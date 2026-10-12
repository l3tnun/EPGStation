import { ChildProcess } from 'child_process';
import { inject, injectable, optional } from 'inversify';
import type * as apid from '../../../api.js';
import ILoggerModel from '../ILoggerModel.js';
import IRecordedManageModel, {
    AddVideoFileOption,
    UploadedVideoFileOption,
} from '../operator/recorded/IRecordedManageModel.js';
import RecordedUploadAdoptionModel from '../operator/recorded/RecordedUploadAdoptionModel.js';
import IRecordedTagManadeModel from '../operator/recordedTag/IRecordedTagManadeModel.js';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel.js';
import IReservationManageModel from '../operator/reservation/IReservationManageModel.js';
import IRuleManageModel from '../operator/rule/IRuleManageModel.js';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel.js';
import IPreparedRecordedDeletionProvider from '../operator/recorded/IPreparedRecordedDeletionProvider.js';
import IPreparedVideoFileDeletionProvider from '../operator/recorded/IPreparedVideoFileDeletionProvider.js';
import ParentUserDeletionCoordinator from '../workflow/ParentUserDeletionCoordinator.js';
import ParentVideoFileDeletionCoordinator from '../workflow/ParentVideoFileDeletionCoordinator.js';
import {
    EncodeCompletionInfo,
    EncodeCompletionSink,
    EncodeCompletionSinkRegistrationPort,
} from './IEncodeCompletionSink.js';
import IIPCServer from './IIPCServer.js';
import { UploadedVideoAdoptedMessage } from './IUploadedVideoRegistration.js';
import {
    ParentRecordedResourceUseRegistry,
    ParentRecordedResourceUseRegistryRegistrationPort,
    RecordedUseSnapshotClient,
    RecordedUseSnapshotPayload,
} from './IRecordedResourceUse.js';
import {
    OperatorEncodeEventFunctions,
    ModelName,
    NotifyClientMessage,
    PushEncodeMessage,
    RecordedUseAcquireMessage,
    RecordedUseAcquireReplyMessage,
    RecordedUseReleaseMessage,
    RecordedUseReleaseReplyMessage,
    RecordedUseSnapshotReplyMessage,
    RecordedUseSnapshotRequestMessage,
    RecordedFunctions,
    RecordedTagFunctions,
    RecordingFunctions,
    ReplayMessage,
    ReserveationFunctions,
    RuleFuntions,
    SendMessage,
    ThumbnailFunctions,
} from './IPCMessageDefine.js';

// model名ごとに、IPC経由で呼び出し可能な関数（func名）を引くための索引の型。
interface IFunctionIndex {
    [functionName: string]: (msg: SendMessage, acknowledgeUploadAdoption?: () => void) => Promise<any>;
}

// 子process（operator process）との接続が切れたと見なすイベント名。このいずれかが1回でも発火したら
// 該当peerへの登録listenerを解除し、以後そのpeerへの通知・応答は行わない。
const terminalEvents = ['exit', 'error', 'disconnect', 'close'] as const;

// 現在接続中のoperator process 1つ分の登録情報。listenerを保持しておくのは、切断時に
// `removeListener`で確実に外すため（外し忘れるとold peerのmessageを処理し続けてしまう）。
interface PeerRegistration {
    readonly child: ChildProcess;
    readonly messageListener: (
        msg: SendMessage | RecordedUseAcquireMessage | RecordedUseReleaseMessage | RecordedUseSnapshotReplyMessage,
    ) => void;
    readonly terminalListener: () => void;
}

// 録画使用状況のsnapshot要求1件分の待ち状態。どのchild processに要求したかを保持し、
// 別peerからの遅延応答や別peer切断時の誤解決を防ぐ。
interface PendingSnapshot {
    readonly child: ChildProcess;
    readonly resolve: (snapshot: RecordedUseSnapshotPayload) => void;
    readonly timeoutHandle: NodeJS.Timeout;
}

// operator processへ返送し得る応答messageの総称型。
type ReplyMessage =
    ReplayMessage | RecordedUseAcquireReplyMessage | RecordedUseReleaseReplyMessage | UploadedVideoAdoptedMessage;

