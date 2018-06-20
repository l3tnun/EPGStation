import * as DBSchema from '../DBSchema';
import { RecordedDB } from '../RecordedDB';

class SQLite3RecordedDB extends RecordedDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Recorded } (`
            + 'id integer primary key autoincrement, '
            + 'programId integer not null, '
            + 'channelId integer not null, '
            + 'channelType text not null, '
            + 'startAt integer not null, '
            + 'endAt integer not null, '
            + 'duration integer not null, '
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
            + 'recording integer, '
            + 'protection integer default 0, '
            + 'filesize integer null default null '
        + ');';

        return this.operator.runQuery(query);
    }

    /**
     * @param baseDir: string
     * @param thumbnailDir: string
     * @param program: DBSchema.RecordedSchema
     * @return DBSchema.RecordedSchema
     */
    protected fixResult(baseDir: string, thumbnailDir: string, program: DBSchema.RecordedSchema, addBaseDir: boolean = true): DBSchema.RecordedSchema {
        program = super.fixResult(baseDir, thumbnailDir, program, addBaseDir);
        program.recording = Boolean(program.recording);
        program.protection = Boolean(program.protection);

        return program;
    }
}

export default SQLite3RecordedDB;

