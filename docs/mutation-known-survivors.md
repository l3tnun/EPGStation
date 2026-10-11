# mutation testing の既知の生き残り

mutation testing（流し方は [testing.md](testing.md) の §5、方針は `.kiro/steering/server-testing.md`・`.kiro/steering/testing.md` の「Mutation Testing」）で、test を足さないと判断して残してある生き残りの一覧。server（`stryker.server.config.mjs`）・DB（`stryker.db.config.mjs`）・配信の本体（`stryker.delivery.config.mjs`）・client（`client/stryker.client.config.mjs`）の設定ごとに分け、その中を対象 file ごとの節にしている。生き残りが無い file は載せない。

## 使い方

1. mutation testing を流し、report（json）を `node scripts/mutation/summarize.mjs <report.json>` で集計する（[testing.md](testing.md) の §5）。生き残り（Survived・NoCoverage）の一覧が file・行・mutator・置き換え後の形で出る。
2. 出た生き残りを、この一覧と見比べる。行番号は使っていないので、処理の場所（クラス・関数・定数の名前）と mutator で引く。**この一覧に載っているものは扱わない。載っていないものだけを扱う。**
3. 載っていない生き残りは、次のどちらかで片付ける。
    - 振る舞いが変わる mutant なら、それを外から観測できる assertion の test を足す。足した後は、対象を絞って `--force` を付けて流し、殺せたことを確かめる。
    - 振る舞いが変わらない（下の理由のどれか）なら、理由を書いてこの一覧に足す。
4. source を変えて、載せた理由が成り立たなくなった項目は消す。成り立たなくなった項目が再び生き残りとして出たときは、2〜3 に従って扱う。

理由は次の 4 つに分ける。

| 理由 | 意味 |
| --- | --- |
| 振る舞いが変わらない | 置き換えても、観測できる結果（戻り値・保存される値・外へ出る副作用）が変わらない。出力する log の文言・呼び出しもここに入れる |
| 冗長 | 同じ条件を別の箇所が検査している、または別の経路が同じ後始末をするため、その箇所を外しても結果が同じ |
| 到達不能 | その分岐へ来る入力が、呼び出し元の検査や処理の性質から存在しない |
| 定数表で判定できない | module の読み込み時に評価される式（定数表・module 先頭の arrow function）の mutant。report に `static: true` と出る。test が値を確かめていても、読み込みが mutant の有効化より先に済むため、この設定では生き残りと出る。値は値そのものを確かめる test で守る |

同じ理由で多数の件がある場合（log の文言など）は、関数単位にまとめている。log の文言・出力は、出力される log を test の対象にしない方針のため、まとめて「振る舞いが変わらない」としている。

## server（`stryker.server.config.mjs`）

### `src/model/operator/reservation/ReservationManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `add`、`addEventRelay`、`createManualReserveWithProgramId`、`createManualReserveWithSpecifiedTime`、`createEventRelayReserve`、`checkSingleReserveConflict`、`checkSubDirectories`、`update`、`updateRule`、`updateAll`、`cancel`、`removeSkip`、`removeOverlap`、`edit`、`cleanup` の log の文言・呼び出し（`log.system.*(err)` の削除、log の文言に入れる `programId` の有無の判定を含む） | StringLiteral、CallExpression、ConditionalExpression、EqualityOperator | 振る舞いが変わらない: log だけ |
| `update`、`updateRule`、`createDiff` の `isSuppressLog === false` の判定と、`createDiff` が log に渡す件数の object | ConditionalExpression、EqualityOperator、BooleanLiteral、BlockStatement、ObjectLiteral | 振る舞いが変わらない: log の出力条件と内容だけ |
| `updateAll` の `.catch` の中（`update`・`updateRule` の失敗を log に出すだけの block） | BlockStatement、CallExpression | 振る舞いが変わらない: log だけ |
| `createReserves` の debug log | StringLiteral、BlockStatement、ObjectLiteral | 振る舞いが変わらない: log だけ |
| `createManualReserveWithSpecifiedTime` の `option.timeSpecifiedOption` が定義済みかの判定 | ConditionalExpression、EqualityOperator、StringLiteral、BlockStatement | 冗長: `.catch` の中では常に定義済みで、分岐の差は log だけ |
| `setManualReserveOption` の `tags`・`saveOption`・`encodeOption`、`setProgramToRuleReserve` の `saveOption`・`encodeOption` が undefined かの判定 | ConditionalExpression、StringLiteral | 振る舞いが変わらない: true にすると undefined の代わりに null が入るだけで、保存先の列はどちらも NULL になる |
| `isEditableManualReserve` の `isEventRelay === false`・`=== true` の判定 | ConditionalExpression | 冗長: 編集可能な手動予約の 3 パターンの和集合が変わらない |
| `updateRule` の `: []`（有効な番組ルールでないときの空配列）と `newRulePrograms.length !== 0` | ArrayDeclaration、ConditionalExpression | 振る舞いが変わらない: 空配列の扱いと結果が同じ（使われるのは有効な番組ルールのときだけ） |
| `checkProgramIdReserveDiff` の `programId` の一致の判定 | ConditionalExpression | 冗長: 比較に使う key に programId が含まれるため常に一致する |
| `cancel` の `isConflict = false` | BooleanLiteral | 冗長: 続く競合判定が `isConflict` を計算し直す |
| `removeSkip` の `other.id !== reserveId` | ConditionalExpression | 冗長: 自分自身が重ねて入っても、番組の重複の折りたたみで 1 件になり差分が変わらない |
| `createReserves` の `reserve.programId !== null`・`reserve.programId === null`・`programIdIndex[...] = true` | ConditionalExpression、BooleanLiteral | 冗長: 集合に null が入らない、判定の結果が同じ |
| `createReserves` の時刻の並べ替えの同時刻の枠（開始と終了の順、`idx` の昇順）と、出力の開始時刻順の並べ替え | ConditionalExpression、LogicalOperator、BlockStatement、BooleanLiteral、ArithmeticOperator、MethodExpression | 冗長: 入力を `idx` 昇順で作り、並べ替えは安定で、出力は元から開始時刻順のため、比較関数の枝が結果に効かない（40 区間の連鎖でも殺せない） |
| `createReserves` の `matches[l.idx].isSkip` なら continue | BlockStatement、ConditionalExpression | 冗長: 後段の評価が `isSkip` を除外している |
| `sortReserve` の `isTimeSpecified` の組み合わせの判定と、末尾の `ruleId !== null` を含む条件 | LogicalOperator、ConditionalExpression | 冗長: そこへ来る時点で両方がルール予約なので `ruleId` は常に null でない |
| `getRuleProgramIdKey` の `'skip'`・`'overlap'` の文字列 | StringLiteral | 振る舞いが変わらない: 空文字にしても 2 つの key は互いに別で、他の key の形とも衝突しない |

### `src/model/operator/recording/RecordingScheduleController.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `ACTIVE_TIME_SPECIFIED_END_PHASES`（時刻指定終了を受け付ける phase の集合） | ArrayDeclaration、StringLiteral | 定数表で判定できない: 受け付ける phase を 1 つずつ確かめる test がある |
| `rerunRequested` の初期値、`stop` での値 | BooleanLiteral | 冗長: `evaluate` の先頭で必ず false に戻る |
| `evaluate` の `hasQueuedWork()` の中間確認と `rerunRequested` の設定、`requestCoalescedEvaluation` の `rerunRequested = true` | BlockStatement、ConditionalExpression、BooleanLiteral | 冗長: loop 条件の `hasQueuedWork()` と各 dispatch 関数の先頭の確認で重複して担保されている |
| `requestCoalescedEvaluation`・`scheduleMicrotaskWake` の `microtaskScheduled` の guard | ConditionalExpression | 冗長: `scheduleMicrotaskWake` 側にも同じ guard があり、`microtaskScheduled` の間は `armedWake` が無い |
| `scheduleMicrotaskWake` の catch の中の `resolveIdleWaiters()` | CallExpression | 冗長: catch へ来る経路では queue に作業が残るか、`evaluate` の末尾の `resolveIdleWaiters` でも解決される |
| `applyQueuedWork` が `applyUpsert` に渡す `'insert'` | StringLiteral | 振る舞いが変わらない: 空文字でも `'update'` 以外なので同じ扱い |
| `applyUpsert`・`applyRemove`・`dispatchDueTimeSpecifiedEnds` の `timeSpecifiedEnds.delete` | CallExpression | 冗長: ほかの掃き出し（`schedulerOwnedDeadlines`、`isActiveTimeSpecifiedMilestone`）でも消えるため、1 回の評価の終わりには同じ状態になる |
| `dispatchDuePreparations` の `current.phase !== 'Waiting'` なら continue | ConditionalExpression | 冗長: `Waiting` 以外は `tryTransitionSession` が期待 phase の不一致で失敗し、同じ結果になる |
| `dispatchDueTimeSpecifiedEnds` の `candidate === undefined` なら continue | ConditionalExpression | 到達不能: 候補が無い milestone は削除時に先に消える |

### `src/model/operator/ReserveOptionChecker.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `checkSearchOption` の `durationMin`・`durationMax` の `typeof ... !== 'undefined'` の条件と、`&&` の組み合わせ | ConditionalExpression、StringLiteral、LogicalOperator | 振る舞いが変わらない: undefined との比較は常に false になり、結果が変わらない |
| `checkKeywordOption` の `cs`・`regExp` が false かの条件 | ConditionalExpression、LogicalOperator、EqualityOperator、BooleanLiteral | 冗長: 後続の「name・description・extended が全て false」の分岐に包含され、同じ結果になる |

### `src/model/operator/rule/RuleManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `add`、`update`、`enable`、`disable`、`delete` の log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |
| `QUEUE_ADVANCE_TIMEOUT_MS` | ArithmeticOperator | 定数表で判定できない: 10,000 ms で timer が消えることを確かめる test がある |
| `waitForAdvance` の `advanced` の再入防止 | BlockStatement、ConditionalExpression、BooleanLiteral | 冗長: resolve の 2 重呼び出しと `clearTimeout` の 2 重呼び出しは無害 |

### `src/model/operator/storage/StorageManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `checkEntry` の log の文言と `log.system.error(err)` の削除 | StringLiteral、CallExpression | 振る舞いが変わらない: log だけ |
| `checkEntry` の古い録画の検索の catch を空にする | BlockStatement | 振る舞いが変わらない: `recordedId === null` の分岐に落ち、同じく break して終わる |
| `checkEntry` の disk 情報の取得の catch を空にする | BlockStatement | 振る舞いが変わらない: NaN で while を抜ける。差は 100 ms の sleep が 1 回増えるだけ |
| `launchCommand` の `log.system.error(error)` の削除 | CallExpression | 振る舞いが変わらない: log だけ |
| `stop` の `this.timerId !== null` の判定 | ConditionalExpression | 振る舞いが変わらない: `clearInterval(null)` は無害 |

### `src/model/ConfigYaml.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `ENV_TAG`（tag の名前・option の object・`identify`）、`CONFIG_YAML_OPTIONS`、`normalizeDBType` | StringLiteral、ObjectLiteral、ArrowFunction | 定数表で判定できない: module の読み込み時に評価される式 |

