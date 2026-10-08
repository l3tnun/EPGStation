# Mock Data Contract: 予約

## 目的

Reserves visual cases は reserve list、state variants、manual reserve form options を synthetic API response で固定する。実番組名、実 channel、実 URL は使わない。

## Dataset

### `reservesMixedList`

- reserve item 12 件以上。
- normal、conflict、skip、overlap、manual、rule reserve を含める。
- long title と short title を混在させる。
- 各 item は `reserveId`、`ruleId`、`programId`、`isManual`、`isConflict`、`isSkip`、`isOverlap`、`canDelete`、`canUnlockSkip`、`canUnlockOverlap` を持つ。
- table/card の両方で表示する `name`、`channelName`、`startAt`、`endAt`、`durationMinutes`、`description`、`extended` の最大長 variant を含める。
- channel 名は synthetic label にする。

### `reservesStateFilters`

- `type=normal`、`conflict`、`skip`、`overlap` の各 route で対象 item が存在する。
- no query の場合は all 相当を確認できる。
- 各 route の対象 item 全件を持ち、compressed visual ではなく route/filter 別 assertion が可能な `expectedFilterType` を含める。

### `reserveDialogFull`

- description、extended、genre/subGenre、channel、datetime を含める。
- linkify 用 URL は `https://example.invalid/reserve-info` のみ許可する。

### `reserveDeleteTarget`

- delete dialog 文言に使う synthetic reserve name を含める。
- 実番組名と誤認される固有名詞を避ける。

### `manualReserveOptions`

- channel options、time-specified options、reserve options、save options、encode options を含める。
- `saveOption` は empty object と omitted object の両方を含める。
- `encodeOption` は all null、1 件 selected、複数 selected、`isDeleteOriginalAfterEncode=true` の差分を含める。
- `/api/config` の encode options は `encode` array と normalized `encodeModes` array の両方を fixture 化し、Manual Reserve がどちらの shape でも同じ option list を表示できることを確認する。
- `/api/config` の encode options が 0 件の variant も含め、`エンコード1`/`エンコード2`/`エンコード3`/`ファイル削除` panel が描画されないことを確認できるようにする。
- option label は synthetic にし、実 channel 名を使わない。

### `manualReserveEdit`

- reserveId edit、programId handoff、add mode の差分を確認できる fixed id を含める。
- `reserveIdFixture`、`programIdFixture`、history restore 用 `savedPageInfo`、edit mode では復元しない negative fixture を持つ。

## 禁止事項

- 実番組名、実 channel 名、実 URL、実ロゴ、認証情報を含めない。
