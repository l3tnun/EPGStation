# サーバー起動・稼働管理機能 要件

## 概要

EPGStation Server の設定と依存先を確認し、予約・録画、Web UI・API、起動時整理、番組情報更新を決められた順序で開始す
る。Web UI・API と番組情報更新の処理が停止した場合は再起動を試みる。また、全サーバー機能が共有するテスト基盤と server の
coverage の計測の道具を一度だけ所有して提供し、本機能自身の品質判定を行う。

## 境界コンテキスト

-   **対象範囲**: 対応 Node.js 版、ログと設定の準備、実行主体の切替、依存先の待機、各サーバー機能の開始、起動時整理、子
    処理の再起動、全サーバー機能が共有するテスト基盤と coverage の計測の道具の提供、公開用
    Docker image の構築と起動の手元での確認、公開用 image の構築と公開、および本機能固有の品質判定
-   **対象外**: 個別の予約・録画・番組情報・API・保存処理、全機能共通の準備完了状態、共通の終了制御
-   **利用する機能**: サーバー設定管理機能（`server-configuration`）、運用ログ記録機能（`server-operational-logging`）、
    チューナーサーバー連携機能（`server-tuner-access`）、データベース保存・検索機能（`server-persistence`）、サーバー内
    部のプロセス間通信機能（`server-process-messaging`）、機能間連携機能（`server-workflow-coordination`）、録画予約管理
    機能（`server-reservation-management`）、予約録画実行機能（`server-recording-execution`）、録画済み番組管理機能
    （`server-recorded-content`）、録画保存先の容量管理機能（`server-storage-management`）、Web・API・リアルタイム通知提
    供機能（`server-service-interface`）、番組情報・番組表機能（`server-program-guide`）
-   **この機能を利用する機能**: なし

## Requirements

### Requirement 1: 対応する Node.js 環境

**目的:** 運用者と開発者として、対応が確認された Node.js 環境でサーバーを利用したい。

#### Acceptance Criteria

1. The EPGStation Server shall Node.js 24 系を最低対応実行環境とする
2. When Node.js 24 系で受入検証するとき, the EPGStation Server shall 新規環境での依存関係導入、構築、起動、およびサー
   バーテストを完了できる
3. When Node.js 26 系で追加互換検証するとき, the EPGStation Server shall 依存関係導入、構築、起動、およびサーバーテスト
   を完了できる
4. The EPGStation Server shall Node.js 24 系未満を対応実行環境として表明しない

### Requirement 2: 起動準備

**目的:** 運用者として、ログ、設定、実行主体の準備に成功した後だけサーバー機能を開始したい。

#### Acceptance Criteria

1. When サーバーを起動するとき, the サーバー起動・稼働管理機能 shall 運用ログを初期化してサーバー設定を取得する
2. Where root 権限で起動しグループが設定されているとき, the サーバー起動・稼働管理機能 shall 設定されたグループへ切り替
   える
3. Where root 権限で起動しグループが設定されていないとき, the サーバー起動・稼働管理機能 shall 既定の録画用グループへ切
   り替える
4. Where root 権限で起動しユーザーが設定されているとき, the サーバー起動・稼働管理機能 shall 設定されたユーザーへ切り替
   える
5. When 実行主体の切替えを行ったとき, the サーバー起動・稼働管理機能 shall 予約・録画を管理する処理用のログ設定を読み込
   む
6. If ログ、設定、または実行主体の準備に失敗したとき, the サーバー起動・稼働管理機能 shall 後続機能を開始せず失敗として
   終了する
7. When 予約・録画を管理するprocessが捕捉されなかった例外または未処理の非同期失敗を検知したとき, the サーバー起動・稼働
   管理機能 shall 重大な異常として記録し、その記録だけを理由に新しい通常業務の受付停止、非0終了、子processの回収、または
   自己再起動を開始しない

### Requirement 3: 外部依存先の待機

**目的:** 運用者として、チューナーサーバーとデータベースを利用できる状態で後続機能を開始したい。

#### Acceptance Criteria

1. When 起動準備が完了したとき, the サーバー起動・稼働管理機能 shall チューナーサーバーの状態取得を試みる
2. While チューナーサーバーの状態取得に失敗するとき, the サーバー起動・稼働管理機能 shall 1 秒待って再確認し、後続機能を
   開始しない
