# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation と Node.js 24 必須・26 追加 matrix は `server-application-runtime` が所有する。さらに、
`server-configuration`、`server-operational-logging`、`server-reservation-management`、`server-program-guide`、
`server-tuner-access`、`server-recorded-content`、および `server-media-process-management` の承認済み provider contract
を実装してから本 spec を実行する。

本 spec は、予約候補 registry、単一周期 scan、共有 short wake、世代付き録画 scheduler、一予約の
prepare/record/retry/finish、tuner stream の利用、録画 file 書込み、drop 集計、および起動時録画整理を一度だけ所有する。
予約 row・候補差分・競合判断は `server-reservation-management`、Mirakurun／mirakc REST と stream 確立は
`server-tuner-access`、録画済み row・file domain は `server-recorded-content`、media child の共通 lifecycle は
`server-media-process-management`、event 配送・跨域 workflow・runtime binding は後続 owner に残す。外部 spec の task ID
は local Depends 欄に記載しない。

予約ごとの長時間 timer を廃止する変更以外では、承認済み Design が明示する既存の retry、margin、file/drop、起動時整理、
event payload、および失敗伝播を維持する。番組リレー確認の20秒前 timer、session の5秒 retry、tuner追跡の30分整理周期を中
央 scheduler へ移さず、録画 stream 本文へ一般的な時間制限を追加しない。

-   [x] 1. 単一周期 scan と世代付き録画 scheduler を実現する
-   [x] 1.1 録画候補の採否と修正前の予約別 timer を characterization する

    -   通常・競合を候補へ含め、除外・重複を含めない既存 predicate を、4状態の synthetic 予約と `unittest/spec` で固定す
        る。
    -   修正前は予約ごとに開始15秒前までの長時間 timer を一件保持し、明示的な更新・reset 以外では時計変化を再評価しない
        ことを、fake timer の隔離 fixture へ残す。
    -   待機中の開始・終了変更、insert・update・delete、同一予約IDの置換、および reset 入口の修正前効果を記録し、目標
        scheduler の保証と混在させない。
    -   完了時には、候補採否の仕様 test と修正前 timer の characterization が production code の差分なしで再現される。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
    -   _Boundary: Recording candidate predicate・legacy timer characterization_
    -   _Verification: unittest/spec, unittest/imp, characterization_

-   [x] 1.3 候補 registry と不透明世代を実装する

    -   予約IDごとの最新候補一件、追加・更新・削除・起動再構築ごとに進む不透明な `bigint` 世代、および同一ID削除・再追
        加後の古い準備結果・終了要求・取消済みcallbackが新世代へ作用しない契約を、deferred fixtureのtarget testが検証
        する。generation、controller token、session tokenへ固定上限、number変換、wrap、serialization、永続化を設けない
        否定assertionも含み、1.1の既存候補採否は変わらない。
    -   保存済み予約snapshot、準備時点、終了時点、種類、状態、phase、世代を予約IDごとの一件へまとめ、通常・競合だけを
        登録する。追加・更新・削除・再構築でprocess-localな世代を単調増加させ、古いcallbackが比較以外の効果を持たない
        consumer seamを持つ。
    -   予約row、DB schema、公開API、IPC envelope、永続queue、固定最大値、一般的CAS基盤を追加しない。
    -   完了時には、全fixtureが成功し、同じ予約IDの削除・再追加後も旧世代からの状態変更が0件であることを観測できる。
    -   _Requirements: 1.1, 1.2, 1.5, 1.7_
    -   _Boundary: RecordingCandidateRegistry_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 1.1_

-   [x] 1.5 単一評価 loop と共有 wake を実装する

    -   15秒の準備前倒し幅と3,000ms周期を分離し、遠未来候補数によらないtimer handle最大一件、最早deadlineが3秒未満の場
        合だけのshort wake、期限到来済み処理の先行dispatch、0ms競合のmicrotask再評価を、fake schedulerのtarget testが
        検証する。callback発火時・dispatch後・非同期境界後のwall clock/最新世代再読込、時計前進・後退、event-loop遅延
        、同時刻準備の非直列dispatchと評価loop一件も検証し、1.1のlegacy fixtureは隔離して維持する。
    -   全候補とactiveな時刻指定終了milestoneを3秒以内ごとに走査し、最早deadlineだけへ共有timerを一件設定する。timer
        callbackは評価loopをwakeし、期限到来済み準備はphase遷移後にsessionへdispatchして録画lifetimeをawaitせず、評価
        中の追加wakeを再実行要求へ合流する。
    -   active番組リレーtimer、session所有retry timer、tuner追跡整理intervalの所有権と値を変更しない。
    -   完了時には、大量遠未来予約でもscheduler所有handleと並行評価が各一件以下であることを観測できる。
    -   _Requirements: 1.3, 1.4, 1.6_
    -   _Boundary: RecordingScheduleController_
    -   _Verification: unittest/spec, unittest/imp, load test_
    -   _Depends: 1.3_

-   [x] 1.7 差分受付、評価合流、および scheduler CAS を実装する

    -   insert・update・deleteの同期enqueue、同一event-loopのmutation burstを一回へ合流するmicrotask wake、評価中
        mutation・timer callback・reset競合時の予約ID/期待世代/session token/期待phaseの同期照合を、target testが検証
        する。controller tokenまたは世代が古いcallbackのno-op、throwしない受付と後続評価rejectionの局所記録、二重
        dispatch 0件も検証し、単発差分の既存結果は変わらない。
    -   予約差分とreset要求を同じ評価入口へ集約し、差分適用ごとに候補世代を進めて最新時刻を直ちに再評価する。
        `Waiting`から`Preparing`、active時刻指定終了のdispatch前に期待世代・session token・phaseを同期照合し、一回だけ
        状態を進める。
    -   session内部の全終了原因、event、DB効果へ普遍的exactly-once、retry、永続queue、公開schemaを追加しない。
    -   完了時には、mutation数に比例したtimer handle、並行評価、旧世代からの状態変更が各0件であることを観測できる。
    -   facade 内部の同期 `acceptMutation(diff)` を Task 1.7 の受付入口として固定する。`Failed` の no-op、起動前・
        `Starting` の snapshot 保留、snapshot不能時の controller 直接受付、`Started` での scheduler 開始確認後一回だけの
        controller 受付、および `update(diff)` の idle/session mutation tail 互換待機を provider test で検証する。後続評価、
        queue、retry、timer、registry は controller の所有のままとする。
    -   _Requirements: 1.5, 1.7, 3.1_
    -   _Boundary: RecordingScheduleController・RecordingCandidateRegistry integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 1.5_

