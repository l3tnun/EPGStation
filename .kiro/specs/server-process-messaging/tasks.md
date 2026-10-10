# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation、`test/server` root、production `dist` import、固定 command、Vitest / V8、および
Node.js 24 必須・26 追加 matrix は `server-application-runtime` Requirement 9 が一度だけ所有する。該当 foundation task
group 完了後に本 spec を実行し、本 spec は process-messaging 固有の test、fixture、production source だけを追加する。

実行前に、`server-operational-logging` の通信異常記録 contract と、`server-encoding`、
`server-recorded-content`、`server-recording-execution`、`server-reservation-management`、
`server-reservation-rules`、`server-thumbnail-management` の各 domain port task groupが利用可能であることを確認する。本
spec はそれらの業務判断、状態、DB / filesystem 副作用を再実装しない。外部 spec の task ID は local `_Depends:` に記載し
ない。

本 spec は IPC request/reply envelope、同期識別子予約、`pending`・`retired`・内部resource用`leased`、allocation wait、
timeout / late reply、requester peer、current notification peer、service-child recorded-use lease / snapshot carrier、
upload adoption acknowledgment carrierを所有する。browser deliveryは`server-service-interface`、event / hook と
`EncodeCompletionSink` providerは`server-event-and-hook-delivery`、child spawn・restart・compositionは
`server-application-runtime`、recorded-useの業務判断はEncoding / Media Delivery / Runtime / Storage、upload一時fileの
exclusive作成・rename・unlinkはService Interface / Recorded Contentに残す。

識別子は`number`の1から`Number.MAX_SAFE_INTEGER`までとし、同期予約、最大値から1への直接wrap、`pending`・`retired`・
`leased`の使用中skip、全使用時の解放待ちで継続する。固定件数上限、文字列・`bigint` ID、採番枯渇による恒久停止、業務
handler取消、永続queue、自動retryを追加しない。通常期限は5,000ms、upload結果登録・video cleanup・drop-log cleanupは
600,000msとし、timeoutをhandler取消または業務失敗確定へ読み替えない。

