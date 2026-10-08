import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import Recorded from '../../../db/entities/Recorded.js';
import Reserve from '../../../db/entities/Reserve.js';
import ProcessUtil from '../../../util/ProcessUtil.js';
import IVideoUtil from '../../api/video/IVideoUtil.js';
import IChannelDB from '../../db/IChannelDB.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import { OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent.js';
import { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { IPromiseQueue } from '../../IPromiseQueue.js';
import IExternalCommandManageModel from './IExternalCommandManageModel.js';

/**
 * 「準備中（子プロセス起動前の非同期処理中）」→「実行中（`child`あり）」→
 * 「確定（`settled`）」→「後始末完了（`finalized`）」という1コマンド分の状態機械。
 * `class`側は同時に1件しか`activeHookCommand`を持たないため、この状態は事実上
 * "現在実行中のフック" のスナップショットとして扱われる。
 */
interface ActiveHookCommand {
    /** 起動済みの子プロセス。準備中（DB検索等）はまだ`null`。 */
    child: ChildProcess | null;
    readonly cmd: string;
    /** `create*Cmd`（コマンド準備〜起動）の Promise。`startCommand`が完了を待つ。 */
    commandPromise: Promise<void> | null;
    readonly commandType: string;
    /** このコマンドの実行完了（成功/失敗を問わない）を表す Promise。`startCommand`の
     *  呼び出し元へ返す。 */
    readonly completion: Promise<void>;
    /** `hookCommandTimeoutMs`超過を検知するタイマー。 */
    deadlineTimer: NodeJS.Timeout | null;
    errorListener: ((err: Error) => void) | null;
    exitListener: (() => void) | null;
    /** `finalize`が実行済みか（後始末の多重実行防止）。 */
    finalized: boolean;
    /** `SIGKILL`送信後、なお終了を確認できない場合に強制解放するまでの猶予タイマー。 */
    killGraceTimer: NodeJS.Timeout | null;
    /** `completion`を解決する関数。`releaseCommand`で一度だけ呼ばれる。 */
    resolveCompletion: (() => void) | null;
    /** タイムアウト後に実際に送信した signal の履歴（ログ用）。 */
    readonly sentSignals: NodeJS.Signals[];
    /** 成功/失敗/タイムアウトのいずれかで一度でも確定したか（`settle`で立てる）。 */
    settled: boolean;
    /** `SIGINT`送信後、`SIGKILL`へ進むまでの猶予タイマー。 */
    terminationGraceTimer: NodeJS.Timeout | null;
    /** タイムアウトで打ち切られたか（`finishFromChildError`でのログ分岐に使う）。 */
    timedOut: boolean;
}

/** ログの出し分け（成功/失敗メッセージの文言）に使う、実行したコマンドの種別大分類。 */
type CommandLogProfile = 'encoding' | 'recorded' | 'reserve';

/**
 * `IExternalCommandManageModel` の実装。予約・録画・エンコードの各イベントに対応する外部
 * コマンド（config.yml の `*Command`）を、`IPromiseQueue`で1件ずつ直列実行する。フック
 * コマンドは終了を確認できないまま放置されないよう、タイムアウト時に`SIGINT`→`SIGKILL`の順で
 * 送信し、それでも終了しなければ確認を諦めて次のコマンドへ進む（`timeoutCommand`〜
 * `finishKillGrace`）。
 */
@injectable()
export default class ExternalCommandManageModel implements IExternalCommandManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private queue: IPromiseQueue;
    private channelDB: IChannelDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    /** 同時に受け付けられる待機件数の上限（config.yml の `hookCommandMaxPending`）。 */
    private readonly hookCommandMaxPending: number;
    /** 1コマンドあたりの実行許容時間（config.yml の `hookCommandTimeoutMs`）。 */
    private readonly hookCommandTimeoutMs: number;
    /** `addCommand`でqueueに投入されたが、まだ実行が開始していない件数。 */
    private pendingHookCommandCount: number = 0;
    /** 現在queueで実行中のコマンドの状態（無ければ`null`）。同時に1件しか持たない。 */
    private activeHookCommand: ActiveHookCommand | null = null;
    /** `withCommandType`が一時的にセットする、これから`addCommand`されるコマンドの種別。
     *  `addReserve`/`addRecorded`/`addFinishEncode`は引数でcommandTypeを受け取らないため、
     *  呼び出し元（`add*Cmd`系）と実際にqueueへ積む処理の間でこの値を経由して受け渡す。 */
    private enqueuingCommandType: string | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.hookCommandMaxPending = this.config.hookCommandMaxPending;
        this.hookCommandTimeoutMs = this.config.hookCommandTimeoutMs;
        this.queue = queue;
        this.channelDB = channelDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
    }

    /**
     * 予約情報更新時のコマンド実行を queue に追加する
     * @param diff: IReserveUpdateValues
     */
    public addUpdateReseves(diff: IReserveUpdateValues): void {
        if (
            typeof diff.insert !== 'undefined' &&
            diff.insert.length > 0 &&
            typeof this.config.reserveNewAddtionCommand !== 'undefined'
        ) {
            for (const r of diff.insert) {
                this.withCommandType('reserve-added', () => this.addReserve(this.config.reserveNewAddtionCommand!, r));
            }
        }

        if (
            typeof diff.update !== 'undefined' &&
            diff.update.length > 0 &&
            typeof this.config.reserveUpdateCommand !== 'undefined'
        ) {
            for (const r of diff.update) {
                this.withCommandType('reserve-updated', () => this.addReserve(this.config.reserveUpdateCommand!, r));
            }
        }

        if (
            typeof diff.delete !== 'undefined' &&
            diff.delete.length > 0 &&
            typeof this.config.reservedeletedCommand !== 'undefined'
        ) {
            for (const r of diff.delete) {
                this.withCommandType('reserve-deleted', () => this.addReserve(this.config.reservedeletedCommand!, r));
            }
        }
    }

    /**
     * 録画準備開始時のコマンド実行を queue に追加する
     * @param reserve: Reserve
     */
    public addRecordingPrepStartCmd(reserve: Reserve): void {
        if (typeof this.config.recordingPreStartCommand === 'undefined') {
            return;
        }

        this.withCommandType('recording-prep-started', () =>
            this.addReserve(this.config.recordingPreStartCommand!, reserve),
        );
    }

    /**
     * 録画準備失敗時のコマンド実行を queue に追加する
     * @param reserve: Reserve
     */
    public addRecordingPrepRecFailedCmd(reserve: Reserve): void {
        if (typeof this.config.recordingPrepRecFailedCommand === 'undefined') {
            return;
        }

        this.withCommandType('recording-prep-cancelled-or-failed', () =>
            this.addReserve(this.config.recordingPrepRecFailedCommand!, reserve),
        );
    }

    /**
     * 録画開始時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingStartCmd(recorded: Recorded): void {
        if (typeof this.config.recordingStartCommand === 'undefined') {
            return;
        }

        this.withCommandType('recording-started', () => this.addRecorded(this.config.recordingStartCommand!, recorded));
    }

    /**
     * 録画終了時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingFinishCmd(recorded: Recorded): void {
        if (typeof this.config.recordingFinishCommand === 'undefined') {
            return;
        }

        this.withCommandType('recording-finished', () =>
            this.addRecorded(this.config.recordingFinishCommand!, recorded),
        );
    }

    /**
     * 録画中にエラー発生時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingFailedCmd(recorded: Recorded): void {
        if (typeof this.config.recordingFailedCommand === 'undefined') {
            return;
        }

        this.withCommandType('recording-failed', () => this.addRecorded(this.config.recordingFailedCommand!, recorded));
    }

    /**
     * エンコードのコマンド実行を queue に追加する
     * @param info: OperatorFinishEncodeInfo
     */
    public addEncodingFinishCmd(info: OperatorFinishEncodeInfo): void {
        this.log.system.info(`encodingFinishCommand: ${this.config.encodingFinishCommand}`);
        if (typeof this.config.encodingFinishCommand === 'undefined') {
            return;
        }

        this.withCommandType('encoding-finished', () => this.addFinishEncode(this.config.encodingFinishCommand!, info));
    }

    /**
     * `enqueuingCommandType`を一時的に`commandType`へ設定した状態で`enqueue`を実行する
     * （`addReserve`等、commandTypeを引数に取らない内部メソッドへ種別を伝えるための仕組み）。
     * @param commandType 一時的に設定する種別
     * @param enqueue この間に実行する処理（実際に`addCommand`するところまで）
     */
    private withCommandType(commandType: string, enqueue: () => void): void {
        const previous = this.enqueuingCommandType;
        this.enqueuingCommandType = commandType;
        try {
            enqueue();
        } finally {
            this.enqueuingCommandType = previous;
        }
    }

    /**
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param reserve: Reserve
     */
    private addReserve(cmd: string, reserve: Reserve): void {
        this.addCommand(this.enqueuingCommandType as string, cmd, () => this.createReserveCmd(cmd, reserve));
    }

    /**
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param reserve: Recorded
     */
    private addRecorded(cmd: string, reserve: Recorded): void {
        this.addCommand(this.enqueuingCommandType as string, cmd, () => this.createRecordedCmd(cmd, reserve));
    }

    /**
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param info OperatorFinishEncodeInfo
     */
    private addFinishEncode(cmd: string, info: OperatorFinishEncodeInfo): void {
        this.addCommand(this.enqueuingCommandType as string, cmd, () => this.createFinishEncodeCmd(cmd, info));
    }

    /**
     * 外部コマンド実行要求をqueueへ積む。`hookCommandMaxPending`を超える要求は実行させずに
     * 捨てる（エラーにはせずログのみ）。
     * @param commandType コマンド種別（ログ用）
     * @param cmd 実行するコマンド文字列（ログ用）
     * @param command 実際にコマンドを準備・起動する処理
     */
    private addCommand(commandType: string, cmd: string, command: () => Promise<void>): void {
        if (this.pendingHookCommandCount >= this.hookCommandMaxPending) {
            this.log.system.error(`hook command queue is full: ${cmd}`);
            return;
        }

        this.pendingHookCommandCount++;
        let isPending = true;
        const releasePending = (): void => {
            if (isPending === false) {
                return;
            }
            isPending = false;
            this.pendingHookCommandCount--;
        };

        try {
            this.queue.add<void>(() => {
                releasePending();
                return this.startCommand(commandType, cmd, command);
            });
        } catch (err: any) {
            releasePending();
            throw err;
        }
    }

    /**
     * `activeHookCommand`を新規作成してタイムアウト監視を開始し、`command`
     * （準備〜子プロセス起動、`create*Cmd`）を実行する。既に実行中のコマンドがある場合は
     * 新規作成せず、そのコマンドの`completion`をそのまま返す（`IPromiseQueue`が直列実行を
     * 保証する前提のため、通常はここに同時に来ない想定の防御）。
     * @param commandType コマンド種別
     * @param cmd 実行するコマンド文字列
     * @param command 実際にコマンドを準備・起動する処理
     * @returns このコマンドの完了を表す Promise（成否に関わらず解決する）
     */
    private startCommand(commandType: string, cmd: string, command: () => Promise<void>): Promise<void> {
        if (this.activeHookCommand !== null) {
            return this.activeHookCommand.completion;
        }

        let resolveCompletion!: () => void;
        const completion = new Promise<void>(resolve => {
            resolveCompletion = resolve;
        });
        const active: ActiveHookCommand = {
            child: null,
            cmd,
            commandPromise: null,
            commandType,
            completion,
            deadlineTimer: null,
            errorListener: null,
            exitListener: null,
            finalized: false,
            killGraceTimer: null,
            resolveCompletion,
            sentSignals: [],
            settled: false,
            terminationGraceTimer: null,
            timedOut: false,
        };
        this.activeHookCommand = active;
        active.deadlineTimer = setTimeout(() => {
            active.deadlineTimer = null;
            this.timeoutCommand(active);
        }, this.hookCommandTimeoutMs);

        let result: Promise<void>;
        try {
            result = command();
        } catch (err: any) {
            this.failCommand(active, err);
            return completion;
        }

        active.commandPromise = Promise.resolve(result);
        void active.commandPromise.then(
            () => {
                if (this.settle(active) === true) {
                    this.finalize(active);
                }
            },
            err => this.failCommand(active, err),
        );
        return completion;
    }

    private failCommand(active: ActiveHookCommand, err: any): void {
        if (this.settle(active) === false) {
            return;
        }
        this.logSafely(() => this.log.system.error(`execute cmd error: ${active.cmd}`));
        this.logSafely(() => this.log.system.error(err));
        this.finalize(active);
    }

    /**
     * 成功/失敗/タイムアウトのいずれかを、そのコマンドについて最初の1回だけ受理する。
     * 既に他の経路で確定済み・既に交代済み（`activeHookCommand`が別のものになっている）
     * 場合は`false`を返し、呼び出し元に以後の処理を諦めさせる。
     * @param active 対象のコマンド状態
     * @returns 今回の呼び出しで確定させてよいか
     */
    private settle(active: ActiveHookCommand): boolean {
        if (this.activeHookCommand !== active || active.settled === true || active.finalized === true) {
            return false;
        }
        active.settled = true;
        return true;
    }

    /**
     * コマンドの後始末（タイマー解除・結果ログ出力）をしたうえで、listener の取り外しと
     * `activeHookCommand`のクリアを次の microtask（`releaseCommand`）へ回す。同一 stack 内で
     * `error`と`exit`が両方積まれているような場合でも、listener 除去が完了するまでは
     * 新しいコマンドを開始させない（queue の次の item は`completion`解決後にしか進まない）
     * ための順序保証。
     * @param active 対象のコマンド状態
     * @param resultLog 後始末に合わせて出す結果ログ（無ければ出さない）
     */
    private finalize(active: ActiveHookCommand, resultLog?: () => void): void {
        if (this.isCommandFinalized(active) === true) {
            return;
        }
        active.finalized = true;
        this.clearCommandTimers(active);
        if (resultLog !== undefined) {
            this.logSafely(resultLog);
        }

        // Keep the error listener through the current stack so an already queued
        // error+exit pair cannot become an unhandled EventEmitter error. The next
        // queue item starts only after this exact listener cleanup completes.
        queueMicrotask(() => this.releaseCommand(active));
    }

    private releaseCommand(active: ActiveHookCommand): void {
        const child = active.child;
        if (child !== null) {
            if (active.exitListener !== null) {
                this.removeOwnedListener(child, 'exit', active.exitListener);
            }
            if (active.errorListener !== null) {
                this.removeOwnedListener(child, 'error', active.errorListener);
            }
        }
        active.exitListener = null;
        active.errorListener = null;
        active.child = null;
        active.commandPromise = null;
        if (this.activeHookCommand === active) {
            this.activeHookCommand = null;
        }
        const resolveCompletion = active.resolveCompletion;
        active.resolveCompletion = null;
        if (resolveCompletion !== null) {
            resolveCompletion();
        }
    }

    private clearCommandTimers(active: ActiveHookCommand): void {
        const deadlineTimer = active.deadlineTimer;
        const terminationGraceTimer = active.terminationGraceTimer;
        const killGraceTimer = active.killGraceTimer;
        active.deadlineTimer = null;
        active.terminationGraceTimer = null;
        active.killGraceTimer = null;
        this.clearOwnedTimer(deadlineTimer);
        this.clearOwnedTimer(terminationGraceTimer);
        this.clearOwnedTimer(killGraceTimer);
    }

    private clearOwnedTimer(timer: NodeJS.Timeout | null): void {
        if (timer === null) {
            return;
        }
        try {
            clearTimeout(timer);
        } catch (err: any) {
            this.logSafely(() => this.log.system.error('failed to clear hook command timer'));
            this.logSafely(() => this.log.system.error(err));
            try {
                clearTimeout(timer);
            } catch (retryErr: any) {
                this.logSafely(() => this.log.system.error(retryErr));
                try {
                    clearInterval(timer);
                } catch (fallbackErr: any) {
                    this.logSafely(() => this.log.system.error(fallbackErr));
                }
            }
        }
    }

    private removeOwnedListener(
        child: ChildProcess,
        event: 'error' | 'exit',
        listener: (...args: any[]) => void,
    ): void {
        try {
            child.removeListener(event, listener);
        } catch (err: any) {
            this.logSafely(() => this.log.system.error(`failed to remove hook command ${event} listener`));
            this.logSafely(() => this.log.system.error(err));
            try {
                EventEmitter.prototype.removeListener.call(child, event, listener);
            } catch (fallbackErr: any) {
                this.logSafely(() => this.log.system.error(fallbackErr));
            }
        }
    }

    private logSafely(write: () => void): void {
        try {
            write();
        } catch (_err: any) {
            // A logging failure must not own command lifecycle progress.
        }
    }

    /**
     * `hookCommandTimeoutMs`超過時のエントリポイント。子プロセスがまだ無い（準備処理が
     * 長引いている）場合は即座に確定させる。子プロセスがある場合は`SIGINT`を送り、
     * 3秒待って（`finishTerminationGrace`）も終了しなければ`SIGKILL`へ進む。
     * @param active 対象のコマンド状態
     */
    private timeoutCommand(active: ActiveHookCommand): void {
        if (this.settle(active) === false) {
            return;
        }
        active.timedOut = true;
        this.logSafely(() => this.log.system.error(`hook command timed out: ${active.cmd}`));
        if (active.child === null) {
            this.finalize(active);
            return;
        }

        this.attemptSignal(active, 'SIGINT');
        if (this.isCommandFinalized(active) === true) {
            return;
        }
        if (this.hasChildExited(active) === true) {
            this.finalize(active);
            return;
        }
        active.terminationGraceTimer = setTimeout(() => {
            active.terminationGraceTimer = null;
            this.finishTerminationGrace(active);
        }, 3_000);
    }

    private finishTerminationGrace(active: ActiveHookCommand): void {
        if (this.activeHookCommand !== active || active.finalized === true) {
            return;
        }
        if (this.hasChildExited(active) === true) {
            this.finalize(active);
            return;
        }
        this.attemptSignal(active, 'SIGKILL');
        if (this.isCommandFinalized(active) === true) {
            return;
        }
        if (this.hasChildExited(active) === true) {
            this.finalize(active);
            return;
        }
        active.killGraceTimer = setTimeout(() => {
            active.killGraceTimer = null;
            this.finishKillGrace(active);
        }, 3_000);
    }

    private finishKillGrace(active: ActiveHookCommand): void {
        if (this.activeHookCommand !== active || active.finalized === true) {
            return;
        }
        if (this.hasChildExited(active) === true) {
            this.finalize(active);
            return;
        }
        const pid = active.child?.pid ?? 'unknown';
        this.logSafely(() =>
            this.log.system.error(
                `hook command termination-unconfirmed forced-release: type=${active.commandType} pid=${pid} signals=${active.sentSignals.join(',')}`,
            ),
        );
        this.finalize(active);
    }

    private attemptSignal(active: ActiveHookCommand, signal: NodeJS.Signals): void {
        const child = active.child;
        if (child === null) {
            return;
        }
        active.sentSignals.push(signal);
        try {
            child.kill(signal);
        } catch (err: any) {
            this.logSafely(() =>
                this.log.system.error(
                    `hook command signal attempt failed: type=${active.commandType} pid=${child.pid ?? 'unknown'} signal=${signal}`,
                ),
            );
            this.logSafely(() => this.log.system.error(err));
        }
    }

    private hasChildExited(active: ActiveHookCommand): boolean {
        try {
            return active.child !== null && ProcessUtil.isExited(active.child) === true;
        } catch (err: any) {
            this.logSafely(() => this.log.system.error('failed to inspect hook command child state'));
            this.logSafely(() => this.log.system.error(err));
            return false;
        }
    }

    private isCommandFinalized(active: ActiveHookCommand): boolean {
        return active.finalized;
    }

    /**
     * `create*Cmd`の冒頭で使う。現在自分が「準備中の実行対象」であるかを確認して返す
     * （既にタイムアウト等で確定済み・交代済みなら`null`）。
     * @returns 準備を続けてよい場合はその`ActiveHookCommand`、そうでなければ`null`
     */
    private getPreparingCommand(): ActiveHookCommand | null {
        const active = this.activeHookCommand;
        return active !== null && active.settled === false ? active : null;
    }

    /**
     * `create*Cmd`内の各`await`の直後で使う。待っている間にタイムアウト等で確定済みに
     * なっていないかを再確認する（DB検索・パス解決の完了を待つ間にタイムアウトが先に
     * 発生していた場合、その後の子プロセス起動を行わせないため）。
     * @param active 確認対象のコマンド状態
     * @returns まだ準備を続けてよいか
     */
    private isPreparingCommand(active: ActiveHookCommand): boolean {
        return this.activeHookCommand === active && active.settled === false;
    }

    /**
     * 起動した子プロセスを`active`へ結び付け、終了/エラーの listener を張る。
     * spawn直後に既に終了済み（即時終了）の場合は`exit`イベントを待たずに処理する。
     * @param active 対象のコマンド状態
     * @param child 起動した子プロセス
     * @param cmd 実行したコマンド文字列（ログ用）
     * @param profile ログの出し分けに使う種別
     * @returns このコマンドの完了を表す Promise
     */
    private superviseChild(
        active: ActiveHookCommand,
        child: ChildProcess,
        cmd: string,
        profile: CommandLogProfile,
    ): Promise<void> {
        if (this.isPreparingCommand(active) === false) {
            return active.completion;
        }
        active.child = child;
        const exitListener = (): void => this.finishFromChildExit(active, cmd, profile, false);
        const errorListener = (err: Error): void => this.finishFromChildError(active, cmd, profile, err);
        active.exitListener = exitListener;
        active.errorListener = errorListener;
        child.on('exit', exitListener);
        child.on('error', errorListener);

        if (ProcessUtil.isExited(child) === true) {
            this.finishFromChildExit(active, cmd, profile, true);
        }
        return active.completion;
    }

    private finishFromChildExit(
        active: ActiveHookCommand,
        cmd: string,
        profile: CommandLogProfile,
        immediate: boolean,
    ): void {
        if (active.finalized === true) {
            return;
        }
        if (active.timedOut === true) {
            this.finalize(active);
            return;
        }
        if (this.settle(active) === false) {
            return;
        }
        this.finalize(active, () => this.logChildExit(active, cmd, profile, immediate));
    }

    private finishFromChildError(active: ActiveHookCommand, cmd: string, profile: CommandLogProfile, err: Error): void {
        if (active.finalized === true) {
            return;
        }
        if (active.timedOut === true) {
            const pid = active.child?.pid ?? 'unknown';
            this.logSafely(() =>
                this.log.system.error(`hook command child error after timeout: type=${active.commandType} pid=${pid}`),
            );
            this.logSafely(() => this.log.system.error(err));
            if (this.hasChildExited(active) === true) {
                this.finalize(active);
            }
            return;
        }
        if (this.settle(active) === false) {
            return;
        }
        this.finalize(active, () => {
            if (profile === 'reserve') {
                this.log.system.error(`failed: ${cmd}`);
                this.log.system.error(err);
            } else {
                this.log.system.error(`${cmd} process is error`);
                this.log.system.error(String(err));
            }
        });
    }

    private logChildExit(active: ActiveHookCommand, cmd: string, profile: CommandLogProfile, immediate: boolean): void {
        const exitCode = active.child?.exitCode;
        if (immediate === true) {
            if (exitCode === 0) {
                this.log.system.info(`finish: ${cmd}`);
            } else {
                this.log.system.error(`failed: ${cmd}`);
            }
        } else if (profile === 'reserve') {
            if (exitCode == 0) {
                this.log.system.info(`finish: ${cmd}`);
            } else {
                this.log.system.error(`failed: ${cmd}. exit: ${exitCode}`);
            }
        } else if (exitCode == 0) {
            this.log.system.info(`${cmd} process is fin`);
        } else {
            this.log.system.error(`${cmd} process is error. exit: ${exitCode}`);
        }
    }

    /**
     * 外部コマンドを実行する
     * @param cmd: string
     * @param reserve: Reserve
     */
    private async createReserveCmd(cmd: string, reserve: Reserve): Promise<void> {
        const active = this.getPreparingCommand();
        if (active === null) {
            return;
        }
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);
        const commandPath = process.env['PATH'];

        const channel = await this.channelDB.findId(reserve.channelId);
        if (this.isPreparingCommand(active) === false) {
            return;
        }

        const child = spawn(cmds.bin, cmds.args, {
            stdio: 'ignore',
            env: {
                PATH: commandPath,
                RESERVEID: reserve.id,
                PROGRAMID: reserve.programId,
                CHANNELTYPE: reserve.channelType,
                CHANNELID: reserve.channelId,
                CHANNELNAME: channel === null ? null : channel.name,
                HALF_WIDTH_CHANNELNAME: channel === null ? null : channel.halfWidthName,
                STARTAT: reserve.startAt,
                ENDAT: reserve.endAt,
                DURATION: reserve.endAt - reserve.startAt,
                NAME: reserve.name,
                HALF_WIDTH_NAME: reserve.halfWidthName,
                DESCRIPTION: reserve.description,
                HALF_WIDTH_DESCRIPTION: reserve.halfWidthDescription,
                EXTENDED: reserve.extended,
                HALF_WIDTH_EXTENDED: reserve.halfWidthExtended,
            },
        } as any);
        return this.superviseChild(active, child, cmd, 'reserve');
    }

    /**
     * 外部コマンドを実行する
     * @param cmd: string
     * @param recorded: Recorded
     */
    private async createRecordedCmd(cmd: string, recorded: Recorded): Promise<void> {
        const active = this.getPreparingCommand();
        if (active === null) {
            return;
        }
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);
        const commandPath = process.env['PATH'];

        const channel = await this.channelDB.findId(recorded.channelId);
        if (this.isPreparingCommand(active) === false) {
            return;
        }
        const recordedPath =
            typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length === 0
                ? null
                : await this.videoUtil.getFullFilePathFromId(recorded.videoFiles[0].id);
        if (this.isPreparingCommand(active) === false) {
            return;
        }

        const child = spawn(cmds.bin, cmds.args, {
            stdio: 'ignore',
            env: {
                PATH: commandPath,
                RECORDEDID: recorded.id,
                PROGRAMID: recorded.programId,
                CHANNELTYPE: channel === null ? null : channel.channelType,
                CHANNELID: recorded.channelId,
                CHANNELNAME: channel === null ? null : channel.name,
                HALF_WIDTH_CHANNELNAME: channel === null ? null : channel.halfWidthName,
                STARTAT: recorded.startAt,
                ENDAT: recorded.endAt,
                DURATION: recorded.endAt - recorded.startAt,
                NAME: recorded.name,
                HALF_WIDTH_NAME: recorded.halfWidthName,
                DESCRIPTION: recorded.description,
                HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription,
                EXTENDED: recorded.extended,
                HALF_WIDTH_EXTENDED: recorded.halfWidthExtended,
                RECPATH: recordedPath,
                LOGPATH:
                    typeof recorded.dropLogFile === 'undefined' || recorded.dropLogFile === null
                        ? null
                        : path.join(this.config.dropLog, recorded.dropLogFile.filePath),
                ERROR_CNT: recorded.dropLogFile?.errorCnt.toString(10) || null,
                DROP_CNT: recorded.dropLogFile?.dropCnt.toString(10) || null,
                SCRAMBLING_CNT: recorded.dropLogFile?.scramblingCnt.toString(10) || null,
            },
        } as any);
        return this.superviseChild(active, child, cmd, 'recorded');
    }

    /**
     * 外部コマンドを実行する
     * @param cmd string
     * @param info OperatorFinishEncodeInfo
     */
    private async createFinishEncodeCmd(cmd: string, info: OperatorFinishEncodeInfo): Promise<void> {
        const active = this.getPreparingCommand();
        if (active === null) {
            return;
        }
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);
        const commandPath = process.env['PATH'];

        // 番組情報を取得する
        const recorded = await this.recordedDB.findId(info.recordedId);
        if (this.isPreparingCommand(active) === false) {
            return;
        }
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        // 局を取得する
        const channel = await this.channelDB.findId(recorded.channelId);
        if (this.isPreparingCommand(active) === false) {
            return;
        }
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }
        const outputPath =
            info.videoFileId === null ? null : await this.videoUtil.getFullFilePathFromId(info.videoFileId);
        if (this.isPreparingCommand(active) === false) {
            return;
        }

        const child = spawn(cmds.bin, cmds.args, {
            stdio: 'ignore',
            env: {
                PATH: commandPath,
                RECORDEDID: info.recordedId,
                VIDEOFILEID: info.videoFileId === null ? '' : info.videoFileId,
                OUTPUTPATH: outputPath,
                MODE: info.mode,
                NAME: recorded.name,
                HALF_WIDTH_NAME: recorded.halfWidthName,
                DESCRIPTION: recorded.description || '',
                HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription || '',
                EXTENDED: recorded.extended || '',
                HALF_WIDTH_EXTENDED: recorded.halfWidthExtended || '',
                CHANNELID: typeof recorded.channelId === 'number' ? recorded.channelId.toString(10) : '',
                CHANNELNAME: typeof channel.name === 'string' ? channel.name : '',
                HALF_WIDTH_CHANNELNAME: typeof channel.halfWidthName === 'string' ? channel.halfWidthName : '',
            },
        } as any);
        return this.superviseChild(active, child, cmd, 'encoding');
    }
}
declare const __EPGSTATION_COVERAGE_EXCLUSION_EXTERNAL_COMMAND_SYNC_THROW_CATCH_20260924: unique symbol;
