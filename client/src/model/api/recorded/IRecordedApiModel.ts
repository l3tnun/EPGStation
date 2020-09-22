import * as apid from '../../../../../api';

export default interface IRecordedApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
    get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem>;
    getSearchOptionList(): Promise<apid.RecordedSearchOptions>;
    delete(recordedId: apid.RecordedId): Promise<void>;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    protect(recordedId: apid.RecordedId): Promise<void>;
    unprotect(recordedId: apid.RecordedId): Promise<void>;
    createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId>;
    cleanup(): Promise<void>;
}
