import DBOperator from '../DBOperator';
import * as DBSchema from '../DBSchema';
import { ProgramsDB } from '../ProgramsDB';

/**
 * SQLite3ProgramsDB
 */
class SQLite3ProgramsDB extends ProgramsDB {
    private regExp: boolean = false;

    constructor(operator: DBOperator) {
        super(operator);

        // config で regexp 用の拡張が設定されているか
        const config = this.config.getConfig().sqlite3;
        if (typeof config !== 'undefined' && typeof config.extensions !== 'undefined' && config.regexp) {
            this.regExp = true;
        }
    }

    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Programs } (`
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
            + 'shortName text null, '
            + 'description text null, '
            + 'extended text null, '
            + 'genre1 integer null, '
            + 'genre2 integer null, '
            + 'genre3 integer null, '
            + 'genre4 integer null, '
            + 'genre5 integer null, '
            + 'genre6 integer null, '
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
     * @param programs: ScheduleProgramItem[] | ProgramSchema[] | ProgramSchemaWithOverlap[]
     * @return ScheduleProgramItem[] | ProgramSchema[]
     */
    protected fixResults(programs: DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[] | DBSchema.ProgramSchemaWithOverlap[]): DBSchema.ScheduleProgramItem[] | DBSchema.ProgramSchema[] | DBSchema.ProgramSchemaWithOverlap[] {
        return (<any> programs).map((program: any) => {
            program.isFree = Boolean(program.isFree);
            if (typeof (<DBSchema.ProgramSchemaWithOverlap> program).overlap !== 'undefined') {
                (<DBSchema.ProgramSchemaWithOverlap> program).overlap = Boolean((<DBSchema.ProgramSchemaWithOverlap> program).overlap);
            }

            return program;
        });
    }

    /**
     * overlap のカラム設定
     * @return string
     */
    protected getOverlapColumn(): string {
        return '1 else 0';
    }

    /**
     * ルール検索実行部分
     * @param query: string
     * @param values: any[]
     * @param cs: boolean
     * @return Promise<DBSchema.ProgramSchema[]>
     */
    public runFindRule(query: string, values: any[], cs: boolean): Promise<DBSchema.ProgramSchema[]> {
        return this.operator.runQuery(query, values, cs);
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
