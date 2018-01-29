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
}

export default DBBase;

