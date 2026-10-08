# 予約一覧・手動予約機能

## 問題

EPGStation の利用者は予約の一覧を通常 / 競合 / 重複 / 除外の状態別に確認し、取消、除外解除、重複解除を行い、番組指定または時刻指定で予約を追加・編集する。状態の見分けが付かない、bulk 取消が対象を誤る、手動予約 form の validation が甘く server が拒否する、編集で既存値が読み込まれない、といった不具合は録画漏れに直結する。

## 現状

- 一覧は `client/src/features/reserves/ReservesPage.tsx`（title bar / list / dialog は `components/`、可視 list の query は `hooks/useVisibleReserves.ts`）、行は `ReserveListItem.tsx`、手動予約は `ManualReservePage.tsx`（form / loader / submit は `hooks/`、panel は `components/`）。API は `reservesApi.ts`（`GET /reserves`、`GET /reserves/:id`、`GET /schedules/detail/:programId`、`POST /reserves`、`PUT /reserves/:id`、`DELETE /reserves/:id` と `/skip` / `/overlap`、`POST /reserves/update`）と `lib/` の request / payload / route helper（`reservesRequests.ts` が barrel）。
- `ReserveMenu`、`ReserveDialog`、`ReserveDeleteDialog`、`ReserveListItem` は `index.ts` から export される。`frontend-dashboard` は `ReserveMenu`・`ReserveDialog`・`ReserveDeleteDialog` を、`frontend-search-rule` は `ReserveListItem` を利用する。
- 手動予約の放送局 / directory / encode mode は `lib/manualReserveServerOptions.ts` が `client/src/app/serverApi.ts` の wrapper（`fetchBootstrapChannels` / `fetchServerConfig`）経由で取得する。
- test は `client/unittest/spec/reserves/`、`unittest/imp/reserves/`、e2e `client/e2e/booking-workflow.spec.ts` / `manual-reserve-workflow.spec.ts`、visual `client/visual/booking-geometry.spec.ts`。

## 期待する結果

- `/reserves` の type query（normal / conflict / overlap / skip）と一覧が対応し、行の見た目で状態が区別でき、page size 設定に従って pagination する。
- 行 menu と edit mode から取消、除外解除、重複解除が確認 dialog 経由で実行され、snackbar で通知される。
- `/reserves/manual` で番組指定（programId）、時刻指定、既存予約編集（reserveId）の 3 mode が動き、時刻指定の validation 失敗は snackbar だけで通知する generic validation に従う。
- dark theme で一覧と form の可読性と操作性を保つ。

## 方針

一覧、状態別表示、取消系 action、手動予約 form を本 spec の要求とし、settings の意味と shell は上流に委ねる。共有 component の契約を本 spec が所有する。

## スコープ

- **In**: `/reserves`、`/reserves/manual`、type query、list rendering、状態別 variant、menu / dialog / snackbar、bulk edit、手動予約 form と validation、共有 component の export 契約、dark theme。
- **Out**: navigation item の生成、settings の default、番組表からの予約 dialog 本体（`frontend-guide`）。

## 境界候補

- Reserves と `frontend-guide` / `frontend-search-rule` の境目: ProgramDialog からの予約作成は各 spec、手動予約 form と一覧の action は本 spec。
- Reserves と `frontend-dashboard` の境目: summary 行の menu / dialog は本 spec の共有 component。

## 境界外

- `frontend-guide`、`frontend-search-rule`、`frontend-app-shell`。
- server 側の reserve / rule API 契約（`server-reservation-management`、`server-reservation-rules`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`（page size）、`frontend-app-shell`、server REST API と Socket.IO。
- **下流**: `frontend-dashboard`、`frontend-search-rule`（共有 component）、`frontend-guide`（予約編集で `/reserves/manual?reserveId=` へ遷移）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-guide`、`frontend-search-rule`、`frontend-dashboard`。

## 制約

- 時刻指定予約の validation は generic snackbar-only とし、field ごとの inline error を持たない。
- hash route 互換。API base path は wrapper が付与する。
