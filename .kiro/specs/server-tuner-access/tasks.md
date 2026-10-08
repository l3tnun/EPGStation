# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複せず、本 spec 固有 test と承認済み差分・未実装契約の最小実装だけを
追加する。

-   [x] 1. 既存の接続・情報・変更通知・stream契約をcharacterizationする
-   [x] 1.1 (P) 接続形式の既存解釈を固定する

    -   network HTTP、標準・legacy Unix domain socket、base path、User-Agentの既存解釈を`unittest/spec` と
        `unittest/imp` で固定する。Windows named pipeは既存parserおよびHTTP request optionのbest-effortな
        characterizationとしてだけ固定し、Windows host OSの正式対応または実接続を主張しない。
    -   HTTPS、userinfo、接続先専用認証、proxy、TLS optionを提供しない境界を記録する。
    -   placeholder targetだけを使い、実URL、実socket、実pipe、credential、response bodyをfixtureや出力へ残さない。
    -   完了時には、HTTP・Unix socketと禁止optionのfixtureが既存の接続結果を再現し、named pipeの既存parser・request
        optionのcharacterizationが再現される。
    -   _Requirements: 1.6, 1.7, 1.8, 1.9_
    -   _Boundary: connection target parser_

-   [x] 1.2 (P) 放送情報とロゴの既存取得結果を固定する

    -   稼働状態と版、チューナー、放送局、番組一覧、個別番組、ロゴの取得結果を合成responseで`unittest/spec`として固定す
        る。
    -   複数音声、番組説明、拡張情報を含む両製品の表現差を`unittest/imp`で記録する。
    -   放送局・番組・ロゴをチューナー連携境界で保存またはcacheせず、同じロゴの再要求が新しいupstream要求になることを確
        認する。
    -   完了時には、情報・ロゴの成功、取得失敗、再要求、および副作用なしの各fixtureが既存結果を再現する。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: information・logo characterization_

-   [x] 1.3 (P) 両製品の変更通知と既知の終了差を固定する

    -   Mirakurunのprogram・service frame、mirakcのon-air・番組更新通知、初期通知抑止、および放送局別番組取得を
        `unittest/spec`で固定する。
    -   製品判定のcacheと初期取得失敗の伝播は、2.3のtarget testで固定する。
    -   通信・解析失敗では異常通知が一度届き、Mirakurunの通常`end`・`close`では同じ異常通知を送らず終了する差を固定す
        る。
    -   通知へ共通連番を加えず、総接続時間を制限せず、集約・保存・全件同期・再接続判断を開始しないことを確認する。
    -   完了時には、両製品のstarted・changed・aborted・completion順序と通常終了差がsynthetic streamで再現される。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
    -   _Boundary: product detection・change feed characterization_

-   [x] 1.4 (P) 録画・ライブstreamの既存取得と終了境界を固定する

    -   番組指定録画、放送局指定録画、ライブ視聴でID、decode指定、10進数priorityを渡し、Readableを利用側へ返す挙動を
        `unittest/spec`で固定する。
    -   取得失敗、利用側の取消・終了・異常、接続先のterminal event、およびEPGStation側接続破棄を `unittest/imp`で検証す
        る。
    -   確立後のstream継続時間へチューナー連携側の一律期限を設けず、自動再開、競合判断、接続先resource解放確認resultを追
        加しないことを確認する。
    -   完了時には、録画とライブのrequest、Readable受渡し、破棄、terminal event、および再要求なしが再現可能になる。
    -   _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7_
    -   _Boundary: recording・live stream characterization_

-   [x] 1.5 (P) 起動確認と起動後要求の時間境界を固定する

    -   起動時の稼働状態確認が一回のpending要求を打ち切らず、失敗確定後だけ1秒待ち、成功まで試行回数と総待機時間を制限し
        ないことをfake timer付き`unittest/spec`で固定する。
    -   起動確認成功前は後続開始barrierを解放せず、起動後の個別要求失敗を一律に自動retryしないことをconsumer stubで確認
        する。
    -   完了時には、無期限の起動確認、一秒間隔、および後続barrierが別々の観測結果になる。
    -   _Requirements: 7.4, 7.5, 7.6, 7.7_
    -   _Boundary: startup gate_

