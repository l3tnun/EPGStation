export type UnixtimeMS = number;

export type ChannelId = number;
export type ServiceId = number;
export type NetworkId = number;
export type ProgramId = number;
export type RuleId = number;
export type ReserveId = number;
export type RecordedId = number;
export type RecordedHistoryId = number;
export type VideoFileId = number;
export type VideoFileType = 'ts' | 'encoded';
export type ThumbnailId = number;
export type DropLogFileId = number;
export type RecordedTagId = number;
export type EncodeId = number;
export type ChannelType = 'GR' | 'BS' | 'CS' | 'SKY';
export type ProgramGenreLv1 = number;
export type ProgramGenreLv2 = number;
export type ProgramVideoType = 'mpeg2' | 'h.264' | 'h.265';
export type ProgramVideoResolution = '240p' | '480i' | '480p' | '720p' | '1080i' | '2160p' | '4320p';
export type ProgramAudioSamplingRate = 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
export type RawExtended = { [description: string]: string };
export type StreamId = number;
export type StreamType = 'LiveStream' | 'LiveHLS' | 'RecordedStream' | 'RecordedHLS';

/**
 * チャンネル情報
 */
export interface ChannelItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    halfWidthName: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
    channel: string;
}

/**
 * 手動予約編集オプション
 */
