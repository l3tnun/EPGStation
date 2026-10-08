# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 runner、compile 境界、coverage command を重複させず、管理ツール固有の fixture、
test、および承認済み差分の結合検証だけを追加する。

管理コマンドが読む DB 設定と encode 方法 snapshot は `server-configuration`、repository と種類内 transaction は
`server-persistence`、移送する予約・自動予約ルール・録画済み番組・サムネイルの意味はそれぞれ
`server-reservation-management`、`server-reservation-rules`、`server-recorded-content`、 `server-thumbnail-management`
が所有する。これら各 spec の該当 task group が提供する契約と機能固有 test を実行前提とし、本 spec は設定読込、domain 判
断、DB schema、repository、thumbnail file 処理を重複実装しない。

DB 接続 lifecycle、種類内 transaction、migration、および repository retry は `server-persistence` が所有する。復元
transaction の開始失敗を含む全経路 release、active 時だけの rollback、raw database error と cleanup error の分離、および
従来の `restore error` 維持は、`server-persistence` の target test と最小修正が完了した後に本 spec から結合検証する。本
spec は同じ production 修正を重複実装しない。

Rule、Reserve、Recorded、Thumbnail、VideoFile、DropLogFile、RecordedHistory、RecordedTag の業務上の意味は各 domain owner
に残す。本 spec は版番号を持たない JSON、管理 CLI、処理順序、v1 変換、および管理時 DB 利用待ちだけを所有する。
backup、restore、v1 migration の DB 利用待ちは従来どおり無期限とし、timeout、試行上限、自動停止、排他、version
envelope、checksum、全種類 transaction、retry、path 長上限を追加しない。Windows service command は script 名だけを維持
し、動作保証または Windows runtime test を追加しない。

-   [x] 1. 管理コマンドの受付、待機、および終了契約を固定する
-   [x] 1.1 既存 CLI と入力検査を characterization する

    -   既存実装分類 A として、`backup`、`restore`、`v1migrate` の既存 command、short / long alias、入力元・出力先の受
        付、および余分な引数の既存取扱いを `unittest/spec` と compiled process test で固定する。
    -   mode、入力元、または出力先の未指定・空文字と未対応 mode は、logger 初期化、file 操作、DB 確認を開始せず既存
        message と終了状態 1 を返すことを spy で確認する。
    -   `install-win-service` と `uninstall-win-service` は `package.json` の script 名の確認（レビュー）だけで扱い、
        Windows 上の起動、終了 code、service lifecycle を成功条件にしない。
    -   完了時には、三つの管理 command の正常な受付と入力不正 matrix が既存 CLI surface を再現し、二つの Windows command
        名が残り、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.6, 6.1, 6.2, 6.3_
    -   _Boundary: Management CLI adapter_
    -   _Verification: unittest/spec, unittest/imp, compiled process_

-   [x] 1.2 (P) DB 利用可能性を無期限に待つ既存契約を characterization する

    -   既存実装分類 A として、最初の接続確認を直ちに開始し、失敗後だけ 1,000 ms 待って新しい確認を始め、任意回数後の成
        功で対象 operation を一度だけ開始することを fake sleep で固定する。
    -   一回の接続確認を長時間相当 pending にしても、独自 timeout、次の probe、sleep、operation、finish が始まらないこと
        を `unittest/imp` で確認する。
    -   総試行回数と総待機時間にも上限を設けず、通常稼働 process への停止要求、signal、maintenance lock を管理 command
        自身が発行しないことを否定検証する。
    -   完了時には、即時成功、複数失敗後成功、長期 pending の各系列で 1 秒 cadence と operation barrier が観測でき、有限
        deadline を持つ production code が追加されていない。
    -   _Requirements: 5.1, 5.2, 5.3_
    -   _Boundary: Management DB availability wait_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 1.3 進行記録、DB close、および process 結果を characterization する

    -   既存実装分類 A として、各 operation の開始、種類別 stage、書出しまたは復元、DB close、`finish` の相対順を
        `unittest/spec` で固定する。
    -   success path は `closeConnection()` 完了より前に `finish` または終了状態 0 を返さず、close failure では成功状態
        へ進まないことを barrier で確認する。
    -   input、file、変換、repository、write の各 failure は後続 stage、`finish`、終了状態 0 を発生させず、failure 後の
        共通 close を新しい期待値にしない。
    -   fixture の内容、credential、接続先、実 media path が stdout、stderr、logger、assertion failure へ出ないことを検
        証する。ただし JSON 解析 error の標準 message に入る入力の断片は対象外とする。
    -   完了時には、operation ごとの進行順、成功 0、失敗 1、close barrier、および failure 後の非継続が自動 test から観測
        できる。
    -   _Requirements: 5.4, 5.5, 5.6_
    -   _Boundary: Progress and process result adapter_
    -   _Verification: unittest/spec, unittest/imp, compiled process_
    -   _Depends: 1.1_

