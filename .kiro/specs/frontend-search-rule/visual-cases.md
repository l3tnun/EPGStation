# Visual Cases: 検索とルール

## 目的

Search / Rule visual regression は、search form、result list、ProgramDialog、rule list card/table、rule edit/create form、responsive breakpoint、history restore が user-visible contract として安定することを検証する。

`design.md` の Visual Implementation Contract にある search form density、rule list breakpoint、rule edit の scroll 位置（title bar の高さを引いた位置）、dark portal surface を geometry assertion の正本にする。

## Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| search-initial | `/search` initial | 1440x900 | `searchOptionsFull` | plain `/search` 初回表示では default search を発火せず、form controls が初期状態で表示され、検索結果領域は空で `検索条件を入力してください ` などの helper text を表示しない。 |
| search-results | `/search?keyword=synthetic` | 1440x900 | `searchResultsMixed` | result list、reserve/rule action が search form と重ならない。 |
| search-query-handoff | Guide ProgramDialog `検索 ` action から `/search?keyword=<programName>` へ遷移 | 1440x900 / 390x844 | `guideProgramDialogStates`, `searchResultsMixed` | `/search` 表示後に追加操作なしで search request が実行され、keyword field、result header、ProgramDialog 由来の channel/genre query visual state が一致する。keyword target が未選択でも request では name/description が有効になる。 |
| search-program-dialog | search result program selected | 1440x900 | `searchProgramDialogStates` | ProgramDialog は Guide owner と同じ action semantics を保ち、Search 由来の rule workflow action が表示される。 |
| rule-list-table | `/rule` wide | 1440x900 | `ruleMixedList` | 780px 以上の table layout で keyword fallback、channel/genre `他<n>`、reservesCnt fallback 0 が崩れず、outer list が content width いっぱいに伸縮し、共有 page wrapper の上限 1600px を除いて固定 max width で頭打ちしない。 |
| rule-list-card | `/rule` narrow | 390x844 | `ruleMixedList` | 779px 以下の card layout で long keyword、予約数、action menu affordance が重ならず、dark theme でも黒系固定色を残さない。 |
| rule-edit-form | `/search?rule=<ruleId>` edit | 1440x900 | `ruleEditFull` | rule edit は `/search` の query state として表示し、keyword/options/encode/save controls が form layout 内で安定し、auto scroll setting の影響で target control が隠れない。 |
| search-empty-error | search empty/error | 1440x900 | `searchEmpty`, `searchError` | empty/error state と snackbar が form controls を押し出さない。 |
| search-rule-dark | `/search` and `/rule` dark theme | 1440x900 | `searchResultsMixed`, `ruleMixedList`, `settingsDarkTheme` | Search form、result list、Rule list/edit、ProgramDialog、action menu、pagination が dark theme token で表示され、main content に light surface が残らない。 |

## Interaction / Geometry Cases

