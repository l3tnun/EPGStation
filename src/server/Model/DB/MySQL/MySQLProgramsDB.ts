import * as DBSchema from '../DBSchema';
import { ProgramsDB } from '../ProgramsDB';

/**
* MySQLProgramsDB
*/
class MySQLProgramsDB extends ProgramsDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Programs } (`
            + 'id BIGINT primary key unique, '
            + 'channelId bigint not null, '
            + 'eventId bigint not null, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'startAt bigint not null, '
            + 'endAt bigint not null, '
            + 'startHour integer not null, '
            + 'week integer not null, '
            + 'duration bigint not null, '
            + 'isFree boolean not null, '
            + 'name text not null, '
            + 'description text null, '
            + 'extended text null, '
            + 'genre1 integer null, '
            + 'genre2 integer null, '
            + 'channelType text not null, '
            + 'channel text not null, '
            + 'videoType text null, '
            + 'videoResolution text null, '
            + 'videoStreamContent integer null, '
            + 'videoComponentType integer null, '
            + 'audioSamplingRate integer null, '
            + 'audioComponentType integer null '
            + ');'

        return this.operator.runQuery(query);
    }
}

export default MySQLProgramsDB;
