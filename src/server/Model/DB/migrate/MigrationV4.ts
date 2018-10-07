import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

interface OldRulesSchema {
    id: number;
    keyCS: boolean | null;
    keyRegExp: boolean | null;
    title: boolean | null;
    description: boolean | null;
    extended: boolean | null;
}

/**
 * MigrationV4
 */
abstract class MigrationV4 extends MigrationBase {
    public readonly revision: number = 4;

    public async upgrade(): Promise<void> {
        const rules = await this.findAll();

        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Rules へ ignoreKeyCS カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'ignoreKeyCS',
                this.getColumnDefine(),
            ));

            // Rules へ ignoreKeyRegExp カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'ignoreKeyRegExp',
                this.getColumnDefine(),
            ));

            // Rules へ ignoreTitle カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'ignoreTitle',
                this.getColumnDefine(),
            ));

            // Rules へ ignoreDescription カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'ignoreDescription',
                this.getColumnDefine(),
            ));

            // Rules へ ignoreExtended カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'ignoreExtended',
                this.getColumnDefine(),
            ));

            // copy keyword option
            for (const rule of rules) {
                await this.copyOption(rule);
            }
        });
    }

    /**
     * keyword Option と id を取得
     * @return OldRulesSchema
     */
    private async findAll(): Promise<OldRulesSchema[]> {
        return <OldRulesSchema[]> await this.operator.runQuery(`select ${ this.getColumns() } from ${ TableName.Rules } order by id asc`);
    }

    /**
     * keyword option を ignore keyword option へコピー
     * @param rule: OldRulesSchema
     */
    private copyOption(rule: OldRulesSchema): Promise<void> {
        const query = `update ${ TableName.Rules } set`
            + ` ignoreKeyCS = ${ rule.keyCS },`
            + ` ignoreKeyRegExp = ${ rule.keyRegExp },`
            + ` ignoreTitle = ${ rule.title },`
            + ` ignoreDescription = ${ rule.description },`
            + ` ignoreExtended = ${ rule.extended }`
            + ` where id = ${ rule.id }`;

        return this.operator.runQuery(query);
    }

    /**
     * column
     * @return string
     */
    protected getColumns(): string {
        return 'id, keyCS, keyRegExp, title, description, extended';
    }

    /**
     * 追加カラム型
     * @return string
     */
    protected getColumnDefine(): string {
        return 'boolean';
    }
}

export default MigrationV4;

