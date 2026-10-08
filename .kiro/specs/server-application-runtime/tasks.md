# Implementation Plan

---

## Execution split and ownership

本 spec の実装は四相に分ける。

1. **Foundation-first**: Major 1 の共有 server test foundation、固定 root command、および Node.js acceptance matrix だけ
   を、Tasks 承認後の全 server domain task より先に一度だけ実装する。
2. **Runtime-core-last**: Major 2〜7 と 8.1・8.2 の起動 sequence、composition、起動時整理、容量不足削除 binding、および
   child 監督は、roadmap Level 1〜11 の domain task と provider contract が完了した後に実装する。
3. **Post-runtime verification**: Workflow 8.1→8.2、Runtime 6.3→8.3のhandoffを順に完了する。その成功後、Major 9のRuntime固有の
   品質（9.3〜9.7）、coverageの計測の道具（9.8）、単体testだけのcoverage（9.9）、server全体の単体testだけでのC0・C1 100%（Major 12）を閉じる。公開用
   Docker imageの手元での確認（Major 10）と公開用workflow（Major 11）は、Runtimeの起動順の実装とは独立に実施できる。
4. **Test foundation revision**: coverageの除外の承認の結び付け直し（Major 13）と、合否をgitの状態から切り離す変更（Major 14）は、
   Major 12の完了後にtest基盤だけを変える。product code（`src/**`）は変更しない。

Major 1 の完了直後に Major 2 へ進んではならない。Major 1 完了後は roadmap Level 1〜11 を依存順に実装し、その間に各
domain suite を同じ共有 command へ追加する。Level 1〜11 完了後に runtime core、post-runtime consumer、最終 matrix の順で
進め、Major 1 の runner、test root、harness、coverage、または Node.js matrix を再作成しない。

本 spec は次の責任を一度だけ所有する。

-   `OWN-001`: `test/server` を唯一の server test root とする共有 Vitest foundation、固定 root command（6 本）、V8 coverage、
    coverage の計測の道具、Node.js 24 必須・Node.js 26 追加互換 matrix
-   `OWN-016`: 容量不足削除で recording/service-child exclusive-use gateと録画済み番組削除coreを接続し、利用者削除
    terminal barrierを呼ばないproduction adapterとcomposition binding
-   `OWN-032`: log・設定・実行主体の準備、外部依存待ち、operator、Service child、起動時三段階、EPG child の全体順とchild
    監督

各 domain の設定解釈、REST・DB transport、予約・録画・削除 algorithm、HTTP・Socket.IO、IPC wire、event payload、および
storage の候補選択は provider owner に残す。容量不足削除 adapter は provider operation を承認済み順序で接続するだけで、
候補、exclusive gate、terminal 判定、resource lock、exact-ID deletion、Encode・配信利用状態を再実装しない。

起動時のチューナーサーバー状態確認と DB 接続確認は、一回の試行にも復旧待ち全体にも EPGStation 独自 timeout を追加せず、
失敗後に1秒待って無期限に続ける。`server-management-tools` が所有する backup、restore、v1 migration の DB 利用待ちも従来
どおり無期限であり、runtime から共通 timeout、試行上限、取消、または別の待機 abstraction を重ねない。

起動時整理の各 stage に対する600秒は観測 deadline だけである。deadline 到達で underlying operation を cancel、失敗確定、
ownership 解放、または再実行せず、late success / failure を元の一回の operation の結果として一回だけ反映する。

Service と EPG の child 監督は承認済み terminal event をそのまま扱い、restart cap、backoff、stability window、子孫回収、
共通 shutdown / drain を追加しない。Web・API受付、起動時整理、EPG開始、最初のEPG更新を一つの global ready state へ統合し
ない。

-   [x] 1. 共有 server test foundation と Node.js acceptance matrix を先行実装する
-   [x] 1.1 唯一の server test root と compiled production import 規則を確立する

    -   `test/server` を唯一の server test root とし、Vitest で仕様、実装・characterization、結合 test を命名別に選択で
        きる初期構成を、先に失敗するtestから追加する。
    -   `package.json`と`package-lock.json`へ共有runnerのexactなVitest依存をbootstrapする。固定root script、V8
        coverage、harness、artifact設定は1.2以降の責務として追加しない。
    -   server production を compile した後、test が production と同じ `dist` 成果物を importし、test 用に別の
        production 実装を構築しない規則を固定する。
    -   source mapを保持し、後続のV8 coverageがserver TypeScriptへ対応付けられる状態にする。
    -   domain 固有 fixture、DB schema、HTTP payload、process scenarioを foundation へ持ち込まない。
    -   完了時には、spec・imp・integration の各層が同じ runner と test root から compiled module を読み、個別に選択して成功する。
    -   _Requirements: 1.2, 1.3_
    -   _Boundary: Shared Server Test Root・Compiled Test Loader_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.2 固定 root command と V8 coverage を共有 foundation へ追加する

    -   先に失敗するfoundation contract testで、`test/server/`、`vitest.server.config.ts`、共通harness、および
        `test/server/.gitignore`の`.artifacts/` ignoreが欠けている現状を固定してから最小設定を追加する。
    -   rootにexact script `test:server:build`、`test:server:spec`、`test:server:imp`、
        `test:server:integration`、`test:server`、`test:server:coverage`の6 commandを一度だけ追加する。
    -   全 server test、仕様 test、実装 test、結合 test、およびV8 coverageを個別または一括実行する固定 root commandを追
        加する。
    -   各 command が同じ test root、命名規則、compiled import規則を使い、suite 0件やtest failureを成功として扱わないこ
        とを contract testで固定する。
    -   V8 coverageをsource map経由でserver TypeScriptへ対応付け、generated test artifactやfixtureをproduction source
        coverageへ混在させない。
    -   本foundation leafのcoverage smokeでは、後続domain testが未実装の間も全`src/**/*.ts`とC0/C1 100% thresholdを緩め
        ず、test実行とreport生成の完了後にthreshold未達で非0終了することをfail-closedの成功条件とする。全production
        scopeのC0/C1 100%の判定は、Requirement 9 Acceptance Criterion 9に従いMajor 12が扱う。
    -   `test:server:build`はworkspace-local `dist/`を消去してserver TypeScriptだけをcompileするpure buildとする。通常
        testはruntime artifact snapshotをimportし、作業treeで事前生成した`dist/`を参照しない。
    -   coverageとruntimeの全成果物を`test/server/.artifacts/{coverage,runtime}`へ固定し、repository root、repository外
        directory、tracked reportへ出力しない。spec別runner、別test root、別coverage commandを作成しない。
    -   完了時にはfoundation contract testと同じtestがGREENになり、固定commandの選択結果と終了statusがfixture suiteの種
        類・成功・失敗へ一意に対応し、production/config差分を含むこのcheckbox内でRED→最小実装→GREENが閉じる。
    -   _Requirements: 9.1, 9.2_
    -   _Boundary: Shared Server Test Commands・V8 Coverage_
    -   _Verification: command contract test; coverage smokeはtest/report完了後の100% threshold未達による非0終了を
        全domain suite収束まで期待する_
    -   _Depends: 1.1_

-   [x] 1.3 (P) 時刻と非同期処理を制御する共通 harness を追加する

    -   synthetic entity、fake timer、deferred Promise、call ledgerを共通harnessとして追加し、domain testが実時刻、実
        DB、実networkへ不必要に依存せず順序とsettlementを観測できるようにする。
    -   clockの直前・到達・超過、Promiseのresolve・reject・pending、および同着結果をdeterministicに構成できるようにする。
    -   domain固有状態や共通業務retryをharnessへ実装しない。
    -   完了時には、後続domain testが同じclockとdeferred primitiveを再利用できる。
    -   _Requirements: 9.1, 9.2_
    -   _Boundary: Deterministic Async Test Harness_
    -   _Verification: 後続domain testの`unittest/imp`_
    -   _Depends: 1.1_

-   [x] 1.4 (P) compiled child process を決定的に観測する共通 harness を追加する

    -   compiled entrypointとchild supervisorをisolated child processで起動し、stdout、stderr、IPC、signal、exit、
        process error、未処理非同期失敗をsynthetic inputで観測できるharnessを追加する。
    -   test終了時にexact child、listener、timer、一時資源を回収し、製品のrestart回数やshutdown仕様をharnessの終了制御か
        ら推定しない。
    -   実service、実EPG更新、実network、実databaseを起動せず、制御可能なchild fixtureだけを利用する。
    -   childが意図的に継続または無期限待機するscenarioはharness側で観測後に終了し、その終了を製品timeoutとして扱わな
        い。
    -   完了時には、正常exit、signal、error、未処理rejection、IPC messageのfixtureが残留process 0件で再現される。
    -   _Requirements: 9.1, 9.2_
    -   _Boundary: Isolated Compiled Child Harness_
    -   _Verification: harnessを使う`integration`_
    -   _Depends: 1.1_

-   [x] 1.5 Node.js 24最低対応環境とmandatory cellのfoundation検証を成立させる

    -   rootのversion宣言、依存、開発環境、container source、利用者向け対応表明がNode.js 24未満を最低対応としている差を洗
        い出す。version宣言（`engines`、`mise.toml`、両server Docker stage）はレビューとNode.js matrixの実行で確かめ、設
        定ファイルの内容を読むtestは置かない。
    -   version宣言とNode.js関連依存を最低対応24へ最小更新し、Node.js 18をfallback、代替、失敗時の迂回経路として残さない。
    -   freshな依存導入、server build、全server test、coverage、compiled startup smokeの固定五commandを同じNode.js 24環
        境で順に実行するmandatory cellを成立させる。
    -   Foundation-firstでは、依存導入、build、現時点の全server test、startup smokeを成功させる。coverageはtest/report完
        了後、未実装domainによるC0/C1 100% threshold未達で非0終了することを期待し、成功へ変換しない。
    -   全domain suite収束後のNode.js 24の回は、Design §12.4のsequence（単体testをcoverage付きで一度、結合testを
        coverageなしで一度）で判定する（9.9）。
    -   startup smokeはsynthetic dependency portを使い、実チューナー、実DB、実設定値を要求しない。
    -   registry publish、package publish、public write capabilityをacceptance経路へ追加しない。
    -   本leaf完了時には、Node.js 24の最低対応表明とfoundationのcellが成立し、24未満の対応表明とNode.js 18 fallbackが0件に
        なる。
    -   _Requirements: 1.1, 1.2, 1.4_
    -   _Boundary: Node.js Version Policy・Mandatory Cell Foundation_
    -   _Verification: fresh install, build, full server test, startup smoke success; coverageは全domain suite収束まで
        期待したthreshold非0_
    -   _Depends: 1.2, 1.3, 1.4_

-   [x] 1.6 Node.js 26 additional cellを同じfoundation手順で成立させる

    -   Node.js 24必須cellと同じcommand・suite一覧をNode.js 26 additional cellへ要求し、26固有runner、command、
        fixture、skip、18 fallbackを持たせない。
    -   matrix設定を最小更新し、同じ手順がGREENになることをこのcheckbox内で閉じる。
    -   Node.js 24 mandatory cellと同じfresh依存導入、server build、全server test、startup smokeをNode.js 26で実行す
        るadditional cellを設定する。coverageは24の回だけが判定し、26の回は`npm run test:server`を一度だけ実行する。
    -   Node.js 26だけの別runner、別command、別fixture、skip allowlistを作らず、同じsuiteの差だけを検出する。
    -   Node.js 26の成功を最低対応versionの引上げとして表明せず、24のfailureを26のsuccessで代替しない。
    -   Node.js 18による再実行、fallback、比較結果のacceptance採用がないことを確かめる。
    -   本leaf完了時には、24 mandatoryと26 additionalの結果が別々に報告され、両方が同一command・suite一覧を持つ。
    -   _Requirements: 1.3, 1.4_
    -   _Boundary: Additional Node.js Compatibility Foundation_
    -   _Verification: Node.js 26 fresh cell_
    -   _Depends: 1.5_

