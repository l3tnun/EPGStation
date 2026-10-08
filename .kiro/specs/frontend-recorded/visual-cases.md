# Visual Cases: 録画済み

## 目的

Recorded の visual regression は、list/detail、table / large card / small card、search menu、delete/add encode/Kodi/streaming dialogs、responsive breakpoint が user-visible contract として安定することを検証する。

`design.md` の Visual Implementation Contract にある table/card/detail/dialog density、surface、padding、breakpoint を screenshot / geometry assertion の正本にする。

## Screenshot / Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| recorded-table | `/recorded` table setting | 1440x900 | `recordedMixedList`, `settingsTableMode` | table max width 1000 内に metadata と action が収まり、pagination と search menu が重ならない。 |
| recorded-large-card | `/recorded` card multi-column | 1440x900 | `recordedMixedList`, `settingsCardMode` | card width 300、margin 8、multi-column 判定 `floor(width / 308) > 1` 相当を維持する。 |
| recorded-small-card | `/recorded` narrow | 390x844 | `recordedMixedList`, `settingsCardMode` | small card と mobile pagination が 500px breakpoint 以下で崩れず、long title が action button を押し出さない。 |
| recorded-detail | `/recorded/detail/:id` loaded | 1440x900 | `recordedDetailFull` | metadata、video file list、description、extended、menu action が detail layout 内に収まる。 |
| recorded-delete-dialog | delete dialog open | 1440x900 | `recordedDeleteTargets` | max width 300、video file checkbox list、`キャンセル ` / `削除 ` action を表示する。 |
| recorded-add-encode-dialog | add encode dialog open | 1440x900 | `recordedEncodeOptions` | max width 500、source/preset/directory/sub directory/same directory/remove original controls が縦に収まる。 |
| recorded-streaming-dialog | streaming dialog open | 1440x900 | `recordedStreamOptions` | stream type/config selection が空白にならず、playback handoff action が stable height を保つ。 |
| recorded-kodi-dialog | Kodi dialog open | 1440x900 | `recordedKodiOptions` | host list、保存済み host、stale host fallback が実 host を表示せずに安定する。 |
| recorded-download-dialog | download dialog open | 1440x900 | `recordedDownloadOptions` | accessible name `録画ダウンロード `、video file list、play list を表示し、本文 heading を追加しない。 |
| recorded-drop-log-dialog | drop/error/scrambling dialog open | 1440x900 | `recordedDropLog` | max-width 600px、content padding 16px、pre text 14px/20px、light/dark text contrast を維持する。 |
| recorded-search-menu | search menu open | 1440x900 | `recordedSearchOptions` | search menu open/close で list width と card column count が変化しない。 |
| recorded-empty-error | list empty/error | 1440x900 | `recordedEmpty`, `recordedError` | empty/error と snackbar が list toolbar、pagination、App Shell title を押し出さない。 |
| recorded-dark-surfaces | `/recorded` and detail dark theme | 1440x900 | `recordedMixedList`, `settingsDarkTheme` | list/detail/upload entry/dialog/menu/pagination/icon の contrast が保たれ、light surface が main content に残らない。 |

## Interaction / Geometry Cases

