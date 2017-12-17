/**
* config.json の定義
*/
interface ConfigInterface {
    serverPort: number;
    mirakurunPath: string;
    dbType: 'mysql' | 'sqlite3' | 'postgres';
    dbPath: string;
    mysql: {
        host: string;
        user: string;
        password: string;
        database: string;
        connectTimeout: number;
        connectionLimit: number;
    };
    sqlite3: {
        extensions: string[];
        regexp: boolean;
    };
    postgres: {
        host: string;
        port: number;
        user: string;
        database: string;
        password: string;
        idleTimeoutMillis: number;
    }
    gid: string | number;
    uid: string | number;
    continuousEPGUpdater: boolean;
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
    maxEncode: number;
    encode: {
        name: string;
        cmd: string;
        suffix: string;
        rate?: number;
        default?: boolean;
    }[];
    delts: boolean;
    storageLimitCheckIntervalTime: number;
    storageLimitThreshold: number;
    storageLimitAction: 'remove' | 'none';
    storageLimitCmd: string;
    recordedViewer: {
        ios: string;
        android: string;
        mac: string;
    };
    recordedDownloader: {
        ios: string;
        android: string;
        mac: string;
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
    };
    streamFilePath: string;
    recordedHLS: {
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