-   [x] 2. 承認済み差分をtargetごとのRED・最小実装・GREENで追加する
-   [x] 2.1 (P) 直接REST accessと安全なtransportをREDから最小実装・GREENまで一単位で追加する

    -   共通REST・stream routeを直接要求し、製品別の共通route分岐を必要としない目標契約を`unittest/spec`で先に固定する。
    -   HTTP・標準・legacy Unix socket、base path、root-relative redirect、禁止scheme・optionを、新しいtransport境界へ適
        用する期待値を定義する。named pipeは既存parser・request optionのbest-effortなcharacterizationとして扱い、実接続
        を期待値に加えない。
    -   1.1のcharacterizationは成功したまま、直接API利用とtransportの未実装だけを理由にtarget testが失敗するREDを確認し
        てからproductionを変更する。
    -   network HTTPと標準・legacy Unix socketをimmutable targetへ変換し、base path、固定route、ID、queryを安全に組み立
        てる。Windows named pipeは既存parser・request optionをbest-effortにcharacterizeしたまま保持し、新しい実接続契約
        を追加しない。HTTPS、userinfo、credential、proxy、certificate optionをtargetへ持たせない。
    -   root-relative redirectだけを同じ接続先で追跡し、absolute・別origin・relative locationを拒否する。
    -   GET、bodyなし、EPGStation User-Agent、200–202、JSON・Buffer・Readableを扱う共通REST gatewayを実装し、中間・失敗
        responseを回収して個別要求を自動retryしない。
    -   同じ`unittest/spec`、`unittest/imp`、合成HTTP transport targetを再実行する。
    -   完了時には、既存characterizationとtarget testがGREENになり、HTTP・Unix socketのmethod・path・query・header・
        response種別が契約へ一致し、実接続先のlog漏えいと赤い必須testが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 5.1, 6.1,
        6.2, 7.4_
    -   _Boundary: connection target・HTTP transport・REST gateway_
    -   _Depends: 1.1_

-   [x] 2.2 (P) 製品非依存DTOと情報・ロゴfacadeをREDから最小実装・GREENまで一単位で追加する

    -   稼働状態、チューナー、放送局、番組、放送局別番組、個別番組のEPGStation所有DTOを `unittest/spec`で先に固定する。
    -   複数・単数音声、extended、optional field、未知field、required field欠落、JSON不正、非finite値の正規化matrixを定
        義する。
    -   raw objectを共有せず、製品discriminator・製品由来型をconsumer条件へ出さず、情報を保存またはcacheしない期待値を定
        義する。
    -   1.2の既存取得testは成功したまま、製品非依存DTOと不正payload拒否の未実装だけを理由にtarget testが失敗するREDを確
        認してからproductionを変更する。
    -   稼働状態、版、チューナー、放送局、番組と入れ子要素を新規objectへcopyし、複数・単数音声とextendedの製品差を共通表
        現へ変換する。required fieldとJSON shapeを検査し、未知fieldだけでは拒否しない。
    -   情報・ロゴ操作を単一access facadeへまとめ、接続先を起動時snapshotとして保持し、取得結果を保存・memoizeせず、同じ
        ロゴ要求も毎回gatewayへ渡す。
    -   Mirakurun 3.8.0、mirakc 3.1.10、未知field、それ以降の版文字列を含む同じ`unittest/spec`、
        `unittest/imp`、consumer stub targetを再実行する。
    -   完了時には、既存取得testと正規化・facade targetがGREENになり、製品由来型・raw object共有・cache副作用・赤いtest
        が0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: payload normalizer・owned DTO contract_
    -   _Depends: 1.2_

