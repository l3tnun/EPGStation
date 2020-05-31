import * as apid from '../../../../api';
import { IStreamBase } from './IStreamBaseModel';

export default interface IStreamManageModel {
    start(stream: IStreamBase<any>): Promise<apid.StreamId>;
    stop(streamId: apid.StreamId): Promise<void>;
    stopAll(): Promise<void>;
    getStreamInfo(streamId: apid.StreamId): apid.LiveStreamInfo | apid.RecordedStreamInfo;
    getStreamInfos(): (apid.LiveStreamInfo | apid.RecordedStreamInfo)[];
}
