# Visual Cases: 番組表

## 目的

Guide の visual regression は、large grid、scroll sync、program cell geometry、reserve / genre / visibility class、dialog/menu、mobile layout が React shell と `GuideGridRenderer` の境界を越えて安定することを検証する。

## 共通条件

- geometry assertion と screenshot は synthetic schedule / reserve / genre / settings dataset から生成する。画素比較の screenshot は `guide-dense-grid`、`guide-program-dialog`、`guide-program-dialog-dark` の 3 件だけで、ほかの case は geometry / computed style の assertion で検査する。
- 実 screenshot、実番組名、実 URL、実ロゴ、実サムネイル、認証情報、Mirakurun URL、ffmpeg / ffprobe 実 path、環境固有値を tracked artifact に含めない。
- program cell DOM は React component tree ではなく `GuideGridRenderer` が所有する前提で、geometry assertion を必須とし、上記 3 件には screenshot visual regression を加える。
- `design.md` の Visual Implementation Contract にある grid variable、program cell density、ProgramDialog padding/surface を screenshot / geometry assertion の正本にする。

## Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| guide-dense-grid | `/guide?time=26050410` | 1440x900 | `guideDenseSchedule` | channel header、time scale、program grid、current timeline が表示され、5 分番組と長時間番組が同じ time scale 上で重ならず配置される。 |
| guide-single-channel | `/guide?channelId=101&time=26050410` | 1440x900 | `guideSingleChannelSchedule` | header は channel header ではなく日付 header として表示され、channel header click 用 stream dialog entry は表示されない。 |
| guide-reserve-states | `/guide?time=26050410` | 1440x900 | `guideReserveStates` | no reserve、manual、rule、conflict、skip、overlap の visible decoration が区別でき、state priority が安定する。 |
| guide-genre-hidden | `/guide?time=26050410`、genre 0/7 hidden | 1440x900 | `guideDenseSchedule`, `guideGenreHidden` | hidden genre program は DOM index と geometry と click target を維持し、light theme では background `#f8f8f8` / text `#888` の muted cell として表示される。`visibility:hidden`、`display:none`、DOM removal で完全不可視にしてはならない。 |
| guide-program-dialog | program selected | 1440x900 | `guideProgramDialogStates` | ProgramDialog は max width 500、metadata、description、extended、状態別 action を表示し、dialog close/remount で選択 UI が残らない。 |
| guide-program-dialog-dark | program selected, dark theme | 1440x900 | `guideProgramDialogStates`, `settingsDarkTheme` | ProgramDialog の paper、metadata、sub text、description、extended、footer/action area、checkbox label、checkbox checked mark、encode select underline/arrow/text、divider が dark theme として一貫し、文字と icon が背景と同化しない。 |
| guide-program-cell-top-align | `/guide?time=26050410` | 1440x900 | `guideDenseSchedule` | 各 program cell は content を上揃えにし、最初の可視子要素が cell 上端から 6px 以内に収まる。余白のある番組でも native button layout の中央寄せにならない。 |
| guide-dark-genre-palette | `/guide?time=26050410`, dark theme | 1440x900 | `guideDenseSchedule`, `settingsDarkTheme` | program cell は 次の dark palette を使い、ctg-0..11 は `#40b6bd`, `#97a039`, `#59b1c7`, `#d88686`, `#7fa534`, `#cf56a1`, `#d85b2a`, `#eb8242`, `#515585`, `#83a993`, `#2c7873`, `#46b3e6`、ctg-12..15/empty は `#445165`、hidden genre は `#272121` / text `#888` になる。 |
| guide-dark-open-states | `/guide?time=26050410`, dark theme, main menu / genre dialog / time selector open | 1440x900 | `guideDenseSchedule`, `settingsDarkTheme` | drawer ではなく Guide 固有の main menu、genre dialog、time selector、grid、channel header、time scale、switch、select、icon、portal surface を確認する。grid cell は dark genre palette（ctg-0..11 は `#40b6bd`, `#97a039`, `#59b1c7`, `#d88686`, `#7fa534`, `#cf56a1`, `#d85b2a`, `#eb8242`, `#515585`, `#83a993`, `#2c7873`, `#46b3e6`、ctg-12..15/empty は `#445165`）を維持し、generic contrast gate ではなく色一致を検査する。time scale の `time-0..23` は `--guide-time-bg-0..23`（dark theme でも上書きしない）を使い、文字色は全 24 時間で `--guide-time-scale-text: #fff` に統一される。 |
| guide-setting-dark | `/guide/setting`, dark theme | 1440x900 | `settingsDarkTheme`, `guideSizeSetting` | setting route は `.guidePage` subtree 外でも dark surface `#1e1e1e`、明色 text、visible MUI/AppSelect combobox、select icon / underline を維持し、白い card や透明 select text を出さない。 |
| guide-reserve-action-reflect | no reserve program reserved from ProgramDialog | 1440x900 | `guideReserveActionReflect` | reserve action 成功後、dialog が閉じ、同一 schedule DOM の対象 program に reserve decoration が即時反映される。schedule grid は再取得 failure 表示へ置き換わらない。 |
| guide-stream-dialog | full guide channel header selected | 1440x900 | `guideStreamChannels` | LiveStreamSelectDialog は On Air owner contract を使い、Guide 由来の `番組表 ` button が表示される。 |
| guide-mobile | `/guide?time=26050410` | 390x844 | `guideDenseScheduleMobile` | mobile size variables が適用され、program text、time scale、channel/date header が重ならず、drawer overlay による grid width 破壊がない。 |
| guide-ios-fixed-shell-viewport | `/guide?type=GR&time=26050410` | iOS Safari / 390x844 | `guideDenseScheduleMobile` | `html.fix-address-bar2` で App Shell が `--app-viewport-height` を使い、Guide page 下端が `shell-main` 可視領域からはみ出さない。`fix-address-bar` は Guide が追加せず、`shell-main.scrollHeight <= shell-main.clientHeight + 1` を維持する。 |
| guide-scroll-sync | `/guide?time=26050410` scrolled | 1440x900 | `guideDenseSchedule` | program grid scroll に対して channel header scrollLeft と time scale scrollTop が同期する。 |
| guide-edge-scroll-normalization | `/guide?time=26050410`, `guideMode=minimum`, edge scroll sequence | Android Chrome / iOS Safari / 390x844 | `guideDenseScheduleMobile`, minimum Guide size | 上端、右端、最下部、左端の順に scroll しても visible range 内の program cell が欠落しない。端部 bounce / fling / CSS pixel rounding の raw scroll value は content bounds へ clamp され、visibility update が破棄されない。 |
| guide-menu-selectors | day/time/main menu open | 1440x900 | `guideSelectorStates` | 8 日 selector、0-23 hour selector、GR/BS/CS/SKY order（`guideSelectorStates` は `BS4K` を含まない既存 fixture のため、snapshot は変わらない）、main menu items が重ならない。 |
| guide-loading-error-empty | loading/error/empty | 1440x900 | `guideStateVariants` | loading の scrim と円形 progress（title bar と channel header を動かさない）、error snackbar、empty blank presentation（scrim と progress が無い）が grid geometry を壊さない。 |