-   [x] 1. 既存wire、operation、およびconsumer-owned portを固定する
-   [x] 1.1 既存operation envelope・dispatcher・replyをcharacterizationする

    -   production sourceを変更せず、承認済み契約と一致する既存wire、operation、
        dispatcher、replyだけを固定する。承認済みown-property拒否と異なるprototype member受入れは
        `implementation defect`の独立locatorへ隔離し、既存挙動を通常oracleへ昇格させない。
    -   `src/model/ipc/IPCMessageDefine.ts`、`IIPCClient.ts`、`IPCClient.ts`、`IPCServer.ts`を入口に、R1の全operationを
        `SPEC-OPS`へ表駆動で追加し、数値ID、exact model / func / args、domain port一回呼出し、戻り値なしを含む成功、同一
        IDのerror messageを固定する。
    -   `SPEC-CORR`と`SPEC-VALID`へout-of-order完了、通常objectのown-propertyにないtarget / operation、missing /
        `undefined` argsを追加する。prototype memberのcaseは独立locatorに置く。
        missingではhandler 0回と`IPCArgsError`を確認し、`null`は存在する値としてhandlerへ渡す。型・値域・余剰fieldの共通
        schemaと重複排除を追加しない。
    -   予約可否、削除可否、保護可否、encode結果の意味、完了順をPMが判断しないこと、handler tableにない`clean`を追加しな
        いことをnegative assertionで固定する。
    -   完了時にはR1、R2.2からR2.4・R2.6、R3.2・R3.3の既存契約がproduction差分なしで成功し、operation、handler、replyの
        call ledgerが一意になる。本leafは一致部分のcharacterizationとprototype差分の隔離を扱い、R3.1の充足と
        production修正はTask 4.1だけが所有する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.2, 2.3, 2.4, 2.6, 3.2, 3.3_
    -   _Boundary: Message Contract・Domain Request Facade・Parent Operation Dispatcher characterization_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 1.2 二種類の一方向通知wireとfailure差分をcharacterizationする

    -   production sourceを変更せず、承認済み契約と一致する通知payload、ackなし、request
        IDなし、response timerなしだけを固定する。failure surfaceの承認済み契約と異なる挙動は`implementation defect`の独立locatorへ隔離
        し、既存挙動を通常oracleへ昇格させない。
    -   `notifyClient`と`pushEncode`が追加ack、request ID、response timerを持たずcurrent childへ一回送られることを
        `SPEC-NOTIFY`で固定する。
    -   recipientなし、同期throw、非同期callback failureの結果を承認済み結果と混ぜず独立locatorで再現する。保存、retry、別child転送のstateがないことはcall ledgerのassertionで確認する。
    -   Socket.IO/browser配送とencode受付判断をfixtureへ取り込まず、PMは既存wireとcarrier deliveryだけを検証する。
    -   完了時には登録済みfixtureでexact payload、send attempt 1、response listener / timer 0、再送state 0が観測でき、
        production差分がない。本leafは一致部分のcharacterizationとfailure差分の隔離を扱い、承認済みfailure契約の
        充足とproduction修正はTask 4.2だけが所有する。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4_
    -   _Boundary: Reverse Notification Sender characterization_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 1.3 `EncodeCompletionSink` consumer-owned portへ依存させる

    -   PM sourceからevent所有interfaceへの静的reverse importがなく、`encodeEvent.emitFinishEncode(info)`がPM所有
        consumer portへ届くことをtarget testが検証する。
    -   `src/model/ipc/IEncodeCompletionSink.ts`へpayload、sink、registration portを最小定義し、Dispatcherを登録済みsink
        へ接続する。provider implementation、event発火条件、Workflow setup、Runtime bindingを本taskへ取り込まない。
    -   完了時にはtarget testが成功し、exact info一回配送、provider未登録時の診断、PM→event source import 0、既存
        operation名・ envelope不変を確認する。
    -   _Requirements: 1.7_
    -   _Boundary: PM-owned EncodeCompletionSink・registration port_
    -   _Depends: 1.1_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 2. 数値識別子とrequest correlation lifecycleを実現する
-   [x] 2.1 同期allocator、直接wrap、および使用中skipを同一leafのtestと実装で閉じる

    -   `IMP-CHAR-PM-7.2`のID caseが、初期1、連続増加、production `Number.MAX_SAFE_INTEGER`、最大分岐
        で`successor`呼出し0、直接1へwrap、同一同期区間の重複予約0を検証する。
    -   `IPCClient.ts`へtest-onlyの小さい正の安全整数maxとcall-ledger付きsuccessorを注入できる内部seamを設け、
        `pending`・`retired`・`leased`のどれにもない候補を送信・非同期境界前に同期予約する最小allocatorを実装する。
    -   wrap後は1から小さい順に三状態をskipし、文字列・`bigint`、乱数・時刻ID、永続counter、通常解放ごとの最小値再探索を
        追加しない。
    -   完了時にはtarget testが成功し、0、負数、最大超過、非安全整数、不正型を送信用IDに採用せず、全送信IDが1以上
        production最大以下の`number`であることを確認する。
    -   _Requirements: 2.1, 2.7, 2.8, 2.9, 2.10, 2.16_
    -   _Boundary: Request Correlator identifier allocator_
    -   _Depends: 1.1_
    -   _Verification: unittest/spec, unittest/imp, property/table-driven test_