-   [x] 1.9 時刻指定終了を中央 milestone へ統合する

    -   activeな時刻指定録画だけを`endAt + endMargin`のscheduler所有milestoneへ登録し、更新時に新世代・新時刻へ置換す
        る契約を、target testが検証する。旧時刻・更新後時刻・時計前進・取消・完了・first-data待機中終了を組み合わせ、
        期待世代・session token・phase一致時だけ一回終了し、番組指定の強制終了milestoneは0、relay確認はsession専用
        timerのままである。時刻指定の既存更新fixtureは変わらない。
    -   時刻指定stream開始後に最新世代の終了milestoneを中央controllerへ登録し、終了時刻変更で旧世代を無効化する。
        sessionの取消・完了・失敗でmilestoneを除去し、終了反映全体を評価loop内でawaitしない。
    -   時刻指定の開始margin、開始前stream消費、開始内部event最大15秒待ち、番組指定streamの上流終端契約を変更しない。
    -   完了時には、古い終了時刻による早期終了が0件、最新時刻での終了が一回、scheduler所有timer handleが一件以下であるこ
        とを観測できる。
    -   _Requirements: 2.5, 2.6, 2.7_
    -   _Boundary: RecordingScheduleController・TimeSpecified RecordingSession integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 1.7_

-   [x] 2. 予約変更、取消、および session 所有 retry を整合させる
-   [x] 2.1 phase と予約種類ごとの変更・取消を characterization する

    -   `Waiting`の開始・終了変更、番組指定`Preparing`の開始後退・前進、番組指定`Recording`の開始変更、および時刻指定の
        準備中・録画中変更を表駆動の`unittest/spec`で固定する。
    -   待機中は候補除去、準備中はAbortと取消完了待ち、録画中はstream終了という、予約削除・対象外化のphase別既存動作を検
        証する。
    -   録画中の番組情報変更ではstreamを再取得せず、録画済み情報の非同期更新失敗を局所記録して受信を継続することを確認す
        る。
    -   完了時には、予約種類、phase、開始・終了変更、取消の組合せが既存結果を再現し、production codeの差分がない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.5_
    -   _Boundary: RecordingSession reservation mutation characterization_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 2.3 session 所有 retry と取消時無効化を実装する

    -   stream取得失敗後の一件の5秒timerと`RetryWaiting`、期待世代・session token・attempt・phase一致時だけの再準備を
        、target testが検証する。取消・対象外化・置換・更新・`Completed`・`Cancelled`・cleanup後のlate callbackから
        stream取得・準備・通知が各0件となることを確認し、attempt 0から時刻指定は最大4回、番組指定は終了時刻前なら回数
        を使い切っても再試行を続ける既存fixtureは変わらない。
    -   有限backoffをsessionの一件のhandleへ保持し、callback前に世代・session token・attempt・phaseを同期検査する。取
        消・更新・終端時にhandleを一回解除してtokenを進め、後着callbackをno-opへ収束させる。
    -   新しいretry回数、指数backoff、永続attempt、共通queueを追加せず、番組指定の再試行の継続判定は失敗直後の終了時刻
        の確認だけである。
    -   完了時には、取消または終了後のstream要求、準備通知、残留retry timerが各0件であることを観測できる。
    -   _Requirements: 2.8, 3.7, 3.9_
    -   _Boundary: RecordingSession retry lifecycle_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 1.7, 2.1_

-   [x] 2.5 削除前取消の terminal barrier を実装する

    -   利用者削除だけを`recorded-content-deletion`へ写像し、active indexの所有を保ったまま放送受信、writer close、
        drop stop、late終了処理の終端後だけ成功する契約を、target testが検証する。Waiting、RetryWaiting、Preparing、
        first-data待機中、Recording、同一sessionの複数要求join、60,000ms境界とlate terminalを検証し、容量不足削除から
        の取消・停止・terminal待機0件、通常取消へのbarrier拡張なしをassertする。通常取消の既存fixtureは変わらない。
    -   該当理由だけでsessionを停止中としてindexへ保持し、stream破棄、first-data gate取消、writer・drop・late
        continuationの終端を一つのlatchへ集約する。barrier成功後だけdetachし、期限到達時は失敗を返してlate terminalを
        観測し続ける。
    -   planned-delete経路で録画中解除・移動・size・drop反映・履歴・完了通知・再録画判断を開始せず、容量不足削除をこの
        入口へ接続しない。
    -   完了時には、利用者削除成功後の対象fileへ作用可能なcontinuationと、容量不足削除起因のsession取消・停止・待機が各0
        件であることを観測できる。
    -   _Requirements: 2.9, 5.1_
    -   _Boundary: Recording manager deletion-stop index・RecordingSession planned-delete finalization_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.3_

-   [x] 2.7 録画利用 snapshot と排他 gate を実装する

    -   active sessionに対応するrecorded IDの重複除去、既知空集合、安全に列挙不能な`unknown`、ID未確定の準備中
        sessionと終了済みsessionの除外を、target testが検証する。activeあり・なし・不明、token保持中の同ID新session拒
        否、別ID継続、double/stale/別ID releaseを表駆動で検証し、busy/unknown経路の
        cancel/stop/destroy/close/drop/query/deleteを各0件とする。2.5のterminal barrier fixtureは変わらない。
    -   active session registryと同じ直列化境界からrecorded IDを一時点に列挙し、不明なら部分集合や空集合でなく
        `unknown`を返す。`busy`・`unknown`・一件の不透明tokenを備え、token保持中は同IDの新sessionだけを拒否する。
    -   `addRecorded`後かつ`Recording` CAS、終了処理設定、開始通知、relay設定前をadmission commit pointとし、actual
        session identityと登録objectを結ぶ。CAS不成立時だけexact registrationを解放し、block時は自己所有
        `PendingRegistrationResources`のpath、recorded/video/drop rowを一つのcleanup lifetimeで一回回収する。writer、
        stream、drop、size更新のcontinuation終端後だけ同じidentityを解放し、failure通知、既存active session、別session、
        token所有者へは作用させない。
    -   exact tokenの一回解放だけが現在のgateを解放し、予約row、候補SQL、file・DB削除、service-child gate、公開API、
        IPC schema、session停止を追加しない。
    -   完了時には、snapshot取得とbusy/unknown判定によるsession・stream・writer・dropへの作用が0件であることを観測でき
        る。
    -   _Requirements: 2.9_
    -   _Boundary: Active recording session registry・RecordingRecordedUseSnapshotProvider・RecordingRecordedUseGate_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 2.5_

-   [x] 2.8 fake容量不足削除consumerとのsnapshot・gate接続を検証する

    -   fake Runtime/Storage consumerへknown snapshotを渡すと候補queryの除外IDだけへ使われ、`unknown`またはsnapshot取得
        rejectでは候補queryと削除要求が各0件になることを確認する。
    -   削除直前のgateが`busy`または`unknown`なら`not-deleted`へ投影し、token取得時は削除の成功・`not-deleted`・rejectの
        すべての最終結果でexact tokenを一回解放することを検証する。
    -   token保持中の同ID新session開始を拒否し、別ID sessionと既存active sessionを停止せず継続することを統合fixtureで確
        認する。
    -   本specでは候補SQL、DB/file削除、容量監視、service-child gate、およびRuntime bindingを実装せず、fake consumerから
        provider contractだけを観測する。
    -   完了時には、known/unknown/busy/acquiredと全削除結果のfixtureが終端し、取消・停止・destroy・writer close・drop
        stop・誤delete・token残留が各0件になる。
    -   _Requirements: 2.9_
    -   _Boundary: RecordingRecordedUse provider contract integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.7_

