# 番組検索・自動予約ルール編集機能

## 問題

EPGStation の利用者は条件検索で番組を探し、検索結果からその場で予約または録画 rule を作る。rule は自動予約の源であり、検索 form と API の mapping が違う、rule option の既定値が意図と異なる、rule の有効 / 無効や削除の結果が一覧に反映されない、といった不具合は大量の予約漏れや不要録画を生む。

## 現状

- 検索と rule の追加・編集の入口は `client/src/features/search/rule/SearchRulePage.tsx`、rule 一覧は `RuleListPage.tsx`。状態と effect は `hooks/`、表示 component は `components/`、純粋関数（route / query の解析、request と payload の組み立て、genre 選択、入力 parse）は `lib/`、genre 表示は `genreLabels.ts`。`query.ts` と `api.ts` は `lib/` と `api/` の barrel で、API は `api/`（`POST /schedules/search`、`GET /rules`、`GET /rules/:id`、`POST /rules`、`PUT /rules/:id`、`PUT /rules/:id/enable|disable`、`DELETE /rules/:id`、`GET /reserves` と `/reserves/lists`、`POST /reserves`、`DELETE /reserves/:id` と `/skip` / `/overlap`）。
- 検索結果の行は本 spec の `components/SearchResultSection.tsx`、time-specified rule edit の予約 card は `frontend-reserves` の `ReserveListItem`、番組 dialog は `frontend-guide` の `ProgramDialog` を利用し、rule 用の action を追加している。検索 keyword 用の text field clear action は `client/src/shared/ClearableTextField.tsx`。
- test は `client/unittest/spec/searchRule.*.spec.test.tsx`（共有 helper は `searchRuleSupport.tsx`）、`unittest/imp/searchRule.*.imp.test.ts`、e2e `client/e2e/search-rule-*.spec.ts`（helper は `e2e/support/searchRuleHelpers.ts`、mock は `searchRuleMocks.ts`）、visual `client/visual/search-rule-geometry.spec.ts`。

## 期待する結果

- `/search` が URL query または form から検索を実行し、結果に予約状態の装飾が付く。`/search?rule=<id>` で既存 rule の編集 form が読み込まれる。
- 検索 form から rule を作成・更新でき、rule option（録画先、encode、既定値）の副作用が設計どおりに働く。
- `/rule` で rule を keyword 検索し、編集、有効 / 無効、削除、一括操作ができ、結果が snackbar と一覧に反映される。
- dark theme で form と一覧の可読性を保つ。

## 方針

検索 route / query / form / result と rule の一覧・操作を本 spec の要求とし、ProgramDialog は `frontend-guide`、time-specified rule edit の予約 card は `frontend-reserves` の共有契約に従う。

## スコープ

- **In**: `/search`、`/search?rule=...`、`/rule`、検索 form と API mapping、result decoration、rule option と既定値、rule 一覧の action、snackbar 文言、dark theme。
- **Out**: navigation、settings の default、手動予約 form（`frontend-reserves`）。

## 境界候補

- Search と `frontend-guide` の境目: ProgramDialog の共通挙動は Guide、rule action の追加は本 spec。
- Search と `frontend-reserves` の境目: 検索結果の行の見た目・装飾・action は本 spec、time-specified rule edit の予約 card の見た目は reserves の `ReserveListItem`。
- Search と `frontend-recorded` の境目: rule から録画済み一覧へ（`/recorded?ruleId=`）の遷移は本 spec、一覧は recorded spec。

## 境界外

- `frontend-guide`、`frontend-reserves`、`frontend-recorded`、`frontend-app-shell`。
- server 側の search / rule API 契約（`server-program-guide`、`server-reservation-rules`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`（検索結果件数など）、`frontend-app-shell`、`frontend-guide` と `frontend-reserves`（共有 component）、server REST API。
- **下流**: `frontend-recorded`（rule 単位の一覧遷移）、`frontend-guide`（ProgramDialog の検索 action が `/search` へ遷移）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-guide`、`frontend-reserves`、`frontend-recorded`。

## 制約

- rule の作成 / 更新は form の値を API の rule schema へ決定的に mapping し、未指定 option は設計の既定値を送る。
- hash route 互換。API base path は wrapper が付与する。
