# Implementation Plan

---

## Cross-spec execution prerequisite

本 spec の実行前提と外部 owner は次のとおりである。これらは別 spec の実行barrierであり、本specのlocal `_Depends` へ外部
task IDを書かない。

-   `server-application-runtime`: 共有server test root、Vitest/V8、固定command、Node.js 24必須・26追加matrix、coverageの計測
-   `server-configuration`: チャンネル順、サービス識別子順、配信サブディレクトリの設定契約
-   `server-persistence`: SQLite/MySQL共通fixture、チャンネル・番組query、およびDB lifecycle
-   `server-program-guide`: チャンネル、番組、通常・半角表記、および対象放送波の意味
-   `server-media-delivery`: 安定したlive M2TS routeとstream lifecycle
-   `server-service-interface`: HTTP carrierのHost・scheme・forwarded情報のtrust、status、header、および
    `IptvPublicUrlBuilder`のcaller binding

Runtime foundation完了後に本specの機能固有testを追加する。Task 2.3と`server-service-interface` Task 2.4は、同一
production treeを一つのrevisionで変更するatomic cross-spec checkpointである。IPTV側だけを先に変更してproduction
interfaceまたはcallerをcompile REDにしてはならず、両taskの変更、全production TypeScript compile、IPTV fake builder
suite、および実HTTP carrier integrationが同一revisionでGREENになるまで、どちらのtaskも完了扱いにしない。このbarrierを満
たすまでTask 6.2、7.1、8.4へ進めない。共有foundation、設定、DB、番組意味、live route、HTTP carrierを本specへ重複実装しな
い。

## Leaf execution contract

共有 Runtime owner が提供する固定 command を消費する。以下は leaf ごとの target、種別、local dependency、実行入口であ
り、Runtime の runner・script・flag を再定義しない。

| Leaf | Concrete target                                                                                                                                                                                                                                    | Test type                                                          | Local Depends              | Verification command                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/iptv-export/unittest/spec/query.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/query.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                       | `unittest/spec`・`unittest/imp`・`integration`                     | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/query.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/query.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                         |
| 1.2  | `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/request-completion.test.ts`                                                                                                        | `unittest/spec`・`unittest/imp`                                    | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/request-completion.test.ts`                                                                                                                                                             |
| 2.1  | `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/serializers.test.ts`                                                                                                                            | `unittest/spec`・`unittest/imp`                                    | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/serializers.test.ts`                                                                                                                                                                                 |
| 2.2  | `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                     | `unittest/spec`・`unittest/imp`・`integration`                     | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                       |
| 2.3  | `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/serializers.test.ts`<br>`src/model/api/iptv/IPTVApiModel.ts`<br>`src/model/service/api/iptv/channel.m3u8.ts`                                    | `unittest/spec`・`unittest/imp`                                    | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/serializers.test.ts`                                                                                                                                                                                 |
| 3.1  | `test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`<br>`test/server/iptv-export/unittest/spec/identity.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/ordering.test.ts`                                                             | `unittest/spec`・`unittest/imp`                                    | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`<br>`npm run test:server:spec -- test/server/iptv-export/unittest/spec/identity.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/ordering.test.ts`                                                                                      |
| 3.2  | `test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`<br>`test/server/iptv-export/unittest/spec/representation.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/serializers.test.ts`                                                    | `unittest/spec`・`unittest/imp`                                    | なし（共有foundationのみ） | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`<br>`npm run test:server:spec -- test/server/iptv-export/unittest/spec/representation.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/serializers.test.ts`                                                                             |
| 4.1  | `test/server/iptv-export/unittest/spec/representation.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/serializers.test.ts`<br>`src/model/api/iptv/IPTVApiModel.ts`                                                                          | `unittest/spec`・`unittest/imp`                                    | `3.2`                      | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/representation.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/serializers.test.ts`                                                                                                                                                                       |
| 4.2  | `test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                             | `integration`                                                      | `4.1`                      | `npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                                                                                                      |
| 5.1  | `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`<br>`src/model/api/iptv/IPTVApiModel.ts`             | `unittest/spec`・`unittest/imp`・`integration`                     | `2.2`                      | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                       |
| 6.1  | `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/request-completion.test.ts`<br>`src/model/service/api/iptv/channel.m3u8.ts`<br>`src/model/service/api/iptv/epg.xml.ts`             | `unittest/spec`・`unittest/imp`                                    | `1.2`                      | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/request-completion.test.ts`                                                                                                                                                             |
| 6.2  | `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`<br>`src/model/service/api/iptv/channel.m3u8.ts`                                                   | `unittest/spec`・`integration`                                     | `2.3, 6.1`                 | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                |
| 6.3  | `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`<br>`src/model/service/api/iptv/epg.xml.ts`                                                        | `unittest/spec`・`integration`                                     | `6.1`                      | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                |
| 7.1  | `test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                             | `integration`                                                      | `2.3, 5.1, 6.2`            | `npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                                                                                                      |
| 7.2  | `test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                             | `integration`                                                      | `4.2, 6.3`                 | `npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                                                                                                      |
| 7.3  | `test/server/iptv-export/unittest/spec/query.spec.test.ts`<br>`test/server/iptv-export/unittest/imp/query.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                       | `unittest/spec`・`unittest/imp`・`integration`                     | `7.1, 7.2`                 | `npm run test:server:spec -- test/server/iptv-export/unittest/spec/query.spec.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/query.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                         |
| 8.2  | `test/server/iptv-export/unittest/imp/query.test.ts`<br>`test/server/iptv-export/unittest/imp/serializers.test.ts`<br>`test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`test/server/iptv-export/unittest/imp/request-completion.test.ts` | `unittest/imp` 実装境界assertion mapping | `7.3` | `npm run test:server:imp -- test/server/iptv-export/unittest/imp/query.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/serializers.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/ordering.test.ts`<br>`npm run test:server:imp -- test/server/iptv-export/unittest/imp/request-completion.test.ts` |
| 8.4  | `test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                             | `integration`                                                      | `7.1, 7.2, 8.2` | `npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts`                                                                                                                                                                                                                                                      |
| 8.5  | `test/server/iptv-export/unittest/imp/query.test.ts`<br>`test/server/iptv-export/integration/iptv-db-http.integration.test.ts` | `unittest/spec`・`unittest/imp`・`integration` | `8.2, 8.4` | `npm run test:server:imp -- test/server/iptv-export/unittest/imp/query.test.ts`<br>`npm run test:server:integration -- test/server/iptv-export/integration/iptv-db-http.integration.test.ts` |

