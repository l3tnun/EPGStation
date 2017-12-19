import DBBase from './DBBase';
import * as DBSchema from './DBSchema';

interface RulesDBInterface extends DBBase {
    create(): Promise<void>;
    insert(rule: DBSchema.RulesSchema): Promise<number>;
    update(id: number, rule: DBSchema.RulesSchema): Promise<void>;
    delete(id: number): Promise<void>;
    enable(id: number): Promise<void>;
    disable(id: number): Promise<void>;
    findId(id: number): Promise<DBSchema.RulesSchema | null>;
    findAllId(): Promise<{ id: number }[]>;
    findAllIdAndKeyword(): Promise<{ id: number, keyword: string }[]>;
    findAll(limit?: number, offset?: number): Promise<DBSchema.RulesSchema[]>;
    getTotal(): Promise<number>;
}

abstract class RulesDB extends DBBase implements RulesDBInterface {
    /**
    * create table
    * @return Promise<void>
    */
    abstract create(): Promise<void>;

    /**
    * データ挿入
    * @param rule: DBSchema.RulesSchema
    * @return Promise<number> insertId
    */
    public insert(rule: DBSchema.RulesSchema): Promise<number> {
        let query = `insert into ${ DBSchema.TableName.Rules } (`
            + 'keyword, '
            + 'ignoreKeyword, '
            + 'keyCS, '
            + 'keyRegExp, '
            + 'title, '
            + 'description, '
            + 'extended, '
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
            + 'enable, '
            + 'directory, '
            + 'recordedFormat, '
            + 'mode1, '
            + 'directory1, '
            + 'mode2, '
            + 'directory2, '
            + 'mode3, '
            + 'directory3, '
            + 'delTs '
        + ') VALUES ('
            + this.operator.createValueStr(1, 30)
        + `) ${ this.operator.getReturningStr() }`;

        let value: any[] = [];
        value.push(rule.keyword);
        value.push(rule.ignoreKeyword);
        value.push(rule.keyCS);
        value.push(rule.keyRegExp);
        value.push(rule.title);
        value.push(rule.description);
        value.push(rule.extended);
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
        value.push(rule.enable);
        value.push(rule.directory);
        value.push(rule.recordedFormat);
        value.push(rule.mode1);
        value.push(rule.directory1);
        value.push(rule.mode2);
        value.push(rule.directory2);
        value.push(rule.mode3);
        value.push(rule.directory3);
        value.push(rule.delTs);

        return this.operator.runInsert(query, value);
    }

