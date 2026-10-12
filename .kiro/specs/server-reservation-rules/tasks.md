# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、自動予約ルール固有の test と承認済み差分の実装だけを追
加する。

予約件数 query port の入力・結果契約は本 spec、provider 実装は `server-reservation-management` が所有する。既存の
`IReserveDB` 注入を通じて `IRuleReservationCountPort` を `RuleApiModel` へ供給し、追加の composition は設けない。予約
execution coordinator の exact release、期限切れ waiter 除外、衝突しない ID の production 修正と target test も
`server-reservation-management` に一度だけ置く。本 spec は port 契約と provider 完了後の結合確認だけを所有し、予約 row、
差分、競合、skip、最終 duplicate、trigger 順序、IPC・HTTP・event carrier を実装しない。

実装時は 1〜5、6.1、7.1 を provider 非依存の前半として先に完了する。6.2〜6.4、7.2、7.3 は
`server-reservation-management` の全 domain task と owner suite 完了後に実行する。

各 leaf task は 1〜3 時間の実行単位とする。各task本文で明示したtest・production fileを主対象とし、`_Depends_`がないleaf
は共有foundation以外のtask-local prerequisiteを持たない。

### Leaf execution manifest

| Leaf | Concrete target                                                                                                                                           | Test type                                         | Local Depends                                                               | Verification command                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | `test/server/reservation-rules/management.spec.test.ts`                                                                                                   | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`                                                                                      |
| 1.2  | `test/server/reservation-rules/rule-validation.test.ts`                                                                                                   | `unittest/imp`                                    | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/rule-validation.test.ts`                                                                                       |
| 1.3  | `test/server/reservation-rules/change-notification.spec.test.ts`                                                                                          | `unittest/spec`                                   | `1.1, 1.2`                                                                  | `npm run test:server:spec -- test/server/reservation-rules/change-notification.spec.test.ts`                                                                             |
| 1.4  | `test/server/reservation-rules/recording-options.spec.test.ts#RR-4.3` | `unittest/spec, unittest/imp` | `1.2` | `npm run test:server:spec -- test/server/reservation-rules/recording-options.spec.test.ts` |
| 2.1  | `test/server/reservation-rules/management.spec.test.ts`                                                                                                   | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`                                                                                      |
| 2.2  | `test/server/reservation-rules/management.spec.test.ts`                                                                                                   | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`                                                                                      |
| 2.3  | `test/server/reservation-rules/management.spec.test.ts`<br>`test/server/reservation-rules/database-query.test.ts`<br>`src/model/api/rule/RuleApiModel.ts` | `unittest/spec`・`unittest/imp` | `2.1`                                                                       | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-rules/database-query.test.ts` |
| 3.1  | `test/server/reservation-rules/program-search.spec.test.ts`                                                                                               | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/program-search.spec.test.ts`                                                                                  |
| 3.2  | `test/server/reservation-rules/recording-options.spec.test.ts`                                                                                            | `unittest/spec`                                   | `1.1, 3.1`                                                                  | `npm run test:server:spec -- test/server/reservation-rules/recording-options.spec.test.ts`                                                                               |
| 3.3  | `test/server/reservation-rules/duplicate-history.spec.test.ts`                                                                                            | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/duplicate-history.spec.test.ts`                                                                               |
| 3.4  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | `integration`                                     | `3.2, 3.3`                                                                  | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 4.1  | `test/server/reservation-rules/time-rule.spec.test.ts`                                                                                                    | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/time-rule.spec.test.ts`                                                                                       |
| 4.2  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | `integration`                                     | `4.1`                                                                       | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 5.1  | `test/server/reservation-rules/change-notification.spec.test.ts`                                                                                          | `unittest/spec`                                   | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/reservation-rules/change-notification.spec.test.ts`                                                                             |
| 5.2  | `test/server/reservation-rules/rule-mutation-timer.test.ts`                                                                                               | `unittest/imp`                                    | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/rule-mutation-timer.test.ts`                                                                                   |
| 5.3  | `test/server/reservation-rules/characterization.test.ts`                                                                                                  | `unittest/imp` characterization                   | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/characterization.test.ts`                                                                                      |
| 5.4  | `test/server/reservation-rules/characterization.test.ts`                                                                                                  | `unittest/imp` characterization                   | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/characterization.test.ts`                                                                                      |
| 5.5  | `test/server/reservation-rules/time-expansion.test.ts`                                                                                                    | `unittest/imp`                                    | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/time-expansion.test.ts`                                                                                        |
| 6.1  | `test/server/reservation-rules/bulk-and-batch.test.ts`                                                                                                    | `unittest/imp`                                    | なし（共有foundationのみ）                                                  | `npm run test:server:imp -- test/server/reservation-rules/bulk-and-batch.test.ts`                                                                                        |
| 6.2  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | cross-spec `integration`・failure injection       | `6.1`                                                                      | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 6.3  | `test/server/reservation-rules/candidate-recalculation.spec.test.ts`                                                                                      | `unittest/spec`                                   | `6.2`                                                                       | `npm run test:server:spec -- test/server/reservation-rules/candidate-recalculation.spec.test.ts`                                                                         |
| 6.4  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | cross-spec `integration`                          | `6.2, 6.3`                                                                  | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 7.1  | `test/server/reservation-rules/change-notification.spec.test.ts`                                                                                          | `unittest/spec`                                   | `1.3, 6.1`                                                                  | `npm run test:server:spec -- test/server/reservation-rules/change-notification.spec.test.ts`                                                                             |
| 7.2  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | cross-spec `integration`                          | `2.3, 3.4, 6.4`                                                             | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 7.3  | `test/server/reservation-rules/management.spec.test.ts`<br>`test/server/reservation-rules/persistence.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `1.1, 1.2, 1.3, 2.2, 2.3, 3.4, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2` | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-rules/persistence.integration.test.ts` |
| 8.4  | `test/server/reservation-rules/persistence.integration.test.ts`                                                                                           | `integration`                                     | `7.3` | `npm run test:server:integration -- test/server/reservation-rules/persistence.integration.test.ts`                                                                       |
| 8.5  | `test/server/reservation-rules/public-http.integration.test.ts`                                                                                           | `integration`                                     | `7.3` | `npm run test:server:integration -- test/server/reservation-rules/public-http.integration.test.ts`                                                                       |
| 8.6  | `test/server/reservation-rules/ipc-rule-operation.integration.test.ts`                                                                                    | `integration`                                     | `7.3` | `npm run test:server:integration -- test/server/reservation-rules/ipc-rule-operation.integration.test.ts`                                                                |
| 8.7  | `test/server/reservation-rules/candidate-event.integration.test.ts`                                                                                       | `integration`                                     | `6.4, 7.3` | `npm run test:server:integration -- test/server/reservation-rules/candidate-event.integration.test.ts`                                                                   |
| 8.8  | `test/server/reservation-rules/management.spec.test.ts`<br>`test/server/reservation-rules/persistence.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `8.4, 8.5, 8.6, 8.7` | `npm run test:server:spec -- test/server/reservation-rules/management.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-rules/persistence.integration.test.ts` |

