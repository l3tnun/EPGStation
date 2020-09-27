import * as apid from '../../../api';
import DropLogFile from '../../db/entities/DropLogFile';

export interface UpdateCntOption {
    id: apid.DropLogFileId;
    errorCnt: number;
    dropCnt: number;
    scramblingCnt: number;
}

export default interface IDropLogFileDB {
    restore(items: DropLogFile[]): Promise<void>;
    insertOnce(dropLogFile: DropLogFile): Promise<apid.DropLogFileId>;
    updateCnt(updateOption: UpdateCntOption): Promise<void>;
    deleteOnce(dropLogFileId: apid.DropLogFileId): Promise<void>;
    findId(dropLogFileId: apid.DropLogFileId): Promise<DropLogFile | null>;
    findAll(): Promise<DropLogFile[]>;
}
