import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRecordingApiModel from '../../api/recording/IRecordingApiModel';
import IRecordedUtil, { RecordedDisplayData } from '../recorded/IRecordedUtil';
import IRecordingState from './IRecordingState';

@injectable()
export default class RecordingState implements IRecordingState {
    private recordingApiModel: IRecordingApiModel;
    private recordedUtil: IRecordedUtil;

    private recorded: apid.Records | null = null;
    private isHalfWidth: boolean = false;

    constructor(
        @inject('IRecordingApiModel') recordingApiModel: IRecordingApiModel,
        @inject('IRecordedUtil') recordedUtil: IRecordedUtil,
    ) {
        this.recordingApiModel = recordingApiModel;
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
        this.recorded = await this.recordingApiModel.gets(option);
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
}
