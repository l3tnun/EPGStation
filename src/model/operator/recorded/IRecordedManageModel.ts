import type * as apid from '../../../../api.js';

/** 録画処理・エンコード処理が生成したビデオファイルを、既存の録画済み情報へ紐付けて追加登録する
 *  ためのオプション。`addUploadedVideoFile`（アップロード由来）とは別経路。 */
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

/**
 * 録画済み情報（`Recorded`）とそれに紐づくビデオファイルの追加・削除・保護状態変更、および
 * 履歴・ビデオファイル・ドロップログの定期クリーンアップを担う操作層の契約。
 * 実装は `RecordedManageModel`。
 */
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
    removeRuleId(ruleId: apid.RuleId): Promise<void>;
}
