import StrUtil from '../../Util/StrUtil';
import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

interface RuleFindAllOption {
    limit?: number;
    offset?: number;
    query?: RuleFindQuery;
}

interface RuleFindQuery {
    keyword?: string;
}

interface RuleList {
    id: number;
    keyword: string | null;
}

interface RulesDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(rule: DBSchema.RulesSchema): Promise<number>;
    restore(rules: DBSchema.RulesSchema[], isDelete?: boolean): Promise<void>;
    update(id: number, rule: DBSchema.RulesSchema): Promise<void>;
    delete(id: number): Promise<void>;
    enable(id: number): Promise<void>;
    disable(id: number): Promise<void>;
    findId(id: number): Promise<DBSchema.RulesSchema | null>;
    findAllId(): Promise<{ id: number }[]>;
    findAllIdAndKeyword(): Promise<{ id: number; keyword: string }[]>;
    findAll(option?: RuleFindAllOption): Promise<DBSchema.RulesSchema[]>;
    getList(): Promise<RuleList[]>;
    getTotal(option?: RuleFindQuery): Promise<number>;
}

abstract class RulesDB extends DBTableBase implements RulesDBInterface {
    /**
     * get table name
     * @return string
     */
    protected getTableName(): string {
        return DBSchema.TableName.Rules;
    }

    /**
     * create table
     * @return Promise<void>
     */
    public abstract create(): Promise<void>;

