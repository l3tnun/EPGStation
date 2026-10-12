import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import IChannelDB from '../../db/IChannelDB.js';
import { TunerServerAccess } from '../../tuner/types.js';
import IChannelApiModel, { IChannelApiModelError } from './IChannelApiModel.js';

/** `IChannelApiModel` の実装。詳細は `IChannelApiModel` を参照。 */
@injectable()
class ChannelApiModel implements IChannelApiModel {
    private channelDB: IChannelDB;
    private tunerServerAccess: TunerServerAccess;

    constructor(
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
    ) {
        this.channelDB = channelDB;
        this.tunerServerAccess = tunerServerAccess;
    }

    /**
     * チャンネル情報取得
     * @return Promise<ChannelItem[]>
     */
    public async getChannels(): Promise<apid.ChannelItem[]> {
        const channels = await this.channelDB.findAll(true);

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
                type: c.type,
            };

            if (c.remoteControlKeyId !== null) {
                result.remoteControlKeyId = c.remoteControlKeyId;
            }

            return result;
        });
    }

    /**
     * logo 取得
     * @param channelId: apid.ChannelId
     * @return Promise<Buffer>
     */
    public async getLogo(channelId: apid.ChannelId): Promise<Buffer> {
        const channel = await this.channelDB.findId(channelId);

        if (channel === null || channel.hasLogoData === false) {
            throw new Error(IChannelApiModelError.NOT_FOUND);
        }

        return this.tunerServerAccess.getLogo(channelId);
    }
}

export default ChannelApiModel;
