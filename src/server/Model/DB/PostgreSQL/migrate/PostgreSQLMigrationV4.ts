import MigrationV4 from '../../migrate/MigrationV4';

/**
 * PostgreSQLMigrationV4
 */
class PostgreSQLMigrationV4 extends MigrationV4 {
    /**
     * column
     * @return string
     */
    protected getColumns(): string {
        return 'id, keyCS as "keyCS", keyRegExp as "keyRegExp", title, description, extended';
    }

}

export default PostgreSQLMigrationV4;

