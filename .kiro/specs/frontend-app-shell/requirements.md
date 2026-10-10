# 要求仕様書

## 概要

この仕様は、EPGStation フロントエンドの共通 App
Shell と Navigation の要求を定義する。全画面に共通する navigation drawer、main content、theme、selected
navigation、version 更新、接続状態表示を requirements 化する。TitleBar /
EditTitleBar は共通部品契約だけを扱い、描画と状態所有は各 routed
screen の責務とする。保存済み settings の key、default、保存形式は `frontend-settings-storage`
を上流仕様として参照する。

## 境界コンテキスト

- **対象範囲**: 共通 app shell、TitleBar / EditTitleBar の共通部品契約、navigation item 生成、selected item 判定、drawer
  responsive 挙動、navigation item click 挙動、version 表示、theme 反映、接続切断/再接続のユーザー可視挙動。
- **対象外**: Dashboard 以降の各 routed screen 本体、個別画面の list/dialog/form/player behavior、React 技術選定、UI
  component library 選定、server path routing への移行。
- **隣接する期待事項**: 各 routed screen はこの App Shell の main content 領域に表示され、必要に応じて TitleBar /
  EditTitleBar 共通部品を screen 内で描画する。画面ごとの title、edit
  mode への遷移条件、snackbar 文言、API 詳細は該当 screen spec または後続 design で扱う。App Shell は
  `frontend-settings-storage` が定義する保存済み settings contract を読む consumer であり、settings の default
  value や migration/backfill を所有しない。

## 要求

### 要求 1: 共通 Shell と画面表示

**目的:** EPGStation ユーザーとして、すべての画面で一貫した application
shell を使いたい。これにより、navigation、title、theme、接続状態 feedback が frontend 全体で予測可能になる。

#### 受け入れ条件

1. フロントエンド起動時、EPGStation フロントエンドは navigation drawer、snackbar 領域、main
   content 領域を含む共通 shell の中に routed screen content を表示する。TitleBar / EditTitleBar は各 routed
   screen が共通部品として描画する。
2. active route が変更されたとき、EPGStation フロントエンドは共通 shell を維持したまま、対象 routed screen を main
   content 領域に表示する。
3. `frontend-settings-storage` が定義する保存済み theme settings と OS preference から active light/dark
   theme を判定したとき、EPGStation フロントエンドは選択された theme を application shell 全体へ反映する。
4. desktop layout 幅で navigation drawer が開いている間、EPGStation フロントエンドは main
   content が drawer の右側から始まるように表示する。
5. mobile layout 幅で navigation drawer を使う間、EPGStation フロントエンドは main
   content に drawer 分の左余白を与えず、drawer open 時は overlay として表示する。
6. main content 領域へ routed screen content を表示するとき、EPGStation フロントエンドは data
   取得 hook が動作するための TanStack Query context を routed screen へ提供し、production build 向けの
   debug/probe UI を main content 内に残してはならない。
7. server configuration が未取得の間、EPGStation フロントエンドは routed screen の content を描画せず、shell を空のまま維持する。

### 要求 2: Title Bar と Edit Title Bar

**目的:** EPGStation ユーザーとして、title bar に現在の状態に応じた navigation action または edit
action を表示してほしい。これにより、global navigation と bulk editing を区別して操作できる。

#### 受け入れ条件

1. 通常 routed screen を表示しているとき、EPGStation フロントエンドは title bar に navigation icon を表示する。
2. ユーザーが通常 title bar の navigation icon を操作したとき、EPGStation フロントエンドは navigation drawer の open
   state を toggle する。
3. routed screen が edit mode に入ったとき、EPGStation フロントエンドは通常 navigation icon の代わりに、その edit
   workflow 用の close、select-all、delete action を表示する。
4. フロントエンドが light theme のとき、EPGStation フロントエンドは light mode app bar treatment の通常 title bar を表示する。
5. フロントエンドが dark theme のとき、EPGStation フロントエンドは dark mode app bar treatment の通常 title
   bar を表示する。
6. Dashboard route を表示しているとき、EPGStation フロントエンドは Dashboard title と browser title に version
   string を使う。
7. Dashboard 以外の route を表示しているとき、EPGStation フロントエンドは該当 routed screen が定義する title を使う。
8. 通常 TitleBar は navigation icon、title、右側 action slot、任意 extension 領域を持ち、title 変更時に browser
   title を同期する。
9. title click が必要な routed screen では、その screen が title click handler を提供できる。
10. 通常 title bar は上端の box-shadow を下方向にのみ滲ませ、shell 上部に 1px の線を残さない。
11. 通常 title bar の高さは viewport **幅** 960px 未満は 56px、960px 以上は 64px とする。判定は viewport 幅で行い、
    高さでは判定しない。実装 `titleBarLayout.ts` の `resolveLegacyTitleBarMinHeight(viewportWidth)` も幅で判定する。
12. 通常 title bar 内の navigation button と title の padding/margin は既定のジオメトリ値を維持する。

