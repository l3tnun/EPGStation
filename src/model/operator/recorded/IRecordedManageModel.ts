import * as apid from '../../../../api';

export interface AddVideoFileOption {
    recordedId: apid.RecordedId;
    parentDirectoryName: string; // 親ディレクトリ名 (config.yaml)
    filePath: string; // 親ディレクトリから下のファイルパス
    isTs: boolean;
    name: string;
}

export default interface IRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    deleteVideoFile(videoFileid: apid.VideoFileId): Promise<void>;
}
