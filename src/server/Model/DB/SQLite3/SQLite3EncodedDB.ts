import * as DBSchema from '../DBSchema';
import { EncodedDB } from '../EncodedDB';

class SQLite3EncodedDB extends EncodedDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Encoded } (`
            + 'id integer primary key autoincrement, '
            + 'recordedId integer, '
            + 'name text not null, '
            + 'path text not null, '
            + 'filesize integer null default null, '
            + `foreign key(recordedId) references ${ DBSchema.TableName.Recorded }(id) `
        + ');';

        return this.operator.runQuery(query);
    }
}

export default SQLite3EncodedDB;