- Rule list layout は container width（`.page` の実測幅）780px 以上で table、779px 以下で card/list に切り替える。
- Rule list table は desktop/tablet viewport 幅変更に追従して outer list width が伸縮することを確認する。780px では table layout、779px では card layout へ切り替わることを確認し、どちらも document 横スクロールが発生しないことを確認する。`max-width: 1160px` などにより content width より狭い幅で固定される場合、または grid column の固定最小幅で viewport を押し広げる場合は failure とする。
- `/rule` の追加 FAB は light/dark theme の両方で pink surface と white plus icon を computed color で確認する。plus icon が黒色、透明、または背景同化色の場合は failure とする。
- Rule row/card は hover/focus-within で light/dark theme とも背景色が変わり、transparent のままにならないことを確認する。
- Rule enable switch は unchecked/checked の checked state と accessible action label が API 成功後に即時更新され、track/thumb に transition が設定されていることを確認する。cross browser assertion は `data-checked` と action label を正とし、`::after` の thumb position pixel 値は Chromium の補助的な visual assertion に限定する。
- Rule enable switch (`.ruleSwitchButton`) の click/tap 領域は、390px 幅の list layout と desktop 幅の table layout の両方で keyword 列の box/glyph rect と重ならないことを `getBoundingClientRect()`/`Range.getClientRects()` で確認する。keyword text の先頭 glyph 位置を click しても enable/disable API が呼ばれず、switch の `data-checked` が変化しないことを確認し、続けて switch 自体の click では enable/disable API が呼ばれ `data-checked` が変わることを同一 test 内で確認する。
- route leave/update で search page state を保存し、history restore の場合だけ復元する。
- rule selection/edit mode の有無で list row/card height が不安定に変わらず、selected row/card は outline-only ではなく `#4285f4` / `#fff` の filled selection になる。
- Rule list edit mode の `選択削除 ` は title bar 下の inline block ではなく centered modal dialog を開き、single delete dialog と同じ action row density を維持する。
- Rule list edit mode は Reserves / Recorded / Recording と同じ `EditTitleBar` の close/select-all/delete icon controls を表示し、Rule 固有の text button row を表示しないことを確認する。bulk delete dialog は max-width 300px を超えず、選択件数本文と actions が single delete dialog と同じ MUI `DialogContent` / `DialogActions` density を維持する。
- `/search?rule=<ruleId>` の EPG rule edit 初期表示では、`isEnableAutoScrollWhenEditingRule=true` のときだけ検索結果 region へ scroll し、`false` のときは同じ初回検索成功後も scroll しないことを DOM scroll spy または browser geometry で確認する。scroll 座標は検索結果 region の top + pageYOffset - title bar height であり、検索結果 heading が sticky title bar に隠れないことを確認する。
- Reserves item menu の `edit` から `/search?rule=<ruleId>` へ遷移した場合も、 Settings の自動スクロールが ON なら初回検索結果へ scroll し、OFF なら scroll しないことを確認する。遷移元ごとの auto-scroll 抑止 state は使わない。
- `/rule` title bar の検索 icon は `/search` へ遷移せず、Rule search menu を表示する。menu は width 400px 相当、`キーワード ` standard text field、`閉じる ` / `検索 ` text buttons、dark portal surface を持ち、検索実行時は close animation 待機後に `/rule?keyword=...` へ遷移することを確認する。
- ProgramDialog から Search へ遷移するとき、settings の channel/genre inclusion が query visual state に反映される。
- ProgramDialog から Search へ遷移するとき、遷移後の `/search?keyword=...` は user が検索 button を押さなくても auto-search し、request body の keyword target default は name/description true、extended false になることを network assertion で確認する。
- iOS / mobile の Search result item は title が 16px / 28px / weight 900、description が 14px / 20px で表示され、
  title/description が放送局名や日時より小さくなる button default font regression を failure とする。
- Search form の keyword field は Enter で検索を実行し、直前に入力した最新 value が request body に含まれることを確認する。Enter submit と button submit の request body normalization が異なる場合は failure とする。
- Search form、Search result、Rule option card は desktop/mobile とも同じ max-width 800px contract を共有し、keyword 入力 card だけが広い/狭い、または結果/録画設定 card だけが別幅になる場合は failure とする。
- plain `/search` の `時刻指定 ` switch は rule edit 以外で操作でき、OFF では通常検索 card、ON では番組名/channel/開始/終了/曜日の time-specified rule card と Rule option card が表示されることを確認する。ON へ切り替えただけで `/schedules/search` を発火する、または switch が label だけで操作不能な場合は failure とする。
- Search form の `検索 ` button で結果取得した直後は SearchResult header が viewport 上部へ移動し、SearchResult header の link icon は Rule option card へ移動することを確認する。link icon が form へ戻る挙動は failure とする。
- Search top FAB は  viewport left 12px、permanent drawer open 時は drawer right + 12px、
  bottom 16px の 56px pink circular button として表示し、drawer に重なって欠けない。iOS fixed shell では top FAB
  tap 後に `shell-main` が top へ戻ることを確認する。
