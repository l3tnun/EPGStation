# Implementation Plan

## Execution ownership

本 spec は、既存 6 source の外部から観測可能な振る舞いに対する owner-local characterization test だけを所有する。製
品 behavior と共有 test foundation は所有しない。production source は本 batch で変更しない。

`test/server/shared-foundation/imp/test-lint-conditional-test.test.ts` は test 用 ESLint rule の test であり、本 spec
の 6 source を対象にしないため、本 spec の範囲外とする。

全 leaf に共通する前提:

-   共有 foundation の固定 command（`test:server:imp`）だけを使い、別 runner・別 config を作らない。
-   production source（`src/model/IPromiseQueue.ts`、`src/model/PromiseQueue.ts`、`src/util/Util.ts`、
    `src/util/DateUtil.ts`、`src/util/StrUtil.ts`、`src/util/FileUtil.ts`）を変更しない。

-   [x] 1. 処理の直列化（`IPromiseQueue` / `PromiseQueue`）の characterization test を作る
    -   `test/server/shared-foundation/imp/promise-queue.test.ts` に、追加順の開始順序、job 自身の例外の reject 伝播、
        失敗後の後続 job 実行を確認する test を追加する。
    -   `PromiseQueue` が `@injectable()` decorator を持つため、`reflect-metadata` を先に読み込んでから compiled
        module を import する。
    -   _Requirements: 1.1, 1.2, 1.3_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/promise-queue.test.ts` を対象とする_

-   [x] 2. 日時表示（`DateUtil`）の characterization test を作る
    -   `test/server/shared-foundation/imp/date-util.test.ts` に、書式トークンの置換、`w` トークンの曜日ラベル、
        `getJaDate` のタイムゾーン変換を確認する test を追加する。
    -   _Requirements: 2.1, 2.2, 2.3_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/date-util.test.ts` を対象とする_

-   [x] 3. 文字列正規化（`StrUtil`）の characterization test を作る
    -   `test/server/shared-foundation/imp/str-util.test.ts` に、NUL 除去、半角化・全角化、ディレクトリ名・ファイル名
        正規化、囲み文字の相互変換、重複録画判定の名前（`deleteBrackets`）を確認する test を追加する。
    -   重複録画判定の名前は、[前]・[後]（`[]` 表記と囲み文字、位置違い、両方）を末尾に `[前]`、`[後]` の順で付け、[再]・[字]
        など他の囲み文字と `[]` 表記は除き、[前]・[後] の無い名前は除去と trim だけの結果になることを確認する。
    -   全角化の `"` 変換は、typographic quote ではなく既存コードの適用順序により全角引用符 `＂` になる挙動を test が検証する。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/str-util.test.ts` を対象とする_

-   [x] 4. ファイル操作（`FileUtil`）の characterization test を作る
    -   `test/server/shared-foundation/imp/file-util.test.ts` に、読み書き・追記・削除・名前変更・移動（失敗時の後始
        末を含む）・一覧取得・空判定・ディレクトリ削除の成功と失敗、および管理対象ディレクトリ安全判定（対象外
        path、ディレクトリ自身、識別情報不一致）を確認する test を追加する。
    -   `test/server/shared-foundation/imp/file-util-read-dir-failure.test.ts` に、存在しないディレクトリの一覧取得
        （`FileUtil.readDir`）が元のファイルシステムエラーで reject されることを確認する test を追加する。
    -   `test/server/shared-foundation/file-util-real-failure.integration.test.ts` に、実 file system で移動先の directory が無い・移動先に既存の directory がある場合に、移動元が残り移動先が作られない（または既存のまま）ことを確認する test を追加する（integration 層。`imp/` の一括実行には含まれない）。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/file-util.test.ts test/server/shared-foundation/imp/file-util-read-dir-failure.test.ts` を対象とする_

-   [x] 5. 単純な時間待機（`Util.sleep`）の characterization test を作る
    -   `test/server/shared-foundation/imp/util.test.ts` に、境界直前で未完了であること、境界で一度だけ完了すること
        を fake timer で確認する test を追加する。
    -   _Requirements: 5.1_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/util.test.ts` を対象とする_

-   [x] 6. 全 test file の一括実行を用意する
    -   本 spec の `imp/` の 6 test file を一括実行できる状態にする。
    -   _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1_
    -   _Verification: `mise exec node@24.18.0 -- npm run test:server:imp -- test/server/shared-foundation/imp/promise-queue.test.ts test/server/shared-foundation/imp/util.test.ts test/server/shared-foundation/imp/date-util.test.ts test/server/shared-foundation/imp/str-util.test.ts test/server/shared-foundation/imp/file-util.test.ts test/server/shared-foundation/imp/file-util-read-dir-failure.test.ts` を対象とする_
