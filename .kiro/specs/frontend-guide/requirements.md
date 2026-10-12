# 要求仕様書

## 概要

Guide は番組表 route、schedule fetch、large grid、day/time/genre/size menu、program dialog、stream handoff を提供する。

## 境界コンテキスト

- **対象範囲**: `/guide`、`/guide/setting`、Guide query、normal/single-channel fetch、grid/timeline/header、dialog/menu、empty/error/loading、responsive。
- **対象外**: App Shell navigation item 生成、settings key/default、video player lifecycle の詳細。
- **隣接する期待事項**: Guide settings は `frontend-settings-storage`、shell は `frontend-app-shell`、player の route validation と lifecycle は `frontend-video-playback` に従う。

## 要求

### 要求 1: route/query と fetch

**目的:** ユーザーとして、番組表を放送波、日時、放送局単位で閲覧したい。

#### 受け入れ条件

1. `/guide` を表示するとき、EPGStation フロントエンドは番組表 title を表示する。
2. `type` query が有効な放送波の場合、EPGStation フロントエンドはその放送波に限定した schedule fetch を行う。
3. `type` query がない場合、EPGStation フロントエンドは enabled broadcast wave 全体を対象にした schedule fetch を行う。
4. `time` query がある場合、EPGStation フロントエンドはその日時を日本時間(JST, Asia/Tokyo)の `YYMMddhh` として扱い、Guide 開始時刻、schedule fetch window、reserve index fetch window に同一の絶対時刻を使う。UTC/local timezone のまま解釈して 9 時間ずらしてはならない。
5. `channelId` query がある場合、EPGStation フロントエンドは single-channel guide として channel schedule fetch を行い、開始時刻から 8 日分を取得する。
6. invalid `type` query がある場合、EPGStation フロントエンドはその `type` を無視し、`type` query がない場合と同じ normal guide として enabled broadcast wave 全体を対象に schedule fetch を行う。これは invalid broadcast type を API query に流さない intentional fix とする。
7. invalid `time` query がある場合、EPGStation フロントエンドは現在時刻を Guide 開始時刻として扱い、invalid `time` を API query、title、day selector、time selector の選択状態へ反映しない。snackbar は表示しない。
8. invalid `channelId` query がある場合、EPGStation フロントエンドはその `channelId` を無視し、single-channel guide ではなく normal guide として schedule fetch を行う。snackbar は表示しない。
9. schedule data が空のとき、EPGStation フロントエンドは Guide grid body を表示せず、blank presentation を維持する。empty 専用文言と snackbar は追加しない。
10. `isShowOnlyFreePrograms` が true の場合、EPGStation フロントエンドは normal guide と single-channel guide の fetch に free-program filter を反映する。
11. single-channel guide の free-only filter 送信は intentional fix とし、`GET /schedules/:channelId` に `isFree=true` query を送る。

### 要求 2: grid と visual state

**目的:** ユーザーとして、大きな番組表 grid をスクロールしながら現在時刻や予約状態を把握したい。

#### 受け入れ条件

