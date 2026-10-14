import { ChildProcess, spawn } from 'child_process';
import { inject, injectable, optional } from 'inversify';
import ProcessUtil from '../../../util/ProcessUtil.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { ServiceProcessDescriptor, ServiceProcessReporter } from '../../ipc/IServiceProcessReport.js';
import IEncodeProcessManageModel, {
    CreateProcessOption,
    ManagedProcessHandle,
    ManagedProcessStartResult,
    ManagedStopRequestResult,
} from './IEncodeProcessManageModel.js';

type ManagedProcessState = 'starting' | 'running' | 'stopping' | 'released';
type ManagedProcessKind = 'process' | 'hls-writer';

/** 停止の signal を送った後に終了を確かめる回数。 */
export const PROCESS_STOP_CHECK_COUNT = 3;
/** 終了を確かめる間隔（ミリ秒）。 */
export const PROCESS_STOP_CHECK_INTERVAL_MS = 1000;

/** 段階的な停止で送る signal。 */
export type StopSignal = 'SIGINT' | 'SIGKILL';

/** `stopInStages`が対象の生存確認・signal送信・待機に使う操作。 */
export interface StagedStopSteps {
    /** 対象が生きているか。確かめられなければ`undefined`（居なくなったとはみなさない）。 */
    isAlive(stage: string): boolean | undefined;
    /** signalを送る。送れたら`true`。 */
    send(signal: StopSignal): boolean;
    /** 確認の間隔だけ待つ。待てなかったら`false`（その回の確認を飛ばす）。 */
    wait(stage: StopSignal): Promise<boolean>;
    /** 確認を待たずに終了が分かったか（実行枠の解放など）。 */
    isSettled(): boolean;
}

/** `stopInStages`の結果。 */
export interface StagedStopResult {
    /** 最初の確認で居なくなっていなかったか。 */
    wasRunning: boolean;
    /** 終了を確かめられたか。 */
    exitConfirmed: boolean;
    /** 実際に送れたsignal。 */
    sentSignals: StopSignal[];
}

/**
 * 対象を`signals`の順に停止する。最初に生存を確かめ、居なければ何も送らない。各signalを送った後は
 * `PROCESS_STOP_CHECK_INTERVAL_MS`ごとに最大`PROCESS_STOP_CHECK_COUNT`回終了を確かめ、確かめられたらそこで終える。
 * HLS writerの停止（`SIGINT`→`SIGKILL`）と、Web・API側処理が終了したときに管理側が行う停止の両方が使う。
 * @param signals 送るsignalの順
 * @param steps 生存確認・signal送信・待機の操作
 * @returns 停止の結果
 */
export const stopInStages = async (
    signals: readonly StopSignal[],
    steps: StagedStopSteps,
): Promise<StagedStopResult> => {
    const sentSignals: StopSignal[] = [];
    if (steps.isAlive('initial-check') === false) {
        return { wasRunning: false, exitConfirmed: true, sentSignals };
    }
    for (const signal of signals) {
        if (steps.send(signal)) {
            sentSignals.push(signal);
        }
        if (await pollUntilExit(signal, steps)) {
            return { wasRunning: true, exitConfirmed: true, sentSignals };
        }
    }
    return { wasRunning: true, exitConfirmed: false, sentSignals };
};

const pollUntilExit = async (stage: StopSignal, steps: StagedStopSteps): Promise<boolean> => {
    for (let attempt = 0; attempt < PROCESS_STOP_CHECK_COUNT; attempt++) {
        if (steps.isSettled()) {
            return true;
        }
        if ((await steps.wait(stage)) === false) {
            continue;
        }
        if (steps.isSettled()) {
            return true;
        }
        if (steps.isAlive(`${stage}-check`) === false) {
            return true;
        }
    }
    return false;
};

interface HlsWriterHandle extends ManagedProcessHandle {
    readonly kind: 'hls-writer';
}

interface HlsWriterStartResult extends ManagedProcessStartResult {
    handle: HlsWriterHandle;
}

interface HlsWriterStopResult {
    exitConfirmed: boolean;
    sentSignals: Array<'SIGINT' | 'SIGKILL'>;
    slotReleased: true;
}

