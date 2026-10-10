# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、設定管理固有の test と承認済み差分の実装だけを追加す
る。

-   [x] 1. 既存の設定候補構築と起動条件を仕様テストで固定する
-   [x] 1.1 YAML 読み込み、標準値補完、表記正規化を characterization する

    -   既存実装は変更せず、YAML から設定候補を作り、主要な省略値と利用可能なストリーミング選択肢だけを補う挙動を
        `unittest/spec` で固定する。
    -   サーバー基準位置、配信サブディレクトリ、録画・一時録画・サムネイル・配信用保存先の表記を、synthetic fixture で
        `unittest/imp` として検証する。
    -   標準値テンプレートを利用できる場合と利用できない場合を分け、利用できない基準値を推定して補わないことを確認する。
    -   完了時には、省略、末尾区切り、基準位置記号、およびストリーミング設定の各 fixture が承認済みの設定候補を再現
        し、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 2.4_
    -   _Boundary: 初回読み込み・候補構築_

-   [x] 1.2 設定取得の独立性と録画保存先の選別を characterization する

    -   既存実装は変更せず、その時点で有効な設定一式と、通常の録画保存先から一時録画用の名前を除く挙動を `unittest/spec`
        で固定する。
    -   ネストした配列とオブジェクトを含む取得結果を変更しても、管理中の設定および前後の取得結果へ波及しないことを
        `unittest/imp` で検証する。
    -   完了時には、同じ有効設定から得た複数の取得結果が相互に独立し、一時録画用保存先が通常一覧へ現れない。
    -   _Requirements: 1.6, 3.1, 3.2, 3.3_
    -   _Boundary: 有効設定・独立複製_

-   [x] 1.3 HTTP/HTTPS の最低起動条件と読込失敗を characterization する

    -   既存実装は変更せず、設定ファイルの不存在、読取不能、YAML 解釈不能、および HTTP/HTTPS 両方の最低条件不足を
        `unittest/spec` で固定する。
    -   HTTP 待受だけ、HTTPS の待受・秘密鍵・証明書の組だけ、および両方を持つ候補が設定提供可能になることを検証する。
    -   `integration` harness では、失敗候補から設定取得可能状態へ進まず、後続処理を開始できない結果になることを確認す
        る。
    -   完了時には、正常な待受構成だけが設定を提供し、各失敗 fixture は起動失敗として観測できる。
    -   _Requirements: 2.1, 2.2, 2.3_
    -   _Boundary: 初回読み込み・最低起動条件_

-   [x] 1.4 `!env`・anchor/alias/merge key の展開と `better-sqlite3` の読み替えを固定する

    -   `config.yml` の `!env 環境変数名`、YAML の anchor・alias・merge key `<<`、`dbtype` の `better-sqlite3` を `sqlite` として
        扱う規則を `src/model/ConfigYaml.ts` に置き、サーバーと `ormconfig.js` が同じ定義を読む。
    -   `unittest/spec` で、`!env` の展開と未定義時の失敗、merge key（複数・明示した値の優先・配列の要素の中・`!env` との併用）、
        `dbtype` の読み替えを固定する。
    -   `ormconfig.js` 側の同じ規則は、`server-persistence` の結合 test（`test/server/persistence/orm-cli.integration.test.ts`）が
        確かめる。
    -   完了時には、上の各規則が設定候補に反映され、`ormconfig.js` も同じ結果になる。
    -   _Requirements: 1.1, 1.7, 2.1, 4.2, 4.4_
    -   _Boundary: 初回読み込み・YAML の解釈_

-   [x] 2. 設定変更時の切替契約を仕様テストで固定する
-   [x] 2.1 変更検知から有効設定の一括置換までを characterization する

    -   既存実装は変更せず、設定ファイルの変更検知後に初回と同じ読込、補完、正規化を候補へ適用する流れを `unittest/spec`
        で固定する。
    -   候補構築中は有効設定を部分更新せず、全処理に成功した後の取得要求だけが新しい独立複製を得ることを `unittest/imp`
        で検証する。
    -   完了時には、変更前と変更後の取得結果がそれぞれ一つの完全な設定世代になり、混在した中間状態が観測されない。
    -   _Requirements: 4.1, 4.2, 4.3_
    -   _Boundary: ファイル監視・再読み込み_

