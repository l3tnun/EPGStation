import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV2
 */
abstract class MigrationV2 extends MigrationBase {
    public readonly revision: number = 2;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Programs へ shortname カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Programs,
                'shortName',
                this.getProgramsShortNameColumnDefine(),
            ));

            // Rules へ avoidDuplicate カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'avoidDuplicate',
                this.getRulesAvoidDuplicateColumnDefine(),
            ));

            // Rules へ periodToAvoidDuplicate カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'periodToAvoidDuplicate',
                this.getRulesPeriodToAvoidDuplicateColumnDefine(),
            ));
        });
    }

    /**
     * Programs へ shortname カラムを追加時のカラム情報
     */
    protected getProgramsShortNameColumnDefine(): string {
        return 'text null';
    }

    /**
     * Rules へ avoidDuplicate カラムを追加時のカラム情報
     */
    protected getRulesAvoidDuplicateColumnDefine(): string {
        return 'boolean default false';
    }

    /**
     * Rule へ periodToAvoidDuplicate カラムを追加時のカラム情報
     */
    protected getRulesPeriodToAvoidDuplicateColumnDefine(): string {
        return 'integer null default null';
    }
}

export default MigrationV2;

