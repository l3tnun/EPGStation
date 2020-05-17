import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import IDBOperator from './IDBOperator';
import IVideoFileDB from './IVideoFileDB';

@injectable()
export default class VideoFileDB implements IVideoFileDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * ビデオファイル情報を 1 件挿入
     * @param videoFile: VideoFile
     * @return inserted id
     */
    public async insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection
            .createQueryBuilder()
            .insert()
            .into(VideoFile)
            .values(videoFile)
            .execute();

        return insertedResult.identifiers[0].id;
    }

    /**
     * ファイルサイズ更新
     * @param videoFileId: video file id
     * @param size: file size
     * @return Promise<void>
     */
    public async updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void> {
        const videoFile = await this.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsNull');
        }

        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                size: size,
            })
            .where({ id: videoFileId })
            .execute();
    }

    /**
     * 指定したビデオファイル情報を 1 件削除
     * @param VideoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteOnce(VideoFileId: apid.VideoFileId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(VideoFile)
            .where({
                id: VideoFileId,
            })
            .execute();
    }

    /**
     * 指定した recordedId のビデオファイル情報を削除する
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(VideoFile)
            .where({
                recordedId: recordedId,
            })
            .execute();
    }

    /**
     * id を指定して取得する
     * @param videoFileId: video file id
     * @return Promise<VideoFile | null>
     */
    public async findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null> {
        const connection = await this.op.getConnection();

        const result = await connection
            .getRepository(VideoFile)
            .createQueryBuilder()
            .where({ id: videoFileId })
            .getOne();

        return typeof result === 'undefined' ? null : result;
    }
}
