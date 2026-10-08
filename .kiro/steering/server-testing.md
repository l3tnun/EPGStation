# Serverテスト方針

## 目的と適用範囲

この文書は、EPGStation Serverのtest設計、coverage、trace / scenario matrix、不一致処理、品質完了条件の正本である。 `src/`の
server production codeと`.kiro/specs/server-*`へ適用し、`client/`には適用しない。clientのtest方針は
`.kiro/steering/testing.md`を正本とする。

testの目的は件数やscoreを増やすことではなく、承認済みの契約、値域、状態、失敗、時間境界、並行処理、外部境界、資源解放を
検証し、server変更による副作用を検出することである。

## 仕様と実装の正本

-   各機能の外部から観測可能な契約は、承認済みのRequirementsとDesignをtest oracleとする。
-   sourceから再構築した仕様にも誤りが含まれ得るため、仕様、source、test、runtime evidenceの一致を前提にしない。
-   疑わしい仕様testを通すためだけにproduction sourceを変更しない。
-   挙動を変更する場合は、影響するRequirements、Design、Tasks、test、source、traceを同じ検証可能な変更単位で同期する。
-   公開API、DB、設定、保存形式、互換性の判断は、既存契約とowner承認を確認せずtestまたは実装だけで変更しない。
-   Requirements、Design、Tasks、Implementationの人間承認gateを維持する。後続phaseのtestを先行作成して承認を代替しない。

## 共有Test Foundationと所有権

サーバー起動・稼働管理機能（`server-application-runtime`）は、全server機能が利用するtest foundationを一度だけ所有する。

-   `test/server`をserver testの唯一のrootとする。
-   Vitestを共通runner、V8 coverageをcoverage計測手段とする。
-   production serverをcompileした後、testはproductionと同じ`dist`成果物をimportし、source mapを通じてTypeScript source
    へcoverage結果を対応付ける。
-   root packageは仕様test、実装test、結合test、coverageを個別または一括実行できる固定commandを提供する。
-   各`server-*`は機能固有のtest、fixture、DB schema、HTTP payload、process scenarioを所有し、runner、test root、
    coverage commandを重複実装しない。
-   synthetic fixture、fake timer、deferred Promise、call ledger、temporary filesystem、isolated child processを使い、実
    時刻、実DB、実network、実運用dataへの不要な依存を避ける。
-   fixtureとtest outputへ実URL、実番組情報、credential、実保存path、実チューナーサーバー情報を含めない（詳細は「testを書く規則」）。
-   coverageの計測道具（V8 coverageの収集、source mapによるTypeScript sourceへの対応付け、集計）もruntimeが所有し、
    各`server-*`は重複実装しない。
-   Docker imageの起動確認（image内の`dist`でserverが起動し、`/api/version`が応答すること）の要件はruntimeが所有する。

test foundationの所有は`server-application-runtime`とする。各`server-*`は自機能のtest、fixture、DB schema、HTTP payload、
process scenarioを所有する。

tool、package、script、configurationの追加は、承認済みImplementation taskで行う。このsteeringの作成だけをtest foundation
の実装またはtest gateの成功として扱わない。

既存specへこの方針を反映する場合は、owner specのRequirementsを先に更新して人間承認を得る。DesignとTasksはその後の各phase
で更新・再承認し、この方針と未整合のdraftをImplementationの入力にしない。

## Test種別と責務

### `unittest/spec`

-   承認済みRequirementsとDesignから導いた、利用者または他機能から観測可能な契約を検証する。
-   入力と出力、状態遷移、完了条件、失敗、retry、cancel、restart、shutdown、互換性を対象にする。
-   内部class、private method、特定の実装順だけを外部契約として固定しない。

### `unittest/imp`

-   utility、変換、validation、algorithm、内部状態、分岐、characterization、adapter境界を検証する。
-   外部契約を重複定義せず、実装上必要な値域、境界値、失敗分岐、副作用、資源解放を固定する。
-   既存挙動のcharacterizationは、望ましい挙動への承認なしの書換えではなく、確認済みの事実を証拠として保持する。

### `integration`

-   DB、HTTP、IPC、filesystem、child process、および複数server機能間の接続を検証する。
-   unit testのmock呼出し確認だけでは証明できないserialization、transaction、stream、process、signal、file、listener、
    timerの実際の境界と後始末を確認する。
