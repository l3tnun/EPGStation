# Implementation Plan

---

## Cross-spec execution prerequisites

共有 server test foundation と Node.js 24 必須・26 追加 matrix は `server-application-runtime` が所有する。さらに、
`server-configuration`、`server-operational-logging`、`server-tuner-access`、`server-recorded-content`、および
`server-media-process-management` の承認済み provider contract を実装してから本 spec を実行する。本 spec は共有
foundation、設定既定値、tuner stream 取得、録画 file/domain 解決、process group 停止、論理実行枠解放を重複実装せず、映像
配信固有の test と承認済み差分だけを追加する。以下の28 executable leaf taskは各1〜3時間とし、変更または追加する具体 file
は次表を正本とする。characterization taskはproduction fileを読取専用で参照する。Task 8 の leaf に 8.3 は置かない（8.2 の次は 8.4）。

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Test type                                          | Local Depends                                                                                   | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/media-delivery/live-delivery.spec.test.ts`<br>`test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/live-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-tuner.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                      |
| 1.2  | `test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`                                                                                                                                                           | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`                                                                                                                                                                                                                                                                                                                                   |
| 1.3  | `test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`src/lib/TailStream.ts`<br>`src/model/operator/recorded/RecordedPlaybackSourceProvider.ts`                                                                                                                                                                                                                                                                                                                                                          | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1.4  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/restart.spec.test.ts`<br>`src/model/service/stream/base/StreamBaseModel.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                                                                                                                                                                       | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts` <br>`npm run test:server:spec -- test/server/media-delivery/restart.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.5  | `test/server/media-delivery/command.spec.test.ts`<br>`test/server/media-delivery/command.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`src/util/ProcessUtil.ts`                                                                                                                                                                                                                                                                                                 | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/command.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/command.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.6  | `test/server/media-delivery/kodi.spec.test.ts`<br>`test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`src/model/api/video/VideoApiModel.ts`<br>`src/model/api/ApiUtil.ts`                                                                                                                                                                                                                                                                                                            | `unittest/spec`・`integration`                     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/kodi.spec.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.1  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.2  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.3  | `test/server/media-delivery/live-delivery.spec.test.ts`<br>`test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`                                                                                                                                                                               | `unittest/spec`・`unittest/imp`・`integration`     | `2.2`                                                                                           | `npm run test:server:spec -- test/server/media-delivery/live-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-tuner.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                   |
| 2.4  | `test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`                                                                                                                                                        | `unittest/spec`・`unittest/imp`・`integration`     | `2.2`                                                                                           | `npm run test:server:spec -- test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-recorded-content.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                |
| 2.5  | `test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/recorded-use-snapshot.test.ts`<br>`test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                                                          | `unittest/spec`・`unittest/imp`・`integration`     | `2.4; server-recorded-content Task 2.4`                                                         | `npm run test:server:spec -- test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-use-snapshot.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-recorded-content.integration.test.ts` <br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`                                                                                                                                                                                                                                                                                                                                                     |
| 3.1  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`<br>`src/model/service/stream/util/HLSFileDeleterModel.ts`                                                                                                                                                                                          | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3.2  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`<br>`src/model/service/stream/util/HLSFileDeleterModel.ts`                                                                                                                                                                                                                                                                        | `unittest/spec`・`unittest/imp`                    | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3.3  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                                                                                                                                                                                                    | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4.1  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`src/model/service/stream/base/StreamBaseModel.ts`                                                                                                                                                                                                                                                         | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5.1  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`<br>`src/model/service/stream/base/StreamBaseModel.ts` | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-tuner.integration.test.ts`                                                                                                                                                                                                                                                               |
| 5.2  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`src/model/service/stream/util/HLSFileDeleterModel.ts`<br>`src/model/service/stream/util/IHLSFileDeleterModel.ts`                                                                                                                                                                                          | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5.3  | `test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`<br>`src/model/service/stream/base/StreamBaseModel.ts`                                                                                                                                                                                              | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5.4  | `test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`src/model/service/stream/util/HLSFileDeleterModel.ts`                                                                                                                                                                                                                                     | `unittest/imp`・`integration`                      | `4.1, 5.3`                                                                                      | `npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6.1  | `test/server/media-delivery/direct-stop.spec.test.ts`<br>`test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`<br>`src/model/service/stream/manager/StreamManageModel.ts`                                                                       | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/direct-stop.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts` <br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`                                                                                                                                                                                                                                                                                                                                                                            |
| 7.1  | `test/server/media-delivery/kodi.spec.test.ts`<br>`test/server/media-delivery/command.test.ts`<br>`test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`src/model/api/ApiUtil.ts`<br>`src/model/api/video/VideoApiModel.ts`                                                                                                                                                                                                                                                            | `unittest/spec`・`unittest/imp`・`integration`     | なし（共有foundationのみ）                                                                      | `npm run test:server:spec -- test/server/media-delivery/kodi.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/command.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8.1  | `test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`                                                                                                                                                                                                                                                             | `unittest/imp`・`integration`                      | `2.5, 3.3, 4.1, 5.4, 6.1, 7.1`                                                                  | `npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts` <br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                                                                                                |
| 8.2  | `test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`                                                                                                                | `integration`                                      | `1.5, 5.4, 6.1, 7.1, 8.1`                                                                       | `npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`                                                                                                                                                                        |
| 8.4  | `test/server/media-delivery/live-delivery.spec.test.ts`<br>`test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`test/server/media-delivery/command.spec.test.ts` | `unittest/spec` | `8.1, 8.2`                                                                                      | `npm run test:server:spec -- test/server/media-delivery/live-delivery.spec.test.ts`<br>`npm run test:server:spec -- test/server/media-delivery/recorded-delivery.spec.test.ts`<br>`npm run test:server:spec -- test/server/media-delivery/hls-lifecycle.spec.test.ts`<br>`npm run test:server:spec -- test/server/media-delivery/command.spec.test.ts` |
| 8.5  | `test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/recorded-delivery.test.ts`<br>`test/server/media-delivery/hls-lifecycle.test.ts`<br>`test/server/media-delivery/command.test.ts`<br>`src/model/service/stream/base/LiveStreamBaseModel.ts`                                                                                                                                                                                                                              | `unittest/imp` | `8.4`                                                                                           | `npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/recorded-delivery.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/hls-lifecycle.test.ts`<br>`npm run test:server:imp -- test/server/media-delivery/command.test.ts`                                                                                                                                                                                                                                                                                                        |
| 8.6  | `.kiro/specs/server-media-delivery/design.md` | レビュー | `8.5`                                                                                           | なし（Designの88行のレビュー） |
| 8.7  | `test/server/media-delivery/media-delivery-http.integration.test.ts`<br>`test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`                                                                                                                | `integration`                                      | `8.2, 8.6`                                                                                      | `npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts` <br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-process.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-tuner.integration.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-recorded-content.integration.test.ts`                                                                                                                                                                        |
| 8.8  | `test/server/media-delivery/live-delivery.test.ts`<br>`test/server/media-delivery/media-delivery-http.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 5.1, 5.2, 5.3, 5.4, 6.1, 7.1, 8.4, 8.5, 8.6, 8.7` | `npm run test:server:imp -- test/server/media-delivery/live-delivery.test.ts`<br>`npm run test:server:integration -- test/server/media-delivery/media-delivery-http.integration.test.ts` |

