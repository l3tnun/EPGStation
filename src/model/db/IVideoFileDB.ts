import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';

export interface UpdateFilePathOption {
    videoFileId: apid.VideoFileId;
    parentDirectoryName: string;
    filePath: string;
}

export default interface IVideoFileDB {
    restore(items: VideoFile[]): Promise<void>;
    insertOnce(videoFile: VideoFile): Promise<apid.VideoFileId>;
    updateFilePath(option: UpdateFilePathOption): Promise<void>;
    updateSize(videoFileId: apid.VideoFileId, size: number): Promise<void>;
    deleteOnce(VideoFileId: apid.VideoFileId): Promise<void>;
    deleteRecordedId(recordedId: apid.RecordedId): Promise<void>;
    findId(videoFileId: apid.VideoFileId): Promise<VideoFile | null>;
    findAll(): Promise<VideoFile[]>;
}