-   [x] 1. Rule 集約、検査、および mutation の既存契約を仕様テストで固定する
-   [x] 1.1 Rule 種別、保存 projection、および CRUD 効果を characterization する

    -   既存実装は変更せず、番組検索 Rule と曜日・時刻指定 Rule の識別、database 生成 ID、検索条件、録画条件、有効状態、
        内部更新 count、および JSON 配列の往復保存を `unittest/spec` と `unittest/imp` で固定する。
    -   追加、全体更新、有効化、無効化、単一削除について、成功時の row 効果と対象なし・repository reject の既存結果を
        synthetic Rule fixture で検証する。
    -   DB 接続、driver 差、transaction、repository retry は永続化機能へ委ね、schema、Migration、公開 field を変更しな
        い。
    -   完了時には、両 Rule 種別の作成・再読込・更新・状態変更・削除が承認済み結果を再現し、production code の差分がな
        い。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2_
    -   _Boundary: Rule repository・Rule aggregate_

-   [x] 1.2 (P) Rule 検索・重複回避・encode 条件の受理境界を characterization する

    -   番組検索 Rule の包含・除外 keyword、対象 field、case、regexp、放送局と放送波の排他、genre、曜日時刻、無料、番組
        長、検索期間の正常・不正 matrix を `unittest/spec` で固定する。
    -   曜日・時刻指定 Rule の必須 field、空 channel、空 time、weekday 0、開始秒 0、正の録画秒数と、重複回避期間の組合せ
        を `unittest/imp` で検証する。
    -   現在の設定 snapshot に存在する最大3件の encode mode、各出力先、元 file 削除指定だけを受理し、成立しない検索・重
        複・encode 条件では保存前に reject することを確認する。
    -   完了時には、各反例が Rule row と変更 event を0件のまま失敗し、正常 fixture だけが保存可能になる。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.3, 5.1_
    -   _Boundary: Rule option validator_

