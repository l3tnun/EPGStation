import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IDropLogApiModel from './IDropLogApiModel';

@injectable()
export default class DropLogApiModel implements IDropLogApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ドロップログの取得
     * @param dropLogFileId: apid.DropLogFileId
     * @param maxsize: number 取得するファイルの最大サイズ(kByte) (default: 512)
     * @return Promise<string>
     */
    public async get(dropLogFileId: apid.DropLogFileId, maxsize: number = 512): Promise<string> {
        const result = await this.repository.getText(`/dropLogs/${dropLogFileId.toString(10)}`, {
            params: {
                maxsize: maxsize,
            },
        });

        return result.data;
    }
}