1. schedule data を取得したとき、EPGStation フロントエンドは channel header、time scale、program grid、current time line を表示する。
2. Guide grid をスクロールしたとき、EPGStation フロントエンドは channel header と time scale の scroll position を同期する。
3. program item に reserve/conflict/skip/overlap state があるとき、EPGStation フロントエンドは state decoration を表示する。
4. Guide program item の visible decoration は `reserve` が赤（`#ff0000`）の 4px solid border、`conflict` が `reserveConflictBackground` と赤（`#ff0000`）の 4px dashed border、`skip` が `reserveSkipBackground`、`overlap` が line-through、`reserveOverlapBackground`、text `reserveOverlapText`、`none` が視覚差分なしであることを正とする。reserve / conflict の border 色は MUI theme の `error` token を使わず、light/dark 共通の固定値とする。dark theme の汎用 program cell border override は reserve / conflict の赤色 border を上書きしてはならない。
5. 同じ program id が複数 reserve list に現れる synthetic priority case では、client index 変換順 normal、conflicts、skips、overlaps の後勝ちを維持し、最終 visible state は overlap になる。
6. iOS / Android の bounce、端部 fling、CSS pixel 丸めによって scroll value が有効範囲外になったとき、EPGStation フロントエンドは visibility 判定用 viewport を content bounds へ clamp してから更新する。境界外値を理由に visibility update 全体を破棄してはならない。
7. dark theme で Guide dark color が無効化されているとき、EPGStation フロントエンドは Guide 固有 palette を通常時と同等に扱う。
8. Guide mode は `all`、`sequential`、`minimum` を扱う。default 値の正本は `frontend-settings-storage` の `guideMode` contract とし、Guide は保存済み値を消費する。
9. route update / leave では Guide grid の x/y scroll position を保存し、history restore 時だけ復元する。
10. Guide history restore では、schedule data と reserve index を取得し、program grid DOM と同期対象の channel header / time scale が準備された後、user-visible content を表示完了扱いにする前に program grid の `scrollLeft` / `scrollTop`、channel header の `scrollLeft`、time scale の `scrollTop` を復元し、通常位置で一度表示してから scroll する flicker を発生させない。
11. large program DOM は 500 件単位で yield して append し、desktop-like pointer では drag scroll を維持する。
12. single-channel guide の header は日付 header とし、full guide の channel header click だけが stream select dialog を開く。
13. current timeline は minute boundary に合わせて更新し、time scale は 24h wrap を維持する。
14. route/query 更新時、EPGStation フロントエンドは schedule と reserve index を再取得し、Socket.IO `updateStatus` では schedule 全体を再取得せず reserve index だけを更新する。
15. full guide の schedule 表示 channel は audio/video service を対象とし、reserve index の `startAt` / `endAt` は schedule fetch window と同じ範囲を使う。
16. EPGStation フロントエンドは program cell を数万件規模の React component tree として管理しない。Guide grid は React shell の外側にある imperative DOM renderer が program cell DOM、visibility class、genre class、reserve state class、event delegation を管理し、React は route/fetch/dialog state と renderer lifecycle だけを所有する。
17. program cell の内部 content は native button の既定 layout に依存せず、常に上揃えで表示する。最初の可視子要素は cell 上端から 6px 以内に配置され、短い番組や余白のある番組で中央寄せになってはならない。
18. dark theme では channel header、time scale、genre cell、reserve/conflict/skip/overlap/hidden state、current timeline、menu/dialog/select/switch/icon が背景と同化しない Guide 固有の dark palette を使う。Guide dark color disabled setting は program genre palette の切替だけを対象とし、menu/dialog/setting surface を light 固定にしてはならない。
19. dark theme の time scale は 明色の時間帯 background と全 24 時間共通の白文字 token を使う。`time-0..23` の時間帯別 class は `--guide-time-bg-0..23` によって背景色だけを切り替える。特定時間帯だけ text color を hard-code してはならず、React 側で独自に暗色化してはならない。
20. Guide page の高さは App Shell の `--app-viewport-height` を基準にし、`100vh` を直接使ってはならない。iOS / iPadOS の address bar / Stage Manager resize で visual viewport が変化しても、Guide page の下端は fixed shell の可視領域からはみ出してはならない。
21. Guide page 表示中、EPGStation フロントエンドは外側 `shell-main` の縦 scroll を発生させず、program grid の縦 scroll だけで番組表下端へ到達できるようにする。program grid 最下部で追加 scroll しても channel header が上へ移動したり消えたりしてはならない。
22. Guide grid host は renderer の `mount()` 完了前に unmount された場合、mount 完了後に renderer の readiness callback や reserve index 更新を呼んではならない。

### 要求 3: Guide menu と表示設定

**目的:** ユーザーとして、番組表の日時、表示対象、表示サイズ、ジャンル表示を変更したい。

#### 受け入れ条件

