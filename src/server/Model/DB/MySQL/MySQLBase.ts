import * as mysql from 'mysql';
import DBBase from '../DBBase';
import Util from '../../../Util/Util';

/**
* MySQLBase クラス
*/
abstract class MySQLBase extends DBBase {
    protected static pool: mysql.IPool | null = null;

    /**
    * get Pool
    * @return Pool
    */
    protected getPool(): mysql.IPool{
        if(MySQLBase.pool === null) {
            let config = this.config.getConfig().mysql;
            if(typeof config.connectTimeout === 'undefined') { config.connectTimeout = 5000; }
            MySQLBase.pool = mysql.createPool(config);
        }

        return MySQLBase.pool;
    }

    /**
    * ping
    * @return Promise<void>
    */
    public ping(): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getPool().getConnection((err, connection) => {
                if(err) {
                    reject(err);
                    return;
                }

                connection.ping((err: Error) => {
                    if(err) {
                        reject(err);
                        return;
                    }

                    resolve();
                });
            });
        });
    }

    /**
    * end
    * @return Promise<void>
    */
    public end(): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: mysql.IError) => void) => {
            this.getPool().end((err) => {
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
        return new Promise<T>((resolve: (row: T) => void, reject: (err: mysql.IError) => void) => {
            this.getPool().getConnection((err, connection) => {
                if(err) { reject(err); return; }

                if(typeof values === 'undefined') {
                    connection.query(query, (err, result) => {
                        connection.release();
                        if(err) { reject(err); return; }
                        resolve(<T>result);
                    });
                } else {
                    connection.query(query, values, (err, result) => {
                        connection.release();
                        if(err) { reject(err); return; }
                        resolve(<T>result);
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
    protected manyInsert(deleteTableName: string, datas: { query: string, values?: any[] }[], isDelete: boolean, insertWait: number = 0): Promise<void> {
        let connection: mysql.IConnection;
        let failed = (err: mysql.IError, reject: (err: mysql.IError) => void) => {
            connection.rollback(() => { connection.release(); });
            connection.release();
            reject(err);
        }

        return new Promise<void>((resolve: () => void, reject: (err: mysql.IError) => void) => {
            this.getPool().getConnection((err, con) => {
                if(err) { reject(err); return; }

                connection = con;

                connection.beginTransaction((err) => {
                    if(err) { connection.release(); reject(err); return; }

                    new Promise((resolve: () => void, reject: (err: mysql.IError) => void) => {
                        if(!isDelete) { resolve(); return; }

                        connection.query(`delete from ${ deleteTableName }`, (err) => {
                            if(err) { reject(err); return; }
                            resolve();
                        })
                    })
                    .then(async () => {
                        for(let data of datas) {
                            await (() => {
                                return new Promise((resolve: () => void, reject: (err: mysql.IError) => void) => {
                                    if(typeof data.values === 'undefined') {
                                        connection.query(data.query, (err) => {
                                            if(err) { reject(err); return; }
                                            resolve();
                                        });
                                    } else {
                                        connection.query(data.query, data.values, (err) => {
                                            if(err) { reject(err); return; }
                                            resolve();
                                        });
                                    }
                                })
                            })();
                            if(insertWait > 0) { await Util.sleep(insertWait); }
                        }
                    })
                    .then(() => {
                        //commit
                        connection.commit((err) => {
                            if(err) { failed(err, reject); return; }
                            connection.release();
                            resolve();
                        });
                    })
                    .catch((err) => {
                        failed(err, reject);
                    });
                });
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
    * 挿入したレコードの id を取得
    * @param result
    * @return insertId
    */
    protected getInsertId(result: any): number {
        return <number>(<any>result).insertId;
    }
}

export default MySQLBase;

