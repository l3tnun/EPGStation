import { inject, injectable } from 'inversify';
import { load as loadYaml } from 'js-yaml';
// lodash 本体は UMD で、名前付き export を静的に読み取れない。使う関数を直接読む。
import cloneDeep from 'lodash/cloneDeep.js';
import * as path from 'path';
import urljoin from 'url-join';
import * as ConfigYaml from './ConfigYaml.js';
import IConfigFile from './IConfigFile.js';
import ConfigurationFileAccess from './ConfigurationFileAccess.js';
import IConfiguration from './IConfiguration.js';
import IConfigurationFileAccess, { ConfigurationChangeListener } from './IConfigurationFileAccess.js';
import ILogger from './ILogger.js';
import ILoggerModel from './ILoggerModel.js';

/**
 * `IConfiguration` の実装。起動時に config.yml（無ければ config.yml.template を雛形として）を
 * 読み込み、デフォルト値の補完・値の検証・パス整形（`formatConfig`）を行った結果を保持する。
 * `IConfigurationFileAccess.watch` で config.yml の変更を監視しており、変更を検知すると
 * 保持している設定を再読み込みで丸ごと差し替える。他の Model は `getConfig()` を通じてのみ
 * 設定へアクセスし、返り値は都度 deep clone するため、呼び出し側が変更しても保持中の設定には
 * 影響しない。
 */