-   [x] 1. 入力条件と要求単位の読取契約を仕様テストで固定する
-   [x] 1.1 OpenAPI 入力、既定値、および追加検査しない境界を characterization する

    -   対象は
        `test/server/iptv-export/unittest/spec/query.spec.test.ts`、`test/server/iptv-export/unittest/imp/query.test.ts`、
        および `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   `mode` と `days` を OpenAPI の整数入力として受け付け、`days` 省略時は 3、`isHalfWidth` 省略時は `true` を使用す
        る既存契約を `unittest/spec` で固定する。
    -   正・負の小数 query が数値化後に floor され、`3.9` は `3`、`-1.2` は `-2` として文書生成へ渡ることを OpenAPI
        middleware を含む `integration` で確認する。
    -   日数の最小値・最大値を IPTV 文書生成側で追加検査せず、画質番号の利用可能性も映像配信機能へ問い合わせないことを
        port 呼出し回数で検証する。
    -   通常表記では M3U8 と XMLTV のチャンネル名および XMLTV の番組情報が通常表記になることを固定し、半角番組本文の差分
        は task 4 の target test と分離する。
    -   完了時には、既定値、正負の floor、範囲外整数、および未登録画質番号の fixture が承認済み入力値を文書生成へ渡
        し、production code の差分がない。
    -   HTTP query 境界と DB 読取前の分岐を検証し、race・timeout・timer/listener・filesystem・IPC・child process は非適
        用、入力変換の誤りは値と downstream 呼出し回数の assertion で検出する。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9, 1.10_
    -   _Boundary: IPTV 入力条件・OpenAPI adapter_

-   [x] 1.2 要求ごとの DB 読取、失敗、および非再生成を characterization する

    -   対象は `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts` と
        `test/server/iptv-export/unittest/imp/request-completion.test.ts` とする。
    -   M3U8 要求ごとにチャンネルを、XMLTV 要求ごとに番組とチャンネルを新しく読み、結果文字列、失敗、および進行状態を別
        要求へ共有しないことを deferred port で検証する。
    -   チャンネル読取失敗を M3U8 全体の失敗、チャンネルまたは番組読取失敗を XMLTV 全体の失敗とし、成功済み部分だけの文
        書を返さない既存結果を `unittest/spec` で固定する。
    -   一度の失敗後に IPTV 文書生成全体を自動再実行せず、永続化機能が所有する内部 retry の意味は変更しないことを
        invocation count で確認する。
    -   30 秒期限は Task 6 で扱い、固着読取はこの characterization の成功条件に含めない。
    -   完了時には、連続要求、同時要求、各読取失敗、および生成失敗の fixture が要求ごとに独立した結果と一回の文書生成を
        再現し、production code の差分がない。
    -   DB Promise と要求 facade の境界で同時要求、reject 順序、再入を検証し、30秒 timeout と timer/listener 解放は task
        6、filesystem・IPC・child process は非適用として分離する。生成回数の誤りは明示的な回数 assertion で検出する。
    -   _Requirements: 6.5, 6.6, 6.7, 6.8_
    -   _Boundary: IPTV 要求単位の読取・生成 facade_

-   [x] 2. M3U8 の対象、URL、および byte 契約を仕様テストで固定する
-   [x] 2.1 対象サービスと一件の exact M3U8 serializer を characterization する

    -   対象は `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts` と
        `test/server/iptv-export/unittest/imp/serializers.test.ts` とする。
    -   デジタルテレビ、デジタル音声、臨時映像・音声、プロモーション映像・音声、4K 専用テレビだけを含め、全対象へ MPEG-2
        TS 指定を付けることを `unittest/spec` で固定する。
    -   宣言、チャンネル ID、選択表記の表示名、放送波、ロゴ有無、指定 `mode` のライブ参照を、UTF-8、LF、ASCII 空
        白、U+3000、および末尾 LF を含む exact byte assertion で検証する。
    -   typed builderが返すロゴURLとライブURLを正確な位置へ反映する。typed builderの構成、要求単位の注
        入、およびHTTP carrier条件は本characterizationの完了条件に含めず、Task 2.3とService Interface Task 2.4のatomic
        checkpointで検証する。
    -   Host、通信方式、転送情報の信頼判定、HTTP status・header、および公開 path の所有権を `server-service-interface`
        と `server-media-delivery` に残し、本機能は渡された値から文書だけを生成する。
    -   対象 0 件では正確に `#EXTM3U\n` だけを返し、文書生成中にライブ視聴を開始しないことを port 呼出し回数 0 で確認す
        る。
    -   完了時には、全対象種別、対象外種別、ロゴ有無、および空文書のfixtureが、typed builderが返すURLを承認済み位置へ置いたexact
        byte列を再現し、production codeの差分がない。
    -   DB snapshot・typed builder入力・文書serializer境界を検証し、HTTP carrier、race・deadline・timer/listenerは非適用、
        filesystem・IPC・child processも非適用とする。対象判定とbyte連結の誤りはexact byteと呼出し回数で検出する。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.14, 2.15_
    -   _Boundary: M3U8 対象選択・URL・serializer_