## Runtime remainder execution barrier

以下の Major 2〜8 は Major 1 完了だけでは開始しない。roadmap Level 1〜11 のdomain taskが完了し、承認済みprovider portと
domain testが共有 foundation 上で検証済みになった後にだけ実施する。local `_Depends:` には本tasks文書内のIDだけを記し、
cross-spec task IDを作らない。

-   [x] 2. 起動準備と重大異常の既存 contract を固定する
-   [x] 2.1 log・設定・実行主体の準備順を characterization する

    -   運用log初期化、設定snapshot取得、実行主体切替、予約・録画管理用log設定読込の順をisolated entrypointで固定する。
    -   non-root、rootかつ空文字列を含むstring/number group指定、rootかつ`gid`がnull/undefined、rootかつuser指定を表駆動
        にし、 `gid`がnull/undefinedのときだけ既定の`video`を選ぶことを確認する。
    -   group切替後にuserを切り替え、identity変更後の主体でoperator log設定を読み込む順をcall ledgerで確認する。
    -   設定parser、default補完、logger sink、OS identity APIをruntime内へ再実装しない。
    -   完了時には、各identity fixtureのcall順、引数、未呼出し分岐が承認済み表と一致し、production codeの差分がない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
    -   _Boundary: Startup Sequence・Identity Preparation_
    -   _Verification: unittest/spec, unittest/imp, isolated entrypoint characterization_
    -   _Depends: 1.6_

-   [x] 2.2 準備失敗とparent重大異常observerの停止境界を characterization する

    -   log、設定、group切替、user切替、operator log読込を一箇所ずつ失敗させ、その位置より後の依存待ち、operator、child
        spawnが0件で非0終了することを固定する。
    -   起動後の未捕捉例外と未処理Promise rejectionは、observerごとにsummaryとErrorをそれぞれ一回、計2回のdirect fatal
        callsとして記録する一方、新規受付停止、明示的process終了、child回収、自己再起動を各0件とする。
    -   起動準備failureと、稼働中observerが記録する重大異常を同じrestart policyへ統合しない。
    -   共通shutdown、global failure state、自動復旧を追加しない。
    -   完了時には、準備failure matrixと稼働中二種の異常で、終了statusと非action件数が承認済み境界へ一致し、
        production/config差分0件となる。
    -   _Requirements: 2.6, 2.7_
    -   _Boundary: Startup Failure Boundary・Parent Fatal Observer_
    -   _Verification: unittest/spec, isolated child-process fault matrix_
    -   _Depends: 2.1_


-   [x] 3. チューナーサーバーとDBの無期限待機を固定する
-   [x] 3.1 1秒再確認と後続開始barrierをfake clockで characterization する

    -   起動準備後にチューナー状態取得を開始し、複数回failureの各回から1,000ms待った後だけ次の試行へ進むことを確認する。
    -   チューナー成功後だけDB接続確認を開始し、DBも複数回failureの各回から1,000ms待って再確認する。
    -   各待機の999msと1,000ms、event-loop遅延をfake clockで検証し、両依存成功前のoperator開始を0件とする。
    -   REST transport、DB driver、一回試行の内部retryやerror変換をruntimeへ移さない。
    -   完了時には、failure回数に応じた試行時刻と、両方成功後だけの後続開始1件がproduction差分なしで再現される。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
    -   _Boundary: Dependency Waiter・Startup Sequence_
    -   _Verification: unittest/spec, unittest/imp, fake-clock characterization_
    -   _Depends: 2.2_

-   [x] 3.2 一回試行と復旧待ち全体に独自timeoutがないことを固定する

    -   チューナー状態取得またはDB接続確認の一回のPromiseをpendingにし、fake clockを長時間進めても外側timer、次試行、
        operator開始、失敗確定が各0件であることを確認する。
    -   failure settlement後は1秒retryへ戻るが、試行回数、総待機時間、deadlineによる終了上限を持たないことをbounded
        harnessで観測する。
    -   test harnessが観測後に処理を終了する操作を製品timeout、cancel、または成功として記録しない。
    -   backup、restore、v1 migrationの無期限DB利用待ちへruntime共通timeoutを波及させないnegative boundaryを確認する。
    -   完了時には、一回試行の独自timeout 0件、全体deadline 0件、retry cap 0件、production/config差分0件となる。
    -   _Requirements: 3.6, 3.7_
    -   _Boundary: Dependency Waiter Timeout Negative Contract_
    -   _Verification: unittest/spec, deferred-promise regression, fake clock_
    -   _Depends: 3.1_

-   [x] 4. Operator composition と容量不足削除bindingをruntimeへ配置する
-   [x] 4.1 tuner snapshot・event binding・storage監視の既存開始順を固定する

    -   外部依存成功後にevent bindingを一回登録し、利用可能なtuner一覧を一回取得する順をcharacterizationする。
    -   同一tuner snapshotを予約競合判定と録画実行へ渡し、その後にstorage monitorを開始するobject identityとcall順を確認
        する。
    -   tuner一覧取得をrejectさせ、登録済みevent bindingを解除・再登録せず、tuner設定、storage監視、Service childを各0件
        とする。
    -   failureは重大異常として記録するが、その記録だけでparent明示終了または自己再起動を開始しない。
    -   予約競合、録画候補、event action選択、容量閾値と監視loopをruntimeへ再実装しない。
    -   完了時には、正常時の同一snapshot二受渡しと、failure時の再binding 0件・後続0件がproduction差分なしで再現される。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
    -   _Boundary: Operator Starter・Runtime Composition_
    -   _Verification: unittest/spec, unittest/imp, composition characterization_
    -   _Depends: 3.2_

-   [x] 4.2 snapshot aggregateと容量不足削除adapterをtarget testから最小実装する

    -   Cross-spec prerequisiteとしてRecorded Contentのprepared deletion、Recording Executionのread-only
        active-recording snapshotと非取消deletion gate、Process Messagingのcurrent-generation carrier/registry、
        Encoding／Media Deliveryのread-only snapshot、Service Interfaceのservice-child binding、およびStorageのtyped
        `IRecordedStorageDeletionPort`・contract double・対象testのprovider preparationが完了していることを確認してから着
        手する。このpreparationはStorageのproduction binding、削除動作、公開API、DB、設定、integration / deletion gateの
        GREENを意味しない。Runtime 4.2のcomposition後にStorageが既存gateへ進む。
    -   先に失敗するtarget testで、Recording snapshotとcurrent-generation service-child snapshotを各一回読み、両方
        `known`の場合だけ検証・重複排除したreadonly和集合をStorage candidate filterへ渡す期待値を定義する。provider不
        在、`unknown`、reject、generation mismatch、不正ID、通常5秒期限ではcandidate query/deleteを各0件とし、late reply
        や旧generationの結果を再利用しない。
    -   snapshotを候補除外のprefilterだけに使い、candidateごとに `prepareStorageDeletion`→recording gate→service-child
        gate→`deletePreparedForStorage`のlock内最終再読取・ exact-ID deleteを各一回呼ぶ期待値をcall ledgerで定義する。
    -   prepareの`not-deleted`、recording gateの`busy`/`unknown`、service-child gateの`busy`/`unknown`をそれぞれ
        `not-deleted`へ投影し、final delete、録画取消、Encode取消、利用者削除用terminal barrierのcallをすべて0件とする。
    -   recording gate取得後にservice-child gateを取得できない場合はrecording tokenだけを一回解放し、両gate取得後の
        success、`not-deleted`、reject、同期throwではservice-child→recordingの逆順で各tokenを一回解放する。
    -   最小adapterとcomposition bindingを同じcheckbox内で実装し、snapshot取得後のEncode受付raceではlease先着とdeletion
        token先着を分け、final deleteとqueue公開が重ならないよう二つの権威的gateを維持する。
    -   active recordingの終了、利用者削除terminal barrier、録画/Encode取消、queue wait/drain/retry、candidate選択、
        capacity再測定を各0件とし、候補、gate内部判定、resource lock、file/DB効果はprovider ownerへ残す。
    -   完了時には同じtarget testがGREENになり、known unionだけがcandidate filterへ渡り、unknown系のcandidate
        query/delete 0件、busy/unknown時の副作用0件、全terminal pathの逆順exact release、およびRuntime外のowner重複0件が
        観測され、production差分を含むRED→最小実装→GREENがこのcheckbox内で閉じる。
    -   _Requirements: 4.4_
    -   _Boundary: StorageRecordedUseSnapshotAdapter・StoragePressureDeletionAdapter・Runtime Composition_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, storage-pressure-deletion integration_
    -   _Depends: 4.1_

-   [x] 5. Web・API child の開始と継続監督を固定する
-   [x] 5.1 Service childのspawn・即時peer登録・cleanup非待機を characterization する

    -   operator開始後にWeb・API提供処理を別childとしてspawnし、追加ready messageを待たずspawn直後にIPC current peerへ一
        回登録する順をcompiled child fixtureで固定する。
    -   peer登録を監督開始の受理として起動時整理へ進み、childのHTTP listener成立またはready acknowledgementをbarrierにし
        ない。
    -   Service child内のHTTP route、Socket.IO集約、API validation、IPC peer identity判断をruntimeへ再実装しない。
    -   Web・API受付開始とcleanup完了を一つのready状態へ統合しない。
    -   完了時には、spawn、peer登録、cleanup開始の順と各1件、ready message待機0件がproduction差分なしで再現される。
    -   _Requirements: 5.1, 5.2, 6.6, 8.1_
    -   _Boundary: Service Child Supervisor・Process Messaging Adapter_
    -   _Verification: unittest/spec, compiled child-process characterization_
    -   _Depends: 4.2_

-   [x] 5.2 Service childのgeneration単位監督をtarget testから最小実装する

    -   generation identityはchildとの相関だけに用いるopaqueな値とし、spawnごとにfreshに新規割当して過去のidentityを再利
        用しない。大小・順序、永続値、IPC公開値、正負分岐には用いない。
    -   先に失敗するtarget testで、Service childの`exit`と`error`同tickでは先着terminalだけがlistener detach、active
        identity無効化、異常記録、次generation spawn、current peer登録を各一回行い、後着・stale callbackの作用を0件とす
        る。
    -   最小generation guardを実装し、連続terminal eventをbounded fixtureで発行して固定restart cap、backoff、stability
        windowなしで各generationの先着受付から一回だけ再spawnへ進むことを確認する。
    -   stdout・stderrがpipe構成の場合だけbuffer滞留を防ぐ読取を行い、pipeでないstreamを新たに作らない。
    -   IPC disconnect専用restart、direct childの子孫回収、共通shutdown / drainを追加しない。
    -   完了時には同じtarget testがGREENになり、exit/error raceごとの再spawn・peer登録がexact一回、旧listener・stale作用
        0件、pipe読取、cap・backoff・子孫回収0件となり、production差分を含むRED→最小実装→GREENがこのcheckbox内で閉じる。
    -   _Requirements: 5.3, 5.4, 8.2, 8.3, 8.6, 8.7_
    -   _Boundary: Service Child Supervisor_
    -   _Verification: unittest/spec, unittest/imp, bounded child supervisor characterization_
    -   _Depends: 5.1_

