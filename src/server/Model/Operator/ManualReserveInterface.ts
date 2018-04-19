import * as apid from '../../../../node_modules/mirakurun/api';
import { EncodeInterface } from './RuleInterface';

export interface AddReserveInterface {
    programId: apid.ProgramId;
    option?: AddReserveOptionInterface;
    encode?: EncodeInterface;
}

export interface AddReserveOptionInterface {
    directory?: string;
    recordedFormat?: string;
}

