import * as apid from '../../../../../../api';

export interface SelectorItem {
    text: string;
    value: number;
}

export default interface IRecordedSearchState {
    keyword: string | undefined;
    isOnlyOriginalFile: boolean;
    ruleId: apid.RuleId | undefined;
    channelId: apid.ChannelId | undefined;
    genre: apid.ProgramGenreLv1 | undefined;
    ruleItems: SelectorItem[];
    channelItems: SelectorItem[];
    genreItems: SelectorItem[];
    fetchData(): Promise<void>;
    initValues(): void;
    update(): Promise<void>;
}
