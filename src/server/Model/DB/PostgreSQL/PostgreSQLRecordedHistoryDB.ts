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
            + 'name text not null, '
            + 'end bigint not null '
            + ');';

        return this.operator.runQuery(query);
    }
}

export default PostgreSQLRecordedHistoryDB;