-   [x] 2. 版番号を持たない管理情報バックアップを固定する
-   [x] 2.1 8 種類の読出しと進行順を characterization する

    -   既存実装分類 A として、自動予約ルール、録画予約、ドロップログ、録画済み番組、サムネイル、録画ファイル、録画履
        歴、録画済み番組タグを設計の固定順で一件ずつ await することを `unittest/spec` で固定する。
    -   Rule は更新回数を含み、Recorded は video、thumbnail、drop log、tag relation を join しない通常表記で取得すること
        を synthetic repository fixture で確認する。
    -   8 read を一つの snapshot、transaction、lock へ統合せず、途中 read failure では後続 read と出力 write を開始しな
        いことを検証する。
    -   完了時には、8 repository の呼出順、引数、await barrier、途中失敗位置、および進行 label が既存契約どおり観測で
        き、production code の差分がない。
    -   _Requirements: 2.1, 5.4, 5.6_
    -   _Boundary: Backup coordinator―repository read order_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 1.3_

-   [x] 2.2 版なし JSON wire と同期 direct write を characterization する

    -   既存実装分類 A として、8 collection の exact root key と emission order を typed synthetic fixture で固定し、
        version、format ID、indent、trailing newline がない compact JSON を確認する。
    -   指定 path へ UTF-8 で同期 direct write し、既存 file を直接置換することを fake filesystem で検証する。
    -   write failure で出力が空または途中内容になり得る既存特性を再現し、temporary file、fsync、atomic rename、旧 file
        復元、checksum を期待値にしない。
    -   完了時には、期待 byte 列、encoding、単一 write 対象、および write failure 後の非原子的結果が再現され、production
        code の差分がない。
    -   _Requirements: 2.2, 5.6_
    -   _Boundary: Backup coordinator―Synchronous JSON file adapter_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 2.1_

-   [x] 2.3 関連情報、実ファイル、および設定の除外を characterization する

    -   録画済み番組とタグ本体を含める一方、多対多の関連付けを backup root と collection row へ追加しないことを
        `unittest/spec` で固定する。
    -   録画映像、サムネイル画像、ドロップログ実 file、および server 設定 file への read、copy、move、delete が 0 件であ
        ることを filesystem spy で確認する。
    -   新しい domain collection、version metadata、設定 snapshot を自動追加せず、固定 8 collection だけを出力することを
        exact key assertion で検証する。
    -   完了時には、含める管理情報と除外する relation・実体・設定が一意に区別され、対象外 file への副作用 0 件が観測でき
        る。
    -   _Requirements: 2.3, 2.4, 2.5_
    -   _Boundary: Backup document projection・filesystem exclusion_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 2.2_

-   [x] 3. 管理情報復元の段階順と失敗境界を固定する
-   [x] 3.1 復元入力の読取と段階的な入力解釈を characterization する

    -   既存実装分類 A として、DB 利用待ち成功後に指定 file を UTF-8 で同期 read し、`JSON.parse()` の結果を復元へ渡すこ
        とを `unittest/spec` で固定する。
    -   file 不在、read failure、parse failure では最初の repository mutation を開始せず、既存の出力と終了状態 1 を返す
        ことを検証する。
    -   JSON として解釈後に 8 collection、row field、ID relation、重複 ID を一括事前検査せず、extra root field は参照せ
        ず、不足・不正値は到達 stage で失敗し得る既存特性を分離して確認する。
    -   完了時には、正常入力、三つの file failure、および JSON として有効だが後段不正な入力の mutation 開始位置が既存順
        序どおり観測でき、production code の差分がない。
    -   _Requirements: 3.1, 3.2, 5.1, 5.6_
    -   _Boundary: Restore coordinator―Synchronous JSON file adapter_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 1.2, 1.3_

