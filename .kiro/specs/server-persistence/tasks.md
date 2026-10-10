# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、永続化固有の test と承認済み差分の最小実装だけを追加する。

-   [x] 1. 接続とデータ構造更新の既存契約を固定する
-   [x] 1.1 SQLite と MySQL の接続選択を characterization する

    -   既存実装分類 A として、SQLite の管理ファイル、MySQL の必須接続情報と省略時文字集合、および backend ごとの接続候
        補を `unittest/spec` で固定する。
    -   未対応 backend、MySQL 設定一式の欠落、および driver が接続値を受理しない場合を分け、エラーを「データなし」へ読み
        替えないことを確認する。
    -   synthetic な接続情報だけを使い、認証情報が log、snapshot、assertion failure の追加文言へ現れないことを
        `unittest/imp` で検証する。
    -   完了時には、二つの対応 backend だけが正しい接続候補を作り、各不正条件が接続開始前または driver の元エラーとして
        再現され、production code の差分がない。
    -   _Requirements: 1.1, 1.4, 1.5_
    -   _Boundary: DBOperator―backend 接続候補_

-   [x] 1.2 SQLite 外部拡張と無期限 settlement を characterization する

    -   既存実装分類 A として、SQLite 外部拡張を設定順かつ重複を除かずに読み込み、途中失敗を最初の利用要求へ返す挙動を
        `unittest/spec` で固定する。
    -   接続作成、データ構造更新、外部拡張、および簡易問い合わせの Promise を制御し、長時間相当の fake clock を進めても
        EPGStation 独自の timeout、別試行、強制中断が発生しないことを `unittest/imp` で確認する。
    -   外部拡張の途中失敗後に初期化済み候補が保存されたままになる修正前の差は、目標契約と混ぜず focused
        characterization として再現する。
    -   完了時には、元 Promise が settle した結果だけが呼出元へ届き、pending 中の追加 timer と並行再試行が 0 件で、拡張
        の成功・失敗順を自動検証できる。
    -   _Requirements: 1.2, 1.3, 1.8_
    -   _Boundary: DBOperator―SQLite 外部拡張・待機境界_

-   [x] 1.3 保存済み接続の再利用、確認、明示終了を characterization する

    -   既存実装分類 A として、正常な初回利用後の要求が同じ process 内で同じ接続を受け取り、利用可能性確認が簡易問い合わ
        せの成功または元エラーを返すことを `unittest/spec` で固定する。
    -   接続がない明示終了は no-op、接続があれば終了完了を待ち、終了エラーを caller へ返すことを `integration` で確認す
        る。
    -   終了後も破棄済み接続が保存されたままの確認済み特性を `unittest/imp` へ分離し、自動再接続、稼働中 shutdown、初期
        化中の同時終了を新しい保証として追加しない。
    -   完了時には、順次利用の instance identity、簡易問い合わせ、no-op、正常終了、終了失敗、および terminal lifecycle
        の各結果を再現でき、production code の差分がない。
    -   _Requirements: 1.6, 1.7, 1.9_
    -   _Boundary: DBOperator―保存済み接続・明示終了_

-   [x] 1.4 backend 別のデータ構造更新を characterization する

    -   既存実装分類 A として、SQLite と MySQL がそれぞれの未適用更新だけを順番に実行し、自動同期と接続時の自動降格を行
        わないことを `unittest/spec` と `integration` で固定する。
    -   空 schema、適用済み schema、途中失敗 schema を synthetic fixture で用意し、更新完了前の接続が利用可能として公開
        されないことを確認する。
    -   更新失敗後の次の確認が新しい接続候補を作り、未適用分を再び試みることを instance identity と更新履歴で検証する。
    -   完了時には、両 backend の前進更新、適用済み版維持、失敗時非公開、および次回再試行が再現可能な integration test
        で観測できる。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: DataSource―backend Migration_

-   [x] 2. 型付き保存・検索ポートの既存契約を固定する
-   [x] 2.1 放送局と番組の保存・検索を characterization する

    -   既存実装分類 A として、放送局と番組の追加、更新、削除、識別番号・放送局・時刻条件による検索、並び替え、および件
        数を `unittest/spec` で固定する。
    -   該当なしの単数検索は `null`、複数検索は空配列、一覧と件数は同じ条件から得られることを synthetic records で検証す
        る。
    -   番組の拡張情報が保存済み text のまま返り、保存境界が番組の業務状態や変更可否を再判断しないことを `unittest/imp`
        で確認する。
    -   完了時には、放送情報の CRUD、検索、pagination、および戻り値境界が両 backend 向け fixture で再現され、production
        code の差分がない。
    -   _Requirements: 2.1, 2.6, 3.1, 3.2, 3.3_
    -   _Boundary: Channel・Program repositories_

-   [x] 2.2 予約と自動予約ルールの保存・検索を characterization する

    -   既存実装分類 A として、予約と自動予約ルールの追加、更新、削除、有効・無効変更、識別番号・条件検索、並び替
        え、pagination、および件数を `unittest/spec` で固定する。
    -   自動予約ルールの複合値を正常に復元し、保存済み JSON が壊れている場合は空値や既定値へ置き換えず parsing error を
        返すことを `unittest/imp` で検証する。
    -   永続化境界が予約競合、録画可否、ルール適合性を独自に判断しないことを、型付き入力と保存結果の対応で確認する。
    -   完了時には、予約・ルールの CRUD と query の戻り値、および破損保存値の読取失敗を再現でき、production code の差分
        がない。
    -   _Requirements: 2.2, 2.6, 3.1, 3.2, 3.3, 3.10_
    -   _Boundary: Reserve・Rule repositories_

-   [x] 2.3 録画済み番組と録画履歴の保存・関連取得を characterization する

    -   既存実装分類 A として、録画済み番組と録画履歴の追加、更新、削除、保護変更、識別番号・予約番号・放送局・ジャン
        ル・最古条件による検索を `unittest/spec` で固定する。
    -   一覧と件数、該当なし、複数識別番号、および録画ファイル・サムネイル・ドロップログ・タグの選択的な関連取得を
        `integration` で検証する。
    -   保存境界が実ファイルを操作せず、録画済み番組の業務上の削除可否を決めないことを `unittest/imp` で確認する。
    -   完了時には、録画記録の CRUD、query、集約、relation 選択、および空結果が設計どおりに観測できる。
    -   _Requirements: 2.3, 2.6, 3.1, 3.2, 3.3, 3.4_
    -   _Boundary: Recorded・RecordedHistory repositories_

