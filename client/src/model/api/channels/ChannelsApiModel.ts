import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IChannelsApiModel from './IChannelsApiModel';

@injectable()
export default class ChannelsApiModel implements IChannelsApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async getChannels(): Promise<apid.ChannelItem[]> {
        const result = await this.repository.get('/channels');

        return result.data;
    }
}
