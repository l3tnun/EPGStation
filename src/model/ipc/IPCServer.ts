import { ChildProcess } from 'child_process';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import IRecordedManageModel, {
    AddVideoFileOption,
    UploadedVideoFileOption,
} from '../operator/recorded/IRecordedManageModel';
import IRecordedTagManadeModel from '../operator/recordedTag/IRecordedTagManadeModel';
import IRecordingManageModel from '../operator/recording/IRecordingManageModel';
import IReservationManageModel from '../operator/reservation/IReservationManageModel';
import IRuleManageModel from '../operator/rule/IRuleManageModel';
import IThumbnailManageModel from '../operator/thumbnail/IThumbnailManageModel';
import IIPCServer from './IIPCServer';
import {
    ModelName,
    NotifyClientMessage,
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

interface IFunctionIndex {
    [functionName: string]: (msg: SendMessage) => Promise<any>;
}

@injectable()
export default class IPCServer implements IIPCServer {
    private reservationManage: IReservationManageModel;
    private recordedManage: IRecordedManageModel;
    private recordedTagManage: IRecordedTagManadeModel;
    private recordingManage: IRecordingManageModel;
    private ruleManage: IRuleManageModel;
    private thumbnailManage: IThumbnailManageModel;
    private child: ChildProcess | null = null;
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
    ) {
        this.reservationManage = reservationManage;
        this.recordedManage = recordedManage;
        this.recordedTagManage = recordedTagManage;
        this.recordingManage = recordingManage;
        this.ruleManage = ruleManage;
        this.thumbnailManage = thumbnailManage;

        this.init();
    }

    public register(child: ChildProcess): void {
        this.child = child;

        this.child.on('message', async (msg: SendMessage) => {
            if (
                typeof this.functions[msg.model] !== 'undefined' &&
                typeof this.functions[msg.model][msg.func] !== 'undefined'
            ) {
                // 指定された関数が存在するなら実行
                try {
                    const result = await this.functions[msg.model][msg.func](msg);
                    this.replay({
                        id: msg.id,
                        result: result,
                    });
                } catch (err) {
                    this.replay({
                        id: msg.id,
                        error: err.message,
                    });
                }
            } else {
                this.replay({
                    id: msg.id,
                    error: 'IPCFunctionError',
                });
            }
        });
    }

    /**
     * 子プロセスに socket.io による状態更新通知を依頼する
     */
    public notifyClient(): void {
        if (this.child === null) {
            return;
        }

        this.child.send(<any>(<NotifyClientMessage>{
            type: 'notifyClient',
        }));
    }

    /**
     * クライアントへエンコードを依頼する
     * @param addOption: apid.AddEncodeProgramOption
     */
    public setEncode(addOption: apid.AddEncodeProgramOption): void {
        if (this.child === null) {
            throw new Error('ChildIsNull');
        }

        this.child.send(<any>(<PushEncodeMessage>{
            type: 'pushEncode',
            value: addOption,
        }));
    }

    /**
     * 応答メッセージ送信
     * @param msg: ReplayMessage
     */
    private replay(msg: ReplayMessage): void {
        if (this.child === null) {
            throw new Error('IPCSendReplayError');
        }

        this.child.send(msg);
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

            await this.recordedManage.delete(recordedId);
        };

        // updateVideoFileSize
        index[RecordedFunctions.updateVideoFileSize] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.recordedManage.updateVideoFileSize(videoFileId);
        };

        // addVideoFile
        index[RecordedFunctions.addVideoFile] = async msg => {
            const option = this.getArgsValue<AddVideoFileOption>(msg, 'option');

            await this.recordedManage.addVideoFile(option);
        };

        // addUploadedVideoFile
        index[RecordedFunctions.addUploadedVideoFile] = async msg => {
            const option = this.getArgsValue<UploadedVideoFileOption>(msg, 'option');

            await this.recordedManage.addUploadedVideoFile(option);
        };

        // createNewRecorded
        index[RecordedFunctions.createNewRecorded] = async msg => {
            const option = this.getArgsValue<apid.CreateNewRecordedOption>(msg, 'option');

            return await this.recordedManage.createNewRecorded(option);
        };

        // deleteVideoFile
        index[RecordedFunctions.deleteVideoFile] = async msg => {
            const videoFileId = this.getArgsValue<apid.VideoFileId>(msg, 'videoFileId');

            await this.recordedManage.deleteVideoFile(videoFileId);
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

        // deletes
        index[RuleFuntions.deletes] = async msg => {
            const ruleIds = this.getArgsValue<apid.RuleId[]>(msg, 'ruleIds');

            await this.ruleManage.deletes(ruleIds);
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
