import * as DBSchema from '../DB/DBSchema';
import { RuleFindQuery, RulesDBInterface } from '../DB/RulesDB';
import { IPCClientInterface } from '../IPC/IPCClient';
import { RuleInterface } from '../Operator/RuleInterface';
import ApiModel from './ApiModel';
import ApiUtil from './ApiUtil';

interface RulesModelInterface extends ApiModel {
    getAll(limit: number | undefined, offset: number, query?: RuleFindQuery): Promise<{}[]>;
    getId(ruleId: number): Promise<{}>;
    getRuleList(): Promise<{}[]>;
    disableRule(ruleId: number): Promise<void>;
    enableRule(ruleId: number): Promise<void>;
    deleteRule(ruleId: number): Promise<void>;
    addRule(rule: RuleInterface): Promise<{ id: number }>;
    updateRule(ruleId: number, rule: RuleInterface): Promise<void>;
}

namespace RulesModelInterface {
    export const NotFoundRuleIdError = 'NotFoundRuleId';
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
     * @param query: RuleFindQuery
     * @return Promise<any>
     */
    public async getAll(limit: number | undefined, offset: number, query: RuleFindQuery = {}): Promise<any> {
        const datas = await this.rulesDB.findAll({
            limit: limit,
            offset: offset,
            query: query,
        });
        const total = await this.rulesDB.getTotal();

        const results: any[] = [];
        datas.forEach((result: DBSchema.RulesSchema) => {
            results.push(ApiUtil.deleteNullinHash(result));
        });

        return {
            rules: results,
            total: total,
        };
    }

    /**
     * rule を id 取得
     * @param ruleId: rule id
     * @return Promise<{}>
     */
    public async getId(ruleId: number): Promise<{}> {
        const rule = await this.rulesDB.findId(ruleId);

        if (rule === null) {
            throw new Error(RulesModelInterface.NotFoundRuleIdError);
        }

        return ApiUtil.deleteNullinHash(rule);
    }

    /**
     * rule list を取得
     * @return Promise<{}[]>
     */
    public async getRuleList(): Promise<{}[]> {
        const list = await this.rulesDB.getList();

        return list.map((l) => {
            return ApiUtil.deleteNullinHash(l);
        });
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
        const ruleId = await this.ipc.ruleAdd(rule);

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

export { RulesModelInterface, RulesModel };

