import * as apid from '../../../../../api';

export default interface IScheduleApiModel {
    getSchedule(programId: apid.ProgramId, isHalfWidth: boolean): Promise<apid.ScheduleProgramItem>;
    getSchedules(option: apid.ScheduleOption): Promise<apid.Schedule[]>;
    getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]>;
    getScheduleSearch(option: apid.ScheduleSearchOption): Promise<apid.ScheduleProgramItem[]>;
    getScheduleOnAir(option: apid.BroadcastingScheduleOption): Promise<apid.Schedule[]>;
}
