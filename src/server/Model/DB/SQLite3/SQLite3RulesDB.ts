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
            + 'ignoreKeyCS integer, '
            + 'ignoreKeyRegExp integer, '
            + 'ignoreTitle integer, '
            + 'ignoreDescription integer, '
            + 'ignoreExtended integer, '
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
            + 'avoidDuplicate integer default 0, '
            + 'periodToAvoidDuplicate integer null default null, '
            + 'enable integer, '
            + 'allowEndLack integer default 1, '
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
            if (rule.ignoreKeyCS !== null) { rule.ignoreKeyCS = Boolean(rule.ignoreKeyCS); }
            if (rule.ignoreKeyRegExp !== null) { rule.ignoreKeyRegExp = Boolean(rule.ignoreKeyRegExp); }
            if (rule.ignoreTitle !== null) { rule.ignoreTitle = Boolean(rule.ignoreTitle); }
            if (rule.ignoreDescription !== null) { rule.ignoreDescription = Boolean(rule.ignoreDescription); }
            if (rule.ignoreExtended !== null) { rule.ignoreExtended = Boolean(rule.ignoreExtended); }
            if (rule.GR !== null) { rule.GR = Boolean(rule.GR); }
            if (rule.BS !== null) { rule.BS = Boolean(rule.BS); }
            if (rule.CS !== null) { rule.CS = Boolean(rule.CS); }
            if (rule.SKY !== null) { rule.SKY = Boolean(rule.SKY); }
            if (rule.isFree !== null) { rule.isFree = Boolean(rule.isFree); }
            if (rule.avoidDuplicate !== null) { rule.avoidDuplicate = Boolean(rule.avoidDuplicate); }
            if (rule.enable !== null) { rule.enable = Boolean(rule.enable); }
            if (rule.allowEndLack !== null) { rule.allowEndLack = Boolean(rule.allowEndLack); }
            if (rule.delTs !== null) { rule.delTs = Boolean(rule.delTs); }

            return rule;
        });
    }
}

export default SQLite3RulesDB;

