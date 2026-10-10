# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation と Node.js 24 必須・26 追加 matrix は `server-application-runtime` が所有する。該当
foundation task group 完了後に本 spec を実行し、共有 runner、test root、coverage command、CI matrix を重複作成しない。本
spec は Web・API・リアルタイム通知提供機能固有の `unittest/spec`、`unittest/imp`、および HTTP・multipart・Socket.IO 結合
test だけを追加する。

本 spec の実装前に、次の owner 契約が利用できることを前提とする。

-   `server-configuration`: `concurrentUploadNum` と `uploadReceiveTimeoutMs` の既定値、範囲検証、および完全な起動時
    snapshot
-   各 domain spec: 番組、予約、Rule、録画、録画済み番組、Thumbnail、Encode、容量、および映像配信の業務 port
-   `server-process-messaging`: upload 登録要求、既存 wire、10分の呼出し側期限、late reply 処理、および録画済みresource
    利用leaseとcurrent-generation snapshotの内部carrier。uploadでは二値dispatch disposition、atomic adoption後だけの
    acknowledgment、request/reply identityを提供する
-   `server-recorded-content`: parent側のexact incoming grammar・token検証、exclusive adopted directory、raw
    `node:fs.rename`によるsame-filesystem atomic adoption、adopted/final destinationのowner cleanup、保存先移動と登録、
    および録画file再生source provider
-   `server-media-delivery`: HLS file の生成、stream ID、成果物 cleanup、および録画file再生sourceのconsumer port
-   `server-iptv-export`: M3U8・XMLTV の対象、並び、文字変換、および byte 単位の出力
-   `server-event-and-hook-delivery`: 画面再取得通知の service 側への受け渡し

本 spec は HTTP・HTTPS listener、公開 route と OpenAPI、request validation、response・error・range、static 公開、upload
の HTTP admission・body lifecycle・一時 file cleanup、および Socket.IO wire の200ミリ秒集約を所有する。業務結果、IPC
ID・timer、IPTV 文書の byte 列、HLS lifecycle、子 process の spawn・restart・全体 shutdown は各 owner に残す。外部 spec
の task ID は local `_Depends:` に記載しない。

すべてのproduction変更leafは同じactionable checkbox内で、同じtargetに対するRED testを追加して意図した理由の失敗を確認
し、最小productionを実装し、同じtestをGREENにしてobservable completionまで閉じる。RED-onlyまたはimplementation-onlyの
checkpointを残さない。characterization leafはGREEN-onlyの前提証拠としてproduction差分0件で閉じる。最終回帰開始後は
productionを変更しない。

`server-iptv-export` Task 2.3と本spec Task 2.4は、同一production treeを一つのrevisionで変更するatomic cross-spec
checkpointである。IPTV側だけを先にtyped interfaceへ移行してcallerをcompile REDにしてはならない。両taskの変更、全
production TypeScript compile、IPTV fake builder suite、および実HTTP carrier integrationが同一revisionでGREENになるまで
どちらも完了扱いにせず、RED状態をcheckpointとして残さない。本Task 2.4はTask 1.3のURL characterizationを前提に実行する。

公開 API runtime の method、path、入力、status、body、header、error、および既存 wire は変更しない。production 修正は
`api.yml` の予約一覧四配列と `viodeFileId` の二つの文書不一致、承認済み upload lifecycle差分、およびDesign 6.3・9のtyped
`IptvPublicUrlBuilder` caller bindingに限定する。IPTVの文書内容生成規則を再実装しない。uploadへfile size上下限、合計byte
上限、待機queue、公開設定項目、公開schema変更を追加しない。

Task 2.1〜2.3 の `(P)` は、route 機能群ごとに独立した contract fixture と test module を作り、共有 runtime source を変更
しない characterization に限定する。Task 2.4は上記atomic checkpointをTDDで閉じる実装leafである。共通inventoryへの統合は
Task 8.1で行う。

## Concrete target map

各leafは次のproduction/test targetだけを扱う。globは承認Designの同一責任内にある既存route群またはnamed test群を表し、別
ownerのdomain実装を含まない。