-   [x] 6. 起動時三段階と600秒観測をTDDで実現する
-   [x] 6.1 録画整理のprovider効果と通常event委譲を結合 characterization する

    -   runtimeがrecording ownerの起動時整理portを一回呼び、一時file移動と対応予約fileのsize反映をowner operationへ委譲
        する境界を確認する。
    -   ownerが通常の録画完了結果を構成できる場合だけ既存event経路へ渡し、構成できない項目にstartup専用画面event、
        Hook、synthetic通知を追加しない。
    -   file移動、path、size、予約照会、候補registry、schedulerの業務処理をruntime integration test内へ複製しない。
    -   provider success / rejectと通常event有無だけをruntime portの観測値として扱う。
    -   完了時には、runtimeからprovider call 1件、通常eventの条件付き受渡し、専用通知0件、production/config差分0件が確認
        できる。
    -   _Requirements: 6.2, 6.3, 6.5_
    -   _Boundary: Startup Cleanup Sequence・Recording Startup Port Integration_
    -   _Verification: unittest/spec, provider contract integration_
    -   _Depends: 5.2_

-   [x] 6.2 600秒soft observerをtarget testから最小実装する

    -   先に失敗するtarget testで各provider Promiseの599,999ms、600,000ms、600,001ms、resolve/reject同tick raceを定義
        し、deadline到達はoverdue記録だけでcancel、failure、ownership解放、retry、shutdown、releaseを各0件とする。
    -   process-local observerを最小実装し、original Promiseのlate success/failureを同じtyped outcomeへ一回だけ反映し、
        timerとsettlementの先着/後着で二重通知しない。
    -   Runtimeはstageを直列選択せず、observerが受けた一つのprovider operationを包んで同じ結果を返すだけにする。
    -   stateをDB、file、IPC、公開readyへ保存せず、開始済みService childや整理非依存業務を停止しない。
    -   完了時には同じ境界/race testがGREENになり、overdue後のcancel/release/retry 0件、late outcome exact一回、残留
        timer 0件となり、production差分を含むRED→最小実装→GREENがこのcheckbox内で閉じる。
    -   _Requirements: 6.7, 6.8_
    -   _Boundary: Runtime Startup Stage Observer_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, fake-clock race regression_
    -   _Depends: 6.1_

-   [x] 6.3 Workflow startup入口への一回handoffをtarget testから最小実装する

    -   Cross-spec prerequisiteとしてWorkflowの実在Task 8.1完了後に8.2が完了し、
        `RuntimeStartupWorkflowPort.runAfterServiceSupervisionAccepted`がreconciliation→combined
        `rebuildCandidatesAndStart()`（再構築成功後に3秒scheduler開始）→expired cleanup→EPG callbackのpolicyを所有するこ
        とを確認する。
    -   先に失敗するtarget testで、Runtimeがevent bindingを一回登録し、operator/tuner同一snapshotとstorageを開始し、
        Service supervision accepted/current peer登録後にready ackを待たず、600秒observed portsとEPG callbackを単一
        Workflow入口へbindingして一回invokeする期待値を定義する。
    -   最小composition bindingと一回guardを実装し、Runtimeが三stageを直列選択、combined providerを分割、failure/retry
        policyを再実装しないことをnegative assertionで固定する。
    -   Web受付、cleanup、EPG開始、最初の更新をglobal readyへ統合せず、failure記録だけでparent終了・自己再起動・Service
        停止を開始しない。
    -   Workflow入口がfulfilした`Failed` outcomeは、Runtimeの既存重大異常記録経路(`log.system.fatal`)へstageとcauseを
        一回だけ記録し、process全体のunhandledRejectionへ意図的に漏らさない。予期しないPromise rejection用catchは維持
        し、typed `Failed`とは混同しない。
    -   完了時には同じtarget testがGREENになり、Workflow入口とEPG callbackが各最大一回、Runtime独自stage選択0件となり、
        production差分を含むRED→最小実装→GREENがこのcheckbox内で閉じる。
    -   _Requirements: 2.7, 6.1, 6.4, 6.6, 6.7, 7.1_
    -   _Boundary: RuntimeStartupWorkflowPort Binding・Runtime Composition_
    -   _Verification: unittest/spec RED, unittest/imp GREEN, startup handoff contract_
    -   _Depends: 6.2_

-   [x] 7. 番組情報更新childの開始と継続監督を固定する
-   [x] 7.1 Workflow handoff後のEPG開始・updated event・ready非統合を結合検証する

    -   Service監督受付後に一回invokeしたWorkflowがbinding済みEPG callbackを呼んだ場合だけEPG childをspawnし、Workflowが
        failureまたはpendingの間はspawn 0件とする。
    -   EPG childの`updated` messageを既存番組情報更新完了eventへ一回渡し、予約更新などの後続選択をworkflow ownerへ委譲
        する。
    -   Web受付、cleanup完了、EPG開始、最初のupdatedを別事実として観測し、一つの公開ready state、ready message、
        checkpointを追加しない。
    -   EPG取得・保存、予約再評価、event payloadの意味をruntimeへ再実装しない。
    -   完了時には、正常・各前段停止でEPG spawn件数が一致し、updated event 1件、global ready 0件になる。
    -   _Requirements: 7.1, 7.2, 7.4, 8.1_
    -   _Boundary: EPG Start Barrier・EPG Child Supervisor Integration_
    -   _Verification: unittest/spec, compiled child-process integration_
    -   _Depends: 6.3_

-   [x] 7.2 EPG childのgeneration単位監督をtarget testから最小実装する

    -   先に失敗するtarget testで`exit`、`disconnect`、`close`、`error`の全順列と同tick raceを発行し、先着だけが異常記
        録、exact child listener除去、active identity無効化、同じspawn経路の再実行を各一回行い、後着・stale作用を0件とす
        る。
    -   `disconnect`ではlistener除去と再spawnの前にexact childへ`SIGINT`を一回送り、他のterminalでは追加signalを送らな
        い。
    -   stdout・stderrがpipeのときに両方を読み、buffer滞留を防ぐ。terminal繰返しでも旧child listenerを新childへ残さな
        い。
    -   最小generation guardを実装し、bounded fixtureで複数回再起動して固定restart cap、backoff、stability window、
        global drain、子孫回収が各0件であることを確認する。
    -   完了時には同じtarget testがGREENになり、四eventのcall順、disconnect exact signal、旧listener/stale作用0件、pipe
        drain、無上限再spawnが成立し、production差分を含むRED→最小実装→GREENがこのcheckbox内で閉じる。
    -   _Requirements: 7.3, 8.4, 8.5, 8.6, 8.7_
    -   _Boundary: EPG Child Supervisor_
    -   _Verification: unittest/spec, unittest/imp, table-driven child characterization_
    -   _Depends: 7.1_

-   [x] 8. runtime全体の結合検証を完成する
-   [x] 8.1 compiled runtimeの全起動順とfailure barrierを結合検証する

    -   synthetic configとprovider portでcompiled runtimeを起動し、log・設定・identity、tuner待機、DB待機、event
        binding、tuner受渡し、storage、Service、三段階cleanup、EPGの順を一つのcall ledgerで確認する。
    -   各起動準備、dependency、tuner取得、cleanup stageを一箇所ずつfailureまたはpendingにし、その位置より後の開始件数を
        0件とする。
    -   容量不足削除adapterをstorage consumerから起動し、known snapshot union、二つのexclusive gate、recorded deletion
        coreのprovider順とexact releaseをruntime composition上で確認する。利用者削除terminal barrierは呼ばない。
    -   無期限dependency waitと600秒観測deadlineを別clock契約として検証し、前者へtimeout、後者へcancel・解放を混在させな
        い。
    -   完了時には、全正常順、全failure停止点、provider owner非重複、残留timer・listener・child 0件が確認できる。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5,
        4.6, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.4_
    -   _Boundary: Application Runtime End-to-End Composition_
    -   _Verification: unittest/spec, unittest/imp, compiled runtime integration, fake clock_
    -   _Depends: 4.2, 5.2, 6.3, 7.1, 7.2_

-   [x] 8.2 Service・EPGの再起動と非所有境界をprocess結合で検証する

    -   Serviceの`exit`・`error`とEPGの四terminal eventを繰り返し、current peer入替え、旧listener除去、SIGINT、pipe
        drain、再spawnをcompiled processで確認する。
    -   old childのterminalまたはlate messageがnew childのpeer、listener、updated eventを変更しないowner contractを
        process-messagingと結合検証する。
    -   restart cap、backoff、global ready、共通shutdown / drain、direct childの子孫回収、domain operationの再実装を
        negative assertionで固定する。
    -   Web・API受付、cleanup、EPG開始、最初の更新の各観測点を別々に保ち、一つのready結果を生成しない。
    -   完了時には、terminal eventごとの再spawn、peer・listenerのexact identity、非所有action 0件、残留child 0件になる。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
    -   _Boundary: Service Child Supervisor・EPG Child Supervisor・Process Messaging Integration_
    -   _Verification: compiled child-process integration, operational-log spy_
    -   _Depends: 5.2, 7.2, 8.1_

-   [x] 8.3 Workflow post-runtime handoffとexact integration bindingを検証する

    -   `OWN-032`完了後、Workflow prerequisite 8.1→8.2の順の成功を確認してから、
        `startup-composition.integration.test.ts#case-7-10`と`#failure-stop`で単一Workflow入口へのhandoffを検証する。
    -   `storage-pressure-deletion.integration.test.ts#exclusive-prepare-and-final-delete`、
        `user-whole-recorded-deletion.integration.test.ts#service-pm-parent-prepared-final-delete`、
        `individual-video-file-deletion.integration.test.ts#direct-or-fresh-whole-delete`、
        `encode-completion-binding.integration.test.ts#workflow-event-binding-invoked-once`をexact alias/bindingで実行す
        る。
    -   Runtimeはprovider内部、Workflow coordination、PM wire、公開HTTP APIを複製せず、process境界、binding identity、重
        複登録0件だけを検証する。
    -   完了時には6つのapproved integration aliasがGREENとなり、missing/extra binding、Runtime owner重複、
        production/config変更が各0件になる。
    -   _Requirements: 4.4, 4.5, 6.1, 6.7, 7.1_
    -   _Boundary: Runtime Cross-spec Handoff Integration_
    -   _Verification: approved exact integration locators_
    -   _Depends: 8.1, 8.2_

-   [x] 9. Runtime固有の品質と、server共通の品質判定の基盤を閉じる

Major 9は、Requirement 9のうちRuntime固有の品質（9.3〜9.7）と、共有foundationが所有するcoverageの計測の道具（9.8）、単体testだけのcoverage（9.9）を
持つ。server全体の単体testだけでのC0/C1 100%（Acceptance Criterion 9）はMajor 12が閉じる。各leafは
gitignored `test/server/.artifacts/`だけを生成する。Requirement 9 Acceptance Criterion 1・2は、Major 1（1.2〜1.4）が扱う。

