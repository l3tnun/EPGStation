import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordingApiModel from './IRecordingApiModel';

@injectable()
export default class RecordingApiModel implements IRecordingApiModel {
    private recordedDB: IRecordedDB;
    private recordedItemUtil: IRecordedItemUtil;

    constructor(
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
    ) {
        this.recordedDB = recordedDB;
        this.recordedItemUtil = recordedItemUtil;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = true;
        // tslint:disable-next-line: typedef
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedTags: false,
        });

        return {
            records: records.map(r => {
                return this.recordedItemUtil.convertRecordedToRecordedItem(r, option.isHalfWidth);
            }),
            total,
        };
    }
}
