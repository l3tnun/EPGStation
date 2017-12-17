import * as DBSchema from '../DBSchema';
import { RecordedDB } from '../RecordedDB';

class PostgreSQLRecordedDB extends RecordedDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Recorded } (`
            + 'id serial primary key, '
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
            + 'ruleId integer, '
            + 'thumbnailPath text, '
            + 'recording boolean '
        + ');'

        return this.operator.runQuery(query);
    }

    /**
    * recording 状態を解除する
    * @param id: recorded id
    * @return Promise<void>
    */
    public removeRecording(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where id = ${ id }`);
    }

    /**
    * recording 状態をすべて解除する
    * @return Promise<void>
    */
    public removeAllRecording(): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Recorded } set recording = false where recording = ${ true }`);
    }
}

export default PostgreSQLRecordedDB;

