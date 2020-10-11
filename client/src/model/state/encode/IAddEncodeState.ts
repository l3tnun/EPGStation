import * as apid from '../../../../../api';

export default interface IAddEncodeState {
    videoFileId: apid.VideoFileId | null;
    encodeMode: string | null;
    parentDirectory: string | null;
    directory: string | null;
    init(recordedId: apid.RecordedId, videoFiles: apid.VideoFile[], encodeMode: string | null, parentDirectory: string | null): void;
    getVideoFiles(): {
        text: string;
        value: apid.VideoFileId;
    }[];
    getEncodeList(): string[];
    getParentDirectoryList(): string[];
    addEncode(): Promise<void>;
}