const defaultRequestTimeout = 5_000;

/**
 * web/service process側からoperator process（`ChildProcess`）とNode.jsのIPCで通信する窓口の実装。
 * `IPCClient`（operator process側）からの要求を`functions`索引で振り分けて対応するmanage modelを呼び出し、
 * 結果を`replay`で送り返す。録画使用状況（recordedResourceUse/recordedUseSnapshot）のacquire/release/
 * snapshot要求はmanage model呼び出しではなく、`ParentRecordedResourceUseRegistry`（登録済みなら）へ
 * 中継する。接続するoperator processは常に高々1つ（`currentPeer`）で、再接続時は前の登録を解除する。
 */
@injectable()
export default class IPCServer implements IIPCServer {
    // 各domainのmanage model。constructorで注入され、以後は不変（再注入されない）。
    private reservationManage: IReservationManageModel;
    private recordedManage: IRecordedManageModel;
    private recordedTagManage: IRecordedTagManadeModel;
    private recordingManage: IRecordingManageModel;
    private ruleManage: IRuleManageModel;
    private thumbnailManage: IThumbnailManageModel;
    // encode process側からのencode完了通知の受け皿。`register`で後から1つだけ登録される
    // （constructor注入だと循環依存になるため、登録用portを介して遅延で結び付けている）。
    private encodeCompletionSink: EncodeCompletionSink | null = null;
    // 上記`encodeCompletionSink`を登録するための窓口。DI側はこのport経由でのみ登録できる。
    public readonly encodeCompletionSinkRegistrationPort: EncodeCompletionSinkRegistrationPort = {
        register: sink => this.setEncodeCompletionSink(sink),
    };
    // 録画使用状況（再生・削除保護等の排他制御）の実処理を担う登録先。encodeCompletionSinkと同様、
    // 循環依存を避けるため後から`register`で結び付ける。
    public readonly recordedResourceUseRegistryRegistrationPort: ParentRecordedResourceUseRegistryRegistrationPort = {
        register: registry => this.setRecordedResourceUseRegistry(registry),
    };
    // operator process側へ現在の録画使用状況のsnapshotを要求するための窓口（呼び出し側から見た公開API）。
    public readonly recordedUseSnapshotClient: RecordedUseSnapshotClient = {
        requestSnapshot: () => this.requestRecordedUseSnapshot(),
    };
    // 上記2つのregistrationPortで後から登録される実体。未登録の間はacquire/release/snapshot要求を
    // 処理できず、`unknown`扱いになる。
    private recordedResourceUseRegistry: ParentRecordedResourceUseRegistry | null = null;
    // 現在接続中のoperator process。接続が無い間は`null`で、`setEncode`等は例外を投げる。
    private child: ChildProcess | null = null;
    // ILoggerModelが未注入（`@optional()`）の場合に備えたfallback。既定は何もしない関数。
    private logError: (message: string) => void = () => undefined;
    // 現在有効なpeer登録（listenerの解除に必要な情報一式）。`child`と対になる。
    private currentPeer: PeerRegistration | null = null;
    // 既に切断済みと判定したchild processの集合。切断後に遅れて届くmessageへの応答を抑止するために使う。
    private readonly disconnectedPeers: WeakSet<ChildProcess> = new WeakSet();
    // 発行済みでまだ応答が来ていないsnapshot要求。requestIdをkeyに、応答またはtimeoutで解決する。
    private readonly pendingSnapshots: Map<number, PendingSnapshot> = new Map();
    // 次に払い出すsnapshot要求ID。`allocateSnapshotRequestId`が既存の未解決IDと衝突しないよう進める。
    private nextSnapshotRequestId: number = 1;
    // アップロードされた動画file本体を受け取り、正式な録画fileとして採用するまでの処理を担う。
    private readonly recordedUploadAdoption: RecordedUploadAdoptionModel;
    // 削除要求（ユーザー起点）を、進行中の予約・録画との整合を取りながら実行する調整役。
    private readonly parentUserDeletionCoordinator: ParentUserDeletionCoordinator;
    // 録画ファイル単位の削除要求について、上記と同様の整合を取る調整役。
    private readonly parentVideoFileDeletionCoordinator: ParentVideoFileDeletionCoordinator;
    // `recordedUploadAdoption.initialize()`の結果を1度だけ実行してキャッシュするためのPromise。
    // `initialize()`が複数回呼ばれても初期化処理自体は1回しか走らない。
    private uploadAdoptionInitialization: Promise<void> | undefined;
    // model名 → 関数索引のmap。`init()`で1度だけ構築され、`handleRequest`が要求の振り分けに使う。
    private functions: {
        [modelName: string]: IFunctionIndex;
    } = {};

