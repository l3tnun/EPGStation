# mutation testing の既知の生き残り

mutation testing（流し方は [testing.md](testing.md) の §5、方針は `.kiro/steering/server-testing.md`・`.kiro/steering/testing.md` の「Mutation Testing」）で、test を足さないと判断して残してある生き残りの一覧。server（`stryker.server.config.mjs`）・DB（`stryker.db.config.mjs`）・client（`client/stryker.client.config.mjs`）の設定ごとに分け、その中を対象 file ごとの節にしている。生き残りが無い file は載せない。

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
| `Configuration.DEFAULT_VALUE`（既定値の表と、その中の path の要素） | StringLiteral、ObjectLiteral、ArrayDeclaration、BooleanLiteral | 定数表で判定できない: 項目ごとに値を確かめる test があり、説明書（`docs/conf-manual.md`）に既定値が無い `encode`・`urlscheme` の形は実装の値で固定している。`mirakurunPath` は説明書が「デフォルト値なし・必須」とするのに実装は既定値を持ち、食い違うので値を確かめる test が無い |

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
| `UNLOCK_TIMEOUT` | ArithmeticOperator | 振る舞いが変わらない: どこからも参照されない定数 |
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
