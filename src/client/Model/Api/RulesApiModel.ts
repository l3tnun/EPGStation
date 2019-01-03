import * as apid from '../../../../api';
import ApiModel from './ApiModel';

interface RuleFindQueryOption {
    keyword?: string;
}

interface RulesApiModelInterface extends ApiModel {
    init(): void;
    updateRules(): Promise<void>;
    fetchRules(limit: number, offset: number, option: RuleFindQueryOption): Promise<void>;
    fetchRule(ruleId: apid.RuleId): Promise<void>;
    fetchRuleList(): Promise<void>;
    getRules(): apid.Rules;
    getPage(): number;
    getRule(): apid.Rule | null;
    getRuleList(): apid.RuleList[];
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
    private ruleList: apid.RuleList[] = [];
    private limit: number = 0;
    private offset: number = 0;
    private option: RuleFindQueryOption = {};
    private currentPage: number = 1;

    public init(): void {
        super.init();
        this.rules = { rules: [], total: 0 };
    }

    /**
     * query を現在の状況のまま更新する
     */
    public async updateRules(): Promise<void> {
        return this.fetchRules(this.limit, this.offset, this.option);
    }

    /**
     * ルール一覧を取得
     * /api/rules
     * @param limit: limit
     * @param offset: offset
     * @param option: RuleFindQueryOption
     */
    public async fetchRules(limit: number, offset: number, option: RuleFindQueryOption): Promise<void> {
        this.limit = limit;
        this.offset = offset;
        this.option = option;

        const query: { [key: string]: any } = {
            limit: limit,
            offset: offset,
        };

        if (typeof option.keyword !== 'undefined') { query.keyword = option.keyword; }

        try {
            this.rules = await <any> this.request({
                method: 'GET',
                url: './api/rules',
                data: query,
            });

            this.currentPage = this.offset / this.limit + 1;
        } catch (err) {
            this.rules = { rules: [], total: 0 };
            console.error('./api/rules');
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
            this.rule = await <any> this.request({
                method: 'GET',
                url: `./api/rules/${ ruleId }`,
            });
        } catch (err) {
            this.rule = null;
            console.error(`./api/rules/${ ruleId }`);
            console.error(err);
            this.openSnackbar('ルール取得に失敗しました');
        }
    }

    /**
     * Rule List を取得
     * /api/rule/list
     */
    public async fetchRuleList(): Promise<void> {
        try {
            this.ruleList = await <any> this.request({
                method: 'GET',
                url: './api/rules/list',
            });
        } catch (err) {
            this.ruleList = [];
            console.error('./api/rules/list');
            console.error(err);
            this.openSnackbar('ルール一覧取得に失敗しました');
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
     * 現在のページを取得
     * @return number
     */
    public getPage(): number {
        return this.currentPage;
    }

    /**
     * rule を取得
     * @return apid.Rule
     */
    public getRule(): apid.Rule | null {
        return this.rule;
    }

    /**
     * rule list を取得
     * @return apid.RuleList[]
     */
    public getRuleList(): apid.RuleList[] {
        return this.ruleList;
    }

    /**
     * enable rule
     * @param ruleId: RuleId
     * @return Promise<void>
     */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        await this.request({
            method: 'PUT',
            url: `./api/rules/${ ruleId }/enable`,
        });
        await this.updateRules();
    }

    /**
     * disable rule
     * @param ruleId: RuleId
     * @return Promise<void>
     */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        await this.request({
            method: 'PUT',
            url: `./api/rules/${ ruleId }/disable`,
        });
        await this.updateRules();
    }

    /**
     * delete rule
     * @param ruleId: RuleId
     * @return Promise<void>
     */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        await this.request({
            method: 'DELETE',
            url: `./api/rules/${ ruleId }`,
        });
        await this.updateRules();
    }

    /**
     * add rule
     * @param rule: AddRule
     * @return Promise<void>
     */
    public async add(rule: apid.AddRule): Promise<void> {
        await this.request({
            method: 'POST',
            url: './api/rules',
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
        await this.request({
            method: 'PUT',
            url: `./api/rules/${ ruleId }`,
            data: rule,
        });
    }
}

export { RuleFindQueryOption, RulesApiModelInterface, RulesApiModel };