-   [x] 2.2 M3U8 の設定順と表示名・識別子をcharacterizationする

    -   対象は `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts` と
        `test/server/iptv-export/unittest/imp/ordering.test.ts`、および
        `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   チャンネル順をサービス識別子順より優先し、選ばれた指定順を先頭へ置いて残りを標準順で続けることを設定 port と
        `integration` DB fixture で固定する。
    -   同じ元表示名を持つチャンネル1件から4件のsuffixはTask 5.1が固定する。本leafではsuffix以外の設定順、ID、live参
        照、属性間空白、LFをM3U8全byte assertionで固定する。
    -   表示名をチャンネル ID の代わりにせず、設定順が変わっても ID とライブ参照の対応を維持することを検証する。
    -   完了時には、チャンネル順のみ、サービス識別子順のみ、両方、未指定、および同名入力のfixtureが承認済み順序、
        U+3000、ID対応を再現し、production codeの差分がない。本leafはsuffix以外のcharacterizationで完了
        でき、承認済みsuffixの検証はTask 5.1だけが所有する。
    -   設定 snapshot と DB 順序の境界を検証し、同名入力と順序重複を扱う。race・timeout・timer/listener・filesystem・
        IPC・child process は非適用とし、比較の誤りは順序とexact byteのassertionで検出する。
    -   _Requirements: 2.3, 2.4, 2.12, 2.13, 4.1, 4.3, 4.4, 4.5_
    -   _Boundary: M3U8 表示名・設定順・チャンネル識別_

-   [x] 2.3 `IptvPublicUrlBuilder`をM3U8 generatorの構造入力へTDDで移行する

    -   対象は `src/model/api/iptv/IIPTVApiModel.ts`、`src/model/api/iptv/IPTVApiModel.ts`、
        `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts`、および
        `test/server/iptv-export/unittest/imp/serializers.test.ts` とする。
    -   `channelLogoUrl(channelId)`と`liveM2tsUrl(channelId, mode)`だけを公開するfake `IptvPublicUrlBuilder`を先にtestへ
        追加し、generatorがraw Host・scheme・subDirectoryを要求するため失敗することを確認して、そのRED理由をbuilder入力
        不足へ限定する。Task 2.1のraw入力serializer fixtureへtyped builderを持ち込まない。
    -   `IIPTVApiModel`の構造入力、generator引数、および`IPTVApiModel`をtyped builderへ最小移行し、ロゴありではlogo URL
        を一回、対象チャンネルではlive URLを一回取得する。ロゴなしではlogo builder呼出し0回、全経路でstream開始0回を
        assertionする。
    -   URLのM3U8内配置とexact byteはIPTVが所有する。Host・scheme・forwarded情報のtrust、status、header、builder構成は
        `server-service-interface`、stable live routeとstreamは`server-media-delivery`が所有し、本leafへreverse importし
        ない。
    -   最小production実装後にfake builderの仕様・実装testをGREENにする。同じrevisionでService Interface Task 2.4の
        caller bindingも実装し、IPTV側だけを先にcompile REDへする中間revisionをcheckpointとして残さない。
    -   完了時には、generatorにraw Host・scheme・subDirectory引数が残らず、URL、属性順、ASCII空白、U+3000、LFのexact
        byteが維持されることに加え、Service Interface Task 2.4、全production TypeScript compile、IPTV fake builder
        suite、および実HTTP carrier integrationが同一revisionでGREENになる。いずれか一つの成功だけでは本taskを完了扱いに
        しない。
    -   DB snapshotとbuilderの構造境界を検証し、race・deadline・timer/listener・filesystem・IPC・child processは非適用と
        する。builder呼出しとURL配置の誤りをexact byteと呼出し回数で検出する。
    -   _Requirements: 2.7, 2.8, 2.9, 2.10, 6.1, 6.2_
    -   _Boundary: IPTV public URL builder contract・M3U8 generator_

-   [x] 3. XMLTV の選択、表現、および byte 契約を仕様テストで固定する
-   [x] 3.1 対象期間、チャンネル対応、および並び順を characterization する

    -   対象は `test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`、
        `test/server/iptv-export/unittest/spec/identity.spec.test.ts`、および
        `test/server/iptv-export/unittest/imp/ordering.test.ts` とする。
    -   一回固定した生成時点から `days × 24時間` 後までの GR、BS、CS、SKY、BS4K を検索し、開始・終了の両端点を含む重なり条件を
        fake clock と DB fixture で検証する。
    -   XML 宣言、文書型、生成元、対象番組を持つチャンネルの ID・選択表記名・サービス ID、番組のチャンネル ID・開始・終
        了時刻を `unittest/spec` で固定する。
    -   チャンネルを放送波・リモコン番号・サービス ID の標準順、番組を開始時刻順とし、同じ開始時刻へ二次順序を追加しない
        query と出力順を `unittest/imp` で確認する。
    -   M3U8 と XMLTV で同じチャンネル ID を使い、XMLTV では各 `channel` を対応する `programme` より先に置く一方、両文書
        の相対順序一致を保証しないことを横断 fixture で検証する。
    -   対象番組 0 件では、チャンネルと番組を含まず末尾改行もない exact 空 XMLTV を返す。
    -   完了時には、期間端点、全対象放送波、同時刻番組、文書間で異なる順序、および空番組の fixture が承認済み対象集合・
        順序・ID 対応を再現する。
    -   DB query・clock・XMLTV document 境界で期間端点、同時刻、0件を検証し、要求間 race と deadline は task 6、
        filesystem・IPC・child process は非適用とする。比較・filter・順序の誤りは対象集合と byte 順序で検出する。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.12, 3.13, 3.14, 3.15, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
    -   _Boundary: XMLTV 対象期間・順序・チャンネル対応_

-   [x] 3.2 通常表記の番組文字列、時刻、および exact XMLTV serializer を characterization する

    -   対象は `test/server/iptv-export/unittest/spec/xmltv.spec.test.ts`、
        `test/server/iptv-export/unittest/spec/representation.spec.test.ts`、および
        `test/server/iptv-export/unittest/imp/serializers.test.ts` とする。
    -   通常表記の番組名と通常説明を出し、通常説明がある場合だけ詳細説明を直後へ連結し、通常説明がなければ詳細説明だけを
        出さない既存契約を `unittest/spec` で固定する。
    -   番組名・通常説明・詳細説明だけに五記号の全角類似文字置換と SUB 除去を適用し、チャンネル名、識別子、属性値、およ
        び M3U8 項目へ一律適用しないことを文字 matrix で検証する。
    -   XMLTV header を改行なしで開始し、`channel` 後だけ LF 一文字、説明前だけ ASCII 空白四文字、`programme` 間と
        `</tv>` 後は改行なしという exact byte 列を固定する。
    -   番組時刻をサーバー現地時刻の年月日時分秒へ変換し、モジュール読込時に一度決めた UTC 時差を稼働中の時刻帯変更や夏
        時間切替で更新しないことを隔離 child process で確認する。
    -   半角番組本文と保存済み entity の直接変更は task 4 の target test と分離する。
    -   完了時には、説明の全組合せ、五記号、SUB、非変換項目、固定時差、および空白・改行の fixture が通常表記の承認済み
        byte 列を再現し、production code の差分がない。
    -   DB projection・clock・document byte 境界を検証し、module load 順序は test harness の隔離 child process だけで固
        定する。製品機能の child process・filesystem・IPC 境界、および要求 race・deadline・timer/listener は非適用とし、
        置換・条件・時刻書式の誤りは exact byte で検出する。
    -   _Requirements: 3.8, 3.9, 3.10, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    -   _Boundary: XMLTV 番組文字列・時刻・serializer_

-   [x] 4. 半角番組本文と要求ローカル projection を TDD で整合させる
-   [x] 4.1 半角指定と保存済みentity不変条件をREDからGREENまで一変更単位で整合させる

    -   対象は `src/model/api/iptv/IPTVApiModel.ts`、
        `test/server/iptv-export/unittest/spec/representation.spec.test.ts`、および
        `test/server/iptv-export/unittest/imp/serializers.test.ts` とする。
    -   通常名と半角名、通常説明と半角説明、通常詳細と半角詳細が異なる synthetic 番組を用意し、`isHalfWidth=true` では半
        角fieldだけがXMLTV番組本文へ現れ、入力entityが不変である期待値を先に固定する。既存通常表記testは成功したまま、半
        角field未選択とentity代入だけを期待理由としてREDにする。
    -   通常説明がない場合は半角詳細だけも出さず、選択後の番組名・説明へ既存の五記号置換と SUB 除去を同じ順で適用する。
    -   各番組から通常または半角の名前・説明・詳細を要求ローカル値へ選ぶ最小production実装を行い、保存済みentityを変更せ
        ず置換・説明連結・直列化する。保存schema、番組query、HTTP carrier、外部API schemaは変更しない。
    -   target仕様testと実装testを再実行してGREENにし、通常・半角の両要求後もDB portから受け取ったentityの全fieldが呼出
        し前snapshotと一致することを確認する。REDのrequired testを残した状態で本checkboxを完了しない。
    -   完了時には、通常・半角のexact byte、説明欠損、五記号、SUB、入力snapshot不変の全target testがGREENになる。
    -   DB entity と要求ローカル projection の境界で通常・半角の連続順序を検証し、同時要求 race は task 4.2、timeout・
        timer/listener・filesystem・IPC・child process は非適用とする。field 選択・代入の誤りは snapshot と byte で検
        出する。
    -   _Requirements: 1.5, 1.6, 3.8, 3.9, 3.10, 3.11, 5.1, 5.2_
    -   _Boundary: XMLTV 非破壊 projection・番組 serializer_
    -   _Depends: 3.2_

-   [x] 4.2 通常・半角 XMLTV の互換 byte 列を結合検証する

    -   対象は `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   同じ DB fixture から通常表記と半角表記を連続生成し、選択 field 以外の宣言、属性、空白、改行、順序、時刻、および
        ID が同一であることを `integration` で検証する。
    -   通常説明あり・なし、詳細あり・なし、変換対象文字、および同時要求を組み合わせ、要求間で番組本文が混ざらないことを
        確認する。
    -   完了時には、通常・半角の exact document assertion が成功し、入力 DB fixture は生成前後で同一になる。
    -   DB と HTTP の結合境界で連続・同時要求の race と request isolation を検証する。文書期限は task 6、filesystem・
        IPC・child process は非適用とし、projectionの誤りは exact byte と DB snapshot で検出する。
    -   _Requirements: 1.5, 1.6, 3.5, 3.8, 3.9, 3.10, 3.11, 5.1, 5.2, 5.3_
    -   _Boundary: XMLTV 表記選択 integration_
    -   _Depends: 4.1_

