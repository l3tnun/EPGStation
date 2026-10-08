---
name: epgstation-server-testing
description: Use when designing, writing, reviewing, or completing EPGStation server tests, including unit or integration tests, coverage gates, test exclusions, and disagreements between specifications, source, tests, or runtime evidence.
---

# EPGStation Server Testing

## 原則

テスト件数や coverage score ではなく、契約、値域、状態、失敗、境界、資源解放を検証する。client には適用しない。

最初に `.kiro/steering/server-testing.md` を読む。test を書く・直す・review するときは、同 file の「testを書く規則」（lint が検出する規則の表と、人が見て守る規則 1〜13）を名指しで守る。未作成の場合、本 skill は調査と steering 作成にだけ使う。project gate やテスト完了を確定せず、正本未整備を報告する。

**REQUIRED SUB-SKILLS:**

- production/test を変更する: `test-driven-development`
- 予期しない失敗を調査する: `systematic-debugging`
- 完了を報告する: `verification-before-completion`

## 必須手順

1. 対象 Requirements、Design、Tasks、Acceptance Criteria と承認状態を確認する。
2. source と必要な runtime evidence を確認し、仕様を推測で補わない。
3. 次の test matrix を作る。非適用項目にも理由を残す。
4. test を書くときは `.kiro/steering/server-testing.md` の「testを書く規則」に従い、`npm run lint:check` が通ることを確かめる（`test/server/**` の書き方の規則を検出する）。
5. 挙動を変更する場合は失敗する target test を先に実行し、期待した理由で失敗することを確認する。既存挙動の characterization と read-only review では、現在の証跡を固定し、失敗を捏造しない。target test が既に通る、または別理由で失敗する場合は実装せず再分類する。
6. 変更時は最小実装で通し、対象 test、関連 test、全体 gate の順に検証する。
7. 変更を担当していない reviewer に matrix、diff、結果を渡す。

| Matrix列 | 必須内容 |
| --- | --- |
| 契約 | Requirement / AC / 現行互換contract |
| 種別 | `unittest/spec` / `unittest/imp` / integration |
| 入力 | null、空、0、1、最大、範囲外、不正型 |
| 状態 | 開始前、進行中、成功、失敗、cancel、再入 |
| 時間・順序 | timeout、late settlement、race、重複通知 |
| 資源 | DB transaction、stream、file、timer、listener、child process |
| 境界 | DB、HTTP、IPC、filesystem、process |
| 結果 | command、件数、結果、未解決risk |

## Coverage

- 単体 test（`unittest/spec`・`unittest/imp`）だけで、server の `src/**` の C0（statement）と C1（branch）を 100% にする。結合 test の通過は C0/C1 に数えない。steering未整備時の調査scopeは `src/**/*.ts` とし、`.d.ts` だけを対象外候補にする。
- coverage 100%だけで完了にしない。行通過ではなく戻り値、副作用、状態遷移、解放をassertする。
- 構造上検証不能な場合は、最小のline/branchだけを理由付きで除外し、代替integration/process検証を指定する。
- directory/file全体の除外や、数値達成目的のtest・到達不能codeを禁止する。

## 不一致の扱い

仕様、source、test、runtime evidenceの不一致を次のいずれかへ分類する。

- `spec defect`
- `implementation defect`
- `test defect`
- `approved change`
- `unknown`

testを通すためだけにproductionを変更しない。公開API、DB、config、互換性の判断はownerへ返す。それ以外は根拠と独立reviewで決める。挙動を変更する場合はrequirements、design、tasks、test、source、traceを同じ変更単位で同期する。

## 完了Gate

以下がすべて満たされるまで完了と報告しない。

- matrixの未分類が0件
- required testが全件成功
- C0/C1 100%、または最小除外が根拠・代替検証付き
- releaseのrisk acceptanceで品質taskを完了扱いにしない
- reviewerのCritical/Importantが0件
- handoffに変更file、実行command、件数、結果、除外、未解決riskがある

## Red Flags

| 判断 | 対応 |
| --- | --- |
| 「coverage 100%だから完了」 | matrixとassertionを再確認する |
| 「testが失敗するからsourceを合わせる」 | 不一致を分類して互換境界を確認する |
| 「広く除外すればgateが通る」 | 最小line/branchへ縮小する |
| 「期限があるから後で確認する」 | 未完了または明示的risk acceptanceとして報告する |
