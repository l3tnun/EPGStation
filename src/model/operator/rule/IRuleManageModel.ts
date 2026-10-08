import type * as apid from '../../../../api.js';

/**
 * 自動録画予約ルール（rule）の追加・更新・有効化/無効化・削除を担う契約。
 * 変更後は関連する予約の再計算（`IReservationManageModel.updateRule` 等）へつながる。
 * 実装は `RuleManageModel`。
 */
export default interface IRuleManageModel {
    /**
     * rule を新規追加する。オプションが現在の config.yml の設定と矛盾する場合は失敗する。
     * @param rule 追加する rule の内容
     * @returns 追加された rule の id
     */
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    /**
     * rule の内容を更新する。
     * @param rule 更新後の内容を持つ rule（id で対象行を特定する）
     */
    update(rule: apid.Rule): Promise<void>;
    /**
     * rule を有効化する。
     * @param ruleId 対象の rule id
     */
    enable(ruleId: apid.RuleId): Promise<void>;
    /**
     * rule を無効化する。
     * @param ruleId 対象の rule id
     */
    disable(ruleId: apid.RuleId): Promise<void>;
    /**
     * rule を 1 件削除する。
     * @param ruleId 削除対象の rule id
     */
    delete(ruleId: apid.RuleId): Promise<void>;
}
