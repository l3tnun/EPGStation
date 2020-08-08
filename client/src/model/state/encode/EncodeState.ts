import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import DateUtil from '../../../util/DateUtil';
import IEncodeApiModel from '../../api/encode/IEncodeApiModel';
import IChannelModel from '../../channels/IChannelModel';
import IEncodeState, { EncodeInfoDisplayData, EncodeInfoDisplayItem } from './IEncodeState';

@injectable()
export default class EncodeState implements IEncodeState {
    private encodeApiModel: IEncodeApiModel;
    private channelModel: IChannelModel;

    private encodeInfo: EncodeInfoDisplayData | null = null;

    constructor(
        @inject('IEncodeApiModel') encodeApiModel: IEncodeApiModel,
        @inject('IChannelModel') channelModel: IChannelModel,
    ) {
        this.encodeApiModel = encodeApiModel;
        this.channelModel = channelModel;
    }

    /**
     * 取得した録画情報をクリア
     */
    public clearData(): void {
        this.encodeInfo = null;
    }

    /**
     * エンコード情報を取得
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<void>
     */
    public async fetchData(isHalfWidth: boolean): Promise<void> {
        const info = await this.encodeApiModel.gets(isHalfWidth);

        this.encodeInfo = {
            runningItems: [],
            waitItems: [],
        };

        this.encodeInfo.runningItems = info.runningItems.map(i => {
            return this.convertEncodeProgramItemToDiplayData(i, isHalfWidth);
        });
        this.encodeInfo.waitItems = info.waitItems.map(i => {
            return this.convertEncodeProgramItemToDiplayData(i, isHalfWidth);
        });
    }

    /**
     * EncodeInfoDisplayItem を EncodeInfoDisplayItem へ変換する
     * @param item: apid.EncodeProgramItem
     * @param isHalfWidth: チャンネル情報を半角で取得するか
     * @return EncodeInfoDisplayItem
     */
    private convertEncodeProgramItemToDiplayData(
        item: apid.EncodeProgramItem,
        isHalfWidth: boolean,
    ): EncodeInfoDisplayItem {
        const startAt = DateUtil.getJaDate(new Date(item.recorded.startAt));
        const endAt = DateUtil.getJaDate(new Date(item.recorded.endAt));
        const channel = this.channelModel.findChannel(item.recorded.channelId, isHalfWidth);

        return {
            display: {
                channelName: channel === null ? item.recorded.channelId.toString(10) : channel.name,
                name: item.recorded.name,
                time: DateUtil.format(startAt, 'MM/dd(w) hh:mm ~ ') + DateUtil.format(endAt, 'hh:mm'),
                duration: Math.floor((item.recorded.endAt - item.recorded.startAt) / 1000 / 60),
                topThumbnailPath:
                    typeof item.recorded.thumbnails === 'undefined' || item.recorded.thumbnails.length === 0
                        ? './img/noimg.png'
                        : `./api/thumbnails/${item.recorded.thumbnails[0]}`,
                mode: item.mode,
            },
            encodeItem: item,
        };
    }

    /**
     * 取得したエンコード情報を返す
     * @return EncodeInfoDisplayData[]
     */
    public getEncodeInfo(): EncodeInfoDisplayData {
        return this.encodeInfo === null
            ? {
                  runningItems: [],
                  waitItems: [],
              }
            : this.encodeInfo;
    }
}
