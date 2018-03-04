import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV1
 */
abstract class MigrationV1 extends MigrationBase {
    public readonly revision: number = 1;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Recorded へ protection カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'protection',
                this.getRecordedProtectionColumnDefine(),
            ));

            // Reocrded へ filesize カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'filesize',
                this.getRecordedFileSizeColumnDefine(),
            ));

            // Encoded へ filesize カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Encoded,
                'filesize',
                this.getEncodedFileSizeColumnDefine(),
            ));
        });
    }

    /**
     * Recorded へ protection カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedProtectionColumnDefine(): string {
        return 'boolean default false';
    }

    /**
     * Recorded へ filesize カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedFileSizeColumnDefine(): string {
        return 'bigint null default null';
    }

    /**
     * Encoded へ filesize カラム追加時のカラム情報
     * @return string
     */
    protected getEncodedFileSizeColumnDefine(): string {
        return 'bigint null default null';
    }
}

export default MigrationV1;

