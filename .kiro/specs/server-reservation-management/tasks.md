# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、録画予約管理固有の test と承認済み差分の最小実装だけを追加
する。

候補の条件評価と業務意味は `server-reservation-rules` が所有する。本 spec は同一 coordinator 内の
`ReservationManageModel.updateRule()`が作る`newRuleReserves: Reserve[]`からprivate `createDiff()`へのhandoff後の予約 row、
候補差分、最終 duplicate、skip、競合、および保存を所有する。Rule別予約件数 port の契約は rules、provider実装は本 specが
所有し、既存の `IReserveDB` 注入を通じて `IRuleReservationCountPort` を供給する。追加の composition は設けない。

番組の意味は `server-program-guide`、tuner REST と能力正規化は `server-tuner-access`、DB lifecycle と driver retry は
`server-persistence`、録画 timer/session は `server-recording-execution`、HTTP・IPC carrier は後続 owner に残す。外部
spec の task ID は local `_Depends:` に記載しない。

`server-application-runtime`所有の共有 foundation task は本 spec の外部 prerequisite である。

## Leaf execution contract

共有 Runtime owner が提供する固定 command を消費する。以下は leaf ごとの target、種別、local dependency、実行入口であ
り、Runtime の runner・script・flag を再定義しない。

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Test type                                                       | Local Depends                                                                                             | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/reservation-management/reservation-types.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                               | `unittest/spec`・`unittest/imp`・`integration`                  | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/reservation-types.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.2  | `test/server/reservation-management/reservation-types.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`unittest/imp`                                 | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/reservation-types.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.3  | `test/server/reservation-management/queries.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                         | `unittest/spec`・`unittest/imp`・`integration`                  | `1.1, 1.2`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/queries.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.4  | `test/server/reservation-management/queries.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`<br>`src/model/db/ReserveDB.ts`                                                                                                                                                                                                                                                                                                                          | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `1.3`                                                                                                     | `npm run test:server:spec -- test/server/reservation-management/queries.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.1  | `test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`・`integration`                  | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.2  | `test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`・`integration` characterization | `1.1, 1.2`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.3  | `test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`                                                                                                                                                                                                                                                                                    | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `2.1, 2.2`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.4  | `test/server/reservation-management/manual-mutations.spec.test.ts#RM-2.13` | `unittest/spec, unittest/imp` | `2.3` | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts` |
| 2.5  | `test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/update-program-found.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts` | `unittest/spec` RED・`unittest/imp` GREEN・`integration` | `2.3` | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/update-program-found.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts` |
| 3.1  | `test/server/reservation-management/rule-reconciliation.spec.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                         | `unittest/spec`・`unittest/imp`・`integration` characterization | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/rule-reconciliation.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/candidate-identity.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3.2  | `test/server/reservation-management/rule-reconciliation.spec.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`・`unittest/imp`                                 | `1.2, 3.1`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/rule-reconciliation.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/candidate-identity.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4.1  | `test/server/reservation-management/relay.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`unittest/imp`・`integration`                  | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/relay.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4.2  | `test/server/reservation-management/relay.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`unittest/imp` characterization・`integration` | `4.1`                                                                                                     | `npm run test:server:spec -- test/server/reservation-management/relay.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4.3  | `test/server/reservation-management/relay.spec.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`                                                                                                                                                                                                                                                                                               | `unittest/spec`・`unittest/imp`・`integration`                  | `2.3, 4.1`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/relay.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/candidate-identity.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5.1  | `test/server/reservation-management/conflict-planning.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`unittest/imp`                                 | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/conflict-planning.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5.2  | `test/server/reservation-management/state-transitions.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                     | `unittest/spec`・`unittest/imp` characterization                | `1.2, 5.1`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/state-transitions.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5.3  | `test/server/reservation-management/state-transitions.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`                                                                                                                                                                                                                                                                                       | `unittest/spec`・`unittest/imp`・`integration`                  | `5.2`                                                                                                     | `npm run test:server:spec -- test/server/reservation-management/state-transitions.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6.1  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/characterization.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                              | `unittest/spec`・`unittest/imp`・`integration`                  | なし（共有foundationのみ）                                                                                | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/characterization.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6.2  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`                                                                                                                                                                                                                                                                          | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `5.3, 6.1`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/candidate-identity.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6.3  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`<br>`src/model/db/ReserveDB.ts`                                                                                                                                                                                                                                     | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `5.1, 5.3`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/candidate-identity.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6.4  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                               | `unittest/spec`・`integration` restart harness                  | `6.2, 6.3`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7.1  | `test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts` | `unittest/imp`・`unittest/spec`・fake timer | なし（共有foundationのみ）                                                                                | `npm run test:server:imp -- test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts` |
| 7.2  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/ExecutionManagementModel.ts`                                                                                                                                                                                                                                                                                          | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `7.1`                                                                                                     | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7.3  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/ExecutionManagementModel.ts`                                                                                                                                                                                                                                                                                          | `unittest/spec` RED・`unittest/imp` GREEN・`integration`        | `7.2`                                                                                                     | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7.4  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`                                                                                                                                                                                                                                                                       | `unittest/spec`・`unittest/imp`・`integration`                  | `2.3, 3.1, 4.3, 6.2, 6.3, 7.3`                                                                            | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7.5  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                               | `unittest/spec`・`integration`                                  | `3.1, 7.4`                                                                                                | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8.1  | `test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `integration`                                                   | `1.4, 3.1, 6.3`                                                                                           | `npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8.2  | `test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`test/server/reservation-management/reservation-ipc.integration.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`integration`                                  | `1.3, 2.3, 6.2, 7.4`                                                                                      | `npm run test:server:spec -- test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-ipc.integration.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8.3  | `test/server/reservation-management/tuner-snapshot.spec.test.ts`<br>`test/server/reservation-management/reservation-event.integration.test.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`<br>`src/index.ts`                                                                                                                                                                                                                                                                                                                                           | `unittest/spec`・`integration` restart harness                  | `1.4, 3.1, 4.3, 5.3, 6.4, 7.5`                                                                            | `npm run test:server:spec -- test/server/reservation-management/tuner-snapshot.spec.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8.4  | `test/server/reservation-management/reservation-types.spec.test.ts`<br>`test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                               | `unittest/spec`・`unittest/imp`・`integration`                  | `1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 4.2, 4.3, 5.3, 6.2, 6.3, 6.4, 7.1, 7.4, 7.5, 8.1, 8.2, 8.3` | `npm run test:server:spec -- test/server/reservation-management/reservation-types.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9.1  | `test/server/reservation-management/reservation-types.spec.test.ts`<br>`test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/rule-reconciliation.spec.test.ts`<br>`test/server/reservation-management/relay.spec.test.ts`<br>`test/server/reservation-management/state-transitions.spec.test.ts`<br>`test/server/reservation-management/conflict-planning.spec.test.ts`<br>`test/server/reservation-management/queries.spec.test.ts`<br>`test/server/reservation-management/lifecycle-diff-concurrency.spec.test.ts` | `unittest/spec` | `8.4` | `npm run test:server:spec -- test/server/reservation-management/reservation-types.spec.test.ts` |
| 9.2  | `test/server/reservation-management/classification.imp.test.ts`<br>`test/server/reservation-management/candidate-identity.imp.test.ts`<br>`test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/characterization.test.ts` | `unittest/imp` | `9.1` | `npm run test:server:imp -- test/server/reservation-management/classification.imp.test.ts` |
| 9.4  | `test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `integration`                                                   | `8.1` | `npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9.5  | `test/server/reservation-management/reservation-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `integration`                                                   | `8.2` | `npm run test:server:integration -- test/server/reservation-management/reservation-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9.6  | `test/server/reservation-management/reservation-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `integration`                                                   | `8.2` | `npm run test:server:integration -- test/server/reservation-management/reservation-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9.7  | `test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `integration`                                                   | `8.3` | `npm run test:server:integration -- test/server/reservation-management/reservation-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9.8  | `test/server/reservation-management/manual-mutations.spec.test.ts`<br>`test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`test/server/reservation-management/reservation-persistence.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `9.4, 9.5, 9.6, 9.7` | `npm run test:server:spec -- test/server/reservation-management/manual-mutations.spec.test.ts`<br>`npm run test:server:imp -- test/server/reservation-management/execution-coordinator.imp.test.ts`<br>`npm run test:server:integration -- test/server/reservation-management/reservation-persistence.integration.test.ts` |

-   [x] 1. 予約 data、状態、および query の既存契約を固定する
-   [x] 1.1 四つの予約種類と保存する録画条件を characterization する

    -   番組指定手動、時刻指定手動、番組リレー、自動予約と、自動予約の番組・時刻候補形式を、既存 flag と対象情報から区別
        する `unittest/spec` を追加する。
    -   放送局、生の開始・終了時刻、番組 snapshot、途中終了許可、tags、保存先、file 名形式、最大3組の encode 条件と元
        file 削除指定を synthetic fixture で保存・再読込する。
    -   時刻指定手動予約の二つの既存 flag、番組リレーの元条件継承、および新しい保存 discriminator を追加しない境界を固定
        する。
    -   完了時には、四種類と二つの自動候補形式が同じ reservation row から一意に判別され、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3_
    -   _Boundary: Reservation aggregate・reservation persistence projection_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.2 (P) 独立状態 flag と録画候補 predicate を characterization する

    -   `conflict`、`skip`、`overlap` の8組合せを排他化せず保存し、`skip` または `overlap` の予約だけを録画候補から除外
        することを表駆動の `unittest/spec` で固定する。
    -   一覧・件数の `conflict > skip > overlap > normal` precedence と、exact state filter が複合 flag rowを返さない既
        存意味を同じ fixture で検証する。
    -   完了時には、8組合せすべての保存状態、一覧分類、および録画候補への採否が観測でき、状態を単一 enum へ変更していな
        い。
    -   _Requirements: 1.4, 1.5, 1.6, 7.1, 7.6, 8.5, 8.6_
    -   _Boundary: Reservation state classification・recording candidate projection_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 1.3 予約一覧、詳細、件数、および既存 projection を characterization する

    -   全件と normal/conflict/skip/overlap の exact filter、Rule IDとのAND、開始時刻昇順、offset、limit、同条件の total
        を `unittest/spec` と SQLite/MySQL `integration` で固定する。
    -   詳細では予約種類、状態、対象、時刻、録画条件、第一・第三 encode directory を既存 optional 条件で返し、保存済み第
        二 encode directory と番組リレー discriminator を公開しないことを確認する。
    -   対象なし、0件、複合 flag、半角化、時間範囲の両端を含む query を synthetic fixture で検証する。
    -   HTTP route、status は carrier ownerへ残し、本 taskでは domain query と projectionだ
        けを固定する。
    -   完了時には、一覧、total、状態別 ID・件数、詳細、対象なしが承認済みの既存形式を再現する。
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
    -   _Boundary: Reservation query service・public reservation projection_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration_
    -   _Depends: 1.1, 1.2_

-   [x] 1.4 Rule別予約件数providerを一つのTDD単位で契約化・接続する

    -   rules側consumerと同じ`ReservationStateFilter`、既存5値、およびreadonly結果collectionを使用し、公開query
        の`type`、database filter、および変換規則を変更しない。
    -   page内Rule ID列と確定したfilterを受けるprovider contractをrules側consumerと同じfixtureへ定義し、空ID列、順不同・
        部分結果、exact filter、repository rejectを同じ`unittest/spec` targetでRED確認する。
    -   確定したfilter名・値shape・readonly結果shapeだけを扱うprovider adapterを既存予約queryへ最小接続し、欠落Ruleの0件
        投影はconsumer側へ残して同じtargetをGREENにする。
    -   database schema、公開field、IPC envelope、独自cache、retry、追加のcompositionを設けない。
    -   完了時には確定したcontractがtestへ一意に反映され、同じtestのRED→最小production→GREENが閉じ、rules側query coreが
        予約repository具象へ直接依存しない。
    -   _Requirements: 7.2, 7.3, 7.6_
    -   _Boundary: Reservation query service・IRuleReservationCountPort provider_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, integration_
    -   _Depends: 1.3_

-   [x] 2. 手動予約 mutation と状態変更を既存契約・承認済み差分へ揃える
-   [x] 2.1 番組指定・時刻指定手動予約の追加を characterization する

    -   番組・放送局の存在、同一番組と同一時間指定の重複、終了時刻境界、保存 snapshot、返却ID、および
        `database commit → unlock → event` の順序を `unittest/spec` で固定する。
    -   追加では、encode条件の検査と時刻指定入力の存在判定のどちらか一方でも失敗すれば、実行権の取得前に
        `AddReservationOptionError`で失敗し、不正なencode条件の予約を保存しないことを`unittest/spec`で固定する。
    -   完了時には、正常追加、対象なし、重複、repository failureのrow効果とevent件数が観測でき、不正なencode条件の追加が
        取得0・保存0で拒否される。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.13, 8.5, 8.14_
    -   _Boundary: Reservation mutation coordinator・manual reservation creation_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 2.2 手動編集、取消、除外解除、および重複解除を characterization する

    -   途中終了許可、指定時だけのtags更新、保存先・encode group内省略とgroup全体省略、時刻指定名維持を
        `unittest/spec`で固定する。
    -   手動・relayはdelete、rule由来非relayはskipまたはoverlap維持、除外・重複解除は競合再計算という既存状態効果を検証
        する。rule由来非relayの取消は同じ番組の他ruleの予約（重複状態を含む）も同じ差分で削除し、除外解除は同じ番組の他ruleの
        除外も解除することを含める。
    -   rule予約の編集を変更前に拒否し、編集保存時刻を更新し、不正encode入力は実行権を取得する前に拒否することを
        `unittest/spec`で固定する。
    -   完了時には、各種類・状態のrow効果、競合差分、commit/unlock/event順、rule予約の編集拒否、編集保存時刻の更新、不正encode入力の取得前拒否が別testで観測できる。
    -   _Requirements: 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 5.1, 5.2, 5.3, 5.5, 5.6, 8.5, 8.14, 8.17_
    -   _Boundary: Reservation mutation coordinator・manual edit・reservation state transition_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_
    -   _Depends: 1.1, 1.2_

-   [x] 2.3 手動追加・編集の承認済み差分を一つのTDD単位で実装する

    -   時刻指定追加は `startAt < endAt` かつ `endAt > now`、手動・relay追加はskip/overlapだけを除いた既存conflict予約も
        事前計画へ含める期待値を先に固定する。
    -   編集は手動予約のpredicateを満たすrowだけをfield変更前に受理し（手動由来の番組リレー予約は2.5で加える）、保存成功時に
        `updateTime`を更新する期待値を定義する。
    -   既存option受理範囲、時刻指定名、公開field、競合時の新規row0件を変更しない assertionを含める。
    -   2.1・2.2のcharacterizationを維持し、承認済み差分だけが現行productionとの差でREDになることを確認してから、時刻区
        間検査、通常・競合を含む追加事前計画、exact manual predicate、編集保存時刻更新だけを追加する。
    -   add/editの入力、queue entry、Promiseをcallごとに分離し、CAS、generation、retry、request合流、public schema変更を
        追加しない。
    -   完了時には、同じtarget testがGREENとなり、正常追加・編集・取消の既存row/event結果が維持される。
    -   _Requirements: 2.3, 2.5, 2.6, 2.11, 4.5, 6.5, 8.14, 8.17_
    -   _Boundary: Reservation mutation coordinator・manual mutation delta_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, integration_
    -   _Depends: 2.1, 2.2_

-   [x] 2.4 手動追加・編集の保存先内ディレクトリ検査を一つのTDD単位で実装する

    -   保存先内ディレクトリとencode出力先ディレクトリが`..`・先頭`/`の後の`..`・NULで録画保存先の外を指す追加・編集が、実
        行権取得0回・DB効果0件・event0件で失敗し、`a/../b`・`/anime`は従来どおり保存される期待値を先に定義して、現行実装で
        REDになることを確認する。
    -   共通の判定関数を追加・編集の入口検査へ接続する最小実装を行い、既存のencode option検査、時刻指定入力検査、競合検査
        の結果を変えない。
    -   完了時には、同じtarget testがGREENとなり、既存の追加・編集の正常系が維持される。
    -   _Requirements: 2.13_
    -   _Boundary: Reservation mutation coordinator・manual option validation_
    -   _Verification: unittest/spec RED, unittest/imp GREEN_
    -   _Depends: 2.3_

-   [x] 2.5 手動由来の番組リレー予約の編集を一つのTDD単位で受理する

    -   手動由来の番組リレー予約（`ruleId === null && isTimeSpecified === false && isEventRelay === true && programId !== null`）
        の編集が、番組指定手動予約と同じ更新規則でfieldと`updateTime`を変更し、`updateOnce`→unlock→eventの順で完了する期待値
        を先に定義し、現行実装でREDになることを確認する。
    -   番組自動予約、時刻自動予約、rule由来の番組リレー予約と、`isTimeSpecified`・`isEventRelay`単独で手動判定しない
        near miss は、fieldを変更せず`ReservationIsNotEditable`で拒否し、入力・encode option不正の`ReservationEditError`と
        区別する期待値を定義する。
    -   編集の受理判定に手動由来の番組リレー予約のpredicateを加え、受理しないrowの失敗を`ReservationIsNotEditable`にする最小
        実装を行い、競合再計算と公開形式を変えない。
    -   番組情報の更新（`update`）の後も、手動由来の番組リレー予約で編集した録画条件（途中終了許可、tags、保存先、encode）が
        維持されることを`unittest/imp`で確かめる。
    -   完了時には、同じtarget testがGREENとなり、既存の手動予約の編集と拒否のcaseが維持される。
    -   _Requirements: 2.6_
    -   _Boundary: Reservation mutation coordinator・manual edit_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, integration_
    -   _Depends: 2.3_

-   [x] 3. 自動予約候補から予約差分を作る契約を実装・検証する
-   [x] 3.1 番組・時刻候補の予約row投影と差分を characterization する

    -   正準候補のRule ID、更新count、評価時刻、番組/放送局snapshot、録画条件、重複可能性を予約rowへ投影する。
    -   番組は`ruleId + programId`、時刻は`ruleId + startAt + endAt + channel`で既存rowと対応付け、insert/update/delete
        をdelete→insert→updateの一transactionへ渡す既存意味を検証する。
    -   空候補、無効・削除Rule、relay row保持、部分channel集合、rollback後のprocess内採番ID残存を独立fixtureで固定する。
    -   完了時には、番組候補・時刻候補・空候補の差分とrollback/event非発行が観測でき、production codeの差分がない。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.4, 8.5_
    -   _Boundary: Rule reservation reconciler・ReservationDiff persistence_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration, characterization_

-   [x] 3.2 自動候補の状態継承と最終duplicate判定を characterization する

    -   既存同一identityのskip・ignoreOverlapを保持し、番組候補のpossibleDuplicateを最終overlapへ反映する規則を表駆動
        testで固定する。
    -   ignoreOverlap済み番組候補と時刻候補では保存済みoverlapを維持し、conflictをcandidateから受け取らずplannerで決める
        ことを確認する。
    -   いずれかのRuleの予約が除外状態の番組では、他Ruleのcandidateを（重複状態を含めて）予約にせず保存済みの予約を削除し、
        別Ruleの除外状態の予約は残すことを確認する。
    -   除外解除は同じ番組の他Ruleの除外も解除して有効な予約が一件に戻ること、Ruleの削除・無効化で除外状態も残らず次の反映
        で他Ruleのcandidateに戻ること、手動予約と番組リレー予約は影響を受けないことを確認する。
    -   完了時には、候補種類、既存状態、possibleDuplicateの組合せごとの予約状態が一意に観測できる。
    -   _Requirements: 3.3, 5.1, 5.3, 5.4, 5.6_
    -   _Boundary: Rule reservation reconciler・duplicate state ownership_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration_
    -   _Depends: 1.2, 3.1_

-   [x] 4. 番組リレー予約の既存意味と追加境界を検証する
-   [x] 4.1 後続番組と元予約から番組リレー予約を作る契約を characterization する

    -   後続Program snapshotと、元予約のRule関連、途中終了許可、tags、保存先、file名、最大3組のencode条件、元file削除指
        定を引き継ぐことを検証する。
    -   同じ後続番組が既存なら`null`、正常なら予約ID、番組・競合・DB failureならrejectし、成功時だけinsert diffを発行す
        る。
    -   完了時には、手動由来・Rule由来の両relay fixtureで継承field、返却値、row効果、eventが観測できる。
    -   _Requirements: 4.1, 4.2, 4.3, 4.5_
    -   _Boundary: Event relay reservation coordinator_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 4.2 複数relay候補の入力順・失敗継続と並行race境界をcharacterizationする

    -   複数候補を入力順に一件ずつawaitし、重複`null`と候補単位rejection後も残候補へ進む既存workflow contractをfake
        consumerで固定する。
    -   重複事前確認が実行権取得前の一回だけで、保存直前に再確認せず、並行追加を一般に一件へ収束させない既存制約を
        barrier fixtureへ隔離する。
    -   retry、結果collect、batch transaction、排他内再確認を追加しない。
    -   完了時には、逐次順、候補別結果、残候補継続と並行raceが偶然のtimingに依存せず別testで観測できる。
    -   _Requirements: 4.3, 4.4, 8.8, 8.10, 8.11, 8.12_
    -   _Boundary: Event relay reservation coordinator・relay workflow seam_
    -   _Verification: unittest/spec, integration, characterization_
    -   _Depends: 4.1_

-   [x] 4.3 relay追加へ通常・競合を含む事前計画を接続する

    -   手動追加と同じplanner seamを使い、skip・overlapだけを除外した通常・競合予約と新規relayを評価する。
    -   新規予約、または保存済みで競合でない既存予約が競合になる場合はinsertせずrejectし（保存済みの競合予約が競合のままで
        あることでは拒否しない）、重複`null`と競合failureを区別する。
    -   完了時には、競合を含むfixtureで新規rowとeventが0件となり、非競合relayの既存継承結果が維持される。
    -   _Requirements: 4.1, 4.3, 4.5, 6.7_
    -   _Boundary: Event relay reservation coordinator・Conflict planner integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.3, 4.1_

-   [x] 5. 競合 planner と予約状態の再計算契約を実装・検証する
-   [x] 5.1 生の半開区間、tuner能力、および既存優先規則をcharacterizationする

    -   保存済みの`[startAt, endAt)`を使い、同時刻では終了を開始より先に扱い、録画marginを競合計画へ含めないことを
        `unittest/spec`で固定する。
    -   放送波対応、同一channel共有、異channel消費、tuner 0件、skip/overlap除外、通常・競合の再評価を表駆動で検証する。
    -   manualをRule関連より優先し、time manualをprogram manualより優先し、同種manualは`updateTime`昇順、Rule関連はRule
        ID昇順、完全tieは追加ID fallbackなしとする。
    -   番組ID重複keyの既存非対称をcandidate identityや一般dedupeへ拡張せず、独立characterization fixtureに固定する。
    -   完了時には、端点、channel共有、能力不足、優先順、完全tieの各結果がdeterministicに観測でき、物理tuner IDを保存し
        ない。
    -   _Requirements: 2.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8_
    -   _Boundary: Conflict planner・tuner capability projection_
    -   _Verification: unittest/spec, unittest/imp, property/table-driven test_

-   [x] 5.2 状態解除と競合差分の既存意味をcharacterizationする

    -   cancel、removeSkip、removeOverlap、Rule候補差分、番組更新の各入口で、影響時間帯の通常・競合予約を再計画する契約
        をfixture別に検証する。
    -   program予約、Rule時刻予約、time manualの`conflict`変更を比較し、time manualのconflict-only差分も落ちずに
        update diffとなることを検証する。
    -   完了時には、time manualを含む通常↔競合の変更がupdate diffとして観測できる。
    -   _Requirements: 5.3, 5.5, 5.6, 6.7, 8.2, 8.5_
    -   _Boundary: Conflict planner・ReservationDiff comparison_
    -   _Verification: unittest/spec, unittest/imp, characterization_
    -   _Depends: 1.2, 5.1_

-   [x] 5.3 time manualを含むconflict-only差分を最小修正する

    -   program予約、Rule時刻予約、time manualを同じ競合結果比較へ通し、状態だけが変わったreservationをupdate diffへ含め
        る。
    -   candidate identity、公開種類、保存flagの排他化、追加tie-breakを変更しない。
    -   完了時には、5.2のtime-manual target assertionが成功し、番組・Rule予約の既存差分結果が不変になる。
    -   _Requirements: 5.6, 6.7, 8.2, 8.5_
    -   _Boundary: ReservationDiff comparison・Conflict planner result_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 5.2_

-   [x] 6. 番組更新、全体更新、期限切れ整理、および起動再評価を検証する
-   [x] 6.1 番組追従と複数batchの既存処理順をcharacterizationする

    -   番組指定手動、手動由来relay、Rule由来relay、Rule IDをcallごとに列挙し、記載順に一件ずつsettleして10ms後に次へ進
        むことをfake timerで固定する。
    -   time manualを番組追従集合から除外し、番組が見つからない既存予約を保持して差分なしとする。
    -   重ねた全体更新を合流せず、各callが別ID列とPromiseを持ち、共通予約queueのitem境界で交錯し得ることを検証する。
    -   完了時には、対象列挙、開始・settlement順、一件失敗後の続行、非合流、個別Promiseがdeterministicに観測できる。
    -   _Requirements: 8.1, 8.3, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14_
    -   _Boundary: Program refresh coordinator・update-all batch_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 6.2 全体更新後の全予約sweepを一つのTDD単位で実装する

    -   各itemの逐次settlement後に、保存済み全予約を再読込し、time manualを含む通常・競合候補を一回plannerへ渡す期待値を
        固定する。
    -   item途中の成功をrollbackせず、全対象eager開始、batch合流、generation、共通CASを導入しない期待値を含める。
    -   6.1の既存batch testを維持し、最終sweepとtime-manual差分だけが現行との差でREDになることを確認してから、三つの既存
        loopがsettleした後だけ保存済み全予約を再読込し、skip/overlapを除く通常・競合予約を一回再計画する。
    -   conflict-only変更を一つのdiffとして保存・通知し、既存10ms yield、個別failure継続、callごとの非合流を維持する。
    -   完了時には、同じtarget testがGREENとなり、各callの個別完了時点と開始受理を混同しない。
    -   _Requirements: 5.6, 6.7, 8.1, 8.2, 8.3, 8.5, 8.7, 8.12, 8.13_
    -   _Boundary: Program refresh coordinator・full reservation sweep_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, integration_
    -   _Depends: 5.3, 6.1_

-   [x] 6.3 期限切れdeleteと残存予約再計画を一つのTDD単位で実装する

    -   `endAt < now`だけを削除し、等号を保持し、削除時間帯に重なる残存予約の競合を同じ計画入力で再計算する期待値を定義
        する。
    -   expired deleteと残存conflict updateを一つのdiffへまとめ、commit→unlock→eventの順に一回処理する。
    -   周期cleanup、利用可能なIPC clean handler、件数上限、retryを追加しない。
    -   起動時だけの既存caller characterizationを維持し、残存競合更新だけが現行との差でREDになることを確認してから、期限
        切れ対象と重なる残存予約を取得し、deleteとconflict updateを一つのtransactionへ渡す。
    -   database failureではeventを発行せず、成功時だけ実行権解放後に確定diffを一回emitする。
    -   完了時には、同じtarget testがGREENとなり、等号境界、起動時caller、IPC cleanup gapが不変になる。
    -   _Requirements: 5.6, 6.7, 8.4, 8.5_
    -   _Boundary: Expired reservation cleaner・ReservationDiff persistence_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, SQLite/MySQL integration_
    -   _Depends: 5.1, 5.3_

-   [x] 6.4 保存済み予約からの起動再評価handoffを統合検証する

    -   process内queue/eventを新規作成し、保存済みrowから番組、Rule、競合を再評価して、通常・競合予約snapshotを録画実行
        portへ提示する。
    -   time manual、isolated/overlapping予約、missing program、途中failureを含むrestart fixtureを使う。
    -   runtime全体の起動順、tuner REST、録画cleanup、updater開始は各ownerへ残し、本specでは予約再評価entrypointとdomain
        diffだけを検証する。
    -   完了時には、保存row以外のqueue、未完了request、relay候補、未配送eventを復元せず、全録画候補が再構築される。
    -   _Requirements: 8.1, 8.2, 8.3, 8.4, 8.7_
    -   _Boundary: Reservation startup re-evaluation port・recording candidate handoff_
    -   _Verification: unittest/spec, integration, restart harness_
    -   _Depends: 6.2, 6.3_

-   [x] 7. reservation execution coordinator の継続性をTDDで実装する
-   [x] 7.1 lock漏れ、期限切れwaiter残存、およびID衝突の回帰を固定する

    -   Rule read reject、時刻候補生成例外、編集validation failureのいずれでも取得済み実行権を残さず、exact IDを一回解放
        することをfailure injectionで固定する。
    -   60秒取得待ちtimeout後にentryがqueueから除外されて後から実行権が付与されないことと、実行IDがprocess内で衝突しない
        ことをfake clockで固定する。
    -   正常なpriority降順、同priority受付順、read中のlock保持も確認する。
    -   完了時には、lock解放、waiter除外、ID一意性、および正常順序が偶然のtimingに依存せず別testで観測できる。
    -   _Requirements: 8.8, 8.9, 8.11, 8.15, 8.16, 8.17_
    -   _Boundary: Reservation execution coordinator の継続性_
    -   _Verification: unittest/spec, unittest/imp, fake timer_

-   [x] 7.2 60秒waiter、衝突しないID、およびexact releaseを一つのTDD単位で実装する

    -   `allocating/waiting/granted/overdue/expired/released`の全状態と、
        `allocating→waiting→granted→released`、`granted→overdue→released`、 `allocating|waiting→expired`だけを有効遷移と
        して`unittest/spec`で定義する。
    -   正準 locator は、公開contract・状態遷移を`lifecycle-diff-concurrency.spec.test.ts`、縮小max・ID algorithm・資源/raceを
        `execution-coordinator.imp.test.ts`、実`ExecutionManagementModel`のbinding/lifecycleを
        `reservation-event.integration.test.ts`へ置く。
    -   priority降順、同priority受付順、取得待ち既定60,000ms、allocation-wait中も受付時deadlineを延長しないことを固定す
        る。
    -   entry IDは`1..Number.MAX_SAFE_INTEGER`の安全整数counterとし、最大値後は1へwrapして使用中IDを飛ばし、未使用IDを再
        利用する。全ID使用中はID未割当のpriority降順、同priority受付順（同priority内FIFO）のallocation-waitへ置き、release
        または`waiting` entryのtimeoutでIDが空いた後にこの優先順から採番を再開して受付を恒久停止しない期待値を固定する。
    -   縮小maxを注入したtestでwrap、全ID使用、`allocating→expired`時のobject identityによる除外、期限切れrequestへ後か
        らIDを渡さないこと、およびrelease後に同priority内FIFO先頭へ最小未使用IDを割り当てることを直接assertする。
    -   timeout entryをreject前に除外または無効化し、付与との競合では最初の一遷移だけを採用し、無効entryを飛ばす。
    -   owner IDだけが成功・失敗・同期例外・早期returnの全経路で一回解放し、非ownerと二重解放が現在ownerを変えないことを
        検証する。
    -   7.1の回帰testを維持したまま、安全整数
        counter、使用中IDの同期skip、ID未割当priority降順・同priority FIFO allocation-wait、entry state、priority queue、timeout時の除外・無効
        化、および無効entry skipを一つのcoordinatorへ実装する。
    -   release通知または`waiting` entryのtimeoutでIDが空いたとき、allocation-waitをpollingなしにpriority降順、同priority内FIFOで再走査し、元の取得期限内に未使用IDを割り当てる。
    -   現在ownerと一致する未解放IDだけを一回releaseし、次の有効entryへ実行権を渡す。
    -   retry、generation、CAS、persistent queue、fairness、starvation防止、他domainとのqueue共有を追加しない。
    -   完了時には、同じtarget testがGREENとなり、priorityと同priority受付順の既存結果が維持される。
    -   _Requirements: 8.8, 8.9, 8.15, 8.16, 8.17_
    -   _Boundary: Reservation execution coordinator production owner_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, fake timer, barrier, integration_
    -   _Depends: 7.1_

-   [x] 7.3 600秒owner watchdogとlate settlementを一つのTDD単位で実装する

    -   実行権取得後600,000msの直前・到達・超過でunderlying operationを未確定にし、watchdog先着時もexact IDを解放済みと
        せず同じqueueの後続を開始しない。
    -   進行中録画、配信、番組更新、保存先監視、および当該laneを使わないqueryが継続し、operator fatalやprocess終了へ接続
        しないことをspiesで検証する。
    -   late success/rejectでDB処理を再実行せず、通常のcatch/finally/event順序とexact releaseを一回だけ行い後続を再開す
        る。
    -   以上のtargetが現行productionとの差でREDになることを確認してから、実行権取得時にowner watchdogを開始し、先着時は
        exact IDとunderlying Promiseを`overdue`として保持して同じlaneだけを保留する。
    -   元operation settlement時だけ通常の確定経路へ戻し、同じIDを一回releaseしてwatchdog状態を解除する。
    -   timeoutでDB効果を推測せず、再実行、別ID解放、process再起動、別domain停止を追加しない。
    -   完了時には、同じtarget testがGREENとなり、overdue log、未解放owner、別domain継続、late settlement、一回release、
        後続再開が独立して観測でき、600秒未満の正常・失敗operationは通常finallyだけで解放される。
    -   _Requirements: 8.11, 8.17, 8.18_
    -   _Boundary: Reservation execution coordinator・owner watchdog_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, fake timer, deferred Promise, integration_
    -   _Depends: 7.2_

-   [x] 7.4 全reservation mutationを共通exact-release境界へ接続する

    -   手動追加・編集・取消・状態解除、relay、番組更新、Rule差分、全体更新item、cleanupについて、取得後のread・write・
        早期returnを共通`try/finally`境界へ通す。
    -   relayの重複事前確認だけは取得前に維持し、取得後に必要情報を読み、保存直前の再確認や共通CASを追加しない。
    -   各callの入力、queue entry、Promise、処理別errorを分離し、同値依頼を合流しない。
    -   完了時には、取得後の全終了経路がexact IDを一回解放し、failure後に次の有効entryが進む。
    -   _Requirements: 2.1, 2.2, 2.6, 2.12, 3.1, 3.2, 4.1, 5.1, 5.2, 5.3, 5.5, 8.8, 8.9, 8.10, 8.11, 8.14, 8.17, 8.18_
    -   _Boundary: Reservation mutation coordinator・execution lane integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.3, 3.1, 4.3, 6.2, 6.3, 7.3_

-   [x] 7.5 Rules起点`updateRule()`の実行権契約を同一coordinator instanceで結合検証する

    -   実際の`ReservationManageModel.updateRule()`について、同一coordinatorのlock取得後にRule/予約readを行い、Rule
        read failure後も一括再計算の後続itemが進むことを検証する。
    -   600秒overdue中は同じreservation laneの後続を開始せず、別domainのcoordinatorは継続し、元のreadがlate settlement
        した後に同じIDを一回だけreleaseして後続laneを再開することを検証する。
    -   正常な差分では`database → unlock → event`の順序を実際のevent adapterまで観測し、failureではcommit/eventを行わな
        い。別候補型、consumer port、test専用 adapter、追加のcompositionを設けない。
    -   完了時には、Rules 7.2の`newRuleReserves`からprivate `createDiff()`への入力と、予約管理が所有する実行権・差分・
        eventの境界が同じtarget testで確認できる。
    -   _Requirements: 3.1, 3.2, 3.5, 8.8, 8.9, 8.11, 8.12, 8.15, 8.16, 8.17, 8.18_
    -   _Boundary: same-coordinator `updateRule()`・ReservationExecutionCoordinator integration_
    -   _Verification: unittest/spec, integration, fake timer, deferred Promise_
    -   _Depends: 3.1, 7.4_

-   [x] 8. 録画予約管理domain suiteを共有server test matrixへ統合する
-   [x] 8.1 reservation persistence contractをSQLite/MySQLで検証する

    -   一件insert/update、ID/program/Rule/time-range/expired query、exact state filter、Rule
        count、delete→insert→update transactionを同じcontract suiteへ通す。
    -   各transaction段階へfailureを注入し、rollback、event非発行、process内insert objectの採番IDが戻らない既存境界を区
        別する。
    -   persistence層の既存retryを一度のdomain結果として扱い、予約domain retryを重ねない。
    -   完了時には、両database adapterが同じ予約意味を返し、driver lifecycleを本specへ再実装していない。
    -   _Requirements: 1.1, 1.2, 1.3, 3.3, 7.1, 7.2, 7.3, 7.6, 8.4, 8.5_
    -   _Boundary: Reservation repository contract・ReservationDiff transaction_
    -   _Verification: SQLite/MySQL integration, failure injection_
    -   _Depends: 1.4, 3.1, 6.3_

-   [x] 8.2 公開・IPC・process内event境界をdomain結果から統合検証する

    -   既存予約operationの入力とdomain結果、全体更新の待機/非待機、IPC 5秒timeout後もdomain処理をcancelしない境界をfake
        carrierで検証する。
    -   database確定→unlock→一つのoptional diff emitを確認し、同期callback throwとreturned rejectionをlogしてrollback ・
        再送しない。
    -   録画候補の同期受付後に起きる後着評価failureをreservation event failureへ戻さず、recording ownerで記録する。
    -   HTTP route/status/body、OpenAPI、realtime配送、hook選択は各ownerへ残す。
    -   完了時には、domain success/failure、carrier timeout、event failure、録画後着failureが別々の観測結果になる。
    -   _Requirements: 1.5, 1.6, 2.12, 5.1, 5.2, 7.4, 7.5, 7.7, 8.5, 8.6, 8.13, 8.14_
    -   _Boundary: Reservation command/query ports・Reservation diff event port_
    -   _Verification: unittest/spec, IPC integration, event integration_
    -   _Depends: 1.3, 2.3, 6.2, 7.4_

-   [x] 8.3 rules、番組、tuner、録画候補のcross-spec handoffを統合検証する

    -   既存`IReserveDB`注入からRules queryへ供給する`IRuleReservationCountPort`、同一coordinator内の
        `newRuleReserves: Reserve[]`からprivate `createDiff()`へのhandoff、Program/Channel query、tuner能力snapshot、
        recording candidate portを既存provider contractと結合検証する。
    -   `test/server/reservation-management/tuner-snapshot.spec.test.ts` で
        `src/model/operator/reservation/ReservationManageModel.ts` の `setTuners()` を、起動時に一度だけ渡される完全
        snapshotの同期的な state setup として検証する。呼出し後に予約repository read/write、conflict planner、差分保存・
        通知、後続snapshotの再取得または動的refreshを行わず、能力と `broadcastStatus` だけを導出することを spy で固定す
        る。
    -   起動再評価は `setTuners()` の責務へ移さず、保存済み予約の読取・再計画・差分通知は Task 6.4 の別entrypointだけで
        観測する。tuner snapshotの再設定、DB reread、replan、dynamic refreshを追加しない。
    -   authoritative候補配列、部分channel集合、番組消失、起動時tuner能力設定、起動再評価、relay入力順のfailure意味と
        owner境界を検証する。
    -   既存の`IReserveDB`注入で`IRuleReservationCountPort`を供給し、新しいbindingを設けない。
    -   完了時には、各provider/consumerのfield、順序、timeout、failure意味が承認Designと一致する。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.4, 6.1, 6.2, 6.7, 8.1, 8.2, 8.3, 8.6, 8.7_
    -   _Boundary: Reservation cross-spec provider/consumer integration_
    -   _Verification: unittest/spec, integration, restart harness_
    -   _Depends: 1.4, 3.1, 4.3, 5.3, 6.4, 7.5_

-   [x] 8.4 Requirements 1〜8の68 Acceptance Criteriaを共有server test matrixへ統合する

    -   予約種類・状態・query、手動mutation、Rule差分、relay、競合、番組更新、cleanup、event、execution queue、restartを
        共有`unittest/spec`、`unittest/imp`、`integration` commandから実行できるようにする。
    -   Designのcharacterization表の既存事実とtarget contractを別suiteで維持する。
    -   RM-T8.4 remediationでは`reservation-types.spec.test.ts`、`manual-mutations.spec.test.ts`、
        `rule-reconciliation.spec.test.ts`、`state-transitions.spec.test.ts`、`queries.spec.test.ts`、
        `lifecycle-diff-concurrency.spec.test.ts`をtarget `unittest/spec` locatorとする。
    -   Node.js 24を必須gate、Node.js 26を同じsuiteの追加gateとして実行し、matrix定義自体は本specで複製しない。
    -   synthetic予約・番組・Rule・tuner、固定epoch、fake timer、deferred Promiseだけを使用し、実番組、実
        URL、credential、machine pathをartifactへ含めない。
    -   完了時には、Requirements 1〜8の68 Acceptance Criteriaが少なくとも一つの自動testへ対応し、
        domain、SQLite/MySQL、cross-spec handoff、実行順のsuiteが成功する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 3.1,
        3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7,
        6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13,
        8.14, 8.15, 8.16, 8.17, 8.18_
    -   _Boundary: 録画予約管理domain validation_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration, cross-spec integration_
    -   _Depends: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 4.2, 4.3, 5.3, 6.2, 6.3, 6.4, 7.1, 7.4, 7.5, 8.1, 8.2,
        8.3_

-   [x] 9. 機能固有の品質を閉じる
-   [x] 9.1 68件の機能仕様main caseを一意に置く

    -   Designのcanonical locatorである`reservation-types.spec.test.ts`、`manual-mutations.spec.test.ts`、
        `rule-reconciliation.spec.test.ts`、`relay.spec.test.ts`、`state-transitions.spec.test.ts`、
        `conflict-planning.spec.test.ts`、`queries.spec.test.ts`、`lifecycle-diff-concurrency.spec.test.ts`の8本に
        `RM-1.1`〜`RM-8.18` named main caseを一件ずつ置く。別の`spec-inventory` fileは作らない。
    -   完了時には、68件のmain caseが成功し、各ACから実行可能な`unittest/spec` leafへtitleから到達できる。
    -   _Requirements: 9.1_
    -   _Boundary: 録画予約管理仕様test case_
    -   _Depends: 8.4_

-   [x] 9.2 値域・分岐 assertionを実装testで確かめる

    -   `classification.imp.test.ts#all-reservation-kinds-and-eight-flag-combinations`、
        `candidate-identity.imp.test.ts#program-time-identity-and-diff-cancel`、
        `execution-coordinator.imp.test.ts#priority-timeout-wrap-unused-exact-release-overdue-late-settlement`、および
        `characterization.test.ts#pre-fix-relay-race-lock-leaks-timeout-waiter-and-wire-gaps`をDesignどおり実装し、全
        anchorが存在して成功することを確認する。
    -   予約種類、状態flag、半開区間の端点、隣接・包含・同一放送局、tuner 0件、優先順位、表示用変換、候補identity、差分
        取消、および入力・失敗分岐を具体的な`unittest/imp` assertionで検証する。
    -   変更対象ごとに意味のある戻り値、副作用、状態遷移、解放、event件数のassertionを対応させる。
    -   完了時には値域・分岐assertionの未割当が0件となり、仕様main case件数で代替していない。
    -   _Requirements: 9.2_
    -   _Boundary: 録画予約管理実装test_
    -   _Depends: 9.1_

