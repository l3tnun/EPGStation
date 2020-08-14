import * as apid from '../../../api';
import RecordedTag from '../../db/entities/RecordedTag';

export default interface IRecordedTagEvent {
    emitCreated(tag: RecordedTag): void;
    emitUpdated(tagId: apid.RecordedTagId): void;
    emitRelated(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void;
    emitDeleted(tagId: apid.RecordedTagId): void;
    emitDeletedRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): void;
    setCreated(callback: (tag: RecordedTag) => void): void;
    setUpdated(callback: (tagId: apid.RecordedTagId) => void): void;
    setRelated(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void;
    setDeleted(callback: (tagId: apid.RecordedTagId) => void): void;
    setDeletedRelation(callback: (tagId: apid.RecordedTagId, recordedId: apid.RecordedId) => void): void;
}
