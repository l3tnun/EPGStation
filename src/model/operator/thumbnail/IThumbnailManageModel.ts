import * as apid from '../../../../api';

export default interface IThumbnailManageModel {
    add(videoFileId: apid.VideoFileId): void;
    regenerate(): Promise<void>;
    fileCleanup(): Promise<void>;
}