    constructor(
        @inject('IReservationManageModel')
        reservationManage: IReservationManageModel,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('IRecordedTagManadeModel') recordedTagManage: IRecordedTagManadeModel,
        @inject('IRecordingManageModel') recordingManage: IRecordingManageModel,
        @inject('IRuleManageModel') ruleManage: IRuleManageModel,
        @inject('IThumbnailManageModel') thumbnailManage: IThumbnailManageModel,
        @inject('ILoggerModel') @optional() logger: ILoggerModel | undefined,
        @inject(RecordedUploadAdoptionModel) recordedUploadAdoption: RecordedUploadAdoptionModel,
    ) {
        this.reservationManage = reservationManage;
        this.recordedManage = recordedManage;
        this.recordedTagManage = recordedTagManage;
        this.recordingManage = recordingManage;
        this.ruleManage = ruleManage;
        this.thumbnailManage = thumbnailManage;
        this.recordedUploadAdoption = recordedUploadAdoption;
        this.parentUserDeletionCoordinator = new ParentUserDeletionCoordinator(
            recordedManage as IRecordedManageModel & IPreparedRecordedDeletionProvider,
            {
                hasReservation: reserveId => recordingManage.hasReserve(reserveId),
                requestCancellationForDeletion: reserveId => recordingManage.cancelForDeletion(reserveId),
            },
        );
        this.parentVideoFileDeletionCoordinator = new ParentVideoFileDeletionCoordinator(
            recordedManage as IRecordedManageModel & IPreparedVideoFileDeletionProvider,
            recordedManage as IRecordedManageModel & IPreparedRecordedDeletionProvider,
            {
                hasReservation: reserveId => recordingManage.hasReserve(reserveId),
                requestCancellationForDeletion: reserveId => recordingManage.cancelForDeletion(reserveId),
            },
        );
        if (typeof logger?.getLogger === 'function') {
            const systemLogger = logger.getLogger().system;
            this.logError = systemLogger.error.bind(systemLogger);
        }

        this.init();
    }

    /**
     * アップロード採用処理（`recordedUploadAdoption`）を初期化する。何度呼ばれても初期化自体は1回だけ
     * 実行され、以後の呼び出しは同じPromiseの完了を待つだけになる。
     */
    public async initialize(): Promise<void> {
        if (typeof this.uploadAdoptionInitialization === 'undefined') {
            this.uploadAdoptionInitialization = this.recordedUploadAdoption.initialize();
        }
        await this.uploadAdoptionInitialization;
    }

    /**
     * operator process（子process）を、このIPCServerが応答する唯一の相手として登録する。
     * 既に別のpeerが登録済みの場合は先にそちらの登録を解除してから差し替える（同時に2つの
     * peerへ応答することはない）。
     * @param child 新たに接続してきたoperator processのハンドル。
     */
    public register(child: ChildProcess): void {
        this.releaseCurrentPeer();
        this.disconnectedPeers.delete(child);
        const registration: PeerRegistration = {
            child,
            messageListener: msg => this.handlePeerMessage(child, msg),
            terminalListener: () => this.handleTerminal(child),
        };
        this.currentPeer = registration;
        this.child = child;
        child.on('message', registration.messageListener);
        for (const event of terminalEvents) child.once(event, registration.terminalListener);
    }

