import * as apid from '../../../../../../api';

export default interface IRecordedStreamingVideoState {
    clear(): void;
    fetchInfo(recordedId: apid.RecordedId, videoFileId: apid.VideoFileId): Promise<void>;
    isRecording(): boolean;
    getDuration(): number;
}
