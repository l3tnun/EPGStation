import * as apid from '../../../../node_modules/mirakurun/api';
import CreateMirakurunClient from '../../Util/CreateMirakurunClient';
import { ServicesDBInterface } from '../DB/ServicesDB';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface ChannelsModelInterface extends ApiModel {
    getAll(): Promise<{}[]>;
    getLogo(channelId: apid.ServiceItemId): Promise<Buffer>;
}

namespace ChannelsModelInterface {
    export const NotFoundChannelIdError = 'NotFoundChannelId';
    export const NotFoundLogoError = 'NotFoundLogo';
}

class ChannelsModel extends ApiModel implements ChannelsModelInterface {
    private servicesDB: ServicesDBInterface;

    constructor(servicesDB: ServicesDBInterface) {
        super();
        this.servicesDB = servicesDB;
    }

    /**
     * channel をすべて取得
     * @return Promise<any>
     */
    public async getAll(): Promise<any> {
        const channels = await this.servicesDB.findAll(true);

        return channels.map((channel) => {
            return ApiUtil.deleteNullinHash(channel);
        });
    }

    /**
     * logo を取得
     * @param channelId: channel id
     * @return Promise<Buffer>
     */
    public async getLogo(channelId: apid.ServiceItemId): Promise<Buffer> {
        const results = await this.servicesDB.findId(channelId);

        if (results === null) {
            throw new Error(ChannelsModelInterface.NotFoundChannelIdError);
        }

        if (!results.hasLogoData) {
            throw new Error(ChannelsModelInterface.NotFoundLogoError);
        }

        const mirakurun = CreateMirakurunClient.get();

        return mirakurun.getLogoImage(channelId);
    }
}

export { ChannelsModelInterface, ChannelsModel };