### `src/model/Configuration.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `readConfig` の `let str = ''` | StringLiteral | 振る舞いが変わらない: 直後に必ず読み込みで上書きされるか `process.exit` する |
| `readConfig` の warning 扱いの `throw e` を空にする | BlockStatement | 振る舞いが変わらない: throw しなくても、続く `loadYaml('')` から `formatConfig` が例外を投げ、呼び出し側が捕まえて同じ結果になる |
| `formatConfig` の `typeof newConfig.https !== 'undefined'` | ConditionalExpression、StringLiteral | 到達不能: `port` も `https` も無い設定は直前の `PortSettingError` で弾かれるので、この `else if` へ来たとき `https` は必ずある |
| `setTemplateValues` の `typeof config.urlscheme === 'undefined'` | ConditionalExpression、StringLiteral | 冗長: undefined は直前の `DEFAULT_VALUE` の補完で既に埋まり、残る null の判定は別の条件で検出される |
| `Configuration.CONFIG_FILE_PATH`・`CONFIG_TEMPLATE_FILE_PATH`・`ROOT_PATH` の path の要素 | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |
| `Configuration.DEFAULT_VALUE`（既定値の表と、その中の path の要素） | StringLiteral、ObjectLiteral、ArrayDeclaration、BooleanLiteral | 定数表で判定できない: 項目ごとに値を確かめる test があり、説明書（`docs/conf-manual.md`）に既定値が無い `encode`・`urlscheme` の形は実装の値で固定している。`mirakurunPath` の既定値は説明書に書いてあるが、値を確かめる test は無い |

### `src/util/StrUtil.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `enclosedCharactersConvertTable`（囲み文字の置換表。表そのものと 35 個の値） | ObjectLiteral、StringLiteral | 定数表で判定できない: 35 個の置換を全部確かめる test がある |
| `toDouble` の `"`・`'`・`` ` ``・`~` の置換 | StringLiteral | 到達不能: 直前の `[!-~]` の全角化で、この 4 文字はすべて全角になっており、後段の置換の対象が残らない |

### `src/util/SubDirectoryUtil.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `stripLeadingSeparators`、`hasSubDirectoryOutsideRoot` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換えで、読み込み時に評価される。呼び出したときの振る舞いは test が確かめている |

### `src/model/operator/thumbnail/ThumbnailManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `add`、`create`、`delete`、`regenerate`、`fileCleanup` の log の文言と `log.system.*(err)` の削除 | StringLiteral、CallExpression | 振る舞いが変わらない: log だけ |
| `PREPARATION_TIMEOUT_ERROR` の message | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |
| `create` の `'VideoFileIsNotFound'` の message | StringLiteral | 振る舞いが変わらない: `add()` の queue 内で catch されて log に出るだけ |
| `create` の `typeof err.code !== 'undefined'` | ConditionalExpression、StringLiteral | 冗長: 後ろの `err.code === 'ENOENT'` が undefined も弾く |
| `awaitChildSettlement` の `finalize` 内の `clearDeadline()` | CallExpression | 冗長: `finalize` へ来る経路はすべて、その前の `settleSuccess`・`settleFailure` で期限 timer を止めている |
| `cleanupReservation` の `err?.code` | OptionalChaining | 到達不能: `err` は常に Error object で null にならない |
| `regenerate` の `recorded.thumbnails.length === 0` | ConditionalExpression | 冗長: list が空なら後続の loop が 0 回で `existingThumbnailCnt === 0` となり、同じく生成の対象になる |
| `regenerate` の `existingThumbnailCnt++` | UpdateOperator | 振る舞いが変わらない: 使うのは `=== 0` の判定だけで、1 件以上あれば符号に依らず 0 でない |
| `fileCleanup` の索引の値 `true` | BooleanLiteral | 振る舞いが変わらない: 索引の値は `typeof ... !== 'undefined'` でしか使わない |
| `checkFileExistence` の catch の block | BlockStatement | 振る舞いが変わらない: 戻り値が undefined になるが、呼び出し側は `=== true` で比べるので false と同じ |

### `src/util/FileUtil.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `emptyFileList`、`emptyManagedFileListResult` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え |
| `isManagedEntrySafeForRemoval` の `entryStats.isSymbolicLink() === false` | ConditionalExpression | 冗長: directory の判定は `lstat` なので、symlink では `isDirectory()` がもともと false |
| `isManagedEntry` の条件、`getManagedFileList` の `isManagedEntry(...) === false` なら continue | ConditionalExpression、LogicalOperator、EqualityOperator、StringLiteral、MethodExpression、BlockStatement | 到達不能: 呼び出し元の entry は `readdir` の名前を `path.resolve(directory, entry)` した path で、managed root の外へ出ない |

### `src/model/operator/externalCommand/ExternalCommandManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `addUpdateReseves` の `diff.insert`・`diff.update`・`diff.delete` の `length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 配列が空なら loop が 0 回で、command は 1 件も追加されない |
| `createReserveCmd`、`createRecordedCmd`、`createFinishEncodeCmd` の `execute cmd` の log | StringLiteral | 振る舞いが変わらない: log だけ |

### `src/model/operator/recorded/RecordedManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `uploadFileSystem`、`fileSystemErrorCode`、`pathOnlyHandle` | ObjectLiteral、ArrowFunction | 定数表で判定できない: module 先頭で評価される式 |
| `fileSystemErrorCode` の `error instanceof Error && 'code' in error` | ConditionalExpression | 振る舞いが変わらない: Error でない値が投げられたときだけ差が出て、返る文字列が `'undefined'` か undefined になるだけ（比べる相手はどの error code とも一致しない） |
| `videoFileCleanupState`・`dropLogFileCleanupState` の初期値と、`dropLogFileCleanup` の終了時の値 `'idle'` | StringLiteral | 振る舞いが変わらない: 状態は `=== 'running'` でしか比べず、`'running'` 以外なら同じ |
| `delete`、`removeManagedFile`、`addVideoFile`、`persistVideoFile`、`addUploadedVideoFile`、`cleanUploadCandidate`、`createNewRecorded`、`deleteVideoFile`、`changeProtect`、`executeVideoFileCleanup`、`executeDropLogFileCleanup` の log の文言と `log.system.error(...)` の削除、unlink の失敗を握りつぶす・log に出すだけの catch の block（`delete` の log に入れる `dropLogFile?.id` を含む） | StringLiteral、CallExpression、BlockStatement、OptionalChaining、ConditionalExpression | 振る舞いが変わらない: log だけ（unlink の失敗は握りつぶす／log に出すだけ） |
| `delete` の `typeof recorded.thumbnails !== 'undefined'`・`typeof recorded.videoFiles !== 'undefined'` | LogicalOperator、ConditionalExpression、StringLiteral | 冗長: 直前の `hasThumbnails`・`hasVideoFiles`（同じ判定を含む）が true なら必ず定義済み。型を絞るための条件 |
| `openPathPinnedDirectory` の directory でない場合の拒否 | BlockStatement、ConditionalExpression | 冗長: 直後の `assertPinnedUploadDirectory` が同じ検査をして同じ error を投げる |
| `assertPathChain` の `chain` の未定義の判定と `UploadPathError` の throw | ConditionalExpression、StringLiteral、BlockStatement | 冗長: 外側の `catch` がすべて `UploadPathError` に包み直すので、内側の throw・判定を外しても同じ error になる |
| `executeVideoFileCleanup`・`executeDropLogFileCleanup` の索引の値 `true` | BooleanLiteral | 振る舞いが変わらない: 索引の値は `typeof ... !== 'undefined'` でしか使わない |
| `executeVideoFileCleanup` の `replace(new RegExp(...), '')` | StringLiteral | 冗長: `path.dirname` の結果の末尾に区切りは付かないので、置換は何もしない |
| `checkFileExistence` の catch の block | BlockStatement | 振る舞いが変わらない: undefined が false と同じに扱われる |

### `src/model/operator/recorded/RecordedUploadAdoptionModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `PAYLOAD_BASENAME`、`rawFileSystem`、`errorCode` | StringLiteral、ObjectLiteral、ArrowFunction | 定数表で判定できない: module 先頭で評価される式。`PAYLOAD_BASENAME` は path 検査の test が値を使っている |
| `parseIncomingPath` の `components.length !== 2`・`token.length === 0`・`token === '.'` と、その連結 | ConditionalExpression、LogicalOperator、StringLiteral | 冗長: 直後の `filePath !== path.join(incomingRoot, token, payload)` が、長さが 2 でない・空・`.` の path をすべて弾く |

### `src/model/service/upload/UploadAdmissionController.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `getUploadRequestFinalizer`、`finishUploadRequest` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え |

### `src/model/service/stream/manager/HlsStreamIdAllocator.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `captureSnapshot` の `sequence > this.snapshotAppliedSequence` | EqualityOperator | 到達不能: 連番は常に増えるので等号になることがない |
| `findAvailable` の `unavailable.has(candidate)` とその throw | BlockStatement、ConditionalExpression、StringLiteral | 到達不能: 距離順に並べた連続した使用中の id の次は必ず空いているので、true になるのは 2^53 個の id が埋まったときだけ |

### `src/model/service/stream/manager/StreamManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `NULL_STREAM_ID_ALLOCATOR`（object と各 method） | ObjectLiteral、ArrowFunction | 定数表で判定できない: module 先頭で評価される式 |
| `MEDIA_DELIVERY_START_TIMEOUT_MS` | ArithmeticOperator | 定数表で判定できない: 30 秒で時間切れになることを確かめる test がある |
| `startRecorded` の `stream !== null && adopted` | LogicalOperator、ConditionalExpression | 冗長: `adopted` が true なら stream は必ずある |
| `startRecorded` の `startedStream === null` の判定と throw | ConditionalExpression、BlockStatement、StringLiteral | 到達不能: `startInternal` が解決したとき `startedStream` は必ず設定済み |
| `acquireRecordedDelivery`・`releaseRecordedDelivery` の状態名の文字列（`'stopping'`・`'ready'`） | StringLiteral | 振る舞いが変わらない: 状態は `'starting'` との比較にしか使われず、別の文字列でも結果が同じ |
| `acquireRecordedDelivery` の `active.state === 'starting'` | ConditionalExpression | 冗長: 続く `rejectStart` が状態を見て何もしない |
| `clearRecordedDeliveryStartTimer` の `startTimer === null` の判定、`releaseRecordedDelivery` の `clearRecordedDeliveryStartTimer`、`startInternal` の `resources.adopt(() => this.clearStartTimer(...))`、`clearStartTimer` の判定 | ConditionalExpression、CallExpression、ArrowFunction、BlockStatement | 冗長: timer の解除が二重（取得の成功時と解放時、開始の確定時と停止時）になっている。`clearTimeout(null)` は無害 |
| `rejectStart` の `startResult.settled = true`・`clearStartTimer(active)` | BooleanLiteral、CallExpression | 冗長: 続く `stopActive` → `finalizeActive` が同じ後始末をする |
| `startInternal`・`runStart` が `rejectStart` に渡す停止理由 `'start-failed'` | StringLiteral | 振る舞いが変わらない: 停止理由は後始末の callback に渡るが、誰も使っていない |
| `runStart` の失敗・無効化の後始末の分岐（`canSettleStart` の判定、else の block） | ConditionalExpression、BlockStatement | 冗長: 後始末は finalize 側で行われるため、省いても観測できる結果が同じ |
| `settleLateStart` の `finalizePromise !== null` | ConditionalExpression | 到達不能 |
| `recheckManagedIdReservation` の `this.idAllocator.isAvailable() === false` | ConditionalExpression | 冗長: NULL allocator は常に衝突なしを返すので同じ結果になる |
| `finalizeActive` の `startResult.settled === false` | ConditionalExpression | 冗長: 既に確定済みなら再度の reject は無視される |

### `src/model/service/encode/EncodeFileManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `getFilePath` の `result === null` の判定と throw | BlockStatement、ConditionalExpression、StringLiteral | 到達不能: `while (1)` の中で必ず代入される（source にも到達不能の目印がある） |
| `getFilePath` の `usedFileNameIndex[result] = true` | BooleanLiteral | 振る舞いが変わらない: 判定は `typeof ... !== 'undefined'` なので、値が false でも使用済みとして扱われる |