### 要求 3: Navigation Item 生成

**目的:** EPGStation ユーザーとして、navigation drawer が server
capability と保存済み表示設定を反映してほしい。これにより、利用できない destination は表示されず、有効な broadcast-wave
link は利用できる。

#### 受け入れ条件

1. navigation
   item を生成するとき、EPGStation フロントエンドは常に「ダッシュボード」「録画中」「録画済み」「エンコード」「予約」「競合」「重複」「検索」「ルール」「ストレージ」「設定」を含める。
2. server configuration で TS live stream が有効なとき、EPGStation フロントエンドは navigation に「放映中」を含める。
3. server configuration で TS live stream が無効なとき、EPGStation フロントエンドは navigation に「放映中」を含めない。
4. `frontend-settings-storage` が定義する保存済み `isEnableDisplayForEachBroadcastWave` が無効で、server
   configuration 上の enabled broadcast
   wave が 1 件以上あるとき、EPGStation フロントエンドは generic な「番組表」navigation item を 1 件だけ含める。
5. `frontend-settings-storage` が定義する保存済み `isEnableDisplayForEachBroadcastWave`
   が有効なとき、EPGStation フロントエンドは server configuration 上で有効な GR、BS、CS、SKY、BS4K の各 broadcast
   wave に対して、それぞれ「番組表 GR」「番組表 BS」「番組表 CS」「番組表 SKY」「番組表 BS4K」の navigation item を、GR、BS、CS、SKY、BS4K の順で生成する。
6. `frontend-settings-storage` が定義する保存済み `isEnableDisplayForEachBroadcastWave`
   が有効なとき、EPGStation フロントエンドは server configuration 上で無効な broadcast
   wave の「番組表」item を生成しない。
7. `frontend-settings-storage` が定義する保存済み `isEnableDisplayForEachBroadcastWave` が有効で、server
   configuration 上の enabled broadcast wave が複数あるとき、EPGStation フロントエンドは enabled broadcast
   wave の数だけ broadcast-wave guide navigation item を表示する。
8. server configuration が取得済みだが enabled broadcast wave がないとき、EPGStation フロントエンドは
   `isEnableDisplayForEachBroadcastWave` の保存済み設定にかかわらず「番組表」navigation item を表示しない。
9. `isEnableDisplayForEachBroadcastWave` が有効で、server configuration が取得済みだが enabled broadcast
   wave がないとき、EPGStation フロントエンドは generic な「番組表」navigation item へ fallback しない。
10. Settings 画面から navigation regeneration request を受信したとき、EPGStation フロントエンドは page
    reload を要求せずに navigation item を再生成する。request は保存内容が navigation
    visibility に影響するかを Settings 側で判定せず、保存が成功した後に常に発行され、保存が失敗したときは発行されない。
11. EPGStation フロントエンドは 次の navigation label、icon name、route
    target を維持する。ただし enabled broadcast wave がないときに generic な「番組表」navigation item を表示する
    挙動は持たない（本要求 AC9 のとおり）。
12. server configuration が未取得の間、EPGStation フロントエンドは config 依存 item のうち「放映中」と broadcast-wave
    Guide item を生成せず、loading-time placeholder として generic な「番組表」item を表示できる。
13. server configuration が取得済みになった後、enabled broadcast
    wave が 0 件の場合に generic な「番組表」を非表示にする挙動は intentional fix として扱い、クリック先のない Guide
    navigation を出さないための仕様とする。
14. `設定` navigation item は icon name `settings` を維持する。
15. `isEnablePWA=false` の保存済み設定を読む consumer は App Shell startup とし、manifest、iOS PWA meta、service worker
    setup を無効化する。settings-storage は field/default だけを所有する。
16. Settings 画面で保存 action が成功したとき、Settings 画面は App Shell へ navigation regeneration
    request を発行し、App Shell は server configuration と保存済み settings から navigation item を再生成する。保存が失敗
    したときは request を発行しない。

### 要求 4: Selected Navigation 判定

**目的:** EPGStation ユーザーとして、現在 route に対応する navigation
item が selected 表示されてほしい。これにより、application 内の現在位置を把握できる。

#### 受け入れ条件

1. current route path が navigation item path と一致し、その item が定義するすべての query key が current route
   query と一致するとき、EPGStation フロントエンドは最初に一致した item を selected にする。
2. current route が matching navigation item に定義されていない追加 query
   parameter を含むとき、EPGStation フロントエンドはその navigation item の selected 状態を維持する。
3. navigation item が query condition を持たず、current route
   path が一致するとき、EPGStation フロントエンドは path の一致だけでその item を selected にする。
4. current route が `/reserves?type=normal`、`/reserves?type=conflict`、`/reserves?type=overlap`
   のいずれかのとき、EPGStation フロントエンドはそれぞれ「予約」「競合」「重複」を selected にする。
5. current reserves route に一致する navigation item
   query がないとき、EPGStation フロントエンドは reserves 系 navigation item を selected にしない。
