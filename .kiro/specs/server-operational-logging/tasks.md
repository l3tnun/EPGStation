# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24 必須・Node.js 26 追加検証 matrix は `server-application-runtime` が所有する。
その foundation task group の完了後に本 spec を実行し、本 spec では運用ログ固有の test と、明示した用途分類の最小修正だ
けを追加する。

-   [x] 1. ログ初期化と設定適用の契約を固定する
-   [x] 1.1 設定指定前の4用途loggerと重要度filterをcharacterization testで固定する

    -   既存実装分類Aとして、設定を指定しない初期化でsystem、access、stream、encodeの4用途が画面出力へ接続され、infoを既
        定の最低重要度として利用できることを検証する。
    -   bootstrap時のencode記録がsystem用出力へ配送される確認済みの経路差と、同一processで同じ用途別logger集合を取得でき
        ることを実装回帰testで固定する。
    -   `unittest/spec`で4用途の利用可否を、`unittest/imp`で重要度filterとcategory routingを検証する。
    -   完了時には、4用途へ送った合成記録の出力先と、最低重要度より低い記録が除外される結果を自動testで観測できる。
    -   _Requirements: 1.1, 2.1, 2.5_

-   [x] 1.2 初期化不能時に業務処理を開始しない契約をisolated processで固定する

    -   既存実装分類Aとして、設定の不在、読取不能、YAML解釈失敗、および初期化前のlogger取得をそれぞれ独立したprocessで再
        現する。
    -   test runner自身を終了させず、画面に残る失敗表示と非0終了を`unittest/spec`およびprocess integration testで検証す
        る。
    -   完了時には、4種類の失敗すべてで業務処理到達を示す観測値が0件となり、失敗表示と終了結果を区別して確認できる。
    -   _Requirements: 1.3, 1.4_

-   [x] 1.3 役割別sampleと出力先置換の契約をcharacterization testで固定する

    -   既存実装分類Aとして、予約・録画、Web・API、番組情報更新の各sampleが定めるcategory、重要度、出力先、容量、保持
        数、切替名形式を読み取る。
    -   役割と4用途を組み合わせた12種類の出力先記号について最初の出現だけが置換されること、およびWeb・APIだけが専用
        encode fileを使う確認済みの役割差を固定する。
    -   `unittest/imp`と設定integration testで、合成した保存先だけを使い、実環境の位置や利用情報をfixtureへ含めない。
    -   完了時には、3役割のrouting matrixと12種類の置換結果がsample設定と一致することを自動testで確認できる。
    -   _Requirements: 1.2, 3.1, 3.2, 3.3_

-   [x] 2. 役割別processとfile appenderの動作を固定する
-   [x] 2.1 役割別processの設定分離と次回初期化時反映を検証する

    -   既存実装分類Aとして、予約・録画processの画面出力から役割別設定への切替、Web・API processと番組情報更新processの
        起動時設定を独立processで確認する。
    -   稼働中に設定内容を変更しても既存loggerへ反映されず、次回の初期化後だけ新しい設定が使われることをprocess
        integration testで固定する。
    -   完了時には、3役割の記録が互いの出力先へ混入せず、変更前processと再初期化後processで異なる設定結果を観測できる。
    -   _Depends: 1.3_
    -   _Requirements: 3.1, 3.2, 3.3, 3.5_

-   [x] 2.2 設定容量によるfile切替と保持数をintegration testで固定する

    -   既存実装分類Aとして、合成した小さい容量と保持数を使い、容量到達時のfile切替、過去file保持、および切替名形式を一
        時保存先で検証する。
    -   配布sampleの容量、保持数、切替名形式はsample値として扱い、任意の役割別設定へ固定値として強制しない。
    -   完了時には、容量を超える合成記録の出力後に、設定した保持数を超えない切替fileを一時保存先で観測できる。
    -   _Depends: 1.3_
    -   _Requirements: 3.4_

-   [x] 2.3 appender失敗とprocess終了直前の配送範囲をtargeted recheckする

    -   未確認の製品保証を追加しないtargeted recheckとして、書込権限なし、容量不足相当、およびprocess終了直前の記録を独
        立processと一時保存先で再現する。
    -   観測結果を独自fallback、retry、flush、shutdownの新しい保証へ読み替えず、ログ基盤が返す結果だけを回帰testへ固定す
        る。
    -   完了時には、各失敗条件の終了結果と実際に残った記録を再現可能に観測でき、ログ機能がprocess停止や再起動を開始して
        いないことを確認できる。
    -   _Depends: 2.2_
    -   _Requirements: 3.4, 5.4_

