import { inject, injectable } from 'inversify';
import { FindManyOptions } from 'typeorm';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import RecordedTag from '../../db/entities/RecordedTag';
import StrUtil from '../../util/StrUtil';
import IDBOperator from './IDBOperator';
import IRecordedTagDB from './IRecordedTagDB';

@injectable()
export default class RecordedTagDB implements IRecordedTagDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * tag 情報を 1 件挿入
     * @param tag: RecordedTag
     * @return Promise<apid.RecordedTagId> inserted id
     */
    public async insertOnce(tag: RecordedTag): Promise<apid.RecordedTagId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection.createQueryBuilder().insert().into(RecordedTag).values(tag).execute();

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
        await connection
            .createQueryBuilder()
            .update(RecordedTag)
            .set({
                name: name,
                color: color,
                halfWidthName: StrUtil.toHalf(name),
            })
            .where({ id: tagId })
            .execute();
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
        await recorded.save();
    }

    private async findRecorded(recordedId: apid.RecordedId): Promise<Recorded> {
        const connection = await this.op.getConnection();
        const recorded = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.tags', 'recorded_tag')
            .getOne();

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

        await recorded.save();
    }

    /**
     * 指定された recordedId の すべての関連付けを削除する
     * @param recordedId: RecordedId
     * @return Promise<void>
     */
    public async deleteAllRelation(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findRecorded(recordedId);

        recorded.tags = [];

        await recorded.save();
    }

    /**
     * tagId を指定して削除
     * @param tagId: RecordedTagId
     * @return Promise<void>
     */
    public async deleteOnce(tagId: apid.RecordedTagId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(RecordedTag)
            .where({
                id: tagId,
            })
            .execute();
    }

    /**
     * tagId を指定して tag を取得する
     * @param tagId: apid.RecordedTagId
     * @return Promise<RecordedTag | null>
     */
    public async findId(tagId: apid.RecordedTagId): Promise<RecordedTag | null> {
        const connection = await this.op.getConnection();
        const result = await connection
            .getRepository(RecordedTag)
            .createQueryBuilder('recorded_tag')
            .where({ id: tagId })
            .getOne();

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全県取得
     * @param option: GetRecordedTagOption
     * @return Promise<[RecordedTag[], number]>
     */
    public async findAll(option: apid.GetRecordedTagOption): Promise<[RecordedTag[], number]> {
        const connection = await this.op.getConnection();

        return await connection.getRepository(RecordedTag).findAndCount(this.createFindOption(option));
    }

    private createFindOption(option: apid.GetRecordedTagOption): FindManyOptions<RecordedTag> {
        const findOption: FindManyOptions<RecordedTag> = {};

        if (typeof option.offset !== 'undefined') {
            findOption.skip = option.offset;
        }

        if (typeof option.limit !== 'undefined') {
            findOption.take = option.limit;
        }

        return findOption;
    }
}