-   [x] 3.2 8 種類の置換順、部分確定、および除外範囲を characterization する

    -   ルール、予約、ドロップログ、録画済み番組、サムネイル、録画ファイル、録画履歴、録画済み番組タグの順に種類別
        replace port を await することを `unittest/spec` と `integration` で固定する。
    -   各 stage の保存済み row が入力 collection へ置換され、drop log と recorded stage の dependent-clear order 後に
        thumbnail と video file が再構成されることを確認する。
    -   任意 stage の失敗後は後続 stage を開始せず、前段の確定済み row を operation 全体として rollback しないことを全 8
        failure point で検証する。
    -   tag 本体は復元する一方で Recorded と Tag の join relation、および録画映像、画像、drop log 実 file は復元しないこ
        とを確認する。
    -   完了時には、全 8 stage の順序、種類別置換、各失敗位置の残存 row、後続非開始、および実 file 副作用 0 件が観測でき
        る。
    -   _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 5.4, 5.6_
    -   _Boundary: Restore coordinator―Metadata repository ports_
    -   _Verification: unittest/spec, unittest/imp, SQLite/MySQL integration_
    -   _Depends: 3.1_

-   [x] 3.3 復元 transaction の失敗後処理を管理コマンド経由で結合検証する

    -   既存実装分類 B である transaction lifecycle の production 修正は `server-persistence` に残し、その target test
        と最小修正が完了した状態を実行前提とする。
    -   管理 CLI から transaction 開始失敗と cleanup failure を注入する target integration test を先に追加し、開始失敗後
        の rollback または未解放 resource が承認済み契約と異なる理由で RED になることを確認する。Persistence owner の最
        小修正と本機能の fault-injection harness だけを適用し、同じ target test を GREEN にする。
    -   全 8 restore port について transaction 開始、mutation、commit、rollback、release の failure を注入し、開始失敗で
        は rollback せず、active な failure だけを rollback し、全経路で release 完了後に coordinator が settle すること
        を管理 CLI から確認する。
    -   raw database error と rollback / release error を内部診断で分離し、組合せにかかわらず管理者には従来の
        `restore error` だけを返し、後続 stage を開始しないことを検証する。
    -   commit 後の release failure では当該 stage が確定済みのまま command が失敗し、前段を全体 rollback しないことを確
        認する。
    -   完了時には、全 failure point の row 効果、rollback / release 回数、診断分離、管理者向け message、および後続非開
        始が承認済み契約へ一致し、本 spec に重複 production 修正がない。
    -   _Requirements: 3.8, 3.7, 5.6_
    -   _Boundary: Restore coordinator―Persistence restore lifecycle integration_
    -   _Verification: unittest/spec, SQLite/MySQL integration, fault injection_
    -   _Depends: 3.2_

-   [x] 4. v1 バックアップ変換と追加順を固定する
-   [x] 4.1 v1 入力、最終 schema 前提、および読取順を characterization する

    -   既存実装分類 A として、最終 v1 database 構造から作成した synthetic backup を入力 fixture とし、指定 path を同期
        read して JSON として解釈することを固定する。
    -   file 不在、read failure、parse failure は DB availability probe と row insert を開始せず終了状態 1 を返すことを
        `unittest/spec` で確認する。
    -   `dbRevisionInfo` を runtime 受入判定に使わず、version allowlist、schema preflight、upgrade registry を追加しない
        既存境界を characterization する。
    -   空の録画済み配列と非文字列の先頭保存先名は別 fixture とし、非文字列時の error 記録だけを fail-fast 成功保証へ読
        み替えない。
    -   完了時には、正常な最終 v1 fixture、三つの入力 failure、および二つの既知入力特性が DB 開始前の既存順序で観測で
        き、production code の差分がない。
    -   _Requirements: 4.1, 4.2, 4.3, 5.6_
    -   _Boundary: v1 migration coordinator―Synchronous JSON file adapter_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 1.1_

-   [x] 4.2 v1 自動予約ルール変換と旧新 ID 対応を characterization する

    -   keyword、除外 keyword、検索 flag、放送波、放送局、genre、曜日時刻、無料条件、時間条件、予約条件、保存条件を
        nullable branch ごとに `unittest/spec` で固定する。
    -   最大 3 組の encode index、保存先、元 file 削除指定を既存設定 snapshot から変換し、対応 encode index がない場合は
        fallback せず失敗することを確認する。
    -   rule を一件ずつ追加し、各旧 ID を返された新 ID へ process 内だけで対応付け、永続 index、retry、重複防止 key を追
        加しないことを検証する。
    -   完了時には、全 nullable branch、3 encode slot、invalid index、旧新 ID 対応が synthetic fixture から再現され、
        production code の差分がない。
    -   _Requirements: 4.4_
    -   _Boundary: v1 converter set―Rule mapping_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 4.1_

