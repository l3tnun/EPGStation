# Mock Data Contract: 放映中

## 目的

On Air visual cases は broadcasting schedule、reserve index、stream options、watch info を synthetic data で固定する。実 channel、実番組名、実配信 URL は使わない。

## Dataset

以下の dataset 名は fixture の条件を述べる概念上の名前で、コード上の識別子ではない。E2E の fixture は `client/e2e/support/guideOnAirFixtures.ts` の `syntheticOnAirSchedules`・`syntheticOnAirChannels`、unit test の fixture は `client/unittest/spec/support/onairSpecHarness.tsx` の `createSchedule`・`createOnAirRepository` が作る。件数などの条件は撮影条件の目安で、今の E2E fixture はこれより少ない。`settingsDarkTheme` は `frontend-app-shell` の mock-data.md で定義する。

### `onAirMixedChannels`

- channel 6 件以上。
- 現在放映中 program、直前終了に近い program、終了時刻が長い program を混在させる。
- reserve state は none、manual、rule、conflict、skip、overlap を含める。
- `enabledBroadcastTypes` は `GR`、`BS`、`CS`、`SKY` の順で明示する（`BS4K` も 5 つ目の broadcast type として存在するが、この fixture では含めない）。
- 各 channel は `logoState` を `hasLogo` または `nameFallback` として持つ。
- progress boundary 用に `now`、`startAt`、`endAt` を固定し、0%、中間、100% 超過相当を含める。

### `onAirProgramDialog`

- ProgramDialog action set を確認できる no reserve / manual / rule / skip / overlap program を含める。
- 各 program は `reserveKind`、`reserveId`、`programId`、`ruleId` を持ち、ProgramDialog action matrix を fixture だけで決定できる。
- extended text の URL は `https://example.invalid/onair-info` のみ許可する。

### `onAirStreamOptions`

- stream type は `M2TS`、`M2TS-LL`、`WebM`、`MP4`、`HLS` を含める。
- mode は numeric id と synthetic label に限定する。
- `savedSelection` は valid / invalid type / invalid mode の 3 variant を持ち、`expectedCorrectedSelection` を明示する。
- `browserSupport` は `m2tsllSupported`、`hlsSupported` を boolean として持つ。
- 実 stream URL、host、token は含めない。

### `onAirWatchInfo`

- watch route の player entrypoint と info card に必要な channel / program metadata を含める。
- `routeQuery`、`channelId`、`mode`、backend internal stream `type` を分離し、matching / non-matching / fetch failure を固定する。
- player source URL は placeholder または mocked media id とし、実 URL を含めない。

### `onAirEmpty` / `onAirError`

- empty は broadcasting schedule 0 件。
- `fetchOutcome` は `emptySuccess` または `failure`、`retryPolicy` は `timer-1s` または `none` として明示する。
- error は user-facing failure state を発火できる synthetic error code のみを含める。

## 禁止事項

- 実 channel 名、実番組名、実配信 URL、実ロゴ、実サムネイル、認証情報を含めない。
- current live data を fixture generation の入力にしない。