    /**
     * drop table
     */
    public drop(): Promise<void> {
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.Rules }`);
    }

    /**
     * データ挿入
     * @param rule: DBSchema.RulesSchema
     * @return Promise<number> insertId
     */
    public insert(rule: DBSchema.RulesSchema): Promise<number> {
        const value: any[] = [];
        value.push(rule.keyword);
        value.push(rule.halfKeyword);
        value.push(rule.ignoreKeyword);
        value.push(rule.halfIgnoreKeyword);
        value.push(rule.keyCS);
        value.push(rule.keyRegExp);
        value.push(rule.title);
        value.push(rule.description);
        value.push(rule.extended);
        value.push(rule.ignoreKeyCS);
        value.push(rule.ignoreKeyRegExp);
        value.push(rule.ignoreTitle);
        value.push(rule.ignoreDescription);
        value.push(rule.ignoreExtended);
        value.push(rule.GR);
        value.push(rule.BS);
        value.push(rule.CS);
        value.push(rule.SKY);
        value.push(rule.station);
        value.push(rule.genrelv1);
        value.push(rule.genrelv2);
        value.push(rule.startTime);
        value.push(rule.timeRange);
        value.push(rule.week);
        value.push(rule.isFree);
        value.push(rule.durationMin);
        value.push(rule.durationMax);
        value.push(rule.avoidDuplicate);
        value.push(rule.periodToAvoidDuplicate);
        value.push(rule.enable);
        value.push(rule.allowEndLack);
        value.push(rule.directory);
        value.push(rule.recordedFormat);
        value.push(rule.mode1);
        value.push(rule.directory1);
        value.push(rule.mode2);
        value.push(rule.directory2);
        value.push(rule.mode3);
        value.push(rule.directory3);
        value.push(rule.delTs);

        const query = `insert into ${ DBSchema.TableName.Rules } (`
            + this.createInsertColumnStr(false)
        + ') VALUES ('
            + this.operator.createValueStr(1, value.length)
        + `) ${ this.operator.getReturningStr() }`;

        return this.operator.runInsert(query, value);
    }

    /**
     * insert 時のカラムを生成
     * @param hasId: boolean
     * @return string
     */
    private createInsertColumnStr(hasId: boolean): string {
        return (hasId ? 'id, ' : '')
            + 'keyword, '
            + 'halfKeyword, '
            + 'ignoreKeyword, '
            + 'halfIgnoreKeyword, '
            + 'keyCS, '
            + 'keyRegExp, '
            + 'title, '
            + 'description, '
            + 'extended, '
            + 'ignoreKeyCS, '
            + 'ignoreKeyRegExp, '
            + 'ignoreTitle, '
            + 'ignoreDescription, '
            + 'ignoreExtended, '
            + 'GR, '
            + 'BS, '
            + 'CS, '
            + 'SKY, '
            + 'station, '
            + 'genrelv1, '
            + 'genrelv2, '
            + 'startTime, '
            + 'timeRange, '
            + 'week, '
            + 'isFree, '
            + 'durationMin, '
            + 'durationMax, '
            + 'avoidDuplicate, '
            + 'periodToAvoidDuplicate, '
            + 'enable, '
            + 'allowEndLack, '
            + 'directory, '
            + 'recordedFormat, '
            + 'mode1, '
            + 'directory1, '
            + 'mode2, '
            + 'directory2, '
            + 'mode3, '
            + 'directory3, '
            + 'delTs ';
    }

    /**
     * restore
     * @param rules: DBSchema.RulesSchema[]
     * @param isDelete: boolean = true
     */
    public restore(rules: DBSchema.RulesSchema[], isDelete: boolean = true): Promise<void> {
        const values: any[] = [];
        for (const rule of rules) {
            const value: any[] = [];
            value.push(rule.id);
            value.push(rule.keyword);
            value.push(rule.halfKeyword);
            value.push(rule.ignoreKeyword);
            value.push(rule.halfIgnoreKeyword);
            value.push(rule.keyCS);
            value.push(rule.keyRegExp);
            value.push(rule.title);
            value.push(rule.description);
            value.push(rule.extended);
            value.push(rule.ignoreKeyCS);
            value.push(rule.ignoreKeyRegExp);
            value.push(rule.ignoreTitle);
            value.push(rule.ignoreDescription);
            value.push(rule.ignoreExtended);
            value.push(rule.GR);
            value.push(rule.BS);
            value.push(rule.CS);
            value.push(rule.SKY);
            value.push(rule.station);
            value.push(rule.genrelv1);
            value.push(rule.genrelv2);
            value.push(rule.startTime);
            value.push(rule.timeRange);
            value.push(rule.week);
            value.push(rule.isFree);
            value.push(rule.durationMin);
            value.push(rule.durationMax);
            value.push(rule.avoidDuplicate);
            value.push(rule.periodToAvoidDuplicate);
            value.push(rule.enable);
            value.push(rule.allowEndLack);
            value.push(rule.directory);
            value.push(rule.recordedFormat);
            value.push(rule.mode1);
            value.push(rule.directory1);
            value.push(rule.mode2);
            value.push(rule.directory2);
            value.push(rule.mode3);
            value.push(rule.directory3);
            value.push(rule.delTs);

            const query = `insert into ${ DBSchema.TableName.Rules } (`
                + this.createInsertColumnStr(true)
            + ') VALUES ('
                + this.operator.createValueStr(1, value.length)
            + ')';

            values.push({ query: query, values: value });
        }

        return this.operator.manyInsert(DBSchema.TableName.Rules, values, isDelete);
    }

    /**
     * データ更新
     * @param id: rule id
     * @param rule: DBSchema.RulesSchema
     * @return Promise<void>
     */
    public update(id: number, rule: DBSchema.RulesSchema): Promise<void> {
        const querys: string[] = [];
        const values: any[] = [];

        querys.push(`keyword = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
        values.push(rule.halfKeyword);
        querys.push(`halfKeyword = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
        values.push(rule.keyword === null ? null : StrUtil.toHalf(rule.keyword));
        querys.push(`ignoreKeyword = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
        values.push(rule.ignoreKeyword);
        querys.push(`halfIgnoreKeyword = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
        values.push(rule.ignoreKeyword === null ? null : StrUtil.toHalf(rule.ignoreKeyword));

        if (rule.keyCS !== null) { querys.push(`keyCS = ${ this.operator.convertBoolean(rule.keyCS) }`); }
        else { querys.push('keyCS = null'); }
        if (rule.keyRegExp !== null) { querys.push(`keyRegExp = ${ this.operator.convertBoolean(rule.keyRegExp) }`); }
        else { querys.push('keyRegExp = null'); }
        if (rule.title !== null) { querys.push(`title = ${ this.operator.convertBoolean(rule.title) }`); }
        else { querys.push('title = null'); }
        if (rule.description !== null) { querys.push(`description = ${ this.operator.convertBoolean(rule.description) }`); }
        else { querys.push('description = null'); }
        if (rule.extended !== null) { querys.push(`extended = ${ this.operator.convertBoolean(rule.extended) }`); }
        else { querys.push('extended = null'); }
        if (rule.ignoreKeyCS !== null) { querys.push(`ignoreKeyCS = ${ this.operator.convertBoolean(rule.ignoreKeyCS) }`); }
        else { querys.push('ignoreKeyCS = null'); }
        if (rule.ignoreKeyRegExp !== null) { querys.push(`ignoreKeyRegExp = ${ this.operator.convertBoolean(rule.ignoreKeyRegExp) }`); }
        else { querys.push('ignoreKeyRegExp = null'); }
        if (rule.ignoreTitle !== null) { querys.push(`ignoreTitle = ${ this.operator.convertBoolean(rule.ignoreTitle) }`); }
        else { querys.push('ignoreTitle = null'); }
        if (rule.ignoreDescription !== null) { querys.push(`ignoreDescription = ${ this.operator.convertBoolean(rule.ignoreDescription) }`); }
        else { querys.push('ignoreDescription = null'); }
        if (rule.ignoreExtended !== null) { querys.push(`ignoreExtended = ${ this.operator.convertBoolean(rule.ignoreExtended) }`); }
        else { querys.push('ignoreExtended = null'); }
        if (rule.GR !== null) { querys.push(`GR = ${ this.operator.convertBoolean(rule.GR) }`); }
        else { querys.push('GR = null'); }
        if (rule.BS !== null) { querys.push(`BS = ${ this.operator.convertBoolean(rule.BS) }`); }
        else { querys.push('BS = null'); }
        if (rule.CS !== null) { querys.push(`CS = ${ this.operator.convertBoolean(rule.CS) }`); }
        else { querys.push('CS = null'); }
        if (rule.SKY !== null) { querys.push(`SKY = ${ this.operator.convertBoolean(rule.SKY) }`); }
        else { querys.push('SKY = null'); }
        if (rule.station !== null) { querys.push(`station = ${ rule.station }`); }
        else { querys.push('station = null'); }
        if (rule.genrelv1 !== null) { querys.push(`genrelv1 = ${ rule.genrelv1 }`); }
        else { querys.push('genrelv1 = null'); }
        if (rule.genrelv2 !== null) { querys.push(`genrelv2 = ${ rule.genrelv2 }`); }
        else { querys.push('genrelv2 = null'); }
        if (rule.startTime !== null) { querys.push(`startTime = ${ rule.startTime }`); }
        else { querys.push('startTime = null'); }
        if (rule.timeRange !== null) { querys.push(`timeRange = ${ rule.timeRange }`); }
        else { querys.push('timeRange = null'); }
        querys.push(`week = ${ rule.week }`);
        if (rule.isFree !== null) { querys.push(`isFree = ${ this.operator.convertBoolean(rule.isFree) }`); }
        else { querys.push('isFree = null'); }
        if (rule.durationMin !== null) { querys.push(`durationMin = ${ rule.durationMin }`); }
        else { querys.push('durationMin = null'); }
        if (rule.durationMax !== null) { querys.push(`durationMax = ${ rule.durationMax }`); }
        else { querys.push('durationMax = null'); }
        querys.push(`avoidDuplicate = ${ this.operator.convertBoolean(rule.avoidDuplicate) }`);
        if (rule.periodToAvoidDuplicate !== null) { querys.push(`periodToAvoidDuplicate = ${ rule.periodToAvoidDuplicate }`); }
        else { querys.push('periodToAvoidDuplicate = null'); }
        querys.push(`enable = ${ this.operator.convertBoolean(rule.enable) }`);
        querys.push(`allowEndLack = ${ this.operator.convertBoolean(rule.allowEndLack) }`);

        if (rule.directory !== null) {
            querys.push(`directory = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
            values.push(rule.directory);
        } else {
            querys.push('directory = null');
        }
        if (rule.recordedFormat !== null) {
            querys.push(`recordedFormat = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
            values.push(rule.recordedFormat);
        } else {
            querys.push('recordedFormat = null');
        }

        if (rule.mode1 !== null) { querys.push(`mode1 = ${ rule.mode1 }`); }
        else { querys.push('mode1 = null'); }
        if (rule.mode2 !== null) { querys.push(`mode2 = ${ rule.mode2 }`); }
        else { querys.push('mode2 = null'); }
        if (rule.mode3 !== null) { querys.push(`mode3 = ${ rule.mode3 }`); }
        else { querys.push('mode3 = null'); }

        if (rule.directory1 !== null) {
            querys.push(`directory1 = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
            values.push(rule.directory1);
        } else {
            querys.push('directory1 = null');
        }
        if (rule.directory2 !== null) {
            querys.push(`directory2 = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
            values.push(rule.directory2);
        } else {
            querys.push('directory2 = null');
        }
        if (rule.directory3 !== null) {
            querys.push(`directory3 = ${ this.operator.createValueStr(values.length + 1, values.length + 1) }`);
            values.push(rule.directory3);
        } else {
            querys.push('directory3 = null');
        }

        if (rule.delTs !== null) { querys.push(`delTs = ${ this.operator.convertBoolean(rule.delTs) }`); }
        else { querys.push('delTs = null'); }

        // query 組み立て
        let queryStr = `update ${ DBSchema.TableName.Rules }`;
        if (querys.length > 0) { queryStr += ' set'; }
        querys.forEach((query) => { queryStr += ` ${ query },`; });
        if (querys.length > 0) { queryStr = queryStr.slice(0, -1); }

        queryStr += ` where id = ${ id }`;

        return this.operator.runQuery(queryStr, values);
    }

    /**
     * rule を削除
     * @param id: rule id
     * @return Promise<void>
     */
    public delete(id: number): Promise<void> {
        return this.operator.runQuery(`delete from ${ DBSchema.TableName.Rules } where id = ${ id }`);
    }

    /**
     * rule を有効化
     * @param id: rule id
     * @return Promise<void>
     */
    public enable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = ${ this.operator.convertBoolean(true) } where id = ${ id }`);
    }

    /**
     * rule を無効化
     * @param id: rule id
     * @return Promise<void>
     */
    public disable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = ${ this.operator.convertBoolean(false) } where id = ${ id }`);
    }

    /**
     * id 検索
     * @param id: rule id
     * @return Promise<DBSchema.RulesSchema>
     */
    public async findId(id: number): Promise<DBSchema.RulesSchema | null> {
        return this.operator.getFirst(this.fixResults(<DBSchema.RulesSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Rules } where id = ${ id }`)));
    }

    /**
     * @param DBSchema.RulesSchema[]
     * @return DBSchema.RulesSchema[]
     */
    protected fixResults(rules: DBSchema.RulesSchema[]): DBSchema.RulesSchema[] {
        return rules;
    }

    /**
     * 全件 ID 取得
     * @return Promise<DBSchema.RulesSchema[]>
     */
    public findAllId(): Promise<{ id: number }[]> {
        return this.operator.runQuery(`select id from ${ DBSchema.TableName.Rules } order by id asc`);
    }

    /**
     * 全件の id と keyword を取得
     * @return Promise<DBSchema.RulesSchema[]>
     */
    public findAllIdAndKeyword(): Promise<{ id: number; keyword: string }[]> {
        return this.operator.runQuery(`select id, keyword from ${ DBSchema.TableName.Rules } order by id asc`);
    }

    /**
     * 全件取得
     * @param option: RuleFindAllOption
     * @return Promise<DBSchema.RulesSchema[]>
     */
    public async findAll(option: RuleFindAllOption = {}): Promise<DBSchema.RulesSchema[]> {
        const values: any[] = [];
        let query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Rules } `;

        // 検索オプション
        if (typeof option.query !== 'undefined') {
            const optionQuery = this.createOptionQuery(option.query);
            query += optionQuery.str;
            Array.prototype.push.apply(values, optionQuery.values);
        }

        query += 'order by id asc';
        if (typeof option.limit !== 'undefined') { query += ` ${ this.operator.createLimitStr(option.limit, option.offset) }`; }

        return this.fixResults(<DBSchema.RulesSchema[]> await this.operator.runQuery(query, values));
    }

    /**
     * 検索時のオプションを生成
     * @param query: RuleFindQuery
     * @return { str: string; values: string[] }
     */
    public createOptionQuery(query: RuleFindQuery): { str: string; values: string[] } {
        let queryStr = '';
        const values: any[] = [];

        if (typeof query.keyword !== 'undefined') {
            const querys: string[] = [];
            const likeStr = this.operator.createLikeStr(false);
            const keywords = StrUtil.toHalf(query.keyword).trim().split(' ');

            keywords.forEach((str, i) => {
                str = `%${ str }%`;
                querys.push(`halfKeyword ${ likeStr } ${ this.operator.createValueStr(i + 1, i + 1) }`);
                values.push(str);
            });

            // and query 生成
            querys.forEach((str, i) => {
                queryStr += i === querys.length - 1 ? `${ str }` : `${ str } and `;
            });
        }

        if (queryStr.length > 0) {
            queryStr = `where ${ queryStr } `;
        }

        return {
            str: queryStr,
            values: values,
        };
    }

    /**
     * keyword と id の一覧を取得
     * @return Promise<RuleList[]>
     */
    public async getList(): Promise<RuleList[]> {
        return <RuleList[]> await this.operator.runQuery(`select id, keyword from ${ DBSchema.TableName.Rules } order by id asc`);
    }

    /**
     * 件数取得
     * @return Promise<number>
     */
    public getTotal(option: RuleFindQuery = {}): Promise<number> {
        const query = this.createOptionQuery(option);

        return this.operator.total(DBSchema.TableName.Rules, query.str, query.values);
    }
}

export { RuleFindQuery, RulesDBInterface, RulesDB };