-   [x] 4.3 v1 録画済み番組変換と状態・除外項目を characterization する

    -   旧 rule ID が対応表にある場合だけ新 ID を関連付け、正の program ID と手動予約、放送局、時刻、名称、説明、genre、
        video / audio 情報を既存規則で射影する。
    -   録画中ではなく未保護として登録し、音声 sampling rate、未変換の詳細、log 位置、error / drop / scrambling 件数、一
        時録画状態を移行しないことを `unittest/spec` で確認する。
    -   `extended` 原文を `extended` に保持し、半角化した値を `halfWidthExtended` に設定する（`description` と同じ写像）。
    -   録画済み番組を一件ずつ追加し、各旧 ID を新 ID に対応付ける一方、対応しない旧 rule ID は未関連のままとする。
    -   完了時には、通常・手動・rule 不明・nullable・除外 field・extended の二 field の各結果が仕様どおりに再現される。
    -   _Requirements: 4.5, 4.9, 4.10_
    -   _Boundary: v1 converter set―Recorded mapping_
    -   _Verification: unittest/spec, unittest/imp_
    -   _Depends: 4.2_

-   [x] 4.4 関連管理情報、録画履歴、および非移行対象を characterization する

    -   thumbnail、元録画 file、encode 済み file の管理情報を新 recorded ID へ関連付け、path は metadata として登録する
        だけで実 file を copy、move、delete しないことを検証する。
    -   元録画 file の型・表示名・親保存先、encoded file の型・名称・親保存先、および size の null から 0 への既存変換を
        `unittest/imp` で固定する。
    -   encoded item の旧 recorded ID に対応がない場合は追加せず失敗し、録画履歴は名称、放送局 ID、終了時刻を一件ずつ追
        加することを確認する。
    -   v1 の予約情報と drop 情報を repository へ渡さず、録画映像と画像の filesystem operation が 0 件であることを否定検
        証する。
    -   完了時には、新 recorded ID への全関連、履歴 row、対応なし failure、非移行 repository 0 call、および実 file 副作
        用 0 件が観測できる。
    -   _Requirements: 4.6, 4.7, 4.8, 4.11_
    -   _Boundary: v1 converter set―Related metadata and history mapping_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 4.3_

-   [x] 4.5 v1 の固定追加順、部分確定、および再実行特性を characterization する

    -   rules、recorded と thumbnail / original file、encoded file、recorded history の順に一件ずつ追加することを
        `integration` call trace で固定する。
    -   各種類の先頭・中間・末尾 failure を注入し、後続を開始せず、それ以前に追加済みの row を migration 全体として
        rollback しないことを確認する。
    -   同じ入力の再実行で既処理分を識別せず重複登録し得る既存特性を隔離 fixture で再現し、checkpoint、resume、
        idempotency key、whole-operation retry を期待値にしない。
    -   完了時には、固定 stage 順、全 failure point の残存 row、後続非開始、および再実行時の既存重複特性が SQLite と
        MySQL の synthetic data で観測できる。
    -   _Requirements: 4.4, 4.5, 4.6, 4.7, 4.12, 4.13, 5.4, 5.6_
    -   _Boundary: v1 migration coordinator―Ordered row insertion_
    -   _Verification: unittest/spec, SQLite/MySQL integration, fault injection_
    -   _Depends: 4.2, 4.3, 4.4_

-   [x] 5. backend と compiled process の管理ツール回帰 matrix を閉じる
-   [x] 5.1 (P) SQLite で backup、restore、v1 migration を結合検証する

    -   test ごとの一時 database に 8 collection と最終 v1 fixture を seed し、backup wire、restore 後 row、および v1 追
        加 row を同じ backend で検証する。
    -   restore の全 stage と transaction failure、v1 の全追加 failure、DB pending / failure / eventual success を
        deterministic に注入し、無期限待ちは harness 側で観測後に process を終了する。
    -   実 database、実設定、実 media file、実 endpoint を使わず、relation と実 file の除外、部分確定、進行順、終了状態
        を確認する。
    -   完了時には、SQLite 固有 suite が 40 acceptance criteria の該当 trace を再現し、A 分類の production code に差分が
        なく、B 分類の production 差分が `server-persistence` owner だけに限定されている。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1,
        4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    -   _Boundary: SQLite management-tools integration_
    -   _Verification: SQLite integration, fault injection_
    -   _Depends: 3.3, 4.5_