-   [x] 3. 録画準備、tuner割当、および有限stream取得を既存契約へ揃える
-   [x] 3.1 準備直前の対象確認と準備情報の決定順をcharacterizationする

    -   準備直前に保存予約を再取得し、存在、通常・競合、終了前を満たす一件だけを開始することを`unittest/spec`で固定す
        る。
    -   番組指定では保存番組、時刻指定では放送局と利用可能な番組表示を使い、stream取得と予約存続確認後に内部
        `Recording`へ移ってから録画先・file名を決める既存順を検証する。
    -   保存番組なし、予約削除、対象外化、期限切れ、およびstream取得後の予約消失の通知・handle終了を確認する。
    -   完了時には、正常・対象外・消失・期限切れの各fixtureが既存の準備結果と呼出順を再現し、production codeの差分がな
        い。
    -   _Requirements: 3.1, 3.2_
    -   _Boundary: Recording preparation coordinator・candidate source_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 3.2 論理tuner割当、priority、および途中終了判断をcharacterizationする

    -   通常予約は通常priority、競合予約は競合priorityで共通streamを要求することをprovider spyで固定する。
    -   対応放送波の空き、同一channel共有、全予約が途中終了可、残り15秒以内、最新番組の延長有無による再割当を表駆動で検
        証する。
    -   最新番組取得失敗を記録して延長されていないものとして判定を続け、他の条件が成立すれば既存録画を終了して新しい録画へ
        割り当てることを`unittest/spec`で固定する。
    -   tuner情報を初回だけ設定し、30分intervalと終了後12時間以内の追跡保持を維持することをfake timerで確認する。
    -   完了時には、priority、同一channel、再割当、metadata失敗、追跡整理の全fixtureが既存結果を再現する。
    -   _Requirements: 3.3, 3.4, 3.5, 3.6_
    -   _Boundary: StreamAllocator characterization_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_

-   [x] 3.3 時刻指定streamの最大4回取得と番組指定streamの終了時刻までの取得をcharacterizationする

    -   初回と5秒間隔の再試行、時刻指定はattempt 3失敗時、番組指定は終了時刻後の失敗時の準備失敗通知、および取得成功後の予約再確認をfake timerで固定する。
    -   番組指定は各失敗の直後に終了時刻を確認して終了時刻前なら再試行を続け、時刻指定は各要求直前に最新時刻が終了後ならportを呼ばず取得失敗とする。
    -   Abortによる取得失敗、予約取消、正常取得、全attempt失敗のtimer・port・event回数を検証する。
    -   完了時には、時刻指定の4 attempt、番組指定の終了時刻までのattempt、各5秒、予約種類別終了判定、および準備失敗一回が再現される。
    -   _Requirements: 3.7, 3.8, 3.9_
    -   _Boundary: RecordingSession stream acquisition characterization_
    -   _Verification: unittest/spec, integration_
    -   _Depends: 3.1_

-   [x] 3.5 録画準備と論理割当を共通 tuner port へ接続する

    -   最新番組・番組stream・service stream・closeを`server-tuner-access`の正準portだけへ要求する契約を、target
        testと静的依存検査が検証する。open前の接続失敗・取消、handle後のend/close/error、冪等な同期closeを製品差のない
        fake handleで検証し、stream本文へ録画時間または600秒watchdogを適用しない。3.2・3.3の業務結果は変わらない。
    -   4操作を正準tuner-access handleへ委譲し、正規化errorを既存の準備・録画判断へ写像する。priority、同一channel共有
        、途中終了判断、再試行回数、時刻指定margin、論理tuner追跡は変更しない。
    -   REST client、認証、接続deadline、stream確立、製品別extensionを本specへ複製しない。
    -   完了時には、録画実行packageから製品固有client・型・URLへの直接依存が0件であることを観測できる。
    -   _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 8.1, 8.2_
    -   _Boundary: StreamAllocator・RecordingTunerPort adapter_
    -   _Verification: unittest/spec, unittest/imp, integration, static dependency test_
    -   _Depends: 3.2, 3.3_

-   [x] 3.6 drop確認の有効・無効と集計開始をcharacterizationする

    -   設定有効時だけstreamを分岐してdrop、error、scramblingの集計を開始し、無効時はcheckerとlog資源を作らないことを固
        定する。
    -   checker開始、log登録、録画stream継続、終了時結果待ちの既存順と、登録失敗・初回data失敗時に資源が残り得る特性を正
        常fixtureから分離する。
    -   drop checkerの準備（log file作成）を録画streamを流す前に終え、録画fileへの`pipe`と同じtickで集計へ接続し、録画file
        と同じ先頭dataから集計することを固定する。準備の間はstreamを止め、flowingのまま渡されたstreamに準備中に届いたdataも
        録画fileと集計の両方へ先頭から渡ることを`drop-checker-attach-order.imp.test.ts`で観測する。
    -   完了時には、有効・無効、準備失敗、接続失敗、登録失敗のresource・呼出回数と、録画fileと集計が受けるdataの一致が決定論的
        に観測できる。
    -   _Requirements: 3.10_
    -   _Boundary: DropCounter characterization_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_

-   [x] 3.7 番組指定の準備再試行の運用logを集約する

    -   fake timerで、attempt 0〜3の失敗は1回ごと、attempt 4以降の失敗は直前の記録から60秒以上経った失敗の時点で一回に
        まとめて、失敗回数（直前の記録以後と総数）と最後のエラーを記録し、59,999msでは記録しないことを、target testが
        検証する。attempt 4以降の準備開始logも記録しないことを含める。
    -   取得に成功して録画へ進むとき、取消で準備を取り消すとき、および予約終了時刻に達して準備失敗を通知するときは、未
        記録の失敗があれば60秒を待たずに記録してから進み、なければ記録しないこと、保持した失敗を次の準備へ持ち越さない
        ことを、同じtarget testが検証する。時刻指定予約は1回ごとに記録する。
    -   `prepRecord`の失敗処理は、attempt 4以降の失敗を回数と最後のエラーだけ保持し、時刻判定でまとめて記録する。
    -   完了時には、再試行が続く間のlogが60秒に一回以下であり、録画開始・取消・準備失敗の前に未記録の失敗が（あれば）必ず記録されること
        を観測できる。
    -   _Requirements: 3.18_
    -   _Boundary: RecordingSession preparation retry logging_
    -   _Verification: unittest/spec_
    -   _Depends: 2.3_