-   [x] 1. 既存の配信・公開契約を characterization する
-   [x] 1.1 ライブ直接配信と視聴用変換の既存契約を固定する

    -   M2TS、低遅延 M2TS、WebM、MP4、HLS の選択、無変換 M2TS の tuner stream 直結、変換時だけの process 枠利用、および
        channel・形式・画質の拒否を、provider stub を使う `unittest/spec` で固定する。
    -   ライブ M2TS の外部 player playlist、直接接続 close による停止、および確立済み stream 本文を時間だけで終了しない
        挙動を `integration` で確認する。
    -   tuner stream 取得失敗を含む stream/system logger category と error projection を characterization し、本
        spec で一律の category 変更を行わない。
    -   完了時には、各形式、変換有無、入力拒否、開始失敗、接続 close、外部 playlist、および長時間本文の fixture が既存結
        果を再現し、production code の差分がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.9, 4.5_
    -   _Boundary: Live Stream characterization（ライブ専用 fixture と test file）_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.2 録画 file の直接再生・download・視聴用変換を固定する

    -   登録済み元 file と変換済み file の直接再生・download、設定済み再生方法の選択、WebM・MP4・HLS の一時変換を
        `unittest/spec` で固定する。
    -   妥当な再生位置と再生時間超過、録画済み番組・file・実 path の欠落、file open 失敗、および録画 file 用外部 player
        playlist を `integration` で確認する。
    -   既存の TS/encoded 分岐、録画中 flag、および公開 response shape を変更しない。
    -   完了時には、元 file、変換済み file、録画中 file、開始位置境界、missing/open failure、および playlist の fixture
        が既存結果を再現し、production code の差分がない。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.10, 2.11_
    -   _Boundary: Recorded Stream characterization（録画専用 fixture と test file）_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.3 録画中 file の末尾追尾と既知の縮小挙動を固定する

    -   file 末尾で 1 秒後に size を再確認し、増加時は直前の追記位置から継続し、不変時は録画中 flag にかかわらず終了する
        挙動を fake timer 付き `unittest/spec` で固定する。
    -   現在位置より file が縮小した場合は先頭から読み直し、既に配信した範囲を再送し得る既知の不整合も characterization
        として明示する。
    -   確立用の開始期限を末尾追尾へ流用しない否定 fixture を用意する。
    -   完了時には、増加、不変、縮小、および停止済み reader の各時系列が決定論的に再現し、縮小再照合方式を変更していな
        い。
    -   `open`、`fstat`、`read`が保留中のreaderをdestroyした場合と通常EOF終了が同着した場合に、FDを高々一回closeし、FD
        `0`、後着FD、timer、callbackを回収する`unittest/imp`を追加する。
    -   _Requirements: 2.6, 2.7, 2.8, 2.9, 6.2_
    -   _Boundary: Tail reader characterization（`src/lib/TailStream.ts`、`src/model/operator/recorded/RecordedPlaybackSourceProvider.ts`の`RecordingTailReadable`）_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 1.4 HLS readiness、配信状態、再起動境界の既存契約を固定する

    -   HLS 開始が ready 前に ID を返すこと、starting/ready 表示、親 playlist、媒体成果物 2 件、任意字幕、100 ms
        poll、15 秒 keep、および readiness に全体期限がないことを fake timer と一時 directory で `unittest/spec` にす
        る。
    -   配信一覧の形式・画質・対象・ready 状態、存在しない stop の成功、存在しない keep の失敗、録画 HLS writer 終了後の
        保持、状態変更通知、および停止中 ID 非再利用を固定する。既存 wire key `viodeFileId` は本 spec で訂正しない。
    -   親 path `./streamfiles/stream{streamId}.m3u8`、`/streamfiles` static route、メモリー内状態の非復元、および全配信
        回収を待つ専用 shutdown 経路がないことを contract test で確認する。
    -   完了時には、readiness/keep/status/restart の fixture が成功し、世代 directory、公開 generation ID、状態永続化、
        専用 drain が追加されていない。
    -   _Requirements: 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 4.1, 4.2, 4.3, 4.7, 4.8, 4.9, 4.10, 4.11, 8.1,
        8.2, 8.4_
    -   _Boundary: HLS Readiness Monitor・status projection・restart contract_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.5 (P) 視聴用 command の既存置換規則と環境を固定する

    -   command 省略、半角空白分割、引用符・shell 非解釈、実行 file の `%NODE%`、引数の `%ROOT%` と `%SPACE%` を
        `unittest/spec` で固定する。
    -   `%INPUT%`、`%OUTPUT%`、`%FFMPEG%`、`%streamFileDir%`、`%streamNum%`、`%SS%` の配信種別ごとの置換と、値なし
        placeholder の未置換を live/recorded process adapter との `integration` で確認する。
    -   親 process の環境だけを継承し、録画変換固有の環境変数、shell、引用符 parser、未承認の placeholder 推定を追加しな
        い。
    -   完了時には、全 placeholder matrix と環境 snapshot が既存 command/引数を再現し、production code の差分がない。
    -   _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
    -   _Boundary: command interpretation characterization（`ProcessUtil` と配信別 option builder）_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 1.6 Kodi の URL・認証・失敗契約を characterization する

    -   設定済み Kodi と録画 file の照合、要求由来の protocol・host による file URL、JSON-RPC payload、および通信失敗を
        `unittest/spec` で固定する。
    -   Basic 認証は Kodi transport だけへ渡し、file URL、payload、log へ埋め込まないことを `unittest/imp` で確認する。
    -   request-derived host の信頼境界は承認済み契約として維持し、本 task で allowlist や URL 再解釈を追加しない。
    -   完了時には、認証有無、設定・file 欠落、通信 reject、および URL shape の fixture が既存結果を再現し、timeout 差分
        だけが後続 task の対象として残る。
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_
    -   _Boundary: Kodi Client characterization（Kodi 専用 fixture と test file）_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 2. 開始予約・有限 deadline・世代隔離を test と実装で実現する
