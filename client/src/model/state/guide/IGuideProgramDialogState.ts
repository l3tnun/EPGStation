import * as apid from '../../../../../api';
import { ReserveType } from './IGuideReserveUtil';

export interface ProgramDialogReseveItem {
    type: ReserveType;
    reserveId: apid.ReserveId;
    ruleId?: apid.RuleId;
}

export interface ProgramDialogOpenOption {
    channel: apid.ScheduleChannleItem | null;
    program: apid.ScheduleProgramItem;
    reserve?: ProgramDialogReseveItem;
}

export interface DisplayProgramData {
    channelName: string;
    programName: string;
    time: string;
    genres?: string[];
    description?: string;
    extended?: string;
    videoType?: string;
    audioType?: string;
    audioSamplingRate?: string;
    isFree: boolean;
}

export default interface IGuideProgramDialogState {
    isOpen: boolean;
    displayData: DisplayProgramData | null;
    reserve: ProgramDialogReseveItem | null;
    open(option: ProgramDialogOpenOption): void;
    close(): void;
    getProgramId(): apid.ProgramId | null;
    getProgram(): apid.ScheduleProgramItem | null;
    getEncodeList(): string[];
    updateReserve(reserve: ProgramDialogReseveItem | null): void;
    addReserve(): Promise<void>;
    cancelReserve(): Promise<void>;
    removeReserveSkip(): Promise<void>;
    removeReserveOverlap(): Promise<void>;
}
