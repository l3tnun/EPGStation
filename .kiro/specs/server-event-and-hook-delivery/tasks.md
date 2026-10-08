# Implementation Plan

---

## Cross-spec execution prerequisites

実装開始前に、次の外部 prerequisite が承認済み contract として利用可能であることを確認する。外部 spec の task ID は
local `_Depends:` に書かず、producer が未実装または証拠を提供できない場合は対応 leaf を未完了のまま owner へ返す。

-   `server-application-runtime`: `test/server` の共有 runner/test root、Vitest、V8、固定 command、Node.js 24
    必須・26追加 matrix、coverage の計測。
-   `server-configuration`: 9種 command の既存解釈、`hookCommandMaxPending`（既定64、整数1..10,000）、
    `hookCommandTimeoutMs`（既定300,000ms、整数1..2,147,483,647）の検証済み完全 snapshot。
-   `server-process-messaging`: IPC envelope/peer 管理、PM所有 `EncodeCompletionSink` consumer port と registration
    port。
-   producer domain: 確定済み event payload、ID/entity、DB参照に必要な contract。
-   `server-workflow-coordination`: 業務上の後続 action と順序、および本機能の引数なし provider-registration setup を一
    回呼ぶ binding。
-   `server-service-interface`: 200ms集約、Socket.IO/browser delivery、再取得実行。

本 spec は process-local event delivery、destination別 failure isolation、PMへのIPC/UI handoff、9種 hook selection、全
hook共通FIFO、waiting上限と過負荷、起動時設定snapshot、allowlist環境、command準備、FIFO先頭到達後の一つのabsolute
deadline、direct childの二段停止とfinalizerを所有する。Configurationのcommand解釈・設定検証、PMのIPC
envelope/`EncodeCompletionSink` port定義、SIの200ms/browser delivery、Workflowの業務順序、Runtimeのchild全体監督と共有品
質基盤は重複実装しない。

通知・hook依頼の永続化、ack、必達再送、共通dedupe、自動retry、業務rollback、追加signal、grandchild終了保証、および親
process環境の全継承を追加しない。

-   [x] 1. 状態変化を destination ごとに隔離して配送する
-   [x] 1.1 (P) process-local event の登録順・非待機・失敗観測を characterization する

    -   `event-delivery.spec.test.ts` と実装特性testへ、全event inventory、listener 0/1/複数、同一payload二回、同期
        throw、非同期reject、遅延Promiseを追加し、登録順のcallback開始、受付の非待機、各回配送、失敗記録、別listener継
        続、業務rollback 0を確認する。
    -   これは既存挙動のcharacterizationであり、test追加前後のproduction source差分を0にする。現在の挙動と異なる場合は
        testを都合よく変更せず不一致分類へ戻す。
    -   完了時には、EH-1.1..EH-1.7の各canonical caseが成功し、listener開始順の逆転、dedupe、受付待ち、業務変更が各0件
        で、production差分0をdiffで観測できる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
    -   _Boundary: Process-local Event Delivery characterization_
    -   _Verification: unittest/spec, unittest/imp, deferred-listener characterization, production diff-check_

-   [x] 1.2 destination 別 failure isolation と PM handoff を一つの TDD cycle で実装する

    -   EH-2.1..EH-2.5を含むtarget testを先に追加し、local listener、PM IPC/UI handoff、hook enqueueの先行destinationが
        同期throwまたは観測可能な非同期rejectを返しても後続destinationを開始し、全Promise完了を受付条件にしない期待でRED
        を確認する。
    -   `EventSetter` の各destinationを独立guardへ分け、失敗を運用ログへ記録して後続を試す最小production修正を行う。ただし録画完了listenerのThumbnail受付と`setEncode()`は、Workflowが定める依存domain call列であり、同期throw時は以後のHook・画面通知へ到達しない。IPC
        envelope、peer、200ms集約、Socket.IO送信、業務action順序は実装しない。
    -   同じtargetを再実行してGREENにし、関連characterizationも再実行する。
    -   完了時には、代表eventごとにPM handoff 1回、後続destination開始1回、再取得/業務Promise待ち0件、業務rollback 0件を
        call ledgerで観測できる。
    -   _Requirements: 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5_
    -   _Boundary: Destination Failure Isolation・PM IPC/UI Handoff_
    -   _Verification: unittest/spec, unittest/imp, carrier contract test, target RED/GREEN_
    -   _Depends: 1.1_