interface ChildProcessInfo {
    child: ChildProcess;
    handle: ManagedProcessHandle;
    kind: ManagedProcessKind;
    pgid?: number;
    pid?: number;
    directTerminalConfirmed: boolean;
    directCloseConfirmed: boolean;
    groupAbsentConfirmed: boolean;
    priority: number;
    processId: number;
    /** 依頼元が添えた処理種別。あれば起動の成立と解放を管理側へ知らせる。 */
    report?: ServiceProcessDescriptor;
    /** 管理側へ開始を知らせたPID。解放時に同じPIDの終了を知らせる。 */
    reportedPid?: number;
    slotReleased: boolean;
    slotReleasedAt?: number;
    slotReleasedPromise: Promise<void>;
    slotReleasedResolve: () => void;
    state: ManagedProcessState;
    stopRequestOperation?: Promise<ManagedStopRequestResult>;
    hlsStopOperation?: Promise<HlsWriterStopResult>;
    groupAbsenceCheckOperation?: Promise<void>;
    token: object;
    removeLifecycleListeners: () => void;
}

interface ReplacementReservation {
    consumed: boolean;
    target: ChildProcessInfo;
    token: object;
}

/**
 * `IEncodeProcessManageModel` の実装。エンコード用子プロセスと、ライブHLS用に独立した
 * プロセスグループで起動する「hls-writer」プロセスの両方を、同じ同時実行数の上限
 * （`maxEncode`）の下で管理する。上限に達した状態で高優先度の要求が来た場合は、
 * より優先度の低い実行中プロセスを停止（`killAndCreateProcess`）してから空いた枠へ
 * 新規プロセスを起動する。呼び出し元には内部状態（`ChildProcessInfo`）を渡さず、
 * `handles`で管理する不透明な `ManagedProcessHandle` だけを返す。
 */
@injectable()
class EncodeProcessManageModel implements IEncodeProcessManageModel {
    private log: ILogger;
    /** 同時に起動できるプロセス数の上限。config.yml の `encodeProcessNum` から constructor で
     *  一度だけ設定され、以降変化しない。 */
    private maxEncode: number;
    /** 起動中・稼働中・停止処理中のプロセス一覧。新規プロセスは `unshift` で先頭に追加し、
     *  `release` で完全に解放された時点で取り除かれる。 */
    private childs: ChildProcessInfo[] = [];
    /** `startProcess` が実際に子プロセスを spawn して `childs` へ登録するまでの間、枠を
     *  二重に消費させないための予約票。`admit` で追加し、登録完了時に削除する。 */
    private reservations = new Set<object>();
    /** `killAndCreateProcess` による差し替え中の枠を表す予約。対象プロセスの停止が完了して
     *  `slotReleased` になるまでは `occupiedSlotCount` が枠を占有中として数え続けるための
     *  記録で、停止完了もしくは差し替え失敗のいずれかで削除される。 */
    private replacementReservations = new Set<ReplacementReservation>();
    /** 呼び出し元に渡す不透明な `ManagedProcessHandle` から、対応する内部状態
     *  （`ChildProcessInfo`）を引くための対応表。`handle` がGCされれば自動的に消える。 */
    private handles = new WeakMap<ManagedProcessHandle, ChildProcessInfo>();
    /** 外部プロセスの開始と終了を管理側へ知らせる窓口。注入されなければ知らせない。 */
    private reporter: ServiceProcessReporter | null;

    constructor(
        @inject('ILoggerModel') logeer: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IServiceProcessReporter') @optional() reporter?: ServiceProcessReporter,
    ) {
        this.log = logeer.getLogger();
        this.maxEncode = configure.getConfig().encodeProcessNum;
        this.reporter = reporter ?? null;
    }

    /**
     * 旧来のインターフェース向けの生成 method。`ManagedProcessHandle` を使わない既存の
     * 呼び出し元が handle 移行を終えるまでの互換用で、成功時に `child` だけを返す。
     * @param option 起動するコマンド・優先度等
     * @returns 起動した子プロセス
     */
    public create(option: CreateProcessOption): Promise<ChildProcess> {
        return this.admit(option, true, 'process').then(result => result.child);
    }

    /**
     * 枠を同期的に予約したうえで、管理対象のプロセスを1つ起動する。
     * @param option 起動するコマンド・優先度等
     * @returns 起動した子プロセスと、以後の停止要求に使う不透明な handle
     */
    public createManaged(option: CreateProcessOption): Promise<ManagedProcessStartResult> {
        return this.admit(option, false, 'process');
    }

