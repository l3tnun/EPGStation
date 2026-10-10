# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、番組情報・番組表固有の test と承認済み差分の最小実装だけを
追加する。

-   [x] 1. 既存の放送局・番組同期と保存 projection を仕様テストで固定する
-   [x] 1.1 放送局の全件同期と変更反映を characterization する

    -   既存実装は変更せず、放送局一覧の取得、放送局・service の除外、識別子・名称・放送波・番号・ロゴ有無の保存を
        `unittest/spec` で固定する。
    -   追加・変更通知による増分保存、削除通知だけでは即時削除しないこと、および次の全件同期で取得結果に合わせて整理する
        ことを synthetic fixture で検証する。
    -   保存 projection と放送局索引が同じ除外済み入力を使うことを `unittest/imp` で確認し、DB 接続・transaction の実装
        は永続化機能に委ねる。
    -   完了時には、全件、追加、変更、削除通知、除外の各 fixture が承認済みの放送局集合を再現し、production code の差分
        がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
    -   _Boundary: 放送局同期・保存 projection_

-   [x] 1.2 (P) 中心番組選択と番組の基本 projection を characterization する

    -   番組リレー、同時放送、移動、旧 schema、および自分自身を示す関連情報から中心番組を選び、関連情報自体は保存しない
        既存判断を `unittest/imp` で固定する。
    -   番組名の欠落、放送局索引の不成立、識別子、放送局、開始・終了時刻、無料判定の基本 projection を合成入力で検証す
        る。
    -   保存対象の選択に利用した関連情報を番組間関係として保存しないことを `unittest/spec` で確認する。
    -   完了時には、中心番組と基本項目の各 fixture が承認済み結果を再現し、保存対象外の番組と関連情報は保存結果へ現れな
        い。
    -   _Requirements: 2.2, 3.1, 3.2, 3.11_
    -   _Boundary: 中心番組 selector・番組基本 projection_

-   [x] 1.3 (P) 番組の文字・ジャンル・映像・音声 projection を characterization する

    -   説明の欠落・空文字、詳細表示文字列と未加工表現、通常・半角・短縮名（[前]・[後]を末尾に残す短縮名を含む）、および囲み文字変換の有効・無効を
        `unittest/spec` で比較する。
    -   入力順の先頭から最大3件の標準ジャンル、映像一組、および主音声一組を保存する既存規則を `unittest/imp` で固定す
        る。
    -   番組名、説明、詳細の通常表記と半角表記が同じ保存 projection から得られることを合成入力で検証する。
    -   完了時には、文字、詳細、ジャンル、映像、単数音声、複数音声の各正常 fixture が承認済みの保存項目を再現する。
    -   _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_
    -   _Boundary: 番組文字・media projection_

-   [x] 1.4 番組変更の集約、短周期保存、および失敗時復元を characterization する

    -   同一番組への作成、変更、削除、再定義の連続通知を、最後の有効な更新または削除へまとめる既存順序を `unittest/imp`
        で固定する。
    -   放送中または開始まで5分未満の番組を含む batch は短周期で保存し、それ以外は設定された更新周期まで buffer へ戻すこ
        とを fake timer で検証する。
    -   保存成功時だけ内部更新結果を発行し、保存全体の reject 時は当該 batch を新着変更の前へ戻して更新完了を発行しない
        ことを `unittest/spec` で確認する。
    -   完了時には、通知順列、短周期境界、通常周期、成功、失敗、新着通知の各 fixture で変更の欠落と二重確定がない。
    -   _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7_
    -   _Boundary: 番組変更 buffer・増分保存_

-   [x] 1.5 service 変更と service 別番組の一括更新を characterization する

    -   service の追加・変更を最後の候補へ集約し、削除通知だけでは保存済み放送局を削除しない既存結果を `unittest/spec`
        で固定する。
    -   on-air と deferred の対象 ID 集合を呼出開始時に一つの snapshot とし、現在の ID 順で番組を取得した後、集合全体を
        一回の一括保存へ渡すことを `unittest/imp` で検証する。
    -   一件の取得または一括保存が失敗した場合は全 ID を未完了のまま残し、prefix 成功、失敗 ID だけの再投入、および
        partial-success を作らないことを確認する。
    -   deferred 保存では保存開始後・完了前の更新通知を維持し、後発の失敗でも通知を取り消さない既存時点を固定する。
    -   完了時には、成功、途中取得失敗、一括保存失敗、空集合、および通知時点の各 fixture が承認済みの集合単位結果を返
        す。
    -   _Requirements: 1.4, 1.5, 7.11, 7.13_
    -   _Boundary: service 変更 buffer・service 別番組 aggregate_