-   [x] 1.3 PM port の provider implementation と registration adapter を一つの TDD cycle で実装する

    -   PM dispatcherから渡したencode完了が同じproviderを介してoperator encode eventへ一回届き、RuntimeがWorkflow
        binding入口を一回呼び、その一回の引数なしsetupがPM registrationを一回行い、PMからevent sourceへのreverse import
        が0になるtargetを追加してREDを確認する。
    -   `OperatorEncodeEvent`へPM所有`EncodeCompletionSink`のprovider実装を追加し、本機能内の
        `OperatorEncodeEventBinding`と既存DI seamへ、注入済みPM registration portへ同じproviderを一回登録する引数なし
        setupを最小実装する。
    -   Workflow/Runtimeのbinding判断やPM port定義を変更せず、複数setup呼出しの自動重複排除を追加しない。同じtargetを
        GREENにしてPM/provider関連回帰を再実行する。
    -   完了時には、provider受信1件、operator event 1件、registration 1件、PM reverse import 0件を観測できる。
    -   _Requirements: 2.1, 2.2, 2.5_
    -   _Boundary: PM-owned EncodeCompletionSink Provider・Event-owned Registration Adapter_
    -   _Verification: unittest/spec, unittest/imp, PM port contract, target RED/GREEN_
    -   _Depends: 1.2_

-   [x] 1.4 非接続・再接続・再起動の揮発性境界を characterization する

    -   PM carrier不在、切断、再接続、新instance生成をsynthetic fixtureで再現し、切断中通知のDB/file保存0、個別replay
        0、再接続後の新規handoff 1、旧listener結果・配送履歴・dedupe state復元0を固定する。
    -   これは既存挙動のcharacterizationでありproduction差分0とする。必達queue、ack、retry、現在状態再取得より個別通知を
        優先する規則を追加しない。
    -   完了時にはEH-2.6/EH-2.7と関連caseが成功し、tracked/temporary filesystemへの配送永続化0件、再起動後の旧通知0件、
        production差分0を観測できる。
    -   _Requirements: 1.4, 1.7, 2.6, 2.7_
    -   _Boundary: Volatile Event and IPC/UI Handoff Lifecycle characterization_
    -   _Verification: unittest/spec, unittest/imp, disconnect/restart characterization, filesystem ledger_
    -   _Depends: 1.3_

-   [x] 2. 9種 hook と allowlist 環境の既存契約を characterization する
-   [x] 2.1 (P) 予約3種と録画5種の hook selection を characterization する

    -   予約追加・変更・削除、録画準備開始、準備取消または失敗、録画開始、録画失敗、録画完了を表駆動で発行し、設定ありで
        entityごとにenqueue 1、未設定でenqueue/spawn 0、同一event二回で独立依頼2を確認する。
    -   hook受付・正常終了・失敗を予約/録画結果や他の後続処理の成功条件にしない既存境界を固定し、production差分0とする。
    -   完了時にはEH-3.1..EH-3.8、EH-3.10..EH-3.12のcaseが成功し、9種のうち対象8種の誤選択、dedupe、業務変更が各0件で、
        production差分0を観測できる。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10, 3.11, 3.12, 6.5, 6.6_
    -   _Boundary: Reservation and Recording Hook Selector characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven characterization, production diff-check_

