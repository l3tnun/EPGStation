import * as apid from '../../../../api';

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
}
