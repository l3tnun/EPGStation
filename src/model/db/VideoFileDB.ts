import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IVideoFileDB, { UpdateFilePathOption } from './IVideoFileDB';

@injectable()
export default class VideoFileDB implements IVideoFileDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: VideoFile[]
     * @return Promise<void>
     */
    public async restore(items: VideoFile[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(VideoFile, {});

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(VideoFile, item);
            }
            await queryRunner.commitTransaction();
        } catch (err) {
            console.error(err);
            hasError = err;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('restore error');
        }
    }

    /**
     * ビデオファイル情報を 1 件挿入
     * @param videoFile: VideoFile
     * @return inserted id
     */
    public async insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(VideoFile).values(videoFile);

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * ファイルパス変更
     * @param option: UpdateFilePathOption
     * @return Promise<void>
     */
    public async updateFilePath(option: UpdateFilePathOption): Promise<void> {
        const videoFile = await this.findId(option.videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsNull');
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                parentDirectoryName: option.parentDirectoryName,
                filePath: option.filePath,
            })
            .where({ id: option.videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
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
        const queryBuilder = connection
            .createQueryBuilder()
            .update(VideoFile)
            .set({
                size: size,
            })
            .where({ id: videoFileId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したビデオファイル情報を 1 件削除
     * @param VideoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteOnce(VideoFileId: apid.VideoFileId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(VideoFile).where({
            id: VideoFileId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した recordedId のビデオファイル情報を削除する
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(VideoFile).where({
            recordedId: recordedId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して取得する
     * @param videoFileId: video file id
     * @return Promise<VideoFile | null>
     */
    public async findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFile).createQueryBuilder().where({ id: videoFileId });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全てのビデオファイルを取得する
     */
    public async findAll(): Promise<VideoFile[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(VideoFile).createQueryBuilder();

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }
}
