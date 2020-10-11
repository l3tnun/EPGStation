import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IRecordedApiModel from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        const result = await this.repository.get('/recorded', {
            params: option,
        });

        return result.data;
    }

    /**
     * 指定した recorded id の録画情報を取得する
     * @param recordedId: apid.RecordedId
     * @param isHalfWidth: boolean 半角で取得するか
     * @return Promise<apid.RecordedItem>
     */
    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem> {
        const result = await this.repository.get(`/recorded/${recordedId.toString(10)}`, {
            params: {
                isHalfWidth: isHalfWidth,
            },
        });

        return result.data;
    }

    /**
     * recorded の検索オプションリストを取得する
     * @return Promise<apid.RecordedSearchOptionList>
     */
    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const result = await this.repository.get('/recorded/options');

        return result.data;
    }

    /**
     * 録画番組の削除
     * @param recordedId: RecordedId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.delete(`/recorded/${recordedId}`);
    }

    /**
     * エンコードの停止
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.delete(`/recorded/${recordedId}/encode`);
    }

    /**
     * 自動削除対象から除外
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async protect(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.put(`/recorded/${recordedId}/protect`);
    }

    /**
     * 自動削除対象に戻す
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async unprotect(recordedId: apid.RecordedId): Promise<void> {
        await this.repository.put(`/recorded/${recordedId}/unprotect`);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        const result = await this.repository.post('recorded', option);

        return result.data.recordedId;
    }

    /**
     * 録画のクリーンアップ
     * @return Promise<void>
     */
    public async cleanup(): Promise<void> {
        await this.repository.post('/recorded/cleanup');
    }
}
