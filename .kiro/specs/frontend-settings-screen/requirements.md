# 要求仕様書

## 概要

`/settings` 画面は `frontend-settings-storage` が定義する settings contract を編集する UI である。画面は保存済み値と一時編集値を分離し、theme preview と保存後の navigation 再生成だけを画面固有の副作用として扱う。

## 境界コンテキスト

- **対象範囲**: `/settings` route、設定 card、section/control、保存、リセット、leave 時の未保存破棄、theme preview、保存後 navigation 再生成。
- **対象外**: settings key/default/backfill の所有、App Shell の navigation 生成結果、各 workflow の詳細挙動。
- **隣接する期待事項**: settings key と default は `frontend-settings-storage`、title bar と snackbar 表示領域は `frontend-app-shell` に従う。

## 要求

### 要求 1: route と画面構成

**目的:** ユーザーとして、Settings 画面で frontend settings を一覧編集したい。

#### 受け入れ条件

1. `/settings` を表示するとき、EPGStation フロントエンドは title `設定 ` の通常画面として表示する。
2. Settings 画面を表示するとき、EPGStation フロントエンドは backend API を呼ばず、`frontend-settings-storage` の一時編集値を form control に反映する。
3. Settings 画面を表示するとき、EPGStation フロントエンドは `全般 `、`放映中 `、`番組表 `、`予約 `、`録画中 `、`録画 `、`検索 `、`ルール `、`ビデオプレーヤ ` の section を現在順で表示する。
4. Settings 画面の route 初期化が完了したとき、EPGStation フロントエンドは scroll restoration 完了を通知する。
5. Settings 画面は backend API を呼ばず、route guard なしの通常 route として表示する。
6. Settings 画面は control matrix として、section、label、settings key、control 種別、表示条件、disabled 条件、選択肢、`tmp` 反映先を requirements/design で固定する。
7. control matrix は settings screen の user-visible control を網羅し、settings key/default/backfill の定義自体は `frontend-settings-storage` を参照する。
8. 放映中の `web での再生を優先する ` / `isPreferredPlayingLiveM2TSOnWeb` は、放映中 section の `isOnAirTabListView` の直後に配置し、mpegts live 再生に対応している間だけ表示する。録画 section にも同じ文言の switch があるが、そちらは別の key `isPreferredPlayingOnWeb` に束縛される。`isPreferredPlayingLiveM2TSOnWeb` の値を読んで挙動を変える consumer は現状存在しないが、値に consumer が無いことは control を落とす理由として扱わない。
9. manual dark theme control は `shouldUseOSColorTheme` の一時値が true の間 disabled とする。
10. Guide の `ダークテーマの配色を無効化する ` control は現在 preview 中の表示 theme が light の間 disabled とする。
11. select control の選択肢は `frontend-settings-storage` の UI 許容値 contract に従い、`guideMode` は `逐次/sequential`、`最小/minimum`、`すべて/all` を表示する。
12. control matrix は少なくとも次の settings key を画面 control として含める: `isEnablePWA`、`shouldUseOSColorTheme`、`isForceDarkTheme`、`isHalfWidthDisplayed`、`isOnAirTabListView`、`onAirM2TSViewURLScheme`、`guideMode`、`guideLength`、`isForceDisableDarkThemeForGuide`、`isShowOnlyFreePrograms`、`isEnableDisplayForEachBroadcastWave`、`isIncludeChannelIdWhenSearching`、`isIncludeGenreWhenSearching`、`reservesLength`、`recordingLength`、`recordedLength`、`isShowTableMode`、`isShowDropInfoInsteadOfDescription`、`deleteRecordedDefaultValue`、`isPreferredPlayingOnWeb`、`shouldUseRecordedViewURLScheme`、`recordedViewURLScheme`、`shouldUseRecordedDownloadURLScheme`、`recordedDownloadURLScheme`、`searchLength`、`isEnableAutoScrollWhenEditingRule`、`isEnableCopyKeywordToDirectory`、`isCheckAvoidDuplicate`、`isEnableEncodingSettingWhenCreateRule`、`isCheckDeleteOriginalAfterEncode`、`rulesLength`、`isEnableExtendedPagination`、`isForceEnableSubtitleStroke`。
13. `onAirM2TSViewURLScheme`、`recordedViewURLScheme`、`recordedDownloadURLScheme` は URL scheme placeholder を表示してよいが、requirements / fixture / screenshot metadata に実 URL、実 host、環境固有値を固定しない。
14. 保存済み settings に control の許容値外の既存値がある場合、Settings 画面は route 表示や control rendering だけで保存済み値または一時編集値を自動上書きしない。select control は未選択または fallback 表示を許容し、switch/text control もユーザー操作または保存 action まで既存値の補正を永続化しない。
15. Settings control matrix は desktop / mobile のどちらでも section、label、control、helper/fallback 表示が重ならず、長い URL scheme placeholder でも horizontal overflow を発生させない。
16. Settings 画面の control matrix は単一の設定 card 内に表示し、card は desktop で centered max width 800px を正とする。section ごとの独立 card や multi-column dashboard layout はない。
17. select control は見た目を custom field として描画する場合でも、実 `<select>` を非表示 DOM にせず、MUI Select/TextField select を用いて mouse/touch/keyboard とアクセシビリティ tree 上の `combobox` として操作可能にする。表示用 overlay は pointer/focus target を奪ってはならない。
18. Settings 画面の select control は native `<select>` / `<option>` を直接描画してはならず、開いた listbox の先頭に選択不能な空白 option を表示してはならない。許容値外の保存済み値を表示する場合だけ hidden fallback item を内部値として使ってよいが、ユーザーに見える listbox item には含めない。
19. 検索 section の `自動スクロール ` control は `isEnableAutoScrollWhenEditingRule` を一時編集し、保存後は Search Rule feature が `/search?rule=<ruleId>` の EPG rule edit 初期自動検索だけに使用する値として永続化する。この control は manual search、query-driven search、time-specified rule edit、history restoration、検索結果 header の「録画設定へ移動」の挙動を変えてはならない。
20. Settings 画面のカスタム switch は thumb と track の色、thumb position の変化に 150ms 程度の transition を持ち、checked と unchecked の切替が滑らかに見える表示を維持する。
21. `guideLength`、`reservesLength`、`recordingLength`、`recordedLength`、`searchLength`、`rulesLength` など数値 select の各選択肢は、素の数値だけでなく `24時間`、`300件` のように単位 suffix（`時間 ` または `件 `）を付けて表示する。どの select が時間単位でどれが件数単位かを選択肢自体から判別できるようにする。
22. ルール section は `表示件数`（`rulesLength`）の直後に、`拡張ページネーションの有効化 ` switch（`isEnableExtendedPagination`、helper text `ルール一覧で先頭・最終ページへの移動とページ数の入力ができるページネーションを使う `）を表示する。この switch は一時編集値 `tmp.isEnableExtendedPagination` を編集し、保存するまで Rule list の pagination を変えない。