-   [x] 5.2 (P) MySQL で backup、restore、v1 migration を結合検証する

    -   隔離 schema に 8 collection と最終 v1 fixture を seed し、SQLite と同じ管理 command contract を backend 固有の
        row 結果で検証する。
    -   restore transaction の全 failure point と v1 の部分追加を注入し、driver error を管理者向け message へ漏らさず、
        種類別 transaction と行別追加を一つの全体 transaction へ統合しないことを確認する。
    -   実認証情報を fixture、log、assertion output に保存せず、suite の success、failure、cleanup で隔離 schema を片付
        ける。
    -   完了時には、MySQL 固有 suite が 40 acceptance criteria の該当 trace を再現し、backend 差を新しい management
        post-process で隠していない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6,
        4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.3, 5.4, 5.5, 5.6_
    -   _Boundary: MySQL management-tools integration_
    -   _Verification: MySQL integration, fault injection_
    -   _Depends: 3.3, 4.5_

-   [x] 5.3 Runtime 所有の Node.js 24/26 matrix で compiled process と全 trace を検証する

    -   `server-application-runtime` が所有する Node.js 24 必須・Node.js 26 追加 matrix を利用し、本 spec に version
        matrix、runner、command を複製せず、三つの compiled command を child process で起動して正常終了 0 と input /
        mode / parse / stage / close failure 1 を確認する。
    -   success path は DB close 後だけ `finish` と終了 0、failure path は後続 stage、`finish`、終了 0 なしという stdout
        / stderr / logger の相対順を検証する。
    -   DB pending fixture は test harness 側の有限時間で待機中を観測して child を終了し、その終了を製品 timeout または
        management cancellation contract として報告しない。
    -   R1 から R5 の各 acceptance criterion に最低一つの deterministic test を対応させ、Windows command は
        `package.json` の確認だけ、Node.js 18 は比較だけとして acceptance から除外する。
    -   完了時には、Node.js 24 の必須 matrix と Node.js 26 の追加 matrix が成功し、各 AC の test と終了順が確認できる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1,
        4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3_
    -   _Boundary: Management CLI process validation_
    -   _Verification: compiled process E2E, Node.js 24/26 matrix_
    -   _Depends: 5.1, 5.2_

-   [x] 6. 管理ツール固有testを共有server品質gateへ接続する
-   [x] 6.1 正式な機能固有の仕様testを完成する

    -   `SPEC-CLI`、`SPEC-BACKUP`、`SPEC-RESTORE`、`SPEC-V1`、`SPEC-DB`のcanonical filenameへ、管理command受付、版なし
        JSON、復元・移行順、部分失敗、進行表示、終了状態の主caseを、R1からR5の各ACへ一つずつ実装する。既存挙動を
        characterizationするcaseではproductionを変更せず、R3.8だけはTask 3.3で承認済み差分を閉じる。
    -   R3.8は6.6で足す。R6（Windows service用のcommand名）は`package.json`の確認で扱い、主caseにしない。R7の5 ACはspec testの主caseへ混入
        させず、Task 6.2から6.7で確かめる。
    -   synthetic JSON、一時DB・filesystem、redacted process出力だけを使用し、実接続先、credential、実番組、実media path
        をfixture、snapshot、test名、失敗出力へ含めない。
    -   完了時には、R3.8を除くR1からR5の各ACを成功した主caseへ一対一で逆引きでき、複数主case、case名・locator重複、およびR7混入が
        0件になる。
    -   _Requirements: 7.1_
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.3_

