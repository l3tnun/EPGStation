import MigrationV1 from '../../migrate/MigrationV1';

/**
* SQLite3MigrationV1
*/
class SQLite3MigrationV1 extends MigrationV1 {
    /**
    * Recorded へ protection カラム追加時のカラム情報
    * @return string
    */
    protected getRecordedProtectionColumnDefine(): string {
        return 'integer default 0';
    }

    /**
    * Recorded へ filesize カラム追加時のカラム情報
    * @return string
    */
    protected getRecordedFileSizeColumnDefine(): string {
        return 'integer null default null';
    }

    /**
    * Encoded へ filesize カラム追加時のカラム情報
    * @return string
    */
    protected getEncodedFileSizeColumnDefine(): string {
        return 'integer null default null';
    }
}

export default SQLite3MigrationV1;

