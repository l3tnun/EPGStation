import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import DBOperator from '../DBOperator';
import Util from '../../../Util/Util';

/**
* SQLite3Operator クラス
*/
class SQLite3Operator extends DBOperator {
    protected static db: sqlite3.Database | null = null;
    protected static isEnableForeignKey = false;

    constructor() {
        super();

        if(!SQLite3Operator.isEnableForeignKey) {
            //外部キー制約を有効化
            this.runQuery(`pragma foreign_keys = ON`);
        }
    }

    private getDB(): sqlite3.Database {
        if(SQLite3Operator.db === null) {
            const dbPath = this.config.getConfig().dbPath || path.join(__dirname, '..', '..', '..', '..', '..', 'data', 'database.db');
            SQLite3Operator.db = new sqlite3.Database(dbPath);
        }

        return SQLite3Operator.db;
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
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getDB().close((err) => {
                if(err) {
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
        return new Promise<T>((resolve: (row: T) => void, reject: (err: Error) => void ) => {
            this.getDB().serialize(() => {
                if(isEnableCS) { this.runQuery(`pragma case_sensitive_like = 1`); }

                const exec = (err: Error | null, result: any) => {
                    if(err) { reject(err); return; }
                    if(isEnableCS) { this.runQuery(`pragma case_sensitive_like = 0`); }
                    resolve(<T>(<any>result));
                };

                if(values === null) {
                    this.getDB().all(query, (err, rows) => {
                        exec(err, rows);
                    });
                } else {
                    this.getDB().all(query, values, (err, rows) => {
                        exec(err, rows);
                    });
                }
            });
        });
    }

    /**
    * 大量のデータをインサートする
    * @param deleteTableName レコードを削除するテーブルの名前
    * @param datas インサートするデータ
    * @param isDelete: データを削除するか true: 削除, false: 削除しない
    * @param insertWait インサート時の wait (ms)
    * @return Promise<pg.QueryResult>
    */
    public manyInsert(deleteTableName: string, datas: { query: string, values?: any[] }[], isDelete: boolean, insertWait: number = 0): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getDB().serialize(() => {
                // トランザクション開始
                this.getDB().exec('begin transaction');

                new Promise(async (resolve: () => void, reject: (err: Error) => void) => {
                    if(isDelete) {
                        // delete DB data
                        this.getDB().run(`delete from ${ deleteTableName }`, (err) => {
                            if(err) { reject(err); return; }
                        });
                    }

                    //データ挿入
                    for(let data of datas) {
                        await (() => {
                            return new Promise((resolve: () => void, reject: (err: Error) => void) => {
                                this.getDB().run(data.query, data.values, (err) => {
                                    if(err) { reject(err); return; }
                                    resolve();
                                });
                            });
                        })();
                        if(insertWait > 0) { await Util.sleep(insertWait); }
                    }

                    resolve();
                })
                .then(() => {
                    // commit
                    this.getDB().exec('commit');
                    resolve();
                })
                .catch((err) => {
                    this.log.system.error(err);
                    // rollback
                    this.getDB().exec('rollback');
                    reject(err);
                });
            });
        });
    }

    /**
    * insert with insertId
    * @param query
    * @return Promise<number> insertId
    */
    public runInsert(query: string, values?: any): Promise<number> {
        return new Promise<number>((resolve: (insertId: number) => void, reject: (err: Error) => void ) => {
            this.getDB().serialize(() => {
                if(typeof values === 'undefined') {
                    this.getDB().run(query, function(err) {
                        if(err) { reject(err); return; }
                        resolve(this.lastID);
                    });
                } else {
                    this.getDB().run(query, values, function(err) {
                        if(err) { reject(err); return; }
                        resolve(this.lastID);
                    });
                }
            });
        });
    }
}

export default SQLite3Operator;