-   [x] 6.2 parser・JSON・v1変換・DB待機の値域と分岐を`unittest/imp`で完成させる

    -   Design の `IMP-CHAR-MT-7.2` に列挙したconcrete caseを先に追加し、CLI必須値、JSON種類、nullable変換、無期限DB待
        ち、cleanup raceの未実装caseが期待した理由でREDになることを確認する。
    -   `IMP-CLIJSON`、`IMP-V1`、`IMP-DBCLEAN`へ`null`、空、0、1、最小、有効最大、範囲外、不正型、重複をDesignの
        `V-DBTOOLS-CLI`、`V-V1-CLI`、`V-JSON`、`V-ROWS`、`V-V1`、`V-WAIT`どおり割り当てる。製品上限がない値へ新しい上限
        を追加せず、非適用値域には理由を持たせる。
    -   必要最小限のfixture、fake timer、deferred Promise、fault injectionだけを追加し、同じtarget testをGREENにする。接
        続確認の一回と全体にtimeoutを追加せず、失敗後だけ1,000 ms待機し、管理command間のlock・retry・自動停止を導入しな
        い。
    -   Designの`V-DBTOOLS-CLI`、`V-V1-CLI`、`V-JSON`、`V-ROWS`、`V-V1`、`V-WAIT`の対象をassertionへ対応付け、JSON root key・処理順・終了状態・resource releaseを検証する。`extended`と
        `halfWidthExtended`の二field射影を確認する。
    -   完了時には、`IMP-CHAR-MT-7.2`の全concrete caseが成功し、値域、種類、除外、変換、継続待機、cleanupの未分類分岐が0
        件になる。
    -   _Requirements: 7.2_
    -   _Depends: 6.1_

-   [x] 6.3 状態・失敗・時間・資源・非適用matrixを45 ACで完成させる

    -   Design のMatrix 45行で、R1からR7の45 ACを、DB接続前・待機中・接続後、JSON解析前・処理中・部分成功・失敗、1,000 ms再確認と
        無期限待機、runtimeと管理commandおよび複数管理commandの競合へ割り当てる。cancelはOS process終了、再入は別command
        process、restartはcheckpointなしの新規実行とし、製品内cancel API・resume・排他lockを作らない。
    -   transaction、connection、input file、output file、timer、child process、pipe、listenerを取得からterminal結果まで
        追跡する。
    -   HTTPとIPCはcarrier自体がなく非適用、Windows service commandはruntime成功が非適用である理由を保持する。
    -   完了時には、45行の契約、種別、入力、状態、時間・race、資源、境界、failure、期待結果の欠落・重複・未分類・N/A理由欠落が
        0件になる。
    -   _Requirements: 7.3_
    -   _Depends: 6.1, 6.2_

-   [x] 6.4 SQLite・MySQLとJSON filesystemの境界を結合検証する

    -   `INT-BOUNDARY-MT-7.4`のDB・filesystem target integration caseを先に追加し、backend、transaction、connection、
        file cleanupの未接続箇所が期待した理由でREDになることを確認する。
    -   `INT-DBFS`で一時SQLiteと隔離MySQL schemaの8 collection read・replaceおよびv1 insertを実行し、QueryRunnerの開
        始、commit、active時だけのrollback、全経路release、connection closeをexact countで検証する。R3.8のproduction修正
        はPersistence ownerから消費し、本機能へ複製しない。
    -   同じ境界testをtemporary filesystemへ接続し、UTF-8 read、invalid JSON、compact direct write、write failure時の空
        またはpartial targetを観測する。入力fileと実media fileは変更せず、atomic rename・自動復旧を追加しない。
    -   必要最小限のDB seed、fault injector、一時tree回収harnessを実装し、同じtarget testをSQLite・MySQL双方でGREENにす
        る。一方のbackend成功を他方の代替証拠にしない。
    -   完了時には、`INT-BOUNDARY-MT-7.4`のDB・filesystem caseが成功し、transaction、connection、一時file・directoryの未
        解放と対象外file副作用が0件になる。
    -   _Requirements: 7.4_
    -   _Depends: 3.3, 4.5, 6.3_