    /**
     * ライブHLS用の writer プロセスを、自身が leader となる独立したプロセスグループとして
     * 起動する。プロセスグループにすることで、`stopHls` で子孫プロセスごと確実に停止できる。
     * @param option 起動するコマンド・優先度等
     * @returns 起動した子プロセスと handle（`kind: 'hls-writer'`）
     */
    public createHlsWriter(option: CreateProcessOption): Promise<HlsWriterStartResult> {
        return this.admit(option, false, 'hls-writer') as Promise<HlsWriterStartResult>;
    }

    /**
     * 空き枠があれば即座に起動し、無ければより優先度の低い実行中プロセスを探して
     * 差し替え（停止してから起動）を試みる。差し替え対象も見つからない場合は拒否する。
     * @param option 起動するコマンド・優先度等
     * @param legacyStart `true` の場合、`spawn` イベント到達前でも即座に resolve する
     *   （`create` からの呼び出し向けの旧挙動）
     * @param kind 起動するプロセスの種別
     * @returns 起動結果
     */
    private admit(
        option: CreateProcessOption,
        legacyStart: boolean,
        kind: ManagedProcessKind,
    ): Promise<ManagedProcessStartResult> {
        if (this.occupiedSlotCount() < this.maxEncode) {
            return this.startProcess(option, legacyStart, kind);
        }

        const replacementTarget = this.childs.find(
            child => child.state === 'running' && option.priority > child.priority,
        );
        if (replacementTarget === undefined) {
            return Promise.reject(new Error('EncodeProcessManageModelCreateError'));
        }

        return this.killAndCreateProcess(replacementTarget, option, legacyStart, kind);
    }

    /**
     * 現時点で占有されている（または占有される見込みの）枠数を数える。`childs` の実在プロセスと
     * `reservations` の起動処理中の枠に加え、差し替え中で対象プロセスの停止は完了したが
     * まだ新プロセスの起動が完了していない枠（`replacementReservations` のうち
     * `consumed`でなく`slotReleased`済みのもの）も占有中として数える。これにより、
     * 差し替え処理の完了前に別の要求が同じ枠へ二重に入り込むのを防ぐ。
     * @returns 占有中とみなす枠数
     */
    private occupiedSlotCount(): number {
        let releasedReplacementSlots = 0;
        for (const reservation of this.replacementReservations) {
            if (!reservation.consumed && reservation.target.slotReleased) {
                releasedReplacementSlots++;
            }
        }
        return this.childs.length + this.reservations.size + releasedReplacementSlots;
    }

    /**
     * handle が指すプロセスへ停止（`SIGINT`）を要求する。同じプロセスへ対して重複して
     * 呼ばれた場合は新たに要求を送らず、先に発行済みの操作へ合流する。
     * @param handle 停止対象のプロセスの handle
     * @returns 要求結果。既に解放済みなら送信無しで `already-released` を返す
     */
    public requestStop(handle: ManagedProcessHandle): Promise<ManagedStopRequestResult> {
        const child = this.handles.get(handle);
        if (child === undefined || child.slotReleased) {
            return Promise.resolve({ status: 'already-released', sentSignals: [] });
        }
        if (child.stopRequestOperation !== undefined) {
            return child.stopRequestOperation;
        }

        let resolveStop: (result: ManagedStopRequestResult) => void = () => {};
        let rejectStop: (reason?: any) => void = () => {};
        const stopRequestOperation = new Promise<ManagedStopRequestResult>((resolve, reject) => {
            resolveStop = resolve;
            rejectStop = reject;
        });
        child.stopRequestOperation = stopRequestOperation;
        child.state = 'stopping';
        ProcessUtil.kill(child.child).then(
            () => resolveStop({ status: 'requested', sentSignals: ['SIGINT'] }),
            rejectStop,
        );
        return stopRequestOperation;
    }

