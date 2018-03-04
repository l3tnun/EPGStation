import * as DBSchema from '../DBSchema';
import { EncodedDB } from '../EncodedDB';

class MySQLEncodedDB extends EncodedDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Encoded } (`
            + 'id int primary key auto_increment, '
            + 'recordedId int, '
            + 'name text not null, '
            + 'path text not null, '
            + 'filesize bigint null default null, '
            + `foreign key(recordedId) references ${ DBSchema.TableName.Recorded }(id) `
        + ') engine=InnoDB;';

        return this.operator.runQuery(query);
    }
}

export default MySQLEncodedDB;