6. broadcast-wave guide navigation が有効で、current Guide route query の `type` が `GR`、`BS`、`CS`、`SKY`、`BS4K` の enabled
   broadcast
   wave と一致するとき、EPGStation フロントエンドは対応する「番組表 GR」「番組表 BS」「番組表 CS」「番組表 SKY」「番組表 BS4K」の item を selected にする。
7. broadcast-wave guide navigation が無効で、current route
   path が Guide のとき、EPGStation フロントエンドは route に Guide query
   parameter が含まれていても generic な「番組表」item を selected にする。
8. current Guide route に `time`、`channelId`、`timestamp` など navigation item が定義していない query
   parameter が含まれるとき、EPGStation フロントエンドはそれらの追加 query parameter によって selected
   item 判定を失敗させない。

### 要求 5: Drawer Responsive と Navigation Click

**目的:** EPGStation ユーザーとして、navigation
drawer が desktop/mobile 幅に応じて適切に動いてほしい。これにより、navigation が不要に content を隠さない。

#### 受け入れ条件

1. viewport width が 1264px 以上で、drawer に明示的な user-toggled
   state がないとき、EPGStation フロントエンドは drawer を default open として表示する。
2. viewport width が 1263px 以下で、drawer に明示的な user-toggled
   state がないとき、EPGStation フロントエンドは drawer を default closed として表示する。
3. navigation drawer を表示するとき、EPGStation フロントエンドは drawer width を 256px とする。
4. viewport width が 1264px 以上で permanent navigation
   drawer を表示するとき、EPGStation フロントエンドは drawer 内に横スクロールを発生させず、navigation
   item の label は drawer 幅内で ellipsis にする。
5. viewport height が navigation
   drawer 全体を表示できないほど小さいとき、EPGStation フロントエンドは drawer 内だけを縦方向にスクロール可能にし、body
   / main content の横スクロールや drawer の横スクロールを発生させない。
6. viewport width が 1264px 未満の状態でユーザーが navigation item を click したとき、EPGStation フロントエンドは route
   change の前に drawer を閉じる。
7. viewport width が 1264px 以上の状態でユーザーが navigation item を click したとき、EPGStation フロントエンドは drawer
   open state を変更せずに route change を行う。
8. ユーザーが任意の viewport width で title bar から drawer を toggle したとき、EPGStation フロントエンドは toggle
   action に応じて drawer open state を更新する。
9. ユーザーが generic な「番組表」navigation item を click したとき、EPGStation フロントエンドは Guide
   route へ遷移し、navigation item 自体から `type`、`time`、`channelId` query parameter を追加しない。
10. ユーザーが broadcast-wave guide navigation item を click したとき、EPGStation フロントエンドは Guide
    route へ遷移し、click した item に対応する `type` query parameter を付与し、navigation item 自体から `time` や
    `channelId` query parameter は追加しない。
11. viewport width が 1264px 未満の状態でユーザーが navigation
    item を click したとき、EPGStation フロントエンドは drawer を閉じ、200ms の delay を置いてから route
    change を開始する。`client/src/app/appProps.ts` の `MOBILE_NAVIGATION_CLICK_DELAY_MS` を `200`（200ms）とする。
12. navigation item click による route change が実行されるとき、EPGStation フロントエンドは共通 route move
    behavior として route refresh 用 `timestamp` query parameter を付与する。
13. 共通 route move behavior では、同一 path かつ `timestamp`
    以外の query が同一の場合、EPGStation フロントエンドは不要な route push を実行しない。
14. selected navigation 判定では、`timestamp` など navigation item が定義していない query parameter を無視する。
15. Guide 内の day/time/channel selection によって `time` や `channelId` query
    parameter が追加または維持されるとき、その query parameter の決定は Guide 仕様の責務として扱う。
16. route boundary は direct URL、browser back/forward、screen-owned `navigate`、dialog/menu
    action のいずれで到達した場合でも、root route `/#/` 以外の routed URL に `timestamp` query parameter がない場合は
    `replace` で `timestamp` を付与する。
17. route boundary による `timestamp` 付与は scroll history key の安定化と route refresh のためだけに行い、`timestamp`
    を user-facing filter state、API request query、selected navigation の判定条件へ含めない。
18. route boundary が `timestamp` を補完するために `replace` するとき、React Router の `location.state`
    は維持する。screen-owned `navigate` が transient navigation state で UI side
    effect の抑止や復元条件を渡した場合、timestamp 正規化によって state が失われてはならない。
19. viewport width が 1263px 以下で temporary な navigation drawer を表示している間、ユーザーが drawer
    背後の scrim (backdrop) を click したとき、EPGStation フロントエンドは drawer を閉じる。
20. temporary な navigation drawer を表示している間、ユーザーが Escape キーを押下しても、EPGStation
    フロントエンドは drawer を開いたままにする。