1. Guide title は app bar と document title で同期し、full guide では `番組表`、任意の broadcast-wave suffix、表示日の suffix を 次の形式で表示する。`番組表<type>` の後に半角 space と `MM/dd(曜)` を続ける（例: `番組表GR 05/05(火)`）。
2. single-channel guide では、schedule 取得後に先頭 schedule の channel name を title として表示する。
3. title bar の title を選択したとき、EPGStation フロントエンドは max width 150 の day selector dialog を開く。
4. day selector dialog は dialog open 時点の現在日を先頭に 8 日分を縦 1 列で昇順表示し、先頭日の value は現在 hour、翌日以降は `00` hour として扱う。day selector は genre dialog の 2 列 grid layout を継承してはならない。day selector dialog の accessible name は `日付選択` とし、genre setting dialog の `表示ジャンル` と混同してはならない。
5. day selector dialog では、item の日付部分（`YYMMdd` の先頭 6 桁）が現在選択中の `time` の日付部分と一致する item を disabled にする。時刻（hour）部分は比較に含めない。
6. day selector item を選択したとき、EPGStation フロントエンドは日本時間の `/guide?time=<YYMMddhh>` へ遷移し、現在の有効な `type` と `channelId` を維持する。
7. day selector dialog は close animation 後に DOM を remove/remount する。
8. title bar 右側の clock action は Guide route data と renderer が利用可能になった後に表示し、選択時に time selector menu/dialog を開く。既存 data がある background refetch 中は非表示にしてはならない。
9. time selector は day select と hour select を表示し、day options は route `time` の有効性に関わらず、常に selector を開いた時点の現在日を先頭に 8 日分とする。route `time` は selected day/hour の初期値解決と disabled 判定にだけ使い、day 候補生成の基準日には使わない。hour options は 0 から 23 とする。day select の表示文字列は `MM/DD(曜)` 形式とし、年を表示してはならない。route value は `YYMMdd` とする。
10. time selector の `表示` を実行したとき、EPGStation フロントエンドは日本時間の `/guide?time=<YYMMddhh>` へ遷移し、選択された broadcast value があれば `type`、現在の有効な `channelId` があれば `channelId` を付与する。
11. time selector の overlay background は  drawer を含む viewport 全体を覆い、outside click で menu を閉じ、透明 background を DOM から remove する。
12. broadcast select は broadcast-specific guide navigation が有効なときだけ time selector 内に表示する。
13. broadcast select は server config で有効な `GR`、`BS`、`CS`、`SKY`、`BS4K` をこの順で表示し、選択時に `type` query を更新する。
14. title bar 右側の dots menu は `予約情報更新`、`表示ジャンル`、`表示設定` を表示する。
15. main menu の `予約情報更新` を実行したとき、EPGStation フロントエンドは `POST /reserves/update` を呼び、成功時は `予約情報の更新開始`、失敗時は `予約情報の更新を開始できませんでした。` を snackbar で通知する。
16. main menu の `表示ジャンル` を実行したとき、EPGStation フロントエンドは menu を閉じてから 300ms 後に
    genre setting dialog を開く。
    この delay は menu 自体の close transition（MUI `Menu` の paper が DOM から消えるまで約 290ms）を待つためのものである。
    delay 無しで開くと、dialog の backdrop が opacity 0 → 1 で fade-in する間に、close 中の menu 項目と重なって見える。
    `client/src/features/guide/hooks/useGuideDialogState.ts`
    の `openGenreDialogAfterDelay()` は 300ms 遅延で開き、
    `client/unittest/spec/guide.menus.spec.test.tsx` の
    `waits for the closing main menu animation before opening the genre dialog` で
    300ms 未満では dialog が開かず、300ms 経過後に開くことを検証する。
