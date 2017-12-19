import Model from '../Model';
import DBOperator from './DBOperator';

/**
* DBBase クラス
*/
abstract class DBBase extends Model {
    protected operator: DBOperator;

    constructor(operator: DBOperator) {
        super();
        this.operator = operator;
    }

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
}

export default DBBase;

