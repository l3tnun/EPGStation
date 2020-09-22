import * as apid from '../../../../../../api';

export interface SelectorItem {
    text: string;
    value: number;
}

export interface VideoFileItem {
    key: number;
    parentDirectoryName: string | undefined;
    subDirectory: string | null;
    viewName: string | null;
    fileType: string | undefined;
    file: File | null | undefined;
}

export interface UploadProgramOption {
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    startAt: Date | null;
    duration: number | null;
    name: string | null;
    description: string | null;
    extended: string | null;
    genre1: apid.ProgramGenreLv1 | undefined;
    subGenre1: apid.ProgramGenreLv2 | undefined;
}

export default interface IRecordedUploadState {
    programOption: UploadProgramOption;
    videoFileItems: VideoFileItem[];
    ruleKeyword: string | null;
    ruleItems: apid.RuleKeywordItem[];
    isShowPeriod: boolean;
    init(): void;
    fetchData(): Promise<void>;
    updateRuleItems(): Promise<void>;
    getChannelItems(): SelectorItem[];
    getPrentDirectoryItems(): string[];
    getFileTypeItems(): apid.VideoFileType[];
    getGenreItems(): SelectorItem[];
    getSubGenreItems(): SelectorItem[];
    addEmptyVideoFileItem(): void;
    checkInput(): boolean;
    upload(): Promise<void>;
}
