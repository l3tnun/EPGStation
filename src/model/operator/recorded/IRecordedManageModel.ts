import * as apid from '../../../../api';

export interface AddVideoFileOption {
    recordedId: apid.RecordedId;
    parentDirectoryName: string; // 親ディレクトリ名 (config.yaml)
    filePath: string; // 親ディレクトリから下のファイルパス
    type: apid.VideoFileType;
    name: string;
}

export default interface IRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    deleteVideoFile(videoFileid: apid.VideoFileId): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    historyCleanup(): Promise<void>;
    videoFileCleanup(): Promise<void>;
    dropLogFileCleanup(): Promise<void>;
}
