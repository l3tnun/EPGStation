import * as apid from '../../../../../api';

export type LiveStreamType = 'M2TS' | 'WebM' | 'MP4' | 'HLS';

export interface StreamConfigItem {
    text: string;
    value: number;
}

export default interface IOnAirSelectStreamState {
    isOpen: boolean;
    streamConfigItems: StreamConfigItem[];
    selectedStreamType: LiveStreamType | undefined;
    selectedStreamConfig: number | undefined;
    open(channelItem: apid.ScheduleChannleItem): void;
    close(): void;
    getChannelItem(): apid.ScheduleChannleItem | null;
    getStreamTypes(): LiveStreamType[];
    updateStreamConfig(): void;
    getM2TSURL(): string | null;
}
