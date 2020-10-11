import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IStorageApiModel from './IStorageApiModel';

@injectable()
export default class StorageApiModel implements IStorageApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ストレージ情報の取得
     * @return Promise<apid.StorageInfo>
     */
    public async getInfo(): Promise<apid.StorageInfo> {
        const result = await this.repository.get('/storages');

        return result.data;
    }
}