-   [x] 2.2 (P) encode完了hook selectionとPM provider経路をcharacterizationする

    -   encode完了の設定あり・なし・重複を表駆動で確認し、設定ありenqueue 1、未設定enqueue/spawn 0、重複2依頼、業務結果
        schemaとworkflow順序への変更0を固定する。
    -   PM providerからoperator encode eventへの経路も同じoracleへ接続し、provider registration自体はTask 1.3の実装契約
        を消費する。characterization対象productionには差分を加えない。
    -   完了時にはEH-3.9..EH-3.12が成功し、provider経由と直接fixtureの選択結果が一致し、production差分0を観測できる。
    -   _Requirements: 3.9, 3.10, 3.11, 3.12, 6.5, 6.6_
    -   _Boundary: Encoding-finished Hook Selector characterization_
    -   _Verification: unittest/spec, unittest/imp, PM provider characterization, production diff-check_
    -   _Depends: 1.3_

-   [x] 2.3 command解釈結果・引数・親環境非継承をcharacterizationする

    -   `ProcessUtil.parseCmdStr`（Configurationが契約を維持する既存形式）が返すexecutableと順序付きargsを変更せずshellなしで直接spawnし、引用符、変数展開、pipe、
        redirect、`%NODE%`、`%ROOT%`、`%SPACE%`を本機能で再解釈しないことをsynthetic executableで確認する。
    -   spawn envがサーバー processの`PATH`（`process.env.PATH`）とevent別allowlistだけで、親にだけ置いたsynthetic markerを含まないことを固定
        する。Configurationの解釈・値検証を本機能へ移さずproduction差分0とする。
    -   完了時にはEH-5.1..EH-5.6が成功し、args順序差、shell起動、再解釈、allowlist外key、production差分が各0件となる。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    -   _Boundary: Configured Command Consumer・Environment Allowlist characterization_
    -   _Verification: unittest/spec, unittest/imp, synthetic-process characterization, production diff-check_
    -   _Depends: 2.1, 2.2_

-   [x] 2.4 9 hook family の exact environment と欠損表現を characterization する

    -   Design §9.4の9 familyについてexact key集合を表駆動で固定し、予約/番組/放送局、録画済み番組/file/drop、encode結果
        の値と10進表現を検証する。
    -   file/説明/拡張/放送局/drop情報の有無を組み合わせ、literal `null`、空文字、unsetを項目規則どおり区別し、空または
        undefined `videoFiles`で`videoFiles[0]`を参照しない。
    -   これは正常値のcharacterizationでproduction差分0とし、準備rejectの修正はTask 4.2へ残す。
    -   完了時にはEH-5.7..EH-5.9が成功し、全familyの不足/余分key、親marker、欠損表現差、production差分が各0件となる。
    -   _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9_
    -   _Boundary: Nine Hook Environment Profiles characterization_
    -   _Verification: unittest/spec, unittest/imp, exact-key table, null/empty/unset characterization_
    -   _Depends: 2.3_

-   [x] 3. 全hook共通の上限付きFIFOを実現する
-   [x] 3.1 一列直列実行・結果分離・通常終端をcharacterizationする

    -   9種混在、再入、正常終了、非0終了、同期spawn throw、非同期`error`、準備失敗をdeferred child fixtureで実行し、受付
        順、準備/実行の最大同時数1、terminal後の次item開始、自動retry 0を固定する。
    -   hook結果による業務状態/他処理success変更0と、exit 0/nonzeroの既存ログ分類を固定するcharacterizationとし、
        production差分0にする。
    -   完了時にはEH-4.1..EH-4.3、EH-4.7、EH-6.2..EH-6.6が成功し、順序逆転、重複finalize、retry、production差分が各0件と
        なる。
    -   _Requirements: 3.11, 3.12, 4.1, 4.2, 4.3, 4.7, 6.2, 6.3, 6.4, 6.5, 6.6_
    -   _Boundary: Hook Command FIFO and Existing Terminal Paths characterization_
    -   _Verification: unittest/spec, unittest/imp, deferred-child characterization, production diff-check_
    -   _Depends: 2.1, 2.2_