-   [x] 2.4 録画ファイル、ドロップログ、サムネイルの管理情報を characterization する

    -   既存実装分類 A として、三種類の管理情報について追加、更新、削除、録画済み番組単位の削除、識別番号、および全件取
        得を `unittest/spec` で固定する。
    -   path、size、drop・scrambling・error 件数を保存する一方、動画、ログ、画像の実体へ副作用を与えないことを synthetic
        filesystem marker で否定検証する。
    -   録画済み番組との関連を要求した場合だけ対応する管理情報が取得されることを `integration` で確認する。
    -   完了時には、三種類の CRUD、空結果、関連取得、および実ファイル副作用 0 件が自動testで観測できる。
    -   _Requirements: 2.4, 2.6, 3.1, 3.2, 3.4_
    -   _Boundary: VideoFile・DropLogFile・Thumbnail repositories_

-   [x] 2.5 タグと録画済み番組の関連付けを characterization する

    -   既存実装分類 A として、タグの追加、更新、削除、一覧、件数、および録画済み番組との関連追加・削除・取得を
        `unittest/spec` で固定する。
    -   relation の追加と削除が対象の識別番号だけへ作用し、他の録画済み番組やタグの業務状態を変更しないことを
        `integration` で確認する。
    -   完了時には、多対多の関連を含む CRUD、pagination、空結果、および対象外 row 不変を再現でき、production code の差分
        がない。
    -   _Requirements: 2.5, 2.6, 3.1, 3.2, 3.3, 3.4_
    -   _Boundary: RecordedTag repository・relation_

-   [x] 2.6 (P) backend ごとの検索能力を characterization する

    -   SQLite の真偽値表現と LIKE、正規表現設定が `true` の場合だけの正規表現能力、および省略・無効時の非対応を
        `unittest/spec` で固定する。
    -   MySQL の真偽値、通常・binary LIKE、通常・binary 正規表現を、大文字小文字指定の全組合せで `unittest/imp` として検
        証する。
    -   両 backend の文字照合・正規表現結果を強制的に同一化せず、それぞれの実 driver から得た結果を backend 別期待値で
        `integration` 検証する。
    -   完了時には、dialect truth table の全組合せが成功し、backend 間差を post-process する新しい production code がな
        い。
    -   _Requirements: 3.5, 3.6, 3.7, 3.8, 3.9_
    -   _Boundary: DBOperator dialect adapter_
    -   _Depends: 1.1_

-   [x] 2.7 保存先限定削除候補providerをREDから最小実装・GREENまで一単位で追加する

    -   `test/server/persistence/storage-deletion-candidate.cross-spec.test.ts`でstorage名と除外Recorded ID集合を受け、
        一件のprimitive IDまたは`null`だけを返す、srcの`IStorageDeletionCandidatePort`と同じ形の契約（test内の`StorageDeletionCandidatePort`）を先に定義する。
    -   未保護、一件以上のvideo relation、全relationの保存先一致、空・非空除外集合、`startAt ASC, id ASC`、query
        rejectionをfake query境界で検証し、既存`findOld()`を適合済みと扱わないREDを確認する。
    -   `IRecordedDB`／`RecordedDB`へ`findOldestUnused()`を追加し、対象relationの`EXISTS`と不一致relation
        の`NOT EXISTS`、protection、除外ID、二段sort、limit一件を一つのparameterized queryとして適用する。
    -   空除外集合では空`NOT IN`を生成せず、SQLite/MySQLのboolean投影以外は同じprimitive ID／`null`／元error contractを
        維持し、既存のread retryとconnection lifecycleだけを利用する。
    -   `IRecordedDB`をstorage consumer portへ一回bindingし、SQL・relation条件を別adapterへ複製しない。
    -   `test/server/persistence/storage-deletion-candidate.integration.test.ts`でtemporary SQLiteと隔離MySQLへ単
        独・mixed storage relation、保護、空・非空除外集合、同時刻ID順、0件、driver/query failureを接続する。
    -   query/connection cleanupと共通read retryを既存owner契約で観測し、部分候補やerrorの`null`変換を行わない。
    -   完了時には同じtarget testと両backend integrationがGREENとなり、同じrow集合・順序・primitive ID／`null`が得ら
        れ、entity/DTO/token返却、usage判定、file削除、lock取得、および残留query資源が0件になる。
    -   _Requirements: 3.2, 3.3, 3.4, 3.5, 3.8, 3.10, 5.1, 5.2, 5.3, 7.4_
    -   _Boundary: IStorageDeletionCandidatePort persistence provider・RecordedDB query・SQLite/MySQL integration_
    -   _Depends: 2.3, 2.4, 2.6_

-   [x] 3. 一括確定と共通再試行の既存境界を固定する
-   [x] 3.1 予約一括変更と番組置換の確定単位を characterization する

    -   既存実装分類 A として、予約の一括追加・更新・削除、および番組の全件・放送局単位置換が全変更成功時だけ確定するこ
        とを `integration` で固定する。
    -   先頭・中間・末尾の変更失敗を注入し、開始前の row 集合へ取り消され、従来の操作別 error message が caller へ返るこ
        とを確認する。
    -   transaction 全体を共通再試行へ渡さず、一つの transaction attempt だけが開始されることを `unittest/imp` で検証す
        る。
    -   完了時には、成功時の全件確定、各失敗位置の全件取消し、操作別 error、および再試行 0 回が観測できる。
    -   _Requirements: 4.1, 4.2, 4.4, 5.4_
    -   _Boundary: Reserve batch・Program replacement transactions_

-   [x] 3.2 種類別復元と段階間の部分確定を characterization する

    -   既存実装分類 A として、復元対象の各種類が削除と全追加を一つの確定単位とし、途中失敗時にその種類だけを開始前へ戻
        すことを parameterized `integration` test で固定する。
    -   復元全体を一つの transaction にせず、確定済みの前段を後段失敗で取り消さない既存の段階順を確認する。
    -   各種類の失敗が従来の `restore error` として返り、共通再試行が重ならないことを `unittest/imp` で検証する。
    -   完了時には、全復元種類の成功・中間失敗と、前段確定後の後段失敗を自動testで再現できる。
    -   _Requirements: 4.3, 4.4, 4.5, 5.4_
    -   _Boundary: Entity restore transactions_

-   [x] 3.3 番組増分更新と未列挙の複数件処理を characterization する

    -   既存実装分類 A として、番組増分更新が個別の削除・追加・更新失敗を記録して後続を続け、成功分を確定する場合がある
        挙動を `integration` で固定する。
    -   個別失敗は caller へ返さず、更新全体を成功として扱う（失敗は log に残る）ことを `unittest/imp` で固定し、新しい
        部分結果型、再照合、全件 rollback を追加しない。
    -   代表的な未列挙の複数件処理を確認し、要件で指定されていない処理を一律の原子的変更または共通再試行対象へ再分類しな
        いことを検証する。
    -   完了時には、失敗記録、後続継続、成功分確定、caller 結果、および非一律な処理境界を今の挙動として固定できる。
    -   _Requirements: 4.4, 4.6, 4.7, 5.4_
    -   _Boundary: Program incremental transaction・未列挙 batch_

