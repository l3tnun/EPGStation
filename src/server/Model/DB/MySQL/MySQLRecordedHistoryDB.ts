import * as DBSchema from '../DBSchema';
import { RecordedHistoryDB } from '../RecordedHistoryDB';

class MySQLRecordedHistoryDB extends RecordedHistoryDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.RecordedHistory } (`
            + 'id int primary key auto_increment, '
            + 'name text not null, '
            + 'endAt bigint not null '
        + ');';

        return this.operator.runQuery(query);
    }
}

export default MySQLRecordedHistoryDB;

