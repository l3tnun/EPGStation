# Visual Cases: アプリケーションシェルとナビゲーション

## 目的

App Shell の visual regression は、全画面共通の drawer、title bar、main content offset、theme、connection
feedback が routed screen に依存せず安定することを検証する。

## 共通条件

- geometry assertion と e2e の fixture は synthetic server configuration と synthetic settings から作る。画素比較の screenshot は持たない。
- test の fixture と添付を含む tracked artifact に、実 URL、実番組名、実ロゴ、サムネイル、認証情報、Mirakurun
  URL、ffmpeg / ffprobe 実 path、環境固有値を含めない。
- routed screen body は App Shell visual case 用の synthetic placeholder
  screen を使い、各 feature の本体 layout は該当 feature spec の visual cases に委譲する。
- geometry assertion は `design.md` の Visual Implementation Contract にある token、typography、layout
  token を実装可能な正本として扱う。token 名だけ一致して色・寸法が違う場合は failure とする。

## Layout Cases

| Case                             | Route / State                                                         | Viewport                                 | Mock Dataset                                                                                       | Visual invariant                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shell-desktop-open               | `/`、user toggle なし、drawer default open                            | 1440x900                                 | `serverConfigFull`, `settingsDefault`                                                              | drawer が左に固定表示され、main content は drawer 右端から始まる。title bar は content 幅内に収まり、selected navigation は Dashboard を示す。                                                                                                                                                                      |
| shell-desktop-drawer-overflow    | `/`、drawer default open、navigation item が viewport height を超える | 1264x360                                 | `serverConfigFull`, `settingsGuideNavigation`                                                      | permanent drawer は横スクロールを出さず、drawer 内だけが縦方向にスクロール可能。body / main content に drawer 由来の横スクロールを出さない。                                                                                                                                                                        |
| shell-tablet-closed              | `/recorded`、user toggle なし                                         | 1024x768                                 | `serverConfigFull`, `settingsDefault`                                                              | drawer は default closed、main content に drawer 分の左余白を持たない。title は routed screen 由来で表示される。                                                                                                                                                                                                    |
| shell-mobile-overlay             | `/guide`、drawer open                                                 | 390x844                                  | `serverConfigFull`, `settingsGuideNavigation`                                                      | drawer は overlay として main content 上に表示され、navigation item 選択前に drawer width による content shift を起こさない。                                                                                                                                                                                       |
| shell-navigation-minimal         | `/onair`                                                              | 1440x900                                 | `serverConfigMinimal`, `settingsHideWaveGuide`                                                     | 放送波ごとの番組表 item が描画されず `番組表` 1 つになり、item は `ダッシュボード`、`放映中`、`番組表`、`録画中`、`録画済み`、`エンコード`、`予約`、`競合`、`重複`、`検索`、`ルール`、`ストレージ`、`設定` の順に並び、`放映中` が selected になる。                                                                |
| shell-dark-theme                 | `/settings`、dark theme resolved                                      | 1440x900                                 | `serverConfigFull`, `settingsDarkTheme`                                                            | drawer、title bar、main content background、snackbar が dark theme として一貫し、文字と icon の contrast が保たれる。                                                                                                                                                                                               |
| shell-dark-drawer-open-device    | `/`、dark theme resolved、navigation drawer open                      | Android Chrome / iOS Safari              | `serverConfigFull`, `settingsDarkTheme`                                                            | 実 device の drawer open state で navigation label、icon、pseudo icon、selected/hover/focus 相当の foreground が dark surface と同化しない。                                                                                                                                                                        |
| shell-dark-routed-matrix         | major routed screens dark theme                                       | 1440x900                                 | `serverConfigFull`, `settingsDarkTheme`, routed screen fixtures                                    | Settings/Search/Rule/Reserves/Guide/Recorded/Recording/Encode/OnAir/Storages/Upload/Playback の main content、icon、pagination、dialog/menu portal、select/combobox が dark theme として表示される。                                                                                                                |
| shell-dark-card-owner-matrix     | card-like routed owner surfaces dark theme                            | 1440x900 + mobile card breakpoints       | `serverConfigFull`, `settingsDarkTheme`, routed owner fixtures                                     | Dashboard section、Settings card、Search card/result/rule-option、Rule item、Reserve card、Manual Reserve option/time card、Recorded card、Recording table/card、Encode item、OnAir card/watch info、Recorded watch info、Storage item が white surface fallback や dark surface 上の black foreground を残さない。 |
| shell-dark-table-owner-matrix    | table routed owner surfaces dark theme                                | 1440x900                                 | `serverConfigFull`, `settingsDarkTheme`, `settingsTableMode`, reserves/recorded/recording fixtures | Reserves table、Recorded table、Recording table の container、header、row、cell、action cell が dark surface token を使い、white fallback と black foreground を残さない。                                                                                                                                          |
| shell-select-empty-option-matrix | routed select/combobox open state                                     | Android Chrome + desktop                 | `serverConfigFull`, routed select fixtures                                                         | 全 routed owner の MUI Select / TextField select / AppSelect / Autocomplete は open state で先頭に空白の選択不能 item を出さず、未選択 placeholder も user-visible label または hidden fallback として扱う。raw native `<select>` は静的検査で failure とする。                                                     |
| shell-version-reconnect          | 任意 route、reconnect snackbar                                        | 1440x900                                 | `serverConfigFull`, `settingsDefault`, `socketReconnect`                                           | reconnect feedback が snackbar として表示され、title bar や navigation item を押し出さない。                                                                                                                                                                                                                        |
| shell-ios-fixed-viewport-clamp   | `/search` と `/rule`、fixed shell、viewport resize 後                 | iOS Safari / iPadOS Safari Stage Manager | `serverConfigFull`, `settingsDefault`, search/rule fixtures                                        | `html.fix-address-bar2` 自体を fixed layer にせず、visual viewport resize 後も title bar 上に空白を残さない。`window` / `documentElement` / `body` の scroll position は 0。Search の `^` button と Rule の `+` button を長押しして上下へ drag しても document rubber-band による外側 scroll が発生しない。         |

