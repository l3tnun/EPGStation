# Server機能仕様書方針

## 目的

server仕様書は、EPGStation Serverが持つ機能、その責務、依存、workflow、状態、algorithmを理解し、変更影響と実装箇所を追跡するための正本とする。source構造の一覧を仕様の代わりにしない。

## 正式仕様の単位

- 正式なserver仕様は機能単位の`.kiro/specs/server-*`とする。
- 1つのspecは、独立して説明・review・test・変更できる責務を1つ所有する。
- source directory、class、API route、DB table、scanner categoryだけを分割根拠にしない。
- 共通platform capabilityは、3つ以上の機能から利用され、固有のlifecycleまたはcontractを持つ場合に独立specとする。
- 同じ業務判断、状態、data ownershipを複数specへ重複記述しない。consumer側はowner specのcontractを参照する。
- domain specはmutationだけでなく、一覧・詳細・filter・分類・pagination・projection等のread/query意味も所有する。HTTP carrierへ業務queryの意味を移さない。
- domain outcomeのschemaと発行条件はproducer domain、跨域commandの選択と順序はworkflow spec、routing/IPC/client/hook配送はdelivery specが所有する。
- 循環を避けるためのconsumer-owned portは、contract owner、実装owner、runtime bindingを明記する。aggregate/file等のresource handoffはadoption前後のownerと失敗時cleanupを定義する。

## Kiro phase

各specは`brief.md`、`spec.json`、`requirements.md`、`design.md`、`tasks.md`を持つ。Requirements → Design → Tasks → Implementationの順に進み、各phaseのreview状態は`spec.json`で管理する。あるphaseの承認を別phaseの承認へ読み替えない。

## brief.md

briefは、初めてEPGStationに触れる読者が「何を実現する機能か」をソースコードを読まずに理解するための機能概要とする。

- 日本語の機能名と「この機能が提供するもの」から書き始める。
- 主な機能、利用者または他機能から見た処理の流れ、異常時の動作、他機能との関係、対象外、未確認事項を平易な言葉で説明する。
- 内部構造や設計用語ではなく、EPGStationが行うことと利用者・運用者が観測できる振る舞いを主語にする。
- 条件付き処理、部分失敗、retry、再起動は、成立条件と保証範囲を明記する。
- 他の機能との関係では、日本語の機能名を先に示し、対応する`server-*`名を文書間参照として併記できる。
- 他の機能との関係で使う日本語名は、参照先の`brief.md`の機能名と一致させる。
- source path、file名、class、interface、関数、変数、library、DI、container、implementation mappingを記載しない。
- ソースコードとの対応、内部component、具体的なalgorithmは`design.md`に記載する。

## requirements.md

requirementsは次を機能の言葉で定義する。

- 提供する能力と利用者
- 入力、出力、事前条件、完了条件
- 状態と外部から観測可能な振る舞い
- failure、retry、cancel、restart、shutdown時の契約
- compatibilityとsecurity/privacy制約
- out-of-boundary

「特定fileを解析する」「scannerが候補を列挙する」ことを製品requirementにしない。

## design.md

designは上から次の順序で説明する。

1. 機能の目的、責務、境界、利用者
2. upstream/downstream dependencyと依存方向
3. component、interface、port/adapter、data ownership
4. 主要workflow、timeline、状態遷移
5. algorithm、不変条件、並行処理、idempotency
6. failure、rollback、retry、cleanup、restart、shutdown
7. API、IPC、event、DB、filesystem、tuner等のcontract
8. test strategy、unknown、revalidation trigger
9. class、関数、source pathへのimplementation mapping

source locatorは設計の根拠と実装入口であり、文書の目次または責務境界にはしない。

## 図表

説明対象に応じてMermaid等を使用する。

- spec / component依存関係図
- API、IPC、event、非同期処理のシーケンス図
- reservation、recording、encode、stream等の状態遷移図
- 判定、retry、conflict、rollbackのフローチャート
- module、class、interface、port/adapterの構成図またはクラス図
- entity、relation、ownershipを表すER図

全種類を機械的に載せず、機能理解に必要な図を選ぶ。図の正常経路と例外経路、状態、責務を本文でも説明する。

## Source-backed evidence

- 実装で確認できる事実、仕様上の決定、未解決事項を区別する。
- 挙動の断定にはsource locatorまたは実行時証拠を付ける。
- sourceだけで意図やruntime結果を証明できない事項はunknownとして残す。
- privateなruntime値、実URL、実番組、machine固有pathをtracked specへ記録しない。
- sourceまたは仕様の変更と同じ変更単位で、影響を受けるrequirements、design、図表、implementation mappingを更新する。

## Testとの同期

- server testの共通方針と品質gateは`.kiro/steering/server-testing.md`を正本とする。
- 各`server-*`は機能固有の`unittest/spec`、`unittest/imp`、integrationを所有し、共有runner、coverage基盤は`server-application-runtime`が一度だけ所有する。
- `.kiro/specs/server-*`は22あり、うち`server-shared-foundation`は複数の機能が共通で使う基盤（utility、characterization）を持つ。それ以外の21は製品機能の仕様である。`server-shared-foundation`は製品機能の仕様ではなく、他の機能から依存される共通の基盤として扱う。
- server全体の検証は手元の`npm run preflight -- --all`が行う。検査する中身は、server testの全件、単体testだけで`src/**`のC0/C1 100%、Node.js 24/26、Docker imageの起動確認（Debian・Alpine）、rootのlint・format・typecheckである。coverageの扱いは`server-testing.md`の「Coverage Gate」に従う。
- 仕様、source、test、runtime evidenceの不一致を、testを通すためだけにproductionへ合わせない。
- 挙動を変更する場合は、該当Requirements、Design、Tasks、test、source、implementation mappingを同じ変更単位で同期し、必要なKiro phaseのhuman approvalを得る。
- coverageだけで仕様網羅性またはtest完全性を主張しない。

## 既存実装から仕様を再構築する場合

- ownerが明示的に変更を決定した挙動を除き、確認済みの外部観測可能な実装をrequirementsの既定契約とする。
- 経路、データベース方式、設定値の有無などによって挙動が異なる場合は、存在しない統一規則を作らず、確認できる差をそのまま記述する。
- sourceにもowner決定にも存在しない世代管理、安定識別子、所有権移転、結果保持、再照合、retry、queue上限、互換移行、終了protocol等を、一般的な設計上の望ましさだけでrequirementsへ追加しない。
- 確認済みの不具合や内部不整合は、望ましい挙動へ黙って書き換えず、修正対象として仕様本文と区別する。修正する場合は変更後のrequirements、design、test、implementationを同じ変更単位で更新する。
- 公開API、CLI、設定形式、保存形式などの互換面で文書と実動作が異なる場合は、ownerが別の変更を承認するまで実動作を互換基準とし、文書側の差異を修正する。
- 将来案を正式仕様へ昇格する場合は、既存挙動との差、互換性への影響、移行の要否を示し、該当Kiro phaseのhuman approvalを得る。

## Cross-spec review gate

- capabilityとspecの対応に未割当がない。
- dependency graphが循環せず、owner/consumerが明確である。
- API/IPC/event/data contractのproducerとconsumerが一致する。
- 同じ状態、algorithm、file、tableを複数specが無説明に所有しない。
- open unknownはowner specのunknownまたは後続test taskへ割り当てる。
- tasks生成前にrequirements/design、図表、source mapping、unknown、test strategyをownerがreviewできる。
