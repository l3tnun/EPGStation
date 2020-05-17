import * as apid from '../../../../../api';

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
}

export default interface IRuleState {
    clearData(): void;
    fetchData(option: apid.GetRuleOption): Promise<void>;
    getRules(): RuleStateData[];
    getTotal(): number;
}
