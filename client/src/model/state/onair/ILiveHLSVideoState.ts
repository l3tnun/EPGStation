import * as apid from '../../../../../api';

export default interface ILiveHLSVideoState {
    start(channelId: apid.ChannelId, mode: number): Promise<void>;
    stop(): Promise<void>;
    getStreamId(): apid.StreamId | null;
    isEnabled(): Promise<boolean>;
}