-   [x] 3. HTTP要求受付から応答完了までのアクセス記録を固定する

    -   既存実装分類Aとして、要求受付時に追跡を開始し、応答のend、finish、error、closeのうち最初のterminal通知で一度だけ
        アクセス記録を出力することを検証する。
    -   合成HTTP要求と応答を使い、method、要求先、status、content length、referrer、user agent、接続元を含み得る一つの記
        録として受付と結果が対応付くことを`unittest/spec`とintegration testで固定する。
    -   middlewareの有無で認可判断、応答status、応答内容が変化しないことを`unittest/imp`で比較する。
    -   完了時には、terminal通知を重ねてもアクセス記録が1件だけになり、同じ要求の業務応答が比較前後で一致する。
    -   _Depends: 1.1_
    -   _Requirements: 2.2, 4.1, 4.2, 4.3_

-   [x] 4. 用途別producerとloggerの分類契約を統合する
-   [x] 4.1 (P) サーバー内部の通常動作と異常がsystem用途へ届くことを固定する

    -   既存実装分類Aとして、起動、設定、内部処理、および異常の代表的な合成事象をsystem用途へ送り、指定した重要度で記録
        されることをcharacterization testで確認する。
    -   記録機能が事象の業務上の成否や重要度を再判定せず、producerの指定をそのまま扱うことを`unittest/spec`で固定する。
    -   完了時には、各合成事象がsystem用途以外へ重複配送されず、指定重要度と出力重要度が一致する。
    -   _Requirements: 2.1, 2.5_
    -   _Boundary: System Producer―用途別logger統合_
    -   _Depends: 1.1_

-   [x] 4.2 (P) エンコードの開始から異常までがencode用途へ届くことを固定する

    -   既存実装分類Aとして、エンコードの開始、進行、終了、取消、および異常の代表事象をencode用途へ送るcharacterization
        testを作成する。
    -   Web・API役割の専用encode出力と重要度filterを組み合わせたintegration testで、producerからappenderまでの分類を確認
        する。
    -   完了時には、5種類の合成事象がencode用途で観測され、system、access、stream用途へ誤配送されない。
    -   _Requirements: 2.4, 2.5_
    -   _Boundary: Encoding Producer―用途別logger統合_
    -   _Depends: 1.1, 1.3_

-   [x] 4.3 (P) 映像配信producerの記録をstream用途へ統一する

    -   既存実装分類Bとして、ライブ視聴と録画済み番組配信の開始、継続、停止、失敗がstream用途へ届くtarget仕様testを先に
        追加し、現在system用途だけへ出る取得失敗を再現する。
    -   failing testを確認した後、分類を選ぶproducerだけを必要最小限に修正し、loggerの公開契約や配信の開始・停止・失敗結
        果は変更しない。
    -   `unittest/spec`とcross-spec integration testで、放送stream取得失敗を含む各配信事象がstream用途へ残ることを検証す
        る。
    -   完了時には、配信失敗がsystem用途だけに残る経路が0件となり、配信結果と利用者向け応答は、stream用途への記録によって変化しない。
    -   _Requirements: 2.3_
    -   _Boundary: Media Delivery Producer―用途別logger統合_
    -   _Depends: 1.1_

-   [x] 5. 重大異常の記録とprocess監督の責務境界を固定する
-   [x] 5.1 捕捉されなかった例外と未処理rejectionを独立してfatal記録する

    -   既存実装分類Aとして、予約・録画、Web・API、番組情報更新の各processへ捕捉されなかった例外と未処理rejectionを配送
        する。
    -   近接して届く二つの通知がそれぞれsystem/fatalへ記録される一方、記録observer自身による新規受付停止、非0終了、回
        収、再起動が0件であることをisolated process integration testで確認する。
    -   完了時には、3役割×2通知のfatal記録を個別に観測でき、logging由来のlifecycle effectが全経路で0件となる。
    -   _Depends: 1.1_
    -   _Requirements: 5.1, 5.2, 5.4_

-   [x] 5.2 child停止・再起動通知の記録matrixをcharacterization testで固定する

    -   既存実装分類Aとして、Web・API childのexitとspawn後errorのどちらでも、停止と再起動のfatal記録が各1件となることを
        固定する。
    -   番組情報更新childのexit、close、disconnect、spawn後errorでは、現在の通知種別と重要度が記録へ渡ることをcross-spec
        characterization testで確認する。
    -   再起動、listener除去、signal送信、および待機の実行結果はサーバー起動・稼働管理側のtaskへ委譲し、本taskでは
        logging側にそれらの制御を追加しない。
    -   完了時には、terminal通知別の記録有無と重要度が設計matrixに一致し、loggerから停止・回収・再起動・signal送信を開始
        した件数が0件となる。
    -   _Depends: 5.1_
    -   _Requirements: 5.3, 5.4_