### `src/model/service/encode/EncodeManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `legacyRecordedResourceUsePort`（object と `acquire`）、`NEEDS_CHECK_QUEUE_EVENT`、`UNLOCK_EVENT` | ObjectLiteral、ArrowFunction、StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |
| `checkQueue` の `waitQueue.length === 0` | ConditionalExpression | 冗長: 空なら直後の `shift()` が undefined になり、続く `typeof encoder === 'undefined'` で同じ結果になる |
| `checkQueue` の `typeof encoder === 'undefined'` の判定と、その中の `unLockExecution` | ConditionalExpression、BlockStatement、StringLiteral、CallExpression | 到達不能: 直前の判定が空を弾くので来ない |
| `createFinishEncodeInfo` の `outputFilePath === null`・`fileName === null` | LogicalOperator、ConditionalExpression | 冗長: 2 つは常に一致する |
| `hasSamVideoFileIdItem` の `option.encodeId !== excludeEncodeId` | ConditionalExpression | 冗長: 待機 queue に自身は入らないので、除外の有無で結果が変わらない |
| `getQueuedAndRunningRecordedIds` の `option === null` の判定 | ConditionalExpression、BlockStatement | 振る舞いが変わらない: option が null のとき `null.recordedId` が例外になり、外側の catch で同じ `unknown` を返す |

### `src/model/service/encode/EncodeProcessManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `release` の `handles.delete(processInfo.handle)` | CallExpression | 振る舞いが変わらない: 解放済みの handle は `slotReleased` で判定されるため、delete の有無で結果が変わらない（メモリだけ） |
| `killAndCreateProcess` の `slotReleasedAt` の期限の判定 | ConditionalExpression | 冗長: 解放が期限内なら `stopAndRelease` が先に確定しており、後から来る timeout 側の reject は race の結果に影響しない |

### `src/model/service/encode/EncoderModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `progressDecoder` の初期値、`updateEncodingProgressInfo`・`resetProgressDecoder` の `new StringDecoder('utf8')` | StringLiteral | 振る舞いが変わらない: 空文字は utf8 と同じ扱い |
| `start` の `this.encodeOption?.mode`、`cancel` の `this.childProcess?.pid`・`this.encodeOption?.encodeId` | OptionalChaining | 冗長: その時点で `encodeOption`・`childProcess` は null でない |
| `start` の `outputDirPath === null || typeof encodeCmd.suffix === 'undefined'` | LogicalOperator、ConditionalExpression、StringLiteral | 冗長: 2 つの条件は常に一致する |
| `childEndProcessing` の `this.timerId !== null` | ConditionalExpression | 振る舞いが変わらない: null への `clearTimeout` は無害 |
| `childEndProcessing` の `this.listener.removeAllListeners()` | CallExpression | 冗長: `once` で登録した listener は emit で消えており、ほかに listener が無い |
| `ENCODE_FINISH_EVENT` | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |
| `MAX_PROGRESS_RECORD_BYTES` | ArithmeticOperator | 定数表で判定できない: 超過時の動作は test が確かめているが、値そのものの境界は確かめていない |

### `src/model/epgUpdater/EPGUpdateManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| constructor の `excludeChannelIndex`・`excludeSidIndex` の値 `true` | BooleanLiteral | 振る舞いが変わらない: 判定は `typeof ... === 'undefined'` なので値は使われない |
| `saveProgram` の `program.id in deleteIndex`・`removeData.id in updateIndex`・`from in updateIndex` | ConditionalExpression | 振る舞いが変わらない: 無いキーの `delete` は無害 |
| `saveProgram` の `else if (event.type === 'redefine')` | ConditionalExpression | 冗長: 残る種別は `redefine` だけ |
| `saveProgram` の `deleteValues.length > 0 || insertValues.length > 0 || ...` | ConditionalExpression | 振る舞いが変わらない: `insertValues` は常に空（insert は使われていない） |
| `saveService` の `serviceData !== undefined` | ConditionalExpression、StringLiteral | 冗長: 常に true |
| `saveService` の `case 'remove'` | ConditionalExpression、StringLiteral | 振る舞いが変わらない: `remove` の本体が空 |

### `src/model/tuner/TunerServerAccessModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `optional`、`defined`、`normalizePrograms` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え |
| `withDeadline` の `disposeLateValue === undefined` | ConditionalExpression | 振る舞いが変わらない: REST の late value では undefined を呼ぶ TypeError が try/catch で握りつぶされる |

### `src/model/tuner/transport/TunerHttpTransport.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `drain`、`collect` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え。呼び出したときの振る舞いは test が確かめている |
| `get` の `cleanupRequestError` の `request?.removeListener` | OptionalChaining | 到達不能: この関数は `cleanup(false)` か request の `close` からしか呼ばれず、どちらも request の生成後 |

### `src/model/tuner/change/MirakurunChangeAdapter.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `asRecord` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え |
| `changeFromFrame` の service frame の `frame.resource === 'service'` の判定（左の項を true にする） | ConditionalExpression | 冗長: program の frame で type が `create`・`update`・`remove`・`redefine` のものは手前で返っており、残る program の frame の type は一覧に無いため、右の項だけで同じ結果になる |

### `src/model/event/EventSetter.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `RESERVE_DELETION_HOLD_LIMIT_MS` | ArithmeticOperator | 定数表で判定できない: 10 分で保留が解けることを確かめる test がある |
| `selectDeletionsAwaitingRecordingEnd` の `deleted.length === 0` の早期 return | ConditionalExpression | 冗長: 空の配列への `filter` も空の配列を返す |
| `setTag` の `tags.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 空の配列では繰り返しが 0 回で、結果が同じ |

### event 名の定数（`src/model/event/` の各 event class）

対象: `EPGUpdateEvent.ts`、`EncodeEvent.ts`、`OperatorEncodeEvent.ts`、`RecordedEvent.ts`、`RecordedTagEvent.ts`、`RecordingEvent.ts`、`ReserveEvent.ts`、`RuleEvent.ts`、`ThumbnailEvent.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| module 先頭の event 名の定数（`UPDATED_EVENT`、`ADDED_EVENT` など `export const` の文字列） | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式。名前は同じ process の中で発火と購読を結ぶ目印で、発火側と購読側が同じ定数を使うため、値が変わっても対応は保たれる。発火した値が購読へ届くことは各 event class の test が確かめている |

### `src/model/service/socketio/SocketIOManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `initialize` の sub directory が無いときの path `'/socket.io'` | StringLiteral | 振る舞いが変わらない: 空文字を渡すと socket.io は指定を無視して既定の `/socket.io` を使う |
| `initialize` の `cors: { origin: '*' }` の中身 | ObjectLiteral | 振る舞いが変わらない: 空の object を渡しても `cors` の既定の origin が `*` で同じ |
| `initialize` の起動 log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |

### `src/lib/TailStream.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `debug` の本体（`err` の有無の判定、`log.stream.error` の呼び出し）と、`debug` を呼ぶ各所（fstat・read・stat の失敗、読み取り無し、読み取り量、待機）の呼び出しと文言 | ConditionalExpression、BlockStatement、CallExpression、StringLiteral | 振る舞いが変わらない: log だけ（`err` の無い呼び出しは何も出さない） |
| 診断文言の定数（`EOF_NO_DATA_TO_READ_DEBUG_MESSAGE` など）と `formatReadBytesDebugMessage` | StringLiteral、ArrowFunction、ArithmeticOperator | 定数表で判定できない: module の読み込み時に評価される式。log の文言だけ |
| `getFd` の open 完了時の `readPending !== 0` なら `doRead` | ConditionalExpression | 冗長: `doRead` が先頭で `readPending === 0` を弾く |
| `scheduleIdleCheck` の timer の中の条件 | ConditionalExpression、LogicalOperator | 振る舞いが変わらない: 条件が真のとき呼ぶのは出力の無い `debug` だけ |
| `_read` の `checkIdleTimer !== null`、`clearTimers` の `checkIdleTimer`・`checkFileTimer`・`openRetryTimer` の `!== null` | ConditionalExpression | 振る舞いが変わらない: `clearTimeout(null)` は無害 |
| `_read` の `getFdInProgress` の判定と中の block | ConditionalExpression、BlockStatement | 冗長: 続く `getFd` が同じ判定で何もせず戻る（差は `debug` だけ） |
| `dispose` の `isClosed` なら return | ConditionalExpression | 冗長: 2 回目の `dispose` も、状態と timer を 0 に戻し、閉じる fd が無いだけで結果が同じ |

### `src/model/ExecutionManagementModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `exeQueue` の初期値 | ArrayDeclaration | 冗長: 余計な要素は `grantNext` が状態の不一致で読み捨て、ID の使用判定にも影響しない |
| `allocateExecutionId` の `attempt < this.maxExecutionId` | EqualityOperator | 冗長: 1 周して全部使用中なら、1 回余分に試しても最初の候補が使用中のまま |
| `expire` の `clearTimeout(entry.timerId)`、`removeEntry` の `allocationQueue` 側 | CallExpression | 冗長: 期限の timer は既に発火済みで、`allocationQueue` の期限切れ entry は直後の `assignAllocationWaiters` が読み捨てる |
| `expire` の log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |
| `assignAllocationWaiters` の割り当て後の `allocationQueue.shift()` | CallExpression | 冗長: 状態が `waiting` に変わった entry は次の周回で読み捨てられる |
| `startOwnerWatchdog` の timer の中の `entry.state !== 'granted'` | ConditionalExpression | 冗長: `owner` が entry である間に状態が `granted` 以外になるのは watchdog 自身だけ |
| `grant` の `owner`・`id`・`state` の 3 条件のうち個別の 1 条件、条件の組み合わせの変更 | ConditionalExpression、LogicalOperator | 冗長: 3 条件が同じ事実（今の保持者が自分であること）を重ねて検査している。全体を外す変更は test が殺している |
| `UNLOCK_EVENT` | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式。名前は内部の目印 |

### `src/model/PromiseQueue.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `queue` の初期値 `Promise.resolve(true)` | BooleanLiteral | 振る舞いが変わらない: 初期値は待つだけで、値は使われない |

### `src/model/ConnectionCheckModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 確認の開始を知らせる log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |

### `src/model/LoggerModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `readLogFile` の `let str = ''` | StringLiteral | 振る舞いが変わらない: 直後に必ず読み込みで上書きされるか `process.exit` する |
| `readLogFile` の `typeof str === 'undefined'` の判定と中身 | ConditionalExpression、StringLiteral、BlockStatement、CallExpression | 到達不能: `str` は文字列で、undefined にならない（到達不能の目印が source にある） |
| `createDefaultLogPath` の `process.platform === 'win32'` | ConditionalExpression | 振る舞いが変わらない: Linux では path に `\` が無く、置換しても同じ |

### `src/model/ServiceChildRecordedUseRegistry.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `GRANTED`・`BLOCKED`・`UNKNOWN`・`BUSY` | ObjectLiteral | 定数表で判定できない: module 先頭で評価される式。返す状態は test が確かめている |
| `release` の `isReleaseInput` の判定と、その中の `isPeer`・`isRequestId` の組み合わせ | ConditionalExpression、LogicalOperator | 冗長: 不正な peer・request id は、続く lease の検索で見つからず `unknown` になる |
| `release` の `unknownLeases.delete(lease)` | CallExpression | 振る舞いが変わらない: 解放した lease は他から参照されず、`WeakSet` に残っても判定に使われない |
| `tryAcquireDeletion` の `[...(leases ?? [])]` の既定の空配列 | ArrayDeclaration | 振る舞いが変わらない: 要素が文字列でも `WeakSet.has` は false |
| `releaseDeletion` の `recordedId === undefined` | ConditionalExpression | 冗長: 続く `deletionTokens.get(undefined) !== token` が同じ結果 |

