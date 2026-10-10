# テスト方針

## 上位目標

フロントエンド再実装の unit test は、最終的に C1 / C2 coverage
100% を目指す。これは単なる数値目標ではなく、仕様から導いた分岐、条件、edge case を test で説明できる状態を目標とする。

C1 / C2 coverage
100% を満たすために、実装を不自然に分岐させたり、価値のない到達不能 code を残したりしない。coverage を満たしにくい code は、責務分離、純粋関数化、境界の明確化、または不要 code の削除で改善する。

将来的に CI / DI を導入し、使用しているライブラリの自動アップデートを安全に実現するため、unit test と E2E
test は最低限必要な gate として扱う。依存ライブラリの自動更新は、unit test と主要 E2E
test が安定して CI で通る状態になってから導入する。

## testを書くときの規則

機械的に検出できる規則は client の ESLint（`client/eslint.config.js`、実装は root の `tools/eslint-test-rules-client.mjs`、
`cd client && npm run lint`）が検出し、人が見て守る規則は review で確認する。lint の規則は disable comment で外さない。

### lint が検出する規則

対象は `client/unittest/spec/**/*.test.{ts,tsx}`と `client/src/**`（`v8 ignore` の規則）で、
`epgstation-test/` の規則が検出する。`client/e2e`・`client/visual` には適用しない。

| 規則 | 内容と例外 |
| --- | --- |
| `no-real-time-poll-under-fake-timers` | 各 `it`・`test` の中で `vi.useFakeTimers()` から `vi.useRealTimers()` までの間に、`waitFor(` と `await findBy*(`・`await screen.findBy*(` を使わない。実時間で poll するので test の timeout まで止まる |
| `no-closing-surface-without-fake-timers` | `getByRole('alert')`・`findByRole('alert')`・`queryAllByRole('alert')` と `data-controls-visible` を、行頭が `expect(` でない行で扱う file は、`useFakeTimers` を呼ぶ。surface の状態を `expect(...)` で同期的に読むだけの行は対象外 |
| `no-real-time-sleep` | `setTimeout(resolve, N)`・`setTimeout(() => resolve(), N)` で N が 0 以外の固定時間を待たない。待ち時間 0 は event loop に譲るだけなので可 |
| `require-timeout-comment` | `timeout: <数値>` の明示的な待ち時間には、直前 4 行以内に `//` comment（その時間が覆う実装側の遅延）を付ける |
| `narrow-coverage-exclusion` | `client/src/**/*.{ts,tsx}`（`.d.ts`、`__fixtures__`・`__mocks__`・`test` directory を除く）の `v8 ignore` を次に限る。`file` / `if` / `else` は使わない。`next` は 5 行以内、`start` から `stop` までは 12 行以内。`next`・`start` は `--` に続けて、jsdom で検証できない category（layout、portal、media、fullscreen、orientation、pointer、geometry、service worker、socket.io、jsdom、navigator、ResizeObserver、IntersectionObserver、visualViewport、requestAnimationFrame、clipboard など）を含む理由を書く。1 file の除外行は 20 行以内で、5 行を超えるなら file の 15% 以内。`start`・`stop` は対応させ、入れ子にしない。1 行で閉じない（複数行の）comment は書式の違反 |

### 人が見て守る規則

1. **軸ごとに test が揃っていること。** 次の軸は、新しい値・key・module を足したときに対応する test を同じ変更で足す。
   「言及する test がある」ではなく、その test が値を正しく検証していることを確認する。
   - 幅の breakpoint: `*.module.css` の `@media (min-width|max-width)`、`*_MIN_WIDTH` / `*_MAX_WIDTH` 定数、inline の幅比較。
     各値について、その値または ±1px をいずれかの unit test か visual test が検証する
   - 設定: `DefaultSettingsValue` の全 key をいずれかの unit test が assert する
   - API schema: client が消費する schema module をいずれかの unit test が import して使う
