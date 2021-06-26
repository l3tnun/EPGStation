import * as apid from '../../../../api';

export default interface IThumbnailManageModel {
    add(videoFileId: apid.VideoFileId): void;
    delete(thumbnailId: apid.ThumbnailId): Promise<void>;
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
}
