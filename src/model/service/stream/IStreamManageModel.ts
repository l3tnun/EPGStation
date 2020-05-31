import * as apid from '../../../../api';
import { IStreamBase, LiveStreamInfo, RecordedStreamInfo } from './IStreamBaseModel';

export default interface IStreamManageModel {
    start(stream: IStreamBase<any>): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
    getStreamInfo(streamId: apid.StreamId): LiveStreamInfo | RecordedStreamInfo;
    getStreamInfos(): (LiveStreamInfo | RecordedStreamInfo)[];
}