2. **時間でなく状態を待つ。** 時間で閉じる surface は fake timer を有効にして clock を進めて観測する。`waitFor` や `findBy*`
   の期限を延ばして通さない。期限を置くときは、その値が覆う実装側の遅延を comment に書く。lint は `client/unittest/spec` だけを
   検出するので、`client/e2e`・`client/visual` では固定時間の待ち（`page.waitForTimeout` など）を使わず、状態を待つ。
3. **fixture は合成値にする。**（lint は検出しない） credential、実番組名、実 URL、実ロゴ、実サムネイルを test・baseline・fixture に含めない。
4. **coverage 除外の合計。** `client/src` 全体の除外行は 2% 以内とする（file ごとの上限は lint が検出する）。
5. **`.kiro/specs` は現在の仕様だけを書く。** 対象は client の spec（`.kiro/specs/frontend-*`）と server の spec
   （`.kiro/specs/server-*`）の全 file（requirements・design・tasks・brief・mock-data など）である。別の実装や過去の版との比較
   （別の版の名前を挙げた「〜と同じ」「〜から変わらない」「従来」「以前は」を含む）、過去の版の内容、報告・指摘の経緯、作業の
   手順（失敗する状態を経る手順など）を書かない。挙動は今の挙動として書く。値の根拠はリポジトリの外に置き、spec には値を書く。
   旧版との互換そのものが要件である場合は、比較ではなく現在の互換要件として書く。

## 網羅の範囲

client の test が保証している軸と、保証していない軸を区別する。保証している軸は上の「人が見て守る規則」1 の三つで、
機械的な検査は無く、review で確認する。

### 網羅していない軸

- **利用者操作の順序**: 画面上の操作をどの順で行うかの組み合わせは列挙しない。test するのは各 spec の受け入れ条件と
  `visual-cases.md` に書かれた操作列だけである。受け入れ条件に無い順序で起きる不具合は、この仕組みでは検出されない。
- **軸どうしの組み合わせ**: breakpoint、設定値、schema の各軸は個別に検査し、それらの直積（ある幅で、ある設定の
  組み合わせのとき）は列挙しない。
- **browser engine 間の差**: e2e と visual は Desktop Chromium / Desktop Firefox / Android Chrome / iOS Safari の
  4 project で走らせるが、engine ごとに全 case の期待値を個別に持つわけではない。engine 差を持つ期待値は、
  その差を実測した case にだけ注記する。

## Unit Test の種類

unit test は 2 種類に分ける。

- `unittest/spec`: 仕様 test。レビュー済み requirements / design から、ユーザー可視の挙動、route/query contract、API
  request contract、状態遷移を検証する。
- `unittest/imp`: 実装 test。実装内部の utility、request builder、transformer、reducer/store、validation、URL
  builder などの edge case と分岐を検証する。

`unittest/spec` は「仕様どおりか」を確認し、`unittest/imp`
は「実装単位が壊れていないか」を確認する。片方で他方を代替しない。

`unittest/spec` の `it` 名は、検証する受け入れ基準を `[AC <要求番号>.<基準番号>]` の形式で名前の先頭に書く。
1 つの test が複数の基準を検証する場合は空白区切りで並べる（`it('[AC 5.3] [AC 3.11] …')`）。
基準番号は当該 spec の `requirements.md` の受け入れ条件の番号とし、既存基準を細分した `8a` のような letter suffix も
そのまま使う。番号を詰め替えたときは test 名も同じ commit でそろえる。どの基準にも対応しない `unittest/spec` の test は requirements の不足を示すので、基準を追記してから id を
付ける。他 spec が所有する基準を検証する test は、spec 名を添えて `[AC frontend-video-playback 1.7]` の形式で書く。
`unittest/imp` は実装単位の test なので AC id を付けない。

spec の受け入れ基準ではなく steering の規則そのものを守る repository 全体の guard test（coverage 除外規則の検査など）は
AC id を持たない。どの規則を守るのかを `describe` 名に書く。