-   [x] 2.1 Stream Manager の開始・停止状態遷移を test と実装で閉じる

    -   start 受付時に一意 object を `starting` として同期予約し、外部 I/O 中も別 start/stop/keep/list が進む目標を
        deferred port 付き `unittest/spec` で定義する。
    -   stopAll は受付時 snapshot へ順番に停止要求し、開始直後の terminal は callback 登録順に依存せず同じ object だけを
        `stopping` へ進めることを定義する。
    -   停止中 ID は cleanup 完了まで再利用せず、開始失敗・即時終了・遅延 terminal が別 object の一覧、通知、ID へ作用し
        ないことを `unittest/imp` で検証する。
    -   tuner/file reader、Readable、timer、listener、managed/HLS handleは各streamの実装が所有し、各ActiveStreamが
        一つだけ持つ`ResourceLeaseBundle`へ後始末関数を登録して、stale adoptionでは後着resourceを得た側が整理する目標を含める。
    -   `starting`、`ready`、`stopping` と object identity を管理し、同期区間を予約・状態遷移だけに限定して外部 I/O を外
        で実行する。
    -   ActiveStreamごとの`ResourceLeaseBundle`へ登録した後始末関数を保持し、重複close、timeout、stop、terminalを
        同じfinalize Promiseへjoinさせる。個別cleanup失敗後も残りの後始末を一回ずつ実行する。
    -   start settlement、stop、terminal、失敗 cleanup を同じ object の一回だけの finalizer へ収束させ、stopAll は固定
        snapshot を順に処理する。
    -   状態変更通知は実際の同一 object 遷移だけで一回発行し、公開一覧・response shape を変更しない。
    -   完了時には 2.1 の全 fixture が成功し、未処理 rejection、二重通知、残留状態が 0 件になる。
    -   _Requirements: 1.6, 4.4, 4.6, 4.10, 4.11, 8.1_
    -   _Boundary: Stream Manager・ActiveStream state machine_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 2.2 30 秒開始 deadline と first-terminal-wins を test と実装で閉じる

    -   入力検証後から live の tuner/process/本文接続、recorded の番組・動画情報・実 path・reader/process/本文接続または
        HLS stdin 接続までを一件の 30 秒期限で監督する目標を fake timer 付き `unittest/spec` で定義する。
    -   deadline と成功・失敗を同着させ、最初の terminal だけを採用し、期限後に得た tuner handle、file reader、process
        handle は同じ object の best-effort cleanup だけへ渡すことを定義する。
    -   確立後本文、HLS readiness、15 秒 keep、録画 file 追尾には開始 deadline が残らない否定 fixture を用意する。
    -   内部定数 `MEDIA_DELIVERY_START_TIMEOUT_MS = 30000` と first-terminal-wins latch を追加し、設定項目や公開 API へ
        露出しない。
    -   deadline 時は同じ object を `stopping` へ遷移させ、開始途中に登録された cleanup を一回実行し、late result を応答
        や一覧へ採用しない。
    -   settlement 後に timer と listener を必ず解除し、確立した Readable/HLS readiness へ deadline を伝播しない。
    -   完了時には 2.2 の共通 lifecycle fixture が成功し、fake clock 上の残留 timer と未処理 late result が 0 件になる。
    -   _Requirements: 1.6, 1.8, 1.9, 2.12, 3.13_
    -   _Boundary: Delivery Start Coordinator_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 2.3 Live Stream の tuner・process handle 接続を test と実装で閉じる

    -   tuner取得、process開始、stdin不在、即時terminal、およびdeadlineで、取得済み資源だけが逆順に一回解放されることをlive専
        用target testが検証する。
    -   `server-tuner-access` の stream handle と `server-media-process-management` の pipe child/opaque handle を開始
        coordinator へ登録し、writer stdin 接続までを確立点にする。
    -   tuner 取得、process 開始、stdin 不在、即時 terminal、deadline の各失敗で、得られた資源だけを逆順に best-effort
        停止する。
    -   無変換 M2TS は process 枠を使わず、変換ありだけが managed handle を保持し、logger category と公開形式を変更
        しない。
    -   完了時には遅延 handle が別配信へ作用せず、確立済み本文は 30 秒後も継続する。
    -   _Requirements: 1.1, 1.3, 1.4, 1.6, 1.8, 1.9_
    -   _Boundary: Live Stream consumer adapter（共有 coordinator と manager は変更しない）_
    -   _Depends: 2.2_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 2.4 Recorded Stream の recorded-content・process handle 接続を test と実装で閉じる

    -   本taskは`server-recorded-content` Task 2.4が提供する再生用source providerを前提とし、providerが未統合のtreeでは
        consumerだけを先行完了扱いにしない。
    -   Task 2.5が取得・adoptしたsourceを受けるRecorded Stream内部input、process、stdin、deadline、late successをcall
        ledgerで固定するrecorded専用target testが検証する。target testはadopt済みsource contract doubleを入力にし、本taskから
        provider、`RecordedDeliveryUsePort`、recorded ID予備照会、lease取得、exact releaseを呼ばない。それらの順序と
        resource利用境界はTask 2.5だけが所有する。
    -   Task 2.5から渡された解決済みの録画file・録画済み番組・動画情報・実path・`playPosition`を持つtagged sourceを受け
        る。`encoded-direct`はpathをprocess入力へ渡してreaderを登録せず、reader variantだけを開始coordinatorとresource
        bundleへ登録する。sourceの`playPosition`だけを既存の再生位置選択へ使い、DB照会、情報probe、path解決、reader種別
        選択、再生位置の再解決を本specに再実装しない。
    -   provider failure、direct DB/path fallback 0、adopt前reader整理はTask 2.5が所有し、本taskはadopt済みsourceだけを
        受ける。sourceを受けた後のreader/process/timer/listenerは本specだけが一回解放する。
    -   source、process、stdin、deadlineの各失敗とlate successで、同じownerが持つreader/handleだけをbest-effort停止す
        る。
    -   TS/encoded、録画中 reader、再生位置、HLS/非 HLS の既存選択を維持する。
    -   完了時には期限後のsource/reader/processが応答へ採用されず、file追尾は30秒後も継続する。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.10, 2.12_
    -   _Boundary: Recorded Stream consumer adapter（共有 coordinator と manager は変更しない）_
    -   _Depends: 2.2_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 2.5 録画file配信のresource利用leaseとread-only snapshotを test と実装で閉じる

    -   `server-recorded-content` Task 2.4のproviderの完了を前提とする。予備照会でrecorded
        IDを確定した後、再生source provider・process・HLS writerより前に`delivery`用途のexact leaseを一回取得し、同じ
        video file ID、expected recorded ID、および既存再生要求の`playPosition`をproviderへ渡して対応とsource値を再検証
        する順序をcall ledgerで定義する。対応消失・変更、取得失敗、期限超過・状態不明ではsource/process開始を各0件にす
        る。
    -   直接応答reader、変換process、録画HLS writerがsourceを利用しなくなるまで同じtokenを保持し、close、開始失敗、
        timeout、明示stop、late resultの全terminalで一回releaseする。late/double/stale releaseは別配信へ作用させない。
    -   activeな直接・変換・HLS録画file配信のrecorded IDだけを重複除去してknown集合にし、live、Kodi、終了済み配信を含め
        ない。対応を安全に列挙できない場合は部分集合でなく`unknown`を返す。
    -   snapshot取得でstart、stop、keep、finalize、leaseを各0回にし、PMのgeneration、通常5秒carrier、capacity deletion
        gateを本specへ複製しない。
    -   `server-process-messaging`が提供するresource-use carrierを受けるconsumer portを定義し、予備照会後のacquire、
        expected recorded IDと`playPosition`を渡すRecorded Content provider再検証、source採用を承認順序で接続する。取得
        失敗、対応変更、またはstale adoptionではreader、process、writer、公開応答、通知を作らない。
    -   取得した利用leaseの解放は`adoptPlaybackSource(source, release)`で録画配信へ渡し、source利用terminalで一回releaseす
        る。release未確認を記録して配信結果を巻き戻さず、parent側が削除可能とは推測しない。
    -   `RecordedDeliveryLeaseConsumer`が更新する`ActiveRecordedDeliveryRegistry`から、副作用なしのknown集合またはunknownを
        返すread-only provider（`DeliveryRecordedUseSnapshotProvider`）を実装し、live/Kodi、公開一覧、playlistへtokenを露出
        しない。
    -   PM carrier実装は`server-process-messaging`、consumer portとsnapshot providerの一回bindingは
        `server-service-interface`の後続service child composition taskへ明示的に委譲し、本taskでは
        `ModelContainerSetter`を変更しない。
    -   完了時には2.5の全target testが成功し、leaseなし録画source利用、重複release、部分snapshotが0件
        で、consumer portとread-only providerを独立したcontract doubleから検証できる。
    -   検証は`unittest/spec`、`unittest/imp`、PM contract doubleとrecorded-content portを使うdomain-local
        `integration`で行う。
    -   _Requirements: 2.1, 2.3, 2.10, 2.12, 4.10, 4.11, 5.10, 6.3, 8.1_
    -   _Boundary: 録画済みresource利用consumer・利用中snapshot_
    -   _Depends: 2.4; server-recorded-content Task 2.4_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 3. HLS Artifact Index と競合しない採番を test と実装で実現する
