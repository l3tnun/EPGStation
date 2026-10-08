import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import internal from 'stream';
import type * as apid from '../../../../../api.js';
import FileUtil from '../../../../util/FileUtil.js';
import IConfigFile from '../../../IConfigFile.js';
import IConfiguration from '../../../IConfiguration.js';
import ILogger from '../../../ILogger.js';
import ILoggerModel from '../../../ILoggerModel.js';
import IEncodeProcessManageModel, { HlsWriterStopResult } from '../../encode/IEncodeProcessManageModel.js';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel.js';
import IHLSFileDeleterModel, { HLSFileDeleterOption, HlsArtifactCleanupResult } from '../util/IHLSFileDeleterModel.js';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from './IStreamBaseModel.js';

/**
 * `HlsStopFinalization.artifactCleanupOperation` を1回試みた結果の記録。
 * `artifactCleanupAttempts` に積み重ね、複数回試みた場合の診断ログに使う。
 */
export interface HlsArtifactCleanupAttempt {
    readonly failure?: unknown;
    readonly result?: HlsArtifactCleanupResult;
}

/** `hlsArtifactOwners` レジストリのキー（`streamFilePath`+`streamId`）に対する値の型。 */
type HlsArtifactOwner = symbol;
// Symbols are compared by identity, so no mutable session state is shared.
// The registry remains private to the stream base implementation.

/**
 * ある streamId の HLS 配信1回分について、ディスク上の artifact（segment/playlist
 * ファイル）の所有権と後始末結果を追跡する状態。`prepStreamDir` で生成され、
 * `stopHlsWriter`/`cleanupHlsArtifacts`/`finalizeStop` 等が結果を書き込んでいく。
 */
export interface HlsStopFinalization {
    artifactCleanup?: HlsArtifactCleanupResult;
    readonly artifactCleanupAttempts: HlsArtifactCleanupAttempt[];
    artifactCleanupFailure?: unknown;
    /** artifact 削除を1回試みる操作。`hlsArtifactOwners` による所有権チェック込みで直列化されている。 */
    readonly artifactCleanupOperation: () => Promise<HlsArtifactCleanupResult>;
    /** 診断ログ（`logHlsStopFinalization`）を既に出したかどうか。二重ログを防ぐ。 */
    diagnosticLogged: boolean;
    /** `finalizeStop()` によって強制終了扱いにされたかどうか。 */
    forceReleased: boolean;
    /** 保持している artifact の所有権（`hlsArtifactOwners` の該当エントリ）を手放す。 */
    readonly releaseArtifactOwnership: () => void;
    streamId: apid.StreamId;
    /** HLS writer プロセスの起動が進行中かどうか。進行中は force-release 診断ログを抑制する。 */
    writerStartPending?: boolean;
    writerStopFailure?: unknown;
    writerStopResult?: HlsWriterStopResult;
}

/**
 * `IStreamBaseModel` の共通実装。放送波・録画済みファイルいずれの配信でも共通する
 * 「HLS artifact の所有権管理・後始末診断」「readiness 監視タイマー」「stream 終了通知」を
 * ここに集約し、`LiveStreamBaseModel`/`RecordedStreamBaseModel` は入力の取得方法
 * （放送波受信かファイル読み出しか）だけを実装する。
 */
@injectable()
abstract class StreamBaseModel<T> implements IStreamBaseModel<T> {
    /**
     * `streamFilePath`+`streamId` をキーに、その artifact 群を現在誰が所有しているかを
     * 記録するプロセス全体のレジストリ。同じ streamId が短時間で再利用された場合に、
     * 古い世代の後始末が新しい世代の artifact を誤って削除しないようにするための排他。
     */
    private static readonly hlsArtifactOwners = new Map<string, HlsArtifactOwner>();

    protected config: IConfigFile;
    protected log: ILogger;
    protected processManager: IEncodeProcessManageModel;
    protected fileDeleter: IHLSFileDeleterModel;
    /** `setOption` で渡された stream 生成 option。start() 前は null。 */
    protected processOption: T | null = null;
    /** `setOption` で渡された配信 mode。start() 前は null。 */
    protected configMode: number | null = null;

