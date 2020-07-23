import * as apid from '../../../../api';
export interface VideoInfo {
    duration: number; // sec
    size: number; // byte
    bitRate: number; // bps
}

export default interface IVideoUtil {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<string | null>;
    getParentDirPath(name: string): string | null;
    getInfo(filePath: string): Promise<VideoInfo>;
}
