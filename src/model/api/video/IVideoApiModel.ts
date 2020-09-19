import * as apid from '../../../../api';
import IPlayList from '../IPlayList';

export interface VideoFilePathInfo {
    path: string;
    mime: string;
}

export default interface IVideoApiModel {
    getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null>;
    getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null>;
    deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    sendToKodi(host: string, isSecure: boolean, kodiName: string, videoFileId: apid.VideoFileId): Promise<void>;
}
