import ApiModel from './ApiModel';
import { ServicesDBInterface } from '../DB/ServicesDB';
import * as DBSchema from '../DB/DBSchema';
import CreateMirakurunClient from '../../Util/CreateMirakurunClient';
import ApiUtil from './ApiUtil';
import * as apid from '../../../../node_modules/mirakurun/api';

interface ChannelsModelInterface extends ApiModel {
    getAll(): Promise<{}[]>;
    getLogo(channelId: apid.ServiceItemId): Promise<Buffer>;
}

namespace ChannelsModelInterface {
    export const NotFoundChannelIdError = 'NotFoundChannelId'
    export const NotFoundLogoError = 'NotFoundLogo'
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
        let datas = await this.servicesDB.findAll();

        let results: any[] = [];
        datas.forEach((result: DBSchema.ServiceSchema) => {
            results.push(ApiUtil.deleteNullinHash(result));
        });

        return ApiUtil.sortItems(results, this.config.getConfig().serviceOrder || []);
    }

    /**
    * logo を取得
    * @param channelId: channel id
    * @return Promise<Buffer>
    */
    public async getLogo(channelId: apid.ServiceItemId): Promise<Buffer> {
        let results = await this.servicesDB.findId(channelId);

        if(results === null) {
            throw new Error(ChannelsModelInterface.NotFoundChannelIdError);
        }

        if(!results.hasLogoData) {
            throw new Error(ChannelsModelInterface.NotFoundLogoError);
        }

        let mirakurun = CreateMirakurunClient.get();
        return mirakurun.getLogoImage(channelId);
    }
}

export { ChannelsModelInterface, ChannelsModel }

