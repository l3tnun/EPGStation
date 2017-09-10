import * as DBSchema from '../Model/DB/DBSchema';
import { OptionInterface, EncodeInterface } from './RuleInterface';

export interface ReserveProgram {
    program: DBSchema.ProgramSchema;
    ruleId?: number;
    ruleOption?: OptionInterface;
    encodeOption?: EncodeInterface;
    isSkip?: boolean;
    isManual: boolean;     //手動予約時にtrue
    manualId?: number;      //手動予約時に追加する
    isConflict: boolean;
}

