import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';

export default interface IReservationManageModel {
    setTuners(tuners: mapid.TunerDevice[]): void;
    getBroadcastStatus(): apid.BroadcastStatus;
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    update(reserveId: apid.ReserveId, isSuppressLog?: boolean): Promise<void>;
    updateRule(ruleId: apid.RuleId, isSuppressLog?: boolean): Promise<void>;
    updateAll(): Promise<void>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    cleanup(): Promise<void>;
}
