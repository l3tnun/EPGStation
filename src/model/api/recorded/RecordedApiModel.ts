import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';
import IRecordedDB from '../../db/IRecordedDB';
import IIPCClient from '../../ipc/IIPCClient';
import IEncodeManageModel, { EncodeRecordedIdIndex } from '../../service/encode/IEncodeManageModel';
import IRecordedApiModel from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private encodeManage: IEncodeManageModel;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
    ) {
        this.recordedDB = recordedDB;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        // tslint:disable-next-line: typedef
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedTags: false,
        });

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return {
            records: records.map(r => {
                return this.toRecordedItem(r, option.isHalfWidth, encodeIndex);
            }),
            total,
        };
    }

    /**
     * Recorded を RecordedItem に変換する
     * @param recorded: Recorded
     * @param isHalfWidth isHalfWidth
     */
    private toRecordedItem(
        recorded: Recorded,
        isHalfWidth: boolean,
        encodeIndex: EncodeRecordedIdIndex,
    ): apid.RecordedItem {
        const item: apid.RecordedItem = {
            id: recorded.id,
            channelId: recorded.channelId,
            startAt: recorded.startAt,
            endAt: recorded.endAt,
            name: isHalfWidth === true ? recorded.halfWidthName : recorded.name,
            isRecording: recorded.isRecording,
            isEncoding: typeof encodeIndex[recorded.id] !== 'undefined',
        };

        if (recorded.ruleId !== null) {
            item.ruleId = recorded.ruleId;
        }

        if (recorded.programId !== null) {
            item.programId = recorded.programId;
        }

        if (recorded.description !== null) {
            item.description = isHalfWidth === true ? recorded.halfWidthDescription! : recorded.description;
        }

        if (recorded.extended !== null) {
            item.extended = isHalfWidth === true ? recorded.halfWidthExtended! : recorded.extended;
        }

        if (recorded.genre1 !== null) {
            item.genre1 = recorded.genre1;
        }

        if (recorded.subGenre1 !== null) {
            item.subGenre1 = recorded.subGenre1;
        }

        if (recorded.genre2 !== null) {
            item.genre2 = recorded.genre2;
        }

        if (recorded.subGenre2 !== null) {
            item.subGenre2 = recorded.subGenre2;
        }

        if (recorded.genre3 !== null) {
            item.genre3 = recorded.genre3;
        }

        if (recorded.subGenre3 !== null) {
            item.subGenre3 = recorded.subGenre3;
        }

        if (recorded.videoType !== null) {
            item.videoType = <any>recorded.videoType;
        }

        if (recorded.videoResolution !== null) {
            item.videoResolution = <any>recorded.videoResolution;
        }

        if (recorded.videoStreamContent !== null) {
            item.videoStreamContent = recorded.videoStreamContent;
        }

        if (recorded.videoComponentType !== null) {
            item.videoComponentType = recorded.videoComponentType;
        }

        if (recorded.audioSamplingRate !== null) {
            item.audioSamplingRate = <any>recorded.audioSamplingRate;
        }

        if (recorded.audioComponentType !== null) {
            item.audioComponentType = recorded.audioComponentType;
        }

        if (typeof recorded.thumbnails !== 'undefined') {
            item.thumbnails = recorded.thumbnails.map(t => {
                return t.id;
            });
        }

        if (typeof recorded.videoFiles !== 'undefined') {
            item.videoFiles = recorded.videoFiles.map(v => {
                return {
                    id: v.id,
                    name: v.name,
                    type: v.isTs === true ? 'ts' : 'encoded',
                    size: v.size,
                };
            });
        }

        if (typeof recorded.tags !== 'undefined') {
            item.tags = recorded.tags.map(t => {
                return {
                    id: t.id,
                    name: t.name,
                };
            });
        }

        return item;
    }

    /**
     * 指定した recorded id の録画情報を取得する
     * @param recordedId: apid.RecordedId
     * @param isHalfWidth: boolean 半角文字で返すか
     * @return Promise<apid.RecordedItem | null> null の場合録画情報が存在しない
     */
    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null> {
        const item = await this.recordedDB.findId(recordedId);

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return item === null ? null : this.toRecordedItem(item, isHalfWidth, encodeIndex);
    }

    /**
     *
     * @param recordedId: ReserveId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.encodeManage.cancelEncodeByRecordedId(recordedId);

        return this.ipc.recorded.delete(recordedId);
    }

    /**
     * recordedId を指定してエンコードを停止させる
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public stopEncode(recordedId: apid.RecordedId): Promise<void> {
        return this.encodeManage.cancelEncodeByRecordedId(recordedId);
    }
}