-   [x] 3.1 HLS Artifact Index の起動時走査・準備・再試行を test と実装で閉じる

    -   保存先を一度だけ準備して read/write access を確認し、`stream{id}` 直後が数字でない成果物から ID を抽出する
        `HLSFileDeleterModel` の走査・列挙（`scanAtStartup`・`scanCurrent`・`listExact`）契約を一時 directory の `unittest/spec` で定義する。
    -   `stream1` と `stream10`、親・segment・subtitle・無関係 file を分離し、見つけた成果物を削除せず startup ID として
        予約することを定義する。
    -   mkdir/access/read 失敗では error を記録して HLS だけを失敗させ、後続 HLS start で準備と走査を再試行し、非 HLS
        start は継続することを定義する。
    -   保存先の mkdir、read/write access、scan、exact ID 抽出を一つの index に集約し、startup/current artifact ID をメ
        モリーで保持する。
    -   起動失敗は HLS 未初期化状態と error 記録へ収束させ、HLS start 時だけ同じ準備を再試行する。
    -   起動時成果物を削除せず、非 HLS の開始経路と server startup を停止しない。
    -   完了時には 3.1 の fixture が成功し、`stream1` の選択へ `stream10` が混入せず、失敗後の再試行回数が要求単位で観測
        できる。
    -   _Requirements: 3.14, 3.15, 3.16, 3.17, 8.3_
    -   _Boundary: HLS Artifact Index・startup initialization_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 3.2 allocation cursor・wrap・予約集合を test と実装で閉じる

    -   `allocationCursor` から active/starting/stopping、startup artifact、確認済み current artifact の ID を飛ばして候
        補を同期予約する目標を `unittest/spec` で定義する。
    -   `Number.MAX_SAFE_INTEGER` の次を 0 とし、wrap 後も使用中 ID を飛ばし、利用可能 ID がない間は重複を返さないことを
        `unittest/imp` で確認する。
    -   cleanup 後は成果物なしを確認できた ID だけを候補へ戻し、強制解放時も cursor を解放 ID の次へ進めることを定義す
        る。
    -   同期境界内で候補選択、`starting` object 登録、cursor 更新を不可分に行い、停止中・成果物残存 ID を再利用しない。
    -   wrap を safe integer 範囲内で行い、候補なしを重複 ID ではなく明示的な開始失敗として扱う。
    -   cleanup 結果に応じて確認済み artifact ID を維持または除去し、強制解放時は cursor を次へ進める。
    -   完了時には 3.2 の fixture が成功し、各時点で同一 ID を所有する active object が最大一件になる。
    -   _Requirements: 3.1, 3.2, 3.3, 4.11, 5.7_
    -   _Boundary: Stream Manager HLS allocator_
    -   _Verification: unittest/spec, unittest/imp_

