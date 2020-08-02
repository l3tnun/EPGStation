import { inject, injectable } from 'inversify';
import { FindManyOptions } from 'typeorm';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import IDBOperator from './IDBOperator';
import IRecordedDB, { FindAllOption, RecordedColumnOption } from './IRecordedDB';

@injectable()
export default class RecordedDB implements IRecordedDB {
    private op: IDBOperator;

    constructor(@inject('IDBOperator') op: IDBOperator) {
        this.op = op;
    }

    /**
     * 録画番組情報を 1 件挿入
     * @param recorded: Recorded
     * @return inserted id
     */
    public async insertOnce(recorded: Recorded): Promise<apid.RecordedId> {
        const connection = await this.op.getConnection();
        const insertedResult = await connection.createQueryBuilder().insert().into(Recorded).values(recorded).execute();

        return insertedResult.identifiers[0].id;
    }

    /**
     * 録画番組情報の更新
     * @param recorded: Recorded
     * @return Promise<void>
     */
    public async updateOnce(recorded: Recorded): Promise<void> {
        const connection = await this.op.getConnection();
        await connection.createQueryBuilder().update(Recorded).set(recorded).where({ id: recorded.id }).execute();
    }

    /**
     * 指定した録画情報の isRecording を false に
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async removeRecording(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに有効か
        if (recorded.isRecording === false) {
            return;
        }

        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isRecording: false,
            })
            .where({ id: recordedId })
            .execute();
    }

    /**
     * 指定した録画番組情報を 1 件削除
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteOnce(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        await connection
            .createQueryBuilder()
            .delete()
            .from(Recorded)
            .where({
                id: recordedId,
            })
            .execute();
    }

    /**
     * id を指定して録画番組情報取得
     * @param recordedId: apid.RecordedId
     * @return Recorded
     */
    public async findId(recordedId: apid.RecordedId): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const result = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .getMany();

        return result.length === 0 ? null : result[0];
    }

    /**
     * 全件取得
     * @param option: FindAllOption
     * @param columnOption: RecordedColumnOption
     * @return Promise<[Recorded[], number]>
     */
    public async findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]> {
        const connection = await this.op.getConnection();

        return await connection.getRepository(Recorded).findAndCount(this.createFindOption(option, columnOption));
    }

    private createFindOption(option: FindAllOption, columnOption: RecordedColumnOption): FindManyOptions<Recorded> {
        const findOption: FindManyOptions<Recorded> = {};

        if (typeof option.offset !== 'undefined') {
            findOption.skip = option.offset;
        }

        if (typeof option.limit !== 'undefined') {
            findOption.take = option.limit;
        }

        if (!!option.isRecording === true) {
            findOption.where = {
                isRecording: true,
            };
        }

        findOption.order = {
            startAt: 'DESC',
        };

        if (
            columnOption.isNeedVideoFiles === true ||
            columnOption.isNeedThumbnails === true ||
            columnOption.isNeedTags === true
        ) {
            findOption.join = {
                alias: 'recorded',
                leftJoinAndSelect: {},
            };

            if (columnOption.isNeedVideoFiles === true) {
                findOption.join.leftJoinAndSelect!.videoFiles = 'recorded.videoFiles';
            }

            if (columnOption.isNeedThumbnails === true) {
                findOption.join.leftJoinAndSelect!.thumbnails = 'recorded.thumbnails';
            }

            if (columnOption.isNeedTags === true) {
                findOption.join.leftJoinAndSelect!.tags = 'recorded.tags';
            }
        }

        return findOption;
    }
}
