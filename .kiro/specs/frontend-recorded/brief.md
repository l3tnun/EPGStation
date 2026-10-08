# 録画済み番組閲覧・操作機能

## 問題

EPGStation の利用者は録画済み番組を検索して視聴、保護、削除、encode、Kodi への送信を行う。list の検索条件が URL query と一致しない、削除 dialog で対象 file を誤る、保護中の item を削除できてしまう、detail から再生 route へ渡す param が違う、といった不具合は録画の消失や再生失敗を招く。運用者は cleanup（不要 file / thumbnail の掃除）をこの画面から実行する。

## 現状

- list は `client/src/features/recorded/RecordedPage.tsx`、detail は `RecordedDetailPage.tsx` が担い、dialog / menu は `components/`、整形と route parse は `lib/` にある。API は `recordedApi.ts`（`api/` の adapter と action method）と `recordedRequests.ts`（`requests/` の builder）で（`GET /recorded`、`GET /recorded/options`、`GET /recorded/:id`、`GET /rules/keyword`、`GET /rules/:ruleId`、`PUT /recorded/:id/protect|unprotect`、`DELETE /recorded/:id`、`DELETE /videos/:id`、`POST /recorded/cleanup`、`POST /thumbnails/cleanup`、`POST /encode`、`DELETE /recorded/:id/encode`、`POST /videos/:id/kodi`、`GET /dropLogs/:id`）。
- `RecordedItemMenu`、`RecordedDeleteDialog`、`RecordedBulkDeleteDialog` は `client/src/features/recorded/index.ts` から export され、`frontend-dashboard` と `frontend-recording-encode` が利用する。
- upload form（`/recorded/upload`）は `frontend-storages-upload` が所有し、本 feature は `client/src/features/recorded/RecordedPage.tsx` から遷移するだけである。再生 route（`/recorded/watch`、`/recorded/streaming/:videoFileId`）への param 組立は本 feature、再生は `frontend-video-playback`。
- Socket.IO の更新通知で list を再取得し、scroll 位置は `client/src/app/scrollHistory.ts` で復元する。
- test は `client/unittest/spec/recorded/`（`list-*`、`detail-*`）、`unittest/imp/recorded/`、e2e `client/e2e/recorded-list-workflow.spec.ts` / `recorded-scroll-workflow.spec.ts` / `recorded-detail-workflow.spec.ts` / `recorded-ios.spec.ts`、visual `client/visual/recorded-geometry.spec.ts`。

## 期待する結果

- `/recorded` の検索 menu（keyword、rule、channel、genre、状態）が query と双方向に対応し、page size 設定に従って pagination する。
- item menu から削除（video file 単位の選択を含む）、保護 / 解除、検索、encode、cleanup が実行でき、結果が snackbar で通知されて list に反映される。
- `/recorded/detail/:id` で詳細、再生 / download / 外部 URL scheme、encode 追加 / 取消、Kodi 送信、drop log 表示、削除ができる。
- 再生と upload への handoff が正しい route と param で行われる。dark theme で可読性を保つ。

## 方針

list / detail の workflow と共有 component 契約を本 spec の要求とし、player lifecycle は `frontend-video-playback`、upload form の要求は `frontend-storages-upload`、設定値の意味は `frontend-settings-storage` に委ねる。

## スコープ

- **In**: `/recorded`、`/recorded/detail/:id`、検索 menu と query、list / detail の menu / dialog、protect / delete / cleanup、encode / Kodi / drop log、watch / streaming / upload への handoff、共有 component の export 契約、responsive / dark theme。
- **Out**: player の route 検証と lifecycle、stream の keep / stop、upload form の validation と進捗、settings の default。

## 境界候補

- Recorded と `frontend-video-playback` の境目: 再生方式の選択と route param の組立は本 spec、player は playback spec。
- Recorded と `frontend-storages-upload` の境目: `/recorded/upload` への遷移は本 spec、form と upload 手順は storages-upload spec。
- Recorded と `frontend-dashboard` / `frontend-recording-encode` の境目: item menu と delete dialog の挙動は本 spec が持ち、他 spec は利用者。

## 境界外

- `frontend-video-playback`、`frontend-storages-upload`、`frontend-recording-encode`（encode queue 画面）。
- server 側の recorded / video / encode API 契約（`server-recorded-content`、`server-encoding`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`（page size、表示設定、URL scheme）、`frontend-app-shell`、server REST API と Socket.IO。
- **下流**: `frontend-dashboard`、`frontend-recording-encode`（共有 component）、`frontend-video-playback`、`frontend-storages-upload`（handoff）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-storages-upload`、`frontend-video-playback`、`frontend-recording-encode`、`frontend-search-rule`（rule 検索からの遷移）。

## 制約

- 保護された item は削除 action を拒否する。削除は video file 単位の選択を尊重する。
- hash route 互換。API base path は wrapper が付与する。