-   [x] 2.3 (P) 製品判定と変更adapterをREDから最小実装・GREENまで一単位で追加する

    -   capability probeの最終200 objectだけをMirakurun、最終404だけをmirakcとしてcacheし、network、cancel、timeout、
        parse、その他statusでは判定しないmatrixを`unittest/spec`で定義する。
    -   Mirakurun frameとmirakc SSEを製品別adapterで正規化し、mirakc通知後の放送局別番組取得を独立REST要求として扱う期待
        値を定義する。
    -   初期取得失敗は開始rejectとして伝え、元のerrorのまま伝わること（error同一性）は`change-feed.test.ts`が固定し、Mirakurun通常終了時の異常通知差を維持する。
    -   1.3のcharacterizationは成功したまま、誤判定cache防止とadapter分離の未実装だけを理由にtarget testが失敗するREDを
        確認してからproductionを変更する。
    -   最終200のJSON objectだけをMirakurun、最終404だけをmirakcとして判定・cacheし、その他の失敗では次回に再probeする。
    -   Mirakurun frameとmirakc SSEを別adapterで正規化する。任意chunk、初期snapshot抑止、独立REST失敗、通常終了差を維持
        し、製品判定後の一つのadapterを冪等close可能なfeed handleとしてfacadeへ結合する。
    -   Mirakurun frameのうちprogram・service以外のresource（`tuner`、`job`、`job_schedule`、未知のresource）は`time`だけを
        検査して読み飛ばし、feedを閉じない。`resource`が文字列でないframe、およびprogram・serviceの内容が不正なframeは解析
        失敗とする。
    -   同じ`unittest/spec`、`unittest/imp`、consumer stub targetを再実行する。
    -   完了時には、既存characterizationとprobe・両adapter・feed lifecycleのtargetがGREENになり、誤判定cache、通知の保
        存・再接続、接続情報漏えい、および赤いtestが0件になる。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 7.1, 7.3, 7.4_
    -   _Boundary: product detector・change adapter contracts_
    -   _Concrete target: `src/model/tuner/TunerServerAccessModel.ts`、`src/model/tuner/types.ts`、
        `src/model/tuner/change/ProductDetector.ts`、`src/model/tuner/change/MirakurunChangeAdapter.ts`、
        `src/model/tuner/change/MirakcChangeAdapter.ts`_
    -   _Depends: 1.3_

-   [x] 2.4 (P) 有限deadlineと破棄可能なstream handleをREDから最小実装・GREENまで一単位で追加する

    -   番組・放送局streamのID、decode、request-local priority、Readable受渡しを`unittest/spec`で定義する。
    -   `close`の冪等性、request・response破棄、確立後terminal event透過、自動再開なし、競合判断なし、resource解放確認
        resultなしを固定する。
    -   録画とライブで同じstream確立portを利用しながら、録画sessionと配信状態をconsumer側へ残す期待値を定義する。
    -   REST用とstream確立用の省略時30,000ms、1以上2,147,483,647以下の安全な整数、起動時snapshot適用を `unittest/spec`で
        定義する。
    -   RESTは全body受信・解析・正規化まで、streamはaccepted headerとhandle生成までを同一absolute deadlineとし、redirect
        ごとに予算を戻さない境界を定義する。
    -   caller cancelとtimeoutのfirst-terminal-wins、request・response・timer・listener cleanup、blanket retryなしを定義
        する。
    -   handle返却後とchange feedには総継続deadlineを残さず、起動確認には一回・全体ともEPGStation期限を適用しない。
    -   1.4と1.5のcharacterizationは成功したまま、有限deadline、共通handle、request-local priority、cleanupの未実装だけ
        を理由にtarget testが失敗するREDを確認してからproductionを変更する。
    -   caller signalとtimeoutを一つのabortへ合成し、first-terminal-winsでsettleしてtimerとlistenerを回収するdeadline
        coordinatorを起動後要求だけへ適用する。
    -   番組・放送局stream要求を組み立て、accepted responseとReadable取得時にdeadline資源を解除して冪等close可能なhandle
        を返す。確立後へ同じdeadline、自動再開、競合判断、接続先resource解放完了resultを追加しない。
    -   同じ`unittest/spec`、`unittest/imp`、fake timer targetを再実行する。
    -   完了時には、既存characterizationと境界・race・cleanup・録画／ライブstream targetがGREENになり、起動確認は無期限
        のまま、残留timer・listener・赤いtestが0件になる。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.3, 7.1, 7.2, 7.3, 7.4,
        7.5, 7.6, 7.7_
    -   _Boundary: deadline coordinator・stream gateway・stream handle_
    -   _Depends: 1.4, 1.5, 2.1, 2.2_

