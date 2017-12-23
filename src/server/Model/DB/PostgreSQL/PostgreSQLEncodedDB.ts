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
    * resotre
    * @param programs: DBSchema.EncodedSchema[]
    * @param isDelete: boolean = true
    * @param hasBaseDir: boolean = true
    */
    public async restore(programs: DBSchema.EncodedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        await super.restore(programs, isDelete, hasBaseDir);

        // シーケンス値の修正
        await this.operator.runQuery(`select setval('${ DBSchema.TableName.Encoded }_id_seq', (select max(id) from ${ DBSchema.TableName.Encoded }))`);
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

