import { inject, injectable, optional } from 'inversify';
import type * as apid from '../../../../../api.js';
import IExecutionManagementModel from '../../../IExecutionManagementModel.js';
import ILogger from '../../../ILogger.js';
import ILoggerModel from '../../../ILoggerModel.js';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel.js';
import IRecordedStreamBaseModel from '../base/IRecordedStreamBaseModel.js';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from '../base/IStreamBaseModel.js';
import RecordedDeliveryLeaseConsumer, {
    AcquiredRecordedDeliverySource,
    toLegacyRecordedDeliveryError,
} from '../recorded/RecordedDeliveryLeaseConsumer.js';
import IStreamIdAllocator from './IStreamIdAllocator.js';
import IStreamManageModel, { RecordedStreamStartOption, StreamInfoWithStreamId } from './IStreamManageModel.js';

/** `ActiveStream`の現在の進行段階。`starting`→`ready`→`stopping`と一方向に進む。 */
type StreamState = 'starting' | 'ready' | 'stopping';
/** `finalizeActive`（停止処理）が呼ばれた理由。ログ・呼び出し元への通知に使う。 */
type StopReason = 'start-failed' | 'start-timeout' | 'explicit-stop' | 'source-ended';
/** `ResourceLeaseBundle`に登録する、停止時に実行すべき後始末処理。 */
type ResourceDisposer = (reason: StopReason) => Promise<void> | void;

/**
 * `start()`/`startRecorded()`が返す Promise を外部から resolve/reject するためのハンドル。
 * `settled`は既に確定済みかどうかを表し、二重に resolve/reject しないためのガードに使う。
 */
interface StartResult {
    readonly promise: Promise<apid.StreamId>;
    readonly reject: (error: Error) => void;
    readonly resolve: (streamId: apid.StreamId) => void;
    settled: boolean;
}

/**
 * `StreamManageModel`が管理する、現在生存中（開始処理中〜停止処理中）の1配信の状態。
 * `stream`は`start()`が受け取った実体で、`startRecorded()`経由の場合は
 * `preparation`が完了して初めて設定される（それまでは null）。
 */
interface ActiveStream {
    id: apid.StreamId;
    readonly mapStartError: (error: unknown) => Error;
    /** `stream`がまだ無い間、`getStreamInfo(s)`に応答するための仮の配信情報。`attachStream`後は無視される。 */
    readonly pendingInfo: LiveStreamInfo | RecordedStreamInfo | null;
    /** `startRecorded()`のように、`stream`を割り当てる前に必要な準備処理。無ければ null。 */
    preparation: (() => Promise<void>) | null;
    /** この配信のために確保された資源（stream 停止処理等）の集合。停止時にまとめて解放する。 */
    readonly resources: ResourceLeaseBundle;
    readonly startResult: StartResult;
    stream: IStreamBaseModel<any> | null;
    /** `stopActive`が返す Promise のキャッシュ。同一配信への複数回の停止要求を1回にまとめる。 */
    finalizePromise: Promise<void> | null;
    /** 開始が `MEDIA_DELIVERY_START_TIMEOUT_MS` 以内に完了しなければ失敗させるタイマー。 */
    startTimer: NodeJS.Timeout | null;
    state: StreamState;
    /**
     * この active stream の streamId が idAllocator による採番（ディスク上の
     * 既存成果物との衝突回避）を経由したかどうか。true の場合のみ、readiness の
     * 確定を start() の解決に任せず、また終了時に idAllocator.release() を呼ぶ。
     */
    readonly usesManagedId: boolean;
}

/**
 * `acquireRecordedDelivery`（stream 本体を持たない、配信元のみの直接取得）1回分の進行状況。
 */
interface ActiveRecordedDelivery {
    /** `releaseRecordedDelivery`の結果のキャッシュ。多重解放を1回にまとめる。 */
    releasePromise: Promise<void> | null;
    startTimer: NodeJS.Timeout | null;
    state: 'starting' | 'ready' | 'stopping';
}