17. main menu の `表示設定` を実行したとき、EPGStation フロントエンドは `/guide/setting` へ遷移する。
18. genre setting dialog は `キャンセル` と `更新` button を持ち、`更新` で genre visibility を保存したとき、EPGStation フロントエンドは Guide 表示に反映する。`キャンセル` は保存せず close する。
19. `/guide/setting` を表示するとき、EPGStation フロントエンドは title `番組表設定` を表示する。
20. size setting route で Guide size を保存したとき、EPGStation フロントエンドは Guide dimension と font size に反映する。
21. genre setting dialog は max width 500、genre 0-15 の switch、default all true を持つ。
22. genre setting dialog の保存後、EPGStation フロントエンドは schedule refetch を行わず、既存 program DOM の `hide` class を更新する。
23. 非表示 genre の program cell は DOM と click target と geometry を維持したまま、次の muted surface と text color で表示する。`visibility:hidden`、`display:none`、DOM removal によって番組情報を完全不可視にしてはならない。light theme は background `#f8f8f8` / text `#888`、dark theme は background `#272121` / text `#888` を使い、`.ctg-*` palette より後で `.hide` palette を一括適用する。
24. genre setting dialog は route change と close animation 後に DOM を remove/remount する。
25. `/guide/setting` は storage key `GuideSizeSetting` を扱い、`tablet`/`mobile`（画面の表示名は通常表示/モバイル表示）の各 7 項目、既定値、select range、`保存` snackbar `保存されました`、`リセット` は一時値 default 復元のみで保存しない挙動、600px breakpoint、program font `pt` 指定を維持する。
26. `GuideSizeSetting` の tablet default は `channelHeight=30`、`channelWidth=140`、`channelFontsize=14`、`timescaleHeight=180`、`timescaleWidth=30`、`timescaleFontsize=16`、`programFontSize=10` とする。
27. `GuideSizeSetting` の mobile default は `channelHeight=20`、`channelWidth=100`、`channelFontsize=12`、`timescaleHeight=120`、`timescaleWidth=20`、`timescaleFontsize=12`、`programFontSize=7.5` とする。
28. `/guide/setting` の select range は channel width `0-600 step 10`、time height `10-400 step 10`、channel height `10-100 step 10`、time width `10-100 step 10`、font size `0.5-40.0 step 0.5` とし、font size は小数 1 桁で表示する。
29. `GuideGenreSetting` の default shape は genre id `0` から `15` までの boolean map とし、すべて `true` を default とする。
30. `/guide/setting` の styled select field は shared `AppSelect` / MUI Select として実装し、raw native `<select>` や表示用 overlay で代替してはならない。keyboard、pointer、Testing Library / Playwright から `combobox` として操作可能な controlled control とする。
31. time selector、main menu、genre dialog、`/guide/setting` は dark theme で自身の surface / text / field / icon token を持つ。これらは `.guidePage` DOM subtree の外側や別 route に render されても dark mode を失わず、白い card、黒い icon、透明 select text、背景と同化する switch を出してはならない。
32. Socket.IO `updateStatus` による reserve index の background refetch 中、EPGStation フロントエンドは既に表示済みの Guide chrome と open 中の time selector anchor を unmount してはならない。time selector が開いている場合は、予約情報の再取得と reserve class 更新後も menu を操作可能な位置に維持し、透明 overlay だけが残って番組表操作を遮る状態を作ってはならない。
33. day selector dialog と time selector は open 中に Escape 押下で選択・遷移を行わず close する。
34. time selector は anchor 要素が document から切り離されたとき自動的に close する。
35. time selector の 放送波 select は現在 `type` が未選択のとき `すべて` option を提供し、選択時は `type` を付与しない。`currentType` が設定されているときは `すべて` option を表示しない。
36. `GuideGenreSetting` は他 tab での localStorage 変更を検知して自身のジャンル表示状態へ反映し、無関係な storage key の変更では反映しない。

### 要求 4: ProgramDialog の予約・除外・重複 action

**目的:** ユーザーとして、番組表上の番組から予約、予約編集、検索、除外、除外解除、重複解除を実行したい。

#### 受け入れ条件