@injectable()
class Configuration implements IConfiguration {
    /** config.yml.template から読み込んだ雛形設定。テンプレートが存在しない/読めない場合は
     *  `null` のままで、`setTemplateValues` での stream 系デフォルト値補完をスキップする。
     *  constructor 時に一度だけ設定され、以降変化しない。 */
    private templateConfig: IConfigFile | null = null;
    /** 現在有効な設定。constructor で初回読み込みされ、以後は `changeListener` が config.yml の
     *  変更を検知するたびに読み込み直した内容へ丸ごと差し替わる。 */
    private config!: IConfigFile;
    private log: ILogger;
    /** 設定ファイルの実 I/O（読み込み・変更監視）を委譲する先。constructor の DI で注入され、
     *  テスト時には差し替え用の実装に置き換えられる。 */
    private readonly fileAccess: IConfigurationFileAccess;
    /** config.yml の変更検知時に呼ばれるコールバック本体。constructor で一度だけ生成し、
     *  `fileAccess.watch` へ渡す。`unwatch` する際に同一の参照が要るため field で保持している。 */
    private readonly changeListener: ConfigurationChangeListener;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfigurationFileAccess') fileAccess: IConfigurationFileAccess = new ConfigurationFileAccess(),
    ) {
        this.log = logger.getLogger();
        this.fileAccess = fileAccess;

        try {
            this.templateConfig = this.readConfig(this.fileAccess.templatePath, true);
        } catch {
            // Missing or unreadable optional template leaves templateConfig at null.
        }

        this.config = this.readConfig(this.fileAccess.configPath, false);
        this.log.system.info('config.yml read success');

        this.changeListener = async () => {
            this.log.system.info('updated config file');
            try {
                const newConfig = <any>(
                    loadYaml(await this.fileAccess.read(this.fileAccess.configPath), Configuration.CONFIG_YAML_OPTIONS)
                );
                this.config = this.formatConfig(newConfig);
            } catch (err: any) {
                this.log.system.error('read config error');
                this.log.system.error(err);
            }
        };
        this.fileAccess.watch(this.fileAccess.configPath, this.changeListener);
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
            str = this.fileAccess.readSync(configPath);
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
        const newConfig: IConfigFile = <any>loadYaml(str, Configuration.CONFIG_YAML_OPTIONS);

        return this.formatConfig(newConfig);
    }

    /**
     * 引数で渡された config のデフォルト値設定 & 整形
     * @param newConfig: IConfigFile
     * @return IConfigFile
     */
    private formatConfig(newConfig: IConfigFile): IConfigFile {
        this.setTemplateValues(newConfig);
        newConfig.dbtype = ConfigYaml.normalizeDBType(newConfig.dbtype);

        this.assertPositiveSafeInteger('encodeQueueLimit', newConfig.encodeQueueLimit);
        this.assertPositiveSafeInteger('concurrentUploadNum', newConfig.concurrentUploadNum);
        this.assertIntegerInRange(
            'uploadReceiveTimeoutMs',
            newConfig.uploadReceiveTimeoutMs,
            Configuration.SETTIMEOUT_DELAY_MAX_MS,
        );
        this.assertIntegerInRange(
            'thumbnailMaxPending',
            newConfig.thumbnailMaxPending,
            Configuration.PENDING_QUEUE_SAFETY_LIMIT,
        );
        this.assertIntegerInRange(
            'hookCommandMaxPending',
            newConfig.hookCommandMaxPending,
            Configuration.PENDING_QUEUE_SAFETY_LIMIT,
        );
        this.assertIntegerInRange(
            'hookCommandTimeoutMs',
            newConfig.hookCommandTimeoutMs,
            Configuration.SETTIMEOUT_DELAY_MAX_MS,
        );

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
     * value が 1 以上の安全な整数であることを検証する
     * @param field: エラー message に含める設定項目名
     * @param value: 検証対象の値
     * @throws Error ConfigValueError:${field}
     */
    private assertPositiveSafeInteger(field: string, value: number): void {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new Error(`ConfigValueError:${field}`);
        }
    }

    /**
     * value が 1 以上 maximum 以下の整数であることを検証する
     * @param field: エラー message に含める設定項目名
     * @param value: 検証対象の値
     * @param maximum: 許容する上限値
     * @throws Error ConfigValueError:${field}
     */
    private assertIntegerInRange(field: string, value: number, maximum: number): void {
        if (!Number.isInteger(value) || value < 1 || value > maximum) {
            throw new Error(`ConfigValueError:${field}`);
        }
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

        // urlscheme はカテゴリ (m2ts / video / download) 単位でも既定値を補う。config.yml が
        // urlscheme 自体を省略した場合は直前のループで DEFAULT_VALUE.urlscheme が丸ごと入るが、
        // urlscheme はあるものの一部カテゴリ (例: download) だけを省略または null にしている場合、
        // config.urlscheme 自体は undefined ではないため直前のループでは補われず、そのカテゴリが
        // undefined/null のまま残って参照時に例外になる。カテゴリ単位でも個別に補う。
        if (typeof config.urlscheme === 'undefined' || config.urlscheme === null) {
            (<any>config).urlscheme = Configuration.DEFAULT_VALUE.urlscheme;
        } else {
            for (const category of ['m2ts', 'video', 'download'] as const) {
                if (
                    typeof (<any>config.urlscheme)[category] === 'undefined' ||
                    (<any>config.urlscheme)[category] === null
                ) {
                    (<any>config.urlscheme)[category] = (<any>Configuration.DEFAULT_VALUE.urlscheme)[category];
                }
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
        const hasRawStorageTimeout = Object.prototype.hasOwnProperty.call(this.config, 'storageLimitCommandTimeoutMs');
        const hasRawTunerRestTimeout = Object.prototype.hasOwnProperty.call(this.config, 'tunerRestRequestTimeoutMs');
        const hasRawTunerStreamTimeout = Object.prototype.hasOwnProperty.call(
            this.config,
            'tunerStreamEstablishmentTimeoutMs',
        );
        const cloneSource = { ...this.config };

        delete cloneSource.storageLimitCommandTimeoutMs;
        delete cloneSource.tunerRestRequestTimeoutMs;
        delete cloneSource.tunerStreamEstablishmentTimeoutMs;

        const clonedConfig = JSON.parse(JSON.stringify(cloneSource)) as IConfigFile;

        if (hasRawStorageTimeout) {
            clonedConfig.storageLimitCommandTimeoutMs = cloneDeep(this.config.storageLimitCommandTimeoutMs);
        }
        if (hasRawTunerRestTimeout) {
            clonedConfig.tunerRestRequestTimeoutMs = cloneDeep(this.config.tunerRestRequestTimeoutMs);
        }
        if (hasRawTunerStreamTimeout) {
            clonedConfig.tunerStreamEstablishmentTimeoutMs = cloneDeep(this.config.tunerStreamEstablishmentTimeoutMs);
        }

        return clonedConfig;
    }
}

namespace Configuration {
    /** config.yml を読むときの `js-yaml` の option（`!env` を含む。定義は `ConfigYaml.ts`）。 */
    export const CONFIG_YAML_OPTIONS = ConfigYaml.CONFIG_YAML_OPTIONS;

    export const CONFIG_FILE_PATH = path.join(import.meta.dirname, '..', '..', 'config', 'config.yml');
    export const CONFIG_TEMPLATE_FILE_PATH = path.join(
        import.meta.dirname,
        '..',
        '..',
        'config',
        'config.yml.template',
    );
    export const ROOT_PATH = path.join(import.meta.dirname, '..', '..').replace(new RegExp(`\\${path.sep}$`), '');

    /**
     * `uploadReceiveTimeoutMs` / `hookCommandTimeoutMs` の許容上限（ミリ秒）。
     * どちらの設定値も Node.js の `setTimeout()` の delay 引数へそのまま渡される
     * （`ServiceServer.ts` のアップロード受信タイムアウト、`ExternalCommandManageModel.ts` の
     * 外部コマンド期限タイマー）。HTML Standard の `setTimeout()` は Web IDL の符号付き32ビット
     * 整数 `long` を受け取る契約であり、この値（2^31 - 1）を超える delay を渡すと Node.js は
     * `TimeoutOverflowWarning` を発生させ、delay を 1ミリ秒へ切り詰める（実行して確認済み）。
     * つまりこの値は「overflow でクランプされずに setTimeout へ渡せる最大のミリ秒数」と一致する。
     * 詳細: `.kiro/specs/server-configuration/design.md` 3.1 節。
     */
    export const SETTIMEOUT_DELAY_MAX_MS = 2_147_483_647;

    /**
     * `thumbnailMaxPending` / `hookCommandMaxPending` の許容上限。
     * どちらも「まだ処理を開始していない依頼の待機件数」を数える安全弁であり、上限に達すると
     * 新規依頼を拒否して待機件数が際限なく積み上がり memory を圧迫するのを防ぐ
     * （`ThumbnailManageModel.ts` の `pendingThumbnailCount`、`ExternalCommandManageModel.ts` の
     * `pendingHookCommandCount`）。ただし、この具体的な数値そのものに個別の算出根拠は無い
     * （既定値 32 / 64 から算出した値でもない）。安全弁としての上限であり、値自体に意味は無い。
     * 詳細: `.kiro/specs/server-configuration/design.md` 3.1 節。
     */
    export const PENDING_QUEUE_SAFETY_LIMIT = 10_000;

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
                path: path.join(import.meta.dirname, '..', '..', 'recorded'),
            },
        ],
        recordedHistoryRetentionPeriodDays: 90,
        storageLimitCheckIntervalTime: 60,
        encodeQueueLimit: 1024,
        concurrentUploadNum: 3,
        uploadReceiveTimeoutMs: 300_000,
        thumbnailMaxPending: 32,
        hookCommandMaxPending: 64,
        hookCommandTimeoutMs: 300_000,
        thumbnail: path.join(import.meta.dirname, '..', '..', 'thumbnail'),
        thumbnailCmd:
            '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%',
        thumbnailSize: '480x270',
        thumbnailPosition: 5,
        dropLog: path.join(import.meta.dirname, '..', '..', 'drop'),
        uploadTempDir: path.join(import.meta.dirname, '..', '..', 'data', 'upload'),
        isEnabledDropCheck: false,
        ffmpeg: '/usr/local/bin/ffmpeg',
        ffprobe: '/usr/local/bin/ffprobe',
        encodeProcessNum: 0,
        concurrentEncodeNum: 0,
        encode: [],
        isSuppressReservesUpdateAllLog: false,
        urlscheme: {
            m2ts: {
                ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL%3A%2F%2FADDRESS',
                android: 'intent://ADDRESS#Intent;action=android.intent.action.VIEW;type=video/*;scheme=PROTOCOL;end',
            },
            video: {
                ios: 'infuse://x-callback-url/play?url=PROTOCOL://ADDRESS',
                android: 'intent://ADDRESS#Intent;action=android.intent.action.VIEW;type=video/*;scheme=PROTOCOL;end',
            },
            // iOS はダウンロード用 URL scheme を既定で持たない。iOS Safari は録画ファイルを直接
            // ダウンロードできる一方、vlc-x-callback 等の URL scheme を経由すると保存ファイル名が
            // Base64 化されるため（実機検証済み）、iOS 向け download scheme は利用者が
            // config.yml の urlscheme.download.ios を明示的に設定した場合のみ使う。
            download: {},
        },
        streamFilePath: path.join(import.meta.dirname, '..', '..', 'data', 'streamfiles'),
    };
}

export default Configuration;