    /**
     * handle が指す hls-writer のプロセスグループ全体を停止する。同じプロセスへの重複呼び出しは
     * 先に発行済みの操作へ合流する。対象が hls-writer でない、または既に解放済みの場合は
     * 何もせず解放済み扱いの結果を返す。
     * @param handle 停止対象の hls-writer の handle
     * @returns 停止結果（実際に終了を確認できたか、送信した signal 一覧）
     */
    public stopHls(handle: ManagedProcessHandle): Promise<HlsWriterStopResult> {
        const processInfo = this.handles.get(handle);
        if (processInfo === undefined || processInfo.kind !== 'hls-writer' || processInfo.slotReleased) {
            return Promise.resolve({ exitConfirmed: true, sentSignals: [], slotReleased: true });
        }
        if (processInfo.hlsStopOperation !== undefined) {
            return processInfo.hlsStopOperation;
        }

        let resolveStop: (result: HlsWriterStopResult) => void = () => {};
        let rejectStop: (reason?: any) => void = () => {};
        const operation = new Promise<HlsWriterStopResult>((resolve, reject) => {
            resolveStop = resolve;
            rejectStop = reject;
        });
        processInfo.hlsStopOperation = operation;
        processInfo.state = 'stopping';
        this.stopHlsProcessGroup(processInfo).then(resolveStop, rejectStop);
        return operation;
    }

    /**
     * hls-writer のプロセスグループを `SIGINT` → （生存していれば）`SIGKILL` の順に停止し、
     * 各 signal 送信後に生死をポーリングして確認する。生存確認自体が失敗した場合
     * （`isHlsGroupAlive` が `undefined` を返す）は「既に居ない」とはみなさず次の段階へ進む。
     * 最終的に終了を確認できなかった場合でも枠は必ず解放する（`finally`）。
     * @param processInfo 停止対象の内部状態
     * @returns 終了を確認できたか、実際に送信した signal 一覧
     */
    private async stopHlsProcessGroup(processInfo: ChildProcessInfo): Promise<HlsWriterStopResult> {
        const pid = processInfo.pid!;
        const pgid = processInfo.pgid!;
        let sentSignals: StopSignal[];
        let exitConfirmed = false;

        try {
            ({ exitConfirmed, sentSignals } = await stopInStages(['SIGINT', 'SIGKILL'], {
                isAlive: stage => this.isHlsGroupAlive(processInfo, pgid, stage),
                send: signal => this.sendHlsSignal(processInfo, pgid, signal),
                wait: async stage => {
                    try {
                        await ProcessUtil.wait(PROCESS_STOP_CHECK_INTERVAL_MS);
                        return true;
                    } catch (err: any) {
                        this.logHlsStopError(processInfo, pgid, `${stage}-wait`, err);
                        return false;
                    }
                },
                isSettled: () => processInfo.slotReleased,
            }));
        } finally {
            if (!exitConfirmed && !processInfo.directCloseConfirmed) {
                this.retainReleasedErrorSink(processInfo.child);
            }
            this.release(processInfo);
        }

        if (!exitConfirmed) {
            this.log.encode.error({
                forcedSlotRelease: true,
                kind: processInfo.kind,
                pgid,
                pid,
                sentSignals,
                terminalConfirmed: false,
            });
        }
        return { exitConfirmed, sentSignals, slotReleased: true };
    }

    private isHlsGroupAlive(processInfo: ChildProcessInfo, pgid: number, stage: string): boolean | undefined {
        try {
            return ProcessUtil.isProcessGroupAlive(pgid);
        } catch (err: any) {
            this.logHlsStopError(processInfo, pgid, stage, err);
            return undefined;
        }
    }

    private sendHlsSignal(processInfo: ChildProcessInfo, pgid: number, signal: StopSignal): boolean {
        try {
            ProcessUtil.killProcessGroup(pgid, signal);
            return true;
        } catch (err: any) {
            this.logHlsStopError(processInfo, pgid, `${signal}-send`, err);
            return false;
        }
    }

    private logHlsStopError(processInfo: ChildProcessInfo, pgid: number, stage: string, err: any): void {
        this.log.encode.error({ kind: processInfo.kind, pgid, pid: processInfo.pid, stage });
        this.log.encode.error(err);
    }

