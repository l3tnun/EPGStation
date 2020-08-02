import * as apid from '../../../../../api';
import { RecordedDisplayData } from '../recorded/IRecordedUtil';

export default interface IRecordingState {
    clearData(): void;
    fetchData(option: apid.GetRecordedOption): Promise<void>;
    getRecorded(): RecordedDisplayData[];
    getTotal(): number;
}