-   [x] 9.3 Requirements 2から8の仕様testを完成する

    -   `*.spec.test.ts`のRequirements 2から8の43 case（AR-2.1〜AR-8.7）が、title tagから逆引きでき、一件ずつ成功する
        ことを確かめる。Requirement 1（対応Node.js環境）はspec caseにせず、Node.js matrixの実行とversion宣言のレビューで確
        かめる。
    -   `startup-composition.spec.test.ts`にAR-7.2（番組情報更新の完了を関係する予約更新処理へ一度だけ通知する）と
        AR-7.4（Web・API受付、起動時整理、番組情報更新開始、最初の更新完了を一つの準備完了状態として公開しない）のspec caseを
        足す。
    -   `operator-composition.spec.test.ts`にAR-4.5（Workflow event binding入口とport bindingが各一回で、再入しない）、
        `startup-composition.spec.test.ts`にAR-6.7（各stage failureで後続stageとretryが0件）のspec caseを足す。結合testの
        `encode-completion-binding.integration.test.ts#workflow-event-binding-invoked-once`と`startup-composition.integration.test.ts#failure-stop`は
        そのまま残し、同じ契約をspecとintegrationの両方から確かめる。
    -   `child-supervision.spec.test.ts#AR-8.4`のcaseにAR-7.3のtagを足し、四つのterminal eventでの回収と再起動を
        AR-7.3としても逆引きできるようにする。
    -   完了時にはAR-2.1〜AR-8.7の43 caseがspec testとして全件成功し、AR-4.5・AR-6.7・AR-7.2・AR-7.3・AR-7.4が各tagから実在するspec caseへ辿れ
        る。production/config変更は0件である。
    -   _Requirements: 4.5, 6.7, 7.2, 7.3, 7.4, 9.3_
    -   _Boundary: Runtime Spec Tests_
    -   _Verification: unittest/spec_
    -   _Depends: 8.3_

-   [x] 9.4 Runtime内部characteristicsを検証する

    -   `imp/runtime-characteristics.test.ts`の、root/non-root、user/group指定省略、依存failure回数、tuner成功失敗、
        600秒境界、全terminal event/generation raceを実行するcaseに、title marker `[AR-9.4]`を付ける。これらのcaseに付けるRequirement 9のtagは`AR-9.4`だけで、
        coverageのrunの記録を表す`AR-9.15`は付けない。`[AR-4.2]`・`[AR-5.2]`・`[AR-6.1]`・`[AR-8.6]`・`[AR-8.7]`など他のARのtagは残す。
    -   完了時にはcharacteristics suiteが全件成功し、`AR-9.4`から各caseを逆引きできる。production/config変更は0件である。
    -   _Requirements: 9.4_
    -   _Depends: 9.3_

-   [x] 9.5 Runtimeのtest matrixを設計と突き合わせて確認する

    -   Design §14のRuntime matrixの全行（Requirements 1〜8のfunctional ACとRuntimeのRequirement 9 AC）が、requirements.mdの
        ACと一対一で対応し、各行のlocatorが実在するtestまたは確認手段を指し、値・状態・time・race・resource分類とN/A理由に空欄
        がないことをレビューで確認する。
    -   このmatrixはDesignの表そのものを正とし、matrixを読む監査testは置かない。
    -   完了時には全行が逆引きでき、missing/extra/duplicate/空欄が0件であることがレビュー記録に残る。
    -   _Requirements: 9.5_
    -   _Depends: 9.4_

-   [x] 9.6 Runtime integration boundary matrixを実行する

    -   `integration/runtime-boundaries.integration.test.ts`の、tuner HTTP、SQLite/MySQL、Service/EPG child、IPC、
        startup filesystem整理をowner公開port経由で接続するcaseに、title marker `[AR-9.6]`を付ける。これらのcaseに付けるRequirement 9のtagは`AR-9.6`だけで、
        preflightの確認を表す`AR-9.17`は付けない。`AR-4.5`・`AR-6.1`・`AR-6.7`・`AR-7.1`・`AR-7.2`・`AR-7.4`など他のARのtagは残す。
        MySQL等のcontainer名の接頭辞`ar-9-17-`は資源名であり（AR-9.17とは関係が無い）、片付けの対象として`scripts/preflight-clean-stale-containers.sh`に残す。
    -   完了時には全境界とfailure cleanupが成功し、`AR-9.6`から各caseを逆引きできる。owner内部複製・production/config変更は各0件である。
    -   _Requirements: 9.6_
    -   _Depends: 9.5_

-   [x] 9.7 Runtime feature-level completionを確定する

    -   Runtimeの機能固有テスト（`unittest/spec`、`unittest/imp`、integration）全件成功、9.3〜9.6の成功、および
        `.kiro/steering/server-testing.md`の共通品質判定への適合を確かめる。
    -   server全体の単体testだけでのC0/C1 100%の判定（Requirement 9 Acceptance Criterion 9。12.6）が成立していることを確かめる。
    -   完了時にはRuntime機能固有テスト全件success、9.3〜9.6全success、12.6の判定が成立し、production/config変更0件となる。
    -   _Requirements: 9.7_
    -   _Depends: 9.6, 12.6_

-   [x] 9.8 coverageの計測の道具を本機能の持ち物として置く

    -   coverageの計測の道具の四要素（worker側のraw coverage取得3 file、`compiled-snapshot-coverage.mjs`、
        `run-coverage-gate-cli.mjs`、作業場所の中身の記録`worktree-content.mjs`）は本機能が所有し、それらのtest 5本
        （`compiled-snapshot-coverage.test.ts`、`coverage-command-terminal.test.ts`、`coverage-raw-flush.spec.test.ts`、
        `run-coverage-gate-cli.test.ts`、`worktree-content.spec.test.ts`）が`test/server/application-runtime/spec/`にあり、全件成功する。
    -   完了時には、道具のtest 5本が全件成功する。
    -   _Requirements: 9.8_
    -   _Boundary: Coverage Measurement Toolchain_
    -   _Verification: unittest/spec_
    -   _Depends: 8.3_

-   [x] 9.9 coverageの計測を単体testだけにし、Node.js 24の回をそろえる

    -   `scripts/server-test/run-tests.mjs`のcoverage modeを、spec・impの単体testだけをcoverage付きで一度実行する形にし、
        integrationをcoverageの対象に含めない。`test:server:coverage`はこの実行を指し、serverの`src/**`のC0/C1が100%未満、
        test失敗、集計の破綻（母数0、malformed）のいずれでも非0終了する。
    -   coverageを複数の実行に分けて統合するshard modeのコード（`EPGSTATION_COVERAGE_SHARD`、部分結果の書き出し、
        test一覧の突き合わせ）と、それだけを検証するtestを外す。
    -   残すcoverageの道具（`compiled-snapshot-coverage.mjs`、`coverage-transform-capture.ts`とそのtest）と
        `run-node-acceptance-matrix.mjs`が、取り除く`evidence-identity.mjs`・`r9-evidence-producers.mjs`へ依存しない形にする
        （hashは`node:crypto`、artifactの書き出しは残すmodule内の実装に置き換える）。
    -   `scripts/server-test/run-node-acceptance-matrix.mjs`のNode.js 24の回を、`run-coverage-gate-cli.mjs`（spec・impを
        coverage付きで一度。C0/C1を判定）と`npm run test:server:integration`（coverageなしで一度）の二段にし、どちらかが失敗すれば
        cellを失敗とする。Node.js 26の回は`npm run test:server`を一度だけ実行する。どのtestも二度流さない。
    -   単体testが一度も読み込まないscript（migrationなど）が`missing-raw-record`でcoverage全体を失敗させる扱いは
        fail-closedのまま保つ。除外表への追加や、読み込みだけを行う一時的な回避ではなく、Major 12の単体testが対象scriptを実際に実行して
        解消する。
    -   完了時には、`npm run test:server:coverage`が単体testだけで一度流れ、Node.js 24の回が「単体coverage一度＋結合一度」、26の回が
        全server test一度となり、残るcoverageの道具とnode-matrixが取り除くfileを参照しない。
    -   _Requirements: 9.2, 9.9_
    -   _Boundary: Coverage Command・Node.js Acceptance Matrix_
    -   _Verification: unittest/spec（道具のtest）、`npm run test:server:coverage`の終了status_
    -   _Depends: 9.8_

-   [x] 10. 公開用Docker imageの構築・起動を手元で確認できるようにする

Major 10はDesign §17の手元の確認（Requirement 10）を持つ。製品のDockerfileは変更せず、base image同梱のNode headerを使う形の
Dockerfileを前提にする。外部からの取得は準備の段階（10.1）だけで行い、本体の確認（10.2〜10.3）は取得しない。

-   [x] 10.1 依存の層を製品のDockerfileから導く準備の道具に直す

    -   `scripts/server-test/dependency-images.mjs`が、`Dockerfile.debian`・`Dockerfile.alpine`の`FROM ...@sha256:...`をすべて読み、
        同じtagが別のdigestなら終了code 2で失敗する。各builder stage（`client-builder`・`server-builder`）で、`FROM`から最初の行頭
        `COPY . `の直前までを依存の部分として導き、導けない形も終了code 2で失敗する。
    -   serverのOS packageの層（最初の`WORKDIR`の直前まで）とnpmの層を別々のtag付きimageとして用意する。tagは層の内容と
        manifestのsha256から決め、`package.json`または`package-lock.json`が変わると、変わった側のnpmの層だけtagが変わり、OSの層と
        baseのtagは変わらない。Nodeのheaderの取得と、手書きの層のDockerfileを持たない。
    -   `scripts/server-test/prepare-dependency-images.mjs`の取得対象をbase image、OS package、npmの依存関係だけにし、揃っていれば
        外へ取りに行かず、取得失敗は終了code 75、入力の誤りは2、想定外は1で終える。`scripts/ci-rehearsal/deps-image-tags.mjs`は同じ
        moduleから層のtagを得る形を保つ。
    -   `test/server/application-runtime/docker-dependency-images.spec.test.ts`を新規に作り、層の導出、導けない形、lock変更時のnpmの層だけの作り直し、揃っている場合に取得しないこと、取得失敗の終了codeを
        fakeの`run`で確かめる。
    -   完了時には、spec testが全件成功し、準備の取得がpull・buildだけであり、揃っている場合のdocker呼び出しが`inspect`だけである。
    -   _Requirements: 10.2, 10.5, 10.6, 10.7, 10.8, 10.9_
    -   _Boundary: Dependency Plan・Dependency Preparer_
    -   _Verification: unittest/spec_

-   [x] 10.2 準備済みの確認と、製品のDockerfileから導いたDockerfileの構築を実装する

    -   新規`scripts/server-test/docker-image-check.mjs`に、`docker image inspect`だけでbase（Dockerfileのdigestと一致）とnpmの層が手元に
        あることを確かめるPrepared Verifierを置く。無ければ、理由`not-prepared`と準備のcommandを示して失敗し、外部へ取りに行かない。
    -   同moduleのImage Dockerfile Deriverは、各builder stageの依存の部分を`FROM <npmの層のtag> AS <stage>`の1行に置き換えた
        Dockerfileを`test/server/.artifacts/docker-image-check/<id>/Dockerfile`に生成し、それ以外の行は製品のDockerfileのままとする。
    -   Image Builderは、`docker build --platform linux/amd64 --network=none --pull=false --no-cache`で構築し、構築後に`Os=linux`・
        `Architecture=amd64`を確かめる。呼んだdockerのargvをledgerに残す。
    -   導いたDockerfileの`FROM`が準備済みのnpmの層のtagであり、それ以外の行が製品のDockerfileと一致すること、準備されていない場合に取得のargvが0件であることを
        `docker-dependency-images.spec.test.ts`で確かめる。
    -   完了時には、Debian版・Alpine版のDockerfileから導いたDockerfileがspec testで検証され、準備されていない状態が`not-prepared`として区別できる。
    -   _Requirements: 10.1, 10.2, 10.10_
    -   _Boundary: Prepared Verifier・Image Dockerfile Deriver・Image Builder_
    -   _Verification: unittest/spec_
    -   _Depends: 10.1_