-   SQLite/MySQL、Mirakurun/mirakc、Node.js、OS等の対応範囲は、対象仕様と技術方針に従ってsynthetic、local、実環境の確認
    を区別する。
-   実環境でしか確認できない項目は、実行条件、安全境界、代替test、未確認riskを明記し、未実行をPASSにしない。実環境で得た結果を
    記録するときは、host名、path、credentialを伏せる。

仕様test、実装test、結合testは互いを代替しない。同じ契約に複数層が必要な場合は、各層が何を証明するかを分ける。

## 必須Test Matrix

各機能または変更対象について、次の観点をtest、非適用理由、または未解決項目へ一意に割り当てる。

| 観点       | 必須内容                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| 契約       | Requirement、Acceptance Criteria、既存互換contract                       |
| 種別       | `unittest/spec`、`unittest/imp`、`integration`                           |
| 入力       | `null`、空、0、1、最小、最大、範囲外、不正型、重複                       |
| 状態       | 開始前、進行中、成功、失敗、cancel、再入、restart                        |
| 時間と順序 | timeout、deadline直前・到達・超過、late settlement、同着、race、重複通知 |
| 資源       | DB transaction、stream、file、timer、listener、child process、lock       |
| 外部境界   | DB、HTTP、IPC、filesystem、process                                       |
| 結果       | command、対象件数、成功・失敗、除外、未解決risk                          |

正常経路だけでなく失敗経路を含める。行を実行した事実だけでなく、戻り値、副作用、状態遷移、順序、回収結果をassertする。非
適用項目は空欄にせず理由を残す。

## Coverage Gate

-   単体test（`unittest/spec`と`unittest/imp`）だけで、server production scope（`src/**/*.ts`）のC0（statement coverage）と
    C1（branch coverage）を100%にする。結合testの通過をC0/C1の達成に数えない。
-   計測は、production serverをcompileした`dist`を対象に、V8 coverageをsource map経由で`src/**`へ対応付けて行う。
    実行文を持たない`.d.ts`だけをproduction coverage対象外候補とする。
-   測定が成立しない場合（test失敗、計測結果の欠落・破損、対象が空）は、百分率を読まず未達として扱う。
-   coverage 100%をtestの完全性とみなさない。Test Matrix、assertion、integration、independent reviewを別に確認する。
-   構造上testから到達不能な箇所は、検証不能な最小lineまたはbranchだけを、理由と代替integration/process検証を付けて除外
    できる。
-   directory全体、file全体、広い関数範囲の除外、数値達成だけを目的とするtest、到達不能codeの追加を禁止する。
-   除外はsourceまたはcoverage configurationの対象箇所に、対象、理由、代替testを追跡できる形で記録する。
-   coverage対象、compiler、source map、Vitest/V8設定が変わった場合は、過去のcoverage結果を再利用せず全対象を再計測す
    る。
-   coverageの計測値や未達locationを理由に、product code変更、広い除外、feature-specの一括変更、到達可能性の主張を認可しな
    い。そのようなfollow-upは、対象owner specの通常の承認済みRequirements → Design → Tasksプロセスを経る。

## 不一致の分類と処理

仕様、source、test、runtime evidenceが一致しない場合は、次のいずれかへ分類する。

| 分類                    | 処理                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `spec defect`           | sourceとruntime evidenceを再確認し、該当Kiro phaseへ戻って仕様を修正・再承認する |
| `implementation defect` | 承認済み仕様を保持し、失敗するtestを先行して最小修正する                         |
| `test defect`           | test oracle、fixture、mock、assertion、実行条件を修正する                        |
| `approved change`       | owner承認済みの変更として仕様、test、source、traceを同期する                     |
| `unknown`               | 推測で埋めず、追加のsource調査またはruntime evidenceへ割り当てる                 |

`unknown`、公開互換性判断、破壊的data判断を、testの都合だけで`implementation defect`へ分類しない。分類根拠と対象限定の独
立reviewを残し、owner判断が必要な項目だけを短い一覧で提示する。

## Reviewと完了Gate

Implementation taskまたはserver品質gateを完了とするには、対象範囲に応じて次をすべて満たす。