-   [x] 6. 既存consumerを正準portへ結線し専用client依存を除去する
-   [x] 6.1 (P) 番組情報・予約照会を製品非依存portへ結線する

    -   完了境界: consumerとDB型境界の移行後も、production bootstrapの共有`TunerServerAccess` bindingはTask 6.4が所有す
        る。Task 6.4で`src/index.ts`の予約用チューナー取得まで正準portへ結線するまで、本taskのcheckboxは完了にしない。

    -   正準portへ未結線であることだけを理由に失敗する番組情報・変更feed・予約照会のtarget `integration` testを先に追加
        し、意図したREDを確認する。
    -   番組情報・番組表には正規化済み情報、変更feed、放送局別番組、ロゴ取得結果だけを渡し、通知集約・保存・再接続判断を
        残す。
    -   予約管理には正規化済みチューナー能力だけを渡し、競合計画と割当判断を残す。
    -   DB・予約・番組情報の境界から製品package由来型を除き、番組ジャンル、音声、説明、囲み文字、対象放送局の業務変換は
        各consumerの既存規則を変更しない。
    -   同じtarget `integration` testを再実行する。
    -   完了時には、情報・変更・予約consumerのtargetがGREENになり、正準port経由で成功して製品route・frame・型の再定義と
        赤いtestが0件になる。
    -   _Requirements: 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.5_
    -   _Boundary: explicit integration―tuner access・program guide・reservation query_
    -   _Concrete target: `src/model/epgUpdater/EPGUpdateManageModel.ts`、
        `src/model/epgUpdater/IEPGUpdateManageModel.ts`、`src/model/epgUpdater/EPGUpdater.ts`、
        `src/model/operator/reservation/ReservationManageModel.ts`、
        `src/model/operator/reservation/IReservationManageModel.ts`、
        `src/model/operator/reservation/Tuner.ts`、`test/server/tuner-access/consumers.integration.test.ts`_
    -   _Depends: 2.2, 2.3_

-   [x] 6.2 (P) 録画・ライブconsumerをstream portへ結線する

    -   stream portへ未結線であることだけを理由に失敗する録画・ライブconsumerのtarget `integration` testを先に追加し、意
        図したREDを確認する。
    -   予約録画実行へ番組・放送局stream handleを渡し、録画時刻、録画追従、録画結果、終了条件をconsumer側へ残す。
    -   映像配信へ放送局stream handleを渡し、変換、HLS、視聴session、配信終了条件をconsumer側へ残す。
    -   同じtarget `integration` testを再実行する。
    -   完了時には、録画・ライブconsumerのtargetがGREENになり、priority、Readable、close、terminal eventが維持され、赤い
        testが0件になる。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
    -   _Boundary: explicit integration―tuner access・recording・media delivery_
    -   _Depends: 2.4_

-   [x] 6.3 (P) ロゴconsumerをlogo portへ結線する

    -   logo portへ未結線であることだけを理由に失敗するBuffer受渡し、not-found、server error、再要求のtarget
        `integration` testを先に追加し、意図したREDを確認する。
    -   ロゴconsumerでは保存済み情報がexactにfalseの場合だけ既存not-foundとし、trueまたは未設定ではlogo portを呼び、
        upstream失敗をserver errorとして維持する。
    -   同じ放送局への再要求を毎回upstreamへ送り、取得画像または取得errorを保存・cacheしない。
    -   同じtarget `integration` testを再実行する。
    -   完了時には、ロゴconsumerのtargetがGREENになり、Buffer受渡し、not-found、server error、再要求が維持され、赤いtest
        が0件になる。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: explicit integration―tuner access・logo_
    -   _Depends: 2.2_

