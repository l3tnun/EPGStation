# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation、`test/server` root、固定 command は `server-application-runtime` Requirement 9
、V8 coverage、coverage の計測の道具、および Node.js 24 必須・Node.js 26 追加matrix も同 spec が所有する。同 spec の foundation 完了後に本計画を実行し、本 spec は
`test/server/thumbnail-management/` の機能固有 test、fixture、assertion、および承認済み差分の実装だけを追加する。

`thumbnailMaxPending` の config schema、既定値 32、1〜10,000 の整数 validation、および標準設定は `server-configuration`
Task 4.1 が所有する。本 spec は同 task 完了後の検証済み設定 snapshot を消費し、
`src/model/IConfigFile.ts`、`src/model/Configuration.ts`、`config/config.yml.template` を変更しない。

## Leaf execution contract

共有 Runtime owner が提供する固定 command を消費する。以下は leaf ごとの target、種別、local dependency、実行入口であ
り、Runtime の runner・script・flag を再定義しない。

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Test type                                         | Local Depends                            | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`test/server/thumbnail-management/imp/queue-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/queue-lifecycle.test.ts`                                                                                                                                                                                                                                                                                     |
| 1.2  | `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                     |
| 1.3  | `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/imp/queue-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                       | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/queue-lifecycle.test.ts`                                                                                                                                                                                                                                                                                          |
| 1.4  | `test/server/thumbnail-management/spec/thumbnail-access-delete.spec.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                                                                                                                          | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-access-delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                             |
| 1.5  | `test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`test/server/thumbnail-management/spec/thumbnail-cleanup.spec.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                                                 | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-cleanup.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                        |
| 1.6  | `test/server/thumbnail-management/spec/thumbnail-restart.spec.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                | `unittest/spec`・`unittest/imp`                   | なし（共有foundationのみ）               | `npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-restart.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                   |
| 2.1  | `test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`test/server/thumbnail-management/imp/admission-limits.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                                                                                       | `unittest/spec`・`unittest/imp`                   | `1.1`                                    | `npm run test:server:spec -- test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/admission-limits.test.ts`                                                                                                                                                                                                                                                                                    |
| 2.2  | `test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`test/server/thumbnail-management/imp/admission-limits.test.ts`<br>`test/server/thumbnail-management/imp/queue-lifecycle.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                     | `unittest/spec`・`unittest/imp`                   | `2.1`                                    | `npm run test:server:spec -- test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/admission-limits.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/queue-lifecycle.test.ts`                                                                                                                                                                                       |
| 2.3  | `test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                                                                                 | `unittest/spec`・`unittest/imp`                   | `2.2`                                    | `npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                              |
| 3.1  | `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/imp/deadline-fences.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`・`unittest/imp`                   | `1.2, 2.2`                               | `npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/deadline-fences.test.ts`                                                                                                                                                                                                                                                                                          |
| 4.1  | `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/imp/output-reservation.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                                                                                          | `unittest/spec`・`unittest/imp`                   | `1.3, 1.5, 3.1`                          | `npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/output-reservation.test.ts`                                                                                                                                                                                                                                                                                       |
| 5.1  | `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/imp/deadline-fences.test.ts`<br>`src/model/operator/thumbnail/ThumbnailManageModel.ts`                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`・`unittest/imp`                   | `4.1`                                    | `npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/deadline-fences.test.ts`                                                                                                                                                                                                                                                                                          |
| 6.1  | `test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`test/server/thumbnail-management/spec/thumbnail-access-delete.spec.test.ts`<br>`test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`test/server/thumbnail-management/spec/thumbnail-cleanup.spec.test.ts`<br>`test/server/thumbnail-management/spec/thumbnail-restart.spec.test.ts` | `unittest/spec` | `2.1, 2.2, 2.3, 3.1, 4.1, 5.1`           | `npm run test:server:spec -- test/server/thumbnail-management/spec/generation-admission.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-access-delete.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-cleanup.spec.test.ts`<br>`npm run test:server:spec -- test/server/thumbnail-management/spec/thumbnail-restart.spec.test.ts` |
| 6.2  | `test/server/thumbnail-management/imp/admission-limits.test.ts`<br>`test/server/thumbnail-management/imp/queue-lifecycle.test.ts`<br>`test/server/thumbnail-management/imp/deadline-fences.test.ts`                                                                                                                                                                                                                                                                                                                                          | `unittest/imp`                                    | `6.1`                                    | `npm run test:server:imp -- test/server/thumbnail-management/imp/admission-limits.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/queue-lifecycle.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/deadline-fences.test.ts`                                                                                                                                                                                                   |
| 6.3  | `test/server/thumbnail-management/imp/output-reservation.test.ts`<br>`test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     | `unittest/imp`                                    | `6.1`                                    | `npm run test:server:imp -- test/server/thumbnail-management/imp/output-reservation.test.ts`<br>`npm run test:server:imp -- test/server/thumbnail-management/imp/maintenance-branches.test.ts`                                                                                                                                                                                                                                                                                         |
| 6.4  | `test/server/thumbnail-management/integration/thumbnail-db.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `integration`                                     | `6.2, 6.3`                               | `npm run test:server:integration -- test/server/thumbnail-management/integration/thumbnail-db.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                     |
| 6.5  | `test/server/thumbnail-management/integration/thumbnail-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `integration`                                     | `6.4`                                    | `npm run test:server:integration -- test/server/thumbnail-management/integration/thumbnail-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                             |
| 6.6  | `test/server/thumbnail-management/integration/thumbnail-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `integration`                                     | `6.5`                                    | `npm run test:server:integration -- test/server/thumbnail-management/integration/thumbnail-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                |
| 6.7  | `test/server/thumbnail-management/integration/thumbnail-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `integration`                                     | `6.6`                                    | `npm run test:server:integration -- test/server/thumbnail-management/integration/thumbnail-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                   |
| 6.8  | `test/server/thumbnail-management/integration/thumbnail-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `integration`                                     | `6.7`                                    | `npm run test:server:integration -- test/server/thumbnail-management/integration/thumbnail-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                    |
| 7.4  | `test/server/thumbnail-management/**`（Task 6.1〜6.8 の全 test file） | `unittest/spec`・`unittest/imp`・`integration` | `6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8` | `npm run test:server`（`server-application-runtime` が所有する共有 command） |

-   [x] 1. 既存の生成・参照・整理契約を characterization する
-   [x] 1.1 FIFO、重複依頼、受付と完了の分離を固定する

    -   `test/server/thumbnail-management/spec/generation-admission.spec.test.ts` と
        `test/server/thumbnail-management/imp/queue-lifecycle.test.ts` に、受付順、同一録画ファイルの重複依頼、DB 保存未
        解決、および非同期 listener の deferred fixture を追加する。
    -   既存実装を変更せず、FIFO、一件実行、受付時の JPEG・DB row・完了通知 0、DB settlement までの後続開始 0、成功通知
        後に listener 完了を待たない順序を exact call ledger で固定する。
    -   完了時には TM-1.2、TM-1.3、TM-1.8、TM-1.9、TM-1.10 の characterization が成功し、production 差分が 0
        件である。
    -   _Requirements: 1.2, 1.3, 1.8, 1.9, 1.10_
    -   _Boundary: サムネイル生成受付・FIFO lifecycle_

-   [x] 1.2 録画ファイル確認、保存先確認、および生成条件を固定する

    -   `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts` に、録画ファイル登録・実 path の null/不
        在、保存先 ENOENT・読書き拒否、動画内位置、画像サイズ、および生成 command の fixture を追加する。
    -   `test/server/thumbnail-management/imp/maintenance-branches.test.ts` で、保存先作成成功・失敗、spawn 前失敗、およ
        び対象外 row/file 不変を検証する。
    -   完了時には TM-2.1、TM-2.4、TM-2.5、TM-2.6 が spawn 回数、引数、保存先副作用を再現し、production 差分が 0
        件である。
    -   _Requirements: 2.1, 2.4, 2.5, 2.6_
    -   _Boundary: JPEG 生成前処理_

-   [x] 1.3 command、登録、通知、および既存失敗 cleanup を固定する

    -   `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts` と
        `test/server/thumbnail-management/imp/queue-lifecycle.test.ts` に、実行対象と引数の分離、親環境継承、正常・異常
        exit、spawn error、DB 保存成功・失敗を追加する。
    -   DB 保存成功時だけ `filePath`・`recordedId` row と生成通知が各 1 件になり、DB 保存失敗時は既存方法で把握済み JPEG
        の削除を試みることを固定する。
    -   生成・DB 保存の原失敗と JPEG cleanup 失敗を別の logger ledger entry とし、各 entry が同じ request identity を一
        回だけ持ち、後続依頼の開始を妨げないことを固定する。
    -   完了時には TM-2.10、TM-2.11、TM-2.12、TM-2.13、TM-2.14 が成功し、production 差分が 0 件である。
    -   _Requirements: 2.10, 2.11, 2.12, 2.13, 2.14_
    -   _Boundary: JPEG command・サムネイル登録 commit_

-   [x] 1.4 取得と個別削除の部分結果を固定する

    -   `test/server/thumbnail-management/spec/thumbnail-access-delete.spec.test.ts` に、取得、登録情報なし、DB 削除失
        敗、JPEG unlink 失敗、および削除成功の fixture を追加する。
    -   `test/server/thumbnail-management/imp/maintenance-branches.test.ts` で、DB 先行削除、JPEG 失敗時の DB 復元 0・通
        知 0、両方成功時だけ通知 1 を検証する。
    -   完了時には TM-3.1〜TM-3.5 が既存の row、JPEG、error、通知結果を再現し、production 差分が 0 件である。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
    -   _Boundary: サムネイル取得・個別削除_

-   [x] 1.5 再生成と明示的クリーンアップの継続契約を固定する

    -   `test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts` に、録画ファイルなし、利用可能画像あ
        り・なし、欠落 JPEG row、および一件失敗後の継続を追加する。
    -   `test/server/thumbnail-management/spec/thumbnail-cleanup.spec.test.ts` と
        `test/server/thumbnail-management/imp/maintenance-branches.test.ts` に、DB のみ、file のみ、両方、削除失敗、
        cleanup 由来 add 0 の fixture を追加する。
    -   再生成と cleanup の照合・削除が失敗しても、失敗した対象以外の後続対象について照合・削除を継続することを検証す
        る。
    -   完了時には TM-4.1〜TM-4.5 と TM-5.2、TM-5.4、TM-5.5 が既存の照合・追加・削除・継続結果を再現し、production差分が
        0 件である。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2, 5.4, 5.5_
    -   _Boundary: 不足サムネイル再生成・クリーンアップ_

-   [x] 1.6 process-local な依頼と再起動後の明示操作を固定する

    -   `test/server/thumbnail-management/spec/thumbnail-restart.spec.test.ts` に、待機中・生成中・新 instance・再起動後
        の明示 regenerate/cleanup の synthetic restart fixture を追加する。
    -   `test/server/thumbnail-management/imp/maintenance-branches.test.ts` で、依頼永続 row/file/cursor 0、旧待機復元
        0、旧実行再開 0、新規要求受付を検証する。
    -   完了時には TM-6.1〜TM-6.4 が承認済みの process-local contract を再現し、production 差分が 0 件である。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4_
    -   _Boundary: サムネイル生成依頼の再起動境界_

-   [x] 2. 起動 snapshot に従う上限付き受付を test と実装で実現する
-   [x] 2.1 検証済み待機上限の起動 snapshot 消費を test と実装で閉じる

    -   `server-configuration` Task 4.1 完了後、
        `test/server/thumbnail-management/spec/generation-admission.spec.test.ts` に検証済み 32、1、10,000 と稼働中の設
        定 source 変更を追加し、現在 instance の上限が保持されることを検証する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` は `thumbnailMaxPending` を constructor で一度だけ取得・
        保持し、config schema、既定値、値域 validation、template は実装しない。
    -   `test/server/thumbnail-management/imp/admission-limits.test.ts` で設定取得一回、現在 instance の上限不変、新
        instance の新 snapshot 消費を確認する。
    -   完了時には TM-1.4〜TM-1.6 が成功し、設定 owner の source 差分が0件である。
    -   _Requirements: 1.4, 1.5, 1.6, 7.2_
    -   _Boundary: サムネイル管理の検証済み起動 snapshot consumption_
    -   _Depends: 1.1_

-   [x] 2.2 bounded admission と同期過負荷拒否を test と実装で閉じる

    -   `test/server/thumbnail-management/spec/generation-admission.spec.test.ts` に、待機上限直前・到達・超過、実行中一
        件、同着受付、重複 ID、および受付済み依頼を追加する。
    -   実行中一件を待機数へ含めず、満杯時は新規依頼だけを既存 error carrier へ同期的に渡し、受理済み依頼の取消 0 を
        exact ledger で定義する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` の同期 `add()` 境界で待機数確認と追加を不可分にし、満杯時
        は既存 error carrier を throw する。
    -   `src/model/operator/thumbnail/IThumbnailManageModel.ts` の公開契約を変えず、重複依頼、FIFO、受付と完了の分離、
        regenerate の一件失敗後継続を維持する。
    -   `test/server/thumbnail-management/imp/admission-limits.test.ts` と
        `test/server/thumbnail-management/imp/queue-lifecycle.test.ts` で、任意の同着受付でも受理数が上限以下、受付済み
        取消 0、同一 ID の独立要素を確認する。
    -   完了時には任意の同着受付でも受理数が上限以下、受付済み取消 0 になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.7, 1.8, 7.2_
    -   _Boundary: サムネイル生成の bounded admission・FIFO_
    -   _Depends: 2.1_

-   [x] 2.3 regenerate の満杯失敗隔離を test と実装で閉じる

    -   `test/server/thumbnail-management/spec/thumbnail-regeneration.spec.test.ts` と
        `test/server/thumbnail-management/imp/maintenance-branches.test.ts` に、複数番組の途中で `add()` が同期的な満杯
        error を返し、前後の対象は調査可能である fixture を追加し、TM-4.6 を検証する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` の regenerate は対象単位で同期 `add()` error を catch
        し、recorded/video identity と原 error を logger ledger へ一回記録して後続番組を続ける。
    -   受付済み依頼を取り消さず、失敗対象の追加 0、後続対象の調査・追加継続、再生成要求が追加済み JPEG の完成を待たない
        ことを exact queue/logger ledger で検証する。
    -   完了時には TM-4.6 が成功し、原失敗の記録一回、後続対象の処理一回以上を観測できる。
    -   _Requirements: 4.6_
    -   _Boundary: 不足サムネイル再生成の admission failure isolation_
    -   _Depends: 2.2_

-   [x] 3. 録画ファイル確認へ有限な開始準備期限を追加する
-   [x] 3.1 30 秒期限と late result fence を test と実装で閉じる

    -   `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts` と
        `test/server/thumbnail-management/imp/deadline-fences.test.ts` に 29,999、30,000、30,001ms、確認成功・失敗・
        late settlement の fake timer/deferred fixture を追加する。
    -   期限時は依頼を一度だけ失敗として queue 先頭を解放し、late 確認から process、DB 保存、通知を開始しない期待値を
        exact count で定義する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` に request token、settled guard、monotonic 30 秒 absolute
        deadline を追加し、確認完了から生成へ進む直前にも同じ deadline を確認する。
    -   録画済み番組管理・永続化機能の retry、取消、DB timeout は変更せず、consumer 側の late result 利用だけを止める。
    -   timer、queue 先頭、request 参照が成功・失敗・期限の全経路で各一回解放されることを
        `test/server/thumbnail-management/imp/deadline-fences.test.ts` で確認する。
    -   完了時には期限後の process・DB 保存・通知が各 0 件で、timer、queue 先頭、request 参照が全経路で一回解放される。
    -   _Requirements: 1.2, 1.10, 2.1, 2.2, 2.3, 7.2_
    -   _Boundary: サムネイル生成の preparation lifecycle_
    -   _Depends: 1.2, 2.2_

-   [x] 4. 出力名を排他的に予約し temporary JPEG から publish する
-   [x] 4.1 同名 race、temporary 出力、および owned cleanup を test と実装で閉じる

    -   `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts` と
        `test/server/thumbnail-management/imp/output-reservation.test.ts` に、`wx` claim、`EEXIST` 連番、同着二依頼、
        temporary 出力、publish、DB 失敗、active reservation 中 cleanup を追加する。
    -   child の final 直接 write 0、二依頼の異なる reservation/final、owned temp/final だけの cleanup、他依頼の
        row/JPEG 不変を期待値にする。
    -   生成・publish・DB 保存の原失敗と各 owned cleanup 失敗は、同じ request/reservation identity を持つ別 logger
        ledger entry として各一回記録し、後続依頼を汚染しない期待値を定義する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` に request identity、claim 済み final、request 固有
        temporary directory/file、および一回解放状態を持つ `OutputReservation` を追加する。
    -   final 候補を `open(..., "wx")` で claim し、child は temporary path だけへ出力し、正常 terminal と出力の存在確認後に
        owned final へ一回 publish する。
    -   active reservation set を名前選択と `fileCleanup()` の削除候補から除外し、成功時は final を残し、生成・publish・
        DB 失敗時は owned temp/final だけを一回回収する。
    -   原失敗と cleanup 失敗を別々に記録し、request/reservation identity、各記録回数一回、後続 request の publish・DB・
        通知継続を logger/call ledger で確認する。
    -   完了時には同名競合でも所有 final の重複 0、active path の誤削除 0、失敗 identity の混同 0 になる。
    -   _Requirements: 2.7, 2.10, 2.12, 5.1, 5.3, 7.2_
    -   _Boundary: OutputReservation・filesystem publish_
    -   _Depends: 1.3, 1.5, 3.1_

-   [x] 5. JPEG child の業務 settlement と資源 finalization を分離する
-   [x] 5.1 300 秒期限、停止、late terminal、および child lease を test と実装で閉じる

    -   `test/server/thumbnail-management/spec/jpeg-generation.spec.test.ts` と
        `test/server/thumbnail-management/imp/deadline-fences.test.ts` に 299,999、300,000、300,001ms、正常・異常
        terminal、spawn error、停止成功・失敗、late exit/error/close の競合を追加する。
    -   deadline 時の業務失敗一回、停止試行一回、late callback から publish・DB・通知 0、terminal 前の次 child 0、
        terminal 後の owned cleanup と slot 解放一回を期待値にする。
    -   process 原失敗、停止失敗、および terminal 後 cleanup 失敗を request/reservation identity 付きの別 logger ledger
        entry として各一回記録し、後続可能な terminal 経路では次依頼を継続する期待値を定義する。
    -   `src/model/operator/thumbnail/ThumbnailManageModel.ts` で正常・異常 terminal、error、deadline の先着一件だけを
        request tokenへ確定し、業務 settlement と child lease finalization を別状態にする。
    -   `src/util/ProcessUtil.ts` の既存停止方法を deadline 時に一回だけ使い、新しい signal escalation や自動 retry は追
        加しない。
    -   spawn failure または `close` terminal で child 非 live を確認するまで slot、reservation、timer/listener を保持
        し、terminal 未確認なら専用 queue だけを停止したまま許可済み情報を記録する。
    -   logger ledger で原失敗と cleanup 失敗の回数・request/reservation identity を分離し、terminal 確認後は後続依頼が
        一回開始することを確認する。
    -   完了時には live child、stop、publish、DB insert、通知、cleanup、解放・failure log が設計上限を超えない。
    -   _Requirements: 1.2, 1.9, 1.10, 2.8, 2.9, 2.10, 2.11, 2.12, 7.2_
    -   _Boundary: JPEG process lifecycle・child lease_
    -   _Depends: 4.1_

-   [x] 6. 機能固有 spec・implementation・integration test を完成させる
-   [x] 6.1 44 AC の一意な仕様 case を実装する

    -   Design 7.1 の6個の `test/server/thumbnail-management/spec/*.spec.test.ts` に TM-1.1〜TM-6.4 の named case を一件
        ずつ置き、AC の重複 owner を作らない。
    -   完了時には spec case が44件、numeric AC が44件で、test title から各 AC を逆引きでき、欠落・重複が各0件である。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
        2.10, 2.11, 2.12, 2.13, 2.14, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5,
        6.1, 6.2, 6.3, 6.4, 7.1_
    -   _Boundary: サムネイル管理 spec test case_
    -   _Depends: 2.1, 2.2, 2.3, 3.1, 4.1, 5.1_

-   [x] 6.2 admission、queue、および deadline の implementation case を完成させる

    -   `test/server/thumbnail-management/imp/admission-limits.test.ts`、
        `test/server/thumbnail-management/imp/queue-lifecycle.test.ts`、および
        `test/server/thumbnail-management/imp/deadline-fences.test.ts` に Design 7.6 の concrete named case を実装する。
    -   null、空、0、1、最小・最大・範囲外・不正型・重複、待機・生成中・成功・失敗・再入、deadline 直前・到達・超過・
        late settlement を exact return/state/call count で検証する。
    -   完了時には admission-limits・queue-lifecycle・deadline-fences の3 case の対象分岐に対応する assertion が一意に存在し、queue、timer、listener、child、DB
        registration の未分類が0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.8, 2.9, 2.10, 2.11, 2.12,
        7.2, 7.3_
    -   _Boundary: サムネイル管理 admission・lifecycle implementation test_
    -   _Depends: 6.1_

-   [x] 6.3 reservation、削除、再生成、cleanup、restart の implementation case を完成させる

    -   `test/server/thumbnail-management/imp/output-reservation.test.ts` と
        `test/server/thumbnail-management/imp/maintenance-branches.test.ts` に Design 7.6 の concrete named case を実装
        する。
    -   同名 race、claim、temporary publish、owned cleanup、取得・削除の部分失敗、照合、再生成、active reservation 除
        外、restart、旧 callback 隔離を exact row/file/resource count で検証する。
    -   生成・再生成・cleanup の原失敗と後始末・照合失敗を logger ledger で分離し、各対象 identity・記録一回・処理可能な
        後続対象の継続を assertion にする。
    -   完了時には output-reservation・maintenance-branches の2 case の対象分岐に対応する assertion が一意に存在し、reservation、temporary/final JPEG、再起動資
        源の未分類が0件になる。
    -   _Requirements: 2.7, 2.10, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5,
        6.1, 6.2, 6.3, 6.4, 7.2, 7.3_
    -   _Boundary: サムネイル管理 filesystem・maintenance implementation test_
    -   _Depends: 6.1_

-   [x] 6.4 サムネイル登録 DB 境界を統合検証する

    -   `test/server/thumbnail-management/integration/thumbnail-db.integration.test.ts` に Design 7.7 の
        `insert-find-delete-and-db-failure-cleanup` case を実装する。
    -   temporary DB で `filePath`・`recordedId` の insert/find/delete、未解決保存、保存・削除失敗、部分結果と通知有無を
        exact row/call ledger で検証する。
    -   他 row 不変と後続可能な依頼・対象の継続を確認する。原 DB 失敗と cleanup 失敗の identity 付きの記録は imp の
        queue-lifecycle・output-reservation が検査する。
    -   完了時には success/failure の全経路で DB connection を harness 規則どおり解放し、未解決 connection・row・通知が
        0 件になる。
    -   _Requirements: 1.10, 2.10, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 4.2, 5.2, 5.4, 7.4_
    -   _Boundary: サムネイル登録 DB integration_
    -   _Depends: 6.2, 6.3_

-   [x] 6.5 JPEG filesystem 境界を統合検証する

    -   `test/server/thumbnail-management/integration/thumbnail-filesystem.integration.test.ts` に Design 7.7 の
        `exclusive-claim-temporary-publish-reconcile-and-cleanup` case を実装する。
    -   temporary root で `wx` claim、EEXIST 連番、temporary 出力、owned final publish、active reservation 除外、欠落
        row と未登録 file の照合を検証する。
    -   owned file だけを一回回収して他 JPEG と後続対象を維持する。identity 付きの失敗記録は imp の output-reservation・
        deadline-fences が検査する。
    -   完了時には success/failure 後の temporary directory/file、reservation、file handle の未解放が0件になる。
    -   _Requirements: 2.4, 2.5, 2.7, 2.10, 2.12, 3.1, 3.3, 3.5, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 7.4_
    -   _Boundary: JPEG filesystem integration_
    -   _Depends: 6.4_

-   [x] 6.6 synthetic child process 境界を統合検証する

    -   `test/server/thumbnail-management/integration/thumbnail-process.integration.test.ts` に Design 7.7 の
        `deadline-stop-failure-late-close-and-live-child-lease` case を実装する。
    -   isolated synthetic child で正常・異常 terminal、spawn failure、期限、停止成功・失敗、late close を接続する。親環境
        marker と exact command args は spec の TM-2.14・TM-2.6 が検査する。
    -   process/stop 失敗の identity 付きの記録は imp の deadline-fences が検査する。late close 後
        だけ timer、listener、child lease、queue slot、reservation を一回解放して後続 child を開始する。
    -   完了時には live child 最大1、DB・通知最大1、raw child output・実 path・実環境値の証跡0件になる。
    -   _Requirements: 1.2, 1.9, 2.1, 2.6, 2.8, 2.9, 2.11, 2.12, 2.13, 2.14, 6.3, 7.4_
    -   _Boundary: JPEG child process integration_
    -   _Depends: 6.5_

-   [x] 6.7 HTTP adapter 境界を統合検証する

    -   `test/server/thumbnail-management/integration/thumbnail-http.integration.test.ts` に Design 7.7 の
        `get-add-delete-regenerate-cleanup-and-overload-error` case を実装する。
    -   生成・取得・削除・再生成・cleanup、not-found、満杯 error の exact status/body/file と、満杯 error の 500 の後に
        続く request が成功することを検証し、route 所有を再実装しない。
    -   success/failure 後の request/response listener を各一回解放し、別 request の response/body/file を変更しない。
    -   完了時には HTTP case が全 terminal 結果で完了し、pending response・listener・誤配送が0件になる。
    -   _Requirements: 1.7, 1.8, 3.1, 3.2, 3.3, 4.1, 4.5, 5.1, 5.4, 6.4, 7.4_
    -   _Boundary: サムネイル管理 HTTP adapter integration_
    -   _Depends: 6.6_

-   [x] 6.8 IPC adapter 境界を統合検証する

    -   `test/server/thumbnail-management/integration/thumbnail-ipc.integration.test.ts` に Design 7.7 の
        `serialize-add-delete-regenerate-cleanup-and-error` case を実装する。
    -   videoFileId/thumbnailId、操作種別、成功・not-found・満杯・対象単位 regenerate 失敗を peer 間で接続し、後続対象と
        別 request の結果を混同しないことを検証する。
    -   success/failure 後の pending request と peer listener を各一回解放し、carrier の peer lifecycle を再実装しない。
    -   完了時には IPC case が全 terminal 結果で完了し、pending request・listener・誤相関が0件になる。
    -   _Requirements: 1.1, 1.7, 1.8, 3.2, 3.3, 4.1, 4.5, 4.6, 5.1, 5.4, 6.4, 7.4_
    -   _Boundary: サムネイル管理 IPC adapter integration_
    -   _Depends: 6.7_

-   [x] 6.9 未生成の所有一時JPEGの回収を分類する

    -   Requirement 2.12の一時JPEG未生成/既不存在を実filesystemで再現し、元生成失敗と後続queueを保持する。
    -   `thumbnail-absent-output-cleanup.integration.test.ts`で不存在、実EISDIR、errno無し故障を分ける。
    -   `imp/queue-lifecycle.test.ts`でDB保存失敗に伴う一時JPEGのENOENTと真の回収故障を分類し、元DB失敗を隠さない。
    -   所有一時JPEGのENOENTだけを削除目的達成として扱い、final/個別削除/汎用unlink契約を維持する。
    -   仕様/実装/結合の関連test、独立review、機能全体の品質判定を通すまで完了にしない。
    -   _Requirements: 2.12, 7.4, 7.5_
    -   _Boundary: owned temporary JPEG filesystem_
    -   _Depends: 6.5_

-   [x] 7. 機能固有の品質を閉じる
-   [x] 7.4 本機能の品質判定を満たす

    -   Task 6.1から6.9の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
