import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IEncodeApiModel from './IEncodeApiModel';

@injectable()
export default class EncodeApiModel implements IEncodeApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async addEncode(option: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId> {
        const result = await this.repository.post('/encode', option);

        return (<any>result.data).encodeId;
    }
}
