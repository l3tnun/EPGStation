import * as apid from '../../../../../api';
import IStreamBaseModel, { LiveStreamInfo, RecordedStreamInfo } from '../base/IStreamBaseModel';

export interface StreamInfoWithStreamId {
    streamId: apid.StreamId;
    info: LiveStreamInfo | RecordedStreamInfo;
}

export default interface IStreamManageModel {
    start(stream: IStreamBaseModel<any>): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId, isForce?: boolean): Promise<void>;
    stopAll(): Promise<void>;
    keep(streamId: apid.StreamId): void;
    getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo;
    getStreamInfos(): StreamInfoWithStreamId[];
}