export interface EditManualReserveOption {
    allowEndLack: boolean; // 末尾切れを許すか
    tags?: RecordedTagId[];
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * 手動予約オプション
 */
export interface ManualReserveOption extends EditManualReserveOption {
    programId?: ProgramId; // program ID undefined の場合は時刻指定予約
    timeSpecifiedOption?: {
        name: string;
        channelId: ChannelId;
        startAt: UnixtimeMS;
        endAt: UnixtimeMS;
    };
}

/**
 * 予約情報取得タイプ
 */
export type GetReserveType = 'all' | 'normal' | 'conflict' | 'skip' | 'overlap';

/**
 * 予約情報取得オプション
 */
export interface GetReserveOption {
    type?: GetReserveType;
    isHalfWidth: boolean;
    ruleId?: RuleId;
    offset?: number;
    limit?: number;
}

/**
 * 予約情報
 */
export interface Reserves {
    reserves: ReserveItem[];
    total: number;
}

/**
 * 予約番組情報
 */
export interface ReserveItem {
    /**
     * 予約情報
     */
    id: ReserveId;
    ruleId?: RuleId;
    isSkip: boolean;
    isConflict: boolean;
    isOverlap: boolean;
    allowEndLack: boolean;
    isTimeSpecified: boolean;
    tags?: RecordedTagId[];
    /**
     * 保存オプション
     */
    parentDirectoryName?: string;
    directory?: string;
    recordedFormat?: string;
    /**
     * エンコード情報
     */
    encodeMode1?: string;
    encodeParentDirectoryName1?: string;
    encodeDirectory1?: string;
    encodeMode2?: string;
    encodeParentDirectoryName2?: string;
    encodeDirectory2?: string;
    encodeMode3?: string;
    encodeParentDirectoryName3?: string;
    encodeDirectory3?: string;
    isDeleteOriginalAfterEncode: boolean;
    /**
     * 番組情報
     */
    programId?: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 予約情報のリスト取得オプション
 */
export interface GetReserveListsOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * 予約情報のリスト
 * 予約, 除外, 重複, 競合の reserveId リスト
 */
export interface ReserveLists {
    normal: ReserveListItem[];
    conflicts: ReserveListItem[];
    skips: ReserveListItem[];
    overlaps: ReserveListItem[];
}

/**
 * 予約リストitem
 */
export interface ReserveListItem {
    reserveId: ReserveId;
    programId?: ProgramId;
    ruleId?: RuleId;
}

export interface ReserveCnts {
    normal: number;
    conflicts: number;
    skips: number;
    overlaps: number;
}

/**
 * 放送波の状態
 * true のもが有効
 */
export interface BroadcastStatus {
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
}

/**
 * Rule
 */
export interface Rule extends AddRuleOption {
    id: RuleId;
    reservesCnt?: number;
}

export interface RuleKeywordItem {
    id: RuleId;
    keyword: string;
}

/**
 * ルールのキーワード検索結果
 */
export interface RuleKeywordInfo {
    items: RuleKeywordItem[];
}

/**
 * Rule 追加オプション
 */
export interface AddRuleOption {
    isTimeSpecification: boolean;
    searchOption: RuleSearchOption;
    reserveOption: RuleReserveOption;
    saveOption?: ReserveSaveOption;
    encodeOption?: ReserveEncodedOption;
}

/**
 * ジャンル
 */
export interface Genre {
    genre: ProgramGenreLv1;
    subGenre?: ProgramGenreLv2;
}

/**
 * 時刻指定
 * program id 予約の場合は動画の長さ
 * 時刻指定予約の場合は時刻範囲 (0 ~  60 * 24)
 */
export interface SearchTime {
    // program id 予約の場合は 0 ~ 23 時の開始時刻を指定する
    // 時刻予約の場合は 0 時を 0 とした 0 ~ (60 * 50 * 24) - 1 秒までの開始時刻を指定する
    start?: number;
    // program id 予約の場合は 1 ~ 23 時間の長さを指定する
    // 時刻予約の場合は秒で時間の長さを指定する 1 ~ 60 * 50 * 24 秒
    range?: number;
    // 曜日指定 0x01, 0x02, 0x04, 0x08, 0x10, 0x20 ,0x40 が日〜土に対応するので and 演算で曜日を指定する
    week: number;
}

/**
 * 検索期間指定
 */
export interface SearchPeriod {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
}

/**
 * Rule 検索オプション
 */
export interface RuleSearchOption {
    keyword?: string; // 検索キーワード
    ignoreKeyword?: string; // 除外検索キーワード
    keyCS?: boolean; // 大文字小文字区別有効化 (検索キーワード)
    keyRegExp?: boolean; // 正規表現 (検索キーワード)
    name?: boolean; // 番組名 (検索キーワード)
    description?: boolean; // 概要 (検索キーワード)
    extended?: boolean; // 詳細 (検索キーワード)
    ignoreKeyCS?: boolean; // 大文字小文字区別有効化 (除外検索キーワード)
    ignoreKeyRegExp?: boolean; // 正規表現 (除外検索キーワード)
    ignoreName?: boolean; // 番組名 (除外検索キーワード)
    ignoreDescription?: boolean; // 概要 (除外検索キーワード)
    ignoreExtended?: boolean; // 詳細 (除外検索キーワード)
    GR?: boolean; // GR
    BS?: boolean; // BS
    CS?: boolean; // CS
    SKY?: boolean; // SKY
    channelIds?: ChannelId[]; // channels ids
    genres?: Genre[];
    times?: SearchTime[]; // 開始時間からの有効時間
    isFree?: boolean; // 無料放送か
    durationMin?: number; // 番組最小時間
    durationMax?: number; // 番組最大時間
    searchPeriods?: SearchPeriod[]; // 検索対象期間
}

/**
 * ルール予約オプション
 */
export interface RuleReserveOption {
    enable: boolean; // ルールが有効か
    allowEndLack: boolean; // 末尾切れを許可するか
    avoidDuplicate: boolean; // 録画済みの重複番組を排除するか
    periodToAvoidDuplicate?: number; // 重複を避ける期間
    tags?: RecordedTagId[]; // 録画完了後に付与する tag 設定
}

/**
 * 保存オプション
 */
export interface ReserveSaveOption {
    parentDirectoryName?: string; // 親保存ディレクトリ
    directory?: string; // 保存ディレクトリ
    recordedFormat?: string; // ファイル名フォーマット
}

/**
 * エンコードオプション
 */
export interface ReserveEncodedOption {
    mode1?: string; // エンコードモード
    encodeParentDirectoryName1?: string; // 親保存ディレクトリ
    directory1?: string; // 保存先ディレクトリ
    mode2?: string;
    encodeParentDirectoryName2?: string;
    directory2?: string;
    mode3?: string;
    encodeParentDirectoryName3?: string;
    directory3?: string;
    isDeleteOriginalAfterEncode: boolean;
}

/**
 * ルール情報
 */
export interface Rules {
    rules: Rule[];
    total: number;
}

/**
 * ルール情報取得オプション
 */
export interface GetRuleOption {
    offset?: number;
    limit?: number;
    type?: GetReserveType;
    keyword?: string;
}

/**
 * 録画一覧情報
 */
export interface Records {
    records: RecordedItem[];
    total: number;
}

/**
 * Recorded
 */
export interface RecordedItem {
    id: RecordedId;
    ruleId?: RuleId;
    programId?: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
    isRecording: boolean;
    thumbnails?: ThumbnailId[];
    videoFiles?: VideoFile[];
    dropLogFile?: DropLogFile;
    tags?: RecordedTag[];
    isEncoding: boolean;
    isProtected: boolean;
}

/**
 * VideoFile
 */
export interface VideoFile {
    id: VideoFileId;
    name: string;
    filename: string;
    type: VideoFileType;
    size: number;
}

export interface DropLogFile {
    id: DropLogFileId;
    errorCnt: number;
    dropCnt: number;
    scramblingCnt: number;
}

/**
 * Recorded tag
 */
export interface RecordedTag {
    id: RecordedTagId;
    name: string;
    color: string;
}

export interface RecordedTags {
    tags: RecordedTag[];
    total: number;
}

/**
 * recorded 取得オプション
 */
export interface GetRecordedOption {
    isHalfWidth: boolean;
    offset?: number;
    limit?: number;
    isReverse?: boolean;
    ruleId?: RuleId;
    channelId?: ChannelId;
    genre?: ProgramGenreLv1;
    keyword?: string;
    hasOriginalFile?: boolean;
}

/**
 * recorded が持つ channelId のリスト
 */
export interface RecordedChannelListItem {
    cnt: number; // 個数
    channelId: ChannelId; // 放送局 id
}

/**
 * recorded が持つ genre のリスト
 */
export interface RecordedGenreListItem {
    cnt: number; // 個数
    genre: ProgramGenreLv1; // ジャンル
}

/**
 * recorded が持つ検索オプションリスト
 */
export interface RecordedSearchOptions {
    channels: RecordedChannelListItem[];
    genres: RecordedGenreListItem[];
}

/**
 * tag 取得オプション
 */
export interface GetRecordedTagOption {
    offset?: number;
    limit?: number;
    name?: string;
    excludeTagId?: RecordedTagId[];
}

/**
 * URL Scheme 情報
 */
export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface M2TSStreamParam {
    name: string;
    isUnconverted: boolean; // 無変換か
}

/**
 * クライアントが受け取る設定情報
 */
export interface Config {
    socketIOPort: number;
    broadcast: BroadcastStatus;
    recorded: string[];
    encode: string[];
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };
    isEnableTSLiveStream: boolean;
    isEnableTSRecordedStream: boolean;
    isEnableEncodedRecordedStream: boolean;
    streamConfig?: {
        live?: {
            ts?: {
                m2ts?: M2TSStreamParam[];
                m2tsll?: string[];
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
        recorded?: {
            ts?: {
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
            encoded?: {
                webm?: string[];
                mp4?: string[];
                hls?: string[];
            };
        };
    };
    kodiHosts?: string[];
}

/**
 * 放送波指定の番組表情報取得オプション
 */
export interface ScheduleOption {
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    GR: boolean;
    BS: boolean;
    CS: boolean;
    SKY: boolean;
}

/**
 * チャンネル指定の番組情報取得オプション
 */
export interface ChannelScheduleOption {
    startAt: UnixtimeMS;
    days: number; // 取得日数
    isHalfWidth: boolean;
    needsRawExtended?: boolean;
    isFree?: boolean;
    channelId: ChannelId;
}

export interface BroadcastingScheduleOption {
    time?: UnixtimeMS; // 追加時間 (ms)
    isHalfWidth: boolean;
}

/**
 * 番組表の放送局データ
 */
export interface ScheduleChannleItem {
    id: ChannelId;
    serviceId: ServiceId;
    networkId: NetworkId;
    name: string;
    remoteControlKeyId?: number;
    hasLogoData: boolean;
    channelType: ChannelType;
}

/**
 * 番組表の番組データ
 */
export interface ScheduleProgramItem {
    id: ProgramId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    isFree: boolean;
    name: string;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
    videoType?: ProgramVideoType;
    videoResolution?: ProgramVideoResolution;
    videoStreamContent?: number;
    videoComponentType?: number;
    audioSamplingRate?: ProgramAudioSamplingRate;
    audioComponentType?: number;
}

/**
 * 番組表データ
 */
export interface Schedule {
    channel: ScheduleChannleItem;
    programs: ScheduleProgramItem[];
}

/**
 * 番組検索オプション
 */
export interface ScheduleSearchOption {
    option: RuleSearchOption;
    isHalfWidth: boolean;
    limit?: number;
}

/**
 * Encode
 */

/**
 * エンコード情報
 */
export interface EncodeInfo {
    runningItems: EncodeProgramItem[]; // エンコード中
    waitItems: EncodeProgramItem[]; // エンコード待ち
}

export interface EncodeProgramItem {
    id: EncodeId;
    mode: string;
    recorded: RecordedItem;
    percent?: number;
    log?: string;
}

/**
 * エンコード追加オプション
 */
export interface AddEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir: string; // 親ディレクトリ config recorded の name
    directory?: string; // 親ディレクトリ以下のディレクトリ設定
    mode: string; // config encode の name
    removeOriginal: boolean;
}

export interface AddManualEncodeProgramOption {
    recordedId: RecordedId;
    sourceVideoFileId: VideoFileId;
    parentDir?: string; // isSaveSameDirectory が false の場合は必須
    directory?: string;
    isSaveSameDirectory?: boolean; // ソースビデオファイルと同じ場所に保存する
    mode: string; // config encode の name
    removeOriginal: boolean;
}

/**
 * ライブストリームオプション
 */
export interface LiveStreamOption {
    channelId: ChannelId;
    mode: number; // config 設定
}

export interface RecordedStreanOption {
    videoFileId: VideoFileId;
    playPosition: number; // 再生位置 (秒)
    mode: number; // config 設定
}
/**
 * ライブストリーム情報
 */
export interface LiveStreamInfoItem {
    streamId: StreamId;
    type: StreamType;
    mode: number;
    isEnable: boolean;
    channelId: ChannelId;
    name: string;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    description?: string;
    extended?: string;
    rawExtended?: RawExtended;
}

/**
 * ビデオファイルストリーム情報
 */
export interface VideoFileStreamInfoItem extends LiveStreamInfoItem {
    viodeFileId: VideoFileId;
    recordedId: RecordedId;
}

/**
 * アップロードするビデオ情報
 */
export interface UploadVideoFileOption {
    recordedId: RecordedId; // 紐付ける recorded id
    parentDirectoryName: string; // 保存先ディレクトリ名
    subDirectory?: string; // 保存先サブディレクトリ
    viewName: string; // UI 上での表示名
    fileType: VideoFileType; // ファイルタイプ
    file: File; // ファイル
}

/**
 * 新規追加する録画番組情報
 */
export interface CreateNewRecordedOption {
    ruleId?: RuleId;
    channelId: ChannelId;
    startAt: UnixtimeMS;
    endAt: UnixtimeMS;
    name: string;
    description?: string;
    extended?: string;
    genre1?: ProgramGenreLv1;
    subGenre1?: ProgramGenreLv2;
    genre2?: ProgramGenreLv1;
    subGenre2?: ProgramGenreLv2;
    genre3?: ProgramGenreLv1;
    subGenre3?: ProgramGenreLv2;
}

/**
 * ストリーム情報
 */
export interface StreamInfo {
    items: (LiveStreamInfoItem | VideoFileStreamInfoItem)[];
}

/**
 * ディスク使用情報
 */
export interface DiskUsage {
    available: number;
    used: number;
    total: number;
}

/**
 * ディスク使用状況 + 名称
 */
export interface StorageItem extends DiskUsage {
    name: string;
}

/**
 * ディスク情報
 */
export interface StorageInfo {
    items: StorageItem[];
}

/**
 * バージョン情報
 */
export interface VersionInfo {
    version: string;
}
