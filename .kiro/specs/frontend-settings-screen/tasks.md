# Implementation Plan

- [x] 1. `/settings` route と SettingsPage layout を実装する
  - App Shell の通常 title `設定` と scroll restoration done signal を使い、backend API を呼ばない route として表示する。
  - 単一 centered settings card、desktop max width 800px、mobile 1 column、section order を維持する。
  - 長い URL scheme placeholder でも horizontal overflow が出ないことを visual/geometry assertion で確認できる。
  - _Depends: frontend-settings-storage 1, frontend-app-shell 1_
  - _Requirements: 1.1-1.5, 1.15-1.21_

- [x] 2. SettingsControlMatrix と form validation 境界を実装する
  - section、label、settings key、control 種別、表示条件、disabled 条件、選択肢、`tmp` 反映先を matrix として固定する。
  - mpegts.js support、OS theme、current preview theme による visible/disabled 条件を反映し、非表示 control は保存済み値と `tmp` を変更しない。
  - select control は Settings Storage の UI 許容値 contract に従い、保存済み範囲外値は表示だけで自動永続化しない。
  - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14_

- [x] 3. 一時編集、保存、navigation regeneration を実装する
  - control change は Settings Storage の `tmp` だけを更新し、保存 action で永続化する。
  - 保存が成功した後は `保存されました` snackbar を表示し、App Shell へ navigation regeneration request を送る。
  - Settings screen は validation error snackbar と rollback path を持たず、保存の成功と失敗の snackbar（`保存されました` と `設定の保存に失敗しました`）を所有する。
  - _Requirements: 2.1-2.4, 2.6-2.11_

- [x] 4. reset、theme preview、leave cleanup を実装する
  - OS color theme control と manual dark theme control は保存前 preview として表示 theme を更新する。
  - reset は `tmp` を default settings に戻すが、保存まで永続化せず、表示 theme は保存済み settings 由来へ戻す。
  - route leave では未保存 `tmp` と表示 theme を保存済み settings 由来へ復元する。
  - _Requirements: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 5. Settings screen の unit/E2E/visual regression を整備する
  - `unittest/spec` は control matrix、save/reset/leave、theme preview、navigation regeneration request を requirements ID に紐づけて検証する。
  - `unittest/imp` は visible/disabled 条件、範囲外値表示、URL scheme placeholder overflow guard を検証する。
  - Playwright visual は desktop/mobile/light/dark の card geometry と section/control overlap absence を確認する。
  - _Requirements: 1.1-1.22, 2.1-2.11, 3.1-3.7, 4.1-4.3_
- [x] 6. Settings select の MUI dark token、4.5 item menu cap、二重矢印禁止、URL Scheme clear button の縦位置、検索自動スクロール設定の所有範囲を検証する。
  - _Requirements: 1.17-1.19, 2.9, 4.1-4.3_
