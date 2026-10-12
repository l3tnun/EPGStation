import type * as apid from '../../../api.js';

/**
 * 自動録画予約ルール（rule）の変化を、発生元（rule 管理）から他の module へ通知するための
 * event の契約。`emitXxx` は発生元が呼び出してイベントを発行し、`setXxx` は購読側が
 * コールバックを登録する。実装は `RuleEvent`。
 */
export default interface IRuleEvent {
    /**
     * rule が新規追加されたことを通知する。
     * @param ruleId 追加された rule の id
     */
    emitAdded(ruleId: apid.RuleId): void;
    /**
     * rule の内容が更新されたことを通知する。
     * @param ruleId 更新された rule の id
     */
    emitUpdated(ruleId: apid.RuleId): void;
    /**
     * rule が有効化されたことを通知する。
     * @param ruleId 対象の rule id
     */
    emitEnabled(ruleId: apid.RuleId): void;
    /**
     * rule が無効化されたことを通知する。
     * @param ruleId 対象の rule id
     */
    emitDisabled(ruleId: apid.RuleId): void;
    /**
     * rule が削除されたことを通知する。
     * @param ruleId 削除された rule の id
     */
    emitDeleted(ruleId: apid.RuleId): void;
    /**
     * `emitAdded` を購読する。
     * @param callback 追加された rule の id を受け取るコールバック
     */
    setAdded(callback: (ruleId: apid.RuleId) => void): void;
    /**
     * `emitUpdated` を購読する。
     * @param callback 更新された rule の id を受け取るコールバック
     */
    setUpdated(callback: (ruleId: apid.RuleId) => void): void;
    /**
     * `emitEnabled` を購読する。
     * @param callback 対象の rule id を受け取るコールバック
     */
    setEnabled(callback: (ruleId: apid.RuleId) => void): void;
    /**
     * `emitDisabled` を購読する。
     * @param callback 対象の rule id を受け取るコールバック
     */
    setDisabled(callback: (ruleId: apid.RuleId) => void): void;
    /**
     * `emitDeleted` を購読する。
     * @param callback 削除された rule の id を受け取るコールバック
     */
    setDeleted(callback: (ruleId: apid.RuleId) => void): void;
}
