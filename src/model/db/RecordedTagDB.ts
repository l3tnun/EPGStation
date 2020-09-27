import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import RecordedTag from '../../db/entities/RecordedTag';
import StrUtil from '../../util/StrUtil';
import IPromiseRetry from '../IPromiseRetry';
import DBUtil from './DBUtil';
import IDBOperator from './IDBOperator';
import IRecordedTagDB from './IRecordedTagDB';

@injectable()
export default class RecordedTagDB implements IRecordedTagDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: RecordedTag[]
     * @return Promise<void>
     */
    public async restore(items: RecordedTag[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(RecordedTag, {});

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(RecordedTag, item);
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
     * tag 情報を 1 件挿入
     * @param tag: RecordedTag
     * @return Promise<apid.RecordedTagId> inserted id
     */
    public async insertOnce(tag: RecordedTag): Promise<apid.RecordedTagId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(RecordedTag).values(tag);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * tag 更新
     * @param tagId: apid.RecordedTagId
     * @param name: string
     * @param color: string
     * @return Promise<void>
     */
    public async updateOnce(tagId: apid.RecordedTagId, name: string, color: string): Promise<void> {
        const tag = await this.findId(tagId);
        if (tag === null) {
            throw new Error('TagIsNull');
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(RecordedTag)
            .set({
                name: name,
                color: color,
                halfWidthName: StrUtil.toHalf(name),
            })
            .where({ id: tagId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * recorded と tag の関連付け設定
     * @param tagId: apid.RecordedTagId
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findRecorded(recordedId);

        // find tag
        const tag = await this.findId(tagId);
        if (tag === null) {
            throw new Error('RecordedTagIsUndefined');
        }

        recorded.tags.push(tag);
        await this.promieRetry.run(() => {
            return recorded.save();
        });
    }

    private async findRecorded(recordedId: apid.RecordedId): Promise<Recorded> {
        const connection = await this.op.getConnection();
        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.tags', 'recorded_tag');
        const recorded = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        if (typeof recorded === 'undefined') {
            throw new Error('RecordedIsUndefined');
        }

        return recorded;
    }

    /**
     * recorded と tag の関連付けを削除
     * @param tagid: RecordedTagId
     * @param recordedId: RecordedId
     * @Promise<void>
     */
    public async deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findRecorded(recordedId);

        recorded.tags = recorded.tags.filter(tag => {
            return tag.id !== tagId;
        });

        await this.promieRetry.run(() => {
            return recorded.save();
        });
    }

    /**
     * 指定された recordedId の すべての関連付けを削除する
     * @param recordedId: RecordedId
     * @return Promise<void>
     */
    public async deleteAllRelation(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findRecorded(recordedId);

        recorded.tags = [];

        await this.promieRetry.run(() => {
            return recorded.save();
        });
    }

    /**
     * tagId を指定して削除
     * @param tagId: RecordedTagId
     * @return Promise<void>
     */
    public async deleteOnce(tagId: apid.RecordedTagId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(RecordedTag).where({
            id: tagId,
        });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * tagId を指定して tag を取得する
     * @param tagId: apid.RecordedTagId
     * @return Promise<RecordedTag | null>
     */
    public async findId(tagId: apid.RecordedTagId): Promise<RecordedTag | null> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .getRepository(RecordedTag)
            .createQueryBuilder('recorded_tag')
            .where({ id: tagId });
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全県取得
     * @param option: GetRecordedTagOption
     * @return Promise<[RecordedTag[], number]>
     */
    public async findAll(option: apid.GetRecordedTagOption): Promise<[RecordedTag[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection.getRepository(RecordedTag).createQueryBuilder('recorded');
        const querys: { query: string; values: any }[] = [];

        // excludeTagId
        if (typeof option.excludeTagId !== 'undefined') {
            querys.push({
                query: 'id not in (:...id)',
                values: {
                    id: option.excludeTagId,
                },
            });
        }

        // name
        if (typeof option.name !== 'undefined') {
            const names = StrUtil.toHalf(option.name).split(/ /);
            const like = this.op.getLikeStr(false);

            const nameAnd: string[] = [];
            const values: any = {};
            names.forEach((str, i) => {
                str = `%${str}%`;

                // value
                const valueName = `name${i}`;
                values[valueName] = str;

                // name
                nameAnd.push(`halfWidthName ${like} :${valueName}`);
            });

            const or: string[] = [];
            if (nameAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(nameAnd)})`);
            }

            querys.push({
                query: DBUtil.createOrQuery(or),
                values: values,
            });
        }

        // where セット
        for (const q of querys) {
            queryBuilder = queryBuilder.andWhere(q.query, q.values);
        }

        // offset
        if (typeof option.offset !== 'undefined') {
            queryBuilder = queryBuilder.skip(option.offset);
        }

        // limit
        if (typeof option.limit !== 'undefined') {
            queryBuilder = queryBuilder.take(option.limit);
        }

        return await this.promieRetry.run(() => {
            return queryBuilder.getManyAndCount();
        });
    }
}
