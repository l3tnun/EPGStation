import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import Thumbnail from '../../db/entities/Thumbnail';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IThumbnailDB from './IThumbnailDB';

@injectable()
export default class ThumbnailDB implements IThumbnailDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: Thumbnail[]
     * @return Promise<void>
     */
    public async restore(items: Thumbnail[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(Thumbnail, {});

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Thumbnail, item);
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
     * サムネイル情報 1 件挿入
     * @param thumbnail: Thumbnail
     * @return inserted id
     */
    public async insertOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Thumbnail).values(thumbnail);

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 指定したサムネイル情報を 1 件削除
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async deleteOnce(thumbnailId: apid.ThumbnailId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(Thumbnail).where({
            id: thumbnailId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した reocrdeId のサムネイル情報を削除する
     * @param recordedId: apid.ReocrdedId
     * @return Promise<void>
     */
    public async deleteRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(Thumbnail).where({
            recordedId: recordedId,
        });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して取得すｒ
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<Thumbnail | null>
     */
    public async findId(thumbnailId: apid.ThumbnailId): Promise<Thumbnail | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(Thumbnail).createQueryBuilder().where({ id: thumbnailId });

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全てのサムネイル情報を取得
     * @return Promise<Thumbnail[]>
     */
    public async findAll(): Promise<Thumbnail[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(Thumbnail).createQueryBuilder();

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }
}