-   [x] 3.4 (P) 共通再試行の回数、待機、最終結果を characterization する

    -   既存実装分類 A として、通常操作が成功する試行位置ごとの呼出回数と、各失敗後の 1,000 ミリ秒待機を fake timer によ
        り `unittest/spec` で固定する。
    -   全試行失敗時は job 5 回と 5 回目後を含む待機 5 回の後、5 回目と同じ error object を返すことを `unittest/imp` で
        検証する。
    -   option を省略した既存 caller の既定値を対象とし、error 分類、指数 backoff、自動再接続、0 以下の値への新しい意味
        を追加しない。
    -   完了時には、成功位置 1〜5、全失敗、待機回数、および最後の error identity の全caseが production code 変更なしで成
        功する。
    -   _Requirements: 5.1, 5.2, 5.3_
    -   _Boundary: PromiseRetry_
    -   _Depends: 1.1_

-   [x] 4. cold start の接続初期化を承認済み契約へ変更する
-   [x] 4.1 共有初期化と完全初期化後公開をREDから最小実装・GREENまで一単位で変更する

    -   修正前の並行候補生成、外部拡張失敗後の保存候補、および回収されない候補を focused `unittest/imp` で再現してから、
        目標 `unittest/spec` を追加する。
    -   同時要求が一つの接続作成・データ構造更新・外部拡張読込みへ合流し、成功時は同じ instance、失敗時は同じ primary
        error を受け取る契約を定義する。
    -   接続、データ構造更新、外部拡張の各失敗で候補を公開せず一回閉じ、close failure は primary error を置換せず別の内
        部診断へ残すcaseを定義する。
    -   不採用候補の回収と、失敗後の次要求が新しい初期化を開始できるcaseを含め、無期限 settlement を有限 timeout へ変更
        しない。
    -   目標testがsingle-flight、公開時点、cleanup、または再初期化の未実装だけを理由に失敗するREDを確認してから
        productionを変更する。
    -   一つの process 内で cold start 中の要求が同じ初期化結果へ合流し、接続作成、データ構造更新、外部拡張読込みを重複
        開始しない最小状態を追加する。
    -   すべての初期化段階が成功した候補だけを保存し、primary failure または不採用の候補を閉じ、共有中の要求へ同じ結果を
        返す。
    -   cleanup error は運用ログの内部診断へ分離し、元の接続・更新・外部拡張 error、既存の接続ポート、保存済み接続の順次
        再利用、および無期限待機を変更しない。
    -   同じ`unittest/spec`と`unittest/imp` targetを再実行する。
    -   完了時には、既存characterizationと目標testがGREENになり、候補生成・初期化・更新・拡張読込み・候補closeの各回数が
        承認済み契約と一致し、赤いtestが残らない。
    -   _Requirements: 1.3, 1.6, 1.10, 1.11, 6.3, 6.5_
    -   _Boundary: DBOperator―cold initialization_
    -   _Depends: 1.2, 1.3, 1.4_

-   [x] 4.3 共有初期化を実 backend 境界で結合検証する

    -   SQLite の外部拡張 callback と既存接続の簡易問い合わせを制御し、pending 中に timeout や別初期化が発生せず、元結果
        だけが返ることを `integration` で確認する。
    -   SQLite と MySQL の初回並行利用で、データ構造更新を含む候補が一つだけ作られ、成功後の全 caller が同じ instance を
        受け取ることを検証する。
    -   各初期化段階の失敗後に候補が非公開かつ回収され、次の確認で新しい候補と未適用更新が再実行されることを確認する。
    -   完了時には、両 backend の成功・失敗・pending・再確認caseが同じ接続 lifecycle 契約を満たす。
    -   _Requirements: 1.2, 1.3, 1.6, 1.8, 1.10, 1.11, 6.1, 6.3, 6.5_
    -   _Boundary: DBOperator―DataSource・Migration・extension 結合_
    -   _Depends: 4.1_

-   [x] 5. 一括変更資源の失敗処理を承認済み契約へ変更する
-   [x] 5.1 transaction lifecycleの全対象をREDから最小実装・GREENまで一単位で変更する

    -   transaction 資源の確保後について、開始、変更、確定、取消し、および解放を個別に失敗させる domain 固有のtarget
        `integration` fault harness を追加する。
    -   全経路で解放を一回だけ試み、開始済みの場合だけ取消し、元の database failure と取消し・解放failureを別の内部診断
        へ記録する目標testを定義する。
    -   依頼元には各操作が従来から返す error message だけを維持し、cleanup error や公開 `cause` で置き換えないことを
        `unittest/spec` で固定する。
    -   operation が成功しても解放だけ失敗した場合は同じ操作別 error と内部 cleanup 診断になるcaseを含める。
    -   目標testが開始失敗時の未解放、無条件取消し、cleanup errorによるwrapper置換など、修正対象ごとの意図した理由だけで
        失敗するREDを確認してからproductionを変更する。
    -   放送局の一括保存、番組置換、および番組増分更新について、transaction 開始を含む全経路で資源を解放し、開始済みの場
        合だけ取消す。
    -   元の操作 failure と cleanup failure を分離して記録し、各操作の従来の caller error、番組増分の個別失敗継続、およ
        び非一律な確定境界を変更しない。
    -   予約の一括追加・更新・削除、予約復元、およびルール復元について、開始失敗を含む全経路で資源を一回解放し、activeな
        変更だけを取消す。
    -   元の database error と cleanup error を分離し、`ReserveUpdateManyError` または `restore error` だけを caller へ
        返す。
    -   生成 ID、ルールの保存形式、一種類ごとの確定単位、および共通再試行の非適用を変更しない。
    -   録画済み番組および録画履歴の種類別復元について、開始失敗を含む全経路で資源を一回解放し、active な変更だけを取消
        す。
    -   元の database error と cleanup error を別々に記録し、caller には従来の `restore error` だけを返す。
    -   録画済み番組復元時の関連管理情報削除、一種類ごとの確定、および前段確定後の後段非 rollback を変更しない。
    -   録画ファイル、ドロップログ、サムネイル、およびタグの種類別復元について、開始失敗を含む全経路で資源を一回解放
        し、active な変更だけを取消す。
    -   元の database error と cleanup error を別々に記録し、caller には従来の `restore error` だけを返す。
    -   実ファイルへの副作用を追加せず、種類別確定、段階順、多対多 relation、および共通再試行の非適用を維持する。
    -   同じ`unittest/spec`とdomain固有`integration` fault matrixを全操作群へ適用して再実行し、共通再試行を重ねない。
    -   完了時には、成功、開始失敗、変更失敗、確定失敗、取消し失敗、解放失敗の全caseがGREENになり、各操作群のrow集合、資
        源回収回数、cleanup診断、および従来のcaller errorが承認済み契約と一致して赤いtestが残らない。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.4_
    -   _Boundary: QueryRunner lifecycle・Channel・Program・Reserve・Rule・Recorded restore transactions_
    -   _Depends: 3.1, 3.2, 3.3_