21. ユーザーが navigation item 上で Space キーを押下したとき、EPGStation フロントエンドは
    Space キーによる既定のアクティブ化を抑止し、Enter
    キーによる既定のアクティブ化は抑止しない。
22. 本要求 AC16 の `timestamp` 補完 `replace` を適用する間、EPGStation フロントエンドは現在 mount
    済みの routed screen（`AppRoutes` 配下）を unmount / 再 mount しない。pagination、filter 変更、検索
    dialog の適用など `timestamp` を持たない screen-owned `navigate` を screen が local component state（録画/予約一覧の
    編集 mode や選択状態など）を保持したまま実行できるようにするためである。**根拠:** React は要素種別の切替時に前の
    subtree を unmount する。AppShellContent が routed screen（`AppRoutes` 配下）を別要素へ切り替えて unmount /
    remount すると、`client/src/features/recorded/requests/searchPath.ts` の `buildRecordedPageSearch`
    （`parameters.delete('timestamp')`）を経由する `RecordedPage.tsx` の pagination `goToPage` のような、`timestamp`
    を持たない screen-owned `navigate` のたびに録画一覧の編集 mode と選択状態が全 reset されてしまう。本 AC は
    routed screen を unmount / remount しないことでこれを防ぐ。

### 要求 6: Version 更新と接続状態

**目的:** EPGStation operator として、shell から version と connection state の変化を把握したい。これにより、application
freshness と reconnect behavior を確認できる。

#### 受け入れ条件

1. route が変更されたとき、EPGStation フロントエンドは selected navigation
   state を更新し、表示中の version 情報を refresh する。
2. application state update event を受信したとき、EPGStation フロントエンドは表示中の version 情報を refresh する。
3. version 情報を取得できないとき、EPGStation フロントエンドは error snackbar `バージョン情報取得に失敗`
   でユーザーへ通知する。
4. realtime connection が disconnected の間、EPGStation フロントエンドは full-screen disconnected overlay を表示する。
5. disconnected 後に realtime connection が restored したとき、EPGStation フロントエンドは Dashboard
   route を経由してから以前の full route を復元する。
6. disconnected 後に realtime
   connection が restored したとき、EPGStation フロントエンドは reconnect が完了したことをユーザーへ通知する。
7. route が変更されたとき、EPGStation フロントエンドは表示中 snackbar を閉じ、scroll history state を更新し、browser
   history restore ではない通常遷移では active page scroll container を `{ x: 0, y: 0 }` に戻す。
8. navigation drawer header には現在の version string を表示し、route change と application state update
   event 後の version refresh 結果を反映する。
9. realtime connection が disconnected したとき、EPGStation フロントエンドは `接続が切断されました`
   snackbar を表示する。
10. realtime connection restored は、過去に disconnected overlay を表示した後の socket connect 成功として扱う。
11. disconnected snackbar の timeout は通常 snackbar
    default に従い、永続表示に変更しない。永続表示へ変える場合は別の intentional change として扱う。
12. フロントエンド起動時の server configuration 取得に失敗したとき、EPGStation フロントエンドは error snackbar
    `設定ダウンロードに失敗しました` を timeout 5000ms で表示する。
13. Socket.IO の初期設定で socket instance を取得できないとき、EPGStation フロントエンドは error snackbar
    `SocketIO の初期設定に失敗しました` を表示する。
14. routed screen が scroll history を保存または復元するとき、EPGStation フロントエンドは shared scroll history
    contract を通じて
    `isNeedRestoreHistory`、`saveScrollData`、`getScrollData`、`updateHistoryPosition`、`emitDoneGetData`、`onDoneGetData`
    相当の API を提供する。
15. routed screen は data 取得と初期描画に必要な処理が終わった時点で scroll-data completion を通知し、App
    Shell は history restore の場合だけ保存済み scroll data と scroll position を復元する。
16. history restore の場合、EPGStation フロントエンドは対象 screen の data fetch と初期 DOM /
    renderer 準備が完了した後、user-visible content を表示完了扱いにする前に保存済み scroll
    position を適用し、通常位置で一度表示してから scroll する flicker を発生させない。この適用は、active page
    scroll container の位置が保存済み position と縦横とも 1px 以内で一致するまで `requestAnimationFrame` で再試行し、
    一致した時点、または再試行開始から `1200ms` が経過した時点のどちらか早い方で終了する。`1200ms` 経過による終了
    時も error やユーザー通知は出さない。
17. iOS / iPadOS の fixed shell では active page scroll container は `shell-main` とし、それ以外の環境では `window`
    を active page scroll container とする。route boundary の保存、通常遷移時の top reset、history restore の scroll
    position 適用は同じ active container に対して行う。
18. App Shell 起動中は browser native の `history.scrollRestoration` を `manual` にし、browser back /
    forward 時の scroll position 復元は App Shell の scroll history contract だけが行う。