`unittest/spec` で検証できない受け入れ基準（layout geometry、描画色、実 browser 依存の lifecycle など）は
`it.todo` を残さず、requirements と design にどの層（E2E / visual / device / `unittest/imp`）が検証するかを書く。

React frontend の unit test runner は Vitest とする。React component の user-visible behavior は React Testing
Library と `@testing-library/jest-dom` で検証する。test DOM は jsdom を基本とする。

time-dependent behavior は Vitest fake timers を使って固定する。対象には On Air progress、番組終了 timer、snackbar
timeout、dialog close cleanup、stream lifecycle timeout を含める。

自動的に消える surface（snackbar、auto-hide する player controls など）に対する assertion は、実時間で開いている間に
観測しようとすると host の速さ次第で成否が変わる。次の形で書く。

1. 観測の前に `vi.useFakeTimers()` を有効にする。
2. 状態を動かしたあと `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })` で必要な時間だけ進める。
   微小な flush だけが必要なら `0` を渡す。
3. `screen.getByText` などの同期 query で読む。`findBy*` や `waitFor` の polling は使わない。polling は実時間で
   待つため、消える surface に対しては観測窓との競合が残る。

fake timers の有効範囲は観測の直前だけに絞り、終わったら `vi.useRealTimers()` に戻す。fake timers が有効な間は
`waitFor` / `findBy*` を使わない。`@testing-library/dom` の `jestFakeTimersAreEnabled()` は global の `jest` が
存在することを前提にしており、この suite では `jest` が未定義のため fake timers を検出しない。検出されないと
`waitFor` は自身の polling timer も止まったまま待ち続け、test timeout まで hang する。`describe` 全体や
`beforeEach` で有効にすると、同じ file の無関係な待ちまで巻き添えになる。

進めるべき時間は実装から特定して書く。値を当てずっぽうに増やさない。実装側に遅延がある例として、MUI の
Snackbar / Dialog の exit transition は 195 ミリ秒、`EncodeCancelDialogs` は閉じたあと 100 ミリ秒 mount を保つ、
`useRecordedUploadRun` は `UPLOAD_DIALOG_REMOUNT_DELAY_MS` で 150 ミリ秒待つ、`RecordedCleanupDialog` は最低
1000 ミリ秒表示する、`HlsLifecycleController` は失敗後 500 ミリ秒で 1 回再試行する。

待ち時間の値を大きくして通す対処は取らない。値を大きくしても遅い環境では同じ場所が落ち、失敗の発見が遅れるだけで
ある。timeout を明示する場合は、その値でなければならない理由を comment に書く。

## E2E Test

E2E test は、実ユーザーに近い主要 workflow が統合された状態で壊れていないことを確認する。unit
test では発見しにくい route、state、API mock、dialog、responsive、playback entrypoint の結合不具合を検出する。

最低限、次の workflow は E2E test の候補として扱う。

- Dashboard を開き、主要 navigation から画面遷移できる。
- On Air、Guide、Recorded、Reserves、Search、Rule、Settings、Storages を開ける。
- Guide / Search の query-driven state が期待どおりに反映される。
- reserve / rule / manual reserve の主要 add/edit/delete/cancel workflow が動く。
- Recorded detail と playback entrypoint が開ける。
- controlled mock data で主要 empty/error state を確認できる。

E2E test は deterministic で、CI で実行でき、環境固有値や実データに依存しないことを要件とする。

E2E runner は Playwright Test とする。正式検証対象 browser は `.kiro/steering/tech.md` の browser support に従う。

API mock / fixture strategy は MSW と typed synthetic
fixtures を基本とする。fixture には実 URL、実番組名、実ロゴ、実サムネイル、認証情報、Mirakurun URL、ffmpeg /
ffprobe 実 path、環境固有値を含めない。Socket.IO event、時刻、media source、upload
progress は deterministic に制御できる adapter または test harness を task に含める。

