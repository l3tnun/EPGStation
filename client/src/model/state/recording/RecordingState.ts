import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRecordingApiModel from '../../api/recording/IRecordingApiModel';
import IRecordedUtil, { RecordedDisplayData } from '../recorded/IRecordedUtil';
import IRecordingState from './IRecordingState';

@injectable()
export default class RecordingState implements IRecordingState {
    private recordingApiModel: IRecordingApiModel;
    private recordedUtil: IRecordedUtil;

    private recorded: RecordedDisplayData[] | null = null;
    private total: number = 0;

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
        this.total = 0;
    }

    /**
     * 録画情報を取得
     * @param option: apid.GetRecordedOption
     * @return Promise<void>
     */
    public async fetchData(option: apid.GetRecordedOption): Promise<void> {
        const recrods = await this.recordingApiModel.gets(option);
        this.total = recrods.total;
        this.recorded = recrods.records.map(r => {
            return this.recordedUtil.convertRecordedItemToDisplayData(r, option.isHalfWidth);
        });
    }

    /**
     * 取得した録画情報を返す
     * @return RecordedStateData[]
     */
    public getRecorded(): RecordedDisplayData[] {
        return this.recorded === null ? [] : this.recorded;
    }

    /**
     * 取得した録画の総件数を返す
     * @return number
     */
    public getTotal(): number {
        return this.total;
    }
}
