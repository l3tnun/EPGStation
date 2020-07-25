import * as apid from '../../../../../api';

export default interface IStreamApiModel {
    getStreamInfo(isHalfWidth: boolean): Promise<apid.StreamInfo>;
    startLiveHLS(channelId: apid.ChannelId, mode: number): Promise<apid.StreamId>;
    startRecordedHLS(videoFileId: apid.VideoFileId, ss: number, mode: number): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
    keep(streamId: apid.StreamId): Promise<void>;
}
