import * as path from 'path';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import IConfigFile from '../IConfigFile.js';
import IConfiguration from '../IConfiguration.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IDBOperator from './IDBOperator.js';

/**
 * `IDBOperator` の実装。config.yml の `dbtype`（sqlite/mysql）に応じた TypeORM `DataSource` を
 * 生成・接続し、DB接続まわりの各 DB クラス（`op: IDBOperator` として注入される）へ単一の
 * 接続を提供する。
 */
@injectable()
export default class DBOperator implements IDBOperator {
    /** 確立済みの接続。一度確立されれば `getConnection` はこれを再利用し、再接続を試みない。 */
    private connection: DataSource | null = null;
    /** 接続確立が進行中の間だけ値を持つ、その完了を表す Promise。`getConnection` が同時に
     *  複数回呼ばれても接続の生成を1回に留めるためのdedupe用で、成功・失敗いずれでも
     *  完了後は`clearConnectionInitialization`により`null`へ戻る。 */
    private connectionInitialization: Promise<DataSource> | null = null;
    private config: IConfigFile;
    private log: ILogger;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') conf: IConfiguration) {
        this.log = logger.getLogger();
        this.config = conf.getConfig();
    }

    public getConnection(): Promise<DataSource> {
        if (this.connection !== null) {
            return Promise.resolve(this.connection);
        }

        if (this.connectionInitialization !== null) {
            return this.connectionInitialization;
        }

        let resolveInitialization!: (connection: DataSource) => void;
        let rejectInitialization!: (error: unknown) => void;
        const initialization = new Promise<DataSource>((resolve, reject) => {
            resolveInitialization = resolve;
            rejectInitialization = reject;
        });
        this.connectionInitialization = initialization;
        void this.initializeConnection().then(resolveInitialization, rejectInitialization);
        void initialization.then(
            () => this.clearConnectionInitialization(),
            () => this.clearConnectionInitialization(),
        );

        return initialization;
    }

    /**
     * DB 接続候補を生成する
     * @returns DataSource
     */
    private createConnection(): DataSource {
        // アプリのルートディレクトリ
        const appRootPath = path.join(import.meta.dirname, '..', '..', '..');

        // dist 下のディレクトリ設定
        const distDBBasePath = path.join(appRootPath, 'dist', 'db');
        const entitie = path.join(distDBBasePath, 'entities', '**', '*.js');
        const subscriber = path.join(distDBBasePath, 'subscribers', '**', '*.js');

        // マイグレーションファイルの場所
        const migrations = [path.join(distDBBasePath, 'migrations', this.config.dbtype, '**', '*.js')];

        let connection: DataSource;
        if (this.config.dbtype === 'sqlite') {
            connection = new DataSource({
                // 利用者向けの設定値は 'sqlite' のまま。TypeORM 1.x は node-sqlite3 driver を
                // 廃止し better-sqlite3 へ置き換えたため、driver 名だけを読み替える。
                type: 'better-sqlite3',
                database: path.join(appRootPath, 'data', 'database.db'),
                // sqlite.wal が true のときだけ journal_mode を WAL にする。それ以外は初期化の後に
                // delete 方式へ揃える（applySQLiteJournalMode）。
                ...(this.config.sqlite?.wal === true ? { enableWAL: true } : {}),
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
                // socketPath は設定されたときだけ渡す。省略時は option に含めず、host / port で接続する。
                ...(typeof this.config.mysql.socketPath === 'undefined'
                    ? {}
                    : { socketPath: this.config.mysql.socketPath }),
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
            });
        } else {
            throw new Error('DBTypeError');
        }

        return connection;
    }

    private async initializeConnection(): Promise<DataSource> {
        let candidate: DataSource | null = null;
        let candidateClosedDuringInitialization = false;
        let candidateInitialized = false;
        let driverConnectStarted = false;
        let driverDisconnectedDuringInitialization = false;
        try {
            candidate = this.createConnection();
            const destroy = candidate.destroy;
            const driver = candidate.driver;
            const connect = driver.connect;
            const disconnect = driver.disconnect;
            candidate.destroy = async () => {
                candidateClosedDuringInitialization = true;
                try {
                    await destroy.call(candidate);
                } catch (error) {
                    this.logInitializationCleanupError(error);
                }
            };
            driver.connect = async () => {
                driverConnectStarted = true;
                await connect.call(driver);
            };
            driver.disconnect = async () => {
                driverDisconnectedDuringInitialization = true;
                await disconnect.call(driver);
            };
            try {
                await candidate.initialize();
                candidateInitialized = true;
            } finally {
                candidate.destroy = destroy;
                driver.connect = connect;
                driver.disconnect = disconnect;
            }
            await this.applySQLiteJournalMode(candidate);
            await this.setSQLiteExtensions(candidate);

            if (this.connection !== null) {
                await this.closeInitializationCandidate(candidate);
                return this.connection;
            }

            this.connection = candidate;
            return candidate;
        } catch (error) {
            if (candidate !== null && !candidateClosedDuringInitialization) {
                const failedCandidate = candidate;
                if (candidateInitialized || !driverConnectStarted) {
                    await this.closeInitializationCandidate(failedCandidate);
                } else if (!driverDisconnectedDuringInitialization) {
                    await this.closeInitializationCandidate(failedCandidate, () => failedCandidate.driver.disconnect());
                }
            }
            throw error;
        }
    }

    private clearConnectionInitialization(): void {
        this.connectionInitialization = null;
    }

    private async closeInitializationCandidate(
        candidate: DataSource,
        close: () => Promise<void> = () => candidate.destroy(),
    ): Promise<void> {
        try {
            await close();
        } catch (error) {
            this.logInitializationCleanupError(error);
        }
    }

    private logInitializationCleanupError(error: unknown): void {
        this.log.system.error('failed to close database initialization candidate');
        this.log.system.error(error);
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
     * sqlite の journal 方式を設定に合わせる。
     *
     * `sqlite.wal` が true のときは、接続時に TypeORM が WAL にする（`enableWAL`）。それ以外のときは
     * delete 方式にする。SQLite は WAL だけを database file に記録するので、以前に WAL にされた file
     * もここで delete 方式へ戻り、設定が無効のまま WAL で動き続けない。WAL でない file は何も変わらない。
     * 他の接続が file を使っていて戻せないときは SQLite が `database is locked` で失敗し、error を log に
     * 残して初期化を失敗させる（接続を公開せず、黙って WAL のまま動かない）。起動時は本体の process が
     * 子 process より先に DB を開き（`checkDB`）、失敗は成功まで再試行される。
     */
    private async applySQLiteJournalMode(connection: DataSource): Promise<void> {
        if (this.config.dbtype !== 'sqlite' || this.config.sqlite?.wal === true) {
            return;
        }

        try {
            await connection.manager.query('PRAGMA journal_mode = DELETE');
        } catch (err: any) {
            this.log.system.error('failed to set sqlite journal_mode to delete');
            throw err;
        }
    }

    /**
     * sqlite の外部拡張読み込み
     */
    private async setSQLiteExtensions(connection: DataSource): Promise<void> {
        if (
            this.config.dbtype !== 'sqlite' ||
            typeof this.config.sqlite === 'undefined' ||
            typeof this.config.sqlite.extensions === 'undefined'
        ) {
            return;
        }

        // 外部拡張読み込み
        //
        // better-sqlite3 の loadExtension は同期で、失敗は例外で返る。node-sqlite3 の callback
        // 形式とは異なる。
        for (const extension of this.config.sqlite.extensions) {
            this.log.system.info(`load extension: ${extension}`);
            try {
                (<any>connection).driver.databaseConnection.loadExtension(extension);
            } catch (err: any) {
                this.log.system.error(`failed to load extension: ${extension}`);
                throw err;
            }
            this.log.system.info(`loaded extension success: ${extension}`);
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
