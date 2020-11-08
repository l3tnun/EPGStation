import * as apid from '../../api';
import * as Enums from '../Enums';

export interface HttpsConfig {
    port: number;
    key: string; // 秘密鍵
    cert: string; // 証明書
    ca?: string | string[]; // クライアント認証用秘密鍵
    socketioPort?: number;
}

export interface RecordedDirInfo {
    name: string;
    path: string;
    limitThreshold?: number; // 空き容量限界閾値 (MB)
    action?: 'remove' | 'none'; // 空き容量限界値を超えたときの動作
    limitCmd?: string; // 空き容量限界値を超えたときに実行するコマンド
}

export interface URLSchemeInfo {
    ios?: string;
    android?: string;
    mac?: string;
    win?: string;
}

export interface StreamingCmd {
    name: string;
    cmd?: string;
}

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

    subDirectory?: string;

    uid?: number | string; // uid
    gid?: number | string; // gid

    apiServers: string[];

    dbtype: Enums.DBType;
    sqlite?: {
        extensions: string[];
        regexp: boolean;
    };
    mysql?: {
        host: string;
        user: string;
        port: number;
        password: string;
        database: string;
    };
    postgres?: {
        host: string;
        user: string;
        port: number;
        database: string;
        password: string;
    };

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

    // サムネイル
    thumbnail: string;
    thumbnailCmd: string;
    thumbnailSize: string;
    thumbnailPosition: number;

    // drop log
    dropLog: string;
    isEnabledDropCheck: boolean; // drop check を有効にするか

    // upload
    uploadTempDir: string;

    ffmpeg: string;
    ffprobe: string;

    // エンコード設定
    encodeProcessNum: number; // エンコード、ストリーミング最大プロセス数
    concurrentEncodeNum: number; // 同時エンコード数
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
