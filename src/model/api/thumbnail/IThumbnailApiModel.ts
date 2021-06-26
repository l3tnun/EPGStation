import * as apid from '../../../../api';

export default interface IThumbnailApiModel {
    getIdFilePath(thumbnailId: apid.ThumbnailId): Promise<string | null>;
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
    add(videoFileId: apid.VideoFileId): Promise<void>;
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
}
