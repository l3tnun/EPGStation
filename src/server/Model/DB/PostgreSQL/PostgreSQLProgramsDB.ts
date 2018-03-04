import * as DBSchema from '../DBSchema';
import { ProgramsDB } from '../ProgramsDB';

/**
 * PostgreSQLProgramsDB
 */
class PostgreSQLProgramsDB extends ProgramsDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Programs } (`
            + 'id bigint primary key, '
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
            + ');';

        return this.operator.runQuery(query);
    }

    /**
     * create regexp str
     * @param cs: boolean 大小文字区別
     * @return string
     */
    public createRegexpStr(cs: boolean): string {
        return cs ? '~' : '~*';
    }

    /**
     * create like str
     * @param cs: boolean 大小文字区別
     */
    public createLikeStr(cs: boolean): string {
        return cs ? 'like' : 'ilike';
    }

    /**
     * create isFree option
     * @param isFree: boolean
     * @return string
     */
    protected createIsFree(isFree: boolean): string {
        return `isFree = ${ Boolean(isFree) }`;
    }

    /**
     * all columns
     * @return string
     */
    public getAllColumns(): string {
        return 'id, channelId as "channelId", eventId as "eventId", serviceId as "serviceId", networkId as "networkId", startAt as "startAt", endAt as "endAt", startHour as "startHour", week, duration, isFree as "isFree", name, description, extended, genre1, genre2, channelType as "channelType", channel, videoType as "videoType", videoResolution as "videoResolution", videoStreamContent as "videoStreamContent", videoComponentType as "videoComponentType", audioSamplingRate as "audioSamplingRate", audioComponentType as "audioComponentType"';
    }

    /**
     * min columns
     * @return string
     */
    protected getMinColumns(): string {
        return 'id, channelId as "channelId", startAt as "startAt", endAt as "endAt", isFree as "isFree" , name, description, extended, genre1, genre2, channelType as "channelType", videoType as "videoType", videoResolution as "videoResolution", videoStreamContent as "videoStreamContent", videoComponentType as "videoComponentType", audioSamplingRate as "audioSamplingRate", audioComponentType as "audioComponentType"';
    }
}

export default PostgreSQLProgramsDB;