-   [x] 2.2 `pending`・`retired`・`leased`と全使用時waitを同一leafのtestと実装で閉じる

    -   fake timerとdeferred replyで成功、error、送信前失敗、同期send throw、timeout、late reply、unknown / duplicate
        response、response-timeout同着について、一件settlement、timer / listener cleanup、`pending→retired→unused`
        をtarget testが検証する。
    -   全IDを`pending`・`retired`・`leased`で占有した縮小max fixtureで、新依頼がIDなしFIFO waiterとなりsend 0、成
        功・error・同期失敗・late reply・exact lease releaseの安全な解放後だけ一回再開することをtarget testが検証する。
    -   一件ごとのresolve / reject、timer、reply listenerを`pending Map`に保持し、timeoutは依頼元だけをrejectして
        `retired`へ移し、late payloadは採用せず解放する最小state machineとFIFO allocation waitを実装する。
    -   `leased`はexact release terminalまでallocatorから除外し、複数waiterが同じIDを予約しない。採番待ち専用deadline、
        固定待機件数、優先度、retry、batch、恒久拒否を追加しない。
    -   完了時にはtarget testが成功し、重複send、二重settlement、残留timer / listener、早期ID再利用、恒久停止が各
        0件であることを確認する。
    -   _Requirements: 2.5, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 4.5, 4.6, 4.7_
    -   _Boundary: Request Correlator pending・retired・leased・allocation wait lifecycle_
    -   _Depends: 2.1_
    -   _Verification: unittest/spec, unittest/imp, fake-timer race, bounded-range concurrency_

-   [x] 2.3 全domain facadeと5秒・三種類の10分期限を同一leafのtestと実装で閉じる

    -   send前同期予約、message作成前failure、`process.send`不存在、send同期throwに加え、`process.send`呼出しが同期的に
        成功した後でcallbackが`Error`を返すcaseを同じtarget testが含む。callback時点では記録一回、`pending`・同
        じtimer保持、ID解放0、allocation waiter再開0をtarget testが検証する。
    -   4,999 / 5,000 / 5,001msと599,999 / 600,000 / 600,001msをfake timerで検証し、通常とuploadの値をcharacterization、
        video cleanupとdrop-log cleanupの期限が600,000msであることを検証する。
    -   全domain facadeを共通correlatorへ接続し、通常5,000ms、upload結果登録・video cleanup・drop-log cleanup各600,000ms
        とsend callback errorの記録だけを最小実装する。同期送信成立後のcallback errorでは同じ`pending`とtimerを変更せ
        ず、Promise settlement、ID解放、waiter再開を行わない。timerはID予約・送信開始時だけ開始し、allocation wait時間を
        算入しない。
    -   完了時にはtarget testが成功する。callback error後にresponseが来るcaseは一回だけsettle・timer解除・ID解放
        し、waiterを最大一回再開する。timeoutが来るcaseは一回だけrejectして`pending→retired`とし、その時点のID解放と
        waiter再開は0、late reply後だけ一回解放・再開する。同期失敗の即時reject・ID解放、handler cancel / abort 0、他
        pendingへの影響0も確認する。
    -   このcallback error assertionは`IMP-CHAR-PM-7.2`のlocatorとして、
        `test/server/process-messaging/imp/correlation-lifecycle.test.ts#records-callback-error-but-keeps-the-same-pending-request-timer-and-allocation-waiter`と
        `test/server/process-messaging/imp/correlation-lifecycle.test.ts#keeps-callback-failed-id-retired-until-a-late-reply-after-timeout`の再現可能なtransport doubleで検証する。actual
        childのcontrolled disconnect scenarioはTask 5.1で独立に検証し、それぞれの成功locatorは品質判定（Task 6.5）で確認する。
    -   _Requirements: 2.1, 2.11, 2.12, 2.13, 2.14, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
    -   _Boundary: Domain Request Facade・Request Correlator・Child Process Transport_
    -   _Depends: 2.2_
    -   _Verification: unittest/spec, unittest/imp, fake-timer boundary, transport integration_

