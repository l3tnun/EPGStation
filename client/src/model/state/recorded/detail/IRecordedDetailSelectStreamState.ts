import * as apid from '../../../../../../api';

export type RecordedStreamType = 'WebM' | 'MP4' | 'HLS';

export interface StreamConfigItem {
    text: string;
    value: number;
}

export default interface IRecordedDetailSelectStreamState {
    isOpen: boolean;
    streamTypeItems: RecordedStreamType[];
    streamModeItems: StreamConfigItem[];
    selectedStreamType: RecordedStreamType | undefined;
    selectedStreamMode: number | undefined;
    title: string | null;
    open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): void;
    close(): void;
    updateModeItems(): void;
    getVideoFileId(): apid.VideoFileId | null;
    getRecordedId(): apid.RecordedId | null;
}
