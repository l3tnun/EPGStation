# Mock Data Contract: ダッシュボード

## 目的

Dashboard visual cases は、recording / recorded / reserve summary と reserve counts を synthetic API response として固定する。実番組名、実 channel、実サムネイル、実 URL は使わない。

## API Response Shape

- `GET /recording` 相当: `{ records: RecordingItem[], total: number }`
- `GET /recorded` 相当: `{ records: RecordedItem[], total: number }`
- `GET /reserves` 相当: `{ reserves: ReserveItem[], total: number }`
- `GET /reserves/cnts` 相当: `{ normal: number, conflicts: number, skips: number, overlaps: number }`

各 item は owner spec の mock-data contract に従う。Dashboard は summary 表示に必要な最小 field と owner shared component が要求する field だけを含める。

## Dataset

### `dashboardMixedSummary`

- 実体は `client/e2e/support/dashboardFixtures.ts` と `dashboardMocks.ts` の `success` mode。recording は 1 件（total 3）、recorded は 2 件（total 3）、reserves は 2 件（total 3）、`GET /reserves/cnts` は normal 2・conflicts 2・skips 0・overlaps 0 を返す。
- recorded には `ruleId` あり item と `ruleId` なし item を含め、Dashboard menu search が rule route と keyword route の両方を owner contract 経由で確認できるようにする。
- recorded は description 表示 item と drop/file size 表示 item を混在させる。
- reserve は normal item だけを持ち、skip・overlap の item は持たない。conflict は `GET /reserves/cnts` の `conflicts` で表す。
- recording item は thumbnail を持たない。

### `dashboardConflictSummary`

- `GET /reserves/cnts.conflicts` を 1 以上にする。
- reserve summary は normal item だけでもよいが、conflict badge の route handoff を確認できる。

### `dashboardEmptySummary`

- すべての list を空配列、total 0 とする。
- empty 専用文言を期待しない。

### `dashboardErrorSummary`

- 1 section だけ fetch failure を返し、他 section は loaded state とする。
- error payload に実 URL、host、stack trace、環境固有 path を含めない。

## Shared Item Fields

Dashboard の summary item は owner component の最小 contract を満たすため、次の synthetic field を含める。

- common: `id`、`channelName`、`channelType`、`startAt`、`endAt`、`durationMinutes`、`title`、`description`。
- recorded: `isProtected`、`encodingState`、`videoFiles`、`dropCount`、`errorCount`、`scramblingCount`、`fileSizeText`、`thumbnailState`。
- reserve: normal の item だけで、`reserveState` は持たない。conflict の件数は `GET /reserves/cnts` の `conflicts` で表す。
- recording: `recordedId`、`isRecording=true`、`isEncoding`、`progressPercent`。
- dialog handoff: `genreLabel`、`extendedText`、`guideTimeKey`。
- placeholder asset: `thumbnailPlaceholderId: synthetic-thumbnail-placeholder`。実画像は使わない。
- error: `failureSource` を `recording`、`recorded`、`reserves`、`reserveCounts` から選び、`snackbarMessageKey` を固定する。

## Layout Fixture Fields

- `sectionScrollHeightMode`: `viewport-minus-titlebar` とする。desktop の page 高さは `calc(100vh - 72px)`（title bar 64px と page padding 4px × 2）とする。
- `themeVariant`: `light` または `dark`。dark theme では contrast assertion を行い、実 color token は固定しない。

## 禁止事項

- 実番組名、実 channel 名、実サムネイル、実ロゴ、実 URL を使わない。
- recorded thumbnail が必要な owner component を composition する場合も synthetic placeholder asset name のみにし、実画像を tracked fixture に含めない。