-   [x] 3. 内部resource carrierを実現する
-   [x] 3.1 recorded-use lease / snapshot carrierを同一leafのtestと実装で閉じる

    -   service generationとacquire request IDの組、5秒直前・到達・超過、granted / blocked / unknown、late granted、
        double / stale release、peer replacementをtarget testへ追加する。
    -   current-generation snapshotのknown ID配列透過、child不在、generation不一致、provider unknown、send failure、
        timeout、correlation不一致、late replyを定義し、失敗時は部分集合・空集合・前回値でなく`unknown`にする。
    -   PM内部契約とclient / parent registryを最小実装し、granted IDを`leased`へ移し、exact release terminalだけで解放す
        る。late grantedは利用開始へ返さず同じidentityのbest-effort releaseを一回送り、release未確認を未使用へ推測しな
        い。
    -   snapshotは現在generationへ一回送り、通常5秒、request固有reply、timer / listener cleanupを共通correlatorで扱う。
        Set・token・object参照をwireへ載せず、公開operation、設定、DB schema、自動retry、永続snapshotを追加しない。
    -   完了時にはtarget testが成功し、別generation lease解放、早期ID再利用、late利用開始、部分snapshot、残留
        timer / listenerが各0件になる。consumer port、snapshot provider、削除gateの業務判断とRuntime compositionは実装し
        ない。
    -   _Requirements: 2.10, 4.5, 4.6, 4.7_
    -   _Boundary: PM internal recorded-use lease / snapshot carrier_
    -   _Depends: 2.3_
    -   _Verification: unittest/spec supporting contract, unittest/imp, fake-timer race_

-   [x] 3.2 upload adoption acknowledgment carrierを同一leafのtestと実装で閉じる

    -   既存`recorded.addUploadedVideoFile` operation、10分期限、filePath carrierへ、send前失敗、deliveryなし、rename先
        着、unlink先着、ack loss、reply loss、child replacementのcall ledgerを追加する。
    -   PMが運ぶ内部adoption acknowledgmentとrequest/reply correlationを最小実装し、ackをownership commit pointにせ
        ず、parent filesystem ownerのraw atomic rename成功後だけ一回返すcarrierとする。
    -   incoming exclusive作成・child cleanupはService Interface、unique grammar・adopted exclusive作成・rename・domain
        call・parent cleanupはRecorded Contentに残し、PMはfileをread / rename / unlinkせずadapter結果を透過配送する。
    -   完了時にはtarget testが成功し、domain callはrename成功後だけ一回、ownerは常に一つ、10分timeout後handler
        cancel 0、late reply誤配信0、request/reply timer・listenerの二重解放0を確認する。
    -   永続adoption journal、新しい公開operation、設定、retry、ack lossによるownership rollbackを追加しない。
    -   _Requirements: 1.3, 4.2, 4.5, 4.6, 4.7_
    -   _Boundary: PM internal upload adoption acknowledgment carrier_
    -   _Depends: 1.1, 2.3_
    -   _Verification: unittest/spec supporting contract, unittest/imp, owner call ledger_

-   [x] 4. requester peerとcurrent notification peerを安全にする
-   [x] 4.1 requester-scoped replyとidentity-fenced current registryを同一leafのtestと実装で閉じる

    -   Task 1.1が隔離したprototype member target / operationを実`IPCServer`へ入力したとき、handler 0回、同じIDの
        `IPCFunctionError`となる承認済み結果をtarget testが検証する。固定表のtargetとoperationをそれぞれown-propertyで判定する最
        小修正を行い、型・値域・余剰fieldの共通schemaを追加しない。
    -   同じ数値IDを使う二child、out-of-order handler、処理中replacement、requester切断について、可変current childへ
        の誤replyがないことをtarget testが検証する。
    -   spawn直後登録、新旧child、`exit`・`error`・`disconnect`・`close`、terminalとreplacement同着を表駆動で検証し、旧
        eventが新currentを消さずlistenerも残留しないことをtarget testが固定する。
    -   request受付callbackのsender objectをclosureへcaptureし、成功・errorを同じIDでrequesterへだけ送る。未接続、同期
        throw、非同期callback failureは記録・破棄し、別childへ転送しない。
    -   最後に登録したobjectだけをcurrent peerとし、登録ごとに四terminal listenerを一組付け、identity一致terminalまたは
        replacementでRegistry所有listenerと参照を一回解放する。request-local targetはhandler settlementまで独立保持す
        る。
    -   完了時にはtarget testが成功し、prototype handler呼出し、新childへの旧reply、旧eventによる新current無効
        化、別request settlement、残留Registry listenerが各0件になる。
    -   _Requirements: 2.2, 2.3, 2.4, 3.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
    -   _Boundary: Parent Operation Dispatcher・Reply Sender・Communication Peer Registry_
    -   _Depends: 1.1_
    -   _Verification: unittest/spec, unittest/imp, deferred concurrency, table-driven terminal race_

