import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IVideoApiModel from './IVideoApiModel';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * ビデオファイルの削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async delete(videoFileId: apid.VideoFileId): Promise<void> {
        await this.repository.delete(`/videos/${videoFileId}`);
    }
}