## UI Parity Evidence

現行 UI と React client の UI
parity を確認する場合は、同一データ、同一時刻、同一タイムゾーン、同一 viewport、同一 theme、同一操作手順で証跡を採取する。実 URL、認証情報、実番組情報、環境固有値は tracked
file に保存しない。

実データあり環境は `running-dataful`、empty/error/破壊的操作の安全確認用環境は `local-empty`
として扱う。通常状態や一覧・詳細・dialog・workflow は `running-dataful` を主資料にし、`local-empty` は empty
state、error state、破壊的操作の確認、作成しにくい状態の補助資料に限定する。

Dashboard 以外の screenshot は、server path を直接開かず、Dashboard から navigation
drawer、画面上の link/button、またはユーザー操作と同じ導線で到達してから採取する。hash route や deep
link を検証対象にする場合は、その目的を台帳に明記する。

screenshot は、data fetch、描画、animation/transition、Web font、thumbnail の読み込みが落ち着いてから採取する。loading
state を意図して撮る場合だけ、state/note に目的を記録する。`Cannot GET ...`、blank page、title
bar だけ、空の list、thumbnail 未描画、誤 theme、意図しない loading 中の screenshot は採用しない。

採取後は、画像、DOM text、URL hash、主要 locator、accessibility
snapshot のいずれかで、意図した画面・状態が写っていることを確認する。theme 別 screenshot では、light/dark の実際の適用状態を保存前に確認する。

比較条件は backend snapshot / fixture
seed、settings、localStorage、timezone、locale、viewport、theme、route、scroll 位置、操作順まで固定する。settings /
localStorage は reset 後の値または redacted hash を記録する。mutation を伴う確認では、確認後に reseed /
restore し、次の比較に状態差分を持ち込まない。タイミング差分が疑われる場合は同条件で 3 回再実行し、結果の揺れと採否を台帳に記録する。

UI parity の viewport は最低限 `desktop`、`tablet`、`mobile` を持ち、overflow risk が高い画面では `narrow-mobile` と
`large-mobile` も確認する。代表値は
`desktop: 1440x1000`、`desktop-wide: 1920x1080`、`tablet: 1024x768`、`mobile: 390x844`、`narrow-mobile: 320x568`、`large-mobile: 430x932`
とする。

UI parity の breakpoint seed
matrix は、実装上の切替境界の直前・直後を含める。最低限、`desktop: 1440x900`、`desktop-breakpoint-1264: 1264x900`、`tablet-breakpoint-1263: 1263x900`、`tablet: 900x900`、`reserves-breakpoint-900: 900x900`、`reserves-breakpoint-899: 899x900`、`guide-breakpoint-600: 600x844`、`guide-breakpoint-599: 599x844`、`pagination-breakpoint-500: 500x844`、`pagination-breakpoint-499: 499x844`、`player-narrow-420: 420x844`、`player-narrow-419: 419x844`、`mobile: 390x844`
を seed として扱う。仕様変更で境界値が変わった場合は seed matrix も更新する。

UI parity の route inventory は、route 定義、navigation、一覧から詳細への遷移、menu 項目、検索結果、query
string、tab、filter、sort、modal/dialog、条件付き表示を突合して作成する。ナビに出ない route、動的 route、error/loading/empty、responsive で置換される UI も削除せず台帳化する。

UI parity discovery では、route / navigation だけでなく、Vue-only source、integration-only state、browser
capability、backend API / OpenAPI、Socket.IO event、DB / ID lifecycle、config / environment、test / fixture、production
/ Docker artifact、runtime telemetry から逆引きして棚卸しする。発見元 class は台帳に残し、runtime
viewport 行とは別に source-audit / spec-audit / integration-audit 行として追跡してよい。

