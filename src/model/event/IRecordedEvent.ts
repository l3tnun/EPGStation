import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';

export default interface IRecordedEvent {
    emitDeleteRecorded(recorded: Recorded): void;
    emitUpdateVideoFileSize(videoFileId: apid.VideoFileId): void;
    emitCreateNewRecorded(recordedId: apid.RecordedId): void;
    emitAddVideoFile(newVideoFileId: apid.VideoFileId): void;
    emitAddUploadedVideoFile(newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean): void;
    emitDeleteVideoFile(videoFileId: apid.VideoFileId): void;
    emitChangeProtect(recordedId: apid.RecordedId, isProtected: boolean): void;
    setDeleteRecorded(callback: (recorded: Recorded) => void): void;
    setCreateNewRecorded(callback: (recordedId: apid.RecordedId) => void): void;
    setUpdateVideoFileSize(callback: (videoFileId: apid.VideoFileId) => void): void;
    setAddVideoFile(callback: (newVideoFileId: apid.VideoFileId) => void): void;
    setAddUploadedVideoFile(callback: (newVideoFileId: apid.VideoFileId, needsCreateThumbnail: boolean) => void): void;
    setDeleteVideoFile(callback: (videoFileId: apid.VideoFileId) => void): void;
    setChangeProtect(callback: (recordedId: apid.RecordedId, isProtected: boolean) => void): void;
}
