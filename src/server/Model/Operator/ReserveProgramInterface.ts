import * as apid from '../../../../node_modules/mirakurun/api';
import * as DBSchema from '../DB/DBSchema';
import { EncodeInterface } from './RuleInterface';

export interface ReserveProgram {
    program: DBSchema.ProgramSchema;
    encodeOption?: EncodeInterface;
    isSkip: boolean;
    isConflict: boolean;
    option?: ReserveOptionInterface;
}

/**
 * ルール予約
 */
export interface RuleReserveProgram extends ReserveProgram {
    ruleId: number;
    isOverlap: boolean;
    disableOverlap: boolean;
}

/**
 * 手動予約
 */
export interface ManualReserveProgram extends ReserveProgram {
    manualId: number;
}

export interface ReserveOptionInterface {
    directory?: string;
    recordedFormat?: string;
}

/**
 * 予約追加時データ
 */
export interface AddReserveInterface {
    programId: apid.ProgramId;
    option?: ReserveOptionInterface;
    encode?: EncodeInterface;
}