-   [x] 3.3 非同期 snapshot と writer 前 exact 再確認を test と実装で閉じる

    -   artifact snapshot 中に start/stop/keep/list の同期境界を保持せず、同じ snapshot を使う並行 start も同期予約で異
        なる ID を得る目標を deferred filesystem 付き `unittest/spec` で定義する。
    -   writer 開始直前の exact 再確認で成果物を見つけた場合は writer を開始せず、同じ object の予約だけを解除し、その
        ID を確認済み集合へ加えて次候補を選ぶことを定義する。
    -   snapshot/recheck failure、stop 同着、late scan result を交差させ、別 object の予約と通知を変更しないことを確認す
        る。
    -   filesystem snapshot と exact recheck を同期境界外で実行し、結果の適用時に object identity と状態を再照合する。
    -   recheck で衝突した予約だけを解放して次候補へ進み、writer/process/tuner/file reader を衝突 ID で開始しない。
    -   走査不能 ID は成果物状態未確認として候補から外し、承認されていない一般 retry や世代 directory を追加しない。
    -   完了時には同じ 3.3 の競合 fixture が成功し、lock 保持中の外部 I/O、重複 ID、衝突 ID の writer start が 0 件にな
        る。
    -   _Requirements: 3.1, 3.2, 3.3, 3.15, 4.11_
    -   _Boundary: HLS allocator・HLS Artifact Index integration_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 4. exact な HLS readiness 判定を test と実装で実現する
