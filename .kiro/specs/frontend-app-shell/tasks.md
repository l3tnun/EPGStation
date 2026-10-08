# Implementation Plan

- [x] 1. App Shell bootstrap と共通 layout を実装する
  - React Router hash route 対応 router、TanStack Query provider、MUI theme provider、Snackbar host、main content slot、drawer host を App Shell に接続する。
  - theme は Settings Storage の保存済み値と OS preference から決定し、desktop/mobile の drawer 余白が visual contract と一致する。
  - `client/` はこの task で新規作成せず、`frontend-settings-storage` の foundation task で作成された package を使う。
  - _Depends: frontend-settings-storage 1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. TitleBar と EditTitleBar の共通 contract を実装する
  - 通常 title bar は navigation icon、title、right action slot、extension slot、browser title sync、optional title click handler を提供する。
  - edit mode では close、select-all、delete action を screen owner へ event として渡し、App Shell は screen-specific action を所有しない。
  - light/dark theme の app bar treatment と Dashboard version title が visual/spec test で確認できる。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

- [x] 3. Navigation item generation と selected 判定を実装する
  - server configuration、settings、enabled broadcast wave から navigation label、icon、route target を生成する。
  - enabled wave 0 件では generic Guide item へ fallback せず、loading-time placeholder と取得後の intentional fix を区別する。
  - selected 判定は path と item-defined query key だけを比較し、`timestamp` や Guide 固有 query を無視する。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 4. Drawer responsive、navigation click、route move を実装する
  - 1264px 以上/未満の default open state、drawer width 256px、mobile click close delay、desktop click no-close を実装する。
  - generic Guide click は `/guide` のみ、broadcast-wave Guide click は `type` のみを追加し、common route move は `timestamp` を付与する。
  - 同一 path かつ `timestamp` 以外が同じ場合は不要な route push が発生しないことを観測できる。
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19, 5.20, 5.21, 5.22_

- [x] 5. Version refresh、Socket.IO connection、scroll history contract を実装する
  - `/version` と `/config` を typed fetch wrapper で取得し、route change と Socket.IO `updateStatus` による refresh を TanStack Query invalidation/refetch に接続する。
  - disconnect overlay、disconnect/reconnect snackbar、Dashboard 経由の previous full route restore、Socket.IO 初期化失敗 snackbar を実装する。
  - shared scroll history contract は routed screen が save/restore/done signal を利用でき、history restore の場合だけ保存済み scroll data を適用する。
  - history restore では data fetch と初期 DOM / renderer 準備の完了後、user-visible content を表示完了扱いにする前に scroll position を適用し、通常位置で一度表示してから scroll する flicker を発生させない。
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18, 6.19, 6.20, 6.21, 6.22, 6.23_

- [x] 6. App Shell の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で navigation matrix、selected 判定、route move、snackbar、version failure、scroll history、history restore の pre-visible scroll application を検証する。
  - Playwright + MSW で Desktop Chromium、Desktop Firefox、Android Chrome、iOS Safari の主要 App Shell workflow と geometry assertion を確認できる。
  - fixture は synthetic data のみを使い、実 URL、実番組名、認証情報、環境固有値を含めない。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19, 5.20, 5.21, 5.22, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18, 6.19, 6.20, 6.21, 6.22, 6.23, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21, 8.22, 8.23, 8.24, 8.25, 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.32, 8.33, 8.34, 8.35, 8.36, 8.37, 8.38, 8.39, 8.40, 8.41, 8.42, 8.43, 8.44, 8.45, 8.46, 8.47_
- [x] 7. shared `AppSelect` に MUI theme 継承、4.5 item menu cap、vertical center 表示、hidden fallback、clear action、owner width 保持の契約を追加し、manual dropdown arrow / native select / visible placeholder / raw checkbox の静的 regression guard を維持する。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16, 8.17, 8.18, 8.19, 8.20, 8.21, 8.22, 8.23, 8.24, 8.25, 8.26, 8.27, 8.28, 8.29, 8.30, 8.31, 8.32, 8.33, 8.34, 8.35, 8.36, 8.37, 8.38, 8.39, 8.40, 8.41, 8.42, 8.43, 8.44, 8.45, 8.46, 8.47_