-   [x] 6. 永続化機能を backend と共有検証matrixで統合する
-   [x] 6.1 SQLite の永続化 lifecycle を結合検証する

    -   test ごとの一時 database と合成外部拡張を使い、空 schema からの更新、接続共有、全 repository の round
        trip、dialect 検索、一括確定、再試行、および明示終了を `integration` で通す。
    -   接続・更新・外部拡張・簡易問い合わせの pending と failure、および transaction の全 failure point を success path
        と同じ重要度で実行する。
    -   完了時には、SQLite 固有suiteが実環境の database file、拡張、認証情報を使わず、承認済みの成功・失敗結果を再現可能
        に返す。
    -   _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3,
        3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3,
        6.4, 6.5_
    -   _Boundary: SQLite persistence integration_
    -   _Depends: 2.6, 3.4, 4.3, 5.1_

-   [x] 6.2 MySQL の永続化 lifecycle を結合検証する

    -   test ごとの隔離 schema と synthetic records を使い、空 schema からの更新、接続共有、全 repository の round
        trip、MySQL の文字照合・正規表現、一括確定、再試行、および明示終了を `integration` で通す。
    -   SQLite との結果完全一致を期待せず、MySQL 固有の真偽値、通常・binary 検索、および driver error を backend 別期待
        値で検証する。
    -   完了時には、MySQL 固有suiteが外部の利用者databaseや実認証情報を使わず、成功・失敗・cleanupを再現可能に返す。
    -   _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.8,
        3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: MySQL persistence integration_
    -   _Depends: 2.6, 3.4, 4.3, 5.1_

-   [x] 6.3 backend 固有suiteを共有 server test rootへ統合する

    -   共有 foundation の固定 command から永続化の `unittest/spec`、`unittest/imp`、SQLite integration、および MySQL
        integration を実行し、別の test root や runner を追加しない。
    -   SQLite temporary databaseと隔離MySQL schemaのfixture、Migration前後のschema、transaction fault injection、
        repository経由の共通再試行、およびclose後のcleanupを、Task 6.1と6.2のbackend別期待値へ接続する。
    -   実接続先、credential、利用者database、実外部拡張、および環境固有pathがfixture、snapshot、logへ含まれないことを検
        査する。Node.js matrix、C0/C1はTask 7.5だけで判定する。
    -   完了時には、永続化固有suiteが共有rootから選択可能で、SQLiteとMySQLの成功・失敗・cleanup caseおよび非秘密fixture
        をTask 7.1から7.5の品質判定へ引き渡せる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 2.1, 2.2, 2.3, 2.4, 2.5,
        2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10,
        5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_
    -   _Boundary: Persistence domain validation_
    -   _Depends: 6.1, 6.2_

-   [x] 7. 永続化固有testを共有server品質gateへ接続する
-   [x] 7.1 全55 ACの機能固有仕様caseとR1〜R6/R7.1の`unittest/spec`を完成させる

    -   Requirements 1から7の全55 ACを一意に列挙し、各ACへ主case、補助case、test path、fixture、期待する戻り値・error・
        状態・副作用を割り当て、未割当ACを0件にする。割り当てはDesignの要件追跡表と`unittest/spec`のtest titleを正とし、別のmatrix
        fileを作らない。
    -   `test/server/persistence/connection.spec.test.ts`、`repositories.spec.test.ts`、
        `search-dialects.spec.test.ts`、`retry.spec.test.ts`で、方式選択、同時初期化、完全初期化後公開、保存・検索、
        backend差、一括確定、再試行、Migration、および明示終了を外部契約として検証する。
    -   Designの`XSP-PERSIST-STORAGE-CANDIDATE-*`はformal trace外の補足caseとして維持し、55 ACのcase件数、成功の根拠へ加算
        しない。
    -   完了時には、全55 ACを主caseから逆引きでき、R1〜R6 と R7.1は成功したnamed `unittest/spec` caseから逆引きでき
        る。R7.2〜R7.5は各Task 7.2〜7.5が閉じ、未割当、根拠のないskip、補足caseのformal trace混入はいずれも0件である。
    -   _Depends: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.1, 6.3_
    -   _Requirements: 7.1_

-   [x] 7.2 保存値・値域・検索・再試行・backend分岐を`unittest/imp`で完成させる

    -   `test/server/persistence/implementation.test.ts`で`null`、空配列、0件・1件・複数件、最小・最大、範囲外、不正型、
        重複、relation選択、boolean、LIKE、正規表現有効・無効、MySQL通常・binary演算子、および破損保存値を表形式で検証す
        る。
    -   型付きportが受理しない`null`、範囲外、不正型は対象signatureと非適用理由を記録し、保存値破損として到達可能なcase
        は読取errorをassertする。要件にない補完、clamp、重複排除、backend間結果のpost-processを期待値にしない。
    -   `retry.spec.test.ts`で成功位置1〜5と全失敗をfake timerで実行し、job呼出回数、各失敗後の1,000ミリ秒待機、再試行4
        回、5回目後を含む待機5回、および最後のerror identityを個別にassertする。transaction経路へ共通再試行を重ねない。
    -   完了時には、Designの入力値域9区分、dialect truth table、relation・復元・retry・backend分岐に未分類branchがなく、
        各分岐を対応assertionから逆引きできる。
    -   _Depends: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.4, 7.1_
    -   _Requirements: 7.2_

-   [x] 7.3 状態・失敗・race・資源matrixを全suiteへ割り当てる

    -   Task 7.1の主caseを、未初期化、初期化中、共有成功、初期化失敗、後続再初期化、明示終了、0件・1件・複数件、
        transaction未開始・進行中・commit・rollback、成功・失敗の状態へ展開する。
    -   cold start同着、extension・Migration・queryの未確定、late settlement、同じ結果を待つrace、重複要求を
        `connection.spec.test.ts`と`connection.integration.test.ts`へ割り当て、独自timeout、cancel、自動再接続を新しい契
        約として追加しない。
    -   DataSource、SQLite handle、MySQL pool connection、QueryRunner、transactionを、生成前・取得成功・開始失敗・変更失
        敗・commit失敗・rollback失敗・release失敗・closeまで追跡する。生成済み資源の解放回数、active時だけのrollback、
        primary database error、cleanup診断、操作別error messageを別々に観測する。
    -   stream、timer、listener、child process、lockは本機能が取得しないため非適用とする。ただし再試行のfake timerは
        `unittest/imp`の決定的harnessとしてteardown後の残留0件を確認し、製品timer資源へ読み替えない。
    -   完了時には、matrixの各項目に主case、補助caseまたは非適用理由があり、
        未分類項目が0件である。
    -   _Depends: 4.1, 4.3, 5.1, 7.1, 7.2_
    -   _Requirements: 7.3_

