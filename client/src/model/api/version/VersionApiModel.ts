import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IVersionApiModel from './IVersionApiModel';

@injectable()
export default class VersionApiModel implements IVersionApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * バージョン情報の取得
     * @return Promise<apid.VersionInfo>
     */
    public async getInfo(): Promise<apid.VersionInfo> {
        const result = await this.repository.get('/version');

        return result.data;
    }
}
