# Mock Data Contract: 録画済み

## 目的

Recorded visual cases は recorded list/detail、video files、search options、encode options、stream options を synthetic API response で固定する。実番組名、実サムネイル、実ファイル path、実 URL は使わない。

## Dataset

以下の dataset 名は fixture の条件を述べる概念上の名前で、コード上の識別子ではない。E2E の fixture は `client/e2e/support/recordedFixtures.ts`（`recordedListItems`・`longRecordedListItems`・`recordedDetail`・`recordedZeroDropDetail`・`recordedRecordingDetail`・`recordedOptions`・`ruleKeywords`）、unit test の fixture は `client/unittest/` 配下の各 test file が作る。件数などの条件は撮影条件の目安で、今の E2E fixture はこれより少ない。`settingsDarkTheme` は `frontend-app-shell` の mock-data.md で定義する。`settingsTableMode` は settings の `isShowTableMode=true`、`settingsCardMode` は `isShowTableMode=false`（既定）の状態を指す。

### `recordedMixedList`

- recorded item 12 件以上。
- long title、short title、drop info あり、file size あり、protected/unprotected、original file あり/なしを含める。
- 各 item は `isRecording`、`isEncoding`、`encodeEnabled`、`ruleId` 有無、`hasDropLog`、`thumbnailState`、`durationMinutes`、`startAt`、`endAt`、`fileSizeAggregateText`、`isProtected` を持つ。
- channel 名は `Synthetic Channel A` のような架空名にする。
- thumbnail は synthetic placeholder id のみとし、実画像を tracked fixture に含めない。

### `recordedDetailFull`

- video file 3 件以上。
- original file と encoded file を含める。
- description、extended、ruleId、channel、genre/subGenre を含める。
- download dialog 用に `downloadSchemeAvailable`、`playlistAvailable`、`dropLogFileId`、`dropLogPosition` を持つ。
- extended text は http/https linkify 対象と非対象 scheme の複数 case を含める。
- linkify 確認用 URL は `https://example.invalid/recorded-info` のみ許可する。

### `recordedDownloadOptions`

- `recordedDetailFull` の video file と `downloadSchemeAvailable`、`playlistAvailable` を使い、download link と playlist link の有無を分ける。

### `recordedDropLog`

- `recordedDetailFull` の `dropLogFileId`、`dropLogPosition` と、drop / error / scrambling の件数を使う。`dropLogFile` が無い item は drop 情報の要素ごと省略する variant を持つ。

### `recordedDeleteTargets`

- single delete と bulk delete の両方に使える video file checkbox list を含める。
- `deleteRecordedDefaultValue` true / false の両 variant を持つ。
- all files checked、some files checked、none checked の expected API path を分ける。

### `recordedEncodeOptions`

- source video file、encode preset、parent directory、sub directory 候補を含める。
- `sameDirectory` on/off、parentDir/directory omitted body、`removeOriginal` true/false の variant を持つ。
- directory は `/synthetic/library` のような記号的 path に留め、実 machine path を使わない。

### `recordedStreamOptions`

- `WebM`、`MP4`、`HLS`、必要に応じて `M2TS` 候補を含める。
- invalid type/mode、保存済み type/mode が候補から消えた場合の fallback variant を含める。
- playback URL は placeholder にし、実 host を含めない。

### `recordedKodiOptions`

- synthetic host list、保存済み host が有効な variant、stale host variant を含める。
- host label は `Synthetic Kodi Host A` のような架空名にし、実 host / IP address を含めない。

### `recordedSearchOptions`

- `/recorded/options`、`/rules/keyword`、`/rules/:ruleId` の success / failure / no-snackbar behavior を分ける。
- `/recorded/options` success は実際の API レスポンスと同じ `channels[].channelId/cnt`、`genres[].genre/cnt` を含める。channel 名は `/channels` fixture の `name` / `halfWidthName` から解決し、genre 名は大分類名から解決する。
- `/rules/:ruleId` success は top-level `keyword` ではなく `searchOption.keyword` を含め、`/rules/keyword` にない selected rule を補完する case を持つ。
- API endpoint は route contract としてのみ使い、実 URL は含めない。

### `recordedEmpty` / `recordedError`

- empty は records 空配列、total 0。
- error は synthetic error code と user-facing snackbar trigger だけを含める。

## 禁止事項

- 実番組名、実 channel 名、実 file path、実サムネイル、実 URL、Kodi host、認証情報を含めない。