19. iOS / iPadOS の fixed shell で visual viewport resize / scroll / orientation
    change が発生したとき、EPGStation フロントエンドは `window`、`documentElement`、`body` の外側 scroll
    position を 0 に clamp し、title bar 上の余白や routed content 末尾の見切れを残してはならない。
20. iOS / iPadOS の fixed shell で、`shell-main` 内外に描画される fixed button / link /
    role=button の touchmove は document rubber-band に渡さず、active page scroll container を `shell-main`
    に限定する。Rule の `+` button や Search の `^` button を長押しして上下へ drag しても title
    bar 上の余白を再表示してはならない。
21. iOS / iPadOS の fixed shell では、EPGStation フロントエンドは `html.fix-address-bar2` 自体を `position: fixed`
    にしてはならない。root layer の固定化で Stage Manager resize 後に shell 全体が visual
    viewport 上端からずれる状態を禁止する。
22. disconnected 後に realtime connection が restored したとき、EPGStation フロントエンドは routed
    screen が保持する server state query を再検証し、表示中のデータを最新化する。
23. フロントエンド起動時の bootstrap channel 情報取得に失敗したとき、EPGStation フロントエンドは version
    と server configuration の初期解決を妨げずに、失敗内容を console error として記録する。
24. snackbar を表示している間に別の snackbar を表示するとき、EPGStation フロントエンドは後から表示した snackbar
    を、前の snackbar の残り時間ではなく自身の `timeout` の間表示する。前の snackbar の自動消去が、後から表示した
    snackbar を閉じたり、表示される前に取り消したりしてはならない。たとえば、切断の約 1 秒後に再接続した場合も
    `再接続されました` を `timeout` の間表示する。

### 要求 7: dark theme shell coverage

**目的:** dark theme で shell と routed screen の contrast と control 契約を保つ。

#### 受け入れ条件

1. dark theme の navigation drawer、title bar、settings navigation icon、material icon
   fallback は背景と同化しない contrast を維持する。navigation drawer は open state で検査し、navigation
   label、icon、`::before` / `::after` 由来の pseudo icon、selected item foreground が dark
   surface と同化しないことを保証する。
2. routed screen の dark theme は App Shell の `data-theme-mode='dark'` を起点に適用し、main content 内だけ light
   theme の背景が残らないようにする。
3. dark theme coverage の static
   regression は settings、rule、search、reserves、guide、recorded、recording、encode、onair、storages、playback、pagination を対象に含める。
4. dark theme の shell token は `pageBackground=#121212`、`chromeSurface=#1e1e1e`、`contentSurface=#1e1e1e` を実 MUI
   theme の `background.default`、`background.paper`、Drawer/Menu/Dialog/Card paper に反映し、灰色 surface を維持する。`mode: dark` の default black surface だけに委譲してはならない。
5. dark theme の `data-theme-mode='dark'` は routed main content の親だけでなく `body` へも同期し、MUI
   Menu/Dialog/Popover など body 配下へ portal される UI の CSS module dark override が失効しないようにする。
6. App Shell theme は MUI Select/Input/TextField/Autocomplete と `<input>` / `<textarea>` に light/dark
   theme を適用する。routed screen は raw native `<select>` を直接描画してはならず、全 select/combobox は MUI `Select` /
   `TextField select` / shared `AppSelect` / Autocomplete を通す。dark theme では routed
   screen、dialog、menu、portal 内の全 select/combobox が `textPrimary` / `textSecondary` / `chromeSurface`
   または継承先 surface を使い、black foreground、white background、native `color-scheme: normal` を残してはならない。
7. dark theme coverage は MUI `Card` component だけでなく、CSS module で card 相当の surface を作る全 routed
   owner を対象にする。少なくとも Dashboard section、Settings card、Search card、Search result item、Search rule option
   card、Rule item、Reserve card、Manual Reserve option/time card、Recorded list item、Recording row/card、Encode
   item、OnAir card、OnAir watch info card、Recorded watch info card、Storage item を個別に検査する。
8. card 相当 UI は dark theme で white paper fallback に落ちてはならず、暗い surface 上の visible
   text/icon/control は black foreground を残してはならない。ただし MUI theme が意図的に明るい filled control
   surface を使う場合は、その control 自身の background と foreground の組み合わせで判定し、親 card
   surface の検査と混同しない。
9. App Shell snackbar は light/dark theme のどちらでも message と action
   text を白文字で表示する。severity ごとの背景色は維持し、dark theme で snackbar text が black foreground や theme
   default text color へ戻ることを regression failure とする。
10. 全 routed owner の dropdown/select/combobox は、Android/iOS/desktop の open
    state で先頭に選択不能な空白 item を表示してはならない。未選択値や fallback 値が必要な場合でも、visible
    option/MenuItem には user-visible label を持たせるか、hidden fallback として menu/listbox から除外する。
11. dark theme coverage は table 表示を card 相当 UI とは別枠で扱い、Reserves、Recorded、Recording など routed
    owner の table container、thead、row、cell、menu column を個別に検査する。table surface / row は white
    fallback に落ちてはならず、th/td/button/icon の foreground は dark surface 上で black
    foreground を残してはならない。table dark regression は CSS module 横断検索だけでなく computed style
    E2E で確認する。
