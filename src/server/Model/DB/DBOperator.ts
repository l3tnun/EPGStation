import Model from '../Model';
import Util from '../../Util/Util';

/**
* DBOperator クラス
* DB 操作を抽象化する
*/
abstract class DBOperator extends Model {
    /**
    * ping
    * @return Promise<void>
    */
    abstract ping(): Promise<void>;

    /**
    * end
    * @return Promise<void>
    */
    abstract end(): Promise<void>;

    /**
    * query を実行する
    * @param query
    * @param values: any
    * @param cs?: boolean
    * @return Promise<T>
    */
    abstract runQuery<T>(query: string, values?: any, cs?: boolean): Promise<T>;

    /**
    * 大量のデータをインサートする
    * @param deleteTableName レコードを削除するテーブルの名前
    * @param datas インサートするデータ
    * @param isDelete: データを削除するか true: 削除, false: 削除しない
    * @param insertWait インサート時の wait (ms)
    * @return Promise<void>
    */
    public manyInsert(deleteTableName: string, datas: { query: string, values?: any[] }[], isDelete: boolean, insertWait: number = 0): Promise<void> {
        return this.runTransaction(async (exec: (query: string, values?: any) => Promise<void>) => {
            // delete data
            if(isDelete) {
                await exec(`delete from ${ deleteTableName }`);
            }

            // insert data
            for(let data of datas) {
                await exec(data.query, data.values);
                if(insertWait > 0) { await Util.sleep(insertWait); }
            }
        });
    }

    /**
    * insert with insertId
    * @param query
    * @param value
    * @return Promise<number> insertId
    */
    abstract runInsert(query: string, values?: any | null): Promise<number>;

    /**
    * トランザクション処理
    * @param callback: transaction で実行する処理
    * @return Promise<void>
    */
    abstract async runTransaction(
        callback: (
            exec: (query: string, values?: any) => Promise<void>
        ) => Promise<void>,
    ): Promise<void>;

    /**
    * テーブルが存在するか
    * @param table name
    * @return boolean
    */
    abstract async exists(tableName: string): Promise<boolean>;

    /**
    * 件数取得
    * @param tableName: string
    * @return Promise<number>
    */
    public async total(tableName: string, option: string = ''): Promise<number> {
        let result = await this.runQuery(`select count(id) as total from ${ tableName } ${ option }`);

        return result[0].total;
    }

    /**
    * 取得した結果の先頭だけ返す。結果が空なら null
    * @param result<T[]>
    * @return T | null
    */
    public getFirst<T>(result: T[]): T | null {
        return result.length === 0 ? null : result[0];
    }

    /**
    * values 文字列を生成する
    * @param start: number
    * @param end: number
    */
    public createValueStr(start: number, end: number): string {
        let str = "";

        if(start > end) {
            throw new Error('createValueStr args error');
        }

        for(let i = start; i <= end; i++) {
            if(i === end) {
                str += '?'
            } else {
                str += '?, '
            }
        }

        return str;
    }

    /**
    * get upsert type
    * @return replace | conflict
    */
    public getUpsertType(): 'replace' | 'conflict' {
        return 'replace';
    }

    /**
    * create limit and offset str
    * @param limit: number
    * @param offset: number
    */
    public createLimitStr(limit: number, offset?: number): string {
        if(typeof offset === 'undefined') {
            return `limit ${ limit}`;
        } else {
            return `limit ${ offset }, ${ limit }`;
        }
    }

    /**
    * returning
    * @return string
    */
    public getReturningStr(): string {
        return '';
    }

    /**
    * カラム追加の query 文字列を生成する
    * @param tableName: table 名
    * @param columnName: column 名
    * @param columnDefine: column 定義
    * @return string
    */
    public createAddcolumnQueryStr(tableName: string, columnName: string, columnDefine: string): string {
        return `alter table ${ tableName } add ${ columnName } ${ columnDefine }`;
    }
}

export default DBOperator;
