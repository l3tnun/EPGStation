import * as apid from '../../../api';

export default interface IReserveOptionChecker {
    checkRuleOption(rule: apid.Rule | apid.AddRuleOption): boolean;
    checkReserveOption(option: apid.RuleReserveOption): boolean;
    checkEncodeOption(encodeOption: apid.ReserveEncodedOption | undefined): boolean;
}
