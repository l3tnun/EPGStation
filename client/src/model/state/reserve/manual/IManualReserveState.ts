import * as apid from '../../../../../../api';

export interface ProgramStateData {
    display: {
        channelName: string;
        name: string;
        day: string;
        dow: string;
        startTime: string;
        endTime: string;
        duration: number;
        genres: string[];
        description?: string;
        extended?: string;
        videoType?: string;
        audioType?: string;
        audioSamplingRate?: string;
        isFree: boolean;
    };
    programItem: apid.ScheduleProgramItem;
}

export default interface IManualReserveState {
    isTimeSpecification: boolean;
    fetchProgramInfo(programId: apid.ProgramId, isHalfWidth: boolean): Promise<void>;
    getProgramInfo(): ProgramStateData | null;
}
