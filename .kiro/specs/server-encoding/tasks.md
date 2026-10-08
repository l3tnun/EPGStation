# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation と Node.js 24 必須・26 追加 matrix は `server-application-runtime` が所有する。設定 schema、
省略時 1,024、正の安全な整数検証、完全な内部設定複製、および公開設定からの除外は `server-configuration` の起動時設定
task 完了を前提とする。共有 process の spawn、枠予約、opaque managed handle、 `requestStop()`、signal 所有権は
`server-media-process-management`、録画済み番組・録画ファイルの登録、サイズ更新、削除は `server-recorded-content`、受
付・開始・取消・失敗・結果反映失敗の記録先は `server-operational-logging` の owner contract を利用する。以下の 21
executable leaf task はそれぞれ 1〜3 時間の単一責務単位とする。各 leaf が変更または追加する具体 file は次表を正本とし、
characterization task は production file を読取専用で参照する。

本 spec は、受付・待機・実行・取消・進捗・結果反映というエンコード固有状態だけを実装・検証する。IPC
envelope、request/reply timeout、再送は `server-process-messaging`、browser・hook への配送は
`server-event-and-hook-delivery` と `server-service-interface`、録画済み番組削除などの跨域 command 順序は
`server-workflow-coordination` の後続 integration task に委譲する。存在しない retry、generation、再照合、永続 queue、互
換移行は追加しない。

