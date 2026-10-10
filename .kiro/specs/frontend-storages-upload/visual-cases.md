# Visual Cases: ストレージと録画アップロード

## 目的

Storages / Recorded Upload visual regression は、storage list、usage display、upload form、upload sequence feedback、rollback/error state が synthetic data で安定することを検証する。

`design.md` の Visual Implementation Contract にある storage row density、usage bar、upload form/FAB、progress dialog を geometry assertion の正本にする。

## Layout Cases

この表の case は screenshot の比較ではなく、geometry assertion と e2e の組で確認する。対応は次のとおり。

- storages-list、storages-mobile: `client/visual/storages-upload-geometry.spec.ts` の "keeps storage usage layout stable on desktop and mobile"。
- upload-form、upload-form-mobile、upload-progress: 同 spec の "keeps upload form, FAB, and progress dialog inside viewport" と、`client/e2e/storages-upload-workflow.spec.ts` の upload workflow（required の赤、48px の select、channel option）。
- upload-rollback-error: 同 visual spec の "keeps upload desktop progress and rollback error geometry stable" と、e2e の rollback workflow。
- storages-empty-error: e2e の "renders storage usage and keeps blank empty/error states"。
- storages-upload-dark: `client/e2e/dark-ui-cards.spec.ts`（storage item の surface）と `client/e2e/dark-ui-controls.spec.ts`（upload の select）、`client/e2e/dark-ui-storages-upload.spec.ts`（required の赤、usage bar、progress dialog）。disabled controls と action icons の dark は自動 test が無い。

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| storages-list | `/storages` loaded | 1440x900 | `storagesMixedList` | storage name、usage bar、used/available footer が list layout 内に収まる。 |
| storages-mobile | `/storages` loaded | 390x844 | `storagesMixedList` | storage card/row は horizontal overflow を出さず、usage bar と footer が重ならない。 |
| upload-form | `/recorded/upload` initial | 1440x900 | `uploadFormOptions` | file/select/input controls、save destination、action buttons が form layout 内に収まり、required labels は red、channel option labels は名前で数値 id を含まず、genre/sub genre は横並び 48px select、`日付選択 ` dialog は `日付 ` / `時刻 ` input に分離し、video file の selected filename は placeholder と重複しない。 |
| upload-form-mobile | `/recorded/upload` initial | 390x844 | `uploadFormOptions` | upload form controls と fixed FAB が mobile 幅で horizontal overflow を出さない。 |
| upload-progress | upload sequence running | 1440x900 | `uploadProgressState` | progress feedback と disabled controls が layout shift せず、snackbar が form を押し出さない。 |
| upload-rollback-error | upload failure and rollback | 1440x900 | `uploadRollbackError` | rollback/error state が実 path や実 URL を表示せず、再試行可能な visual state を維持する。 |
| storages-empty-error | storages empty/error | 1440x900 | `storagesEmpty`, `storagesError` | empty/error state と snackbar が title/action area を押し出さない。 |
| storages-upload-dark | `/storages` and `/recorded/upload` dark theme | 1440x900 | `storagesMixedList`, `uploadFormOptions`, `settingsDarkTheme` | storage list、usage bar、upload form、progress dialog、disabled controls、action icons が dark theme token で表示される。 |

## Interaction / Geometry Cases

- upload step の進行で form control の高さが不安定に変化しない。
- storage usage value が 0%、中間、ほぼ満杯でも usage bar の container width は変わらない。
- upload route と storages route の owner 境界を越えて action snackbar 文言を分岐しない。
- upload progress は step label を画面に出さず、persistent `アップロード中 ` dialog と indeterminate progress を正とする。
- upload form の genre/sub genre select は選択操作後に visible value と form state が一致することを確認する。genre 変更時は sub genre options が再生成され、空のまま固定されない。
- upload form の video file block は row title `ビデオファイル<n>` と field label `name`、`file type`、`directory`、`sub directory`、`video file` の原文 label を表示し、日本語 label に置き換わっていないことを accessible name で確認する。
- upload form の `日付※`、`長さ※`、`番組名※`、`概要 `、`詳細 `、video block `name` / `sub directory` は non-empty 時に clear button を表示し、押下で該当 field だけが空になることを確認する。select、file input、Rule autocomplete 内部 input は対象外とする。
- video file block の accessible name は field label そのものを正とし、`name 1`、`file type 1`、`directory 1`、`video file 1` のような block number suffix を field label 側へ付けない。複数 block の識別は row title `ビデオファイル<n>` と block container に委譲する。
- video file block の `file type` と `directory` は MUI standard select の外観と操作性を維持し、placeholder label、selected value、MUI select icon、focus/hover/dark theme contrast を確認する。
- dark / high contrast は App Shell theme token へ委譲し、この spec は storage/upload content geometry と contrast assertion だけを持つ。
- dark theme では usage bar track/fill、upload input/select、progress dialog、disabled text、icon-only action が background と同化しないことを確認する。
- storages list max width は 960px 未満は指定なし、960px 以上で 900px、1264px 以上で 1185px、1904px 以上で 1785px、upload form max width 800px、item padding 8px、usage bar height 25px、form padding `16px 16px 0`、FAB 56px square、progress height 4px とする。
- upload form は `放送局※`、`日付※`、`長さ※`、`番組名※` の computed color が light/dark とも red であることを確認する。dark theme の row title 一括 color override で白へ上書きされないことも確認する。
- upload form の `channel` select は option text が channel name / halfWidthName であり、id だけの数値 option を含まないことを確認する。
- upload form の `日付※` は direct input 後に後続 `長さ※` input と submit button を dialog/backdrop が覆わないこと、field text/underline/空白部分の click で `日付選択 ` dialog を開くこと、dialog 内に `日付 ` date input と `時刻 ` time input が分離して存在すること、`設定 ` / `クリア ` で閉じることを確認する。
- upload form の `日付※`、`長さ※`、`番組名※`、`概要 `、`詳細 `、video block `name` / `sub directory` は non-empty 時に clear button を表示し、押下で対象 field だけが空になることを確認する。select、file input、Rule autocomplete 内部 input は対象外とする。