-   [x] 2.2 再読み込み失敗時の直前値保持と非配信を characterization する

    -   既存実装は変更せず、読込、YAML 解釈、補完または検証に失敗した候補を破棄し、直前の有効設定を維持する挙動を
        `unittest/spec` で固定する。
    -   失敗が運用ログへ記録されることと、成功後も既に取得済みの設定を自動変更せず、consumer の停止・再起動・更新通知を
        発生させないことを `unittest/imp` で確認する。
    -   完了時には、失敗直後の新規取得が直前値を返し、既存取得結果も不変で、異常記録だけが観測される。
    -   _Requirements: 4.4, 4.5_
    -   _Boundary: 再読み込み失敗・有効設定保持_

-   [x] 3. 公開設定と外部コマンドの互換契約を固定する
-   [x] 3.1 Web UI 向け公開設定の allowlist を characterization する

    -   リアルタイム通知ポートの既存選択順、録画保存先名、エンコード方法名、利用可能な配信方法、端末別再生 URL、および外
        部再生先名を `unittest/spec` と `integration` で固定する。
    -   DB 認証情報、内部保存場所、外部コマンド、および処理量・期限の内部設定が公開結果へ含まれないことを synthetic
        marker で否定検証する。
    -   完了時には、許可された表示情報だけが公開結果に現れ、秘密情報と内部設定の marker は全経路で 0 件になる。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 7.11_
    -   _Boundary: Web UI 向け公開設定_
    -   _Depends: 1.2_

-   [x] 3.2 外部コマンド設定の既存解釈を characterization する

    -   既存実装は変更せず、空白区切りによる実行対象と順序付き引数の分離を `unittest/spec` で固定する。
    -   Node.js 実行対象記号、サーバー基準位置記号、引数内空白記号、および空の引数要素の既存解釈を `unittest/imp` で検証
        する。
    -   実行対象が存在しない場合は準備エラーとなり、shell コマンドとして別解釈されないことを確認する。
    -   完了時には、synthetic executable と各記号の fixture が既存の実行対象・引数列を再現し、不在 fixture だけが開始前
        に失敗する。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4_
    -   _Boundary: 外部コマンド設定の解釈_

-   [x] 4. 承認済みの処理量・期限設定を追加する
-   [x] 4.1 6項目の目標契約を一単位で追加する

    -   6項目の省略時既定値、許容境界、型不正、範囲外、完全複製への包含、公開設定からの除外、および起動時保持を、
        target `unittest/spec` と`unittest/imp`が検証する。
    -   timer に直接渡す2項目は 1 と 2,147,483,647 を受理し、その外側、小数、文字列、非有限値を拒否する境界を固定する。
    -   `src/model/IConfigFile.ts`、`src/model/Configuration.ts`、および`config/config.yml.template`へ、
        型、補完・検証、標準設定を実装する。
    -   エンコード待機1,024件、同時アップロード3件、アップロード受信300,000ミリ秒、サムネイル待機32件、外部コマンド待機
        64件、外部コマンド期限300,000ミリ秒を省略時に補う。
    -   6項目を内部設定として完全な設定複製へ含め、公開設定 schema や公開 API へ追加しない。
    -   consumer の queue、timeout、処理開始・終了は各 owner spec に残し、この task では default、型、および設定取得契約
        だけを変更する。
    -   エンコード待機上限と同時アップロード数には1以上の安全な整数、二つの待機依頼上限には1以上10,000以下の整数だけを許
        可する。
    -   二つの期限には1以上2,147,483,647以下の整数だけを許可し、丸め、文字列変換、上限超過の分割 timeout を行わない。
    -   初回の不正値は設定提供前にエラーとし、再読み込みの不正値は候補だけを破棄して直前値を維持する。
    -   完了時には、最小値・最大値が成功し、0、負数、小数、文字列、非有限値、上限超過の全fixtureが設定エラーとなる。既存
        characterization testとtarget testが成功し、公開結果のshapeが変わらないことを観測できる。
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_
    -   _Boundary: 起動時スナップショット設定・標準値・候補検証_
    -   _Depends: 1.1, 1.2, 2.1, 3.1_