-   [x] 7.4 SQLite・MySQL・Migration・transaction・再試行の外部境界を結合検証する

    -   `connection.integration.test.ts`、`migrations.integration.test.ts`、`queries.integration.test.ts`、
        `transactions.integration.test.ts`、`close.integration.test.ts`をtemporary SQLite databaseと隔離MySQL schemaへ実
        driverで接続し、initialize、pending Migration、query、transaction、destroy、および後始末を検証する。
    -   SQLite database fileと合成extensionについて、作成、順序付き読込み、途中失敗、候補非公開、close後削除をfilesystem
        境界として観測する。MySQLではpool connectionと隔離schemaの取得・解放を観測し、利用者databaseや実credentialを使わ
        ない。
    -   repository経由の通常操作へ一時driver failureを注入し、共通再試行後のquery結果・最後のerror・connection資源を実
        driver境界で確認する。transactionは一attemptだけでrollbackし、共通再試行との境界を呼出回数とrow集合で検証する。
    -   HTTP、IPC、child processは本機能の直接portに存在せず、DB driver、SQLite file、extensionの検証でもcarrier境界を通
        らないため非適用とする。filesystemはSQLite database fileとextensionだけを適用対象とし、非適用を未実行成功へ読み
        替えない。
    -   完了時には、SQLite・MySQL・Migration・query・transaction・retry・closeの成功、失敗、cleanupを実境界から観測で
        き、filesystemの限定範囲とHTTP・IPC・child processの非適用理由を含む結合matrixの未分類が0件である。
    -   _Depends: 6.1, 6.2, 6.3, 7.3_
    -   _Requirements: 7.4_

-   [x] 7.5 本機能の品質判定を満たす

    -   Task 7.1から7.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 7.1, 7.2, 7.3, 7.4_
    -   _Requirements: 7.5_

## Requirement 8: 現行公式 MySQL LTS との接続互換

本 group は Owner 承認済み Requirement 8 と Design R1 のクライアント置換だけを実装入力にする。MySQL
サーバー設定変更、データベース移行、無関係な refactor は対象外である。

実装時の許可範囲は次に限定する。

-   `package.json` と `package-lock.json`
-   `test/server/persistence/mysql-lts-runtime.ts`（新設。公式現行 LTS 用。認証弱体化なし）
-   `test/server/persistence/mysql-lts-connection.integration.test.ts`
-   `test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`
-   `test/server/fixtures/persistence/mysql-inplace/`
-   旧直接 `mysql` 除去後に既存 R1〜7 の隔離 fixture が `require('mysql')` で壊れる場合に限り
    `test/server/persistence/mysql-runtime.ts` の管理クライアント切替。`mysql:8.4` と既存隔離 fixture が付けている
    削除済み認証 plugin の有効化 option はそのまま残し、公式 LTS 証跡へ流用しない

次は変更しない。必要性を後から証明する場合は、新しい承認済み task 修正が必要である。

-   `src/model/db/DBOperator.ts`
-   `src/model/IConfigFile.ts`
-   `config/config.yml.template`

各 leaf は TDD 順、成功 / 失敗 oracle、command 種別、実装の記録を持ち、公開や publish を行わない。`mysql2`
と `typeorm` を直接依存とする（版は `package.json` が正本）。公式現行 LTS は image tag `mysql:lts` で表し、焦点 integration が
tag と image digest を検証する。

-   [x] 8. 現行公式 MySQL LTS へ本番接続できるよう直接依存を置換する
-   [x] 8.1 公式現行 MySQL LTS の接続・終了 RED と公開前後の既存 state を固定する

    -   TDD: 実装より先に RED test を追加する。公式現行 LTS は image tag `mysql:lts` で表し、確認した
        digest を実装の記録へ残す。
    -   設定は既存 Configuration 契約（`dbtype` と `mysql.host` / `user` / `port` / `password` / `database`、任意
        `charset`）を `DBOperator` へ渡す。新しい設定 field と `driver` override を追加しない。
    -   `test/server/persistence/mysql-lts-runtime.ts` と
        `test/server/persistence/mysql-lts-connection.integration.test.ts` を新設する。既存
        `mysql-runtime.ts` の `mysql:8.4` と削除済み認証 plugin の有効化 option は公式 LTS 証跡に使わない。削除済み
        旧認証 plugin や認証弱体化 option を付けない。
    -   公式 LTS に対し `Configuration` → `DBOperator` の接続作成と `closeConnection()` を観測する。旧直接
        `mysql@2.18.1` では公開前 handshake が失敗し、候補は公開されず閉じられ、通常の接続失敗が返ることを RED oracle
        とする。失敗 identity は `ER_NOT_SUPPORTED_AUTH_MODE` または同等の認証 handshake 拒否であり、timeout や
        skip、別 image への読替えではない。
    -   公開後の既存 state は、公開済み instance の `checkConnection()` / `select 1` 失敗が既存 query error を返し、自動
        close / 置換をしないことである。既存 `[PERSIST-1.11-FAILED-*-INITIALIZATION]` と `[PERSIST-1.3-CHECK]` をこの
        二分の oracle として維持し、公式 LTS 経路が公開後失敗を新しい再接続契約へ変えないことを named case で固定する。
    -   成功 oracle（本 leaf）: 公式 LTS 接続 case が期待した公開前認証失敗で RED になり、公開前 cleanup と公開後 query
        error の二分が named case から逆引きできる。失敗 oracle: skip、`mysql:8.4` 弱体化 fixture の流用、固定 version の
        image を現行 LTS の証跡にすること、認証弱体化、公開後失敗での自動 close / 置換。
    -   Command 種別は `integration` と既存 state の `unittest/spec`。検証 command は
        `npm run test:server:integration -- test/server/persistence/mysql-lts-connection.integration.test.ts`、
        `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`。
    -   確認した LTS tag / digest、失敗 identity、command を実装の記録に残す。公開や publish はしない。
    -   完了時には、公式現行 LTS への本番接続 RED が focused integration から観測でき、公開前候補 cleanup / 公開後
        query error の既存 state が named spec case から逆引きでき、production source の差分がない。
    -   _Requirements: 8.1, 8.2, 8.4_
    -   _Boundary: DBOperator―公式 MySQL LTS 接続_

