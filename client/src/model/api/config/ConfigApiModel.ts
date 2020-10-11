import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IConfigApiModel from './IConfigApiModel';

@injectable()
export default class ConfigApiModel implements IConfigApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async getConfig(): Promise<apid.Config> {
        const result = await this.repository.get('/config');

        return result.data;
    }
}
