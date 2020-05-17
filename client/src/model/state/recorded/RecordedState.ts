import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel';
import IRecordedState from './IRecordedState';
import IRecordedUtil, { RecordedDisplayData } from './IRecordedUtil';

@injectable()
export default class RecordedState implements IRecordedState {
    private recordedApiModel: IRecordedApiModel;
    private recordedUtil: IRecordedUtil;

    private recorded: apid.Records | null = null;
    private isHalfWidth: boolean = false;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IRecordedUtil') recordedUtil: IRecordedUtil,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.recordedUtil = recordedUtil;
    }

    /**
     * 取得した録画情報をクリア
     */
    public clearData(): void {
        this.recorded = null;
    }

    /**
     * 録画情報を取得
     * @param option: apid.GetRecordedOption
     * @return Promise<void>
     */
    public async fetchData(option: apid.GetRecordedOption): Promise<void> {
        this.isHalfWidth = option.isHalfWidth;
        this.recorded = await this.recordedApiModel.gets(option);
    }

    /**
     * 取得した録画情報を返す
     * @return RecordedStateData[]
     */
    public getRecorded(): RecordedDisplayData[] {
        return this.recorded === null
            ? []
            : this.recorded.records.map(r => {
                  return this.recordedUtil.convertRecordedItemToDisplayData(r, this.isHalfWidth);
              });
    }

    /**
     * 取得した録画の総件数を返す
     * @return number
     */
    public getTotal(): number {
        return this.recorded === null ? 0 : this.recorded.total;
    }

    /**
     * エンコード停止
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        await this.recordedApiModel.stopEncode(recordedId);
    }
}
