import * as apid from '../../../../../api';

export interface RuleFetchOption extends apid.GetRuleOption {
    isHalfWidth: boolean;
}

export interface RuleStateDisplayData {
    id: apid.RuleId;
    isEnable: boolean;
    keyword: string;
    ignoreKeyword: string;
    channels: string;
    genres: string;
    reservationsCnt: number;
}

export interface RuleStateData {
    display: RuleStateDisplayData;
    item: apid.Rule;
    isSelected: boolean;
}

export default interface IRuleState {
    clearData(): void;
    fetchData(option: RuleFetchOption): Promise<void>;
    getRules(): RuleStateData[];
    getTotal(): number;
    getSelectedCnt(): number;
    select(recordedId: apid.RecordedId): void;
    selectAll(): void;
    clearSelect(): void;
    multiplueDeletion(): Promise<void>;
}
