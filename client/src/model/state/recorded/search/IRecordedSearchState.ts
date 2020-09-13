import * as apid from '../../../../../../api';

export interface SelectorItem {
    text: string;
    value: number;
}

export default interface IRecordedSearchState {
    keyword: string | undefined;
    hasOriginalFile: boolean;
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    genre: apid.ProgramGenreLv1 | undefined;
    ruleKeyword: string | null;
    ruleItems: apid.RuleKeywordItem[];
    channelItems: SelectorItem[];
    genreItems: SelectorItem[];
    fetchData(): Promise<void>;
    initValues(): void;
    updateRuleItems(): Promise<void>;
}