-   [x] 4.2 storage command timeout raw snapshot契約を一単位で追加する

    -   `test/server/configuration/storage-timeout-provider.cross-spec.test.ts`でfield不在、有効raw値、不正raw値を読み、
        完全cloneとreload前後snapshotが参照非共有のまま同じraw値を保持する補足contractをtarget testが検証する。
    -   公開projectionに`storageLimitCommandTimeoutMs`が現れず、providerがdefault補完、数値変換、範囲検証、consumer開始
        を行わない期待値を固定する。
    -   `IConfigFile`、`Configuration`、`config/config.yml.template`へoptional raw `storageLimitCommandTimeoutMs`
        carrierを追加し、field不在、有効値、不正値をprovider側で解釈せず完全cloneへ保持する。
    -   reload成功時だけ新snapshotへ切り替え、取得ごとに参照非共有のraw値を返し、公開allowlistへ追加しない。
    -   既定値300,000、正の有限値判定、timer適用、設定errorによるstorage開始抑止はStorage Management consumerへ残す。
    -   初回読込、clone二回、reload成功・失敗、field不在、有効raw、不正raw、公開projectionを同じsynthetic YAML fixtureで
        target testが検証する。
    -   補足caseをRequirement 8の正式inventory件数へ加算せず、Storage Managementのconsumer testからraw snapshotを利用で
        きるcross-spec fixtureとして公開する。
    -   完了時には同じtarget testと既存configuration characterizationが成功し、旧新snapshot混在、参照共有、providerによ
        る変換・拒否、公開field追加、および公開漏えいが0件になる。
    -   _Requirements: 1.1, 3.1, 3.2, 3.3, 4.2, 4.3, 4.4, 4.5, 5.4, 8.1, 8.2, 8.3, 8.4_
    -   _Boundary: storage timeout raw configuration provider contract・complete snapshot・cross-spec verification_
    -   _Depends: 4.1_

-   [x] 5. 設定ライフサイクルを実ファイル境界で結合検証する
-   [x] 5.1 初回読込、再読み込み、再起動相当の切替を結合検証する

    -   synthetic な一時設定ファイルを用い、初回読込、正常な再読み込み、不正な再読み込み、直前値保持、および新しい設定管
        理 instance での再起動相当の読込を `integration` で検証する。
    -   設定再読み込み後も既に取得済みの起動時スナップショットは変わらず、新しい instance だけが変更済みの6項目を取得す
        ることを確認する。
    -   設定エラー時は後続開始可能な設定を返さず、再読み込み失敗だけは稼働中の直前値を返すことを確認する。
    -   完了時には、設定ファイルの各世代と取得結果の対応が一意になり、fixture と出力に実環境値を含まない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 7.10, 7.12_
    -   _Boundary: 設定管理ライフサイクル結合_
    -   _Depends: 4.1_

-   [x] 5.2 完全複製と公開 allowlist を結合検証する

    -   6項目を含む完全な設定複製が取得ごとに独立し、Web UI 向け公開結果には6項目と synthetic secret marker が現れないこ
        とを `integration` で確認する。
    -   consumer 固有の queue、timeout、実行時 backpressure はこの結合検証へ実装せず、各 owner spec の task に委譲する。
    -   完了時には、設定管理固有の `unittest/spec`、`unittest/imp`、`integration` が共通 server test command から再現可
        能に成功し、公開結果の既存 shape が維持される。
    -   _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 5.4, 7.11, 7.12_
    -   _Boundary: 設定複製・公開設定結合_
    -   _Depends: 4.1_

-   [x] 6. 設定管理固有testを共有server品質gateへ接続する
-   [x] 6.1 正式な機能固有test inventoryを作り`unittest/spec`を完成させる

    -   `test/server/configuration/configuration.spec.test.ts`にRequirements 1から7の全38 ACと主case、補助
        case、fixture、期待する戻り値・error・状態・effectを一意に対応付け、未割当ACを0件にする。対応表は同fileの
        `[CFG-6.1-AC-TRACE]`が持ち、AC 1.1から7.12の38個の鍵ごとに、同directoryの`*.test.ts`に実在するcase IDを引き、
        `CFG-4.2-*`の補助caseを含まないこと、およびskip・todoのcaseが無いことを検査する。
    -   同fileで、読込・補完・正規化、HTTP/HTTPS最低条件、独立複製、再読み込み中の旧設定・成功後の新設定・失敗後の直前設
        定、公開allowlist、外部コマンド解釈、および6項目の既定値・検証・起動時保持を外部契約として検証する。
    -   `test/server/fixtures/configuration/`には実秘密情報と実運用pathを含まない合成YAML、鍵、証明書だけを配置し、
        templateと実行fileはtestが一時directoryに作って回収する。Designの補足case（`CFG-4.2-*`）は正式trace外のままとし、38 ACの
        inventory、Requirement 8のmatrix、case件数へ加えない。
    -   完了時には、正式inventoryから全38 ACを成功したnamed caseへ逆引きでき、未割当、根拠のないskip、および補助
        caseの正式trace混入がいずれも0件である。
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2_
    -   _Requirements: 8.1_

