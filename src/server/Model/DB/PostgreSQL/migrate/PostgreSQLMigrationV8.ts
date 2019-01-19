import MigrationV8 from '../../migrate/MigrationV8';

/**
 * PostgreSQLMigrationV8
 */
class PostgreSQLMigrationV8 extends MigrationV8 {
    /**
     * column
     * @return string
     */
    protected getColumns(): string {
        return 'id, keyword, ignoreKeyword as "ignoreKeyword"';
    }
}

export default PostgreSQLMigrationV8;