-   [x] 1.3 mutation 確定後の Rule event を characterization する

    -   add、update、enable、disable、delete の正常な repository settlement 後に、対応する mutation 種別と Rule ID が一
        回だけ process-local event へ渡ることを `unittest/spec` で固定する。
    -   delete が失敗しても event を渡さず、続けて呼んだ別 Rule の delete は独立に成功して event を渡すことを
        `unittest/spec` で検証する。
    -   削除 ID は将来予約と録画済み関連を整理できる domain payload として渡すだけにし、本機能から予約 row または録画済
        み row を変更しない。
    -   完了時には、正常 mutation と失敗した delete の row 効果、event 件数、payload、順序が一対一に観測できる。
    -   _Requirements: 1.2, 1.3, 1.4, 1.5, 6.1, 7.1, 7.2, 7.3, 7.4_
    -   _Boundary: Rule mutation coordinator・Rule change event port_
    -   _Depends: 1.1, 1.2_

-   [x] 1.4 保存先内ディレクトリの検査を実装する

    -   保存先内directoryと各encode出力先directoryが`..`・先頭`/`の後の`..`・NULで録画保存先の外を指すRuleの追加・変更が
        Rule row・変更eventとも0件で失敗し、`a/../b`・`/anime`は保存されることをtarget testが検証する。
    -   共通の判定関数をRuleの追加・変更の検査へ接続し、他の検証規則と保存形式を変えない。
    -   完了時には、target testが通り、既存の追加・変更の正常系が維持される。
    -   _Requirements: 4.3_
    -   _Boundary: Rule option validator・sub directory_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 1.2_

-   [x] 2. Rule read/query と予約件数 consumer port を契約化する
-   [x] 2.1 一覧、詳細、総件数、および page 条件を characterization する

    -   半角化した keyword の空白区切り token AND、ID 昇順、offset、limit、同じ条件の total、詳細の存在・不存在を
        `unittest/spec` と SQLite/MySQL の `integration` で固定する。
    -   `type` は Rule 種別 filter ではなく page 内 Rule の予約件数指定であり、指定なしでは件数取得を行わないことを確認
        する。
    -   公開 route、status、body、query coercion は carrier ownerへ残し、Rule query の業務意味だけを検証する。
    -   完了時には、0件、複数 page、対象なし、type 有無の各 fixture が承認済みの Rule 集合と total を返す。
    -   _Requirements: 1.6_
    -   _Boundary: Rule query service・Rule repository query_

-   [x] 2.2 keyword 候補の一 Rule 一件・非集約契約を仕様テストで固定する

    -   program/time の両 Rule、同じ keyword を持つ複数 Rule、keyword なし、offset、limit を含む結果を `unittest/spec`
        で検証する。
    -   Rule ID 昇順で各 Rule を一件ずつ返し、同じ keyword を集約せず、keyword なしは空文字列へ投影することを確認する。
    -   Rule 種別 filter、新しい discriminator、keyword group key を追加しない。
    -   完了時には、入力 Rule 数と返却 item 数が page 条件を除いて一致し、同一 keyword の異なる ID がすべて残る。
    -   _Requirements: 1.7_
    -   _Boundary: Rule keyword query_