## Interaction / Geometry Cases

- viewport を 1263px から 1264px へ変更したとき、user-toggled state がない場合だけ drawer default
  open/closed が切り替わる。
- mobile 幅で navigation item を click したとき、route change 前に drawer が閉じ、main content
  offset が 0 のまま維持される。
- desktop 幅で navigation item を click したとき、drawer open state と main content offset は維持される。
- Settings 保存後の navigation regeneration request で item list が再生成されても、selected item と title
  bar の高さが layout shift しない。
- drawer width は desktop fixed case で 256px とし、main content offset は drawer open state と一致する。
- permanent drawer は desktop fixed case で paper を `overflow-x:hidden` / `overflow-y:hidden`、drawer content を
  `overflow-x:hidden` / `overflow-y:auto` とし、item label が長い場合も drawer content の `scrollWidth <= clientWidth`
  を維持し、paper の `scrollLeft` が動かない。viewport height が小さい場合は drawer content の `scrollTop`
  が変化し、page body や main content ではなく drawer 内で navigation 全体を閲覧できる。
- root route `/#/` 以外の screen-owned navigation、menu action、dialog action、direct URL normalization の URL
  assertion は `timestamp` query を含むことを正とする。filter query の一致確認では `timestamp` を user-facing filter
  state として扱わず、末尾に `timestamp=<digits>` が付与されることを検証する。
- timestamp 補完による `replace` 後も React Router `location.state` が維持されることを route handoff
  test で確認する。rule edit handoff は auto-scroll 抑止 state を使わず、`/search?rule=<id>`
  の初期 scroll は SearchRule の settings のみで決まる。
- iOS / iPadOS fixed shell は visual viewport の resize / scroll / orientation change 後に外側 scroll を 0 に戻す。Stage
  Manager で tablet/mobile 幅を往復した後、title bar の上端は visual viewport 上端と一致し、Search の `^`
  button や Rule の `+` button を hold-drag しても `window.scrollY`、`documentElement.scrollTop`、`body.scrollTop`
  が増えないことを確認する。