-   [x] 4.1 exact selector を使う readiness を test と実装で閉じる

    -   親 `stream{id}.m3u8` の完全一致と、`stream{id}` 直後が数字でない媒体成果物 2 件以上だけで ready となる目標を、一
        時 directory と fake timer の `unittest/spec` で定義する。
    -   `stream1` 判定へ `stream10` の segment を混入させず、子 playlist と字幕 playlist は必須にせず、利用可能な字幕だ
        けを親へ追加することを定義する。
    -   100 ms poll、停止時 timer cancel、全体 deadline なし、ready 通知一回を既存 characterization と同時に検証する。
    -   readiness の列挙を `HLSFileDeleterModel.listExact()` へ集約し、親完全一致と媒体成果物数を同一 snapshot から判定す
        る。
    -   ready 遷移と字幕反映を同じ object identity へ限定し、停止後または ID 再利用後の poll result を無作用にする。
    -   既存の 100 ms、15 秒 keep、公開 path、および readiness 無期限契約を変更しない。
    -   完了時には 4.1 の全 fixture が成功し、`stream1`/`stream10` 混在、stop 同着、subtitle 有無で誤通知がない。
    -   _Requirements: 3.5, 3.6, 3.7, 3.12, 3.13, 4.10_
    -   _Boundary: HLS Readiness Monitor_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 5. HLS writer 停止・成果物整理・強制解放を test と実装で実現する
-   [x] 5.1 opaque HLS handle への停止委譲を test と実装で閉じる

    -   readiness/keep timer と tuner/file reader/transform input を先に止め、保存済み `HlsWriterHandle` の `stopHls()`
        を一回呼ぶ目標を `unittest/spec` で定義する。
    -   stream ID や pipe child から停止対象を引き直さず child へ直接 signal を送らないこと、process manager の停止結果
        を受けてから artifact 整理へ進むことを `unittest/imp` で確認する。
    -   provider が所有する SIGINT 一回・1 秒最大 3 回、残存時 SIGKILL 一回・1 秒最大 3 回の結果と reject/throw を合成
        し、delivery が signal や論理枠解放を重複実行しないことを定義する。
    -   stream object が開始時に保存した generation-safe opaque handle だけで `stopHls()` へ委譲し、timer/input 停止後に
        一回実行する。
    -   stop result または失敗を同一停止 operation へ保存し、並行 stop はその operation へ参加させる。
    -   provider failure を error 記録した後も artifact cleanup へ進め、delivery から signal、PID/PGID 解釈、slot
        release を行わない。
    -   完了時には 5.1 の全 fixture が成功し、停止委譲、timer/input cleanup、provider result が各 object で一回だけ観測
        される。
    -   _Requirements: 5.1, 5.2, 5.3, 5.11, 5.12_
    -   _Boundary: HLS Stop Coordinator・process manager consumer port_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 5.2 exact artifact 削除・最大 3 pass・失敗記録を test と実装で閉じる

    -   各 pass で対象 ID の exact artifact だけを列挙・削除・再走査し、残存または失敗時も最大 3 pass まで進む目標を一時
        directory の `unittest/spec` で定義する。
    -   `stream1` cleanup で `stream10` を削除せず、個別 unlink 失敗には file 名・ID・pass・error を記録することを確認す
        る。
    -   scan、exact list、unlink、rescan を個別に失敗させ、ID・pass・操作・error を記録し、scan/list/rescan 失敗時は残存
        状態を未確認として安全な後続処理へ進むことを定義する。
    -   `HLSFileDeleterModel.listExact()` を使って各 pass の列挙・削除・再走査結果を返し、別 ID の file を対象外にする。
    -   各補助処理の失敗を承認済み field 付き error event として記録し、安全に実行可能な次の file/pass/終端へ進む。
    -   成功、残存、未確認を区別した cleanup result を Stop Coordinator へ返し、deleter 自身は stream 一覧や ID を解放し
        ない。
    -   完了時には 5.2 の全 fixture が成功し、最大 pass 数は 3、誤削除は 0、握り潰された unlink error は 0 件になる。
    -   _Requirements: 5.4, 5.5, 5.6, 5.9, 5.12, 5.13_
    -   _Boundary: HLS Artifact Deleter・operational logging producer_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 5.3 一回だけの強制解放と遅延 event 隔離を test と実装で閉じる

    -   process 終了未確認、stop reject、artifact 残存、scan 未確認の全経路で、cleanup 後に同じ object を一覧から除去し
        ID を一回強制解放する目標を `unittest/spec` で定義する。
    -   終了未確認 result では ID・配信種別・削除結果/未確認・ID 強制解放、残存時は残存 file・ID・pass・強制解放を error
        記録することを `unittest/imp` で定義する。
    -   強制解放後の late exit/error/delete result/readiness timer が、再利用 ID の object、artifact、process 枠、通知へ
        作用せず、cursor は解放 ID の次から進むことを確認する。
    -   writer result と artifact cleanup result の成否にかかわらず一回だけ実行される finalizer で、同じ object の一覧除
        去、ID 解放、cursor 更新、通知を行う。
    -   object identity、状態、finalized latch を各 callback/timer/result 適用時に照合し、stale result を無作用にする。
    -   process manager result と cleanup result を組み合わせた承認済み error event を記録し、logger failure も
        finalizer を妨げないようにする。
    -   完了時には同じ 5.3 の全 target fixture が成功し、各 object の finalizer、ID 解放、通知が最大一回になる。
    -   _Requirements: 4.10, 4.11, 5.7, 5.8, 5.9, 5.10, 5.12, 5.13_
    -   _Boundary: HLS Stop Finalizer・Stream Manager_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 5.4 HLS 停止の順序・失敗 matrix を結合検証する

    -   SIGINT 終了、SIGKILL 終了、終了未確認、stop reject と、artifact の成功・残存・unlink 失敗・scan 未確認を組み合わ
        せ、stop result 後にだけ削除へ進むことを `integration` で確認する。
    -   明示 stop、15 秒 keep 途絶、live terminal、開始 deadline の各入口が同じ停止 operation/finalizer へ収束することを
        fake timer で確認する。
    -   `stream1`/`stream10` と ID 再利用を交差させ、別 generation の handle、成果物、通知、slot が変更されないことを検
        証する。
    -   完了時には停止 matrix が共有 server test command から成功し、残留 timer、未処理 rejection、一覧残留、重複解放が
        0 件になる。
    -   _Requirements: 3.10, 3.11, 4.3, 4.6, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13_
    -   _Boundary: HLS Stop Coordinator・Artifact Index・Stream Manager integration_
    -   _Depends: 4.1, 5.3_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 6. 非 HLS 資源を managed handle で停止する
