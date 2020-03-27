import MigrationV9 from '../../migrate/MigrationV9';

/**
 * SQLite3MigrationV9
 */
class SQLite3MigrationV9 extends MigrationV9 {
    /**
     * RecordedHistory へ channelId カラム追加時のカラム情報
     * @return string
     */
    protected getChannelIdColumnDefine(): string {
        return 'integer null default null';
    }
}

export default SQLite3MigrationV9;

