import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV3
 */
abstract class MigrationV3 extends MigrationBase {
    public readonly revision: number = 3;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Recorded へ protection カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'logPath',
                this.getRecordedLogPathColumnDefine(),
            ));

            // Reocrded へ errorCnt カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'errorCnt',
                this.getRecordedCntColumnDefine(),
            ));

            // Reocrded へ dropCnt カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'dropCnt',
                this.getRecordedCntColumnDefine(),
            ));

            // Reocrded へ scramblingCnt カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'scramblingCnt',
                this.getRecordedCntColumnDefine(),
            ));
        });
    }

    /**
     * Recorded へ logPath カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedLogPathColumnDefine(): string {
        return 'text default null';
    }

    /**
     * Recorded へ errorCnt, dropCnt, scramblingCnt  カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedCntColumnDefine(): string {
        return 'bigint null default null';
    }
}

export default MigrationV3;

