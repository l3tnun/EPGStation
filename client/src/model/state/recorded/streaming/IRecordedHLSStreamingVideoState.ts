import * as apid from '../../../../../../api';
import IRecordedStreamingVideoState from './IRecordedStreamingVideoState';

export default interface IRecordedHLSStreamingVideoState extends IRecordedStreamingVideoState {
    start(videoFileId: apid.VideoFileId, playPosition: number, mode: number): Promise<void>;
    stop(): Promise<void>;
    getStreamId(): apid.StreamId | null;
    isEnabled(): Promise<boolean>;
}
