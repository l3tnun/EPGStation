import * as events from 'events';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import { AddVideoFileOption, UploadedVideoFileOption } from '../operator/recorded/IRecordedManageModel';
import IEncodeManageModel from '../service/encode/IEncodeManageModel';
import ISocketIOManageModel from '../service/socketio/ISocketIOManageModel';
import IIPCClient, {
    IPCRecordedManageModel,
    IPCRecordedTagManageModel,
    IPCRecordingManageModel,
    IPCReservationManageModel,
    IPCRuleManageModel,
    IPCThumbnailManageModel,
} from './IIPCClient';
import {
    ClientMessageOption,
    ModelName,
    ParentMessage,
    PushEncodeMessage,
    RecordedFunctions,
    RecordedTagFunctions,
    RecordingFunctions,
    ReplayMessage,
    ReserveationFunctions,
    RuleFuntions,
    SendMessage,
    ThumbnailFunctions,
} from './IPCMessageDefine';

@injectable()
export default class IPCClient implements IIPCClient {
    private socketIO: ISocketIOManageModel;
    private encodeManage: IEncodeManageModel;
    public reserveation!: IPCReservationManageModel;
    public recorded!: IPCRecordedManageModel;
    public recordedTag!: IPCRecordedTagManageModel;
    public recording!: IPCRecordingManageModel;
    public rule!: IPCRuleManageModel;
    public thumbnail!: IPCThumbnailManageModel;

    private log: ILogger;
    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
    ) {
        this.log = logger.getLogger();
        this.socketIO = socketIO;
        this.encodeManage = encodeManage;

        if (typeof process.send === 'undefined') {
            this.log.system.fatal('bit child process');
        }

        this.ipcInit();
        this.setReserveation();
        this.setRecorded();
        this.setRecordedTag();
        this.setRecording();
        this.setRule();
        this.setThumbnail();
    }

    /**
     * IPC 通信初期設定
     */
    private ipcInit(): void {
        process.on('message', async (msg: ReplayMessage | ParentMessage) => {
            if (typeof (<ReplayMessage>msg).id !== 'undefined') {
                // 送信したメッセージの応答
                this.listener.emit((<ReplayMessage>msg).id.toString(10), msg);
            } else if ((<ParentMessage>msg).type === 'notifyClient') {
                // socket.io によるクライアントへの状態更新通知
                this.socketIO.notifyClient();
            } else if ((<ParentMessage>msg).type === 'pushEncode') {
                // エンコード依頼
                this.encodeManage.push((<PushEncodeMessage>msg).value);
            }
        });
    }

    /**
     * IPC 送信
     * @param option: ClientMessageOption
     * @return MessageId
     */
    private send<T>(option: ClientMessageOption, timeout: number = 5000): Promise<T> {
        const msg: SendMessage = {
            id: new Date().getTime(),
            model: option.model,
            func: option.func,
            args: option.args,
        };

        process.nextTick(() => {
            if (typeof process.send === 'undefined') {
                this.log.system.error('process.send is undefined');

                return;
            }

            process.send(msg);
        });

        return new Promise<T>((resolve: (value: T) => void, reject: (err: Error) => void) => {
            this.listener.once(msg.id.toString(10), (replay: ReplayMessage) => {
                if (typeof replay.error === 'undefined') {
                    resolve(<T>replay.result);
                } else {
                    reject(new Error(replay.error));
                }
            });

            if (timeout > 0) {
                setTimeout(() => {
                    this.listener.removeAllListeners(msg.id.toString(10));
                    reject(new Error('IPCTimeout'));
                }, timeout);
            }
        });
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
                return this.send({
                    model: ModelName.recorded,
                    func: RecordedFunctions.addUploadedVideoFile,
                    args: {
                        option: option,
                    },
                });
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
                    0, // タイムアウトなし
                );
            },
            dropLogFileCleanup: () => {
                return this.send(
                    {
                        model: ModelName.recorded,
                        func: RecordedFunctions.dropLogFileCleanup,
                    },
                    0, // タイムアウトなし
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
            deletes: (ruleIds: apid.RuleId[]) => {
                return this.send({
                    model: ModelName.rule,
                    func: RuleFuntions.deletes,
                    args: {
                        ruleIds: ruleIds,
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
        };
    }
}
