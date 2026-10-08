# Mock Data Contract: ストレージと録画アップロード

## 目的

Storages / Upload visual cases は storage list、upload options、progress、rollback state を synthetic API response で固定する。実 storage path、実 upload file、実 URL は使わない。

## Dataset

### `storagesMixedList`

- storage 4 件以上。
- usage 0%、中間、90% 以上、`total=0`（容量不明相当）を含める。
- API の item は `name`、`used`、`total`、`available` を具体的な synthetic 値として持つ。`useRate` は API に無く、view で算出する。
- `total=0` case は `available` に非負の synthetic 数値（例: `0`）を持つ。`StorageUsageItem`（`storagesApi.ts`）の `available` / `used` / `total` は数値必須の型契約であり、`"unknown"` のような文字列は受け付けない。expected display は `formatStorageSize` の通常変換結果（例: `available=0` なら `0.0B`）とし、`useRate: 0` は `total=0` guard の結果とする。

### `uploadFormOptions`

- upload destination、encode option、metadata input に必要な synthetic options を含める。
- `channelId`、半角/全角表示差分、`genre`、`subGenre`、rule `id` / `keyword` を含める。
- recorded directory names、file type options、初期 video block default object を明示する。
- file name は `synthetic-recording.m2ts` のような架空名にする。

### `uploadProgressState`

- `showStepLabel=false` を visual baseline とし、upload dialog は `アップロード中` と indeterminate progress を表示する。
- `disabledControls`、`dialogCleanupDelayMs: 100` を持つ。

### `uploadRollbackError`

- upload failure と registered record の rollback の visual state を確認できる。
- upload 失敗では、rollback の成功・失敗とも同じ `アップロードに失敗` snackbar を出す。rollback の失敗は `console.error` のみに留める。file cleanup は server の責務で、client の fixture には持たない。
- error payload に実 path、実 URL、stack trace を含めない。

### `storagesEmpty` / `storagesError`

- empty は storages 空配列。
- error は synthetic error code と snackbar trigger だけを含める。

## 禁止事項

- 実 storage path、実 file path、実 upload file、実 URL、認証情報、ffmpeg / ffprobe path を含めない。
