import * as apid from '../../../../api';

export default interface IScheduleApiModel {
    getSchedule(option: apid.ScheduleOption): Promise<apid.Schedule[]>;
    getChannelSchedule(option: apid.ChannelScheduleOption): Promise<apid.Schedule[]>;
    search(option: apid.RuleSearchOption, isHalfWidth: boolean, limit?: number): Promise<apid.ScheduleProgramItem[]>;
}
