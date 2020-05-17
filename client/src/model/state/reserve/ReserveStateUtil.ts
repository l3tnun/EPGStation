import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IChannelModel from '../../channels/IChannelModel';
import IReserveStateUtil, { ReserveStateData } from './IReserveStateUtil';

@injectable()
export default class ReserveStateUtil implements IReserveStateUtil {
    private channelModel: IChannelModel;

    constructor(@inject('IChannelModel') channelModel: IChannelModel) {
        this.channelModel = channelModel;
    }

    /**
     * apid.ReserveItem[] を ReserveStateData[] に変換する
     * @param reserves: apid.ReserveItem[]
     * @param isHalfWidth: 半角データを返すか
     * @return ReserveStateData[]
     */
    public convertReserveItemsToStateDatas(reserves: apid.ReserveItem[], isHalfWidth: boolean): ReserveStateData[] {
        return reserves.map(r => {
            const startAt = DateUtil.getJaDate(new Date(r.startAt));
            const endAt = DateUtil.getJaDate(new Date(r.endAt));
            const channel = this.channelModel.findChannel(r.channelId, isHalfWidth);

            return {
                display: {
                    channelName: channel === null ? r.channelId.toString(10) : channel.name,
                    name: r.name,
                    day: DateUtil.format(startAt, 'MM/dd'),
                    dow: DateUtil.format(startAt, 'w'),
                    startTime: DateUtil.format(startAt, 'hh:mm'),
                    endTime: DateUtil.format(endAt, 'hh:mm'),
                    duration: Math.floor((r.endAt - r.startAt) / 1000 / 60),
                    description: r.description,
                    extended: r.extended,
                },
                reserveItem: r,
            };
        });
    }
}
