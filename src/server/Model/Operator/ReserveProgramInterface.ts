import * as DBSchema from '../DB/DBSchema';
import { EncodeInterface, OptionInterface } from './RuleInterface';

export interface ReserveProgram {
    program: DBSchema.ProgramSchema;
    ruleId?: number;
    ruleOption?: OptionInterface;
    encodeOption?: EncodeInterface;
    isSkip: boolean;
    isManual: boolean; // 手動予約時にtrue
    manualId?: number; // 手動予約時に追加する
    isConflict: boolean;
}

