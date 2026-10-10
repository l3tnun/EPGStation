# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、保存先容量管理固有の test、fixture、および承認済み差分の最
小実装だけを追加する。

容量不足削除では、本 spec は候補選択、監視 loop、進捗停止、および `IRecordedStorageDeletionPort` への要求までを所有する。
exclusive 利用 gate、録画 terminal barrier、録画済み番組削除 core の binding は `server-application-runtime`、存在・保
護・relation の再確認と exact-ID の file／DB 効果は `server-recorded-content`、録画取消の terminal 意味は
`server-recording-execution` が所有する。利用者削除の Encode 取消と跨域順序を持つ `server-workflow-coordination` は通さ
ない。設定 file の parser、共通 default、reload は `server-configuration`、DB 接続 lifecycle、migration、driver 差、共通
retry は `server-persistence` に残す。

`server-recorded-content`が提供する副作用なしprepare済み容量削除coreと、`server-application-runtime`が合成する録画・
service-child利用gateを混同しない。本specは候補ID・storage名をruntime-owned `IRecordedStorageDeletionPort`へ渡
し、`deleted` / `not-deleted` / rejectだけを観測する。候補選定、試行済みID guard、監視pathの容量再測定、および反復停止は
本specからadapter側へ移さない。

Cross-spec provider prerequisiteは、Configuration Task 4.2 の storage command timeout raw snapshot suite、Persistenceの
`IStorageDeletionCandidatePort` provider suite、Recorded Content Task 5.8、ならびにRuntimeのuse-snapshot・deletion
adapter suiteである。各consumer leafは対応provider suiteの完了前に開始せず、外部task IDはlocal
`_Depends:`へ混在させない。

ただしRuntime Task 4.2のcompositionに必要なprovider preparationとして、Tasks 5.1 / 5.2は型付き
`IRecordedStorageDeletionPort`、contract double、および対象testだけをRuntime 4.2より先に用意してよい。この先行段階は
production binding、削除動作、公開API、DB、設定を変更せず、Task 5.1 / 5.2のintegration完了を意味しない。
Runtime 4.2のcomposition後に、既存のRuntime use-snapshot・recording/service-child gate・deletion adapterの前提を満たして
から、consumerのproduction binding、削除動作、integration / deletion gateへ進む。

各 leaf task は 1〜3 時間の実行単位とする。各task本文で明示したtest・production fileを主対象とし、`_Depends_`がないleaf
は共有foundation以外のtask-local prerequisiteを持たない。

### Leaf execution manifest

