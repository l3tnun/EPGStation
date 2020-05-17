import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import Thumbnail from '../../db/entities/Thumbnail';
import IDBOperator from './IDBOperator';
import IThumbnailDB from './IThumbnailDB';

@injectable()
export default class ThumbnailDB implements IThumbnailDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * サムネイル情報 1 件挿入
     * @param thumbnail: Thumbnail
     * @return inserted id
     */
    public async insertOnce(thumbnail: Thumbnail): Promise<apid.ThumbnailId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection
            .createQueryBuilder()
            .insert()
            .into(Thumbnail)
            .values(thumbnail)
            .execute();

        return insertedResult.identifiers[0].id;
    }

    /**
     * 指定したサムネイル情報を 1 件削除
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async deleteOnce(thumbnailId: apid.ThumbnailId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(Thumbnail)
            .where({
                id: thumbnailId,
            })
            .execute();
    }

    /**
     * 指定した reocrdeId のサムネイル情報を削除する
     * @param recordedId: apid.ReocrdedId
     * @return Promise<void>
     */
    public async deleteRecordedId(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(Thumbnail)
            .where({
                recordedId: recordedId,
            })
            .execute();
    }

    /**
     * id を指定して取得すｒ
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<Thumbnail | null>
     */
    public async findId(thumbnailId: apid.ThumbnailId): Promise<Thumbnail | null> {
        const connection = await this.op.getConnection();

        const result = await connection
            .getRepository(Thumbnail)
            .createQueryBuilder()
            .where({ id: thumbnailId })
            .getOne();

        return typeof result === 'undefined' ? null : result;
    }
}
