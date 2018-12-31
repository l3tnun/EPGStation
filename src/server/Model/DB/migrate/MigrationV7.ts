import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV7
 */
abstract class MigrationV7 extends MigrationBase {
    public readonly revision: number = 7;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Recorded へ isTmp カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'isTmp',
                this.getRecordedIsTmpColumnDefine(),
            ));
        });
    }

    /**
     * Recorded へ isTmp カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedIsTmpColumnDefine(): string {
        return 'boolean default false';
    }
}

export default MigrationV7;

