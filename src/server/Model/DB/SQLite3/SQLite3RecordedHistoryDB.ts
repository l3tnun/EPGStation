import * as DBSchema from '../DBSchema';
import { RecordedHistoryDB } from '../RecordedHistoryDB';

/**
 * SQLite3RecordedHistoryDB
 */
class SQLite3RecordedHistoryDB extends RecordedHistoryDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.RecordedHistory } (`
            + 'id integer primary key autoincrement, '
            + 'name text not null, '
            + 'channelId integer null default null, '
            + 'endAt integer not null '
            + ');';

        return this.operator.runQuery(query);
    }
}

export default SQLite3RecordedHistoryDB;

