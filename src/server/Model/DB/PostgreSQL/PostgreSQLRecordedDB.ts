import * as DBSchema from '../DBSchema';
import { RecordedDB } from '../RecordedDB';

class PostgreSQLRecordedDB extends RecordedDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Recorded } (`
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
            + 'ruleId integer, '
            + 'thumbnailPath text, '
            + 'recording boolean, '
            + 'protection boolean default false, '
            + 'filesize bigint null default null, '
            + 'logPath text default null, '
            + 'errorCnt bigint null default null, '
            + 'dropCnt bigint null default null, '
            + 'scramblingCnt bigint null default null, '
            + 'isTmp boolean default false '
        + ');';

        return this.operator.runQuery(query);
    }

    /**
     * restore
     * @param program: DBSchema.RecordedSchema[]
     * @param isDelete: boolean
     * @param hasBaseDir: boolean
     */
    public async restore(programs: DBSchema.RecordedSchema[], isDelete: boolean = true, hasBaseDir: boolean = true): Promise<void> {
        await super.restore(programs, isDelete, hasBaseDir);

        // シーケンス値の修正
        await this.operator.runQuery(`select setval('${ DBSchema.TableName.Recorded }_id_seq', (select max(id) from ${ DBSchema.TableName.Recorded }))`);
    }

    /**
     * create like str
     */
    public createLikeStr(): string {
        return 'ilike';
    }

    /**
     * 指定した項目の集計
     * @return Promise<T>
     */
    protected getTag<T>(item: string): Promise<T> {
        return this.operator.runQuery(`select count(*) as cnt, ${ item } as "${ item }" from ${ DBSchema.TableName.Recorded } group by ${ item } order by ${ item } asc nulls first`);
    }

    /**
     * all columns
     * @return string
     */
    public getAllColumns(): string {
        return 'id, programId as "programId", channelId as "channelId", channelType as "channelType", startAt as "startAt", endAt as "endAt", duration, name, description, extended, genre1, genre2, genre3, genre4, genre5, genre6, videoType as "videoType", videoResolution as "videoResolution", videoStreamContent as "videoStreamContent", videoComponentType as "videoComponentType", audioSamplingRate as "audioSamplingRate", audioComponentType as "audioComponentType", recPath as "recPath", ruleId as "ruleId", thumbnailPath as "thumbnailPath", recording, protection, filesize, logPath as "logPath", errorCnt as "errorCnt", dropCnt as "dropCnt", scramblingCnt as "scramblingCnt", isTmp as "isTmp"';
    }

    /**
     * get recPath column str
     * @return string
     */
    protected getRecPathColumnStr(): string {
        return 'recPath as "recPath"';
    }

    /**
     * get logPath column str
     * @return string
     */
    protected getLogPathColumnStr(): string {
        return 'logPath as "logPath"';
    }

    /**
     * get isTmp column str
     * @return string
     */
    protected getIsTmpColumnStr(): string {
        return 'isTmp as "isTmp"';
    }
}

export default PostgreSQLRecordedDB;

