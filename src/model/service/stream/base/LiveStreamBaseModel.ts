import { ChildProcess } from 'child_process';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import internal from 'stream';
// CommonJS package のため、既定の書き出しは名前空間の default に入る。
import aribSubtitleTimedmetadater from 'arib-subtitle-timedmetadater';

const ID3MetadataTransform = aribSubtitleTimedmetadater.default;
type ID3MetadataTransform = InstanceType<typeof ID3MetadataTransform>;
import type * as apid from '../../../../../api.js';
import ProcessUtil from '../../../../util/ProcessUtil.js';
import IConfigFile from '../../../IConfigFile.js';
import IConfiguration from '../../../IConfiguration.js';
import ILoggerModel from '../../../ILoggerModel.js';
import { TunerServerAccess, TunerStreamHandle } from '../../../tuner/types.js';
import IEncodeProcessManageModel, {
    CreateProcessOption,
    HlsWriterHandle,
    ManagedProcessHandle,
} from '../../encode/IEncodeProcessManageModel.js';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel.js';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel.js';
import ILiveStreamBaseModel, { LiveStreamOption } from './ILiveStreamBaseModel.js';
import { LiveStreamInfo } from './IStreamBaseModel.js';
import StreamBaseModel, { HlsStopFinalization } from './StreamBaseModel.js';

/**
 * `start()` の1回の呼び出し（1つの世代）が保持する資源と進行状況。`token`で世代を識別し、
 * 途中で新しい `start()`/`stop()` が来て自分の世代が無効になったかどうかを
 * `canSessionAdopt` で確認しながら、放送波受信・プロセス起動を進める。
 */
interface LiveStartSession {
    readonly token: object;
    /** この session の後始末（`disposeSession`）の Promise。一度だけ実行されるようキャッシュする。 */
    finalizer: Promise<void> | null;
    hlsStopFinalization: HlsStopFinalization | null;
    hlsWriterHandle: HlsWriterHandle | null;
    id3MetadataTransform: ID3MetadataTransform | null;
    managedProcessHandle: ManagedProcessHandle | null;
    /** この session が登録した listener の一覧。後始末時にまとめて解除するために保持する。 */
    ownedListeners: OwnedListener[];
    /** `stopSession`で立てられる、この session が停止要求を受けたかどうか。 */
    stopped: boolean;
    stream: http.IncomingMessage | null;
    streamProcess: ChildProcess | null;
    tunerStreamHandle: TunerStreamHandle | null;
}

/** `addSessionListener`が登録した listener を、後で確実に解除するために保持する情報。 */
interface OwnedListener {
    readonly emitter: NodeJS.EventEmitter;
    readonly event: string | symbol;
    readonly listener: (...args: unknown[]) => void;
}

/**
 * ライブ配信（放送波受信）の `StreamBaseModel` 実装。mirakurun からの stream 取得と、
 * 必要であればエンコードプロセスへのパイプ接続を行う。`start()` は呼び出しごとに
 * `LiveStartSession` を1つ生成し、その中で完結する形で資源を積み上げていくことで、
 * 途中で新しい `start()`/`stop()` が割り込んでも古い世代の資源だけを後始末できるようにする。
 */