### `src/model/epgUpdater/EPGUpdateExecutorManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 起動 log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |
| `settleTerminal` の `lateErrorScope` の既定値 `'none'` | StringLiteral | 振る舞いが変わらない: `'close'`・`'same-tick'` 以外はどの枝にも入らない |

### `src/model/epgUpdater/EPGUpdater.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| constructor の `PROGRAM_UPDATED`・`SERVICE_UPDATED` の購読 | CallExpression | 振る舞いが変わらない: 購読する関数の本体が空（通知は周期の更新に任せている） |

### `src/model/epgUpdater/EPGUpdateExecutor.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `runEPGUpdateExecutor` の既定の container の分岐、file 末尾の自己起動の判定 | ConditionalExpression、StringLiteral、EqualityOperator、BlockStatement、CallExpression | Stryker で判定できない: 実際の子 process として起動する test でしか通らず、Stryker は子 process の mutant を有効にできない。その test（`epg-update-executor-entry-seam.test.ts`）は実 process でこの分岐の結果を確かめている |

### `src/model/operator/recordedTag/RecordedTagManadeModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `create`・`update`・`setRelation`・`delete`・`deleteRelation` の成功時の log の文言 | StringLiteral | 振る舞いが変わらない: log だけ |

### `src/model/operator/recording/RecordingRecordedUseProvider.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `UNKNOWN_SNAPSHOT`・`UNKNOWN_DELETION`・`BUSY_DELETION` | ObjectLiteral | 定数表で判定できない: module 先頭で評価される式。返す状態は test が確かめている |

### `src/model/operator/storage/StorageRecordedUseSnapshotAdapter.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `UNKNOWN` | ObjectLiteral | 定数表で判定できない: module 先頭で評価される式。返す状態は test が確かめている |
| `readRecordingSnapshot`・`readServiceChildSnapshot` の catch を空にする | BlockStatement | 振る舞いが変わらない: undefined を返しても、続く検査で known でないと判定され同じ `unknown` になる |
| `isRecordedId` の `typeof recordedId === 'number'` | ConditionalExpression | 冗長: 続く `Number.isSafeInteger` が数でない値を弾く |

### `src/util/ProcessUtil.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `ROOT_PATH` | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |

### `src/model/operator/recording/RecorderModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 録画の各処理の log の文言と `log.system.*` の呼び出し（`cleanupPendingRegistration` の削除失敗の記録、録画の開始・失敗・終了の記録など） | StringLiteral、CallExpression、BlockStatement | 振る舞いが変わらない: log だけ |
| `bindScheduleSession` の `previous !== null && bindingChanged` の左の項、RetryWaiting を引き継ぐ条件の `binding.phase === 'RetryWaiting'`・`this.retryTimerId !== null` の確認、`recordRegistrationTerminationIntent` の `current === null` の早期 return、`hasRegistrationOwner` の `binding !== null` | ConditionalExpression、LogicalOperator | 冗長: `bindingChanged` が `previous !== null` を含む。ほかも `scheduleRetry` や `matchesRegistrationOwner` 側の確認と重なり、外しても観測できる結果が同じ |
| `promoteRegistrationTerminationIntent` の優先度の比較 `<=` | EqualityOperator | 振る舞いが変わらない: 優先度が等しいときは、return しても代入しても `owner.intent` が同じ値のまま |
| `setTimer` の `timerId !== null` の確認（2 か所）と、待ち時間が負のときの `time < 0` の補正 | ConditionalExpression | 振る舞いが変わらない: `clearTimeout(null)` は無害で、負の待ち時間は `setTimeout` が 1 ms に丸めるので 0 のときと結果が同じ |
| `setEventRelayTimer` の `time < 0` の補正 | ConditionalExpression | 振る舞いが変わらない: 同上 |
| 録画準備の `currentSchedule === null \|\| !currentSchedule.tryTransition('Preparing', 'Recording')` の左の項、録画準備の終了時の `currentRetryPhase === null \|\| !transitionSchedulePhase(...)` の左の項 | ConditionalExpression、LogicalOperator | 冗長: null を渡すと直後の例外処理か、null の phase からの遷移の失敗で、同じ後始末と return になる |
| `destroyAcquiredStream` の `acquiredStream === null \|\| this.stream === acquiredStream` の左の項 | ConditionalExpression、LogicalOperator | 冗長: 直前の `acquiredStream === null && this.stream !== null` の return により、左の項が true のとき `this.stream` も null で、右の項が同じ結果になる |
| 録画終了後の drop 検査停止の `isEnabledDropCheck === true` | ConditionalExpression | 振る舞いが変わらない: drop 検査が無効なら停止処理の中で何も起きない |
| 録画開始処理（`doRecord`）の登録 owner と watchdog の二重 guard（watchdog 停止後の `registrationOwner === null` の確認、`registrationOwner === null \|\| registrationOwner.intent !== 'Deletion'`、取消の意図の判定、`registeringSchedule`・`activeSchedule` の null 確認、登録済みを示す flag の代入） | ConditionalExpression、LogicalOperator、BooleanLiteral、OptionalChaining | 冗長: 先に watchdog が止まる、または owner は非 null でしか呼ばれないため、同じ確認を重ねているだけ |
| 先頭データの観測を示す `firstDataObserved = true` | BooleanLiteral | 振る舞いが変わらない: `settleFailure` が同期で結果の確定を立てるので、この値は届かない |
| `_cancel` の `else if (this.isRecording === true)`、`cancel` の対象 phase の一覧の `'RetryWaiting'` | ConditionalExpression、StringLiteral | 到達不能: 前の分岐で除かれる、または同じ値の代入 |
| `cleanupPendingRegistration` の最後の `resources.videoFileId !== null`・`resources.recordedId !== null`・`resources.dropLogFileId !== null`（`this.xxxId === resources.xxxId` との `&&` の左の項を true にする） | ConditionalExpression | 冗長: 左の項が false（`resources` 側が null）のとき、右の項が true になるのは `this` 側も null のときだけで、null を null に代入するだけで結果が変わらない |
| `stopForDeletion` の `currentSchedule !== null && deletionPhase !== null` の左の項を true にする | ConditionalExpression | 冗長: `currentSchedule` が null のとき `deletionPhase` も必ず null なので、右の項だけで同じ結果になる |
| `registrationTerminationIntentPriority`（終了の意図の優先度の表） | ObjectLiteral、NumericLiteral | 定数表で判定できない: 優先順の全組み合わせは test が確かめている |
| `CANCEL_EVENT`、`START_RECORDING_EVENT`、`EVENT_RELAY_CHECK_TIME` | StringLiteral、ArithmeticOperator | 定数表で判定できない: 値を確かめる test がある |

### `src/model/operator/recording/RecordingManageModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 録画管理の各処理の log の文言と `log.system.*` の呼び出し（予約の削除・追加・再試行・起動時の整理など） | StringLiteral、CallExpression、BlockStatement | 振る舞いが変わらない: log だけ |
| `observePreparingRecordedUse` の `recorder === undefined`、`observeActiveRecordedUse` の `unknown !== undefined && unknown !== recorder` の左の項 | ConditionalExpression | 振る舞いが変わらない: `undefined` の使用登録を解放しても何も起きない |
| `observeNormalRecordedUseTerminal`・`releaseRecordedUse`・`releaseRecordedUsesForReservation` の `normalRecordedUseTerminals.delete(...)`・`unknownRecordedUseSessions.delete(...)`・同じ値かの確認 | CallExpression、ConditionalExpression | 冗長: 録画の終端を待つ map と不明な使用登録の map の掃除は他の経路でも同じ状態になる |
| `isAwaitingNormalRecordedUseTerminal`・`releaseRecordedUse`・`findActiveRecordedUse`・`isRecordedUseId` の確認 | ConditionalExpression、LogicalOperator | 冗長: `findActiveRecordedUse` と `releaseRecordedUse` が互いに同じ確認を重ねており、片方を外しても他方が担保する |
| `isCurrentRecordingFailure` の `currentCandidate?.generation === failure.generation`（true への置き換えと `?.` を外す変更の 2 件） | ConditionalExpression、OptionalChaining | 冗長: 直前の `getSessionSnapshot` が候補の世代で session を作るので、session の世代の確認が候補の世代の確認と同じ事実を検査済み。session が取れているとき候補も必ずある |
| `failCandidateStartup` の起動前の変更・録画失敗の退避配列の掃除、`rebuildCandidatesAndStartInternal` の先行の flush と、skip・重複を個別に false にした変種 | CallExpression、ConditionalExpression、BlockStatement | 冗長: 起動に失敗したあとは再実行されないので、退避配列の掃除や先行の flush は観測できない。skip・重複を個別に false にした変種は `rebuildCandidates` の後段で同じ結果になる |
| `snapshotStartupMutationRows` の予約の行の検証、`ensureScheduleStarted` の確認、`applyScheduleMutation` の `current === undefined \|\| candidate === undefined \|\| ...` と `recorder !== undefined && indexedToken !== undefined && ...` の組み合わせ | ConditionalExpression、LogicalOperator | 冗長: 検証に失敗しても catch で同じ分岐になる、`ensureScheduleStarted` は起動済みのときにしか呼ばれない |

### `src/model/operator/recording/RecordingUtilModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 録画 file の移動・保存先の整理の log の文言と、catch の中が log だけの block | StringLiteral、CallExpression、BlockStatement | 振る舞いが変わらない: log だけ |
| `_getRecPath` の `reserve.parentDirectoryName === null` の分岐 | ConditionalExpression、BlockStatement | 冗長: この分岐を外しても、後の「見つからなければ先頭の保存先」で同じ結果になる |
| `cleanupOverdueRecPath` と `_getRecPath` の `typeof err.code !== 'undefined' && err.code === 'ENOENT'` の左の項 | ConditionalExpression、StringLiteral | 冗長: 右の項が定義済みを含意する |
| `movingFromTmp` の `isMoveCompleted === true && finalCloseError !== undefined` の左の項 | ConditionalExpression | 到達不能: ここへ来る時点で `isMoveCompleted` は常に true |
| `isReserveSource`（module 先頭の arrow function）、`GET_REC_PATH_LOCK_TIMEOUT`、`GET_REC_PATH_OWNER_TIMEOUT` | ArrowFunction、ArithmeticOperator | 定数表で判定できない: module の読み込み時に評価される式。`getExecution(1, 5000)` の引数と 600,000 ms の境界は test が確かめている |

### `src/model/operator/recording/DropCheckerModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| log の文言と log 呼び出し | StringLiteral | 振る舞いが変わらない: log だけ |
| `attach` の `TsPacketSelector` の設定（`pids`・`programNumbers`）、`pmt` の登録、selector への pipe | ObjectLiteral、ArrayDeclaration、CallExpression | 振る舞いが変わらない: selector の出力はどこにも繋がっておらず、設定しても観測できない |
| `onFinish` の `removeAllListeners('finish')` の文字列 | StringLiteral | 振る舞いが変わらない: `finish` は一度しか発火しない |
| `getLogFilePath` の `typeof err.code !== 'undefined' && err.code === 'ENOENT'` の左の項 | ConditionalExpression、StringLiteral | 冗長: 右の項が定義済みを含意する |
| `appendFile` の `this.dest === null` の確認と throw、`getResult` の `this.result === null` の確認と throw | ConditionalExpression、BlockStatement、StringLiteral | 到達不能: `attach` は `prepare` の後にしか呼ばれず、`dest`・`result` は null にならない |
| `FINISH_EVENT` | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式。結果待ちの test が通る |

## DB（`stryker.db.config.mjs`）

