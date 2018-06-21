import * as apid from '../../../../node_modules/mirakurun/api';

export enum TableName {
    Services = 'Services',
    Programs = 'Programs',
    Rules = 'Rules',
    Recorded = 'Recorded',
    Encoded = 'Encoded',
    RecordedHistory = 'RecordedHistory',
}

export interface ServiceSchema {
    id: apid.ServiceItemId;
    serviceId: apid.ServiceId;
    networkId: apid.NetworkId;
    name: string;
    remoteControlKeyId: number | null;
    hasLogoData: boolean;
    channelType: apid.ChannelType;
    channelTypeId: number;
    channel: string;
    type: number | null; // 192 がワンセグ?
}

export interface ProgramSchema {
    id: apid.ProgramId;
    channelId: number;
    eventId: apid.EventId;
    serviceId: apid.ServiceId;
    networkId: apid.NetworkId;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
    startHour: number;
    week: number;
    duration: number;
    isFree: boolean;

    name: string;
    shortName: string | null;
    description: string | null;
    extended: string | null;
    genre1: number | null;
    genre2: number | null;
    channelType: apid.ChannelType;
    channel: string;

    videoType: apid.ProgramVideoType | null;
    videoResolution: apid.ProgramVideoResolution | null;
    videoStreamContent: number | null;
    videoComponentType: number | null;

    audioSamplingRate: apid.ProgramAudioSamplingRate | null;
    audioComponentType: number | null;
}

export interface RulesSchema {
    id: number;
    keyword: string | null;
    ignoreKeyword: string | null;
    keyCS: boolean | null;
    keyRegExp: boolean | null;
    title: boolean | null;
    description: boolean | null;
    extended: boolean | null;
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

export interface RecordedSchema {
    id: number;
    programId: apid.ProgramId;
    channelId: apid.ServiceItemId;
    channelType: apid.ChannelType;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
    duration: number;
    name: string;
    description: string | null;
    extended: string | null;
    genre1: number | null;
    genre2: number | null;
    videoType: apid.ProgramVideoType | null;
    videoResolution: apid.ProgramVideoResolution | null;
    videoStreamContent: number | null;
    videoComponentType: number | null;
    audioSamplingRate: apid.ProgramAudioSamplingRate | null;
    audioComponentType: number | null;
    recPath: string | null;
    ruleId: number | null;
    thumbnailPath: string | null;
    recording: boolean;
    protection: boolean;
    filesize: number | null;
}

export interface EncodedSchema {
    id: number;
    recordedId: number; // 外部キー
    name: string;
    path: string;
    filesize: number | null;
}

export interface RecordedHistorySchema {
    id: number;
    name: string;
    endAt: apid.UnixtimeMS;
}

export interface ScheduleProgramItem {
    id: apid.ProgramId;
    channelId: number;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
    isFree: boolean;
    name: string;
    description: string | null;
    extended: string | null;
    genre1: number | null;
    genre2: number | null;
    channelType: apid.ChannelType;

    videoType: apid.ProgramVideoType | null;
    videoResolution: apid.ProgramVideoResolution | null;
    videoStreamContent: number | null;
    videoComponentType: number | null;

    audioSamplingRate: apid.ProgramAudioSamplingRate | null;
    audioComponentType: number | null;
}

export interface RuleTag {
    cnt: number;
    ruleId: number | null;
}

export interface ChannelTag {
    cnt: number;
    channelId: number;
}

export interface GenreTag {
    cnt: number;
    genre1: number | null;
}

