import * as DBSchema from '../DBSchema';
import { EncodedDB } from '../EncodedDB';

class PostgreSQLEncodedDB extends EncodedDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Encoded } (`
            + 'id serial primary key, '
            + `recordedId integer references ${ DBSchema.TableName.Recorded } (id), `
            + 'name text not null, '
            + 'path text not null '
        + ');'

        return this.operator.runQuery(query);
    }

    /**
    * all columns
    * @return string
    */
    public getAllColumns(): string {
        return 'id, recordedId as "recordedId", name, path';
    }
}

export default PostgreSQLEncodedDB;