-   [x] 4. 録画先選択の排他、no-clobber確保、および遅延結果を整合させる
-   [x] 4.1 優先度1・5秒取得待ちと録画先選択順をcharacterizationする

    -   path選択専用のexecution coordinatorへ優先度1、最大5秒で実行権を要求し、取得後だけ録画先選択を開始する既存契約を
        `unittest/spec`で固定する。
    -   実行権内で保存先、番組、放送局、file名、既存fileを順に確認し、成功・失敗のsettlement後に`finally`から一回解放す
        ることをdeferred portで検証する。
    -   5秒で取得できないentryへ後から実行権を渡さず、録画先選択を開始せず、同じqueueの次の有効要求を進めることを確認す
        る。
    -   priority順、同priority受付順、process-local ID、timeout entry除外、exact releaseのprovider実装は
        `server-reservation-management`の正本testを再利用する。
    -   完了時には、priority、5秒境界、選択順、排他、および解放回数が既存結果を再現し、production codeの差分がない。
    -   _Requirements: 3.11, 3.12, 3.13, 3.14_
    -   _Boundary: Recording path selection consumer・execution coordinator contract_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 4.3 no-clobber file 確保と handle 引渡しを実装する

    -   同じ候補名の二録画を競合させ、実行権内で最初だけがno-clobber作成に成功し、他方がsuffix付きの別fileを確保する契
        約を、target testが検証する。writerの確保済みhandle引継ぎとappend再open 0件、pipe前失敗・取消時のexact
        session所有handle/fileだけのcleanupを検証し、4.1の実行権fixtureは変わらない。
    -   候補名ごとの排他的作成を試し、存在済みの場合だけ次suffixへ進み、成功pathとhandleを同じsessionへ引き渡す。
        writerはそのhandleだけへ書き込み、準備失敗時は所有handleをcloseして未公開fileだけを削除する。
    -   path公開形式、file名置換、suffix規則、保存先選択、一時保存先、一般的canonical containment契約を変更しない。
    -   完了時には、同時録画で同じ書込先を返す件数と別所有fileを変更する件数が各0件であることを観測できる。
    -   _Requirements: 3.15, 3.16, 4.1_
    -   _Boundary: RecordingFileWriter allocation・recording path ownership_
    -   _Verification: unittest/spec, unittest/imp, filesystem integration_
    -   _Depends: 4.1_

-   [x] 4.5 録画先選択の owner watchdog と後着整理を実装する

    -   番組・放送局read、directory access/作成、no-clobber確保をdeferredにし、599,999ms以内のsettlementと600,000ms未
        確定の`path-selection-overdue`を、target testが検証する。期限後も実行権・underlying Promise・途中handleの所有
        を保持し、同queue後続と同session録画開始を進めず、別session/domainは継続する。後着success/failureのexact
        cleanupと一回release、再実行0件を検証し、4.1〜4.3は変わらない。
    -   一件の選択全体へ600秒watchdogと一意execution IDを設定し、通常settlementと期限の先着一件だけで状態遷移する。
        overdue時は同operationの所有を保持してsession stream終了を要求し、後着settlementをexact sessionのhandle/file整
        理と一回releaseだけへ限定する。
    -   underlying I/O取消・再実行、DB read個別timeout、共通queue解放、永続結果、retry、process停止を追加しない。
    -   完了時には、overdue中の同queue並行path選択、二重release、別session停止が各0件であることを観測できる。
    -   _Requirements: 3.17_
    -   _Boundary: Recording path selection owner watchdog_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 4.3_

-   [x] 4.6 保存先の外を指すsubdirectoryを使わず保存先直下へ保存する

    -   書式展開後のsubdirectoryが`..`・先頭`/`の後の`..`・NULで保存先の外を指す予約と、`a/../b`・`/anime`のように保存
        先の中に収まる予約を`unittest/spec`で定義し、外を指す予約でも保存先の外にfileが作られないことを検証する。
    -   共通の判定関数を録画先選択の書式展開の後に適用し、外を指す場合はsubdirectoryを空として扱い、運用logへ記録して
        録画を続ける。登録される相対pathがfile名だけになることを確認する。
    -   内に収まる指定の実file、no-clobber、一時保存先、登録path形式が変わらないことを確認する。
    -   完了時には、外を指す指定で保存先の外に作られるfileが0件で、録画が失敗しないことを観測できる。
    -   _Requirements: 3.19_
    -   _Boundary: Recording path selection sub directory_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 4.3_

-   [x] 5. 録画開始、first-data settlement、および結果登録を整合させる
-   [x] 5.1 stream取得後から録画開始通知までの既存順をcharacterizationする

    -   stream取得と予約存続確認後に内部`Recording`化・内部開始eventを行い、その後にpath、writer、pipe、最初のdata待ちへ
        進む順序を`unittest/spec`で固定する。
    -   5秒以内の最初のdataで録画済み番組行、続いて録画file行を別要求で登録し、終了listener、外部録画開始通知、番組リ
        レーtimerを順に開始することを検証する。
    -   最初のdata timeoutではstream・writerを終了して部分file削除を試み、登録成功後は複数chunkを同じwriterへ継続する。
    -   録画中更新の非同期失敗を局所記録してstreamを継続し、番組リレー候補を親予約のshallow copyとともに予約管理へ渡す既
        存契約を確認する。
    -   修正前のasync data listener内登録rejectが外側準備をpendingにし得る特性をtarget contractから分離する。
    -   完了時には、正常、timeout、複数chunk、更新失敗、relay、登録rejectの各既存時系列がproduction codeの差分なしで再現
        される。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
    -   _Boundary: RecordingSession start characterization・RecordingFileWriter・LifecyclePublisher_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_

-   [x] 5.3 first-data settlement gate と登録失敗 cleanup を実装する

    -   data、5秒timeout、stream/writer error、取消、時刻指定終了、登録rejectを同着させ、先着一件だけが準備結果を確定
        する契約を、target testが検証する。登録reject時のstream/writer終了、exact sessionの部分file整理、外側Promiseの
        有限失敗、残attemptへの遷移を検証する。録画済みrowだけ作成済みならその行の削除を試み、開始event/relay timerを
        発行せず、後発continuationの二重作用を0件とする。5.1の正常順は変わらない。
    -   first-data処理へ一件のsettlement gateを置き、最初の結果だけを採用する。winner後にlistener/timerを解除し、
        generation・session token・phaseでlate continuationを無効化する。二段登録は別要求のまま、reject時は定義済み順
        でexact sessionの資源と作成済みの録画済みrowだけを整理する。
    -   新しい共通transactionを追加しない。
    -   完了時には、準備Promiseの永久pending、二重登録・通知・cleanup、late作用が各0件であることを観測できる。
    -   _Requirements: 4.2, 4.3, 4.7, 4.8_
    -   _Boundary: RecordingSession first-data settlement gate_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 5.1_

-   [x] 5.5 登録 owner watchdog と late-result fence を実装する

    -   first-data後の各登録をpendingにし、599,999ms以内のsettlementと600,000ms未確定の `registration-overdue`を、
        target testが検証する。overdue後もstream・writer・gate・作成済みrow・DB Promiseの所有を保持し、同sessionの重複
        登録/開始を0件とする。別session/domainの継続、後着結果から一回だけの既存成功/reject完了、24時間進行した
        stream本文へのwatchdog非適用を検証し、5.3の即時fixtureは変わらない。
    -   二段登録へ一件の600秒watchdogを設定し、通常settlementと期限の先着一件でoperation stateを進める。overdue時は資
        源を保持してexact sessionだけを隔離し、後着DB settlementを同じ結果の通常成功またはreject経路へ一回だけ戻す。
    -   stream本文・data間隔・録画時間・別session・operator processへwatchdogを伝播せず、DB取消・登録retry・共通
        transactionを追加しない。
    -   完了時には、overdue後の二重row作成、二重開始event、別session停止、本文timeoutが各0件であることを観測できる。
    -   _Requirements: 4.9, 4.10_
    -   _Boundary: Recording result registration owner watchdog_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 5.3_