-   [x] 10.3 tuner serverの代役、起動とHTTPの確認、片付けを実装し、integration testで確かめる

    -   `docker-image-check.mjs`のTuner Stubが`/api/version`と`/api/status`だけに応じ、実チューナー・実tuner serverへは接続しない。
        Server Runnerは専用のnetworkを作り、stub・serverのcontainerを起動し、`config/config.yml.template`の複製の`mirakurunPath`を
        stubのcontainer名にし、hostのportを公開しない。
    -   HTTP Probeは、server containerの中から`GET /api/version`（200、`version`が`package.json`と一致）と`GET /`（200、HTML）を
        deadlineまで確かめ、containerが終了していれば即座に失敗する。失敗時はserver・stubの`docker logs --tail`をmessageへ含める。
    -   Resource Cleanerは、成功・失敗のどちらでも、この実行のcontainer・network・確認用imageを削除し、存在しないことを確かめる。依存imageは
        残す。呼んだdockerの引数に`push`・`login`・`--push`・registryへの`--output`が無いことをledgerで確かめる。
    -   新規`test/server/application-runtime/docker-image.integration.test.ts`にDebian・Alpineの2 caseを置き、準備済みの確認から片付けまでを
        一つの流れで確かめる。恒久のtestはこのfileと`docker-dependency-images.spec.test.ts`の2 fileだけとする。
    -   完了時には、Debian版・Alpine版が構築・起動・応答・片付けまで成功し、終了code（75・2・1と、確認の失敗の1の区別）がDesign §17.4の表と一致する。
    -   _Requirements: 10.3, 10.4, 10.11, 10.12_
    -   _Boundary: Tuner Stub・Server Runner・HTTP Probe・Resource Cleaner_
    -   _Verification: integration（準備済みの依存imageと実Dockerが前提）_
    -   _Depends: 10.2_

-   [x] 10.4 確認のfileを直列実行・node-matrix・模擬runnerへ組み込む

    -   `scripts/server-test/serialized-real-process-files.mjs`の`SERIALIZED_REAL_PROCESS_FILES`に`application-runtime/docker-image.integration.test.ts`を載せ、
        `scripts/server-test/run-tests.mjs`の直列実行の判定と名前を新しいfileに替える。直列実行がこの1 fileになったことで空振りになる側を整理する。
    -   `scripts/server-test/run-node-acceptance-matrix.mjs`のNode.js 26の回の除外envの名前と説明を新しいfileに合わせる（挙動は変えない）。
    -   `scripts/ci-rehearsal/job.sh`の`serialized`のlocatorの対応を`<layer>/<test/server配下のpath>`に一般化し、`scripts/ci-rehearsal/setup.sh`の
        残骸のpatternを`epgstation-docker-check-*`・`epgs-docker-check-*`に替える。
    -   完了時には、`serialized`の経路で新しいfileが単独に実行でき、node-matrixのNode.js 26の回で除外される。
    -   _Requirements: 10.3_
    -   _Boundary: Test Runner Integration_
    -   _Verification: `scripts/ci-rehearsal/job.sh`の`serialized`の経路で確認fileを選択した結果_
    -   _Depends: 10.3_

-   [x] 10.5 preflightのstepと説明を新しい確認に合わせる

    -   `scripts/release-preflight.sh`の`deps-prepare`・`docker-gate-node24`のstep名と並びは変えず、説明文を新しい内容（外部取得は`deps-prepare`だけ、
        `docker-gate-node24`は`docker-image.integration.test.ts`の単独実行）にする。`deps-prepare`が取得するのはbase image、OS package、npmの依存関係だけである。
    -   `scripts/preflight-clean-stale-containers.sh`の掃除を`epgstation-docker-check-*`・`epgs-docker-check-*`のcontainer・networkの回収へ替える。
        `runtime-boundaries.integration.test.ts`の`ar-9-17-*`のcontainerの掃除と、persistenceのMySQL fixtureの掃除は残す。
    -   完了時には、`--only deps-prepare`と`--only docker-gate-node24`が新しい確認の順で実行でき、`ar-9-17-*`の掃除が残っている。
    -   _Requirements: 10.5, 10.9, 10.12_
    -   _Boundary: Preflight Steps_
    -   _Verification: `scripts/release-preflight.sh`の`--only deps-prepare`、`--only docker-gate-node24`の実行_
    -   _Depends: 10.4_

-   [x] 10.6 docker-gateのリリース証明の機構と、それだけが使うscript・testを取り除く

    -   10.3で新しい確認が通ってから、docker-gateのリリース証明の機構を取り除く。`scripts/server-test/`の`final-acceptance-adapters.mjs`、
        `engine-create-supervisor.mjs`、`run-final-acceptance.mjs`、`run-final-acceptance-cli.mjs`、`validate-release-evidence.mjs`、
        `r9-evidence-producers.mjs`、`r9-evidence-dag.mjs`、`evidence-identity.mjs`、`db-matrix-spawn-adapter.mjs`、
        `db-matrix-sqlite-backend-handoff.mjs`、`coverage-shard-inventory.mjs`、`enumerate-sealed-coverage-roster.mjs`、およびそれだけが使う補助を削除する。
    -   `test/server/release-certification/`の`final-acceptance*.test.ts`、`audit/final-acceptance*.test.ts`、`gitleaks-accepted.gitleaksignore`など、
        それだけが使うtestと設定を削除する。`release-certification/audit/`が空になるため、`test-selection.mjs`の`/audit/`の分類とglobを外す。
    -   `package.json`の`test:server:final-acceptance`を削除し、公開commandが6本であることを確かめる。`process.mjs`の`assertNotUnderAuditor`と、`compiled-snapshot.mjs`の`dbMatrixCellCompiledSnapshotPath`など、
        それらのfileだけが使う部分も整理する。
    -   削除の前後で、残るfileからの参照（import、path文字列、コメント）を検索し、参照切れが0件であることを確かめる。`runtime-boundaries.integration.test.ts`の
        `ar-9-17-*`とその掃除は残す。
    -   完了時には、公開commandが`test:server:build`・`spec`・`imp`・`integration`・`test:server`・`test:server:coverage`の6本だけで、取り除いた
        fileへの参照が0件であり、`npm run test:server`が成功する。
    -   _Requirements: 9.1, 10.9_
    -   _Boundary: Docker Gate Cleanup_
    -   _Verification: 参照の検索、typecheck、`npm run test:server`_
    -   _Depends: 10.5, 9.9_

-   [x] 11. 公開用Docker imageの構築・公開workflowを置く

-   [x] 11.1 `.github/workflows/docker.yml`をDesign §17.8の形で書く

    -   triggerを`master`へのpushと全tag、`pull_request`なし、top-level `permissions: {}`、jobに`contents: read`、matrixのdistroとplatformの一覧、
        `Docker tags`のstep、QEMU・Buildx・Docker Hubのlogin・build-pushの各stepで構成する。actionはcommit SHAで固定し、`type=gha`のcacheをdistroごとの
        scopeで持ち、`provenance: false`とする。
    -   Docker Hubの認証情報は`secrets`の参照で渡し、`DOCKERHUB_IMAGE`と`matrix.distro`は`env`でshellへ渡す。
    -   完了時には、workflowがDesign §17.8の「v2との差と理由」の表と一致し、`pull_request`を含まない。
    -   _Requirements: 11.1, 11.2, 11.5_
    -   _Boundary: Docker Publish Workflow_
    -   _Verification: 11.2の実装時の確認_
    -   _Depends: 11.3_

-   [x] 11.2 tagの計算と構文を実装時に確かめる

    -   `Docker tags`のstepの`run`を、`GITHUB_REF`を`refs/heads/master`と`refs/tags/v2.10.0`、`DISTRO`を`debian`と`alpine`の4通りで実行し、
        Requirement 11 Acceptance Criterion 3・4のtag列と一致することを確かめる。`IMAGE`はdummyを使う。
    -   `actionlint`が使えれば構文を検査する。
    -   実行した4通りの入力と出力、`actionlint`の結果を、実装の記録（変更の本文）に残す。恒久のtestは置かない。
    -   Docker Hubへの公開、QEMUでのarmの構築、gha cacheの保存・復元は、offlineでは確かめられないため、最初の公開の実行で確かめる。
    -   完了時には、4通りのtag列が期待と一致した記録が残る。
    -   _Requirements: 11.3, 11.4_
    -   _Depends: 11.1_

-   [x] 11.3 秘密情報の検査が、GitHub Actionsの`secrets`の参照を値として弾かないようにする

    -   `tools/check-tracked-secrets.py`は、Docker Hubのloginの`password`引数へ`DOCKERHUB_TOKEN`のsecrets参照（式の記法`${{ … }}`）を渡す行をcredentialらしき値として弾く（値の正規表現が空白で切れ、placeholderに合わない）。
        `.github/workflows/`配下の行に限り、`${{ secrets.<識別子> }}`だけの参照を値と見なさないようにする。
    -   検査を弱めすぎないため、`${{ 'abc' }}`のようなリテラル、`${{ secrets.X }}abc`のように参照に値が続く形、workflow以外のfile、実際のtokenらしき文字列は
        引き続き弾く。pre-commit hookは飛ばさない。
    -   上記のsecrets参照を`password`引数へ渡す行が通ること、上記の弾く例が弾かれることを、変更前後の実行結果として実装の記録に残す。
    -   完了時には、secrets参照を含む`docker.yml`がpre-commit hookを通ってcommitでき、弾くべき例が引き続き弾かれる。
    -   _Requirements: 11.1_
    -   _Boundary: Tracked Secrets Check_
    -   _Verification: `python3 tools/check-tracked-secrets.py`をstageした例で実行した結果_

-   [x] 12. serverの`src/**`のC0・C1を単体testだけで100%にする

Major 12はRequirement 9 Acceptance Criterion 9の「単体testだけでserverの`src/**`のC0・C1が100%」を成立させる。各leafは、未到達の箇所に単体test
（spec・imp）を足す。足すtestは、そのsourceを主に所有する機能の`test/server/<機能>/`に置く。product codeは変更せず、`COVERAGE_EXCLUSION_AUTHORIZATIONS`へ除外を足さない。単体testでは届かないと判断した箇所は、
product codeを変えずに、箇所と理由を記録して保守者の判断へ上げる。測定は9.9の`npm run test:server:coverage`で行う。