    /**
     * 実際に子プロセスを spawn し、内部状態（`ChildProcessInfo`）を作って `childs`/`handles`
     * に登録したうえで、lifecycle イベント（`attachLifecycle`）を張る。spawn 自体に失敗した
     * 場合は予約（`reservations`）だけ取り消して reject する。
     * @param option 起動するコマンド・優先度等
     * @param legacyStart `attachLifecycle` へ渡す旧挙動フラグ
     * @param kind 起動するプロセスの種別
     * @returns 起動結果
     */
    private startProcess(
        option: CreateProcessOption,
        legacyStart: boolean,
        kind: ManagedProcessKind,
    ): Promise<ManagedProcessStartResult> {
        const token = {};
        const handle = Object.freeze(kind === 'hls-writer' ? { kind } : {}) as ManagedProcessHandle;
        this.reservations.add(token);

        return new Promise<ManagedProcessStartResult>((resolve, reject) => {
            let child: ChildProcess;
            try {
                child = this.spawnProcess(option, kind);
            } catch (err: any) {
                this.reservations.delete(token);
                this.log.encode.error('create encode process failed');
                this.log.encode.error(err);
                reject(err);
                return;
            }

            let slotReleasedResolve: () => void = () => {};
            const slotReleasedPromise = new Promise<void>(slotResolve => {
                slotReleasedResolve = slotResolve;
            });
            const processInfo: ChildProcessInfo = {
                child,
                handle,
                kind,
                pgid: kind === 'hls-writer' ? child.pid : undefined,
                pid: kind === 'hls-writer' ? child.pid : undefined,
                directTerminalConfirmed: false,
                directCloseConfirmed: false,
                groupAbsentConfirmed: false,
                priority: option.priority,
                processId: Date.now(),
                report: option.report,
                slotReleased: false,
                slotReleasedPromise,
                slotReleasedResolve,
                state: 'starting',
                token,
                removeLifecycleListeners: () => {},
            };
            this.childs.unshift(processInfo);
            this.handles.set(handle, processInfo);
            this.reservations.delete(token);
            this.attachLifecycle(processInfo, resolve, reject, legacyStart);
        });
    }

    /**
     * コマンド文字列を解釈し、`%INPUT%`/`%OUTPUT%` をプレースホルダー置換したうえで実際に
     * `spawn` する。hls-writer は独立したプロセスグループの leader にする必要があるため
     * `detached: true` を強制する。
     * @param option 起動するコマンド・入出力パス等
     * @param kind 起動するプロセスの種別
     * @returns spawn した子プロセス
     */
    private spawnProcess(option: CreateProcessOption, kind: ManagedProcessKind): ChildProcess {
        let cmds: ProcessUtil.Cmds;
        try {
            cmds = ProcessUtil.parseCmdStr(option.cmd);
        } catch (err: any) {
            this.log.encode.error(`build process error: ${option.cmd}`);
            throw err;
        }

        cmds.args = cmds.args.map(arg => {
            if (option.input !== null) {
                arg = arg.replace(/%INPUT%/g, option.input);
            }
            if (option.output !== null) {
                arg = arg.replace(/%OUTPUT%/g, option.output);
            }
            return arg;
        });

        if (kind === 'hls-writer') {
            return spawn(cmds.bin, cmds.args, { ...option.spawnOption, detached: true });
        }
        return option.spawnOption === undefined
            ? spawn(cmds.bin, cmds.args)
            : spawn(cmds.bin, cmds.args, option.spawnOption);
    }