    /**
    * データ更新
    * @param id: rule id
    * @param rule: DBSchema.RulesSchema
    * @return Promise<void>
    */
    public update(id: number, rule: DBSchema.RulesSchema): Promise<void> {
        let querys: string[] = [];
        if(rule.keyword !== null) { querys.push(`keyword = "${ rule.keyword.replace(/"/g, '\\"') }"`); }
        else { querys.push("keyword = null"); }
        if(rule.ignoreKeyword !== null) { querys.push(`ignoreKeyword = "${ rule.ignoreKeyword.replace(/"/g, '\\"') }"`); }
        else { querys.push("ignoreKeyword = null"); }
        if(rule.keyCS !== null) { querys.push(`keyCS = ${ Number(rule.keyCS) }`); }
        else { querys.push("keyCS = null"); }
        if(rule.keyRegExp !== null) { querys.push(`keyRegExp = ${ Number(rule.keyRegExp) }`); }
        else { querys.push("keyRegExp = null"); }
        if(rule.title !== null) { querys.push(`title = ${ Number(rule.title) }`); }
        else { querys.push("title = null"); }
        if(rule.description !== null) { querys.push(`description = ${ Number(rule.description) }`); }
        else { querys.push("description = null"); }
        if(rule.extended !== null) { querys.push(`extended = ${ Number(rule.extended) }`); }
        else { querys.push("extended = null"); }
        if(rule.GR !== null) { querys.push(`GR = ${ Number(rule.GR) }`); }
        else { querys.push("GR = null"); }
        if(rule.BS !== null) { querys.push(`BS = ${ Number(rule.BS) }`); }
        else { querys.push("BS = null"); }
        if(rule.CS !== null) { querys.push(`CS = ${ Number(rule.CS) }`); }
        else { querys.push("CS = null"); }
        if(rule.SKY !== null) { querys.push(`SKY = ${ Number(rule.SKY) }`); }
        else { querys.push("SKY = null"); }
        if(rule.station !== null) { querys.push(`station = ${ rule.station }`) }
        else { querys.push("station = null"); }
        if(rule.genrelv1 !== null) { querys.push(`genrelv1 = ${ rule.genrelv1 }`) }
        else { querys.push("genrelv1 = null"); }
        if(rule.genrelv2 !== null) { querys.push(`genrelv2 = ${ rule.genrelv2 }`) }
        else { querys.push("genrelv2 = null"); }
        if(rule.startTime !== null) { querys.push(`startTime = ${ rule.startTime }`) }
        else { querys.push("startTime = null"); }
        if(rule.timeRange !== null) { querys.push(`timeRange = ${ rule.timeRange }`) }
        else { querys.push("timeRange = null"); }
        querys.push(`week = ${ rule.week }`);
        if(rule.isFree !== null) { querys.push(`isFree = ${ Number(rule.isFree) }`); }
        else { querys.push("isFree = null"); }
        if(rule.durationMin !== null) { querys.push(`durationMin = ${ rule.durationMin }`) }
        else { querys.push("durationMin = null"); }
        if(rule.durationMax !== null) { querys.push(`durationMax = ${ rule.durationMax }`) }
        else { querys.push("durationMax = null"); }
        querys.push(`enable = ${ Number(rule.enable) }`);
        if(rule.directory !== null) { querys.push(`directory = "${ rule.directory.replace(/"/g, '\\"') }"`); }
        else { querys.push("directory = null"); }
        if(rule.recordedFormat !== null) { querys.push(`recordedFormat = "${ rule.recordedFormat.replace(/"/g, '\\"') }"`); }
        else { querys.push("recordedFormat = null"); }
        if(rule.mode1 !== null) { querys.push(`mode1 = ${ rule.mode1 }`) }
        else { querys.push("mode1 = null"); }
        if(rule.directory1 !== null) { querys.push(`directory1 = "${ rule.directory1.replace(/"/g, '\\"') }"`); }
        else { querys.push("directory1 = null"); }
        if(rule.mode2 !== null) { querys.push(`mode2 = ${ rule.mode2 }`) }
        else { querys.push("mode2 = null"); }
        if(rule.directory2 !== null) { querys.push(`directory2 = "${ rule.directory2.replace(/"/g, '\\"') }"`); }
        else { querys.push("directory2 = null"); }
        if(rule.mode3 !== null) { querys.push(`mode3 = ${ rule.mode3 }`) }
        else { querys.push("mode3 = null"); }
        if(rule.directory3 !== null) { querys.push(`directory3 = "${ rule.directory3.replace(/"/g, '\\"') }"`); }
        else { querys.push("directory3 = null"); }
        if(rule.delTs !== null) { querys.push(`delTs = ${ Number(rule.delTs) }`); }
        else { querys.push("delTs = null"); }

        // query 組み立て
        let queryStr = `update ${ DBSchema.TableName.Rules }`
        if(querys.length > 0) { queryStr += ' set' };
        querys.forEach((query) => { queryStr += ` ${ query },` });
        if(querys.length > 0) { queryStr = queryStr.slice(0, -1); };

        queryStr += ` where id = ${ id }`

        return this.operator.runQuery(queryStr);
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
    abstract enable(id: number): Promise<void>;

    /**
    * rule を無効化
    * @param id: rule id
    * @return Promise<void>
    */
    abstract disable(id: number): Promise<void>;

    /**
    * id 検索
    * @param id: rule id
    * @return Promise<DBSchema.RulesSchema>
    */
    public async findId(id: number): Promise<DBSchema.RulesSchema | null> {
        return this.operator.getFirst(this.fixResult(<DBSchema.RulesSchema[]> await this.operator.runQuery(`select ${ this.getAllColumns() } from ${ DBSchema.TableName.Rules } where id = ${ id }`)));
    }

    /**
    * @param DBSchema.RulesSchema[]
    * @return DBSchema.RulesSchema[]
    */
    private fixResult(rules: DBSchema.RulesSchema[]): DBSchema.RulesSchema[] {
        return rules.map((rule) => {
            if(rule.keyCS != null) { rule.keyCS = Boolean(rule.keyCS); }
            if(rule.keyRegExp != null) { rule.keyRegExp = Boolean(rule.keyRegExp); }
            if(rule.title != null) { rule.title = Boolean(rule.title); }
            if(rule.description != null) { rule.description = Boolean(rule.description); }
            if(rule.extended != null) { rule.extended = Boolean(rule.extended); }
            if(rule.GR != null) { rule.GR = Boolean(rule.GR); }
            if(rule.BS != null) { rule.BS = Boolean(rule.BS); }
            if(rule.CS != null) { rule.CS = Boolean(rule.CS); }
            if(rule.SKY != null) { rule.SKY = Boolean(rule.SKY); }
            if(rule.isFree != null) { rule.isFree = Boolean(rule.isFree); }
            if(rule.enable != null) { rule.enable = Boolean(rule.enable); }
            if(rule.delTs != null) { rule.delTs = Boolean(rule.delTs); }

            return rule;
        });
    }

    /**
    * 全件 ID 取得
    * @return Promise<DBSchema.RulesSchema[]>
    */
    public findAllId(): Promise<{ id: number }[]> {
        return this.operator.runQuery(`select id from ${ DBSchema.TableName.Rules }`);
    }

    /**
    * 全件の id と keyword を取得
    * @return Promise<DBSchema.RulesSchema[]>
    */
    public findAllIdAndKeyword(): Promise<{ id: number, keyword: string }[]> {
        return this.operator.runQuery(`select id, keyword from ${ DBSchema.TableName.Rules }`);
    }

    /**
    * 全件取得
    * @param limit: limit
    * @param offset: offset
    * @return Promise<DBSchema.RulesSchema[]>
    */
    public async findAll(limit?: number, offset: number = 0): Promise<DBSchema.RulesSchema[]> {
        let query = `select ${ this.getAllColumns() } from ${ DBSchema.TableName.Rules }`;
        if(typeof limit !== 'undefined') { query += ` ${ this.operator.createLimitStr(limit, offset) }` }

        return this.fixResult(<DBSchema.RulesSchema[]> await this.operator.runQuery(query));
    }

    /**
    * 件数取得
    * @return Promise<number>
    */
    public getTotal(): Promise<number> {
        return this.operator.total(DBSchema.TableName.Rules);
    }
}

export { RulesDBInterface, RulesDB }

