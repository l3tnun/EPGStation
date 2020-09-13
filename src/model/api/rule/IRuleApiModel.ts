import * as apid from '../../../../api';

export default interface IRuleApiModel {
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    get(ruleId: apid.RuleId): Promise<apid.Rule | null>;
    gets(option: apid.GetRuleOption): Promise<apid.Rules>;
    searchKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]>;
    update(rule: apid.Rule): Promise<void>;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
    deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]>;
}