    /**
     * 子プロセスの `spawn`/`error`/`exit`/`close` を監視し、起動確定・異常終了・停止確認を
     * `processInfo.state` の遷移へ反映する。hls-writer は `spawn` 時に pid を取得できたかで
     * プロセスグループの起動成否を判定し、失敗時は枠を解放して reject する。終了系イベントは
     * `onTerminal`（`exit`）と `onClose`（`close`、標準入出力の完全な破棄まで待つ）の双方から
     * 呼ばれるが、`release` 自体は多重解放を防ぐ実装になっている。listener を後から確実に
     * 外せるよう、解除用の関数を `processInfo.removeLifecycleListeners` に保存する。
     * @param processInfo 監視対象の内部状態
     * @param resolve `createManaged`/`createHlsWriter` 呼び出しの成功を確定させる関数
     * @param reject 同じ呼び出しの失敗を確定させる関数
     * @param legacyStart `true` の場合、`spawn` イベントを待たずに即座に resolve する
     *   （`create` からの呼び出し向けの旧挙動）
     */
    private attachLifecycle(
        processInfo: ChildProcessInfo,
        resolve: (result: ManagedProcessStartResult) => void,
        reject: (reason?: any) => void,
        legacyStart: boolean,
    ): void {
        const { child } = processInfo;

        const onSpawn = (): void => {
            if (
                processInfo.kind === 'hls-writer' &&
                (!Number.isSafeInteger(processInfo.pid) || processInfo.pid! <= 0)
            ) {
                this.release(processInfo);
                reject(new Error('HlsWriterProcessGroupStartError'));
                return;
            }
            processInfo.state = 'running';
            this.log.encode.info(`create new encode process: ${processInfo.processId}`);
            this.reportStarted(processInfo);
            resolve({ child, handle: processInfo.handle });
        };
        const onError = (err: Error): void => {
            if (processInfo.state !== 'starting') {
                this.log.encode.error(err);
                return;
            }
            this.release(processInfo);
            reject(err);
        };
        const onTerminal = (): void => {
            processInfo.directTerminalConfirmed = true;
            if (processInfo.kind === 'hls-writer' && processInfo.state !== 'starting') {
                this.confirmHlsGroupAbsent(processInfo);
                return;
            }
            this.release(processInfo);
            reject(new Error('EncodeProcessManageModelStartError'));
        };
        const onClose = (): void => {
            processInfo.directCloseConfirmed = true;
            onTerminal();
        };
        const stdoutData = (): void => {};
        const stderrData = (): void => {};

        child.once('spawn', onSpawn);
        child.on('error', onError);
        child.on('exit', onTerminal);
        child.on('close', onClose);
        child.stdout?.on('data', stdoutData);
        child.stderr?.on('data', stderrData);
        processInfo.removeLifecycleListeners = () => {
            child.removeListener('spawn', onSpawn);
            child.removeListener('error', onError);
            child.removeListener('exit', onTerminal);
            child.removeListener('close', onClose);
            child.stdout?.removeListener('data', stdoutData);
            child.stderr?.removeListener('data', stderrData);
        };

        if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') {
            onTerminal();
        } else if (legacyStart) {
            resolve({ child, handle: processInfo.handle });
        }
    }

    /**
     * プロセスの枠を解放する（多重解放は無視する）。`process` 種別が「起動済みで、直接の
     * `exit` は確認できたが `close`（標準入出力の完全な破棄）はまだ確認できていない」状態で
     * 解放される場合、まだ書き込まれうる標準エラー出力が unhandled `'error'` で
     * プロセス全体を落とさないよう、`retainReleasedErrorSink` で受け皿を張ってから解放する。
     * @param processInfo 解放する内部状態
     */
    private release(processInfo: ChildProcessInfo): void {
        if (processInfo.slotReleased) {
            return;
        }
        const retainNormalErrorSink =
            processInfo.kind === 'process' &&
            processInfo.state !== 'starting' &&
            processInfo.directTerminalConfirmed &&
            !processInfo.directCloseConfirmed;
        processInfo.slotReleasedAt = globalThis.performance.now();
        processInfo.slotReleased = true;
        processInfo.state = 'released';
        processInfo.removeLifecycleListeners();
        if (retainNormalErrorSink) {
            this.retainReleasedErrorSink(processInfo.child);
        }
        const index = this.childs.indexOf(processInfo);
        this.childs.splice(index, 1);
        this.handles.delete(processInfo.handle);
        if (processInfo.reportedPid !== undefined) {
            this.reporter!.ended(processInfo.reportedPid);
        }
        processInfo.slotReleasedResolve();
    }

    /**
     * 依頼元が処理種別を添えたプロセスの起動の成立を、PID（HLS writerはPGIDも）とともに管理側へ知らせる。
     * 処理種別が無い、知らせる窓口が無い、またはPIDが無い場合は知らせない。
     * @param processInfo 起動が成立したプロセスの内部状態
     */
    private reportStarted(processInfo: ChildProcessInfo): void {
        const pid = processInfo.child.pid;
        if (processInfo.report === undefined || this.reporter === null || typeof pid !== 'number') {
            return;
        }
        processInfo.reportedPid = pid;
        this.reporter.started(
            processInfo.kind === 'hls-writer'
                ? { ...processInfo.report, pid, pgid: processInfo.pgid }
                : { ...processInfo.report, pid },
        );
    }

    /**
     * 解放後もまだ発生しうる `'error'` イベントを、プロセス終了（`'close'`）まで黙って
     * 受け止め続けるための listener を張る。Node.js は `ChildProcess` の `'error'` に
     * listener が無いと例外を投げて process 全体を落とすため、解放済みプロセスの
     * 後始末としてこの受け皿が要る。
     * @param child 対象の子プロセス
     */
    private retainReleasedErrorSink(child: ChildProcess): void {
        const errorSink = (): void => {};
        const removeSink = (): void => {
            child.removeListener('error', errorSink);
        };
        child.on('error', errorSink);
        child.once('close', removeSink);
    }

    /**
     * hls-writer で `exit`/`close` を受け取った後、実際にプロセスグループ自体が居なくなって
     * いるかを非同期に確認し、確認できた時点で改めて枠を解放する。同じ確認が重複して
     * 走らないよう、進行中の確認は `processInfo.groupAbsenceCheckOperation` に保持する。
     * @param processInfo 確認対象の内部状態
     */
    private confirmHlsGroupAbsent(processInfo: ChildProcessInfo): void {
        if (processInfo.slotReleased || processInfo.groupAbsenceCheckOperation !== undefined) {
            return;
        }
        let resolveCheck: () => void = () => {};
        const operation = new Promise<void>(resolve => {
            resolveCheck = resolve;
        });
        processInfo.groupAbsenceCheckOperation = operation;
        Promise.resolve()
            .then(() => ProcessUtil.isProcessGroupAlive(processInfo.pgid!))
            .then(alive => {
                if (!alive && !processInfo.slotReleased) {
                    processInfo.groupAbsentConfirmed = true;
                    this.release(processInfo);
                }
            })
            .catch(err => this.logHlsStopError(processInfo, processInfo.pgid!, 'terminal-check', err))
            .finally(() => {
                processInfo.groupAbsenceCheckOperation = undefined;
                resolveCheck();
            });
    }

    /**
     * 優先度の低い実行中プロセス（`target`）を停止させ、解放を確認してから代わりのプロセスを
     * 起動する。停止～解放が3秒以内に終わらない場合はタイムアウト扱いにする（`setImmediate`で
     * 実際に解放済みかどうかを再確認してから reject することで、`setTimeout` の遅延と実際の
     * 解放タイミングの際どい競合による誤タイムアウトを避けている）。差し替えの間、対象の枠は
     * `replacementReservations` に登録し、`occupiedSlotCount` から占有中として見え続ける
     * ようにする。
     * @param target 停止させる対象の内部状態（呼び出し元で優先度確認済み）
     * @param option 新たに起動するコマンド・優先度等
     * @param legacyStart `startProcess` へ渡す旧挙動フラグ
     * @param kind 起動するプロセスの種別
     * @returns 新しく起動したプロセスの起動結果
     */
    private async killAndCreateProcess(
        target: ChildProcessInfo,
        option: CreateProcessOption,
        legacyStart: boolean,
        kind: ManagedProcessKind,
    ): Promise<ManagedProcessStartResult> {
        const reservation: ReplacementReservation = { consumed: false, target, token: {} };
        this.replacementReservations.add(reservation);
        const deadline = globalThis.performance.now() + 3 * 1000;
        const releasedByDeadline = (): boolean =>
            target.slotReleasedAt !== undefined && target.slotReleasedAt <= deadline;
        let timeoutId: NodeJS.Timeout | undefined;
        let deadlineCheckId: NodeJS.Immediate | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
                deadlineCheckId = setImmediate(() => {
                    if (!releasedByDeadline()) {
                        reject(new Error('EncodeProcessManageModelTimeoutError'));
                    }
                });
            }, 3 * 1000);
        });
        const stopAndRelease = (async (): Promise<void> => {
            try {
                if (target.kind === 'hls-writer') {
                    await this.stopHls(target.handle);
                } else {
                    await this.requestStop(target.handle);
                }
            } catch (err: any) {
                this.log.encode.error(`kill process failed: ${target.processId}`);
                this.log.encode.error(err);
                throw err;
            }
            await target.slotReleasedPromise;
            if (!releasedByDeadline()) {
                throw new Error('EncodeProcessManageModelTimeoutError');
            }
        })();
        try {
            await Promise.race([stopAndRelease, timeout]);
            reservation.consumed = true;
            this.replacementReservations.delete(reservation);
            const result = await this.startProcess(option, legacyStart, kind);
            this.log.encode.info(`kill & create new encode process: ${Date.now()}`);
            return result;
        } catch (err: any) {
            this.replacementReservations.delete(reservation);
            throw err;
        } finally {
            clearTimeout(timeoutId);
            clearImmediate(deadlineCheckId);
        }
    }
}

export default EncodeProcessManageModel;