-   [x] 12.1 DB層（`src/model/db/*`）の未到達の箇所に単体testを足す

    -   `RecordedDB`、`ProgramDB`、`ReserveDB`、`VideoFileDB`、`DropLogFileDB`、`ThumbnailDB`、`ChannelDB`など、未到達のstatementとbranchが残る
        DBアクセスの各methodを、DB接続をfakeにした単体test（spec・imp）で通す。実DBを使う結合testの代わりにはしない。
    -   完了時には、対象fileのC0・C1が単体testだけで100%になる。
    -   _Requirements: 9.9_
    -   _Boundary: Unit Tests for DB Access_
    -   _Verification: `npm run test:server:coverage`の対象fileの未到達0件_
    -   _Depends: 9.9, 12.2_

-   [x] 12.2 migration scriptを単体testで確かめる

    -   `src/db/migrations/**`のMySQL・SQLiteのmigration（`up`・`down`）を、問い合わせを記録するfakeのquery runnerに対して実行し、
        `up`が発行する問い合わせの列（順序と対象table）と、`down`が`up`を戻す列であることをassertする。実DBへの接続は使わない。
    -   testは所有機能の`test/server/persistence/`に置く。C0・C1の両方を測り、各script全体のstatementとbranchが届くようにする。
    -   完了時には、migration scriptが単体testで読み込まれ、C0・C1が100%になり、`missing-raw-record`で止まらない。
    -   _Requirements: 9.9_
    -   _Boundary: Unit Tests for Migrations_
    -   _Verification: `npm run test:server:coverage`のmigrationの未到達0件_
    -   _Depends: 9.9_

-   [x] 12.3 operator層の未到達の箇所に単体testを足す

    -   `src/model/operator/`の録画済み番組（`RecordedManageModel`、`RecordedPlaybackSourceProvider`、`RecordedUploadAdoptionModel`）、録画
        （`RecordingUtilModel`、`RecorderModel`、`RecordingManageModel`、`RecordingStreamCreator`）、予約、保存先、外部commandの未到達のstatementとbranchを、
        単体test（spec・imp）で通す。
    -   完了時には、対象fileのC0・C1が単体testだけで100%になる。
    -   _Requirements: 9.9_
    -   _Boundary: Unit Tests for Operators_
    -   _Verification: `npm run test:server:coverage`の対象fileの未到達0件_
    -   _Depends: 9.9, 12.2_

-   [x] 12.4 DI組立、child登録、IPC、起動、管理commandの未到達の箇所に単体testを足す

    -   `ModelContainerSetter`、`ServiceChildRecordedUseRegistry`、`IPCServer`、`index.ts`、`Configuration`、`ConfigurationFileAccess`、`DBTools`、
        `V1MigrationTool`、`FileUtil`、`StartupContinuationCoordinator`の未到達のstatementとbranchを、単体test（spec・imp）で通す。
    -   完了時には、対象fileのC0・C1が単体testだけで100%になる。
    -   _Requirements: 9.9_
    -   _Boundary: Unit Tests for Composition and Startup_
    -   _Verification: `npm run test:server:coverage`の対象fileの未到達0件_
    -   _Depends: 9.9, 12.2_

-   [x] 12.5 service・stream・APIの未到達の箇所に単体testを足す

    -   `src/model/service/`（`ServiceServer`、`api`、`stream`、`encode`）と`src/model/api/`（`schedule`、`encode`、`video`、`stream`）の未到達の
        statementとbranchを、単体test（spec・imp）で通す。
    -   完了時には、対象fileのC0・C1が単体testだけで100%になる。
    -   _Requirements: 9.9_
    -   _Boundary: Unit Tests for Services and API Models_
    -   _Verification: `npm run test:server:coverage`の対象fileの未到達0件_
    -   _Depends: 9.9, 12.2_

-   [x] 12.6 server全体のC0・C1の判定を閉じる

    -   `npm run test:server:coverage`（spec・impのcoverage）と`npm run test:server:integration`（coverageなし）が、ともに全件成功し、
        `src/**`のC0・C1が単体testだけで100%であることを確かめる。未到達が残る場合は、箇所・理由・保守者の判断を記録し、本leafを完了としない。
    -   完了時には、Node.js 24の回が「単体coverage一度＋結合一度」で成立し、各機能のサーバーテストの品質判定の前提（Requirement 9 Acceptance Criterion 9）が満たされる。
    -   _Requirements: 9.9_
    -   _Boundary: Server-wide Quality Judgment_
    -   _Verification: Node.js 24のcell（run-node-acceptance-matrix.mjs）_
    -   _Depends: 12.1, 12.2, 12.3, 12.4, 12.5_

-   [x] 13. coverageの除外の承認を、除外したcodeと周りのcodeの中身へ結び付ける

Major 13はDesign §12.3.1を実装する。product code（`src/**`）は変更せず、除く箇所と件数（16 file、statement 67件、branch 20件）を
変えない。

-   [x] 13.1 commentや無関係な変更で落ちないこと、codeの変更で落ちることのtestを先に書き、今の実装で前者が落ちることを確かめる

    -   `compiled-snapshot-coverage.test.ts`に、実際の`VideoUtil.ts`と`ReservationManageModel.ts`（同じ単位に同じcode`0`の除外が3箇所ある）
        のsourceを書き換えたものを`ts.transpileModule`（`tsconfig.json`の設定）でcompileし、discoveryに通すcaseを足す。
    -   落ちてはならないcase: 除外を含む単位の中へcomment行を足す、fileの先頭へcommentを足す、除外のある行の空白と改行を変える、
        改行に伴って末尾のcommaを付け外しする、除外を含まない別のmemberをclassへ足す（行とbyte位置がずれる）。どれも承認が有効のまま、
        書き換え前と同じcodeのentryが除かれ、母数がその分だけ減ることをassertする。
    -   落ちるべきcase: 除外のspanのcodeを変える、除外を含む単位の別のcodeを変える、根拠として結び付ける単位のcodeを変える。どれも
        `malformed-coverage-exclusion`で失敗することをassertする。
    -   今の実装（file全体のdigestと位置を含むID）で、落ちてはならないcaseがすべて`malformed-coverage-exclusion`で落ち（RED）、落ちる
        べきcaseが失敗することを実行して記録する。
    -   完了時には、追加したcaseのうち落ちてはならないcaseだけが今の実装でREDであり、その出力が記録に残る。
    -   _Requirements: 9.11, 9.12_
    -   _Boundary: Coverage Measurement Toolchain_
    -   _Verification: unittest/spec（RED）_
    -   _Depends: 12.6_

-   [x] 13.2 token列、関数の単位、承認の解決を実装する

    -   Design §12.3.1のとおり、parserのASTの葉からtoken列を作り（comment・JSDoc・空白・改行と、閉じ括弧の直前のcommaを除く）、関数の
        単位の名前と`codeSha256`を求め、basis entryごとのkeyとanchorの解決を実装する。statementとbranchは独立に解決する。
    -   承認を引数に取って解決する関数と、sourceとbasis entryからkey・code・各単位の`codeSha256`を返す関数をexportする。
    -   この関数を使い、合成した承認で、解決が0件のcase（basisに無いspan）と2件以上のcase（constructorのparameter propertyのように
        2つのdist spanが同じsourceの範囲へ対応するsource map）、単位の名前が0件・2件以上のcase、`code`が表と食い違うcaseが
        `malformed-coverage-exclusion`で失敗し、messageに件数・単位の名前・今の`codeSha256`が出ることをassertするtestを先に書き、
        REDを確かめてから実装する。
    -   markerの検査（未知のmarker、2個以上、末尾でない、形の違い、別fileのmarker）は今の規則とtestのまま保つ。
    -   完了時には、13.1の落ちてはならないcaseがGREENになり、落ちるべきcase、0件・2件以上のcase、markerのcaseがすべて期待どおり
        失敗し、`compiled-snapshot-coverage.test.ts`が全件成功する。
    -   _Requirements: 9.10, 9.11, 9.12, 9.13_
    -   _Boundary: Coverage Measurement Toolchain_
    -   _Verification: unittest/spec_
    -   _Depends: 13.1_

-   [x] 13.3 今の承認16件を新しい形へ移し、除く対象と件数が変わらないことを確かめる

    -   13.2でexportした関数を使い、実際のcompiled snapshotで位置IDが指すbasis entryからanchor（単位の名前、token位置、`code`）を
        求めて`statementAnchors`・`branchAnchors`にする。anchorの単位と、各承認の根拠のcommentが引く同じfileの箇所を含む単位を
        `boundFunctions`に入れ、`codeSha256`を記録する。
    -   位置IDとanchorを並べた状態で、16 fileそれぞれについて、除かれるentryの集合（distのoffsetの組）が位置IDとanchorで一致し、母数（statementと
        branchの総数）と除く件数（statement 67件、branch 20件）が一致することを実行して記録してから、位置IDと`markerlessSourceSha256`を
        表とtestから除く。
    -   根拠のcommentが行番号で引いている箇所は、単位の名前で引く形に直す（除外の理由の内容は変えない）。
    -   除外表の承認数（16）とanchorの総数（67・20）をassertするtestを置く。
    -   完了時には、表の各承認が新しい形だけを持ち、位置IDとanchorの一致の記録が残り、`compiled-snapshot-coverage.test.ts`が全件成功する。
    -   _Requirements: 9.10_
    -   _Boundary: Coverage Measurement Toolchain_
    -   _Verification: unittest/spec、位置IDとanchorの除外の集合の一致の記録_
    -   _Depends: 13.2_

-   [x] 13.4 coverageの判定を流し、C0・C1 100%と除く件数を確かめる

    -   `npm run test:server:coverage`を流し、全testが成功し、`src/**`のC0・C1がともに100%であることを確かめる。
    -   解決はanchorごとにちょうど1件を除き、それ以外では失敗するため、判定の成功は除く件数が67件・20件であることを含む。この
        関係と、13.3の件数のtestの成功を合わせて記録する。
    -   完了時には、coverageの判定が成功し、C0・C1が100%で、除く件数が移行前と同じであることが記録に残る。
    -   _Requirements: 9.9, 9.10_
    -   _Boundary: Server-wide Quality Judgment_
    -   _Verification: `npm run test:server:coverage`_
    -   _Depends: 13.3_

-   [x] 14. test・coverageの判定・Node.js matrix・preflightの合否をgitの状態から切り離す

Major 14はDesign §12.3.2を実装する。treeのidは「何を検証したか」の記録として残し、合否の条件にしない。

-   [x] 14.1 作業場所の中身の記録をtestから作る

    -   新規`test/server/application-runtime/spec/worktree-content.spec.test.ts`に、`test/server/.artifacts/`の下に作った一時の
        git repositoryで次をassertするcaseを先に書く: cleanなら`contentTree === headTree`・`uncommittedChanges === false`、追跡中の
        fileを変えると`contentTree`が変わり`true`、ignoreされていない未追跡のfileを含み、ignoreされたfileを含まない、実行の前後で
        `git status --porcelain`の出力とindexが変わらない、git repositoryでなければ各fieldが`null`、commandとして実行すると
        `contentTree`を1行で出力する。
    -   testのgitのcommitはidentityを環境変数（`GIT_AUTHOR_*`・`GIT_COMMITTER_*`）で渡し、利用者のgitの設定に依らない。
    -   moduleが無い状態でREDを確かめてから、新規`scripts/server-test/worktree-content.mjs`を実装する（一時indexは
        `test/server/.artifacts/worktree-content/`の下に置き、使い終えたら消す）。
    -   完了時には、追加したcaseがすべて成功し、利用者のindex・作業file・refが変わらないことがtestで確かめられている。
    -   _Requirements: 9.14, 9.15, 9.16_
    -   _Boundary: Worktree Content Record_
    -   _Verification: unittest/spec_
    -   _Depends: 13.4_

