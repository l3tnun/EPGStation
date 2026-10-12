import type * as apid from '../../../api.js';

/**
 * rule・予約に指定されたオプションが、現在の config.yml の設定と矛盾していないかを
 * 検証する契約（例: 設定されていないエンコードモードの指定、キーワード検索に必要な項目の
 * 不足等）。API 層で rule・予約の追加/更新を受け付ける際のバリデーションに使う。
 * 実装は `ReserveOptionChecker`。
 */
export default interface IReserveOptionChecker {
    /**
     * rule 全体（検索条件・予約オプション・エンコードオプション）が妥当かを検証する。
     * @param rule 検証対象の rule。既存の rule 全体、または新規追加用のオプションのいずれか
     * @returns 問題が無ければ `true`
     */
    checkRuleOption(rule: apid.Rule | apid.AddRuleOption): boolean;
    /**
     * 予約オプション（重複時の扱い等）が妥当かを検証する。
     * @param option 検証対象の予約オプション
     * @returns 問題が無ければ `true`
     */
    checkReserveOption(option: apid.RuleReserveOption): boolean;
    /**
     * エンコードオプションが妥当かを検証する。config.yml にエンコード設定自体が
     * 無い場合や、設定されていないエンコードモードが指定された場合は不正とする。
     * @param encodeOption 検証対象のエンコードオプション。未指定であれば検証不要として扱う
     * @returns 問題が無ければ `true`
     */
    checkEncodeOption(encodeOption: apid.ReserveEncodedOption | undefined): boolean;
}
