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
}