-   [x] 3.2 waiting上限・起動時snapshot・過負荷を一つのTDD cycleで実装する

    -   検証済み`hookCommandMaxPending`の省略64、1、10,000、Configuration側で拒否される0/-1/10,001/文字列/小数/NaN/
        Infinity、reload非反映、restart反映をcontract fixtureへ追加する。active一件を除くwaitingだけを数え、満杯時に新規
        だけ拒否する期待でREDを確認する。
    -   feature生成時に値を一回snapshotし、activeとwaitingを分離した一つのFIFOへ最小実装する。満杯時は新規をenqueueも
        spawnもせずerror記録し、既存順序を保持する。
    -   clamp、丸め、種別queue、priority、retry、永続化、dedupe、稼働中reloadを追加せず、同じtargetをGREENにしてTask 3.1
        を再実行する。
    -   完了時にはEH-4.4..EH-4.6/EH-4.20が成功し、active 1+waiting上限、満杯時新規enqueue/spawn 0、既存順序差0を観測でき
        る。
    -   _Requirements: 4.4, 4.5, 4.6, 4.20_
    -   _Boundary: Bounded Hook Command FIFO・Startup Configuration Snapshot_
    -   _Verification: unittest/spec, unittest/imp, configuration contract, overload race, target RED/GREEN_
    -   _Depends: 3.1_

-   [x] 4. 先頭到達後のabsolute deadlineとcommand準備を実現する
-   [x] 4.1 deadline値・開始点・waiting除外を一つのTDD cycleで実装する

    -   検証済み`hookCommandTimeoutMs`の省略300,000ms、1、2,147,483,647、Configuration側で拒否される0/-1/ 2,147,483,648/
        文字列/小数/NaN/Infinity、reload非反映、restart反映をfake timer fixtureへ追加してREDを確認する。
    -   FIFO headをactiveへ移した直後かつcommand選択・解釈・file確認・DB/path/env準備より前に一件のabsolute deadlineを開
        始し、spawnとexitまで同じ期限stateを使う最小実装を行う。waiting時間は除外し、段階別timeoutを重ねない。
    -   同じtargetをGREENにし、Task 3.1/3.2を再実行する。
    -   完了時にはEH-4.8..EH-4.10が成功し、activeあたりmain timer 1、waiting timer 0、設定drift 0、deadline対象段階の欠
        落0を観測できる。
    -   _Requirements: 4.8, 4.9, 4.10_
    -   _Boundary: Hook Command Absolute Deadline・Startup Configuration Snapshot_
    -   _Verification: unittest/spec, unittest/imp, fake-timer boundary, target RED/GREEN_
    -   _Depends: 3.2_

-   [x] 4.2 準備失敗・準備中timeout・late resultを一つのTDD cycleで実装する

    -   provider解釈、executable確認、DB、record/drop/output path、env構築のthrow/rejectと準備中deadlineを注入し、spawn
        0、failure記録、active解放、次item開始、late resolve後spawn 0、未処理rejection 0を要求するtargetでREDを確認す
        る。
    -   `async` Promise executorを除き、準備のresolve/rejectを同じdeadline/generation/settled stateへ収束させる最小
        production修正を行う。各await後とspawn直前にguardし、late resultを破棄する。
    -   正常environment値を変えず、自動retry、準備cancel保証、late result再利用、業務変更を追加しない。同じtargetをGREEN
        にしTask 2.4/4.1を再実行する。
    -   完了時にはEH-4.19/EH-6.1/EH-6.7が成功し、各failure後の次item開始1、spawn 0、unhandled rejection 0を観測できる。
    -   _Requirements: 4.13, 4.19, 5.8, 5.9, 6.1, 6.5, 6.7_
    -   _Boundary: Command Preparation・Deadline Generation Fence_
    -   _Verification: unittest/spec, unittest/imp, deferred-promise, unhandled-rejection sentinel, target RED/GREEN_
    -   _Depends: 2.4, 4.1_

