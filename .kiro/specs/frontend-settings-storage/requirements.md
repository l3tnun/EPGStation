# 要求仕様書

## 概要

この仕様は、EPGStation フロントエンドの frontend settings localStorage contract を定義する。各 screen spec はこの contract を参照し、setting key、default value、保存形式、一時編集、欠損 field 補完を重複定義しない。

## 境界コンテキスト

- **対象範囲**: `settings` localStorage key、JSON 保存形式、default value、platform-dependent default、missing storage / missing field の補完、`tmp` 一時値、保存、reset、隣接 workflow storage key の存在。
- **対象外**: `/settings` 画面の visual layout、App Shell の navigation item 生成結果、Guide / Recorded / Video など各 feature の詳細挙動、React 技術選定。
- **隣接する期待事項**: Settings 画面はこの contract を編集する UI として扱う。App Shell、Guide、Search、Recorded、Video などはこの contract の保存済み値を読む consumer として扱う。

## 要求

### 要求 1: Settings storage key と保存形式

**目的:** EPGStation フロントエンドの各機能として、同じ settings storage contract を参照したい。これにより、画面ごとに異なる default や保存形式が発生しない。

#### 受け入れ条件

1. settings storage を初期化するとき、EPGStation フロントエンドは localStorage key `settings` を settings object の保存先として使う。
2. settings storage を保存するとき、EPGStation フロントエンドは settings object を JSON serialized value として保存する。
3. settings storage を読むとき、EPGStation フロントエンドは保存済み settings object を frontend 全体の source of truth として扱う。
4. settings storage key が存在しないとき、EPGStation フロントエンドは default settings object を作成し、その値を保存済み settings として書き込む。
5. 保存済み settings object に default settings object が持つ field が欠けているとき、EPGStation フロントエンドは欠けている field を default value で補完し、補完後の object を保存する。
6. 保存済み settings object が default settings object に存在しない追加 field を含むとき、EPGStation フロントエンドはその追加 field をこの contract の要求として扱わない。
7. 保存済み settings object が default settings object に存在しない追加 field を含む場合、settings storage は読み書き時に追加 field を削除せず保持してよい。ただしその追加 field は typed consumer contract の要求として扱わない。
8. 保存済み JSON が parse 不能、または settings object として扱えない場合、EPGStation フロントエンドは intentional fix として default settings object に退避し、退避後の object を保存済み settings として書き込む。
9. missing field 補完は default settings object に存在する field のみを対象とする。
10. 既存 field の型不一致、enum 不一致、範囲外値は missing field 補完の対象外であり、field ごとの intentional fix が別途定義されない限り保存済み値を保持する。この保持は reset action を伴わない通常の保存 action にも適用し、保存は保存済み JSON の追加 field を削除せず、型不一致のため consumer value が default になっている field は、その値が default のままなら保存済み値を書き戻す（変更された field だけを tmp の値で上書きする）。reset action の後の保存は 2.4 に従い、この保持を適用しない。

### 要求 2: 一時値、保存、reset

**目的:** Settings 画面として、未保存の編集と保存済み値を分離したい。これにより、preview や編集途中の値が意図せず永続化されない。

#### 受け入れ条件