-   [x] 2.3 予約件数 query port を契約化・接続する

    -   canonical内部contractを`ReservationStateFilter`、値を `'all' | 'normal' | 'conflict' | 'skip' | 'overlap'`、結果
        をreadonly collectionとして固定し、公開queryの`type`と既存値を変更しない。
    -   page内Rule ID列と確定したfilterだけをconsumer-owned portへ一回渡し、空page、port非利用query、順不同・部分結果、
        欠落Rule IDの0件投影、repository rejectを同じ`unittest/spec` targetで検証する。
    -   確定したfilter名・値shape・readonly結果shapeだけからなる内部contractとfake provider seamを実装し、Rule順序、
        total、filter未指定時の非呼出しを維持する。
    -   providerの予約query意味、保存row、追加のcomposition、public field、database schema、IPC envelope、独自変換を追加し
        ない。
    -   完了時には、確定したcontractがtestへ一意に反映され、Rule query coreの
        contract testに予約repository具象が現れない。
    -   _Requirements: 1.6_
    -   _Boundary: Rule query service・IRuleReservationCountPort_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 2.1_

-   [x] 3. 番組候補、録画条件、および履歴由来の重複可能性を固定する
-   [x] 3.1 番組検索条件と database 別結果を characterization する

    -   包含・除外 keyword、検索 field、case、regexp、channel ID 優先、放送波、genre、weekday/time、free、duration、
        search period を保存済み条件のまま Program query へ渡すことを `unittest/spec` で固定する。
    -   `endAt >= evaluatedAt` の現在放送中・将来番組を開始時刻順で返し、SQLite の case-sensitive 無効と regexp
        capability、MySQL の case・regexp を別期待値の `integration` で検証する。
    -   Program query reject は対象 Rule の candidate 更新失敗とし、空 candidate 成功や独自検索 engineへ変換しない。
    -   完了時には、各検索条件と両 database capability の matrix が承認済み Program 集合を再現し、query failure が明示的
        に reject する。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.3_
    -   _Boundary: Program candidate evaluator・Program Rule query_

-   [x] 3.2 番組候補の snapshot と録画条件継承を仕様テストで固定する

    -   Rule ID、内部更新 count、一回の評価時刻、Program ID・更新時刻、Channel、開始・終了、番組 snapshot 全 field を
        `unittest/spec` で番組候補の業務意味として検証する。
    -   途中終了許可、tags、任意の保存先・directory・file名、最大3組の encode 条件と元 file 削除指定を、未指定 fieldへ新
        しい省略値を補わず候補へ継承することを `unittest/imp` で確認する。
    -   候補の業務意味は `updateRule()` 内で `newRuleReserves: Reserve[]` へ投影されるまでの process 内入力に限定し、
        database table、public serialization、予約 row projectionを本 taskで作らない。
    -   完了時には、program candidate fixture の全 field が保存済み Rule と Program snapshotから一意に説明できる。
    -   _Requirements: 4.1, 4.2, 4.4, 6.3, 6.5_
    -   _Boundary: Program candidate projection・same-coordinator `newRuleReserves` handoff_
    -   _Depends: 1.1, 3.1_

-   [x] 3.3 (P) 録画履歴照合と possibleDuplicate を characterization する

    -   重複回避の有無、照合期間あり・なし、短縮名、channel ID、履歴終了時刻の一致・不一致を `unittest/spec` と
        `unittest/imp` で固定する。
    -   一致結果を `possibleDuplicate` として番組候補へ付け、利用者の重複解除と最終 duplicate 状態を予約管理へ委ねること
        を候補の業務意味だけの観測で検証する。
    -   履歴 query reject は対象 Rule の candidate 更新失敗とし、履歴 row の追加・保持・削除を本機能へ移さない。
    -   完了時には、履歴 matrix が true/false の可能性だけを返し、最終予約状態と履歴 row に副作用がない。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.5, 6.6_
    -   _Boundary: Recorded history semantics・possibleDuplicate projection_

