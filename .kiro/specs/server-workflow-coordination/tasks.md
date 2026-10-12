# Implementation Plan

---

## Cross-spec execution prerequisites

本specはWorkflow固有の選択、同期開始順、await / detached / failure境界だけを実装する。次の外部owner契約が実装され、各
owner testが成功している状態で、それを利用するlocal taskを開始する。外部task IDはlocal `_Depends:` に書かない。

-   `server-application-runtime`: 共有Vitest runner、`test/server` root、production compile、V8 C0/C1、
    Node.js 24必須・26追加matrix、coverageの計測。起動時は単一`RuntimeStartupWorkflowPort`一回invoke、stage別透過600秒
    observer、one-entry guard、EPG supervisor callbackを提供する。Runtimeの承認済み遅延barrier `OWN-032`相当とRuntime
    handoff完了まではTask 8.3を開始しない。
-   `server-recording-execution`: 同期`acceptMutation(diff)`、利用者削除用terminal barrier、
    `rebuildCandidatesAndStart()` combined stageを提供する。保存予約read、候補再構築、4状態、一Promise join、成功後だけ
    の録画対象3秒周期scheduler、capacity-pressure active-use gateは同ownerに残す。
-   `server-recorded-content`: 利用者削除と個別video削除のtyped preparation、opaque token、recorded ID単位lock、lock内
    fresh read、exact-ID `deletePrepared`、capacity-pressure prepared deletionを提供する。保護、relation、file、DB、
    filesystem効果をWorkflowへ移さない。
-   `server-encoding`: 録画済み番組ID単位のEncode取消と、source videoを必須とするEncode受付を提供する。
-   `server-event-and-hook-delivery`: process-local event/hook provider登録、画面通知、型付き外部command配送を提供する。
-   `server-process-messaging`: 既存IPC envelope、通常5秒timeout、listener / timer、request / reply identity、exact
    peer、late replyを提供する。
-   `server-program-guide`、`server-reservation-management`、`server-reservation-rules`、 `server-thumbnail-management`:
    承認Designに記載した既存domain portを提供する。

Workflowはdomain outcomeからcross-domain actionを選ぶ条件、番組・Rule、予約・録画、録画完了、relay、recorded-change、
startup continuation、service child user deletion、parent whole / video deletion coordinatorを所有する。domain状態・効
果、event / Hook配送、IPC wire・timeout・peer、HTTP、process監督、capacity-pressure deletion adapterは所有しない。

利用者による番組全体削除は、service childでrecordedId単位のEncode取消をawaitし、全件成功後だけ抽象outbound requestを送
る。parentはrecorded-contentのtyped prepareをawaitし、対象に必要な場合だけRecordingの利用者削除terminal barrierをawait
し、opaque tokenを`deletePrepared`へ渡す。providerはlock内でfresh readしexact-IDだけを削除する。失敗時にEncodeや録画を再
開しない。個別video削除はEncode取消を行わず、typed direct / whole decisionに従い、wholeならfresh whole prepareから同じ
barrierへ進む。公開APIと既存IPC wireは変えない。

capacity-pressure削除はRuntime ownerのprepare → recording gate → child gate → locked final deleteであり、active /
unknownならnot-deletedとする。Workflow、利用者削除coordinator、Encode取消のcallは0件で、本specにadapterを実装しない。

すべての変更taskは同じactionable checkbox内で、承認契約をtestで検証し、productionと関連test、観測可能な完了条件まで
閉じる。characterization taskは現在の挙動を固定し、production差分を0件にする。owner実装に依存するtarget testはbarrier
完了後の状態を前提とする。

-   [x] 1. Event bindingと配送handoff境界を固定する
-   [x] 1.1 Event wrapperの同期開始・非待機・restart非復元をcharacterizationする

    -   synthetic event、deferred Promise、同期throw、returned reject、detached resolve / reject、call ledgerを共有
        foundation上へ追加し、listener登録順の同期prefixと`emit()`の非待機を確認する。
    -   returned rejectはwrapper、detached rejectは要求局所handlerが観測する境界を分け、同じevent再受付では共通dedupeせ
        ず新しいcallbackを開始し、restart後は進行位置を復元しないことを固定する。
    -   transaction、共通result registry、checkpoint、retry、rollback、ack待ち、人工timeoutをfixtureへ追加しない。
    -   完了時には、characterization suiteが成功し、production差分0件、登録順・非待機・非復元のcall ledgerが保存される。
    -   _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6_
    -   _Boundary: Workflow Event Binding characterization_
    -   _Verification: unittest/spec, unittest/imp, restart characterization_

