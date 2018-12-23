import MigrationV6 from '../../migrate/MigrationV6';

/**
 * SQLite3MigrationV6
 */
class SQLite3MigrationV6 extends MigrationV6 {
    /**
     * Rules へ allowEndLack カラム追加時のカラム情報
     * @return string
     */
    protected getRulesAllowEndLackColumnDefine(): string {
        return 'integer default 1';
    }
}

export default SQLite3MigrationV6;