-   [x] 3.4 candidate handoff と予約管理 owner 境界を統合検証する

    -   番組候補と空候補が `updateRule()` 内の `newRuleReserves: Reserve[]` からprivate `createDiff()`へ渡り、query failure
        はそのhandoffに到達しないことを `integration` で確認する。
    -   本機能が所有する観測点を Rule ID、候補対象、録画条件、possibleDuplicate までと
        し、insert/update/delete、conflict、skip、duplicate解除・最終状態の判断を assertion 内で再実装しない。
    -   同じ物理 component 内の candidate 計算と予約差分を論理 seam で分け、新しい carrier、version、queueを追加しない。
    -   完了時には、handoff 入力が `newRuleReserves: Reserve[]` で表現され、予約差分 owner の内部判断に依存しない contract
        test が成功する。
    -   _Requirements: 5.3, 5.5, 6.3, 6.5, 6.6_
    -   _Boundary: Candidate handoff seam_
    -   _Depends: 3.2, 3.3_

-   [x] 4. 曜日・時刻候補の既存意味を仕様テストで固定する
-   [x] 4.1 0件条件、8日展開、および開始日の曜日判定を characterization する

    -   空 channel、空 time、weekday 0 を受理して候補0件とし、開始秒 0、正の録画秒数、当日から7日後までを
        `unittest/spec` で検証する。
    -   指定曜日の開始・終了 epoch、`endAt < evaluatedAt` の除外、翌日以降まで続く録画で開始日の曜日だけを見る既存計算を
        fake clock の `unittest/imp` で固定する。
    -   対象時間帯の Program 存在確認を行わず、Channel snapshot と表示名を持つ時間候補の業務意味を `newRuleReserves` へ投影
        する。
    -   完了時には、空条件、端点、8日、翌日超過、番組不存在の fixture が承認済み candidate 列を再現する。
    -   _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 4.4, 6.4, 6.5_
    -   _Boundary: Time candidate evaluator_

-   [x] 4.2 Channel 部分失敗を authoritative な候補部分集合として固定する

    -   Channel A の成功、B の reject、C の対象なし、および全件失敗を与え、取得できた Channel だけの時間候補を
        `unittest/spec` と `integration` で確認する。
    -   部分集合と空配列のどちらにも完全性 flag を追加せず、一 Rule 分の全置換入力として handoff する。
    -   取得できなかった Channel に対応する既存予約の扱いは予約管理へ委ね、本機能testで削除差分を生成しない。
    -   完了時には、Aだけまたは空の正準候補配列が一回 handoff され、B/C の失敗が別 Channel の候補作成を止めない。
    -   _Requirements: 3.7, 4.4, 6.4, 6.5, 6.6_
    -   _Boundary: Time candidate evaluator・Channel query・Candidate handoff_
    -   _Depends: 4.1_

-   [x] 5. Design に列挙された実装特性を正常契約から独立して固定する
-   [x] 5.1 Rule insert reject を呼出元へ返す

    -   insert reject 時に error を記録して再送出し、追加成功の log、added event、および ID の返却を行わないことを
        `unittest/spec` で固定する。後続の add は引き続き実行される。
    -   公開 API では、この error が IPC 応答、`RuleApiModel`、公開 HTTP adapter を経て status 500 の既存 error projection
        になることを、既存の層別 test で確認する。
    -   完了時には、reject、log、event 件数、後続 add の実行が一つの明示 test で観測できる。
    -   _Requirements: 1.2, 6.1_
    -   _Boundary: Rule mutation insert-failure propagation_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 5.2 mutation queue と10秒 timer の安全弁を独立 characterization する

    -   重なった mutation を queue で直列に実行し、queue の先頭が10秒確定しなくても先頭を打ち切らずに後続を進める安全弁
        timer を fake timer で観測する。timer は teardown 後に 0 件にする。
    -   10秒 timer を実行権の奪取、retry、強制完了として扱わない。
    -   完了時には、同時 mutation の開始順と timer 発火後状態が偶然の timing に依存せず観測できる。
    -   _Requirements: 1.2, 1.3, 1.4, 1.5, 6.1_
    -   _Boundary: Rule mutation queue and timer_
    -   _Verification: unittest/imp_