- viewport width 変化で table / large card / small card と pagination mode が contract どおりに切り替わる。
- search menu open/close で list width と card column count が変化しない。
- recorded search menu の rule/channel/genre は loaded options を表示する select control とし、選択後に route query と list fetch query に同じ値が反映されることを確認する。fixture は `/recorded/options` のレスポンス形状である `channelId/cnt` と `genre/cnt` を含め、表示 label に channel/genre 名と件数が出ることを確認する。
- `/#/recorded?ruleId=<id>` で rule keyword 一覧にない rule が選択済みの場合、search menu open 後に `/rules/:ruleId` 由来の keyword が selected option として表示され、snackbar が出ないことを確認する。
- table layout の recorded row は mouse hover で light `#eeeeee`、dark `#616161` の background color に変わる。selected row は hover で selected color を失わない。
- edit title の select-all action は、partial selected では表示中 item を全選択し、all selected では表示中 item を全解除することを確認する。
- detail delete で全 video file delete 成功時は previous route へ戻り、削除済み detail visual state に留まらない。
- bulk delete dialog は Recorded consumer では option を表示し、Recording consumer では option を非表示にできる export contract を維持する。
- download dialog は backdrop click、Escape、route change で閉じ、close 後に role `dialog` が DOM に残らない。再 open 時に stale selected file/play list を保持しない。
- Recorded detail の streaming、add encode、download、drop log、delete、Kodi などの dialogs は MUI Paper/Backdrop の open transition を維持し、transition/animation duration が 0 の instant mount へ退行しないことを代表 dialog で検査する。
- streaming dialog から playback route へ遷移するとき、WebM / MP4 / HLS / Direct stream の query と handoff state は `frontend-video-playback` の visual cases と対応する。
- table columns は `タイトル `、`放送局 `、`時間 `、menu を正とし、table max width 1000px 内で file size / duration text が overflow しないことを確認する。
- dark theme の table case は table wrapper、thead、visible row、td/th、menu cell を個別に computed style 監査し、white fallback surface と black foreground を failure とする。
- detail main content の max width は viewport 幅に応じた 3 段 breakpoint に従い、960px 以上 1264px 未満 900px、1264px 以上 1904px 未満 1185px、1904px 以上 1785px とする（padding 12px は breakpoint 無しで常時）。960px 未満の viewport では max-width 指定なしとし、top section は 800px 以上で thumbnail と metadata を横並び・垂直中央、799px 以下で縦積みとし、thumbnail aspect ratio は 16:9、desktop width 400px、max height 400 を正とする。
- detail の play/streaming/encode/kodi action button icon は 18px 四方とする。`client/visual/recorded-geometry.spec.ts` は viewport 1440x900 の 4 project（Desktop Chromium / Desktop Firefox / Android Chrome / iOS Safari）で、play icon box の高さ 18px（差 0.5px 未満）と幅 20px 以下、4 button の icon 左端の button 左端からの offset（play/encode/kodi は 11.5px 超 13.5px 未満、streaming は 12px 超 14.5px 未満）、button の computed style `letter-spacing: 1.25px` / `line-height: 21px`、icon と label の上下中心が button の上下中心との差 0.5px 未満であることを検査する。4 button の icon への `.detailActionIcon` 付与は `client/unittest/spec/recorded/detail-metadata-2.spec.test.tsx` の `[AC 3.22]`、CSS の宣言値は `client/unittest/spec/recorded/list-styles.spec.test.tsx` の `[AC 3.22]` が固定する。
- detail metadata は channel が 16px/28px、genre/time が 14px/22px、extended text は padding-top 0 を正とする。genre は `genre1/subGenre1` がある fixture で大分類と小分類を `大分類 / 小分類 ` として表示し、`genres` string fallback だけを表示してサブジャンルを落とす regression を不一致にする。
- detail drop/error/scrambling は録画完了済みかつ `dropLogFile` がある場合だけ表示する。録画中または `dropLogFile` がない場合は `drop: 0, error: 0, scrambling: 0` を fallback 表示しない。録画完了済みの `0/0/0` では neutral text、いずれか 1 以上では warning color/background とし、どちらも drop log button として操作できることを確認する。
- detail drop/error/scrambling dialog は max width 600px、`pre` が browser default 16px monospace に戻っていないこと、dark theme でも text が黒色のまま残らないことを確認する。
- add encode dialog は open state で dialog body の horizontal overflow がなく、`source`、`preset`、`recorded` select が browser default appearance ではないことを確認する。`元ファイルと同じ場所に保存する ` ON では `recorded` と `sub directory` が disabled になり、payload は `isSaveSameDirectory: true` で `parentDir` / `directory` を省略する。
- recorded detail more menu、streaming dialog、add encode dialog、download dialog は dark coverage audit で visible text/icon/control の contrast を検査し、MUI portal root ではなく Paper/menu surface を対象にする。
- card width 300px、card margin 8px、table row min height 48px、dialog content padding 16px 24px、action row 8px 16px、control gap 12px を確認する。
- recorded search menu keyword と recorded search menu の `ルール ` / `放送局 ` / `ジャンル ` select、add encode `sub directory` は non-empty 時に clear button が表示され、押下で対象 field だけが空になることを DOM/interaction で確認する。recorded search menu の select は選択 text と placeholder/label text が重なって読めない状態になってはならない。
