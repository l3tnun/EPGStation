# 放映中番組表示・視聴機能

## 問題

EPGStation の利用者は放映中の番組を一覧で確認し、そのまま live 視聴を始める。放送波 tab と一覧の切替が保存されない、進行状況が更新されない、stream 種別の選択が再生 route へ正しく渡らない、といった不具合は視聴開始を妨げる。

## 現状

- 画面は `client/src/features/onair/OnAirPage.tsx`（card は `components/OnAirCard.tsx`、tab は `components/OnAirTabs.tsx`、取得と更新 timer は `hooks/useOnAirSchedules.ts`）、stream 選択 dialog は `LiveStreamSelectDialog.tsx`、live watch の情報 card は `WatchOnAirPage.tsx`、API は `onairApi.ts` / `onairRequests.ts`（`GET /schedules/broadcasting`、`GET /reserves/lists`、`GET /streams`）。純粋関数は `lib/` に分かれる。
- ProgramDialog は `frontend-guide` の共有 component を使う。stream 種別の選択は localStorage の隣接 key に保存し、再生本体は `frontend-video-playback` の `/onair/watch` へ handoff する。
- test は `client/unittest/spec/onair.*.spec.test.tsx`、`unittest/imp/onair.*.imp.test.ts`、e2e `client/e2e/broadcast-onair-workflow.spec.ts` / `broadcast-ios.spec.ts`、visual `client/visual/broadcast-geometry.spec.ts`。

## 期待する結果

- `/onair` で放映中番組が放送波 tab または一覧で表示され、Socket.IO の更新通知で最新化される。
- card に進行状況が表示され、dialog から予約 / 検索などの action ができる。
- stream 選択 dialog で config に基づく stream 種別と mode を選び、選択が保存されて `/onair/watch` へ渡る。
- live watch page の情報 card が番組と channel を表示し、player 契約は playback spec に従う。dark theme で可読性を保つ。

## 方針

放映中一覧、card、dialog、stream 選択、watch page の情報 card を本 spec の要求とし、stream API の lifecycle と player は `frontend-video-playback` に委ねる。

## スコープ

- **In**: `/onair` route、放映中 fetch、tab / list、OnAirCard、ProgramDialog の利用、LiveStreamSelectDialog、選択 storage、`/onair/watch` の情報 card、responsive / dark theme。
- **Out**: stream の開始 / keep / 停止、player の route 検証、settings key / default、navigation。

## 境界候補

- On Air と `frontend-video-playback` の境目: 選択結果を route param へ組み立てるまでが本 spec、`/onair/watch` の player と stream lifecycle は playback spec。
- On Air と `frontend-guide` の境目: ProgramDialog の共通挙動は Guide、放映中固有の action 表は本 spec。
- On Air と `frontend-settings-storage` の境目: live 表示 / 再生設定の意味は storage spec、stream 選択の隣接 key は本 spec が owner。

## 境界外

- `frontend-video-playback`、`frontend-guide`、`frontend-app-shell`。
- server 側の broadcasting / stream API 契約（`server-program-guide`、`server-media-delivery`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`、`frontend-guide`（ProgramDialog）、server REST API と Socket.IO。
- **下流**: `frontend-video-playback`（`/onair/watch`）、`frontend-guide`（live handoff で LiveStreamSelectDialog を利用）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-guide`、`frontend-video-playback`、`frontend-settings-storage`。

## 制約

- iOS など platform による stream 種別の制約は playback spec の判定に従い、本 spec で重複判定しない。
- hash route 互換。API base path は wrapper が付与する。