-   [x] 6.5 compiled CLI processの終了・進行・資源解放を結合検証する

    -   `INT-BOUNDARY-MT-7.4`のcompiled CLI target integration caseを先に追加し、終了状態、進行順、無期限待機時のharness
        回収、またはresource解放の未接続箇所が期待した理由でREDになることを確認する。
    -   `INT-CLI`でproductionと同じcompiled `backup`、`restore`、`v1migrate`をisolated childとして実行し、success 0と
        input・mode・parse・repository・close failure 1、進行順、close barrierを検証する。
    -   DB pendingでは待機中を観測した後にharnessがchildを終了し、child、pipe、listener、一時directory、DB handleを一回
        回収する。harness期限を製品timeout、management cancellation、Windows runtime成功へ読み替えない。
    -   必要最小限のcompiled fixtureとprocess回収harnessを実装し、同じtarget testをGREENにする。HTTPとIPCを新設せず、
        command自身による通常runtime停止または管理command間のlockを追加しない。
    -   完了時には、`INT-BOUNDARY-MT-7.4`のcompiled CLI caseが成功し、exit 0・1、進行・close順、child・pipe・listener・
        一時資源の未解放が0件になる。
    -   _Requirements: 7.4_
    -   _Depends: 5.3, 6.3_

-   [x] 6.6 復元の一括変更の失敗を`SPEC-RESTORE#MT-3.8`の仕様testで確かめる

    -   `SPEC-RESTORE`のcanonical fileに、R3.8（一種類の復元における一括変更の開始または処理の失敗）のspec case
        `MT-3.8`を足す。transaction開始・mutation・commit・rollback・releaseの各failureをfake portで注入し、開始失敗では
        rollbackせず、active時だけrollbackし、全経路でrelease完了後に公開messageが`restore error`だけであることを確認する。
    -   Task 3.3のintegrationを置き換えず、同じ契約をspec側から確かめる。production codeは変更しない。
    -   完了時には、`SPEC-RESTORE#MT-3.8`がAC 3.8の主caseとして成功し、全failure pointで公開messageが`restore error`のみである。
    -   _Requirements: 3.8, 7.1_
    -   _Depends: 6.1_

-   [x] 6.7 本機能の品質判定を満たす

    -   Task 6.1から6.6の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   R6の確認（MT-6.1〜6.3）として、`package.json`に`install-win-service`・`uninstall-win-service`のscript名が一意に存在することと、
        Windowsの動作保証を表明する記述がないことをレビューで確かめる。設定ファイルを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
    -   _Requirements: 6.1, 6.2, 6.3, 7.5_

## Leaf execution contract