1. program item を選択したとき、EPGStation フロントエンドは program dialog を開き、route change 時には dialog を閉じる。
2. no reserve 状態では、EPGStation フロントエンドは encode selector、delete-original checkbox、`詳細`、`検索`、`予約` を表示する。
3. reserve が存在する状態では、EPGStation フロントエンドは編集系ボタンの表示を『予約の有無 → reserveItem の `ruleId` の有無（rule 予約か manual 予約か）→ type』の優先順で決める。`ruleId` が無い（manual reserve）場合、EPGStation フロントエンドは type（reserve/conflict/skip/overlap）に関わらず `編集` を表示する。manual reserve の reserve または conflict 状態では、`編集`、`検索`、`削除` を表示する。
4. rule reserve の normal または conflict 状態では、EPGStation フロントエンドは `ルール`、`検索`、`除外` を表示する。
5. skip 状態では、EPGStation フロントエンドは reserveItem の `ruleId` の有無に応じて `編集`（manual reserve）または `ルール`（rule reserve）と、`検索`、`除外解除` を表示する。
6. overlap 状態では、EPGStation フロントエンドは reserveItem の `ruleId` の有無に応じて `編集`（manual reserve）または `ルール`（rule reserve）と、`検索`、`重複解除` を表示する。
7. `詳細` を実行したとき、EPGStation フロントエンドは `/reserves/manual?programId=<programId>` へ遷移する。
8. manual reserve の `編集` を実行したとき、EPGStation フロントエンドは `/reserves/manual?reserveId=<reserveId>` へ遷移する。
9. rule reserve の `ルール` を実行したとき、EPGStation フロントエンドは `/search?rule=<ruleId>` へ遷移する。
10. `検索` を実行したとき、EPGStation フロントエンドは番組名を基準に `/search` query を生成し、settings に応じて channel と genre/subGenre を含める。遷移先の SearchRule はこの query を query-driven auto-search として扱うため、Guide 側は検索 button 押下を別途要求する中間 route を作ってはならない。
11. no reserve の `予約` を実行したとき、EPGStation フロントエンドは `POST /reserves` に `programId` と `allowEndLack: true` を渡し、encode が `TS` 以外なら `encodeOption.mode1` と `isDeleteOriginalAfterEncode` を反映する。
12. manual reserve の `削除` または rule reserve の `除外` を実行したとき、EPGStation フロントエンドは `DELETE /reserves/:reserveId` を呼ぶ。
13. `除外解除` を実行したとき、EPGStation フロントエンドは `DELETE /reserves/:reserveId/skip` を呼ぶ。
14. `重複解除` を実行したとき、EPGStation フロントエンドは `DELETE /reserves/:reserveId/overlap` を呼ぶ。
15. ProgramDialog action の成功/失敗 snackbar は program name と action 結果を含め、action 完了後に dialog を閉じる。
16. dialog close 時、EPGStation フロントエンドは encode selector と delete-original checkbox の選択を Guide dialog 用 settings として保持する。
17. ProgramDialog は max width 500 とし、program metadata、description、extended text を表示し、extended text 内の `http://` と `https://` URL だけを dialog open 後に linkify する。生成 anchor は `target="_blank"` と `rel="noopener noreferrer"` を付与し、それ以外の scheme は plain text のまま扱う。`rel="noopener noreferrer"` は常に付与する。
18. ProgramDialog は Android scroll 互換のため close animation 後に DOM を remove/remount する。
19. rule reserve conflict の `除外` は `DELETE /reserves/:reserveId` を呼ぶ。frontend は skip 化または削除の backend 内部分岐を直接判定せず、後続の Socket.IO `updateStatus` による reserve index 更新で conflict/skip/none の表示状態を確定する。
20. ProgramDialog の `詳細`、`編集`、`ルール`、`検索` route action は close animation 後に遷移し、遷移先から同じ Guide route へ戻った直後も grid item を再選択して後続 action を継続できる。route leave / external unmount では dialog setting の保存だけを行い、親 page の close state 更新を再入させて hash route 復帰を妨げない。
21. mobile viewport の ProgramDialog は横幅を viewport に合わせるが、高さを viewport 比率で固定しない。content が短い場合は content + footer の高さに shrink し、下部に巨大な空白を残さない。content が長い場合だけ max-height 内で scroll する。
22. no reserve 状態の encode selector は `TS` と server config の encode mode 一覧を source とし、`H.264` などの固定値を frontend に hardcode しない。保存済み dialog setting が server config に含まれない mode を持つ場合だけ、その値を現在選択値として追加表示する。
23. no reserve 状態の encode selector と delete-original checkbox は read-only 表示ではなく、mouse/touch/keyboard と Testing Library / Playwright で操作可能な control とする。encode selector は shared `AppSelect` / MUI Select、delete-original checkbox は MUI `Checkbox` / `FormControlLabel` を正とし、raw `<select>` と raw `<input type="checkbox">` を直接描画してはならない。encode selector の選択値は MUI Select の表示面だけが描画し、同じ mode 名を sibling `span` や overlay text で再描画して二重表示してはならない。
24. mobile viewport の ProgramDialog footer は checkbox、encode selector、action buttons を dialog bounds 内に収め、横 overflow と control の切れを発生させない。checked checkbox は MUI primary check mark を表示し、dark theme でも checkbox、select underline、select arrow、label が背景と同化しない。
24a. no reserve 状態の ProgramDialog footer は delete-original checkbox と encode selector を 52px 行内で中央揃えする。footer 自体の高さを viewport 比率や固定 114px にせず、content + 52px option row + 36px action row + padding だけで自然に shrink する。encode selector の control box は 48px 高さ、max width 120px とし、checkbox label と縦位置がずれて見える状態を禁止する。52px option row 内の child padding / MUI field box によって `scrollHeight > clientHeight` や computed `overflow-y:auto` を発生させてはならない。
24b. ProgramDialog no reserve 状態の encode selector menu は、server config 由来の `TS` + encode mode 一覧を表示するとき、dropdown/listbox/Paper 自体に不要な縦スクロール領域を作らない。shared `AppSelect` の既定 menu cap は 4.5 items とするが、ProgramDialog encode selector は ProgramDialog の compact footer menu と同じく、通常の encode option 件数が menu 内で完結するよう明示的に visible item 上限を指定する。Android touch 操作性を損なわないよう、menu option の高さは 44px 以上を維持し、項目を詰めて scroll を隠す対策を禁止する。MUI Popover/Paper の既定 `overflow-x:hidden` / `overflow-y:auto` による計算後 overflow 回帰を防ぐため、ProgramDialog encode menu では Paper と listbox の両方で `overflow-x` / `overflow-y` を internal scroll 非発生の値にする。page 本体や dialog footer に dropdown 由来の縦スクロール領域を作ってはならない。
25. Guide、SearchRule、OnAir が使う ProgramDialog は同一の encode selector / delete-original checkbox contract を共有し、consumer ごとに異なる control 実装や hardcoded encode mode を持たない。
26. ProgramDialog の予約/削除/除外解除/重複解除 action は実行中に同じ action を再度実行せず、進行中の呼び出しを二重発火しない。
27. ProgramDialog は reserve index の該当 entry が予約詳細（`item`）を持たない不整合な形状のとき、reserve 系 API を呼ばずに failure snackbar を表示する。

