import * as DBSchema from '../DBSchema';
import { ServicesDB } from '../ServicesDB';

/**
* ServicesDB
*/
class PostgreSQLServicesDB extends ServicesDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Services } (`
            + 'id bigint primary key, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'name text not null, '
            + 'remoteControlKeyId integer null, '
            + 'hasLogoData boolean, '
            + 'channelType text, '
            + 'channelTypeId integer, '
            + 'channel text, '
            + 'type integer null'
            + ');'

        return this.operator.runQuery(query);
    }

    /**
    * all columns
    * @return string
    */
    public getAllColumns(): string {
        return 'id, serviceId as "serviceId", networkId as "networkId", name, remoteControlKeyId as "remoteControlKeyId", hasLogoData as "hasLogoData", channelType as "channelType", channelTypeId as "channelTypeId", channel, type';
    }
}

export default PostgreSQLServicesDB;

