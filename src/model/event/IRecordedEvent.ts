import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';

export default interface IRecordedEvent {
    emitDeleteRecorded(recorded: Recorded): void;
    emitUpdateVideoFileSize(videoFileId: apid.VideoFileId): void;
    emitAddVideoFile(newVideoFileId: apid.VideoFileId): void;
    emitDeleteVideoFile(videoFileId: apid.VideoFileId): void;
    emitChangeProtect(recordedId: apid.RecordedId, isProtected: boolean): void;
    setDeleteRecorded(callback: (recorded: Recorded) => void): void;
    setUpdateVideoFileSize(callback: (videoFileId: apid.VideoFileId) => void): void;
    setAddVideoFile(callback: (newVideoFileId: apid.VideoFileId) => void): void;
    setDeleteVideoFile(callback: (videoFileId: apid.VideoFileId) => void): void;
    setChangeProtect(callback: (recordedId: apid.RecordedId, isProtected: boolean) => void): void;
}
