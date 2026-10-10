# Visual Cases: 録画中とエンコード

## 目的

Recording / Encode の visual regression は、録画中 list、エンコード list、progress 表示、stop/cancel dialogs、empty/loading/error、Recorded shared dialog consumer state を検証する。

`design.md` の Visual Implementation Contract にある recording item density、encode section density、progress bar、empty blank state を screenshot / geometry assertion の正本にする。

## Screenshot / Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| recording-list | `/recording` loaded | 1440x900 | `recordingMixedList` | recording item menu、progress/metadata、recorded shared menu consumer が list layout 内に収まる。 |
| recording-mobile | `/recording` loaded | 390x844 | `recordingMixedList` | long title と progress 表示が action button と重ならず、horizontal overflow を出さない。 |
| recording-delete-dialog | recording delete dialog open | 1440x900 | `recordingDeleteTargets` | Recorded owned bulk delete dialog を `disableOption=true` 相当で表示し、option と option 用の余白が非表示になる。edit mode の list/card item は selected color だけを表示し、右端 checkbox を表示しない。 |
| encode-list | `/encode` loaded | 1440x900 | `encodeMixedList` | encode progress、queue state、cancel action が stable row/card height を保つ。 |
| encode-state-variants | `/encode` failed/completed optional states | 1440x900 | `encodeMixedList` | running/waiting を主要表示としつつ、failed/completed fixture が表示対象外または補助表示として明示される。 |
| encode-empty-blank | `/encode` running/waiting empty | 1440x900 | `encodeEmpty` | main content は空で、`エンコード中`、`待機中`、empty copy、placeholder container を表示しない。 |
| encode-cancel-dialog | cancel dialog open | 1440x900 | `encodeCancelTargets` | cancel dialog の文言と action row が max width 内に収まり、screenshot 未取得の bulk cancel state を mock で確認できる。 |
| recording-empty-error | `/recording` empty/error | 1440x900 | `recordingEmpty`, `recordingError` | empty presentation と snackbar が App Shell title や pagination 領域を押し出さない。 |
| recording-encode-dark | `/recording` and `/encode` dark theme | 1440x900 + 390x844 | `recordingMixedList`, `encodeMixedList`, `settingsDarkTheme` | recording desktop table container、recording mobile card、encode running/waiting item、list/progress/dialog/menu/pagination の contrast が保たれ、white surface fallback と empty encode state の light surface が残らない。 |

## Interaction / Geometry Cases

- progress value 更新で item height が変化しない。
- Socket.IO 相当 update で list item が更新されても action menu open state が意図せず別 item に移動しない。
- Recording consumer の `RecordedBulkDeleteDialog` は Recorded visual contract と同じ component を使い、option 非表示以外の layout を分岐しない。
- Recording item の channel 表示は `/channels` fixture で解決した channel name / halfWidthName を表示し、該当 channel が存在する case で numeric channelId を表示しない。
- Recording edit mode の選択は行・card の selected 色だけで表し、checkbox や選択用の label を出さないため、table/card width を広げないことを確認する。
- Recording edit mode の table row は 48px height を維持し、menu button の領域を空にしても title / channel / time cell の並びを崩さない。Bulk delete dialog は `削除対象` select を持たず、`選択した <count> 件の番組を削除しますか。`、`キャンセル`、`削除` を表示する。
- Recording desktop table dark case は table container、visible row、cell、menu/action cell を個別に computed style 監査し、white fallback surface と black foreground を failure とする。
- Encode item の single cancel dialog と bulk cancel dialog は Paper 実体を max-width 300px のみに固定し（width は固定しないため短文 body では 300px 未満に縮む）、bulk cancel dialog に 90px fixed height にしない。Dialog content は padding `16px 16px 0`、text color primary、action row は min-height 52px と padding 8px を持ち、短文 body では縦スクロールを出さない。accessible name は single `エンコード停止`、bulk `エンコード一括停止` とする。
- pagination は App Shell/shared pagination contract へ委譲し、本 feature visual regression では disabled/loading state が item body を押し出さないことを確認する。
- encode empty blank state は body/main の scroll height を増やさず、dark theme でも placeholder surface を描画しない。main content は DOM 上も空とし、hidden dummy text や accessibility tree 外 placeholder を残さない。
- Recording desktop table 行高 48px/14px、mobile card 高さ 100px/card title 14px-700/metadata 12px-300、Encode item title 14px-700、channel/time/mode/progress text 12px、progress bar height 4px、section label 20px/32px/500、section gap 8px を確認する（`design.md` Visual Implementation Contract に対応表がある）。Encode item row の高さは固定値を持たず、thumbnail の `aspect-ratio: 1.7778` に連動する fluid 値である（コンテナ幅 800px 時で概算 112px）。