-   [x] 6.1 非 HLS の best-effort 停止と一覧除去を test と実装で閉じる

    -   live は tuner stream と変換、recorded は file reader と変換を停止し、変換は保存済み `ManagedProcessHandle` の
        `requestStop()` だけへ委譲する目標を `unittest/spec` で定義する。
    -   pipe child へ直接 signal を送らず、同じ handle の停止 operation へ参加し、process terminal を stop 応答条件にし
        ないことを `unittest/imp` で確認する。
    -   input/process 停止の一部が reject しても残りを試し、最後に同じ object を一覧から除去して通知することを定義する。
    -   live/recorded の input cleanup を best-effort で行い、保存済み opaque handle の `requestStop()` へ一回委譲する。
    -   各 cleanup error を記録して残りの後始末を続け、stop operation の終端で同じ object を一覧から一回除去する。
    -   direct stream、公開 response、process manager の signal/slot 所有権を変更しない。
    -   完了時には 6.1 の全 fixture が成功し、consumer からの child signal、一覧残留、二重通知が 0 件になる。
    -   _Requirements: 6.1, 6.2, 6.3_
    -   _Boundary: non-HLS stop consumer adapters・Stream Manager finalizer_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 7. Kodi 通信の有限 deadline を test と実装で実現する
-   [x] 7.1 Kodi の 30 秒 response deadline を test と実装で閉じる

    -   一回の HTTP request 直前から response body の受信・JSON 解釈完了までを 30 秒で監督する目標を fake timer と
        deferred response の `unittest/spec` で定義する。
    -   deadline と response/parse error を同着させて最初の terminal だけを採用し、期限後 response を成功に変えず別
        request へ転用しないことを確認する。
    -   認証情報が transport だけへ渡り file URL に含まれない既存 characterization を同時に成功させる。
    -   内部定数 `KODI_REQUEST_TIMEOUT_MS = 30000` を HTTP client request に適用し、設定 schema や公開 API へ追加しな
        い。
    -   response parse まで first-terminal-wins latch で監督し、settlement 後の timer/listener と late response を整理す
        る。
    -   既存 URL、payload、Basic auth、error projection を変更しない。
    -   完了時には 7.1 の全 fixture が成功し、期限後成功、認証漏えい、残留 timer が 0 件になる。
    -   _Requirements: 7.3, 7.4, 7.5, 7.6_
    -   _Boundary: Kodi Client deadline_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 8. 配信境界を結合検証する
