import MigrationV4 from '../../migrate/MigrationV4';

/**
 * SQLite3MigrationV4
 */
class SQLite3MigrationV4 extends MigrationV4 {
    /**
     * 追加カラム型
     * @return string
     */
    protected getColumnDefine(): string {
        return 'integer';
    }
}

export default SQLite3MigrationV4;