-   [x] 1.2 全event catalogとUI / Hook宛先別failure isolationを完成する

    -   番組、Rule、予約、録画、録画済み番組、video、Tag、Thumbnail、Encode完了の全triggerをtable-drivenにし、UI再取得要
        否とsemantic Hook種別だけを選ぶtestを追加する。
    -   各UI / Hook handoffの同期throwと観測可能rejectで、失敗記録1件、後続の独立destination試行、unhandled rejection 0
        件、起点domain rollback / retry / ack 0件をtestが検証する。
    -   handoffごとの局所guardだけを置き、delivery集約、送信、再送、切断回復、Hook環境・FIFO・timeout・process
        lifecycleをWorkflowへ追加しない。
    -   architecture testがdelivery ownerの型付きfacade以外の配送実装importが0件であることを検証する。
    -   完了時には、全triggerが一意のactionへ対応し、全handoff failure caseが成功し、delivery再実装とWorkflow scope外の
        production変更が0件になる。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.3, 7.7_
    -   _Boundary: Workflow Event Binding・UI / typed Hook handoff_
    -   _Verification: unittest/spec, unittest/imp, architecture contract test_
    -   _Depends: 1.1_

-   [x] 2. 番組情報・Rule workflowを完成する
-   [x] 2.1 番組更新の履歴整理・予約更新・初回flagをcharacterizationする

    -   履歴整理resolve / rejectと`updateAll` resolve / rejectの直積を実行し、履歴整理を最初にawaitした後は結果にかかわ
        らず予約更新へ進むことを確認する。
    -   手動予約、relay予約、有効Rule再評価を同じdomain portへ委譲し、初回flagは`updateAll(true)`成功後だけfalseにする。
    -   候補採否、競合、重複判定をWorkflow test doubleへ実装しない。
    -   完了時には、4 settlementと初回・次回ledgerが成功し、production差分0件、owner判断の再実装0件となる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.11_
    -   _Boundary: Program / Rule Coordinator characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven characterization_
    -   _Depends: 1.2_

-   [x] 2.2 Rule五種の独立後続とdetached failureを完成する

    -   add / update / enable / disableでUI → `updateRule`、deleteでUI → `removeRuleId` → `updateRule`の同期開始順を固定
        する。
    -   各detached Promiseをrejectさせ、要求種別とRule IDの局所log 1件、残る独立operationの開始、unhandled rejection 0
        件、rollback / retry / 結果集約 / 二度目のUI 0件をtestが検証する。
    -   要求単位の局所handlerだけを置き、二依頼を一transactionにせず、候補・競合・重複判断をownerに残す。
    -   五種・片側failure testが、同期開始順とdetached境界が変わらないことを検証する。
    -   完了時には、Rule五種と全reject caseが成功し、未処理rejection 0件、追加retry / registry 0件となる。
    -   _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 7.3, 7.7, 7.11_
    -   _Boundary: Program / Rule Coordinator_
    -   _Verification: unittest/spec, unittest/imp, isolated-process rejection test_
    -   _Depends: 2.1_

-   [x] 3. 予約差分・録画lifecycle workflowを完成する
-   [x] 3.1 Recording ownerの同期受付後に予約diff接続を完成する

    -   Recording ownerの同期`acceptMutation(diff)`を前提に、insert / update / deleteでUI → `acceptMutation` →
        Hookを同じcall stackで開始することをtarget testが検証する。
    -   `acceptMutation()`が同期throwしたとき、局所log 1件、後続Hook 1件、retry 0件、rollback 0件、追加queue 0件となる
        ことをtargetが検証する。
    -   UI、`acceptMutation()`、Hookをそれぞれ独立した三guardから呼ぶ。同期throwを記録して吸収し、残るHookを一回試行する。
        成功経路と同期throw経路の両方をtestが検証する。
    -   returnを評価完了として待たず、評価、世代、候補、burst wake coalescing、scheduler、後続failure記録をRecording
        ownerに残す。UI / Hookの失敗はTask 1.2のguardで隔離する。
    -   完了時には、三diffの順序testとRecording port結合testが成功し、Workflow内のqueue / scheduler / retry / result
        registryが0件となる。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.13, 7.3_
    -   _Boundary: Reservation / Recording Coordinator・Recording Mutation Port_
    -   _Verification: unittest/spec, unittest/imp, recording-port integration_
    -   _Depends: 1.2_