-   [x] 5. M3U8同名表示の承認済みsuffixを回帰固定する
-   [x] 5.1 同名1〜4件のsuffix 0、2、3、4…をREDからGREENまで整合させる

    -   対象は `test/server/iptv-export/unittest/spec/m3u8.spec.test.ts` と
        `test/server/iptv-export/unittest/imp/ordering.test.ts`、および
        `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   同じ選択表記名を持つ1〜4件のチャンネルを順に出力したとき、元表示名の出現順に
        末尾ASCII空白が正確に0、2、3、4個となり、その後ろにU+3000を一文字置く承認済み結果を固定する。
    -   各件のチャンネルID、ロゴ、設定順、live URL、属性間空白、LFを含むM3U8全文書byteをassertし、部分文字列や表示名だけ
        の比較で代替しない。
    -   同名counterの最初の値だけを0、後続値を2、3、4…へ対応させる最小production修正を行う。チャンネル順、ID、URL、
        U+3000、属性間空白、LF、および公開schemaは変更しない。
    -   完了時には、1〜4件の全文書assertionが全件GREENで、0、2、3、4…のsuffix、U+3000、ID対応が固定され、required testに
        REDが残らない。
    -   serializer 内の重複名 counter 境界を検証し、要求間 race・timeout・timer/listener・filesystem・IPC・child process
        は非適用とする。counter と loop 境界の誤りは1件から4件の exact byte で検出する。
    -   _Requirements: 2.4, 2.11, 4.3_
    -   _Boundary: M3U8 同名表示 suffix_
    -   _Depends: 2.2_

-   [x] 6. 各 IPTV 文書要求へ30秒の絶対期限と遅延結果隔離を追加する
-   [x] 6.1 要求ローカルの絶対期限と一回完了guardをREDからGREENまで一変更単位で実装する

    -   対象は `src/model/service/api/iptv/channel.m3u8.ts`、`src/model/service/api/iptv/epg.xml.ts`、
        `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`、および
        `test/server/iptv-export/unittest/imp/request-completion.test.ts` とする。
    -   handler 開始時に monotonic clock から固定する 30,000ms の直前・到達・超過を fake timer と deferred DB port で再
        現する。
    -   query 変換、Host・通信方式・設定取得、DB 読取、および同期的文書生成を同じ absolute deadline に含め、成功応答確定
        直前にも期限内であることを確認する期待値を定義する。
    -   正常、DB・生成失敗、期限到達、要求切断の先着一件だけが完了し、期限・切断後の resolve/reject から応答、別要求の文
        書、または未処理 rejection を発生させないことを検証する。
    -   一件が期限到達または遅延中でも別要求は独立して正常完了し、文書全体の自動再生成が 0 回であることを同時要求
        fixture で確認する。
    -   target testを先に実行し、既存の即時成功・失敗testは成功したまま、30秒absolute deadline、単一完了、late-result
        fenceの不足だけを期待理由としてREDにする。
    -   handlerごとにabsolute deadline、完了済み状態、timerを持つ最小production実装を行い、成功、失敗、期限、切断の先着
        一件だけを確定する。成功確定直前にも同じdeadlineを再確認し、完了時にtimer/listenerを一回解放する。
    -   期限・切断後のPromise resolve/rejectは観測して応答だけを抑止し、DB処理の取消、永続化timeout/retry、global queue
        を追加しない。
    -   target仕様・実装testを再実行してGREENにし、REDのrequired testを残した状態で本checkboxを完了しない。
    -   完了時には、各要求の応答確定が最大一回、未処理rejectionと残留timer/listenerが0件で、残留がない。
    -   DB Promise・HTTP completion・timer/listener 境界で race、同着、期限直前・到達・超過、切断、資源解放を検証する。
        filesystem・IPC・child process は非適用とし、比較・CAS・cleanupの誤りは状態と副作用回数で検出する。
    -   検証は fake timer を用いた `unittest/spec` と completion state の `unittest/imp` で行う。
    -   _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: IPTV 要求 absolute deadline・completion state_
    -   _Depends: 1.2_

-   [x] 6.2 M3U8 要求へ絶対期限と切断処理を統合する

    -   対象は `src/model/service/api/iptv/channel.m3u8.ts`、
        `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`、および
        `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   handler 開始時から Host・通信方式・設定 snapshot、チャンネル読取、M3U8 生成、成功確定までを同じ 30 秒 guard で囲
        む。
    -   Host 不在、DB・生成失敗、期限到達を既存の文書生成エラー carrier へ一度だけ渡し、HTTP status・header の一般契約は
        `server-service-interface` に残す。
    -   期限・切断後に得たチャンネルまたは生成結果を送らず、後続の独立要求やライブ配信処理へ作用させない。
    -   完了時には、M3U8 の直前・到達・超過、切断、遅延 resolve/reject、および次要求成功の target test がすべて成功す
        る。
    -   HTTP・DB・timer/listener 境界で同着 race と全 terminal path の資源解放を確認し、filesystem・IPC・child process
        は非適用とする。deadline・late-result・二重応答の誤りは status、body、回数、および残留0件で検出する。
    -   検証は `unittest/spec` と HTTP adapter を含む `integration` で行う。
    -   _Requirements: 6.3, 6.5, 6.6, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: M3U8 HTTP 要求 lifecycle integration_
    -   _Depends: 2.3, 6.1_