-   [x] 5.3 time Rule keyword の runtime 必須・public schema optional 差を独立 characterization する

    -   keyword 省略を共有 public schema が表現できる一方、runtime validator と candidate evaluator が拒否する差を別
        contract fixture で固定する。
    -   runtime の既存受理条件を schema optional へ合わせず、新しい discriminator、field、error body を追加しない。
    -   完了時には、schema validation と runtime operation の相違が一つずつ観測でき、どちらかを他方の保証として扱わな
        い。
    -   _Requirements: 3.1, 3.2, 3.3_
    -   _Boundary: Time Rule schema/runtime characterization_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 5.4 keyword query が両 Rule 種別を返す特性を独立 characterization する

    -   program/time の両 Rule、同一 keyword、keyword なしを実 repository 経路へ保存し、ID順・一Rule一件・非集約の挙動を
        characterization する。
    -   2.2 の正常契約testとは fixture と test名を分け、program Ruleだけへの絞り込みや keyword dedupe を追加しない。
    -   完了時には、両種別の各 ID が別 item として返り、production code の差分がない。
    -   _Requirements: 1.7_
    -   _Boundary: Rule keyword repository characterization_
    -   _Verification: unittest/imp, integration_

-   [x] 5.5 local 年月日・JST midnight・local weekday の分離を独立 characterization する

    -   process timezone を日本標準時、UTC、非日本標準時へ切り替え、local 年月日から作る JST 0時と `Date.getDay()` の
        local weekday が分離することを isolated process で再現する。
    -   一貫した timezone calendar、timezone設定、DST補正を追加せず、通常の time candidate testと fixtureを分ける。
    -   完了時には、各 timezone の基準 epoch と曜日選択が承認済み split を再現し、実環境 timezone に依存しない。
    -   _Requirements: 3.4, 3.5, 3.6, 3.8_
    -   _Boundary: Time candidate timezone characterization_
    -   _Verification: unittest/imp_

-   [x] 6. trigger、逐次 batch、および reservation execution contract を検証する
-   [x] 6.1 Rule変更・番組更新ごとの非合流とID順逐次処理を characterization する

    -   add、update、enable、disable の各通知が同じ Rule IDでも個別の対象再計算要求となり、番組更新の各発火が保存済み
        Rule IDを別々に列挙することを `unittest/spec` で固定する。
    -   一つの全件再計算ではRule ID順に一件ずつsettleし、成功・failure後に10ms待って次へ進み、全件をeagerに開始しないこ
        とを fake timer で検証する。
    -   重ねた全件要求を合流せず、各callのID列とPromiseを独立させ、execution item境界で入り交じり得ることを確認する。
    -   完了時には、targeted通知数、全件call数、開始・settlement順、failure後続がdeterministicな記録として観測できる。
    -   _Requirements: 6.1, 6.2, 6.7, 6.8, 6.9, 6.11, 6.12, 7.5_
    -   _Boundary: Candidate handoff seam・all-rule batch entrypoint_

-   [x] 6.2 owner完了後にread・handoff・全終了経路をcandidate側から結合検証する

    -   `server-reservation-management` の owner suite が成功した coordinator instanceを使い、一 Rule処理が実行権取得後
        にRule、Program、Channel、履歴、関連予約を読み、candidate handoffの成功または処理別failureまでexact IDを保持する
        ことを結合検証する。
    -   Rule read reject、欠落 time field、Program・履歴・Channel・差分 reject、同期例外、早期returnの各経路で、一回
        release後に同じbatchの次Ruleが進むことをowner coordinatorとcandidate fixtureで固定する。
    -   read前unlock、再取得、同一read共有、generation・updateCnt・row stampの再検証を期待値にしない。
    -   本taskではowner側のqueue、ID、waiter、release実装を変更せず、contract不一致は `server-reservation-management` へ
        返す。
    -   完了時には、exact hold/releaseとfailure後続のcandidate-side integrationが成功する。
    -   _Requirements: 6.7, 6.10, 6.11_
    -   _Boundary: Candidate-side ReservationExecutionCoordinator post-owner integration_
    -   _Verification: unittest/spec, cross-spec integration, failure injection_
    -   _Depends: 6.1_