    private socketIO: ISocketIOManageModel;
    /** stream 終了イベント（`EXIT_EVENT`）の発行・購読に使う内部 emitter。 */
    private emitter: events.EventEmitter = new events.EventEmitter();
    /** HLS の readiness チェック（`startCheckStreamEnable`）が完了したかどうか。`isEnable()` が返す値。 */
    private isEnableStream: boolean = false;
    /**
     * 現在有効な readiness チェックの世代を表すトークン。`startCheckStreamEnable` の
     * 呼び出しごとに新しいオブジェクトを発行し、非同期のファイル走査が完了した時点で
     * 世代が一致するかを確認することで、古い呼び出しの結果を無視する。
     */
    private readinessGeneration: object | null = null;
    /** HLS readiness を定期チェックする `setInterval` のハンドル。チェック未実施/完了時は null。 */
    private streamCheckTimer: NodeJS.Timeout | null = null;
    /** `keep()`/`setStopTimer()` が張る自動停止タイマーのハンドル。 */
    private streamStopTimer: NodeJS.Timeout | null = null;
    /** 現在進行中の HLS 配信の artifact 後始末状態。非HLSでは常に null。 */
    private hlsStopFinalization: HlsStopFinalization | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
    ) {
        this.config = configure.getConfig();
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.fileDeleter = fileDeleter;
        this.socketIO = socketIO;
    }

    /**
     * stream 生成に必要な情報を渡す
     * @param option: LiveStreamOption
     */
    public setOption(option: T, mode: number): void {
        this.processOption = option;
        this.configMode = mode;
    }

    public abstract start(streamId: apid.StreamId): Promise<void>;

    /**
     * HLS Stream に使用するディレクトリの使用準備をする
     * @return Promise<HlsStopFinalization>
     */
    protected async prepStreamDir(streamId: apid.StreamId): Promise<HlsStopFinalization> {
        const option: HLSFileDeleterOption = {
            streamId,
            streamFilePath: this.config.streamFilePath,
        };
        const artifactOwnerKey = JSON.stringify([option.streamFilePath, option.streamId]);
        const artifactOwner: HlsArtifactOwner = Symbol(artifactOwnerKey);
        // The registry entry, rather than mutable model state, identifies the
        // current artifact generation. Replaced and released generations retain
        // only a token that no longer matches the registry entry.
        //
        StreamBaseModel.hlsArtifactOwners.set(artifactOwnerKey, artifactOwner);
        const finalization: HlsStopFinalization = {
            artifactCleanupAttempts: [],
            artifactCleanupOperation: () =>
                this.runHlsArtifactCleanupTurn(artifactOwnerKey, artifactOwner, () =>
                    this.fileDeleter.deleteAllFiles(option),
                ),
            diagnosticLogged: false,
            forceReleased: false,
            releaseArtifactOwnership: () => {
                if (StreamBaseModel.hlsArtifactOwners.get(artifactOwnerKey) === artifactOwner) {
                    StreamBaseModel.hlsArtifactOwners.delete(artifactOwnerKey);
                }
            },
            streamId,
        };
        this.hlsStopFinalization = finalization;
        try {
            await this.checkStreamDir();

            // ゴミファイルを削除
            this.fileDeleter.setOption(option);
            await finalization.artifactCleanupOperation();
            return finalization;
        } catch (error: unknown) {
            finalization.releaseArtifactOwnership();
            throw error;
        }
    }

    /**
     * 現在進行中の HLS 配信の後始末状態を返す。非HLS配信、または `prepStreamDir` 未実施の
     * 場合は null。
     */
    protected getHlsStopFinalization(): HlsStopFinalization | null {
        return this.hlsStopFinalization;
    }

    /**
     * HLS writer プロセスの起動を開始する直前に呼ぶ。起動が完了するまでの間、
     * force-release による診断ログ出力を抑制するためのフラグを立てるだけ。
     */
    protected beginHlsWriterStart(finalization: HlsStopFinalization): void {
        finalization.writerStartPending = true;
    }

    /**
     * HLS writer プロセスの起動が完了した（成功・失敗いずれも含む）ことを通知する。
     * 起動待ちの間に artifact 削除が試みられていた場合は、ここで初めて所有権を手放す。
     */
    protected completeHlsWriterStart(finalization: HlsStopFinalization): void {
        finalization.writerStartPending = false;
        if (finalization.artifactCleanupAttempts.length > 0) {
            finalization.releaseArtifactOwnership();
        }
        this.logHlsStopFinalization(finalization);
    }

    /**
     * HLS writer プロセスの停止操作を実行し、結果（成功結果 or 失敗）を `finalization` へ
     * 記録する。停止操作自体の例外は呼び出し元へ伝播させず、診断ログの材料にする。
     */
    protected async stopHlsWriter(
        finalization: HlsStopFinalization,
        operation: () => Promise<HlsWriterStopResult>,
    ): Promise<void> {
        try {
            finalization.writerStopResult = await operation();
        } catch (error: unknown) {
            finalization.writerStopFailure = error;
        }
        this.logHlsStopFinalization(finalization);
    }

    /**
     * artifact 削除を1回試み、結果を `finalization.artifactCleanupAttempts` へ記録する。
     * writer 起動待ちが既に終わっていれば、この時点で artifact の所有権を手放す
     * （起動待ち中は、後から起動する writer が同じ artifact を書くため保持したままにする）。
     */
    protected async cleanupHlsArtifacts(finalization: HlsStopFinalization): Promise<void> {
        try {
            const result = await finalization.artifactCleanupOperation();
            this.recordHlsArtifactCleanupAttempt(finalization, result, undefined);
        } catch (error: unknown) {
            this.recordHlsArtifactCleanupAttempt(finalization, undefined, error);
        }
        if (finalization.writerStartPending !== true) {
            finalization.releaseArtifactOwnership();
        }
        this.logHlsStopFinalization(finalization);
    }

    /**
     * 停止が readiness 確定より後に来た（stream が一度も有効化されないまま停止要求が
     * 追い越した）場合の後始末。writer 停止と artifact 削除を両方行ってから、
     * `completeHlsWriterStart` と同じ後処理（起動待ちフラグ解除・所有権解放）を行う。
     */
    protected async stopLateHlsWriterAndCleanupArtifacts(
        finalization: HlsStopFinalization,
        writerStopOperation: () => Promise<HlsWriterStopResult>,
    ): Promise<void> {
        let writerStopResult: HlsWriterStopResult | undefined;
        let writerStopFailure: unknown;
        let artifactCleanup: HlsArtifactCleanupResult | undefined;
        let artifactCleanupFailure: unknown;
        try {
            writerStopResult = await writerStopOperation();
        } catch (error: unknown) {
            writerStopFailure = error;
        }
        try {
            artifactCleanup = await finalization.artifactCleanupOperation();
        } catch (error: unknown) {
            artifactCleanupFailure = error;
        }
        finalization.writerStopResult = writerStopResult;
        finalization.writerStopFailure = writerStopFailure;
        this.recordHlsArtifactCleanupAttempt(finalization, artifactCleanup, artifactCleanupFailure);
        this.completeHlsWriterStart(finalization);
    }

    /**
     * artifact 削除の1回の試行結果を記録する。`artifactCleanup`/`artifactCleanupFailure`は
     * 最初の試行結果のみ保持する（`??=`相当）。2回目以降の試行は
     * `artifactCleanupAttempts` の追加としてのみ残る。
     */
    private recordHlsArtifactCleanupAttempt(
        finalization: HlsStopFinalization,
        result: HlsArtifactCleanupResult | undefined,
        failure: unknown,
    ): void {
        finalization.artifactCleanupAttempts.push({ failure, result });
        if (finalization.artifactCleanup === undefined) {
            finalization.artifactCleanup = result;
        }
        if (finalization.artifactCleanupFailure === undefined) {
            finalization.artifactCleanupFailure = failure;
        }
    }

    /**
     * IStreamBaseModel#finalizeStop() の実装。
     * HLS 以外の種別では hlsStopFinalization が常に null のため no-op になる（1.5節参照）。
     */
    public finalizeStop(): void {
        if (this.hlsStopFinalization === null) {
            return;
        }

        this.hlsStopFinalization.forceReleased = true;
        this.logHlsStopFinalization(this.hlsStopFinalization);
    }

    /**
     * force-release 経由で終了した HLS 配信について、後始末に問題があった場合に限り
     * 一度だけ診断ログを出す。`forceReleased`でない、既にログ済み、writer 起動待ち中、
     * または `shouldLogHlsStopFinalization` が「問題なし」と判定した場合は何もしない。
     */
    private logHlsStopFinalization(finalization: HlsStopFinalization): void {
        if (
            finalization.forceReleased === false ||
            finalization.diagnosticLogged ||
            finalization.writerStartPending ||
            this.shouldLogHlsStopFinalization(finalization) === false
        ) {
            return;
        }

        finalization.diagnosticLogged = true;
        this.logHlsError({
            artifactCleanup: finalization.artifactCleanup,
            ...(finalization.artifactCleanupAttempts.length > 1
                ? { artifactCleanupAttempts: finalization.artifactCleanupAttempts }
                : {}),
            artifactCleanupFailure: finalization.artifactCleanupFailure,
            event: 'hls-stop-finalization',
            forceReleased: true,
            streamId: finalization.streamId,
            streamType: this.getStreamType(),
            writerStopFailure: finalization.writerStopFailure,
            writerStopResult: finalization.writerStopResult,
        });
    }

    /**
     * writer の停止に失敗した、正常終了を確認できなかった、または artifact 削除が
     * 一度も `cleared` に至らなかった場合に true を返す（＝診断ログを出す価値がある）。
     */
    private shouldLogHlsStopFinalization(finalization: HlsStopFinalization): boolean {
        return (
            finalization.writerStopFailure !== undefined ||
            finalization.writerStopResult?.exitConfirmed === false ||
            finalization.artifactCleanupAttempts.some(attempt => attempt.result?.status !== 'cleared')
        );
    }

    private logHlsError(value: unknown): void {
        try {
            this.log.stream.error(value);
        } catch {
            // HLS finalization diagnostics must not interrupt resource cleanup.
        }
    }

    /**
     * HLS Stream に使用するディレクトリのチェックをする
     * ディレクトリが存在しなければ生成する
     * @return Promise<void>
     */
    private async checkStreamDir(): Promise<void> {
        // streamFilePath の存在チェック
        try {
            await FileUtil.access(this.config.streamFilePath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err: any) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.stream.info(`mkdirp: ${this.config.streamFilePath}`);
                await FileUtil.mkdir(this.config.streamFilePath);
            } else {
                // アクセス権に Read or Write が無い
                this.log.stream.fatal(`dir permission error: ${this.config.streamFilePath}`);
                this.log.stream.fatal(err);
                throw err;
            }
        }
    }

    /**
     * ストリームを停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        this.readinessGeneration = null;
        if (this.streamCheckTimer !== null) {
            clearInterval(this.streamCheckTimer);
            this.streamCheckTimer = null;
        }

        if (this.streamStopTimer !== null) {
            clearTimeout(this.streamStopTimer);
        }

        this.emitExitStream();
        this.emitter.removeAllListeners(StreamBaseModel.EXIT_EVENT);
    }

    public abstract getStream(): internal.Readable;
    public abstract getInfo(): LiveStreamInfo | RecordedStreamInfo;
    protected abstract getStreamType(): apid.StreamType;

    /**
     * IStreamBaseModel#ownsDiskArtifacts() の実装。
     * 具象クラスの getStreamType() が返す種別名から一意に決まるため、
     * 派生クラス側で個別に override する必要はない。
     */
    public ownsDiskArtifacts(): boolean {
        return this.getStreamType().includes('HLS');
    }

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.once(StreamBaseModel.EXIT_EVENT, async () => {
            try {
                callback();
            } catch (err: any) {
                this.log.stream.error('exit stream callback error');
                this.log.stream.error(err);
            }
        });
    }

    /**
     * ストリーム終了イベント発行
     */
    protected emitExitStream(): void {
        this.emitter.emit(StreamBaseModel.EXIT_EVENT);
    }

    /**
     * HLS stream が有効になったかチェックする
     * @param streamId: apid.StreamId
     */
    protected startCheckStreamEnable(streamId: apid.StreamId): void {
        if (this.streamCheckTimer !== null && this.getStreamType().includes('HLS') === false) {
            return;
        }

        const generation = {};
        this.readinessGeneration = generation;
        this.log.stream.info(`start check stream file: ${streamId}`);
        this.streamCheckTimer = setInterval(async () => {
            let fileList: string[];
            try {
                fileList = await this.listExactHlsArtifacts(streamId);
            } catch (err: any) {
                if (this.isCurrentReadinessGeneration(generation) === false) {
                    return;
                }
                this.log.stream.error(`get stream files list error: ${streamId} ${this.config.streamFilePath}`);
                if (this.streamCheckTimer !== null) {
                    clearInterval(this.streamCheckTimer);
                    this.streamCheckTimer = null;
                }
                this.readinessGeneration = null;

                return;
            }
            if (this.isCurrentReadinessGeneration(generation) === false) {
                return;
            }
            const parentPlayListName = `stream${streamId}.m3u8`;
            const subtitlePlayListName = `stream${streamId}-child_vtt.m3u8`;

            let hasParentPlayList = false;
            let hasSubtitlePlayList = false;
            let fileCnt = 0;
            for (const f of fileList) {
                if (f.endsWith('.m3u8')) {
                    hasParentPlayList ||= f === parentPlayListName;
                    hasSubtitlePlayList ||= f === subtitlePlayListName;
                } else if (f.endsWith('.vtt') === false) {
                    fileCnt += 1;
                }
            }

            if (hasParentPlayList === true && fileCnt >= 2) {
                if (hasSubtitlePlayList) {
                    // parentPlayList に字幕用のプレイリスト情報を追加する
                    await this.addSubtitleInfoToParentPlaylist(
                        parentPlayListName,
                        subtitlePlayListName,
                        generation,
                    ).catch(err => {
                        this.log.stream.error('failed to add subtitle info');
                        this.log.stream.error(err);
                    });
                }
                if (this.isCurrentReadinessGeneration(generation) === false) {
                    return;
                }

                if (this.streamCheckTimer !== null) {
                    clearInterval(this.streamCheckTimer);
                    this.streamCheckTimer = null;
                }
                this.readinessGeneration = null;
                this.isEnableStream = true;
                this.log.stream.info(`enable stream: ${streamId}`);
                this.socketIO.notifyClient();
            }
        }, 100);
    }

    private isCurrentReadinessGeneration(generation: object): boolean {
        return this.readinessGeneration === generation;
    }

    /**
     * 指定 streamId ちょうどの artifact ファイル名一覧を返す。DI で注入される
     * `fileDeleter` の実体（`HLSFileDeleterModel`）は `IHLSFileDeleterModel` の宣言に
     * 無い `listExact` も公開しているため、それを使えれば流用し（HLS artifact ID の
     * 判定ロジックを二重に持たないため）、無ければ自前でディレクトリを読んで判定する。
     */
    private async listExactHlsArtifacts(streamId: number): Promise<string[]> {
        const artifactIndex = this.fileDeleter as IHLSFileDeleterModel & {
            listExact?(streamFilePath: string, exactStreamId: number): Promise<string[]>;
        };
        if (artifactIndex.listExact !== undefined) {
            return artifactIndex.listExact(this.config.streamFilePath, streamId);
        }

        const prefix = `stream${streamId}`;
        return (await FileUtil.readDir(this.config.streamFilePath)).filter(
            file => file === `${prefix}.m3u8` || (file.startsWith(`${prefix}-`) && /\.(?:m3u8|ts|vtt)$/.test(file)),
        );
    }

    /**
     * parentPlayList に字幕用のプレイリスト情報を追加する
     * @param parentPlayListName: string 親プレイリスト名
     * @param subtitlePlayListName: string 字幕プレイリスト名
     */
    private async addSubtitleInfoToParentPlaylist(
        parentPlayListName: string,
        subtitlePlayListName: string,
        readinessGeneration: object,
    ): Promise<void> {
        const parentPlayListPath = path.join(this.config.streamFilePath, parentPlayListName);
        const file = await FileUtil.readFile(parentPlayListPath);
        if (this.isCurrentReadinessGeneration(readinessGeneration) === false) {
            return;
        }
        const lines = file.split(/\n/);

        // 字幕プレイリスト情報挿入
        const subtitleInfo = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitle",NAME="Japanese",DEFAULT=YES,LANGUAGE="jp",URI="${subtitlePlayListName}"`;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('#EXT-X-STREAM-INF') === true) {
                lines[i] += ',SUBTITLES="subtitle"';
                lines.splice(i, 0, subtitleInfo);
                break;
            }
        }

        // 親プレイリストへ書き込み
        await FileUtil.writeFile(parentPlayListPath, lines.join('\n'));
    }

    /**
     * `artifactOwnerKey` ごとに、直列化された artifact 削除操作の待ち行列を表す
     * 「直前の削除試行」の Promise。同じディレクトリへの削除が並行実行されて
     * 競合しないよう、`runHlsArtifactCleanupTurn` が前の turn の完了を待ってから実行する。
     */
    private static readonly hlsArtifactCleanupTurns = new Map<string, Promise<void>>();

    /**
     * `artifactOwnerKey` ごとに削除操作を直列化して実行する。前の turn の完了を待ってから
     * 実行し、待っている間に別の世代（`artifactOwner`）へ所有権が移っていたら、
     * 自分の世代はもう有効ではないため実際の削除は行わず空の結果を返す。
     */
    private async runHlsArtifactCleanupTurn(
        artifactOwnerKey: string,
        artifactOwner: HlsArtifactOwner,
        cleanupOperation: () => Promise<HlsArtifactCleanupResult>,
    ): Promise<HlsArtifactCleanupResult> {
        const previousTurn = StreamBaseModel.hlsArtifactCleanupTurns.get(artifactOwnerKey);
        let releaseTurn!: () => void;
        const currentTurn = new Promise<void>(resolve => {
            releaseTurn = resolve;
        });
        StreamBaseModel.hlsArtifactCleanupTurns.set(artifactOwnerKey, currentTurn);
        await previousTurn;

        try {
            if (StreamBaseModel.hlsArtifactOwners.get(artifactOwnerKey) !== artifactOwner) {
                return { passes: 0, remainingFiles: [], status: 'cleared' };
            }
            return await cleanupOperation();
        } finally {
            releaseTurn();
            if (StreamBaseModel.hlsArtifactCleanupTurns.get(artifactOwnerKey) === currentTurn) {
                StreamBaseModel.hlsArtifactCleanupTurns.delete(artifactOwnerKey);
            }
        }
    }

    /**
     * ストリームが有効か
     */
    protected isEnable(): boolean {
        return this.isEnableStream;
    }

    /**
     * 一定時間内に stream 保持要求が来なかったら停止するようにタイマーをセットする
     */
    protected setStopTimer(): void {
        if (this.streamStopTimer !== null) {
            clearTimeout(this.streamStopTimer);
        }

        this.streamStopTimer = setTimeout(async () => {
            await this.stop().catch(err => {
                this.log.stream.error('stop stream error');
                this.log.stream.error(err);
            });
        }, 15 * 1000);
    }

    /**
     * stream 保持要求
     */
    public keep(): void {
        this.setStopTimer();
    }
}

namespace StreamBaseModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default StreamBaseModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_STREAM_BASE_STARTCHECK_NONHLS_GUARD_20260924: unique symbol;