-   [x] 8.2 置換前と同じ schema・migration history・代表 row の in-place 互換 RED を作る

    -   TDD: 8.1 の公式 LTS provisioner を使い、空 schema からの Migration / CRUD とは別の in-place fixture を先に RED
        として追加する。
    -   exact path は `test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts` と
        `test/server/fixtures/persistence/mysql-inplace/` である。既存
        `connection.integration.test.ts` の空隔離 schema は代替にしない。
    -   fixture は置換前と同じ MySQL Migration を適用済みにする。履歴 oracle は `SELECT name FROM migrations ORDER BY
        id ASC` が `Init1601186196169`、`AddRawExtended1624084351785`、`AddEventRelay1716647383635`、
        `AddRuleBS4K1790497623885` であること（BS4K対応でMigrationを追加した際、fixtureのschema.sqlはBS4K追加前の
        状態のまま据え置くため、接続時にこのMigrationだけが新たに適用され、`rule`表以外のschemaは変わらない）。
    -   代表 row は秘密を含まない合成の `channel` 1 件と `program` 1 件以上とする。`Configuration` → `DBOperator` →
        採用 client 経路で既存 row を読み、代表更新と再読取りを行い、schema と migration history が変わっていないことを
        確認し、close と cleanup する。
    -   `IConfigFile` と `config/config.yml.template` の field 不変確認は設定形状の補助証跡に限定する。
    -   Command 種別は `integration`。検証 command は
        `npm run test:server:integration -- test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`。
    -   成功 oracle（本 leaf）: 旧直接 `mysql@2.18.1` では公式 LTS へ開けず、読取り・更新・再読取りまで到達できない
        RED になる。失敗 oracle: 空 schema からの Migration / CRUD を本証跡へ読み替える、履歴を再実行して上書きする、設定
        型の静的比較だけで 8.3 を満たしたとする。
    -   実装の記録には fixture の migration 名、代表 row 識別、command、RED 理由を残す。公開や publish はしない。
    -   完了時には、in-place fixture が空 schema 経路と区別でき、旧 client では公式 LTS 上の保存データ互換を証明でき
        ないことが focused integration から観測できる。
    -   _Requirements: 8.1, 8.3, 8.4_
    -   _Boundary: DBOperator―in-place 保存データ_
    -   _Depends: 8.1_

-   [x] 8.3 TypeORM 互換の直接依存 `mysql2` へ置換し、旧直接 `mysql` を除去する

    -   TDD: 8.1 と 8.2 の RED が残っていることを確認してから依存を置換する。本 leaf では GREEN を宣言しない。
    -   採用する `mysql2` 版は、`typeorm` の peerDependencies を満たす版として `package.json` に固定する。
    -   `package.json` へ直接依存 `mysql2` を追加し、直接依存 `mysql` とその lockfile 条目を除去する。TypeORM
        `type: 'mysql'` を維持し、`driver` override を追加しない。
    -   旧 `mysql` 除去後に TypeORM が `type: 'mysql'` から `mysql2` を解決することを実装時に確認し、確認方法と解決結果
        を実装の記録へ残す。旧 client が残り続けて選ばれる状態を残さない。
    -   既存 R1〜7 の隔離 fixture が `require('mysql')` に依存している場合だけ
        `test/server/persistence/mysql-runtime.ts` の管理クライアントを切替える。`mysql:8.4` と既存隔離用の
        削除済み認証 plugin 有効化 option はそのまま残し、公式 LTS や本番接続の成功条件にしない。
    -   `src/model/db/DBOperator.ts`、`src/model/IConfigFile.ts`、`config/config.yml.template` は変更しない。必要性がある場合は
        本 leaf を拡張せず、承認済み task 修正を待つ。
    -   config / API / CLI / schema / データ移行の契約を変えない。接続失敗を旧 client や削除済み認証 plugin、認証弱体化へ
        fallback しない。
    -   Command 種別は package-manager と focused integration 再実行である。公開 command や publish は使わない。
    -   成功 oracle: lockfile に installed `mysql2` があり直接 `mysql` が無く、TypeORM の runtime 解決が `mysql2`
        であること、および 8.1 / 8.2 を弱体化せずに再実行できること。失敗 oracle: peer 範囲外の版、`mysql` の残留、
        `driver` override、設定 field 追加、公式 LTS への認証弱体化。
    -   実装の記録には選んだ `mysql2` 版、peer 範囲の根拠、TypeORM 解決の確認方法と結果、lockfile 差分要約を残す。
    -   完了時には、直接依存が検証済み `mysql2` だけになり、既存 `type: 'mysql'` 経路と設定 field が保たれ、GREEN 証跡は
        まだ 8.4 の担当である。
    -   _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
    -   _Boundary: package.json―TypeORM mysql2_
    -   _Depends: 8.2_

-   [x] 8.4 公式 LTS 接続・終了と in-place 保存データの GREEN を確認し、既存 R1〜6 の主 test を置換後に再確認する

    -   TDD: 8.3 の置換後にだけ GREEN を取る。8.1 と 8.2 の focused integration が公式現行 LTS で成功し、公開後
        `select 1` 失敗は既存 query error のままであることを確認する。
    -   接続作成の成功は `getConnection()` の公開完了である。その後 `closeConnection()` が接続を解放する。in-place
        経路は既存 row の読取り・代表更新・再読取り・schema / migration history 非変更・close / cleanup をすべて通す。
    -   公式現行 LTS（`mysql:lts`）の tag と digest、および TypeORM の runtime 解決を再確認し、確認値を実装の記録に残す。
    -   既存 `connection.integration.test.ts` と `close.integration.test.ts` の MySQL 隔離経路は、公式 LTS の確認の代替に
        せず、旧 client 除去後も既存契約のまま成功することを回帰確認する。焦点 LTS test だけでは Requirement 8.1 の既
        存振る舞い縮小を検出しない。
    -   8.3 後の同一 tree で、既存 persistence R1〜6 の主 spec / imp / SQLite / MySQL integration を再実行する。再確認対象
        は次である。
        -   `npm run test:server:integration -- test/server/persistence/mysql-lts-connection.integration.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`
        -   `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`
        -   `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`
        -   `npm run test:server:spec -- test/server/persistence/search-dialects.spec.test.ts`
        -   `npm run test:server:spec -- test/server/persistence/retry.spec.test.ts`
        -   `npm run test:server:imp -- test/server/persistence/implementation.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`
        -   `npm run test:server:integration -- test/server/persistence/close.integration.test.ts`
    -   公開や publish はしない。
    -   完了時には、公式現行 LTS の接続・終了と in-place 保存データ互換、置換後 R1〜6 の主 test の再確認が、上記の command の
        全件成功として確認できる。
    -   _Requirements: 8.1, 8.2, 8.3, 8.4_
    -   _Boundary: DBOperator―公式 MySQL LTS GREEN_
    -   _Depends: 8.3_

## 接続設定・一覧・error 記録の追加契約

