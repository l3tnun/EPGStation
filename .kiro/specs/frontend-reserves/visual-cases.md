# Visual Cases: 予約

## 目的

Reserves visual regression は、予約 list、state variants、card/table layout、ReserveDialog、delete dialog、bulk edit、Manual Reserve form が state decoration と owner boundary を維持することを検証する。

`design.md` の Visual Implementation Contract にある table/card density、dialog/form width、decoration 表示範囲、dark surface を geometry assertion の正本にする。

## Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| reserves-table | `/reserves` normal | 1440x900 | `reservesMixedList` | list container width（`.reservesPage` の実測幅）916px 以上では table layout を表示し、columns `放送局` / `日付` / `時間` / `番組名` / `内容` / menu が崩れず、visible state decoration を出さない。 |
| reserves-card | `/reserves` normal narrow container | 800x900 | `reservesMixedList` | list container width（`.reservesPage` の実測幅）915px 以下では card/list rows を表示し、通常 card は `.reservesPage` の幅一杯の list に並び、visible state decoration を出さない。 |
| reserves-mobile | `/reserves` normal | 390x844 | `reservesMixedList` | card/list rows で long title、channel、datetime、action menu が重ならず、pagination が mobile 幅で収まる。 |
| reserves-conflict-filter | `/reserves?type=conflict` | 1440x900 | `reservesStateFilters` | conflict filter の table list と title/filter state が対応し、state class priority は保持するが decoration は表示しない。 |
| reserve-dialog | reserve dialog open | 1440x900 | `reserveDialogFull` | 番組名、channel、日時、genre、description、extended、`閉じる` action を表示する。 |
| reserve-delete-dialog | delete dialog open | 1440x900 | `reserveDeleteTarget` | max width 300、`<予約名> を削除しますか?`、`キャンセル` / `削除` action を表示する。 |
| reserve-bulk-delete-dialog | edit mode with selected reserves | 1440x900 / 390x844 | `reservesMixedList` | select-all は表示中 item を選択/解除し、bulk delete dialog は max width 300、visible title なし、`選択した <total> 件の番組を削除しますか。`、`キャンセル` / `削除` action だけを表示する。 |
| manual-reserve-add | `/reserves/manual` add | 1440x900 | `manualReserveOptions` | time-specified / channel / reserve / encode / save options が form layout 内で重ならない。 |
| manual-reserve-edit | `/reserves/manual?reserveId=...` edit | 1440x900 | `manualReserveEdit` | edit mode の初期値、delete/save action、scroll restoration が安定する。 |
| reserves-dark | `/reserves` and `/reserves/manual` dark theme | 1440x900 / 390x844 | `reservesMixedList`, `manualReserveOptions`, `settingsDarkTheme` | list/table/card、ReserveDialog、delete dialog、manual form、menu、pagination、disabled/link text が dark theme token で表示される。title menu open、item menu open、bulk delete dialog open を個別に開き、portal 配下の icon/text contrast と card datetime text の黒残りを検査する。 |

## Interaction / Geometry Cases

- route type invalid は normal 表示へ正規化され、unknown filter visual state を出さない。
- Reserve list layout は viewport 915px で card/list rows、916px で table に切り替わることを geometry assertion で確認する。
- bulk edit selection の有無で title/action row の高さが不安定に変わらず、table layout の selected row は `td` を含む item 全体が `#4285f4` / `#fff` の filled selection になる。
- SearchRule の time-specified rule edit だけが `needsDecoration=true` consumer として decoration を表示できる。
- Manual Reserve program add では、時刻指定 switch off 時に program information section だけを表示し、時刻指定 switch on 時に program information section を非表示にして time-specified target fields だけを表示する。on/off を往復しても余分な section が残らないことを確認する。
- Manual Reserve option panels は `[0, 1, 2, 3, 6]` を初期 open とし、panel header クリックで非 0ms の transition duration を持って開閉できることを確認する。`エンコード2` / `エンコード3` は初期 closed だが、開いた場合は mode、directory、sub directory の control が表示され、閉じると exit transition 完了後に input が消える。
- Manual Reserve の時刻指定 start/end は `yyyy-MM-dd HH:mm` 表示を正とし、UNIX milliseconds の裸値が text field に出る場合は failure とする。start/end の click で開く日時 picker dialog は、月曜始まりの日本語 calendar と時刻の選択、`クリア` / `設定` を持ち、明暗の両 theme と幅 375px で dialog からはみ出さないことを確認する。
- Manual Reserve の時刻指定 `番組名`、start/end、保存 `sub directory`、`file format`、encode1-3 `sub directory` は non-empty 時に clear button を表示し、押下で対象 field だけが空になることを確認する。select/combobox は clearable text field の代表確認に含めない。
- ReserveDialog は max width 500px とし、visual regression では body field order と overflow safety を固定する。
- dark theme では reserve/manual main content と dialog/menu portal の contrast を確認し、state decoration、card datetime/channel/description text、menu icon、disabled text、pagination icon が背景と同化しないことを geometry/contrast assertion に含める。
- desktop table dark case は table card だけでなく visible row、cell、menu cell を個別に computed style 監査し、white row surface と black foreground を failure とする。
- table body row height 80px、card padding 12px、Manual Reserve max width 800px の寸法を持つ。