-   [x] 6. 運用ログ固有testを共有server検証matrixで完走させる
-   [x] 6.1 機能固有test inventoryを作り外部契約を`unittest/spec`で検証する

    -   `test/server/operational-logging/operational-logging.spec.test.ts`にRequirements 1から5の全21 ACと主test名、補助
        test名、対象fixture、観測する出力・状態・副作用を一意に対応付け、未割当ACを0件にする。
    -   同fileで、4用途logger、3役割の設定、HTTP要求受付から最初のterminal通知までの1記録、重大異常の個別fatal記録、およ
        びlogging自身による停止・回収・signal送信・再起動effectが0件である外部契約を検証する。
    -   `test/server/fixtures/logging/`には合成YAMLと合成HTTP fixtureだけを配置し、実URL、実番組情報、credential、実保存
        pathを含めない。
    -   完了時には、inventoryから全21 ACを成功した`unittest/spec`へ逆引きでき、未割当、重複だけで代替した契約、skipの理
        由なしがいずれも0件である。
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3, 4.1, 4.2, 4.3, 5.1, 5.2_
    -   _Requirements: 6.1_

-   [x] 6.2 値域と内部分岐を`unittest/imp`で固定する

    -   `test/server/operational-logging/implementation.test.ts`で、設定file位置の未指定・空・不在・読取不能・不正YAML、
        12種類の役割・用途別記号の最初の出現、4用途のcategory・level、および3役割sampleの出力先差を検証する。
    -   同fileでHTTP fieldの欠損・空・重複と、`end`、`finish`、`error`、`close`の各終了分岐を検証し、最初のterminal通知
        だけが1件を記録することをassertする。rotationの0、1、最小、最大、範囲外、不正型は本機能が値域を定義せずログ基盤
        へ渡すため非適用とし、設定値の引渡しと容量到達時の実動作はTask 6.4へ割り当てる。
    -   初期化不能と初期化前取得はtest runner自身を終了させずisolated childで実行し、画面出力、終了code、業務処理到達0件
        を別々に観測する。
    -   完了時には、Designの初期化、記号置換、category・level、sample差、HTTP初回terminal gateの各分岐が対応assertionか
        ら逆引きでき、値域の非適用理由にも空欄がない。
    -   _Depends: 1.1, 1.2, 1.3, 3, 6.1_
    -   _Requirements: 6.2_

-   [x] 6.3 値・分岐・状態・race・資源matrixを全suiteへ割り当てる

    -   Task 6.1のinventoryを、契約、test種別、入力値、分岐、未初期化・初期化済み・再初期化・成功・失敗の状態、通知順
        序・同着・race・重複、logger・appender・file・request listener・process listener・isolated childの取得から終了ま
        でへ展開する。
    -   `test/server/operational-logging/operational-logging.spec.test.ts`と
        `test/server/operational-logging/implementation.test.ts`にはlogger lifecycleとHTTP初回terminal gateを、
        `test/server/operational-logging/http.integration.test.ts`には実middlewareへ接続したHTTP lifecycleを、
        `test/server/operational-logging/process.integration.test.ts`には重大異常の近接発生とlistener・child回収を、
        `test/server/operational-logging/rotation.integration.test.ts`にはfile open・rotation・書込失敗・終了直前の結果
        を割り当てる。
    -   timeout、deadline、late settlement、cancel可能な業務job、DB transaction、stream、timer、lockは本機能が所有しない
        ため非適用とし、自動retryや新しいtimer契約を追加しない。各testは記録件数、category・level、状態遷移、通知順序、
        listener解除、残留handle、および停止・再起動effect 0件を観測する。
    -   完了時には、matrixの未分類項目が0件となり、各行に主test、補助testまたは非適用理由がある。
    -   _Depends: 6.1, 6.2_
    -   _Requirements: 6.3_

-   [x] 6.4 HTTP・filesystem・役割別processの結合境界を専用integration suiteで検証する

    -   `test/server/operational-logging/http.integration.test.ts`で実middlewareへ合成request/responseを接続し、要求受
        付、最初のterminal通知、応答状態、1要求1記録、およびlistener後始末を検証する。
    -   `test/server/operational-logging/rotation.integration.test.ts`でtemporary directoryの合成YAMLと実appenderを接続
        し、設定読込、容量到達時の切替、保持数、書込権限なし、容量不足相当、書込失敗、およびprocess終了直前に実際に残る
        記録を観測する。結果を独自fallback、retry、flush保証へ読み替えない。
    -   `test/server/operational-logging/process.integration.test.ts`でOperator、Service、EPG updater相当processの設定分
        離、初期化失敗、重大異常の近接発生、terminal通知の分類差、test listener解除、child終了・回収、およびlogging由来
        の停止・再起動effect 0件を検証する。
    -   DBとIPCは本機能がtransaction、schema、message配送、peer選択、接続状態を所有しないため結合非適用とし、未実行を成
        功扱いせずmatrixへ理由を残す。
    -   完了時には、HTTP、filesystem、processの各境界で成功・失敗・後始末を観測でき、DB・IPCの非適用理由を含む結合matrix
        の未分類が0件である。
    -   _Depends: 2.1, 2.2, 2.3, 3, 5.1, 5.2, 6.3_
    -   _Requirements: 6.4_