-   [x] 4.2 通知failure cross-productを同一leafのtestと実装で閉じる

    -   Task 1.2が隔離したlocatorを再利用し、`notifyClient` / `pushEncode` × recipientなし / 同期throw / 非同期callback
        failureについてDesign 10.3のcaller result、記録、破棄、cleanupをtarget testが検証する。
    -   current peerへexact payloadを一回送る最小failure adapterを実装し、`notifyClient`の三failureは記録・破棄、
        `pushEncode`のrecipientなし・同期throwはcaller-facing failure、非同期failureは記録・破棄へ収束させる。
    -   完了時にはtarget testが成功し、response timer / listener、保存、retry、別child forwarding、browser
        deliveryが各0、send callbackと参照が最大一回解放されることを確認する。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4_
    -   _Boundary: Communication Peer Registry・Reverse Notification Sender_
    -   _Depends: 1.2, 4.1_
    -   _Verification: unittest/spec, unittest/imp, notification failure cross-product_

-   [x] 5. child IPC境界と44機能ACの回帰を閉じる
-   [x] 5.1 request/reply・deadline・peer・notificationをisolated childで結合検証する

    -   5.1固有のtarget integration caseは、production `dist` moduleを実processへ接続するcompiled child
        harnessで実行する。複数requestの逆順応答、成功・error、5秒・10分直前/到達/
        超過・同着、late reply、同一IDの別child、requester切断、再登録、四terminal eventを対象にする。
    -   production `dist`をimportし実際のchild IPC channelを使うtest-onlyの最小production-equivalent shared harnessを実
        装し、同じtarget integration caseをこのharnessで実行する。transport、correlator、dispatcher、peer registryのproduction
        logicをfixtureへ複製せず、spawn / restart判断とscenario開始・終了だけをharnessから注入する。
    -   同期send受理後に実channelのcontrolled disconnectが起きるcaseではcallback errorを必須にしない。再送0、別child
        への転送0、誤配送0、responseまたはtimeoutによる適切な一回終端、およびtimer・listener・childのcleanupを確認す
        る。callback errorの契約はTask 2.3の再現可能なtransport double targetで別途検証する。
    -   child再起動後は初期候補1、空の`pending`・`retired`・`leased`・wait queueから始め、旧request、timer、listener、
        notification、snapshotを復元・自動再送しない。PMへchild監督を追加しない。
    -   current notification peerとrequester reply peerが同時に異なるscenarioを検証し、旧request結果は旧peerだけ、新通知
        はcurrentだけ、切断済みreplyは記録・破棄となることを確認する。
    -   完了時には同じtargetがdeterministicに成功し、誤settlement、誤peer send、handler cancel、残留child・pipe・
        timer・listener・peer参照が各0件になる。production差分はTasks 1.3から4.2の前段owner leafで完了済みとし、このleaf
        では0件にする。
    -   _Requirements: 2.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
    -   _Boundary: Request Correlator・Dispatcher・Peer Registry child-process integration_
    -   _Depends: 2.3, 4.1, 4.2_
    -   _Verification: compiled child-process integration, fake clock, operational-log spy_

