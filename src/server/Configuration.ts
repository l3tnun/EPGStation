import * as fs from 'fs';
import ConfigInterface from './ConfigInterface';
import { Logger, LoggerInterface } from './Logger';

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
     */
    public initialize(configPath: string): void {
        this.configPath = configPath;
        this.updateConfig();
    }

    /**
     * @return config
     */
    public getConfig(): ConfigInterface {
        // readOnlyOnce が有効のときは config を update しない
        if (this.config === null || !this.config.readOnlyOnce) { this.updateConfig(); }
        if (this.config === null) { throw new Error('config is null'); }

        return this.config;
    }

    /**
     * update config
     */
    private updateConfig(): void {
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
}

export default Configuration;

