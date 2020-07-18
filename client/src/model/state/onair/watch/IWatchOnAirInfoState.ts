import * as apid from '../../../../../../api';

export interface DsiplayWatchInfo {
    channelName: string;
    time: string;
    name: string;
    description?: string;
}

export default interface IWatchOnAirInfoState {
    clear(): void;
    update(channelId: apid.ChannelId, mode: number): Promise<void>;
    getInfo(): DsiplayWatchInfo | null;
    getUpdateTime(): number;
}