次の task group は、後から足された条件（1.4 の `socketPath`・`ssl`、1.12〜1.14、3.11、4.10、6.1 の `ormconfig.js`）に対応する。
実装と test は済んでいる。

-   [x] 9. 接続設定・一覧・error 記録の追加契約を固定する
-   [x] 9.1 SQLite の journal 方式（`sqlite.wal`）を固定する

    -   `sqlite.wal` が `true` のときだけ WAL にし、無効なら delete 方式にして、WAL だった file も delete 方式へ戻す。他の接続が
        使用中で戻せないときは接続を返さず error にする。
    -   `connection.spec.test.ts`（option の投影、pragma の順序、失敗時の候補 close）、`sqlite-journal.integration.test.ts`
        （実 file）、`orm-cli.integration.test.ts`（`ormconfig.js`）で確かめる。
    -   _Requirements: 1.12, 1.13, 6.1_
    -   _Boundary: DBOperator―SQLite の journal 方式_

-   [x] 9.2 SQLite のロック待ち時間（`sqlite.busyTimeout`）を固定する

    -   値を変えずに driver へ渡し、省略時は 5000 ミリ秒とする。不正な値は driver が拒否する。
    -   `connection.spec.test.ts`、`sqlite-busy-timeout.integration.test.ts`、`orm-cli.integration.test.ts` で確かめる。
    -   _Requirements: 1.14_
    -   _Boundary: DBOperator―SQLite のロック待ち_

-   [x] 9.3 MySQL の `socketPath`・`ssl` を固定する

    -   設定されているときだけ値を変えずに driver へ渡し、サーバーと `ormconfig.js` で同じに扱う。
    -   `connection.spec.test.ts`、`connection-socket.integration.test.ts`、`connection-ssl.integration.test.ts`、
        `orm-cli.integration.test.ts` で確かめる。
    -   _Requirements: 1.4_
    -   _Boundary: DBOperator―MySQL の接続先と TLS_

-   [x] 9.4 一覧の `limit` が 0 のときの扱いを固定する

    -   `limit` 0 は件数を制限しないものとして扱い、`offset` があればその位置以降の全件を返す。
    -   `list-limit-zero.imp.test.ts`、`findkeyword-offset-limit.imp.test.ts`、`programdb-queries.imp.test.ts`、
        `doubles-parity.integration.test.ts`（実 DB）で確かめる。
    -   _Requirements: 3.11_
    -   _Boundary: 各 repository の一覧取得_

-   [x] 9.5 一括変更の失敗と後始末の失敗を system log へ記録することを固定する

    -   `transactions.imp.test.ts`、`repositories.spec.test.ts`、`channeldb.imp.test.ts`、`programdb-queries.imp.test.ts` で確かめる。
    -   _Requirements: 4.10_
    -   _Boundary: 各 repository の一括変更_

-   [x] 9.6 `ormconfig.js` の設定の読み込みを固定する

    -   `ormconfig.js` が、`!env`・merge key の展開と `dbtype` の `better-sqlite3` の読み替えを、サーバーと同じ規則で行う。
    -   `orm-cli.integration.test.ts` で確かめる。
    -   _Requirements: 6.1_
    -   _Boundary: `ormconfig.js`_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                    | Test type                                          | Local Depends                                                                              | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                      |
