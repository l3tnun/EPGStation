import * as DBSchema from '../DBSchema';
import { RulesDB } from '../RulesDB';

class PostgreSQLRulesDB extends RulesDB {
    /**
    * create table
    * @return Promise<void>
    */
    public create(): Promise<void> {
        let query = `create table if not exists ${ DBSchema.TableName.Rules } (`
            + 'id serial primary key, '
            + 'keyword text, '
            + 'ignoreKeyword text, '
            + 'keyCS boolean, '
            + 'keyRegExp boolean, '
            + 'title boolean, '
            + 'description boolean, '
            + 'extended boolean, '
            + 'GR boolean, '
            + 'BS boolean, '
            + 'CS boolean, '
            + 'SKY boolean, '
            + 'station bigint, '
            + 'genrelv1 integer, '
            + 'genrelv2 integer, '
            + 'startTime integer, '
            + 'timeRange integer, '
            + 'week integer, '
            + 'isFree boolean, '
            + 'durationMin integer, '
            + 'durationMax integer, '
            + 'enable boolean, '
            + 'directory text, '
            + 'recordedFormat text, '
            + 'mode1 integer, '
            + 'directory1 text, '
            + 'mode2 integer, '
            + 'directory2 text, '
            + 'mode3 integer, '
            + 'directory3 text, '
            + 'delTs boolean '
        + ');'

        return this.operator.runQuery(query);
    }

    /**
    * rule を有効化
    * @param id: rule id
    * @return Promise<void>
    */
    public enable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = true where id = ${ id }`);
    }

    /**
    * rule を無効化
    * @param id: rule id
    * @return Promise<void>
    */
    public disable(id: number): Promise<void> {
        return this.operator.runQuery(`update ${ DBSchema.TableName.Rules } set enable = false where id = ${ id }`);
    }

    /**
    * all columns
    * @return string
    */
    public getAllColumns(): string {
        return 'id, keyword, ignoreKeyword as "ignoreKeyword", keyCS as "keyCS", keyRegExp as "keyRegExp", title, description, extended, GR as "GR", BS as "BS", CS as "CS", SKY as "SKY", station, genrelv1, genrelv2, startTime as "startTime", timeRange as "timeRange", week, isFree as "isFree", durationMin as "durationMin", durationMax as "durationMax", enable, directory, recordedFormat, mode1, directory1, mode2, directory2, mode3, directory3, delTs';
    }
}

export default PostgreSQLRulesDB;

