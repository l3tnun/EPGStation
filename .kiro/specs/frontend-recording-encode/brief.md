# 録画中・エンコード状況表示機能

## 問題

EPGStation の利用者は録画中の番組と encode job の状況を確認し、不要な録画 file の削除や encode の取消を行う。録画中 item の menu が録画済みと異なる action を出す、bulk 削除が対象を誤る、running / waiting の区別が付かない、cancel の結果が通知されない、といった不具合は録画中 file の誤削除や encode の放置を招く。

## 現状

- 録画中は `client/src/features/recording/RecordingPage.tsx`（table / card は `components/`、query は `hooks/`、API `recordingApi.ts` / `recordingRequests.ts`: `GET /recording`、`GET /channels`、`DELETE /recorded/:id`、`DELETE /videos/:id`、`PUT /recorded/:id/protect|unprotect`）、encode は `client/src/features/encode/EncodePage.tsx`（item / dialog は `components/`、query は `hooks/`、API `encodeApi.ts` / `encodeRequests.ts`: `GET /encode`、`DELETE /encode/:encodeId`）。
- 録画中 item の menu と bulk delete dialog は `frontend-recorded` が export する `RecordedItemMenu` / `RecordedBulkDeleteDialog` を使う。Encode 画面は `POST /encode` を発火しない。
- test は `client/unittest/spec/recording/` / `encode/`、`unittest/imp/recording.imp.test.ts` / `encode.imp.test.ts`、e2e `client/e2e/recording-encode-workflow.spec.ts`、visual `client/visual/recording-encode-geometry.spec.ts`。

## 期待する結果

- `/recording` で録画中 item が page size 設定に従って一覧され、item menu と edit mode の bulk 削除が録画中 item 用の action 表に従う。
- `/encode` で running / waiting の job が進捗付きで表示され、単一 / 一括 cancel が確認後に実行され snackbar で通知される。
- 空状態が明示され、dark theme で可読性を保つ。

## 方針

録画中と encode queue の一覧、pagination（`/recording` のみ）、edit mode、cancel / delete を本 spec の要求とし、item menu / dialog の実体は `frontend-recorded` の共有 component 契約に従う。

## スコープ

- **In**: `/recording`、`/encode`、list fetch、pagination（`/recording` のみ）、edit mode、single / bulk delete と cancel、空状態、responsive / dark theme。
- **Out**: 録画済みからの encode 追加（AddEncodeDialog）、player、settings の default。

## 境界候補

- Recording と `frontend-recorded` の境目: menu / dialog の共有 component は recorded spec、録画中固有の action 表（何を出さないか）は本 spec。
- Encode と `frontend-recorded` の境目: encode の追加は recorded detail、queue の表示と cancel は本 spec。

## 境界外

- `frontend-recorded`、`frontend-video-playback`、`frontend-app-shell`。
- server 側の recording / encode API 契約（`server-recording-execution`、`server-encoding`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`（page size、表示設定）、`frontend-app-shell`、`frontend-recorded`（共有 component）、server REST API と Socket.IO。
- **下流**: `frontend-dashboard`（recording summary が同じ menu 契約を使う）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-recorded`、`frontend-dashboard`。

## 制約

- Encode 画面から新規 encode を投入しない。
- hash route 互換。API base path は wrapper が付与する。