| Leaf | Concrete target                                                                                                                 | Test type                                         | Local Depends                                                                         | Verification command                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/storage-management/storage-info.spec.test.ts`                                                                      | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/storage-info.spec.test.ts`                                                                                                        |
| 1.2  | `test/server/storage-management/storage-http.integration.test.ts`                                                               | `integration`                                     | なし（共有foundationのみ）                                                            | `npm run test:server:integration -- test/server/storage-management/storage-http.integration.test.ts`                                                                                          |
| 1.3  | `test/server/storage-management/monitoring.spec.test.ts`                                                                        | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/monitoring.spec.test.ts`                                                                                                          |
| 1.4  | `test/server/storage-management/stop.spec.test.ts`                                                                              | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/stop.spec.test.ts`                                                                                                                |
| 1.5  | `test/server/storage-management/command.spec.test.ts`                                                                           | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/command.spec.test.ts`                                                                                                             |
| 1.6  | `test/server/storage-management/auto-deletion.spec.test.ts`                                                                     | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/auto-deletion.spec.test.ts`                                                                                                       |
| 2.1  | `test/server/storage-management/monitoring-concurrency.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`           | `unittest/imp`                                    | なし（共有foundationのみ）                                                            | `npm run test:server:imp -- test/server/storage-management/monitoring-concurrency.test.ts`                                                                                                    |
| 2.2  | `test/server/storage-management/monitoring-concurrency.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`           | `unittest/imp`                                    | `2.1`                                                                                 | `npm run test:server:imp -- test/server/storage-management/monitoring-concurrency.test.ts`                                                                                                    |
| 3.1  | `test/server/storage-management/command-supervision.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`              | `unittest/imp`                                    | なし（共有foundationのみ）                                                            | `npm run test:server:imp -- test/server/storage-management/command-supervision.test.ts`                                                                                                       |
| 3.2  | `test/server/storage-management/command-supervision.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`              | `unittest/imp`                                    | `3.1`                                                                                 | `npm run test:server:imp -- test/server/storage-management/command-supervision.test.ts`                                                                                                       |
| 3.3  | `test/server/storage-management/storage-process.integration.test.ts`                                                            | `integration`                                     | `2.1, 3.1, 3.2`                                                                       | `npm run test:server:integration -- test/server/storage-management/storage-process.integration.test.ts`                                                                                       |
| 4.1  | `test/server/storage-management/candidate-selection.test.ts`<br>`test/server/storage-management/storage-db.integration.test.ts` | `unittest/imp`・`integration`                     | なし（共有foundationのみ）                                                            | `npm run test:server:imp -- test/server/storage-management/candidate-selection.test.ts`<br>`npm run test:server:integration -- test/server/storage-management/storage-db.integration.test.ts` |
| 5.1  | `test/server/storage-management/auto-deletion.spec.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`               | `unittest/spec`                                   | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/storage-management/auto-deletion.spec.test.ts`                                                                                                       |
| 5.2  | `test/server/storage-management/deletion-progress.test.ts`<br>`src/model/operator/storage/StorageManageModel.ts`                | `unittest/imp`                                    | なし（共有foundationのみ）                                                            | `npm run test:server:imp -- test/server/storage-management/deletion-progress.test.ts`                                                                                                         |
| 5.3  | `test/server/storage-management/storage-db.integration.test.ts`                                                                 | `integration`                                     | `2.2, 3.3, 4.1, 5.1, 5.2`                                                             | `npm run test:server:integration -- test/server/storage-management/storage-db.integration.test.ts`                                                                                            |
| 6.1  | `test/server/storage-management/monitoring.spec.test.ts`<br>`test/server/storage-management/command.spec.test.ts`<br>`test/server/storage-management/storage-db.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 3.3, 4.1, 5.3`                                    | `npm run test:server:spec -- test/server/storage-management/monitoring.spec.test.ts`<br>`npm run test:server:spec -- test/server/storage-management/command.spec.test.ts`<br>`npm run test:server:integration -- test/server/storage-management/storage-db.integration.test.ts` |
| 6.2  | `test/server/storage-management/storage-process.integration.test.ts`                                                            | 実機境界確認・`integration`                       | `6.1`                                                                                 | `npm run test:server:integration -- test/server/storage-management/storage-process.integration.test.ts`                                                                                       |
| 7.4  | `test/server/storage-management/storage-db.integration.test.ts`                                                                 | `integration`                                     | `6.1`                                                                            | `npm run test:server:integration -- test/server/storage-management/storage-db.integration.test.ts`                                                                                            |
| 7.5  | `test/server/storage-management/storage-http.integration.test.ts`                                                               | `integration`                                     | `6.1`                                                                            | `npm run test:server:integration -- test/server/storage-management/storage-http.integration.test.ts`                                                                                          |
| 7.6  | `test/server/storage-management/storage-filesystem.integration.test.ts`                                                         | `integration`                                     | `6.1`                                                                            | `npm run test:server:integration -- test/server/storage-management/storage-filesystem.integration.test.ts`                                                                                    |
| 7.7  | `test/server/storage-management/storage-process.integration.test.ts`                                                            | `integration`                                     | `6.1, 6.2`                                                                       | `npm run test:server:integration -- test/server/storage-management/storage-process.integration.test.ts`                                                                                       |
| 7.8  | `test/server/application-runtime/storage-pressure-deletion.integration.test.ts`                                                 | external Runtime adapter `integration`            | `5.3, 7.4, 7.5, 7.6, 7.7`                                                             | `npm run test:server:integration -- test/server/application-runtime/storage-pressure-deletion.integration.test.ts`                                                                            |
| 7.9  | `test/server/storage-management/monitoring.spec.test.ts`<br>`test/server/storage-management/storage-db.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `7.4, 7.5, 7.6, 7.7, 7.8` | `npm run test:server:spec -- test/server/storage-management/monitoring.spec.test.ts`<br>`npm run test:server:integration -- test/server/storage-management/storage-db.integration.test.ts` |

-   [x] 1. 容量表示、定期監視、および既存の局所失敗契約を仕様テストで固定する
-   [x] 1.1 全保存先の容量情報と byte 単位の投影を characterization する

    -   下限、削除 action、通知 command の有無にかかわらず、設定 snapshot の全録画保存先を設定順で一件ずつ容量取得する既
        存挙動を `unittest/spec` で固定する。
    -   同じ path または同じ合成容量を指す複数 entry も統合せず、設定名と `available`、`used`、`total` の exact byte 値
        を個別 item にすることを `unittest/imp` で検証する。
    -   一 entry の容量取得失敗を別 entry の値へ代入せず、部分結果を返さず query 全体を reject することを確認する。
    -   完了時には、全件、設定なし項目、重複 path、および一件 failure の各 synthetic fixture が承認済みの item 列または
        query error を再現し、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
    -   _Boundary: 容量情報 query・容量取得 adapter_