-   [x] 3.2 録画準備・開始・失敗・再試行上限とTag境界を完成する

    -   prep start / cancel / failure、retry exhausted、recording failureのaction表と、Tag null / 空 / 正常 / aggregate
        parse failure / 個別relation rejectをtable-drivenにする。
    -   prep failureとretry exhaustedの取消reject、Tag個別reject、UI / Hook failureで、局所log、残る独立action、
        unhandled rejection 0件となることをtestが検証する。
    -   取消には要求局所handlerを接続し、Tagは全体を一回parseして成功後だけ入力順にawaitし、個別failure後も残件を続ける。
        aggregate parse failureは個別call 0件で後続UI → start Hookへ進む。
    -   finish(false)の同期prefix後、deferred Tag中にfailure UIとrecorded非null時だけのfailure Hookが追越し得る時系列を
        同じsuiteが検証する。
    -   完了時には、全状態・Tag値域・recorded null/non-null caseが成功し、録画状態・retry回数・遷移判断のWorkflow実装0件
        となる。
    -   _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 7.3, 7.7, 7.11_
    -   _Boundary: Reservation / Recording Coordinator・Tag Relation Sequencer_
    -   _Verification: unittest/spec, unittest/imp, deferred-tag timeline, isolated-process rejection test_
    -   _Depends: 3.1_

-   [x] 4. 録画完了後workflowを完成する
-   [x] 4.1 予約整理・source video・最大三Encode・Tag・配送順を一つの単位で閉じる

    -   予約取消不要、manual、relay、Rule、video 0 / 1 / 複数、Encode mode 0 / 1 / 3 / 4、Tag各値域を組み合わせる。
    -   first videoがある場合だけThumbnailを開始し、同じsource IDでmode 1 → 2 → 3の最大三件を個別受付し、video 0件では
        Thumbnail / Encode各0件のままTag → finish Hook → UIへ進むtestを追加する。
    -   予約整理detached reject、Tag個別reject、Hook failureを局所観測し独立後続へ進む期待と、Thumbnail / Encode各位置の
        同期throwでは明示した後続へ到達せず先行効果をrollbackしないことをtestが検証する。
    -   要求局所handlerと宛先guardだけを接続する。Encode queue・結果反映、Tag効
        果、Thumbnail効果はownerへ残す。
    -   完了時には、source-video / parse / failure matrixが成功し、最大Encode 3件、unhandled rejection 0件、録画完了
        reverse mutation 0件となる。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 7.3, 7.7, 7.11_
    -   _Boundary: Recording Completion Coordinator・Tag Relation Sequencer_
    -   _Verification: unittest/spec, unittest/imp, source-video matrix, synchronous-failure matrix_
    -   _Depends: 3.2_

-   [x] 5. Relayとrecorded-change workflowを完成する
-   [x] 5.1 Relay候補の逐次処理と候補別観測を完成する

    -   success ID、duplicate `null`、rejectを同じ候補配列へ混ぜ、各settlement後だけ次候補を開始するtestを追加する。
    -   `null`とrejectを候補別に一回記録し、残候補を続け、結果一覧・retry・rollbackを作らないことをtestが検証する。
    -   空catchを候補別の最小logへ置換する。親予約設定の複写とduplicate判断はreservation ownerへ残
        す。
    -   完了時には、入力順、候補別log、残件続行が成功し、productionの共通結果保持とretryが0件となる。
    -   _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_
    -   _Boundary: Event Relay Coordinator_
    -   _Verification: unittest/spec, unittest/imp, deferred-result table_
    -   _Depends: 1.2_

