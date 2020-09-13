import * as apid from '../../../../../api';

export default interface IRuleApiModel {
    get(ruleId: apid.RuleId): Promise<apid.Rule>;
    gets(option: apid.GetRuleOption): Promise<apid.Rules>;
    searchKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]>;
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    update(ruleId: apid.RuleId, rule: apid.AddRuleOption): Promise<void>;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
}
