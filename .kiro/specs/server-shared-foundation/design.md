# 共有基盤ユーティリティ機能 設計

## 1. 目的と責任境界

本機能は、次の 6 source が持つ既存の外部から観測可能な振る舞いを、利用機能から独立して確認する spec
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
-   `IPromiseQueue` は method シグネチャだけを持つ interface である。型の一致は production の compile が保証し、test は
    `PromiseQueue` を実行して `add` の契約（開始順・reject 伝播・失敗後続行）だけを検証する。type-only source として扱う。
-   `FileUtil` の test は `node:os` の一時ディレクトリ配下で実ファイル操作を行う。実 URL、実番組情報、credential、実
    保存 path、実チューナーサーバー情報を fixture に含めない。

