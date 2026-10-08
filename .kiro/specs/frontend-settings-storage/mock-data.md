# Mock Data Contract: 設定ストレージ契約

## 目的

Settings Storage は直接の画面 owner ではないが、consumer visual generation のために storage state matrix を synthetic data として固定する。実 URL、実 host、認証情報、環境固有値は使わない。

## Dataset

### `settingsStorageStateMatrix`

- `platformVariant`: `desktop`、`ios`、`android`。
- `osColorTheme`: `light` または `dark`。
- `savedSettings`: consumer UI 初期表示用の保存済み settings object。
- `tmpSettings`: Settings Screen の未保存編集状態を表す draft object。
- `themePreviewState`: `saved-derived`、`tmp-preview`、`reset-restored`、`leave-restored` のいずれか。
- `writeFailureMode`: `none`、`quotaExceeded`、`unavailable`。storage owner は例外を caller へ伝播しないことだけを保証し、consumer snackbar は Settings Screen / App Shell が所有する。
- `extraUnknownField`: unknown additional field を持つ fixture。typed consumer contract には含めないが、read/write 時に保持してよい。
- `invalidExistingField`: enum/range/type 不正だが storage 読み込み時に補正しない field。
- `urlSchemeTemplate`: `PROTOCOL`、`ADDRESS`、`FILENAME` token だけを含む placeholder template。

### `adjacentStorageFixtures`

- `OnAirSelectStreamSetting`、`RecordedSelectStreamSetting`、`SendVideoFileSelectHostSetting`、`VideoPlayerSetting`、`GuideSizeSetting`、`GuideGenreSetting`、`GuideProgramDetailSetting`、`AddEncodeSeting` の existence/default shape を持つ。
- `GuideSizeSetting` と `GuideGenreSetting` の詳細 default value は `frontend-guide` owner spec から参照する。

## 禁止事項

- 実 URL、実 host、実 path、実番組名、実ロゴ、実サムネイル、認証情報、Mirakurun URL、ffmpeg / ffprobe path を含めない。
