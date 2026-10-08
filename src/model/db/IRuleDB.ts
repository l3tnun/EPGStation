import type * as apid from '../../../api.js';

/**
 * rule（自動録画予約ルール）情報に、そのルールから生成された予約の件数を
 * 付加した形。一覧画面などで「このルールで何件予約されているか」を表示する際に使う。
 */
export interface RuleWithCnt extends apid.Rule {
    updateCnt: number;
}

/**
 * 自動録画予約ルール（rule）情報の永続化を担う DB 層の契約。実装は `RuleDB`。
 */
export default interface IRuleDB {
    /**
     * バックアップされた rule 一覧で DB を全件洗い替えする。
     * @param items 復元する rule の一覧（予約件数付き）
     */
    restore(items: RuleWithCnt[]): Promise<void>;
    /**
     * rule を 1 件挿入する。
     * @param rule 挿入する rule。既存の rule 全体、または新規追加用のオプションのいずれか
     * @returns 挿入された行の id
     */
    insertOnce(rule: apid.Rule | apid.AddRuleOption): Promise<apid.RuleId>;
    /**
     * rule を 1 件更新する。
     * @param rule 更新後の内容を持つ rule（id で対象行を特定する）
     */
    updateOnce(rule: apid.Rule): Promise<void>;
    /**
     * rule を有効化する。
     * @param ruleId 対象の rule id
     */
    enableOnce(ruleId: apid.RuleId): Promise<void>;
    /**
     * rule を無効化する。無効化しても rule 自体は削除されず、以後この rule からの
     * 新規予約が発生しなくなる。
     * @param ruleId 対象の rule id
     */
    disableOnce(ruleId: apid.RuleId): Promise<void>;
    /**
     * rule を 1 件削除する。
     * @param ruleId 削除対象の rule id
     */
    deleteOnce(ruleId: apid.RuleId): Promise<void>;
    /**
     * id を指定して rule を取得する。
     * @param ruleId 検索対象の rule id
     * @param isNeedCnt `true` の場合、紐づく予約件数を含めた形で返す
     * @returns 該当する rule。存在しない場合は `null`
     */
    findId(ruleId: apid.RuleId, isNeedCnt?: boolean): Promise<apid.Rule | RuleWithCnt | null>;
    /**
     * 条件を指定して rule を検索する。
     * @param option 絞り込み・ページングの条件
     * @param isNeedCnt `true` の場合、各 rule に紐づく予約件数を含めた形で返す
     * @returns 該当する rule の一覧と、絞り込み条件に一致する総件数の組
     */
    findAll(option: apid.GetRuleOption, isNeedCnt?: boolean): Promise<[apid.Rule[] | RuleWithCnt[], number]>;
    /**
     * 条件に一致する rule から、キーワード検索設定だけを抜き出した一覧を取得する。
     * @param option 絞り込みの条件
     * @returns 該当する rule のキーワード情報の一覧
     */
    findKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]>;
    /**
     * 登録済みの rule の id を全件取得する。
     * @returns rule id の一覧
     */
    getIds(): Promise<apid.RuleId[]>;
}
