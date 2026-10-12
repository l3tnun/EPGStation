# Mock Data Contract: 検索とルール

## 目的

Search / Rule visual cases は search options、program results、reserve states、rule list/edit data を synthetic API response で固定する。実番組名、実 channel、実 URL、実 directory path は使わない。

## Dataset

### `searchOptionsFull`

- channel options、genre 0-15、encode options、save options、reserve options を含める。
- normal search option、time-specified option、reserveOption、saveOption、encodeOption の full shape を含める。
- channel option は `channelId`、`channelType`、`label` を持つ。
- E2E/API mock では実装が参照する `GET /api/channels` 互換の配列も必ず持つ。各 channel は `id`、`name`、必要に応じて `halfWidthName` を持ち、Search form の `放送局` select はこの endpoint から `channelId` option を構成できることを検証する。
- channel label は `Synthetic Channel A` のような架空名にする。

### `searchResultsMixed`

- search result 20 件以上。
- no reserve、manual、rule、conflict、skip、overlap を含める。
- long title、short title、日跨ぎ program を含める。
- 各 row は `programId`、`channelId`、`startAt`、`endAt`、`durationMinutes`、`reserveType`、`expectedDecoration` を持つ。

### `searchProgramDialogStates`

- ProgramDialog の状態別 action と rule add/update handoff を確認できる program を含める。
- no reserve / manual / rule / skip / overlap ごとに `reserveId`、`ruleId`、`programId`、`encodeOption`、`expectedActions` を持つ。
- extended URL は `https://example.invalid/search-info` のみ許可する。

### `ruleMixedList`

- rule item 12 件以上。
- keyword あり/なし、channel 複数、genre 複数、reservesCnt null/0/positive を含める。
- 各 item は `ruleId`、`isEnabled`、`keyword`、`channels`、`genres`、`reservesCnt`、`paginationTotal`、`selectedInEditMode` を持つ。
- rule list layout breakpoint で text overflow を検出しやすい long keyword を含める。

### `ruleEditFull`

- keyword、channel、genre、reserve option、save option、encode option、directory option、avoid duplicate flag を含める。
- `searchOption`、`reserveOption`、`saveOption`、`encodeOption`、`directoryOptions`、`isTimeSpecification`、`timeSpecifiedReserveList` を含める。
- directory は `/synthetic/rules` のような記号的 path にする。

### `searchEmpty` / `searchError`

- empty は results 空配列、total 0。
- error は synthetic error code、snackbar trigger、failure kind (`initial` / `refresh` / `scroll` / `ruleListFetch`) を含める。

## Dataset と fixture の対応

dataset 名は spec 上の名前であり、test の fixture はこの名前の定数としては存在しない。次の関数・定数が各 dataset を実現する（すべて `client/e2e/support/searchRuleMocks.ts`）。

| Dataset | fixture |
| --- | --- |
| `searchOptionsFull` | `searchChannels`（`GET /api/channels` 互換の配列。`installSearchRuleWorkflowApiMocks` が返す）。unit test 側の option は `client/unittest/spec/searchRuleSupport.tsx` の `createSearchRuleRepository()` が返す |
| `searchResultsMixed` | `createMixedSearchResults()`（`installSearchRuleWorkflowApiMocks` の `mixed: true` と `installPagedRuleListApiMocks` が使う） |
| `searchProgramDialogStates` | `searchPrograms` と `createMixedSearchResults()` の reserve 状態（none / manual / rule / conflict / skip / overlap） |
| `ruleMixedList` | `createMixedRules()`。長い keyword で crowded row を作る補助は `installSearchRuleCrowdedRowApiMocks` の `crowdedRule` |
| `ruleEditFull` | `ruleList` の先頭（`GET /api/rules/:id` が返す rule） |
| `searchEmpty` | `SearchRuleRealtimeMockController.clearSearchPrograms()` で検索結果を空にする |
| `searchError` | 各 test が handler を失敗応答に差し替えて作る（共有の fixture は持たない） |

## 禁止事項

- 実番組名、実 channel 名、実 directory path、実 URL、認証情報を含めない。
