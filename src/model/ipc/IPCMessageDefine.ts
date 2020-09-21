import * as apid from '../../../api';

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

export interface PushEncodeMessage extends ParentMessage {
    type: 'pushEncode';
    value: apid.AddEncodeProgramOption;
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
    deletes = 'deletes',
}

/**
 * Thumbnail の関数定義
 */
export enum ThumbnailFunctions {
    regenerate = 'regenerate',
    fileCleanup = 'fileCleanup',
}
