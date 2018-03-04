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
        const query = `create table if not exists ${ DBSchema.TableName.Services } (`
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
            + ');';

        return this.operator.runQuery(query);
    }

    /**
     * @param services: DBSchema.ServiceSchema[]
     * @return DBSchema.ServiceSchema[]
     */
    protected fixResults(services: DBSchema.ServiceSchema[]): DBSchema.ServiceSchema[] {
        return services.map((service) => {
            service.hasLogoData = Boolean(service.hasLogoData);

            return service;
        });
    }
}

export default SQLite3ServicesDB;

