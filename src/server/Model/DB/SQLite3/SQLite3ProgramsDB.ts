import * as DBSchema from '../DBSchema';
import { ProgramsDB } from '../ProgramsDB';
import DBOperator from '../DBOperator';

/**
* SQLite3ProgramsDB
*/
class SQLite3ProgramsDB extends ProgramsDB {
    private regExp: boolean = false;

    constructor(operator: DBOperator) {
        super(operator);

        // config で regexp 用の拡張が設定されているか
        const config = this.config.getConfig().sqlite3;
        if(typeof config !== 'undefined' && typeof config.extensions !== 'undefined' && config.regexp) {
            this.regExp = true;
        }
    }

    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Programs } (`
            + 'id integer primary key unique, '
            + 'channelId integer not null, '
            + 'eventId integer not null, '
            + 'serviceId integer not null, '
            + 'networkId integer not null, '
            + 'startAt integer not null, '
            + 'endAt integer not null, '
            + 'startHour integer not null, '
            + 'week integer not null, '
            + 'duration integer not null, '
            + 'isFree integer not null, '
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
        let insertMax = config.programInsertMax || 10;
        if(insertMax > 10) { insertMax = 10; }

        return {
            insertMax: insertMax,
            insertWait: config.programInsertWait || 0,
        }
    }

    /**
    * ルール検索実行部分
    * @param query: string
    * @param cs: boolean
    * @return Promise<DBSchema.ProgramSchema[]>
    */
    public runFindRule(query: string, cs: boolean): Promise<DBSchema.ProgramSchema[]> {
        return this.operator.runQuery(query, null, cs);
    }

    /**
    * regexp が有効か
    * @return boolean
    */
    public isEnableRegExp(): boolean {
        return this.regExp;
    }

    /**
    * 大文字小文字判定が有効か
    * @return boolean
    */
    public isEnableCS(): boolean {
        return false;
    }
}

export default SQLite3ProgramsDB;