    // peerからの受信messageを種別ごとに振り分ける。録画使用状況のacquire/release/snapshot応答は
    // 専用handlerへ、それ以外は通常のIPC要求として`handleRequest`へ渡す。
    private handlePeerMessage(
        requester: ChildProcess,
        msg: SendMessage | RecordedUseAcquireMessage | RecordedUseReleaseMessage | RecordedUseSnapshotReplyMessage,
    ): void {
        if ((<RecordedUseAcquireMessage>msg).type === 'recordedUseAcquire') {
            this.handleRecordedUseAcquire(requester, <RecordedUseAcquireMessage>msg);

            return;
        }
        if ((<RecordedUseReleaseMessage>msg).type === 'recordedUseRelease') {
            this.handleRecordedUseRelease(requester, <RecordedUseReleaseMessage>msg);

            return;
        }
        if ((<RecordedUseSnapshotReplyMessage>msg).type === 'recordedUseSnapshotReply') {
            this.handleRecordedUseSnapshotReply(requester, <RecordedUseSnapshotReplyMessage>msg);

            return;
        }
        void this.handleRequest(requester, <SendMessage>msg);
    }

    // 録画使用状況（再生・削除保護など）の確保要求を`recordedResourceUseRegistry`へ中継する。
    // registryが未登録、または例外を投げた場合は`unknown`として応答する（要求元をブロックしない）。
    private handleRecordedUseAcquire(requester: ChildProcess, msg: RecordedUseAcquireMessage): void {
        let status: RecordedUseAcquireReplyMessage['status'] = 'unknown';
        try {
            const result = this.recordedResourceUseRegistry?.acquire({
                kind: msg.kind,
                recordedId: msg.recordedId,
                requestId: msg.id,
                senderPeer: requester,
            });
            if (result?.status === 'granted' || result?.status === 'blocked' || result?.status === 'unknown') {
                status = result.status;
            }
        } catch (_error: unknown) {
            status = 'unknown';
        }
        this.replay(requester, { id: msg.id, status, type: 'recordedUseAcquireReply' });
    }

    // 録画使用状況の解放要求を`recordedResourceUseRegistry`へ中継する。acquireと同様、
    // registry未登録・例外時は`unknown`として応答する。
    private handleRecordedUseRelease(requester: ChildProcess, msg: RecordedUseReleaseMessage): void {
        let status: RecordedUseReleaseReplyMessage['status'] = 'unknown';
        try {
            const result = this.recordedResourceUseRegistry?.release({
                acquisitionRequestId: msg.acquisitionRequestId,
                senderPeer: requester,
            });
            if (result === 'released' || result === 'already-released' || result === 'unknown') {
                status = result;
            }
        } catch (_error: unknown) {
            status = 'unknown';
        }
        this.replay(requester, {
            acquisitionRequestId: msg.acquisitionRequestId,
            status,
            type: 'recordedUseReleaseReply',
        });
    }

    // `functions`索引を使って、manage model呼び出しを伴う通常のIPC要求を実行し、結果または
    // エラーを応答する。`addUploadedVideoFile`のときだけ、file採用完了を要求元へ先行通知する
    // `acknowledgeUploadAdoption`callbackを渡す（採用が確定した時点と、本処理の完了時点がずれるため）。
    private async handleRequest(requester: ChildProcess, msg: SendMessage): Promise<void> {
        const requestId = msg.id;
        if (!Object.prototype.hasOwnProperty.call(this.functions, msg.model)) {
            this.replay(requester, {
                id: requestId,
                error: 'IPCFunctionError',
            });

            return;
        }
        const functions = this.functions[msg.model];
        if (!Object.prototype.hasOwnProperty.call(functions, msg.func)) {
            this.replay(requester, {
                id: requestId,
                error: 'IPCFunctionError',
            });

            return;
        }

        try {
            const acknowledgeUploadAdoption =
                msg.model === ModelName.recorded && msg.func === RecordedFunctions.addUploadedVideoFile
                    ? () => this.replay(requester, { id: requestId, type: 'uploadedVideoAdopted' })
                    : undefined;
            const result = await functions[msg.func](msg, acknowledgeUploadAdoption);
            this.replay(requester, {
                id: requestId,
                result: result,
            });
        } catch (err: any) {
            this.replay(requester, {
                id: requestId,
                error: err.message,
            });
        }
    }

