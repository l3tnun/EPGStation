# 設定画面機能

## 問題

EPGStation の利用者は、番組表の表示、list の件数、再生方式、theme などの frontend 設定を `/settings` 画面で変更する。保存前の編集が他画面へ漏れる、保存しても navigation が古いまま、reset が保存済み値を壊す、といった不具合は、利用者に「設定が効かない」と感じさせ、運用者には localStorage の手動修正を強いる。

## 現状

- 画面は `client/src/features/settings/SettingsPage.tsx` が `components/`（section、control、URL scheme 対、label）と `lib/`（storage access、control helper）を合成する。control の一覧は `settingsControlMatrix.ts`（types / rows front・back / options の各 module から組み立て）、section / layout の契約は `settingsLayoutContract.ts`、theme preview と reset / 離脱の復元は `settingsPreview.ts`、保存は `settingsSave.ts` が担う。
- 編集中の値（`tmp`）は `SettingsPage` が React state に持ち、保存済み値は `lib/settingsStorageAccess.ts` が `frontend-settings-storage` の `SettingsStorageRepository`（`client/src/shared/settings/`）で読み書きする。server API は呼ばない。
- 保存後の navigation 再生成は `frontend-app-shell` の navigation host に委ねる。
- test は `client/unittest/spec/settingsScreen.*.spec.test.tsx`（bootstrapSave / controlMatrixRendering / controlMatrixDraft / themePreview / controlInteractions / defensiveGuards）、`unittest/imp/settingsScreen.*.imp.test.ts`（layoutMatrix / savePreview / liveWebPlaybackSwitch / numericSelectUnitSuffix）、`unittest/imp/settingsStorageAccess.imp.test.ts`、e2e `client/e2e/settings-screen-workflow.spec.ts`、visual `client/visual/settings-screen-geometry.spec.ts`。

## 期待する結果

- `/settings` に storage contract の全 field が section ごとの control として並び、既存の不正値は default 表示規則に従って表示される。
- 編集は保存 button を押すまで永続化されず、画面を離れると未保存の編集は破棄される。
- reset は保存前の初期値へ戻し、theme の control は保存前に preview として反映される。
- 保存後に navigation が再生成され、snackbar で結果が通知される。

## 方針

storage contract を編集する UI として要求を定義し、画面固有の副作用を theme preview と保存後の navigation 再生成に限定する。

## スコープ

- **In**: `/settings` route、設定 card、section / control、保存、reset、離脱時の未保存破棄、theme preview、保存後の navigation 再生成要求、保存失敗の snackbar。
- **Out**: setting key / default / 補完の所有、navigation の生成結果、各 workflow が設定値をどう使うか。

## 境界候補

- screen と `frontend-settings-storage` の境目: 値の型、default、検証は storage spec、control の配置と操作は本 spec。
- screen と `frontend-app-shell` の境目: navigation 再生成の実行と snackbar 表示領域は shell、再生成の要求と文言は本 spec。

## 境界外

- `frontend-settings-storage`（key、default、補完、tmp の永続化規則）。
- `frontend-app-shell`（navigation 生成、title bar、snackbar host）。
- 各 consumer spec の詳細挙動。

## 上流・下流

- **上流**: `frontend-settings-storage`、`frontend-app-shell`。
- **下流**: 保存後に設定を読む全 consumer spec（番組表、放映中、録画済み、再生など）。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-settings-storage`（唯一の書き手として）、`frontend-app-shell`（navigation 再生成）、`frontend-guide`（Guide 表示設定 storage との役割分担）。

## 制約

- backend API を直接呼ばない。
- hash route 互換を維持する。
- 保存失敗（localStorage 書込不可）でも画面を止めず snackbar で通知する。