1. settings storage を初期化するとき、EPGStation フロントエンドは保存済み settings object を一時編集値 `tmp` に読み込む。
2. Settings 画面で control value が変更されたとき、EPGStation フロントエンドはまず一時編集値 `tmp` を変更する。
3. ユーザーが保存 action を実行したとき、EPGStation フロントエンドは一時編集値 `tmp` を `settings` localStorage key に保存する。
4. ユーザーが reset action を実行したとき、EPGStation フロントエンドは一時編集値 `tmp` を default settings object に置き換え、保存 action が実行されるまで localStorage へ永続化しない。reset の後に保存 action が実行されたときは、保存済みの値を引き継がず `tmp`（default settings object に、その後の変更を加えたもの）だけを書く。保存済み JSON の追加 field と型不一致の値は残らない。
5. Settings 画面から離れるとき、EPGStation フロントエンドは未保存の一時編集値を破棄し、保存済み settings object から `tmp` を復元する。
6. settings storage の保存に失敗したとき、EPGStation フロントエンドは例外によって application 全体を停止させない。
7. settings save action の user-facing snackbar と navigation regeneration は Settings screen / App Shell が所有し、storage contract は保存失敗を caller へ例外伝播しないことだけを定義する。validation error snackbar と rollback path は持たず、保存 action が成功した後は Settings screen が `保存されました ` を、保存が失敗した（書き込みが例外になった）ときは `設定の保存に失敗しました` を表示する。
8. Settings 画面の theme control は `tmp` による即時 preview を許可する。reset 時は `tmp` を default settings object に戻すが、表示 theme は保存済み settings 由来の状態へ戻す。leave/destroy 時は `tmp` と表示 theme をどちらも保存済み settings 由来の状態へ戻す。

### 要求 3: 全般と theme settings

**目的:** EPGStation フロントエンドとして、全般表示と theme に関する保存済み値を一貫して扱いたい。これにより、App Shell と Settings 画面が同じ theme contract を参照できる。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは `isEnablePWA=true` を設定する。
2. default settings object を作成するとき、EPGStation フロントエンドは `shouldUseOSColorTheme=true` を設定する。
3. default settings object を作成するとき、EPGStation フロントエンドは `isForceDarkTheme=false` を設定する。
4. default settings object を作成するとき、EPGStation フロントエンドは `isHalfWidthDisplayed=true` を設定する。
5. App Shell または Settings 画面が theme を判定するとき、EPGStation フロントエンドは `shouldUseOSColorTheme` と `isForceDarkTheme` を theme contract として参照する。
6. channel display を半角表示にするか判定するとき、EPGStation フロントエンドは `isHalfWidthDisplayed` を channel display contract として参照する。
7. `isEnablePWA=false` は PWA setup consumer が manifest、iOS PWA meta、service worker setup を無効化する contract として参照する。
8. `isHalfWidthDisplayed` は On Air、Guide、Search、Rule、Recorded、Recorded Upload、Recorded detail/watch など channel name 表示を持つ workflow の shared display contract として参照する。

### 要求 4: 放映中と live playback settings

**目的:** On Air と live stream workflow として、live 表示/再生設定を一貫して扱いたい。これにより、On Air spec と Video spec が同じ保存済み値を参照できる。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは `isOnAirTabListView=true` を設定する。
2. default settings object を作成するとき、EPGStation フロントエンドは `isPreferredPlayingLiveM2TSOnWeb=true` を設定する。
3. default settings object を作成するとき、EPGStation フロントエンドは `onAirM2TSViewURLScheme=null` を設定する。
4. On Air の broadcast-wave tab/list 表示を判定するとき、EPGStation フロントエンドは `isOnAirTabListView` を参照する。
5. live M2TS external playback URL scheme を解決するとき、EPGStation フロントエンドは `onAirM2TSViewURLScheme` を optional override として扱い、empty または null の場合は server config 側の URL scheme を fallback として扱う。
6. `isPreferredPlayingLiveM2TSOnWeb` は compatibility setting として保存し、playback behavior へ接続しない。
7. live M2TS external playback URL scheme が使われるとき、EPGStation フロントエンドは `PROTOCOL` と `ADDRESS` placeholder replacement を維持する。
8. URL scheme fallback と placeholder replacement の共通 helper は settings-storage が pure utility として提供できる。実際に外部 URL を開くか playlist fallback を使うかは On Air / Recorded / Video owner spec が決める。

### 要求 5: Guide settings

