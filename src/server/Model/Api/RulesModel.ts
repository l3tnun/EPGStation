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
            results.push(ApiUtil.deleteNullinHash(result));
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
        let rule = await this.rulesDB.findId(ruleId);

        if(rule === null) {
            throw new Error(RulesModelInterface.NotFoundRuleIdError);
        }

        return ApiUtil.deleteNullinHash(rule);
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