- snackbar は bottom placement の newest-visible contract とし、複数 request は `snackbarRequests.order`
  に従う。snackbar は title bar、drawer、routed content を押し出さない。light/dark theme の両方で message と `閉じる`
  action は白文字で表示し、dark theme text token や black foreground に戻った場合は failure とする。
- disconnected overlay は centered message、scrim、focus trap なしの visual contract とする。message 文言は synthetic
  fixture の `connectionState` で決め、実 host や endpoint を表示しない。
- icon-only controls と Settings navigation icon / Material Symbols fallback は dark theme でも foreground
  token を使い、background と同化しないことを contrast assertion で確認する。
- navigation drawer は closed route の確認だけでは確認済みにしない。desktop/mobile/device の drawer open
  state を作り、visible text、navigation icon、`::before`/`::after` icon glyph、selected item foreground を computed
  style / contrast assertion で確認する。
- dark theme の drawer、menu/dialog paper、card は `chromeSurface=#1e1e1e` を computed style で確認し、pure
  black や light surface になっていないことを failure とする。
- Menu/Dialog/Popover の portal open state は `body[data-theme-mode='dark']` 起点の dark override が適用され、routed
  main content の外に出ても text/icon/pseudo icon contrast が落ちないことを確認する。
- select/combobox は MUI Select、MUI TextField select、shared AppSelect、Autocomplete の全形式を検査し、open
  menu/listbox は最大 4.5 item 分、216px を超えてメインコンテンツいっぱいに伸びないことを確認する。routed owner の raw
  native `<select>`、dark theme の black foreground、white background、native `color-scheme: normal`
  が残る場合は failure とする。最低対象は Settings、Search、Guide setting/time selector、Recorded upload、Manual
  Reserve、Recorded detail streaming/add encode dialog とする。
- checkbox は MUI `Checkbox` root を持つことを DOM/static assertion で検査し、raw `<input type="checkbox">` は
  `role="switch"` の場合だけ許容する。Search、Guide ProgramDialog、Recorded、Manual Reserve、Recording edit、Reserves
  edit の checked/unchecked/disabled/focus state を操作し、dark theme でも check mark、label、disabled
  state が background と同化しないことを確認する。
- text-like field は static inventory で `TextField` 非 select、raw text
  input、datetime/number/multiline を抽出し、Search/Rule、Settings URL Scheme、Recorded search/add encode/upload、Manual
  Reserve の代表 interaction で non-empty 時の clear button と押下後の value clear を確認する。file input、range
  slider、select/combobox、Autocomplete 内部 input は対象外として inventory に理由を残す。
- card-like surface は MUI `Card` component に限定せず、CSS module の
  `.card`、`.item`、`.section`、`.infoCard`、`.manualOptionsCard`、`.manualTimeReserveCard`、`.recordingTableCard`、`.recordingCard`、`.storageItem`
  など user-visible grouped surface を route owner ごとに inventory し、inventory にない card-like
  UI を「確認済み」として扱わない。
- table surface は card-like surface の代表確認で済ませず、Reserves / Recorded / Recording の table mode を forced
  settings と desktop viewport で開き、table container、thead、tr、td/th、menu/action cell を computed
  style で検査する。SPA 遷移中の localStorage 変更だけで table/dark 設定を変えた検査は invalid とする。
- 色の assertion は、dark theme の `data-theme-mode`、CSS module の dark override を `unittest/spec/appShell.theme.spec.test.tsx` が、MUI theme の `background.default`・`background.paper` の値を `unittest/imp/appShell.themeDocument.imp.test.ts` が確認し、navigation drawer・menu・dialog・card・table の contrast と surface を `e2e/dark-ui-*.spec.ts` が computed style で確認する。token の論理名ごとの値の assertion は持たない。
- layout assertion は drawer 256px と main の offset、light/dark の title bar を `visual/app-geometry.spec.ts` が確認する。typography の寸法は assertion に持たない。