-   [x] 5.2 Recorded / video / upload / protect / Tag / Thumbnail / Encode変更の選択を完成する

    -   全triggerのUI / Hook選択、upload時の条件付きThumbnail、recorded delete後の条件付きreservation cancelを表駆動にす
        る。
    -   UI failure後もThumbnail / cancelを試行し、cancel rejectを局所記録してunhandled rejection 0件となることをtestが検
        証する。
    -   cancelには局所handlerを接続し、Task 1.2のhandoff guardから独立domain callへ進む。
    -   Encode結果、元file、利用状態、recorded / thumbnail / Tag効果、配送をWorkflowで変更しない。
    -   完了時には、全action表とfailure caseが成功し、owner domain mutationとdelivery実装の追加0件となる。
    -   _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 6.1, 6.2, 7.3, 7.7, 7.11_
    -   _Boundary: Recorded Change Coordinator_
    -   _Verification: unittest/spec, unittest/imp, event guard table, isolated-process rejection test_
    -   _Depends: 5.1_

-   [x] 6. Service child利用者削除coordinatorを完成する
-   [x] 6.1 recordedId単位Encode取消から抽象outbound requestまでを一つの単位で閉じる

    -   既存公開APIと`recorded.delete` wire snapshotを固定する。
    -   Encode取消中はrequest 0件、全取消成功後だけ`requestUserDeletion(recordedId)`一回、個別取消失敗時は残対象も試した
        後にaggregate rejectしてrequest / parent prepare / recording / delete各0件となることをtargetが検証する。
    -   service child coordinatorはEncodingとtransport非依存outbound portだけで構成し、composition ownerが既存wireへ
        adapter写像できるseamにする。
    -   adapter reject / timeout / restartでも取消済みEncodeを再開せず、remote cancel / rollback / retry / replay /
        duplicate effectを各0件にする。
    -   完了時には、取消→request順、失敗時request 0件、既存model / function / args / reply / 通常5秒不変、Workflow core
        のIPC import 0件となる。
    -   _Requirements: 5.1, 5.2, 5.7, 5.10, 7.3, 7.5, 7.6, 7.7_
    -   _Boundary: Service Child User Deletion Coordinator・Child User Deletion Request Port_
    -   _Verification: unittest/spec, unittest/imp, user-deletion integration, wire snapshot_
    -   _Depends: 1.2_

-   [x] 7. Parent利用者削除と個別video削除を完成する
-   [x] 7.1 番組全体のtyped prepare→terminal→opaque delete順を実装する

    -   Recorded ownerのtyped preparationとRecording ownerのterminal barrierを前提に、`not-found` /
        `protected` / `prepared`、録画中、reserve有無、保持有無、barrier rejectをdecision table化する。
    -   `prepared`かつ必要な場合だけterminal barrierをawaitし、成功後だけ同じopaque tokenを`deletePrepared`へ渡すことを
        target testが検証する。前二状態とbarrier失敗ではdelete 0件とする。
    -   parent coordinatorはRecordingとPrepared Recorded Deletion portだけで構成し、relation、resource、path、lock、
        Encoding、transport clientを渡さない。
    -   provider integrationでbarrier後のlock内fresh read、存在・保護・relation再確認、exact-ID deleteを接続する。削除失
        敗時に録画・Encodeを再開せず、先行部分効果をrollbackしないことをtestが検証する。
    -   完了時には、全typed outcomeとfailure caseが成功し、停止前planの削除効果利用0件、bulk recorded-ID row delete 0件、
        公開wire差分0件となる。
    -   _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.12, 7.3, 7.7_
    -   _Boundary: Parent User Deletion Coordinator・Prepared Recorded Deletion Port_
    -   _Verification: unittest/spec, unittest/imp, user-deletion provider integration_
    -   _Depends: 6.1_

