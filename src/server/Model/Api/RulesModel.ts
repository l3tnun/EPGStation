import ApiModel from './ApiModel';
import { IPCClientInterface } from '../IPC/IPCClient';
import { RulesDBInterface } from '../DB/RulesDB';
import * as DBSchema from '../DB/DBSchema';
import ApiUtil from './ApiUtil';
import { RuleInterface } from '../../Operator/RuleInterface';

interface RulesModelInterface extends ApiModel {
    getAll(limit: number | undefined, offset: number): Promise<{}[]>;
    getId(ruleId: number): Promise<{}>;
    disableRule(ruleId: number): Promise<void>;
    enableRule(ruleId: number): Promise<void>;
    deleteRule(ruleId: number): Promise<void>;
    addRule(rule: RuleInterface): Promise<{ id: number }>;
    updateRule(ruleId: number, rule: RuleInterface): Promise<void>;
}

namespace RulesModelInterface {
    export const NotFoundRuleIdError = 'NotFoundRuleId'
}

class RulesModel extends ApiModel implements RulesModelInterface {
    private ipc: IPCClientInterface;
    private rulesDB: RulesDBInterface;

    constructor(ipc: IPCClientInterface, rulesDB: RulesDBInterface) {
        super();
        this.ipc = ipc;
        this.rulesDB = rulesDB;
    }

    /**
    * rule をすべて取得
    * @param limit: number | undefined
    * @param offset: number
    * @return Promise<any>
    */
    public async getAll(limit: number | undefined, offset: number): Promise<any> {
        let datas = await this.rulesDB.findAll(limit, offset);
        let total = await this.rulesDB.getTotal();

        let results: any[] = [];
        datas.forEach((result: DBSchema.RulesSchema) => {
            results.push(this.fixResult(result));
        });

        return {
            rules: results,
            total: total
        }
    }

    /**
    * rule を id 取得
    * @param ruleId: rule id
    * @return Promise<{}>
    */
    public async getId(ruleId: number): Promise<{}> {
        let result = await this.rulesDB.findId(ruleId);

        if(result.length === 0) {
            throw new Error(RulesModelInterface.NotFoundRuleIdError);
        }

        return this.fixResult(result[0]);
    }

    /**
    * DBSchema.RulesSchema の boolean 値を number から boolean へ正す
    * @param data: DBSchema.RulesSchema
    * @return {};
    */
    private fixResult(data: DBSchema.RulesSchema): {} {
        if(data.keyCS != null) { data.keyCS = Boolean(data.keyCS); }
        if(data.keyRegExp != null) { data.keyRegExp = Boolean(data.keyRegExp); }
        if(data.title != null) { data.title = Boolean(data.title); }
        if(data.description != null) { data.description = Boolean(data.description); }
        if(data.extended != null) { data.extended = Boolean(data.extended); }
        if(data.GR != null) { data.GR = Boolean(data.GR); }
        if(data.BS != null) { data.BS = Boolean(data.BS); }
        if(data.CS != null) { data.CS = Boolean(data.CS); }
        if(data.SKY != null) { data.SKY = Boolean(data.SKY); }
        if(data.enable != null) { data.enable = Boolean(data.enable); }
        if(data.delTs != null) { data.delTs = Boolean(data.delTs); }

        return ApiUtil.deleteNullinHash(data);
    }

    /**
    * rule を無効化
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async disableRule(ruleId: number): Promise<void> {
        await this.ipc.ruleDisable(ruleId);
    }

    /**
    * rule を有効化
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async enableRule(ruleId: number): Promise<void> {
        await this.ipc.ruleEnable(ruleId);
    }

    /**
    * rule を削除
    * @param ruleId: rule id
    * @return Promise<void>
    */
    public async deleteRule(ruleId: number): Promise<void> {
        await this.ipc.ruleDelete(ruleId);
    }

    /**
    * rule を追加
    * @param rule: RuleInterface
    * @return Promise<{ id: number }>: rule id
    */
    public async addRule(rule: RuleInterface): Promise<{ id: number }> {
        let ruleId = await this.ipc.ruleAdd(rule);

        return { id: ruleId };
    }

    /**
    * rule を更新
    * @param ruleId: rule id
    * @param rule: RuleInterface
    * @return Promise<void>
    */
    public async updateRule(ruleId: number, rule: RuleInterface): Promise<void> {
        await this.ipc.ruleUpdate(ruleId, rule);
    }
}

export { RulesModelInterface, RulesModel }

