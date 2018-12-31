import MigrationV7 from '../../migrate/MigrationV7';

/**
 * SQLite3MigrationV7
 */
class SQLite3MigrationV7 extends MigrationV7 {
    /**
     * Recorded へ isTmp カラム追加時のカラム情報
     * @return string
     */
    protected getRecordedIsTmpColumnDefine(): string {
        return 'integer default 0';
    }
}

export default SQLite3MigrationV7;

