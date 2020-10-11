import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IRuleApiModel from './IRuleApiModel';

@injectable()
export default class RuleApiModel implements IRuleApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    /**
     * 指定した id のルール情報の取得
     * @param ruleId: apid.Rule
     * @return Promise<apid.Rule>
     */
    public async get(ruleId: apid.RuleId): Promise<apid.Rule> {
        const result = await this.repository.get(`/rules/${ruleId}`);

        return result.data;
    }

    /**
     * ルール情報の取得
     * @param option: apid.GetRuleOption
     * @return Promise<apid.Rules>
     */
    public async gets(option: apid.GetRuleOption): Promise<apid.Rules> {
        const result = await this.repository.get('/rules', {
            params: option,
        });

        return result.data;
    }

    /**
     * ルールのキーワード検索
     * @param option: apid.GetRuleOption
     * @return Promise<apid.RuleKeywordItem[]>
     */
    public async searchKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]> {
        const result = await this.repository.get('/rules/keyword', {
            params: option,
        });

        return result.data.items;
    }

    /**
     * ルールの追加
     * @param rule: apid.AddRuleOption
     * @return Promise<apid.RuleId>
     */
    public async add(rule: apid.AddRuleOption): Promise<apid.RuleId> {
        const result = await this.repository.post('/rules', rule);

        return result.data;
    }

    /**
     * ルールの更新
     * @param ruleId: apid.RuleId
     * @param rule: apid.AddRuleOption
     * @return Promise<void>
     */
    public async update(ruleId: apid.RuleId, rule: apid.AddRuleOption): Promise<void> {
        await this.repository.put(`/rules/${ruleId}`, rule);
    }

    /**
     * 指定したルールの有効化
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        await this.repository.put(`/rules/${ruleId}/enable`);
    }

    /**
     * 指定したルールの無効化
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        await this.repository.put(`/rules/${ruleId}/disable`);
    }

    /**
     * 指定したルールの削除
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        await this.repository.delete(`/rules/${ruleId}`);
    }
}