-   [x] 6. 録画終了、部分失敗、および録画失敗後の有限再試行を固定する
-   [x] 6.1 stream・writer終端からsize・drop反映までをcharacterizationする

    -   予約終了、取消、上流終端、stream error、writer errorから、stream・writer・drop停止、時刻指定milestone・relay
        timer除去、録画中flag解除へ進む既存順を`unittest/spec`で固定する。
    -   録画中flag解除のrejectでは後続を行わず失敗させ、残りの後片付けを再起動時の起動時整理に任せることを確認する。解除
        成功後の一時file移動、size更新開始、drop集計・反映は順に試みる。
    -   移動、size、dropの各失敗をfault injectionし、失敗記録後にDesignで定めた後続だけを続け、size更新を終了完了の前提
        としてawaitしないことを確認する。
    -   planned-deleteではdrop停止後に終了し、録画中解除、移動、size、drop反映、履歴、完了通知を行わない。
    -   録画中の取消と時刻指定終了では、受信socketへ届いていた放送データを最大1秒まで読み切ってからstreamを止め、録画
        fileが届いたdataをすべて含むことを、実物のTCP socketのstreamで確認する。writerが詰まってstreamが止まっている間
        も読み切りを続けること、まだ録画fileへpipeしていないstreamでは読み切りに入らないことも確認する。
    -   完了時には、各終了原因と部分失敗点の呼出順、継続・中断、event件数がproduction codeの差分なしで再現される。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_
    -   _Boundary: RecordingSession finalization・RecordingFileWriter・DropCounter_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_

-   [x] 6.2 終了時再取得、履歴、および完了通知をcharacterizationする

    -   録画済み番組再取得のrejectでは履歴・完了通知を行わず終了処理を失敗させ、成功かつnullでは両方を省略して終了するこ
        とを固定する。
    -   再取得結果があり、番組指定自動予約、非relay、正常終了、予約削除要の全条件を満たす場合だけ録画履歴を追加する。
    -   予約終了時刻の直前・同時・後の取消で、自動予約ルールの予約（非relay）は同時と後だけを正常終了として予約削除要
        `true`で通知し、手動予約と番組リレー予約は常に`false`で通知することを固定する。同じルールの録画が同時に終わ
        り先の完了通知で残りの予約が削除されても、どの録画も録画履歴を追加することを、実物のTCP socketのstreamで確認する。
        取消か正常終了かは読み切りの前に決め、読み切りの間にstreamが終わっても変わらないことを確認する。
    -   履歴の名前は、録画済み番組の半角名から番組の短縮名と同じ規則で作り（[前]・[後]を末尾に残し、[再]・[字]などは除く）、番組と履歴で同じ名前になることを固定する。
    -   履歴追加失敗は記録して完了通知へ進み、予約、再取得結果、予約削除要否を既存entity payloadで通知する。
    -   sessionの終了callbackとeventへ新しい普遍的exactly-once保証を追加せず、既存flag・listenerの競合を隔離
        characterization fixtureへ残す。
    -   完了時には、再取得reject、null、履歴条件表、履歴失敗、および正常通知の全結果が既存順で再現される。
    -   _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9_
    -   _Boundary: Recording finalization・RecordingHistoryPort・LifecyclePublisher_
    -   _Verification: unittest/spec, unittest/imp, integration, characterization_
    -   _Depends: 6.1_

-   [x] 6.3 録画開始後失敗の結果数上限と即時再準備をcharacterizationする

    -   録画開始後のstream／writer失敗で通常終了反映を試みた後、同じ予約の作成済み録画結果数を一回照会することを固定す
        る。
    -   0〜2件かつ終了前なら最新候補世代を即時準備対象へ戻し、3件以上ならsession factoryを呼ばず再試行上限eventを一回発
        行する。
    -   結果数照会reject、予約終了済み、予約削除・置換との競合では推測再試行せず、最新世代だけが準備を開始することを検証
        する。
    -   これは録画開始前のストリーム取得の再試行（5秒間隔、時刻指定は最大4回、番組指定は終了時刻まで）と別の既存制御であり、永続attempt ledger、追加backoff、retry上限変更を追加
        しない。
    -   完了時には、件数0〜3、終了境界、照会失敗、予約競合のfactory・event・候補回数が承認済み結果を再現する。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4_
    -   _Boundary: Recording failure retry coordinator・RecordingCandidateRegistry integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 1.7, 6.2_

-   [x] 7. 起動時の中断録画整理と候補再構築を段階化する
-   [x] 7.1 中断録画の項目単位整理をcharacterizationする

    -   録画中flagの結果一覧を取得し、各項目でflag解除、予約取得、一時file移動、各fileのsize更新、録画済み番組再取得を逐
        次実行する既存順を固定する。
    -   flag解除失敗、reserveIdなし、予約取得reject／nullでは同じ項目の残りを行わず次へ進み、移動・size失敗では記録して
        定めた同項目後続へ進む。
    -   再取得結果がある場合だけ`needsReservationRemoval = true`の完了eventを発行し、予約または再取得結果なしでは追加
        event・画面通知・Hookを作らない。
    -   前processの受信処理、未追跡process、tuner streamへ再接続せず、保存状態とfileだけを扱うことをport呼出回数で確認す
        る。
    -   完了時には、正常・項目別failure・orphan・fileなし・再取得nullの各fixtureが既存の項目結果を再現する。
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
    -   _Boundary: StartupRecordingReconciler characterization_
    -   _Verification: unittest/spec, unittest/imp, filesystem+DB integration_

-   [x] 7.3 起動時整理と候補再構築を独立 stage として実装する

    -   録画中結果一覧reject時に項目loop・候補再構築・schedulerを開始せず、整理stageを一回rejectする契約を、target
        testが検証する。項目loop完了後だけ保存予約一覧へ進み、通常・競合候補の再構築成功後だけ3秒schedulerを開始する。
        項目内最終再取得rejectと保存予約一覧rejectを空成功にせず、全stage failureで内部retry timer 0件、runtime
        failure一回とする。7.1の項目内fixtureは変わらない。
    -   録画中一覧と各項目を逐次整理し、stage rejectと項目内failureをDesignどおり分ける。整理成功後だけ保存予約一覧を
        一回取得し、終了済みを除く通常・競合を最新世代としてregistryへ再構築し、成功後だけ共有3秒wakeを開始する。
    -   failure時に空registry置換・scheduler開始・内部retryを行わず、前process復元、追加DB timeout、retry、ack、永続
        startup state、公開eventを追加しない。
    -   完了時には、失敗stage後の候補・timer・後続stage開始件数が各0件であることを観測できる。
    -   _Requirements: 7.6, 7.8, 7.9, 7.10, 7.11_
    -   _Boundary: RecordingExecutionFacade startup stages・RecordingCandidateRegistry_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 7.1_

