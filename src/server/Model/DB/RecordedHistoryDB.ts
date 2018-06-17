import * as DBSchema from './DBSchema';
import DBTableBase from './DBTableBase';

interface RecordedHistoryDBInterface extends DBTableBase {
    create(): Promise<void>;
    drop(): Promise<void>;
    insert(program: DBSchema.RecordedHistorySchema): Promise<void>;
    restore(programs: DBSchema.RecordedHistorySchema[], isDelete?: boolean): Promise<void>;
}

/**
 * RecordedHistoryDB
 * revision 2 で追加された
 * migrate で変更を加えるときは存在するか確認してから操作すること
 */
abstract class RecordedHistoryDB extends DBTableBase implements RecordedHistoryDBInterface {
    /**
     * get table name
     * @return string
     */
    protected getTableName(): string {
        return DBSchema.TableName.RecordedHistory;
    }

    /**
     * create table
     * @return Promise<void>
     */
    public abstract create(): Promise<void>;

    /**
     * drop table
     */
    public drop(): Promise<void> {
        return this.operator.runQuery(`drop table if exists ${ DBSchema.TableName.RecordedHistory }`);
    }

    /**
     * データ挿入
     * @param program: DBSchema.RecordedHistorySchema
     * @return Promise<number> insertId
     */
    public async insert(program: DBSchema.RecordedHistorySchema): Promise<void> {
        const query = `insert into ${ DBSchema.TableName.RecordedHistory } (`
            + this.createInsertColumnStr()
        + ') VALUES ('
            + this.operator.createValueStr(1, 2)
        + ')';

        const value: any[] = [];
        value.push(program.name);
        value.push(program.end);

        await this.operator.runQuery(query, value);
    }

    /**
     * insert 時のカラムを生成
     * @return string
     */
    private createInsertColumnStr(): string {
        return 'name, '
            + 'end ';
    }

    /**
     * restore
     * @param programs: DBSchema.RecordedHistorySchema[]
     * @param isDelete: boolean = true
     */
    public restore(programs: DBSchema.RecordedHistorySchema[], isDelete: boolean = true): Promise<void> {
        const query = `insert into ${ DBSchema.TableName.RecordedHistory } (`
            + this.createInsertColumnStr()
        + ') VALUES ('
            + this.operator.createValueStr(1, 2)
        + ')';

        const values: any[] = [];
        for (const program of programs) {
            const value: any[] = [];
            value.push(program.name);
            value.push(program.end);

            values.push({ query: query, values: value });
        }

        return this.operator.manyInsert(DBSchema.TableName.RecordedHistory, values, isDelete);
    }
}

export { RecordedHistoryDBInterface, RecordedHistoryDB };