**目的:** Guide と Navigation として、番組表関連の保存済み値を一貫して扱いたい。これにより、navigation 表示、Guide fetch、Guide rendering が同じ contract に基づく。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは iOS 環境では `guideMode=all`、それ以外では `guideMode=sequential` を設定する。
2. default settings object を作成するとき、EPGStation フロントエンドは `guideLength=24` を設定する。
3. default settings object を作成するとき、EPGStation フロントエンドは `isForceDisableDarkThemeForGuide=false` を設定する。
4. default settings object を作成するとき、EPGStation フロントエンドは `isShowOnlyFreePrograms=false` を設定する。
5. default settings object を作成するとき、EPGStation フロントエンドは `isEnableDisplayForEachBroadcastWave=false` を設定する。
6. default settings object を作成するとき、EPGStation フロントエンドは `isIncludeChannelIdWhenSearching=true` を設定する。
7. default settings object を作成するとき、EPGStation フロントエンドは `isIncludeGenreWhenSearching=true` を設定する。
8. Guide rendering mode を判定するとき、EPGStation フロントエンドは `guideMode` を `sequential`、`minimum`、`all` のいずれかとして扱う。
9. Guide normal fetch length を判定するとき、EPGStation フロントエンドは `guideLength` を hour count として扱う。
10. Navigation が Guide navigation item を生成するとき、EPGStation フロントエンドは `isEnableDisplayForEachBroadcastWave` を generic Guide item と broadcast-wave Guide item の切替 contract として参照する。
11. Guide または search-link workflow が free program / channel id / genre inclusion を判定するとき、EPGStation フロントエンドは `isShowOnlyFreePrograms`、`isIncludeChannelIdWhenSearching`、`isIncludeGenreWhenSearching` を参照する。
12. `guideLength` の UI 許容値は 1 から 24 とする。保存済み既存 field が範囲外の場合は storage 読み込み時に補正せず、Settings 画面の UI 操作時だけ許容範囲の値を保存する。

### 要求 6: List page size と Recorded display settings

**目的:** list screen と Recorded workflow として、pagination と表示設定を一貫して扱いたい。これにより、Dashboard と各 list screen が同じ page size contract を参照できる。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは `reservesLength=24`、`recordingLength=24`、`recordedLength=24` を設定する。
2. Reserves、Recording、Recorded、Dashboard summary が page size を決めるとき、EPGStation フロントエンドは対応する `reservesLength`、`recordingLength`、`recordedLength` を参照する。
3. default settings object を作成するとき、EPGStation フロントエンドは `isShowTableMode=false` を設定する。
4. default settings object を作成するとき、EPGStation フロントエンドは `isShowDropInfoInsteadOfDescription=false` を設定する。
5. default settings object を作成するとき、EPGStation フロントエンドは `deleteRecordedDefaultValue=false` を設定する。
6. Recorded list layout、Recorded card display、Recorded delete dialog initial checkbox state を判定するとき、EPGStation フロントエンドは `isShowTableMode`、`isShowDropInfoInsteadOfDescription`、`deleteRecordedDefaultValue` を参照する。
7. `reservesLength`、`recordingLength`、`recordedLength`、`rulesLength` の UI 許容値は 1 から 100 とする。

### 要求 7: Recorded playback URL scheme settings

**目的:** Recorded playback workflow として、web playback と external URL scheme の保存済み値を一貫して扱いたい。これにより、device/platform ごとの playback handoff が同じ contract を参照できる。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは Android/iOS 以外では `isPreferredPlayingOnWeb=true`、Android/iOS では `isPreferredPlayingOnWeb=false` を設定する。
2. default settings object を作成するとき、EPGStation フロントエンドは `shouldUseRecordedViewURLScheme=true` を設定する。
3. default settings object を作成するとき、EPGStation フロントエンドは `recordedViewURLScheme=null` を設定する。
4. default settings object を作成するとき、EPGStation フロントエンドは `shouldUseRecordedDownloadURLScheme=true` を設定する。
5. default settings object を作成するとき、EPGStation フロントエンドは `recordedDownloadURLScheme=null` を設定する。
6. Recorded playback route handoff を判定するとき、EPGStation フロントエンドは `isPreferredPlayingOnWeb` と `shouldUseRecordedViewURLScheme` を参照する。
7. Recorded external playback または download URL scheme を解決するとき、EPGStation フロントエンドは saved URL scheme が null または empty の場合に server config 側の URL scheme を fallback として扱う。
8. Saved recorded URL scheme が使われるとき、EPGStation フロントエンドは `PROTOCOL`、`ADDRESS`、`FILENAME` placeholder replacement を維持する。

