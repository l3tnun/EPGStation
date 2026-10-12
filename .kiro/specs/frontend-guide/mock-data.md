# Mock Data Contract: 番組表

## 目的

Guide visual cases は、schedule、channel、program、genre、reserve index、settings を synthetic dataset として固定する。実番組名、実 channel 名、実 URL、実ロゴ、実サムネイルは使わない。

## API Response Shape

- normal schedule: `GET /schedules` 相当の `{ schedules: ChannelSchedule[] }`
- single-channel schedule: `GET /schedules/:channelId` 相当の `{ schedules: Program[] }` または実装時 API adapter の正規化後 shape
- reserve index: `GET /reserves/lists` 相当の `{ normal: Reserve[], conflicts: Reserve[], skips: Reserve[], overlaps: Reserve[] }`。Reserve fixture は API response と同じ `reserveId`、`programId`、optional `ruleId` を持ち、frontend adapter が `reserveId` を内部 `id` に正規化することを確認する。

`GuideGridRenderer` に渡す正規化後 input は `GuideGridRendererInput` に従い、DOM node や browser object を含めない。

## Synthetic Entity Rules

- channel 名は `Synthetic GR 1`、`Synthetic BS 1` のような架空名にする。
- program 名は `Synthetic Program 001` のような連番にする。
- description / extended は架空文にし、linkify 確認用 URL は `https://example.invalid/program-info` など予約済みドメインだけを使う。
- genre は 0 から 15 までをすべて含める。
- startAt / endAt は固定日時にし、現在時刻依存を避ける。

## Dataset

### `guideDenseSchedule`

- channel 8 件以上。
- 各 channel に 5 分番組、15 分番組、30 分番組、60 分番組、3 時間以上の長時間番組を含める。
- 1 件以上の日跨ぎ番組を含める。
- genre 0 から 15 を全体で網羅する。
- e2e / visual の fixture は `client/e2e/support/guideOnAirFixtures.ts` の `syntheticGuideDenseSchedules`（8 channel、各 channel に 5・15・30・60 分、3.5 時間、23:30 から 00:30 の日跨ぎの番組を持つ）で、mock の option `dense: true` が返す。

### `guideSingleChannelSchedule`

- channel 1 件。
- 8 日分 selector と single-channel title を確認できる fixed date を持つ。
- stream dialog entry ではなく日付 header 表示を確認する。

### `guideReserveStates`

- no reserve、manual reserve、rule reserve、conflict、skip、overlap を program id で識別できる。
- 同じ program id に normal、conflicts、skips、overlaps の複数 state が入る priority case を最低 1 件含め、expected final state は client index 変換順の後勝ちにより `overlap` とする。
- visual assertion 用に各 program の `expectedReserveClass`、`expectedDecoration`、`expectedPrioritySource` を持たせる。`expectedDecoration` は `reserve` が赤 `#ff0000` の 4px solid border、`conflict` が `reserveConflictBackground` と赤 `#ff0000` の 4px dashed border、`skip` が `reserveSkipBackground`、`overlap` が line-through、`reserveOverlapBackground`、text `reserveOverlapText`、`none` が視覚差分なしのいずれかを表す。

### `guideReserveActionReflect`

- no reserve program を ProgramDialog から予約した後、同じ `/reserves/lists` fixture の `normal` に対象 `programId` を追加して返す。
- 再アクセス時も stateful fixture を維持し、schedule fetch failure や `番組表情報の取得に失敗しました` snackbar を混ぜない。

### `guideGenreHidden`

- `GuideGenreSetting` の genre 0 と 7 を false、他を true とする。
- hidden 対象と visible 対象が同じ channel / time range に混在する。

### `guideProgramDialogStates`

- no reserve、manual、rule normal/conflict、skip、overlap の各 dialog action set を開ける program を含める。
- encode selector と delete-original checkbox の initial value は `GuideProgramDetailSetting` から与える。

### `guideStreamChannels`

- full guide の channel header から LiveStreamSelectDialog を開ける channel を含める。
- stream type/config は synthetic label と numeric mode だけを使い、実配信 URL は含めない。

### `guideDenseScheduleMobile`

- `guideDenseSchedule` と同じ semantic coverage を保ち、mobile size variables で重なりを検出しやすい短い title を含める。

### `guideSelectorStates`

- 8 日 selector、hour 0-23 selector、broadcast wave selector、main menu open state を含める。
- broadcast wave order は `GR`、`BS`、`CS`、`SKY` とする（`BS4K` は 5 つ目の broadcast wave として存在するが、既存 visual case の snapshot を変えないため、この fixture では含めない）。

### `guideStateVariants`

- loading、empty、fetch error の state を含める。
- loading visual は、遅延表示（200ms）の後に番組表の領域の上に重ねる暗い scrim と円形 progress（`role="progressbar"`）とし、progress の animation の細部は固定しない。skeleton は持たない。
- error は synthetic snackbar trigger と exact user-facing text key を持つ。

## 禁止事項

- 実番組名、実放送局名、実サービス ID 由来と分かる名称、実 URL、実ロゴ、実サムネイルを使わない。
- Mirakurun URL、ffmpeg / ffprobe path、認証情報、cookie、token を含めない。
- current time を fixture generation の暗黙入力にしない。