/**
 * 1つの配信が確保した資源の後始末処理（`ResourceDisposer`）を集め、`finalize()`で
 * まとめて実行する。`adopt()`は`finalize()`後（`finalizing`が true）の登録を
 * `'stale'`として拒否し、既に停止処理へ進んだ配信へ新たな資源が紛れ込まないようにする。
 */
class ResourceLeaseBundle {
    /** 登録済みの後始末処理。登録順に`finalize()`で実行する。 */
    private readonly disposers: ResourceDisposer[] = [];
    /** `finalize()`が呼ばれた（＝以後の`adopt()`を拒否すべき）かどうか。 */
    private finalizing = false;
    /** `finalize()`の結果のキャッシュ。複数回呼ばれても後始末は一度だけ実行する。 */
    private finalizePromise: Promise<void> | null = null;

    constructor(private readonly onError: (error: unknown) => void) {}

    /** 後始末処理を登録する。既に`finalize()`済みなら登録せず`'stale'`を返す。 */
    public adopt(disposer: ResourceDisposer): 'adopted' | 'stale' {
        if (this.finalizing) {
            return 'stale';
        }

        this.disposers.push(disposer);
        return 'adopted';
    }

    /** 以後の`adopt()`を拒否し、登録済みの後始末処理をすべて実行する。複数回呼んでも一度だけ実行する。 */
    public finalize(reason: StopReason): Promise<void> {
        if (this.finalizePromise === null) {
            this.finalizing = true;
            this.finalizePromise = Promise.resolve().then(() => this.disposeAll(reason));
        }

        return this.finalizePromise;
    }

    /** 登録順に後始末処理を実行する。個々の失敗は`onError`へ回し、残りの実行は継続する。 */
    private async disposeAll(reason: StopReason): Promise<void> {
        for (const dispose of this.disposers) {
            try {
                await dispose(reason);
            } catch (error: unknown) {
                try {
                    this.onError(error);
                } catch {
                    // Diagnostics must not interrupt later resource disposal.
                }
            }
        }
    }
}

/**
 * idAllocator が注入されない（あるいは利用不可の）場合の既定実装。
 * 「衝突回避が必要な資源を持たない」という状態を、null 判定ではなく
 * IStreamIdAllocator という同じ形の値として表現することで、
 * StreamManageModel 側の分岐を「注入されているか否か」ではなく
 * 「使えるか否か（isAvailable()）」という allocator 自身の状態確認に統一する。
 */
const NULL_STREAM_ID_ALLOCATOR: IStreamIdAllocator = {
    beginInitialization: () => undefined,
    captureSnapshot: async () => null,
    hasArtifactCollision: async () => false,
    isAvailable: () => false,
    knownCollisions: () => new Set<apid.StreamId>(),
    markKnownCollision: () => undefined,
    release: () => undefined,
    reserve: () => {
        throw new Error('StreamIdAllocatorUnavailable');
    },
};

/**
 * `IStreamManageModel`の実装。ライブ・録画済み、配信方式（segment ファイルを
 * ディスクへ書き出す方式かどうか）を問わず、複数配信の
 * 生存期間（開始→稼働→停止）を一元管理する。個々の配信の実装差は
 * `IStreamBaseModel`契約（`ownsDiskArtifacts()`/`finalizeStop()`）越しにしか見ず、
 * ディスク上の成果物と衝突しない streamId の採番は `idAllocator`
 * （`IStreamIdAllocator`）へ委譲することで、このクラス自身は配信方式を意識しない。
 */
