import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IEncodeApiModel from './IEncodeApiModel';

@injectable()
export default class EncodeApiModel implements IEncodeApiModel {
    private encodeManage: IEncodeManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private recordedItemUtil: IRecordedItemUtil;

    constructor(
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
    ) {
        this.encodeManage = encodeManage;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.recordedItemUtil = recordedItemUtil;
    }

    /**
     * エンコード情報を返す
     * @param isHalfWidth: boolean 番組情報を半角にして返すか ture で半角にする
     * @return Promise<apid.EncodeInfo>
     */
    public async getAll(isHalfWidth: boolean): Promise<apid.EncodeInfo> {
        const info = this.encodeManage.getEncodeInfo();
        if (info.runningQueue.length === 0 && info.waitQueue.length === 0) {
            return {
                runningItems: [],
                waitItems: [],
            };
        }

        // recordedId 取り出し
        let recordedIds: apid.RecordedId[] = [];
        for (const i of info.runningQueue) {
            recordedIds.push(i.recordedId);
        }
        for (const i of info.waitQueue) {
            recordedIds.push(i.recordedId);
        }
        // 重複削除
        recordedIds = Array.from(new Set(recordedIds));

        // 番組情報取得
        const recordedItems = await this.recordedDB.findIds(recordedIds);
        const recordedIndex: { [key: number]: Recorded } = {};
        for (const i of recordedItems) {
            recordedIndex[i.id] = i;
        }

        // 結果格納
        const result: apid.EncodeInfo = {
            runningItems: [],
            waitItems: [],
        };

        // エンコード中
        for (const i of info.runningQueue) {
            const recordedItem = recordedIndex[i.recordedId];
            if (typeof recordedItem === 'undefined') {
                continue;
            }

            const info: apid.EncodeProgramItem = {
                id: i.id,
                mode: i.mode,
                recorded: this.recordedItemUtil.convertRecordedToRecordedItem(recordedItem, isHalfWidth, {}),
            };
            if (typeof i.percent !== 'undefined' && typeof i.log !== 'undefined') {
                info.percent = i.percent;
                info.log = i.log;
            }
            result.runningItems.push(info);
        }

        // エンコード待ち
        for (const i of info.waitQueue) {
            const recordedItem = recordedIndex[i.recordedId];
            if (typeof recordedItem === 'undefined') {
                continue;
            }

            result.waitItems.push({
                id: i.id,
                mode: i.mode,
                recorded: this.recordedItemUtil.convertRecordedToRecordedItem(recordedItem, isHalfWidth, {}),
            });
        }

        return result;
    }

    /**
     * エンコード手動追加
     * @param addOption: apid.AddManualEncodeProgramOption
     * @return Promise<apid.EncodeId>
     */
    public async add(addOption: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId> {
        if (typeof addOption.parentDir === 'undefined' && !!addOption.isSaveSameDirectory === false) {
            throw new Error('OptionError');
        }

        let option: apid.AddEncodeProgramOption;
        if (typeof addOption.parentDir !== 'undefined') {
            option = {
                recordedId: addOption.recordedId,
                sourceVideoFileId: addOption.sourceVideoFileId,
                parentDir: addOption.parentDir,
                directory: addOption.directory,
                mode: addOption.mode,
                removeOriginal: addOption.removeOriginal,
            };
        } else {
            const video = await this.videoFileDB.findId(addOption.sourceVideoFileId);
            if (video === null) {
                throw new Error('VideoFileIsNotFound');
            }

            let directory: string | null = path.dirname(video.filePath);
            if (directory === '.' || directory === path.posix.sep || directory === path.win32.sep) {
                directory = null;
            }

            option = {
                recordedId: addOption.recordedId,
                sourceVideoFileId: addOption.sourceVideoFileId,
                parentDir: video.parentDirectoryName,
                mode: addOption.mode,
                removeOriginal: addOption.removeOriginal,
            };

            if (directory !== null) {
                option.directory = directory;
            }
        }

        return await this.encodeManage.push(option);
    }

    /**
     * 指定した id のエンコードをキャンセルする
     * @param encodeId: apid.EncodeId
     * @return Promise<void>
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        await this.encodeManage.cancel(encodeId);
    }
}