    // `terminalEvents`のいずれかが発火したときのhandler。発火元が現在のpeerと一致する場合のみ
    // 切断済み扱いにして登録を解除する（古いpeerの遅延発火で現peerを巻き込まないようにする）。
    private handleTerminal(child: ChildProcess): void {
        const peer = this.currentPeer;
        if (peer === null) return;
        if (peer.child !== child) return;
        this.disconnectedPeers.add(child);
        this.releaseCurrentPeer();
    }

    // 現在のpeer登録を解除する。解除対象のpeerを待っていたsnapshot要求は全て`unknown`で解決してから
    // listenerを外す（解除後に応答が来ることは無いため、待ち続けさせない）。
    private releaseCurrentPeer(): void {
        const peer = this.currentPeer;
        if (peer === null) {
            this.child = null;

            return;
        }
        this.resolveSnapshotsForPeer(peer.child);
        this.currentPeer = null;
        this.child = null;
        peer.child.removeListener('message', peer.messageListener);
        for (const event of terminalEvents) peer.child.removeListener(event, peer.terminalListener);
    }

    // 要求元peerへ応答messageを送る。既に切断済みと判定済み、または`connected`が`false`の場合は
    // 送信を試みずに失敗として記録する（無効なsocketへの`send`が例外を投げ得るため）。
    private replay(requester: ChildProcess, msg: ReplyMessage): void {
        if (this.disconnectedPeers.has(requester) || requester.connected === false) {
            this.recordReplyFailure(new Error('requester is disconnected'));

            return;
        }

        try {
            if (typeof requester.connected !== 'boolean') {
                requester.send(msg);

                return;
            }
            requester.send(msg, error => {
                if (error !== null) this.recordReplyFailure(error);
            });
        } catch (error: unknown) {
            this.recordReplyFailure(error);
        }
    }

    // 応答送信の失敗をログへ記録するだけの処理（呼び出し元へ例外を伝播させない）。
    private recordReplyFailure(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logError(`IPC reply discarded: ${message}`);
    }

    // encodeCompletionSinkRegistrationPort.register の実処理。
    private setEncodeCompletionSink(sink: EncodeCompletionSink): void {
        this.encodeCompletionSink = sink;
    }

    // recordedResourceUseRegistryRegistrationPort.register の実処理。
    private setRecordedResourceUseRegistry(registry: ParentRecordedResourceUseRegistry): void {
        this.recordedResourceUseRegistry = registry;
    }

    /**
     * operator processへ現在の録画使用状況のsnapshotを要求する。
     * @returns operator processから届いたsnapshot。接続が無い／送信失敗／timeoutの場合は
     *          `{ status: 'unknown' }`（例外は投げない）。
     */
    private requestRecordedUseSnapshot(): Promise<RecordedUseSnapshotPayload> {
        const child = this.child;
        if (child === null || child.connected === false) {
            return Promise.resolve({ status: 'unknown' });
        }
        const id = this.allocateSnapshotRequestId();
        return new Promise(resolve => {
            const timeoutHandle = setTimeout(() => this.timeoutRecordedUseSnapshot(id), defaultRequestTimeout);
            this.pendingSnapshots.set(id, { child, resolve, timeoutHandle });
            try {
                const message: RecordedUseSnapshotRequestMessage = { id, type: 'recordedUseSnapshotRequest' };
                if (typeof child.connected !== 'boolean') {
                    child.send(message);
                } else {
                    child.send(message, error => {
                        if (error !== null) this.completeRecordedUseSnapshot(id, child, { status: 'unknown' });
                    });
                }
            } catch (_error: unknown) {
                this.completeRecordedUseSnapshot(id, child, { status: 'unknown' });
            }
        });
    }

    // 未使用のsnapshot要求IDを1つ払い出す（`nextSnapshotRequestId`から順に、既存の未解決IDと
    // 衝突しない値まで進める。上限到達時は1へ折り返す）。
    private allocateSnapshotRequestId(): number {
        let id = this.nextSnapshotRequestId;
        while (this.pendingSnapshots.has(id)) id = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        this.nextSnapshotRequestId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;

        return id;
    }