| Leaf    | Concrete target files                                                                                                                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1     | `src/model/service/ServiceServer.ts`、`src/model/service/stream/base/StreamBaseModel.ts`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                       |
| 1.2     | `src/model/service/ServiceServer.ts`、`src/model/api/config/ConfigApiModel.ts`、`api.yml`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                      |
| 1.3     | `src/model/service/api.ts`、`src/model/api/ApiUtil.ts`、`src/model/api/video/VideoApiModel.ts`、`test/server/service-interface/imp/public-url.test.ts`                                                                                                                                                                       |
| 2.1     | `src/model/service/api/{channels,schedules,programs,reserves,rules,recording}/**`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                              |
| 2.2     | `src/model/service/api/{recorded,videos,thumbnails}/**`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                                                        |
| 2.3     | `src/model/service/api/{encode,storage,streams}/**`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                                                            |
| 2.4     | `src/model/service/api/iptv/{channel.m3u8,epg.xml}.ts`、`src/model/api/iptv/IIPTVApiModel.ts`、`test/server/service-interface/{imp/iptv-carrier.test.ts,integration/service-interface.integration.test.ts}`                                                                                                                  |
| 3.1–3.2 | `api.yml`、`api.d.ts`、`src/model/api/{reserve,stream,config}/**`、`src/model/service/api/{rules,recording}/**`、`test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                |
| 4.1–4.3 | `src/model/service/{ServiceServer.ts,api.ts}`、`test/server/service-interface/{public-contract.spec.test.ts,imp/service-interface-characteristics.test.ts,api-responsefile-directory.imp.test.ts,api-response-guards.imp.test.ts,integration/service-interface.integration.test.ts}`                                                                                                                                    |
| 5.1–5.7 | `src/model/service/{ServiceServer.ts,upload/UploadAdmissionController.ts,api/videos/upload.ts}`、`test/server/service-interface/{upload.spec.test.ts,imp/upload-lifecycle.test.ts,integration/service-interface.integration.test.ts}`                                                                                        |
| 6.1–6.3 | `src/model/service/socketio/SocketIOManageModel.ts`、`test/server/service-interface/{realtime.spec.test.ts,imp/realtime-notifier.test.ts,integration/service-interface.integration.test.ts}`                                                                                                                                 |
| 7.1–7.2 | `src/model/service/ServiceServer.ts`、`test/server/service-interface/{listener.spec.test.ts,integration/service-interface.integration.test.ts}`                                                                                                                                                                              |
| 8.1–8.5 | `src/model/ModelContainerSetter.ts`、`test/server/service-interface/{public-contract.spec.test.ts,upload.spec.test.ts,realtime.spec.test.ts,listener.spec.test.ts,integration/service-interface.integration.test.ts,recorded-resource-use-binding.integration.test.ts,recorded-playback-source-binding.integration.test.ts}` |
| 9.2・9.4・9.5 | `test/server/service-interface/{imp/*.test.ts,integration/service-interface.integration.test.ts}` |

-   [x] 1. Static 配信・公開情報・外部 URL の既存契約を固定する
-   [x] 1.1 Static root、subDirectory、および HLS 公開 path を characterization する

    -   subDirectory あり・なしで Web 配布物、画像、サムネイル、配信用一時 file、API、API 文書、およびリアルタイム通知が
        対応する公開 path から取得できることを temporary filesystem fixture で確認する。
    -   HLS 親 playlist が `./streamfiles/stream{streamId}.m3u8` を指し、既存の static route から公開されることを固定す
        る。
    -   存在しない file、`..`、符号化区切り、および絶対 path 相当の要求で static root 外の synthetic sentinel を返さない
        ことを確認する。
    -   HLS の生成、stream ID 採番、および終了時 cleanup を本機能へ追加しない。
    -   完了時には、全公開面の path matrix が成功し、root 外 sentinel の取得件数が0件で、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9_
    -   _Boundary: Static File Publisher characterization_
    -   _Verification: unittest/spec, unittest/imp, temporary-filesystem integration, security regression_

-   [x] 1.2 公開設定・version・API 文書の既存提供条件を characterization する

    -   公開設定が通知 port、録画保存先名、Encode 方法、再生用 URL 設定、streaming 方法、外部再生先名、および
        `broadcast` を返すことを exact assertion する。
    -   package version と機械可読 API 文書を取得でき、Swagger UI 配布物がある場合だけ説明画面を提供することを確認する。
    -   upload 内部設定を公開設定、公開 request・response、または API 文書へ追加しない負契約を固定する。
    -   完了時には、公開設定 field 集合と version が既存値へ一致し、Swagger UI の有無二条件が再現され、production code
        の差分がない。
    -   _Requirements: 1.4, 1.5, 1.6, 1.7_
    -   _Boundary: Service Composition・API Document characterization_
    -   _Verification: unittest/spec, unittest/imp, exact response contract test_
    -   _Depends: 1.1_

-   [x] 1.3 Host・通信方式・subDirectory による公開 URL 組立てを characterization する

    -   request の Host を外部 URL の接続先として使用し、実 HTTPS と `X-Forwarded-Proto: https` の各条件を HTTPS として
        扱うことを表駆動 test で確認する。
    -   HTTP、HTTPS、forwarded HTTPS と subDirectory あり・なしを組み合わせ、生成 URL の scheme、host、base path を固定
        する。
    -   固定 host、新しい proxy 設定、IPTV 文書 serializer、および配信機能の URL 意味を追加しない。
    -   完了時には、全組合せの外部 URL が既存 carrier 規則へ一致し、production code の差分がない。
    -   _Requirements: 5.1, 5.2, 5.3_
    -   _Boundary: Public URL Builder characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven URL contract test_
    -   _Depends: 1.2_

-   [x] 2. 公開 route と domain 委譲の既存契約を固定する
-   [x] 2.1 (P) 番組・予約・Rule・録画中 route の carrier 契約を characterization する

    -   チャンネル、ロゴ、番組表、検索、放送中番組、予約、Rule、および録画中操作の method、path、入力位置、成功応答、既
        存 error を機能群別の contract inventory で固定する。
    -   予約の一覧・件数・詳細・追加・編集・取消・状態解除・再計算、Rule の全操作、および録画 timer 再設定を対応する
        domain port へ一回委譲することを確認する。
    -   carrier が候補採否、競合、予約状態、録画状態、および Rule の業務結果を独自に再判定しないことを test double で固
        定する。
    -   完了時には、対象 route inventory の未割当が0件で、各正常要求の owner port 呼出しが1件となり、production code の
        差分がない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.10, 3.1_
    -   _Boundary: Program・Reservation・Rule・Recording Route Adapter characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven route contract test_
    -   _Depends: 1.3_

-   [x] 2.2 (P) 録画済み番組と関連資源 route の carrier 契約を characterization する

    -   録画済み番組、video、drop log、Tag、保護状態、および Thumbnail の参照・変更 route を独立した contract inventory
        で固定する。
    -   path・query・body・multipart の既存入力を対応する owner port へ渡し、domain の成功・失敗を route 固有の既存 HTTP
        応答へ変換することを確認する。
    -   削除可否、保護判断、filesystem 効果、Thumbnail 生成、および upload 登録結果を carrier で再定義しない。
    -   完了時には、対象 route inventory の未割当が0件で、業務判断を持つ追加分岐が0件となり、production code の差分がな
        い。
    -   _Requirements: 2.5, 2.10, 3.1_
    -   _Boundary: Recorded Content Route Adapter characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven route contract test_
    -   _Depends: 1.3_

-   [x] 2.3 (P) Encode・容量・映像配信 route の carrier 契約を characterization する

    -   Encode の追加・一覧・進捗・取消、録画保存先容量、および live・録画済み映像の開始・継続・停止・状態参照を独立した
        contract inventory で固定する。
    -   公開入力を対応する owner port へ渡し、stream resource、Encode queue、容量判定を route 内で再実装しないことを確認
        する。
    -   成功 status、必須本文、内容種類、および route 固有の既存 error を exact assertion する。
    -   完了時には、対象 route inventory の未割当が0件で、owner port 外の業務判断が0件となり、production code の差分がな
        い。
    -   _Requirements: 2.6, 2.7, 2.8, 2.10, 3.1_
    -   _Boundary: Encoding・Storage・Media Delivery Route Adapter characterization_
    -   _Verification: unittest/spec, unittest/imp, table-driven route contract test_
    -   _Depends: 1.3_

-   [x] 2.4 IPTV typed public-URL builderのcaller bindingをTDDでatomic実装する

    -   Task 1.3のURL characterizationを前提に、現行routeが`IIPTVApiModel`へraw Host・scheme・subDirectoryを含む5引数を
        渡し、Design 6.3のtyped inputを満たさないことをproduction TypeScript compileとprovider contract testで先にREDと
        して確認する。RED理由をcaller bindingの欠落へ限定し、その状態をcheckpointとして残さない。
    -   M3U8要求ごとにHost、Design 9のscheme判定、および設定済み`subDirectory`からimmutableな `IptvPublicUrlBuilder`を構成す
        る。`channelLogoUrl(channelId)`は `<scheme>://<host><base>/api/channels/{channelId}/logo`、
        `liveM2tsUrl(channelId, mode)`は `<scheme>://<host><base>/api/streams/live/{channelId}/m2ts?mode={mode}`を正確に
        返す。
    -   OpenAPI middleware後の`mode`と`isHalfWidth`を、要求ローカルな`publicUrls`とともにtyped provider入力へ渡す。
        `days`とXMLTVの`isHalfWidth`も既存typed入力へ渡し、二回目のfloor、数値化、独自丸め、値域・利用可能性検査を追加し
        ない。
    -   Host不在はbuilder構成、IPTV provider、およびDB読取より前に既存route errorへ一回だけ確定する。実HTTPSと正確な
        `X-Forwarded-Proto: https`だけをHTTPSとし、新しいproxy trustや固定Hostを追加しない。
    -   OpenAPIの正負小数floor、成功status、M3U8・XMLのContent-Type、providerが返したexact body、HTTP・HTTPS・forwarded
        HTTPS、およびsubDirectoryあり・なしを実HTTP integrationで検証する。M3U8・XMLTVのserializer、byte、空白、改行、対
        象選択、文字変換、時刻規則はIPTV ownerのfixtureを消費し、本specで再実装しない。
    -   IPTV Task 2.3と同じrevisionで最小実装し、全production TypeScript compile、IPTV fake builder suite、本specの
        provider contract test、および実HTTP carrier integrationをすべてGREENにする。いずれか一つの成功だけでは完了扱い
        にしない。
    -   完了時には、raw 5引数callerが0件、要求ごとのtyped builder構成が1件、Host不在時のprovider・DB呼出しが各0件で、
        carrier matrixのstatus・Content-Type・exact bodyと両spec suiteが同一revisionで一致する。
    -   _Requirements: 2.9, 2.10, 3.1, 4.1, 4.3, 5.1, 5.2, 5.3_
    -   _Boundary: IPTV Route Adapter・Public URL Builder caller binding_
    -   _Verification: compile-contract RED/GREEN, unittest/spec, unittest/imp, OpenAPI middleware integration,
        HTTP/HTTPS carrier integration_
    -   _Depends: 1.3_

-   [x] 3. 公開 API exact compatibility と機械可読文書を一致させる
-   [x] 3.1 既存 runtime wire の重要互換点を exact regression で固定する

    -   録画済み映像の stream 情報が `viodeFileId` を返し、予約一覧の `normal`、`conflicts`、`skips`、`overlaps` がすべ
        て配列であることを確認する。
    -   Rule 追加の二つの POST route、body なしの録画 timer 再設定と `{ code: 200 }`、公開設定の `broadcast` を固定す
        る。
    -   `updateStatus` と `updateEncode` が既存名のまま payload なしで送信される wire を確認する。
    -   runtime field 名の訂正、route 統合、payload 追加、および共通 error 形式への統一を行わない。
    -   完了時には、六つの重要互換点が byte・field・status 単位で一致し、production code の差分がない。
    -   _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
    -   _Boundary: Public API Runtime Contract characterization_
    -   _Verification: unittest/spec, exact wire regression, Socket.IO contract test_
    -   _Depends: 2.1, 2.2, 2.3_

-   [x] 3.2 API文書の二つの不一致を同じcontract targetのRED/GREENで訂正する

    -   予約一覧四項目の runtime response・公開型・API 文書 schema を比較し、文書だけが配列形と一致しない状態を検出する
        同じcontract targetを追加してREDを確認する。
    -   stream 情報の runtime response・公開型・API 文書 field を比較し、文書だけが `viodeFileId` と一致しない状態を検出
        する同じtargetのRED理由を二つの文書不一致だけへ限定する。
    -   `api.yml`の予約一覧`normal`、`conflicts`、`skips`、`overlaps`を既存item schemaの配列へ、stream情報fieldをruntime
        と同じ`viodeFileId`へ訂正する最小productionだけを実装し、同じcontract targetと全route inventoryをGREENにする。
    -   runtime response、公開型、method、path、入力、status、body、header、error、その他のschemaを変更せず、runtimeを文
        書へ合わせる変更を0件にする。
    -   完了時には二つの文書差分だけが解消され、同じcontract targetと全route inventoryがGREEN、production runtime/API
        wire差分0件となる。
    -   _Requirements: 3.1, 3.8_
    -   _Boundary: OpenAPI Document Contract_
    -   _Verification: unittest/spec, same-target RED/GREEN, schema comparison, full API inventory_
    -   _Depends: 3.1_

-   [x] 4. 共通 HTTP request・response の既存契約を固定する
-   [x] 4.1 入力 error、JSON header、内部 error、および access log を characterization する

    -   OpenAPI 定義に合わない入力が業務 port を呼ばず既存入力 error となることを middleware を含む test で確認する。
    -   正常 JSON の既存 private・no-cache header と、内部失敗時の HTTP 500、`code`、`message`、任意の `errors` を固定す
        る。
    -   全 HTTP request が access log へ一回渡され、logger sink・category・rotation を本機能で再実装しないことを確認す
        る。
    -   完了時には、valid・invalid・内部失敗の response matrix と access log 件数が既存契約へ一致し、production code の
        差分がない。
    -   _Requirements: 4.1, 4.2, 4.7, 4.8_
    -   _Boundary: OpenAPI Request Boundary・Response Writer・Access Log characterization_
    -   _Verification: unittest/spec, unittest/imp, middleware integration, response contract test_
    -   _Depends: 3.2_

-   [x] 4.2 内容種類と download 応答を characterization する

    -   playlist、画像、log、映像、および XML の代表応答へ用途別の既存内容種類が付くことを確認する。
    -   download 指定時に保存用内容種類と既存 file 名が `Content-Disposition` へ設定されることを固定する。
    -   route ごとの内容種類を新しい共通形式へ統一せず、IPTV 文書や HLS の内容生成へ踏み込まない。
    -   完了時には、代表 content type matrix と download header が exact assertion を満たし、production code の差分がな
        い。
    -   _Requirements: 4.3, 4.6_
    -   _Boundary: Response Writer characterization_
    -   _Verification: unittest/spec, unittest/imp, content-type and download regression_
    -   _Depends: 4.1_

-   [x] 4.3 単一 byte range の既存境界を実 file で characterization する

    -   Design 8.3のexact locator `IMP#SI-9.2/range-*`と`INT#SI-9.4/range-*`で、同じ8-byte fixtureに
        `range-absent`、`range-empty`、`range-normal-closed`、`range-open-ended`、`range-suffix`、
        `range-oversized-suffix`、`range-start-equals-end`、`range-start-greater-than-end`、
        `range-start-equals-file-size`、`range-end-equals-file-size`、`range-malformed`、`range-multiple`の12 caseを割り
        当てる。
    -   各caseで最終wire status、`Content-Range`と`Content-Length`の値または不在、実body byte列、 `createReadStream`回
        数、file handle解放回数をassertする。stream作成caseは正常endとclient closeの競合でも一回解放、非作成caseは作成・
        解放各0回とする。
    -   sourceだけで確定しないoversized suffix、`start > end`、416 implicit lengthは実行結果をCURRENT
        characterizationとして固定し、canonical R4.4/R4.5と区別する。`start === end`はcanonical R4.4として
        `Content-Length: 1`と該当1 byteを返し、同じ接続の次の応答が壊れないことを確認する。新しい正規化と複数range対応は
        行わない。
    -   完了時には12/12のwire・resource結果が両locatorで一致し、未確定case 0件となる。
    -   _Requirements: 4.4, 4.5_
    -   _Boundary: Response Writer range characterization_
    -   _Verification: unittest/spec, unittest/imp, temporary-file HTTP integration_
    -   _Depends: 4.2_

-   [x] 4.4 保存先外のディレクトリ指定を HTTP 400 で応答する

    -   予約・ルールの追加と編集、ルール追加（`/rules/keyword`を含む）、手動エンコード追加の route が、担当機能の
        `InvalidSubDirectory`による拒否を HTTP 400 と`{ code, message, errors }`へ変換し、その他の失敗は従来どおり HTTP 500
        のままであることを、現行実装でREDになる`unittest/imp`で定義する。
    -   共通の変換関数を追加して該当 route から使う最小実装を行い、OpenAPI 定義、成功応答、他 route の失敗応答を変えない。
    -   _Requirements: 4.1_
    -   _Boundary: Response Writer・入力エラー_
    -   _Verification: unittest/imp_
    -   _Depends: 4.1_

-   [x] 4.5 編集できない予約の編集を HTTP 409 で応答する

    -   `PUT /reserves/{reserveId}`の route が、録画予約管理機能の`ReservationIsNotEditable`による拒否を HTTP 409 と
        `{ code: 409, message: 'Conflict', errors: 'ReservationIsNotEditable' }`へ変換し、`InvalidSubDirectory`の HTTP 400 と
        その他の失敗の HTTP 500 を変えないことを、現行実装でREDになる`unittest/imp`で定義する。
    -   共通の変換関数`responseOperationError`に対応を加える最小実装を行い、成功応答を変えない。OpenAPI 定義は
        `PUT /reserves/{reserveId}`の応答に 409（本文は`Error`）を加え、それ以外の route の定義を変えない。
    -   _Requirements: 4.7_
    -   _Boundary: Response Writer・内部 error_
    -   _Verification: unittest/imp_
    -   _Depends: 4.4_

-   [x] 5. Upload admission と request lifecycle を TDD で実現する
-   [x] 5.1 既存 multipart・登録・応答契約を characterization する

    -   一要求一 file、録画済み番組、保存先、表示名、file 種類の既存 multipart schema と、一時保存先への受信を固定する。
    -   受信成功後の録画済み番組 owner への登録依頼、HTTP 200 と `{ code: 200, result: 'ok' }`、登録 IPC の10分期限と
        HTTP 500を確認する。
    -   IPC 期限後の late result を HTTP へ採用せず、管理側処理を取消扱いしない既存境界を固定する。
    -   file size の最小・最大、同時 upload 全体の合計 byte 上限、公開 schema、および upload 内部設定の公開を追加しない
        負契約を確認する。
    -   完了時には、正常・登録失敗・10分期限の carrier matrix と無制限 file size 設定が再現され、production code の差分
        がない。
    -   _Requirements: 6.1, 6.7, 6.9, 6.10, 6.11, 6.15, 6.16, 6.17_
    -   _Boundary: Upload Route・Recorded Content Registration Carrier characterization_
    -   _Verification: unittest/spec, unittest/imp, multipart characterization, fake-timer IPC contract test_
    -   _Depends: 4.3_

-   [x] 5.2 起動snapshotと二namespaceのlistener前gateを一つのRED/GREEN単位で完成する

    -   `concurrentUploadNum`の省略値3・安全な整数1以上と、`uploadReceiveTimeoutMs`の省略値300,000・整数
        1〜2,147,483,647、startup-only snapshotをtable-driven testへ追加し、invalid値、`incoming`/`adopted`作成失敗、
        device不一致でHTTP/HTTPS listener開始0件となるREDを確認する。
    -   設定ownerの完成snapshotを一回消費し、`uploadTempDir`直下の両namespaceを作成してsame filesystemを確認する最小
        productionを実装し、同じtestをGREENにする。二値とtokenを公開設定、request/response、API文書、IPC/domain schemaへ
        追加しない。
    -   `uploadReceiveTimeoutMs`をlistener-global `requestTimeout`、接続・header・keep-alive・response期限へ流用せず、
        upload以外のAPIとlive/recorded/通常file responseを切らない否定testも同じGREENへ含める。
    -   完了時にはdefault・両端・範囲外・reload・filesystem matrixがGREEN、invalid時listener 0、公開field追加0となる。
    -   _Requirements: 6.2, 6.3, 6.8, 6.17_
    -   _Boundary: Upload Runtime Settings・Namespace Startup Gate_
    -   _Verification: unittest/spec, unittest/imp, configuration/filesystem integration, RED/GREEN_
    -   _Depends: 5.1_

-   [x] 5.3 Body前slot・既定3並列・single finalizerを一つのRED/GREEN単位で完成する

    -   body読取・token/temp作成前のslot取得、3件受付、4件目だけの既存error、4件目body byte 0・temp作成0、待機queue・
        size/aggregate byte上限0を期待するconcurrency testを追加し、現行productionへのREDを確認する。
    -   process-local admissionと`releaseOnce` leaseを最小実装し、body受信、入力確認、dispatch、登録待ちから最初の
        success/failure/abort/receive-timeout/registration-timeoutまで保持するsingle finalizerへ接続する。
    -   `req.aborted`、`res.finish`、`res.close`、Multer callback、timer、IPC settlementの同着を全順序で競合させ、同じ
        testをGREENにする。正常bodyで発生する`req.close`だけでは早期解放しない。
    -   完了時には使用中0〜3、4件目だけ拒否、terminal/response/slot解放各最大1回、通常request取消0件となる。
    -   _Requirements: 6.4, 6.5, 6.6, 6.14, 6.15_
    -   _Boundary: Upload Admission Controller・Request Finalizer_
    -   _Verification: unittest/spec, unittest/imp, deterministic race test, RED/GREEN_
    -   _Depends: 5.2_

-   [x] 5.4 Upload body全体期限とincoming所有cleanupを一つのRED/GREEN単位で完成する

    -   slot取得後・body receiver直前に一回開始しchunkで延長せず、body成功/失敗callbackで解除する期限をfake timerでREDに
        する。期限/abortと、Task 5.5が接続するasync send failure/confirmed-not-sentのterminal reasonをfinalizer seamへ注
        入し、exact `incoming/{uploadToken}/payload`だけをunlinkOnceし、空のexact token directoryだけをremoveOnceする。
        本leafはfinalizer seamのreason別動作までを所有し、実PM attempt/dispositionからの接続はTask 5.5が所有する。
    -   requestごとの一意token directoryを`incoming`直下へexclusive作成し固定名`payload`へ受信する最小productionを実装す
        る。別request、namespace全体、`adopted`をlist/unlink/rmdirせず、cleanup失敗は既存HTTP結果を変えず記録する。
    -   body期限終了後だけ登録段階へ進めるfinalizer seamを確認し、登録期限後を表すterminal reasonとlate callback/result
        でroute、response、timer、cleanup、slotを復活させない同じrace testをGREENにする。実PMの10分timer、attempt、
        disposition、late result接続はTask 5.5が所有する。
    -   完了時にはbody timer 1・延長0、exact incoming cleanup各最大1、adopted変更0、別request変更0、live/recorded/通常
        responseの300,000ms超継続がGREENとなる。
    -   _Requirements: 6.7, 6.8, 6.11, 6.12, 6.13, 6.14_
    -   _Boundary: Upload Receive Deadline・Service-child Incoming Ownership_
    -   _Verification: unittest/spec, unittest/imp, integration, fake-timer/resource race, RED/GREEN_
    -   _Depends: 5.3_

-   [x] 5.5 SI-local dispatch/disposition consumptionを同じtargetのRED/GREENで完成する

    -   Recorded Content Task 3.1のgrammar検証、exclusive adopted mkdir、raw atomic rename、parent cleanupと、Process
        Messaging Task 3.2のcarrier/dispositionが同一revisionでGREENになった後、その完成adapterをfake/compiled boundary
        で消費する。
    -   service childがexact `incoming/{uploadToken}/payload`を登録portへ一回dispatchし、一件のattemptと
        `confirmed-not-sent` / `adopted` / rejection settlementをsingle finalizerへ一回接続できない現状だけを同じ
        SI-local targetでREDにする。
    -   `src/model/service/api/videos/upload.ts`とUpload finalizer seamだけへ最小productionを実装し、同じtargetをGREENに
        する。attempt return、send callback、delivery可能性、ACKをownership transferへ読み替えず、late settlementで
        HTTP、timer、incoming cleanup、slotを復活させない。
    -   raw rename、adopted grammar/directory、parent source read、domain call、adopted/final cleanup、PM ID/timer/
        disposition生成をSI productionへ追加しない。これらのraceはTask 5.6がowner suiteを消費して結合検証する。
    -   完了時にはexact incoming dispatch 1、attempt/finalizer接続1、HTTP terminal/slot各最大1、SI内のraw
        rename・adopted cleanup・PM carrier再実装各0となり、同じtargetがGREENになる。
    -   _Requirements: 6.9, 6.11, 6.12, 6.13, 6.14_
    -   _Boundary: Upload Dispatch・Disposition Consumption_
    -   _Verification: unittest/spec, unittest/imp, fake/compiled owner boundary, same-target RED/GREEN_
    -   _Depends: 5.4_

-   [x] 5.6 Upload HTTP・IPC・filesystemのfailure/race matrixを結合検証する

    -   Recorded Content Task 3.1とProcess Messaging Task 3.2のGREEN owner suiteを前提に完成adapterを消費し、parent
        adoptionとPM dispositionを本specへ再実装しない。
    -   一件の正常multipartをincoming exclusive mkdir、payload受信、parent adopted exclusive mkdir、raw atomic rename、
        rename後ACK、adopted path domain call、HTTP 200と`{ code: 200, result: 'ok' }`まで接続する。
    -   abortと10分期限をparent target read前、rename直後、source read後、final move後DB前、DB後reply前へ競合させ、
        unlink-vs-rename両先着、ACK loss/late ACK、async send failure、collision、raw rename failure、registration
        failureをDesign 10.4/10.8どおりassertする。
    -   3件の低速upload中も通常API・live/recorded response・通知を継続し、4件目だけbody/temp前拒否する。公開schema、
        status/error、file size無制限をexact regressionする。
    -   完了時にはowner以外のcleanup 0、domain call 0/1、HTTP finalizer/slot/timer各一回、残留incoming 0、既存adopted
        sentinel変更0となる。
    -   _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16_
    -   _Boundary: Upload HTTP・Multipart・IPC・Filesystem Integration_
    -   _Verification: unittest/spec, integration, slow-stream/fault-injection/race matrix_
    -   _Depends: 5.5_

-   [x] 5.7 Child restartでstale incomingだけをcleanupするRED/GREENを完成する

    -   新childがlistener前に`incoming`だけを列挙し、exact grammarのstale payloadと空token dirを一件ずつcleanupし、
        `adopted`のlist/unlink/rmdir 0件となるrestart testを追加してREDを確認する。
    -   listener前startup cleanupを最小実装し、旧slot/body/HTTP response/registration resultを復元せず、二設定を読み直し
        て空slotから開始する。同時にold parent renameとcleanupを両順序で競合させる。
    -   同じtestをGREENにし、cleanup先着ではrename `ENOENT`・ACK/source read/domain各0、rename先着ではincoming `ENOENT`
        no-opでadopted owner処理だけが継続することを確認する。
    -   完了時にはrestart後使用中0、新snapshot一致、stale incoming残留0、adopted列挙・変更0、generation復元0となる。
    -   _Requirements: 6.2, 6.18_
    -   _Boundary: Upload Service-child Restart・Incoming Startup Cleanup_
    -   _Verification: unittest/spec, unittest/imp, child-process/filesystem integration, RED/GREEN_
    -   _Depends: 5.6_

-   [x] 5.8 Multipart filenameのcharsetと登録carrierの名前保持を検証する

    -   通常filenameをUTF-8、extended filenameを明示charsetで一回だけ解釈し、extendedを優先する契約を固定する。
    -   主spec caseは解釈済みの日本語とliteral `Ã©` を製品upload routeから登録portへ渡し、名前を再decodeせず、成功応答と
        finalizerの解放を維持する既存挙動をcharacterizationする。このcarrier caseのREDを捏造しない。
    -   実HTTP・実multer・実diskの7caseはparser境界を担い、通常UTF-8の退行REDと最小受信設定のGREENを確認する。
    -   完了時には名前・payload一致、HTTP/受信器/実行枠/file/server回収、主specとparser caseのtrace対応が成立する。
    -   _Requirements: 6.19_
    -   _Boundary: Multipart Filename Decoder・Upload Registration Carrier_
    -   _Verification: unittest/spec characterization, unittest/imp real HTTP/filesystem, RED/GREEN_
    -   _Depends: 5.1, 5.5_

-   [x] 6. Socket.IO wire と200ミリ秒集約の既存契約を固定する
-   [x] 6.1 Same・dedicated listener、subDirectory path、origin 条件を characterization する

    -   HTTP・HTTPS と同じ listener、および設定済み専用 port の各構成で Socket.IO 接続を受け付けることを確認する。
    -   subDirectory あり・なしの `<base>/socket.io` path と、すべての接続元を許可する既存 origin 条件を固定する。
    -   listener の spawn・restart・全体 shutdown と、event producer の発行条件を本機能で再実装しない。
    -   完了時には、same・dedicated・subDirectory の接続 matrix が成功し、production code の差分がない。
    -   _Requirements: 7.1, 7.2, 8.5_
    -   _Boundary: Realtime Notifier・Listener Factory characterization_
    -   _Verification: unittest/spec, integration, Socket.IO connection matrix_
    -   _Depends: 5.7_

-   [x] 6.2 `updateStatus` の固定windowとdestination failure isolationをTDDで完成する

    -   最初の状態更新から200ミリ秒以内に届く同種通知を一件の `updateStatus` へまとめることを fake timer で確認する。
    -   一destinationの同期的・直接観測可能なemit失敗で、運用log一回、後続destination継続、delayed callback開始時の
        status timer reset一回、fatal 0を期待するtestを追加してREDを確認し、要求局所guardだけを最小実装して同じtestを
        GREENにする。
    -   200ミリ秒を越えた次の更新は別通知とし、payload、変更内容、ack、retry、永続化、replay、rollbackを追加しない。
    -   完了時には同一window/次window各送信1件、失敗後の宛先継続、payload field 0、未処理失敗0となる。
    -   _Requirements: 3.7, 7.3, 7.5_
    -   _Boundary: Realtime Status Notifier characterization_
    -   _Verification: unittest/spec, unittest/imp, fake-timer wire regression_
    -   _Depends: 6.1_

-   [x] 6.3 `updateEncode` の独立window・failure isolation・非再送をTDDで完成する

    -   エンコード進捗を独立した200ミリ秒 window で `updateEncode` へまとめ、payload なしで送ることを fake timer で確認
        する。
    -   一destinationの送信失敗でlog一回、後続destination継続、encode timer reset一回、status timerへの干渉0、fatal 0を
        期待してREDを確認し、encode callbackの局所guardだけを最小実装して同じtestをGREENにする。
    -   client 切断中の状態更新とエンコード更新を保存せず、再接続時に replay しないことを確認する。
    -   再接続後の新規通知だけを送信し、現在状態の payload、delivery ack、retry queue、永続化、rollback を追加しない。
    -   完了時には、状態更新とのtimer干渉0件、失敗後の宛先継続、切断中送信・再送0件、再接続後の新規送信1件となる。
    -   _Requirements: 3.7, 7.4, 7.5, 7.6_
    -   _Boundary: Realtime Encode Notifier characterization_
    -   _Verification: unittest/spec, unittest/imp, fake-timer disconnect/reconnect regression_
    -   _Depends: 6.2_

-   [x] 7. HTTP・HTTPS listener と接続元条件を characterization する
-   [x] 7.1 HTTP・HTTPS・専用通知 listener の構成 matrix を固定する

    -   HTTP のみ、HTTPS のみ、両方、および専用 Socket.IO port の組合せを synthetic listener fixture で開始する。
    -   HTTPS へ設定済み秘密鍵と証明書を使用し、各 listener が対応する Web・API・通知面を提供することを確認する。
    -   child process の監督、再起動判断、listener 全体の global ready、追加 timeout を本機能へ導入しない。
    -   完了時には、全有効構成で対象 listener が一回開始し、未設定 listener の開始が0件で、production code の差分がな
        い。
    -   _Requirements: 7.1, 8.1, 8.2_
    -   _Boundary: Listener Factory characterization_
    -   _Verification: unittest/spec, integration, synthetic HTTP/HTTPS listener matrix_
    -   _Depends: 6.3_

-   [x] 7.2 Client CA・CORS・共通認証非追加を characterization する

    -   CA 設定時に client 証明書を要求・検証し、有効・無効な synthetic 証明書の接続結果を固定する。
    -   API 全接続元許可時に Web と API の HTTP 応答へすべての接続元を許可し、Socket.IO は既存どおり全接続元を許可するこ
        とを確認する。
    -   Web、API、画像、映像、API 文書、および通知へ共通アプリケーション認証を暗黙に追加しない負契約を代表 route で検証
        する。
    -   完了時には、client CA と CORS の設定 matrix が一致し、既存公開面への追加認証 challenge が0件で、production code
        の差分がない。
    -   _Requirements: 8.3, 8.4, 8.5, 8.6_
    -   _Boundary: Listener Factory・CORS Boundary characterization_
    -   _Verification: unittest/spec, integration, synthetic TLS fixture, negative security regression_
    -   _Depends: 7.1_

-   [x] 8. 全公開面の結合・回帰 gate を完成する
-   [x] 8.1 全 route の method・入力・応答・owner 委譲を contract suite で閉じる

    -   全公開 route の method、path、parameter 位置、必須性、成功 status、必須 body、header、内容種類、および既存 error
        を一つの inventory として実 HTTP で検証する。
    -   runtime response、公開型、訂正後 API 文書の field・配列形を比較し、`viodeFileId`、予約四配列、Rule 二経路、
        bodyless timer reset、`broadcast` を再確認する。
    -   各 route が担当 owner port へ委譲し、carrier に業務可否・状態・serializer を重複実装していないことを
        representative call ledger で確認する。
    -   完了時には、Requirement 2〜4の全 AC が contract inventory の一行以上へ対応し、未割当・未検証 route が0件となる。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1,
        4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
    -   _Boundary: Public API Contract integration_
    -   _Verification: unittest/spec, integration, exhaustive route inventory gate_
    -   _Depends: 2.1, 2.2, 2.3, 2.4, 3.2, 4.3, 7.2_

-   [x] 8.2 Static・URL・upload・IPTV carrier を temporary 資源で結合検証する

    -   subDirectory あり・なしの static、HLS path、公開情報、外部 URL、および IPTV query carrier を temporary
        filesystem と owner port stub で検証する。
    -   uploadの正常・満杯・body期限・abort・登録失敗・10分期限・late/async send・unlink-vs-rename・ACK
        loss・collision・ raw rename failure・再起動を一つの結合matrixで実行し、namespace所在によるowner一意性とHTTP資源
        の一回解放を確認する。
    -   childはexact incoming payload/空token dirだけ、parentは自作空adopted dir、owned adopted payload/dir、final
        destinationだけを変更し、別request、namespace全体、他ownerのpath変更を各0件とする。
    -   IPTV exact bytes、HLS lifecycle、recorded-content domain cleanup、IPC timer・IDを各owner fixtureへ残し、本specの
        重複実装を0件にする。
    -   完了時にはRequirement 1・5・6の全ACが結合matrixの一行以上へ対応し、残留incoming・lease・timer 0、adopted誤変更0
        となる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7,
        6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18_
    -   _Boundary: Static・URL・Upload・IPTV Carrier integration_
    -   _Verification: unittest/spec, integration, temporary-resource lifecycle gate_
    -   _Depends: 1.1, 1.2, 1.3, 2.4, 5.7, 8.1_

-   [x] 8.4 service childのresource-use clientとsnapshot provider bindingをRED/GREENで完成する

    -   `test/server/service-interface/recorded-resource-use-binding.integration.test.ts`へ、service child起動ごとに一つ
        のPM resource-use clientを構成し、EncodingとMedia Deliveryのconsumer adapterへ同じinstanceを一回ずつbindingする
        期待を追加する。現行`ModelContainerSetter`にbindingがない理由だけでREDを確認する。
    -   Encoding adapterのexact token acquire/release、Delivery adapterの同じopaque tokenを高々一回releaseするclosure、
        両provider known時だけの重複除去readonly ID union、一方unknown時のunknown伝播を同じtargetへ含める。live配信、旧
        generation、部分snapshotを含めない。
    -   `src/model/ModelContainerSetter.ts`のservice child compositionへSI-local bindingだけを最小実装し、同じtestを
        GREENにする。PMがcarrier・lease・snapshot protocol、Encoding/Deliveryがconsumer provider、Runtimeが
        aggregate/capacity compositionを所有し、それらのproduction実装変更を0件にする。
    -   service child再起動では新しいclient、adapter、provider bindingだけを構成し、旧generationのtoken、pending
        request、release closure、snapshotを復元しない。
    -   完了時には同一clientへの二domain binding、exact acquire/release、known union、unknown propagation、再起動時の新
        規bindingが同じtargetでGREENとなり、二重binding、leaseなしdomain開始、部分snapshot、外部owner production変更が各
        0件になる。
    -   _Requirements: 9.4_
    -   _Boundary: Recorded Use Port Binding・Service Composition_
    -   _Verification: recorded-resource-use-binding.integration.test.ts same-target RED/GREEN_
    -   _Depends: 8.2_

-   [x] 8.5 service childのrecorded playback source provider bindingをRED/GREENで完成する

    -   `test/server/service-interface/recorded-playback-source-binding.integration.test.ts`へ、service child起動ごとに
        一つのRecorded Content playback source providerを構成し、Media Deliveryのrecorded stream consumerへ一回だけ
        bindingするRED expectationを追加する。現行`ModelContainerSetter`にbindingがない理由だけでREDを確認する。
    -   providerが解決する録画file・録画済み番組・実path・動画情報、recorded ID予備照会とexpected ID照合、TS/encoded、録
        画中/完了済みreaderの意味は`server-recorded-content` Task 2.4のowner testで確認する。本taskは同じprovider
        instanceの一回bindingと、provider failureの既存開始失敗へのそのままの伝播だけを確認する。
    -   `src/model/ModelContainerSetter.ts`のservice child compositionへbindingだけを最小実装し、同じtargetをGREENにす
        る。Recorded Contentがprovider、Media Deliveryがconsumer lifecycle、Service Interfaceがcompositionを所有し、公開
        API、IPC、設定、DB schema、HLS公開path、他ownerのproduction実装変更を0件にする。
    -   service child再起動では新しいproviderとconsumer bindingだけを構成し、旧generationの
        reader、source、stream、process、HLS成果物、再生途中状態を復元しない。
    -   完了時には一回binding、provider failure handoff、再起動時の新規bindingが同じtargetでGREENとなる。
    -   _Requirements: 9.4_
    -   _Boundary: Recorded Playback Source Binding・Service Composition_
    -   _Verification: recorded-playback-source-binding.integration.test.ts same-target RED/GREEN_
    -   _Depends: 8.4_

-   [x] 8.3 HTTP・HTTPS・Socket.IO と upload 非阻害のfeature-local回帰checkpointを完成する

    -   HTTP・HTTPS、client CA、CORS、same・dedicated Socket.IO port、および subDirectory の listener matrix を実接続で
        検証する。
    -   `updateStatus` と `updateEncode` の独立200ミリ秒集約、payload なし、切断中非保存・非再送を fake timer と実
        Socket.IO client で再確認する。
    -   三件の低速 upload 中も通常 API とリアルタイム通知が継続し、4件目 upload だけが拒否されることを確認する。
    -   destination一件の送信失敗時もstatus/encodeそれぞれで後続送信、log一回、timer reset一回、fatal 0となることを含め
        る。
    -   feature-local回帰checkpointを実行し、このleaf開始後のproduction/config変更を0件にする。後続Tasks 9.2・9.4で追加
        するtestを完成させ、本機能の品質判定はTask 9.5で満たす。本leafで共有基盤を再実装しない。
    -   完了時には、Requirement 7・8を含む全69 Acceptance Criteria が一件以上の成功 test へ対応し、未分類・未検証が0件と
        なる。
    -   _Requirements: 3.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
    -   _Boundary: Service Interface end-to-end integration_
    -   _Verification: unittest/spec, unittest/imp, HTTP/HTTPS/Socket.IO integration, feature-local regression
        checkpoint_
    -   _Depends: 5.6, 6.3, 7.2, 8.2, 8.4, 8.5_

-   [x] 9. R9の機能固有の品質を閉じる

Tasks 9.2・9.4は本機能のspec・imp・integration testを完成させ、Task 9.5は本機能の単体testと結合testの全件成功で品質判定を満たす。
production/config差分は追加しない。

-   [x] 9.2 implementation characteristicsを具体的caseで閉じる

    -   `test/server/service-interface/imp/*.test.ts`へDesign 14・18.2のcanonical casesを具体化
        し、subDirectory/Host/scheme、OpenAPI floor一回・adapter floor 0、range 12 case、upload default/境界/期限
        /finalizer/rename race/namespace owner、status/encode 200ms、destination failure、listener/TLS/CORS分岐を実行す
        る。
    -   値、null/空/0/1/最大/範囲外、不正型、状態、failure、race、timeout、late settlement、file/timer/listener/socket解
        放を分類する。characterizationはproduction差分0とする。
    -   完了時にはDesign canonical imp caseが全件GREEN、未分類0、残留resource 0、characterization production差分0とな
        る。
    -   _Requirements: 9.2_
    -   _Boundary: Service Interface Implementation Characteristics_
    -   _Verification: imp/\*.test.ts_
    -   _Depends: 8.3_

-   [x] 9.4 HTTP・IPC・filesystem・process owner integrationを一つのlocatorで閉じる

    -   `test/server/service-interface/integration/service-interface.integration.test.ts`で
        HTTP/HTTPS、OpenAPI、static/HLS、IPTV fake builder、range 12 case、upload二
        namespace/IPC/restart、Socket.IO、TLS/CORS/listenerを接続する。
    -   Task 8.4のservice child resource-use client/snapshot provider bindingを同じowner integrationのconsumptionとして
        接続し、PM carrier/lease/snapshot、Encoding/Delivery provider、Runtime aggregate/capacity compositionの再実装を0
        件にする。DBはdomain ownerのため直接取得せず理由を残す。
    -   完了時にはowner integration全件GREEN、range handle・upload owner・timer/socket/listener解放が各設計値、owner越境
        実装0、外部ownerのtest欠落0となる。
    -   _Requirements: 9.4_
    -   _Boundary: HTTP・IPC・Filesystem・Process Owner Integration_
    -   _Verification: integration/service-interface.integration.test.ts_
    -   _Depends: 9.2_

-   [x] 9.5 本機能の品質判定を満たす

    -   Task 9.2から9.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 9.2, 9.4_
    -   _Requirements: 9.1, 9.3, 9.5_

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                                                    | Test type                                                                               | Local Depends                       | Verification command                                                                                                                                                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts` | `unittest/spec, unittest/imp, temporary-filesystem integration, security regression`    | `なし（共有foundationのみ）`        | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts` |
| 1.2  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, exact response contract test`                             | `1.1`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 1.3  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, table-driven URL contract test`                           | `1.2`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 2.1  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, table-driven route contract test`                         | `1.3`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 2.2  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, table-driven route contract test`                         | `1.3`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 2.3  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, table-driven route contract test`                         | `1.3`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 2.4  | `test/server/service-interface/imp/iptv-carrier.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                         | `unittest/imp, OpenAPI middleware integration, HTTP/HTTPS carrier integration`         | `1.3`                               | `npm run test:server:imp -- test/server/service-interface/imp/iptv-carrier.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                     |
| 3.1  | `test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                       | `unittest/spec, exact wire regression, Socket.IO contract test`                         | `2.1, 2.2, 2.3`                     | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                                                                                     |
| 3.2  | `test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                       | `unittest/spec, same-target RED/GREEN, schema comparison, full API inventory`           | `3.1`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                                                                                     |
| 4.1  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts` | `unittest/spec, unittest/imp, middleware integration, response contract test`           | `3.2`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts` |
| 4.2  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                      | `unittest/spec, unittest/imp, content-type and download regression`                     | `4.1`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                         |
| 4.3  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts` | `unittest/spec, unittest/imp, temporary-file HTTP integration`                          | `4.2`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts` |
| 4.4  | `test/server/service-interface/imp/sub-directory-response.imp.test.ts` | `unittest/imp` | `4.1` | `npm run test:server:imp -- test/server/service-interface/imp/sub-directory-response.imp.test.ts` |
| 4.5  | `test/server/service-interface/imp/reservation-edit-response.imp.test.ts` | `unittest/imp` | `4.4` | `npm run test:server:imp -- test/server/service-interface/imp/reservation-edit-response.imp.test.ts` |
| 5.1  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                | `unittest/spec, unittest/imp, multipart characterization, fake-timer IPC contract test` | `4.3`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                                                   |
| 5.2  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                           | `unittest/spec, unittest/imp, configuration/filesystem integration, RED/GREEN`          | `5.1`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                           |
| 5.3  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                | `unittest/spec, unittest/imp, deterministic race test, RED/GREEN`                       | `5.2`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                                                   |
| 5.4  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                           | `unittest/spec, unittest/imp, integration, fake-timer/resource race, RED/GREEN`         | `5.3`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                           |
| 5.5  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                | `unittest/spec, unittest/imp, fake/compiled owner boundary, same-target RED/GREEN`      | `5.4`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`                                                                                                                                                   |
| 5.6  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                           | `unittest/spec, integration, slow-stream/fault-injection/race matrix`                   | `5.5`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                      |
| 5.7  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                           | `unittest/spec, unittest/imp, child-process/filesystem integration, RED/GREEN`          | `5.6`                               | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                           |
| 5.8  | `test/server/service-interface/upload.spec.test.ts`<br>`test/server/service-interface/imp/upload-lifecycle.test.ts` | `unittest/spec characterization, unittest/imp real HTTP/filesystem, RED/GREEN` | `5.1, 5.5` | `npm run test:server:spec -- test/server/service-interface/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/upload-lifecycle.test.ts` |
| 6.1  | `test/server/service-interface/realtime.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                         | `unittest/spec, integration, Socket.IO connection matrix`                               | `5.7`                               | `npm run test:server:spec -- test/server/service-interface/realtime.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                    |
| 6.2  | `test/server/service-interface/realtime.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                             | `unittest/spec, unittest/imp, fake-timer wire regression`                               | `6.1`                               | `npm run test:server:spec -- test/server/service-interface/realtime.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                                |
| 6.3  | `test/server/service-interface/realtime.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                             | `unittest/spec, unittest/imp, fake-timer disconnect/reconnect regression`               | `6.2`                               | `npm run test:server:spec -- test/server/service-interface/realtime.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                                |
| 7.1  | `test/server/service-interface/listener.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                         | `unittest/spec, integration, synthetic HTTP/HTTPS listener matrix`                      | `6.3`                               | `npm run test:server:spec -- test/server/service-interface/listener.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                    |
| 7.2  | `test/server/service-interface/listener.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                         | `unittest/spec, integration, synthetic TLS fixture, negative security regression`       | `7.1`                               | `npm run test:server:spec -- test/server/service-interface/listener.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                    |
| 8.1  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                  | `unittest/spec, integration, exhaustive route inventory gate`                           | `2.1, 2.2, 2.3, 2.4, 3.2, 4.3, 7.2` | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                             |
| 8.2  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                  | `unittest/spec, integration, temporary-resource lifecycle gate`                         | `1.1, 1.2, 1.3, 2.4, 5.7, 8.1`      | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                             |
| 8.4  | `test/server/service-interface/recorded-resource-use-binding.integration.test.ts`                                                                                                                                                  | `recorded-resource-use-binding.integration.test.ts same-target RED/GREEN`               | `8.2`                               | `npm run test:server:integration -- test/server/service-interface/recorded-resource-use-binding.integration.test.ts`                                                                                                                                                                                                         |
| 8.5  | `src/model/ModelContainerSetter.ts`<br>`test/server/service-interface/recorded-playback-source-binding.integration.test.ts`                                                                                                        | `recorded-playback-source-binding.integration.test.ts same-target RED/GREEN`            | `8.4`                               | `npm run test:server:integration -- test/server/service-interface/recorded-playback-source-binding.integration.test.ts`                                                                                                                                                                                                      |
| 8.3  | `test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                       | `unittest/spec`                                                                         | `5.6, 6.3, 7.2, 8.2, 8.4, 8.5`      | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`                                                                                                                                                                                                                                     |
| 9.2  | `test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                                  | `imp/*.test.ts`                                 | `8.3` | `npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`                                                                                                                                                |
| 9.4  | `test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                                                  | `integration/service-interface.integration.test.ts`                                     | `9.2` | `npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts`                                                                                                                                                                                                         |
| 9.5  | `test/server/service-interface/public-contract.spec.test.ts`<br>`test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`test/server/service-interface/integration/service-interface.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `9.4`                               | `npm run test:server:spec -- test/server/service-interface/public-contract.spec.test.ts`<br>`npm run test:server:imp -- test/server/service-interface/imp/service-interface-characteristics.test.ts`<br>`npm run test:server:integration -- test/server/service-interface/integration/service-interface.integration.test.ts` |