3. When チューナーサーバーを利用できるとき, the サーバー起動・稼働管理機能 shall データベースの接続確認へ進む
4. While データベースの接続確認に失敗するとき, the サーバー起動・稼働管理機能 shall 1 秒待って再確認し、後続機能を開始し
   ない
5. When チューナーサーバーとデータベースの確認に成功したとき, the サーバー起動・稼働管理機能 shall 予約・録画に必要な機
   能の開始へ進む
6. The サーバー起動・稼働管理機能 shall 起動中に外部依存先の復旧を待つ期間全体へ期限を設けない
7. The サーバー起動・稼働管理機能 shall チューナーサーバーの状態取得とデータベースの接続確認の一回ごとの試行へEPGStation
   独自の時間制限を追加しない

### Requirement 4: 予約・録画機能の開始

**目的:** 利用者として、利用可能なチューナーに基づいて予約と録画を利用したい。

#### Acceptance Criteria

1. When 外部依存先を利用できるようになったとき, the サーバー起動・稼働管理機能 shall 利用可能なチューナー情報を取得する
2. When チューナー情報を取得したとき, the サーバー起動・稼働管理機能 shall 予約の競合判定と録画処理へ同じチューナー情報
   を渡す
3. The サーバー起動・稼働管理機能 shall 予約、録画、録画済み番組、ルール、サムネイル、およびエンコードの状態変化を連携す
   る処理を開始する
4. The サーバー起動・稼働管理機能 shall 録画保存先の空き容量監視を開始する
5. When 予約・録画機能の開始準備を行うとき, the サーバー起動・稼働管理機能 shall 状態変化を連携する process 内の event
   binding を一回だけ登録する
6. If 利用可能なチューナー情報の取得に失敗したとき, the サーバー起動・稼働管理機能 shall event binding を再登録せず後続
   機能を開始せず、未処理の非同期失敗として重大な異常を記録する一方、その記録だけを理由に予約・録画を管理するprocessを明
   示的に終了または再起動しない

### Requirement 5: Web UI・API の開始

**目的:** 利用者として、Web UI、API、ファイル配信、リアルタイム通知を利用したい。

#### Acceptance Criteria

1. When 予約・録画機能の準備後に Web・API 提供処理を開始するとき, the サーバー起動・稼働管理機能 shall Web・API・リアル
   タイム通知提供機能を別の処理として起動する
2. When Web・API 提供処理を子processとしてspawnしたとき, the サーバー起動・稼働管理機能 shall 起動成立を知らせる追加
   messageを待たず、その子processを管理側とのプロセス間通信の相手として直ちに登録する
3. When Web・API 提供処理の終了を確認したとき, the サーバー起動・稼働管理機能 shall Requirement 8 の監督規則に従って同じ
   提供処理の再起動を続ける
4. When Web・API 提供処理の起動前または起動後の`error`を受け取ったとき, the サーバー起動・稼働管理機能 shall Requirement
   8の監督規則に従って同じ提供処理の再起動を続ける

### Requirement 6: 起動時の状態整理

**目的:** 運用者として、前回停止時に残った録画状態と期限切れ予約を起動時に整理したい。

#### Acceptance Criteria

1. When Web・API 提供処理の監督開始を受理した後, the サーバー起動・稼働管理機能 shall 子processの起動成立を待たず、録画
   中のまま残った録画情報を整理し、成功後に保存済み予約から録画候補を再構築する
2. Where 一時保存先から通常保存先へ移動できる録画ファイルがあるとき, the サーバー起動・稼働管理機能 shall その移動を試み
   る
3. Where 対応する予約を確認できた録画ファイルがあるとき, the サーバー起動・稼働管理機能 shall 録画ファイルの大きさを確認
   して管理情報へ反映する
4. When 録画情報の整理と録画候補の再構築を終えたとき, the サーバー起動・稼働管理機能 shall 終了時刻を過ぎた予約を削除す
   る
5. When 録画情報または予約の整理結果から通常の業務通知を構成できるとき, the サーバー起動・稼働管理機能 shall 所有機能が
   既存の通知を行うよう委譲し、通常の業務通知を構成できない項目へ起動時整理専用の画面通知を追加しない
6. The サーバー起動・稼働管理機能 shall Web・API の受付開始を起動時整理の完了まで待たせない
7. If 録画情報の整理、録画候補の再構築、または期限切れ予約の整理が失敗したとき, the サーバー起動・稼働管理機能 shall 後
   続の整理と番組情報更新を開始せず、失敗した段階を自動的に再試行せず、未処理の非同期失敗として重大な異常を記録する一
   方、その記録だけを理由に予約・録画を管理するprocessを明示的に終了または再起動しない