| 1.2  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                      |
| 1.3  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/close.integration.test.ts`                                                                                                                                       | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/close.integration.test.ts`                                                                                                                                                                                                                            |
| 1.4  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/orm-cli.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`                                                                                                                                                                                      | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/orm-cli.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`                                                                                                                                                                                                                                                                                                      |
| 2.1  | `test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                    |
| 2.2  | `test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                    |
| 2.3  | `test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/queries.integration.test.ts`                                                                                                                                   | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                                                        |
| 2.4  | `test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                       | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                                                                                                                                       |
| 2.5  | `test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                       | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                                                 | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                                                                                                                                       |
| 2.6  | `test/server/persistence/search-dialects.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/queries.integration.test.ts`                                                                                                                                | `unittest/spec`<br>`unittest/imp`<br>`integration` | `1.1`                                                                                      | `npm run test:server:spec -- test/server/persistence/search-dialects.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`                                                                                                                                                                                                                     |
| 2.7  | `src/model/db/IRecordedDB.ts`<br>`src/model/db/RecordedDB.ts`<br>`src/model/ModelContainerSetter.ts`<br>`test/server/persistence/storage-deletion-candidate.cross-spec.test.ts`<br>`test/server/persistence/storage-deletion-candidate.integration.test.ts`                                        | `unittest/spec`<br>`integration`                   | `2.3, 2.4, 2.6`                                                                            | `npm run test:server:spec -- test/server/persistence/storage-deletion-candidate.cross-spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/storage-deletion-candidate.integration.test.ts`                                                                                                                                                                                                                                                                |
| 3.1  | `test/server/persistence/implementation.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                     | `unittest/imp`<br>`integration`                    | なし（共有foundationのみ）                                                                 | `npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                                                                                                                                      |
| 3.2  | `test/server/persistence/implementation.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                     | `unittest/imp`<br>`integration`                    | なし（共有foundationのみ）                                                                 | `npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                                                                                                                                      |
| 3.3  | `test/server/persistence/implementation.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                     | `unittest/imp`<br>`integration`                    | なし（共有foundationのみ）                                                                 | `npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`                                                                                                                                                                                                                                                                                                      |
| 3.4  | `test/server/persistence/retry.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                                                                   | `unittest/spec`<br>`unittest/imp`                  | `1.1`                                                                                      | `npm run test:server:spec -- test/server/persistence/retry.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                           |
| 4.1  | `src/model/db/DBOperator.ts`<br>`test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | `1.2, 1.3, 1.4`                                                                            | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`                                                                                                                                                                                                                                                                                                                      |
| 4.3  | `test/server/persistence/connection.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`                                                                                                                                                                               | `integration`                                      | `4.1`                                                                                      | `npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`                                                                                                                                                                                                                                                                                        |
| 5.1  | `src/model/db/ChannelDB.ts`<br>`src/model/db/ReserveDB.ts`<br>`test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`                                | `unittest/spec`<br>`integration`                   | `3.1, 3.2, 3.3`                                                                            | `npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`                                                                                                                                                           |
| 6.1  | `test/server/persistence/connection.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`<br>`test/server/persistence/queries.integration.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`<br>`test/server/persistence/close.integration.test.ts` | `integration`                                      | `2.6, 3.4, 4.3, 5.1`                                                                       | `npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/close.integration.test.ts` |
| 6.2  | `test/server/persistence/connection.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`<br>`test/server/persistence/queries.integration.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`<br>`test/server/persistence/close.integration.test.ts` | `integration`                                      | `2.6, 3.4, 4.3, 5.1`                                                                       | `npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/close.integration.test.ts` |
| 6.3  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/connection.integration.test.ts`                                                                                                                                  | `unittest/spec`<br>`unittest/imp`<br>`integration` | `6.1, 6.2`                                                                                 | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`                                                                                                                                                                                                                       |
| 7.1  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/search-dialects.spec.test.ts`<br>`test/server/persistence/retry.spec.test.ts`                                     | `unittest/spec`                                    | `1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.1, 6.3` | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/search-dialects.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/retry.spec.test.ts`                                                                                                                                                |
| 7.2  | `test/server/persistence/implementation.test.ts`<br>`test/server/persistence/retry.spec.test.ts`                                                                                                                                                                                                   | `unittest/imp`<br>`unittest/spec`                  | `2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.4, 7.1`                                                   | `npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:spec -- test/server/persistence/retry.spec.test.ts`                                                                                                                                                                                                                                                                                                                           |
| 7.3  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/connection.integration.test.ts`                                                                                                                                  | `unittest/spec`<br>`unittest/imp`<br>`integration` | `4.1, 4.3, 5.1, 7.1, 7.2`                                                                  | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`                                                                                                                                                                                                                       |
| 7.4  | `test/server/persistence/connection.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`<br>`test/server/persistence/queries.integration.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`<br>`test/server/persistence/close.integration.test.ts` | `integration`                                      | `6.1, 6.2, 6.3, 7.3`                                                                       | `npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/close.integration.test.ts` |
| 7.5  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/connection.integration.test.ts`                                                                                                                                  | `unittest/spec`・`unittest/imp`・`integration` | `7.1, 7.2, 7.3, 7.4`                                                                       | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`                                                                                                                                                                                                                       |
| 8.1  | `test/server/persistence/mysql-lts-runtime.ts`<br>`test/server/persistence/mysql-lts-connection.integration.test.ts`<br>`test/server/persistence/connection.spec.test.ts`                                                                               | `integration`<br>`unittest/spec`                   | `7.4`                                                                                      | `npm run test:server:integration -- test/server/persistence/mysql-lts-connection.integration.test.ts`<br>`npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`                                                                                                                                                                                                                                                                                            |
| 8.2  | `test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`<br>`test/server/fixtures/persistence/mysql-inplace/`                                                                                                                                                                    | `integration`                                      | `8.1`                                                                                      | `npm run test:server:integration -- test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                    |
| 8.3  | `package.json`<br>`package-lock.json`<br>`test/server/persistence/mysql-runtime.ts`（旧 `mysql` 除去後の管理クライアント切替が必要な場合のみ）                                                                                                                                                      | package-manager<br>`integration`                   | `8.2`                                                                                      | `typeorm` の peer `mysql2` を満たす版を `package.json` に固定し、`mysql2` 追加と直接 `mysql` 除去後に 8.1 / 8.2 の focused integration を再実行する                                                                                                                                                                                                                                                                         |
| 8.4  | `test/server/persistence/mysql-lts-connection.integration.test.ts`<br>`test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`<br>`test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/search-dialects.spec.test.ts`<br>`test/server/persistence/retry.spec.test.ts`<br>`test/server/persistence/implementation.test.ts`<br>`test/server/persistence/connection.integration.test.ts`<br>`test/server/persistence/migrations.integration.test.ts`<br>`test/server/persistence/queries.integration.test.ts`<br>`test/server/persistence/transactions.integration.test.ts`<br>`test/server/persistence/close.integration.test.ts` | `integration`・`unittest/spec`・`unittest/imp` | `8.3`                                                                                      | 最終計測前に 3 種 RED witness を一時 dirty として raw へ残して復元し、最終 bytes を commit して clean `HEAD^{tree}` を固定したうえで、inventory GREEN と次の targeted GREEN だけをその tree で実行する。<br>`npm run test:server:integration -- test/server/persistence/mysql-lts-connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/mysql-lts-inplace-stored-data.integration.test.ts`<br>`npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/search-dialects.spec.test.ts`<br>`npm run test:server:spec -- test/server/persistence/retry.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/implementation.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/migrations.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/queries.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/transactions.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/close.integration.test.ts` |
| 9.1  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/sqlite-journal.integration.test.ts`<br>`test/server/persistence/orm-cli.integration.test.ts` | `unittest/spec`<br>`integration` | `4.1` | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/sqlite-journal.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/orm-cli.integration.test.ts` |
| 9.2  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/sqlite-busy-timeout.integration.test.ts`<br>`test/server/persistence/orm-cli.integration.test.ts` | `unittest/spec`<br>`integration` | `4.1` | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/sqlite-busy-timeout.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/orm-cli.integration.test.ts` |
| 9.3  | `test/server/persistence/connection.spec.test.ts`<br>`test/server/persistence/connection-socket.integration.test.ts`<br>`test/server/persistence/connection-ssl.integration.test.ts`<br>`test/server/persistence/orm-cli.integration.test.ts` | `unittest/spec`<br>`integration` | `4.1` | `npm run test:server:spec -- test/server/persistence/connection.spec.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection-socket.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/connection-ssl.integration.test.ts`<br>`npm run test:server:integration -- test/server/persistence/orm-cli.integration.test.ts` |
| 9.4  | `test/server/persistence/list-limit-zero.imp.test.ts`<br>`test/server/persistence/findkeyword-offset-limit.imp.test.ts`<br>`test/server/persistence/programdb-queries.imp.test.ts`<br>`test/server/persistence/doubles-parity.integration.test.ts` | `unittest/imp`<br>`integration` | `2.3` | `npm run test:server:imp -- test/server/persistence/list-limit-zero.imp.test.ts`<br>`npm run test:server:imp -- test/server/persistence/findkeyword-offset-limit.imp.test.ts`<br>`npm run test:server:imp -- test/server/persistence/programdb-queries.imp.test.ts`<br>`npm run test:server:integration -- test/server/persistence/doubles-parity.integration.test.ts` |
| 9.5  | `test/server/persistence/transactions.imp.test.ts`<br>`test/server/persistence/repositories.spec.test.ts`<br>`test/server/persistence/channeldb.imp.test.ts`<br>`test/server/persistence/programdb-queries.imp.test.ts` | `unittest/spec`<br>`unittest/imp` | `5.1` | `npm run test:server:imp -- test/server/persistence/transactions.imp.test.ts`<br>`npm run test:server:spec -- test/server/persistence/repositories.spec.test.ts`<br>`npm run test:server:imp -- test/server/persistence/channeldb.imp.test.ts`<br>`npm run test:server:imp -- test/server/persistence/programdb-queries.imp.test.ts` |
| 9.6  | `test/server/persistence/orm-cli.integration.test.ts` | `integration` | `4.3` | `npm run test:server:integration -- test/server/persistence/orm-cli.integration.test.ts` |
