/**
* config.json の定義
*/
interface ConfigInterface {
    serverPort: number;
    mirakurunPath: string;
    mysql: {
        host: string,
        user: string,
        password: string,
        database: string,
        connectTimeout: number,
        connectionLimit: number,
    };
    continuousEPGUpdater: boolean;
    programInsertMax: number;
    programInsertWait: number;
    serviceOrder: number[],
    excludeServices: number[],
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
        name: string,
        cmd: string,
        suffix: string,
        default?: boolean,
    }[];
    delts: boolean;
    storageLimitCheckIntervalTime: number;
    storageLimitThreshold: number;
    storageLimitAction: 'remove' | 'none';
    storageLimitCmd: string;
    recordedViewer: {
        ios: string;
        android: string;
    };
    recordedDownloader: {
        ios: string;
        android: string;
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
    };
    streamFilePath: string;
    recordedHLS: {
        name: string;
        cmd: string;
    }[];
}

export default ConfigInterface;
