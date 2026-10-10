# Implementation Plan

- [x] 1. React frontend foundation と settings storage 基盤を作成する
  - `client/` に、Node.js 24.18.0 の mise pin、Vite React TypeScript、npm lock、ESLint flat config、Prettier、Vitest、V8 coverage、Playwright/MSW、`@/` alias、`build` / `build:verify` / `check` script gate を置く。
  - `build` は Vite production build（`bundle`）、`build:verify` は lint、typecheck、unit test、`build`、`check` は lint、format:check、typecheck、`test:dev-server`、`unittest/spec`、`unittest/imp` を通す構成にする。
  - SettingsStorageRepository、SettingsValidator、DefaultSettingsFactory、AdjacentStorageRegistry の実装境界を用意し、localStorage key `settings` の read/write と JSON parse failure fallback が unit test で観測できる。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 2. default settings と platform-dependent contract を実装する
  - default settings object に全般、放映中、Guide、list page size、Recorded playback、Search/Rule/Video の default field を定義する。
  - iOS/Android/その他 platform による `guideMode` と `isPreferredPlayingOnWeb` の default 差分を deterministic input で生成できる。
  - UI 許容値は Settings 画面の consumer contract として公開し、storage load 時の既存範囲外値は自動補正しない。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

- [x] 3. tmp draft、save、reset、leave restore を実装する
  - 保存済み settings と一時編集値 `tmp` を分離し、control change、save、reset、leave restore の状態遷移を Settings 画面（`SettingsPage` の React state と `lib/settingsStorageAccess.ts` の `persistSettingsTmp`）で提供する。受け入れ条件は `unittest/spec/settingsScreen.*` で確かめる。
  - save failure は application 全体を停止させず caller に制御を返し、Settings screen が snackbar を所有できる境界にする。
  - theme preview は `tmp` に反応するが、reset/leave では保存済み settings 由来の表示 theme に戻ることを unit test で観測できる。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 4. 隣接 workflow storage key registry と URL scheme utility を実装する
  - `OnAirSelectStreamSetting`、`RecordedSelectStreamSetting`、`SendVideoFileSelectHostSetting`、`VideoPlayerSetting`、`GuideProgramDetailSetting`、`AddEncodeSeting` の default shape を settings object から分離する。
  - `GuideSizeSetting` と `GuideGenreSetting` の owner を Guide に残し、この registry では key 分離と default 参照だけを提供する。
  - URL scheme placeholder replacement は `PROTOCOL`、`ADDRESS`、`FILENAME` を pure utility として扱い、実 URL や環境固有値を fixture に含めない。
  - _Requirements: 4.7, 4.8, 7.7, 7.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13_

- [x] 5. settings storage の spec/imp test と synthetic fixture を整備する
  - `unittest/spec` は requirements の storage load/save/backfill/draft/default/adjacent key behavior を synthetic localStorage で検証する。
  - `unittest/imp` は parse failure、missing field、追加 field preservation、platform default、URL scheme replacement、UI 許容値の edge case を検証する。
  - fixture と snapshot に実 URL、実番組名、認証情報、Mirakurun URL、ffmpeg / ffprobe 実 path、環境固有値が含まれないことを確認できる。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13_
