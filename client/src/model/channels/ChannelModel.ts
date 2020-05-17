import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IChannelsApiModel from '../api/channels/IChannelsApiModel';
import IChannelModel, { Channel } from './IChannelModel';

@injectable()
export default class ChannelModel implements IChannelModel {
    private channelsApiModel: IChannelsApiModel;
    private channels: apid.ChannelItem[] = [];
    private channelsIndex: { [channelId: number]: apid.ChannelItem } = {};

    constructor(@inject('IChannelsApiModel') channelsApiModel: IChannelsApiModel) {
        this.channelsApiModel = channelsApiModel;
    }

    /**
     * 放送局情報取得
     * @return Promise<void>
     */
    public async fetchChannels(): Promise<void> {
        this.channels = await this.channelsApiModel.getChannels();

        // 索引作成
        this.channelsIndex = {};
        for (const c of this.channels) {
            this.channelsIndex[c.id] = c;
        }
    }

    /**
     * 放送局情報を返す
     * @param isHalfWidth: boolean 半角文字で取得するか
     */
    public getChannels(isHalfWidth: boolean): Channel[] {
        return this.channels.map(c => {
            return this.toChannel(c, isHalfWidth);
        });
    }

    /**
     * ChannelItem を Channel に変換する
     * @param item: ChannelItem
     * @param isHalfWidth: boolean 半角文字で取得するか
     * @return Channel
     */
    private toChannel(item: apid.ChannelItem, isHalfWidth: boolean): Channel {
        return {
            id: item.id,
            serviceId: item.serviceId,
            networkId: item.networkId,
            name: isHalfWidth === true ? item.halfWidthName : item.name,
            remoteControlKeyId: item.remoteControlKeyId,
            hasLogoData: item.hasLogoData,
            channelType: item.channelType,
            channel: item.channelType,
        };
    }

    /**
     * 指定された id の放送局情報を返す
     * @param id: ChannelId
     * @param isHalfWidth: boolean 半角文字で取得するか
     * @return Channel | null
     */
    public findChannel(id: apid.ChannelId, isHalfWidth: boolean): Channel | null {
        const item = this.channelsIndex[id];

        return typeof item === 'undefined' ? null : this.toChannel(item, isHalfWidth);
    }
}