-   [x] 6.5 本機能の品質判定を満たす

    -   Task 6.1から6.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 6.1, 6.2, 6.3, 6.4_
    -   _Requirements: 6.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                 | Test type                                          | Local Depends                                              | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/implementation.test.ts`                                                                                                                                                                                                  | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                 | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`                                                                                                                                                                                                                                                                                                           |
| 1.2  | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                             | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                 | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                              |
| 1.3  | `test/server/operational-logging/implementation.test.ts`<br>`test/server/operational-logging/rotation.integration.test.ts`                                                                                                                                                                                                      | `unittest/imp`<br>`integration`                    | なし（共有foundationのみ）                                 | `npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/rotation.integration.test.ts`                                                                                                                                                                                                                                                                                                        |
| 2.1  | `test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                   | `integration`                                      | `1.3`                                                      | `npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.2  | `test/server/operational-logging/rotation.integration.test.ts`                                                                                                                                                                                                                                                                  | `integration`                                      | `1.3`                                                      | `npm run test:server:integration -- test/server/operational-logging/rotation.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.3  | `test/server/operational-logging/rotation.integration.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                 | `integration`                                      | `2.2`                                                      | `npm run test:server:integration -- test/server/operational-logging/rotation.integration.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                           |
| 3    | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/implementation.test.ts`<br>`test/server/operational-logging/http.integration.test.ts`                                                                                                                                    | `unittest/spec`<br>`unittest/imp`<br>`integration` | `1.1`                                                      | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/http.integration.test.ts`                                                                                                                                                                                                          |
| 4.1  | `test/server/operational-logging/operational-logging.spec.test.ts`                                                                                                                                                                                                                                                              | `unittest/spec`                                    | `1.1`                                                      | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4.2  | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                             | `unittest/spec`<br>`integration`                   | `1.1, 1.3`                                                 | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                              |
| 4.3  | `src/model/service/stream/base/LiveStreamBaseModel.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`<br>`test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                        | `unittest/spec`<br>`integration`                   | `1.1`                                                      | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                              |
| 5.1  | `test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                   | `integration`                                      | `1.1`                                                      | `npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                |
| 5.2  | `test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                   | `integration`                                      | `5.1`                                                      | `npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                |
| 6.1  | `test/server/operational-logging/operational-logging.spec.test.ts`                                                                                                                                                                                                                                                              | `unittest/spec`                                    | `1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3, 4.1, 4.2, 4.3, 5.1, 5.2` | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6.2  | `test/server/operational-logging/implementation.test.ts`                                                                                                                                                                                                                                                                        | `unittest/imp`                                     | `1.1, 1.2, 1.3, 3, 6.1`                                    | `npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6.3  | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/implementation.test.ts`<br>`test/server/operational-logging/http.integration.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`<br>`test/server/operational-logging/rotation.integration.test.ts` | `unittest/spec`<br>`unittest/imp`<br>`integration` | `6.1, 6.2`                                                 | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/http.integration.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/rotation.integration.test.ts` |
| 6.4  | `test/server/operational-logging/http.integration.test.ts`<br>`test/server/operational-logging/rotation.integration.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                                                                                   | `integration`                                      | `2.1, 2.2, 2.3, 3, 5.1, 5.2, 6.3`                          | `npm run test:server:integration -- test/server/operational-logging/http.integration.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/rotation.integration.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                          |
| 6.5  | `test/server/operational-logging/operational-logging.spec.test.ts`<br>`test/server/operational-logging/implementation.test.ts`<br>`test/server/operational-logging/process.integration.test.ts`                                                                                                                                 | `unittest/spec`<br>`unittest/imp`<br>`integration` | `6.1, 6.2, 6.3, 6.4`                                       | `npm run test:server:spec -- test/server/operational-logging/operational-logging.spec.test.ts`<br>`npm run test:server:imp -- test/server/operational-logging/implementation.test.ts`<br>`npm run test:server:integration -- test/server/operational-logging/process.integration.test.ts`                                                                                                                                                                                                       |