-   [x] 5.2 recorded-useとupload adoptionのsupporting carrierをchild IPCで結合検証する

    -   5.2固有のtarget integration caseは、lease acquire / release、snapshot、upload adoption ack、期限超過、
        late reply、disconnect、再登録、generation replacementをcompiled child接続で検証する。
    -   Task 5.1のshared production-equivalent compiled child harnessを再利用し、carrier message driverとfake owner
        adapterだけを最小追加して同じtarget integration caseを実行する。別harness、別spawn / teardown、transport・
        correlationの複製実装を追加しない。
    -   old generationのpending snapshot、opaque token、release closure、adoption ackを復元・再利用せず、current
        snapshotだけを採用し、stale releaseとack lossで別leaseまたはfile ownerを変更しない。
    -   known ID配列とadoption owner結果だけをserializable payloadで運び、consumer/provider binding、候補query、最終削除
        gate、filesystem mutation、HTTP lifecycle、child監督をtest doubleの外へ持ち込まない。
    -   完了時には同じtargetが成功し、誤generation reply、別lease解放、部分snapshot、ownership二重化、残留timer /
        listener / child参照が各0件になる。supporting caseはR1-R6のcanonical 44主case数へ加算せず、production差分はTasks
        3.1・3.2で完了済みとしてこのleafでは0件にする。
    -   _Requirements: 6.1_
    -   _Boundary: PM supporting carrier child-process integration_
    -   _Depends: 3.1, 3.2, 4.1_
    -   _Verification: compiled child-process integration, fake owner adapters_

-   [x] 5.3 R1からR6の44機能ACだけをcanonical回帰matrixで閉じる

    -   `SPEC-OPS`、`SPEC-CORR`、`SPEC-VALID`、`SPEC-DEADLINE`、`SPEC-NOTIFY`、`SPEC-PEER`を再実行し、R1からR6の44 ACへ
        `PM-1.1`から`PM-6.6`の主caseを一対一で対応させる。
    -   各主caseでoperation / args / result / error、ID状態、deadline、requester / current peer、send count、timer /
        listener / Promise / child参照のterminal結果をassertし、supporting carrier caseとR7 evidenceを44主caseへ吸収しな
        い。
    -   固定件数上限、文字列・`bigint` ID、共通業務schema、handler取消、retry、永続message、browser delivery、child
        lifecycle、event hookの追加が0件であることをnegative contractで固定する。
    -   完了時には44/44機能ACが成功したcanonical locatorへ追跡でき、欠落・重複主case・残留resourceが各0件になる。後段でproduction差分が生じた場合は
        この44/44のtestを再実行する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11,
        2.12, 2.13, 2.14, 2.15, 2.16, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2,
        6.3, 6.4, 6.5, 6.6_
    -   _Boundary: Process-messaging functional acceptance matrix_
    -   _Depends: 1.3, 5.1, 5.2_
    -   _Verification: unittest/spec, unittest/imp, compiled child-process integration_