route/spec 対応表は、Dashboard、放送中、放送視聴、番組表、番組表設定、予約一覧、手動予約、予約詳細/編集、録画中、録画済み一覧、アップロード、録画再生 UI、録画詳細、録画ストリーミング再生 UI、エンコード、検索、ルール編集、ルール一覧、設定、ストレージ、404 を含める。各 route は対応する
`.kiro/specs/frontend-*` と紐付け、query variant、modal route、dynamic ID、source-audit、spec-audit、navigation
audit を削除せず台帳に残す。

全画面 UI parity の台帳は、全 route、viewport、theme、menu、dialog、pagination、FAB、form control、list/card、video
control、snackbar/toast、loading/empty/error を横断的に追跡する。個別 spec や test に分散している確認項目でも、全体漏れ検知用の route/viewport
inventory では 1 つの台帳として突合できる状態を維持する。

component family 単位の代表確認を使う場合は、同一 React component、同一 CSS module、同一 props
contract、同一操作結果のものだけを同じ family に含める。代表証跡に紐付ける row は、`rg`
横断検索結果、hit 件数、対象 rowIds、代表証跡 key、必要な spot
screenshot を台帳へ記録する。実装差、viewport 差、操作差、文言差、アイコン差、enabled/disabled 差、副作用差、破壊的確認、URL 遷移、responsive 置換がある場合は別 family または別代表バンドルへ分離する。

視認性、操作性、レイアウト崩れ、テキスト欠落、アイコン欠落に影響しない 1-3px の位置・寸法差だけを capture
tolerance として扱える。tolerance にする場合は、根拠となる screenshot、DOM/geometry、却下理由を記録する。明確な残指摘やユーザー報告を根拠なしに tolerance 扱いしてはいけない。

UI
parity の独立レビューはサブエージェントに依頼する。レビュー対象は、代表証跡、差分候補、複雑な状態遷移、破壊的操作、responsive 置換、video
control を優先し、レビュー結果、採用/却下、却下根拠、残指摘件数を台帳に残す。サブエージェントを使えない場合は、その理由と代替確認を記録し、未確認を完了扱いしない。

Dark UI の computed-style contrast gate では、visible text / icon / control / portal / pseudo element / opened
state を要素単位で検査する。normal text は contrast ratio `>= 4.5`、large text / icon / non-text control は `>= 3.0`
を基準とする。disabled state は actual contrast と disabled 理由を記録する。transparent foreground、black-on-dark
foreground、背景と同化する inherited color、未検査の portal / pseudo element は failure または `未確認`
として扱い、ページ単位の dark screenshot だけで合格にしない。

## Local Check and CI

GitHub Actionsの`Client` workflowはpull requestのときだけ走り、単一のjob `check`でlint・typecheck・format:checkだけを検査する。
それ以外の検査は手元で実行し、`npm run preflight -- --all`の8 step（`stale-containers`・`rehearsal-setup`・`deps-prepare`・`server-check`・`docker-gate-node24`・`client`・`client-browser`・`node-matrix`）が対応する。このうちclientの検査は次のstepが対応する。

-   `client`: lint・typecheck・format:check、unit test（`unittest/spec`・`unittest/imp`）、coverage gate（`npm run coverage:gate`）
-   `client-browser`: production bundle、e2e（`npm run e2e`）、visual（`npm run visual`）

pushの前には、`scripts/ci-rehearsal/job.sh local <node> client-check -`で`check` jobを模擬runnerで通す。
Visual regressionはfont rasterization、system font、GPU、headless rendering、runner imageの差分に影響されるため、
固定した模擬runnerのcontainerで実行する。失敗したspecだけのtargeted runは仮説確認に使えるが、通過の確認は該当stepの全体を実行して行う。

## 手元で確認する検査の分類

検査は、pull requestで自動で走るもの（lint・typecheck・format:check）と、手元で実行するもの（unit test、coverage 100%、
e2e、visual）に分ける。手元で実行する検査は、`npm run preflight -- --all`の全stepが成功していることをmergeの条件とする。
実機のdevice suite（`npm run device:smoke`・`device:workflow`・`device:visual`・`device:all`）は`npm run preflight`に含まれない。
実機・環境依存の検査は、実行した日時と結果を記録し、未実行をPASSにしない。

