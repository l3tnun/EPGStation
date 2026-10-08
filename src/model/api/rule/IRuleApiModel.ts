import type * as apid from '../../../../api.js';

/** 予約ルール（`Rule`）の作成・編集・有効/無効切り替え・削除を行うAPI層の契約。実装は`RuleApiModel`。 */
export default interface IRuleApiModel {
    /**
     * ルールを新規作成する。
     * @param rule 作成するルールの検索条件・録画設定。
     * @returns 作成されたルールのID。
     */
    add(rule: apid.AddRuleOption): Promise<apid.RuleId>;
    /**
     * ルール1件を取得する。
     * @param ruleId 対象ルールのID。
     * @returns 該当ルール。存在しなければ`null`。
     */
    get(ruleId: apid.RuleId): Promise<apid.Rule | null>;
    /**
     * 条件・ページングを指定してルール一覧を取得する。
     * @param option 検索条件・ページング指定。
     * @returns 該当ルール一覧（予約件数等の集計を含む）。
     */
    gets(option: apid.GetRuleOption): Promise<apid.Rules>;
    /**
     * ルール一覧を、キーワードのみのごく簡略な形（ID・キーワード等）で取得する（選択UIでの一覧表示等の軽量用途向け）。
     * @param option 検索条件。
     * @returns 該当ルールの簡略項目一覧。
     */
    searchKeyword(option: apid.GetRuleOption): Promise<apid.RuleKeywordItem[]>;
    /**
     * ルールの内容を丸ごと置き換える。
     * @param rule 更新後のルール全体（IDを含む）。
     */
    update(rule: apid.Rule): Promise<void>;
    /**
     * ルールを有効化する。
     * @param ruleId 対象ルールのID。
     */
    enable(ruleId: apid.RuleId): Promise<void>;
    /**
     * ルールを無効化する（既存の予約は残るが、以降の番組は予約されなくなる）。
     * @param ruleId 対象ルールのID。
     */
    disable(ruleId: apid.RuleId): Promise<void>;
    /**
     * ルールを削除する。
     * @param ruleId 対象ルールのID。
     */
    delete(ruleId: apid.RuleId): Promise<void>;
}
