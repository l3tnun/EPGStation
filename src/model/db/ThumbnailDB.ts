import { inject, injectable } from 'inversify';
import type * as apid from '../../../api.js';
import Thumbnail from '../../db/entities/Thumbnail.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IPromiseRetry from '../IPromiseRetry.js';
import IDBOperator from './IDBOperator.js';
import IThumbnailDB from './IThumbnailDB.js';

/** `IThumbnailDB` の実装。詳細は `IThumbnailDB` を参照。 */
@injectable()
export default class ThumbnailDB implements IThumbnailDB {
    private log: ILogger;
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IDBOperator') op: IDBOperator,
        @inject('IPromiseRetry') promieRetry: IPromiseRetry,
    ) {
        this.log = logger.getLogger();
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

        let hasError = false;
        try {
            // start transaction
            await queryRunner.startTransaction();

            // 削除
            await queryRunner.manager.createQueryBuilder().delete().from(Thumbnail).execute();

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Thumbnail, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            this.log.system.error(err);
            hasError = true;
            if (queryRunner.isTransactionActive) {
                try {
                    await queryRunner.rollbackTransaction();
                } catch (cleanupError) {
                    this.log.system.error(cleanupError);
                }
            }
        } finally {
            try {
                await queryRunner.release();
            } catch (cleanupError) {
                this.log.system.error(cleanupError);
                hasError = true;
            }
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