-   [x] 14.2 coverageのrunを未commitの変更で失敗させず、中身を記録する

    -   `coverage-command-terminal.test.ts`と`compiled-snapshot-coverage.test.ts`に、未commitの変更がある記録（`uncommittedChanges:
        true`、`contentTree !== headTree`）でcoverageのrunと`writeCanonicalCoverageArtifacts`を通し、失敗せずにartifactを書き、
        `coverage-final.binding.json`に`worktreeContent`が入ることをassertするcaseと、gitが使えない記録（各field`null`）でも判定が
        続くcaseを先に書く。今の実装で`dirty-worktree`（または`worktreeDirty`の欠落）で落ちること（RED）を記録する。
    -   `run-tests.mjs`の`currentWorktreeDirty`・`currentTreeDigest`を`snapshotWorktreeContent`に替え、`writeCanonicalCoverageArtifacts`
        の`worktreeDirty`と`dirty-worktree`を除き、binding sidecarの`treeDigest`を`worktreeContent`に置き換え、registryの照合の値に
        `contentTree ?? 'unrecorded'`を渡す。`dirty-worktree`を期待する既存のcaseは、記録を確かめるcaseに置き換える。
    -   `run-coverage-gate-cli.mjs`のcommentから、未commitの変更で失敗するという説明を除く（挙動は変えない）。
    -   完了時には、追加したcaseがGREENになり、`dirty-worktree`がsourceとtestから無くなり、coverageの道具のtest 5本が全件成功する。
    -   _Requirements: 9.14, 9.15_
    -   _Boundary: Coverage Measurement Toolchain_
    -   _Verification: unittest/spec_
    -   _Depends: 14.1_

-   [x] 14.3 Node.js matrixの候補を作業場所の中身から決め、gitの状態で失敗させない

    -   `coverage-command-terminal.test.ts`に、注入した`git`が未commitの変更とHEADと違うtreeを返す状態で`runNodeAcceptanceMatrixCli`
        が失敗せず、artifactに`candidate: { tree, source: 'worktree', headTree, uncommittedChanges: true }`を記録するcase、
        `--candidate`を渡したときに`source: 'argument'`でそのtreeを使いHEADと比べないcase、`--candidate`無しの引数を
        `parseNodeAcceptanceMatrixArguments`が受け付けるcase、候補のtreeを取り出せないときに`materialize-failed`で失敗するcaseを
        先に書く。今の実装で前の3つが`dirty-worktree`・`candidate-mismatch`・必須の`--candidate`で落ちること（RED）を記録する。
    -   `run-node-acceptance-matrix.mjs`の`dirty-worktree`・`candidate-mismatch`を除き、`--candidate`を任意にし、無ければ
        `snapshotWorktreeContent`の`contentTree`を候補にする。workspaceの作り方は変えない。
    -   完了時には、追加したcaseがGREENになり、node-matrixのsourceにHEADとの一致や未commitの変更を合否の条件にする箇所が無い。
    -   _Requirements: 9.14, 9.16_
    -   _Boundary: Coverage Command・Node.js Acceptance Matrix_
    -   _Verification: unittest/spec_
    -   _Depends: 14.1_

-   [x] 14.4 preflightと模擬runnerを、開始時に一度だけ決めた中身で回す

    -   `scripts/release-preflight.sh`を、開始時に`node scripts/server-test/worktree-content.mjs`で`CANDIDATE`を求め、log directoryと
        `summary.tsv`の`tree=`に使い、HEADのtreeと未commitの変更の有無をlogへ出し、node-matrixへ`--candidate $CANDIDATE`、
        模擬runnerを使うstepへ`tree:$CANDIDATE`を渡す形にする。「node-matrix requires a clean tree」の警告を除く。
    -   `scripts/ci-rehearsal/job.sh`に`tree:<tree id>`の形を足す（親の無いcommitを一時ref経由でbundleにして渡し、一時refを消し、
        containerの中で`HEAD^{tree}`が指定のtreeと一致することを確かめる）。`tree:`のときはworkflowのstepとimageのdigestの期待値を
        `git show <tree>:<path>`で開始時のtreeから読み、そのために`scripts/ci-rehearsal/image-digest.mjs`に`--tree <tree id>`を足す。
        一時refの削除は後始末なので、失敗してもstepを失敗させない。`local`と`<sha>`は変えない。
    -   新規`test/server/application-runtime/spec/image-digest.spec.test.ts`で、作業場所から求めたdigestと`--tree`で求めたdigestが同じ中身で
        一致すること、作業場所の入力fileを書き換えても`--tree`のdigestが変わらないことをassertする。
    -   確認の前に`bash scripts/ci-rehearsal/setup.sh`で模擬container（既定`epgs-runner-rehearsal`）を用意する。
    -   未commitの変更（`src/**`以外の無害な変更）がある作業場所で、`bash scripts/release-preflight.sh --only deps-prepare`と
        `scripts/ci-rehearsal/job.sh tree:<CANDIDATE> 24.18.0 server-check -`を実行し、どちらも成功し、`summary.tsv`の`tree=`と
        containerの`HEAD^{tree}`が`CANDIDATE`と一致することを確かめる。確かめた後に作業場所の変更を手で戻す（gitのcheckout・restore・
        stashを使わない）。
    -   完了時には、未commitの変更がある作業場所でpreflightのstepが失敗せず、全stepが同じ`CANDIDATE`を記録する。
    -   _Requirements: 9.14, 9.17_
    -   _Boundary: Preflight Steps_
    -   _Verification: `bash scripts/release-preflight.sh --only deps-prepare`、`scripts/ci-rehearsal/job.sh tree:<CANDIDATE> 24.18.0 server-check -`_
    -   _Depends: 14.1, 14.3_

