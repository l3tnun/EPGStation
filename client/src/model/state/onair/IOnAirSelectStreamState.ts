import * as apid from '../../../../../api';

export type LiveStreamType = 'M2TS' | 'WebM' | 'MP4' | 'HLS';

export interface StreamConfigItem {
    text: string;
    value: number;
}

export default interface IOnAirSelectStreamState {
    isOpen: boolean;
    streamTypes: LiveStreamType[];
    streamConfigItems: StreamConfigItem[];
    selectedStreamType: LiveStreamType | undefined;
    selectedStreamConfig: number | undefined;
    open(channelItem: apid.ScheduleChannleItem): void;
    close(): void;
    getChannelItem(): apid.ScheduleChannleItem | null;
    updateStreamConfig(): void;
    getM2TSURL(): string | null;
    getM2TPlayListURL(): string | null;
}
