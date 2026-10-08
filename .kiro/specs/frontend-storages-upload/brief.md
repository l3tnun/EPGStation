# ストレージ表示・録画アップロード機能

## 問題

EPGStation の運用者は録画 storage の使用量を確認し、外部で作った録画 file を metadata 付きで登録する。使用量の表示が実際と違う、upload form の validation が不十分で途中失敗する、失敗時に metadata だけが残る、といった不具合は storage 枯渇と孤立した録画 record を生む。

## 現状

- storage 画面は `client/src/features/storages/StoragesPage.tsx`（API `storagesApi.ts` / `storagesRequests.ts`: `GET /storages`）。
- upload form は `client/src/features/storages/upload/RecordedUploadPage.tsx` で、form state は `hooks/useRecordedUploadForm.ts`、upload 手順と rollback は `hooks/useRecordedUploadRun.ts`、部品は `components/` にある（`GET /rules/keyword`、`POST /recorded`、`POST /videos/upload`、失敗時の `DELETE /recorded/:id`）で、route `/recorded/upload` は `client/src/app/routes/managementRoutes.tsx` が定義する。channel 表示設定は `frontend-settings-storage` を読む。
- test は `client/unittest/spec/storages.spec.test.tsx`、`unittest/imp/storages.imp.test.ts`、upload の `client/unittest/spec/storages/upload-*.spec.test.tsx`、`unittest/imp/storages/upload-*.imp.test.ts`、e2e `client/e2e/storages-upload-workflow.spec.ts`、visual `client/visual/storages-upload-geometry.spec.ts`。

## 期待する結果

- `/storages` で各 storage の使用量が割合と容量で表示され、error / empty が区別できる。
- `/recorded/upload` で metadata（channel、日時、rule、genre など）と video file を form 入力でき、validation を通った場合だけ upload が始まる。
- upload は metadata 登録の後に file を順に送り、進捗 dialog を出し、失敗時は登録した metadata を削除して結果を通知する。
- dark theme と select 部品の契約で操作性を保つ。

## 方針

storage usage view と upload form / 手順 / rollback を本 spec の要求とし、録画済み一覧・詳細は `frontend-recorded` に委ねる。

## スコープ

- **In**: `/storages`、`/recorded/upload`、usage rendering、upload form と validation、進捗 dialog、rollback、dark theme。
- **Out**: 録画済み一覧・詳細、settings の default、shell。

## 境界候補

- Upload と `frontend-recorded` の境目: `/recorded/upload` の要求は本 spec、一覧・詳細と upload への遷移は recorded spec。
- Upload と `frontend-settings-storage` の境目: channel 表示設定の意味は storage spec。

## 境界外

- `frontend-recorded`、`frontend-app-shell`、`frontend-settings-storage`。
- server 側の storage / upload API 契約（`server-storage-management`、`server-recorded-content`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`、server REST API と Socket.IO。
- **下流**: `frontend-recorded`（upload 完了後に一覧へ戻る）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-recorded`、`frontend-settings-storage`。

## 制約

- upload は metadata → file の順で行い、file 送信失敗時は登録済み metadata を削除する。
- 実 file path や実 URL を fixture に含めない。hash route 互換。
