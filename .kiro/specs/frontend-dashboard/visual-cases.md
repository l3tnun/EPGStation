# Visual Cases: ダッシュボード

## 目的

Dashboard の visual regression は、summary section layout、more link、shared item component composition、empty/loading/error、responsive/theme が owner spec と矛盾しないことを検証する。

## 共通条件

- screenshot は synthetic recording / recorded / reserve dataset から生成する。
- Dashboard は item action の意味を再定義せず、Recorded / Reserves / Recording owner component の visual contract を composition した状態を検証する。
- screenshot 本体はこの仕様に貼らない。
- `design.md` の Visual Implementation Contract にある section width、height、header、surface、item density を screenshot / geometry assertion の正本にする。

## Screenshot / Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| dashboard-desktop-three-columns | `/` summary loaded | 1440x900 | `dashboardMixedSummary` | content max width ではなく App Shell content 領域内で 3 section が横並びになり、各 section は 33.3% 幅で縦 scroll を持つ。 |
| dashboard-mobile-stack | `/` summary loaded | 390x844 | `dashboardMixedSummary` | section は max width 600px の縦積みになり、item text と action button が重ならない。 |
| dashboard-conflict-badge | `/` conflicts >= 1 | 1440x900 | `dashboardConflictSummary` | conflict badge と more link が同時に表示され、badge が section title や item action を押し出さない。 |
| dashboard-empty | `/` all empty | 1440x900 | `dashboardEmptySummary` | section title は `0/0` を維持し、追加 empty copy は表示しない。section の高さと余白は mixed state と大きく崩れない。 |
| dashboard-loading-error | `/` loading then one section error | 1440x900 | `dashboardErrorSummary` | loading hide/transition と snackbar 表示が title bar、more link、section scroll area を押し出さない。 |
| dashboard-dark | `/` dark theme | 1440x900 | `dashboardMixedSummary`, `settingsDarkTheme` | card/list surface と section background が dark theme として一貫し、shared item component の text contrast が保たれる。 |
| dashboard-dark-recorded-menu | `/` dark theme、recorded item menu open | 1440x900 | `dashboardMixedSummary`, `settingsDarkTheme` | portal 上の recorded item menu で `rule`、`search`、`protect/unprotect`、`encode`、`stop`、`delete` の text と icon/pseudo icon が dark surface と同化しない。 |
| dashboard-recorded-no-image | `/` summary loaded、recorded item thumbnails empty | 1440x900 | `dashboardMixedSummary` | recorded summary item は `img/noimg.png` を height 100px、flex-basis 30%、max-width 200px の slot で表示し、text と action button の横幅を押し潰さない。 |
| dashboard-no-outer-scroll | `/` summary loaded | 1440x900 | `dashboardMixedSummary` | body/main content は縦 scroll を持たず、scrollable overflow は各 section body だけに限定される。1px outer scroll は不一致とする。1023px 未満の縦積みでは section body に高さ制限が無く、外側の main content が縦 scroll する。 |

## Interaction / Geometry Cases

- 1023px 未満では section は縦積み、1023px 以上では横並びに切り替わる。
- 1264px 以上で drawer default open のとき、drawer を除いた content 領域内で横並びを維持する。
- each section の scrollTop は route update/leave で保存され、history restore flag が true の場合だけ fetch 完了後に復元される。
- more link は recording / recorded / reserves それぞれの owner route page 2 へ遷移し、Dashboard route query を増やさない。
- recorded/recording item menu の search action は `ruleId` あり item で `/recorded?ruleId=<ruleId>`、`ruleId` なし item で bracket と episode suffix を除去した `/recorded?keyword=<keyword>` へ遷移する。Dashboard card click target と menu click target は干渉しない。
- ReserveDialog open state は MUI Dialog transition を維持し、open 直後に root/backdrop/container/paper のいずれも transition duration 0 固定にならないことを確認する。
- section scroll height は `sectionScrollHeightMode=viewport-minus-titlebar` として固定し、3 section の header/more link/scroll body が互いに重ならないことを確認する。
- desktop（1023px 以上）では body/main の `scrollHeight <= clientHeight` を geometry assertion で確認し、section body 以外に overflow を持たせない。mobile/tablet の縦積みでは main content が縦 scroll owner であり、この assertion を適用しない。
- section container の surface 背景、box-shadow、radius 4px、title height 60px、title padding 16px、section gap 8px は、`dashboard-list`・`dashboard-list-mobile` の screenshot 比較で固定する。個別の寸法の assertion は持たない。
- loading は skeleton を必須とせず、content hidden/transition stable contract とする。loading transition duration と opacity は implementation token へ委譲し、visual regression では layout shift がないことだけを固定する。