-   [x] 2. 保存済み番組の read/query 契約を仕様テストで固定する
-   [x] 2.1 番組表、番組詳細、および放送中番組の query 意味を characterization する

    -   放送波または放送局と期間を指定した番組表について、期間の両端を含む重なり、無料番組 filter、および開始時刻順を
        `unittest/spec` で固定する。
    -   番組詳細の存在・不存在、通常・半角表記、および放送中番組の開始・終了両端を含む時刻判定を合成保存データで検証す
        る。
    -   同じ開始時刻へ追加の安定順序を仮定せず、放送局ごとの日別区切りと放送中の先頭一件 projection を `unittest/imp` で
        確認する。
    -   完了時には、端点、無料・有料、存在・不存在、表記、および現在時刻の各 fixture が承認済みの query 結果を返す。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
    -   _Boundary: 番組表・詳細・放送中 query_

-   [x] 2.2 keyword・除外・正規表現検索を characterization する

    -   keyword と除外 keyword の field 内 AND・field 間 OR、正規表現、および正規表現非対応時の通常検索 fallback を
        `unittest/spec` で固定する。
    -   選択された番組名、通常説明、詳細説明の組合せと、通常・半角表記の検索用保存値を `unittest/imp` で検証する。
    -   SQLite と MySQL の正規表現能力を別期待値で実行し、非対応能力を新しい意味へ推定しない。
    -   完了時には、通常 keyword、除外、正規表現対応・非対応の各 matrix が承認済み検索結果を再現する。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4_
    -   _Boundary: 番組検索の文字条件_

-   [x] 2.3 構造化検索条件、順序、および件数制限を characterization する

    -   放送局 ID が一件以上あれば放送波より優先し、ID がなければ指定放送波を使うことを `unittest/spec` で固定する。
    -   ジャンル、曜日、時間帯、無料、番組長、および検索期間の条件結合を SQLite と MySQL の合成 fixture で検証する。
    -   結果を開始時刻順にし、同時刻の追加順序を保証せず、指定件数までに制限することを `unittest/imp` で確認する。
    -   完了時には、各 filter の単独・複合、同時刻、および limit の matrix が承認済み検索結果を再現する。
    -   _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
    -   _Boundary: 番組検索の構造化条件・結果整形_

-   [x] 2.4 (P) 放送局ロゴの既存判定と非 cache を characterization する

    -   保存済み放送局の存在とロゴ有無を先に確認し、不存在またはロゴなしだけを not-found にする判断を `unittest/spec` で
        固定する。
    -   ロゴありではチューナーサーバー連携へ一回要求し、取得した画像をそのまま返す既存成功経路を検証する。
    -   同じ放送局を二回照会すると二回の上流要求になり、画像本体を database、filesystem、または process memory へ保存し
        ないことを `integration` で確認する。
    -   完了時には、不存在、ロゴなし、画像成功、および二回照会の各 fixture が not-found と画像結果を混同しない。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
    -   _Boundary: 放送局 query・ロゴ照会_

-   [x] 3. 既存の更新 lifecycle と確認済み不整合を分離して固定する
-   [x] 3.1 feed 開始、全件同期、再接続、および失敗中の read を characterization する

    -   初回または再接続時に放送局・番組の全件同期を一度試み、失敗しても同じ接続内で繰り返さず変更通知の受信へ進むことを
        `unittest/spec` で固定する。
    -   通信・解析失敗では切断状態へ移り、5秒刻みで最大60秒まで待ち時間を増やしながら回数無制限で再接続することを fake
        timer で検証する。
    -   更新失敗中も保存済み番組表、詳細、放送中番組、検索を鮮度期限なしで提供し、共通連番や永続 cursor を作らないことを
        確認する。
    -   完了時には、同期成功、同期失敗、通信失敗、解析失敗、および再接続の各 fixture が既存の読取継続と再接続結果を再現
        する。
    -   _Requirements: 2.1, 2.8, 2.9, 2.10, 7.2, 7.3, 7.4, 7.5_
    -   _Boundary: EPG 更新 coordinator・change feed lifecycle_

-   [x] 3.2 更新失敗中の終了済み番組削除を characterization する

    -   更新取得の成否とは独立して、設定周期で放送終了時刻を過ぎた番組を削除する既存条件を `unittest/spec` で固定する。
    -   削除成功と reject をそれぞれ待ち、reject は運用ログへ記録して最終削除時刻を更新し、取得と保存済み read を継続す
        ることを fake timer で検証する。
    -   database の retry、transaction、および接続 lifecycle は永続化機能の責務とし、この task で独自 timeout や retry
        を追加しない。
    -   完了時には、更新失敗と削除成功・失敗を組み合わせた全 fixture で read が継続し、同じ削除を即時に重ねない。
    -   _Requirements: 7.6, 7.7_
    -   _Boundary: 終了済み番組の周期削除_