-   [x] 6.4 access facadeを共有bindingし専用client packageを除去する

    -   production import graph、共有instance数、起動時snapshot、および専用client package不在を検証するtarget dependency
        testを先に追加し、旧bindingとpackage依存だけを理由に失敗するREDを確認する。
    -   access facade、transport、normalizer、product detectorをprocess内で共有し、接続targetとdeadlineは起動時snapshot
        から一度だけ生成する。
    -   情報、変更、録画、ライブ、ロゴのproduction import graphから専用client packageとpackage API型を除去する。
    -   package削除後に同じtarget dependency test、fresh install、production build、domain testを再実行する。
    -   完了時には、targetがGREENになり、専用client packageなしでinstall・build・domain testが成功し、production import
        hitと赤いtestが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.6, 2.7_
    -   _Boundary: access composition・dependency removal_
    -   _Depends: 6.1, 6.2, 6.3_

-   [x] 7. transport・consumer・対応版を結合検証する
-   [x] 7.1 (P) HTTP互換transportと全操作を合成serverで結合検証する

    -   合成HTTP serverとtemporary Unix socketでREST、redirect、logo、Mirakurun event、mirakc SSE、録画・ライブstream、
        abortを`integration`として通す。
    -   Windows named pipeは既存parser・request optionのbest-effortなcharacterizationに限定する。Windows host OSはserver
        正式対応外のためtemporary pipe実接続を必須にせず、非Windowsのrequest option seamを実接続PASSと記載しない。
    -   timeout、cancel、network、status、parseの各失敗後にrequest、response、timer、listener、intervalが残らず、実接続
        先やbodyがログへ出ないことを確認する。
    -   完了時には、HTTP・Unix socketと全routeの必須合成matrixが再現可能に成功し、named pipe実接続の未実
        行・skip・failureをleaf未完了、dependency/release blocker、unresolved riskへ数えず、cleanup未完了と秘密情報
        findingが0件になる。
    -   _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 3.1, 3.2, 3.3, 4.4, 4.5, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_
    -   _Boundary: transport integration_
    -   _Depends: 2.3, 2.4, 6.4_

-   [x] 7.2 (P) 起動barrierと各consumerの受渡しを結合検証する

    -   起動確認pending中は後続consumerを開始せず、失敗確定後1秒で新しい確認を行い、成功時だけbarrierを解放する。
    -   番組表の変更feed、録画とライブのpriority・close、ロゴのnot-found・server error projectionをconsumer stubで
        `integration`検証する。
    -   長時間の変更feed、録画stream、ライブstreamをfake clockで継続し、確立deadlineがhandle返却後に誤って終了させないこ
        とを確認する。
    -   完了時には、起動・番組表・録画・配信・ロゴの受渡しが一つのdomain suiteで成功し、owner外の業務判断を追加しない。
    -   _Requirements: 2.8, 3.3, 3.4, 3.5, 3.7, 4.3, 4.5, 4.6, 4.7, 5.2, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5,
        7.2, 7.4, 7.5, 7.6, 7.7_
    -   _Boundary: consumer integration_
    -   _Depends: 2.3, 6.1, 6.2, 6.3, 6.4_

-   [x] 7.3 (P) 最低対応版と将来版の契約matrixを自動検証する

    -   Mirakurun 3.8.0とmirakc 3.1.10の合成contract fixtureで、status、版、チューナー、放送局、番組、ロゴ、通知、stream
        shapeを検証する。
    -   未知の追加fieldとそれ以降の版文字列を通し、exact allowlist、上限版、追加fieldだけを理由とする拒否がないことを確
        認する。
    -   Node.js 24必須・26追加matrixの同一domain suiteから実行し、Node.js 18の成功を代替またはfallbackにしない。
    -   完了時には、最低対応版fixtureと将来版fixtureが両Node matrixで成功する。
    -   _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
    -   _Boundary: compatibility contract matrix_
    -   _Depends: 6.4_