## Geometry Assertion Cases

- `programCell.left` は channel index と `channelWidth` から決まり、scroll position によらず content coordinate として安定する。
- `programCell.top` は program `startAt` と Guide start time、`timescaleHeight` から決まり、日跨ぎ番組も 24h wrap contract に従う。
- `programCell.firstVisibleChildTop - programCell.top <= 6px` を確認し、content の上揃えが崩れた場合は failure とする。
- `/guide/setting` の size select controls は visible MUI/AppSelect combobox として検出でき、値を変更できる。display-only text と hidden browser-default select の組み合わせで操作不能になる場合は failure とする。
- `programCell.height` は duration minutes と `timescaleHeight` から決まり、5 分番組は最小可視高さを満たし、長時間番組は隣接 cell と重ならない。
- route/query update が history restore ではない場合、program grid、channel header、time scale の scroll は初期位置へ戻る。
- history restore の場合、program grid scrollLeft / scrollTop、channel header scrollLeft、time scale scrollTop が同じ値に復元される。
- history restore の場合、program grid、channel header、time scale は data fetch と DOM / renderer 準備後、user-visible content の表示完了前に保存済み scroll position へ復元され、初期位置が一瞬表示される flicker を発生させない。
- iOS / Android bounce、端部 fling、CSS pixel rounding 相当の負値または content bounds 超過 scroll value では、visibility 判定用 viewport を content bounds に clamp し、visibility update を継続する。`minimum` mode で右端・最下部・左端へ移動した後も、現在 viewport と交差する cell は `.hidden` を外し、交差しない cell は `.hidden` を付ける。
- iOS fixed shell では program grid を最下部へ scroll した状態でも `shell-main.scrollTop === 0` を維持し、外側 shell scroll によって channel header が画面外へ移動する状態を failure とする。
- `guideMode=all` は visibility hide class を付けない。
- `guideMode=sequential` は一度 visible になった cell を保持する。
- `guideMode=minimum` は viewport 外 cell に hide class を再付与できる。
- genre setting 更新後は schedule refetch なしで genre hide class だけが更新される。hide class が付いた program cell は visible のまま muted palette になり、computed `visibility` が `hidden` にならないことを確認する。
- reserve class assertion は `reserve` が赤（`#ff0000`）の 4px solid border、`conflict` が `reserveConflictBackground` と赤（`#ff0000`）の 4px dashed border、`skip` が `reserveSkipBackground`、`overlap` が line-through、`reserveOverlapBackground`、text `reserveOverlapText`、`none` が視覚差分なしであることを確認する。
- 同じ program id に複数 reserve state が入る synthetic priority case は normal、conflicts、skips、overlaps の変換順で後勝ちになり、最終 visible state が overlap になることを確認する。
- ProgramDialog action 成功後の reserve index refetch は normal/conflict/skip/overlap 全 state で geometry を変えず、class だけを更新することを確認する。
- ProgramDialog の `詳細 `、`編集 `、`ルール `、`検索 ` route action は click 直後に dialog close を開始し、close animation 待機中は現在 route を維持し、約 300ms 後に目的 route へ遷移することを確認する。
- Guide ProgramDialog の `検索 ` action は click 直後に Guide route を維持して dialog を閉じ始め、close animation 後に `/search?keyword=<番組名>` へ遷移することを確認する。遷移先では SearchRule の query-driven auto-search が発火し、追加 click なしで search request と result header が観測できることを確認する。
- Guide ProgramDialog の encode selector は option 選択後も selected mode 名が shared `AppSelect` / MUI Select の表示面にだけ表示され、同じ text を持つ sibling `span` / overlay / display-only element が 0 件であることを確認する。
- Guide title day selector は current clock の日付を先頭に 8 日分を縦 1 列で表示し、各 item の x 座標が一致し、y 座標が昇順になることを確認する。route `time` は disabled 判定にだけ使い、genre dialog の 2 列 grid layout を day selector に流用しない。time selector は selected day/hour/broadcast を visible MUI controls として操作でき、menu/listbox が最大 216px を超えないことを確認する。time selector は outside click で閉じ、Socket.IO `updateStatus` による reserve index refetch 中も title bar clock anchor を unmount せず、menu paper が viewport 外へ移動したり透明 overlay だけが残ったりしないことを確認する。
- Guide route `time`、day selector、time selector、schedule fetch window、reserve index fetch window はすべて Asia/Tokyo の `YYMMddhh` を正本にする。UTC 15:00 が翌日 00:00 JST になる境界 case を含め、route 表示と API `startAt/endAt` が 9 時間ずれないことを assertion に含める。
- dark Guide grid の channel header、time scale、genre cell、reserve state、current timeline、main menu、genre dialog、time selector、`/guide/setting` は dark palette と contrast audit を通し、text/icon/control が背景と同化する場合は failure とする。time scale は `--guide-time-bg-0..23` の明色 background palette を維持し（dark theme でも上書きしない）、全 24 時間の computed text color が `--guide-time-scale-text: #fff` に統一されることを確認する。
- `GuideSizeSetting` 取得前の renderer fallback は `channelWidth=140px`、`timescaleHeight=180px`（`lib/guideGridTypes.ts` の `DEFAULT_CHANNEL_WIDTH_PX` / `DEFAULT_TIMESCALE_HEIGHT_PX`、tablet default と同値）として確認する。size setting は `tablet` と `mobile` の 2 段だけで、desktop 専用の段は持たない。
- ProgramDialog は max width 500px、content padding 16px 16px 20px、footer padding 8px、action row height 52px、field gap 8px、dark surface `chromeSurface` を確認する。
- ProgramDialog no reserve footer は footer 自体を固定 height にせず `height:auto` とし、52px option row の中で delete-original checkbox と encode select を中央揃えにする。encode select control は 48px 高さ、max width 120px、option row は `overflow-x:hidden` / `overflow-y:hidden` とし、option row 自体の `scrollHeight` が `clientHeight` を超えず、computed `overflow-y` が `auto` / `scroll` にならないことを確認する。checkbox label と select text/arrow/underline が dark theme でも App Shell token を継承して可視であることを geometry / computed style で確認する。encode select の menu/listbox は ProgramDialog 用に visible item 上限を調整し、通常の `TS` + encode mode 一覧では listbox / Paper の `scrollHeight` が `clientHeight` を超えず、computed `overflow-y` が `auto` / `scroll` にならず、dialog 内や page 本体に dropdown 由来の縦スクロール領域を作らないことを確認する。Android touch 操作性のため、menu option は 44px 以上の高さを保つ。MUI Popover/Paper の `overflow-x:hidden` が `overflow-y:visible` を `auto` に計算し直す回帰を防ぐため、Paper は `overflow-x` と `overflow-y` の両方を確認する。shared `AppSelect` の既定 4.5 item cap は他の select の regression guard として維持する。
