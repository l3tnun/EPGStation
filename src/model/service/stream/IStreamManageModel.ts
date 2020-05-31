import * as apid from '../../../../api';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from './IStreamBaseModel';

export interface StreamInfoWithStreamId {
    streamId: apid.StreamId;
    info: LiveStreamInfo | RecordedStreamInfo;
}

export default interface IStreamManageModel {
    start(stream: IStreamBaseModel<any>): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
    getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo;
    getStreamInfos(): StreamInfoWithStreamId[];
}
