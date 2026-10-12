# Visual Cases: 設定画面

## 目的

Settings Screen visual regression は、settings control matrix、section order、save/reset/leave action、theme preview、navigation regeneration request が backend API に依存せず安定することを検証する。

`design.md` の Visual Implementation Contract にある card width/padding、section/control gap、typography、theme preview token 反映を screenshot / geometry assertion の正本にする。

## Screenshot / Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| settings-desktop | `/settings` default | 1440x900 | `settingsDefaultControls` | 単一の centered settings card が max width 800px で表示され、`全般` から `ビデオプレーヤ` までの section が現在順で表示され、control label/value/action が重ならない。 |
| settings-mobile | `/settings` default | 390x844 | `settingsDefaultControls` | 単一 card 内で controls は 1 column に収まり、long URL scheme placeholder が horizontal overflow を出さない。 |
| settings-invalid-existing | `/settings` invalid stored values | 1440x900 | `settingsInvalidExistingValues` | 許容値外の既存値は route 表示だけで保存されず、select は空表示として安定する。 |
| settings-theme-preview | theme controls changed | 1440x900 | `settingsThemePreview` | `tmp` による theme preview が App Shell theme と Settings controls に反映され、reset/leave で保存済み theme に戻る。 |
| settings-save-reset | save/reset snackbar | 1440x900 | `settingsEditedControls` | save は `保存されました` snackbar と navigation regeneration request を発行し、reset は tmp default 復元だけで layout shift しない。 |
| settings-capability-variants | browser capability variants | 1440x900 | `settingsBrowserCapabilities` | `userAgentSupportsMpegts` により live M2TS web playback control の表示/非表示が変わっても settings value は自動変更されない。 |
| settings-dark-icons | `/settings` dark theme | 1440x900 | `settingsDefaultControls`, `settingsDarkTheme` | settings card、section title、helper text、input/select、action button、navigation icon が dark theme token で表示され、icon が背景と同化しない。 |

## Interaction / Geometry Cases

- Settings 画面は backend API を呼ばず、mock data は localStorage 相当の settings object だけを持つ。
- desktop では settings card の幅が 800px を超えず、mobile では viewport 幅内に収まることを geometry assertion で確認する。
- URL scheme placeholder は実 URL ではなく、長い synthetic placeholder でも control container からはみ出さない。placeholder `URL` は native input placeholder として未入力時だけ表示し、入力後は非表示にして入力文字列と重ねない。放映中、録画視聴、録画ダウンロードの 3 種は fake placeholder span を持たず、同一の input placeholder mechanism を使うことを DOM で確認する。
- URL scheme text control は 3 種とも non-empty 時に clear button を表示し、押下で対象 field だけを empty string に戻すことを確認する。clear button は input underline の高さに揃え、switch header を持つ row でも row 下端へ落ちないことを geometry assertion で確認する。switch の checked state や他 URL scheme field を同時に変更してはならない。
- section collapse を追加しない限り、section order と control order は requirements/design の matrix を正とする。
- 範囲外の既存値の select は空表示を synthetic baseline とし、route 表示だけで saved/tmp values を補正しない。
- Settings select は MUI Select として `combobox` を露出し、native `select` / `option` を DOM に直接残さない。listbox を開いた時、先頭 item は空白ではなく実 option label であり、Android/iOS project でも選択不能な空白行が見えないことを確認する。`combobox` が非表示になる、overlay が pointer target を奪う、または focus ring が表示面に出ない場合は failure とする。
- dark theme preview と saved dark theme の両方で Settings main content、control surface、icon-only / adornment icon の contrast を確認し、light surface が残る場合は failure とする。
- dark theme の custom switch は checked/unchecked を screenshot で確認し、checked thumb が dark primary `#90caf9`、track が translucent primary で描画されることを確認する。dark theme で light primary `#1976d2` が残る場合は failure とする。
- custom switch の pixel snapshot は Chromium を正本とし、Firefox / Android Chrome / iOS Safari project では snapshot baseline 不足を failure にしない。非 Chromium project は `::before` thumb と `::after` track の computed style、幅、操作性、theme preview 反映を確認する。
- card max width 800px、container padding desktop `12px 0` / mobile `12px`、section padding `16px 16px 17.5px`、control gap `16px`、action row padding `8px`、text button min height `36px`、card 後続の不可視 bottom spacer を確認する。
