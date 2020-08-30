import * as apid from '../../../../../api';

export default interface IReservesApiModel {
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    gets(option: apid.GetReserveOption): Promise<apid.Reserves>;
    getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    updateAll(): Promise<void>;
}
