import { inject, injectable } from 'inversify';
import { FindConditions, FindManyOptions, In, IsNull, LessThan, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import * as apid from '../../../api';
import Reserve from '../../db/entities/Reserve';
import { IReserveUpdateValues } from '../event/IReserveEvent';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IReserveDB, {
    IFindRuleOption,
    IFindTimeRangesOption,
    IFindTimeSpecificationOption,
    IGetManualIdsOption,
    RuleIdCountResult,
} from './IReserveDB';

@injectable()
export default class ReserveDB implements IReserveDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: Reserve[]
     * @return Promise<void>
     */
    public async restore(items: Reserve[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(Reserve, {});

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Reserve, item);
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
     * 1つだけ挿入
     * @param reserve: Reserve
     * @return inserted id
     */
    public async insertOnce(reserve: Reserve): Promise<apid.ReserveId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Reserve).values(reserve);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 1件更新
     * @param reserve: Reserve
     */
    public async updateOnce(reserve: Reserve): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Reserve)
            .set(reserve)
            .where('id = :id', { id: reserve.id });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * delete, insert, update をまとめて行う
     * @param values: IReserveUpdateValues
     */
    public async updateMany(values: IReserveUpdateValues): Promise<void> {
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // delete
            if (typeof values.delete !== 'undefined' && values.delete.length > 0) {
                const deleteIds = values.delete.map(d => {
                    return d.id;
                });
                await queryRunner.manager.delete(Reserve, deleteIds);
            }

            // insert
            if (typeof values.insert !== 'undefined' && values.insert.length > 0) {
                for (const newReserve of values.insert) {
                    const result = await queryRunner.manager.insert(Reserve, newReserve);

                    // set inserted id
                    newReserve.id = result.identifiers[0].id;
                }
            }

            // update
            if (typeof values.update !== 'undefined' && values.update.length > 0) {
                for (const u of values.update) {
                    await queryRunner.manager.update(Reserve, u.id, u);
                }
            }

            await queryRunner.commitTransaction();
        } catch (err) {
            console.error(err);
            hasError = true;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError === true) {
            throw new Error('ReserveUpdateManyError');
        }
    }

    /**
     * 指定した id の予約情報を取得する
     * @param reserveId: apid.ReserveId
     * @return Promise<Reserve | null>
     */
    public async findId(reserveId: apid.ReserveId): Promise<Reserve | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection.getRepository(Reserve);

        const result = await this.promieRetry.run(() => {
            return queryBuilder.findOne({
                where: { id: reserveId },
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 全件取得
     * @param option: GetReserveOption
     * @return Promise<Reserve[]>
     */
    public async findAll(option: apid.GetReserveOption): Promise<[Reserve[], number]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection.getRepository(Reserve);

        return await this.promieRetry.run(() => {
            return queryBuilder.findAndCount(this.createFindOption(option));
        });
    }

    private createFindOption(option: apid.GetReserveOption): FindManyOptions<Reserve> {
        const findConditions: FindConditions<Reserve> = {};
        this.setReserveTypeOption(option.type, findConditions);

        if (typeof option.ruleId !== 'undefined') {
            findConditions.ruleId = option.ruleId;
        }

        const findOption: FindManyOptions<Reserve> = {
            where: findConditions,
        };

        if (typeof option.offset !== 'undefined') {
            findOption.skip = option.offset;
        }

        if (typeof option.limit !== 'undefined') {
            findOption.take = option.limit;
        }

        findOption.order = {
            startAt: 'ASC',
        };

        return findOption;
    }

    private setReserveTypeOption(type: apid.GetReserveType | undefined, findConditions: FindConditions<Reserve>): void {
        if (type === 'normal') {
            findConditions.isConflict = false;
            findConditions.isSkip = false;
            findConditions.isOverlap = false;
        } else if (type === 'conflict') {
            findConditions.isConflict = true;
            findConditions.isSkip = false;
            findConditions.isOverlap = false;
        } else if (type === 'skip') {
            findConditions.isConflict = false;
            findConditions.isSkip = true;
            findConditions.isOverlap = false;
        } else if (type === 'overlap') {
            findConditions.isConflict = false;
            findConditions.isSkip = false;
            findConditions.isOverlap = true;
        }
    }

    /**
     * オプションで指定した時刻間の予約情報を取得する
     * @param option: GetReserveListsOption
     * @return Promise<Reserve[]>
     */
    public async findLists(option?: apid.GetReserveListsOption): Promise<Reserve[]> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(Reserve);

        return await this.promieRetry.run(() => {
            return typeof option === 'undefined'
                ? queryBuilder.find()
                : queryBuilder.find(this.createFindListOption(option));
        });
    }

    private createFindListOption(option: apid.GetReserveListsOption): FindManyOptions<Reserve> {
        const findConditions: FindConditions<Reserve> = {
            startAt: LessThanOrEqual((<apid.GetReserveListsOption>option).endAt),
            endAt: MoreThanOrEqual((<apid.GetReserveListsOption>option).startAt),
        };

        return { where: findConditions };
    }

    /**
     * program id を指定して検索
     * @param programId program id
     * @return Promise<Reserve[]>
     */
    public async findProgramId(programId: apid.ProgramId): Promise<Reserve[]> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(Reserve);

        return await this.promieRetry.run(() => {
            return queryBuilder.find({
                where: { programId: programId },
            });
        });
    }

    /**
     * 指定した時間帯の予約情報を取得する
     * @param option: IFindTimeRangesOption
     * @return Promise<Reserve[]>
     */
    public async findTimeRanges(option: IFindTimeRangesOption): Promise<Reserve[]> {
        // times が空か
        if (option.times.length === 0) {
            return [];
        }

        const connection = await this.op.getConnection();

        let queryBuilder = await connection.getRepository(Reserve).createQueryBuilder('reserve');

        // option.times の重複を削除
        option.times = option.times.filter((time, i) => {
            return option.times.indexOf(time) === i;
        });

        // times
        let timesQuery = '';
        const timesValues: any = {};
        option.times.forEach((time, i) => {
            const startAtName = `startAt${i}`;
            const endAtName = `endAt${i}`;
            const baseQuery = `(reserve.endAt >= :${startAtName} and reserve.startAt < :${endAtName})`;
            timesQuery += i === option.times.length - 1 ? baseQuery : `${baseQuery} or `;

            timesValues[startAtName] = time.startAt;
            timesValues[endAtName] = time.endAt;
        });
        queryBuilder = queryBuilder.where(`(${timesQuery})`, timesValues);

        // isSkip
        if (option.hasSkip === false) {
            queryBuilder = queryBuilder.andWhere('reserve.isSkip = :isSkip', {
                isSkip: false,
            });
        }

        // isConflict
        if (option.hasConflict === false) {
            queryBuilder = queryBuilder.andWhere('reserve.isConflict = :isConflict', {
                isConflict: false,
            });
        }

        // isOverlap
        if (option.hasOverlap === false) {
            queryBuilder = queryBuilder.andWhere('reserve.isOverlap = :isOverlap', {
                isOverlap: false,
            });
        }

        // 指定された ruleId の除外
        if (typeof option.excludeRuleId !== 'undefined') {
            queryBuilder = queryBuilder.andWhere('reserve.ruleId <> :ruleId', {
                ruleId: option.excludeRuleId,
            });
        }

        // 指定された予約 id の除外
        if (typeof option.excludeReserveId !== 'undefined') {
            queryBuilder = queryBuilder.andWhere('reserve.id <> :reserveId', {
                reserveId: option.excludeReserveId,
            });
        }

        queryBuilder = queryBuilder.orderBy('reserve.startAt', 'ASC');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }

    /**
     * 指定した ruleId の予約情報を取り出す
     * @param option IFindRuleOption
     */
    public async findRuleId(option: IFindRuleOption): Promise<Reserve[]> {
        const connection = await this.op.getConnection();

        const whereOption: FindConditions<Reserve>[] = [{ ruleId: option.ruleId }];
        if (option.hasSkip === false) {
            whereOption.push({ isSkip: false });
        }
        if (option.hasConflict === false) {
            whereOption.push({ isConflict: false });
        }
        if (option.hasOverlap === false) {
            whereOption.push({ isOverlap: false });
        }

        const queryBuilder = connection.getRepository(Reserve);

        return await this.promieRetry.run(() => {
            return queryBuilder.find({
                where: whereOption,
                order: {
                    startAt: 'ASC',
                },
            });
        });
    }

    /**
     * baseTime で指定した時間より古い予約を取得する
     * @param baseTime: apid.UnixtimeMS
     * @return Promise<Reserve[]>
     */
    public async findOldTime(baseTime: apid.UnixtimeMS): Promise<Reserve[]> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.getRepository(Reserve);

        return await this.promieRetry.run(() => {
            return queryBuilder.find({
                endAt: LessThan(baseTime),
            });
        });
    }

    /**
     * 時刻指定予約を検索する
     * @param option: IFindTimeSpecificationOption
     * @return Promise<Reserve | null>
     */
    public async findTimeSpecification(option: IFindTimeSpecificationOption): Promise<Reserve | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(Reserve);
        const result = await this.promieRetry.run(() => {
            return queryBuilder.findOne({
                where: {
                    channelId: option.channelId,
                    startAt: option.startAt,
                    endAt: option.endAt,
                    ruleId: IsNull(),
                },
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 手動予約の reserve id を取得する
     * @param option: IGetManualIdsOption
     */
    public async getManualIds(option: IGetManualIdsOption): Promise<apid.ReserveId[]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .createQueryBuilder()
            .select('reserve.id')
            .from(Reserve, 'reserve')
            .where('reserve.ruleId is null');

        if (option.hasTimeReserve === false) {
            queryBuilder = queryBuilder.andWhere('reserve.programId is not null');
        }

        queryBuilder = queryBuilder.orderBy('reserve.id', 'ASC');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result.map(r => {
            return r.id;
        });
    }

    /**
     * ruleId を指定して予約数をカウントする
     * @param ruleIds: apid.RuleId[]
     * @param type: apid.GetReserveType
     * @return Promise<RuleIdCountResult[]>
     */
    public async countRuleIds(ruleIds: apid.RuleId[], type: apid.GetReserveType): Promise<RuleIdCountResult[]> {
        const connection = await this.op.getConnection();

        const whereOption: FindConditions<Reserve> = {
            ruleId: In(ruleIds),
        };
        this.setReserveTypeOption(type, whereOption);

        const queryBuilder = connection
            .getRepository(Reserve)
            .createQueryBuilder('reserve')
            .select(['ruleId, count(ruleId) as ruleIdCnt'])
            .where(whereOption)
            .groupBy('ruleId');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }
}
