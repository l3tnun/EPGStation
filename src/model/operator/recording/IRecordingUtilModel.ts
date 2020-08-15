import * as apid from '../../../../api';
import Reserve from '../../../db/entities/Reserve';
import { RecordedDirInfo } from '../../IConfigFile';

export interface RecFilePathInfo {
    parendDir: RecordedDirInfo; // 親ディレクトリ情報
    subDir: string; // サブディレクトリ
    fileName: string; // ファイル名 (拡張子付き)
    fullPath: string;
}

export default interface IRecordingUtilModel {
    getRecPath(reserve: Reserve, isEnableTmp: boolean): Promise<RecFilePathInfo>;
    movingFromTmp(reserve: Reserve, videoFileId: apid.VideoFileId): Promise<string>;
    updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void>;
}
