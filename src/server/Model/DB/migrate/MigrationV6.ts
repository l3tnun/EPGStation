import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV6
 */
abstract class MigrationV6 extends MigrationBase {
    public readonly revision: number = 6;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Rules へ allowEndLack カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Rules,
                'allowEndLack',
                this.getRulesAllowEndLackColumnDefine(),
            ));
        });
    }

    /**
     * Rules へ allowEndLack カラム追加時のカラム情報
     * @return string
     */
    protected getRulesAllowEndLackColumnDefine(): string {
        return 'boolean default true';
    }
}

export default MigrationV6;

