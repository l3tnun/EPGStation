import * as apid from '../../../../../api';

export default interface IVideoApiModel {
    delete(videoFileId: apid.VideoFileId): Promise<void>;
    getDuration(videoFileId: apid.VideoFileId): Promise<number>;
    sendToKodi(hostName: string, videoFileId: apid.VideoFileId): Promise<void>;
    uploadedVideoFile(option: apid.UploadVideoFileOption): Promise<void>;
}