-   [x] 1.2 公開容量 API の既存 200／500 wire を結合 characterization する

    -   `GET /api/storages` の成功が `{ items }` を返し、各 item が `name`、`available`、`used`、`total` だけを持つこと
        を `integration` で固定する。
    -   一 path の容量取得失敗が既存の 500 error carrier へ写像され、途中 item、閾値、command、内部 operation ID が
        response へ混入しないことを検証する。
    -   HTTP routing、認証、status／error の一般規則は変更せず、容量 query と既存 service adapter の結合だけを確認する。
    -   完了時には、成功 fixture は設定順と byte 値を保った 200、失敗 fixture は部分 response のない既存 500 を返し、
        production code の差分がない。
    -   _Requirements: 1.2, 1.5, 1.6_
    -   _Boundary: 容量情報 query・公開 API adapter integration_

-   [x] 1.3 監視対象、最初の interval、および初回 MB 判定を characterization する

    -   `limitThreshold` が定義された entry だけを設定順で監視対象にし、対象 0 件なら interval を登録しないことを
        `unittest/spec` で固定する。
    -   fake timer で監視間隔を second から millisecond へ変換し、登録直後には読まず、最初の一間隔後に初回読取を開始する
        ことを検証する。
    -   `availableBytes / 1024 / 1024` を丸めず MB 閾値と比較し、閾値超過では command／削除を 0 件、閾値一致・未満では容
        量不足処理を開始することを `unittest/imp` で確認する。
    -   完了時には、対象なし、interval 直前・到達、閾値超過・一致・未満の各 fixture で timer、読取、容量不足処理の call
        数が一意に観測でき、production code の差分がない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.8_
    -   _Boundary: 定期監視 controller・容量不足 coordinator_

-   [x] 1.4 容量取得失敗の局所継続と定期 timer の停止を characterization する

    -   一保存先の初回容量取得を reject させ、当該 entry の command／削除を開始せず、確認可能な後続保存先を続ける既存結
        果を `unittest/spec` で固定する。
    -   `stop()` が定期 interval を解除して次 callback を 0 件にする一方、開始済み容量取得・削除の Promise を
        await、cancel、または成功扱いしないことを deferred fixture で検証する。
    -   active 状態を共通 shutdown token にせず、停止後に開始済み処理が通常 settlement へ進めることを `unittest/imp` で
        確認する。
    -   完了時には、一 entry failure 後の後続読取と、停止要求の同期 return、次 callback 0 件、開始済み Promise 未取消が
        観測でき、production code の差分がない。
    -   _Requirements: 2.7, 5.1, 5.2, 5.3_
    -   _Boundary: 定期監視 controller・system log port_

-   [x] 1.5 通知 command の既存解析、親環境継承、および削除非待機を characterization する

    -   容量不足かつ `limitCmd` ありの場合だけ command 起動を一回試み、既存 parser が実行対象と引数、既存 placeholder、
        空引数除去を適用することを `unittest/spec` で固定する。
    -   shell と `env` option を指定せず、合成 marker だけを使った isolated child の `integration` で親環境継承を確認す
        る。
    -   parser または同期 spawn 受付 failure を system logger へ渡した後も `action` を評価し、削除ありでは child
        terminal を待たず削除へ進み、削除なしでは追加の削除処理を始めない既存分岐を確認する。
    -   command の無期限放置を望ましい oracle にせず、有限監督の target contract は task 3 で失敗 test から追加する。
    -   完了時には、command なし、正常受付、解析 failure、同期受付 failure、削除あり・なしの各 fixture で起動、log、削除
        call 数が再現され、production code の差分がない。
    -   _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7, 3.8_
    -   _Boundary: 通知 command 起動境界・容量不足 coordinator_

-   [x] 1.6 削除依頼後の再取得と既存の局所終了分岐を characterization する

    -   削除依頼が resolve した場合だけ監視中 entry の同じ path から空き容量を再取得する既存順序を `unittest/spec` で固
        定する。
    -   初回容量判定の MB 換算と、候補 `null`、候補 query reject、削除 reject、再取得 reject がそれぞ
        れ当該保存先の loop を終えることを `unittest/imp` で検証する。
    -   修正前の global 候補、直接削除接続、削除後 raw byte 比較、および無進捗反復は target oracle にせず、task 4・5 の
        失敗 test で分離する。
    -   完了時には、削除 resolve 後だけ同じ path が再取得され、4種類の局所終了で追加候補と追加削除が 0 件になり、
        production code の差分がない。
    -   _Requirements: 4.3, 4.4, 4.6, 4.7_
    -   _Boundary: 容量不足 coordinator・容量取得 adapter_

