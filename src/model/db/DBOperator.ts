import * as path from 'path';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IDBOperator from './IDBOperator';

@injectable()
export default class DBOperator implements IDBOperator {
    private connection: DataSource | null = null;
    private config: IConfigFile;
    private log: ILogger;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') conf: IConfiguration) {
        this.log = logger.getLogger();
        this.config = conf.getConfig();
    }

    public async getConnection(): Promise<DataSource> {
        if (this.connection === null) {
            this.connection = await this.createConnection();
            await this.setSQLiteExtensions();
        }

        return this.connection;
    }

    /**
     * DB へ接続を行い接続済みのDataSourceを返す
     * @returns DataSource
     */
    private async createConnection(): Promise<DataSource> {
        // アプリのルートディレクトリ
        const appRootPath = path.join(__dirname, '..', '..', '..');

        // dist 下のディレクトリ設定
        const distDBBasePath = path.join(appRootPath, 'dist', 'db');
        const entitie = path.join(distDBBasePath, 'entities', '**', '*.js');
        const subscriber = path.join(distDBBasePath, 'subscribers', '**', '*.js');

        // マイグレーションファイルの場所
        const migrations = [path.join(distDBBasePath, 'migrations', this.config.dbtype, '**', '*.js')];

        let connection: DataSource;
        if (this.config.dbtype === 'sqlite') {
            connection = new DataSource({
                type: 'sqlite',
                database: path.join(appRootPath, 'data', 'database.db'),
                synchronize: false,
                logging: false,
                entities: [entitie],
                subscribers: [subscriber],
                migrationsRun: true,
                migrations: migrations,
            });
        } else if (this.config.dbtype === 'mysql' && typeof this.config.mysql !== 'undefined') {
            connection = new DataSource({
                type: 'mysql',
                host: this.config.mysql.host,
                port: this.config.mysql.port,
                username: this.config.mysql.user,
                password: this.config.mysql.password,
                database: this.config.mysql.database,
                charset: typeof this.config.mysql.charset === 'undefined' ? 'utf8mb4' : this.config.mysql.charset,
                bigNumberStrings: false,
                synchronize: false,
                logging: false,
                entities: [entitie],
                subscribers: [subscriber],
                migrationsRun: true,
                migrations: migrations,
                ssl: this.config.mysql.enable_ssl === true ? {
                    minVersion: 'TLSv1.2',
                    ca: this.config.mysql.ca_path || undefined
                  } : null,
            });
        } else {
            throw new Error('DBTypeError');
        }

        // 接続処理実施
        await connection.initialize();

        return connection;
    }

    /**
     * 接続確認
     * @return Promise<void>
     */
    public async checkConnection(): Promise<void> {
        const connection = await this.getConnection();
        await connection.manager.query('select 1');
    }

    /**
     * DB との接続を切断する
     * @return Promise<void>
     */
    public async closeConnection(): Promise<void> {
        if (this.connection === null) {
            return;
        }

        await this.connection.destroy();
    }

    /**
     * sqlite の外部拡張読み込み
     */
    private async setSQLiteExtensions(): Promise<void> {
        if (
            this.config.dbtype !== 'sqlite' ||
            typeof this.config.sqlite === 'undefined' ||
            typeof this.config.sqlite.extensions === 'undefined' ||
            this.connection === null
        ) {
            return;
        }

        // 外部拡張読み込み
        for (const extension of this.config.sqlite.extensions) {
            this.log.system.info(`load extension: ${extension}`);
            await new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
                (<any>this.connection).driver.databaseConnection.loadExtension(extension, (err: Error | null) => {
                    if (err) {
                        this.log.system.error(`failed to load extension: ${extension}`);
                        reject(err);
                    } else {
                        this.log.system.info(`loaded extension success: ${extension}`);
                        resolve();
                    }
                });
            });
        }
    }

    /**
     * regexp が有効か返す
     */
    public isEnabledRegexp(): boolean {
        if (this.config.dbtype !== 'sqlite') {
            return true;
        }

        return typeof this.config.sqlite === 'undefined' ? false : !!this.config.sqlite.regexp;
    }

    /**
     * boolean 型を変換する
     */
    public convertBoolean(value: boolean): boolean | number {
        if (this.config.dbtype !== 'sqlite') {
            return value;
        }

        return value === true ? 1 : 0;
    }

    /**
     * 大文字小文字の区別が有効か返す
     * @return boolean
     */
    public isEnableCS(): boolean {
        return this.config.dbtype === 'sqlite' ? false : true;
    }

    /**
     * regexp を返す
     * @param cs: boolean 大小文字区別の有無
     * @return string
     */
    public getRegexpStr(cs: boolean): string {
        switch (this.config.dbtype) {
            case 'mysql':
                return cs ? 'regexp binary' : 'regexp';
            case 'postgres':
                return cs ? '~' : '~*';
            case 'sqlite':
            default:
                return 'regexp';
        }
    }

    /**
     * like を返す
     * @param cs boolean 大小文字区別の有無
     */
    public getLikeStr(cs: boolean): string {
        switch (this.config.dbtype) {
            case 'mysql':
                return cs ? 'like binary' : 'like';
            case 'postgres':
                return cs ? 'like' : 'ilike';
            case 'sqlite':
            default:
                return 'like';
        }
    }
}