8. If 録画情報の整理、録画候補の再構築、または期限切れ予約の整理が開始から600秒以内に成功または失敗へ確定しないとき, the
   サーバー起動・稼働管理機能 shall 処理中の所有権を解放済みと扱わず後続の整理と番組情報更新へ進まず、その起動段階を期限
   超過として記録する一方、開始済みのWeb・API処理と当該整理に依存しない業務を停止させない。元の処理が後から成功したとき
   は次の整理段階へ一回だけ進み、失敗したときはRequirement 6 Acceptance Criterion 7の失敗経路へ一回だけ進んで、同じ整理
   処理を再実行しない

### Requirement 7: 番組情報更新の開始

**目的:** 利用者として、起動後に番組情報が取得・更新されるようにしたい。

#### Acceptance Criteria

1. When Web・API 提供処理の監督開始後に録画情報の整理、録画候補の再構築、および期限切れ予約の整理が順に成功したとき, the
   サーバー起動・稼働管理機能 shall 番組情報更新の監督を開始する
2. When 番組情報の更新が完了したとき, the サーバー起動・稼働管理機能 shall 関係する予約更新処理へ通知する
3. When 番組情報更新の処理が終了、切断、または起動エラーになったとき, the サーバー起動・稼働管理機能 shall Requirement 8
   の監督規則に従って同じ更新処理の回収と再起動を続ける
4. The サーバー起動・稼働管理機能 shall Web・API の受付開始、起動時整理、番組情報更新開始、および最初の番組情報更新完了
   を一つの準備完了状態として公開しない

### Requirement 8: 子プロセスの継続的な監督

**目的:** 利用者として、子プロセスの終了または起動失敗後に Web・API と番組情報更新が再び起動するようにしたい。

#### Acceptance Criteria

1. When サーバー起動・稼働管理機能が起動するとき, the サーバー起動・稼働管理機能 shall Web・API提供処理と番組情報更新処
   理をそれぞれ子プロセスとして起動する
2. When Web・API提供処理の終了を受け取ったとき, the サーバー起動・稼働管理機能 shall 異常終了と再起動を記録し、同じ処理
   を再び起動する
3. When Web・API提供処理の起動エラーを受け取ったとき, the サーバー起動・稼働管理機能 shall 同じ処理を再び起動する
4. When 番組情報更新処理の終了、切断、close、または起動エラーを受け取ったとき, the サーバー起動・稼働管理機能 shall 異常
   を記録し、その子プロセスに登録した監督用listenerを取り除いてから同じ処理を再び起動する
5. When 番組情報更新処理の切断を受け取ったとき, the サーバー起動・稼働管理機能 shall 対象子プロセスへ`SIGINT`を送ってか
   ら再起動処理へ進む
6. The サーバー起動・稼働管理機能 shall Web・API提供処理および番組情報更新処理の再起動回数へ固定上限を設けない
7. When 子プロセスの標準出力または標準エラー出力をpipeで受け取るとき, the サーバー起動・稼働管理機能 shall bufferの滞留
   を防ぐため読み取る

### Requirement 9: サーバーテストの品質判定

**目的:** 保守者とリリース責任者として、仕様、実装、およびテストの誤りを区別しながら、サーバー変更による副作用をリリース
前に検出したい。

#### Acceptance Criteria

1. The サーバー起動・稼働管理機能 shall 全サーバー機能が利用する共通テスト基盤と品質判定を一度だけ所有し、その品質判定を
   clientへ適用しない。root packageの公開 server test commandを一意に提供する
2. When サーバー変更を検証するとき, the 共通テスト基盤 shall 外部から観測可能な契約を確認する仕様単体テスト、内部の値域
   と分岐を確認する実装単体テスト、および複数の機能または外部境界を接続する結合テストを区別して実行できる
3. When サーバー起動・稼働管理機能を検証するとき, the 機能固有テスト shall Requirements 2から8の起動準
    備、依存先待機、予約・録画機能とWeb・APIの開始、起動時整理、番組情報更新開始、および子process監督を
    `unittest/spec`で検証する