-   [x] 2. 保存先単位の監視 ownership と 600 秒 watchdog を実現する
-   [x] 2.1 保存先単位の開始順、single-flight、および解放を test と実装で閉じる

    -   保存先 A の容量取得を deferred にしても、同じ tick が設定順で B、C の開始可否を判定し、異なる `StorageEntryId`な
        ら先行完了を待たず開始する `unittest/spec` を置く。
    -   次 tick では進行中の exact entry ID だけを skipし、同じ正規化pathを持つ別設定entryも独立して開始し、別entryを停
        止しないことを検証する。
    -   成功・失敗の通常 settlement で exact entry ID だけを一回解放し、別 operation の後着 callback が後続監視の
        ownership を解放しない反例を加える。
    -   完了時には、設定順、同一entry ID skip、同path別entry開始、exact entry ID解放をcall ledgerで独立して再現できる。
    -   設定snapshot indexとopaque identityからなる不変な`StorageEntryId`をentryごとに割り当てるprocess-local active
        operationを持ち、tickの設定順走査から各entry IDの独立Promise continuationを開始する。
    -   容量取得、容量不足処理、削除、および command の有限監督が通常 settle した `finally` だけで exact entry ID を解放
        する。
    -   異なるentry IDのglobal mutex、同一path・物理volume・symlink先の統合、結果共有、固定並行上限を追加しない。
    -   `unittest/imp` で task 2.1 の開始・skip・解放 matrix を通し、一entry IDのfailureが別entry IDのstateを変更しない
        ことを確認する。
    -   完了時には task 2.1 の全 test が通り、進行中entry ID集合と開始call ledgerが常に一致する。
    -   _Requirements: 2.4, 2.9, 2.10, 2.11, 3.11_
    -   _Boundary: 定期監視 controller・StorageEntryId operation state_

-   [x] 2.2 各 I/O 段階の 600 秒 ownership watchdog を test と実装で閉じる

    -   初回容量取得、利用中の録画の取得、候補取得、削除依頼、削除後再取得を個別に 599,999 ms で settle させる通常経路と、600,000 ms まで未
        確定にする `overdue` 経路を fake timer と deferred Promise で `unittest/spec` にする。
    -   watchdog 先着時も exact entry ID と元 Promise を進行中として保持し、同じ entry ID の後続段階・後続監視を 0 件に
        しながら、別 entry ID と合成した録画・配信・番組更新・Web API probe を継続することを確認する。
    -   元 Promise の late resolve／reject が同じ段階を再実行せず、通常の次段階または局所終了と exact entry ID 解放へ一
        回だけ進む反例を加える。
    -   完了時には、5段階それぞれで境界直前、期限到達、late settlement、および別 entry ID 継続を決定的に再現できる。
    -   各 I/O 段階へ単一 watchdog、operation generation、および一回だけの通常 continuation を持たせ、期限先着を
        `overdue` として記録する。
    -   watchdog は元処理を resolve、reject、cancel、再実行、または ownership 解放済みと扱わず、元 Promise の exact
        settlement だけを既存の次段階または局所終了へ接続する。
    -   期限を operator fatal、process 再起動、別 entry ID の停止、および自動 retry へ接続しない。
    -   `unittest/imp` と entry ID isolation の `integration` で task 2.2 の5段階 matrix、late callback、および exact
        `finally` 解放を検証する。
    -   完了時には task 2.2 の全 test が通り、watchdog 後も同じ I/O の call 数が一回、別 entry ID の開始数が期待値どおり
        になる。
    -   _Requirements: 2.10, 2.11, 2.12_
    -   _Boundary: entry ID operation watchdog・容量不足 coordinator_
    -   _Depends: 2.1_

-   [x] 3. 通知 command の有限監督と未回収 key 隔離を追加する
-   [x] 3.1 command 期限設定と通常 terminal lifecycle を test と実装で閉じる

    -   Cross-spec prerequisiteとして、Configurationのstorage command timeout raw snapshot provider suiteが完了し、省略
        値・raw値・clone・reload後snapshotを取得できることを確認してから着手する。
    -   optional 期限の省略値 `300_000`、最小 `1`、最大 `2_147_483_647` と、`0`、負数、小数、`NaN`、`Infinity`、上限超過
        を component 構築境界の `unittest/spec` にする。
    -   command 解析と同期 spawn 受付後に、exact child の terminal listener と一つの絶対 deadline が登録され、期限前
        terminal で deadline、listener、handle、registry が各一回解放されることを `child_process` の module mock と fake timer で検証する。
    -   process 未生成の spawn failure と process 終了を証明しない `error` を分け、前者も confirmed cleanup までは owner
        を失わず、後者を terminal へ暗黙変換しない反例を加える。
    -   設定 file parser、共通 default、reload を変更する test にせず、受領 snapshot の optional 値を本 component が正規
        化する契約だけを対象にする。
    -   完了時には、設定境界、normal terminal、spawn failure、non-terminal error の各 state と resource call 数を再現で
        きる。
    -   受領 snapshot の optional 値を正の有限な `commandTimeoutMs` へ正規化し、不正値では command 起動前に設定 error と
        する。
    -   既存 command parser、shell なし、`env` 未指定、`stdio: ignore` を維持する通知 command の起動と、deadline、operation-local state を
        `launchCommand` 内に実装する。test は module mock と fake timer を使う。
    -   `close` 相当だけを confirmed terminal とし、期限前 terminal または process 未生成の confirmed cleanup で
        listener、deadline、handle、registry を一回だけ解放する。
    -   `StorageLimitCommandOperation.observationDone` は confirmed terminal／cleanup だけで settle し、解析・同期 spawn
        受付 failure は既存 error 経路へ返す。
    -   `unittest/imp` で task 3.1 の設定値、event 順列、resource 解放、および親環境継承を検証する。
    -   完了時には task 3.1 の全 test が通り、正常・非0終了・起動失敗で resource ledger に未所有項目が残らない。
    -   _Requirements: 3.1, 3.2, 3.5, 3.7, 3.8_
    -   _Boundary: 通知 command supervisor_

