import { inject, injectable } from 'inversify';
import { Connection, createConnection, getConnectionOptions } from 'typeorm';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IDBOperator from './IDBOperator';

@injectable()
export default class DBOperator implements IDBOperator {
    private connection: Connection | null = null;
    private config: IConfigFile;
    private log: ILogger;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') conf: IConfiguration) {
        this.log = logger.getLogger();
        this.config = conf.getConfig();
    }

    public async getConnection(): Promise<Connection> {
        if (this.connection === null) {
            const option = await getConnectionOptions();
            this.connection = await createConnection(option);
            await this.setSQLiteExtensions();
        }

        return this.connection;
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

        await this.connection.close();
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

        return typeof this.config.sqlite === 'undefined' ? false : this.config.sqlite.regexp;
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
