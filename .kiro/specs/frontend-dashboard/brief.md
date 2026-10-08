# ダッシュボード表示機能

## 問題

EPGStation の利用者は、トップ画面で録画中、録画済み、予約の状況を一目で把握し、そこから詳細画面や個別 action（削除、保護、予約取消）へ移動する。summary が古い、more link の遷移先が違う、item menu の action が list 画面と異なる結果になる、といった不具合は利用者の最初の操作を誤らせる。

## 現状

- 画面は `client/src/features/dashboard/DashboardPage.tsx`（section は `components/`、summary query と scroll 保存は `hooks/`）、API は `dashboardApi.ts` / `dashboardRequests.ts`（`GET /recording`、`GET /recorded`、`GET /reserves`、`GET /reserves/cnts`、item action として `POST /encode`、`PUT /recorded/:id/protect|unprotect`、`DELETE /recorded/:id`、`DELETE /recorded/:id/encode`、`DELETE /videos/:id`、`DELETE /reserves/:id` と `/skip` / `/overlap`）、応答 adapter は `lib/`。
- item menu と delete dialog は `frontend-recorded` / `frontend-reserves` の共有 component を使う。Socket.IO の更新通知で query を再取得する。
- test は `client/unittest/spec/dashboard/`、`unittest/imp/dashboard.imp.test.ts` と `dashboard.{adapters,apiEdges,format}.imp.test.ts`、e2e `client/e2e/dashboard-workflow.spec.ts` / `dashboard-android.spec.ts`、visual `client/visual/dashboard-geometry.spec.ts`。

## 期待する結果

- `/` で recording / recorded / reserves の summary が page size 設定に従って表示され、更新通知で最新化される。
- more link が対応する list 画面へ移動し、item menu / dialog の action が list 画面と同じ結果と snackbar を出す。
- desktop / mobile、light / dark で同じ意味の layout になり、空状態と error が区別できる。

## 方針

summary 表示と各 workflow への入口を要求として固定し、item action の実体は対応 list spec の共有 component 契約に従う。

## スコープ

- **In**: `/` route と title、summary layout、3 種の fetch、more link、item menu / dialog、responsive / theme、空 / error 表示。
- **Out**: 各 list / detail 画面の全機能、player、settings contract。

## 境界候補

- Dashboard と `frontend-recorded` / `frontend-recording-encode` / `frontend-reserves` の境目: item 行の menu と dialog は各 list spec の共有 component、summary の並びと more link は本 spec。
- Dashboard と `frontend-settings-storage` の境目: page size と表示設定の意味は storage spec。

## 境界外

- `frontend-recorded`、`frontend-recording-encode`、`frontend-reserves`（list 本体）。
- `frontend-video-playback`（再生）。
- `frontend-app-shell`（shell、snackbar host）。
- server 側の list API 契約（`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`、`frontend-recorded` / `frontend-reserves` の共有 component、server REST API と Socket.IO。
- **下流**: なし（入口画面）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-recorded`、`frontend-recording-encode`、`frontend-reserves`、`frontend-app-shell`。

## 制約

- hash route 互換。API base path は wrapper が付与する。
- 実番組名や実 URL を fixture に含めない。
