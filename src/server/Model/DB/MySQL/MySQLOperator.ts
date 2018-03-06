import * as mysql from 'mysql';
import DBOperator from '../DBOperator';

/**
 * MySQLOperator クラス
 */
class MySQLOperator extends DBOperator {
    protected static pool: mysql.Pool | null = null;

    /**
     * get Pool
     * @return Pool
     */
    public getPool(): mysql.Pool {
        if (MySQLOperator.pool === null) {
            const config = this.config.getConfig().mysql;
            if (typeof config.connectTimeout === 'undefined') { config.connectTimeout = 5000; }

            // boolean 型を Javascript の Boolean へ変換する
            (<any> config).typeCast = (field: any, next: () => void) => {
                if (field.type === 'TINY' && field.length === 1) {
                    return field.string() === '1';
                }

                return next();
            };

            MySQLOperator.pool = mysql.createPool(config);
        }

        return MySQLOperator.pool;
    }

    /**
     * ping
     * @return Promise<void>
     */
    public ping(): Promise<void> {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getPool().getConnection((err, connection) => {
                if (err) {
                    reject(err);

                    return;
                }

                connection.ping((e: Error) => {
                    if (e) {
                        reject(e);

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
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getPool().end((err) => {
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
     * @return Promise<T>
     */
    public runQuery<T>(query: string, values?: any): Promise<T> {
        return new Promise<T>((resolve: (row: T) => void, reject: (err: Error) => void) => {
            this.getPool().getConnection((err, connection) => {
                if (err) {
                    reject(err);

                    return;
                }

                if (typeof values === 'undefined') {
                    connection.query(query, (e, result) => {
                        connection.release();
                        if (e) {
                            reject(e);

                            return;
                        }
                        resolve(<T> result);
                    });
                } else {
                    connection.query(query, values, (e, result) => {
                        connection.release();
                        if (e) {
                            reject(e);

                            return;
                        }
                        resolve(<T> result);
                    });
                }
            });
        });
    }

    /**
     * insert with insertId
     * @param query
     * @param value
     * @return Promise<number> insertId
     */
    public runInsert(query: string, values?: any): Promise<number> {
        return new Promise<number>((resolve: (insertId: number) => void, reject: (err: Error) => void) => {
            this.getPool().getConnection((err, connection) => {
                if (err) {
                    reject(err);

                    return;
                }

                if (typeof values === 'undefined') {
                    connection.query(query, (e, result) => {
                        connection.release();
                        if (e) {
                            reject(e);

                            return;
                        }
                        resolve(<number> (<any> result).insertId);
                    });
                } else {
                    connection.query(query, values, (e, result) => {
                        connection.release();
                        if (e) {
                            reject(e);

                            return;
                        }
                        resolve(<number> (<any> result).insertId);
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
        let connection: mysql.PoolConnection;
        const failed = (err: Error, reject: (err: Error) => void) => {
            connection.rollback(() => { connection.release(); });
            connection.release();
            reject(err);
        };

        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            this.getPool().getConnection((err, con) => {
                if (err) {
                    reject(err);

                    return;
                }

                connection = con;

                connection.beginTransaction((e) => {
                    if (e) {
                        connection.release();
                        reject(e);

                        return;
                    }

                    callback((query: string, values?: any) => {
                        return new Promise<void>((cresolve: () => void, creject: (err: Error) => void) => {
                            connection.query(query, values, (ce) => {
                                if (ce) {
                                    creject(ce);

                                    return;
                                }
                                cresolve();
                            });
                        });
                    })
                    .then(() => {
                        // commit
                        connection.commit((es) => {
                            if (es) {
                                failed(es, reject);

                                return;
                            }
                            connection.release();
                            resolve();
                        });
                    })
                    .catch((fe) => {
                        failed(fe, reject);
                    });
                });
            });
        });
    }

    /**
     * テーブルが存在するか
     * @param table name
     * @return boolean
     */
    public async exists(tableName: string): Promise<boolean> {
        const result = <any[]> await this.runQuery(`show tables like '${ tableName }';`);

        return result.length !== 0;
    }
}

export default MySQLOperator;

