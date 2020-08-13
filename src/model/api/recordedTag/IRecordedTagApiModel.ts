import * as apid from '../../../../api';

export default interface IRecordedTagApiModel {
    create(name: string): Promise<apid.RecordedTagId>;
    updateName(tagId: apid.RecordedTagId, name: string): Promise<void>;
    setRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    delete(tagId: apid.RecordedTagId): Promise<void>;
    deleteRelation(tagId: apid.RecordedTagId, recordedId: apid.RecordedId): Promise<void>;
    gets(option: apid.GetRecordedTagOption): Promise<apid.RecordedTags>;
}