-   [x] 7.4 起動時整理で取り消される予約を候補再構築で録画準備にかけない

    -   起動時整理が録画完了を通知した手動予約・番組リレー予約が、予約の取消より先に読んだ保存済み予約一覧に残る場合を、
        target test（`startup.spec.test.ts#RE-7.12`）が検証する。
    -   候補再構築がその予約を候補へ入れず、録画準備の開始と、後から届いた取消による録画準備の取消を通知しない。ルール
        予約（番組リレーを除く）と、起動時整理の対象でない開始時刻を過ぎた予約は候補へ入れる。
    -   完了時には、同じtarget testが成功し、7.1・7.3のfixtureも成功する。
    -   _Requirements: 7.12_
    -   _Boundary: RecordingExecutionFacade startup stages・RecordingCandidateRegistry_
    -   _Verification: unittest/spec_
    -   _Depends: 7.3_

-   [x] 8. 録画lifecycleとschedulerをdomain境界で統合検証する
-   [x] 8.1 録画lifecycle eventとconsumer handoffを契約検証する

    -   準備開始・取消・失敗、録画開始・失敗・完了、再試行上限、番組リレー候補の発行時点と既存entity payloadを
        `unittest/spec`で固定する。
    -   準備開始はattempt 0だけ、録画開始は最初のdataと二段登録後、起動時完了は `needsReservationRemoval = true`、候補な
        しではrelay eventなしとなることを確認する。
    -   listenerの同期例外と返却Promise rejectをpublisher境界で局所記録し、event配送、Hook、画面通知、跨域command順を本
        specへ実装しない。
    -   完了時には、各lifecycle fixtureのevent種類、順序、payload、回数が承認済み契約と一致する。
    -   _Requirements: 3.9, 4.3, 4.5, 4.6, 5.6, 6.4, 7.6_
    -   _Boundary: RecordingLifecyclePublisher・domain consumer ports_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 5.5, 6.3, 7.3_

-   [x] 8.2 保存予約から録画完了までのprocess integrationを検証する

    -   synthetic保存予約、番組・放送局、共通fake tuner stream、一時filesystem、SQLite/MySQL共通repository adapterを接続
        し、候補登録から準備、内部Recording化、no-clobber writer、最初のdata、二段登録、終了反映、完了通知まで通す。
    -   通常・競合priority、時刻指定開始・終了、番組指定上流終端、予約変更・取消、stream／writer error、有限retryを同じ
        test harnessで検証する。
    -   path選択・登録overdue、削除前terminal barrier、終了時部分失敗をfault injectionし、別sessionの録画と別domainが継
        続することを確認する。
    -   productionのMirakurun／mirakc、実録画data、実番組名、実保存path、外部registryを使用しない。
    -   完了時には、正常・取消・失敗・retry・overdueの全scenarioが一意な結果へ終端し、未処理rejectionと残留test資源が0件
        になる。
    -   _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7,
        3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10,
        5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2_
    -   _Boundary: Recording execution process integration_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration_
    -   _Depends: 1.9, 2.5, 3.5, 3.6, 4.5, 5.5, 6.3, 8.1_

-   [x] 8.3 schedulerの大量予約、時計変化、および長時間進行を検証する

    -   遠未来予約を大量登録し、候補数は増えてもscheduler所有timer handleが一件以下、予約ごとの長時間timerが0件であるこ
        とをfake clockで確認する。
    -   mutation burst、3秒を超える評価、同時deadline、時計前進・後退、event-loop遅延を与え、並行評価を作らず最新時刻か
        ら期限到来を回収する。
    -   24時間fake-clockを進め、完了・取消・置換後の候補、時刻指定milestone、controller callback、session retry timerが
        残らず、active stream本文は一般deadlineで切断されないことを確認する。
    -   完了時には、負荷scenarioごとの準備・終了dispatch回数が期待値と一致し、timer handle、未処理callback、unhandled
        rejectionの残留が0件になる。
    -   _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 2.6, 2.8, 4.10_
    -   _Boundary: RecordingScheduleController load/soak verification_
    -   _Verification: unittest/spec, unittest/imp, load/soak test_
    -   _Depends: 1.9, 2.3_

-   [x] 8.4 domain suiteを共有server test matrixへ統合する

    -   candidate、scheduler、mutation、session、path coordinator、finalization、retry、tuner contract、起動時整理、
        process integration、load、characterization、録画利用snapshot/gateの各suiteをdomain固有testとして共有runnerへ登
        録する。
    -   70受入条件の`unittest/spec`と実装分岐の`unittest/imp`を対応付け、仕様contractと既知source特性を別suiteとして列挙
        可能にする。
    -   fake timer、stream、filesystem、SQLite/MySQL adapterを使うdomain suiteを共有runnerから決定的に起動できるように
        し、本specからrunner、test root、V8、Node.js matrixを再定義しない。
    -   録画実行層から製品固有tuner client・型へのimport、実URL・実path・認証情報を含むfixture、およびdomain外taskの重複
        が0件であることをレビューで確認する。
    -   完了時には、71機能ACが少なくとも一つの実行testへ対応し、共有commandから全domain suiteを欠落なく起動
        できる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3,
        3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7,
        4.8, 4.9, 4.10, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6,
        7.7, 7.8, 7.9, 7.10, 7.11, 8.1, 8.2_
    -   _Boundary: Recording execution domain test suite integration_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.8, 8.2, 8.3_

-   [x] 9. 機能固有の品質を閉じる
-   [x] 9.2 実装特性caseを独立監査する

    -   `IMP-CHAR-RE-9.2`としてscheduler、session、path、finalization、startup、既存不整合characterizationを、仕様testと
        分離した具体的な`unittest/imp` caseへ対応付ける。
    -   値域、状態、3秒周期、5秒・60秒・600秒境界、時計変化、race、token、timer、stream、writer、file、lock、DB、dropの
        分岐と解放assertionを、Design 11.5の対象へ一意に割り当てる。
    -   完了時には、実装特性と既知不整合が仕様contractへ混在せず、Designが列挙する値域・分岐・race・資源解放の未割当case
        が0件になる。
    -   _Requirements: 9.2_
    -   _Boundary: IMP-CHAR-RE-9.2 recording implementation characteristics_
    -   _Depends: 8.4_

-   [x] 9.4 録画情報DB境界のintegration caseを実装する

    -   `INT-CASES-RE-9.4`のDB部分として、保存予約・番組・録画済み番組・file行・drop・履歴のread/write、対象なし、二段登
        録、終了時再取得、起動時整理をtemporary SQLite/MySQL adapterへ接続する。
    -   query/insert/update reject、部分row、600秒registration overdue、後着settlement、取消・置換・削除intentをfault
        injectionし、exact sessionの通常結果またはcleanupへ一回だけ収束することを検証する。
    -   完了時には全DB scenarioが有限に終端し、二重row、誤session反映、未解放DB handle、未処理rejectionが各0件になる。
    -   _Requirements: 9.4_
    -   _Boundary: INT-CASES-RE-9.4 recording DB integration_
    -   _Depends: 9.2_