4. When 内部の値域と分岐を検証するとき, the 機能固有テスト shall root・非root、user・groupの指定と省略、依存先確認の失
    敗回数、tuner情報取得の成功・失敗、起動時整理の600秒境界、およびchild processの各terminal eventと再起動分岐を
    `unittest/imp`で検証する
5. When 機能固有test matrixを作るとき, the 機能固有テスト shall 起動準備前・依存先待機・業務機能開始・Web・API稼働・起
    動時整理・番組情報更新・child process再起動、1秒ごとの再確認、600秒の直前・到達・超過・期限後の確定、応答と期限およ
    び複数terminal eventの競合、timer・監督listener・child process参照・IPC通信相手参照の一回だけの解放または再登録を分
    類する
6. Where 結合境界を検証するとき, the 機能固有テスト shall チューナーサーバー連携機能を介したHTTP状態確認、SQLite・
    MySQLのDB接続、Web・API提供処理と番組情報更新処理のchild process・IPC、および録画済み番組管理機能を介した起動時の
    filesystem整理を接続する。各domain機能の内部契約と公開HTTP APIはそれぞれのowner仕様へ委ねる
7. When サーバー起動・稼働管理機能の完了を判定するとき, the サーバー起動・稼働管理機能 shall 本機能の単体test（spec・imp）と
   結合testがすべて成功し、かつAcceptance Criterion 9のserver全体のcoverageの判定を満たさない限り本機能を未完了とする
8. The 共通テスト基盤 shall serverの`src/**`のC0・C1を単体test（spec・imp）だけで計測するcoverageの計測の道具
    （worker側のraw coverageの取得、compiled snapshotの計測、およびC0・C1の集計）を、全サーバー機能のために一度だけ所有する
9. When サーバー変更の完了を判定するとき, the サーバー起動・稼働管理機能 shall 全サーバー機能の単体test（spec・imp）と結合
   testがすべて成功し、単体testだけでserverの`src/**`のC0・C1が100%であり、`.kiro/steering/server-testing.md`の共通品質判定へ
   適合しない限りそのサーバー変更を未完了とする
10. The coverageの計測の道具 shall レビュー済みの除外の承認に記録されたstatementとbranchだけを、承認ごとにsourceのちょうど1箇所
    ずつ母数から除き、承認に記録されていない箇所を母数から除かない
11. If 承認された除外の箇所のcode、その箇所を含む関数のcode、または承認が除外の根拠として記録した同じfileの関数のcodeが承認時か
    ら変わったとき, the coverageの計測の道具 shall そのfileの除外を適用せず、変わった関数と承認が無効になったことを示してcoverage
    の判定を失敗とする
12. When 除外のあるsource fileでcomment・空白・改行（改行に伴う末尾のcommaの付け外しを含む）だけが変わったとき、または承認に結
    び付いた関数の外のcodeだけが変わったとき, the coverageの計測の道具 shall 承認を有効のまま扱い、承認時と同じstatementとbranch
    を母数から除く
13. If 1つの除外の承認に対応する箇所がsourceに1つも無いとき、または2つ以上あるとき, the coverageの計測の道具 shall その除外を適用
    せず、対応する箇所の数を示してcoverageの判定を失敗とする
14. The 共通テスト基盤 shall server test、coverageの判定、Node.js matrix、およびpreflightの合否を実行時点のfileの中身だけで決め、
    commit id、treeの識別子、または未commitの変更の有無を合否の条件にしない
15. When 未commitの変更がある作業場所でcoverageの判定を実行するとき, the 共通テスト基盤 shall 失敗とせずにその作業場所の中身を
    計測して判定し、計測した中身の識別子、HEADの識別子、および未commitの変更があったことを結果の記録に残す
16. When Node.js matrixを実行するとき, the 共通テスト基盤 shall 検証する中身の指定が無ければ実行時点の作業場所の中身（未commitの変更
    と、ignoreされていない未追跡のfileを含む）を、指定があればその中身を各fresh workspaceへ取り出して検証し、検証した中身の識別子
    とHEADとの違いの有無を結果の記録に残す
17. When preflightを実行するとき, the preflight shall 開始時に一度だけ定めた中身をすべてのstepで検証し、その中身の識別子をstepごと
    の結果の記録に残す

### Requirement 10: 公開用 Docker image の構築と起動の手元での確認

**目的:** 保守者として、公開用の Debian 版・Alpine 版 Docker image が製品の Dockerfile から構築でき、起動した server が Web・API に応答することを、リリース前に手元で確かめたい。依存の取得は確認の前に済ませ、回線の状態で確認の結果が変わらないようにしたい。

