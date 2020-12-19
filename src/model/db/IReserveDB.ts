import * as apid from '../../../api';
import Reserve from '../../db/entities/Reserve';
import { IReserveUpdateValues } from '../event/IReserveEvent';

export interface IFindReserveOption {
    hasSkip: boolean; // スキップされた予約を含むか
    hasConflict: boolean; // 競合した予約を含むか
    hasOverlap: boolean; // 重複した予約情報を含むか
}

export interface IReserveTimeOption {
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
}

export interface IFindTimeRangesOption extends IFindReserveOption {
    times: IReserveTimeOption[];
    excludeRuleId?: apid.RuleId;
    excludeReserveId?: apid.ReserveId;
}

export interface IFindRuleOption extends IFindReserveOption {
    ruleId: apid.RuleId;
}

export interface IGetManualIdsOption {
    hasTimeReserve: boolean;
}

export interface IFindTimeSpecificationOption {
    channelId: apid.ChannelId;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
}

export interface RuleIdCountResult {
    ruleId: apid.RuleId;
    ruleIdCnt: number;
}

export default interface IReserveDB {
    restore(items: Reserve[]): Promise<void>;
    insertOnce(reserve: Reserve): Promise<apid.ReserveId>;
    updateOnce(reserve: Reserve): Promise<void>;
    updateMany(values: IReserveUpdateValues): Promise<void>;
    findId(reserveId: apid.ReserveId): Promise<Reserve | null>;
    findAll(option: apid.GetReserveOption): Promise<[Reserve[], number]>;
    findLists(option?: apid.GetReserveListsOption): Promise<Reserve[]>;
    findProgramId(programId: apid.ProgramId): Promise<Reserve[]>;
    findTimeRanges(option: IFindTimeRangesOption): Promise<Reserve[]>;
    findRuleId(option: IFindRuleOption): Promise<Reserve[]>;
    findOldTime(baseTime: apid.UnixtimeMS): Promise<Reserve[]>;
    findTimeSpecification(option: IFindTimeSpecificationOption): Promise<Reserve | null>;
    getManualIds(option: IGetManualIdsOption): Promise<apid.ReserveId[]>;
    countRuleIds(ruleIds: apid.RuleId[], type: apid.GetReserveType): Promise<RuleIdCountResult[]>;
}
