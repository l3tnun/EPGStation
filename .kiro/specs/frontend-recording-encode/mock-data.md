# Mock Data Contract: 録画中とエンコード

## 目的

Recording / Encode visual cases は recording item、encode queue、progress、cancel/delete target を synthetic data で固定する。実番組名、実 file path、実 thumbnail、実 encoder path は使わない。

## Dataset

以下の dataset 名は fixture の条件を述べる概念上の名前で、コード上の識別子ではない。E2E の fixture は `client/e2e/support/recordingEncodeFixtures.ts`（`recordingItems`・`encodeRunningItems`・`encodeWaitItems`）、unit test の fixture は `client/unittest/` 配下の各 test file が作る。`settingsDarkTheme` は `frontend-app-shell` の mock-data.md で定義する。件数などの条件は撮影条件の目安で、今の E2E fixture はこれより少ない。

### `recordingMixedList`

- recording item 8 件以上。
- progress 0%、中間、99%、終了間近を含める。
- long title、short title、channel、start/end、drop count 相当の表示差分を含める。
- `/channels` fixture に存在する `channelId` と `name` / `halfWidthName` を含め、recording item 側は `channelName` 欠落 case を最低 1 件持つ。該当 id がある場合は channel 名表示、該当 id がない場合だけ numeric fallback を期待する。
- 各 item は `recordedId`、`ruleId` 有無、`isProtected`、`videoFiles[].id`、`videoFiles.length`、`isRecording=true`、`isEncoding` を明示する。
- mobile overflow 確認用に最大長 title、channel 名、metadata 文字列を含める。
- thumbnail は含めない。

### `recordingDeleteTargets`

- Recorded owned bulk delete dialog の recording consumer case 用。
- video file option を非表示にする入力を含める。
- `selectedItemCount`、`visibleItemCount`、各 item の `videoFiles[].id` 数、全 file 選択 / 一部 file 選択の区別を含める。

### `encodeMixedList`

- waiting、running、failed、completed 相当の visual state を含める。
- encode mode、progress、source recorded title は synthetic label にする。
- 各 item は `encodeId`、`mode`、`recordedName`、`percent`、`hasLog`、`section` (`running` / `waiting` / `failed` / `completed`) を持つ。
- `/encode` visual owner は running / waiting を主要表示とし、failed / completed は regression fixture で表示可否を確認する optional state とする。

### `encodeCancelTargets`

- single cancel と bulk cancel の両方を確認できる item id を含める。
- single cancel target と bulk selected ids、成功 / 失敗結果を fixture で分離する。
- API error payload に実 path、実 command、ffmpeg / ffprobe path を含めない。

### `encodeEmpty`

- `GET /encode` の running / waiting がともに 0 件の応答。

### `recordingEmpty` / `recordingError`

- empty は records 空配列、total 0。
- error は snackbar 文言に紐づく synthetic error code と、body blank state を区別する `stateName` を含める。

## 禁止事項

- 実番組名、実録画 file path、実サムネイル、ffmpeg / ffprobe 実 path、encoder command、認証情報を含めない。