    // operator processからのsnapshot応答を受け取り、対応する待ちを解決する。
    private handleRecordedUseSnapshotReply(requester: ChildProcess, reply: RecordedUseSnapshotReplyMessage): void {
        this.completeRecordedUseSnapshot(reply.id, requester, this.normalizeRecordedUseSnapshot(reply.snapshot));
    }

    // snapshot要求が既定時間内に応答されなかった場合、`unknown`として解決する。
    private timeoutRecordedUseSnapshot(id: number): void {
        const pending = this.pendingSnapshots.get(id);
        if (typeof pending === 'undefined') {
            return;
        }
        this.completeRecordedUseSnapshot(id, pending.child, { status: 'unknown' });
    }

    // 指定したpeerを待っている全snapshot要求を`unknown`として解決する。peer切断時に、
    // そのpeerからの応答をこれ以上待たせないために呼ぶ。
    private resolveSnapshotsForPeer(child: ChildProcess): void {
        for (const [id, pending] of this.pendingSnapshots) {
            if (pending.child === child) this.completeRecordedUseSnapshot(id, child, { status: 'unknown' });
        }
    }

    // snapshot要求1件を解決する。要求時と異なるpeerからの応答（別peerに切り替わった後の
    // 遅延応答等）は無視する。
    private completeRecordedUseSnapshot(id: number, child: ChildProcess, snapshot: RecordedUseSnapshotPayload): void {
        const pending = this.pendingSnapshots.get(id);
        if (typeof pending === 'undefined' || pending.child !== child) {
            return;
        }
        this.pendingSnapshots.delete(id);
        clearTimeout(pending.timeoutHandle);
        pending.resolve(snapshot);
    }

    // operator processから届いたsnapshot payload（`unknown`な形式で届き得る）を検証し、
    // 期待する形になっていなければ`{ status: 'unknown' }`へfallbackさせる。
    private normalizeRecordedUseSnapshot(snapshot: unknown): RecordedUseSnapshotPayload {
        if (typeof snapshot !== 'object' || snapshot === null) {
            return { status: 'unknown' };
        }
        const candidate = <Partial<RecordedUseSnapshotPayload>>snapshot;
        if (
            candidate.status !== 'known' ||
            !Array.isArray(candidate.recordedIds) ||
            !candidate.recordedIds.every(
                recordedId => typeof recordedId === 'number' && Number.isSafeInteger(recordedId),
            )
        ) {
            return { status: 'unknown' };
        }
        return { recordedIds: candidate.recordedIds, status: 'known' };
    }

    // operator processへ通知系message（クライアント更新通知／encode依頼）を送る。
    private sendNotification(child: ChildProcess, msg: NotifyClientMessage | PushEncodeMessage): void {
        child.send(<any>msg, error => {
            if (error !== null) this.recordNotificationFailure(error);
        });
    }

    // 通知送信の失敗をログへ記録するだけの処理（応答を待つ要求ではないため、呼び出し元には伝播しない）。
    private recordNotificationFailure(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logError(`IPC notification discarded: ${message}`);
    }

    /**
     * 子プロセスに socket.io による状態更新通知を依頼する
     */
    public notifyClient(): void {
        const child = this.child;
        if (child === null) {
            this.recordNotificationFailure(new Error('notification recipient is unavailable'));

            return;
        }

        try {
            this.sendNotification(child, {
                type: 'notifyClient',
            });
        } catch (error: unknown) {
            this.recordNotificationFailure(error);
        }
    }

    /**
     * クライアントへエンコードを依頼する
     * @param addOption: apid.AddEncodeProgramOption
     */
    public setEncode(addOption: apid.AddEncodeProgramOption): void {
        const child = this.child;
        if (child === null) {
            throw new Error('ChildIsNull');
        }

        this.sendNotification(child, {
            type: 'pushEncode',
            value: addOption,
        });
    }

