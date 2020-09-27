import * as apid from '../../../../api';

export interface AddVideoFileOption {
    recordedId: apid.RecordedId;
    parentDirectoryName: string; // 親ディレクトリ名 (config.yaml)
    filePath: string; // 親ディレクトリから下のファイルパス
    type: apid.VideoFileType;
    name: string;
}

/**
 * アップロードされたビデオファイル情報
 */
export interface UploadedVideoFileOption {
    recordedId: apid.RecordedId; // 紐付ける recorded id
    parentDirectoryName: string; // 保存先ディレクトリ名
    subDirectory?: string; // 保存先サブディレクトリ
    viewName: string; // UI 上での表示名
    fileType: apid.VideoFileType; // ファイルタイプ
    fileName: string; // ファイル名
    filePath: string; // ファイルパス (アップロード先)
}

export default interface IRecordedManageModel {
    delete(recordedId: apid.RecordedId): Promise<void>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
    addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId>;
    addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    deleteVideoFile(videoFileid: apid.VideoFileId, isIgnoreProtection?: boolean): Promise<void>;
    changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void>;
    historyCleanup(): Promise<void>;
    videoFileCleanup(): Promise<void>;
    dropLogFileCleanup(): Promise<void>;
}
