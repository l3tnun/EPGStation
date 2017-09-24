export interface Error {
    code: number;
    message: string;
    errors?: string;
}

export type EncodedId = number;
export type RecordedId = number;
export type RuleId = number;
export type ProgramId = number;
export type EventId = number;
export type ServiceId = number;
export type NetworkId = number;
export type ServiceItemId = number;
export type UnixtimeMS = number;
export type ChannelType = 'GR' | 'BS' | 'CS' | 'SKY';
export type remoteControlKeyId = number;
export type ProgramGenreLv1 = number;
export type ProgramGenreLv2 = number;
export type ProgramVideoType = 'mpeg2' | 'h.264' | 'h.265';
export type ProgramVideoResolution = '240p' | '480i' | '480p' | '720p' | '1080i' | '1080p' | '2160p' | '4320p';
export type ProgramAudioSamplingRate = 16000 | 22050 | 24000 | 32000 | 44100 | 48000;

export interface Config {
    enableEncode: boolean;
    encodeOption?: string[];
    defaultEncode?: number;
    delTs?: boolean;
    broadcast: {
        GR: boolean;
        BS: boolean;
        CS: boolean;
        SKY: boolean;
    };
    recordedViewer?: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    recordedDownloader?: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    mpegTsStreaming?: string[];
    mpegTsViewer?: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    recordedHLS?: string[];
    kodiHosts?: string[];
}

export interface ScheduleProgram {
    channel: ScheduleServiceItem;
    programs: ScheduleProgramItem[];
}

export interface ScheduleProgramItem {
    id: ProgramId;
    channelId: ServiceItemId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isFree: boolean;
    name: string;
    description?: string;
    extended?: string;
    genre1?: ProgramGenreLv1;
    genre2?: ProgramGenreLv2;
    channelType: ChannelType;
}

export interface ScheduleServiceItem {
    id: ServiceItemId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    remoteControlKeyId?: remoteControlKeyId;
    hasLogoData: boolean;
    channelType:ChannelType
}

export interface ServiceItem {
    id: ServiceItemId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    remoteControlKeyId?: remoteControlKeyId;
    hasLogoData: boolean;
    channelType: ChannelType;
    channel: string;
    type?: number;
}

export interface EncodedProgram {
    encodedId: EncodedId;
    name: string;
    filename: string;
}

export interface EncodingInfo {
    name: string;
    isEncoding: boolean;
}

export interface RecordedPrograms {
    recorded: RecordedProgram[];
    total: number;
}

export interface RecordedProgram {
    id: RecordedId;
    channelId: ServiceItemId;
    channelType: ChannelType;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    genre1?: string;
    genre2?: string;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
    recording: boolean;
    hasThumbnail: boolean;
    original: boolean;
    filename?: string;
    ruleId?: RuleId;
    encoded: EncodedProgram[];
    encoding?: EncodingInfo[];
}

export interface RecordedTags {
    rule: RecordedRuleTag[];
    channel: RecordedChannelTag[];
    genre: RecordedGenreTag[];
}

export interface RecordedRuleTag {
    cnt: number;
    ruleId: number | null;
    name: string;
}

export interface RecordedChannelTag {
    cnt: number;
    channelId: number;
    name: string;
}

export interface RecordedGenreTag {
    cnt: number;
    genre1: number | null;
}

export interface Reserves {
    reserves: Reserve[];
    total: number;
}

export interface Reserve {
    program: ReserveProgram;
    ruleId?: RuleId;
    isManual: boolean;
}

export interface ReserveAllId {
    reserves: ReserveAllItem[];
    conflicts: ReserveAllItem[];
    skips: ReserveAllItem[];
}

export interface ReserveAllItem {
    programId: ProgramId;
    ruleId?: RuleId;
}

export interface ReserveProgram {
    id: ProgramId;
    channelId: ServiceItemId;
    eventId: EventId;
    serviceId: ServiceId;
    networkId: NetworkId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isFree: boolean;
    name: string;
    description?: string;
    extended?: string;
    genre1?: ProgramGenreLv1;
    genre2?: ProgramGenreLv2;
    channelType: ChannelType;
    channel: string;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

export interface Rules {
    rules: Rule[];
    total: number;
}

export interface Rule {
    id: RuleId;
    keyword?: string;
    ignoreKeyword?: string;
    keyCS?: boolean
    keyRegExp?: boolean;
    title?: boolean;
    description?: boolean;
    extended?: boolean;
    GR?: boolean;
    BS?: boolean;
    CS?: boolean;
    SKY?: boolean;
    station?: ServiceItemId;
    genrelv1?: ProgramGenreLv1;
    genrelv2?: ProgramGenreLv2;
    startTime?: number;
    timeRange?: number;
    week: number;
    isFree?: boolean;
    durationMin?: number;
    durationMax?: number;
    enable: boolean;
    directory?: string;
    recordedFormat?: string;
    mode1?: number;
    directory1?: string;
    mode2?: number;
    directory2?: string;
    mode3?: number;
    directory3?: string;
    delTs?: boolean;
}

export interface AddRule {
    search: RuleSearch;
    option: RuleOption;
    encode?: RuleEncode;
}

export interface RuleSearch {
    keyword?: string;
    ignoreKeyword?: string;
    keyCS?: boolean
    keyRegExp?: boolean;
    title?: boolean;
    description?: boolean;
    extended?: boolean;
    GR?: boolean;
    BS?: boolean;
    CS?: boolean;
    SKY?: boolean;
    station?: ServiceItemId;
    genrelv1?: ProgramGenreLv1;
    genrelv2?: ProgramGenreLv2;
    startTime?: number;
    timeRange?: number;
    week: number;
    isFree?: boolean;
    durationMin?: number;
    durationMax?: number;
}

export interface RuleOption {
    enable: boolean;
    directory?: string;
    recordedFormat?: string;
}

export interface RuleEncode {
    mode1: number;
    directory1?: string;
    mode2?: number;
    directory2?: string;
    mode3?: number;
    directory3?: string;
    delTs: boolean;
}

interface DiskStatus {
    free: number;
    used: number;
    total: number;
}

interface HLSStream {
    streamNumber: number;
}

interface StreamInfo {
    streamNumber: number;
    isEnable: boolean;
    viewCnt: number;
    isNull: boolean,
    type?: 'MpegTsLive' | 'RecordedHLS',
    channelId?: ServiceItemId,
    recordedId?: RecordedId,
    mode?: number,
    channelName?: string,
    title?: string,
    startAt?: UnixtimeMS,
    endAt?: UnixtimeMS,
    channelType?: ChannelType,
    description?: string,
    extended?: string,
}

