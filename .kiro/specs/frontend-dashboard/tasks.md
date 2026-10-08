# Implementation Plan

- [x] 1. Dashboard route、title、summary fetch lifecycle を実装する
  - `/` route は version string を title に使い、録画中、録画済み、予約 summary section を順に表示する。
  - `GET /reserves/cnts`、`GET /recording`、`GET /recorded`、`GET /reserves` を settings と route query から組み立て、Dashboard route `page` は summary offset に混入させない。
  - initial route、route/query change、Socket.IO `updateStatus` は TanStack Query invalidation/refetch に接続し、load 前は本体を隠し、完了後に表示する。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Dashboard item navigation と delegated action entrypoint を実装する
  - more button は total が表示件数を超える場合だけ表示し、各 list route の `page=2` へ遷移する。
  - recording/recorded item click は recorded detail workflow へ遷移し、reserve card click は Reserves owned `ReserveDialog` を開く。
  - conflict badge、ReserveDialog 日時 click、reserve menu、reserve delete dialog、recorded/recording menu は隣接 owner の exported contract を consumer として使い、Dashboard で API body や snackbar 文言を再定義しない。
  - _Depends: frontend-recorded 2, frontend-reserves 2, frontend-recording-encode 1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14_

- [x] 3. Dashboard responsive、theme、summary visual state を実装する
  - default max width 600px の縦積み、1023px 以上の 3 section 横並び、1264px 以上 drawer open content 領域での横並びを維持する。
  - dark theme、conflict badge、more button boundary、thumbnail fallback、drop/description display が visual contract と一致する。
  - section scroll position は route leave/update 時に保存し、history restore の場合だけ復元する。
  - _Requirements: 1.9, 2.14, 2.15, 2.16, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Dashboard の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で fetch options、snackbar 文言、more condition、delegated action entrypoint、scroll restore を検証する。
  - Playwright + MSW で summary loading/empty/error、desktop/mobile layout、conflict badge、delegated dialog/menu entrypoint を synthetic data で確認する。
  - fixture と screenshot baseline に実番組名、実 URL、実ロゴ、サムネイル、認証情報を含めない。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
