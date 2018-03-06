import DBBase from './DBBase';

abstract class DBTableBase extends DBBase {
    /**
     * ping
     * @return Promise<void>
     */
    public ping(): Promise<void> {
        return this.operator.ping();
    }

    /**
     * end
     * @return Promise<void>
     */
    public end(): Promise<void> {
        return this.operator.end();
    }

    /**
     * all columns
     * @return string
     */
    public getAllColumns(): string {
        return '*';
    }

    /**
     * get table name
     * @return string
     */
    protected abstract getTableName(): string;

    /**
     * テーブルが存在するか
     * @return boolean
     */
    public exists(): Promise<boolean> {
        return this.operator.exists(this.getTableName());
    }
}

export default DBTableBase;