-   [x] 3.3 修正前の全件同期・projection・保存不整合を characterization する

    -   全件同期10分 callback の throw と空ジャンル配列の例外を望ましい仕様テストへ混ぜず再現する。
    -   放送局全件・増分の部分 commit を一件として扱い、独立した synthetic fixture で更新結果との不一致を観測する。
    -   番組増分保存の行単位の失敗継続（個別失敗を記録し、後続を続け、成功分を commit し、更新全体は成功とする）は修正の対象
        ではなく今の契約として、承認済みの互換性の test で固定する。
    -   各 test 名と期待値で「修正前の確認済み動作」であることを明示し、target test の失敗を無視または成功へ反転させな
        い。
    -   完了時には、設計に列挙された3件の修正前挙動（全件同期の callback、空ジャンル、放送局の部分 commit）を個別に再現でき、10分観測と空ジャンルの後続 target test から区別でき
        る。
    -   _Requirements: 2.6, 2.7, 3.7, 7.9_
    -   _Boundary: 全件同期・番組 projection・保存 characterization_

-   [x] 3.4 修正前の feed・放送局索引・service buffer 不整合を characterization する

    -   放送局削除通知の保留と Mirakurun 通常終了時の接続 flag を、望ましい仕様テストへ混ぜず既存結果として再現する。
    -   service change 保存前の services 全件取得失敗が空配列へ変換され、queued service 保存自体を失敗させないこと、放送
        局全件入力欠落時の DB と索引の乖離、および放送局増分保存 reject 時の buffer 消失を synthetic fixture で固定す
        る。
    -   各 test 名と期待値で「修正前の確認済み動作」であることを明示し、owner が変更を承認していない項目を修正しない。
    -   完了時には、設計に列挙された残り5件の不整合が個別に再現でき、通常の同期・再接続 test と混同されない。
    -   _Requirements: 1.5, 7.3_
    -   _Boundary: change feed・放送局索引・service buffer characterization_

-   [x] 4. 製品非依存のチューナー連携境界を test と実装で適用する
-   [x] 4.1 製品非依存 port と有限要求の契約を仕様テストで固定する

    -   放送局全件、番組全件、service 別番組、およびロゴの取得を製品非依存 port だけから受ける契約を `unittest/spec` が
        検証する。
    -   各一回要求の取得失敗・有限 deadline 超過で更新完了を発行せず、ロゴ取得失敗を not-found へ変換しない結果を固
        定する。
    -   service ID ごとの要求へ30秒の独立 deadline を適用し、全 ID 列と後続 database 保存へ別の aggregate deadline を設
        けないことを fake timer と deferred port で検証する。
    -   Mirakurun と mirakc の合成 DTO・change から同じ保存・query 結果を得て、製品 client 型と discriminator が保存・公
        開 object に現れないことを確認する。
    -   完了時には、既存 characterization test が成功したまま、直接 client・直接 REST・製品型・不足する deadline の無い
        ことを test が確認する。
    -   _Requirements: 1.1, 2.1, 6.4, 6.6, 7.1, 7.12, 8.1, 8.2, 8.3_
    -   _Boundary: Program Guide tuner port contract_
    -   _Depends: 1.1, 1.2, 1.5, 2.4, 3.1_

-   [x] 4.2 全件・service 別・ロゴ取得を正準 tuner port へ最小移行する

    -   放送局、番組、service 別番組、およびロゴを正準 tuner port の同一 instance から取得し、製品 client package、直接
        fetch、および製品判別による route 選択を Program Guide 境界から除く。
    -   一回要求の deadline、transport cleanup、status・network・parse error の生成はチューナーサーバー連携機能へ委ね、
        本機能では結果の保存・通知・error 分類だけを維持する。
    -   ロゴの不存在・ロゴなしと upstream 取得失敗を分離し、成功時も画像を cache しない既存結果を維持する。
    -   完了時には、4.1 の全件・service 別・ロゴ target test が成功し、Program Guide から製品 client 型と直接 REST 呼出
        しがなくなる。
    -   検証は `unittest/spec`、`unittest/imp`、および tuner port stub を用いた `integration` で行う。
    -   _Requirements: 1.1, 2.1, 6.4, 6.5, 6.6, 6.7, 7.1, 7.12, 8.1, 8.2, 8.3_
    -   _Boundary: 更新管理 model・放送局 query の tuner port adapter_
    -   _Depends: 4.1_

-   [x] 4.3 change feed の契約を仕様テストで固定する

    -   製品非依存の program、service、on-air、service-programs-updated change を既存の buffer と ID 集合へ振り分ける契
        約を `unittest/spec` が検証する。
    -   feed の開始・終了結果から接続ごとの全件同期、通信・解析失敗の切断状態、および通常終了時の既存 flag 差を再現する
        期待値を固定する。
    -   frame 解析、transport cleanup、製品 route、および製品 client 型が Program Guide 境界に存在しないことを
        `integration` の port stub で検証する。
    -   完了時には、既存 characterization test が成功したまま、直接 feed 解析と製品固有 change 型が無いことを test が確認する。
    -   _Requirements: 2.3, 2.8, 2.9, 2.10, 7.2, 7.3, 8.1, 8.2, 8.3_
    -   _Boundary: Program Guide change feed contract_
    -   _Depends: 3.1, 3.4, 4.2_