-   [x] 5. direct childの二段停止と例外安全finalizerを実現する
-   [x] 5.1 timeout停止・競合・resource解放を一つのTDD cycleで実装する

    -   running timeout、exit/error/timeout同着、即時exit、signal/log/timer/listener cleanup失敗をfake timerとchild
        doubleで注入し、最初のsettlement一件だけ、finalize一回、次item一回を要求するtargetでREDを確認する。
    -   spawnが返したdirect childだけを保持し、timeoutで`SIGINT`一回→最大3秒確認→未終了なら`SIGKILL`一回→最大3秒確認を実
        装する。未終了でもcommand type、PID、送信済みsignal、`termination-unconfirmed`、`forced-release`をerror記録し、
        resourceを強制解放して次へ進む。
    -   finalizerでmain/grace timer、当該listener、child/準備参照、activeを例外分離して一回だけ解放する。追加signal、
        grandchild終了保証、自動retryは追加しない。同じtargetをGREENにして通常終端回帰を再実行する。
    -   完了時にはEH-4.11..EH-4.18が成功し、各signal最大1、各grace最大3秒、settle/finalize/次item各1、残留
        timer/listener/ active参照0を観測できる。
    -   _Requirements: 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.18_
    -   _Boundary: Direct Child Termination Controller・Single Finalizer_
    -   _Verification: unittest/spec, unittest/imp, fake-timer race/fault injection, target RED/GREEN_
    -   _Depends: 4.2_

-   [x] 6. 62機能ACだけのdomain matrixを閉じる
-   [x] 6.1 R1からR6の62 canonical caseを実装・実行してdomain gateを閉じる

    -   Design §12のexact locatorへEH-1.1..EH-6.7の62 canonical `unittest/spec`主caseを一意に実装し、各caseを対応する実
        行leafのtestへ接続する。欠落、重複ID、別locatorへの代替を許可しない。
    -   process-local配送、destination隔離、PM provider/registration、9種hook、共通FIFO、waiting上限、absolute
        deadline、command準備、allowlist env、二段停止、single finalizer、失敗継続を対象targetと関連suiteで実行する。
    -   永続化、ack、必達再送、共通dedupe、自動retry、業務rollback、親env全継承、追加signal、grandchild終了保証が0である
        否定assertionも実行する。R7品質証拠はこのleafへ混在させない。
    -   完了時には62/62 caseが成功し、各IDの実行結果、command、対象件数、resource解放、未解決riskを確認できる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5,
        3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14,
        4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
        6.7_
    -   _Boundary: R1-R6 Domain Contract Matrix_
    -   _Verification: 62 canonical unittest/spec cases, related unittest/imp_
    -   _Depends: 1.4, 2.1, 2.2, 2.3, 2.4, 3.2, 4.2, 5.1_

-   [x] 7. R7の機能固有の品質を閉じる
-   [x] 7.2 implementation characteristicを検証する

    -   `test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts#EH-7.2`を実装し、値域、状
        態、deadline直前/到達/ 超過、race、null/empty/unset、single completion、timer/listener/direct child/queue head解
        放を横断する。
    -   既存characterizationはproduction差分0を証明する。
    -   完了時には全profileの分類済み件数、成功結果、production差分、残留resource 0を確認できる。
    -   _Requirements: 7.2_
    -   _Boundary: Event and Hook Implementation Characteristics_
    -   _Verification: imp/event-hook-characteristics.test.ts#EH-7.2_
    -   _Depends: 6.1_

-   [x] 7.4 DB・filesystem・IPC・process・signal結合を検証する

    -   `test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts#EH-7.4`を実装
        し、synthetic DB、temporary filesystem、PM IPC port、実child executable、SIGINT/SIGKILLを接続する。
    -   正常/非0/spawn失敗、準備reject、FIFO/満杯、準備中/実行中timeout、二段停止、終了未確認、late event、次item継続、
        allowlist env、終了時child回収を検証する。HTTP/Socket.IO/browser直接配送はSI ownerのためN/A理由を残す。
    -   完了時には全scenario成功、最大同時child 1、過負荷/late spawn/retry 0、残留DB/file/timer/listener/test child 0を
        観測できる。
    -   _Requirements: 7.4_
    -   _Boundary: DB・Filesystem・IPC・Process・Signal Integration_
    -   _Verification: integration/event-hook-delivery.integration.test.ts#EH-7.4_
    -   _Depends: 7.2_

