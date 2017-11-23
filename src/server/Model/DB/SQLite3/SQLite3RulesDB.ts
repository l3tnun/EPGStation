import * as DBSchema from '../DBSchema';
import { RulesDB } from '../RulesDB';

class SQLite3RulesDB extends RulesDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Rules } (`
            + 'id integer primary key autoincrement, '
            + 'keyword text, '
            + 'ignoreKeyword text, '
            + 'keyCS integer, '
            + 'keyRegExp integer, '
            + 'title integer, '
            + 'description integer, '
            + 'extended integer, '
            + 'GR integer, '
            + 'BS integer, '
            + 'CS integer, '
            + 'SKY integer, '
            + 'station integer, '
            + 'genrelv1 integer, '
            + 'genrelv2 integer, '
            + 'startTime integer, '
            + 'timeRange integer, '
            + 'week integer, '
            + 'isFree integer, '
            + 'durationMin integer, '
            + 'durationMax integer, '
            + 'enable integer, '
            + 'directory text, '
            + 'recordedFormat text, '
            + 'mode1 integer, '
            + 'directory1 text, '
            + 'mode2 integer, '
            + 'directory2 text, '
            + 'mode3 integer, '
            + 'directory3 text, '
            + 'delTs integer '
        + ');'

        return this.operator.runQuery(query);
    }

    /**
    * rule を有効化
    * @param id: rule id
    * @return Promise<void>
    */
    public enable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = 1 where id = ${ id }`);
    }

    /**
    * rule を無効化
    * @param id: rule id
    * @return Promise<void>
    */
    public disable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = 0 where id = ${ id }`);
    }
}

export default SQLite3RulesDB;