-   [x] 9.5 録画fileのfilesystem境界をintegration検証する

    -   `INT-CASES-RE-9.4`のfilesystem部分として、排他的file確保、writer、first-data、部分file、rename/copy/unlink、
        size、planned-delete terminalをtemporary filesystemへ接続する。
    -   EEXIST、permission、write、move、rollback、5秒first-data、60秒利用者削除barrier、600秒path overdueをfault
        injectionし、exact handle/fileだけを一回整理することを検証する。
    -   容量不足削除では録画session、stream、writer、dropを停止せず、fake consumerの削除効果を本specで実装しない。
    -   完了時には全filesystem scenario後の未解放handle、部分file、別session file変更、容量不足削除起因の停止が各0件にな
        る。
    -   _Requirements: 9.4_
    -   _Boundary: INT-CASES-RE-9.4 recording filesystem integration_
    -   _Depends: 9.4_

-   [x] 9.6 予約差分と録画状態通知のIPC・event境界をintegration検証する

    -   `INT-CASES-RE-9.4`のIPC/event部分として、`resetTimer`互換入口、insert/update/delete差分、準備・開始・失敗・完
        了・relay通知を既存carrier fixtureへ接続する。
    -   serialization/handler/listener failure、detached受付後の内部failure、同一event-loop burst、重複・後着通知を与
        え、latest generationだけが一回作用することを検証する。
    -   HTTP route、request、responseとevent配送先の業務順序は各ownerへ残し、本specにcarrier schemaを追加しない。
    -   完了時には全IPC/event scenarioが終端し、未解放listener、誤相関、二重dispatch、未処理rejectionが各0件になる。
    -   _Requirements: 9.4_
    -   _Boundary: INT-CASES-RE-9.4 recording IPC and event integration_
    -   _Depends: 9.5_

-   [x] 9.7 共通tuner stream境界をintegration検証する

    -   `INT-CASES-RE-9.4`のtuner部分として、番組・serviceの共通stream handle、通常・競合priority、同一channel共有、取得
        失敗、first-dataなし、end/close/errorをsynthetic adapterへ接続する。
    -   予約取消・置換・retry・時刻指定終了とのraceで、stream/listener/closeとsession tokenが一回だけ終端し、製品固有
        Mirakurun／mirakc client・型へ直接依存しないことを検証する。
    -   child process監督はmedia-process/runtime owner、HTTP carrierはservice-interface ownerとして理由付き非適用を保持
        する。
    -   完了時には全tuner scenario後のopen stream、listener、retry timer、二重close、実環境値を含むfixtureが各0件にな
        る。
    -   _Requirements: 9.4_
    -   _Boundary: INT-CASES-RE-9.4 recording tuner stream integration_
    -   _Depends: 9.6_

-   [x] 9.9 本機能の品質判定を満たす

    -   Task 9.2から9.7の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 9.2, 9.4, 9.5, 9.6, 9.7_
    -   _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

## R2 内部契約・検証条件

本節は action 可能な task / leaf を増やさない。既存 task の完了状態と依存関係を変更しない。新しい checkbox、番号付き
task ID、source の class 分割、private call 順、公開 API / IPC / DB schema / 設定 wire / hook の変更を追加しない。

### 対象 locator

-   Design §3.2.1（候補 arm 内部信号、`RecordingCandidateRegistry` の generation / 候補 phase 所有、
    `RecordingScheduleController` の session token / 時刻指定終了 milestone 所有と registry に対する検証・遷移仲介、
    stale action の no-op）
-   Design §6.6 および §3.2.1 の時刻指定終了 generation ゲート
-   Design「通常録画終端の観測と active use 解放」および `RecordingRecordedUseGate`（writer / stream / drop /
    size-update continuation 終端後だけ active use を解放）
-   Design §7.2（再試行上限到達 lifecycle event）
-   Requirements 1.1–1.5, 1.7（対象選定と再評価）
-   Requirements 2.1–2.6（予約変更追従）
-   Requirements 5.1, 5.6（終了と結果反映）
-   Requirements 6.3, 6.4（再試行上限と関係機能への終了通知）

### 外部挙動の不変条件

-   候補 arm 結果は公開返却値ではない。Requirements 1 の対象選定結果を変えない。
-   generation / session token 不一致および終端 phase の無効 retry は no-op とし、新しい準備・終了・再試行を起こさない。
-   時刻指定終了は controller が generation ゲートした後に既存 finalization へ入る。新しい公開終了操作を追加しない。
-   通常終端後の active-use 解放は既存 Design 不変条件を維持する。容量不足削除の `busy` / `not-deleted` /
    final-delete eligibility の意味は変更しない。利用者削除の 60 秒 terminal barrier を置換しない。
-   再試行上限到達時は新試行を開始せず、関係機能へ録画終了を通知する（Requirements 6）。

### 検証と実装の許可範囲