-   [x] 6.3 owner watchdog と late settlement をcandidate側から結合検証する

    -   実行権取得後600,000msの直前・到達・超過で Rule readを未確定にし、watchdog先着時もexact IDを解放済みとせず、同じ
        batchの後続Ruleと同じlaneの別operationを開始しないowner契約をcandidate fixtureから確認する。
    -   進行中の録画、配信、番組更新、保存先監視、および当該laneを使わないqueryは継続し、operator fatalや別domain停止へ
        接続しないことを independent spies で検証する。
    -   元Promiseのlate success/rejectで候補計算・DB処理を再実行せず、通常のcatch/finally/event経路、exact release、後続
        Rule再開を一回だけ行う期待値を固定する。
    -   本taskではwatchdog、queue、late settlement guardを実装せず、owner suiteが確定した同じcoordinator instanceを使
        う。
    -   完了時には、watchdog log、未解放owner、別domain継続、late settlement、release、後続再開の各観測点が独立し、
        candidate-side integrationが成功する。
    -   _Requirements: 6.10, 6.13_
    -   _Boundary: Candidate-side owner-watchdog post-owner integration_
    -   _Verification: unittest/spec, cross-spec integration, fake timer, deferred Promise_
    -   _Depends: 6.2_

-   [x] 6.4 reservation-management owner 修正後に candidate-side execution contract を結合検証する

    -   downstream owner が実装した単調増加ID、waiting/granted/expired/released、期限切れentry除外、exact一回releaseを同
        一 coordinator instance 経由で利用する `integration` testを実行する。
    -   一件failure後の後続、600秒 overdue中の同batch停止、別domain継続、late settlementの一回確定と再開を、6.2・6.3の
        candidate-side fixtureから観測する。
    -   本taskではexecution coordinator、予約row、差分、競合、skip、最終duplicateのproduction codeを変更せず、provider
        contract不一致は予約管理ownerへ返す。
    -   完了時には、6.2・6.3のpost-owner integrationが成功する。
    -   _Requirements: 6.7, 6.10, 6.11, 6.13_
    -   _Boundary: Candidate handoff・ReservationExecutionCoordinator integration_
    -   _Depends: 6.2, 6.3_

-   [x] 7. owner境界を越える Rule contract を統合し、domain suiteを完成させる
-   [x] 7.1 Rule mutation、candidate再計算、削除ID、および起動後再読込を統合検証する

    -   add、update、enable、disable、deleteのdomain eventからfake workflow consumerへの対象Rule入力、削除後の空候補、録
        画済み関連整理用IDを `integration` で追跡する。
    -   初回番組更新相当の入口で保存済みRule IDを昇順に読み、実際の `updateRule()` が実行権取得後に各Ruleを再読込し、無
        効Ruleを既存の予約差分処理へ空候補として渡すことを `integration` で確認する。
    -   triggerの全体順、画面・hook・IPC配送、recorded relationの実変更は各ownerへ残し、本specではevent payloadと
        candidate entrypointだけを検証する。
    -   完了時には、各domain triggerが承認済みRule IDと候補入力へ一対一に到達し、削除済みRuleが後続列挙へ現れない。
    -   _Requirements: 6.1, 6.2, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5_
    -   _Boundary: Rule change event・Candidate entrypoint integration_
    -   _Depends: 1.3, 6.1_

-   [x] 7.2 実在する予約件数portと同一coordinator内のcandidate-to-diff handoffを検証する

    -   `ReserveDB`が実装する`IRuleReservationCountPort`をRule queryへ接続した`integration` fixtureで、page内ID・
        canonical filter名・readonly結果shape・欠落0件・provider rejectionを確認する。存在しないportや代替provider実装を
        作らない。
    -   実際の`ReservationManageModel.updateRule()`が、Ruleの業務意味から作る`newRuleReserves: Reserve[]`を同一
        coordinator instanceのprivate `createDiff()`へ渡すことを観測し、番組候補field、入力順、空配列、および
        `createDiff()` failure時のevent非発行とexact releaseを確認する。
    -   別候補型、consumer port、reconcile API、test専用 adapter、追加のcompositionを設けず、最終予約差分、identity、
        state、conflict、保存、およびevent順序は録画予約管理owner testへ残す。
    -   完了時には、Rulesが候補の業務意味だけを所有し、予約管理が既存の同一coordinator内で差分まで完了することがtarget
        testで確認できる。
    -   _Requirements: 1.6, 5.3, 5.5, 6.5, 6.6_
    -   _Boundary: IRuleReservationCountPort・same-coordinator `newRuleReserves` → private `createDiff()` integration_
    -   _Depends: 2.3, 3.4, 6.4_

