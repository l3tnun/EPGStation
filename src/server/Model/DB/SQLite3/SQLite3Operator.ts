import * as path from 'path';
import * as sqlite3 from 'sqlite3';
import DBOperator from '../DBOperator';

/**
 * SQLite3Operator クラス
 */
class SQLite3Operator extends DBOperator {
    protected static db: sqlite3.Database | null = null;

    /**
     * get DB connection
     * Promise<sqlite3.Database>
     */
    private getDB(): Promise<sqlite3.Database> {
        return new Promise<sqlite3.Database>(async(resolve: (result: sqlite3.Database) => void, reject: (error: Error) => void) => {
            if (SQLite3Operator.db === null) {
                const dbPath = this.config.getConfig().dbPath || path.join(__dirname, '..', '..', '..', '..', '..', 'data', 'database.db');
                SQLite3Operator.db = new sqlite3.Database(dbPath);
                try {
                    // load extension
                    const config = this.config.getConfig().sqlite3;
                    if (typeof config !== 'undefined' && typeof config.extensions !== 'undefined') {
                        for (const filePath of config.extensions) {
                            await this.loadExtension(SQLite3Operator.db, filePath);
                        }
                    }
                    await this.setForeignKeyConfig(SQLite3Operator.db);
                } catch (err) {
                    reject(err);
                }
            }

            resolve(SQLite3Operator.db);
        });
    }

    /**
     * load Extension
     */
    private loadExtension(db: sqlite3.Database, filePath: string): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            (<any> db).loadExtension(filePath, (err: Error | null) => {
                if (err) {
                    reject(err);

                    return;
                }
                resolve();
            });
        });
    }

    /**
     * set foreign key config
     * @param db: sqlite3.Database
     */
    private setForeignKeyConfig(db: sqlite3.Database): Promise<void> {
        return new Promise<void>((resolve: () => void) => {
            db.serialize(() => {
                db.run('pragma foreign_keys = ON', (err) => {
                    if (err) {
                        this.log.system.warn('sqlite3 foreign keys set error');
                        this.log.system.warn(err.message);
                    }
                    resolve();
                });
            });
        });
    }

    /**
     * ping
     * @return Promise<void>
     */
    public ping(): Promise<void> {
        return new Promise<void>((resolve: () => void) => {
            resolve();
        });
    }

    /**
     * end
     * @return Promise<void>
     */
    public end(): Promise<void> {
        return new Promise<void>(async(resolve: () => void, reject: (err: Error) => void) => {
            (await this.getDB()).close((err) => {
                if (err) {
                    reject(err);

                    return;
                }
                resolve();
            });
        });
    }

    /**
     * query を実行する
     * @param query
     * @param values: any
     * @param isEnableCS: boolean 大文字小文字を区別するか
     * @return Promise<T>
     */
    public runQuery<T>(query: string, values: any | null = null, isEnableCS: boolean = false): Promise<T> {
        return new Promise<T>(async(resolve: (row: T) => void, reject: (error: Error) => void) => {
            const db = await this.getDB();
            db.serialize(async() => {
                if (isEnableCS) { await this.setCS(db, true); }

                const exec = async(err: Error | null, result: any) => {
                    if (err) {
                        reject(err);

                        return;
                    }
                    if (isEnableCS) { await this.setCS(db, false); }
                    resolve(<T> (<any> result));
                };

                if (values === null) {
                    db.all(query, (err, rows) => {
                        exec(err, rows);
                    });
                } else {
                    db.all(query, values, (err, rows) => {
                        exec(err, rows);
                    });
                }
            });
        });
    }

    /**
     * set case sensitive like
     * @param db: sqlite3.Database
     * @param isEnableCS: boolean
     */
    private setCS(db: sqlite3.Database, isEnableCS: boolean): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            db.run(`pragma case_sensitive_like = ${ Number(isEnableCS) }`, (err) => {
                if (err) {
                    reject(err);

                    return;
                }
                resolve();
            });
        });
    }

    /**
     * insert with insertId
     * @param query
     * @return Promise<number> insertId
     */
    public runInsert(query: string, values?: any): Promise<number> {
        return new Promise<number>(async(resolve: (insertId: number) => void, reject: (err: Error) => void) => {
            const db = await this.getDB();
            db.serialize(() => {
                if (typeof values === 'undefined') {
                    // tslint:disable-next-line
                    db.run(query, function(err) {
                        if (err) {
                            reject(err);

                            return;
                        }
                        // tslint:disable-next-line
                        resolve(this.lastID);
                    });
                } else {
                    // tslint:disable-next-line
                    db.run(query, values, function(err) {
                        if (err) {
                            reject(err);

                            return;
                        }
                        // tslint:disable-next-line
                        resolve(this.lastID);
                    });
                }
            });
        });
    }

    /**
     * トランザクション処理
     * @param callback: transaction で実行する処理
     * @return Promise<void>
     */
    public async runTransaction(
        callback: (
            exec: (query: string, values?: any) => Promise<void>,
        ) => Promise<void>,
    ): Promise<void> {
        return new Promise<void>(async(resolve: () => void, reject: (err: Error) => void) => {
            const db = await this.getDB();
            db.serialize(() => {
                // トランザクション開始
                db.exec('begin transaction');

                callback((query: string, values?: any) => {
                    return new Promise<void>((sresolve: () => void, sreject: (err: Error) => void) => {
                        db.run(query, values, (err) => {
                            if (err) {
                                sreject(err);

                                return;
                            }
                            sresolve();
                        });
                    });
                })
                .then(() => {
                    // commit
                    db.exec('commit');
                    resolve();
                })
                .catch((err) => {
                    this.log.system.error(err);
                    // rollback
                    db.exec('rollback');
                    reject(err);
                });
            });
        });
    }

    /**
     * boolean を文字列に変換
     * @param value: boolean
     * @return string
     */
    public convertBoolean(value: boolean): string {
        return `${ Number(value) }`;
    }

    /**
     * テーブルが存在するか
     * @param table name
     * @return boolean
     */
    public async exists(tableName: string): Promise<boolean> {
        const result = <{ cnt: number }[]> await this.runQuery(`select count(*) as cnt from sqlite_master where type='table' and name='${ tableName}';`);

        return result.length !== 0 && result[0].cnt === 1;
    }

    /**
     * カラム追加の query 文字列を生成する
     * @param tableName: table 名
     * @param columnName: column 名
     * @param columnDefine: column 定義
     * @return string
     */
    public createAddcolumnQueryStr(tableName: string, columnName: string, columnDefine: string): string {
        return `alter table ${ tableName } add column ${ columnName } ${ columnDefine }`;
    }
}

export default SQLite3Operator;

