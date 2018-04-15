import * as DBSchema from '../DB/DBSchema';
import { EncodeInterface, OptionInterface } from './RuleInterface';

export interface ReserveProgram {
    program: DBSchema.ProgramSchema;
    encodeOption?: EncodeInterface;
    isSkip: boolean;
    isConflict: boolean;
}

/**
 * ルール予約
 */
export interface RuleReserveProgram extends ReserveProgram {
    ruleId?: number;
    ruleOption?: OptionInterface;
}

/**
 * 手動予約
 */
export interface ManualReserveProgram extends ReserveProgram {
    manualId?: number;
}