-   [x] 7.3 自動予約ルールdomain suiteを共有server test matrixへ統合する

    -   Rule CRUD/query/validation、番組・時刻candidate、履歴照合、trigger/batch、execution handoff、および6件の独立
        characterizationを共有の `unittest/spec`、`unittest/imp`、`integration` commandから実行できるようにする。
    -   Node.js 24を必須gate、Node.js 26を同じsuiteの追加gateとして実行し、matrix定義自体は本specで複製しない。
    -   SQLite/MySQL、fake clock、isolated timezone、deferred Promiseのsynthetic fixtureだけを使い、実Rule、実番組、実
        Channel、実履歴、実保存先、credential、machine pathをartifactへ含めない。
    -   完了時には、domain suiteとhandoff integrationが共有commandから成功する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4,
        3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
        6.10, 6.11, 6.12, 6.13, 7.1, 7.2, 7.3, 7.4, 7.5_
    -   _Boundary: 自動予約ルールdomain validation_
    -   _Depends: 1.1, 1.2, 1.3, 2.2, 2.3, 3.4, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2_

-   [x] 8. 機能固有の品質を閉じる
-   [x] 8.4 SQLite・MySQLのRule保存・検索・履歴照合を結合検証する

    -   `test/server/reservation-rules/persistence.integration.test.ts`でRule保存・検索・履歴照合をSQLite・MySQLの
        synthetic fixtureへ接続し、DB別case/regexp結果とtransaction境界を検証する。
    -   完了時にはDB別結果が承認済みcontractに一致し、Rule行と予約行を一つのtransactionへまとめない。
    -   _Requirements: 8.4_
    -   _Boundary: Rule persistence integration_
    -   _Depends: 7.3_

-   [x] 8.5 公開HTTP adapter境界を結合検証する

    -   `test/server/reservation-rules/public-http.integration.test.ts`で既存method/status/body、optional field、
        not-found/error projectionをsynthetic domain fixtureへ接続する。
    -   完了時にはHTTP契約が承認済みcarrierに一致し、新しいwire fieldまたはrouteを追加していない。
    -   _Requirements: 8.4_
    -   _Boundary: Rule public HTTP carrier integration_
    -   _Depends: 7.3_

-   [x] 8.6 Rule操作IPC carrier境界を結合検証する

    -   `test/server/reservation-rules/ipc-rule-operation.integration.test.ts`で既存IPC envelope、応答、timeout後の
        domain継続をsynthetic fixtureへ接続し、HTTP、filesystem、child processの非適用理由を残す。
    -   完了時にはIPC契約が承認済みcarrierに一致し、新しいversion、業務IPC、domain取消を追加していない。
    -   _Requirements: 8.4_
    -   _Boundary: Rule IPC carrier integration_
    -   _Depends: 7.3_

-   [x] 8.7 候補handoff・予約transaction・event確定順を結合検証する

    -   `test/server/reservation-rules/candidate-event.integration.test.ts`で予約管理ownerが所有するtransactionへ正準候
        補を渡し、予約管理がidentity reconciliationを行うこと、commit後event一回、rollback時event 0回、exact実行権解放、
        期限後確定、およびresource cleanupを確認する。
    -   完了時には候補引渡しから予約transaction settlementとeventまでのcall ledgerが一意で、Rule側が予約差分判断を重複実
        装していない。
    -   _Requirements: 8.4_
    -   _Boundary: candidate semantics・same-coordinator reservation transaction・event integration_
    -   _Depends: 6.4, 7.3_

-   [x] 8.8 本機能の品質判定を満たす

    -   Task 8.4から8.7の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 8.4, 8.5, 8.6, 8.7_
    -   _Requirements: 8.1, 8.2, 8.3, 8.5_