-   [x] 6.3 XMLTV 要求へ絶対期限と切断処理を統合する

    -   対象は `src/model/service/api/iptv/epg.xml.ts`、
        `test/server/iptv-export/unittest/spec/request-lifecycle.spec.test.ts`、および
        `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   handler 開始時から query、番組読取、チャンネル読取、XMLTV 生成、成功確定までを同じ 30 秒 guard で囲む。
    -   番組読取、チャンネル読取、生成、期限の各失敗を既存の文書生成エラー carrier へ一度だけ渡し、途中までの XMLTV を返
        さない。
    -   期限・切断後に一方の読取が完了しても残りの文書処理や応答を開始せず、遅延 rejection を未処理にしない。
    -   完了時には、XMLTV の各読取段階、同期生成超過、切断、遅延 resolve/reject、および同時要求独立性の target test がす
        べて成功する。
    -   二つの DB Promise・HTTP completion・timer/listener 境界で順序、race、期限、解放を確認し、filesystem・IPC・child
        process は非適用とする。deadline・late-result・部分文書の誤りは status、body、回数、および残留0件で検出する。
    -   検証は `unittest/spec` と HTTP adapter を含む `integration` で行う。
    -   _Requirements: 6.5, 6.7, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: XMLTV HTTP 要求 lifecycle integration_
    -   _Depends: 6.1_

-   [x] 7. IPTV 文書生成の domain contract を統合検証する
-   [x] 7.1 M3U8 の入力から exact byte 文書までを実 DB adapter と統合検証する

    -   対象は `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   synthetic なチャンネルを SQLite と MySQL 共通の repository contract fixture へ保存し、対象サービス、設定順、同名
        表示、ID、ロゴ有無、および exact M3U8 byte 列を `integration` で検証する。
    -   OpenAPI の `mode` 小数 floor、Host・通信方式・サブディレクトリ、およびライブ参照が既存公開 path と一致することを
        確認し、ライブ視聴自体は開始しない。
    -   DB 成功・失敗、30秒超過、切断、遅延結果、および別要求成功を同じ deterministic clock で検証し、部分文書・二重応
        答・自動再生成を発生させない。
    -   HTTP route、status、header、Host carrier の一般実装、DB lifecycle、および映像配信 path を本 task へ重複実装しな
        い。
    -   完了時には、両 DB contract で M3U8 の exact document assertion と全 failure fixture が同じ承認済み結果を返す。
    -   DB・HTTP 境界、deadline/切断 race、response・timer・listener 解放を実 fixture で確認し、filesystem・IPC・child
        process は非適用とする。変更対象の誤りは exact byte、status、副作用回数で検出する。
    -   _Requirements: 1.1, 1.4, 1.5, 1.6, 1.8, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12,
        2.13, 2.14, 2.15, 4.1, 4.3, 4.4, 4.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: M3U8 文書生成・DB adapter integration_
    -   Service Interfaceのtyped builder caller bindingとMedia Deliveryのstable live routeが外部barrierを満たした後に実
        行する。
    -   _Depends: 2.3, 5.1, 6.2_