-   既存契約に対する観測では、承認済み契約を oracle とする。
-   欠落が観測だけで閉じる場合は product code を変更しない。
-   product code の変更は、承認済み契約の欠陥を直す最小実装に限る。
-   coverage のためだけの product code 変更は禁止する。
-   準備中 update の timeout / failure は、Requirements 2 の成功系不変条件を oracle として continuation・state・timer/listener
    資源の終端を focused 観測し、新しい失敗製品契約や task ID / checkbox を追加せず、上記の契約欠陥時のみ実装・
    coverage のみの product 変更禁止を維持する。

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                   | Test type                                                          | Local Depends                            | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                              | `unittest/spec, unittest/imp, characterization`                    | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                                                  |
| 1.3  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                              | `unittest/spec, unittest/imp`                                      | `1.1`                                    | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                                                  |
| 1.5  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                              | `unittest/spec, unittest/imp, load test`                           | `1.3`                                    | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts`                                                                                                                                                                                                                                                                                                  |
| 1.7  | `test/server/recording-execution/scheduler.imp.test.ts`<br>`test/server/recording-execution/startup.imp.test.ts`<br>`test/server/recording-execution/mutation-acceptance-facade.integration.test.ts`                                                                                                                            | `unittest/imp, integration`                                       | `1.5`                                    | `npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts test/server/recording-execution/startup.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/mutation-acceptance-facade.integration.test.ts`                                                                                                                                                                                                                 |
| 1.9  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/scheduler.imp.test.ts`<br>`test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                           | `unittest/spec, unittest/imp, integration`                         | `1.7`                                    | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                            |
| 2.1  | `test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration`                         | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                     |
| 2.3  | `test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration`                         | `1.7, 2.1`                               | `npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                     |
| 2.5  | `test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration`                         | `2.3`                                    | `npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                     |
| 2.7  | `test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/recorded-use.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/recorded-use.imp.test.ts`                                                                                                                                          | `unittest/spec, unittest/imp`                                      | `2.5`                                    | `npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts test/server/recording-execution/recorded-use.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts test/server/recording-execution/recorded-use.imp.test.ts`                                                                                                                                                                        |
| 2.8  | `test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/recorded-use.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/recorded-use.imp.test.ts`<br>`test/server/recording-execution/ipc-event.integration.test.ts`<br>`test/server/recording-execution/recorded-use.integration.test.ts` | `unittest/spec, unittest/imp, integration`                         | `2.7`                                    | `npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts test/server/recording-execution/recorded-use.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts test/server/recording-execution/recorded-use.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts test/server/recording-execution/recorded-use.integration.test.ts` |
| 3.1  | `test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/characterization.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration`                         | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                     |
| 3.2  | `test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/stream-allocation-boundary.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts` | `unittest/spec, unittest/imp, integration, characterization`       | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/stream-allocation-boundary.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts` |
| 3.3  | `test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/reservation-changes.spec.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts` | `unittest/spec, integration` | `3.1`                                    | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:spec -- test/server/recording-execution/reservation-changes.spec.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts` |
| 3.5  | `test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/stream-allocation-boundary.test.ts`<br>`test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts` | `unittest/spec, unittest/imp, integration, static dependency test` | `3.2, 3.3`                               | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:spec -- test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/stream-allocation-boundary.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts` |
| 3.6  | `test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/drop-checker.imp.test.ts`<br>`test/server/recording-execution/drop-checker-attach-order.imp.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts` | `unittest/spec, unittest/imp, integration, characterization`       | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/drop-checker.imp.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/drop-checker-attach-order.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts` |
| 3.7 | `test/server/recording-execution/preparation.spec.test.ts` | `unittest/spec` | `2.3` | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts` |
| 4.1  | `test/server/recording-execution/recording-start.spec.test.ts`<br>`test/server/recording-execution/path.imp.test.ts`<br>`test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                                          | `unittest/spec, unittest/imp, integration`                         | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/recording-start.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/path.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                           |
| 4.3  | `test/server/recording-execution/recording-start.spec.test.ts`<br>`test/server/recording-execution/preparation.spec.test.ts`<br>`test/server/recording-execution/path.imp.test.ts`<br>`test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                                          | `unittest/spec, unittest/imp, filesystem integration`              | `4.1`                                    | `npm run test:server:spec -- test/server/recording-execution/recording-start.spec.test.ts`<br>`npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/path.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                           |
| 4.5  | `test/server/recording-execution/preparation.spec.test.ts#RE-3.17`<br>`test/server/recording-execution/path.imp.test.ts`<br>`test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                                          | `unittest/spec, unittest/imp, integration`                         | `4.3`                                    | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/path.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                           |
| 4.6  | `test/server/recording-execution/preparation.spec.test.ts#RE-3.19`<br>`test/server/recording-execution/sub-directory-util.imp.test.ts` | `unittest/spec, unittest/imp` | `4.3` | `npm run test:server:spec -- test/server/recording-execution/preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/sub-directory-util.imp.test.ts` |
| 5.1  | `test/server/recording-execution/finalization.spec.test.ts`<br>`test/server/recording-execution/finalization.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration, characterization`       | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/finalization.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/finalization.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                     |
| 5.3  | `test/server/recording-execution/finalization.spec.test.ts`<br>`test/server/recording-execution/finalization.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                    | `unittest/spec, unittest/imp, integration`                         | `5.1`                                    | `npm run test:server:spec -- test/server/recording-execution/finalization.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/finalization.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                     |
| 5.5  | `test/server/recording-execution/recording-start.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                                       | `unittest/spec, unittest/imp, integration`                         | `5.3`                                    | `npm run test:server:spec -- test/server/recording-execution/recording-start.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                        |
| 6.1  | `test/server/recording-execution/retry.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                                | `unittest/spec, unittest/imp, integration, characterization`       | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/retry.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                 |
| 6.2  | `test/server/recording-execution/retry.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                                | `unittest/spec, unittest/imp, integration, characterization`       | `6.1`                                    | `npm run test:server:spec -- test/server/recording-execution/retry.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                 |
| 6.3  | `test/server/recording-execution/retry.spec.test.ts`<br>`test/server/recording-execution/session.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                                | `unittest/spec, unittest/imp, integration`                         | `1.7, 6.2`                               | `npm run test:server:spec -- test/server/recording-execution/retry.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/session.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                 |
| 7.1  | `test/server/recording-execution/startup.spec.test.ts`<br>`test/server/recording-execution/startup.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                              | `unittest/spec, unittest/imp, filesystem+DB integration`           | `なし（共有foundationのみ）`             | `npm run test:server:spec -- test/server/recording-execution/startup.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/startup.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                               |
| 7.3  | `test/server/recording-execution/startup.spec.test.ts`<br>`test/server/recording-execution/startup.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`<br>`test/server/application-runtime/integration/startup-recording-handoff.integration.test.ts`                                                                                                                                              | `unittest/spec, unittest/imp, integration`                         | `7.1`                                    | `npm run test:server:spec -- test/server/recording-execution/startup.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/startup.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`<br>cross-spec executable evidence: `test/server/application-runtime/integration/startup-recording-handoff.integration.test.ts`                                                                                                                                   |
| 8.1  | `test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`test/server/recording-execution/characterization.test.ts`<br>`test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                                 | `unittest/spec, unittest/imp, integration`                         | `5.5, 6.3, 7.3`                          | `npm run test:server:spec -- test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                  |
| 8.2  | `test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`test/server/recording-execution/characterization.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                  | `unittest/spec, unittest/imp, SQLite/MySQL integration`            | `1.9, 2.5, 3.5, 3.6, 4.5, 5.5, 6.3, 8.1` | `npm run test:server:spec -- test/server/recording-execution/tuner-boundary.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                   |
| 8.3  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/scheduler.imp.test.ts`<br>`test/server/recording-execution/scheduler-load.integration.test.ts`                                                                                                                                                                                                      | `unittest/spec, unittest/imp, load/soak test`                      | `1.9, 2.3`                               | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/scheduler.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/scheduler-load.integration.test.ts`                                                                                                                                                                                       |
| 8.4  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/characterization.test.ts`<br>`test/server/recording-execution/domain-suite-matrix.imp.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                      | `unittest/spec, unittest/imp, integration`                         | `2.8, 8.2, 8.3`                          | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/domain-suite-matrix.imp.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                       |
| 9.2  | `test/server/recording-execution/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                        | `unittest/imp` | `8.4` | `npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                        |
| 9.4  | `test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                 | `integration` | `9.2` | `npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                         |
| 9.5  | `test/server/recording-execution/filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                  | `integration` | `9.4`                                    | `npm run test:server:integration -- test/server/recording-execution/filesystem.integration.test.ts` |
| 9.6  | `test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                   | `integration` | `9.5`                                    | `npm run test:server:integration -- test/server/recording-execution/ipc-event.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                           |
| 9.7  | `test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                                                                                                                                                                | `integration` | `9.6`                                    | `npm run test:server:integration -- test/server/recording-execution/tuner-stream.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                        |
| 9.9  | `test/server/recording-execution/candidates.spec.test.ts`<br>`test/server/recording-execution/characterization.test.ts`<br>`test/server/recording-execution/persistence.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `9.2, 9.4, 9.5, 9.6, 9.7` | `npm run test:server:spec -- test/server/recording-execution/candidates.spec.test.ts`<br>`npm run test:server:imp -- test/server/recording-execution/characterization.test.ts`<br>`npm run test:server:integration -- test/server/recording-execution/persistence.integration.test.ts` |