| Leaf | Concrete target                                                                                                                                                                                   | Test type                                                  | Local Depends                                                     | Verification command                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/management-tools/cli.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`<br>`test/server/management-tools/compiled-cli.integration.test.ts`                             | `unittest/spec, unittest/imp, compiled process`            | `なし（共有foundationのみ）`                                      | `npm run test:server:spec -- test/server/management-tools/cli.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/compiled-cli.integration.test.ts`                             |
| 1.2  | `test/server/management-tools/database-lifecycle.spec.test.ts`<br>`test/server/management-tools/database-wait-cleanup.test.ts`                                                                    | `unittest/spec, unittest/imp`                              | `なし（共有foundationのみ）`                                      | `npm run test:server:spec -- test/server/management-tools/database-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/database-wait-cleanup.test.ts`                                                                                                       |
| 1.3  | `test/server/management-tools/database-lifecycle.spec.test.ts`<br>`test/server/management-tools/database-wait-cleanup.test.ts`<br>`test/server/management-tools/compiled-cli.integration.test.ts` | `unittest/spec, unittest/imp, compiled process`            | `1.1`                                                             | `npm run test:server:spec -- test/server/management-tools/database-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/database-wait-cleanup.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/compiled-cli.integration.test.ts` |
| 2.1  | `test/server/management-tools/backup.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`                                                                                             | `unittest/spec, unittest/imp`                              | `1.3`                                                             | `npm run test:server:spec -- test/server/management-tools/backup.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`                                                                                                                                |
| 2.2  | `test/server/management-tools/backup.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`                                                                                             | `unittest/spec, unittest/imp`                              | `2.1`                                                             | `npm run test:server:spec -- test/server/management-tools/backup.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`                                                                                                                                |
| 2.3  | `test/server/management-tools/backup.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`                                                                                             | `unittest/spec, unittest/imp`                              | `2.2`                                                             | `npm run test:server:spec -- test/server/management-tools/backup.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`                                                                                                                                |
| 3.1  | `test/server/management-tools/restore.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`                                                                                            | `unittest/spec, unittest/imp`                              | `1.2, 1.3`                                                        | `npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`                                                                                                                               |
| 3.2  | `test/server/management-tools/restore.spec.test.ts`<br>`test/server/management-tools/database-wait-cleanup.test.ts`<br>`test/server/management-tools/db-filesystem.integration.test.ts`           | `unittest/spec, unittest/imp, SQLite/MySQL integration`    | `3.1`                                                             | `npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/database-wait-cleanup.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`           |
| 3.3  | `test/server/management-tools/restore.spec.test.ts`<br>`test/server/management-tools/db-filesystem.integration.test.ts`                                                                           | `unittest/spec, SQLite/MySQL integration, fault injection` | `3.2`                                                             | `npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                      |
| 4.1  | `test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/v1-conversion.test.ts`                                                                                  | `unittest/spec, unittest/imp`                              | `1.1`                                                             | `npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/v1-conversion.test.ts`                                                                                                                     |
| 4.2  | `test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/v1-conversion.test.ts`                                                                                  | `unittest/spec, unittest/imp`                              | `4.1`                                                             | `npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/v1-conversion.test.ts`                                                                                                                     |
| 4.3  | `test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/v1-conversion.test.ts`                                                                                  | `unittest/spec, unittest/imp`                              | `4.2`                                                             | `npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/v1-conversion.test.ts`                                                                                                                     |
| 4.4  | `test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/v1-conversion.test.ts`<br>`test/server/management-tools/db-filesystem.integration.test.ts`              | `unittest/spec, unittest/imp, integration`                 | `4.3`                                                             | `npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/v1-conversion.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`              |
| 4.5  | `test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/db-filesystem.integration.test.ts`                                                                      | `unittest/spec, SQLite/MySQL integration, fault injection` | `4.2, 4.3, 4.4`                                                   | `npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                 |
| 5.1  | `test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                  | `SQLite integration, fault injection`                      | `3.3, 4.5`                                                        | `npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                                                                         |
| 5.2  | `test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                  | `MySQL integration, fault injection`                       | `3.3, 4.5`                                                        | `npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                                                                         |
| 5.3  | `test/server/management-tools/compiled-cli.integration.test.ts`                                                                                                                                   | `compiled process E2E, Node.js 24/26 matrix` | `5.1, 5.2`                                                        | `npm run test:server:integration -- test/server/management-tools/compiled-cli.integration.test.ts`                                                                                                                                                                                          |
| 6.1  | `test/server/management-tools/cli.spec.test.ts`<br>`test/server/management-tools/backup.spec.test.ts`<br>`test/server/management-tools/restore.spec.test.ts`<br>`test/server/management-tools/v1-migration.spec.test.ts`<br>`test/server/management-tools/database-lifecycle.spec.test.ts` | `unittest/spec` | `1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.3` | `npm run test:server:spec -- test/server/management-tools/cli.spec.test.ts`<br>`npm run test:server:spec -- test/server/management-tools/backup.spec.test.ts`<br>`npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts`<br>`npm run test:server:spec -- test/server/management-tools/v1-migration.spec.test.ts`<br>`npm run test:server:spec -- test/server/management-tools/database-lifecycle.spec.test.ts` |
| 6.2  | `test/server/management-tools/cli-json.test.ts`                                                                                                                                                   | `unittest/imp` | `6.1`                                                             | `npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`                                                                                                                                                                                                                  |
| 6.3  | `.kiro/specs/server-management-tools/design.md` | レビュー | `6.1, 6.2` | なし（DesignのMatrix 45行のレビュー） |
| 6.4  | `test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                  | `integration` | `3.3, 4.5, 6.3`                                                   | `npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`                                                                                                                                                                                         |
| 6.5  | `test/server/management-tools/compiled-cli.integration.test.ts`                                                                                                                                   | `integration` | `5.3, 6.3`                                                        | `npm run test:server:integration -- test/server/management-tools/compiled-cli.integration.test.ts`                                                                                                                                                                                          |
| 6.6  | `test/server/management-tools/restore.spec.test.ts` | `unittest/spec` | `6.1` | `npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts` |
| 6.7  | `test/server/management-tools/restore.spec.test.ts`<br>`test/server/management-tools/cli-json.test.ts`<br>`test/server/management-tools/db-filesystem.integration.test.ts`<br>`test/server/management-tools/compiled-cli.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `6.1, 6.2, 6.3, 6.4, 6.5, 6.6` | `npm run test:server:spec -- test/server/management-tools/restore.spec.test.ts`<br>`npm run test:server:imp -- test/server/management-tools/cli-json.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/db-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/management-tools/compiled-cli.integration.test.ts` |
