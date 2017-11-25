import * as m from 'mithril';
import ApiModel from './ApiModel';
import * as apid from '../../../../api';

interface RulesApiModelInterface extends ApiModel {
    init(): void;
    updateRules(): Promise<void>;
    fetchRules(limit: number, offset: number): Promise<void>;
    fetchRule(ruleId: apid.RuleId): Promise<void>;
    getRules(): apid.Rules;
    getRule(): apid.Rule | null;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
    add(rule: apid.AddRule): Promise<void>;
    update(ruleId: apid.RuleId, rule: apid.AddRule): Promise<void>;
}

/**
* RuleApiModel
* /api/rules
*/
class RulesApiModel extends ApiModel implements RulesApiModelInterface {
    private rules: apid.Rules = { rules: [], total: 0 };
    private rule: apid.Rule | null = null;
    private limit: number = 0;
    private offset: number = 0;

    public init(): void {
        super.init();
        this.rules = { rules: [], total: 0 };
    }

    /**
    * query を現在の状況のまま更新する
    */
    public async updateRules(): Promise<void> {
        return this.fetchRules(this.limit, this.offset);
    }

    /**
    * ルール一覧を取得
    * /api/rules
    * @param limit: limit
    * @param offset: offset
    */
    public async fetchRules(limit: number, offset: number): Promise<void> {
        this.limit = limit;
        this.offset = offset;

        let query = {
            limit: limit,
            offset: offset,
        };

        try {
            this.rules = await <any> m.request({
                method: 'GET',
                url: '/api/rules',
                data: query,
            });
        } catch(err) {
            this.rules = { rules: [], total: 0 };
            console.error('/api/rules');
            console.error(err);
            this.openSnackbar('ルール情報取得に失敗しました');
        }
    }

    /**
    * id を指定して rule を取得
    * /api/rules/{id}
    * @param ruleId: RuleId
    */
    public async fetchRule(ruleId: apid.RuleId): Promise<void> {
        try {
            this.rule = await <any> m.request({
                method: 'GET',
                url: `/api/rules/${ ruleId }`,
            });
        } catch(err) {
            this.rule = null;
            console.error(`/api/rules/${ ruleId }`);
            console.error(err);
            this.openSnackbar('ルール取得に失敗しました');
        }
    }

    /**
    * rules を取得
    * @return apid.Rules
    */
    public getRules(): apid.Rules {
        return this.rules;
    }

    /**
    * rule を取得
    * @return apid.Rule
    */
    public getRule(): apid.Rule | null {
        return this.rule;
    }

    /**
    * enable rule
    * @param ruleId: RuleId
    * @return Promise<void>
    */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        await m.request({
            method: 'PUT',
            url: `/api/rules/${ ruleId }/enable`,
        });
        await this.updateRules();
    }

    /**
    * disable rule
    * @param ruleId: RuleId
    * @return Promise<void>
    */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        await m.request({
            method: 'PUT',
            url: `/api/rules/${ ruleId }/disable`,
        });
        await this.updateRules();
    }

    /**
    * delete rule
    * @param ruleId: RuleId
    * @return Promise<void>
    */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        await m.request({
            method: 'DELETE',
            url: `/api/rules/${ ruleId }`,
        });
        await this.updateRules();
    }

    /**
    * add rule
    * @param rule: AddRule
    * @return Promise<void>
    */
    public async add(rule: apid.AddRule): Promise<void> {
        await m.request({
            method: 'POST',
            url: `/api/rules`,
            data: rule,
        });
    }

    /**
    * update rule
    * @param ruleId: RuleId
    * @param rule: AddRule
    * @return Promise<void>
    */
    public async update(ruleId: apid.RuleId, rule: apid.AddRule): Promise<void> {
        await m.request({
            method: 'PUT',
            url: `/api/rules/${ ruleId }`,
            data: rule,
        });
    }
}

export { RulesApiModelInterface, RulesApiModel }