**境界:** 対象は repository の `Dockerfile.debian` と `Dockerfile.alpine` から作る image の構築と起動。image の中の個別機能（予約、録画、番組表など）の振る舞いは各機能の test が確かめる。手元の確認は linux/amd64（x86_64）向けの構築だけを対象とし、他の architecture 向けの構築は Requirement 11 の公開用の構築が行う。image の registry への公開（Requirement 11）、実チューナー・実 tuner server への接続は対象外。

#### Acceptance Criteria

1. When Docker image を確認するとき, the Docker image 確認 shall `Dockerfile.debian` と `Dockerfile.alpine` のそれぞれから、server と client を含む linux/amd64 向けの image を手元で構築する
2. The Docker image 確認 shall 構築に使う base image を、製品の Dockerfile が digest で固定したものと同じにする
3. When 構築した image を起動したとき, the Docker image 確認 shall image 内の server が起動を完了し、Web・API の要求に正常応答を返すことを Debian 版・Alpine 版それぞれで確かめる
4. When 構築した image を起動するとき, the Docker image 確認 shall 外部の tuner server の代わりに起動に必要な応答だけを返す代役を使い、実チューナーと実 tuner server へ接続しない
5. The 依存の準備 shall 構築に要る外部からの取得（base image、OS の package、npm の依存関係）を、確認の本体より前の準備の段階だけで行う
6. The 依存の準備 shall OS の package と npm の依存関係を別々に用意して手元に保持し、次回以降の確認で再利用する
7. When server または client の `package.json` か `package-lock.json` が変わったとき, the 依存の準備 shall 変わった側の npm の依存関係だけを用意し直し、OS の package と base image を取り直さない
8. When 必要な依存が既に手元に揃っているとき, the 依存の準備 shall 外部へ取りに行かずに終わる
9. If 依存の準備で外部からの取得に失敗したとき, the 依存の準備 shall 確認の本体を始めずに終了し、その失敗を image の構築・起動の失敗と区別できる終了 code で報告する
10. If 確認の本体の開始時に必要な依存が手元に揃っていないとき, the Docker image 確認 shall 外部へ取りに行かず、準備されていないことを示して失敗する
11. The Docker image 確認 shall 構築した image を registry へ公開しない
12. When 確認が成功・失敗のどちらで終わったときも, the Docker image 確認 shall 起動した container と、確認のために構築した image を片付ける。準備で用意した依存（6）は残す
13. The Docker image 確認 shall 構築した image に、server の開発用の package（`package.json` の `devDependencies`。型検査・lint・format・test の道具）と client の `node_modules` が含まれず、server の実行に要る package と client の build 済みの成果物は含まれることを、Debian 版・Alpine 版それぞれで確かめる

### Requirement 11: 公開用 Docker image の構築と公開

**目的:** 利用者として、x86_64 以外の機器（ARM の機器を含む）でも、公開された Docker image で EPGStation を使いたい。保守者として、公開用 image を v2 と同じく GitHub Actions で作りたい。

**境界:** 公開用 image の構築と Docker Hub への公開を対象とする。image の中身が動くことの確認は Requirement 10（手元、linux/amd64）が行う。公開先の認証情報は repository に置かず、GitHub Actions の secret から渡す。

#### Acceptance Criteria

1. When `master` branch へ push されたとき, or git tag が作られたとき, the 公開用 image の構築 shall GitHub Actions で `Dockerfile.debian` と `Dockerfile.alpine` のそれぞれから image を構築して Docker Hub へ公開する
2. The 公開用 image の構築 shall Debian 版を linux/amd64・linux/arm/v7・linux/arm64/v8 向けに、Alpine 版を linux/amd64・linux/arm/v6・linux/arm/v7・linux/arm64/v8 向けに構築する
3. When `master` branch へ push されたとき, the 公開用 image の構築 shall `<branch>-debian`・`<branch>-alpine` の tag を付け、Debian 版には `<branch>` の tag も付ける
4. When git tag が作られたとき, the 公開用 image の構築 shall `<tag>-debian`・`<tag>-alpine`・`debian`・`alpine` の tag を付け、Debian 版には `<tag>` と `latest` の tag も付ける
5. While pull request の検査を行うとき, the 公開用 image の構築 shall 実行しない
