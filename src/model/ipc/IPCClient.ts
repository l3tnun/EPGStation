import { inject, injectable, unmanaged } from 'inversify';
import type * as apid from '../../../api.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import { AddVideoFileOption, UploadedVideoFileOption } from '../operator/recorded/IRecordedManageModel.js';
import IEncodeManageModel from '../service/encode/IEncodeManageModel.js';
import ISocketIOManageModel from '../service/socketio/ISocketIOManageModel.js';
import { EncodeCompletionInfo } from './IEncodeCompletionSink.js';
import {
    ChildRecordedUseSnapshotHandler,
    ChildRecordedUseSnapshotHandlerRegistrationPort,
    RecordedResourceUseClient,
    RecordedResourceUseKind,
    RecordedUseSnapshotPayload,
} from './IRecordedResourceUse.js';
import {
    UploadedVideoAdoptedMessage,
    UploadedVideoDispatchAttempt,
    UploadedVideoDispatchDisposition,
    UploadedVideoRegistrationPort,
} from './IUploadedVideoRegistration.js';
import IIPCClient, {
    IPCOperatorEncodeEvent,
    IPCRecordedManageModel,
    IPCRecordedTagManageModel,
    IPCRecordingManageModel,
    IPCReservationManageModel,
    IPCRuleManageModel,
    IPCThumbnailManageModel,
} from './IIPCClient.js';
import {
    ClientMessageOption,
    OperatorEncodeEventFunctions,
    ModelName,
    ParentMessage,
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

/**
 * 送信メッセージID採番の挙動をtestから差し替えるための注入点（`@unmanaged()`）。
 * `max`はID空間の上限（この値に達したら1へ折り返す）、`successor`は次候補の計算方法。
 * 本番では`productionIdAllocationSeams`（`Number.MAX_SAFE_INTEGER`まで単純増加）を使う。
 * testでは`max`を小さくしてID空間の枯渇・折り返しを再現できるようにする。
 */
export interface IdAllocationSeams {
    readonly max: number;
    readonly successor: (current: number) => number;
}

const defaultRequestTimeout = 5_000;
// アップロード動画の採用（`addUploadedVideoFile`）はfile本体のcopy等で時間がかかり得るため、
// 通常より長いtimeoutを使う。
const longRequestTimeout = 600_000;
type RequestTimeout = typeof defaultRequestTimeout | typeof longRequestTimeout;

// 送信済みで応答待ちの要求1件分の状態。`kind`/`lifecycle`はアップロード動画登録や
// 録画使用状況取得のような、通常のreject/resolveだけでは表現しきれない追加の完了経路を持つ
// 要求のときだけ使う。
interface PendingRequest {
    readonly kind?: 'recordedUseAcquire' | 'uploadedVideoRegistration';
    readonly lifecycle?: UploadedVideoRegistrationLifecycle;
    readonly reject: (error: Error) => void;
    readonly resolve: (result: unknown) => void;
    readonly timeoutHandle: NodeJS.Timeout;
}

// メッセージID未払い出しのため送信を待っている要求。`start`が設定されている場合はID確保後に
// `send`を経由せず直接その場で送信処理を開始する特殊経路（録画使用状況の確保要求）。
interface AllocationWaiter {
    readonly lifecycle?: UploadedVideoRegistrationLifecycle;
    readonly option: ClientMessageOption;
    readonly reject: (error: Error) => void;
    readonly resolve: (result: unknown) => void;
    readonly timeout: RequestTimeout;
    readonly start?: (id: number) => void;
}

// アップロード動画登録1件の進行状況に応じたcallback群。`onAdopted`は先行して「採用済み」を
// 通知された時点、`onRejected`は登録自体が失敗した時点、`onConfirmedNotSent`はメッセージ送信に
// 失敗して要求が成立しなかったことが確定した時点で呼ばれる。
interface UploadedVideoRegistrationLifecycle {
    readonly kind: 'uploadedVideoRegistration';
    readonly onAdopted: () => void;
    readonly onConfirmedNotSent: (error: Error) => void;
    readonly onRejected: (error: Error) => void;
}

// 録画使用状況の解放要求のうち、応答待ちのもの。
interface RecordedUseReleasePending {
    readonly reject: (error: Error) => void;
    readonly resolve: () => void;
    readonly timeoutHandle: NodeJS.Timeout;
}

const productionIdAllocationSeams: IdAllocationSeams = {
    max: Number.MAX_SAFE_INTEGER,
    successor: current => current + 1,
};

/**
 * web/service process側で動く、operator process（親process）とのIPC通信の実装。`IIPCClient`の
 * 各propertyは、対応するIPC要求を組み立てて`send`する薄いproxy関数の集まりとして
 * `setXxx`系methodで構築される。録画使用状況（recordedResourceUse）の確保・解放と、アップロード
 * 動画登録の2つは、単純なreject/resolveでは表現できない追加の完了経路を持つため、
 * 通常の`send`とは別の専用経路（`acquireRecordedResourceUse`/`dispatchUploadedVideoRegistration`
 * 等）で処理する。
 */
@injectable()
export default class IPCClient implements IIPCClient {
    private socketIO: ISocketIOManageModel;
    private encodeManage: IEncodeManageModel;
    // 各domain向けのIPC facade。constructorの`setXxx()`呼び出し群で組み立てられる
    // （`!`は「constructorの中で必ず初期化される」ことをTypeScriptへ伝えるためのもの）。
    public reserveation!: IPCReservationManageModel;
    public recorded!: IPCRecordedManageModel;
    public recordedTag!: IPCRecordedTagManageModel;
    public recording!: IPCRecordingManageModel;
    public rule!: IPCRuleManageModel;
    public thumbnail!: IPCThumbnailManageModel;
    public encodeEvent!: IPCOperatorEncodeEvent;
    // 録画使用状況（再生・削除保護等）の確保／解放を、他のmoduleへ公開するための窓口。
    public readonly recordedResourceUseClient: RecordedResourceUseClient = {
        acquire: (recordedId, kind) => this.acquireRecordedResourceUse(recordedId, kind),
        release: token => this.releaseRecordedResourceUseToken(token),
    };
    // operator processからのsnapshot要求（`recordedUseSnapshotRequest`）に応答するための
    // handlerを、後から1つだけ登録するための窓口。
    public readonly recordedUseSnapshotHandlerRegistrationPort: ChildRecordedUseSnapshotHandlerRegistrationPort = {
        register: handler => this.setRecordedUseSnapshotHandler(handler),
    };
    // アップロードされた動画fileの登録要求を発行するための窓口。
    public readonly uploadedVideoRegistrationPort: UploadedVideoRegistrationPort = {
        dispatch: option => this.dispatchUploadedVideoRegistration(option),
    };

    private log: ILogger;
    // 送信済みで応答待ちの要求。messageIDをkeyにする。
    private readonly pending: Map<number, PendingRequest> = new Map();
    // timeoutで打ち切った（＝pendingから外れた）が、operator process側では処理が続いている可能性がある
    // messageIDの集合。この後に届く遅延応答・関連messageを、値が再利用される前に正しく捨てるために使う。
    private readonly retired: Set<number> = new Set();
    // 録画使用状況の確保に成功し、まだ解放していない要求IDの集合。
    private readonly leased: Set<number> = new Set();
    // 呼び出し元へ渡した不透明なtoken（object）と、対応する確保要求IDの対応。
    // `releaseRecordedResourceUseToken`はtokenからIDを引いて解放要求を組み立てる。
    private readonly recordedUseTokens: Map<object, number> = new Map();
    // 発行済みで応答待ちの録画使用状況の解放要求。
    private readonly recordedUseReleasePending: Map<number, RecordedUseReleasePending> = new Map();
    // timeoutで打ち切った録画使用状況の確保要求のうち、`retired`とは別に、遅延応答が届いたときに
    // 「granted なら追って解放する」という後始末が必要なものを追跡する集合。
    private readonly retiredRecordedUseAcquires: Set<number> = new Set();
    // timeoutで打ち切った録画使用状況の解放要求のうち、遅延応答が届いたときに`leased`から
    // 取り除く後始末が必要なものを追跡する集合。
    private readonly retiredRecordedUseReleases: Set<number> = new Set();
    // operator processからのsnapshot要求に応答するhandler。未登録の間は`unknown`扱いで応答する。
    private recordedUseSnapshotHandler: ChildRecordedUseSnapshotHandler | null = null;
    // messageID未払い出しのため送信を保留している要求の待ち行列（FIFO）。
    private readonly allocationWaiters: AllocationWaiter[] = [];
    // messageIDの採番方法（本番/test用の差し替え）。constructorで固定され、以後変わらない。
    private readonly idAllocationSeams: IdAllocationSeams;
    // `drainAllocationWaiters`の再入防止フラグ（解決callbackの中から再度waiterが追加される場合に
    // 二重に処理してしまうのを防ぐ）。
    private isDrainingAllocationWaiters: boolean = false;
    // 次に試すmessageIDの候補。`allocateIdentifier`が使用中でなければこの値を払い出し、
    // 使用中ならこのfield自体も次候補へ進める。
    private nextCandidate: number = 1;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @unmanaged() idAllocationSeams?: IdAllocationSeams,
    ) {
        this.log = logger.getLogger();
        this.socketIO = socketIO;
        this.encodeManage = encodeManage;
        this.idAllocationSeams = this.normalizeIdAllocationSeams(idAllocationSeams);

        this.ipcInit();
        this.setReserveation();
        this.setRecorded();
        this.setRecordedTag();
        this.setRecording();
        this.setRule();
        this.setThumbnail();
        this.setEncodeEvent();
    }

    /**
     * IPC 通信初期設定
     */
    private ipcInit(): void {
        process.on(
            'message',
            async (
                msg:
                    | ReplayMessage
                    | ParentMessage
                    | RecordedUseAcquireReplyMessage
                    | RecordedUseReleaseReplyMessage
                    | RecordedUseSnapshotRequestMessage
                    | UploadedVideoAdoptedMessage,
            ) => {
                if ((<RecordedUseSnapshotRequestMessage>msg).type === 'recordedUseSnapshotRequest') {
                    this.handleRecordedUseSnapshotRequest(<RecordedUseSnapshotRequestMessage>msg);
                } else if ((<RecordedUseAcquireReplyMessage>msg).type === 'recordedUseAcquireReply') {
                    this.handleRecordedUseAcquireReply(<RecordedUseAcquireReplyMessage>msg);
                } else if ((<RecordedUseReleaseReplyMessage>msg).type === 'recordedUseReleaseReply') {
                    this.handleRecordedUseReleaseReply(<RecordedUseReleaseReplyMessage>msg);
                } else if ((<UploadedVideoAdoptedMessage>msg).type === 'uploadedVideoAdopted') {
                    this.handleUploadedVideoAdopted(<UploadedVideoAdoptedMessage>msg);
                } else if (typeof (<ReplayMessage>msg).id !== 'undefined') {
                    // 送信したメッセージの応答
                    this.handleReplay(<ReplayMessage>msg);
                } else if ((<ParentMessage>msg).type === 'notifyClient') {
                    // socket.io によるクライアントへの状態更新通知
                    this.socketIO.notifyClient();
                } else {
                    if ((<ParentMessage>msg).type === 'pushEncode') {
                        // エンコード依頼
                        this.encodeManage.push((<PushEncodeMessage>msg).value);
                    }
                }
            },
        );
    }

    /**
     * IPC 送信
     * @param option: ClientMessageOption
     * @return MessageId
     */
    private send<T>(
        option: ClientMessageOption,
        timeout: RequestTimeout = defaultRequestTimeout,
        lifecycle?: UploadedVideoRegistrationLifecycle,
    ): Promise<T> {
        return new Promise<T>((resolve: (value: T) => void, reject: (err: Error) => void) => {
            const waiter: AllocationWaiter = {
                option: option,
                lifecycle,
                reject: reject,
                resolve: (result: unknown) => resolve(<T>result),
                timeout: timeout,
            };
            const id = this.allocateIdentifier();
            if (typeof id === 'undefined') {
                this.allocationWaiters.push(waiter);

                return;
            }

            this.startRequest(id, waiter);
        });
    }

    // 払い出し済みmessageIDを使って要求を`pending`へ登録し、実際の送信をnext tickへ委ねる。
    // メッセージ組み立てで例外が出た場合（循環参照など）は送信せず即座に要求を失敗させる。
    private startRequest(id: number, waiter: AllocationWaiter): void {
        const timeoutHandle = setTimeout(() => this.timeoutRequest(id), waiter.timeout);
        this.pending.set(id, {
            kind: waiter.lifecycle?.kind,
            lifecycle: waiter.lifecycle,
            reject: waiter.reject,
            resolve: waiter.resolve,
            timeoutHandle: timeoutHandle,
        });

        let msg: SendMessage;
        try {
            msg = {
                id: id,
                model: waiter.option.model,
                func: waiter.option.func,
                args: waiter.option.args,
            };
        } catch (error: unknown) {
            this.failPendingRequest(id, this.toError(error));

            return;
        }

        process.nextTick(() => this.sendRequestMessage(id, msg));
    }

    // 録画使用状況の確保を要求する。`send`を使わない専用経路なのは、成功時に受け取る不透明な
    // tokenを`recordedUseTokens`へ登録する後処理が必要なため（`send`はmessage送信の汎用処理のみを担う）。
    private acquireRecordedResourceUse(
        recordedId: number,
        kind: RecordedResourceUseKind,
    ): Promise<{ readonly token: object }> {
        return new Promise((resolve, reject) => {
            const start = (id: number): void => this.startRecordedUseAcquire(id, recordedId, kind, resolve, reject);
            const id = this.allocateIdentifier();
            if (typeof id === 'undefined') {
                this.allocationWaiters.push({
                    option: { func: '', model: ModelName.recorded },
                    reject,
                    resolve: result => resolve(<{ readonly token: object }>result),
                    start,
                    timeout: defaultRequestTimeout,
                });

                return;
            }
            start(id);
        });
    }

    /**
     * アップロードされた動画fileの登録要求を送る。`send`の完了（本登録の完了）を待たず、
     * 呼び出し元へは即座に`disposition`（後で解決されるPromise）を返す。`disposition`は
     * 「採用済み通知が先に届いた（`adopted`）」「送信自体が失敗して要求が成立しなかった
     * （`confirmed-not-sent`）」のいずれかで解決する。本登録自体の失敗（`onRejected`）は
     * `disposition`をrejectする。
     * @param option アップロードされた動画fileの登録内容。
     * @returns `disposition`（登録処理の中間的な結果を表すPromise）を持つobject。
     */
    private dispatchUploadedVideoRegistration(option: UploadedVideoFileOption): UploadedVideoDispatchAttempt {
        let resolveDisposition!: (value: UploadedVideoDispatchDisposition) => void;
        let rejectDisposition!: (reason: Error) => void;
        const disposition = new Promise<UploadedVideoDispatchDisposition>((resolve, reject) => {
            resolveDisposition = resolve;
            rejectDisposition = reject;
        });
        const lifecycle: UploadedVideoRegistrationLifecycle = {
            kind: 'uploadedVideoRegistration',
            onAdopted: () => {
                resolveDisposition({ completion, kind: 'adopted' });
            },
            onConfirmedNotSent: error => resolveDisposition({ error, kind: 'confirmed-not-sent' }),
            onRejected: rejectDisposition,
        };
        const completion = this.send<void>(
            {
                args: { option },
                func: RecordedFunctions.addUploadedVideoFile,
                model: ModelName.recorded,
            },
            longRequestTimeout,
            lifecycle,
        );
        void completion.catch(() => undefined);

        return { disposition };
    }

    // 払い出し済みmessageIDで、録画使用状況の確保要求を`pending`へ登録して送信する
    // （`startRequest`の録画使用状況版。`kind: 'recordedUseAcquire'`で応答の扱いを分岐させる）。
    private startRecordedUseAcquire(
        id: number,
        recordedId: number,
        kind: RecordedResourceUseKind,
        resolve: (value: { readonly token: object }) => void,
        reject: (reason: Error) => void,
    ): void {
        const timeoutHandle = setTimeout(() => this.timeoutRequest(id), defaultRequestTimeout);
        this.pending.set(id, {
            kind: 'recordedUseAcquire',
            reject,
            resolve: result => resolve(<{ readonly token: object }>result),
            timeoutHandle,
        });
        const message: RecordedUseAcquireMessage = { id, kind, recordedId, type: 'recordedUseAcquire' };
        process.nextTick(() => this.sendRequestMessage(id, message));
    }

    // `process.send`を実際に呼び出す共通処理。`process.send`が未定義（親processが無い等）、
    // または呼び出し自体が例外を投げた場合は要求を即座に失敗させる。callback二重呼び出しを
    // `callbackHandled`で防いでいる（Node.jsのIPC実装がcallbackを複数回呼ぶ場合があるため）。
    private sendRequestMessage(id: number, msg: SendMessage | RecordedUseAcquireMessage): void {
        const send = process.send;
        if (typeof send === 'undefined') {
            const error = new Error('process.send is undefined');
            this.log.system.error(error.message);
            this.failPendingRequest(id, error);

            return;
        }

        let callbackHandled = false;
        try {
            send.call(process, msg, (error: Error | null) => {
                if (callbackHandled) {
                    return;
                }
                callbackHandled = true;
                if (error instanceof Error) {
                    this.log.system.error(`process.send callback error: ${error.message}`);
                    const pending = this.pending.get(id);
                    if (pending?.kind === 'uploadedVideoRegistration') pending.lifecycle?.onRejected(error);
                }
            });
        } catch (error: unknown) {
            const sendError = this.toError(error);
            this.log.system.error(`process.send error: ${sendError.message}`);
            this.failPendingRequest(id, sendError);
        }
    }

    // 通常のIPC要求（`send`経由）に対する応答を受け取り、対応する`pending`を解決/rejectする。
    // 該当する`pending`が既に無い場合は、timeoutで打ち切り済み（`retired`）の要求への遅延応答と
    // 見なして後始末（`retired`から除去し、空いたID分の待ち行列を進める）だけ行う。
    private handleReplay(replay: ReplayMessage): void {
        const pending = this.takePendingRequest(replay.id);
        if (typeof pending !== 'undefined') {
            if (typeof replay.error === 'undefined') {
                if (pending.kind === 'uploadedVideoRegistration') pending.lifecycle?.onAdopted();
                pending.resolve(replay.result);
            } else {
                const error = new Error(replay.error);
                pending.lifecycle?.onRejected(error);
                pending.reject(error);
            }
            this.drainAllocationWaiters();

            return;
        }

        if (this.retired.delete(replay.id)) {
            this.drainAllocationWaiters();
        }
    }

    // operator process側が動画fileの採用を確定した時点で先行して届く通知。本登録の完了
    // （`handleReplay`）を待たずに`disposition`を`adopted`で解決させるためのfast path。
    private handleUploadedVideoAdopted(message: UploadedVideoAdoptedMessage): void {
        const pending = this.pending.get(message.id);
        if (pending?.kind === 'uploadedVideoRegistration') pending.lifecycle?.onAdopted();
    }

    // 録画使用状況の確保要求への応答を処理する。既にtimeoutで打ち切り済み（`retiredRecordedUseAcquires`）
    // の要求に対して`granted`の遅延応答が届いた場合は、使われないまま確保状態だけが残らないよう、
    // 即座に解放要求を送る（呼び出し元は既にこの結果を受け取れないため）。
    private handleRecordedUseAcquireReply(reply: RecordedUseAcquireReplyMessage): void {
        const pending = this.pending.get(reply.id);
        if (pending?.kind === 'recordedUseAcquire') {
            this.pending.delete(reply.id);
            clearTimeout(pending.timeoutHandle);
            if (reply.status === 'granted') {
                const token = {};
                this.leased.add(reply.id);
                this.recordedUseTokens.set(token, reply.id);
                pending.resolve({ token });

                return;
            }
            pending.reject(
                new Error(reply.status === 'blocked' ? 'RecordedResourceUseBlocked' : 'RecordedResourceUseUnknown'),
            );
            this.drainAllocationWaiters();

            return;
        }
        if (!this.retiredRecordedUseAcquires.delete(reply.id)) {
            return;
        }
        this.retired.delete(reply.id);
        if (reply.status === 'granted') {
            this.leased.add(reply.id);
            void this.releaseRecordedResourceUse(reply.id).catch(() => undefined);

            return;
        }
        this.drainAllocationWaiters();
    }

    // 呼び出し元が持つ不透明なtokenから確保要求IDを引いて解放する。未知のtoken（既に解放済み等）は
    // 何もせず成功扱いにする。
    private releaseRecordedResourceUseToken(token: object): Promise<void> {
        const acquisitionRequestId = this.recordedUseTokens.get(token);
        if (typeof acquisitionRequestId === 'undefined') {
            return Promise.resolve();
        }
        this.recordedUseTokens.delete(token);

        return this.releaseRecordedResourceUse(acquisitionRequestId);
    }

    // 確保済み（`leased`）かつ未解放要求中でない場合のみ、実際の解放要求を送る。それ以外
    // （未確保、または既に解放要求中）は何もせず成功扱いにする（二重解放を防ぐ）。
    private releaseRecordedResourceUse(acquisitionRequestId: number): Promise<void> {
        if (!this.leased.has(acquisitionRequestId) || this.recordedUseReleasePending.has(acquisitionRequestId)) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(
                () => this.timeoutRecordedUseRelease(acquisitionRequestId),
                defaultRequestTimeout,
            );
            this.recordedUseReleasePending.set(acquisitionRequestId, { reject, resolve, timeoutHandle });
            process.nextTick(() => this.sendRecordedUseRelease(acquisitionRequestId));
        });
    }

    // 録画使用状況の解放要求を実際に送信する（`sendRequestMessage`の解放専用版）。
    private sendRecordedUseRelease(acquisitionRequestId: number): void {
        const send = process.send;
        if (typeof send === 'undefined') {
            this.failRecordedUseRelease(acquisitionRequestId, new Error('process.send is undefined'));

            return;
        }
        try {
            const message: RecordedUseReleaseMessage = { acquisitionRequestId, type: 'recordedUseRelease' };
            send.call(process, message, error => {
                if (error instanceof Error) this.log.system.error(`process.send callback error: ${error.message}`);
            });
        } catch (error: unknown) {
            const sendError = this.toError(error);
            this.log.system.error(`process.send error: ${sendError.message}`);
            this.failRecordedUseRelease(acquisitionRequestId, sendError);
        }
    }

    // 録画使用状況の解放要求への応答を処理する。timeoutで打ち切り済み（`retiredRecordedUseReleases`）
    // の要求に遅延応答が届いた場合も、`leased`から確実に取り除く（取りこぼすとID空間が
    // 実質的に使用中のまま塞がり続ける）。
    private handleRecordedUseReleaseReply(reply: RecordedUseReleaseReplyMessage): void {
        const pending = this.recordedUseReleasePending.get(reply.acquisitionRequestId);
        if (typeof pending !== 'undefined') {
            this.recordedUseReleasePending.delete(reply.acquisitionRequestId);
            clearTimeout(pending.timeoutHandle);
            if (reply.status === 'released' || reply.status === 'already-released') {
                this.releaseLeasedIdentifier(reply.acquisitionRequestId);
                pending.resolve();
            } else {
                pending.reject(new Error('RecordedResourceUseUnknown'));
            }

            return;
        }
        if (this.retiredRecordedUseReleases.delete(reply.acquisitionRequestId)) {
            if (reply.status === 'released' || reply.status === 'already-released') {
                this.releaseLeasedIdentifier(reply.acquisitionRequestId);
            }
        }
    }

    // 解放要求が既定時間内に応答されなかった場合、待ちを打ち切って失敗させる。
    private timeoutRecordedUseRelease(acquisitionRequestId: number): void {
        const pending = this.recordedUseReleasePending.get(acquisitionRequestId);
        if (typeof pending === 'undefined') {
            return;
        }
        this.recordedUseReleasePending.delete(acquisitionRequestId);
        clearTimeout(pending.timeoutHandle);
        this.retiredRecordedUseReleases.add(acquisitionRequestId);
        pending.reject(new Error('IPCTimeout'));
    }

    // 解放要求の送信自体が失敗した場合に、その待ちを失敗させる。
    private failRecordedUseRelease(acquisitionRequestId: number, error: Error): void {
        const pending = this.recordedUseReleasePending.get(acquisitionRequestId);
        if (typeof pending === 'undefined') {
            return;
        }
        this.recordedUseReleasePending.delete(acquisitionRequestId);
        clearTimeout(pending.timeoutHandle);
        pending.reject(error);
    }

    // 確保済みIDを`leased`から外し、そのIDが再利用可能になったことで送信できる待ち要求が
    // あれば処理を進める。
    private releaseLeasedIdentifier(id: number): void {
        if (this.leased.delete(id)) this.drainAllocationWaiters();
    }

    // recordedUseSnapshotHandlerRegistrationPort.register の実処理。
    private setRecordedUseSnapshotHandler(handler: ChildRecordedUseSnapshotHandler): void {
        this.recordedUseSnapshotHandler = handler;
    }

    // operator processからのsnapshot要求に応答する。handler未登録、または`getSnapshot`が
    // 例外を投げた場合は`unknown`として応答する（要求元をブロックしない）。
    private handleRecordedUseSnapshotRequest(request: RecordedUseSnapshotRequestMessage): void {
        let snapshot: RecordedUseSnapshotPayload = { status: 'unknown' };
        try {
            const result = this.recordedUseSnapshotHandler?.getSnapshot();
            if (typeof result !== 'undefined') snapshot = this.normalizeRecordedUseSnapshot(result);
        } catch (_error: unknown) {
            snapshot = { status: 'unknown' };
        }
        process.nextTick(() =>
            this.sendRecordedUseSnapshotReply({ id: request.id, snapshot, type: 'recordedUseSnapshotReply' }),
        );
    }

    // snapshot応答を実際に送信する。応答であり要求ではないため、送信失敗時に`pending`側の
    // 後始末は行わない（ログのみ）。
    private sendRecordedUseSnapshotReply(reply: RecordedUseSnapshotReplyMessage): void {
        const send = process.send;
        if (typeof send === 'undefined') {
            this.log.system.error('process.send is undefined');

            return;
        }
        try {
            send.call(process, reply, error => {
                if (error instanceof Error) this.log.system.error(`process.send callback error: ${error.message}`);
            });
        } catch (error: unknown) {
            const sendError = this.toError(error);
            this.log.system.error(`process.send error: ${sendError.message}`);
        }
    }

    // `getSnapshot`が返した値（handler実装依存で形式を保証できない）を検証し、期待する形に
    // なっていなければ`{ status: 'unknown' }`へfallbackさせる。
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

    // 通常のIPC要求が既定時間内に応答されなかった場合、待ちを打ち切って失敗させ、`retired`へ
    // 登録する（後で遅延応答が届いても正しく無視できるようにするため）。
    private timeoutRequest(id: number): void {
        const pending = this.pending.get(id);
        if (typeof pending === 'undefined') {
            return;
        }

        this.pending.delete(id);
        clearTimeout(pending.timeoutHandle);
        this.retired.add(id);
        if (pending.kind === 'recordedUseAcquire') this.retiredRecordedUseAcquires.add(id);
        const error = new Error('IPCTimeout');
        if (pending.kind === 'uploadedVideoRegistration') pending.lifecycle?.onRejected(error);
        pending.reject(error);
    }

    // `pending`から要求を取り出し、timeout timerを止めた上で返す（`pending`に残したまま
    // 二重解決してしまうことを防ぐ、取り出し専用の共通処理）。
    private takePendingRequest(id: number): PendingRequest | undefined {
        const pending = this.pending.get(id);
        if (typeof pending === 'undefined') {
            return undefined;
        }

        this.pending.delete(id);
        clearTimeout(pending.timeoutHandle);

        return pending;
    }

    // 送信自体の失敗など、応答を待たずに要求を失敗として確定させる共通処理。
    private failPendingRequest(id: number, error: Error): void {
        const pending = this.takePendingRequest(id);
        if (typeof pending === 'undefined') {
            return;
        }

        if (pending.kind === 'uploadedVideoRegistration') pending.lifecycle?.onConfirmedNotSent(error);
        pending.reject(error);
        this.drainAllocationWaiters();
    }

    // messageID未払い出しのため保留されていた要求（`allocationWaiters`）を、IDが空くたびに
    // 先頭から順に送信していく。IDがまだ確保できない要求に当たったら、それ以降はまとめて
    // 待ち行列の先頭へ戻す（順序を保つため）。再入防止フラグを使うのは、`start`/`startRequest`の
    // 中で同期的に解決が走り、再度この処理が呼ばれるケースがあるため。
    private drainAllocationWaiters(): void {
        if (this.isDrainingAllocationWaiters) {
            return;
        }

        this.isDrainingAllocationWaiters = true;
        try {
            const waiters = this.allocationWaiters.splice(0);
            const blockedIndex = waiters.findIndex(waiter => {
                const id = this.allocateIdentifier();
                if (typeof id === 'undefined') {
                    return true;
                }

                if (typeof waiter.start === 'function') waiter.start(id);
                else this.startRequest(id, waiter);

                return false;
            });
            if (blockedIndex !== -1) {
                this.allocationWaiters.unshift(...waiters.slice(blockedIndex));
            }
        } finally {
            this.isDrainingAllocationWaiters = false;
        }
    }

    // catch節で受け取った`unknown`を`Error`へ正規化する（`throw`されるのは必ずしも`Error`とは
    // 限らないため）。
    private toError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }

    // constructorへ渡された`idAllocationSeams`（test用の差し替え）を検証し、不正な値
    // （`max`が1未満、整数でない等）なら本番用の既定値へfallbackさせる。
    private normalizeIdAllocationSeams(seams?: IdAllocationSeams): IdAllocationSeams {
        if (typeof seams?.max !== 'number' || Number.isSafeInteger(seams.max) === false || seams.max < 1) {
            return productionIdAllocationSeams;
        }

        // `seams.successor`はtest側が呼び出しを観測するために呼ぶだけで、実際のID進行は
        // 常に`current + 1`に固定する（testが独自の増分ロジックを渡しても、本番と同じID列に
        // なることを保証するため）。
        const observedSuccessor =
            typeof seams.successor === 'function' ? seams.successor : productionIdAllocationSeams.successor;

        return {
            max: seams.max,
            successor: current => {
                observedSuccessor(current);

                return current + 1;
            },
        };
    }

    // 現在のIDから次の候補を求める（`max`に達していたら1へ折り返す）。
    private nextIdentifier(current: number): number {
        if (current === this.idAllocationSeams.max) {
            return 1;
        }

        return this.idAllocationSeams.successor(current);
    }

    // 現在使用中でない（`pending`/`retired`/`leased`のいずれにも無い）messageIDを1つ探して返す。
    // ID空間が全て使用中の場合は`undefined`を返し、呼び出し元は要求を`allocationWaiters`へ
    // 積んで空くのを待つ。
    private allocateIdentifier(): number | undefined {
        const used = new Set<number>([...this.pending.keys(), ...this.retired.values(), ...this.leased.values()]);
        let candidate = this.nextCandidate;

        used.forEach(() => {
            if (used.has(candidate)) {
                candidate = this.nextIdentifier(candidate);
            }
        });

        if (used.has(candidate)) {
            return undefined;
        }

        this.nextCandidate = this.nextIdentifier(candidate);

        return candidate;
    }

    /**
     * set reserveation
     */
    private setReserveation(): void {
        this.reserveation = {
            getBroadcastStatus: () => {
                return this.send<apid.BroadcastStatus>({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.getBroadcastStatus,
                });
            },
            add: (option: apid.ManualReserveOption) => {
                return this.send<apid.ReserveId>({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.add,
                    args: {
                        option: option,
                    },
                });
            },
            update: (reserveId: apid.ReserveId) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.update,
                    args: {
                        reserveId: reserveId,
                    },
                });
            },
            updateRule: (ruleId: apid.RuleId) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.updateRule,
                    args: {
                        ruleId: ruleId,
                    },
                });
            },
            updateAll: (isUntilComplete: boolean) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.updateAll,
                    args: {
                        isUntilComplete: isUntilComplete,
                    },
                });
            },
            cancel: (reserveId: apid.ReserveId) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.cancel,
                    args: {
                        reserveId: reserveId,
                    },
                });
            },
            removeSkip: (reserveId: apid.ReserveId) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.removeSkip,
                    args: {
                        reserveId: reserveId,
                    },
                });
            },
            removeOverlap: (reserveId: apid.ReserveId) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.removeOverlap,
                    args: {
                        reserveId: reserveId,
                    },
                });
            },
            edit: (reserveId: apid.ReserveId, option: apid.EditManualReserveOption) => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.edit,
                    args: {
                        reserveId: reserveId,
                        option: option,
                    },
                });
            },
            clean: () => {
                return this.send({
                    model: ModelName.reserveation,
                    func: ReserveationFunctions.clean,
                });
            },
        };
    }

    /**
     * set recorded
     */
    private setRecorded(): void {
        this.recorded = {
            delete: (recordedId: apid.RecordedId) => {
                this.log.system.info(`delete recorded by ipc: ${recordedId}`);

                return this.send({
                    model: ModelName.recorded,
                    func: RecordedFunctions.delete,
                    args: {
                        recordedId: recordedId,
                    },
                });
            },
            updateVideoFileSize: (videoFileId: apid.VideoFileId) => {
                return this.send({
                    model: ModelName.recorded,
                    func: RecordedFunctions.updateVideoFileSize,
                    args: {
                        videoFileId: videoFileId,
                    },
                });
            },
            addVideoFile: (option: AddVideoFileOption) => {
                return this.send<apid.VideoFileId>({
                    model: ModelName.recorded,
                    func: RecordedFunctions.addVideoFile,
                    args: {
                        option: option,
                    },
                });
            },
            addUploadedVideoFile: (option: UploadedVideoFileOption) => {
                return this.send(
                    {
                        model: ModelName.recorded,
                        func: RecordedFunctions.addUploadedVideoFile,
                        args: {
                            option: option,
                        },
                    },
                    longRequestTimeout,
                );
            },
            createNewRecorded: (option: apid.CreateNewRecordedOption, isIgnoreProtection?: boolean) => {
                return this.send<apid.RecordedId>({
                    model: ModelName.recorded,
                    func: RecordedFunctions.createNewRecorded,
                    args: {
                        option: option,
                        isIgnoreProtection: isIgnoreProtection,
                    },
                });
            },
            deleteVideoFile: (videoFileId: apid.VideoFileId) => {
                return this.send({
                    model: ModelName.recorded,
                    func: RecordedFunctions.deleteVideoFile,
                    args: {
                        videoFileId: videoFileId,
                    },
                });
            },
            changeProtect: (recordedId: apid.RecordedId, isProtect: boolean) => {
                return this.send({
                    model: ModelName.recorded,
                    func: RecordedFunctions.changeProtect,
                    args: {
                        recordedId: recordedId,
                        isProtect: isProtect,
                    },
                });
            },
            videoFileCleanup: () => {
                return this.send(
                    {
                        model: ModelName.recorded,
                        func: RecordedFunctions.videoFileCleanup,
                    },
                    longRequestTimeout,
                );
            },
            dropLogFileCleanup: () => {
                return this.send(
                    {
                        model: ModelName.recorded,
                        func: RecordedFunctions.dropLogFileCleanup,
                    },
                    longRequestTimeout,
                );
            },
        };
    }

    /**
     * set recordedTag
     */
    private setRecordedTag(): void {
        this.recordedTag = {
            create: (name: string, color: string) => {
                return this.send({
                    model: ModelName.recordedTag,
                    func: RecordedTagFunctions.create,
                    args: {
                        name: name,
                        color: color,
                    },
                });
            },
            update: (tagId: apid.RecordedTagId, name: string, color: string) => {
                return this.send({
                    model: ModelName.recordedTag,
                    func: RecordedTagFunctions.update,
                    args: {
                        tagId: tagId,
                        name: name,
                        color: color,
                    },
                });
            },
            setRelation: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => {
                return this.send({
                    model: ModelName.recordedTag,
                    func: RecordedTagFunctions.setRelation,
                    args: {
                        tagId: tagId,
                        recordedId: recordedId,
                    },
                });
            },
            delete: (tagId: apid.RecordedTagId) => {
                return this.send({
                    model: ModelName.recordedTag,
                    func: RecordedTagFunctions.delete,
                    args: {
                        tagId: tagId,
                    },
                });
            },
            deleteRelation: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => {
                return this.send({
                    model: ModelName.recordedTag,
                    func: RecordedTagFunctions.deleteRelation,
                    args: {
                        tagId: tagId,
                        recordedId: recordedId,
                    },
                });
            },
        };
    }

    /**
     * set recording
     */
    private setRecording(): void {
        this.recording = {
            resetTimer: () => {
                return this.send({
                    model: ModelName.recording,
                    func: RecordingFunctions.resetTimer,
                });
            },
        };
    }

    /**
     * set rule
     */
    private setRule(): void {
        this.rule = {
            add: (rule: apid.AddRuleOption) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.add,
                    args: {
                        rule: rule,
                    },
                });
            },
            update: (rule: apid.Rule) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.update,
                    args: {
                        rule: rule,
                    },
                });
            },
            enable: (ruleId: apid.RuleId) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.enable,
                    args: {
                        ruleId: ruleId,
                    },
                });
            },
            disable: (ruleId: apid.RuleId) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.disable,
                    args: {
                        ruleId: ruleId,
                    },
                });
            },
            delete: (ruleId: apid.RuleId) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.delete,
                    args: {
                        ruleId: ruleId,
                    },
                });
            },
        };
    }

    /**
     * set thumbnail
     */
    private setThumbnail(): void {
        this.thumbnail = {
            regenerate: () => {
                return this.send({
                    model: ModelName.thumbnail,
                    func: ThumbnailFunctions.regenerate,
                });
            },
            fileCleanup: () => {
                return this.send({
                    model: ModelName.thumbnail,
                    func: ThumbnailFunctions.fileCleanup,
                });
            },
            add: videoFileId => {
                return this.send({
                    model: ModelName.thumbnail,
                    func: ThumbnailFunctions.add,
                    args: {
                        videoFileId: videoFileId,
                    },
                });
            },
            delete: thumbnailId => {
                return this.send({
                    model: ModelName.thumbnail,
                    func: ThumbnailFunctions.delete,
                    args: {
                        thumbnailId: thumbnailId,
                    },
                });
            },
        };
    }

    /**
     * set encode event
     */
    private setEncodeEvent(): void {
        this.encodeEvent = {
            emitFinishEncode: (info: EncodeCompletionInfo) => {
                return this.send({
                    model: ModelName.encodeEvent,
                    func: OperatorEncodeEventFunctions.emitFinishEncode,
                    args: {
                        info: info,
                    },
                });
            },
        };
    }
}
declare const __EPGSTATION_COVERAGE_EXCLUSION_IPC_CLIENT_ACQUIRE_WAITER_START_20260924: unique symbol;
