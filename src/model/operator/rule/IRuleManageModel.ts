import * as apid from '../../../../api';

export default interface IRuleManageModel {
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    update(rule: apid.Rule): Promise<void>;
    enable(ruleId: apid.RuleId): Promise<void>;
    disable(ruleId: apid.RuleId): Promise<void>;
    delete(ruleId: apid.RuleId): Promise<void>;
    deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]>;
}