@injectable()
class StreamManageModel implements IStreamManageModel {
    private executeManagementModel: IExecutionManagementModel;
    /** streamId 採番の collaborator。DI で注入されなければ`NULL_STREAM_ID_ALLOCATOR`（常に無効）を使う。 */
    private idAllocator: IStreamIdAllocator;
    private log: ILogger;
    /** 録画済み配信元のリース取得を担う collaborator。DI で注入されなければ`startRecorded`等は呼び出し側が明示的に consumer を渡す必要がある。 */
    private recordedDeliveryLeaseConsumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>;
    private socketIO: ISocketIOManageModel;
    /** streamId をキーにした、現在生存中の配信の集合。開始時に追加され、`finalizeActive`完了時に削除される。 */
    private streams: { [streamId: number]: ActiveStream } = {};

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IStreamIdAllocator') idAllocator?: IStreamIdAllocator,
        @inject('RecordedDeliveryLeaseConsumer')
        @optional()
        recordedDeliveryLeaseConsumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>,
    ) {
        this.log = logger.getLogger();
        this.executeManagementModel = executeManagementModel;
        this.socketIO = socketIO;
        this.idAllocator = idAllocator ?? NULL_STREAM_ID_ALLOCATOR;
        this.recordedDeliveryLeaseConsumer = recordedDeliveryLeaseConsumer;
    }

    /**
     * ストリームを開始する
     * @param stream: IStreamBase<any> setOption() した状態で渡す
     * @return Promise<apid.StreamId>
     */
    public async start(stream: IStreamBaseModel<any>): Promise<apid.StreamId> {
        return await this.startInternal(stream, stream.ownsDiskArtifacts());
    }

    /**
     * `IStreamManageModel#startRecorded`の実装。streamId を先に確保してから、配信元
     * リースの取得（`consumer.acquireAndOpen`）→ stream 実体の生成（`streamProvider`）→
     * `option.configure`による option 適用、の順に進める。途中で開始要求が無効化
     * されれば、取得済みのリース・生成済み stream 候補を後始末してから中断する。
     * @param consumer 省略時は DI で注入された既定の consumer を使う。
     */
    public async startRecorded(
        streamProvider: () => Promise<IRecordedStreamBaseModel>,
        option: RecordedStreamStartOption,
        suppliedConsumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>,
    ): Promise<{ readonly stream: IRecordedStreamBaseModel; readonly streamId: apid.StreamId }> {
        const consumer = suppliedConsumer ?? this.recordedDeliveryLeaseConsumer;
        if (consumer === undefined) {
            throw new Error('RecordedDeliveryLeaseConsumerIsUndefined');
        }

        let startedStream: IRecordedStreamBaseModel | null = null;
        const streamId = await this.startInternal(
            null,
            option.usesManagedId,
            async active => {
                let delivery: AcquiredRecordedDeliverySource | null = null;
                let adopted = false;
                let stream: IRecordedStreamBaseModel | null = null;
                try {
                    delivery = await consumer.acquireAndOpen(option.videoFileId, option.playPosition, () =>
                        this.canSettleStart(active),
                    );
                    if (this.canSettleStart(active) === false) {
                        await this.releaseUnadoptedRecordedDeliveryAfterFailure(delivery, active.id);
                        return;
                    }

                    stream = await streamProvider();
                    if (this.canSettleStart(active) === false) {
                        await this.cleanupLateStreamCandidate(stream, active.id);
                        await this.releaseUnadoptedRecordedDeliveryAfterFailure(delivery, active.id);
                        return;
                    }

                    stream.adoptPlaybackSource(delivery.source, () => delivery!.release());
                    adopted = true;
                    option.configure(stream, delivery.source);
                    this.attachStream(active, stream);
                    startedStream = stream;
                } catch (error: unknown) {
                    if (stream !== null && adopted) {
                        await this.cleanupLateStreamCandidate(stream, active.id);
                    } else if (delivery !== null) {
                        await this.releaseUnadoptedRecordedDeliveryAfterFailure(delivery, active.id);
                    }
                    throw error;
                }
            },
            toLegacyRecordedDeliveryError,
            {
                isEnable: false,
                mode: option.mode,
                type: option.pendingInfoType,
                videoFileId: option.videoFileId,
            },
        );
        if (startedStream === null) {
            throw new Error('RecordedStreamStartNotAdopted');
        }
        return { stream: startedStream, streamId };
    }

    /**
     * `IStreamManageModel#acquireRecordedDelivery`の実装。stream 実体を経由せず、
     * `streams`registry には登録しない独立した `ActiveRecordedDelivery` 状態で
     * タイムアウト・多重解放を管理しながらリースを取得する。
     * @param isActive 取得の途中で呼び出し元がまだ有効かを確認する callback。
     * @param consumer 省略時は DI で注入された既定の consumer を使う。
     */
    public async acquireRecordedDelivery(
        videoFileId: number,
        playPosition: number,
        isActive: () => boolean = () => true,
        suppliedConsumer?: Pick<RecordedDeliveryLeaseConsumer, 'acquireAndOpen'>,
    ): Promise<AcquiredRecordedDeliverySource> {
        const consumer = suppliedConsumer ?? this.recordedDeliveryLeaseConsumer;
        if (consumer === undefined) {
            throw new Error('RecordedDeliveryLeaseConsumerIsUndefined');
        }

        const active: ActiveRecordedDelivery = {
            releasePromise: null,
            startTimer: null,
            state: 'starting',
        };
        return await new Promise<AcquiredRecordedDeliverySource>((resolve, reject) => {
            const rejectStart = (error: Error): void => {
                if (active.state !== 'starting') return;
                active.state = 'stopping';
                this.clearRecordedDeliveryStartTimer(active);
                reject(error);
            };
            active.startTimer = setTimeout(
                () => rejectStart(new Error('StreamStartTimeout')),
                StreamManageModel.MEDIA_DELIVERY_START_TIMEOUT_MS,
            );
            void consumer
                .acquireAndOpen(videoFileId, playPosition, () => active.state === 'starting' && isActive(), {
                    // 直接配信は動画情報を使わないため、ffprobe の失敗で配信を止めない。
                    allowMissingVideoInfo: true,
                })
                .then(
                    delivery => {
                        if (active.state !== 'starting' || isActive() === false) {
                            void this.releaseUnadoptedRecordedDeliveryAfterFailure(delivery, undefined);
                            if (active.state === 'starting') {
                                rejectStart(new Error('StreamStartStopped'));
                            }
                            return;
                        }

                        active.state = 'ready';
                        this.clearRecordedDeliveryStartTimer(active);
                        resolve({
                            recordedId: delivery.recordedId,
                            source: delivery.source,
                            release: () => this.releaseRecordedDelivery(active, delivery),
                        });
                    },
                    error => rejectStart(toLegacyRecordedDeliveryError(error)),
                );
        });
    }

    /** `acquireRecordedDelivery`の取得タイムアウトタイマーを解除する。 */
    private clearRecordedDeliveryStartTimer(active: ActiveRecordedDelivery): void {
        if (active.startTimer === null) return;
        clearTimeout(active.startTimer);
        active.startTimer = null;
    }

    /** `acquireRecordedDelivery`が返した`release`の実体。複数回呼ばれても解放は一度だけ行う。 */
    private async releaseRecordedDelivery(
        active: ActiveRecordedDelivery,
        delivery: AcquiredRecordedDeliverySource,
    ): Promise<void> {
        active.releasePromise ??= (async () => {
            active.state = 'stopping';
            this.clearRecordedDeliveryStartTimer(active);
            await this.releaseUnadoptedRecordedDeliveryAfterFailure(delivery, undefined);
        })();
        await active.releasePromise;
    }

    /**
     * `stream`として採用されなかった（または解放要求を受けた）配信元を後始末する。
     * `encoded-direct`以外の種別は reader を明示的に close してから lease を解放する。
     */
    private async releaseUnadoptedRecordedDeliveryAfterFailure(
        delivery: AcquiredRecordedDeliverySource,
        streamId: apid.StreamId | undefined,
    ): Promise<void> {
        if (delivery.source.kind !== 'encoded-direct') {
            try {
                await delivery.source.reader.close();
            } catch (error: unknown) {
                this.logStreamError('recorded delivery source reader close error');
                this.logStreamError(error);
            }
        }
        await this.releaseRecordedDeliveryAfterFailure(delivery, streamId);
    }

    /** 配信元の lease を解放する。失敗しても呼び出し元へは伝播させず、診断ログに残すのみ。 */
    private async releaseRecordedDeliveryAfterFailure(
        delivery: AcquiredRecordedDeliverySource,
        streamId: apid.StreamId | undefined,
    ): Promise<void> {
        try {
            await delivery.release();
        } catch (error: unknown) {
            this.logStreamError(
                streamId === undefined
                    ? 'recorded delivery lease release error'
                    : `recorded delivery lease release error ${streamId}`,
            );
            this.logStreamError(error);
        }
    }

    /**
     * `start()`/`startRecorded()`共通の開始処理本体。streamId を採番（必要なら
     * `idAllocator`経由）し、`ActiveStream`を`streams`へ登録してから、実際の開始
     * （`runStart`）を非同期に進める。`stream`が未確定（`startRecorded`）の場合は
     * `preparation`が`stream`を用意して`attachStream`するまで、仮の`pendingInfo`で応答する。
     * @param usesManagedId ディスク上の既存成果物と衝突しない streamId が必要かどうか。
     * @param preparation `stream`を確定させる前段の非同期処理（無ければ`stream`をそのまま使う）。
     * @returns 開始が完了（またはタイムアウト・失敗が確定）した際に解決/拒否される Promise。
     */
    private async startInternal(
        stream: IStreamBaseModel<any> | null,
        usesManagedId: boolean,
        preparation: ((active: ActiveStream) => Promise<void>) | null = null,
        mapStartError: (error: unknown) => Error = this.toError,
        pendingInfo: LiveStreamInfo | RecordedStreamInfo | null = null,
    ): Promise<apid.StreamId> {
        const startDeadline = globalThis.performance.now() + StreamManageModel.MEDIA_DELIVERY_START_TIMEOUT_MS;
        let snapshot: ReadonlySet<apid.StreamId> | null;
        try {
            snapshot = usesManagedId
                ? await this.withStartDeadline(this.idAllocator.captureSnapshot(), startDeadline)
                : null;
        } catch (error: unknown) {
            this.log.stream.error('start stream error');
            this.log.stream.error(error);
            throw error;
        }
        const streamId =
            snapshot === null
                ? this.getEmptyStreamId()
                : this.idAllocator.reserve(Object.keys(this.streams).map(Number), snapshot);
        const active = this.createActiveStream(streamId, null, usesManagedId, mapStartError, pendingInfo);
        if (preparation !== null) {
            active.preparation = () => preparation(active);
        }
        this.streams[streamId] = active;
        this.log.stream.info(`start stream: ${streamId.toString(10)}`);
        this.socketIO.notifyClient();

        if (stream !== null) {
            try {
                this.attachStream(active, stream);
            } catch (error: unknown) {
                this.rejectStart(active, this.toError(error), 'start-failed');
                return active.startResult.promise;
            }
        }

        active.startTimer = setTimeout(
            () => {
                this.rejectStart(active, new Error('StreamStartTimeout'), 'start-timeout');
            },
            Math.max(0, Math.ceil(startDeadline - globalThis.performance.now())),
        );
        active.resources.adopt(() => this.clearStartTimer(active));

        void this.runStart(active);
        return active.startResult.promise;
    }

    /** 新しい`ActiveStream`を、対応する`StartResult`（未解決 Promise）・`ResourceLeaseBundle`込みで生成する。 */
    private createActiveStream(
        streamId: apid.StreamId,
        stream: IStreamBaseModel<any> | null,
        usesManagedId: boolean,
        mapStartError: (error: unknown) => Error,
        pendingInfo: LiveStreamInfo | RecordedStreamInfo | null,
    ): ActiveStream {
        let resolve!: (streamId: apid.StreamId) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<apid.StreamId>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        const resources = new ResourceLeaseBundle(error => {
            this.logStreamError(`stop stream error ${streamId}`);
            this.logStreamError(error);
        });

        return {
            finalizePromise: null,
            id: streamId,
            mapStartError,
            pendingInfo,
            preparation: null,
            resources,
            startResult: { promise, reject, resolve, settled: false },
            startTimer: null,
            state: 'starting',
            stream,
            usesManagedId,
        };
    }

    /**
     * `active`へ実際の stream 実体を紐付ける。`stream.stop()`を後始末処理として
     * `resources`へ登録し、`stream`が自発的に終了イベントを出したら`stopActive`する
     * よう配線する。既に紐付け済みなら例外を投げる。
     */
    private attachStream(active: ActiveStream, stream: IStreamBaseModel<any>): void {
        if (active.stream !== null) {
            throw new Error('StreamAlreadyAttached');
        }
        active.stream = stream;
        active.resources.adopt(() => stream.stop());
        stream.setExitStream(() => {
            void this.stopActive(active, 'source-ended');
        });
    }

    /** `attachStream`されないまま無効になった stream 候補を停止する（失敗を診断ログに残すのみ）。 */
    private async cleanupLateStreamCandidate(stream: IStreamBaseModel<any>, streamId: apid.StreamId): Promise<void> {
        try {
            await stream.stop();
        } catch (error: unknown) {
            this.logStreamError(`late stream cleanup error ${streamId}`);
            this.logStreamError(error);
        }
    }

    /**
     * `active`の開始処理を進める。`preparation`（あれば）→ 遷移の順番待ち
     * （`completeTransitionTurn`）→ 採番済み streamId の衝突再確認
     * （`recheckManagedIdReservation`）→ 実際の`stream.start()`、の順に進み、
     * 各段階の後で`canSettleStart`により、この開始要求がまだ有効かを確認する。
     * 途中で無効化されていれば`settleLateStart`で後始末する。
     */
    private async runStart(active: ActiveStream): Promise<void> {
        if (active.preparation !== null) {
            try {
                await active.preparation();
            } catch (error: unknown) {
                if (this.canSettleStart(active)) {
                    this.log.stream.error('start stream error');
                    this.log.stream.error(error);
                    this.rejectStart(active, active.mapStartError(error), 'start-failed');
                } else {
                    await this.settleLateStart(active);
                }
                return;
            }
            if (this.canSettleStart(active) === false) {
                return;
            }
        }
        const stream = active.stream;
        if (stream === null) {
            this.rejectStart(active, new Error('RecordedStreamStartNotAdopted'), 'start-failed');
            return;
        }

        try {
            await this.completeTransitionTurn(StreamManageModel.START_STREAM_PRIORITY);
        } catch (error: unknown) {
            this.log.stream.error('start stream error');
            this.log.stream.error(error);
            this.rejectStart(active, active.mapStartError(error), 'start-failed');
            return;
        }
        if (this.canSettleStart(active) === false) {
            return;
        }

        try {
            await this.recheckManagedIdReservation(active);
        } catch (error: unknown) {
            this.log.stream.error('start stream error');
            this.log.stream.error(error);
            this.rejectStart(active, active.mapStartError(error), 'start-failed');
            return;
        }
        if (this.canSettleStart(active) === false) {
            return;
        }

        try {
            await stream.start(active.id);
        } catch (error: unknown) {
            if (this.canSettleStart(active)) {
                this.log.stream.error('start stream error');
                this.log.stream.error(error);
                this.rejectStart(active, active.mapStartError(error), 'start-failed');
                return;
            }

            await this.settleLateStart(active);
            return;
        }

        if (this.canSettleStart(active) === false) {
            await this.settleLateStart(active);
            return;
        }

        active.startResult.settled = true;
        this.clearStartTimer(active);
        if (active.usesManagedId === false) {
            active.state = 'ready';
            this.socketIO.notifyClient();
        }
        active.startResult.resolve(active.id);
    }

    /**
     * 開始が既に無効化された（＝`canSettleStart`が false になった）後の後始末。
     * 既に`finalizeActive`が進行中ならそれを待つだけにし、まだ停止処理が始まっていなければ
     * `stream`を直接クリーンアップする。
     */
    private async settleLateStart(active: ActiveStream): Promise<void> {
        if (this.streams[active.id] === active && active.finalizePromise !== null) {
            await active.finalizePromise;
            return;
        }

        await this.cleanupLateStream(active);
    }

    /** この開始要求がまだ「未確定・進行中・自分が current な active stream」であるかどうか。 */
    private canSettleStart(active: ActiveStream): boolean {
        return (
            active.startResult.settled === false && active.state === 'starting' && this.streams[active.id] === active
        );
    }

    /** 開始を失敗として確定させ、`startResult`を reject してから`reason`で停止処理へ進む。既に確定済みなら何もしない。 */
    private rejectStart(active: ActiveStream, error: Error, reason: StopReason): void {
        if (this.canSettleStart(active) === false) {
            return;
        }

        active.startResult.settled = true;
        this.clearStartTimer(active);
        active.startResult.reject(error);
        void this.stopActive(active, reason);
    }

    /** `active`に stream が紐付いていれば停止する。まだ紐付いていなければ何もしない。 */
    private async cleanupLateStream(active: ActiveStream): Promise<void> {
        if (active.stream === null) return;
        await this.cleanupLateStreamCandidate(active.stream, active.id);
    }

    /** 開始タイムアウトタイマーを解除する。 */
    private clearStartTimer(active: ActiveStream): void {
        if (active.startTimer === null) {
            return;
        }

        clearTimeout(active.startTimer);
        active.startTimer = null;
    }

    private toError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }

    /**
     * 空いている streamId を返す
     * @return apid.StreamId
     */
    private getEmptyStreamId(): apid.StreamId {
        let newStreamId = 0;
        while (true) {
            if (typeof this.streams[newStreamId] === 'undefined') {
                return newStreamId;
            }

            newStreamId++;
        }
    }

    /**
     * すでに払い出した active.id が、その後の外部資源の状態変化で衝突していないか
     * idAllocator へ確認し、衝突していれば再採番する。衝突が解消するまで再帰する。
     *
     * 衝突判定・再採番のアルゴリズム自体は idAllocator に閉じており、
     * このメソッドは「いつ確認するか（canSettleStart）」「再採番後の
     * this.streams 更新・通知」という manager 自身の関心事だけを担う。
     */
    private async recheckManagedIdReservation(active: ActiveStream): Promise<void> {
        if (active.usesManagedId === false || this.idAllocator.isAvailable() === false) {
            return;
        }

        let hasCollision: boolean;
        try {
            hasCollision = await this.idAllocator.hasArtifactCollision(active.id);
        } catch (error: unknown) {
            if (this.canSettleStart(active) === false) {
                return;
            }
            this.idAllocator.markKnownCollision(active.id);
            throw error;
        }
        if (this.canSettleStart(active) === false || hasCollision === false) {
            return;
        }

        const collidedId = active.id;
        this.idAllocator.markKnownCollision(collidedId);
        delete this.streams[collidedId];
        active.id = this.idAllocator.reserve(Object.keys(this.streams).map(Number), this.idAllocator.knownCollisions());
        this.streams[active.id] = active;
        this.socketIO.notifyClient();
        await this.recheckManagedIdReservation(active);
    }

    /**
     * `operation`を`deadline`（`performance.now()`基準の絶対時刻）までに完了させる。
     * 解決が間に合っても、その時点で既に締切を過ぎていれば`StreamStartTimeout`で
     * 拒否する（`await`中に締切ぎりぎりで解決した場合の取りこぼしを防ぐ）。
     */
    private withStartDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('StreamStartTimeout')),
                Math.max(0, Math.ceil(deadline - globalThis.performance.now())),
            );
            void operation.then(
                value => {
                    clearTimeout(timer);
                    if (globalThis.performance.now() >= deadline) {
                        reject(new Error('StreamStartTimeout'));
                    } else {
                        resolve(value);
                    }
                },
                error => {
                    clearTimeout(timer);
                    reject(error);
                },
            );
        });
    }

    /**
     * ストリームを停止する
     * @param streamId: apid.StreamId
     * @param isForce?: boolean 強制的に停止させるか
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId, isForce: boolean = false): Promise<void> {
        const active = this.streams[streamId];
        if (typeof active === 'undefined') {
            return;
        }

        await this.stopActive(
            active,
            'explicit-stop',
            isForce ? StreamManageModel.FOURCE_STOP_STREAM_PRIORITY : StreamManageModel.STOP_STREAM_PRIORITY,
        );
    }

    private stopActive(
        active: ActiveStream,
        reason: StopReason,
        priority: number = StreamManageModel.STOP_STREAM_PRIORITY,
    ): Promise<void> {
        if (active.finalizePromise === null) {
            active.finalizePromise = this.finalizeActive(active, reason, priority);
        }

        return active.finalizePromise;
    }

    private async finalizeActive(active: ActiveStream, reason: StopReason, priority: number): Promise<void> {
        if (this.streams[active.id] !== active) {
            return;
        }

        if (active.startResult.settled === false) {
            active.startResult.settled = true;
            this.clearStartTimer(active);
            active.startResult.reject(new Error('StreamStartStopped'));
        }
        active.state = 'stopping';
        this.socketIO.notifyClient();

        try {
            await this.completeTransitionTurn(priority);
        } catch (error: unknown) {
            this.logStreamError(`stop stream transition error ${active.id}`);
            this.logStreamError(error);
        }
        await active.resources.finalize(reason);
        if (this.streams[active.id] !== active) {
            return;
        }

        const stream = active.stream;
        delete this.streams[active.id];
        if (active.usesManagedId) {
            this.idAllocator.release(active.id);
        }
        if (stream !== null) {
            this.finalizeStream(stream);
        }
        this.socketIO.notifyClient();
        this.logStreamInfo(`stop stream ${active.id}`);
    }

    /**
     * IStreamBaseModel#finalizeStop() は interface で保証された contract のため、
     * duck-typing による存在確認は不要。呼び出し自体の失敗だけを診断する。
     */
    private finalizeStream(stream: IStreamBaseModel<any>): void {
        try {
            stream.finalizeStop();
        } catch (error: unknown) {
            this.logStreamError(error);
        }
    }

    private logStreamError(value: unknown): void {
        try {
            this.log.stream.error(value);
        } catch {
            // Diagnostics must not interrupt stream finalization.
        }
    }

    private logStreamInfo(value: unknown): void {
        try {
            this.log.stream.info(value);
        } catch {
            // Diagnostics must not interrupt stream finalization.
        }
    }

    private async completeTransitionTurn(priority: number): Promise<void> {
        const executionId = await this.executeManagementModel.getExecution(priority);
        this.executeManagementModel.unLockExecution(executionId);
    }

    /**
     * すべてのストリームを停止する
     */
    public async stopAll(): Promise<void> {
        const snapshot = Object.values(this.streams);
        for (const active of snapshot) {
            await this.stopActive(active, 'explicit-stop', StreamManageModel.FOURCE_STOP_STREAM_PRIORITY).catch(
                error => {
                    this.log.system.error(error);
                },
            );
        }
    }

    /**
     * 指定したストリームを停止しないように停止タイマー情報を更新させる
     * @param streamId: apid.StreamId
     */
    public keep(streamId: apid.StreamId): void {
        const active = this.streams[streamId];
        if (typeof active === 'undefined') {
            throw new Error('StreamIsUndefined');
        }

        if (active.stream === null) throw new Error('StreamIsUndefined');
        active.stream.keep();
        this.log.stream.debug(`keep stream ${streamId}`);
    }

    /**
     * ストリーム情報を返す
     * @param streamId: apid.StreamId
     * @return LiveStreamInfo | RecordedStreamInfo
     */
    public getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo {
        const active = this.streams[streamId];
        if (typeof active === 'undefined') {
            throw new Error('StreamIsNotFound');
        }

        if (active.stream === null) throw new Error('StreamIsNotFound');
        return active.stream.getInfo();
    }

    /**
     * すべてのストリーム情報を返す
     * @return StreamInfoWithStreamId[]
     */
    public getStreamInfos(): StreamInfoWithStreamId[] {
        return Object.values(this.streams)
            .map(active => ({
                info: active.stream?.getInfo() ?? active.pendingInfo,
                streamId: active.id,
            }))
            .filter((item): item is StreamInfoWithStreamId => item.info !== null);
    }
}

namespace StreamManageModel {
    export const START_STREAM_PRIORITY = 1;
    export const STOP_STREAM_PRIORITY = 1;
    export const FOURCE_STOP_STREAM_PRIORITY = 10;
    export const MEDIA_DELIVERY_START_TIMEOUT_MS = 30 * 1000;
}

export default StreamManageModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_STREAM_MANAGE_STARTRECORDED_NOTADOPTED_20260924: unique symbol;