### `src/model/db/ProgramDB.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `createProgramValue` の `genres[n].lv2` が undefined かの判定 | ConditionalExpression、StringLiteral | 振る舞いが変わらない: undefined のまま渡しても DB は NULL を保存する（TypeORM が undefined の列を省く） |
| `createProgramValue` の `description`・`extended` が未定義のときの `{}` | BlockStatement | 振る舞いが変わらない: 列の既定が NULL で同じ |
| `findEventRelayProgram` の `typeof result === 'undefined' ? null : result` | ConditionalExpression、StringLiteral | 到達不能: `findOne` は該当なしのとき null を返し、undefined にならない |
| `findRule` の `query.strs[i].length === 0` | ConditionalExpression、BlockStatement | 到達不能: `strs` に空文字は入らない |
| `createOverlapQueryStr` の `periodToAvoidDuplicate` の判定 | ConditionalExpression、LogicalOperator、StringLiteral、EqualityOperator | 振る舞いが変わらない: undefined・0 のとき期間は NaN・0 のどちらでも 0 扱いで同じ |
| `findSchedule` の `option.isFree` の判定 | ConditionalExpression、StringLiteral | 振る舞いが変わらない: undefined の条件は適用されない |

### `src/model/db/DBOperator.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `getRegexpStr`、`getLikeStr` の `case 'sqlite':` | StringLiteral | 振る舞いが変わらない: default へ落ちて同じ結果になる |

### `src/model/db/DBUtil.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `resolvePagination` の `{ skip: undefined, take: undefined }` | ObjectLiteral | 振る舞いが変わらない: `{}` にしても未定義の項目になり同じ |

### `src/model/db/RecordedDB.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `findAll` の `nameAnd.length > 0`・`descriptionAnd.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 配列は必ず 1 件以上入るので同じ |
| `findChannelList`、`findGenreList` の query builder の alias | StringLiteral | 振る舞いが変わらない: alias は使われない |

### `src/model/db/RecordedTagDB.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `findRecorded` の `typeof recorded === 'undefined' \|\| recorded == null` | ConditionalExpression、StringLiteral | 冗長: 後ろの `== null` で足り、前半は冗長 |
| `findAll` の `nameAnd.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 配列は必ず 1 件以上入るので同じ |

### `src/model/db/ReserveDB.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `updateMany` の `values.delete`・`values.insert`・`values.update` の `length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 空の配列で delete・insert・update を呼んでも何も起きない |
| `createFindOption` の `pagination.skip`・`pagination.take` が undefined かの判定 | ConditionalExpression、StringLiteral | 振る舞いが変わらない: undefined を渡すと適用されない |
| `findTimeRanges` の索引の値 `true` | BooleanLiteral | 振る舞いが変わらない: 索引の値は `typeof ... !== 'undefined'` でしか使わない |
| `getManualIds`、`getRuleEventRelayIds` の query builder の alias と `orderBy` の文字列 | StringLiteral | 振る舞いが変わらない: 並びは主キー順で同じ、alias は使われない |
| `countByRuleIds` の `ruleIds.length === 0` の早期 return | ConditionalExpression | 振る舞いが変わらない: `In([])` は空で、同じ結果になる |

### `src/model/db/RuleDB.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `findId` の `typeof result === 'undefined' \|\| result == null` | ConditionalExpression、StringLiteral | 冗長: 後ろの `== null` で足り、前半は冗長 |
| `convertRuleToDBRule` の各項目（`keyword`・`ignoreKeyword`・`channelIds`・`genres`・`times`・`durationMin`・`durationMax`・`searchPeriods`・`periodToAvoidDuplicate`・`tags`・エンコード設定の mode・directory・親 directory 名）が undefined かの判定 | ConditionalExpression、StringLiteral | 振る舞いが変わらない: undefined のまま渡しても DB は NULL を保存する（TypeORM が undefined の列を省く） |
| `convertRuleToDBRule` の `typeof rule === 'undefined' ? 0 : rule.updateCnt`、`typeof rule.id !== 'undefined'` | ConditionalExpression、StringLiteral | 振る舞いが変わらない: `rule` は常に定義済み。id が無くて undefined を渡しても自動採番される |
| `findAll`・`findKeyword` の `keywordAnd.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 配列は必ず 1 件以上入るので同じ |
| `findAll`・`getIds` の query builder の alias と `orderBy` の文字列 | StringLiteral | 振る舞いが変わらない: 並びは主キー順で同じ、alias は使われない |

## 配信の本体（`stryker.delivery.config.mjs`）

結合 test も対象 test に入れた設定（`npm run mutation:delivery`）での生き残り。

### `src/model/service/stream/base/RecordedStreamBaseModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `videoFileType` の初期値 `'encoded'` | StringLiteral | 定数表で判定できない: `start` の最初に必ず `setVideFileInfo` が上書きするので、初期値は使われない |
| ログ文言を作る `createEncodeProcessLogMessage`・`createEncodeProcessFailureLogMessage` | ArrowFunction、StringLiteral | 定数表で判定できない: module 先頭で評価される式。log の文言だけ |
| `start` の `processOption === null` の確認 | ConditionalExpression | 冗長: 直後の `setVideFileInfo` が同じ message で拒否する |
| `start` の入力 reader を作る条件 `videoFileType === 'ts'` | ConditionalExpression | 冗長: 入力 reader が存在するのは `ts`（reader つきの再生元または file stream）のときだけで、`encoded` では入力 reader が null |
| `stopInternal` の `getStreamType() === 'RecordedHLS'` | ConditionalExpression | 冗長: 非 HLS では `prepStreamDir` が呼ばれず、`getHlsStopFinalization()` も null を返す |
| `observeManagedProcessTerminal` の再入の確認と、`close`・`error`・`exit` の listener の取り外し | ConditionalExpression、BlockStatement、StringLiteral、CallExpression | 冗長: 再入の確認と listener の取り外しは重複した安全策。close・error・exit のいずれかが一度来ると他の listener は外れ、再入しない |
| `finishProcessStartGeneration` の `pendingHlsWriterStops.add(finalization)` | CallExpression | 振る舞いが変わらない: 追跡専用で、判定には使われない |

### `src/model/service/stream/base/LiveStreamBaseModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `createStartSession` の `session.stream === null` | ConditionalExpression | 到達不能: 直前で tuner の stream を取得済みで、null にならない |
| `setMirakurunStream` の `processOption !== null` | ConditionalExpression | 到達不能: 冒頭で null を弾いており、この catch で null にならない |
| `setMirakurunStream` が tuner の stream の `close`・`end`・`error` に登録する listener の `once`（true → false） | BooleanLiteral | 冗長: 3 つの handler は `closeTunerStream` で、同じ handle の 2 回目以降は先頭の確認で何もしない。listener は session の後始末でも外す |
| `closeTunerStream` の `tunerStreamHandle` の代入 | ConditionalExpression、AssignmentOperator | 振る舞いが変わらない: `tunerStreamHandle` は書き込み専用の field で、読む所が無い |
| `disposeSession` の `getStreamType() === 'LiveHLS'` | ConditionalExpression | 冗長: 非 HLS では `getHlsStopFinalization()` が null を返すので同じ結果になる |
| `disposeSession` の `activeStartSession === session` | ConditionalExpression | 冗長: 後始末されるのは現行の session だけ（新しい start の前に古い session は後始末される） |

### `src/model/service/stream/base/StreamBaseModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `checkStreamDir` の `typeof err.code !== 'undefined'` | ConditionalExpression、StringLiteral | 冗長: 続く `err.code === 'ENOENT'` の確認が決める |
| `stop`・`startCheckStreamEnable`・`setStopTimer` の `streamCheckTimer !== null`・`streamStopTimer !== null` | ConditionalExpression | 振る舞いが変わらない: `clearInterval(null)`・`clearTimeout(null)` は無害で、後に null を代入するだけ |
| `stop` の `emitter.removeAllListeners(EXIT_EVENT)` | CallExpression | 冗長: 直前の emit で `once` の listener は消えており、他に listener が無い |
| `EXIT_EVENT` | StringLiteral | 定数表で判定できない: 発行側と購読側が同じ定数を使うので、値を変えても動作が同じ |

### `src/model/service/stream/util/HLSFileDeleterModel.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `deleteAllFiles`・`deleteArtifact` の log の method 名 `'info'` | StringLiteral | 振る舞いが変わらない: `'error'` 以外は info に流れるので同じ |
| `scan` の正規表現の `^` | Regex | 冗長: 続く `isHlsArtifactForStream` が `startsWith` で同じ判定をする |
| `isHlsArtifactForStream` の `suffix.length > 0`・`/[0-9]/u.test(suffix.charAt(0)) === false` | ConditionalExpression、EqualityOperator | 定数表で判定できない: report が `static` と報告する行。`stream1`（拡張子無し）を artifact に数えないこと、`stream10` を `stream1` のものにしないことは test が確かめている |

### `src/model/service/stream/recorded/DeliveryRecordedUseSnapshotProvider.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `remove` の `count === undefined` | ConditionalExpression | 到達不能: 解除は register の後に 1 回だけで、その時点で件数が必ずある |

## client（`client/stryker.client.config.mjs`）

### `src/features/reserves/lib/manualReserveForm.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `EMPTY_TIME_SPECIFIED_OPTION`、`EMPTY_ENCODE_OPTION`、`MANUAL_RESERVE_TIME_ZONE` | ObjectLiteral、BooleanLiteral、StringLiteral | 定数表で判定できない: module の読み込み時に評価される式 |
| `formatManualDateTimeInput` の `value === null \|\| value === undefined` | ConditionalExpression | 振る舞いが変わらない: `new Date(undefined)` は NaN で、空文字になる |
| `parseManualDateTimeInput` の `trimmed === ''` | ConditionalExpression、StringLiteral、BlockStatement | 振る舞いが変わらない: 空文字は正規表現に合わず null になる |
| `parseManualDateTimeInput` の正規表現の `^`・`$` | Regex | 冗長: 余計な文字が付いた入力は、後段の往復検査（書式化して元の入力と一致するか）で一致せず null になる |
| `parseManualDateTimeInput` の月・日・時・分の範囲検査と `Number.isNaN`、`daysInManualReserveMonth` の block | ConditionalExpression、LogicalOperator、BlockStatement | 冗長: 範囲検査を外しても `Date.UTC` が繰り上げ、直後の往復検査（コメントに defense in depth とある）で必ず null になる。境界の `<=`・`>=` への変更は test が殺している |

### `src/features/reserves/lib/manualReservePayload.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `buildManualReserveAddPayload` の `parsedTimeSpecifiedOption?.success` を含む条件 | OptionalChaining、ConditionalExpression、LogicalOperator | 冗長: `isTimeSpecification` が true のとき `parsedTimeSpecifiedOption` は必ず null でない（`?.` は型のための記述）。false のとき `&&` は短絡する |

### `src/features/reserves/lib/reserveSelection.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `toggleVisibleReserveSelection` の `visibleReserveIds.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 表示が空のときは「全部選択済み」でも「未選択」でも、返る集合が同じ |

### `src/features/search/rule/lib/rulePayload.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `SEARCH_RULE_PAYLOAD_SCHEMA`（zod の schema の object と `custom` の検査） | ObjectLiteral、ArrowFunction | 定数表で判定できない: module の読み込み時に評価される式。schema が受け付ける形・拒否する形は `rulePayload` の test が確かめている |

### `src/features/search/rule/lib/searchRequest.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `parseTimeTextToSeconds` の `value === null` | ConditionalExpression | 振る舞いが変わらない: null は正規表現に合わず null になる |
| `parseTimeTextToSeconds` の `Number.isInteger` を含む検査 | ConditionalExpression、LogicalOperator | 冗長: 正規表現で数字だけと確かめた後の `Number.isInteger` は常に true |
| `appendBroadcastWaveOption` の `channelIds.length > 0 \|\| entries.length === 0 \|\| areAllVisibleEnabled` | ConditionalExpression、LogicalOperator | 定数表で判定できない: report が `static` と報告するため判定できない。チャンネル指定のとき・表示できる放送波が無いとき・全部有効なときに放送波を送らないことは test が確かめている |

