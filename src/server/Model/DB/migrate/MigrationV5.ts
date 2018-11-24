import { TableName } from '../DBSchema';
import MigrationBase from '../MigrationBase';

/**
 * MigrationV5
 */
abstract class MigrationV5 extends MigrationBase {
    public readonly revision: number = 5;

    public async upgrade(): Promise<void> {
        await this.operator.runTransaction(async(exec: (query: string, values?: any) => Promise<void>) => {
            // Programs へ genre3 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Programs,
                'genre3',
                this.getProgramGenreColumnDefine(),
            ));
            // Programs へ genre4 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Programs,
                'genre4',
                this.getProgramGenreColumnDefine(),
            ));
            // Programs へ genre5 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Programs,
                'genre5',
                this.getProgramGenreColumnDefine(),
            ));
            // Programs へ genre6 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Programs,
                'genre6',
                this.getProgramGenreColumnDefine(),
            ));
            // Recorded へ genre3 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'genre3',
                this.getProgramGenreColumnDefine(),
            ));
            // Reorded へ genre4 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'genre4',
                this.getProgramGenreColumnDefine(),
            ));
            // Recorded へ genre5 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'genre5',
                this.getProgramGenreColumnDefine(),
            ));
            // Recorded へ genre6 カラムを追加
            await exec(this.operator.createAddcolumnQueryStr(
                TableName.Recorded,
                'genre6',
                this.getProgramGenreColumnDefine(),
            ));
        });
    }

    /**
     * Program へ Genre カラム追加時のカラム情報
     * @return string
     */
    protected getProgramGenreColumnDefine(): string {
        return 'integer null default null';
    }
}

export default MigrationV5;

