import * as apid from '../../../../../api';
import { RecordedDisplayData } from './IRecordedUtil';

export type MultipleDeletionOption = 'All' | 'OnlyOriginalFile' | 'OnlyEncodedFile';

export interface SelectedInfo {
    cnt: number;
    size: number;
}

export default interface IRecordedState {
    clearData(): void;
    fetchData(option: apid.GetRecordedOption): Promise<void>;
    getRecorded(): RecordedDisplayData[];
    getTotal(): number;
    stopEncode(recordedId: apid.RecordedId): Promise<void>;
    getSelectedCnt(): SelectedInfo;
    select(recordedId: apid.RecordedId): void;
    selectAll(): void;
    clearSelect(): void;
    multiplueDeletion(option: MultipleDeletionOption): Promise<void>;
}
