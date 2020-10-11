import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import GenreUtil from '../../../util/GenreUtil';
import IChannelModel from '../../channels/IChannelModel';
import IReserveStateUtil, { ReserveStateData, SelectedIndex } from './IReserveStateUtil';

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
    public convertReserveItemsToStateDatas(reserves: apid.ReserveItem[], isHalfWidth: boolean, isSelectedIndex: SelectedIndex = {}): ReserveStateData[] {
        return reserves.map(r => {
            const startAt = DateUtil.getJaDate(new Date(r.startAt));
            const endAt = DateUtil.getJaDate(new Date(r.endAt));
            const channel = this.channelModel.findChannel(r.channelId, isHalfWidth);

            return {
                display: {
                    channelName: channel === null ? r.channelId.toString(10) : channel.name,
                    isRule: typeof r.ruleId !== 'undefined',
                    name: r.name,
                    day: DateUtil.format(startAt, 'MM/dd'),
                    dow: DateUtil.format(startAt, 'w'),
                    startTime: DateUtil.format(startAt, 'hh:mm'),
                    endTime: DateUtil.format(endAt, 'hh:mm'),
                    duration: Math.floor((r.endAt - r.startAt) / 1000 / 60),
                    genres: this.createGenres(r),
                    description: r.description,
                    extended: r.extended,
                },
                reserveItem: r,
                isSelected: typeof isSelectedIndex[r.id] === 'undefined' ? false : isSelectedIndex[r.id],
            };
        });
    }

    /**
     * ジャンル情報
     * @param reserve: apid.ReserveItem
     * @return string[]
     */
    private createGenres(reserve: apid.ReserveItem): string[] {
        const genres: string[] = [];

        if (typeof reserve.genre1 !== 'undefined') {
            const genre = GenreUtil.getGenres(reserve.genre1, reserve.subGenre1);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof reserve.genre2 !== 'undefined') {
            const genre = GenreUtil.getGenres(reserve.genre2, reserve.subGenre2);
            if (genre !== null) {
                genres.push(genre);
            }
        }
        if (typeof reserve.genre3 !== 'undefined') {
            const genre = GenreUtil.getGenres(reserve.genre3, reserve.subGenre3);
            if (genre !== null) {
                genres.push(genre);
            }
        }

        return genres;
    }
}
