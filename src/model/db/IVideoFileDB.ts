import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';

export default interface IVideoFileDB {
    insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId>;
    updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void>;
    deleteOnce(VideoFileId: apid.VideoFileId): Promise<void>;
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null>;
}