1. Test Matrixの未分類項目が0件である。
2. required testが全件成功している。
3. 単体testだけで変更scopeを含む`src/**`のC0/C1が100%である。最小line/branch除外を使う場合は根拠と代替検証を残す。
4. 変更scopeのsource / Requirement / Design / Task / external-observable test / scenario matrixの対応が一対一で成立し、
   未分類0件である。
5. 実装を担当していないreviewerのCritical/Important findingが0件である。
6. handoffに変更file、実行command、対象件数、結果、coverage除外、未解決riskがある。

reviewは変更対象と影響境界へ限定する。指摘修正後は指摘箇所と必要な回帰だけを再reviewし、根拠なく全体reviewを反復しない。
期限や未実行のgateを理由に品質taskを完了扱いにしない。

## testを書く規則

testの書き方の規則。機械的に検出できるものは`npm run lint`（ESLintの規則。実装は`tools/eslint-test-rules-server.mjs`と、
それが呼ぶ`tools/eslint-version-scan.ts`・`tools/eslint-fixture-scan.ts`）が検出し、人が見て守るものはreviewで確認する。
lintの規則はdisable commentで外さない。

### lintが検出する規則

対象のfileの範囲は規則ごとに異なる。`.ts`・`.mjs`・`.cjs`・`.js`のほか、`.json`・`.jsonc`・`.md`・`.toml`・`.txt`・
`.yaml`・`.yml`・`.sql`・`.pem`と`.gitignore`・`.npmignore`・`.gitleaksignore`は、textのまま検査する（`.artifacts`を除く）。

| 規則（`epgstation-test/`） | 範囲 | 検出する内容と例外 |
| --- | --- | --- |
| `no-version-branch` | `test/server`、`scripts/server-test`の全file | `process.version`・`process.versions`・`process.release`の読み取り（`?.`・`process['versions']`・`require('process')`・`import('process')`経由、`import { versions } from 'process'`、`const { versions } = process`を含む）と、`NODE_VERSION`・`NODE_MAJOR`の記述。textを走査するので、commentや文字列の中の記述も対象。例外は無い |
| `no-conditional-test` | `test/server`、`scripts/server-test`の全file | `it`・`test`・`describe`の`.skip`・`.skipIf`・`.runIf`・`.only`・`.todo`・`.fails`（bracket記法を含む）と、`skipIf(...)`・`runIf(...)`の呼出し。例外なし |
| `no-version-specific-file` | `test/server`、`scripts/server-test`の全file | pathにNode 18または26を表す語と`runner`・`command`・`fixture`・`skip`・`allowlist`・`workaround`・`fallback`のいずれかを含むfile。例外なし |
| `no-platform-early-return` | `test/server/application-runtime/**/*.test.ts`、`test/server/tuner-access/**/*.test.ts` | `if (process.platform ...)`の本体が`return`・`continue`で始まる形（OS依存のfileは、実行する環境で選ぶ）。例外なし |
| `no-real-fixture-value` | `test/server`の全file | fixtureの検出器（`tools/eslint-fixture-scan.ts`）が報告する、実在し得るURL・IP address・credential・番組名・チューナー名・絶対の保存path。`.json`は値として、ほかはtextとして走査する。`.invalid`のhost、loopback・unspecifiedのaddress、`<...>`・`synthetic-`/`test-`始まりの値、test用の一時directory配下のpathは合成値として認める |
| `child-env-inherited` | `test/server`の`.ts` | `spawn`・`fork`と、`vitest`を引数に含む`execFile`の`env`は、指定しない、`process.env`、`...process.env`を1つだけ展開しほかの展開と`NODE_V8_COVERAGE`の指定を持たない object literal、先頭が`...process.env`で展開が2つまでかつ末尾が`NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE`の object literal、のいずれかに限る。例外は無い |
| `no-dynamic-eval` | `test/server`の`.ts`・`.js`・`.cjs` | `Function(...)`・`new Function(...)`・`<名前空間>.Function(...)`・`eval(...)`。例外なし |
| `no-direct-src-import` | `test/server`の`.ts` | `../`で`src/`へ上る相対pathの値のimport（`import`、動的`import()`、`require()`、`import x = require()`、`export ... from`）。型だけのimport（`import type`、全specifierが`type`）は可。例外なし |

