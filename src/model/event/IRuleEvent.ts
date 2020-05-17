import * as apid from '../../../api';

export default interface IRuleEvent {
    emitAdded(ruleId: apid.RuleId): void;
    emitUpdated(ruleId: apid.RuleId): void;
    emitEnabled(ruleId: apid.RuleId): void;
    emitDisabled(ruleId: apid.RuleId): void;
    emitDeleted(ruleId: apid.RuleId): void;
    setAdded(callback: (ruleId: apid.RuleId) => void): void;
    setUpdated(callback: (ruleId: apid.RuleId) => void): void;
    setEnabled(callback: (ruleId: apid.RuleId) => void): void;
    setDisabled(callback: (ruleId: apid.RuleId) => void): void;
    setDeleted(callback: (ruleId: apid.RuleId) => void): void;
}
