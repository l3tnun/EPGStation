import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

interface RulesSchema {
    id: number;
    keyword: string | null;
    ignoreKeyword: string | null;
}

/**
 * MigrationV8
 */
abstract class MigrationV8 extends MigrationBase {
    public readonly revision: number = 8;

    public async upgrade(): Promise<void> {
        const rules = await this.findAll();

        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Rules へ halfKeyword カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'halfKeyword',
                this.getColumnDefine(),
            ));

            // Rules へ halfIgnoreKeyword カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'halfIgnoreKeyword',
                this.getColumnDefine(),
            ));

            // halfKeyword に keyword を 半角化したものをセット
            // halfIgnoreKeyword に ignoreKeyword を半角化したものをセット
            for (const rule of rules) {
                await this.copyOption(rule, exec);
            }
        });
    }

    /**
     * keyword Option と id を取得
     * @return RulesSchema
     */
    private async findAll(): Promise<RulesSchema[]> {
        return <RulesSchema[]> await this.operator.runQuery(`select ${ this.getColumns() } from ${ TableName.Rules } order by id asc`);
    }

    /**
     * halfKeyword と halfIgnoreKeyword を生成
     * @param rule: RulesSchema
     * @param exec: (query: string, values?: any) => Promise<void>
     */
    private async copyOption(rule: RulesSchema, exec: (query: string, values?: any) => Promise<void>): Promise<void> {
        const query = `update ${ TableName.Rules } set `
            + `halfKeyword = ${ this.operator.createValueStr(1, 1) }, `
            + `halfIgnoreKeyword = ${ this.operator.createValueStr(2, 2) } `
            + `where id = ${ rule.id }`;

        const values: any[] = [];
        values.push(this.convertStr(rule.keyword));
        values.push(this.convertStr(rule.ignoreKeyword));

        await exec(query, values);
    }

    /**
     * 半角化
     * @param str | null
     * @return string | null
     */
    private convertStr(str: string | null): string | null {
        if (str === null) { return null; }

        const tmp = str.replace(/[！-～]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        return tmp.replace(/”/g, '"')
            .replace(/’/g, '\'')
            .replace(/‘/g, '`')
            .replace(/￥/g, '\\')
            // tslint:disable-next-line:no-irregular-whitespace
            .replace(/　/g, ' ')
            .replace(/〜/g, '~')
            .replace(/\x00/g, ''); // PostgreSQL 非対応文字
    }

    /**
     * column
     * @return string
     */
    protected getColumns(): string {
        return 'id, keyword, ignoreKeyword';
    }

    /**
     * 追加カラム型
     * @return string
     */
    private getColumnDefine(): string {
        return 'text';
    }
}

export default MigrationV8;