-   [x] 3.2 timeout、未回収隔離、および late terminal を test と実装で閉じる

    -   deadline 先着で timeout failure を一回記録し、同じ exact child へ `SIGKILL` を一回要求して、追加3,000 ms の停止
        強化 timer を一件だけ登録する `unittest/spec` を追加する。
    -   停止要求が `false` または throw しても timeout を成功へ変えず、追加期限で terminal 未確認ならその事実を一回記録
        し、listener、handle、registry、entry ID ownership、未settleの `observationDone` を保持することを検証する。
    -   timeout 後3秒内 terminal、追加期限先着後の late terminal、重複 terminal、旧 operation callback を分け、exact
        generation だけが元 entry ID を一回解放し、過去の失敗を成功へ変更しない反例を加える。
    -   logical ownership 中は同じ entry ID の新しい command を 0 件、別 entry ID の command と合成した別 domain probe
        を継続し、 `stop()` 後も command deadline／late cleanup が残ることを確認する。
    -   完了時には、SIGKILL 成功・false・throw、terminal 先着・追加期限先着・late terminal、停止後 deadline を決定的に再
        現できる。
    -   operation ID／generation gate により terminal と deadline の最初の遷移だけを採用し、deadline 先着時の failure、
        `SIGKILL`、追加3秒監督を一回ずつ実行する。
    -   追加期限でも terminal 未確認なら operation と entry ID を `unreaped` のまま保持し、exact child の late terminal
        だけで timer、listener、handle、registry、entry ID ownership を一回解放する。
    -   経過時間から direct child／descendant の不存在を推測せず、二回目の停止要求、retry、fallback、別 entry ID の
        global 停止を追加しない。
    -   定期 interval の `stop()` は command registry／deadline を clear、await、停止、成功扱いせず、supervisor を独立し
        て継続する。
    -   `unittest/imp` で task 3.2 の race、停止失敗、未回収、late terminal、stale callback matrix を通す。
    -   完了時には task 3.2 の全 test が通り、registry と entry ID の所有数が exact terminal の有無に一致する。
    -   _Requirements: 2.10, 3.3, 3.9, 3.10, 3.11, 5.4_
    -   _Boundary: 通知 command supervisor・unreaped operation registry_
    -   _Depends: 3.1_

-   [x] 3.3 command 非待機削除と key 保持を容量不足 coordinator へ結合する

    -   command の起動受付・監督登録後は terminal を待たず `action` を評価し、削除ありでは deferred child と並行して削除
        を開始する `integration` testを追加する。
    -   削除処理または削除なしの評価後は `observationDone` を await して exact entry ID を保持し、同じ entry ID の後続
        command を 0 件、別 entry ID の容量確認・command を継続することを確認する。
    -   parser／同期 spawn failure は記録後に action 評価へ進み、timeout／late terminal は開始済み削除を
        cancel、rollback、retry しないことを故障注入する。
    -   `stop()` では次の interval だけを止め、実行中 command の deadline、停止試行、追加3秒、late cleanup を継続する。
    -   synthetic child だけを使う `integration` で shell 非使用、合成環境継承、terminal observer 回収を確認し、実
        command path や実 environment 値を証跡へ残さない。
    -   完了時には、command 正常・起動失敗・timeout・未回収と削除あり・なしの matrix で、削除開始時刻、key 保持、別entry
        ID継続、停止後監督が観測できる。
    -   _Requirements: 2.10, 3.1, 3.4, 3.5, 3.6, 3.8, 3.9, 3.10, 3.11, 5.4_
    -   _Boundary: 容量不足 coordinator・通知 command supervisor integration_
    -   _Depends: 2.1, 3.1, 3.2_

