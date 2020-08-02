import * as apid from '../../../../../api';
import { ProgramDialogReseveItem } from '../guide/IGuideProgramDialogState';
import { ReserveType } from '../guide/IGuideReserveUtil';
import { ReserveStateData } from '../reserve/IReserveStateUtil';

export interface KeywordOption {
    keyCS: boolean;
    keyRegExp: boolean;
    name: boolean;
    description: boolean;
    extended: boolean;
}

export interface BroadcastWaveState {
    isEnable: boolean;
    isShow: boolean;
}

export interface BroadcastWave {
    GR: BroadcastWaveState;
    BS: BroadcastWaveState;
    CS: BroadcastWaveState;
    SKY: BroadcastWaveState;
}

export interface SubGenreIndex {
    [subgenre: number]: boolean;
}

export interface GenreIndex {
    isEnable: boolean;
    subGenreIndex: SubGenreIndex;
}

export interface Week {
    mon: boolean;
    tue: boolean;
    wed: boolean;
    thu: boolean;
    fri: boolean;
    sat: boolean;
    sun: boolean;
}

/**
 * 検索オプション
 */
export interface SearchOption {
    keyword: string | null;
    keywordOption: KeywordOption;
    ignoreKeyword: string | null;
    ignoreKeywordOption: KeywordOption;
    channels: apid.ChannelId[];
    broadcastWave: BroadcastWave;
    genres: { [genre: number]: GenreIndex };
    isShowSubgenres: boolean;
    startTime: number | undefined;
    rangeTime: number | undefined;
    week: Week;
    durationMin: number | null;
    durationMax: number | null;
    startPeriod: Date | null;
    endPeriod: Date | null;
    isFree: boolean;
}

/**
 * 時刻予約オプション
 */
export interface TimeReserveOption {
    keyword: string | null;
    channel: apid.ChannelId | undefined;
    startTime: string | null;
    endTime: string | null;
    week: Week;
}

export interface SelectorItem {
    text: string;
    value: number;
}

export interface SubGenreItem {
    name: string;
    value: number;
}

export interface GenreItem {
    name: string;
    value: number;
    subGenres: SubGenreItem[];
}

export interface SearchResultItem {
    display: {
        channelName: string;
        name: string;
        day: string;
        dow: string;
        startTime: string;
        endTime: string;
        duration: number;
        description?: string;
        extended?: string;
        reserveType: ReserveType;
    };
    channel: apid.ScheduleChannleItem | null;
    program: apid.ScheduleProgramItem;
    reserve?: ProgramDialogReseveItem;
}

/**
 * ルール予約オプション
 */
export interface ReserveOption {
    enable: boolean; // ルールが有効か
    allowEndLack: boolean; // 末尾切れを許可するか
    avoidDuplicate: boolean; // 録画済みの重複番組を排除するか
    periodToAvoidDuplicate: number | null; // 重複を避ける期間
}

/**
 * 保存オプション
 */
export interface SaveOption {
    parentDirectoryName: string | null; // 親保存ディレクトリ
    directory: string | null; // 保存ディレクトリ
    recordedFormat: string | null; // ファイル名フォーマット
}

/**
 * エンコードオプション
 */
export interface EncodedOption {
    mode1: string | null; // エンコードモード
    encodeParentDirectoryName1: string | null; // 親保存ディレクトリ
    directory1: string | null; // 保存先ディレクトリ
    mode2: string | null;
    encodeParentDirectoryName2: string | null;
    directory2: string | null;
    mode3: string | null;
    encodeParentDirectoryName3: string | null;
    directory3: string | null;
    isDeleteOriginalAfterEncode: boolean; // エンコード後に元ファイルを自動削除するか
}

export interface QuerySearchOption {
    keyword?: string;
    channelId?: apid.ChannelId;
    genre?: apid.ProgramGenreLv1;
    subGenre?: apid.ProgramGenreLv2;
}

export default interface ISearchState {
    isTimeSpecification: boolean;
    searchOption: SearchOption | null;
    timeReserveOption: TimeReserveOption | null;
    reserveOption: ReserveOption | null;
    saveOption: SaveOption | null;
    encodeOption: EncodedOption | null;
    isShowPeriod: boolean;
    optionPanel: number[];
    genreSelect: number;
    init(ruleId?: apid.RuleId): Promise<void>;
    setQueryOption(query: QuerySearchOption): void;
    clear(): void;
    getChannelItems(): SelectorItem[];
    getGenreItems(): GenreItem[];
    getStartTimeItems(): SelectorItem[];
    getRangeTimeItems(): SelectorItem[];
    onClickGenre(genre: apid.ProgramGenreLv1): void;
    onClickSubGenre(genre: apid.ProgramGenreLv1, subGenre: apid.ProgramGenreLv2): void;
    clearGenres(): void;
    prepSearch(): void;
    fetchSearchResult(): Promise<void>;
    getSearchResult(): SearchResultItem[] | null;
    fetchRuleReserves(): Promise<void>;
    getRuleReservesResult(): ReserveStateData[];
    getPrentDirectoryItems(): string[];
    getEncodeModeItems(): string[];
    isEnableEncodeMode(): boolean;
    isEditingRule(): boolean;
    addRule(): Promise<void>;
    updateRule(): Promise<void>;
}
