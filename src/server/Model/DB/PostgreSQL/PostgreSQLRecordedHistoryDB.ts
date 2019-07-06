import * as DBSchema from '../DBSchema';
import { RecordedHistoryDB } from '../RecordedHistoryDB';

/**
 * PostgreSQLRecordedHistoryDB
 */
class PostgreSQLRecordedHistoryDB extends RecordedHistoryDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.RecordedHistory } (`
            + 'id serial primary key, '
            + 'name text not null, '
            + 'channelId bigint null default null, '
            + 'endAt bigint not null '
            + ');';

        return this.operator.runQuery(query);
    }

    /**
     * restore
     * @param programs: DBSchema.RecordedHistorySchema[]
     * @param isDelete: boolean = true
     */
    public async restore(programs: DBSchema.RecordedHistorySchema[], isDelete: boolean = true): Promise<void> {
        await super.restore(programs, isDelete);

        // シーケンス値の修正
        await this.operator.runQuery(`select setval('${ DBSchema.TableName.RecordedHistory }_id_seq', (select max(id) from ${ DBSchema.TableName.RecordedHistory }))`);
    }

    /**
     * all columns
     * @return string
     */
    public getAllColumns(): string {
        return 'id, name, channelId as "channelId", endAt as "endAt"';
    }
}

export default PostgreSQLRecordedHistoryDB;