-   [x] 4. 保存先限定・未使用・最古順の削除候補 port を実現する
-   [x] 4.1 候補 scope、利用中除外、および安定順序を test と実装で閉じる

    -   対象保存先だけに一件以上の video relation を持ち、全 relation の `parentDirectoryName` が storage 名と一致し、未
        保護の録画済み番組だけを候補にする `unittest/spec` を追加する。
    -   録画・待機中／実行中 encode・配信中の利用 snapshot と、同じ entry での試行済み ID を除外することを合成 fixture
        で検証する。
    -   候補を `startAt ASC`、同時刻では `id ASC` の一つの sort で一件返し、別保存先だけ・複数保存先・video 0件・対象な
        しを分ける。
    -   global 未保護集合、利用中非除外、二回目の sort 上書きを欠陥 fixture として扱い、target oracle にしない。
    -   完了時には、保存先、保護、relation集合、利用中／試行済み、開始時刻／ID の matrix が一意の ID または `null` を返
        す。
    -   Cross-spec prerequisiteとして、Persistenceの`IStorageDeletionCandidatePort` provider実装とSQLite/MySQL
        suiteが完了し、primitive ID／`null`／reject contractを利用できることを確認してから着手する。
    -   本specで`storageName`と利用中・試行済みID集合を受ける型付き候補port contractを定義し、 `server-persistence`の承
        認済みprovider taskが条件を一つのquery contractとして適用したadapterへ接続する。
    -   全 video relation の保存先一致、未保護、除外 ID、および `startAt ASC, id ASC` を同時に満たす一件だけを返し、後続
        sort で先行 sort を上書きしない。
    -   provider adapterのDB接続、Entity／relation ownership、SQLite／MySQL差、migration、transaction、共通retryは
        `server-persistence`に残し、本specのproduction変更へ取り込まない。
    -   `unittest/imp` と SQLite／MySQL の synthetic `integration` で task 4.1 の候補 matrix と `null`／query error を検
        証する。
    -   完了時にはtask 4.1のtarget testが両backendのprovider contract fixtureで通り、候補adapterからfile削除・録画停止・
        利用gateのcallが0件になる。
    -   _Requirements: 4.1_
    -   _Boundary: IStorageDeletionCandidatePort consumer contract・server-persistence provider integration_

-   [x] 5. 削除 consumer port、単位統一、および無進捗停止を実現する
-   [x] 5.1 排他的削除要求と削除後 MB 再判定を test と実装で閉じる

    -   候補 ID と storage 名だけを `IRecordedStorageDeletionPort` へ渡し、`deleted` で同じ監視 path を再取得、
        `not-deleted`／reject で再取得・別候補・retry を 0 件にする `unittest/spec` を置く。
    -   削除後の `nextAvailableBytes / 1024 / 1024` を初回と同じ MB 閾値へ比較し、raw byte と MB を直接比較しない target
        test を加える。
    -   録画済み番組 row 自体の削除失敗が port rejection または `not-deleted` として伝播し、成功や同一候補の再選択になら
        ないことを故障注入する。
    -   完了時には、`deleted`、`not-deleted`、reject、post-read failure、MB 閾値の各 ledger が期待 call 数と結果を再現す
        る。
    -   Runtime Task 4.2より先には、型付き`IRecordedStorageDeletionPort`、contract double、およびこのtarget testだけを
        provider preparationとして用意してよい。この段階ではproduction binding、削除動作、公開API、DB、設定を変更しない。
        Recorded Content Task 5.8とRuntimeのrecording/service-child gate providerおよびapproved-order deletion adapter
        suiteが完了し、Runtime 4.2がcompositionを閉じた後にだけ、consumerのproduction bindingと削除動作へ進む。
    -   録画済み管理への直接削除接続を consumer port 呼出しへ置き換え、容量管理は `deleted`、`not-deleted`、reject だけ
        を観測する。
    -   `deleted` の後だけ同じ path を再取得し、raw byte 値を保持したまま MB へ換算して同じ閾値へ比較する。
    -   exclusive 利用 gate、存在・保護・relation 再確認、録画 terminal barrier、exact-ID file／DB 効果、event を本境界
        へ実装しない。
    -   `unittest/imp` で task 5.1 の結果 matrix を通し、利用者削除の Encode 取消、workflow port、新しい wire／API／IPC
        の call が 0 件であることを確認する。
    -   完了時には task 5.1 の target test が通り、容量管理から観測できる削除結果と再取得有無が consumer port の結果に一
        致する。
    -   _Requirements: 4.2, 4.3, 4.5, 4.6, 4.9_
    -   _Boundary: IRecordedStorageDeletionPort consumer・容量不足 coordinator_

