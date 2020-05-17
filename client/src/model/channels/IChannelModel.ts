import * as apid from '../../../../api';

export interface Channel extends apid.ScheduleChannleItem {
    channel: string;
}

export default interface IChannelModel {
    fetchChannels(): Promise<void>;
    getChannels(isHalfWidth: boolean): Channel[];
    findChannel(id: apid.ChannelId, isHalfWidth: boolean): Channel | null;
}
