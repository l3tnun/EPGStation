import * as DBSchema from '../DBSchema';
import { RulesDB } from '../RulesDB';

class SQLite3RulesDB extends RulesDB {
    /**
     * create table
     * @return Promise<void>
     */
    public create(): Promise<void> {
        const query = `create table if not exists ${ DBSchema.TableName.Rules } (`
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
        + ');';

        return this.operator.runQuery(query);
    }

    /**
     * @param DBSchema.RulesSchema[]
     * @return DBSchema.RulesSchema[]
     */
    protected fixResults(rules: DBSchema.RulesSchema[]): DBSchema.RulesSchema[] {
        return rules.map((rule) => {
            if (rule.keyCS !== null) { rule.keyCS = Boolean(rule.keyCS); }
            if (rule.keyRegExp !== null) { rule.keyRegExp = Boolean(rule.keyRegExp); }
            if (rule.title !== null) { rule.title = Boolean(rule.title); }
            if (rule.description !== null) { rule.description = Boolean(rule.description); }
            if (rule.extended !== null) { rule.extended = Boolean(rule.extended); }
            if (rule.GR !== null) { rule.GR = Boolean(rule.GR); }
            if (rule.BS !== null) { rule.BS = Boolean(rule.BS); }
            if (rule.CS !== null) { rule.CS = Boolean(rule.CS); }
            if (rule.SKY !== null) { rule.SKY = Boolean(rule.SKY); }
            if (rule.isFree !== null) { rule.isFree = Boolean(rule.isFree); }
            if (rule.enable !== null) { rule.enable = Boolean(rule.enable); }
            if (rule.delTs !== null) { rule.delTs = Boolean(rule.delTs); }

            return rule;
        });
    }
}

export default SQLite3RulesDB;