### 要求 5: live stream handoff

**目的:** ユーザーとして、番組表から放送中 channel のライブ視聴へ移動したい。

#### 受け入れ条件

1. full guide の channel header を選択したとき、EPGStation フロントエンドは stream select dialog を表示する。
2. Guide から開いた stream select dialog では `番組表` button を表示し、`/guide?channelId=<channelId>` へ遷移し、現在 `time` があれば維持する。
3. Guide から live stream を開始するとき、EPGStation フロントエンドは stream type/config を選択して watch route へ遷移する。
4. unsupported combination では、EPGStation フロントエンドは `再生に対応していません` を snackbar で通知する。
5. Guide stream dialog の `番組表` button は `type` を維持しない。`type` 維持へ変える場合は別の intentional change として扱う。
6. watch route への移動失敗は `視聴ページへの移動に失敗` を snackbar で通知する。
7. Guide から開いた stream select dialog の `番組表` button は `channelId` と現在 `time` だけを受け取り、300ms 程度の短い delay 後に `/guide?channelId=<channelId>[&time=<YYMMddhh>]` へ遷移する。stream type/mode/URL scheme の保存と watch route 生成は `frontend-onair` / `frontend-video-playback` の owner contract に従う。

### 要求 6: loading/error/empty

**目的:** ユーザーとして、番組表取得中や失敗時に現在状態を理解したい。

#### 受け入れ条件

1. Guide fetch が共有 hook `useDeferredLoading` の遅延（200ms）を超えて続くとき、EPGStation フロントエンドは番組表の領域の上に暗い scrim（`rgb(0, 0, 0, 0.6)`）と円形 progress（indeterminate、size 60、thickness 4、primary 色）を表示し、fetch の完了と scroll 位置の復元の後に（表示した場合は最短表示時間 200ms を過ぎてから）消す。遅延より早く終わる fetch では表示しない。grid は復元の前に表示しない。fetch に失敗した場合や schedule data が空の場合も、結果が確定した後は scrim を残さない。loading と empty は、scrim と progress の有無で区別できる。
2. Guide fetch に失敗したとき、EPGStation フロントエンドは `番組表情報の取得に失敗しました` を snackbar で通知する。
3. schedule data が空のとき、EPGStation フロントエンドは要求 1 の blank presentation を維持し、empty 専用文言と snackbar を追加しない。

### 要求 7: reserve reflection と dark theme

**目的:** ProgramDialog の予約操作を番組表へ即時反映し、dark theme で可読性を保つ。

#### 受け入れ条件

1. ProgramDialog で予約、削除、除外、除外解除、重複解除が成功したとき、EPGStation フロントエンドは reserve index を再取得し、番組表 item の reserve/conflict/skip/overlap class を即時に反映する。
2. reserve action 後に同じ番組表へ戻ったとき、取得済み schedule data があっても reserve index が stale のままにならず、番組表データ取得失敗の誤表示を出さない。
3. ProgramDialog、Guide main content、time selector、genre dialog は dark theme で background、text、sub text、action area、divider の contrast を維持する。
