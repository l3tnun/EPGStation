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

    /**
     * エンコード情報取得
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<apid.EncodeInfo>
     */
    public async gets(isHalfWidth: boolean): Promise<apid.EncodeInfo> {
        const result = await this.repository.get('/encode', {
            params: {
                isHalfWidth: isHalfWidth,
            },
        });

        return result.data;
    }

    /**
     * エンコード追加
     * @param option: apid.AddManualEncodeProgramOption
     * @return Promise<apid.EncodeId>
     */
    public async addEncode(option: apid.AddManualEncodeProgramOption): Promise<apid.EncodeId> {
        const result = await this.repository.post('/encode', option);

        return result.data.encodeId;
    }

    /**
     * 指定した id のエンコードをキャンセル
     * @param encodeId: apid.EncodeId
     * @return Promise<void>
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        await this.repository.delete(`/encode/${encodeId.toString(10)}`);
    }
}
