# 設定保存機能

## 問題

EPGStation frontend の App Shell、番組表、放映中、録画済み、検索、動画再生、各 list 画面は同じ `settings` localStorage を読む。各画面が default 値、保存形式、欠損 field の補完、保存済み値と編集中の値の分離を別々に実装すると、利用者は「設定画面で保存したのに番組表には反映されない」「ブラウザを変えたら初期値が違う」といった矛盾に遭う。運用者は不正な保存値が原因の不具合を再現できない。

## 現状

- contract の実体は `client/src/shared/settings/` にある。型は `settingsTypes.ts`、default と platform 依存 default は `defaultSettings.ts` / `platformDefaultSettings.ts`、解析 / 補完 / 検証は `settingsValidation.ts` と `settingsStorage.ts`、編集中の値は `settingsDraftStore.ts`、settings 以外の localStorage key の登録は `adjacentStorageRegistry.ts`、URL scheme の platform 判定は `urlScheme.ts` / `urlSchemePlatform.ts`。
- App Shell の読み取りは `client/src/app/settingsStorageAdapter.ts`（theme と navigation）、`client/src/app/pwa.ts`、`client/src/app/lib/shellSettingsSnapshots.ts` が `SettingsValidator` で行い、書き手は `/settings` 画面の `client/src/features/settings/lib/settingsStorageAccess.ts` だけである。
- server API は呼ばない。
- test は `client/unittest/spec/settingsStorage.*.spec.test.ts`（contract / draft / adjacent）と `unittest/imp/settingsStorage.*.imp.test.ts`（repository / registryUrlScheme）。UI を持たないため e2e / visual は消費側 spec が担う。

## 期待する結果

- `settings` key の JSON 形式、全 field の default、platform 依存 default（URL scheme など）が一か所で定義され、欠損 key / 欠損 field は default で補完されて保存される。
- 編集中の値（tmp）は保存するまで永続化されず、reset と未保存破棄が保存済み値に影響しない。
- 各消費 spec は typed contract だけを参照し、setting の意味を重複定義しない。
- settings 以外の workflow が使う localStorage key は registry に列挙され、settings contract に吸収されない。

## 方針

UI から独立した storage contract として要求を定義し、Settings 画面はこの contract を編集する UI、他の画面は読む consumer として扱う。

## スコープ

- **In**: `settings` localStorage key、JSON 保存形式、default 値、platform 依存 default、欠損補完、tmp 一時値、保存、reset、隣接 workflow storage key の登録。
- **Out**: `/settings` 画面の layout と snackbar、App Shell の navigation 生成結果、各 feature の詳細挙動。

## 境界候補

- storage contract と `frontend-settings-screen` の境目: 値の意味、default、検証は本 spec、control の配置と保存操作の UI は screen spec。
- storage contract と各 consumer の境目: 番組表の表示設定、list page size、再生設定などの意味は本 spec、その値による描画は各 consumer。
- settings key と隣接 key の境目: 隣接 key の存在と owner は本 spec が登録し、値の形式は owner spec が持つ。

## 境界外

- `frontend-settings-screen`（layout、保存 / reset の操作、theme preview）。
- `frontend-app-shell`（navigation 生成結果）。
- `frontend-guide` / `frontend-recorded` / `frontend-video-playback` などの詳細挙動。

## 上流・下流

- **上流**: browser localStorage と user agent / platform 判定。
- **下流**: `frontend-app-shell`、`frontend-settings-screen`、`frontend-guide`、`frontend-onair`、`frontend-recorded`、`frontend-recording-encode`、`frontend-reserves`、`frontend-search-rule`、`frontend-storages-upload`、`frontend-video-playback`、`frontend-dashboard`。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-settings-screen`（書き手）、`frontend-guide`（Guide 表示設定 storage）、`frontend-onair`（stream 選択 storage）、`frontend-recorded`（隣接 storage key）。

## 制約

- localStorage が使えない環境でも default で動作し、例外で画面を止めない。
- 不正な保存値は default へ補完し、補完結果を保存する。
- 実 URL、認証情報を default や fixture に含めない。