-   [x] 7.2 XMLTV の入力から exact byte 文書までを実 DB adapter と統合検証する

    -   対象は `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   synthetic なチャンネル・番組を SQLite と MySQL 共通の repository contract fixture へ保存し、期間端点、標準順、ID
        対応、通常・半角表記、文字・時刻、および exact XMLTV byte 列を `integration` で検証する。
    -   OpenAPI の `days` 小数 floor、空文書、同時刻番組、および通常説明・詳細説明の全組合せを同じ deterministic clockで
        確認する。
    -   各 DB 読取失敗、30秒超過、同期生成超過、切断、遅延結果、および別要求成功を検証し、部分文書・二重応答・自動再生成
        を発生させない。
    -   HTTP carrier、番組データの意味、DB lifecycle、および設定 parser を本 task へ重複実装しない。
    -   完了時には、両 DB contract で XMLTV の exact document assertion と全 failure fixture が同じ承認済み結果を返す。
    -   DB・HTTP 境界、二読取の順序、deadline/切断 race、response・timer・listener 解放を実 fixture で確認し、
        filesystem・IPC・child process は非適用とする。変更対象の誤りは exact byte、status、副作用回数で検出する。
    -   _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12,
        3.13, 3.14, 3.15, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.5, 6.7, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: XMLTV 文書生成・DB adapter integration_
    -   _Depends: 4.2, 6.3_

-   [x] 7.3 domain suite を共有 server test matrix へ統合する

    -   対象は `test/server/iptv-export/` の機能固有 suite とし、共有 runner、coverage、Node.js matrix の設定
        file は変更しない。
    -   IPTV 入力、M3U8、XMLTV、表記、文字・時刻、要求期限、および遅延結果隔離を共有
        `unittest/spec`、`unittest/imp`、`integration` command から実行できるようにする。
    -   Node.js 24 を必須 gate、Node.js 26 を同じ suite の追加 gate として実行し、matrix 定義や runner を本 spec で複製
        しない。
    -   fixture は synthetic な Host、チャンネル、番組、時刻、および DB failure だけを使い、実 URL、実番組名、実ロゴ、認
        証情報、および環境固有 path を tracked test や出力へ含めない。
    -   HTTP・DB 境界を含む feature suite を共有 command の入力として接続し、filesystem・IPC・child process は非適用とす
        る。race、timeout、資源解放、および値域・分岐の判定は各機能固有 test の実結果を消費する。
    -   完了時には、本機能の全68 Acceptance CriteriaのうちR1からR6の63件が一件以上の自動testへ対応し、R7の5件はtask 8.2から8.5へ割当済みで、共有commandから同じdomain suiteを実行できる。後続品質taskの実行結果を本
        taskの完了条件へ循環参照しない。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
        2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14,
        3.15, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
        6.10, 6.11_
    -   _Boundary: IPTV 文書生成 domain validation_
    -   _Depends: 7.1, 7.2_

-   [x] 8. 機能固有の品質を閉じる
-   [x] 8.2 内部分岐の値域 test と実装境界 assertion を準備・検証する

    -   対象は `test/server/iptv-export/unittest/imp/query.test.ts`、
        `test/server/iptv-export/unittest/imp/serializers.test.ts`、
        `test/server/iptv-export/unittest/imp/ordering.test.ts`、および
        `test/server/iptv-export/unittest/imp/request-completion.test.ts` とする。
    -   imp の4 fileと値域caseが未実装の状態でimp gateを先に実行し、欠落している値域・分岐・meaningful assertionだけを期待理
        由としてREDにする。現在の承認済み挙動を意図的に誤った期待値へ変えない。
    -   省略、正負の小数 floor、0件、対象・対象外、期間端点、同名・同時刻、説明欠損、文字置換、固定時差、DB・生成失敗を
        戻り値、exact byte、状態、副作用回数の meaningful assertion で検証する。
    -   DB/HTTP はport fixtureによる補助境界、filesystem・IPC・child processは非適用とする。deadline直前・到達・超過、
        late settlement、timer/listener解放を含む実装境界assertionを準備・検証する。
    -   最小test/harnessと、承認済み差分に必要な最小production/seamだけを追加し、全imp target testをGREENにして実装境界assertion mappingを準備・検証する。REDのrequired testを残して8.4へ進まない。
    -   完了時には、値域・分岐matrixの未分類が0件で、実装境界assertion mappingが準備・検証済みになる。
    -   _Requirements: 7.2_
    -   _Boundary: IPTV implementation tests・実装境界assertion mapping
        consumption is Task 8.5_
    -   _Depends: 7.3_

-   [x] 8.4 DB読取からHTTP文書byteまでの結合境界を品質gateとして確定する

    -   対象は `test/server/iptv-export/integration/iptv-db-http.integration.test.ts` とする。
    -   integration fileとSQLite/MySQL共通fixtureが存在しない状態で結合gateを先に実行し、DB/HTTP evidence欠落だけを期待
        理由としてREDにする。
    -   SQLite/MySQL共通repository fixtureから、M3U8・XMLTV query、Host、status、Content-Type、exact byteまでを接続し、
        DB成功・失敗、空文書、deadline、切断、late result、および同時要求隔離を検証する。
    -   DB connectionとHTTP response・timer・listenerの終了をassertし、IPC、filesystem、child processは本機能の結合経路
        に存在しないため非適用理由を残す。
    -   結合testが担当する境界はexact byte、status、回数、資源解放で検出し、unit testのmock呼出し確認だけで代
        替しない。
    -   Persistence ownerのDB harnessとService Interface ownerのHTTP adapterを消費する最小integration harnessを追加し、
        必要な承認済み差分だけを実装して全fixtureをGREENにする。REDのrequired testを残して8.5へ進まない。
    -   完了時には、両DB contractのM3U8・XMLTV正常系と全failure fixtureが同じ承認済み結果を返し、結合境界の未分類が0件に
        なる。
    -   _Requirements: 7.4_
    -   _Boundary: IPTV DB・HTTP integration gate_
    -   _Depends: 7.1, 7.2, 8.2_

-   [x] 8.5 本機能の品質判定を満たす

    -   Task 8.2と8.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   Designのspec case一覧とtest matrixを、requirements.mdのACと突き合わせてレビューし、欠落・重複・空欄が0件であることを確かめる。
        一覧とmatrixを読む監査testは置かない。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 8.2, 8.4_
    -   _Requirements: 7.1, 7.3, 7.5_
