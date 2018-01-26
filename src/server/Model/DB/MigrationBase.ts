import DBBase from './DBBase';

/**
* MigrationBase
*/
abstract class MigrationBase extends DBBase {
    abstract readonly revision: number;

    abstract upgrade(): Promise<void>;
}

export default MigrationBase;