-   [x] 4.4 change feed の受信を正準 change contract へ最小移行する

    -   製品非依存の program、service、on-air、service-programs-updated change を既存の buffer と ID 集合へ振り分け、製
        品 client 型、frame 解析、および transport cleanup を Program Guide から除く。
    -   feed の開始・終了結果から接続ごとの全件同期、通信・解析失敗の切断状態、および通常終了時の既存 flag 差を再現す
        る。
    -   runtime composition がチューナーサーバー連携機能の同じ instance を更新・query 境界へ渡し、Program Guide が接続
        target や製品 route を所有しないことを `integration` で確認する。
    -   完了時には、両製品の合成 change が同じ domain buffer・query 結果へ到達し、4.3 の製品非依存 target test が成功す
        る。
    -   _Requirements: 2.3, 2.8, 2.9, 2.10, 7.2, 7.3, 8.1, 8.2, 8.3_
    -   _Boundary: change feed consumer・runtime binding_
    -   _Depends: 4.3_

-   [x] 5. 周期処理と番組 projection の承認済み差分を test と実装で閉じる
-   [x] 5.1 全件同期の10分観測を仕様テストで固定する

    -   放送局全件保存後、番組全件取得の直前に600,000ミリ秒の観測を一回だけ開始する契約を `unittest/spec` が検証
        する。
    -   観測が先着しても経過を一回記録するだけで、元の取得、projection、保存、resolve、reject、取消、および close を変更
        しないことを deferred port と fake timer で検証する。
    -   遅れて resolve・reject した通常結果を一回だけ反映し、settlement まで新しい全件同期を開始せず、保留再評価があれば
        現在状態で一回だけ行う期待値を固定する。
    -   完了時には、3.3 の characterization が再現可能なまま、観測 callback の throw と active 早期解放が無いことを target test が
        確認する。
    -   _Requirements: 7.9, 7.10_
    -   _Boundary: 全件同期の10分観測_
    -   _Depends: 3.3, 4.2_

-   [x] 5.2 10分観測を記録専用へ最小修正する

    -   観測 callback からの throw を除き、同じ全件同期の通常 settlement まで active 状態と観測 timer を保持する。
    -   resolve・reject のどちらでも観測 timer を一回解除し、結果と更新通知をそれぞれ一回だけ反映する。
    -   10分値を公開設定へ追加せず、service 別取得列、増分保存、および終了済み番組削除へ同じ観測を拡張しない。
    -   完了時には、5.1 の target test と既存の全件同期 test が成功し、10分経過だけでは元処理の終了、取消、新規同期開始
        が観測されない。
    -   検証は `unittest/spec` と fake timer を用いた `unittest/imp` で行う。
    -   _Requirements: 7.9, 7.10, 7.15_
    -   _Boundary: 全件同期の10分観測_
    -   _Depends: 5.1_

-   [x] 5.3 周期処理の active 一件・pending 一件を仕様テストで固定する

    -   10秒 tick が active 中に複数回発火しても後続処理を開始せず、保留再評価を最大一件だけ記録する契約を
        `unittest/spec` が検証する。
    -   program 保存、service 別番組更新、終了済み番組削除、および切断時全件同期を個別に未確定にし、各処理の通常
        settlement まで active 一件を維持することを検証する。
    -   settlement 後は過去の tick 時刻を使わず、現在時刻と feed 状態で一回だけ再評価し、その再評価中の tick も pending
        一件へ合流する期待値を固定する。
    -   Mirakurun の service→program、mirakc の on-air→deferred、および削除判定の既存順序と更新通知時点を変えないことも
        同じ matrix で確認する。
    -   完了時には、既存 characterization test が成功したまま、重複開始と未完了処理を待たない箇所が無いことを test が確認する。
    -   _Requirements: 2.4, 2.5, 2.6, 2.7, 7.8, 7.10, 7.14, 7.15_
    -   _Boundary: EPG 更新 coordinator・周期 single-flight_
    -   _Depends: 1.4, 1.5, 3.2, 5.2_

