import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IChannelDB from '../../db/IChannelDB';
import IChannelApiModel from './IChannelApiModel';

@injectable()
export default class ChannelApiModel implements IChannelApiModel {
    private channelDB: IChannelDB;

    constructor(@inject('IChannelDB') channelDB: IChannelDB) {
        this.channelDB = channelDB;
    }

    /**
     * チャンネル情報取得
     * @return Promise<ChannelItem[]>
     */
    public async getChannels(): Promise<apid.ChannelItem[]> {
        const channels = await this.channelDB.findAll();

        return channels.map(c => {
            const result: apid.ChannelItem = {
                id: c.id,
                serviceId: c.serviceId,
                networkId: c.networkId,
                name: c.name,
                halfWidthName: c.halfWidthName,
                hasLogoData: c.hasLogoData,
                channelType: <any>c.channelType,
                channel: c.channel,
            };

            if (c.remoteControlKeyId !== null) {
                result.remoteControlKeyId = c.remoteControlKeyId;
            }

            return result;
        });
    }
}