-   [x] 6.2 省略値・値域・複製・正規化の分岐を`unittest/imp`で完成させる

    -   `test/server/configuration/implementation.test.ts`で、6項目の省略値、1、各最大許容値、0、負数、上限超過、小数、
        文字列、`NaN`、正負の無限値を表どおり検証し、候補採否、設定error、consumer開始effect 0件をassertする。
    -   同fileで、`null`、空YAML、空の必須object、深い配列・objectの参照非共有、基準位置・末尾区切り・subdirectory・
        stream選択肢の正規化、公開allowlist、および空command・存在しない実行fileの分岐を検証する。
    -   deferred readで再読み込みを保留し、旧設定取得、成功時の一括置換、失敗時の直前値保持、late settlement、同着、
        race、重複通知の各branchをcall ledgerから観測する。競合時の最終winner順序は新しい製品契約にせず、実際の完了順と
        結果を証跡化する。
    -   完了時には、Designの値域表、複製、正規化、allowlist、実行file不存在、一括置換の各分岐が対応assertionから逆引きで
        き、非適用値または未分類branchが0件である。
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 6.1_
    -   _Requirements: 8.2_

-   [x] 6.3 値・default・reload・状態・失敗・race・資源matrixを全suiteへ割り当てる

    -   Task 6.1のinventoryを、契約、test種別、入力とdefault、値域、開始前・有効設定あり・再読み込み中・成功・失敗・次回
        初期化の状態、late settlement・同着・race・重複通知、およびfile・watcher・listener・isolated child・server
        listenerの取得から解放までへ展開する。
    -   `test/server/configuration/configuration.spec.test.ts`へ外部契約とconsumer snapshot、
        `test/server/configuration/implementation.test.ts`へ値域・分岐・deferred read、
        `test/server/configuration/filesystem.integration.test.ts`へfile・watcher・listener・isolated child、
        `test/server/configuration/http.integration.test.ts`へrequest/response lifecycleを割り当てる。
    -   cancelはinterfaceに存在せず、timeout・deadlineはRequirements 1から7が定義せず、DB transaction・stream・lockは本
        機能が取得しないため非適用とする。製品process再起動をtest harnessのisolated child回収と混同しない。
    -   各caseで有効設定の置換回数、旧・新設定の完全性、errorと運用log、consumer・process開始effect 0件、file close、
        watch/unwatchの同一path・listener各1回、およびteardown後のtimer・listener・open handle 0件を観測する。
    -   完了時には、matrixの各項目に主case、補助caseまたは非適用理由があり、未分類項目が0件である。
    -   _Depends: 6.1, 6.2_
    -   _Requirements: 8.3_

-   [x] 6.4 filesystemと公開設定HTTP projectionを結合検証する

    -   `src/model/IConfigurationFileAccess.ts`、`src/model/ConfigurationFileAccess.ts`、
        `src/model/ModelContainerSetter.ts`のDesign済みseamを用い、
        `test/server/configuration/filesystem.integration.test.ts`からtemporary設定・template pathを注入できるようにする。
    -   filesystem integrationで設定・templateの正常、不在、読取不能、解析失敗と、正常・不正な変更通知を接続し、同期・非
        同期readのpath・回数、旧・新設定、直前値保持、file close、同一listenerのwatch/unwatch、fixture回収を検証する。
    -   合成鍵・証明書とephemeral portはisolated child内の`ServiceServer.start()`へ接続し、成功時のlistener開始と、不
        在・読取不能時の起動失敗を区別して、全経路でchild、server listener、file handleを親harnessが回収する。合成実行
        fileは存在確認までとし、外部コマンドprocessを開始しない。
    -   `test/server/configuration/http.integration.test.ts`で公開設定の実装（`ConfigApiModel`）をlocal HTTP harnessへ接続し、許可fieldを肯定検
        証し、DB認証情報、内部path、外部command、6つの処理量・期限fieldが応答に存在しないことをfield単位でassertする。
    -   DBは設定状態を永続化せず、IPCは設定外情報の配送を所有せず、外部コマンド実行と製品process再起動は利用機能が所有す
        るため非適用と記録する。isolated childはtest隔離であり製品process contractへ昇格させず、未実行を成功扱いしない。
    -   完了時には、targetが成功し、filesystemとHTTPの成功・失敗・後始末を境界別に観測でき、DB・IPC・製品processの
        非適用理由を含む結合matrixの未分類が0件である。
    -   _Depends: 1.1, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.3_
    -   _Requirements: 8.4_