-   [x] 5.4 周期処理を active 一件・pending 一件へ最小直列化する

    -   interval callback は再評価要求だけを作り、idle 時だけ一つの周期処理を開始し、active 時は boolean 相当の pending
        を一件だけ保持する。
    -   接続中の増分更新、切断時の全件同期、および終了済み番組削除を承認済み順序で await し、各 database Promise へ人工
        timeout、cancel race、または独自 retry を追加しない。
    -   mirakc の deferred 更新通知は保存開始後・完了前の既存時点を保つ一方、保存 Promise の settlement までは次の周期処
        理を重ねない。
    -   完了時には、5.3 の target test が成功し、任意回数の active 中 tick で実行中一件、保留一件、重複 REST・DB 呼出し
        0件が観測できる。
    -   検証は fake timer と deferred port を用いた `unittest/spec`、`unittest/imp`、および `integration` で行う。
    -   _Requirements: 2.4, 2.5, 2.6, 2.7, 7.8, 7.10, 7.13, 7.14, 7.15_
    -   _Boundary: EPG 更新 coordinator・周期 single-flight_
    -   _Depends: 5.3_

-   [x] 5.5 (P) 空ジャンル配列をジャンルなしとして扱う

    -   ジャンル欠落、空配列、一件、三件、四件以上、および標準範囲外を入力する `unittest/spec` が、空配列で
        例外にならないことを検証する。
    -   存在する入力要素だけを先頭から最大3件投影し、空配列を全 slot 未設定として扱う。
    -   ジャンルの順序、保存上限、および公開 field を変更せず、複数ジャンルを無制限保存する新しい schema を追加しない。
    -   完了時には、空配列が例外にならずジャンルなしとして保存され、他の正常 fixture と3.3の修正前 fixtureを明確に区別で
        きる。
    -   検証は `unittest/spec` と `unittest/imp` で行う。
    -   _Requirements: 3.7_
    -   _Boundary: 番組 projection・genre slot_
    -   _Depends: 1.3, 3.3_

-   [x] 6. owner 境界を越える契約を統合検証する
-   [x] 6.1 全件同期と feed lifecycle を両 tuner 製品の合成入力で統合検証する

    -   両製品の合成 service、program、feed 開始・終了、および取得 error を正準 tuner port から与え、全件保存と更新
        outcome を `integration` で比較する。
    -   初回・再接続・切断時の全件同期、同期失敗後の feed 継続、および保存済み read を発火から結果まで追跡する。
    -   一回要求 deadline、10分観測、遅延した通常結果、および再接続 backoff を一つの deterministic clock で検証する。
    -   完了時には、両製品 matrix が同じ全件保存・query 結果を返し、製品 discriminator、実 URL、実番組、および実ロゴを
        test artifact に含めない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.8, 2.9, 2.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 8.1, 8.2,
        8.3_
    -   _Boundary: Program Guide full-sync・feed integration_
    -   _Depends: 4.4, 5.2_

-   [x] 6.2 増分・service 別更新と周期削除を統合検証する

    -   program change、service change、on-air、および deferred change を正準 tuner port から与え、buffer・ID集合から保
        存結果までを `integration` で追跡する。
    -   短周期・設定周期、service ID ごとの30秒 deadline、集合全体の一括保存、失敗時の全 ID 残存、および deferred の通知
        時点を deterministic clock で検証する。
    -   未完了の増分保存、service 別更新、および終了済み削除へ後続周期を重ねず、settlement 後に現在状態で一回だけ再評価
        することを確認する。
    -   完了時には、成功、取得失敗、保存失敗、削除失敗、および active 中の複数 tick で、重複処理0件と承認済みの通知結果
        が観測できる。
    -   _Requirements: 1.4, 1.5, 2.3, 2.4, 2.5, 2.6, 2.7, 7.6, 7.7, 7.8, 7.11, 7.12, 7.13, 7.14, 7.15, 8.1, 8.2, 8.3_
    -   _Boundary: Program Guide incremental-update integration_
    -   _Depends: 4.4, 5.4_

-   [x] 6.3 (P) 保存 projection と read/query を SQLite・MySQL で統合検証する

    -   合成放送局・番組を保存し、通常・半角・短縮表記、説明、詳細、最大3件のジャンル、映像、主音声を両 database から同
        じdomain projection として読めることを `integration` で確認する。
    -   番組表の両端包含、詳細の存在・不存在、放送中の両端包含、および検索条件・開始時刻順・件数上限を database 能力別の
        期待値で検証する。
    -   同じ開始時刻へ追加の安定順序を要求せず、正規表現非対応時は通常検索 fallback を維持する。
    -   完了時には、両 database suite が承認済みの保存・query 契約を再現し、driver、transaction、migration の実装を本
        spec へ重複させない。
    -   _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7,
        4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
    -   _Boundary: Program Guide persistence/query integration_
    -   _Depends: 1.2, 1.3, 2.1, 2.2, 2.3, 5.5_

