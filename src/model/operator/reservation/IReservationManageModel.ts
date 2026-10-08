import type * as apid from '../../../../api.js';
import Reserve from '../../../db/entities/Reserve.js';
import { TunerInfo } from '../../tuner/types.js';

/**
 * 予約（Reserve）の追加・更新・削除・rule に基づく再計算を担う契約。DB への
 * 反映後は `IReserveEvent` を通じて変更を通知する。実装は `ReservationManageModel`。
 */
export default interface IReservationManageModel {
    /**
     * 利用可能な tuner の一覧を反映し、放送種別ごとの利用可否（`getBroadcastStatus` の
     * 内容）を更新する。
     * @param tuners 現在利用可能な tuner の情報一覧
     */
    setTuners(tuners: TunerInfo[]): void;
    /**
     * 放送種別（地上波・BS 等）ごとに、対応する tuner が存在するかを返す。
     * @returns 放送種別ごとの利用可否
     */
    getBroadcastStatus(): apid.BroadcastStatus;
    /**
     * 手動予約を追加する。
     * @param option 追加する予約の内容（番組指定または時刻指定）
     * @returns 追加された予約の id
     */
    add(option: apid.ManualReserveOption): Promise<apid.ReserveId>;
    /**
     * リレー予約（同一番組が複数チャンネルで放送される場合の追従予約）を追加する。
     * 既に同じ番組が予約済みであれば追加しない。
     * @param programId 追加対象の番組 id
     * @param parentReserve 元になった予約
     * @returns 追加された予約の id。既に予約済みで追加不要な場合は `null`
     */
    addEventRelay(programId: apid.ProgramId, parentReserve: Reserve): Promise<apid.ReserveId | null>;
    /**
     * 指定した予約を、現在の番組情報・rule 設定に基づいて再計算する。
     * @param reserveId 対象の予約 id
     * @param isSuppressLog `true` の場合、更新時のログ出力を抑える
     */
    update(reserveId: apid.ReserveId, isSuppressLog?: boolean): Promise<void>;
    /**
     * 指定した rule に基づく予約群をまとめて再計算する。
     * @param ruleId 対象の rule id
     * @param isSuppressLog `true` の場合、更新時のログ出力を抑える
     * @param isFirstUpdate rule 追加直後の初回計算である場合 `true`
     */
    updateRule(ruleId: apid.RuleId, isSuppressLog?: boolean, isFirstUpdate?: boolean): Promise<void>;
    /**
     * 全ての手動予約・rule 予約を再計算する。config.yml の設定次第でログ出力は抑制される。
     * @param isFirstUpdate 起動直後の初回計算である場合 `true`
     */
    updateAll(isFirstUpdate?: boolean): Promise<void>;
    /**
     * 予約をキャンセルする。
     * @param reserveId 対象の予約 id
     */
    cancel(reserveId: apid.ReserveId): Promise<void>;
    /**
     * rule 予約で除外（skip）扱いになっている予約の skip を解除し、再度予約候補として
     * 計算し直す。ルール予約以外、または skip されていない予約に対しては何もしない。
     * @param reserveId 対象の予約 id
     */
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    /**
     * 重複（overlap）扱いになっている予約の overlap を解除し、再度予約候補として
     * 計算し直す。
     * @param reserveId 対象の予約 id
     */
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    /**
     * 手動予約の内容を編集する。
     * @param reserveId 対象の予約 id
     * @param option 変更後の予約内容
     */
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    /** 終了時刻を過ぎた古い予約をまとめて削除する。 */
    cleanup(): Promise<void>;
}
