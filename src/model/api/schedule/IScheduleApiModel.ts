import * as apid from '../../../../api';

export default interface IScheduleApiModel {
    getSchedule(programId: apid.ProgramId, isHalfWidth: boolean): Promise<apid.ScheduleProgramItem | null>;
    getSchedules(option: apid.ScheduleOption): Promise<apid.Schedule[]>;
    getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]>;
    getBroadcastingSchedule(option: apid.BroadcastingScheduleOption): Promise<apid.Schedule[]>;
    search(option: apid.RuleSearchOption, isHalfWidth: boolean, limit?: number): Promise<apid.ScheduleProgramItem[]>;
}