-   [x] 6.4 更新 outcome、ロゴ、および公開 carrier の互換契約を統合検証する

    -   保存成功・失敗から更新 outcome までを追跡し、成功時点までに確定した情報だけを downstream から読めることを
        `integration` で確認する。
    -   放送局一覧、番組表、番組詳細、放送中、検索、およびロゴについて、既存 route、status、content type、field key、
        optional field、および error projection を contract fixture と比較する。
    -   ロゴの不存在・ロゴなしを既存 not-found へ、network・status・parse・timeout を既存 server error へ投影し、画像本
        体と upstream error body を保存または新規 logging しない。
    -   完了時には、Requirements 1から8の71 ACについて、Program Guide 固有の `unittest/spec`、`unittest/imp`、
        characterization、および `integration` が共有server test rootから選択可能となり、Requirement 9の5品質caseをTask
        7.1から7.5へ引き渡せる。
    -   _Requirements: 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9,
        5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 8.1, 8.2, 8.3_
    -   _Boundary: 更新 outcome adapter・Program Guide public contract integration_
    -   _Depends: 6.1, 6.2, 6.3_

-   [x] 7. Program Guide固有testの品質判定を満たす
-   [x] 7.1 全76 ACの機能固有Test Matrixと`unittest/spec`を完成させる

    -   Designの唯一の機能固有Test Matrixにある`PG-S-001`から`PG-S-072`だけを
        `test/server/program-guide/program-guide.spec.test.ts`のnamed caseへ一意に対応付ける。`PG-I-073`、
        `PG-I-074`、`PG-X-075`、`PG-G-076`はTest MatrixからそれぞれTasks 7.2、7.3、7.4、7.5の固有test種別とDesignの配置表のfile
        へ排他的に接続し、`unittest/spec`へ重複配置しない。
    -   Requirements 1から8の71 ACについて、放送局・番組更新、保存結果、番組表・詳細・放送中・検索、ロゴ、失敗中のread継
        続、Mirakurun・mirakcの共通結果を外部契約として検証する。Requirement 9の5 ACは各品質leaf自身の合否条件へ対応させ
        る。
    -   8件の確認済み不整合は`characterization.test.ts`へ分離し、望ましいcontractの成功caseへ混ぜず、不一致分類なしに製
        品契約として固定しない。
    -   完了時には、`PG-S-001`から`PG-S-072`を成功したspec caseから逆引きでき、残る4品質ACは一意な後続leafと配置表のfileへ割
        り当て済みで、全76 ACの未割当、test種別間の重複主test、根拠のないskip、およびcharacterizationのcontract混入が0件
        である。
    -   _Depends: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.2, 4.4, 5.2, 5.4, 5.5, 6.4_
    -   _Requirements: 9.1_

-   [x] 7.2 projection・検索・buffer・service集合の値域と分岐を`unittest/imp`で完成させる

    -   `program-guide-internals.test.ts`、`update-manager.test.ts`、`projection.test.ts`で、`null`、空、0、1、最小、最
        大、範囲外、不正型、重複を、中心番組、変更buffer、開始時service ID集合、番組field、genre・video・main audio、通
        常・半角・短縮文字へ対象別に割り当てる。
    -   `query.integration.test.ts`と補完する内部testで、番組表・放送中の両端包含、keyword結合、除外、regexp対応・
        fallback、channel ID優先、genre・曜日・時間・free・duration、sort、同時刻非保証、limit、およびSQLite・MySQL差を
        分岐表どおりassertする。
    -   program changeのcreate・update・remove・redefine順列、保存失敗時の所有batch復元、新着changeとの順序、service
        snapshot全ID残存、0 ID、prefix失敗、およびDB call回数を検証する。
    -   8件の既知不整合は`characterization.test.ts`で修正前事実として分類し、目標contract、未解決のimplementation
        defect、または成功証拠へ読み替えない。
    -   完了時には、Designの入力値域と`MB`・`MP`・`MQ`・`MT`対象分岐に未分類がなく、各値・分岐を対応assertionから逆引き
        できる。
    -   _Depends: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 5.5, 6.3, 7.1_
    -   _Requirements: 9.2_

-   [x] 7.3 lifecycle・状態・時間race・資源matrixを全suiteへ割り当てる

    -   `program-guide-lifecycle.test.ts`と`update-coordinator.test.ts`で、初回同期、変更取得、再接続、増分保存、周期処
        理の開始前・進行中・成功・失敗・再入・restartを分類する。cancelは本機能が所有しないため非適用とし、10分観測を取
        消やfailure確定へ読み替えない。
    -   10秒tick、5分threshold、設定周期、1.5倍の切断時同期、5秒から60秒のbackoff、service別30秒deadline、全件同期10分
        observer、late resolve・reject、同着、重複tick、変更buffer・service集合とのraceをfake clockとdeferred portへ割り
        当てる。
    -   active一件・pending一件、保存中の新着change、期限後のREST・DB結果、settlement後の現在状態による一回再評価、更新
        outcome一回をcall ledgerで観測する。
    -   timer、listener、stream、Buffer、service ID集合、DB transaction・connectionを取得前から成功・失敗・終了まで追跡
        し、timer解除、listener除去、stream終了、DB資源解放、およびteardown後の残留handleを確認する。raw transport資源は
        tuner ownerの証拠を消費する。
    -   完了時には、matrixの各項目に主case、補助caseまたは非適用理由があり、
        未分類項目が0件である。
    -   _Depends: 3.1, 3.2, 3.3, 3.4, 5.2, 5.4, 6.1, 6.2, 7.1, 7.2_
    -   _Requirements: 9.3_

