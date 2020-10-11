import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import DateUtil from '../../../../util/DateUtil';
import IRecordedApiModel from '../../../api/recorded/IRecordedApiModel';
import IChannelModel from '../../../channels/IChannelModel';
import { ISettingStorageModel } from '../../../storage/setting/ISettingStorageModel';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from './IWatchRecordedInfoState';

@injectable()
export default class WatchRecordedInfoState implements IWatchRecordedInfoState {
    private recordedApiModel: IRecordedApiModel;
    private channelModel: IChannelModel;
    private settingModel: ISettingStorageModel;
    private displayInfo: DsiplayWatchInfo | null = null;

    constructor(
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
    ) {
        this.recordedApiModel = recordedApiModel;
        this.channelModel = channelModel;
        this.settingModel = settingModel;
    }

    /**
     * 表示情報をクリア
     */
    public clear(): void {
        this.displayInfo = null;
    }

    /**
     * 表示情報を更新する
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async update(recordedId: apid.RecordedId): Promise<void> {
        const isHalfWidth = this.settingModel.getSavedValue().isHalfWidthDisplayed;

        const recordedInfo = await this.recordedApiModel.get(recordedId, isHalfWidth);
        const channel = this.channelModel.findChannel(recordedInfo.channelId, isHalfWidth);
        const startAt = DateUtil.getJaDate(new Date(recordedInfo.startAt));
        const endAt = DateUtil.getJaDate(new Date(recordedInfo.endAt));

        this.displayInfo = {
            channelName: channel === null ? recordedInfo.channelId.toString(10) : channel.name,
            time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
            name: recordedInfo.name,
            description: recordedInfo.description,
        };
    }

    /**
     * 表示情報を返す
     * @return DsiplayWatchInfo | null
     */
    public getInfo(): DsiplayWatchInfo | null {
        return this.displayInfo;
    }
}