12. 通常の checkbox control は MUI `Checkbox` を正とし、routed owner が raw `<input type="checkbox">`
    を直接描画してはならない。例外は `role="switch"` を持つ switch
    control だけとし、switch は checkbox ではなく switch visual contract で検査する。native
    checkbox の残存は静的検査で failure とする。
13. routed owner の user-editable text-like control は  clear action を持つ。MUI `TextField`
    の非 select text/datetime/number/multiline は shared `ClearableTextField` owner を使い、raw text
    input は field 右端または同一 label 内に clear button を持つ。file input、range
    slider、switch/checkbox、select/combobox、Autocomplete 内部 input はこの対象外とする。対象外でない text
    input の clear action 欠落は静的検査で failure とする。

### 要求 8: 共有 form control と静的 guard

**目的:** EPGStation ユーザーとして、共有 form control (`AppSelect`、`ClearableTextField`、`AppPagination`、`LegacyPagination`、`ExtendedPagination`)
が一貫した挙動を持ち、native control や崩れた option 表示が紛れ込まないでほしい。これにより、画面ごとに再実装された
select/checkbox/pagination の挙動差異が発生しない。

#### 受け入れ条件

1. `AppSelect` の解決済み値が配列で複数件あるとき、EPGStation フロントエンドは対応する option label をカンマ区切りで結合して表示する。
2. `AppSelect` の解決済み値がすべて空で、空 option 用の label が定義されているとき、EPGStation フロントエンドはその空 option label を表示する。
3. `AppSelect` の解決済み値が空で、空 option 用の label が定義されていないとき、EPGStation フロントエンドは他 option の label を表示せず空文字として扱う。
4. `AppSelect` の clear button が操作されたとき、EPGStation フロントエンドは呼び出し元の clear handler を呼び出す。
5. `AppSelect` の option は自身の disabled flag が設定されている場合だけ選択不能として表示し、他 option の disabled 状態に影響しない。
6. window が存在しない環境 (server-side render) で `LegacyPagination` を描画するとき、EPGStation フロントエンドは desktop
   pagination layout にフォールバックする。
7. document が存在しない環境 (server-side render) で `LegacyPagination` を描画するとき、EPGStation フロントエンドは
   `document.documentElement.clientWidth` を参照せずに描画を完了する。
8. viewport width の解決元がすべて利用できないとき、EPGStation フロントエンドは `LegacyPagination` を default の desktop
   layout で表示する。
9. mobile layout 幅で `LegacyPagination` の現在ページが一覧の先頭付近にあるとき、EPGStation フロントエンドは表示 page
   window を先頭付近に維持する。
10. mobile layout 幅で `LegacyPagination` の現在ページが一覧の末尾付近にあるとき、EPGStation フロントエンドは表示 page
    window を末尾付近に維持する。
11. total が 1 page 以内のとき、EPGStation フロントエンドは `LegacyPagination` を表示しない。
12. viewport width が mobile 幅の閾値未満のとき、EPGStation フロントエンドは `LegacyPagination` を ellipsis なしの
    mobile layout で表示する。
13. `visualViewport` の width が `window.innerWidth` より狭いとき、EPGStation フロントエンドは `LegacyPagination` の
    layout 判定に `visualViewport` の width を優先する。
14. `LegacyPagination` の現在ページが一覧末尾付近の desktop layout のとき、EPGStation フロントエンドは ellipsis
    cluster を表示する。
15. `LegacyPagination` の現在ページが一覧中央付近の desktop layout のとき、EPGStation フロントエンドは前後 2 箇所の
    ellipsis cluster を表示する。
16. viewport width が変化したとき、EPGStation フロントエンドは `LegacyPagination` の表示 page 一覧を再計算する。
17. routed screen は native `<select>` 要素を直接描画してはならない。
18. `TextField`/`Select` を用いる select owner (`AppSelect` 自身を除く) は、共有 menu height 上限
    (`appSelectMenuProps` 相当) を適用する。
19. `AppSelect` は owner が指定した幅 (`wrapperClassName` 未指定時は 100%) を維持し、固定 `minWidth` を持たない。
20. `AppSelect` の owner class は clear button を包む wrapper ではなく MUI field 自身に適用する。
21. `AppSelect` の表示値は MUI theme を置き換えずに垂直中央揃えとし、clear 機能を維持する。
22. `ClearableTextField` の clear adornment は field の高さに対して垂直中央揃えで表示する。
23. routed screen の CSS は native select 用 overlay スタイルを残してはならない。
24. dropdown/select の visible option には空 label の選択可能な option を表示してはならない。
25. dropdown/select の visible option に field name (`channel`、`ジャンル` など) をそのまま placeholder として
    表示してはならない。