## Cross-Cutting Gates

Network parity gate では、現行 UI と client で同じ操作を行い、network
log を正規化して比較する。比較対象は method、pathname、query、body shape、redacted request headers、credentials
mode、CORS / CSP / cache-control / security headers、status、response content-type、response body shape または redacted
hash、redirect chain、set-cookie の redacted attributes、call count、order、mutation 後の follow-up fetch、retry / abort
/ cancellation、cache hit / no-store、polling / timer、visibilitychange /
reconnect、`/api`、`/streamfiles`、thumbnail、video、manifest、icon、font、static asset、WebSocket namespace / query /
connect / disconnect / reconnect attempts / event payload shape とする。

Network
parity の no-go は、現行 UI が叩く API を client が叩かない、client だけが不要な API を叩く、同一操作で API 回数が増える、query/body が異なる、mutation 後の refetch がない、Socket.IO
event 後の更新 API がない、production artifact 経路で `/api` / `/streamfiles` / thumbnail / manifest /
icon が解決できない、401 / 403 / redirect / login HTML / credentials / cookie の扱いが異なる場合とする。

Realtime parity
gate では、複数 client を同時に開き、端末 A の操作が端末 B に反映されることを確認する。対象は予約追加、予約削除、予約 skip
/ unskip、録画削除、録画 protect / unprotect、エンコード追加、エンコード削除 /
cancel、録画開始 / 完了 event、番組表の予約 decoration、Dashboard の録画中 / 予約 / 録画済み section、Recorded
list/detail、Reserves、Search result の reserve state とする。

PWA / cache / static asset gate では、`index.html` metadata、`manifest.json`、favicon、Android icon、iOS touch
icon、installed PWA icon、新規 install、既存 PWA
install 済み状態からの update、uninstall 後の reinstall、`isEnablePWA=false` 時の manifest / iOS touch icon / service
worker cleanup、theme-color、standalone display、old cache / old manifest 残留、production `dist` asset
path、subDirectory 配信を確認する。

Performance / soak / memory gate では、短時間 E2E では漏れるクラッシュ、二重通信、listener leak、memory
leak を確認する。対象は Search rule edit 後の放置、Guide 長時間表示、Recorded list 長時間表示、HLS playback seek
repeated、Socket.IO event repeated、route change repeated、dialog open/close repeated、timer cleanup、HLS instance
cleanup、event listener cleanup、AbortController cleanup とする。

Performance gate の最低基準は、soak 10 分以上、console error 0 件、crash / browser reload / unhandled rejection
0 件とする。同一操作なしの idle 中に baseline より API request count が増え続ける場合、cleanup 後に event
listener、timer、Socket.IO listener、HLS instance が増え続ける場合、または JS
heap を取得できる環境で 10 分 soak 後の heap 増分が baseline を超え、かつ 50 MB を超える場合は `差分あり`
とする。heap を取得できない環境では、platform
category、試行 command、失敗理由、代替指標を記録し、未確認を完了扱いしない。

Accessibility / keyboard parity gate では、Tab、Shift+Tab、Enter、Space、Escape、arrow keys、dialog focus trap、focus
restore、role、aria-label、aria-expanded、aria-selected、icon button accessible name、disabled
state を確認する。証跡は keyboard traversal log、focus trap / restore log、role / aria snapshot、icon button accessible
name dump、axe または同等の accessibility scan とする。critical / serious
violation は 0 件を目標とし、現行 UI にも存在する violation を継承する場合は `意図的差分(承認済み)` として根拠を残す。

Config / auth / environment variation gate では、auth enabled / disabled、401 / 403 / session expired、basic
auth、Socket.IO auth failure、streamfiles auth failure、server config streamConfig、encode presets、recorded
directories、upload directories、broadcast wave、disabled services、URL Scheme config、subDirectory、timezone /
locale を確認する。security-sensitive な値は `.kiro/steering/security.md` に従って redacted evidence だけを残す。

