import type * as apid from '../../../api.js';
import Reserve from '../../db/entities/Reserve.js';
import { IReserveUpdateValues } from '../event/IReserveEvent.js';

/** 予約検索で除外可能な種別を含めるかどうかの共通条件。`false`にすると該当種別の予約を検索結果から除く。 */
export interface IFindReserveOption {
    hasSkip: boolean; // スキップされた予約を含むか
    hasConflict: boolean; // 競合した予約を含むか
    hasOverlap: boolean; // 重複した予約情報を含むか
}

/** 予約時刻の範囲（開始・終了）。ミリ秒単位のUnix時刻。 */
export interface IReserveTimeOption {
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
}

/**
 * 複数の時間帯にまたがる予約を検索するための条件。
 * `excludeRuleId`/`excludeReserveId`を指定すると、その予約自身（更新前の自分自身等）を結果から除外できる。
 */
export interface IFindTimeRangesOption extends IFindReserveOption {
    times: IReserveTimeOption[];
    excludeRuleId?: apid.RuleId;
    excludeReserveId?: apid.ReserveId;
}

/** 指定したルールIDに紐づく予約を検索する条件。 */
export interface IFindRuleOption extends IFindReserveOption {
    ruleId: apid.RuleId;
    hasEventRelay: boolean; // イベントリレーによる予約情報を含むか
}

/** 手動予約（ルールに属さない予約）のID一覧取得条件。 */
export interface IGetManualIdsOption {
    hasTimeReserve: boolean;
}

/** 時刻指定予約（番組表に依らず、放送局と時間帯だけで指定した予約）を検索する条件。 */
export interface IFindTimeSpecificationOption {
    channelId: apid.ChannelId;
    startAt: apid.UnixtimeMS;
    endAt: apid.UnixtimeMS;
}

/** ルールIDごとの該当予約件数。 */
export interface RuleIdCountResult {
    ruleId: apid.RuleId;
    ruleIdCnt: number;
}

/** 予約（`Reserve`）情報の永続化を担うDB層の契約。実装は`ReserveDB`。 */
export default interface IReserveDB {
    /** バックアップ（`items`）の内容で予約テーブルを丸ごと置き換える（全削除→全挿入）。 */
    restore(items: Reserve[]): Promise<void>;
    /** 予約を1件挿入する。 */
    insertOnce(reserve: Reserve): Promise<apid.ReserveId>;
    /** 予約を1件、`reserve.id`を主キーとして更新する。 */
    updateOnce(reserve: Reserve): Promise<void>;
    /** 削除・挿入・更新をまとめて1回の処理として反映する。 */
    updateMany(values: IReserveUpdateValues): Promise<void>;
    /** IDを指定して予約1件を取得する。存在しなければ`null`。 */
    findId(reserveId: apid.ReserveId): Promise<Reserve | null>;
    /**
     * 条件・ページングを指定して予約一覧を取得する。
     * @returns 該当予約一覧と、ページングを無視した場合の総件数の組。
     */
    findAll(option: apid.GetReserveOption): Promise<[Reserve[], number]>;
    /** 条件を指定して予約一覧を取得する（`findAll`と異なり総件数は返さない、ページングも行わない軽量版）。 */
    findLists(option?: apid.GetReserveListsOption): Promise<Reserve[]>;
    /** 指定した番組IDに紐づく予約を検索する（同一番組に対する予約は通常高々1件だが、複数件返り得る形になっている）。 */
    findProgramId(programId: apid.ProgramId): Promise<Reserve[]>;
    /** 指定した複数の時間帯のいずれかと重なる予約を検索する。 */
    findTimeRanges(option: IFindTimeRangesOption): Promise<Reserve[]>;
    /** 指定したルールIDに紐づく予約を、開始時刻の昇順で検索する。 */
    findRuleId(option: IFindRuleOption): Promise<Reserve[]>;
    /**
     * 終了時刻が`baseTime`より過去の予約を検索する（録画完了後の古い予約情報の掃除対象を洗い出す用途）。
     * @param baseTime 基準となるUnix時刻（ミリ秒）。
     */
    findOldTime(baseTime: apid.UnixtimeMS): Promise<Reserve[]>;
    /** ルールに属さない時刻指定予約を、放送局・開始・終了時刻の完全一致で検索する。存在しなければ`null`。 */
    findTimeSpecification(option: IFindTimeSpecificationOption): Promise<Reserve | null>;
    /** 手動予約（ルールに属さない予約）のID一覧を、ID昇順で取得する。 */
    getManualIds(option: IGetManualIdsOption): Promise<apid.ReserveId[]>;
    /** ルール予約のうち、イベントリレー（番組の別チャンネルへの引き継ぎ）によって作られた予約のID一覧を取得する。 */
    getRuleEventRelayIds(): Promise<apid.ReserveId[]>;
    /**
     * 指定したルールID群それぞれについて、該当する予約件数を集計する。
     * @param ruleIds 集計対象のルールID一覧。
     * @param type 集計対象とする予約の種別（通常予約のみ／競合含む等）。
     * @returns ルールIDと件数の組の一覧。
     */
    countRuleIds(ruleIds: apid.RuleId[], type: apid.GetReserveType): Promise<RuleIdCountResult[]>;
}
