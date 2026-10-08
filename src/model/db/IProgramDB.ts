import type * as apid from '../../../api.js';
import Program from '../../db/entities/Program.js';
import { ProgramId, TunerProgram, TunerServerId } from '../tuner/types.js';
import IChannelTypeIndex from './IChannelTypeHash.js';

/** `Program`に、`reserveOption.avoidDuplicate`指定時の重複判定結果`overlap`を追加した
 *  ルール検索結果1件。`overlap`は、同一チャンネル・同一番組名の録画が`periodToAvoidDuplicate`
 *  日以内の録画履歴（`recorded_history`）に存在すれば`true`になる（`avoidDuplicate`未指定時は
 *  常に`false`）。 */
export interface ProgramWithOverlap extends Program {
    overlap: boolean;
}

/** `update`が受け取る、放送局から取得し直した最新の番組情報と既存DBとの差分。
 *  `insert`は新規追加、`update`は内容変更、`delete`は放送されなくなった番組のID。 */
export interface ProgramUpdateValues {
    insert: TunerProgram[];
    update: TunerProgram[];
    delete: ProgramId[];
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
    isFree?: boolean;
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

/**
 * 番組情報の永続化を担う DB 層の契約。放送波から取得した番組表の反映（`insert`/`update`/
 * `deleteOld`）と、ルール検索・番組表表示・EPG更新用の各種検索を提供する。実装は `ProgramDB`。
 */
export default interface IProgramDB {
    insert(
        channelTypes: IChannelTypeIndex,
        programs: TunerProgram[],
        deleteChannelIds?: TunerServerId[],
    ): Promise<void>;
    update(channelTypes: IChannelTypeIndex, values: ProgramUpdateValues): Promise<void>;
    deleteOld(time: apid.UnixtimeMS): Promise<void>;
    findId(programId: apid.ProgramId): Promise<Program | null>;
    findEventRelayProgram(
        networkId: apid.NetworkId,
        serviceId: apid.ServiceId,
        eventId: apid.EventId,
    ): Promise<Program | null>;
    findRule(option: FindRuleOption): Promise<ProgramWithOverlap[]>;
    findChannelIdAndTime(channelId: apid.ChannelId, startAt: apid.UnixtimeMS): Promise<Program | null>;
    findAll(): Promise<Program[]>;
    findSchedule(option: FindScheduleOption | FindScheduleIdOption): Promise<Program[]>;
    findBroadcasting(option: apid.BroadcastingScheduleOption): Promise<Program[]>;
}
