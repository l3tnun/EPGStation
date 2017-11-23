import * as DBSchema from '../DBSchema';
import { ServicesDB } from '../ServicesDB';

/**
* ServicesDB
*/
class SQLite3ServicesDB extends ServicesDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Services } (`
            + 'id integer primary key unique, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'name text not null, '
            + 'remoteControlKeyId integer null, '
            + 'hasLogoData integer, '
            + 'channelType text, '
            + 'channelTypeId integer, '
            + 'channel text, '
            + 'type integer null'
            + ');'

        return this.operator.runQuery(query);
    }
}

export default SQLite3ServicesDB;

