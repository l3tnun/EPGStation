export type ProgramId = number;
export type ServiceItemId = number;
export type UnixtimeMS = number;
export type ChannelType = 'GR' | 'BS' | 'CS' | 'SKY';
export type ProgramVideoType = 'mpeg2' | 'h.264' | 'h.265';
export type ProgramVideoResolution = '240p' | '480i' | '480p' | '720p' | '1080i' | '2160p' | '4320p';
export enum ProgramAudioSamplingRate {
    '16kHz' = 16000,
    '22.05kHz' = 22050,
    '24kHz' = 24000,
    '32kHz' = 32000,
    '44.1kHz' = 44100,
    '48kHz' = 48000,
}

export interface OldRuleItem {
    id: number;
    keyword: string | null;
    halfKeyword: string | null;
    ignoreKeyword: string | null;
    halfIgnoreKeyword: string | null;
    keyCS: boolean | null;
    keyRegExp: boolean | null;
    title: boolean | null;
    description: boolean | null;
    extended: boolean | null;
    ignoreKeyCS: boolean | null;
    ignoreKeyRegExp: boolean | null;
    ignoreTitle: boolean | null;
    ignoreDescription: boolean | null;
    ignoreExtended: boolean | null;
    GR: boolean | null;
    BS: boolean | null;
    CS: boolean | null;
    SKY: boolean | null;
    station: number | null;
    genrelv1: number | null;
    genrelv2: number | null;
    startTime: number | null;
    timeRange: number | null;
    week: number;
    isFree: boolean | null;
    durationMin: number | null;
    durationMax: number | null;
    avoidDuplicate: boolean;
    periodToAvoidDuplicate: number | null;
    enable: boolean;
    allowEndLack: boolean;
    directory: string | null;
    recordedFormat: string | null;
    mode1?: number | null;
    directory1: string | null;
    mode2: number | null;
    directory2: string | null;
    mode3: number | null;
    directory3: string | null;
    delTs: boolean | null;
}

export interface OldRecordedItem {
    id: number;
    programId: ProgramId;
    channelId: ServiceItemId;
    channelType: ChannelType;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    duration: number;
    name: string;
    description: string | null;
    extended: string | null;
    genre1: number | null;
    genre2: number | null;
    genre3: number | null;
    genre4: number | null;
    genre5: number | null;
    genre6: number | null;
    videoType: ProgramVideoType | null;
    videoResolution: ProgramVideoResolution | null;
    videoStreamContent: number | null;
    videoComponentType: number | null;
    audioSamplingRate: ProgramAudioSamplingRate | null;
    audioComponentType: number | null;
    recPath: string | null;
    ruleId: number | null;
    thumbnailPath: string | null;
    recording: boolean;
    protection: boolean;
    filesize: number | null;
    logPath: string | null;
    errorCnt: number | null;
    dropCnt: number | null;
    scramblingCnt: number | null;
    isTmp: boolean;
}

export interface OldEncodedItem {
    id: number;
    recordedId: number; // 外部キー
    name: string;
    path: string;
    filesize: number | null;
}

export interface OldRecordedHistoryItem {
    id: number;
    name: string;
    channelId: number;
    endAt: UnixtimeMS;
}

export interface DBRevisionInfo {
    revision: number;
}

export interface OldBackupData {
    rules: OldRuleItem[];
    recorded: OldRecordedItem[];
    encoded: OldEncodedItem[];
    recordedHistory: OldRecordedHistoryItem[];
    dbRevisionInfo: DBRevisionInfo;
}