-   [x] 9.4 SQLite・MySQLの予約保存・検索・差分rollbackを結合検証する

    -   `test/server/reservation-management/reservation-persistence.integration.test.ts`で予約の保存、検
        索、filter、count、差分transactionをSQLite・MySQLのsynthetic fixtureへ接続する。
    -   canonical caseが存在しない状態をREDとして確認してから最小fixture・testを追加し、
        `#sqlite-and-mysql-save-query-filter-count-and-diff-rollback`をGREENにする。
    -   delete、insert、updateの各段階へfailureを注入し、rollback、event非発行、process内採番の既存境界をDBごとに確認す
        る。
    -   完了時には両DB adapterが同じ予約結果を返し、予約domainがdriver lifecycleまたは独自retryを追加していない。
    -   _Requirements: 9.4_
    -   _Boundary: 予約保存・検索・差分transaction integration_
    -   _Depends: 8.1, 9.2_

-   [x] 9.5 公開HTTP adapter境界を結合検証する

    -   `test/server/reservation-management/reservation-http.integration.test.ts`で既存method、status、body、optional
        field、not-found、およびerror projectionをsynthetic domain fixtureへ接続する。
    -   canonical caseが存在しない状態をREDとして確認してから最小harness・testを追加し、
        `#public-routes-status-body-and-projection`をGREENにする。
    -   完了時には予約の一覧、詳細、追加、編集、取消のHTTP契約が承認済みcarrierと一致し、新しいwire fieldまたはrouteを追
        加していない。
    -   _Requirements: 9.4_
    -   _Boundary: 予約公開HTTP carrier integration_
    -   _Depends: 8.2_

