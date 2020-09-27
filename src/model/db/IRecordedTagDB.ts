import * as apid from '../../../api';
import RecordedTag from '../../db/entities/RecordedTag';

export default interface IRecordedTagDB {
    restore(items: RecordedTag[]): Promise<void>;
    insertOnce(tag: RecordedTag): Promise<apid.RecordedTagId>;
    updateOnce(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    deleteAllRelation(recordedId: apid.RecordedId): Promise<void>;
    deleteOnce(tagId: apid.RecordedTagId): Promise<void>;
    findId(tagId: apid.RecordedTagId): Promise<RecordedTag | null>;
    findAll(option: apid.GetRecordedTagOption): Promise<[RecordedTag[], number]>;
}
