import * as apid from '../../../../../api';

export type LiveStreamType = 'M2TS' | 'WebM' | 'MP4' | 'HLS';

export default interface IOnAirSelectStreamState {
    isOpen: boolean;
    streamConfigItems: string[];
    selectedStreamType: LiveStreamType | undefined;
    selectedStreamConfig: string | undefined;
    open(channelItem: apid.ScheduleChannleItem): void;
    close(): void;
    getChannelItem(): apid.ScheduleChannleItem | null;
    getStreamTypes(): LiveStreamType[];
    updateStreamConfig(): void;
    getM2TSURL(): string | null;
}