    /**
     * 関数登録処理
     */
    private init(): void {
        this.functions[ModelName.reserveation] = this.getReserveationFunctions();
        this.functions[ModelName.recorded] = this.getRecordedFunctions();
        this.functions[ModelName.recordedTag] = this.getRecordedTagFunctions();
        this.functions[ModelName.recording] = this.getRecordingFunctions();
        this.functions[ModelName.rule] = this.getRuleFunctions();
        this.functions[ModelName.thumbnail] = this.getThumbnailFunctions();
        this.functions[ModelName.encodeEvent] = this.getOperatorEncodeEventFunctions();
    }

    /**
     * set reserveation functions
     */
    private getReserveationFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // getBroadcastStatus
        index[ReserveationFunctions.getBroadcastStatus] = async () => {
            return this.reservationManage.getBroadcastStatus();
        };

        // add
        index[ReserveationFunctions.add] = async msg => {
            const option = this.getArgsValue<apid.ManualReserveOption>(msg, 'option');

            return await this.reservationManage.add(option);
        };

        // update
        index[ReserveationFunctions.update] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.update(reserveId);
        };

        // updateRule
        index[ReserveationFunctions.updateRule] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');
            await this.reservationManage.updateRule(ruleId);
        };

        // updateAll
        index[ReserveationFunctions.updateAll] = async msg => {
            const isUntilComplete = this.getArgsValue<boolean>(msg, 'isUntilComplete');

            if (isUntilComplete === true) {
                await this.reservationManage.updateAll();
            } else {
                this.reservationManage.updateAll();
            }
        };

        // cancel
        index[ReserveationFunctions.cancel] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.cancel(reserveId);
        };

        // removeSkip
        index[ReserveationFunctions.removeSkip] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.removeSkip(reserveId);
        };

        // removeOverlap
        index[ReserveationFunctions.removeOverlap] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            await this.reservationManage.removeOverlap(reserveId);
        };

        // edit
        index[ReserveationFunctions.edit] = async msg => {
            const reserveId = this.getArgsValue<apid.ReserveId>(msg, 'reserveId');
            const option = this.getArgsValue<apid.EditManualReserveOption>(msg, 'option');
            await this.reservationManage.edit(reserveId, option);
        };

        return index;
    }

    /**
     * set recorded functions
     */
    private getRecordedFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // delete
        index[RecordedFunctions.delete] = async msg => {
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.parentUserDeletionCoordinator.deleteFromRequest(recordedId);
        };

        // updateVideoFileSize
        index[RecordedFunctions.updateVideoFileSize] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.recordedManage.updateVideoFileSize(videoFileId);
        };

        // addVideoFile
        index[RecordedFunctions.addVideoFile] = async msg => {
            const option = this.getArgsValue<AddVideoFileOption>(msg, 'option');

            return await this.recordedManage.addVideoFile(option);
        };

        // addUploadedVideoFile
        index[RecordedFunctions.addUploadedVideoFile] = async (msg, acknowledgeUploadAdoption) => {
            const option = this.getArgsValue<UploadedVideoFileOption>(msg, 'option');
            const filePath = await this.recordedUploadAdoption.adopt(option.filePath);
            acknowledgeUploadAdoption?.();

            await this.recordedManage.addUploadedVideoFile({ ...option, filePath });
        };

        // createNewRecorded
        index[RecordedFunctions.createNewRecorded] = async msg => {
            const option = this.getArgsValue<apid.CreateNewRecordedOption>(msg, 'option');

            return await this.recordedManage.createNewRecorded(option);
        };

        // deleteVideoFile
        index[RecordedFunctions.deleteVideoFile] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.parentVideoFileDeletionCoordinator.deleteVideoFileFromRequest(videoFileId);
        };

        // changeProtect
        index[RecordedFunctions.changeProtect] = async msg => {
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');
            const isProtect = this.getArgsValue<boolean>(msg, 'isProtect');

            await this.recordedManage.changeProtect(recordedId, isProtect);
        };

        // videoFileCleanup
        index[RecordedFunctions.videoFileCleanup] = async () => {
            await this.recordedManage.videoFileCleanup();
        };

        // dropLogFileCleanup
        index[RecordedFunctions.dropLogFileCleanup] = async () => {
            await this.recordedManage.dropLogFileCleanup();
        };

        return index;
    }

    /**
     * set recordedTag functions
     */
    private getRecordedTagFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        index[RecordedTagFunctions.create] = async msg => {
            const name = this.getArgsValue<string>(msg, 'name');
            const color = this.getArgsValue<string>(msg, 'color');

            return await this.recordedTagManage.create(name, color);
        };

        index[RecordedTagFunctions.update] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const name = this.getArgsValue<string>(msg, 'name');
            const color = this.getArgsValue<string>(msg, 'color');

            await this.recordedTagManage.update(tagId, name, color);
        };

        index[RecordedTagFunctions.setRelation] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.recordedTagManage.setRelation(tagId, recordedId);
        };

        index[RecordedTagFunctions.delete] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');

            await this.recordedTagManage.delete(tagId);
        };

        index[RecordedTagFunctions.deleteRelation] = async msg => {
            const tagId = this.getArgsValue<apid.RecordedTagId>(msg, 'tagId');
            const recordedId = this.getArgsValue<apid.RecordedId>(msg, 'recordedId');

            await this.recordedTagManage.deleteRelation(tagId, recordedId);
        };

        return index;
    }

    /**
     * set recording functions
     */
    private getRecordingFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // resetTimer
        index[RecordingFunctions.resetTimer] = async () => {
            this.recordingManage.resetTimer();
        };

        return index;
    }

    /**
     * set rule functions
     */
    private getRuleFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // add
        index[RuleFuntions.add] = async msg => {
            const rule = this.getArgsValue<apid.AddRuleOption>(msg, 'rule');

            return await this.ruleManage.add(rule);
        };

        // update
        index[RuleFuntions.update] = async msg => {
            const rule = this.getArgsValue<apid.Rule>(msg, 'rule');

            await this.ruleManage.update(rule);
        };

        // enable
        index[RuleFuntions.enable] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.enable(ruleId);
        };

        // disable
        index[RuleFuntions.disable] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.disable(ruleId);
        };

        // delete
        index[RuleFuntions.delete] = async msg => {
            const ruleId = this.getArgsValue<apid.RuleId>(msg, 'ruleId');

            await this.ruleManage.delete(ruleId);
        };

        return index;
    }

    /**
     * set thumbnail functions
     */
    private getThumbnailFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // regenerate
        index[ThumbnailFunctions.regenerate] = async () => {
            await this.thumbnailManage.regenerate();
        };

        // fileCleanup
        index[ThumbnailFunctions.fileCleanup] = async () => {
            await this.thumbnailManage.fileCleanup();
        };

        // add
        index[ThumbnailFunctions.add] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            this.thumbnailManage.add(videoFileId);
        };

        // delete
        index[ThumbnailFunctions.delete] = async msg => {
            const thumbnailId = this.getArgsValue<apid.ThumbnailId>(msg, 'thumbnailId');

            await this.thumbnailManage.delete(thumbnailId);
        };

        return index;
    }

    /**
     * set operator encode event functions
     */
    private getOperatorEncodeEventFunctions(): IFunctionIndex {
        const index: IFunctionIndex = {};

        // emitFinishEncode
        index[OperatorEncodeEventFunctions.emitFinishEncode] = async msg => {
            const info = this.getArgsValue<EncodeCompletionInfo>(msg, 'info');

            if (this.encodeCompletionSink === null) {
                throw new Error('EncodeCompletionSinkNotRegistered');
            }

            await this.encodeCompletionSink.accept(info);
        };

        return index;
    }

    /**
     * SendMessage.args から指定した引数を取り出す
     * @param msg: SendMessage
     * @param argsName: 引数名
     * @return T
     */
    private getArgsValue<T>(msg: SendMessage, argsName: string): T {
        if (typeof msg.args === 'undefined' || typeof msg.args[argsName] === 'undefined') {
            throw new Error('IPCArgsError');
        }

        return <T>msg.args[argsName];
    }
}