### `src/features/search/rule/lib/searchRoute.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `parseInteger` の `value === null` | ConditionalExpression | 振る舞いが変わらない: null は `/^\d+$/` に合わず undefined になる（report は `static` と報告する） |
| `parseRuleRoute` の `page < 1` | EqualityOperator | 振る舞いが変わらない: page が 1 のとき 1 を返すので同じ |

### page 番号・選択の解析（`features/recorded/requests/listRequest.ts`、`features/recording/recordingRequests.ts`、`features/reserves/lib/reservesListRequests.ts`、`features/encode/encodeRequests.ts`、`features/guide/lib/guideRoute.ts`）

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `parsePositivePage` の `value === null \|\| value === ''` と `parsed >= 1` | ConditionalExpression、LogicalOperator、StringLiteral、EqualityOperator | 振る舞いが変わらない: 省略すると `Number('')`・`Number(null)` が 0 になり、続く `>= 1` で同じ結果（既定の 1、または undefined）になる。page が 1 のとき両方 1 |
| `toggleVisibleRecordedSelection`・`toggleVisibleRecordingSelection`・`toggleVisibleEncodeSelection` の `visible...Ids.length > 0` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 表示が空のときは「全部選択済み」でも「未選択」でも返る集合が同じ |

### `src/features/recorded/requests/listRequest.ts`、`recordingRequests.ts`、`encodeRequests.ts`、`storagesRequests.ts`、`reservesListRequests.ts`、`reservesFetch.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `RECORDING_QUERY_KEY`・`RECORDING_FAILURE_MESSAGE`、`ENCODE_QUERY_KEY`・`ENCODE_FAILURE_MESSAGE`、`STORAGES_QUERY_KEY`・`STORAGES_FAILURE_MESSAGE`・`STORAGE_SIZE_UNITS`、`RESERVES_QUERY_KEY`・各 message・`RESERVES_ROUTE_TITLES`（予約の種別の題名）、`reservesFetch.ts` の `resolveDefaultFetch` | StringLiteral、ArrayDeclaration、ObjectLiteral、ArrowFunction | 定数表で判定できない: module の読み込み時に評価される式。取得失敗・更新の文言と予約の種別の題名は値を確かめる test がある |
| `parseReservesType` の先頭の `normal` の判定 | ConditionalExpression | 冗長: 外しても続く既定の分岐が同じ値を返す |
| `formatStorageSize` の `value > 0`（`>= 0` との違い） | EqualityOperator | 振る舞いが変わらない: 0 のとき同じ |

### `src/features/recorded/requests/`（`addEncode.ts`、`bulkDelete.ts`、`fileSize.ts`、`searchPath.ts`、`uploadForm.ts`）

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `resolveAddEncodeParentDirectory` の `storedParentDirectory !== undefined`・`!== null` | ConditionalExpression | 振る舞いが変わらない: 一覧に null・undefined は含まれないため、`includes` が false で同じ結果 |
| `bulkDelete` の対象を選ぶ `(item.videoFiles ?? [])` の既定の配列 | ArrayDeclaration | 振る舞いが変わらない: 余分な要素（文字列）は `id` が無く、続く処理で除かれる |
| `formatRecordedFileSize` の `typeof size === 'number'` | ConditionalExpression | 冗長: 外しても `Number.isFinite(undefined)` が false で 0 になる |
| `createRecordedSearchKeyword` の区切り文字が空のときの分岐 | ConditionalExpression | 冗長: 全体を返すのと同じ結果（`slice(0, 0)` の空は元の題名に戻る） |
| `validateRecordedUploadForm` の `duration !== null` | ConditionalExpression | 冗長: 続く `duration > 0` が null で false |

### `src/features/guide/lib/guideRoute.ts`、`guideUrls.ts`、`guideDate.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `guideRoute.ts` の時刻・チャンネルの解析で null を調べる判定（`value === null`、`hour < 0 \|\| hour > 23`、月日の食い違いの検査 `parts.year !== year \|\| ...`） | ConditionalExpression、LogicalOperator、EqualityOperator | 冗長: null は `Number(null) = 0` や正規表現の不一致で同じ結果になる。月日の食い違いの検査は年・月・日が互いに重なっていて、1 つを外しても別の項目が検出する |
| `guideRoute.ts` の `enabledBroadcastWaves = []` の既定配列 | ArrayDeclaration | 振る舞いが変わらない: 文字列を入れても `includes('BS4K')` が false |
| `guideUrls.ts` の `createGuideProgramSearchKeyword` の区切り文字が空のときの分岐 | ConditionalExpression | 冗長: 全体を返すのと同じ結果（`slice(0, 0)` の空は元の題名に戻る） |
| `guideDate.ts` の `getJapanDateParts` の `?? '0'` | StringLiteral | 到達不能: 常に値があり、右辺に来ない |
| `guideDate.ts` の `HOUR_MS` | ArithmeticOperator | 定数表で判定できない: module の読み込み時に評価される式。1 時間の長さは test が確かめている |

### `src/features/guide/guideStorage.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isRecord`、`readGuideGenreVisibility`・`readGuideSizeSetting` の `storage === undefined`・`?? 'null'`・非 record の確認 | ConditionalExpression、StringLiteral | 冗長: 非 record は項目ごとの検証で既定値になる。storage が undefined のときは例外から既定値に戻る |
| `GUIDE_GENRE_SETTING_STORAGE_KEY`・`GUIDE_SIZE_SETTING_STORAGE_KEY`・`GUIDE_GENRE_IDS`・`GUIDE_SIZE_FIELD_LIMITS`・`DEFAULT_GUIDE_SIZE_SETTING` | StringLiteral、ObjectLiteral、ArithmeticOperator | 定数表で判定できない: module の読み込み時に評価される式。保存 key・16 ジャンル・既定の大きさ・上限下限は値を確かめる test がある |

### `src/features/recorded/requests/settingsStorage.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isRecord`、`readAddEncodeSetting`・`readSendVideoFileSelectHostSetting` の `raw === null ? null : JSON.parse(raw)`・非 record の確認・`typeof parsed.hostName === 'string' \|\| parsed.hostName === null` | ConditionalExpression | 冗長: 非 object・null は例外か既定値になり、外側の try/catch で既定値に戻る |
| `resolveKodiHostName` の `storedHostName !== undefined && storedHostName !== null` | ConditionalExpression | 振る舞いが変わらない: 一覧に null・undefined は含まれないため、`includes` が false で同じ結果 |
| `ADD_ENCODE_SETTING_STORAGE_KEY`・`DEFAULT_ADD_ENCODE_SETTING` | StringLiteral、ObjectLiteral、BooleanLiteral | 定数表で判定できない: module の読み込み時に評価される式。保存 key と既定値は値を確かめる test がある |

### `src/features/reserves/lib/reserveRoutes.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isSafeHttpUrl` の `url.protocol === 'http:' \|\| ...`、catch の戻り値、`linkifyReserveExtendedText` の `text === undefined \|\| text === ''` | ConditionalExpression、LogicalOperator、BooleanLiteral | 振る舞いが変わらない: 一致した URL は必ず http か https で、catch の戻り値が false でも undefined でも同じ。空の text は後続の処理でも空のまま |

### `src/app/lib/routePath.ts`、`src/app/scroll/memoryScrollHistory.ts`、`src/app/scroll/sessionScrollHistory.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `createFullRoutePathFromBrowserHash` の `replace(/^#/, '')` の `^` | Regex | 冗長: hash は必ず `#` で始まる |
| `memoryScrollHistory.ts` の `getScrollData` の `savedScrollData === null ? null : ...` | ConditionalExpression | 振る舞いが変わらない: 保存値が null のとき `null as T` が null |
| `sessionScrollHistory.ts` の `isScrollPosition`・`isScrollHistoryEntry` の `typeof value !== 'object' \|\| value === null` | ConditionalExpression、LogicalOperator | 冗長: 非 object の項目は後続の型の検査で落ちる |
| `readStoredHistory` の既定の履歴 `history: []` | ArrayDeclaration | 振る舞いが変わらない: 履歴の既定配列に文字列を入れても `slice(0, 0)` で捨てられる |
| `getScrollData` の `currentEntry === null \|\| currentEntry.data === null` | ConditionalExpression | 振る舞いが変わらない: データが null のとき `return null` と `return currentEntry.data` が同じ |
| `SCROLL_HISTORY_STORAGE_KEY` ほか module 先頭の定数 | StringLiteral | 定数表で判定できない: module の読み込み時に評価される式。保存 key は test が確かめている |

### 再生（`src/features/video/playback/`、`src/features/recorded/requests/videoHandoff.ts`、`streamSelect.ts`）

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `buildVideoViewUrl`・`buildRawVideoUrl`・`buildBrowserRelativeApiUrl` の `basePath = './api'` の既定引数 | StringLiteral | 到達不能: 呼び出し元が常に既定の base path を渡すため、既定引数は使われない |
| `buildBrowserRelativeApiUrl` の `basePath.replace(/^\.\//, '/').replace(/\/$/, '')` | Regex、StringLiteral | 冗長: 呼び出し元が常に `./api` を渡す（`^` の有無・末尾 `/` の除去は結果が同じ） |
| `buildRecordedViewUrlSchemeUrl` の `template === undefined \|\| template === null \|\| template.trim() === ''`、`buildRecordedPlaybackHandoffTarget` の `recordedViewUrlScheme !== null` | ConditionalExpression、LogicalOperator | 振る舞いが変わらない: 保存値が空白のとき、既定値への置き換えを経由して同じ結果になる |
| `normalizeRecordedStreamMode`・`resolveRecordedStreamFileConfig`・`resolveRecordedStreamCandidates` の `typeof` の判定、`mode <= 0`、storage が undefined のときの分岐 | ConditionalExpression、LogicalOperator、EqualityOperator | 冗長: `typeof` の判定を外しても `Number.isSafeInteger('x')` が false。`mode <= 0` は 0 のとき同じ。未知のファイル種別は `undefined` のまま。storage が undefined のときは例外から既定値 |
| `readVideoPlayerSetting`・`saveVideoPlayerSetting` の storage が undefined・null の JSON・非 object の分岐と保存の catch | ConditionalExpression、LogicalOperator、BlockStatement | 冗長: storage が undefined・null の JSON・非 object は例外か型の不一致で既定値になり、結果が同じ。保存の catch は false を返す前に同じ結果 |
| `parseFiniteInteger`・`parseOptionalFiniteInteger` の null・undefined の判定、`isRecordedStreamingFileType` の拡張 | ConditionalExpression、LogicalOperator | 冗長: 先頭の判定を外しても、正規表現の不一致か null で同じ結果。拡張した種別は後続の mode 数の 0 で不正になる |
| `rebuildDirectStreamUrlForSeek` の scheme を判定する正規表現の `\d` → `\D` | Regex | 到達不能: 数字を含む scheme は `new URL` が origin を `null` にするため実在しない |
| `LIVE_WATCH_ERROR`・`RECORDED_WATCH_ERROR`・`RECORDED_STREAMING_ERROR`、`VIDEO_PLAYER_SETTING_KEY`・`DEFAULT_VIDEO_PLAYER_SETTING`、`DEFAULT_RECORDED_SELECT_STREAM_SETTING`・`RECORDED_STREAM_TYPE_QUERY` | StringLiteral、ObjectLiteral | 定数表で判定できない: module の読み込み時に評価される式。エラー文言・保存 key・既定値・方式名の query は値を確かめる test がある |

