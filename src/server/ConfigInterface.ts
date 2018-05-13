/**
 * config.json の定義
 */
interface ConfigInterface {
    readOnlyOnce: boolean;
    serverPort: number;
    mirakurunPath: string;
    dbType: 'mysql' | 'sqlite3' | 'postgresql';
    dbPath: string;
    dbInfoPath: string;
    mysql: {
        host: string;
        user: string;
        password: string;
        database: string;
        connectTimeout: number;
        connectionLimit: number;
        connectionTimeoutMillis: number;
    };
    sqlite3: {
        extensions: string[];
        regexp: boolean;
    };
    postgresql: {
        host: string;
        port: number;
        user: string;
        database: string;
        password: string;
        idleTimeoutMillis: number;
    };
    basicAuth: {
        user: string;
        password: string;
    };
    gid: string | number;
    uid: string | number;
    programInsertMax: number;
    programInsertWait: number;
    serviceOrder: number[];
    excludeServices: number[];
    reserves: string;
    recPriority: number;
    conflictPriority: number;
    recorded: string;
    recordedStartCommand: string;
    recordedEndCommand: string;
    recordedFormat: string;
    fileExtension: string;
    reservesUpdateIntervalTime: number;
    thumbnail: string;
    thumbnailSize: string;
    thumbnailPosition: number;
    ffmpeg: string;
    ffprobe: string;
    maxEncode: number;
    encode: {
        name: string;
        cmd: string;
        suffix?: string; // 非エンコードコマンドの場合 undefined
        rate?: number;
        default?: boolean;
    }[];
    delts: boolean;
    tsModify: {
        cmd: string;
        rate?: number;
    };
    storageLimitCheckIntervalTime: number;
    storageLimitThreshold: number;
    storageLimitAction: 'remove' | 'none';
    storageLimitCmd: string;
    recordedViewer: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    recordedDownloader: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };

    maxStreaming: number;
    streamingPriority: number;
    mpegTsStreaming: {
        name: string;
        cmd: string;
    }[];
    mpegTsViewer: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    recordedStreaming: {
        mpegTs: {
            name: string;
            cmd: string;
            vb: string;
            ab: string;
        }[];
        webm: {
            name: string;
            cmd: string;
            vb: string;
            ab: string;
        }[];
        mp4: {
            name: string;
            cmd: string;
            vb: string;
            ab: string;
        }[];
    };
    streamFilePath: string;
    recordedHLS: {
        name: string;
        cmd: string;
    }[];
    liveHLS: {
        name: string;
        cmd: string;
    }[];
    HLSViewer: {
        ios: string;
        android: string;
        mac: string;
        win: string;
    };
    liveWebM: {
        name: string;
        cmd: string;
    }[];
    kodiHosts: {
        name: string;
        host: string;
        user?: string;
        pass?: string;
    }[];
}

export default ConfigInterface;
