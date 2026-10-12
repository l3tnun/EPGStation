# Mock Data Contract: 設定画面

## 目的

Settings Screen visual cases は `frontend-settings-storage` の settings object と adjacent storage defaults を synthetic data として使う。backend API response は持たない。

## Dataset

### `settingsDefaultControls`

- `frontend-settings-storage` の default settings object をそのまま使う。
- platform-dependent default は visual case ごとに `platformVariant` (`desktop` / `ios` / `android`) と `userAgentFamily` (`desktop-chromium` / `ios-safari` / `android-chrome`) で固定する。
- `settingsDefaultControls` は `savedSettings` と `tmpSettings` を同一 object として持ち、完全な default object field value は `frontend-settings-storage` の default schema を参照する。

### `settingsInvalidExistingValues`

- `guideLength`、`reservesLength`、`recordedLength`、`searchLength`、`rulesLength` に UI 許容値外の既存値を含める。
- enum/select control に未知値を含める。
- `invalidSelectDisplayMode` は `empty-display` とし、範囲外の既存値の select は空表示（隠し fallback item の `value=""`）にする。
- route 表示だけで保存済み値を自動上書きしないことを確認する。

### `settingsThemePreview`

- 保存済み値は light theme、tmp は dark theme preview になる組み合わせを含める。
- `osDerivedDarkState` は `false` と `true` の両 variant、`previewTheme` と `savedTheme` を明示する。
- reset/leave 後に保存済み値へ戻せる。

### `settingsEditedControls`

- navigation visibility に影響する `isEnableDisplayForEachBroadcastWave` と、表示だけに影響する複数 settings を変更済み tmp として含める。
- 保存が成功したときは App Shell へ navigation regeneration request を発行する。保存が失敗したときは発行せず、error snackbar `設定の保存に失敗しました` を出す。
- `expectedNavigationRegenerationRequested=true`、`expectedSnackbar={ text: "保存されました", color: "success" }` を含める。失敗時の期待は `expectedNavigationRegenerationRequested=false`、`expectedSnackbar={ text: "設定の保存に失敗しました", color: "error" }`。
- `routeLeaveRestoresSavedDraft=true` を含める。

### `settingsBrowserCapabilities`

- `userAgentSupportsMpegts` true / false を含め、live M2TS web playback control の表示/非表示を固定する。
- `longUrlSchemePlaceholder` は通常長と極端に長い placeholder の両方を持つ。

## 禁止事項

- `onAirM2TSViewURLScheme`、`recordedViewURLScheme`、`recordedDownloadURLScheme` に実 URL、実 host、環境固有値を含めない。
- URL scheme 欄は `<recorded-view-url-scheme>` のような placeholder だけを使う。
- backend API response、Mirakurun URL、ffmpeg / ffprobe path、認証情報を fixture に含めない。