### 設定の保存（`src/shared/settings/settingsStorage.ts`、`src/features/settings/lib/settingsStorageAccess.ts`）

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `shared/settings/settingsStorage.ts` の読み込みの失敗を null にする catch と `JSON.parse(this.readRawSettings() ?? 'null')` | BlockStatement、StringLiteral | 振る舞いが変わらない: 読み込みの失敗は null、`undefined` でも `?? 'null'` で同じ |
| `getReadableSettingsStorage` の `typeof window === 'undefined'`、`createInitialSettingsTmp` の保存の catch | ConditionalExpression、BlockStatement | 冗長: `window` が無いとき `window.localStorage` が例外で、catch が同じ値を返す。保存の catch は repository 側の例外処理で同じ結果 |

### 要求の組み立て（`src/features/dashboard/dashboardRequests.ts`）

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `buildEndpointUrl` の `query === undefined \|\| query === ''` | ConditionalExpression | 到達不能: `query` は全呼び出しで空にならない。空のとき endpoint だけという分岐は来ない |

### API の呼び出しと応答の変換: 共通の理由

次の 3 種類の生き残りは、API の呼び出しと応答の変換の file に共通で現れる。個別の節には載せず、ここにまとめる。

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `fetchJson`・`fetchAction` の `catch` の block を空にする（`dashboardApi.ts`、`encodeApi.ts`、`recordingApi.ts`、`app/api/fetchServerApiRepository.ts`） | BlockStatement | 振る舞いが変わらない: null の代わりに undefined（`fetchAction` は false の代わりに undefined）が返るだけで、呼び出し側の変換は null も undefined も同じ失敗として扱う |
| 既定の base path `options.basePath ?? './api'`（各 repository の生成関数） | StringLiteral、LogicalOperator | 定数表で判定できない: report が `static` と報告する。既定の `./api` と、指定した base path の使われ方は `unittest/imp/api.basePathResolution.imp.test.ts` が確かめている |
| channel の index を `Map.get(item.channelId)` で引く前の `item.channelId === undefined` の判定（`recordedAdapters.ts`、`recordingApi.ts`、`dashboardRecordedAdapters.ts`、`reserveAdapters.ts`、`search/rule/api/channelNames.ts`） | ConditionalExpression | 冗長: index の key は数値だけなので、undefined で引いても何も見つからず、同じ項目がそのまま返る |

### `src/features/guide/guideApi.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `createRequestSetFromScheduleRequest` が作る `guideQuery` の全体と、`mode` を持たない要求の分岐が作る `schedule` の各項目（`mode`・`isHalfWidth`・`isFree`・各放送波の真偽） | ObjectLiteral、StringLiteral、BooleanLiteral、ConditionalExpression、EqualityOperator | 到達不能: URL を組み立てる `buildGuideRequestUrls` は `guideQuery` を読まない。`mode` を持たない要求は予約の索引の取得にだけ渡り、そこで使うのは `reserveIndex` だけで `schedule` は読まれない |

### `src/features/recorded/recordedApi.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `fetchRecordedDetail` の `response === null` の判定と `\|\|` | ConditionalExpression、LogicalOperator | 冗長: 続く `!isRecord(response)` が null も弾く |

### `src/features/recorded/api/recordedSearchAdapters.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `SEARCH_OPTION_GENRE_NAMES`（ジャンル名の表） | ObjectLiteral、StringLiteral | 定数表で判定できない: 16 個の名前を全部確かめる test がある |
| `adaptVideoDuration` の `typeof value === 'number'`・`typeof value.duration !== 'number'` | ConditionalExpression | 冗長: `Number.isFinite` が数値以外を弾く |

### `src/features/recording/recordingApi.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `adaptChannelIndex` の `typeof channel.id !== 'number'` と `name !== undefined` | ConditionalExpression | 振る舞いが変わらない: 数値でない id や undefined の名前を index に入れても、数値の channelId で引く側から見えない |
| `hydrateRecordingChannelName` の `channelName === undefined` | ConditionalExpression | 振る舞いが変わらない: 項目は元から `channelName: undefined` の key を持ち、spread しても同じ形になる |
| `createFetchRecordedApiRepository({ fetcher, basePath })` の引数の object | ObjectLiteral | 定数表で判定できない: report が `static` と報告する。録画済みの repository への継承は `recording` の test が確かめている |

### `src/features/storages/storagesApi.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isRecord` の判定、`isNonNegativeFiniteNumber` の `typeof value === 'number'`、`adaptStoragesResponse` の `isRecord`・`items` が配列かの判定 | ConditionalExpression、LogicalOperator、BlockStatement | 冗長: 外側の `try/catch` が例外を同じ失敗の結果に変える。`Number.isFinite` は数値以外を弾く |

### `src/features/reserves/lib/reserveAdapters.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isRecord` の `typeof value === 'object'` | ConditionalExpression | 冗長: 文字列や数値は property が全部 undefined になり、続く id の判定で弾かれる（`isRecord` 自体の判定は test が確かめている） |
| `isSafeInteger` の `typeof value === 'number'` | ConditionalExpression | 冗長: `Number.isSafeInteger` が数値以外を弾く |
| `adaptReserveItem` の開始時刻・終了時刻の逆転判定の `startAt !== undefined`・`endAt !== undefined` と `&&` | ConditionalExpression、LogicalOperator | 振る舞いが変わらない: undefined との大小比較は常に false で、どちらかが無ければ何も消えない |

### `src/features/reserves/lib/manualReserveServerOptions.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `EMPTY_SERVER_OPTIONS` | ObjectLiteral、ArrayDeclaration | 定数表で判定できない: 3 つとも空であることを確かめる test がある |
| `isRecord` の `typeof value === 'object'` | ConditionalExpression | 冗長: 文字列は後段の `typeof channel.id !== 'number'` で弾かれる |

### `src/features/onair/lib/onairLiveStreamAdapters.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `adaptChannelNameIndex` の `typeof entry.name === 'string'` | ConditionalExpression | 冗長: 後段の `typeof name === 'string'` が文字列でない名前を弾く |

### `src/features/guide/lib/guideApiAdapters.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `resolveDefaultFetch` | BlockStatement | 定数表で判定できない: report が `static` と報告する。`fetcher` を渡さないとき global の `fetch` が使われることは test が確かめている |

### `src/app/api/serverConfigAdapters.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `adaptServerConfig` の `isEncodeEnabled` に代入する式 | ConditionalExpression、EqualityOperator | 冗長: 代入する式は外側の `if` と同じ条件で、そこへ来た時点で常に true |

### `src/shared/legacyPaginationDesktop.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `desktopPaginationRange` の loop の条件と増分（`pageNumber <= to`、`pageNumber += 1`） | EqualityOperator、BooleanLiteral、UpdateOperator | Stryker の制約: 条件を常に真にする・増分を逆向きにする mutant は無限 loop になり、配列が伸び続けて runner が止まるため、流すときはこの 1 行を除く（設定の comment を参照）。範囲の出力は通常の test が確かめている |
| `computeDesktopPaginationItems` の最後の `items[index - 1]` | ArithmeticOperator | 振る舞いが変わらない: 連続する `'ellipsis'` のどれを残すかが変わるだけで、出力は同じ |

### `src/app/navigation/routeMatching.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `currentQueryMatchesCondition` の `actual === undefined` | ConditionalExpression、BlockStatement | 振る舞いが変わらない: undefined は続く比較で false になる |
| `listComparableQueryKeys` の `query[key] !== undefined` | ConditionalExpression | 振る舞いが変わらない: 値が undefined の key を含めても、値の列は両側とも空で一致する |
| `normalizeQueryValue` の `value === undefined` | ConditionalExpression、BlockStatement、ArrayDeclaration | 冗長: 比べる key は少なくとも片側に値があるので、undefined を `[undefined]` や別の配列にしても、反対側の値の列と一致することが無い |

### `src/app/navigation/items.ts`・`src/app/navigation/regenerationRequest.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `baseBeforeConfigItems`・`baseAfterGuideItems`（項目の表）と、`generateNavigationItems` の放映中の項目の条件 | ArrayDeclaration、ObjectLiteral、StringLiteral、ConditionalExpression | 定数表で判定できない: 全項目を並びまで確かめる test がある |
| `NAVIGATION_REGENERATION_EVENT` | StringLiteral | 定数表で判定できない: 名前を確かめる test がある |

### `src/app/realtime.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `SOCKET_INITIALIZATION_FAILURE_MESSAGE`・`DISCONNECT_MESSAGE`・`RECONNECT_MESSAGE` | StringLiteral | 定数表で判定できない: 文言を確かめる test がある |

### `src/features/settings` と `src/shared/settings`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `settingsControlSupport.ts` の `formatSettingsSelectValue` の `controlType !== 'select'` | ConditionalExpression、BlockStatement | 冗長: `options` を持つのは select だけで、それ以外は `find` が undefined になり同じく元の値を返す |
| `settingsControlMatrix.ts` の `createSettingsControlUpdate` の `typeof rawValue === 'string' ? rawValue : String(rawValue)` | ConditionalExpression、StringLiteral | 振る舞いが変わらない: 文字列に `String` を掛けても同じ文字列 |
| `settingsSave.ts` の保存成功・失敗の snackbar の定数 | ObjectLiteral、StringLiteral | 定数表で判定できない: 保存の test が値を確かめている |
| `adjacentStorageRegistry.ts` の `definitions`（隣接する保存先の表） | ArrayDeclaration、ObjectLiteral、StringLiteral、BooleanLiteral | 定数表で判定できない: 8 項目の key・owner・既定値を並びまで確かめる test がある |
| `settingsControlOptions.ts` の `rangeOptions`・`valueOptions` | ArrowFunction | 定数表で判定できない: module 先頭で定義される arrow function 全体の置き換え。呼び出したときの結果は test が確かめている |

### `src/app/drawerLayout.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `APP_SHELL_DRAWER_TRANSITION_EASING` | StringLiteral | 定数表で判定できない: 値を確かめる test がある |

### `src/app/lib/serverConfigSelectors.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `getRecordedDownloadUrlScheme`・`getRecordedViewUrlScheme` の `os === null`・`!('urlscheme' in config)` の判定 | ConditionalExpression、LogicalOperator | 振る舞いが変わらない: 判定を外しても、続く `config.urlscheme?.…?.[os]` が undefined になり、`?? null` で同じ null を返す |

### `src/app/lib/shellSettingsSnapshots.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `loadThemeSettingsSnapshot`・`loadNavigationSettingsSnapshot` の `typeof window !== 'undefined'` | ConditionalExpression、StringLiteral | 冗長: window が無いときの `window.localStorage` の読み込みの例外を、外側の `try/catch` が拾って同じ既定値を返す |

### `src/app/scroll/scrollHistoryContext.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `createMissingScrollHistory`（provider が無いときの既定の履歴） | BlockStatement、ObjectLiteral、ArrowFunction | 定数表で判定できない: module の読み込み時に評価される式。各 method の戻り値と例外は test が確かめている |
| `createMissingScrollHistory` の `clearRestoreHistory` の `return undefined` | BlockStatement | 振る舞いが変わらない: 空の本体も undefined を返す |

### `src/features/guide/GuideGridRenderer.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `programDoms` の初期値 | ArrayDeclaration | 振る舞いが変わらない: `mount` の先頭の `destroy()` が `[]` に戻すので、初期値は外に出ない |
| `destroy` の `this.timerId !== null` | ConditionalExpression | 振る舞いが変わらない: `clearTimeout(null)` は無害 |
| 描画の途中で世代が変わったときの `return false` | BooleanLiteral | 冗長: 呼び出し側の `mount` が世代を再確認して同じく戻る |

### `src/features/guide/lib/guideGridDom.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `setTextChild` の `innerText` に対応しているかの判定（`typeof HTMLElement !== 'undefined'` と `'innerText'`） | ConditionalExpression、StringLiteral | 振る舞いが変わらない: jsdom の `HTMLElement` には `innerText` が無く、どちらの置き換えでも `textContent` の経路になる。`innerText` を使う経路は実ブラウザでしか通らない |