| Leaf | Concrete target                                                                                                                                                                                                                                                              | Test type                                          | Local Depends                                                               | Verification command                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`                                                                                                                   | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`                                                                                                    |
| 1.2  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`src/model/api/encode/EncodeApiModel.ts`<br>`src/model/service/encode/IEncodeManageModel.ts`                                                                      | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`                                                                                                    |
| 2.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`                                                                                                                   | `unittest/spec`・`unittest/imp`                    | `1.1`                                                                       | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`                                                                                                    |
| 2.2  | `test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`<br>`src/model/api/encode/EncodeApiModel.ts`                                                                                                                  | `integration`                                      | `1.2, 2.1`                                                                  | `npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts`                                                                                                                                                                   |
| 2.3  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`                                                   | `unittest/spec`・`unittest/imp`・`integration`     | `2.2`                                                                       | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 3.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`<br>`src/model/service/encode/EncoderModel.ts`     | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 3.2  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`src/model/service/encode/EncodeFileManageModel.ts` | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 3.3  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`src/util/ProcessUtil.ts`                           | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 3.4  | `test/server/encoding/encode-api.spec.test.ts`<br>`test/server/encoding/encodermodel-dirpath.imp.test.ts` | `unittest/spec`・`unittest/imp` | `3.2` | `npm run test:server:spec -- test/server/encoding/encode-api.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encodermodel-dirpath.imp.test.ts` |
| 4.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`src/model/event/EncodeEvent.ts`                                                                                    | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`                                                                                                    |
| 4.2  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeManageModel.ts`<br>`src/model/service/encode/EncoderModel.ts`     | `unittest/spec`・`unittest/imp`・`integration`     | `3.1, 3.3`                                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 4.3  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`src/model/service/encode/EncodeFileManageModel.ts` | `unittest/spec`・`unittest/imp`・`integration`     | `3.1, 3.2`                                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 5.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeFinishModel.ts`                                                   | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 5.2  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncodeFinishModel.ts`                                                   | `unittest/spec`・`unittest/imp`・`integration`     | `5.1`                                                                       | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 5.3  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/{EncodeManageModel,IEncodeFinishModel,EncodeFinishModel}.ts`            | `unittest/spec`・`unittest/imp`・`integration`     | `2.3, 5.2`                                                                  | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 6.1  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts`                                                                                                      | `unittest/spec`・`unittest/imp`・`integration`     | `2.2, 2.3, 3.1, 4.1, 4.2, 4.3, 5.2, 5.3`                                    | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |
| 6.2  | `test/server/encoding/encode-boundaries.integration.test.ts`<br>`src/model/service/encode/EncoderModel.ts`<br>`src/util/ProcessUtil.ts`                                                                                                                                      | `integration`                                      | `3.2, 3.3, 4.2, 4.3, 5.2, 5.3`                                              | `npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts`                                                                                                                                                                   |
| 6.3  | `test/server/encoding/encode-contracts.spec.test.ts` | `unittest/spec` | `1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.2, 5.3, 6.1, 6.2` | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts` |
| 6.4  | `test/server/encoding/encode-internals.test.ts`                                                                                                                                                                                                                              | `unittest/imp`                                     | `6.3`                                                                       | `npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`                                                                                                                                                                                        |
| 6.5  | `.kiro/specs/server-encoding/design.md` | レビュー | `6.4` | なし（Design §9.1の54行のレビュー） |
| 6.6  | `test/server/encoding/encode-boundaries.integration.test.ts`                                                                                                                                                                                                                 | `integration`                                      | `6.2, 6.5`                                                                  | `npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts`                                                                                                                                                                   |
| 6.7  | `test/server/encoding/encode-contracts.spec.test.ts`<br>`test/server/encoding/encode-internals.test.ts`<br>`test/server/encoding/encode-boundaries.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `2.1, 2.2, 2.3, 5.2, 5.3, 6.3, 6.4, 6.5, 6.6` | `npm run test:server:spec -- test/server/encoding/encode-contracts.spec.test.ts`<br>`npm run test:server:imp -- test/server/encoding/encode-internals.test.ts`<br>`npm run test:server:integration -- test/server/encoding/encode-boundaries.integration.test.ts` |

-   [x] 1. 依頼、識別番号、およびメモリー内状態の既存契約を仕様テストで固定する
-   [x] 1.1 依頼受付と process-local 識別・再起動契約を characterization する

    -   既存 production code は変更せず、録画済み番組、変換元ファイル、変換方法、保存先、相対 directory、および依頼ごと
        の元ファイル削除指定が一件の待機 job に保持されることを `unittest/spec` で固定する。
    -   同時実行数が 0 以下なら provider、識別番号、待機 job、追加通知を作らず拒否し、受付成功時だけ正の整数 ID と追加通
        知を返すことを検証する。
    -   新しい機能 instance は空の待機・実行一覧と ID 1 から始まり、以前の依頼・途中出力を復元、追跡、整理しないことを
        `unittest/imp` で確認する。
    -   `Number.MAX_SAFE_INTEGER` を割り当てた次の ID が 1 になり、新しい衝突探索、世代、永続 ID を追加しない現行規則を
        固定する。
    -   完了時には、正常受付、同時実行数 0、再起動相当、最大安全整数折返しの各 fixture が承認済み結果を再現
        し、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.6, 7.2, 7.3, 7.4, 7.5_
    -   _Boundary: 変換操作窓口・受付／待機管理_

-   [x] 1.2 待機・実行一覧と公開業務データを characterization する

    -   待機中と実行中を別配列で返し、各項目に識別番号、変換方法、録画済み番組を含める既存の `unittest/spec` を追加す
        る。
    -   録画済み情報を結合した一覧で、進捗率と message は実行中かつ取得済みの場合だけ現れ、空一覧も二つの空配列として返
        ることを検証する。
    -   `encodeQueueLimit` が変換依頼、一覧、追加・取消・完了 event、公開設定、API 向け DTO、IPC 業務 payload の field
        にならないことを interface contract test で固定する。
    -   HTTP routing、response status、Socket.IO 配送は後続 owner に残し、本 task は変換操作窓口の業務 DTO shape だけを
        検証する。
    -   完了時には、待機のみ、実行のみ、混在、進捗あり・なし、空一覧の各結果と公開 key 集合が観測でき、内部待機上限は現
        れない。
    -   検証は `unittest/spec` と `unittest/imp` で行い、`integration` と実機確認は不要とする。
    -   _Requirements: 1.11, 4.1, 4.2_
    -   _Boundary: 変換操作窓口・一覧契約_

-   [x] 2. 同期 queue admission と起動時上限を TDD で実現する
-   [x] 2.1 起動 snapshot、同期予約、および副作用なし拒否を RED から GREEN まで閉じる

    -   `server-configuration` から受け取った省略時 1,024 と、1、1,024、`Number.MAX_SAFE_INTEGER` を機能構築時に保持
        し、0、負数、小数、`NaN`、`Infinity`、安全でない整数、非数値で構築を失敗させる `unittest/spec` を先に追加する。
    -   同じ event loop で複数受付を開始し、最初の非同期境界より前に `受付処理中 + 待機中` を検査・予約して上限を超え
        ず、実行中は計数しない目標を deferred fixture で定義する。
    -   上限到達時は新しい一件だけを同期的に拒否し、ID counter、job provider、待機・実行一覧、追加通知、および受付済み依
        頼が不変であることを個別 assertion にする。
    -   実行権待ち、job 生成、option 設定、待機列追加の各失敗で、予約と取得済み実行権を `finally` から一回だけ戻し、不完
        全な job を残さない目標を `unittest/imp` で定義する。
    -   稼働中に設定 source を変更しても既存 instance の上限は変わらず、新しい instance だけが変更後 snapshot を使うこと
        を確認する。
    -   既存 characterization が成功したまま、未実装の待機上限、同期予約、および failure cleanup だけが意図した理由で
        RED になることを確認してから、次の最小実装へ進む。
    -   構築時に待機上限を snapshot し、正の安全な整数でなければ機能を起動させない consumer-side guard を追加す
        る。default、設定 file parse、公開 projection は変更しない。
    -   `受付処理中 + 待機中` の検査と受付予約を await より前の同じ同期区間で行い、予約済みの後続受付が更新済み件数を観
        測するようにする。
    -   成功時は予約一件を待機 job 一件へ移し、失敗・拒否時は予約、実行権、および部分生成物を一回だけ戻す最小変更に限定
        する。
    -   実行中 job を上限へ含めず、上限拒否に retry、別 queue、永続状態、ID 探索を追加しない。
    -   実装後に同じ target test を再実行して GREEN を確認する。
    -   完了時には全 interleave で `受付処理中 + 待機中 <= encodeQueueLimit`、拒否時副作用 0、失敗後残留予約 0 が観測さ
        れる。
    -   検証は `unittest/spec` と `unittest/imp` で行う。
    -   _Requirements: 1.6, 1.7, 1.8, 1.9, 1.10_
    -   _Boundary: 受付／待機管理_
    -   _Depends: 1.1_

-   [x] 2.2 受付境界と既存操作契約を結合検証する

    -   上限 1 と 1,024 の synthetic 設定で、実行権待ちを含む同時受付、満杯拒否、受付失敗後の再受付、および実行中移行後
        の空き受付を `integration` で交差させる。
    -   受付成功だけが既存の正の ID と追加 event を一回返し、拒否は既存エラー経路を使って新しい成功 response field を作
        らないことを確認する。
    -   設定 source の稼働中変更、再起動相当の新 instance、および公開 DTO key 集合を同じ fixture で確認し、snapshot と非
        公開制約を結合する。
    -   完了時には、limit+1 件を同じ event loop から開始しても受付済み件数が上限と一致し、余分な ID、job、通知、公開
        field が 0 件になる。
    -   実機確認は不要とし、共有 server test foundation 上の `unittest/spec`、`unittest/imp`、`integration` で検証する。
    -   _Requirements: 1.1, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_
    -   _Boundary: 設定 snapshot・受付／待機管理・変換操作窓口 integration_
    -   _Depends: 1.2, 2.1_

-   [x] 2.3 録画済みresource利用leaseとread-only snapshotを RED から GREEN まで閉じる

    -   受付枠予約後、待機列への公開、ID・job・追加通知、録画情報read、process開始より前に`encoding`用途のexact leaseを
        一回取得し、取得失敗・期限超過・状態不明ではそれらの副作用が0件になる目標を`unittest/spec`で定義する。
    -   同じtokenを待機、実行、結果反映のsettlement完了まで保持する。結果settlement後のexact releaseはTask 5.3だけが所有
        し、late/double/stale releaseが別jobへ作用しないことをdeferred resultとcall ledgerで定義する。
    -   待機中と実行中のrecorded IDを同じ同期境界で重複除去したread-only集合として返し、安全に列挙できない場合は部分集合
        でなく`unknown`を返す。snapshot取得によるqueue、取消、lease操作、通知を各0回にする。
    -   PMのgeneration、request identity、通常5秒carrier、parent deletion gateを本specへ複製せず、consumer request・
        token保持・snapshot projectionだけをtargetにする。
    -   既存characterizationが成功したまま、queue公開前acquire、exact release、known/unknown snapshotの未実装契約だけが
        意図した理由でREDになることを確認してから、次の最小実装へ進む。
    -   `server-process-messaging`が提供するresource-use carrierを受けるconsumer portを定義し、受付予約から待機公開前
        acquireへ進み、同じexact tokenをjobへ保持する。取得失敗では予約を一回解放し、ID・job・queue・通知・read・spawnを
        作らない。
    -   待機取消、job生成失敗、queue追加失敗など結果settlementへ到達しない経路だけで同じtokenを一回releaseする。結果
        settlementへ到達したjobのreleaseはTask 5.3へ委譲し、送信・応答未確認から削除可能とは推測しない。release failure
        によって別jobのqueue finalizationを重複させない。
    -   `EncodeManageModel`の待機・実行registryから副作用なしのknown集合またはunknownを返すread-only providerを実装す
        る。公開API・業務IPC payloadへtokenや内部上限を露出しない。
    -   PM carrier実装は`server-process-messaging`、consumer portとsnapshot providerの一回bindingは
        `server-service-interface`の後続service child composition taskへ明示的に委譲し、本taskでは
        `ModelContainerSetter`を変更しない。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時にはqueue公開前leaseなしjob、重複release、部分snapshotが0件で、consumer portとread-only providerを独立した
        contract doubleから検証できる。
    -   検証は`unittest/spec`、`unittest/imp`、PM contract doubleを使うdomain-local `integration`で行う。
    -   _Requirements: 1.1, 3.1, 3.2, 5.1, 5.2_
    -   _Boundary: 録画済みresource利用consumer・利用中snapshot_
    -   _Depends: 2.2_

-   [x] 3. FIFO 実行、開始前確認、および外部 command 契約を固定する
-   [x] 3.1 FIFO、二種類の実行枠、および終了後の次依頼を characterization する

    -   既存 production code は変更せず、待機列先頭を受付順に一件ずつ選び、本機能の同時実行数未満の場合だけ実行中へ移す
        挙動を `unittest/spec` で固定する。
    -   job 開始が共有 media process port を一回利用し、共有枠取得・spawn 開始が失敗した依頼を失敗として実行中から除き、
        待機列へ戻さないことを `integration` で確認する。
    -   正常終了、異常終了、および開始失敗で対象だけを実行中一覧から除いた後、次の event loop で先頭の待機依頼を確認す
        る。
    -   result reflection の完了を queue 枠解放の条件にせず、queue owner が次依頼確認、結果反映 owner が録画済み管理への
        依頼を独立して進める既存境界を固定する。
    -   完了時には、複数待機、本機能上限、共有枠拒否、開始失敗、正常・異常終了の各系列で、開始順、最大実行数、失敗対象、
        次の対象が一意に観測できる。
    -   検証は `unittest/spec`、`unittest/imp`、`integration` で行い、process spawn/stop substrate 自体は変更しない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.6, 6.9_
    -   _Boundary: 受付／待機管理・変換 job integration_

-   [x] 3.2 開始前確認と衝突しない出力候補を characterization する

    -   録画ファイル登録、録画済み番組、放送局、実入力ファイル、変換方法、保存先と必要 directory を順に確認し、一つでも
        欠ければ外部 process を開始せず失敗することを `unittest/spec` で固定する。
    -   出力ありでは元名と suffix から候補を作り、既存ファイルと同時実行中の予約を避けて `(1)`、`(2)` と進み、終了時に当
        該予約を解放することを `unittest/imp` で確認する。
    -   共有枠取得または process 開始が reject した場合は、既に取得した exact 出力予約を一回解放して元の開始 error を呼
        出元へ返す RED を先に追加し、`EncoderModel.start()` の開始失敗境界だけを最小修正する。
    -   出力なしの方法は output を `null` とし、依頼の directory だけを command 環境へ渡して出力名予約を作らないことを検
        証する。
    -   filesystem fixture は synthetic temporary root だけを使い、管理保存先の domain 登録や共有 process spawn を再実装
        しない。
    -   完了時には、6 種の開始前失敗で spawn 0 件、衝突 fixture で重複 path 0 件、開始 reject と終了後の残留予約 0 件が
        観測され、開始 reject では exact path の解放一回と元 error が再現される。
    -   検証は `unittest/spec`、`unittest/imp`、共有 process port を接続した `integration` で行い、実機確認は不要とす
        る。
    -   _Requirements: 3.1, 3.2_
    -   _Boundary: 変換 job・出力名管理_

-   [x] 3.3 command 置換、35 環境変数、および実行時間上限を characterization する

    -   実行ファイルの `%NODE%`、引数の `%ROOT%`、`%SPACE%`、`%INPUT%`、出力ありの場合だけの `%OUTPUT%` を既存の半角空白
        分割規則で置換し、出力なしでは `%OUTPUT%` literal を維持することを `unittest/spec` と `integration` で固定する。
    -   親 process 環境を継承し、Design に列挙された 35 key をすべて encoding 値で上書きし、任意欠損を空文字、数値を 10
        進文字列、放送局名を `CHANNELNAME` のまま渡すことを key 集合、複数 stale 親値、および isolated child の代表値で
        検証する。
    -   `DIR` と `SUBDIR` の出力あり・出力なし・directory なしを区別し、未定義値や別名 key を作らないことを
        `unittest/imp` で確認する。
    -   録画時間と明示 rate の積、rate 省略時の倍率 4 で timer を設定し、境界到達時に通常の取消処理を一回開始することを
        fake timer で固定する。
    -   command の引用符・shell 文法、未知 token の新規解釈、rate の新しい範囲、開始前 deadline、停止 retry を追加しな
        い。
    -   完了時には、5 置換、35 key、欠損・数値変換、明示 rate・既定 4 の各 fixture が承認済み spawn request と取消回数を
        再現し、3.3 固有の production code 差分がない。
    -   検証は `unittest/spec`、`unittest/imp`、synthetic process adapter の `integration` で行う。
    -   _Requirements: 3.3, 3.4, 3.5, 3.7, 3.8, 3.9_
    -   _Boundary: 変換 job・command adapter_

-   [x] 3.4 出力ディレクトリの保存先外指定を一つのTDD単位で閉じる

    -   手動の変換依頼で`directory`が`..`・先頭`/`の後の`..`・NULにより録画保存先の外を指す場合に依頼を待機列へ追加せず
        失敗し、`a/../b`・`/anime`は従来どおり受け付ける期待値を、書式展開後に外を指す登録済みの値は親保存先の直下へ出力
        して録画保存先の外にfileを作らない期待値とともに先に定義し、現行実装でREDになることを確認する。
    -   共通の判定関数を手動依頼の受付と出力先決定へ接続する最小実装を行い、出力名の選択、環境変数、結果登録の既存契約を
        変えない。
    -   完了時には、同じtarget testがGREENとなり、外を指す指定で保存先の外に作られるfileが0件になる。
    -   _Requirements: 1.1, 3.1_
    -   _Boundary: 手動依頼の受付・出力先決定_
    -   _Verification: unittest/spec RED, unittest/imp GREEN_
    -   _Depends: 3.2_

-   [x] 4. 進捗、取消、および途中出力 cleanup を検証する
-   [x] 4.1 進捗の取得・非推定・通知を RED から GREEN まで閉じる

    -   stdout の一行が `type: "progress"`、数値 `percent`、文字列 `log` をすべて持つ場合だけ実行中情報を更新することを
        `unittest/spec` で先に固定する。完全な JSON を一回の data event で受ける既存契約、複数行、複数 chunk に分割され
        た一行、および不正行後の有効行をそれぞれ反例にする。
    -   不正 JSON、別 type、field 欠損、および進捗を出さない command では進捗を生成・推定せず、以前に存在しない値を一覧
        へ追加しないことを確認する。
    -   有効な進捗更新ごとに encoding domain の更新 event を一回発行し、browser への集約・配送回数は後続 delivery owner
        に残す。
    -   分割された有効行を失う現行差だけが意図した理由で RED になることを確認してから、stdout chunk を一行境界とみなさ
        ず、完結行を一回だけ処理する最小の line framing を実装する。状態反映後に更新 event を発行し、不正入力では既存値
        を変更しない。
    -   BufferのUTF-8多byte文字内分割をdecoderで保持する。改行なしの不正recordは次の完結JSON chunkで破棄して再同期し、未
        完recordは64KiBを内部上限として超過時に破棄する。terminal時はdecoderの未完byteとrecord bufferを破棄する。
    -   完了時には、有効、不正、欠損、進捗なしの各入力で内部状態、一覧 field、domain event 回数が一意に観測でき、一回の
        完全 JSON と分割 JSON の両方が同じ進捗結果を再現する。
    -   検証は `unittest/spec` と `unittest/imp` で行い、実機確認は不要とする。
    -   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
    -   _Boundary: 変換 job・変換イベント・一覧情報_

-   [x] 4.2 待機中・実行中・番組単位の取消を managed handle 契約へ結合する

    -   待機中の対象は開始せず待機列から除き、実行中の対象は job が保持する opaque managed handle の `requestStop()` へ
        一回だけ停止を依頼する `integration` test を追加する。
    -   時間上限、明示取消、および優先度入れ替えが同じ対象で競合しても同じ stop request operation へ参加し、encoding 側
        から child、PID、signal を直接操作しないことを確認する。
    -   `requestStop()` の応答を process terminal とみなさず、running 一覧からの除去と途中出力 cleanup は外部 process の
        終了通知後だけ行う。
    -   録画済み番組単位の取消は該当する待機・実行 ID を固定して全件を試し、個別失敗を記録し、一件以上失敗なら呼出元へ失
        敗を返す既存挙動を固定する。
    -   取消受付時の domain event は各 ID について一回発行し、録画済み削除 workflow、IPC transport、browser 配送順を本
        task へ持ち込まない。
    -   完了時には、待機取消で spawn 0 件、実行中取消・時間上限で managed stop 1 operation、番組単位取消で全対象試
        行、direct signal 0 件が観測される。
    -   検証は `unittest/spec`、`unittest/imp`、`server-media-process-management` consumer `integration` で行う。managed
        handle の production adapter 変更は同 owner spec の task が一度だけ所有する。
    -   _Requirements: 2.3, 3.5, 5.1, 5.2, 5.3, 5.4_
    -   _Boundary: 受付／待機管理・変換 job・managed process consumer integration_
    -   _Depends: 3.1, 3.3_

-   [x] 4.3 異常終了・取消時の途中出力 cleanup を RED から GREEN まで閉じる

    -   異常終了または取消で当該 job が作成しかけた出力だけを best-effort に削除し、出力なしでは unlink を要求しないこと
        を `unittest/spec` で固定する。
    -   正常終了では出力を途中成果物として削除せず、すべての terminal 分岐で出力名予約、timer、listener を当該 job につ
        いて解放することを `unittest/imp` で確認する。
    -   cleanup 失敗は運用ログ port へ渡して queue finalization を妨げず、対象を実行中から除いて次の待機依頼を確認する。
    -   新しい機能 instance が再起動前の途中出力を探索・整理しないことを再確認し、orphan adoption、再照合、generation
        cleanup を追加しない。
    -   遅延または重複した terminal event で予約解放、途中出力削除、完了 callback、queue finalization、および次依頼開始
        が二重になる現行差を RED にし、副作用より前の同期 one-shot guard と当該 job が所有する timer・listener の一回だ
        けの解放を最小実装する。他 owner の listener を一括削除しない。
    -   完了時には、異常、取消、正常、出力なし、unlink 失敗、再起動相当の各 fixture で、削除対象、log、queue、予約残数が
        承認済み値になる。
    -   検証は `unittest/spec`、`unittest/imp`、temporary filesystem の `integration` で行う。
    -   _Requirements: 2.5, 6.9, 7.1, 7.5_
    -   _Boundary: 変換 job・出力名管理・受付／待機管理 integration_
    -   _Depends: 3.1, 3.2_

-   [x] 5. 結果登録成功を元ファイル削除の commit point にする
-   [x] 5.1 正常な結果反映と削除失敗境界を RED から GREEN まで閉じる

    -   出力ありでは新しい録画ファイル登録、出力なしでは元ファイルサイズ更新を録画済み管理 port へ依頼することを
        `unittest/spec` で先に固定し、未成立の契約だけを最小実装する。
    -   同じ元ファイルを使う別の待機・実行 job があれば元ファイル削除指定を抑止し、反映成功かつ別 job なしの場合だけ削除
        候補になることを検証する。
    -   反映成功後に削除不要または削除成功なら、画面更新要求と、録画済み番組 ID、新規録画ファイル ID または `null`、変換
        方法を持つ完了 domain outcome を発行する。
    -   反映成功後の元ファイル削除失敗は結果 settlement を待つ管理側で記録し、後続の画面更新要求と完了 outcome を発行しない既存分岐を
        `unittest/imp` で固定する。
    -   IPC envelope、operation ID、timeout、再送、browser・hook 配送、および跨域 workflow 順序は後続 owner に残す。
    -   完了時には、追加、サイズ更新、同一 source job、削除不要、削除成功、削除失敗の各 fixture で port call と domain
        outcome が承認済み順序・回数を再現する。
    -   検証は `unittest/spec`、`unittest/imp`、fake recorded-content port の `integration` で行う。
    -   _Requirements: 6.1, 6.2, 6.3, 6.5, 6.7, 6.8_
    -   _Boundary: 結果反映・変換イベント_

-   [x] 5.2 結果登録・サイズ更新失敗時の削除禁止を RED から GREEN まで閉じる

    -   新規録画ファイル登録を reject させ、失敗を記録して元ファイル削除を 0 回にし、画面更新要求と新規録画ファイル ID
        `null` の完了 outcome へ進む `unittest/spec` を先に追加する。
    -   元ファイルサイズ更新を reject させた場合も、元ファイル削除 0 回と完了 outcome 一回を同じ契約として検証する。
    -   `removeOriginal` が真、同じ source job がない条件を明示して、削除されない理由が登録・更新失敗だけになる反例を作
        る。
    -   retry、quarantine、generation、再照合状態、IPC 業務 operation を新設せず、現在の一回の結果反映入力に対する効果だ
        けを target にする。
    -   既存 characterization は成功したまま、現行の登録・更新失敗後に元ファイル削除へ進む差だけが意図した理由で RED に
        なることを確認してから、次の最小修正へ進む。
    -   録画ファイル登録またはサイズ更新の成功を明示的に保持し、失敗時は error 記録後に元ファイル削除分岐を通らない最小
        変更にする。
    -   反映失敗時も画面更新要求と完了 outcome へ進み、新規録画ファイル ID は `null` とする既存 payload shape を維持す
        る。
    -   反映成功時だけ、元ファイル削除指定と同一 source job 不在を評価して削除を依頼する。
    -   反映成功後の元ファイル削除失敗では後続通知へ進まない既存分岐を変えず、失敗を成功扱いにしない。
    -   実装後に同じ target test を再実行して GREEN を確認する。
    -   完了時には 5.2 と同じ target test が通り、すべての反映失敗 fixture で元ファイル削除 0 回、完了 outcome 1 回にな
        る。
    -   検証は `unittest/spec`、`unittest/imp`、fake recorded-content port の `integration` で行う。
    -   _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8_
    -   _Boundary: 結果反映・変換イベント_
    -   _Depends: 5.1_

-   [x] 5.3 結果settlement後のrecorded resource lease解放を RED から GREEN まで閉じる

    -   `EncodeFinishModel.finishEncode()`による登録・サイズ更新・条件付き元file削除と、その成功・失敗の結果settlementが
        完了するまで、Task 2.3で取得した同じexact lease tokenを保持するtarget testを先に追加する。
    -   結果反映成功、登録・更新失敗、元file削除失敗、正常・異常終了、待機取消、開始失敗を分け、結果settlementへ到達した
        jobは全経路でsettlement後にだけ一回releaseすることをcall ledgerで検証する。結果settlementへ到達しない経路の
        releaseはTask 2.3の責務として重複実装しない。
    -   同じservice child内の`IEncodeFinishModel`へ結果settlement Promiseを返すdirect local operationを追加し、
        `EncodeManageModel`がその完了を観測してからreleaseする最小実装にする。結果settlement専用のchild-local finish
        event listenerはdirect portへ置換して二重実行を0件にし、settlement内部の既存完了通知IPCは維持する。queue
        finalization、画面更新、完了outcome、元file削除の既存順序を変更しない。
    -   release失敗は記録するが、確定済みの結果、元file削除の成否、queue finalizationを巻き戻さず、別jobのtokenをrelease
        しない。二重terminal、late settlement、重複callbackでも同じtokenを高々一回releaseする。
    -   実装後に同じtarget testをGREENにし、`EncodeFinishModel.finishEncode()`の成功・失敗とresource releaseを接続する
        domain-local integrationを実行する。
    -   完了時には結果反映前のearly release、結果settlement後のlease残留、二重release、別job tokenのreleaseが0件となる。
    -   _Requirements: 3.1, 3.2, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
    -   _Boundary: 結果反映settlement・recorded resource lease release_
    -   _Depends: 2.3, 5.2_

-   [x] 6. エンコード lifecycle を domain 境界で結合検証する
-   [x] 6.1 受付から結果反映までの競合系列を決定論的に結合検証する

    -   deferred job、fake timer、fake recorded-content port、および managed process handle を使い、上限境界の同時受
        付、FIFO 開始、進捗、待機・実行取消、開始失敗、正常・異常終了を `integration` で交差させる。
    -   各系列で `受付処理中 + 待機中` が上限以下、本機能実行中数が同時実行数以下、共有枠要求が job ごとに一回、終了 job
        の queue 除去と次依頼確認が一回になることを確認する。
    -   出力あり・なし、結果反映失敗、同一 source job、元ファイル削除成功・失敗を組み合わせ、結果登録成功前の元ファイル
        削除が全系列で 0 回であることを検証する。
    -   domain event の発行条件と payload までを対象とし、IPC carrier、Socket.IO・hook 配送、録画済み削除 workflow の全
        体順序を再実装しない。
    -   完了時には、全 fixture が未処理 rejection、残留 reservation、待機・実行 job、timer、listener、出力名予約を残さ
        ず、期待した途中出力だけが整理される。
    -   検証は `unittest/spec`、`unittest/imp`、決定論的 `integration` で行い、実機確認は不要とする。
    -   _Requirements: 1.1, 1.5, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.5, 3.6, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1,
        6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1_
    -   _Boundary: 受付／待機管理・変換 job・結果反映 domain integration_
    -   _Depends: 2.2, 2.3, 3.1, 4.1, 4.2, 4.3, 5.2, 5.3_

-   [x] 6.2 隔離した外部 process と temporary filesystem で実行契約を確認する

    -   synthetic Node.js executable と synthetic 録画情報・temporary input だけを使い、実際の child process で command
        置換、35 環境変数、progress 一行、出力 file 作成、正常終了を確認する。
    -   取消・時間上限では opaque managed handle だけから停止を要求し、外部 process の終了後に途中出力を削除して次依頼へ
        進むことを確認する。
    -   出力ありの結果登録と出力なしのサイズ更新は fake recorded-content port へ接続し、実 DB、実録画 file、実
        URL、tuner、network、production command を使用しない。
    -   `server-media-process-management` が所有する spawn/stop test と重複して signal algorithm を再検証せず、encoding
        job が正しい request、stdio、handle、result を結ぶことだけを検証する。
    -   完了時には、隔離 process が残らず、temporary root 外への作成・削除 0 件、direct signal 0 件、期待した登録・更新
        要求と domain outcome が一回ずつ観測される。
    -   検証は `integration` と実機確認として Node.js 24 の隔離 process suite を実行し、Node.js 26 は共有追加 matrix に
        委譲する。
    -   _Requirements: 2.3, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 4.3, 4.4, 5.2, 6.1, 6.2, 7.1_
    -   _Boundary: 変換 job・managed process consumer・filesystem adapter integration_
    -   _Depends: 3.2, 3.3, 4.2, 4.3, 5.2, 5.3_

-   [x] 6.3 R1〜R7 の仕様 test の主 case を完成する

    -   R1からR7の49件を一意な`unittest/spec`主testへ割り当て、`encode-contracts.spec.test.ts`のtest titleから各ACを逆引きで
        きる形にする。
    -   各主testは戻り値だけでなく、queue、通知、port call、取消、結果反映、およびcleanupの意味ある結果をassertする。
    -   完了時には49件すべてが一つの主testへ追跡でき、未割当・重複・空assertionが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2,
        3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
        6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1_
    -   _Boundary: 録画ファイル変換 spec test case_
    -   _Depends: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.2, 5.3, 6.1, 6.2_

-   [x] 6.4 値域・分岐の意味ある assertion を閉じる

    -   待機上限、識別番号折返し、実行時間上限、command置換、環境変数、開始失敗、結果反映、およびfile削除分岐を
        `encode-internals.test.ts`で個別assertionする。
    -   完了時には値域・分岐testが全件成功し、spec test件数だけで代替していないことが観測できる。
    -   _Requirements: 8.2_
    -   _Boundary: 録画ファイル変換 internal assertions_
    -   _Depends: 6.3_

-   [x] 6.5 機能固有 test matrix の状態・競合・資源分類を完成する

    -   Design §9.1の54行のmatrixで受付前・待機・実行・成功・失敗・取消・再起動、同着受付、取消と期限の競合、late
        settlementを一意に分類する。
    -   待機枠、timer、process、途中出力、元fileの解放または保持を記録し、空欄と未分類を0件にする。
    -   完了時にはDesign §9.1の54行が必須列と主testのlocatorを持ち、空欄と未分類が0件である。
    -   _Requirements: 8.3_
    -   _Boundary: 録画ファイル変換 Design test matrix_
    -   _Depends: 6.4_

-   [x] 6.6 HTTP・IPC・filesystem・process 境界を結合検証する

    -   HTTP一覧・追加・取消、IPCのfile追加・size更新・元file削除・完了通知、filesystem、およびisolated child processを
        `encode-boundaries.integration.test.ts`で接続する。
    -   DB直接更新はrecorded-content owner委譲として非適用理由を保持し、external processは6.2のsynthetic executableだけ
        を使う。
    -   完了時には各境界の成功・失敗・cleanup結果が具体的にassertされ、実録画情報、実保存先、実URL、未加工child出力が証
        拠へ残らない。
    -   _Requirements: 8.4_
    -   _Boundary: 録画ファイル変換 external boundaries integration_
    -   _Depends: 6.2, 6.5_

-   [x] 6.7 本機能の品質判定を満たす

    -   Task 6.3から6.6の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 2.1, 2.2, 2.3, 5.2, 5.3, 6.3, 6.4, 6.5, 6.6_
    -   _Requirements: 8.5_
