import * as apid from '../../../api';
import * as mapid from '../../../node_modules/mirakurun/api';
import Program from '../../db/entities/Program';
import IChannelTypeIndex from './IChannelTypeHash';

export interface ProgramWithOverlap extends Program {
    overlap: boolean;
}

export interface ProgramUpdateValues {
    insert: mapid.Program[];
    update: mapid.Program[];
    delete: mapid.ProgramId[];
}

/**
 * ルール検索オプション
 */
export interface FindRuleOption {
    searchOption: apid.RuleSearchOption;
    reserveOption?: apid.RuleReserveOption;
    limit?: number;
}

/**
 * 番組情報取得ベースオプション
 */
export interface FindScheduleBaseOption {
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
    isHalfWidth: boolean;
}

/**
 * 放送波指定の番組表情報取得オプション
 */
export interface FindScheduleIdOption extends FindScheduleBaseOption {
    channelId: apid.ChannelId;
}

/**
 * 放送局指定の番組情報取得オプション
 */
export interface FindScheduleOption extends FindScheduleBaseOption {
    types: apid.ChannelType[];
}

export default interface IProgramDB {
    insert(channelTypes: IChannelTypeIndex, programs: mapid.Program[]): Promise<void>;
    update(channelTypes: IChannelTypeIndex, values: ProgramUpdateValues): Promise<void>;
    deleteOld(time: apid.UnixtimeMS): Promise<void>;
    findId(programId: apid.ProgramId): Promise<Program | null>;
    findRule(option: FindRuleOption): Promise<ProgramWithOverlap[]>;
    findChannelIdAndTime(channelId: apid.ChannelId, startAt: apid.UnixtimeMS): Promise<Program | null>;
    findAll(): Promise<Program[]>;
    findSchedule(option: FindScheduleOption | FindScheduleIdOption): Promise<Program[]>;
    findBroadcasting(option: apid.BroadcastingScheduleOption): Promise<Program[]>;
}
