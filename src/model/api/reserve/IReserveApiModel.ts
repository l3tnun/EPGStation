import * as apid from '../../../../api';

export default interface IReserveApiModel {
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    get(reserveId: apid.ReserveId, isHalfWidth: boolean): Promise<apid.ReserveItem | null>;
    gets(option: apid.GetReserveOption): Promise<apid.Reserves>;
    getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists>;
    getCnts(): Promise<apid.ReserveCnts>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    updateAll(): Promise<void>;
}
