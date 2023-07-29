import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as path from 'path';
import urljoin from 'url-join';
import IConfigFile from './IConfigFile';
import IConfiguration from './IConfiguration';
import ILogger from './ILogger';
import ILoggerModel from './ILoggerModel';

/**
 * Configuration
 * コンフィグ設定取得
 */
@injectable()
class Configuration implements IConfiguration {
    private templateConfig: IConfigFile | null = null;
    private config!: IConfigFile;
    private log: ILogger;

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();

        try {
            this.templateConfig = this.readConfig(Configuration.CONFIG_TEMPLATE_FILE_PATH, true);
        } catch (err: any) {
            this.templateConfig = null;
        }

        this.config = this.readConfig(Configuration.CONFIG_FILE_PATH, false);
        this.log.system.info('config.yml read success');

        fs.watchFile(Configuration.CONFIG_FILE_PATH, async () => {
            this.log.system.info('updated config file');
            try {
                const newConfig = <any>yaml.load(await fs.promises.readFile(Configuration.CONFIG_FILE_PATH, 'utf-8'));
                this.config = this.formatConfig(newConfig);
            } catch (err: any) {
                this.log.system.error('read config error');
                this.log.system.error(err);
            }
        });
    }

    /**
     * read config
     * @param configPath: ファイルパス
     * @param isWarning エラーを warning でログに残すか
     * @return IConfigFile
     */
    private readConfig(configPath: string, isWarning: boolean): IConfigFile {
        let str: string = '';
        try {
            str = fs.readFileSync(configPath, 'utf-8');
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                const errMsg = `${configPath} is not found`;
                if (isWarning === true) {
                    this.log.system.warn(errMsg);
                } else {
                    this.log.system.fatal(errMsg);
                }
            } else {
                if (isWarning === true) {
                    this.log.stream.warn(e);
                } else {
                    this.log.system.fatal(e);
                }
            }

            // warning 扱いの場合はエラーを throw する
            if (isWarning === true) {
                throw e;
            } else {
                process.exit(1);
            }
        }

        // parse configFile
        const newConfig: IConfigFile = <any>yaml.load(str);

        return this.formatConfig(newConfig);
    }

    /**
     * 引数で渡された config のデフォルト値設定 & 整形
     * @param newConfig: IConfigFile
     * @return IConfigFile
     */
    private formatConfig(newConfig: IConfigFile): IConfigFile {
        this.setTemplateValues(newConfig);

        // http or https の設定が存在するかチェック
        if (
            typeof newConfig.port === 'undefined' &&
            (typeof newConfig.https === 'undefined' ||
                typeof newConfig.https.port === 'undefined' ||
                typeof newConfig.https.key === 'undefined' ||
                typeof newConfig.https.cert === 'undefined')
        ) {
            this.log.system.fatal('port setting error');
            throw new Error('PortSettingError');
        }

        // set apiServes
        if (newConfig.apiServers.length === 0) {
            newConfig.apiServers.push(`http://localhost:${newConfig.port}`);
        }

        // subDirectory のパス整形
        if (typeof newConfig.subDirectory !== 'undefined') {
            newConfig.subDirectory = urljoin('/', newConfig.subDirectory).replace(/\/$/, '');
        }

        // recorded のパス整形
        for (let i = 0; i < newConfig.recorded.length; i++) {
            newConfig.recorded[i].path = this.directoryFormatting(newConfig.recorded[i].path);
        }

        // recorded の中に tmp があったら削除する
        newConfig.recorded = newConfig.recorded.filter(r => {
            return r.name !== 'tmp';
        });

        // recordedTmp のパス整形
        if (typeof newConfig.recordedTmp !== 'undefined') {
            newConfig.recordedTmp = this.directoryFormatting(newConfig.recordedTmp);
        }

        // thumbnail のパス整形
        newConfig.thumbnail = this.directoryFormatting(newConfig.thumbnail);

        // streamfiles のパス整形
        newConfig.streamFilePath = this.directoryFormatting(newConfig.streamFilePath);

        return newConfig;
    }

    /**
     * config デフォルト値をセットする
     * @param config: IConfigFile
     */
    private setTemplateValues(config: IConfigFile): void {
        for (const key in Configuration.DEFAULT_VALUE) {
            if (typeof (<any>config)[key] === 'undefined') {
                (<any>config)[key] = (<any>Configuration.DEFAULT_VALUE)[key];
            }
        }

        // stream のデフォルト値設定
        if (this.templateConfig !== null && typeof config.stream !== 'undefined') {
            if (typeof config.stream.live !== 'undefined' && typeof config.stream.live.ts !== 'undefined') {
                if (typeof config.stream.live.ts.m2ts === 'undefined') {
                    config.stream.live.ts.m2ts = this.templateConfig.stream?.live?.ts?.m2ts;
                }
                if (typeof config.stream.live.ts.m2tsll === 'undefined') {
                    config.stream.live.ts.m2tsll = this.templateConfig.stream?.live?.ts?.m2tsll;
                }
                if (typeof config.stream.live.ts.webm === 'undefined') {
                    config.stream.live.ts.webm = this.templateConfig.stream?.live?.ts?.webm;
                }
                if (typeof config.stream.live.ts.mp4 === 'undefined') {
                    config.stream.live.ts.mp4 = this.templateConfig.stream?.live?.ts?.mp4;
                }
                if (typeof config.stream.live.ts.hls === 'undefined') {
                    config.stream.live.ts.hls = this.templateConfig.stream?.live?.ts?.hls;
                }
            }

            if (typeof config.stream.recorded !== 'undefined') {
                if (typeof config.stream.recorded.ts !== 'undefined') {
                    if (typeof config.stream.recorded.ts.webm === 'undefined') {
                        config.stream.recorded.ts.webm = this.templateConfig.stream?.recorded?.ts?.webm;
                    }
                    if (typeof config.stream.recorded.ts.mp4 === 'undefined') {
                        config.stream.recorded.ts.mp4 = this.templateConfig.stream?.recorded?.ts?.mp4;
                    }
                    if (typeof config.stream.recorded.ts.hls === 'undefined') {
                        config.stream.recorded.ts.hls = this.templateConfig.stream?.recorded?.ts?.hls;
                    }
                }
                if (typeof config.stream.recorded.encoded !== 'undefined') {
                    if (typeof config.stream.recorded.encoded.webm === 'undefined') {
                        config.stream.recorded.encoded.webm = this.templateConfig.stream?.recorded?.encoded?.webm;
                    }
                    if (typeof config.stream.recorded.encoded.mp4 === 'undefined') {
                        config.stream.recorded.encoded.mp4 = this.templateConfig.stream?.recorded?.encoded?.mp4;
                    }
                    if (typeof config.stream.recorded.encoded.hls === 'undefined') {
                        config.stream.recorded.encoded.hls = this.templateConfig.stream?.recorded?.encoded?.hls;
                    }
                }
            }
        }
    }

    /**
     * 引数で渡されたディレクトリの末尾のパス区切り文字を削除する
     * @param dir: ディレクトリパス
     */
    private directoryFormatting(dir: string): string {
        return dir.replace('%ROOT%', Configuration.ROOT_PATH).replace(new RegExp(`\\${path.sep}$`), '');
    }

    /**
     * コンフィグ設定を返す
     */
    public getConfig(): IConfigFile {
        return JSON.parse(JSON.stringify(this.config));
    }
}