26. MUI select owner の CSS は手動描画された dropdown 矢印装飾を残してはならない。
27. routed screen は `role="switch"` を持つ switch control 以外で native `<input type="checkbox">` を直接
    描画してはならない。
28. `Checkbox` (MUI) を使う owner は既知の一覧に限定し、checked 状態の色は primary color を使う。
29. 非 select の text-like input owner は `ClearableTextField` または隣接する clear action を持つ raw input の
    いずれかを使う。
30. 全 route の Japanese program title 表示は Android Chrome 上で bold 相当の fallback glyph を合成描画できるよう、
    `font-synthesis: weight` を維持し `font-synthesis: none` を指定しない。
31. 共有 dialog（`RecordedPlainDialog`）の owner は MUI dialog の transition を無効化してはならない。禁止する実装手段の例として `transitionDuration={0}` の指定などが挙げられる。
32. `/reserves/manual` の add mode option panel（ディレクトリ・ファイル名形式・エンコード1〜3）に並ぶ
    `TextField`/`Select`（`AppSelect`、`ClearableTextField` を含む）の form control wrapper は、helper text
    や error text を表示していない field でも、helper text 分の下部余白を確保した高さで描画する。field
    ごとの縦密度は helper text の有無によらず一定に保つ。この余白確保は上記 option panel の field に
    限定し、他の routed form や dialog 内の field には適用しない。