## Coverage Gate

design / tasks では、各 spec の task に `unittest/spec`、`unittest/imp`、E2E
test のどれで検証するかを明示する。implementation phase では、C1 / C2 coverage 100% と主要 E2E
test を最終 gate として扱える構造を優先する。

coverage gate の導入は段階的でもよいが、設計上の目標は最初から C1 / C2 100% として扱う。

Coverage tool は Vitest V8
coverage とする。coverage を満たしにくい分岐は、test の水増しではなく責務分離、純粋関数化、adapter 境界の明確化、または不要 code の削除で解決する。

React frontend の最終 coverage gate 範囲は `client/src/**/*.{ts,tsx}`
とし、設定ファイル側のファイル単位除外は型宣言、test harness、fixture/mock 専用 directory に限定する。unit
test で意味のある C1/C2 を検証できる request builder、transformer、validation、state transition、adapter
contract は test で coverage を満たす。jsdom で意味のある検証ができない browser layout、MUI portal、media
element、fullscreen/orientation、pointer geometry、service worker、Socket.IO runtime などは、対象コードの直近に
`v8 ignore` と理由を残し、Playwright E2E/visual/device test の責務であることを明記する。gate command は `client` の
`npm run coverage:gate` で、Vitest V8 coverage の statements / branches / functions /
lines をすべて 100% に固定する。

除外は jsdom で意味のある検証ができない category に限る。`epgstation-test/narrow-coverage-exclusion`（lint）が、`v8 ignore file` /
`if` / `else` を使わないこと、`v8 ignore next` は 5 行以内、`start` から `stop` までは 12 行以内、1 file の除外行は 20
行以内で 5 行を超えるなら file の 15% 以内、各 marker が `--` に続けて理由を書くことを検出する。理由には layout、portal、media / HTMLMediaElement / hls / mpegts / MSE / TextTrack、fullscreen、orientation、pointer、geometry、service worker、socket.io、jsdom、navigator、ResizeObserver、IntersectionObserver、visualViewport、requestAnimationFrame、clipboard のいずれかの category を含める。
`client/src` 全体の除外行は 2% 以内とする。これは file をまたぐので lint は検出せず、review で確認する。
通常の coverage 現状確認は `npm run coverage` を使い、手元の`npm run preflight`の step `client` が `npm run coverage:gate` を実行する。

## Visual Regression

visual regression は Playwright screenshot assertion と geometry assertion を組み合わせる。Chromium を pixel
baseline の中心とし、Firefox は functional E2E と geometry assertion を重視する。

`npm run visual` は Playwright の device emulation であり、実 Android Emulator / iOS
Simulator の検証ではない。実 device 固有の Chrome / Safari / Appium / WebView context / viewport 問題は `device:*`
script で確認する。`npm run visual` の skipped は Chromium 専用 screenshot
test が他 project で除外されることを示す場合があり、実 device 検証の不足や失敗として扱わない。

GitHub runner、host、固定browser containerのfont rasterization / headless
rendering 差分で、text-heavy 画面の screenshot は数 % 程度の pixel 差分が出る。`client/playwright.config.ts` の
`toHaveScreenshot.maxDiffPixelRatio` は 0.06 を上限とし、layout 崩れ、viewport overflow、dialog / menu overlap、player
control geometry は screenshot だけに依存せず geometry assertion で検証する。

Guide のような複雑 UI は screenshot だけに依存せず、program cell の `left` / `top` / `height`、scroll
sync、reserve/conflict/skip/overlap class、responsive breakpoint を locator / DOM geometry assertion で検証する。

screenshot baseline や fixture は synthetic
data から生成する。実スクリーンショット、実番組名、実 URL、実ロゴ、実サムネイルを tracked artifact に含めない。
