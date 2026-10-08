# 番組表表示機能

## 問題

EPGStation の利用者は番組表から予約を作る。放送波や日時の切替が URL query と一致しない、大きな grid で現在時刻や予約状態が見えない、番組 dialog からの予約が表へ即時反映されない、といった不具合は予約漏れや二重予約を招く。表示設定（表示対象、size、genre 表示）が保存されないと利用者は毎回設定し直す。

## 現状

- 画面は `client/src/features/guide/GuidePage.tsx`（route と dialog の配線）と `GuideSettingPage.tsx`、grid 描画は `GuideGridRenderer.ts` と `lib/guideGrid*.ts`、番組 dialog は `ProgramDialog.tsx`、API は `guideApi.ts` / `guideRequests.ts`（`GET /schedules`、`GET /schedules/:channelId`、`GET /reserves/lists`、`POST /reserves`、`DELETE /reserves/:id` と `/skip` / `/overlap`、`POST /reserves/update`）、Guide 固有の表示設定 storage は `guideStorage.ts`。表示 component は `components/`、状態と取得は `hooks/`、純粋関数は `lib/` に分かれる。
- `/guide/setting` は同じ feature 内で表示設定を編集する。live 視聴への handoff は `frontend-onair` の stream 選択 dialog と `frontend-video-playback` の route へ渡す。
- `ProgramDialog` は `frontend-onair` / `frontend-search-rule` からも利用される共有 component である。
- test は `client/unittest/spec/guide.*.spec.test.tsx`、`unittest/imp/guide.*.imp.test.ts`、e2e `client/e2e/broadcast-guide-workflow.spec.ts` / `broadcast-guide-dialog-workflow.spec.ts` / `guide-fixed-shell.spec.ts`、visual `client/visual/broadcast-geometry.spec.ts`。

## 期待する結果

- `/guide` の query（放送波、日時、channel）が検証され、通常 / 単一 channel の fetch と grid に決定的に対応する。
- grid に timeline、現在時刻線、予約 / 除外 / 重複の装飾が描かれ、scroll しても header が追従する。
- menu で日時、表示対象、size、genre 表示を変更でき、表示設定は保存される。
- ProgramDialog から予約、予約編集、検索、除外、除外解除、重複解除ができ、結果が表へ即時反映されて snackbar が出る。
- 放送中 channel から live 視聴へ移動できる。loading / error / empty が区別できる。

## 方針

route / query、fetch、grid、menu、dialog、handoff を本 spec の要求として固定し、settings key と player lifecycle は上流 spec に委ねる。

## スコープ

- **In**: `/guide`、`/guide/setting`、query 検証、schedule fetch、grid / timeline / header、menu、ProgramDialog の action、reserve 反映、live handoff、loading / error / empty、responsive / dark theme。
- **Out**: navigation item 生成、settings key / default、player の route 検証と lifecycle。

## 境界候補

- Guide と `frontend-settings-storage` の境目: 番組表関連 setting の意味は storage spec、Guide 固有の表示設定 storage（`guideStorage.ts`）は本 spec が owner として registry に登録する。
- Guide と `frontend-search-rule` / `frontend-onair` の境目: ProgramDialog の共通挙動は本 spec が持ち、rule action と stream 選択は各 spec が追加する。
- Guide と `frontend-video-playback` の境目: handoff 先 route と param の組立は本 spec、再生は playback spec。

## 境界外

- `frontend-app-shell`（navigation、snackbar host）。
- `frontend-video-playback`（player）。
- `frontend-reserves`（Manual Reserve form）。
- server 側の schedule / reserve API 契約（`server-program-guide`、`server-reservation-management`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`、server REST API と Socket.IO。
- **下流**: `frontend-onair`、`frontend-search-rule`（ProgramDialog の共有）、`frontend-video-playback`（handoff）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-onair`、`frontend-search-rule`、`frontend-reserves`、`frontend-video-playback`。

## 制約

- 番組表は pagination しない。大きな grid でも scroll 性能を保つ。
- hash route 互換。API base path は wrapper が付与する。