### 要求 2: 一時編集と保存

**目的:** ユーザーとして、変更を保存するまで永続化しない状態で設定を編集したい。

#### 受け入れ条件

1. control value が変更されたとき、EPGStation フロントエンドは `frontend-settings-storage` の一時編集値だけを更新する。
2. ユーザーが `保存 ` を実行したとき、EPGStation フロントエンドは一時編集値を保存済み settings として永続化する。
3. 保存が完了したとき、EPGStation フロントエンドは success snackbar `保存されました ` を表示する。保存に失敗したとき（storage への書き込みが失敗したとき）は、error snackbar `設定の保存に失敗しました` を表示し、`保存されました ` と navigation items の再生成要求は行わない。
4. 保存が完了したとき、EPGStation フロントエンドは一時編集値を永続化してから、broadcast-wave Guide navigation の表示切替が即時反映されるよう navigation items の再生成を要求する。
5. Settings 画面から離れるとき、EPGStation フロントエンドは未保存の一時編集値を破棄し、保存済み settings から一時編集値を復元する。
6. navigation 生成結果と settings/server config/current route に基づく item 条件は `frontend-app-shell` の責務とする。
7. Settings 画面は settings 固有 validation error snackbar と rollback path を持たず、保存 action の snackbar は success `保存されました ` と、storage への書き込み失敗を知らせる error `設定の保存に失敗しました` だけとする。
8. URL Scheme 系 text control は placeholder `URL` を未入力時だけ表示し、入力済み状態では placeholder を非表示にして入力文字列と重ねない。`onAirM2TSViewURLScheme`、`recordedViewURLScheme`、`recordedDownloadURLScheme` は同じ native input placeholder 機構を使い、別要素の fake placeholder を絶対配置してはならない。
9. URL Scheme 系 text control は clearable として、値が non-empty かつ disabled でないとき field 右端に clear button を表示し、押下で該当 text value を empty string に戻す。clear button は行全体の下端ではなく text input underline の高さに揃え、放映中、録画視聴、録画ダウンロードの 3 種で同じ相対位置を使う。switch header を持つ URL Scheme row では header 高さ分を加味し、button が input より下へずれてはならない。
10. Settings card の末尾には action row を置き、`リセット ` / `保存 ` は background を持たない text button として表示する。card 後続には不可視 bottom spacer を残し、画面末尾の余白を維持する。
11. 表示条件を満たさなくなった control からの変更、または有効な一時編集値の更新を生成できない変更は、一時編集値へ反映せず既存の値を維持する。

### 要求 3: reset と theme preview

**目的:** ユーザーとして、theme を確認しながら編集し、必要なら保存前に初期値へ戻したい。

#### 受け入れ条件

1. OS color theme control を有効にしたとき、EPGStation フロントエンドは現在の OS-derived dark state を一時編集値と表示 theme に反映する。
2. manual dark theme control を変更したとき、EPGStation フロントエンドは保存前でも表示 theme を preview として更新する。
3. ユーザーが `リセット ` を実行したとき、EPGStation フロントエンドは一時編集値を default settings に置き換える。
4. `リセット ` を実行したとき、EPGStation フロントエンドは保存 action が実行されるまで default settings を永続化しない。
5. `リセット ` を実行したとき、EPGStation フロントエンドは一時編集値を default settings に置き換えるが、表示 theme は保存済み settings から算出した theme に戻す。
6. default settings の theme preview は保存または後続の theme control 操作まで適用しない。
7. Settings 画面から離れるとき、EPGStation フロントエンドは保存済み settings に基づく theme 表示へ戻す。

### 要求 4: dark theme coverage

**目的:** dark theme で Settings の可読性を保つ。

#### 受け入れ条件

1. Settings 画面は dark theme で navigation icon、section title、form label、helper text、input/control、action button が背景と同化しない contrast を維持する。
2. manual dark theme preview 中も Settings main content は App Shell と同じ theme state を反映し、light background が残らないようにする。
3. Settings 画面の custom switch は dark theme checked state で thumb・track とも App Shell `primary` token 経由（CSS variable `--mui-palette-primary-main`、フォールバック値 thumb `#90caf9`、track `rgba(144,202,249,0.5)`）の色を使い、unchecked state は grey track/thumb を維持する。light theme の `#1976d2` を dark theme に流用してはならない。
