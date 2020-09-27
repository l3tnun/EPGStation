import * as apid from '../../../api';

export interface RuleWithCnt extends apid.Rule {
    updateCnt: number;
}

export default interface IRuleDB {
    restore(items: RuleWithCnt[]): Promise<void>;
    insertOnce(rule: apid.Rule | apid.AddRuleOption): Promise<apid.RuleId>;
    updateOnce(rule: apid.Rule): Promise<void>;
    enableOnce(ruleId: apid.RuleId): Promise<void>;
    disableOnce(ruleId: apid.RuleId): Promise<void>;
    deleteOnce(ruleId: apid.RuleId): Promise<void>;
    findId(ruleId: apid.RuleId, isNeedCnt?: boolean): Promise<apid.Rule | RuleWithCnt | null>;
    findAll(option: apid.GetRuleOption, isNeedCnt?: boolean): Promise<[apid.Rule[] | RuleWithCnt[], number]>;
    findKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]>;
    getIds(): Promise<apid.RuleId[]>;
}
