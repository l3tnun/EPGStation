import MigrationV2 from '../../migrate/MigrationV2';

/**
 * SQLite3MigrationV2
 */
class SQLite3MigrationV2 extends MigrationV2 {
    /**
     * Rules へ avoidDuplicate カラムを追加時のカラム情報
     */
    protected getRulesAvoidDuplicateColumnDefine(): string {
        return 'integer default 0';
    }
}

export default SQLite3MigrationV2;