-   [x] 5.2 byte 無進捗と同一候補再選択の停止を test と実装で閉じる

    -   Runtime Task 4.2より先には、Task 5.1と共通の型付きport・contract doubleを使うtarget testだけをprovider
        preparationとして追加してよい。production loop、削除動作、公開API、DB、設定はRuntime 4.2のcomposition後まで変更し
        ない。
    -   一件削除後の空き byte が減少または同値なら、追加候補取得と追加削除を 0 件にする `unittest/spec` を置く。
    -   同じ候補 ID が adapter から再提示されても再削除せず、試行済み ID を次の候補 query の除外集合へ渡すことを検証す
        る。
    -   byte が増加してなお閾値以下の場合だけ、100 ms 後に別候補へ進み、増加後に閾値超過ならその entry を終える fake
        timer test を加える。
    -   固定削除件数上限、物理 byte 解放の推測、自動 retry、別候補規則への fallback を期待値へ追加しない。
    -   完了時には、減少、同値、増加後超過、増加後不足、同一 ID 再提示の各 fixture で候補・削除 call 数を再現できる。
    -   一監視 operation ごとに前回 `availableBytes` と試行済み ID 集合を保持し、候補受領時に ID を集合へ追加する。
    -   削除後は MB 閾値判定より先に `nextAvailableBytes > previousAvailableBytes` を確認し、不増加または同一候補ではそ
        の entry の loop を終了する。
    -   増加かつ閾値以下の場合だけ前回 byte／MB を更新し、100 ms の待機を経て試行済み ID を除外した次候補へ進む。
    -   `unittest/imp` で task 5.2 の進捗・同一 ID・待機 matrix を通し、削除件数上限や追加 retry が存在しないことを確認
        する。
    -   完了時には task 5.2 の全 test が通り、各 loop iteration の候補 ID、byte 値、MB 値、待機回数が一対一に観測でき
        る。
    -   _Requirements: 4.8_
    -   _Boundary: 容量不足 coordinator・削除進捗 state_

-   [x] 5.3 候補選択、削除要求、再取得、および command 並行を容量不足 loop で結合する

    -   Configuration timeout snapshot、Persistence candidate provider、Recorded Content Task 5.8、Runtime
        use-snapshot・deletion gate adapterの各owner suiteをcross-spec prerequisiteとして実行し、一つでも未完了なら本
        integration leafを開始しない。
    -   保存先限定候補 port、fake `IRecordedStorageDeletionPort`、容量 adapter、deferred command を結び、候補 ID／storage
        名、削除結果、同一 path 再取得、raw byte 増加、MB 再判定、試行済み除外の順を `integration` で検証する。
    -   `null`、query reject、`not-deleted`、delete reject、post-read reject、byte 不増加、同一 ID 再提示を個別に故障注
        入し、その entry だけを一回終了することを確認する。
    -   command terminal を deferred にしたまま削除を開始し、削除 loop 終了後も command 監督が終わるまで同じ entry ID を
        保持し、別 entry ID は継続することを確認する。
    -   runtime adapter の内部 gate／prepare／barrier／final delete と recorded-content の path／row 効果を期待値にせ
        ず、consumer port の入力・結果だけを検証する。
    -   完了時には、容量不足の正常・全 failure・無進捗 matrix で追加削除が停止条件どおりとなり、利用者削除 workflow の
        call が 0 件になる。
    -   _Requirements: 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
    -   _Boundary: 容量不足 coordinator・候補／削除 consumer integration_
    -   _Depends: 2.2, 3.3, 4.1, 5.1, 5.2_

-   [x] 6. 保存先容量管理の domain suite を共有 matrix へ統合し実環境境界を確認する
-   [x] 6.1 42 AC の自動 test と cross-spec consumer contract を共有 server suite で検証する

    -   容量表示、entry ID 監視、600秒 watchdog、command supervisor、候補 query、削除 loop、停止を、共有の
        `unittest/spec`、`unittest/imp`、`integration` command から実行できるようにする。
    -   `GET /api/storages` の既存 wire と、容量管理側の候補／削除 consumer contract を確認し、runtime-owned
        `StoragePressureDeletionAdapter` の内部 integration testを本 spec へ複製しない。
    -   Node.js 24を必須 gate、Node.js 26を同じ domain suite の追加 gateとして実行し、matrix、runner、test
        root、coverage command 自体は本 spec で変更しない。
    -   fixture、snapshot、log assertion には実 URL、実番組、実保存 path、実 command path、credential、親環境の実値を含
        めない。
    -   42 ACそれぞれのnamed main caseと実行可能leafを一意に対応付け、欠落、重複、および親taskだけへの割当を0件として
        domain suiteへ統合する。
    -   完了時には全42 Acceptance Criteriaが一意なnamed／table-driven testと実行可能leafへ対応し、Node.js 24/26の同一
        domain suite、AC coverage、境界確認が成功する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.1,
        3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3,
        5.4, 6.1_
    -   _Boundary: 保存先容量管理 domain validation_
    -   _Depends: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.2, 3.3, 4.1, 5.3_

