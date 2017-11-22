import Model from '../Model';

/**
* DBBase クラス
*/
abstract class DBBase extends Model {
    /**
    * ping
    * @return Promise<void>
    */
    abstract ping(): Promise<void>;

    /**
    * end
    * @return Promise<void>
    */
    abstract end(): Promise<void>;
}

export default DBBase;