-   [x] 14.5 未commitの変更がある作業場所でNode.js matrixを流し、中身で合否が決まることを確かめる

    -   除外のある単位（例: `RecorderModel.doRecord`）の中のcommentを1行だけ変え、commitしない状態で、`--candidate`を付けずに
        `node scripts/server-test/run-node-acceptance-matrix.mjs`をtransient systemd user unitとして流す。
    -   Node.js 24の回でcoverageの判定（C0・C1 100%、除外の解決）と結合test、Node.js 26の回でserver test全件が成功し、artifactの
        `candidate`に`source: 'worktree'`・`uncommittedChanges: true`と、comment変更を含む中身の`tree`が記録されることを確かめる。
        確かめた後にcommentを手で戻す（gitのcheckout・restore・stashを使わない）。
    -   完了時には、commentだけを変えた未commitの作業場所でNode.js matrixが成功し、検証した中身がartifactに記録されている。
    -   _Requirements: 9.12, 9.14, 9.16_
    -   _Boundary: Server-wide Quality Judgment_
    -   _Verification: Node.js 24・26のcell（run-node-acceptance-matrix.mjs、`--candidate`無し）_
    -   _Depends: 13.4, 14.2, 14.3_

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Test type                                                                                                                      | Local Depends                | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | `package.json`<br>`package-lock.json`<br>`vitest.server.config.ts` | 各層のtest | `なし（共有foundationのみ）` | `npm run test:server` |
| 1.2  | `package.json`<br>`package-lock.json`<br>`vitest.server.config.ts`<br>`scripts/server-test/build.mjs`<br>`scripts/server-test/compiled-snapshot.mjs`<br>`scripts/server-test/process.mjs`<br>`scripts/server-test/run-tests.mjs`<br>`scripts/server-test/test-selection.mjs`<br>`test/server/.gitignore` | `command contract test, fail-closed coverage smoke（全domain suite収束までthreshold未達exit 1）` | `1.1`                        | `npm run test:server:coverage` |
| 1.3  | `test/server/harness/async.ts` | `unittest/imp`（後続domain testが使う） | `1.1`                        | `npm run test:server:imp` |
| 1.4  | `test/server/harness/child-process.ts`<br>`test/server/harness/fixtures/child-scenarios.ts` | `integration`（後続domain testが使う） | `1.1`                        | `npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts` |
| 1.5  | `.devcontainer/epgstation/Dockerfile`<br>`Dockerfile.alpine`<br>`Dockerfile.debian`<br>`README.md`<br>`mise.toml`<br>`package.json`<br>`package-lock.json`<br>`scripts/server-test/compiled-snapshot.mjs`<br>`scripts/server-test/run-tests.mjs`<br>`src/model/service/api/streams/live/{channelId}/m2ts.ts`<br>`src/model/service/api/streams/live/{channelId}/m2tsll.ts`<br>`src/model/service/api/streams/live/{channelId}/mp4.ts`<br>`src/model/service/api/streams/live/{channelId}/webm.ts`<br>`src/model/service/api/streams/recorded/{videoFileId}/mp4.ts`<br>`src/model/service/api/streams/recorded/{videoFileId}/webm.ts`<br>`src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`test/server/harness/child-process.ts`<br>`test/server/harness/startup-retry.ts`<br>`test/server/integration/application-runtime/startup-smoke.integration.test.ts` | `Node.js 24 mandatory foundation cell（coverageの判定は9.9がDesign §12.4の形で扱う）` | `1.2, 1.3, 1.4`              | `mise exec node@24 -- npm ci`<br>`mise exec node@24 -- npm run build-server`<br>`mise exec node@24 -- npm run test:server`<br>`mise exec node@24 -- npm run test:server:integration -- test/server/integration/application-runtime/startup-smoke.integration.test.ts` |
| 1.6  | `mise.toml`<br>`test/server/integration/application-runtime/startup-smoke.integration.test.ts` | `Node.js 26 additional foundation cell` | `1.5`                        | `mise exec node@26 -- npm ci`<br>`mise exec node@26 -- npm run build-server`<br>`mise exec node@26 -- npm run test:server`<br>`mise exec node@26 -- npm run test:server:integration -- test/server/integration/application-runtime/startup-smoke.integration.test.ts` |
| 2.1  | `test/server/application-runtime/startup-preparation.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `unittest/spec, unittest/imp, isolated entrypoint characterization`                                                            | `1.6`                        | `npm run test:server:spec -- test/server/application-runtime/startup-preparation.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.2  | `test/server/application-runtime/startup-preparation.spec.test.ts`<br>`test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `unittest/spec, isolated child-process fault matrix`                                                                           | `2.1`                        | `npm run test:server:spec -- test/server/application-runtime/startup-preparation.spec.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                    |
| 3.1  | `test/server/application-runtime/dependency-wait.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec, unittest/imp, fake-clock characterization`                                                                     | `2.2`                        | `npm run test:server:spec -- test/server/application-runtime/dependency-wait.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3.2  | `test/server/application-runtime/dependency-wait.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `unittest/spec, deferred-promise regression, fake clock`                                                                       | `3.1`                        | `npm run test:server:spec -- test/server/application-runtime/dependency-wait.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4.1  | `test/server/application-runtime/operator-composition.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec, unittest/imp, composition characterization`                                                                    | `3.2`                        | `npm run test:server:spec -- test/server/application-runtime/operator-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4.2  | `test/server/application-runtime/operator-composition.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`test/server/application-runtime/storage-pressure-deletion.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `unittest/spec RED, unittest/imp GREEN, storage-pressure-deletion integration`                                                 | `4.1`                        | `npm run test:server:spec -- test/server/application-runtime/operator-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/storage-pressure-deletion.integration.test.ts`                                                                                                                                                                                                                                                                                    |
| 5.1  | `test/server/application-runtime/service-child-supervision.spec.test.ts`<br>`test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `unittest/spec, compiled child-process characterization`                                                                       | `4.2`                        | `npm run test:server:spec -- test/server/application-runtime/service-child-supervision.spec.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                              |
| 5.2  | `test/server/application-runtime/service-child-supervision.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `unittest/spec, unittest/imp, bounded child supervisor characterization`                                                       | `5.1`                        | `npm run test:server:spec -- test/server/application-runtime/service-child-supervision.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6.1  | `test/server/application-runtime/startup-composition.spec.test.ts`<br>`test/server/application-runtime/startup-composition.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `unittest/spec, provider contract integration`                                                                                 | `5.2`                        | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/startup-composition.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                               |
| 6.2  | `test/server/application-runtime/startup-composition.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `unittest/spec RED, unittest/imp GREEN, fake-clock race regression`                                                            | `6.1`                        | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6.3  | `test/server/application-runtime/startup-composition.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `unittest/spec RED, unittest/imp GREEN, startup handoff contract`                                                              | `6.2`                        | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7.1  | `test/server/application-runtime/startup-composition.integration.test.ts` | compiled child-process integration | `6.3`                        | `npm run test:server:integration -- test/server/application-runtime/startup-composition.integration.test.ts` |
| 7.2  | `test/server/application-runtime/child-supervision.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `unittest/spec, unittest/imp, table-driven child characterization`                                                             | `7.1`                        | `npm run test:server:spec -- test/server/application-runtime/child-supervision.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8.1  | `test/server/application-runtime/startup-composition.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `unittest/spec, unittest/imp, compiled runtime integration, fake clock`                                                        | `4.2, 5.2, 6.3, 7.1, 7.2`    | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                |
| 8.2  | `test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `compiled child-process integration, operational-log spy`                                                                      | `5.2, 7.2, 8.1`              | `npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8.3  | `test/server/application-runtime/startup-composition.integration.test.ts`<br>`test/server/application-runtime/storage-pressure-deletion.integration.test.ts`<br>`test/server/application-runtime/user-whole-recorded-deletion.integration.test.ts`<br>`test/server/application-runtime/individual-video-file-deletion.integration.test.ts`<br>`test/server/application-runtime/encode-completion-binding.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `approved exact integration locators`                                                                                          | `8.1, 8.2`                   | `npm run test:server:integration -- test/server/application-runtime/startup-composition.integration.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/storage-pressure-deletion.integration.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/user-whole-recorded-deletion.integration.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/individual-video-file-deletion.integration.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/encode-completion-binding.integration.test.ts` |
| 9.3  | `test/server/application-runtime/startup-composition.spec.test.ts`<br>`test/server/application-runtime/child-supervision.spec.test.ts`<br>`test/server/application-runtime/operator-composition.spec.test.ts` | `unittest/spec` | `8.3` | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/child-supervision.spec.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/operator-composition.spec.test.ts` |
| 9.4  | `test/server/application-runtime/imp/runtime-characteristics.test.ts` | `unittest/imp` | `9.3` | `npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts` |
| 9.5  | `.kiro/specs/server-application-runtime/design.md` | レビュー | `9.4` | なし（Design §14の全行のレビュー） |
| 9.6  | `test/server/application-runtime/integration/runtime-boundaries.integration.test.ts` | `integration` | `9.5` | `npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts` |
| 9.7  | `test/server/application-runtime/*.spec.test.ts`<br>`test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`test/server/application-runtime/integration/runtime-boundaries.integration.test.ts` | `unittest/spec`<br>`unittest/imp`<br>`integration` | `9.6, 12.6` | `npm run test:server:spec -- test/server/application-runtime/startup-composition.spec.test.ts`<br>`npm run test:server:imp -- test/server/application-runtime/imp/runtime-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/application-runtime/integration/runtime-boundaries.integration.test.ts` |
| 9.8  | `test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts`<br>`test/server/application-runtime/spec/coverage-command-terminal.test.ts`<br>`test/server/application-runtime/spec/coverage-raw-flush.spec.test.ts`<br>`test/server/application-runtime/spec/run-coverage-gate-cli.test.ts` | `unittest/spec` | `8.3` | `npm run test:server:spec -- test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/spec/coverage-command-terminal.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/spec/coverage-raw-flush.spec.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/spec/run-coverage-gate-cli.test.ts` |
| 9.9  | `scripts/server-test/run-tests.mjs`<br>`scripts/server-test/run-node-acceptance-matrix.mjs`<br>`scripts/server-test/compiled-snapshot-coverage.mjs`<br>`test/server/harness/coverage-transform-capture.ts` | `unittest/spec` | `9.8` | `npm run test:server:coverage` |
| 10.1 | `scripts/server-test/dependency-images.mjs`<br>`scripts/server-test/prepare-dependency-images.mjs`<br>`scripts/ci-rehearsal/deps-image-tags.mjs`<br>`test/server/application-runtime/docker-dependency-images.spec.test.ts` | `unittest/spec` | なし | `npm run test:server:spec -- test/server/application-runtime/docker-dependency-images.spec.test.ts` |
| 10.2 | `scripts/server-test/docker-image-check.mjs`<br>`test/server/application-runtime/docker-dependency-images.spec.test.ts` | `unittest/spec` | `10.1` | `npm run test:server:spec -- test/server/application-runtime/docker-dependency-images.spec.test.ts` |
| 10.3 | `scripts/server-test/docker-image-check.mjs`<br>`test/server/application-runtime/docker-image.integration.test.ts` | `integration` | `10.2` | `npm run test:server:integration -- test/server/application-runtime/docker-image.integration.test.ts` |
| 10.4 | `scripts/server-test/serialized-real-process-files.mjs`<br>`scripts/server-test/run-tests.mjs`<br>`scripts/server-test/run-node-acceptance-matrix.mjs`<br>`scripts/ci-rehearsal/job.sh`<br>`scripts/ci-rehearsal/setup.sh` | 直列実行の経路の確認 | `10.3` | `scripts/ci-rehearsal/job.sh local 24 serialized integration/application-runtime/docker-image.integration.test.ts` |
| 10.5 | `scripts/release-preflight.sh`<br>`scripts/preflight-clean-stale-containers.sh` | preflightのstepの実行 | `10.4` | `bash scripts/release-preflight.sh --only deps-prepare`<br>`bash scripts/release-preflight.sh --only docker-gate-node24` |
| 10.6 | `scripts/server-test/`の削除対象のscript<br>`test/server/release-certification/`の削除対象のtest<br>`package.json`<br>`scripts/server-test/test-selection.mjs`<br>`scripts/server-test/process.mjs`<br>`scripts/server-test/compiled-snapshot.mjs` | 参照の検索、`npm run test:server` | `10.5, 9.9` | `npm run test:server` |
| 11.1 | `.github/workflows/docker.yml` | レビュー | `11.3` | `actionlint .github/workflows/docker.yml`（使える場合） |
| 11.2 | `.github/workflows/docker.yml` | 実装時の確認 | `11.1` | `Docker tags`のstepの`run`を4通りの`GITHUB_REF`・`DISTRO`で実行 |
| 11.3 | `tools/check-tracked-secrets.py` | 実装時の確認 | なし | `python3 tools/check-tracked-secrets.py`（stageした例で） |
| 12.1 | `src/model/db/`の未到達のfileに対応する単体test | `unittest/spec`<br>`unittest/imp` | `9.9, 12.2` | `npm run test:server:coverage` |
| 12.2 | `src/db/migrations/**`に対応する単体test | `unittest/imp` | `9.9` | `npm run test:server:coverage` |
| 12.3 | `src/model/operator/`の未到達のfileに対応する単体test | `unittest/spec`<br>`unittest/imp` | `9.9, 12.2` | `npm run test:server:coverage` |
| 12.4 | 組立・child登録・IPC・起動・管理commandの未到達のfileに対応する単体test | `unittest/spec`<br>`unittest/imp` | `9.9, 12.2` | `npm run test:server:coverage` |
| 12.5 | `src/model/service/`・`src/model/api/`の未到達のfileに対応する単体test | `unittest/spec`<br>`unittest/imp` | `9.9, 12.2` | `npm run test:server:coverage` |
| 12.6 | なし（判定のみ） | Node.js 24のcell | `12.1, 12.2, 12.3, 12.4, 12.5` | `node scripts/server-test/run-node-acceptance-matrix.mjs` |
| 13.1 | `test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` | `unittest/spec`（RED） | `12.6` | `npm run test:server:spec -- test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` |
| 13.2 | `scripts/server-test/compiled-snapshot-coverage.mjs`<br>`test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` | `unittest/spec` | `13.1` | `npm run test:server:spec -- test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` |
| 13.3 | `scripts/server-test/compiled-snapshot-coverage.mjs`<br>`test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` | `unittest/spec`、位置IDとanchorの一致の記録 | `13.2` | `npm run test:server:spec -- test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` |
| 13.4 | なし（判定のみ） | coverageの判定 | `13.3` | `npm run test:server:coverage` |
| 14.1 | `scripts/server-test/worktree-content.mjs`<br>`test/server/application-runtime/spec/worktree-content.spec.test.ts` | `unittest/spec` | `13.4` | `npm run test:server:spec -- test/server/application-runtime/spec/worktree-content.spec.test.ts` |
| 14.2 | `scripts/server-test/run-tests.mjs`<br>`scripts/server-test/compiled-snapshot-coverage.mjs`<br>`scripts/server-test/run-coverage-gate-cli.mjs`<br>`test/server/application-runtime/spec/coverage-command-terminal.test.ts`<br>`test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` | `unittest/spec` | `14.1` | `npm run test:server:spec -- test/server/application-runtime/spec/coverage-command-terminal.test.ts`<br>`npm run test:server:spec -- test/server/application-runtime/spec/compiled-snapshot-coverage.test.ts` |
| 14.3 | `scripts/server-test/run-node-acceptance-matrix.mjs`<br>`test/server/application-runtime/spec/coverage-command-terminal.test.ts` | `unittest/spec` | `14.1` | `npm run test:server:spec -- test/server/application-runtime/spec/coverage-command-terminal.test.ts` |
| 14.4 | `scripts/release-preflight.sh`<br>`scripts/ci-rehearsal/job.sh`<br>`scripts/ci-rehearsal/image-digest.mjs`<br>`test/server/application-runtime/spec/image-digest.spec.test.ts` | preflightのstepと模擬runnerの実行 | `14.1, 14.3` | `bash scripts/release-preflight.sh --only deps-prepare`<br>`scripts/ci-rehearsal/job.sh tree:<CANDIDATE> 24.18.0 server-check -` |
| 14.5 | なし（判定のみ） | Node.js 24・26のcell | `13.4, 14.2, 14.3` | `node scripts/server-test/run-node-acceptance-matrix.mjs` |

## Implementation Notes

- 9.4: `imp/runtime-characteristics.test.ts` には Requirement 9 Acceptance Criterion 4 が求める種類の case（root・非root、user・groupの指定と省略、依存先確認の失敗回数、tuner情報取得の成功・失敗、600秒の境界、Service child・EPG child の最初の terminal event ごとの再起動分岐）が無かったため、marker を付けるだけでなく、compiled の製品を注入した port で実行する case として足した。
