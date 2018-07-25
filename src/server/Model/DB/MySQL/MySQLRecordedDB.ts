import * as DBSchema from '../DBSchema';
import { RecordedDB } from '../RecordedDB';

class MySQLRecordedDB extends RecordedDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `CREATE TABLE IF NOT EXISTS ${ DBSchema.TableName.Recorded } (`
            + 'id int primary key auto_increment, '
            + 'programId bigint not null, '
            + 'channelId bigint not null, '
            + 'channelType text not null, '
            + 'startAt bigint not null, '
            + 'endAt bigint not null, '
            + 'duration bigint not null, '
            + 'name text not null, '
            + 'description text null, '
            + 'extended text null, '
            + 'genre1 integer null, '
            + 'genre2 integer null, '
            + 'videoType text null, '
            + 'videoResolution text null, '
            + 'videoStreamContent integer null, '
            + 'videoComponentType integer null, '
            + 'audioSamplingRate integer null, '
            + 'audioComponentType integer null, '
            + 'recPath text, '
            + 'ruleId int, '
            + 'thumbnailPath text, '
            + 'recording boolean, '
            + 'protection boolean default false, '
            + 'filesize bigint null default null, '
            + 'logPath text default null, '
            + 'errorCnt bigint null default null, '
            + 'dropCnt bigint null default null, '
            + 'scramblingCnt bigint null default null '
        + ') engine=InnoDB;';

        return this.operator.runQuery(query);
    }
}

export default MySQLRecordedDB;

