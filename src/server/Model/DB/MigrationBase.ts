import DBBase from './DBBase';

/**
 * MigrationBase
 */
abstract class MigrationBase extends DBBase {
    public abstract readonly revision: number;

    public abstract upgrade(): Promise<void>;
}

export default MigrationBase;

