import * as apid from '../../../../../api';

export type LiveStreamType = 'M2TS' | 'WebM' | 'MP4' | 'HLS';

export default interface IOnAirSelectStreamState {
    isOpen: boolean;
    open(channelItem: apid.ScheduleChannleItem): void;
    close(): void;
    getChannelItem(): apid.ScheduleChannleItem | null;
    getStreamTypes(): LiveStreamType[];
    getStreamConfig(type: LiveStreamType): string[];
}