-   [x] 6.2 child process と容量 adapter の環境依存境界を実機で確認する

    -   Node.js 24 と26の対応環境で、秘密情報を持たない短時間の合成 child を起動し、`error`、`exit`、`close`、停止要求後
        terminal、親の合成 marker 継承を `実機` で観測する。
    -   対象 OS の temporary root で容量 adapter の通常 path、同一 path の別 entry、symlink／mount point の観測結果を取
        得し、同一物理領域の完全同一性や値の同時 snapshot を新しい保証へ昇格しない。
    -   terminal 未確認または adapter 差があっても、owner 未承認の descendant 回収、symlink 理由の削除抑止、volume 同一
        性判定、fallback を production へ追加しない。
    -   実 path、実環境変数、実保存先、child 出力を tracked fixture／logへ残さず、platform category と合否だけを実装の記録へ残す。
    -   完了時には Node.js 24/26 の合成 child lifecycle と対象 OS の容量 adapter 結果が取得され、自動 suite の前提との差
        異が明示される。
    -   _Requirements: 1.4, 1.6, 3.2, 3.3, 3.8, 3.9, 3.10_
    -   _Boundary: 通知 command supervisor・容量取得 adapter platform verification_
    -   _Depends: 6.1_

-   [x] 7. 機能固有の品質を閉じる
-   [x] 7.4 DB candidate provider境界を結合検証する

    -   `test/server/storage-management/storage-db.integration.test.ts`でcandidate ID/storage名・除外ID集合をPersistence
        provider contractへ接続し、primitive ID／`null`／rejectと順序を検証する。
    -   完了時にはcandidate selectorがstorage側、SQL・relation・driver lifecycleがPersistence側に残り、削除効果が0件にな
        る。
    -   _Requirements: 6.4_
    -   _Boundary: Storage DB candidate provider integration_
    -   _Depends: 6.1_

-   [x] 7.5 公開HTTP容量一覧境界を結合検証する

    -   `test/server/storage-management/storage-http.integration.test.ts`で公開容量一覧のmethod/status/bodyとdomain結果
        をsynthetic fixtureへ接続し、内部entry ID、timeout、candidate、削除resultを公開しない。
    -   完了時には既存HTTP wireだけが観測され、DB・filesystem・process責務をcarrierへ移していない。
    -   _Requirements: 6.4_
    -   _Boundary: Storage public HTTP integration_
    -   _Depends: 6.1_

-   [x] 7.6 容量取得filesystem境界を結合検証する

    -   `test/server/storage-management/storage-filesystem.integration.test.ts`でtemporary監視pathの容量取得、同一path再
        測定、error、symlink/mount観測をadapterへ接続する。
    -   完了時には監視path再測定がstorage側に残り、prepared deletionのfile効果または物理volume同一性を推定していない。
    -   _Requirements: 6.4_
    -   _Boundary: Storage capacity filesystem integration_
    -   _Depends: 6.1_

-   [x] 7.7 通知command process境界を結合検証する

    -   `test/server/storage-management/storage-process.integration.test.ts`でchildのbin/args・合成環境、期限、停止要
        求、terminal cleanupをisolated synthetic childへ接続する。
    -   完了時にはprocess境界の正常・failure・timeout・late terminalが観測され、filesystem削除またはruntime gateをchild
        supervisorへ移していない。
    -   _Requirements: 6.4_
    -   _Boundary: Storage notification process integration_
    -   _Depends: 6.1, 6.2_

-   [x] 7.8 runtime-owned容量削除adapterの外部integrationを確認する

    -   Cross-spec prerequisiteとして、Recorded Content Task 5.8とRuntimeのuse-snapshot、recording/service-child gate、
        approved-order deletion adapterのowner suiteがすべて完了していることを確認する。
    -   `test/server/application-runtime/storage-pressure-deletion.integration.test.ts`のowner testで、副作用なしprepared
        deletion→録画利用gate→service-child利用gate→lock内final delete、busy/unknown時`not-deleted`、逆順一回解放を確認
        する。実行前提は`server-application-runtime`の容量削除adapter owner task完了である。
    -   本specでは`IRecordedStorageDeletionPort`へのcandidate ID/storage名と`deleted`/`not-deleted`/reject後の容量再測定
        有無だけを検証し、録画・encode・配信の取消や候補再選定をadapterへ移さない。
    -   完了時にはstorage consumer contractとruntime provider contractの入力・結果が一致し、いずれかのowner test未実行・
        failureなら本taskは未完了になる。
    -   _Requirements: 6.4_
    -   _Boundary: IRecordedStorageDeletionPort consumer・runtime provider integration_
    -   _Depends: 5.3, 7.4, 7.5, 7.6, 7.7_

-   [x] 7.9 本機能の品質判定を満たす

    -   Task 7.4から7.8の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 7.4, 7.5, 7.6, 7.7, 7.8_
    -   _Requirements: 6.1, 6.2, 6.3, 6.5_