-   [x] 9.6 既存handlerを持つ予約IPC境界を結合検証する

    -   `test/server/reservation-management/reservation-ipc.integration.test.ts`で既存IPC envelope、応答、5秒timeout後の
        domain継続をsynthetic fixtureへ接続する。
    -   canonical caseが存在しない状態をREDとして確認してから最小harness・testを追加し、
        `#existing-handlers-wait-and-detached-update-all`をGREENにする。
    -   IPC handlerが存在しない`clean`操作、filesystem、およびchild processは非適用理由を明記し、存在しないhandlerや新し
        いIPC versionを追加しない。
    -   完了時には既存handlerを持つ予約操作のIPC契約が一致し、carrier timeoutが進行中domain処理をcancelしない。
    -   _Requirements: 9.4_
    -   _Boundary: 予約IPC carrier integration_
    -   _Depends: 8.2_

-   [x] 9.7 自動予約候補・録画差分・event確定順を結合検証する

    -   `test/server/reservation-management/reservation-event.integration.test.ts`で正準候補の受取、予約差分
        transaction、録画候補handoff、およびprocess内eventを同じcall ledgerへ接続する。
    -   canonical caseが存在しない状態をREDとして確認してから最小harness・testを追加し、
        `#rule-candidate-to-commit-unlock-diff-and-consumers`をGREENにする。
    -   commit後のevent一回、rollback時event 0回、exact release、期限後確定、および資源解放を確認し、rules側条件評価や
        recording側session処理を本機能へ複製しない。
    -   完了時には候補入力から保存確定、差分、eventまでの順序が一意で、失敗時の部分通知または二重通知がない。
    -   _Requirements: 9.4_
    -   _Boundary: 自動予約候補・録画差分・event integration_
    -   _Depends: 8.3_

