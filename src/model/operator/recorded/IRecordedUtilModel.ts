import VideoFile from '../../../db/entities/VideoFile';

export default interface IRecordedUtilModel {
    getVideoFilePath(videoFile: VideoFile): string;
}