-   [x] 7.4 tuner provider・永続化・ロゴ・公開API・process結果の結合境界を検証する

    -   `program-guide-boundaries.integration.test.ts`を中心に、`tuner-compatibility.integration.test.ts`、
        `query.integration.test.ts`、`logo.integration.test.ts`、`public-api.contract.test.ts`を接続し、両製品の合成
        service・program・change・logoから同じ保存・query・公開結果を検証する。
    -   SQLiteとMySQLの実driver境界では、保存projection、番組表・詳細・放送中・検索、成功・reject後のrow集合、および
        connection・transaction解放をbackend別期待値で観測する。driver、Migration、共通retryは`server-persistence`の実装
        と証拠を利用し、本specへ重複実装しない。
    -   logo境界では保存済みchannelの不存在・logo false・Buffer成功・network/status/parse/timeoutを分離し、二回要求が二
        回のprovider callとなり、画像本体をDB、filesystem、またはprocess memoryへcacheしないことを確認する。
    -   公開HTTP adapterでは既存route、status、content type、field key、optional field、error projectionを確認する。
        `EPGUpdateExecutorManageModel`の親側message処理と更新childの`process.send({ msg: 'updated' })`を合成IPCで接続
        し、保存成功後の親結果とerror時通知0件を確認する。
    -   raw tuner transport、公開routeのcarrier、processの起動・再起動・signal、filesystemは各owner責務または本機能の直
        接port外として非適用理由を記録する。合成IPCはprocess result contractの検証であり、runtime lifecycleの成功証拠へ
        読み替えない。
    -   完了時には、tuner provider、SQLite・MySQL、logo、HTTP adapter、親IPC結果の成功・失敗・cleanupを接続でき、非適用
        境界を含む結合matrixの未分類が0件である。
    -   _Depends: 4.4, 6.1, 6.2, 6.3, 6.4, 7.3_
    -   _Requirements: 9.4_

-   [x] 7.5 本機能の品質判定を満たす

    -   Task 7.1から7.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 7.1, 7.2, 7.3, 7.4_
    -   _Requirements: 9.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                             | Test type                                          | Local Depends                                                                                   | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                                                                                                                                        |
