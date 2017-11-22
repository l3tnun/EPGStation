import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import DBBase from '../DBBase';
import Util from '../../../Util/Util';

/**
* SQLite3Base クラス
*/
abstract class SQLite3Base extends DBBase {
    protected db: sqlite3.Database;

    constructor() {
        super();

        const dbPath = this.config.getConfig().dbPath || path.join(__dirname, '..', '..', '..', '..', '..', 'data', 'database.db');
        this.db = new sqlite3.Database(dbPath);

        //外部キー制約を有効化
        this.runQuery(`pragma foreign_keys = ON`);
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
            this.db.close((err) => {
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
    * @return Promise<T>
    */
    protected runQuery<T>(query: string, values?: any): Promise<T> {
        return new Promise<T>((resolve: (row: T) => void, reject: (err: Error) => void ) => {
            this.db.serialize(() => {
                if(typeof values === 'undefined') {
                    this.db.all(query, (err, rows) => {
                        if(err) { reject(err); return; }
                        resolve(<T>(<any>rows));
                    });
                } else {
                    this.db.all(query, values, (err, rows) => {
                        if(err) { reject(err); return; }
                        resolve(<T>(<any>rows));
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
    protected manyInsert(deleteTableName: string, datas: { query: string, values: any[] }[], isDelete: boolean, insertWait: number = 0): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.db.serialize(() => {
                // トランザクション開始
                this.db.exec('begin transaction');

                new Promise(async (resolve: () => void, reject: (err: Error) => void) => {
                    if(isDelete) {
                        // delete DB data
                        this.db.run(`delete from ${ deleteTableName }`, (err) => {
                            if(err) { reject(err); return; }
                        });
                    }

                    //データ挿入
                    for(let data of datas) {
                        await (() => {
                            return new Promise((resolve: () => void, reject: (err: Error) => void) => {
                                this.db.run(data.query, data.values, (err) => {
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
                    this.db.exec('commit');
                    resolve();
                })
                .catch((err) => {
                    this.log.system.error(err);
                    // rollback
                    this.db.exec('rollback');
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
    protected runInsert(query: string, values?: any): Promise<number> {
        return new Promise<number>((resolve: (insertId: number) => void, reject: (err: Error) => void ) => {
            this.db.serialize(() => {
                if(typeof values === 'undefined') {
                    this.db.run(query, function(err) {
                        if(err) { reject(err); return; }
                        resolve(this.lastID);
                    });
                } else {
                    this.db.run(query, values, function(err) {
                        if(err) { reject(err); return; }
                        resolve(this.lastID);
                    });
                }
            });
        });
    }

    /**
    * 件数取得
    * @param tableName: string
    * @return Promise<number>
    */
    protected async total(tableName: string, option: string = ''): Promise<number> {
        let result = await this.runQuery(`select count(id) as total from ${ tableName } ${ option }`);

        return result[0].total;
    }

    /**
    * 取得した結果の先頭だけ返す。結果が空なら null
    * @param result<T[]>
    * @return T | null
    */
    protected getFirst<T>(result: T[]): T | null {
        return result.length === 0 ? null : result[0];
    }

    /**
    * 大小文字区別
    * @param status: boolean
    */
    protected setCS(status: boolean): Promise<void> {
        return this.runQuery(`pragma case_sensitive_like = ${ Number(status)}`);
    }
}

export default SQLite3Base;

