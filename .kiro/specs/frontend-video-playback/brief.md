# ビデオ再生機能

## 問題

EPGStation の利用者は放映中の番組と録画済み番組を browser で視聴する。不正な route で古い player が残る、選んだ再生方式（HLS、WebM、MP4、M2TS-LL、直接再生）と player が一致しない、画面を離れても stream が server に残る、iOS など platform の制約を無視して失敗する、字幕や player 設定が route 間で保たれない、といった不具合は視聴不能と server 資源の浪費を招く。

## 現状

- player は `client/src/features/video/playback/PlaybackShell.tsx`（`PlaybackPlayerContainer`）が `hooks/`（lifecycle、media element、media source、seek、字幕、control 表示、fullscreen、event 配線）と `components/`（controls overlay、video 要素、情報 card）を合成する。route の chrome は `PlaybackRouteShell.tsx`、録画済みの watch / streaming page は `RecordedWatchPages.tsx`、route 検証は `playbackRoutes.ts`、media / lifecycle / controls / subtitle / settings / platform 判定はそれぞれ `playbackMedia.ts`、`playbackLifecycle.ts`（types / repository / controller の各 module を再 export）、`playbackControls.ts`、`playbackSubtitle.ts`、`playbackSettings.ts`、`platformDetection.ts`、録画済みの request は `recordedWatchRequests.ts`。
- API は `GET /streams/live/:channelId/{hls|m2tsll|webm|mp4}`（直リンクの `m2ts` も受理する）、`GET /streams/recorded/:videoFileId/{hls|webm|mp4}`、`PUT /streams/:id/keep`、`DELETE /streams/:id`、`GET /streams`、`GET /videos/:id`、`GET /videos/:id/duration`、`GET /recorded/:id`。M2TS 対応判定は `client/src/shared/media/mpegtsSupport.ts`。
- 開発時の proxy は `client/vite.config.ts` が担う。route は `/onair/watch`、`/recorded/watch`、`/recorded/streaming/:videoFileId`。
- test は `client/unittest/spec/videoPlayback.{route,mapping,lifecycle,controls,controlsVisibility,streaming}.spec.test.tsx`（受け入れ条件ごとに `[AC x.y]` を `it` 名に持つ component test。harness は `unittest/spec/support/videoPlaybackSpecSupport.tsx`）、`client/unittest/imp/videoPlayback.*.imp.test.ts`（routes / platformMedia / hlsLifecycle / hlsRecovery / hlsCleanupDirect / subtitles / subtitleBridgesControls）と `viteConfig.imp.test.ts`、e2e `client/e2e/video-playback-workflow.spec.ts` / `video-playback-android.spec.ts` / `video-playback-non-ios.spec.ts`、visual `client/visual/video-playback-geometry.spec.ts`。

## 期待する結果

- route param が検証され、不正なら stale player ではなく controlled な error / empty UI になる。
- 再生方式ごとに対応 player が決定的に選ばれ、HLS は開始 / keep / 停止の lifecycle を守り、画面離脱で stream を停止する。
- platform 制約（iOS Safari の録画済み direct playback は encode 済み MP4・raw TS ともに ready とし unsupported UI は出さない、M2TS 対応可否）に従って方式を絞る。
- 字幕と player 設定が route 間で一貫し、録画済み streaming で再生・seek・字幕が契約どおりに働く。

## 方針

route 検証、player mapping、stream lifecycle、platform 制約、字幕 / 設定を本 spec の要求とし、入口（一覧、dialog、選択 storage）は `frontend-onair` / `frontend-recorded`、設定値の意味は `frontend-settings-storage` に委ねる。

## スコープ

- **In**: `/onair/watch`、`/recorded/watch`、`/recorded/streaming/:videoFileId`、player param、HLS / WebM / MP4 / M2TS-LL / 直接再生、stream lifecycle、platform 制約、字幕、player 設定、error / empty、dev proxy の契約。
- **Out**: 放映中一覧と stream 選択 dialog、録画済み一覧・詳細、settings の key / default。

## 境界候補

- Playback と `frontend-onair` の境目: 情報 card と選択 dialog は onair、`/onair/watch` の player は本 spec。
- Playback と `frontend-recorded` の境目: 再生方式の選択と handoff は recorded、player と lifecycle は本 spec。
- Playback と `frontend-settings-storage` の境目: 再生設定の意味は storage spec、適用は本 spec。

## 境界外

- `frontend-onair`、`frontend-recorded`、`frontend-app-shell`。
- server 側の stream / video API 契約（`server-media-delivery`、`server-service-interface`）。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`、`frontend-onair` / `frontend-recorded`（入口）、server stream API。
- **下流**: なし（終端画面）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-onair`、`frontend-recorded`、`frontend-settings-storage`。

## 制約

- 画面離脱、route 変更、error 時に stream を必ず停止し、server に stream を残さない。
- browser の autoplay と codec 制約に従い、未対応の方式は選択肢から外す。
- hash route 互換。API base path は wrapper が付与する。
