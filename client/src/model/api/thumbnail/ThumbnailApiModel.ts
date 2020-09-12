import { inject, injectable } from 'inversify';
import IRepositoryModel from '../IRepositoryModel';
import IThumbnailApiModel from './IThumbnailApiModel';

@injectable()
export default class ThumbnailApiModel implements IThumbnailApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * サムネイルのクリーンアップ
     * @return Promise<void>
     */
    public async cleanup(): Promise<void> {
        await this.repository.post('/thumbnails/cleanup');
    }
}