-   [x] 8. チューナーアクセス固有testを共有server品質gateへ接続する
-   [x] 8.1 正式な機能固有test inventoryを作り`unittest/spec`を完成させる

    -   `test/server/tuner-access/tuner-access.spec.test.ts`にRequirements 1から7の全53 ACと主case、補助case、合成
        fixture、期待する戻り値・error・状態・effectを一意に対応付け、未割当ACを0件にする。
    -   同fileで、最低対応版と以降の版、HTTP・Unix domain socketの接続意味、named pipeの既存parser・request optionの
        best-effortなcharacterization、製品非依存DTO、change feed、録画・ライブstream、logo、有限な一回の要求、および無
        期限の起動確認barrierを外部契約として検証する。
    -   `test/server/fixtures/tuner-access/`には実endpoint、credential、実socket・pipe、実番組情報を含めず、Mirakurun
        3.8.0、mirakc 3.1.10、未知の追加field、それ以降の版文字列を合成fixtureとして配置する。
    -   完了時には、正式inventoryから全53 ACを成功したnamed caseへ逆引きでき、未割当、根拠のないskip、実環境依存、および
        補助planned caseの正式trace混入がいずれも0件である。
    -   _Depends: 2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.4_
    -   _Requirements: 8.1_

-   [x] 8.2 transport・正規化・製品判定・deadline分岐を`unittest/imp`で完成させる

    -   `test/server/tuner-access/implementation.test.ts`でHTTP、標準・legacy Unix domain socket、named pipeの既存
        parser・ request optionによるbest-effortな分類、base path、route、redirect、200–202、ID encode、priorityの0・1の
        10進伝達、禁止scheme・optionを検証する。named pipeのrequest option seamは`implementation.posix.test.ts`が非Windows
        だけで検証し、named pipe実接続を検証結果に含めない。
    -   同fileと`test/server/tuner-access/product-detection.test.ts`で最低版・以降版、required field欠落、未知field、
        `null`、空body・object・配列、不正型、非finite値、`audios`・`audio`・`extended`、最終200 object・404・その他
        status・network・parse失敗と成功時だけのcacheを検証する。ID・priority固有の最小・最大・範囲外とruntime型検査は
        caller所有のため非適用とし、代表値の透過だけをoracleにする。
    -   `test/server/tuner-access/deadline.test.ts`でdeadlineの1、2147483647、0、負数、上限超過、小数、非safe、非
        finite、deadline直前・到達・超過、redirect共通予算、response・abort・timeoutの同着、late settlement、重複
        terminalをdeferred responseとfake clockで検証する。
    -   完了時には、Designのspec・imp契約matrixと値域分岐が対応assertionまたは明示的な非適用理由へ逆引きでき、未分類
        branchが0件である。
    -   _Depends: 8.1_
    -   _Requirements: 8.2_

-   [x] 8.3 lifecycle・失敗・race・所有権・資源matrixを全suiteへ割り当てる

    -   Task 8.1のinventoryを、要求前・REST要求中・stream確立中・引渡し済み・change feed接続中・product判定中・startup
        pending／失敗／成功・終了へ展開し、成功、通信error、解析失敗、通常終了、close、abort、timeout、再入、restart、
        late settlement、同着、race、重複通知を主case、補助caseまたは非適用理由へ一意に割り当てる。
    -   `tuner-access.spec.test.ts`へ外部契約、`implementation.test.ts`、`deadline.test.ts`、
        `product-detection.test.ts`、`change-feed.test.ts`へ値域・状態・順序・分岐、
        `transport.integration.test.ts`と`consumers.integration.test.ts`へ境界と受渡しを割り当てる。
    -   引渡し前のrequest・response・timer・AbortSignal listener、change parser・interval、合成server・socketを成功・失
        敗・abort・timeoutで一回だけ回収し、引渡し後はReadable所有権をconsumerへ移し、冪等closeとterminal event伝播を観
        測する。startup失敗settle後1秒、試行回数・総待機上限なし、restart時の新instance・設定snapshotも分類する。
    -   接続先チューナー資源の解放完了確認は本機能が共通result、poll、listener、promiseを所有しないため非適用とする。DB
        transaction、IPC、永続filesystem、file lock、child processも非適用とし、temporary Unix socket nodeだけをtest資源
        として別に回収する。
    -   完了時には、matrixの契約、種別、入力、状態、時間・順序、資源、外部境界に未分類項目が0件である。
    -   _Depends: 8.1, 8.2_
    -   _Requirements: 8.3_

