import * as DBSchema from '../DBSchema';
import { ServicesDB } from '../ServicesDB';

/**
 * ServicesDB
 */
class MySQLServicesDB extends ServicesDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Services } (`
            + 'id BIGINT primary key unique, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'name text not null, '
            + 'remoteControlKeyId integer null, '
            + 'hasLogoData boolean, '
            + 'channelType text, '
            + 'channelTypeId integer, '
            + 'channel text, '
            + 'type integer null'
            + ');';

        return this.operator.runQuery(query);
    }
}

export default MySQLServicesDB;

