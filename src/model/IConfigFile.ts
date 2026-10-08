import type * as apid from '../../api.js';
import * as Enums from '../Enums.js';

/**
 * HTTPS で待ち受ける場合の証明書一式とポート設定。config.yml の `https` キーに対応する。
 * 未設定（`IConfigFile.https`が`undefined`）の場合はHTTPSを待ち受けない。
 */
export interface HttpsConfig {
    port: number;
    key: string; // 秘密鍵
    cert: string; // 証明書
    ca?: string | string[]; // クライアント認証用秘密鍵
    socketioPort?: number;
}

/**
 * 録画保存先ディレクトリ1件分の設定。config.yml `recorded` 配列の要素に対応する
 * （複数指定でき、`recording/RecordingUtilModel`側が空き容量等を見て使用先を選ぶ）。
 */
export interface RecordedDirInfo {
    name: string;
    path: string;
    limitThreshold?: number; // 空き容量限界閾値 (MB)
    action?: 'remove' | 'none'; // 空き容量限界値を超えたときの動作
    limitCmd?: string; // 空き容量限界値を超えたときに実行するコマンド
}

/**
 * クライアントから外部アプリを起動させるための URL scheme 設定。`m2ts`/`video`/`download`
 * それぞれの配信種別ごとに、OSやプラットフォーム別のscheme文字列を保持する。
 */
export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

/**
 * 配信・エンコードで使うコマンド定義1件（表示名と、実行するコマンドのテンプレート文字列）。
 * `cmd`が未設定の場合はコマンド実行を伴わない方式（後段の実装依存）を表す。
 */
export interface StreamingCmd {
    name: string;
    cmd?: string;
}

/** Kodi 連携（録画済みファイルの送信先）1台分の接続設定。config.yml `kodiHosts` 配列の要素。 */
export interface KodiInfo {
    name: string;
    host: string;
    user?: string;
    password?: string;
}

/**
 * config ファイル形式
 */
export default interface IConfigFile {
    port?: number;
    socketioPort?: number;
    clientSocketioPort?: number;
    https?: HttpsConfig;
    mirakurunPath: string;
    tunerRestRequestTimeoutMs?: unknown;
    tunerStreamEstablishmentTimeoutMs?: unknown;

    subDirectory?: string;

    uid?: number | string; // uid
    gid?: number | string; // gid

    apiServers: string[];

    isAllowAllCORS: boolean;

    dbtype: Enums.DBType;
    sqlite?: {
        extensions?: string[];
        regexp?: boolean;
    };
    mysql?: {
        host: string;
        user: string;
        port: number;
        password: string;
        database: string;
        charset?: string;
    };
    postgres?: {
        host: string;
        user: string;
        port: number;
        database: string;
        password: string;
    };

    // 囲み文字を置換するか
    needToReplaceEnclosingCharacters: boolean;

    // epg 更新時間間隔 (分)
    epgUpdateIntervalTime: number;

    // 放送局並び順
    channelOrder?: apid.ChannelId[];
    sidOrder?: apid.ServiceId[];

    // 放送局除外設定
    excludeChannels?: apid.ChannelId[];
    excludeSids?: apid.ServiceId[];

    // priority 設定
    recPriority: number;
    conflictPriority: number;
    streamingPriority: number;

    // 時刻指定予約マージン
    timeSpecifiedStartMargin: number;
    timeSpecifiedEndMargin: number;

    // 録画ファイル名フォーマット
    recordedFormat: string;

    // 拡張子
    recordedFileExtension: string;

    // 録画ディレクトリ
    recorded: RecordedDirInfo[];
    // 録画一時ディレクトリ
    recordedTmp?: string;

    // 録画履歴保存期間
    recordedHistoryRetentionPeriodDays: number;

    // ストレージ空き容量チェック間隔 (秒)
    storageLimitCheckIntervalTime: number;
    storageLimitCommandTimeoutMs?: unknown;

    // サムネイル
    thumbnail: string;
    thumbnailCmd: string;
    thumbnailSize: string;
    thumbnailPosition: number;
    thumbnailMaxPending: number;

    // drop log
    dropLog: string;
    isEnabledDropCheck: boolean; // drop check を有効にするか

    // upload
    uploadTempDir: string;
    concurrentUploadNum: number;
    uploadReceiveTimeoutMs: number;

    ffmpeg: string;
    ffprobe: string;

    // エンコード設定
    encodeProcessNum: number; // エンコード、ストリーミング最大プロセス数
    concurrentEncodeNum: number; // 同時エンコード数
    encodeQueueLimit: number;
    encode: {
        name: string;
        cmd: string;
        suffix?: string; // 非エンコードコマンドの場合 undefined
        rate?: number;
    }[];

    // 予約定期更新時のログ出力を抑えるか
    isSuppressReservesUpdateAllLog: boolean;

    // 各種フックコマンド
    reserveNewAddtionCommand?: string; // 予約新規追加
    reserveUpdateCommand?: string; // 予約情報更新
    reservedeletedCommand?: string; // 予約削除
    recordingPreStartCommand?: string; // 録画準備開始
    recordingPrepRecFailedCommand?: string; // 録画準備失敗
    recordingStartCommand?: string; // 録画開始
    recordingFinishCommand?: string; // 録画終了
    recordingFailedCommand?: string; // 録画中のエラー
    encodingFinishCommand?: string; // エンコード終了
    hookCommandMaxPending: number;
    hookCommandTimeoutMs: number;

    // 視聴 URL Scheme 設定
    urlscheme: {
        m2ts: URLSchemeInfo;
        video: URLSchemeInfo;
        download: URLSchemeInfo;
    };

    streamFilePath: string;
    stream?: {
        live?: {
            ts?: {
                m2ts?: StreamingCmd[];
                m2tsll?: StreamingCmd[];
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
        recorded?: {
            ts?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
            encoded?: {
                webm?: StreamingCmd[];
                mp4?: StreamingCmd[];
                hls?: StreamingCmd[];
            };
        };
    };

    // 配信先 kodi 設定
    kodiHosts?: KodiInfo[];
}