### `src/features/guide/lib/guideGridInteraction.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `onMouseUp` の `this.programGrid?.classList` | OptionalChaining | 到達不能: `detach` が先に timer を解除してから `programGrid` を null にするため、null で呼ばれない |

### `src/features/guide/lib/guideGridLayout.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isFiniteNumber` の `typeof value === 'number'` | ConditionalExpression | 冗長: 後ろの `Number.isFinite` が数でない値を弾く |
| 日付を分解する `part` の既定値 `'0'` | StringLiteral | 振る舞いが変わらない: `Number('')` と `Number('0')` はどちらも 0 |
| 番組の `genre3` が数かの判定 | ConditionalExpression | 振る舞いが変わらない: 数でなくても undefined が入るだけで結果が同じ |
| 窓の先頭に切り詰めるかの `clippedStartAt === baseStartAt` | ConditionalExpression | 冗長: else の枝も同じ 0 を返す |
| ジャンルが非表示かの判定の `genre !== undefined` | ConditionalExpression | 冗長: `genreVisibility[undefined]` は `false` と等しくならない |

### `src/features/guide/lib/guideGridVisibility.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 現在時刻線の `now < input.startAt` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 開始前でも開始と同時でも、分数が 0 以下になり同じ位置（画面外）を返す |

### `src/features/guide/lib/guidePageState.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| 番組の検索の `programId === undefined` | ConditionalExpression | 振る舞いが変わらない: undefined の id では見つからず undefined になる |
| 履歴の URL の `split('#')[1]?.split` | OptionalChaining | 到達不能: 直前の `includes('#')` で `[1]` は必ずある |
| query が undefined のときの `false` | ConditionalExpression | 振る舞いが変わらない: `URLSearchParams(undefined)` は `timestamp` を持たない |
| `hasDisplayChannels` の `schedules.length === 0` | ConditionalExpression | 冗長: 空の schedule から作る配置も channel が 0 件になり同じ結果 |

### `src/features/guide/lib/guideProgramText.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `linkifyGuideProgramExtendedText` の `text === ''` | ConditionalExpression、StringLiteral | 振る舞いが変わらない: 空文字も同じく `[]` になる |
| `parseGuideProgramDetailSetting` の `value === null` と `typeof parsed !== 'object' \|\| parsed === null` | ConditionalExpression、LogicalOperator、BlockStatement | 振る舞いが変わらない: null や object でない値は、後続の項目の検査か `JSON.parse` の catch で同じ既定値になる |

### `src/features/guide/lib/guideSizeSettingForm.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `GUIDE_SIZE_FIELDS`（表と各項目の label・min・max・step） | ArrayDeclaration、ObjectLiteral、StringLiteral | 定数表で判定できない: 全項目の値を確かめる test がある |

### `src/features/guide/lib/programDialogText.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `resolveLegacyGenre` の `genre === undefined`、`subGenre === undefined` | ConditionalExpression | 振る舞いが変わらない: undefined の表引きは undefined になり、同じ結果になる |
| 映像・音声の種別とサンプリング周波数の `=== undefined ? undefined : 表[...]` | ConditionalExpression | 振る舞いが変わらない: undefined の表引きは undefined で、後段の filter が除く |

### `src/features/guide/lib/programGenreLabels.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `GENRE_NAMES`・`SUB_GENRE_NAMES`・`VIDEO_COMPONENT_TYPES`・`AUDIO_COMPONENT_TYPES`・`AUDIO_SAMPLING_RATES`（表と全値） | ObjectLiteral、StringLiteral | 定数表で判定できない: 表全体の値を確かめる test がある |

### `src/features/recorded/lib/recordedFormat.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `GENRE_NAMES`（表と全値） | ObjectLiteral、StringLiteral | 定数表で判定できない: 16 個の値を全部確かめる test がある |
| `formatRecordedGenre` の `genre === undefined`、`subGenre === undefined` | ConditionalExpression、BlockStatement | 振る舞いが変わらない: undefined の表引きは undefined で、続く判定が同じ結果にする |

### `src/features/recorded/requests/extendedText.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isSafeHttpUrl` の protocol の判定と catch の block | ConditionalExpression、BlockStatement | 振る舞いが変わらない: 呼び出し側の正規表現が `http(s)://` で始まる文字列だけを通す。catch が undefined を返しても呼び出し側では偽として扱われる |
| `text === ''` の早期 return | ConditionalExpression、StringLiteral | 振る舞いが変わらない: 空文字も同じく `[]` になる |

### `src/features/recording/lib/recordingFormat.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `WEEKDAYS`、`RECORDING_CARD_LAYOUT_MEDIA_QUERY` | ArrayDeclaration、StringLiteral | 定数表で判定できない: 7 曜日の値と media query の文字列を確かめる test がある |

### `src/features/reserves/lib/reserveLabels.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `reserveGenreLabels` の `item.genres.length > 0` | ConditionalExpression、EqualityOperator | 冗長: 空配列の `every` は真なので、直後の条件で同じく旧 genre 欄に落ちる |

### `src/features/search/rule/genreLabels.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `GENRE_NAMES`・`SUB_GENRE_NAMES`（表と全値） | ObjectLiteral、StringLiteral | 定数表で判定できない: 表全体の値を確かめる test がある |

### `src/features/search/rule/lib/programDisplay.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `programs === null \|\| programs.length === 0` | ConditionalExpression | 定数表で判定できない: report が `static` と報告するため判定できない。番組が無いときの表示は test が確かめている |

### `src/features/search/rule/lib/channelSelectOptions.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| ルールの channel 名を引く `ruleDetailIndex >= 0` と `ruleDetail?.` | ConditionalExpression、OptionalChaining | 振る舞いが変わらない／到達不能: 添字が -1 のときの表引きは undefined で id の文字列に戻る。添字が 0 以上なら `ruleDetail` は必ずある |

### `src/features/search/rule/lib/ruleOptionDraft.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isEnableEncodingSettingWhenCreateRule && firstAvailableEncodeMode !== undefined` の右の項 | ConditionalExpression | 振る舞いが変わらない: モードの一覧が空なら、右の項に依らず `encodeOption` は undefined になる |

### `src/features/search/rule/lib/searchFormState.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `DEFAULT_TARGETS`、`DEFAULT_WEEKDAYS`、`DEFAULT_TIME_RESERVE_WEEKDAYS` | ObjectLiteral、BooleanLiteral | 定数表で判定できない: 既定の状態を `createDefaultSearchFormState` の戻り値で確かめる test がある |
| `createSearchFormStateFromOption` の曜日の `week === 0x7f \|\|` | ConditionalExpression | 冗長: 0x7f はすべての bit が立っているので、右の項だけで同じ結果になる |

### `src/features/search/rule/lib/searchFormItems.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `START_TIME_ITEMS`、`RANGE_TIME_ITEMS` | ArrayDeclaration、StringLiteral、ArithmeticOperator | 定数表で判定できない: 開始 24 件・範囲 23 件の全件を確かめる test がある |

### `src/features/storages/upload/lib/uploadFormat.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `REQUIRED_UPLOAD_SCHEMA`（zod の schema） | ObjectLiteral、MethodExpression | 定数表で判定できない: module の読み込み時に評価される式。検証の結果は test が確かめている |
| `parseDatetimeLocalValue` の `value === ''` | ConditionalExpression、BlockStatement、StringLiteral | 振る舞いが変わらない: 空文字は日付として不正で、どのみち null になる |
| `createSubGenreItems` の `genre === null` | ConditionalExpression、BlockStatement | 定数表で判定できない: report が `static` と報告する。null のときも表引きの結果が空になり同じ |
| `createValidatedVideoUploadRequests` の `viewName === null && file === null` | ConditionalExpression、LogicalOperator、EqualityOperator、BlockStatement | 冗長: 直後の判定が同じ `[]` を返す |

### `src/features/onair/lib/liveStreamSelection.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `isGuideRouteTimeValue` の `2000 + 年`、年・月・日・時の一致の検査（個別の 1 つと組み合わせ） | ArithmeticOperator、ConditionalExpression、LogicalOperator | 冗長: 年・月・日・時のどれかが範囲外だと `Date.UTC` の繰り上がりで別の項目が一致しなくなるため、1 つを外しても結果が同じ。年は符号を逆にしても自己整合する |

### `src/features/onair/lib/onairStreams.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `formatWatchInfoTime` の曜日の取り出し（`part.type === 'weekday'` と既定値 `'Sun'`） | ConditionalExpression、StringLiteral | 到達不能: 曜日だけを書式化すると part は 1 つで必ず見つかり、既定値は使われない |
| `normalizeMode` の `typeof mode !== 'number'` と `mode < 0` の `<=` | ConditionalExpression、EqualityOperator | 振る舞いが変わらない: 数でない値は `Number.isSafeInteger` が弾く。0 のときは 0 を返すので同じ |
| `readOnAirSelectStreamSetting` の `storage === undefined` と `?? 'null'` と `typeof raw.mode === 'number'` | ConditionalExpression、BlockStatement、StringLiteral | 振る舞いが変わらない: storage が undefined なら例外を catch して既定値になり、空文字の `JSON.parse` も例外で既定値になる。数でない mode は `Number.isSafeInteger` が弾く |
| `resolveLiveM2TSUrlSchemeTemplate` の `platform === null` | ConditionalExpression | 振る舞いが変わらない: null の表引きは undefined で、`?? null` で同じ null になる |

### `src/features/onair/lib/onairWatch.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `calculateOnAirProgress` の `startAt === undefined`・`endAt === undefined`・`endAt <= startAt` の一部 | ConditionalExpression、LogicalOperator、EqualityOperator | 冗長: undefined や同じ時刻のときは割り算が NaN か無限大になり、`clampOnAirProgress` が 0 にする。終了が開始より前の範囲を弾く条件は test が確かめている |

### `src/features/video/playback/lib/playbackShellSupport.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `readSeekSeconds` の `value > 0` | EqualityOperator | 振る舞いが変わらない: 0 のときはどちらでも 0 |
| `getVideoPlayerStorage` の `typeof window === 'undefined'` と catch の block | ConditionalExpression、StringLiteral、BlockStatement | 冗長: window が無ければ `window.localStorage` が例外になり、catch が同じ undefined を返す |

### `src/features/video/playback/playbackControls.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `formatPlaybackTime` の `seconds > 0` | EqualityOperator | 振る舞いが変わらない: 0 のときはどちらでも 0 秒 |
| `clampPlaybackSeek` の `duration <= 0` | EqualityOperator | 振る舞いが変わらない: duration が 0 のとき、clamp の結果も 0 |

### `src/features/video/playback/playbackLifecycleController.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `startWithRetry` が世代の失効で投げる error（`lastError ?? new Error(...)` とその文言） | LogicalOperator、StringLiteral | 振る舞いが変わらない: 呼び出し側の `start()` の catch が error の中身を使わない |
| `startWithRetry`・`poll` の `this.abortController?.signal` | OptionalChaining | 到達不能: 開始の処理中と readiness の確認中は `abortController` が必ずある |
| `waitForReadiness` の `completeWait` の `isSettling = true`、`resolveReady` の `isSettling = true` | BooleanLiteral | 冗長: 完了後は timer が解除され、`resolveReady` の直後に `completeWait` が同じ値を設定する |
| `resolveTerminal`・`poll` の世代が失効したときの早期 return と `completeWait()` | ConditionalExpression、BlockStatement、CallExpression | 冗長: 世代を進める処理が `completeWait` を先に呼び、続く `isSettling` の判定が同じく何もせず戻る |

### `src/features/video/playback/playbackLifecycleControllerBase.ts`

| 処理の場所 | mutator | 理由 |
| --- | --- | --- |
| `clearAbortableResources` の `readinessTimeoutId !== undefined` | ConditionalExpression | 振る舞いが変わらない: `clearTimeout(undefined)` は無害 |