33. `ExtendedPagination` は総 page 数 `ceil(total / pageSize)` が 1 以下（`total` が `pageSize` 以下）のとき何も表示しない。それ以外のとき `<nav aria-label="ページ">` に、先頭 page へ移動する `≪` button（accessible name `最初のページへ移動`）、page 番号 button、最終 page へ移動する `≫` button（`最後のページへ移動`）をこの順に 1 段で並べる。`≪` `≫` は MDI の chevron-double glyph で描く。
34. page 番号 button の accessible name は `ページ<n>へ移動` とし、押すとその page 番号で `onPageChange` を呼ぶ。現在 page の button は `aria-current="page"` を持ち、accessible name は `ページ数を入力して移動` とする。現在 page が先頭のとき `≪` を、最終 page のとき `≫` を disabled にし、押しても `onPageChange` を呼ばない。`≪` は page 1、`≫` は最終 page で `onPageChange` を呼ぶ。
35. 表示する要素数（`≪` と `≫` を含む）は 7 / 9 / 11 / 13 / 15 / 17 の 6 段階とする。`<nav>` の実測幅（`ResizeObserver`）を、button 1 個の実測幅と左右の余白の合計に要素数を掛けた値で割り、収まる最大の段階を選ぶ。1 段階ずつ増やすため、左右に 1 個ずつ足せない幅では増やさない。7 個が収まらない幅でも 7 個を下限とし、幅の測定前も 7 個とする。端末幅やソフトウェアキーボードの高さの固定値は使わない。
36. 総 page 数 + 2 が選んだ要素数より小さいとき、存在する page の番号だけを表示する（要素数は総 page 数 + 2）。
37. 現在 page を page 番号の並びの中央に置く。先頭または最終 page に近く片側が足りないときは、足りない分を反対側へずらして page 番号の個数を保ち、存在しない page 番号（1 未満・最終 page 超）を表示しない。
38. 現在 page の button は `transform: scale(1.1)` で拡大する。拡大は `transform` だけで行い、button の幅・余白を他の button と同じに保つため、隣の button の位置は動かない。配色は 48 に従い、dark theme でも現在 page は他の button と区別できる。
39. 現在 page の button を押すと `ページ数を入力` dialog を開く。dialog は `ページ数` の text field（placeholder `1 〜 <最終 page>`、`inputMode="numeric"`、`ClearableTextField`）、`キャンセル`、`移動` button を持つ。dialog は開くたびに入力欄を空にして入力欄へ focus する。
40. dialog の入力が空欄、0、負数、小数、数字以外（全角数字・指数表記を含む）、最終 page 超のいずれかのとき、`移動` を押しても Enter を押しても page を移動せず、1 や最終 page へ丸めず、dialog を開いたまま `1 〜 <最終 page> の整数を入力してください` を表示する。入力を変えるとこのメッセージを消す。
41. dialog の入力が 1 以上最終 page 以下の整数（先頭の 0 を含んでよい）のとき、`移動` または入力欄での Enter（IME の変換を確定する Enter を除く）で dialog を閉じ、その page 番号で `onPageChange` を呼ぶ。Enter は keydown の既定動作を取り消し、dialog を閉じて focus が戻った現在 page の button を、同じ Enter が続けて押して dialog を開き直すことがないようにする。入力が現在 page と同じときは dialog を閉じるだけで `onPageChange` を呼ばない。`キャンセル` と dialog 外の click（Esc を含む）は dialog を閉じ、`onPageChange` を呼ばない。
42. `window.visualViewport` が使える環境では、dialog が開いている間だけ `visualViewport` の `resize` と `scroll` を購読し、可視領域の高さと `offsetTop` から dialog を可視領域の中央に置き、dialog の高さ上限を可視領域の高さ - 24px にする。キーボードの高さは `window.innerHeight` と `visualViewport.height` の差から求める。dialog を閉じている最中は位置を動かさず、閉じたら購読を解除する。
43. dialog の入力欄が focus を得て 300ms 後に入力欄が可視領域の外にあるときは、入力欄を `scrollIntoView({ block: 'nearest' })` で可視領域へ入れる。dialog が閉じていれば何もしない。
44. `window.visualViewport` が無い環境では、画面幅が 600px 以下のとき dialog を画面上端寄せ（上の余白 12px）にし、600px を超えるときは中央に置く。dialog の高さは `100dvh - 24px` を上限とする。
45. 入力 dialog の開閉は 150ms のフェードで、拡大・縮小の動きを持たない。
46. `ExtendedPagination` は 320px から 1920px までのどの viewport 幅（touch 端末の設定を含む）でも、`<nav>` と document の横幅を viewport より広げない。また `<nav>` の下に 72px の余白を持ち、画面右下に固定表示される操作 button（Rule list の追加 button）の上まで scroll でき、最終 page まで scroll した状態でどの button もこの固定 button に覆われない。
47. `<nav>` の幅は内容の幅に引きずられず、親の幅に従う（`min-width: 0`）。viewport を広い幅から狭い幅へ変えても、実測幅が追従して要素数が減る。`LegacyPagination` が 1 行に収まり、はみ出さず、document の横幅を viewport より広げずに表示できる最小の viewport 幅（実測 328px）を、`ExtendedPagination` は下回らない。つまり 328px 以上のすべての幅で、先頭・中間・最終のどの page でも、要素が 1 行に並び、重ならず、`<nav>` と document の横幅が viewport を超えない。最小の 7 要素（280px）が入らない幅では、要素数を 7 より減らさずに 7 個を表示する（その幅は viewport 298px 未満であり、`LegacyPagination` も 328px 未満で崩れるため、比較の対象外とする）。
48. `LegacyPagination` と `ExtendedPagination` の button の配色は、同じ規則（共通の CSS module）で定め、v2（Vuetify 2.7.0 の `v-pagination`、既定の theme）と同じにする。大きさ・余白・並べ方・個数の規則・拡大は配色に含めず、それぞれの規則に従う。値は計算された style で次のとおりとする。
    - page 番号 button（現在 page 以外）: light theme は背景 `#FFFFFF`・文字 `rgba(0, 0, 0, 0.87)`、dark theme は背景 `#1E1E1E`・文字 `#FFFFFF`。影は `0 3px 1px -2px rgba(0,0,0,0.2), 0 2px 2px 0 rgba(0,0,0,0.14), 0 1px 5px 0 rgba(0,0,0,0.12)`。
    - 現在 page の button: light/dark theme のどちらでも背景 `#1976D2`（v2 の既定 theme の primary。v3 の dark theme の primary `#90caf9` ではない）・文字 `#FFFFFF`。影は `0 2px 4px -1px rgba(0,0,0,0.2), 0 4px 5px 0 rgba(0,0,0,0.14), 0 1px 10px 0 rgba(0,0,0,0.12)`。dark theme でも塗りと文字色を失わない。
    - 矢印 button（`≪` `≫` `<` `>`）: 背景と影は page 番号 button と同じ。icon の色は light theme が `rgba(0, 0, 0, 0.54)`、dark theme が `#FFFFFF`。
    - 押せない矢印 button: 背景・icon の色・影は押せるときと同じで、`opacity: 0.6` にする（色を変えない）。
    - `LegacyPagination` の ellipsis の文字色は、light theme が `rgba(0, 0, 0, 0.87)`、dark theme が `#FFFFFF`。
49. 共有 component `AppPagination`（`client/src/shared/AppPagination.tsx`）は、`page`、`pageSize`、`total`、`onPageChange` と設定 `isEnableExtendedPagination` を受け取り、`isEnableExtendedPagination` が `true` のときだけ `ExtendedPagination`（8.33-8.47）を、それ以外（既定の `false` を含む）のとき `LegacyPagination` を、同じ `page`、`pageSize`、`total`、`onPageChange` で描画する。ページ送りを持つ画面（録画済み・録画中・予約・ルール一覧。検索結果と encode 一覧はページ送りを持たない）は `LegacyPagination` や `ExtendedPagination` を直接描画せず、この component だけを使う。拡張・従来の選択は画面ごとの分岐ではなくこの 1 か所で行い、どちらの場合も各画面の page、総数、page size、URL の `?page=` 更新、移動の処理は変えない。設定が `false` のときの各画面の表示は、この component を使う前と同じにする。見た目（配色・大きさ・余白）は `ExtendedPagination` と `LegacyPagination` それぞれの規則（8.1-8.48）のままで、`AppPagination` 自身は余分な要素や余白を足さない。
