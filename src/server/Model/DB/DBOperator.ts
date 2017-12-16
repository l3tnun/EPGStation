import Model from '../Model';

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
    abstract manyInsert(deleteTableName: string, datas: { query: string, values?: any[] }[], isDelete: boolean, insertWait?: number): Promise<void>;

    /**
    * insert with insertId
    * @param query
    * @param value
    * @return Promise<number> insertId
    */
    abstract runInsert(query: string, values?: any | null): Promise<number>;

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
}

export default DBOperator;
