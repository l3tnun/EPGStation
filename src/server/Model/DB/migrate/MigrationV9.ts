import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV9
 */
abstract class MigrationV9 extends MigrationBase {
    public readonly revision: number = 9;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // RecordedHistory へ channelId カラム追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.RecordedHistory,
                'channelId',
                this.getChannelIdColumnDefine(),
            ));
        });
    }

    /**
     * RecordedHistory へ channelId カラム追加時のカラム情報
     * @return string
     */
    protected getChannelIdColumnDefine(): string {
        return 'bigint null default null';
    }
}

export default MigrationV9;