-   [x] 7.2 個別video direct / whole decisionとfresh whole昇格を完成する

    -   `prepareVideoFileDeletion`の`not-found` / `protected` / `prepared` / `whole-recorded-deletion-required`と、final
        operationの同じwhole decisionをtable-drivenにする。
    -   directはopaque video tokenだけを使い、whole decisionはrecordedIdだけでfresh `prepareUserDeletion`を呼び、typed
        prepared時だけ条件付きterminal barrier → whole opaque token → `deletePrepared`へ進むことをtargetが検証する。
    -   parent video coordinatorはPrepared Video / Whole DeletionとRecording portだけで構成し、個別tokenや親snapshot
        をwholeへ再利用しない。
    -   初回wholeとfinal-reread wholeのtestが、全caseでservice child coordinatorとEncode cancel callが0件、
        `recorded.deleteVideoFile` wireが不変であることを確認する。
    -   完了時には、direct / whole全decisionが成功し、fresh whole prepare 1件、Encode取消0件、既存wire差分0件となる。
    -   _Requirements: 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10, 5.12, 7.3, 7.7_
    -   _Boundary: Parent Video File Deletion Coordinator_
    -   _Verification: unittest/spec, unittest/imp, video-file-deletion integration, wire snapshot_
    -   _Depends: 7.1_

-   [x] 7.3 user / video / capacity-pressure三経路の負契約をcharacterizationする

    -   user wholeはEncode取消を通り、individual videoはEncode取消0件であることをcall ledgerのassertionで固定する。
        capacity-pressureはWorkflow / user coordinator / Encode取消 / recording cancellation各0件であることを、Runtimeの
        `storage-pressure-deletion.integration.test.ts`と、9.6のレビュー（WC-5.11）で確かめる。
    -   Runtime外部contractのprepare → recording gate → child gate → locked final delete、busy / unknownのnot-deleted、
        取得token逆順解放を参照し、Workflow側へadapter、gate、lease carrierを追加しない。
    -   HTTP、DB、filesystem、IPC timeout / peer、process supervisionを本specのassertion内部へ複製しない。
    -   完了時には、user・video二経路のnegative call ledgerが成功し、production差分0件、capacity-pressure adapter実装0件となる。
    -   _Requirements: 5.10, 5.11, 7.3, 7.7_
    -   _Boundary: Deletion path separation characterization_
    -   _Verification: unittest/spec, unittest/imp, negative call ledger contract（user・video）、capacity-pressureはレビュー_
    -   _Depends: 7.2_

-   [x] 8. Startup reconciliation後のWorkflow continuationを完成する
-   [x] 8.1 Recording owner stage完成後に通常finish handoffをcharacterizationする

    -   起動時項目failureはowner logだけで追加UI / Hook 0件、規定の次項目または残fileへ進み、成功した最終readだけが既存
        通常finish eventを発行することをcross-spec characterizationで固定する。
    -   初期listまたは最終read failureはreconciliation stage failureを返し、combined / cleanup / EPG callと固定間隔retry
        を各0件にする。
    -   起動整理のDB / file処理、候補再構築、schedulerをWorkflowへ移さない。
    -   完了時には、owner stage suiteとhandoff characterizationが成功し、production差分0件、専用通知と人工timeout 0件とな
        る。
    -   _Requirements: 7.8, 7.9_
    -   _Boundary: Startup Reconciliation Operation consumer characterization_
    -   _Verification: unittest/spec, cross-spec event characterization_
    -   _Depends: 1.2_

-   [x] 8.2 Recording combined stage後の予約整理→EPG continuationを完成する

    -   Recording ownerの`rebuildCandidatesAndStart()`を前提に、reconciliation成功時だけcombined stageをawaitし、成功後
        だけ予約整理、さらに成功後だけEPG supervisor開始をrequestすることをtargetが検証する。
    -   各providerのresolve / sync throw / rejectをtyped `Succeeded` / `Failed(stage)`へ変換し、first-failure後続call 0
        件、retry 0件となる。
    -   Startup Continuation Coordinatorは、combined provider内部の保存予約read、rebuild、4状態、Promise
        join、3秒scheduler、Runtime observerを分割・再実装しない。
    -   成功済みstageのrollback、共通result list、timeout、retryを各0件にする。
    -   完了時には、combined → cleanup → EPGの論理順と全first-failure caseが成功し、Recording / Runtime mechanicsの重複0
        件となる。
    -   _Requirements: 7.9, 7.10_
    -   _Boundary: Runtime Startup Workflow Port・Startup Continuation Coordinator_
    -   _Verification: unittest/spec, unittest/imp, typed-outcome call ledger_
    -   _Depends: 8.1_

