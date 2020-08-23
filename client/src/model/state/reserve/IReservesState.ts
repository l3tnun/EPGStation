import * as apid from '../../../../../api';
import { ReserveStateData } from './IReserveStateUtil';

export default interface IReservesState {
    clearDate(): void;
    fetchData(option: apid.GetReserveOption): Promise<void>;
    getReserves(): ReserveStateData[];
    getTotal(): number;
    getSelectedCnt(): number;
    select(recordedId: apid.RecordedId): void;
    selectAll(): void;
    clearSelect(): void;
    multiplueDeletion(): Promise<void>;
}