-   [x] 9.8 本機能の品質判定を満たす

    -   Task 9.1・9.2・9.4から9.7の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7_
    -   _Requirements: 9.1, 9.2, 9.3, 9.5_

## R2 内部契約・検証条件

本節は action 可能な task / leaf を増やさない。既存 task の完了状態と依存関係を変更しない。新しい checkbox、番号付き
task ID、source の class 分割、private call 順、公開 API / IPC / DB schema / 設定 wire / hook の変更を追加しない。

### 対象 locator

-   Design「公開放送波状態の責任境界」（本機能は起動時 tuner capability snapshot から放送波状態を提供する provider。公
    開設定 `broadcast` のキー名・型・意味の正本は `server-service-interface`）
-   Requirements 5.1, 5.2, 5.3, 5.5（種類別 cancel、除外解除、重複解除）
-   Requirements 8.1, 8.5, 8.6, 8.11, 8.17（番組更新再計算、差分提供、読取・DB 失敗時処理、exact 一回解放）
-   Requirements 6.1, 6.2（チューナー能力 snapshot 入力。broadcast wire 自体の正本ではない）

### 外部挙動の不変条件

-   公開設定の `broadcast` キー・型・意味を変更しない。
-   cancel / removeSkip / removeOverlap の成功系種類別結果（Requirements 5）を壊さない。
-   実行権は成功・失敗・例外・早期終了で exact 一回解放する（Requirements 8.17）。
-   単件公開 HTTP update API を新設しない。

### 検証と実装の許可範囲

-   invalid / missing target および update の read / DB rejection は、承認済み契約（Requirements 5 / 8）を oracle とし、先
    に focused characterization を置く。現行挙動が GREEN なら missing evidence だけを閉じ、product code は変更しない。契
    約軸で実際に RED になった場合だけ、別分類の defect candidate とする。観測は operation 結果・exact unlock・event 非発
    行・no mutation を含める。新しい HTTP status 表、公開契約、task ID、checkbox は作らない。
-   coverage のためだけの product code 変更は禁止する。
