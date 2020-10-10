import * as fs from 'fs';
import { injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import * as path from 'path';
import ILogger from './ILogger';
import ILoggerModel from './ILoggerModel';

/**
 * Logger
 */
@injectable()
export default class LoggerModel implements ILoggerModel {
    private logger: ILogger | null = null;

    /**
     * 初期設定
     * @param filePath: log file path
     */
    public initialize(filePath?: string): void {
        if (typeof filePath === 'undefined') {
            log4js.configure({
                appenders: {
                    system: { type: 'console' },
                    access: { type: 'console' },
                    stream: { type: 'console' },
                    encode: { type: 'console' },
                    console: { type: 'console' },
                },
                categories: {
                    default: { appenders: ['console'], level: 'info' },
                    system: { appenders: ['system'], level: 'info' },
                    access: { appenders: ['access'], level: 'info' },
                    stream: { appenders: ['stream'], level: 'info' },
                    encode: { appenders: ['system'], level: 'info' },
                },
            });
        } else {
            try {
                const str = this.readLogFile(filePath);
                const config: log4js.Configuration = yaml.safeLoad(str) as any;
                log4js.configure(config);
            } catch (err) {
                console.error('log file parse error');
                process.exit(1);
            }
        }

        // set Logger
        this.logger = {
            system: log4js.getLogger('system'),
            access: log4js.getLogger('access'),
            stream: log4js.getLogger('stream'),
            encode: log4js.getLogger('encode'),
        };
    }

    /**
     * Logger を返す
     * @return Logger
     */
    public getLogger(): ILogger {
        if (this.logger === null) {
            console.error('Logger is not initialized');
            process.exit(1);
        }

        return this.logger;
    }

    /**
     * read lof file
     * @param filePath log file path
     * @return log file
     */
    private readLogFile(filePath: string): string {
        // ログ設定ファイル読み取り
        let str: string = '';
        try {
            str = fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error('log file is not found');
            } else {
                console.error(err);
            }
            process.exit(1);
        }

        if (typeof str === 'undefined') {
            console.error('log file read error');
            process.exit(1);
        }

        // replace path
        return str
            .replace('%OperatorSystem%', this.createDefaultLogPath('Operator', 'system.log'))
            .replace('%OperatorAccess%', this.createDefaultLogPath('Operator', 'access.log'))
            .replace('%OperatorStream%', this.createDefaultLogPath('Operator', 'stream.log'))
            .replace('%OperatorEncode%', this.createDefaultLogPath('Operator', 'encode.log'))
            .replace('%ServiceSystem%', this.createDefaultLogPath('Service', 'system.log'))
            .replace('%ServiceAccess%', this.createDefaultLogPath('Service', 'access.log'))
            .replace('%ServiceStream%', this.createDefaultLogPath('Service', 'stream.log'))
            .replace('%ServiceEncode%', this.createDefaultLogPath('Service', 'encode.log'))
            .replace('%EPGUpdaterSystem%', this.createDefaultLogPath('EPGUpdater', 'system.log'))
            .replace('%EPGUpdaterAccess%', this.createDefaultLogPath('EPGUpdater', 'access.log'))
            .replace('%EPGUpdaterStream%', this.createDefaultLogPath('EPGUpdater', 'stream.log'))
            .replace('%EPGUpdaterEncode%', this.createDefaultLogPath('EPGUpdater', 'encode.log'));
    }
    /**
     * ログファイルのファイルパスを生成する
     * @param dir: dir
     * @param filename: file name
     * @return file path
     */
    private createDefaultLogPath(dir: string, filename: string): string {
        const logFileFullPath = path.join(__dirname, '..', '..', 'logs', dir, filename);

        return process.platform === 'win32' ? logFileFullPath.replace(/\\/g, '\\\\') : logFileFullPath;
    }
}