-   [x] 8.4 HTTP・Unix socketを合成transportで結合検証する

    -   `test/server/tuner-access/transport.integration.test.ts`で合成HTTP serverとtemporary Unix domain socketへ
        REST、redirect、Mirakurun change stream、mirakc SSE、録画・ライブstream、logo、abortを接続し、成功・失敗・
        timeout・closeのwire結果とcleanupを検証する。
    -   named pipeは既存parser・request option seamを`implementation.posix.test.ts`（`unittest/imp`）でbest-effortに
        characterizeし、Windows上の実接続は`transport.win32.integration.test.ts`だけが確認する。非Windowsの結果を
        実接続PASSへ代替しない。Windows host OSはserver正式対応外のため、名前付きパイプ実接続の未実行・skip・failureを
        leaf未完了、dependency/release blocker、unresolved riskへ数えない。
    -   各case後に合成serverとsocketをcloseし、Unix socket nodeをunlinkし、request、response、stream、timer、listener、
        interval、open handleの残存0件を観測する。DB、IPC、永続filesystem、製品process、child processは本機能の結合境界
        ではないため理由付き非適用として記録する。
    -   `test/server/tuner-access/consumers.integration.test.ts`でstartup barrier、変更feed、録画・ライブのpriority・
        Readable・close、logo projectionを正準portから検証し、consumer所有の永続化、競合判断、録画・配信状態を本機能へ移
        さない。
    -   完了時には、HTTP・Unix socketの必須integrationをtransport別に識別でき、named pipeのbest-effort characterization
        を実接続成功件数へ含めず、後始末未完了が0件である。
    -   _Depends: 7.1, 7.2, 7.3, 8.3_
    -   _Requirements: 8.4_

-   [x] 8.5 本機能の品質判定を満たす

    -   Task 8.1から8.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 8.1, 8.2, 8.3, 8.4_
    -   _Requirements: 8.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                        | Test type                                          | Local Depends                            | Verification command                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`                                                                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`                                                                                                           |