- Search form の `クリア ` / `検索 ` action row は上側に divider を持ち、action row 下側または card 末尾の余分な divider が出ないことを確認する。
- Rule option form では checkbox、日数、directory/sub directory、mode1-3、file format が実入力として操作でき、編集後も panel layout、label、input underline、accordion icon が崩れないことを確認する。directory/directory1-3 と mode1-3 は shared `AppSelect` の select/combobox visual として表示し、server config 由来 option を選択できることを確認する。menu 先頭に `mode1`、`directory1` など field label 自体が option として混入する場合は failure とする。encode2/3 は mode 未選択で panel を開き、sub directory を先に入力しても値が保持され、その後 mode/directory を選択して `追加 ` / `更新 ` すると payload に反映されることを確認する。read-only snapshot に見える、クリックしても値が変わらない、payload に反映されない場合は failure とする。
- Search / Rule の text-like field と clearable select は non-empty 時に field 右端の clear button を表示し、押下で該当 input/select だけを空にする。Clear button は field/card 右端ではなく対象 input/select の右端に重なり、横並び field でも隣の input や card 端へ逃げてはならない。Clear button は `/settings` と同じ 32px hit area、28px の `×`、`#1976d2` foreground とする。Search form の keyword、ignore keyword、duration min/max、channel、start time、range、period dialog datetime、Rule option form の `日数 `、`directory`、`sub directory`、`file format`、`mode1-3`、`directory1-3`、`sub directory1-3`、Rule search menu keyword を DOM/interaction で個別に確認する。`file format` は clearable な text field であり select ではないため、text field として検査する。通常検索 UI の `range` select と時刻指定 UI の `終了 ` field の双方を確認対象に含める。
- Search/Rule の checkbox は MUI checkbox root と label を持つことを DOM assertion で確認し、raw native checkbox の直接描画を failure とする。keyword target、ignore keyword target、broadcast wave、weekday、genre sub-toggle、free flag、rule option checkbox を同一 visual/dark audit 対象に含める。
- Rule option の accordion summary は表示 title、開閉 icon、focus/hover state を持ち、CSS 疑似要素だけに依存して操作不能にならないことを確認する。accordion body は開閉時に非 0ms の transition duration を持ち、instant show/hide にならないことを geometry/animation assertion に含める。
- Search form の genre preview では `サブジャンル表示 ` checkbox の ON/OFF で subGenre button 群が表示/非表示になり、genre button、checkbox label、clear button の配置が崩れないことを確認する。
- Search form の `放送局 `、ジャンル一覧の絞り込み select、`start`、`range` は select/combobox visual として下向き indicator、underline、label density を持ち、直接数値入力に見えないことを確認する。`放送局 ` は 48px display height を維持し、未選択の `channel` は keyword placeholder と同じ muted color で表示し、outlined `fieldset` や raw input 用 border が左/上/右に重複表示されてはならない。channel option 表示、genre filter top-level option、0-23 時の start、1-23 時間の range が操作でき、選択後も broadcast wave checkbox、genre preview、weekday checkbox と重ならないことを確認する。複数 channel 選択時は selected labels が 1 行 ellipsis になり、combobox の実幅が Search form card の右端を越えないことを browser geometry で確認する。
- Search form の genre preview は 180px 程度の scrollable card とし、top-level genre / subGenre item を複数選択できること、selected item は blue tint になること、unselected item の hover は selected と同じ blue tint にならないこと、genre filter select で一覧だけが絞り込まれて search payload の genre 選択は直接変わらないことを確認する。
- Search form の duration min/max は各 100px 程度、Rule option の duplicate period は 90px 程度、directory/mode select は 150px 程度に収まり、desktop 幅でも行全体に引き伸ばされないことを確認する。
- Search form の `期間 ` は `開始 ` / `終了 ` text field から日時 picker dialog を開き、dialog 幅（幅 375px でも calendar がはみ出さない）、月曜始まりの日本語 calendar、時刻の選択、`クリア ` / `設定 ` text button、light/dark surface を確認する。片側だけ設定した状態で検索しても `searchPeriods` は送られない。
- Loading visual は skeleton placeholder を許容するが、visual regression は form/result/rule option の geometry が変わらないことを正とする。
- dark theme は App Shell theme token へ委譲し、SearchRule は geometry と contrast assertion だけを持つ。
- dark theme では dialog/menu portal も SearchRule owner visual case に含め、text/icon/disabled state が背景と同化しないことを確認する。`/rule` mobile card の予約数と overflow menu 疑似要素は、card root だけでなく該当 child/pseudo-element の computed color を検査する。
- form/search result/rule option card max width 800px、rule table breakpoint 780px、card は table と同じ `width: 100%`（共有 page wrapper の上限 1600px を除き固定 max width なし）を確認する。search card padding は `32px 16px 24px`（CSS の値。geometry では確かめない）。
