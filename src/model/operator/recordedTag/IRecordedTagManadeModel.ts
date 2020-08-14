import * as apid from '../../../../api';

export default interface IRecordedTagManadeModel {
    create(name: string, color: string): Promise<apid.RecordedTagId>;
    update(tagId: apid.RecordedTagId, name: string, color: string): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    delete(tagId: apid.RecordedTagId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
}
