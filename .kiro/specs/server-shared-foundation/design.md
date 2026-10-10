# 共有基盤ユーティリティ機能 設計

## 1. 目的と責任境界

本機能は、次の 6 source が持つ外部から観測可能な振る舞いを、利用機能から独立して確認する spec
である。製品としての振る舞い、公開 API、IPC、DB schema、設定、保存形式を所有せず、変更しない。

| source | 対応する Requirement |
| --- | --- |
| `src/model/IPromiseQueue.ts` | Requirement 1 |
| `src/model/PromiseQueue.ts` | Requirement 1 |
| `src/util/DateUtil.ts` | Requirement 2 |
| `src/util/StrUtil.ts` | Requirement 3 |
| `src/util/FileUtil.ts` | Requirement 4 |
| `src/util/Util.ts` | Requirement 5 |

共有 server test foundation（test root、固定 root command、Vitest 設定、coverage の実行方法）は
`server-application-runtime` design が単独所有する。本機能はその consumer であり、foundation を再実装しない。共通品質
規則の正本は `.kiro/steering/server-testing.md` である。

## 2. 依存関係

-   upstream: `server-application-runtime`（共有 test foundation の provider）。
-   downstream: なし。本機能の test は各利用機能の consumer cross-spec test から参照され得るが、本機能自身は利用機能
    に依存しない。

## 3. shared / domain-local の判定根拠

`.kiro/steering/server-testing.md` および `server-shared-foundation` の対象選定は、consumer domain 数を判定根拠とす
る。3 つ以上の server 機能から利用され、固有の lifecycle または contract を持つ utility を本 spec の所有とし、単一
domain に閉じる utility はその domain の primary owner に残す。既存 domain test は、本機能が定義する契約に対する
consumer cross-spec evidence として再利用できるが、shared source の唯一の primary proof にはしない。本機能は各 source
に対する direct characterization test を `test/server/shared-foundation/` に持つ。

## 4. Test 方針

-   test は `test/server/shared-foundation/imp/` に置き、各 source の compiled 成果物（
    `EPGSTATION_SERVER_COMPILED_SNAPSHOT` 配下）を動的 `import()` する。private field、logger message、source 文字列
    だけを oracle にしない。
-   `PromiseQueue` は `@injectable()` decorator を持つため、test は `reflect-metadata` を import した後に compiled
    module を読み込む。これは `src/index.ts` 自身の起動時初期化順序と同じであり、
    `test/server/application-runtime/child-supervision.spec.test.ts` が既に使う既存パターンを踏襲する。
-   実 file system の失敗を確かめる `FileUtil.move` の test だけは、integration 層の `test/server/shared-foundation/file-util-real-failure.integration.test.ts` に置く（4.3）。
-   `IPromiseQueue` は method シグネチャだけを持つ interface である。型の一致は production の compile が保証し、test は
    `PromiseQueue` を実行して `add` の契約（開始順・reject 伝播・失敗後続行）だけを検証する。type-only source として扱う。
-   `FileUtil` の test は `node:os` の一時ディレクトリ配下で実ファイル操作を行う。実 URL、実番組情報、credential、実
    保存 path、実チューナーサーバー情報を fixture に含めない。

### 条件と test の対応

本機能は新規の test を持たず、各部品の振る舞いを確かめる test だけを持つ。test の ID（`IMP-CHAR-SF-n`）の n は
source の並びの番号であり、Requirement の番号とは一致しない。条件から test を辿るときは次の表を正とする。

| 条件 | 主な test（`test/server/shared-foundation/` 配下） |
| --- | --- |
| 1.1 | `imp/promise-queue.test.ts`: 前の job が完了してから追加順に開始する |
| 1.2 | `imp/promise-queue.test.ts`: job 自身の拒否理由で呼び出し元が reject される |
| 1.3 | `imp/promise-queue.test.ts`: 前の job が reject した後も後続の job が完了する |
| 2.1 | `imp/date-util.test.ts`: `yyyy/MM/dd hh:mm:ss` のゼロ詰めと `YY` の置換 |
| 2.2 | `imp/date-util.test.ts`: `w` が曜日の日本語 1 文字になる |
| 2.3 | `imp/date-util.test.ts`: `getJaDate` が UTC+9 の壁時計の時刻へずらす |
| 3.1 | `imp/str-util.test.ts`: NUL の除去（NUL の無い文字列はそのまま） |
| 3.2 | `imp/str-util.test.ts`: 全角の英数字・記号を半角へ変換する |
| 3.3 | `imp/str-util.test.ts`: 半角の英数字を全角へ変換する（`[`・`]` は半角のまま。バックスラッシュは全角の円記号） |
| 3.4 | `imp/str-util.test.ts`: ディレクトリ名・ファイル名で使えない記号を全角へ置換する |
| 3.5 | `imp/str-util.test.ts`: 囲み文字と `[]` の区間の除去、`[前]`・`[後]` の付け直し（`deleteBrackets` の各 case） |
| 3.6 | `imp/str-util.test.ts`: 囲み文字を `[]` 表記へ往復変換する |
| 4.1 | `imp/file-util.test.ts`: 読み書き・追記・削除・名前変更・移動・一覧取得・ディレクトリ削除の成功 |
| 4.2 | `imp/file-util.test.ts`・`imp/file-util-read-dir-failure.test.ts`: 存在しない file の読み取り・削除・サイズ取得（`FileIsNotFound`）・一覧取得の失敗 |
| 4.3 | `imp/file-util.test.ts`（コピー失敗時の後始末）と `file-util-real-failure.integration.test.ts`（実 file system の失敗） |
| 4.4 | `imp/file-util.test.ts`: 管理対象ディレクトリの外・自身・識別情報の不一致を削除不可と判定する |
| 5.1 | `imp/util.test.ts`: 境界の直前まで完了せず、境界で 1 度だけ完了する |

`toHalfRegExp`・`getFileList` など、条件を持たない公開関数は、振る舞いを確かめる test だけがあり、上の表の対象外である。