-   [x] 8.3 Runtimeの承認済み遅延barrier後に単一port結合を検証する

    -   Runtime `OWN-032`相当が成功している状態でintegration testを実行する。
    -   service supervision accepted後の単一port一回invoke、stage別透過600秒observer、one-entry guard、EPG callback
        bindingをRuntime external locatorから消費する。
    -   Runtimeが個別stageを直接選択・順序付けせず、observer overdueがlate settlementをfailureへ変換せず、Workflowの
        typed first-failureを一回受けることを確認する。
    -   完了時には、Workflow continuationとRuntime integrationが成功し、Workflowのtimer / generation / child process実装0
        件、Runtimeのstage選択実装0件となる。
    -   _Requirements: 7.9, 7.10_
    -   _Boundary: Startup cross-spec handoff integration_
    -   _Verification: provider contract integration_
    -   _Depends: 8.2_

-   [x] 9. R8の品質を閉じる
-   [x] 9.4 Layer 4のprovider結合testを完成する

    -   `test/server/workflow-coordination/provider-contracts.integration.test.ts#workflow-coordination Layer 4 provider contracts`へ既存IPC consumer、recording
        / recorded-content typed provider、DB / filesystem削除、startup handoffを接続するtestを追加する。
    -   HTTPは非適用理由を残し、IPC envelope / timeout / peer、event / Hook配送、Recording scheduler / barrier
        internals、recorded効果、Runtime observer / process mechanics、capacity adapterを各owner testへ委譲する。
    -   public APIとdelete / deleteVideoFile wire不変、Workflow transport import 0件、capacity経路のWorkflow / Encode /
        cancellation call 0件をsynthetic providerで確認する。
    -   完了時にはlayer 4のintegrationが成功し、production/config差分0件、owner testへの委譲の欠落0件となる。
    -   _Requirements: 8.4_
    -   _Boundary: Workflow provider contract integration_
    -   _Verification: integration_
    -   _Depends: 8.3_

-   [x] 9.5 利用者削除の調整がport以外を操作しないことをspec testで確かめる（WC-5.10）

    -   `imp/workflow-characteristics.test.ts`の`[WC-5.10]`と`[WC-5.3][WC-5.10]`の既存caseに加えて、録画済み番組の利用者削除で、recorded-contentが準備した
        opaque tokenをそのまま渡し、保護判定・file選択・tag解除・thumbnail削除・同時実行制御を本機能が独自に実行しないことを、
        port以外への操作が0件であるcall ledgerのassertionで確かめるspec caseを足す。
    -   production codeは変更しない。
    -   完了時には、新しいspec caseが成功し、port以外への操作が全経路で0件である。
    -   _Requirements: 5.10_
    -   _Boundary: Deletion Coordinator Port Boundary_
    -   _Verification: unittest/spec_
    -   _Depends: 7.3_

-   [x] 9.6 本機能の品質判定を満たす

    -   Task 9.4から9.5の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   Requirement 5のうち、容量不足の自動削除を本機能の削除経路へ含めない依存の向き（`WC-5.11`）を、本機能のsourceが容量削除のadapter、
        gate、lease carrierを持たないことをレビューで確認する。sourceのimportを読むtestは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 9.4, 9.5_
    -   _Requirements: 8.1, 8.2, 8.3, 8.5_
## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                                  | Test type                                                                                        | Local Depends                       | Verification command                                                                                                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/workflow-coordination/event-binding.spec.test.ts`<br>`test/server/workflow-coordination/restart.characterization.test.ts`                                                                                           | `unittest/spec, unittest/imp, restart characterization`                                          | `なし（共有foundationのみ）`        | `npm run test:server:spec -- test/server/workflow-coordination/event-binding.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/restart.characterization.test.ts`                                                                                                                              |
| 1.2  | `test/server/workflow-coordination/event-binding.spec.test.ts`<br>`test/server/workflow-coordination/architecture.spec.test.ts`                                                                                                  | `unittest/spec, architecture contract test`                                                      | `1.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/event-binding.spec.test.ts`<br>`npm run test:server:spec -- test/server/workflow-coordination/architecture.spec.test.ts`                                                                                                                                    |
| 2.1  | `test/server/workflow-coordination/program-rule.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                        | `unittest/spec, unittest/imp, table-driven characterization`                                     | `1.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/program-rule.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                           |
| 2.2  | `test/server/workflow-coordination/program-rule.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                        | `unittest/spec, unittest/imp, isolated-process rejection test`                                   | `2.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/program-rule.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                           |
| 3.1  | `test/server/workflow-coordination/reservation-recording.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/provider-contracts.integration.test.ts` | `unittest/spec, unittest/imp, recording-port integration`                                        | `1.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/reservation-recording.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/provider-contracts.integration.test.ts` |
| 3.2  | `test/server/workflow-coordination/reservation-recording.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/provider-contracts.integration.test.ts` | `unittest/spec, unittest/imp, deferred-tag timeline, isolated-process rejection test`            | `3.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/reservation-recording.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/provider-contracts.integration.test.ts` |
| 4.1  | `test/server/workflow-coordination/recording-finish.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                    | `unittest/spec, unittest/imp, source-video matrix, synchronous-failure matrix`                   | `3.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/recording-finish.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                       |
| 5.1  | `test/server/workflow-coordination/relay.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                               | `unittest/spec, unittest/imp, deferred-result table`                                             | `1.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/relay.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                                  |
| 5.2  | `test/server/workflow-coordination/recorded-change.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                     | `unittest/spec, unittest/imp, event guard table, isolated-process rejection test`                | `5.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/recorded-change.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                        |
| 6.1  | `test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/user-deletion.integration.test.ts`            | `unittest/spec, unittest/imp, user-deletion integration, wire snapshot`                          | `1.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/user-deletion.integration.test.ts`            |
| 7.1  | `test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/user-deletion.integration.test.ts`            | `unittest/spec, unittest/imp, user-deletion provider integration`                                | `6.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/user-deletion.integration.test.ts`            |
| 7.2  | `test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/video-file-deletion.integration.test.ts`      | `unittest/spec, unittest/imp, video-file-deletion integration, wire snapshot`                    | `7.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/partial-failure.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/video-file-deletion.integration.test.ts`      |
| 7.3  | `test/server/workflow-coordination/architecture.spec.test.ts`<br>`test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                        | `unittest/spec, unittest/imp, negative call ledger contract（user・video）` | `7.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/architecture.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`                                                                                                                           |
| 8.1  | `test/server/workflow-coordination/event-binding.spec.test.ts`                                                                                                                                                                   | `unittest/spec, cross-spec event characterization`                                               | `1.2`                               | `npm run test:server:spec -- test/server/workflow-coordination/event-binding.spec.test.ts`                                                                                                                                                                                                                                 |
| 8.2  | `test/server/workflow-coordination/startup-continuation.spec.test.ts`<br>`test/server/workflow-coordination/imp/startup-continuation.imp.test.ts`                                                                                 | `unittest/spec, unittest/imp, typed-outcome call ledger`                                         | `8.1`                               | `npm run test:server:spec -- test/server/workflow-coordination/startup-continuation.spec.test.ts`<br>`npm run test:server:imp -- test/server/workflow-coordination/imp/startup-continuation.imp.test.ts`                                                                                                                    |
| 8.3  | `test/server/workflow-coordination/provider-contracts.integration.test.ts`<br>`test/server/workflow-coordination/startup-workflow-entry-guard.integration.test.ts`<br>`test/server/application-runtime/startup-composition.integration.test.ts`                                                                          | `provider contract integration, Runtime external evidence`                                       | `8.2`                               | `npm run test:server:integration -- test/server/workflow-coordination/provider-contracts.integration.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/startup-workflow-entry-guard.integration.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/startup-composition.integration.test.ts`                                                                                              |
| 9.4  | `test/server/workflow-coordination/provider-contracts.integration.test.ts` | `integration` | `8.3` | `npm run test:server:integration -- test/server/workflow-coordination/provider-contracts.integration.test.ts` |
| 9.5  | `test/server/workflow-coordination/user-deletion.spec.test.ts` | `unittest/spec` | `7.3` | `npm run test:server:spec -- test/server/workflow-coordination/user-deletion.spec.test.ts` |
| 9.6  | `test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`test/server/workflow-coordination/provider-contracts.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `9.4, 9.5` | `npm run test:server:imp -- test/server/workflow-coordination/imp/workflow-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/workflow-coordination/provider-contracts.integration.test.ts` |
