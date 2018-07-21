import MigrationV3 from '../../migrate/MigrationV3';

/**
 * SQLite3MigrationV3
 */
class SQLite3MigrationV3 extends MigrationV3 {
    /**
     * Recorded へ errorCnt, dropCnt, scramblingCnt  カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedCntColumnDefine(): string {
        return 'integer null default null';
    }
}

export default SQLite3MigrationV3;