-   [x] 7.5 本機能の品質判定を満たす

    -   Task 7.2と7.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 7.2, 7.4_
    -   _Requirements: 7.1, 7.3, 7.5_

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                                                         | Test type                                                                                       | Local Depends                            | Verification command                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/event-and-hook-delivery/event-delivery.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                       | `unittest/spec, unittest/imp, deferred-listener characterization, production diff-check`        | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/event-and-hook-delivery/event-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                          |
| 1.2  | `test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                              | `unittest/spec, unittest/imp, carrier contract test, target RED/GREEN`                          | `1.1`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                 |
| 1.3  | `test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`test/server/event-and-hook-delivery/provider-registration.spec.test.ts`<br>`test/server/event-and-hook-delivery/startup-encode-completion.spec.test.ts`                                                                                              | `unittest/spec, unittest/imp, PM port contract, target RED/GREEN`           | `1.2`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`npm run test:server:spec -- test/server/event-and-hook-delivery/provider-registration.spec.test.ts`<br>`npm run test:server:spec -- test/server/event-and-hook-delivery/startup-encode-completion.spec.test.ts`                                                                                                                                 |
| 1.4  | `test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts` | `unittest/spec, unittest/imp, disconnect/restart characterization, filesystem ledger`           | `1.3`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/downstream-notification.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts` |
| 2.1  | `test/server/event-and-hook-delivery/external-command-selection.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                           | `unittest/spec, unittest/imp, table-driven characterization, production diff-check`             | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-selection.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                              |
| 2.2  | `test/server/event-and-hook-delivery/external-command-selection.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                           | `unittest/spec, unittest/imp, PM provider characterization, production diff-check`              | `1.3`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-selection.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                              |
| 2.3  | `test/server/event-and-hook-delivery/external-command-environment.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                         | `unittest/spec, unittest/imp, synthetic-process characterization, production diff-check`        | `2.1, 2.2`                               | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-environment.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                            |
| 2.4  | `test/server/event-and-hook-delivery/external-command-environment.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                         | `unittest/spec, unittest/imp, exact-key table, null/empty/unset characterization`               | `2.3`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-environment.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                            |
| 3.1  | `test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                               | `unittest/spec, unittest/imp, deferred-child characterization, production diff-check`           | `2.1, 2.2`                               | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                  |
| 3.2  | `test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                               | `unittest/spec, unittest/imp, configuration contract, overload race, target RED/GREEN`          | `3.1`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                  |
| 4.1  | `test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                               | `unittest/spec, unittest/imp, fake-timer boundary, target RED/GREEN`                            | `3.2`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                  |
| 4.2  | `test/server/event-and-hook-delivery/external-command-failures.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                            | `unittest/spec, unittest/imp, deferred-promise, unhandled-rejection sentinel, target RED/GREEN` | `2.4, 4.1`                               | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-failures.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                               |
| 5.1  | `test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                               | `unittest/spec, unittest/imp, fake-timer race/fault injection, target RED/GREEN`                | `4.2`                                    | `npm run test:server:spec -- test/server/event-and-hook-delivery/external-command-queue.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                  |
| 6.1  | `test/server/event-and-hook-delivery/*.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts` | `62 canonical unittest/spec cases, related unittest/imp` | `1.4, 2.1, 2.2, 2.3, 2.4, 3.2, 4.2, 5.1` | `npm run test:server:spec -- 'test/server/event-and-hook-delivery/*.spec.test.ts'`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts` |
| 7.2  | `test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                                                            | `imp/event-hook-characteristics.test.ts#EH-7.2`                                                 | `6.1`                                    | `npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`                                                                                                                                                                                                                                           |
| 7.4  | `test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts`                                                                                                                                                               | `integration/event-hook-delivery.integration.test.ts#EH-7.4`                                    | `7.2` | `npm run test:server:integration -- test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts`                                                                                                                                                                                                                      |
| 7.5  | `test/server/event-and-hook-delivery/*.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `7.2, 7.4` | `npm run test:server:spec -- 'test/server/event-and-hook-delivery/*.spec.test.ts'`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/event-and-hook-delivery/integration/event-hook-delivery.integration.test.ts` |