### 要求 8: Search / Rule / Video player settings

**目的:** Search、Rule、Video player workflow として、保存済み値を一貫して扱いたい。これにより、検索結果件数、rule 作成 default、subtitle 表示が各 spec で矛盾しない。

#### 受け入れ条件

1. default settings object を作成するとき、EPGStation フロントエンドは `searchLength=300` を設定する。
2. default settings object を作成するとき、EPGStation フロントエンドは `isEnableAutoScrollWhenEditingRule=true` を設定する。
3. default settings object を作成するとき、EPGStation フロントエンドは `isEnableCopyKeywordToDirectory=false`、`isCheckAvoidDuplicate=false`、`isEnableEncodingSettingWhenCreateRule=false`、`isCheckDeleteOriginalAfterEncode=false` を設定する。
4. default settings object を作成するとき、EPGStation フロントエンドは `rulesLength=24` を設定する。
5. default settings object を作成するとき、EPGStation フロントエンドは `isForceEnableSubtitleStroke=true` を設定する。
6. Search result limit を決めるとき、EPGStation フロントエンドは `searchLength` を参照する。
7. Rule list page size と rule 作成 default を決めるとき、EPGStation フロントエンドは `rulesLength`、`isEnableCopyKeywordToDirectory`、`isCheckAvoidDuplicate`、`isEnableEncodingSettingWhenCreateRule`、`isCheckDeleteOriginalAfterEncode` を参照する。
8. Video subtitle rendering option を決めるとき、EPGStation フロントエンドは `isForceEnableSubtitleStroke` を参照する。
9. `searchLength` の UI 許容値は 50 から 600 の 50 刻みとする。

### 要求 9: 隣接 workflow storage key

**目的:** EPGStation フロントエンドとして、settings 以外の localStorage key を誤って settings contract に吸収しないようにしたい。これにより、各 workflow の storage owner が分離される。

#### 受け入れ条件

1. live stream dialog の保存済み選択を扱うとき、EPGStation フロントエンドは `OnAirSelectStreamSetting` を settings object とは別 key として扱う。
2. recorded streaming dialog の保存済み選択を扱うとき、EPGStation フロントエンドは `RecordedSelectStreamSetting` を settings object とは別 key として扱う。
3. send-video-file dialog の host 選択を扱うとき、EPGStation フロントエンドは `SendVideoFileSelectHostSetting` を settings object とは別 key として扱う。
4. video player subtitle visibility を扱うとき、EPGStation フロントエンドは `VideoPlayerSetting` を settings object とは別 key として扱う。
5. Guide size、genre visibility、program dialog encode setting を扱うとき、EPGStation フロントエンドは `GuideSizeSetting`、`GuideGenreSetting`、`GuideProgramDetailSetting` を settings object とは別 key として扱う。
6. add encode dialog の保存済み default を扱うとき、EPGStation フロントエンドは spelling の `AddEncodeSeting` を settings object とは別 key として扱う。
7. `OnAirSelectStreamSetting` の default shape は `{ useURLScheme: false, type: 'M2TS', mode: 0 }` とする。
8. `RecordedSelectStreamSetting` の default shape は `{ type: 'WebM', mode: 0 }` とする。
9. `SendVideoFileSelectHostSetting` の default shape は `{ hostName: null }` とする。
10. `VideoPlayerSetting` の default shape は `{ isShowSubtitle: false }` とする。
11. `GuideProgramDetailSetting` の default shape は `{ encode: 'TS', isDeleteOriginalAfterEncode: false }` とする。
12. `AddEncodeSeting` の default shape は `{ encodeMode: null, parentDirectory: null, isSaveSameDirectory: false, removeOriginal: false }` とする。
13. `GuideSizeSetting` と `GuideGenreSetting` の詳細 default は `frontend-guide` が所有する。
