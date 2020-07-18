import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import DateUtil from '../../../../util/DateUtil';
import IChannelModel from '../../..//channels/IChannelModel';
import IStreamApiModel from '../../../api/streams/IStreamApiModel';
import IWatchOnAirInfoState, { DsiplayWatchInfo } from './IWatchOnAirInfoState';

@injectable()
export default class WatchOnAirInfoState implements IWatchOnAirInfoState {
    private streamApiModel: IStreamApiModel;
    private channelModel: IChannelModel;
    private displayInfo: DsiplayWatchInfo | null = null;
    private endAt: number = new Date().getTime();

    constructor(
        @inject('IStreamApiModel') streamApiModel: IStreamApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
    ) {
        this.streamApiModel = streamApiModel;
        this.channelModel = channelModel;
    }

    /**
     * 表示情報をクリア
     */
    public clear(): void {
        this.displayInfo = null;
    }

    /**
     * 表示情報を更新する
     * @param channelId: apid.ChannelId
     * @param mode: number
     * @return Promise<void>
     */
    public async update(channelId: apid.ChannelId, mode: number): Promise<void> {
        const streamInfo = await this.streamApiModel.getStreamInfo();

        for (const item of streamInfo.items) {
            const channel = this.channelModel.findChannel(channelId, true); // TODO isHalf
            const startAt = DateUtil.getJaDate(new Date(item.startAt));
            const endAt = DateUtil.getJaDate(new Date(item.endAt));
            if (item.channelId === channelId && item.mode === mode) {
                this.displayInfo = {
                    channelName: channel === null ? channelId.toString(10) : channel.name,
                    time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                    name: item.name,
                    description: item.description,
                };
                this.endAt = item.endAt;
            }
        }
    }

    /**
     * 表示情報を返す
     * @return DsiplayWatchInfo | null
     */
    public getInfo(): DsiplayWatchInfo | null {
        return this.displayInfo;
    }

    /**
     * 次の更新までの待ち時間を返す (ms)
     * @return number
     */
    public getUpdateTime(): number {
        const diff = this.endAt - new Date().getTime();

        return diff <= 0 ? 1000 : diff;
    }
}
