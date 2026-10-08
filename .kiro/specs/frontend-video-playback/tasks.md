# Implementation Plan

- [x] 1. playback route validation と controlled player state を実装する
  - `/onair/watch`、`/recorded/watch`、`/recorded/streaming/:videoFileId` の path/query を React Router hash route から validated model に変換する。
  - invalid required query、invalid id/mode/streamingType、valid player with invalid optional recordedId を区別し、invalid API path や stale media element を作らない。
  - controlled empty/error state は stable player container 内に表示し、実 URL、stack trace、環境固有 path を表示しない。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1-1.13_

- [x] 2. direct / streaming player mapping と recorded info card を実装する
  - recorded direct、recorded HLS/WebM/MP4 streaming、live watch の player mapping を API/media URL builder と VideoContainer に接続する。
  - recorded info card fetch failure は playback 非 fatal として `番組情報取得に失敗 ` snackbar を表示し、live info card は On Air owner に残す。
  - HLS readiness polling は `GET /streams?isHalfWidth=<isHalfWidthDisplayed>` を使い、recorded direct watch route は通常 entrypoint boundary に従う。
  - React dev server で実 HLS を確認するため、`/streamfiles` proxy の設定を regression guard（`viteConfig.imp.test.ts`）に含める。`#EXTM3U` manifest の到達は実 backend での手動確認とする。
  - _Requirements: 2.1-2.11_

- [x] 3. HLS lifecycle、direct stream、platform constraints を実装する
  - HLS start/keep/stop、readiness check、timeout/abort、seek commit 後の restart、generation token cleanup を実装する。recorded HLS の seek bar drag/input 中は表示値 preview に留め、commit 前に `ss` 更新や stream 再作成を行わない。
  - WebM/MP4 direct stream は frontend start/keep/stop API を呼ばず、recorded out-of-range seek は `ss` 付き URL rebuild で復元する。
  - iOS Safari recorded direct playback は MP4・raw TS ともに ready（unsupported UI は出さない）、M2TS-LL mpegts.js support check と snackbar/error 文言を requirements に従って扱う。
  - _Requirements: 3.1-3.14_

- [x] 4. subtitle、player setting、shared controls を実装する
  - `VideoPlayerSetting` と `isForceEnableSubtitleStroke` を読み、HLS/M2TS-LL subtitle 表示と保存・復元を扱う。
  - 16:9 player surface、loading indicator、bottom controls、center controls、seek/speed/volume/PiP/fullscreen/subtitle visibility を browser/platform/viewport 条件に従って表示する。
  - controls auto-hide、keyboard shortcuts、fullscreen fallback、`video.play()` failure log-only、decode/network overlay not added が observable に確認できる。
  - _Requirements: 4.1-4.19_

- [x] 5. Video Playback の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で route validation、media URL builder、HLS lifecycle、late resolve/generation token、seek restart、subtitle setting、control visibility を検証する。
  - Playwright + MSW で controlled error、player surface、loading, controls, subtitle, mobile/narrow viewport、Desktop Chromium/Firefox/Android Chrome/iOS Safari constraints を確認する。
  - fixture に実 media URL、実 file path、実番組名、実サムネイル、認証情報、token、cookie を含めない。
  - _Requirements: 1.1-1.13, 2.1-2.11, 3.1-3.14, 4.1-4.19, 5.1-5.6_
- [x] 6. live/recorded HLS lifecycle、recorded WebM/MP4 absolute seek resume、Android mobile tap-to-hide controls、fullscreen landscape lock、standalone rotation button の regression guard を検証する。
  - _Requirements: 3.1-3.8, 3.11, 4.6-4.6d, 4.16a, 4.19, 5.1-5.6_
