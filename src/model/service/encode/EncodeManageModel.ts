import * as path from 'path';
import * as events from 'events';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as apid from '../../../../api';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel, { EncodeInfoItem, EncodeQueueInfo, EncodeRecordedIdIndex } from './IEncodeManageModel';
import { EncodeOption, EncoderModelProvider, IEncoderModel } from './IEncoderModel';

@injectable()
class EncodeManageModel implements IEncodeManageModel {
    private log: ILogger;
    private executeManagementModel: IExecutionManagementModel;
    private encoderModelProvider: EncoderModelProvider;
    private encodeEvent: IEncodeEvent;
    private concurrentEncodeNum: number;
    private waitQueue: IEncoderModel[] = [];
    private runningQueue: IEncoderModel[] = [];
    private idCnt: number = 1;

    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('EncoderModelProvider') encoderModelProvider: EncoderModelProvider,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
    ) {
        this.log = logger.getLogger();
        this.executeManagementModel = executeManagementModel;
        this.concurrentEncodeNum = configure.getConfig().concurrentEncodeNum;
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.checkQueue.bind(this));
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('CncurrentEncodeNumIsZero');
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);

        // encoder を生成する
        const encoder = await this.encoderModelProvider();
        const option = this.createEncodeOption(addOption);
        encoder.setOption(option);

        // queue に積む
        this.waitQueue.push(encoder);
        this.emitNeedsCheckQueue();

        this.log.encode.info(`add new encode: ${option.encodeId}`);

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitAddEncode(option.encodeId);

        return option.encodeId;
    }

    /**
     * エンコードオプションを生成する
     * @param baseOption: apid.AddEncodeProgramOption
     * @returns EncodeOption
     */
    private createEncodeOption(baseOption: apid.AddEncodeProgramOption): EncodeOption {
        // encoder のオプションを生成
        const encodeOption: EncodeOption = cloneDeep(baseOption) as any;
        const encodeId = this.idCnt;
        encodeOption.encodeId = encodeId;

        // idCnt をインクリメント
        if (this.idCnt === Number.MAX_SAFE_INTEGER) {
            this.idCnt = 0;
        }
        this.idCnt++;

        return encodeOption;
    }

    /**
     * queue の状態をチェックする必要がある場合に呼ぶ
     */
    private emitNeedsCheckQueue(): void {
        this.listener.emit(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT);
    }

    /**
     * queue をチェックする
     * @return Promise<void>
     */
    private async checkQueue(): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(
            EncodeManageModel.CREATE_ENCODING_PROCESS_PRIPORITY,
        );

        // runningQueue がロック中 or 同時エンコード最大数に達している or waitQueue が空の場合はスルー
        if (this.runningQueue.length >= this.concurrentEncodeNum || this.waitQueue.length === 0) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // waitQueue から取り出す
        const encoder = this.waitQueue.shift();
        if (typeof encoder === 'undefined') {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);

            return;
        }

        // encodeOption が無い場合は何もしない
        const encodeOption = encoder.getEncodeOption();
        if (encodeOption === null) {
            // 実行権開放
            this.executeManagementModel.unLockExecution(exeId);
            this.log.encode.warn('encodeOption is null'); // encoder 生成時にセットされているはずなので警告を出す

            return;
        }

        // runningQueue に積む
        this.runningQueue.push(encoder);

        // エンコード終了時の処理をセット
        encoder.setOnFinish((isError, outputFilePath) => {
            this.onFinish(isError, outputFilePath, encodeOption);
        });

        // エンコードプロセス開始
        let needsFinalize = false;
        try {
            await encoder.start();
        } catch (err: any) {
            this.log.encode.error(`create encode process error: ${encoder.getEncodeId()}`);
            this.log.encode.error(err);

            needsFinalize = true;

            // エラー通知
            this.encodeEvent.emitErrorEncode();
        }

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        if (needsFinalize === true) {
            this.finalize(encodeOption.encodeId);
        }
    }

    /**
     * エンコード終了処理
     * @param isError: 異常終了か
     * @param outputFilePath: エンコードファイルパス
     * @param encodeOption: エンコードオプション
     */
    private onFinish(isError: boolean, outputFilePath: string | null, encodeOption: EncodeOption): void {
        if (isError) {
            // エラー通知
            this.encodeEvent.emitErrorEncode();
        } else {
            // 終了通知 DB に登録を依頼
            const fileName = outputFilePath === null ? null : path.basename(outputFilePath);
            if (
                encodeOption.removeOriginal === true &&
                this.hasSamVideoFileIdItem(encodeOption.sourceVideoFileId, encodeOption.encodeId) === true
            ) {
                // queue に削除予定の videofile が存在するので、削除しないように false にする
                encodeOption.removeOriginal = false;
            }

            this.encodeEvent.emitFinishEncode({
                recordedId: encodeOption.recordedId,
                videoFileId: encodeOption.sourceVideoFileId,
                parentDirName: encodeOption.parentDir,
                filePath:
                    outputFilePath === null || fileName === null
                        ? null
                        : typeof encodeOption.directory === 'undefined'
                        ? fileName
                        : path.join(encodeOption.directory, fileName),
                fullOutputPath: outputFilePath,
                mode: encodeOption.mode,
                removeOriginal: encodeOption.removeOriginal,
            });
        }

        // 終了処理
        this.finalize(encodeOption.encodeId);
    }

    /**
     * videoFileId で指定した video file id を持つ queue item が存在するか調べる
     * @param videoFileId: apid.VideoFileId
     * @param excludeEncodeId: apid.EncodeId 除外する encode id
     * @return boolean 存在するなら true を返す
     */
    private hasSamVideoFileIdItem(videoFileId: apid.VideoFileId, excludeEncodeId: apid.EncodeId): boolean {
        const runningItem = this.runningQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof runningItem !== 'undefined') {
            return true;
        }

        const waitItem = this.waitQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof waitItem !== 'undefined') {
            return true;
        }

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);

        // runningQueue から encodeId の要素を削除する
        this.runningQueue = this.runningQueue.filter(q => {
            return q.getEncodeId() !== encodeId;
        });

        // 実行権開放
        this.executeManagementModel.unLockExecution(exeId);

        process.nextTick(() => {
            this.emitNeedsCheckQueue();
        });
    }

    /**
     * 指定された encode id を queue から削除する
     * @param encodeId: apid.EncodeId
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CANCEL_ENCODE_PRIPORITY);

        this.log.encode.info(`cancel encode: ${encodeId}`);

        // runningQueue にあるので プロセスを殺す
        const runningQueueItem = this.getRunnginQueueItem(encodeId);
        if (typeof runningQueueItem !== 'undefined') {
            await runningQueueItem.cancel();
        } else {
            // waitQueue から削除
            this.waitQueue = this.waitQueue.filter(q => {
                return q.getEncodeId() !== encodeId;
            });

            process.nextTick(() => {
                this.emitNeedsCheckQueue();
            });
        }

        this.executeManagementModel.unLockExecution(exeId);

        // イベント発行
        this.encodeEvent.emitCancelEncode(encodeId);
    }

    /**
     * 指定した encodeId を runningQueue から取り出す
     * @param encodeId: apid.EncodeId
     * @return IEncoderModel | undefined
     */
    private getRunnginQueueItem(encodeId: apid.EncodeId): IEncoderModel | undefined {
        return this.runningQueue.find(q => {
            return q.getEncodeId() === encodeId;
        });
    }

    /**
     * queu に積まれている要素の recorded id の索引を返す
     */
    public getRecordedIndex(): EncodeRecordedIdIndex {
        const index: EncodeRecordedIdIndex = {};

        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        return index;
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const encodeIds: apid.EncodeId[] = [];

        // recordedId に該当する encodedId を取り出す
        // wait queue
        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // running queue
        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // 取り出した encodedId を元にキャンセル指示を出す
        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.encode.error(`cancel encode failed: ${encodeId}`);
                this.log.encode.error(err);
            });
        }

        // キャンセルに失敗した場合はエラーを履く
        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public getEncodeInfo(): EncodeQueueInfo {
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
        };

        // running queue
        for (const i of this.runningQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            const result: EncodeInfoItem = {
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            };

            const progress = i.getProgressInfo();
            if (progress !== null) {
                result.percent = progress.percent;
                result.log = progress.log;
            }

            queueInfo.runningQueue.push(result);
        }

        // wait queue
        for (const i of this.waitQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            queueInfo.waitQueue.push({
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            });
        }

        return queueInfo;
    }
}

namespace EncodeManageModel {
    export const UNLOCK_EVENT = 'unlockEvent';
    export const UNLOCK_TIMEOUT = 1000 * 60;
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
}

export default EncodeManageModel;
