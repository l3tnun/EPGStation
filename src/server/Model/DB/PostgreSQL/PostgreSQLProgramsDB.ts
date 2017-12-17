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
        let query = `create table if not exists ${ DBSchema.TableName.Programs } (`
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
            + ');'

        return this.operator.runQuery(query);
    }

    /**
    * insert 時の config を取得
    */
    public getInsertConfig(): { insertMax: number, insertWait: number } {
        const config = this.config.getConfig();
        return {
            insertMax: config.programInsertMax || 100,
            insertWait: config.programInsertWait || 0,
        }
    }

    /**
    * ルール検索実行部分
    * @param query: string
    * @return Promise<DBSchema.ProgramSchema[]>
    */
    public runFindRule(query: string): Promise<DBSchema.ProgramSchema[]> {
        return this.operator.runQuery(query);
    }

    /**
    * regexp が有効か
    * @return boolean
    */
    public isEnableRegExp(): boolean {
        return true;
    }

    /**
    * 大文字小文字判定が有効か
    * @return boolean
    */
    public isEnableCS(): boolean {
        return true;
    }
}

export default PostgreSQLProgramsDB;