namespace Configuration {
    export const CONFIG_FILE_PATH = path.join(__dirname, '..', '..', 'config', 'config.yml');
    export const CONFIG_TEMPLATE_FILE_PATH = path.join(__dirname, '..', '..', 'config', 'config.yml.template');
    export const ROOT_PATH = path.join(__dirname, '..', '..').replace(new RegExp(`\\${path.sep}$`), '');

    export const DEFAULT_VALUE: IConfigFile = {
        mirakurunPath: 'http+unix://%2Fvar%2Frun%2Fmirakurun.sock/',
        apiServers: [],
        isAllowAllCORS: false,
        dbtype: 'sqlite',
        needToReplaceEnclosingCharacters: true,
        epgUpdateIntervalTime: 10,
        conflictPriority: 1,
        recPriority: 2,
        streamingPriority: 0,
        timeSpecifiedStartMargin: 1,
        timeSpecifiedEndMargin: 1,
        recordedFormat: '%YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE%',
        recordedFileExtension: '.ts',
        recorded: [
            {
                name: 'recorded',
                path: path.join(__dirname, '..', '..', 'recorded'),
            },
        ],
        recordedHistoryRetentionPeriodDays: 90,
        storageLimitCheckIntervalTime: 60,
        thumbnail: path.join(__dirname, '..', '..', 'thumbnail'),
        thumbnailCmd:
            '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%',
        thumbnailSize: '480x270',
        thumbnailPosition: 5,
        dropLog: path.join(__dirname, '..', '..', 'drop'),
        uploadTempDir: path.join(__dirname, '..', '..', 'data', 'upload'),
        isEnabledDropCheck: false,
        ffmpeg: '/usr/local/bin/ffmpeg',
        ffprobe: '/usr/local/bin/ffprobe',
        encodeProcessNum: 0,
        concurrentEncodeNum: 0,
        encode: [],
        isSuppressReservesUpdateAllLog: false,
        urlscheme: {
            m2ts: {
                ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL%3A%2F%2FADDRESS"',
                android: 'intent://ADDRESS#Intent;action=android.intent.action.VIEW;type=video/*;scheme=PROTOCOL;end',
            },
            video: {
                ios: 'infuse://x-callback-url/play?url=PROTOCOL://ADDRESS',
                android: 'intent://ADDRESS#Intent;action=android.intent.action.VIEW;type=video/*;scheme=PROTOCOL;end',
            },
            download: {
                ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL%3A%2F%2FADDRESS&filename=FILENAME',
            },
        },
        streamFilePath: path.join(__dirname, '..', '..', 'data', 'streamfiles'),
    };
}

export default Configuration;