-   [x] 8.1 競合する start/stop/keep/list と遅延結果を決定論的に結合検証する

    -   deferred tuner/content/process/filesystem port と fake timer を使い、並行 start、stopAll snapshot、keep、一
        覧、30 秒 deadline、即時 terminal、late success を `integration` で交差させる。
    -   active/starting/stopping/artifact ID が重複せず、外部 I/O 中も他操作が進み、同じ object だけが一回終端・通知され
        ることを全順序で確認する。
    -   確立済み本文、HLS readiness、録画 file 追尾に開始 deadline が残らず、未承認の一般 retry/reconciliation、自動再起
        動、shutdown drain がないことを否定検証する。
    -   完了時には lifecycle race suite が決定論的に成功し、未処理 rejection、残留 timer、重複 ID、stale mutation が 0
        件になる。
    -   _Requirements: 1.6, 1.8, 1.9, 2.12, 3.1, 3.2, 3.3, 3.13, 4.4, 4.6, 4.10, 4.11, 5.10, 6.3, 8.1, 8.2, 8.4_
    -   _Boundary: media-delivery lifecycle integration_
    -   _Depends: 2.5, 3.3, 4.1, 5.4, 6.1, 7.1_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 8.2 provider contract と公開配信 path を結合検証する

    -   tuner stream handle、recorded-content lookup、managed/HLS process handle、logger port を合成 adapter で接続
        し、live direct/transformed と recorded direct/transformed/HLS の開始・本文・停止を `integration` で確認する。
    -   外部 player playlist と `./streamfiles/stream{streamId}.m3u8` が既存 `/streamfiles` carrier で取得でき、世代情報
        や認証情報を URL に追加しないことを確認する。HTTP carrier 自体の再設計は `server-service-interface` に残す。
    -   command placeholder、HLS ready/keep、Kodi、開始 deadline を同じ domain suite から実行し、共有 test foundation と
        Node matrix の定義は変更しない。
    -   完了時には media-delivery 固有の `unittest/spec`、`unittest/imp`、`integration` が共有 command から成功し、owner
        外の設定既定値、process signal、file/domain、tuner acquisition 実装がない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.1, 2.2, 2.3, 2.11, 3.4, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.5, 4.7,
        6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
    -   _Boundary: provider-consumer・public delivery integration_
    -   _Depends: 1.5, 5.4, 6.1, 7.1, 8.1_
    -   _Verification: unittest/spec, unittest/imp, integration_

-   [x] 8.4 R1〜R9 の仕様 test の主 case を完成する

    -   R1からR9の83件を一意な`unittest/spec`主testへ割り当て、test titleから各ACを逆引きできる形にする。
    -   各主testは戻り値だけでなく、配信状態、resource取得、通知、停止、外部player効果、およびcleanupの意味ある結果を
        assertする。
    -   完了時には83件すべてが一つの主testへ追跡でき、未割当・重複・空assertionが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10,
        2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 4.1,
        4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11,
        5.12, 5.13, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7,
        9.8, 10.1_
    -   _Boundary: 映像配信・再生連携 spec test case_
    -   _Depends: 8.1, 8.2_
    -   _Verification: unittest/spec_

-   [x] 8.5 値域・終了・失敗の意味ある assertion を閉じる

    -   再生位置、識別番号cursorと折返し、exact artifact集合、readiness、placeholder、形式別終了条件、および失敗分岐を4
        つの`unittest/imp` fileで個別assertionする。
    -   完了時には値域・分岐testが全件成功し、spec test件数だけで代替していないことが観測できる。
    -   _Requirements: 10.2_
    -   _Boundary: 映像配信・再生連携 internal assertions_
    -   _Depends: 8.4_
    -   _Verification: unittest/imp_

-   [x] 8.6 機能固有 test matrix の状態・競合・資源分類を完成する

    -   Designの88行のmatrixで開始中・準備完了・停止中・停止済み・再起動、100ms・1秒・15秒・30秒、timeout、同着、late settlementを一意に
        分類する。
    -   stream、file、timer、listener、process handle、HLS artifactの解放または保持を記録し、空欄と未分類を0件にする。
    -   完了時にはDesignの88行が必須列と主testのlocatorを持ち、空欄と未分類が0件である。
    -   _Requirements: 10.3_
    -   _Boundary: 映像配信・再生連携 Design test matrix_
    -   _Depends: 8.5_
    -   _Verification: Designの表のレビュー_

-   [x] 8.7 HTTP・filesystem・process・tuner・recorded-content 境界を結合検証する

    -   5つのintegration fileでHTTP、filesystem、isolated child process、tuner、recorded-contentの成功・失敗・race・
        cleanupを具体的にassertする。
    -   DBはrecorded-content経由の間接適用、公開業務IPCは非適用とする承認済み理由を保持する。
    -   完了時には5境界の結合結果が全件成功し、owner外のDB更新、IPC operation、signal algorithmを追加していないことが観
        測できる。
    -   _Requirements: 10.4_
    -   _Boundary: 映像配信・再生連携 external boundaries integration_
    -   _Depends: 8.2, 8.6_
    -   _Verification: integration_

-   [x] 8.8 本機能の品質判定を満たす

    -   Task 8.4から8.7の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 8.4, 8.5, 8.6, 8.7_
    -   _Requirements: 10.5_
