import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import Rule from '../../db/entities/Rule';
import StrUtil from '../../util/StrUtil';
import IPromiseRetry from '../IPromiseRetry';
import DBUtil from './DBUtil';
import IDBOperator from './IDBOperator';
import IRuleDB, { RuleWithCnt } from './IRuleDB';

@injectable()
export default class RuleDB implements IRuleDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: RuleWithCnt[]
     * @return Promise<void>
     */
    public async restore(items: RuleWithCnt[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.delete(Rule, {});

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Rule, this.convertRuleToDBRule(item));
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
     * ルールを1件挿入
     * @param rule apid.Rule | apid.AddRuleOption
     * @return inserted id
     */
    public async insertOnce(rule: apid.Rule | apid.AddRuleOption): Promise<apid.RuleId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Rule).values(this.convertRuleToDBRule(rule));

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * ルールをi件更新
     * @param rule: apidRule
     */
    public async updateOnce(newRule: apid.Rule): Promise<void> {
        // updateCnt 更新のために古いルールを取り出す
        const oldRule = <RuleWithCnt>await this.findId(newRule.id, true);
        if (oldRule === null) {
            throw new Error('RuleIsNull');
        }

        // updateCnt 更新
        const convertedRule = this.convertRuleToDBRule(newRule);
        convertedRule.updateCnt = oldRule.updateCnt + 1;

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Rule)
            .set(convertedRule)
            .where('id = :id', { id: newRule.id });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したルールを1件有効化
     * @param ruleId: apid.RuleId
     */
    public async enableOnce(ruleId: apid.RuleId): Promise<void> {
        const rule = <RuleWithCnt>await this.findId(ruleId, true);
        if (rule === null) {
            throw new Error('RuleIsNull');
        }

        // すでに有効か
        if (rule.reserveOption.enable === true) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Rule)
            .set({
                enable: true,
                updateCnt: rule.updateCnt + 1,
            })
            .where('id = :id', { id: ruleId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したルールを1件無効化
     * @param ruleId: apid.RuleId
     */
    public async disableOnce(ruleId: apid.RuleId): Promise<void> {
        const rule = <RuleWithCnt>await this.findId(ruleId, true);
        if (rule === null) {
            throw new Error('RuleIsNull');
        }

        // すでに無効か
        if (rule.reserveOption.enable === false) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Rule)
            .set({
                enable: false,
                updateCnt: rule.updateCnt + 1,
            })
            .where('id = :id', { id: ruleId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定したルールを1件削除
     * @param ruleId: apid.RuleId
     */
    public async deleteOnce(ruleId: apid.RuleId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(Rule).where('id = :id', { id: ruleId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して取得
     * @param ruleId rule id
     * @param updateCnt を削除するか
     * @return Promise<apidRule | RuleWithCnt | null>
     */
    public async findId(ruleId: apid.RuleId, isNeedCnt: boolean = false): Promise<apid.Rule | RuleWithCnt | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection.getRepository(Rule);

        const result = await this.promieRetry.run(() => {
            return queryBuilder.findOne({
                where: { id: ruleId },
            });
        });

        if (typeof result === 'undefined') {
            return null;
        } else if (isNeedCnt === true) {
            return this.convertDBRuleToRule(result);
        } else {
            const rule = this.convertDBRuleToRule(result);
            delete (rule as any).updateCnt;

            return rule;
        }
    }

    /**
     * RuleWithCnt から Rule へ変換する
     * @param rule: RuleWithCnt
     * @return Rule
     */
    private convertRuleToDBRule(rule: RuleWithCnt | apid.Rule | apid.AddRuleOption): Rule {
        const convertedRule: Rule = <any>{
            updateCnt: typeof rule === 'undefined' ? 0 : (<RuleWithCnt>rule).updateCnt,
            isTimeSpecification: rule.isTimeSpecification,
            keyword: typeof rule.searchOption.keyword === 'undefined' ? null : rule.searchOption.keyword,
            halfWidthKeyword:
                typeof rule.searchOption.keyword === 'undefined' ? null : StrUtil.toHalf(rule.searchOption.keyword),
            ignoreKeyword:
                typeof rule.searchOption.ignoreKeyword === 'undefined' ? null : rule.searchOption.ignoreKeyword,
            halfWidthIgnoreKeyword:
                typeof rule.searchOption.ignoreKeyword === 'undefined'
                    ? null
                    : StrUtil.toHalf(rule.searchOption.ignoreKeyword),
            keyCS: !!rule.searchOption.keyCS,
            keyRegExp: !!rule.searchOption.keyRegExp,
            name: !!rule.searchOption.name,
            description: !!rule.searchOption.description,
            extended: !!rule.searchOption.extended,
            ignoreKeyCS: !!rule.searchOption.ignoreKeyCS,
            ignoreKeyRegExp: !!rule.searchOption.ignoreKeyRegExp,
            ignoreName: !!rule.searchOption.ignoreName,
            ignoreDescription: !!rule.searchOption.ignoreDescription,
            ignoreExtended: !!rule.searchOption.ignoreExtended,
            GR: !!rule.searchOption.GR,
            BS: !!rule.searchOption.BS,
            CS: !!rule.searchOption.CS,
            SKY: !!rule.searchOption.SKY,
            channelIds:
                typeof rule.searchOption.channelIds === 'undefined'
                    ? null
                    : JSON.stringify(rule.searchOption.channelIds),
            genres: typeof rule.searchOption.genres === 'undefined' ? null : JSON.stringify(rule.searchOption.genres),
            times: typeof rule.searchOption.times === 'undefined' ? null : JSON.stringify(rule.searchOption.times),
            isFree: !!rule.searchOption.isFree,
            durationMin: typeof rule.searchOption.durationMin === 'undefined' ? null : rule.searchOption.durationMin,
            durationMax: typeof rule.searchOption.durationMax === 'undefined' ? null : rule.searchOption.durationMax,
            searchPeriods:
                typeof rule.searchOption.searchPeriods === 'undefined'
                    ? null
                    : JSON.stringify(rule.searchOption.searchPeriods),
            enable: rule.reserveOption.enable,
            avoidDuplicate: rule.reserveOption.avoidDuplicate,
            periodToAvoidDuplicate:
                typeof rule.reserveOption.periodToAvoidDuplicate === 'undefined'
                    ? null
                    : rule.reserveOption.periodToAvoidDuplicate,
            allowEndLack: rule.reserveOption.allowEndLack,
            tags: typeof rule.reserveOption.tags === 'undefined' ? null : JSON.stringify(rule.reserveOption.tags),
            parentDirectoryName: null,
            directory: null,
            recordedFormat: null,
            mode1: null,
            parentDirectoryName1: null,
            directory1: null,
            mode2: null,
            parentDirectoryName2: null,
            directory2: null,
            mode3: null,
            parentDirectoryName3: null,
            directory3: null,
            isDeleteOriginalAfterEncode: false,
        };

        if (typeof (<apid.Rule>rule).id !== 'undefined') {
            convertedRule.id = (<apid.Rule>rule).id;
        }

        if (typeof rule.saveOption !== 'undefined') {
            convertedRule.parentDirectoryName =
                typeof rule.saveOption.parentDirectoryName === 'undefined' ? null : rule.saveOption.parentDirectoryName;
            convertedRule.directory =
                typeof rule.saveOption.directory === 'undefined' ? null : rule.saveOption.directory;
            convertedRule.recordedFormat =
                typeof rule.saveOption.recordedFormat === 'undefined' ? null : rule.saveOption.recordedFormat;
        }

        if (typeof rule.encodeOption !== 'undefined') {
            convertedRule.mode1 = typeof rule.encodeOption.mode1 === 'undefined' ? null : rule.encodeOption.mode1;
            convertedRule.parentDirectoryName1 =
                typeof rule.encodeOption.encodeParentDirectoryName1 === 'undefined'
                    ? null
                    : rule.encodeOption.encodeParentDirectoryName1;
            convertedRule.directory1 =
                typeof rule.encodeOption.directory1 === 'undefined' ? null : rule.encodeOption.directory1;
            convertedRule.mode2 = typeof rule.encodeOption.mode2 === 'undefined' ? null : rule.encodeOption.mode2;
            convertedRule.parentDirectoryName2 =
                typeof rule.encodeOption.encodeParentDirectoryName2 === 'undefined'
                    ? null
                    : rule.encodeOption.encodeParentDirectoryName2;
            convertedRule.directory2 =
                typeof rule.encodeOption.directory2 === 'undefined' ? null : rule.encodeOption.directory2;
            convertedRule.mode3 = typeof rule.encodeOption.mode3 === 'undefined' ? null : rule.encodeOption.mode3;
            convertedRule.parentDirectoryName3 =
                typeof rule.encodeOption.encodeParentDirectoryName3 === 'undefined'
                    ? null
                    : rule.encodeOption.encodeParentDirectoryName3;
            convertedRule.directory3 =
                typeof rule.encodeOption.directory3 === 'undefined' ? null : rule.encodeOption.directory3;
            convertedRule.isDeleteOriginalAfterEncode = rule.encodeOption.isDeleteOriginalAfterEncode;
        }

        return convertedRule;
    }

    /**
     * Rule から RuleWithCnt へ変換する
     * @param rule: Rule
     * @return RuleWithCnt
     */
    private convertDBRuleToRule(rule: Rule): RuleWithCnt {
        const convertedRule: RuleWithCnt = {
            id: rule.id,
            updateCnt: rule.updateCnt,
            isTimeSpecification: rule.isTimeSpecification,
            searchOption: {
                keyCS: rule.keyCS,
                keyRegExp: rule.keyRegExp,
                name: rule.name,
                description: rule.description,
                extended: rule.extended,
                ignoreKeyCS: rule.ignoreKeyCS,
                ignoreKeyRegExp: rule.ignoreKeyRegExp,
                ignoreName: rule.ignoreName,
                ignoreDescription: rule.ignoreDescription,
                ignoreExtended: rule.ignoreExtended,
                GR: rule.GR,
                BS: rule.BS,
                CS: rule.CS,
                SKY: rule.SKY,
                isFree: rule.isFree,
            },
            reserveOption: {
                enable: rule.enable,
                allowEndLack: rule.allowEndLack,
                avoidDuplicate: rule.avoidDuplicate,
            },
        };

        /**
         * 検索オプションセット
         */
        if (rule.keyword !== null) {
            convertedRule.searchOption.keyword = rule.keyword;
        }
        if (rule.ignoreKeyword !== null) {
            convertedRule.searchOption.ignoreKeyword = rule.ignoreKeyword;
        }
        if (rule.channelIds !== null) {
            convertedRule.searchOption.channelIds = JSON.parse(rule.channelIds);
        }
        if (rule.genres !== null) {
            convertedRule.searchOption.genres = JSON.parse(rule.genres);
        }
        if (rule.times !== null) {
            convertedRule.searchOption.times = JSON.parse(rule.times);
        }
        if (rule.durationMin !== null) {
            convertedRule.searchOption.durationMin = rule.durationMin;
        }
        if (rule.durationMax !== null) {
            convertedRule.searchOption.durationMax = rule.durationMax;
        }
        if (rule.searchPeriods !== null) {
            convertedRule.searchOption.searchPeriods = JSON.parse(rule.searchPeriods);
        }

        /**
         * 予約オプションセット
         */
        if (rule.periodToAvoidDuplicate !== null) {
            convertedRule.reserveOption.periodToAvoidDuplicate = rule.periodToAvoidDuplicate;
        }
        if (rule.tags !== null) {
            convertedRule.reserveOption.tags = JSON.parse(rule.tags);
        }

        /**
         * 保存オプション
         */
        const saveOption: apid.ReserveSaveOption = {};
        if (rule.parentDirectoryName !== null) {
            saveOption.parentDirectoryName = rule.parentDirectoryName;
        }

        if (rule.directory !== null) {
            saveOption.directory = rule.directory;
        }
        if (rule.recordedFormat !== null) {
            saveOption.recordedFormat = rule.recordedFormat;
        }
        if (Object.keys(saveOption).length > 0) {
            convertedRule.saveOption = saveOption;
        }

        /**
         * エンコードオプション
         */
        const encodeOption: apid.ReserveEncodedOption = <any>{};
        if (rule.mode1 !== null) {
            encodeOption.mode1 = rule.mode1;
        }
        if (rule.parentDirectoryName1 !== null) {
            encodeOption.encodeParentDirectoryName1 = rule.parentDirectoryName1;
        }
        if (rule.directory1 !== null) {
            encodeOption.directory1 = rule.directory1;
        }
        if (rule.mode2 !== null) {
            encodeOption.mode2 = rule.mode2;
        }
        if (rule.parentDirectoryName2 !== null) {
            encodeOption.encodeParentDirectoryName2 = rule.parentDirectoryName2;
        }
        if (rule.directory2 !== null) {
            encodeOption.directory2 = rule.directory2;
        }
        if (rule.mode3 !== null) {
            encodeOption.mode3 = rule.mode3;
        }
        if (rule.parentDirectoryName3 !== null) {
            encodeOption.encodeParentDirectoryName3 = rule.parentDirectoryName3;
        }
        if (rule.directory3 !== null) {
            encodeOption.directory3 = rule.directory3;
        }
        if (Object.keys(encodeOption).length > 0) {
            encodeOption.isDeleteOriginalAfterEncode = rule.isDeleteOriginalAfterEncode;
            convertedRule.encodeOption = encodeOption;
        }

        return convertedRule;
    }

    /**
     * 全件取得
     * @param option: apid.GetRuleOption
     * @return Promise<[apid.Rule[], number]>
     */
    public async findAll(option: apid.GetRuleOption, isNeedCnt: boolean = false): Promise<[apid.Rule[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection.getRepository(Rule).createQueryBuilder('rule');

        // keyword
        if (typeof option.keyword !== 'undefined') {
            const names = StrUtil.toHalf(option.keyword).split(/ /);
            const like = this.op.getLikeStr(false);

            const keywordAnd: string[] = [];
            const values: any = {};
            names.forEach((str, i) => {
                str = `%${str}%`;

                // value
                const valueName = `keyword${i}`;
                values[valueName] = str;

                // keyword
                keywordAnd.push(`halfWidthKeyword ${like} :${valueName}`);
            });

            const or: string[] = [];
            if (keywordAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(keywordAnd)})`);
            }

            queryBuilder = queryBuilder.andWhere(DBUtil.createOrQuery(or), values);
        }

        // offset
        if (typeof option.offset !== 'undefined') {
            queryBuilder = queryBuilder.skip(option.offset);
        }

        // limit
        if (typeof option.limit !== 'undefined') {
            queryBuilder = queryBuilder.take(option.limit);
        }

        // order by
        queryBuilder = queryBuilder.orderBy('rule.id', 'ASC');

        const [rules, total] = await this.promieRetry.run(() => {
            return queryBuilder.getManyAndCount();
        });

        return [
            rules.map(rule => {
                const result = this.convertDBRuleToRule(rule);
                if (isNeedCnt === false) {
                    delete (result as any).updateCnt;
                }

                return result;
            }),
            total,
        ];
    }

    /**
     * キーワード検索
     * @param option: apid.GetRuleOption
     * @return Promise<apid.RuleKeywordItem[]>
     */
    public async findKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .createQueryBuilder()
            .select('rule.id, rule.keyword')
            .from(Rule, 'rule')
            .orderBy('rule.id', 'ASC');

        // keyword
        if (typeof option.keyword !== 'undefined') {
            const names = StrUtil.toHalf(option.keyword).split(/ /);
            const like = this.op.getLikeStr(false);

            const keywordAnd: string[] = [];
            const values: any = {};
            names.forEach((str, i) => {
                str = `%${str}%`;

                // value
                const valueName = `keyword${i}`;
                values[valueName] = str;

                // keyword
                keywordAnd.push(`halfWidthKeyword ${like} :${valueName}`);
            });

            const or: string[] = [];
            if (keywordAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(keywordAnd)})`);
            }

            queryBuilder = queryBuilder.andWhere(DBUtil.createOrQuery(or), values);
        }

        // offset
        if (typeof option.offset !== 'undefined') {
            queryBuilder = queryBuilder.skip(option.offset);
        }

        // limit
        if (typeof option.limit !== 'undefined') {
            queryBuilder = queryBuilder.take(option.limit);
        }

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });

        return result.map(r => {
            return {
                id: r.id,
                keyword: r.keyword === null ? '' : r.keyword,
            };
        });
    }

    /**
     * rule id を全て取得する
     * @return Promise<apid.RuleId[]>
     */
    public async getIds(): Promise<apid.RuleId[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .createQueryBuilder()
            .select('rule.id')
            .from(Rule, 'rule')
            .orderBy('rule.id', 'ASC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result.map(r => {
            return r.id;
        });
    }
}
