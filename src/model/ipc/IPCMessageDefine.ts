import type * as apid from '../../../api.js';
import type {
    RecordedResourceUseKind,
    RecordedUseAcquireStatus,
    RecordedUseReleaseStatus,
    RecordedUseSnapshotPayload,
} from './IRecordedResourceUse.js';
import type { ServiceProcessStart } from './IServiceProcessReport.js';

/** 親子プロセス間メッセージ（`SendMessage`/`ReplayMessage`等）を対応付けるための一意な識別子。 */
export type MessageId = number;

/**
 * 親プロセスから子プロセスへのメッセージ
 */
export interface ParentMessage {
    type: 'pushEncode' | 'notifyClient';
    value?: any;
}

/**
 * クライアントへのステータス更新通知メッセージ
 */
export interface NotifyClientMessage extends ParentMessage {
    type: 'notifyClient';
}

/**
 * 親プロセスから子プロセスへのエンコード追加要求。`value`は追加するエンコードの依頼内容、`encodeId`は
 * 親側の依頼記録窓口が記録した依頼の識別番号。
 */
export interface PushEncodeMessage extends ParentMessage {
    type: 'pushEncode';
    value: apid.AddEncodeProgramOption;
    encodeId: apid.EncodeId;
}

/**
 * 子プロセスからメッセージ送信時に使用するオプション
 */
export interface ClientMessageOption {
    model: ModelName;
    func: string;
    args?: any;
}

/**
 * 子プロセスから送信されるメッセージ
 */
export interface SendMessage extends ClientMessageOption {
    id: MessageId;
}

/**
 * 子プロセスから送信されたメッセージに対する応答メッセージ
 */
export interface ReplayMessage {
    id: MessageId;
    result?: any;
    error?: string;
}

/** 子プロセスから親プロセスへの、録画済みファイルの利用権（lease）取得要求。 */
export interface RecordedUseAcquireMessage {
    readonly type: 'recordedUseAcquire';
    readonly id: MessageId;
    readonly recordedId: number;
    readonly kind: RecordedResourceUseKind;
}

/** `RecordedUseAcquireMessage`（同じ`id`）への応答。`status`が取得結果を表す。 */
export interface RecordedUseAcquireReplyMessage {
    readonly type: 'recordedUseAcquireReply';
    readonly id: MessageId;
    readonly status: RecordedUseAcquireStatus;
}

/** 子プロセスから親プロセスへの、取得済み利用権の解放要求。`acquisitionRequestId`は対応する
 *  `RecordedUseAcquireMessage.id`。 */
export interface RecordedUseReleaseMessage {
    readonly type: 'recordedUseRelease';
    readonly acquisitionRequestId: MessageId;
}

/** `RecordedUseReleaseMessage`（同じ`acquisitionRequestId`）への応答。`status`が解放結果を表す。 */
export interface RecordedUseReleaseReplyMessage {
    readonly type: 'recordedUseReleaseReply';
    readonly acquisitionRequestId: MessageId;
    readonly status: RecordedUseReleaseStatus;
}

/** 親プロセスから子プロセスへの、その時点で保持している録画使用状況のsnapshot要求。 */
export interface RecordedUseSnapshotRequestMessage {
    readonly type: 'recordedUseSnapshotRequest';
    readonly id: MessageId;
}

/** `RecordedUseSnapshotRequestMessage`（同じ`id`）への応答。子プロセス側が把握している使用状況を返す。 */
export interface RecordedUseSnapshotReplyMessage {
    readonly type: 'recordedUseSnapshotReply';
    readonly id: MessageId;
    readonly snapshot: RecordedUseSnapshotPayload;
}

/**
 * 子プロセスから親プロセスへの、外部プロセスの開始の知らせ。応答しない。管理側では
 * `ServiceChildProcessRegistry`が受け取る。
 */
export interface ServiceProcessStartedMessage extends ServiceProcessStart {
    readonly type: 'serviceProcessStarted';
}

/** 子プロセスから親プロセスへの、外部プロセスの終了の知らせ。応答しない。 */
export interface ServiceProcessEndedMessage {
    readonly type: 'serviceProcessEnded';
    readonly pid: number;
}

/**
 * モデル名
 */
export enum ModelName {
    recorded = 'recorded',
    recording = 'recording',
    recordedTag = 'recordedTag',
    reserveation = 'reserveation',
    rule = 'rule',
    thumbnail = 'thumbnail',
    encodeEvent = 'encodeEvent',
    encodeQueue = 'encodeQueue',
}

/**
 * reserveation の関数定義
 */
export enum ReserveationFunctions {
    getBroadcastStatus = 'getBroadcastStatus',
    add = 'add',
    update = 'update',
    updateRule = 'updateRule',
    updateAll = 'updateAll',
    cancel = 'cancel',
    removeSkip = 'removeSkip',
    removeOverlap = 'removeOverlap',
    edit = 'edit',
    clean = 'clean',
}

/**
 * recorded の関数定義
 */
export enum RecordedFunctions {
    delete = 'delete',
    updateVideoFileSize = 'updateVideoFileSize',
    addVideoFile = 'addVideoFile',
    addUploadedVideoFile = 'addUploadedVideoFile',
    createNewRecorded = 'createNewRecorded',
    deleteVideoFile = 'deleteVideoFile',
    changeProtect = 'changeProtect',
    videoFileCleanup = 'videoFileCleanup',
    dropLogFileCleanup = 'dropLogFileCleanup',
}

/**
 * recordedTag の関数定義
 */
export enum RecordedTagFunctions {
    create = 'create',
    update = 'update',
    setRelation = 'setRelation',
    delete = 'delete',
    deleteRelation = 'deleteRelation',
}

/**
 * Recording の関数定義
 */
export enum RecordingFunctions {
    resetTimer = 'resetTimer',
}

/**
 * Rule の関数定義
 */
export enum RuleFuntions {
    add = 'add',
    update = 'update',
    enable = 'enable',
    disable = 'disable',
    delete = 'delete',
}

/**
 * Thumbnail の関数定義
 */
export enum ThumbnailFunctions {
    regenerate = 'regenerate',
    fileCleanup = 'fileCleanup',
    add = 'add',
    delete = 'delete',
}

/**
 * encode event の関数定義
 */
export enum OperatorEncodeEventFunctions {
    emitFinishEncode = 'emitFinishEncode',
}

/**
 * encode queue（エンコードの依頼の記録）の関数定義
 */
export enum EncodeQueueFunctions {
    add = 'add',
    abandon = 'abandon',
    updateOutputPath = 'updateOutputPath',
    remove = 'remove',
    list = 'list',
}