-   [x] 6. 機能固有testの品質判定を満たす
-   [x] 6.5 本機能の品質判定を満たす

    -   Task 5.1から5.3の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designの44主case（PM-7.1）、`IMP-CHAR-PM-7.2`のconcrete imp case（anchor 10件）、49行のFeature Test Matrix（PM-7.3）、および
        Task 5.1・5.2のcompiled child integration（`INT-BOUNDARY-PM-7.4`）を、requirements.mdのACと突き合わせてレビューし、
        欠落・重複・空欄が0件であることを確かめる。これらを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 5.3_
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                    | Test type                                                                       | Local Depends                | Verification command                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | `test/server/process-messaging/operation-routing.spec.test.ts`<br>`test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                      | `unittest/spec, unittest/imp`                                                   | `なし（共有foundationのみ）` | `npm run test:server:spec -- test/server/process-messaging/operation-routing.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                                                         |
| 1.2  | `test/server/process-messaging/notifications.spec.test.ts`<br>`test/server/process-messaging/imp/notification-cleanup.test.ts`                                                                                     | `unittest/spec, unittest/imp`                                                   | `なし（共有foundationのみ）` | `npm run test:server:spec -- test/server/process-messaging/notifications.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/notification-cleanup.test.ts`                                                                                                                        |
| 1.3  | `test/server/process-messaging/operation-routing.spec.test.ts`<br>`src/model/ipc/IEncodeCompletionSink.ts` | `unittest/spec, unittest/imp` | `1.1`                        | `npm run test:server:spec -- test/server/process-messaging/operation-routing.spec.test.ts` |
| 2.1  | `test/server/process-messaging/correlation.spec.test.ts`<br>`test/server/process-messaging/imp/id-allocation.test.ts`                                                                                              | `unittest/spec, unittest/imp, property/table-driven test`                       | `1.1`                        | `npm run test:server:spec -- test/server/process-messaging/correlation.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/id-allocation.test.ts`                                                                                                                                 |
| 2.2  | `test/server/process-messaging/correlation.spec.test.ts`<br>`test/server/process-messaging/imp/correlation-lifecycle.test.ts`                                                                                      | `unittest/spec, unittest/imp, fake-timer race, bounded-range concurrency`       | `2.1`                        | `npm run test:server:spec -- test/server/process-messaging/correlation.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/correlation-lifecycle.test.ts`                                                                                                                         |
| 2.3  | `test/server/process-messaging/deadlines.spec.test.ts`<br>`test/server/process-messaging/imp/correlation-lifecycle.test.ts`                                                                                     | `unittest/spec, unittest/imp, fake-timer transport callback error`              | `2.2`                        | `npm run test:server:spec -- test/server/process-messaging/deadlines.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/correlation-lifecycle.test.ts`                                                                                                                               |
| 3.1  | `test/server/process-messaging/operation-routing.spec.test.ts`<br>`test/server/process-messaging/imp/deadline-races.test.ts`                                                                                       | `unittest/spec supporting contract, unittest/imp, fake-timer race`              | `2.3`                        | `npm run test:server:spec -- test/server/process-messaging/operation-routing.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/deadline-races.test.ts`                                                                                                                          |
| 3.2  | `test/server/process-messaging/operation-routing.spec.test.ts`<br>`test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                      | `unittest/spec supporting contract, unittest/imp, owner call ledger`            | `1.1, 2.3`                   | `npm run test:server:spec -- test/server/process-messaging/operation-routing.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                                                         |
| 4.1  | `test/server/process-messaging/peer-registry.spec.test.ts`<br>`test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                          | `unittest/spec, unittest/imp, deferred concurrency, table-driven terminal race` | `1.1`                        | `npm run test:server:spec -- test/server/process-messaging/peer-registry.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/dispatcher-peer.test.ts`                                                                                                                             |
| 4.2  | `test/server/process-messaging/notifications.spec.test.ts`<br>`test/server/process-messaging/imp/notification-cleanup.test.ts`                                                                                     | `unittest/spec, unittest/imp, notification failure cross-product`               | `1.2, 4.1`                   | `npm run test:server:spec -- test/server/process-messaging/notifications.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/notification-cleanup.test.ts`                                                                                                                        |
| 5.1  | `test/server/process-messaging/integration/process-messaging.integration.test.ts`                                                                                                                                  | `compiled child-process integration, fake clock, operational-log spy`           | `2.3, 4.1, 4.2`              | `npm run test:server:integration -- test/server/process-messaging/integration/process-messaging.integration.test.ts`                                                                                                                                                                                         |
| 5.2  | `test/server/process-messaging/integration/process-messaging.integration.test.ts`                                                                                                                                  | `compiled child-process integration, fake owner adapters`                       | `3.1, 3.2, 4.1`              | `npm run test:server:integration -- test/server/process-messaging/integration/process-messaging.integration.test.ts`                                                                                                                                                                                         |
| 5.3  | `test/server/process-messaging/operation-routing.spec.test.ts`<br>`test/server/process-messaging/imp/dispatcher-peer.test.ts`<br>`test/server/process-messaging/integration/process-messaging.integration.test.ts` | `unittest/spec, unittest/imp, compiled child-process integration`               | `1.3, 5.1, 5.2`              | `npm run test:server:spec -- test/server/process-messaging/operation-routing.spec.test.ts`<br>`npm run test:server:imp -- test/server/process-messaging/imp/dispatcher-peer.test.ts`<br>`npm run test:server:integration -- test/server/process-messaging/integration/process-messaging.integration.test.ts` |
| 6.5  | `test/server/process-messaging/imp/correlation-lifecycle.test.ts`<br>`test/server/process-messaging/integration/process-messaging.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `5.3` | `npm run test:server:imp -- test/server/process-messaging/imp/correlation-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/process-messaging/integration/process-messaging.integration.test.ts` |