| 1.2  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`                                                                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`                                                                                                           |
| 1.3  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/change-feed.test.ts`                                                                                                                                                                                                                 | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/change-feed.test.ts`                                                                                                              |
| 1.4  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/deadline.test.ts`                                                                                                                                                                                                                    | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/deadline.test.ts`                                                                                                                 |
| 1.5  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/deadline.test.ts`                                                                                                                                                                                                                    | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/deadline.test.ts`                                                                                                                 |
| 2.1  | `src/model/tuner/TunerServerAccessModel.ts`<br>`src/model/tuner/transport/ConnectionTargetParser.ts`<br>`src/model/tuner/transport/TunerHttpTransport.ts`<br>`test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`                                                 | `unittest/spec`<br>`unittest/imp`                  | `1.1`                                    | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`                                                                                                           |
| 2.2  | `src/model/tuner/TunerServerAccessModel.ts`<br>`src/model/tuner/types.ts`<br>`test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`                                                                                                                                 | `unittest/spec`<br>`unittest/imp`                  | `1.2`                                    | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`                                                                                                           |
| 2.3  | `src/model/tuner/change/ProductDetector.ts`<br>`src/model/tuner/change/MirakurunChangeAdapter.ts`<br>`src/model/tuner/change/MirakcChangeAdapter.ts`<br>`test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/product-detection.test.ts`<br>`test/server/tuner-access/change-feed.test.ts` | `unittest/spec`<br>`unittest/imp`                  | `1.3`                                    | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/product-detection.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/change-feed.test.ts`                           |
| 2.4  | `src/model/tuner/TunerServerAccessModel.ts`<br>`src/model/tuner/transport/TunerHttpTransport.ts`<br>`src/model/IConfigFile.ts`<br>`src/model/Configuration.ts`<br>`config/config.yml.template`<br>`test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/deadline.test.ts`                  | `unittest/spec`<br>`unittest/imp`                  | `1.4, 1.5, 2.1, 2.2`                     | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/deadline.test.ts`                                                                                                                 |
| 6.1  | `src/model/epgUpdater/EPGUpdateManageModel.ts`<br>`src/model/operator/reservation/ReservationManageModel.ts`<br>`test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                               | `integration`                                      | `2.2, 2.3`                               | `npm run test:server:integration -- test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                |
| 6.2  | `src/model/operator/recording/RecordingStreamCreator.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`<br>`test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                         | `integration`                                      | `2.4`                                    | `npm run test:server:integration -- test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                |
| 6.3  | `src/model/api/channel/ChannelApiModel.ts`<br>`test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                                                 | `integration`                                      | `2.2`                                    | `npm run test:server:integration -- test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                |
| 6.4  | `src/model/tuner/TunerServerAccessModel.ts`<br>`src/model/ModelContainerSetter.ts`<br>`package.json`<br>`package-lock.json`<br>`test/server/tuner-access/implementation.test.ts`                                                                                                                                       | `unittest/imp`                                     | `6.1, 6.2, 6.3`                          | `npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`                                                                                                                                                                                               |
| 7.1  | `test/server/tuner-access/transport.integration.test.ts`                                                                                                                                                                                                                                                               | `integration`                                      | `2.3, 2.4, 6.4`                          | `npm run test:server:integration -- test/server/tuner-access/transport.integration.test.ts`                                                                                                                                                                                |
| 7.2  | `test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                                                                                               | `integration`                                      | `2.3, 6.1, 6.2, 6.3, 6.4`                | `npm run test:server:integration -- test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                                                                |
| 7.3  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/product-detection.test.ts`                                                                                                                                                                                                           | `unittest/spec`<br>`unittest/imp`                  | `6.4`                                    | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/product-detection.test.ts`                                                                                                        |
| 8.1  | `test/server/tuner-access/tuner-access.spec.test.ts`                                                                                                                                                                                                                                                                   | `unittest/spec`                                    | `2.1, 2.2, 2.3, 2.4, 6.1, 6.2, 6.3, 6.4` | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`                                                                                                                                                                                           |
| 8.2  | `test/server/tuner-access/implementation.test.ts`<br>`test/server/tuner-access/implementation.posix.test.ts`<br>`test/server/tuner-access/product-detection.test.ts`<br>`test/server/tuner-access/deadline.test.ts`                                                                                                                                                               | `unittest/imp`                                     | `8.1`                                    | `npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.posix.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/product-detection.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/deadline.test.ts`                                  |
| 8.3  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`<br>`test/server/tuner-access/transport.integration.test.ts`                                                                                                                                                  | `unittest/spec`<br>`unittest/imp`<br>`integration` | `8.1, 8.2`                               | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`<br>`npm run test:server:integration -- test/server/tuner-access/transport.integration.test.ts`            |
| 8.4  | `test/server/tuner-access/implementation.posix.test.ts`<br>`test/server/tuner-access/transport.integration.test.ts`<br>`test/server/tuner-access/consumers.integration.test.ts`                                                                                                                                              | `unittest/imp`<br>`integration`                    | `7.1, 7.2, 7.3, 8.3`                     | `npm run test:server:imp -- test/server/tuner-access/implementation.posix.test.ts`<br>`npm run test:server:integration -- test/server/tuner-access/transport.integration.test.ts`<br>`npm run test:server:integration -- test/server/tuner-access/consumers.integration.test.ts` |
| 8.5  | `test/server/tuner-access/tuner-access.spec.test.ts`<br>`test/server/tuner-access/implementation.test.ts`<br>`test/server/tuner-access/transport.integration.test.ts`                                                                                                                                                  | `unittest/spec`<br>`unittest/imp`<br>`integration` | `8.1, 8.2, 8.3, 8.4`                     | `npm run test:server:spec -- test/server/tuner-access/tuner-access.spec.test.ts`<br>`npm run test:server:imp -- test/server/tuner-access/implementation.test.ts`<br>`npm run test:server:integration -- test/server/tuner-access/transport.integration.test.ts`            |
