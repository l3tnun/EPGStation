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
            + 'genre3 integer null, '
            + 'genre4 integer null, '
            + 'genre5 integer null, '
            + 'genre6 integer null, '
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
            + 'filesize integer null default null, '
            + 'logPath text default null, '
            + 'errorCnt integer null default null, '
            + 'dropCnt integer null default null, '
            + 'scramblingCnt integer null default null, '
            + 'isTmp integer default 0 '
        + ');';

        return this.operator.runQuery(query);
    }

    /**
     * @param baseDir: string
     * @param tmpDir: string || null
     * @param isTmp: boolean
     * @param logFileDir: string
     * @param thumbnailDir: string
     * @param program: DBSchema.RecordedSchema
     * @param isAddBaseDir: boolean
     * @return DBSchema.RecordedSchema
     */
    protected fixResult(
        baseDir: string,
        tmpDir: string | null,
        logFileDir: string,
        thumbnailDir: string,
        program: DBSchema.RecordedSchema,
        isAddBaseDir: boolean,
    ): DBSchema.RecordedSchema {
        program.recording = Boolean(program.recording);
        program.protection = Boolean(program.protection);
        program.isTmp = Boolean(program.isTmp);
        program = super.fixResult(baseDir, tmpDir, logFileDir, thumbnailDir, program, isAddBaseDir);

        return program;
    }
}

export default SQLite3RecordedDB;