| 1.2  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-manager.test.ts`<br>`test/server/program-guide/projection.test.ts`                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/projection.test.ts`                                                                                                                                                                                                                                                           |
| 1.3  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/projection.test.ts`                                                                                                                                                                                                                    | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/projection.test.ts`                                                                                                                                                                                                                                                                                                                                            |
| 1.4  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                                                                                                                                        |
| 1.5  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`                                                                                                                                                                                                                                                                                                                                        |
| 2.1  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/query.integration.test.ts`                                                                                                                                              | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`                                                                                                                                                                                                                                   |
| 2.2  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/query.integration.test.ts`                                                                                                                                              | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`                                                                                                                                                                                                                                   |
| 2.3  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/query.integration.test.ts`                                                                                                                                              | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`                                                                                                                                                                                                                                   |
| 2.4  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/logo.integration.test.ts`                                                                                                                                                                                                              | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/logo.integration.test.ts`                                                                                                                                                                                                                                                                                                                              |
| 3.1  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-lifecycle.test.ts`                                                                                                                                                                                                       | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                               |
| 3.2  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                                                                                                                                                    |
| 3.3  | `test/server/program-guide/characterization.test.ts`                                                                                                                                                                                                                                                                        | `unittest/imp`                                     | なし（共有foundationのみ）                                                                      | `npm run test:server:imp -- test/server/program-guide/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3.4  | `test/server/program-guide/characterization.test.ts`                                                                                                                                                                                                                                                                        | `unittest/imp`                                     | なし（共有foundationのみ）                                                                      | `npm run test:server:imp -- test/server/program-guide/characterization.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4.1  | `test/server/program-guide/program-guide.spec.test.ts`                                                                                                                                                                                                                                                                      | `unittest/spec`                                    | `1.1, 1.2, 1.5, 2.4, 3.1`                                                                       | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4.2  | `src/model/epgUpdater/EPGUpdateManageModel.ts`<br>`src/model/api/channel/ChannelApiModel.ts`<br>`test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-manager.test.ts`<br>`test/server/program-guide/tuner-compatibility.integration.test.ts`                                         | `unittest/spec`<br>`unittest/imp`<br>`integration` | `4.1`                                                                                           | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                                              |
| 4.3  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                               | `unittest/spec`<br>`integration`                   | `3.1, 3.4, 4.2`                                                                                 | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                                                                                                                               |
| 4.4  | `src/model/epgUpdater/EPGUpdateManageModel.ts`<br>`test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                       | `integration`                                      | `4.3`                                                                                           | `npm run test:server:integration -- test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5.1  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | `3.3, 4.2`                                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                                                                                                                                                    |
| 5.2  | `src/model/epgUpdater/EPGUpdateManageModel.ts`<br>`test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                          | `unittest/spec`<br>`unittest/imp`                  | `5.1`                                                                                           | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                                                                                                                                                    |
| 5.3  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | `1.4, 1.5, 3.2, 5.2`                                                                            | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                                                                                                                                                    |
| 5.4  | `src/model/epgUpdater/EPGUpdater.ts`<br>`test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`<br>`test/server/program-guide/program-guide-boundaries.integration.test.ts`                                                                                        | `unittest/spec`<br>`unittest/imp`<br>`integration` | `5.3`                                                                                           | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/program-guide-boundaries.integration.test.ts`                                                                                                                                                                                                                     |
| 5.5  | `src/model/db/ProgramDB.ts`<br>`test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/projection.test.ts`                                                                                                                                                                                     | `unittest/spec`<br>`unittest/imp`                  | `1.3, 3.3`                                                                                      | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/projection.test.ts`                                                                                                                                                                                                                                                                                                                                            |
| 6.1  | `test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                                                                         | `integration`                                      | `4.4, 5.2`                                                                                      | `npm run test:server:integration -- test/server/program-guide/tuner-compatibility.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6.2  | `test/server/program-guide/program-guide-boundaries.integration.test.ts`                                                                                                                                                                                                                                                    | `integration`                                      | `4.4, 5.4`                                                                                      | `npm run test:server:integration -- test/server/program-guide/program-guide-boundaries.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                |
| 6.3  | `test/server/program-guide/query.integration.test.ts`                                                                                                                                                                                                                                                                       | `integration`                                      | `1.2, 1.3, 2.1, 2.2, 2.3, 5.5`                                                                  | `npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6.4  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/logo.integration.test.ts`<br>`test/server/program-guide/public-api.contract.test.ts`<br>`test/server/program-guide/program-guide-boundaries.integration.test.ts`        | `unittest/spec`<br>`unittest/imp`<br>`integration` | `6.1, 6.2, 6.3`                                                                                 | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/logo.integration.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/public-api.contract.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/program-guide-boundaries.integration.test.ts`                       |
| 7.1  | `test/server/program-guide/program-guide.spec.test.ts`                                                                                                                                                                                                                                                                      | `unittest/spec`                                    | `1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.2, 4.4, 5.2, 5.4, 5.5, 6.4` | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7.2  | `test/server/program-guide/update-manager.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`<br>`test/server/program-guide/projection.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/query.integration.test.ts`                                      | `unittest/imp`<br>`integration`                    | `1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 5.5, 6.3, 7.1`                                              | `npm run test:server:imp -- test/server/program-guide/update-manager.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/projection.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`                                                                      |
| 7.3  | `test/server/program-guide/program-guide-lifecycle.test.ts`<br>`test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                       | `unittest/imp`                                     | `3.1, 3.2, 3.3, 3.4, 5.2, 5.4, 6.1, 6.2, 7.1, 7.2`                                              | `npm run test:server:imp -- test/server/program-guide/program-guide-lifecycle.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/update-coordinator.test.ts`                                                                                                                                                                                                                                                                                                                                |
| 7.4  | `test/server/program-guide/program-guide-boundaries.integration.test.ts`<br>`test/server/program-guide/tuner-compatibility.integration.test.ts`<br>`test/server/program-guide/query.integration.test.ts`<br>`test/server/program-guide/logo.integration.test.ts`<br>`test/server/program-guide/public-api.contract.test.ts` | `integration`                                      | `4.4, 6.1, 6.2, 6.3, 6.4, 7.3`                                                                  | `npm run test:server:integration -- test/server/program-guide/program-guide-boundaries.integration.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/tuner-compatibility.integration.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/query.integration.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/logo.integration.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/public-api.contract.test.ts` |
| 7.5  | `test/server/program-guide/program-guide.spec.test.ts`<br>`test/server/program-guide/program-guide-internals.test.ts`<br>`test/server/program-guide/program-guide-boundaries.integration.test.ts` | `unittest/spec`<br>`unittest/imp`<br>`integration` | `7.1, 7.2, 7.3, 7.4`                                                                            | `npm run test:server:spec -- test/server/program-guide/program-guide.spec.test.ts`<br>`npm run test:server:imp -- test/server/program-guide/program-guide-internals.test.ts`<br>`npm run test:server:integration -- test/server/program-guide/program-guide-boundaries.integration.test.ts` |