-   [x] 6.5 本機能の品質判定を満たす

    -   Task 6.1から6.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 4.2, 6.1, 6.2, 6.3, 6.4_
    -   _Requirements: 8.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                | Test type                                          | Local Depends                                           | Verification command                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                                                                                                                   | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 1.2  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                                                                                                                   | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 1.3  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/filesystem.integration.test.ts`                                                                                                                           | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:integration -- test/server/configuration/filesystem.integration.test.ts`                                                                                                                                                                             |
| 1.4  | `src/model/ConfigYaml.ts`<br>`test/server/configuration/configuration.spec.test.ts` | `unittest/spec` | `1.1` | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts` |
| 2.1  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                                                                                                                   | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 2.2  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                                                                                                                   | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 3.1  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/http.integration.test.ts`                                                                                                                                 | `unittest/spec`<br>`integration`                   | `1.2`                                                   | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:integration -- test/server/configuration/http.integration.test.ts`                                                                                                                                                                                   |
| 3.2  | `src/util/ProcessUtil.ts`<br>`test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                                                                                      | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 4.1  | `src/model/IConfigFile.ts`<br>`src/model/Configuration.ts`<br>`config/config.yml.template`<br>`test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`                                     | `unittest/spec`<br>`unittest/imp`                  | `1.1, 1.2, 2.1, 3.1`                                    | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                             |
| 4.2  | `src/model/IConfigFile.ts`<br>`src/model/Configuration.ts`<br>`config/config.yml.template`<br>`test/server/configuration/storage-timeout-provider.cross-spec.test.ts`                                                                          | `unittest/spec`                                    | `4.1`                                                   | `npm run test:server:spec -- test/server/configuration/storage-timeout-provider.cross-spec.test.ts`                                                                                                                                                                                                                                                             |
| 5.1  | `test/server/configuration/filesystem.integration.test.ts`                                                                                                                                                                                     | `integration`                                      | `4.1`                                                   | `npm run test:server:integration -- test/server/configuration/filesystem.integration.test.ts`                                                                                                                                                                                                                                                                   |
| 5.2  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`<br>`test/server/configuration/http.integration.test.ts`                                                                           | `unittest/spec`<br>`unittest/imp`<br>`integration` | `4.1`                                                   | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`<br>`npm run test:server:integration -- test/server/configuration/http.integration.test.ts`                                                                                                  |
| 6.1  | `test/server/configuration/configuration.spec.test.ts`                                                                                                                                                                                         | `unittest/spec`                                    | `1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2` | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`                                                                                                                                                                                                                                                                              |
| 6.2  | `test/server/configuration/implementation.test.ts`                                                                                                                                                                                             | `unittest/imp`                                     | `1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 6.1`           | `npm run test:server:imp -- test/server/configuration/implementation.test.ts`                                                                                                                                                                                                                                                                                   |
| 6.3  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`<br>`test/server/configuration/filesystem.integration.test.ts`<br>`test/server/configuration/http.integration.test.ts`             | `unittest/spec`<br>`unittest/imp`<br>`integration` | `6.1, 6.2`                                              | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`<br>`npm run test:server:integration -- test/server/configuration/filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/configuration/http.integration.test.ts` |
| 6.4  | `src/model/IConfigurationFileAccess.ts`<br>`src/model/ConfigurationFileAccess.ts`<br>`src/model/ModelContainerSetter.ts`<br>`test/server/configuration/filesystem.integration.test.ts`<br>`test/server/configuration/http.integration.test.ts` | `integration`                                      | `1.1, 1.3, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.2, 6.3` | `npm run test:server:integration -- test/server/configuration/filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/configuration/http.integration.test.ts`                                                                                                                                                                        |
| 6.5  | `test/server/configuration/configuration.spec.test.ts`<br>`test/server/configuration/implementation.test.ts`<br>`test/server/configuration/filesystem.integration.test.ts`                                                                     | `unittest/spec`<br>`unittest/imp`<br>`integration` | `4.2, 6.1, 6.2, 6.3, 6.4`                               | `npm run test:server:spec -- test/server/configuration/configuration.spec.test.ts`<br>`npm run test:server:imp -- test/server/configuration/implementation.test.ts`<br>`npm run test:server:integration -- test/server/configuration/filesystem.integration.test.ts`                                                                                            |