### 人が見て守る規則

1. **製品を実行して判定する。** testは`src`のproduction codeを実際に実行し、戻り値、副作用、状態遷移、順序、解放を
   assertする。sourceの文字列・構文・件数・ファイル構成を読んで形を判定するtest、値や文字列を比べるだけのtest、title
   だけで本体が空のtest、本体の先頭で`return`して何も検証しないtestを書かない。構造の規則は、testではなくlintに置く。
2. **層と対応を保つ。** testは`*.spec.test.ts`（または`unittest/spec/`）、`*.imp.test.ts`（または`imp/`）、
   `*.integration.test.ts`のいずれかに置き、層の責務（「Test種別と責務」）を越えない。各受入基準に、その基準を主に検証する
   `unittest/spec`のcaseを1つ持たせ、case名に基準IDを書く。assertの無いcaseを主caseにしない。
3. **Test Matrixを埋める。** 値、状態、時間、資源の各観点を空欄にせず、testまたは非適用理由へ割り当てる。
4. **fixtureは合成値にする。** URL、IP address、credential、番組名、チューナー名、保存pathは機械に依存しない合成値
   （`.invalid`のhost、loopback、`<...>`、`synthetic-`始まりの名前）にする。lintが検出するのは上の表の範囲で、検出器が
   見分けられない値（実在するか判断が要る番組名・チューナー名など）は目で確認する。
5. **一時fileの置き場所。** testに`/tmp`のliteralを書かない。一時file・directoryは`os.tmpdir()`（`TMPDIR`に従う）か`test/server/.artifacts/`配下に作る。
   `/tmp`はtmpfsでメモリを消費するため、GB級の書き出し（Docker imageのexport、coverageの生出力など）を既定の`os.tmpdir()`
   に任せない。重いtestは`TMPDIR`をディスク上のdirectoryへ向けて起動する。
6. **子processの環境変数。** 子processの`env`は、`process.env`を引き継ぐ形に限る（lintが検出する形は上の表）。`env`を
   別のobjectにすると、coverageの計測（`NODE_V8_COVERAGE`）が子processに届かず、子processで実行した`src`のcoverageが落ちる。
   上書きが要るときは`{ ...process.env, 名前: 値 }`とし、`NODE_V8_COVERAGE`を落とさない。
7. **時間でなく状態を待つ。** 待つ対象の状態（deferredの解決、event、queueのjobの完了、`kill`の呼出し、callの回数、
   fake timerの`advance`）を直接待つ。固定時間のsleepを足して通さない。期限を延ばしてtestを通さない。時間の経過そのものを
   検証するtestはfake timerを使い、clockをtest側で進める。
8. **後始末をhookに置かない。** 外部command、container削除、process終了待ちのような重い後始末を、timeoutの短い
   `afterEach`・`afterAll`に置かない。testの本体（`try`/`finally`、または末尾に置いた明示timeout付きのcase）で行う。hookに
   残すのは、冪等で軽いfallbackだけにする。
9. **起動した資源を回収する。** testが起動した子process、container、server、listener、timer、一時fileは、成功・失敗・
   timeoutのいずれでもtestの中で回収する。子processはprocess groupごと終了させる。
10. **testを外さず、環境で分岐しない。** 外部境界のtestを`skip`で無効化せず、`.only`・`.todo`・`.fails`も残さない。Nodeの
    version・OSでtestを分岐させない（lintが検出する範囲は上の表）。`src/`を値として直接importせず、source textを`eval`・
    `Function`で実行しない。開発containerはNode 24に固定する。OS依存のtestが必要な
    場合は、そのfileを分けて対象の環境でだけ実行されるようにする。
11. **testを通すためだけにproduction codeを変えない。** 不一致は「不一致の分類と処理」に従って分類する。
12. **検査を新設するときは効くことを確かめる。** testにguard・分類器・導出器を足したら、それを無効化すると落ちることを
    確かめる。現在のtreeに該当例が0件の分岐は、現在のtreeを読むだけでは検証できないので、合成の入力で駆動する。
13. **共通のtest基盤を重複させない。** runner、harness、fixture生成の持ち主は`server-application-runtime`の1か所とし、
    各`server-*`は自分のtestとfixtureだけを置く。
