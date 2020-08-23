import * as apid from '../../../../../api';
import { RecordedDisplayData } from './IRecordedUtil';

export default interface IRecordedState {
    clearData(): void;
    fetchData(option: apid.GetRecordedOption): Promise<void>;
    getRecorded(): RecordedDisplayData[];
    getTotal(): number;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    getSelectedCnt(): number;
    select(recordedId: apid.RecordedId): void;
    selectAll(): void;
    clearSelect(): void;
}