@injectable()
export default abstract class LiveStreamBaseModel
    extends StreamBaseModel<LiveStreamOption>
    implements ILiveStreamBaseModel
{
    /** 現在の session が保持する放送波の受信 stream。`disposeSession`でクリアされる。 */
    private stream: http.IncomingMessage | null = null;
    /** 現在の session が保持するエンコードプロセスの `ChildProcess`。 */
    private streamProcess: ChildProcess | null = null;
    /** `stopSession`で停止済みと記録された session の `token` の集合。古い世代の非同期処理が資源を採用しないようにするための判定に使う。 */
    private stoppedProcessStartGenerations: WeakSet<object> = new WeakSet();
    /** 現在進行中（または直近に開始した）session。`start()`が呼ばれるたびに差し替わる。 */
    private activeStartSession: LiveStartSession | null = null;
    /** 進行中の`start()`呼び出しの Promise。null でない間は多重 `start()` を拒否する。 */
    private startOperation: Promise<void> | null = null;
    private tunerServerAccess: TunerServerAccess;
    /** 現在の session が保持するチューナーへの接続ハンドル。close 済み判定・クローズ処理に使う。 */
    private tunerStreamHandle: TunerStreamHandle | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.tunerServerAccess = tunerServerAccess;
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @param streamId: apid.StreamId
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    protected createProcessOption(streamId: apid.StreamId): CreateProcessOption | null {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        /**
         * mirakurun の stream をそのまま横流しする
         */
        if (typeof this.processOption.cmd === 'undefined') {
            return null;
        }

        let cmd = this.processOption.cmd.replace(/%FFMPEG%/g, this.config.ffmpeg);
        if (this.getStreamType() === 'LiveHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, streamId.toString(10));
        }

        return {
            input: null,
            output: this.getStreamType() === 'LiveHLS' ? `${this.config.streamFilePath}\/stream${streamId}.m3u8` : null,
            cmd: cmd,
            priority: LiveStreamBaseModel.ENCODE_PROCESS_PRIORITY,
        };
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public start(streamId: apid.StreamId): Promise<void> {
        if (this.startOperation !== null) {
            return Promise.reject(new Error('StreamStartInProgress'));
        }

        const operation = this.startSession(streamId);
        this.startOperation = operation;
        const clearOperation = () => {
            this.startOperation = null;
        };
        void operation.then(clearOperation, clearOperation);
        return operation;
    }

    /**
     * 実際の開始処理本体。新しい `LiveStartSession` を1つ生成し、その中で
     * HLSディレクトリ準備・放送波受信・エンコードプロセス起動を順に進める。
     * 途中の各段階で `assertSessionCanAdopt` により、この session がまだ
     * `activeStartSession` のまま有効かを確認し、無効化されていれば例外で打ち切る。
     * 失敗時は必ず `stopSession`+`finalizeSession` で後始末してから例外を再送出する。
     */
    private async startSession(streamId: apid.StreamId): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const session = this.createStartSession();
        try {
            // HLS stream ディレクトリ使用準備
            if (this.getStreamType() === 'LiveHLS') {
                session.hlsStopFinalization = await this.prepStreamDir(streamId);
                this.assertSessionCanAdopt(session);
            }

            // 放送波受信
            await this.setMirakurunStream(this.config, session);
            if (session.stream === null) {
                throw new Error('SetStreamError');
            }

            // エンコードプロセスの生成が必要かチェック
            const poption = this.createProcessOption(streamId);
            if (poption !== null) {
                await this.startStreamProcess(session, poption, streamId);
            } else {
                const emitExit = () => this.emitExitForSession(session);
                this.addSessionListener(session, session.stream, 'close', emitExit);
                this.addSessionListener(session, session.stream, 'end', emitExit);
                this.addSessionListener(session, session.stream, 'error', emitExit);
            }

            this.assertSessionCanAdopt(session);
            if (this.getStreamType() === 'LiveHLS') {
                // stream 停止タイマーセット
                this.setStopTimer();
            }
        } catch (err: unknown) {
            this.stopSession(session);
            await this.finalizeSession(session);
            throw err;
        }
    }

    /**
     * 新しい世代の `LiveStartSession` を生成し、`activeStartSession` へ差し替える。
     * 併せて公開フィールド（`stream`/`streamProcess`/`tunerStreamHandle`）もリセットする。
     */
    private createStartSession(): LiveStartSession {
        const session: LiveStartSession = {
            finalizer: null,
            hlsStopFinalization: null,
            hlsWriterHandle: null,
            id3MetadataTransform: null,
            managedProcessHandle: null,
            ownedListeners: [],
            stopped: false,
            stream: null,
            streamProcess: null,
            token: {},
            tunerStreamHandle: null,
        };
        this.activeStartSession = session;
        this.stream = null;
        this.streamProcess = null;
        this.tunerStreamHandle = null;
        return session;
    }

    /**
     * エンコードプロセス（HLS の場合は writer、それ以外は managed process）を起動し、
     * 受信 stream をプロセスの標準入力へパイプする。起動待ちの間に session が
     * 無効化されていれば、起動したプロセスをすぐに停止して打ち切る。
     */
    private async startStreamProcess(
        session: LiveStartSession,
        poption: CreateProcessOption,
        streamId: apid.StreamId,
    ): Promise<void> {
        this.log.stream.info(`create encode process: ${poption.cmd}`);
        try {
            if (this.getStreamType() === 'LiveHLS') {
                const finalization = session.hlsStopFinalization!;
                this.beginHlsWriterStart(finalization);
                const result = await this.processManager.createHlsWriter(poption);
                if (this.canSessionAdopt(session) === false) {
                    await this.stopLateHlsWriterAndCleanupArtifacts(finalization, () =>
                        this.processManager.stopHls(result.handle),
                    );
                    this.assertSessionCanAdopt(session);
                }
                this.completeHlsWriterStart(finalization);
                session.streamProcess = result.child;
                session.hlsWriterHandle = result.handle;
                this.streamProcess = result.child;
            } else {
                const result = await this.processManager.createManaged(poption);
                if (this.canSessionAdopt(session) === false) {
                    await this.tryCleanup(() => this.processManager.requestStop(result.handle));
                    throw new Error('StreamStartStopped');
                }
                session.streamProcess = result.child;
                session.managedProcessHandle = result.handle;
                this.streamProcess = result.child;
            }
        } catch (err: unknown) {
            if (session.hlsStopFinalization !== null) {
                this.completeHlsWriterStart(session.hlsStopFinalization);
            }
            if (this.canSessionAdopt(session)) {
                this.log.stream.error(`create encode process failed: ${poption.cmd}`);
            }
            throw err;
        }

        const streamProcess = session.streamProcess;
        if (streamProcess === null || session.stream === null) {
            throw new Error('CreateStreamProcessError');
        }

        const emitExit = () => this.emitExitForSession(session);
        this.addSessionListener(session, streamProcess, 'exit', emitExit);
        this.addSessionListener(session, streamProcess, 'error', emitExit);
        this.addSessionListener(session, streamProcess, 'exit', (...args: unknown[]) => {
            this.logStreamProcessExit(session, args[0] as number | null, args[1] as NodeJS.Signals | null);
        });

        if (streamProcess.stderr !== null) {
            this.addSessionListener(session, streamProcess.stderr, 'data', data => {
                this.log.stream.debug(String(data));
            });
        }

        if (streamProcess.stdin === null) {
            throw new Error('StreamProcessStdinIsNull');
        }

        // encode process への書き込み中に stdin が error を発行しても uncaughtException にはせず記録するだけに
        // 留める（例: encode process が既に終了した後の書き込み）。既存の session 終了経路は変更しない。
        this.addSessionListener(session, streamProcess.stdin, 'error', (...args: unknown[]) => {
            this.log.stream.error('stream process stdin error');
            this.log.stream.error(args[0]);
        });

        // HLS 配信の場合は arib-subtitle-timedmetadater を通す
        if (this.getStreamType() === 'LiveHLS') {
            this.log.stream.info('use arib-subtitle-timedmetadater');
            const transform = new ID3MetadataTransform();
            session.id3MetadataTransform = transform;
            session.stream.pipe(transform);
            transform.pipe(streamProcess.stdin);
            // stream 有効チェク開始
            this.startCheckStreamEnable(streamId);
        } else {
            session.stream.pipe(streamProcess.stdin);
        }

        // プロセスが即時終了していた場合
        if (ProcessUtil.isExited(streamProcess) === true) {
            this.emitExitForSession(session);
        }
    }

    /**
     * この session がまだ「現行の」session として資源を採用してよい状態かを判定する。
     * `stop()`が呼ばれた後や、別の`start()`に世代が進んだ後は false になる。
     */
    private canSessionAdopt(session: LiveStartSession): boolean {
        return (
            this.activeStartSession === session &&
            session.stopped === false &&
            this.stoppedProcessStartGenerations.has(session.token) === false
        );
    }

    /** `canSessionAdopt`が false なら `StreamStartStopped` を投げる。 */
    private assertSessionCanAdopt(session: LiveStartSession): void {
        if (this.canSessionAdopt(session) === false) {
            throw new Error('StreamStartStopped');
        }
    }

    /** session を停止済みとして記録する（`canSessionAdopt`が以後 false を返すようにする）。 */
    private stopSession(session: LiveStartSession): void {
        session.stopped = true;
        this.stoppedProcessStartGenerations.add(session.token);
    }

    /** session がまだ有効な場合のみ stream 終了イベントを発行する（無効化後の遅延イベントを無視する）。 */
    private emitExitForSession(session: LiveStartSession): void {
        if (this.canSessionAdopt(session)) {
            this.emitExitStream();
        }
    }

    /**
     * encode process の終了を code/signal 付きで記録する。session がまだ`canSessionAdopt`な状態のまま終了
     * した場合は、`stop()`を経由しない予期しない終了としてwarnで記録する。session側が既に停止済み
     * （`stop()`経由の終了、または世代交代で無効化された後に遅れて終了した場合）はinfoで記録する。
     */
    private logStreamProcessExit(session: LiveStartSession, code: number | null, signal: NodeJS.Signals | null): void {
        const message = `encode process exited: code=${String(code)}, signal=${String(signal)}`;
        if (this.canSessionAdopt(session)) {
            this.log.stream.warn(message);
        } else {
            this.log.stream.info(message);
        }
    }

    private addSessionListener(
        session: LiveStartSession,
        emitter: NodeJS.EventEmitter,
        event: string | symbol,
        listener: (...args: unknown[]) => void,
        once: boolean = false,
    ): void {
        if (once) {
            emitter.once(event, listener);
        } else {
            emitter.on(event, listener);
        }
        session.ownedListeners.push({ emitter, event, listener });
    }

    /**
     * 放送波受信
     * @param config: IConfigFile
     * @return Promise<void>
     */
    private async setMirakurunStream(config: IConfigFile, session: LiveStartSession): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        this.log.stream.info(`get mirakurun service stream: ${this.processOption.channelId}`);
        const handle = await this.tunerServerAccess
            .openServiceStream({ serviceId: this.processOption.channelId, priority: config.streamingPriority })
            .catch(err => {
                if (this.processOption !== null) {
                    this.log.stream.error(`get mirakurun service stream failed: ${this.processOption.channelId}`);
                }
                throw err;
            });
        if (this.canSessionAdopt(session) === false) {
            await this.tryCleanup(() => handle.close());
            throw new Error('StreamStartStopped');
        }
        session.tunerStreamHandle = handle;
        session.stream = handle.stream as http.IncomingMessage;
        this.tunerStreamHandle = handle;
        this.stream = handle.stream as http.IncomingMessage;
        const closeTunerStream = () => this.closeTunerStream(handle, session);
        this.addSessionListener(session, this.stream, 'close', closeTunerStream, true);
        this.addSessionListener(session, this.stream, 'end', closeTunerStream, true);
        this.addSessionListener(session, this.stream, 'error', closeTunerStream, true);
        if (this.isTunerStreamTerminal(this.stream)) {
            this.emitExitForSession(session);
            throw new Error('TunerStreamIsTerminal');
        }
    }

    private isTunerStreamTerminal(stream: http.IncomingMessage): boolean {
        return stream.destroyed === true || stream.readableEnded === true;
    }

    private closeTunerStream(handle: TunerStreamHandle, session: LiveStartSession): void {
        if (session.tunerStreamHandle !== handle) return;
        session.tunerStreamHandle = null;
        if (this.tunerStreamHandle === handle) this.tunerStreamHandle = null;
        try {
            handle.close();
        } catch (err: unknown) {
            this.logCleanupError('stop tuner stream error');
            this.logCleanupError(err);
        }
    }

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        const session = this.activeStartSession;
        if (session !== null) this.stopSession(session);
        await super.stop();

        if (session !== null) {
            await this.finalizeSession(session);
        }
    }

    /** `disposeSession`を一度だけ実行し、以後の呼び出しには同じ Promise を返す。 */
    private finalizeSession(session: LiveStartSession): Promise<void> {
        if (session.finalizer === null) {
            session.finalizer = this.disposeSession(session);
        }
        return session.finalizer;
    }

    /**
     * session が保持する資源（listener・stream・変換 stream・プロセスハンドル・
     * チューナー接続・HLS artifact）を、対応する内容がある分だけ順に解放する。
     * 個々の解放は `tryCleanup` で失敗を握りつぶし、他の資源の解放を継続する。
     */
    private async disposeSession(session: LiveStartSession): Promise<void> {
        this.releaseSessionListeners(session);

        const stream = session.stream;
        const transform = session.id3MetadataTransform;
        const streamProcessHandle = session.managedProcessHandle;
        const hlsWriterHandle = session.hlsWriterHandle;
        const hlsStopFinalization =
            session.hlsStopFinalization ?? (this.getStreamType() === 'LiveHLS' ? this.getHlsStopFinalization() : null);
        const tunerStreamHandle = session.tunerStreamHandle;

        session.stream = null;
        session.streamProcess = null;
        session.id3MetadataTransform = null;
        session.managedProcessHandle = null;
        session.hlsWriterHandle = null;
        session.tunerStreamHandle = null;
        if (this.activeStartSession === session) {
            this.stream = null;
            this.streamProcess = null;
            this.tunerStreamHandle = null;
        }

        if (stream !== null) {
            await this.tryCleanup(() => stream.unpipe());
        }

        if (transform !== null) {
            await this.tryCleanup(() => transform.unpipe());
            await this.tryCleanup(() => transform.destroy());
        }

        if (streamProcessHandle !== null) {
            await this.tryCleanup(() => this.processManager.requestStop(streamProcessHandle));
        }

        if (tunerStreamHandle !== null) {
            await this.tryCleanup(() => tunerStreamHandle.close());
        } else if (stream !== null) {
            await this.tryCleanup(() => stream.destroy());
        }

        if (hlsWriterHandle !== null) {
            if (hlsStopFinalization === null) {
                await this.tryCleanup(() => this.processManager.stopHls(hlsWriterHandle));
            } else {
                await this.stopHlsWriter(hlsStopFinalization, () => this.processManager.stopHls(hlsWriterHandle));
            }
        }

        if (this.getStreamType() === 'LiveHLS') {
            if (hlsStopFinalization === null) {
                await this.tryCleanup(() => this.fileDeleter.deleteAllFiles());
            } else {
                await this.cleanupHlsArtifacts(hlsStopFinalization);
            }
        }
    }

    private releaseSessionListeners(session: LiveStartSession): void {
        const listeners = session.ownedListeners;
        session.ownedListeners = [];
        for (const { emitter, event, listener } of listeners) {
            try {
                emitter.off(event, listener);
            } catch (err: unknown) {
                this.logCleanupError('stop stream listener error');
                this.logCleanupError(err);
            }
        }
    }

    private async tryCleanup(operation: () => Promise<unknown> | unknown): Promise<void> {
        try {
            await operation();
        } catch (err: unknown) {
            this.logCleanupError('stop stream resource error');
            this.logCleanupError(err);
        }
    }

    private logCleanupError(message: unknown, ...args: unknown[]): void {
        try {
            this.log.stream.error(message, ...args);
        } catch (_err: unknown) {
            // Cleanup diagnostics must not interrupt remaining resource cleanup.
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else if (this.stream !== null) {
            return this.stream;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return LiveStreamInfo
     */
    public getInfo(): LiveStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.configMode === null) {
            throw new Error('ConfigModeIsNull');
        }

        return {
            type: this.getStreamType(),
            mode: this.configMode,
            channelId: this.processOption.channelId,
            isEnable: this.isEnable(),
        };
    }

    protected abstract getStreamType(): 'LiveStream' | 'LiveHLS';
}
