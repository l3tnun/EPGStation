/**
 * 検索, ルール作成の定義
 */
export interface RuleInterface {
    search: SearchInterface;
    option: OptionInterface;
    encode?: EncodeInterface;
}

export interface SearchInterface {
    keyword?: string;
    ignoreKeyword?: string;
    // keyworoption
    keyCS?: boolean;
    keyRegExp?: boolean;
    title?: boolean;
    description?: boolean;
    extended?: boolean;
    // broadcast
    GR?: boolean;
    BS?: boolean;
    CS?: boolean;
    SKY?: boolean;
    station?: number;
    genrelv1?: number;
    genrelv2?: number;
    startTime?: number;
    timeRange?: number;
    week: number;
    isFree?: boolean;
    durationMin?: number;
    durationMax?: number;
    avoidDuplicate?: boolean;
    periodToAvoidDuplicate?: number;
}

export interface OptionInterface {
    enable: boolean;
    directory?: string;
    recordedFormat?: string;
}

export interface EncodeInterface {
    mode1?: number;
    directory1?: string;
    mode2?: number;
    directory2?: string;
    mode3?: number;
    directory3?: string;
    delTs: boolean;
}

