import * as fs from 'fs';
import ConfigInterface from './ConfigInterface';
import { Logger, LoggerInterface } from './Logger';
import FileUtil from './Util/FileUtil';

/**
 * Configuration
 * config.json を読み取る
 */
class Configuration {
    private static instance: Configuration;
    private configPath: string | null = null;
    private config: ConfigInterface | null = null;
    private log: LoggerInterface = Logger.getLogger();

    public static getInstance(): Configuration {
        if (!this.instance) {
            this.instance = new Configuration();
        }

        return this.instance;
    }

    private constructor() {}

    /**
     * 初期化
     * @param configPath config file path
     * @param neededWatch: boolean ファイルを監視して更新するか
     */
    public initialize(configPath: string, neededWatch: boolean): void {
        this.configPath = configPath;
        this.readConfig();

        if (this.config === null) { throw new Error('config.json read error'); }

        if (neededWatch && !this.config.readOnlyOnce) {
            // readOnlyOnce が有効のときは config を update しない
            fs.watchFile(this.configPath, async() => {
                this.log.system.info('update config');
                try {
                    const newConfig = JSON.parse(await FileUtil.promiseReadFile(this.configPath!));
                    this.config = newConfig;
                } catch (err) {
                    this.log.system.error('update config error');
                    this.log.system.error(err);
                }
            });
        }
    }

    /**
     * read config
     */
    private readConfig(): void {
        let configFile: string | null = null;

        // read configFile
        try {
            configFile = fs.readFileSync(this.configPath!, 'utf-8');
        } catch (e) {
            if (e.code === 'ENOENT') {
                this.log.system.fatal('config.json is not found');
            } else {
                this.log.system.fatal(e);
            }
            if (this.config === null) { process.exit(); }
        }

        // JSON parse configFile
        try {
            if (configFile === null) { throw new Error('config file is null'); }
            this.config = JSON.parse(configFile);
        } catch (e) {
            this.log.system.fatal('config.json parse error');
            if (this.config === null) { process.exit(); }
        }
    }

    /**
     * @return config
     */
    public getConfig(): ConfigInterface {
        if (this.config === null) { throw new Error('config is null'); }

        return <ConfigInterface> JSON.parse(JSON.stringify(this.config));
    }
}

export default Configuration;

