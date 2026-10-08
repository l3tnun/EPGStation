import type * as apid from '../../../../api.js';

/** `countByRuleIds`で集計対象とする予約の種別。`'all'`は種別を問わず全件、それ以外は該当種別のみを数える。 */
export type ReservationStateFilter = 'all' | 'normal' | 'conflict' | 'skip' | 'overlap';

/** ルールIDごとの該当予約件数。 */
export interface RuleReservationCount {
    readonly ruleId: apid.RuleId;
    readonly count: number;
}

/**
 * ルールに紐づく予約件数を集計する契約。`RuleApiModel`が予約件数付きのルール一覧を返す際に使う。
 * `ReserveDB`が本体の実装を持つが、`RuleApiModel`のコンストラクタは`IReserveDB`単体が渡された場合に備え、
 * `countByRuleIds`が無い実装を`IReserveDB.findRuleId`から件数を数える簡易実装へ適合させる（`adaptReserveDB`）。
 */
export default interface IRuleReservationCountPort {
    /**
     * 指定したルールID群それぞれについて、条件に合う予約件数を集計する。
     * @param ruleIds 集計対象のルールID一覧。
     * @param state 集計対象とする予約の種別。
     * @returns ルールIDと件数の組の一覧（`ruleIds`と同じ順序・件数とは限らない）。
     */
    countByRuleIds(
        ruleIds: readonly apid.RuleId[],
        state: ReservationStateFilter,
    ): Promise<readonly RuleReservationCount[]>;
}
