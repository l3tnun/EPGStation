# 技術方針

## Node.js / mise

EPGStation の root package、server、`client/` が正式にサポートする最低 Node.js version は v24 系とする。それぞれの package boundary で提供する依存 install、build、start、test は Node.js v24 系で動作しなければならず、fresh environment におけるこれらの成功を必須の acceptance gate とする。

Node.js v26 系は将来の互換性を早期に検出するための追加検証対象とする。現在の mise や検証 tooling は v26 系を pin してもよいが、その pin は日常の検証 version を示すものであり、最低サポート version を v26 系へ引き上げるものではない。Node.js v18 系は非サポートとし、過去の挙動との比較にのみ使用できる。v18 系の成功を acceptance の代替や fallback として扱わない。

Playwright のブラウザ install と E2E / visual test は、最低サポート対象である Node.js v24 系から実行して成功しなければならない。Node.js v26 系でも追加検証する。特定 version の ZIP 展開問題を理由に install step と test step の Node.js version を分ける workaround は製品方針として持たず、Node.js v24 系での acceptance を免除しない。

## Server Test Stack

server testの品質契約は`.kiro/steering/server-testing.md`を正本とする。`test/server`を唯一のserver test rootとし、Vitestを共通runner、V8 coverageをC0/C1計測手段とする。

server test foundation、固定command、Node.js 24必須・Node.js 26追加matrixは`server-application-runtime`が一度だけ所有する。各`server-*`は同じfoundationへ機能固有testを追加し、runner、test root、coverage configurationを重複実装しない。

clientのtest stackとcoverage方針は`.kiro/steering/testing.md`を正本とし、serverのtest gateをclientへ適用しない。

## Frontend Package Boundary

`client/` は frontend の唯一の package boundary であり、root build、Docker、CI、release 手順は `client/` を install / build / package する。server package は frontend の implementation details を直接 import しない。

## React Frontend Stack

実装前技術選定の正本はこの節と `.kiro/steering/testing.md` とする。`.kiro/steering` と `.kiro/specs` 以外の資料は tasks generation の正本にしない。

| 対象 | 採用方針 |
| --- | --- |
| framework | React / TypeScript |
| build system | Vite React TypeScript |
| package manager | npm。`client/` に独立した `package-lock.json` を持つ |
| router | React Router の hash route 対応 router。初期 route contract は `/#/...` を維持する |
| data fetching / cache | TanStack Query |
| local state | React local reducer / local state を使う。global store library は使わない |
| UI component | MUI Core を基盤にし、EPGStation 固有 shared component と theme token で visual contract を満たす |
| form / validation | React Hook Form + Zod |
| API client | native `fetch` wrapper と typed request / response validation。repository base `./api` と endpoint path を二重結合しない |
| Socket.IO | `socket.io-client` を継続採用する |
| media playback | `hls.js` と `mpegts.js` を継続採用する |
| icon | `@mdi/font`（Material Design Icons の web font） |
| linter | ESLint flat config + typescript-eslint + React Hooks plugin |
| formatter | Prettier |
| CSS | MUI theme + `*.module.css`。global CSS は `client/src/index.css` の reset・bootstrap だけにする |
| path alias | `@/` を採用し、Vite / TypeScript / Vitest / ESLint で同じ解決規則にする |

## State / Boundary Rules

server state は TanStack Query に置き、screen/dialog/edit/bulk state は feature-local reducer または React local state を基本とする。Snackbar、connection、server config、settings draft のような App Shell 横断 state も、Zustand などの global store library は使わず、App Shell の hook が持つ。

UI component は endpoint 文字列、raw query、localStorage schema を直接所有しない。route/query parser、API repository、action controller、dialog coordinator、storage adapter を feature boundary として分離する。

Guide の大量 program cell DOM は `GuideGridRenderer` が React tree の外側で所有する。`HTMLElement`、DOM index、scroll restoration の内部 DOM 参照を React state、外部の store に保存しない。

## Script Policy

`client/` package の tasks では、少なくとも次の script 方針を反映する。

```text
lint          = eslint .
lint:fix      = eslint . --fix
format        = prettier . --write
format:check  = prettier . --check
typecheck     = tsc --noEmit
test:spec     = unittest/spec を実行する
test:imp      = unittest/imp を実行する
test:run      = unit test 全体を実行する
build         = npm run bundle（vite build）
build:verify  = npm run lint && npm run typecheck && npm run test:run -- --no-file-parallelism && npm run build
check         = npm run lint && npm run format:check && npm run typecheck && npm run test:dev-server && npm run test:spec && npm run test:imp
e2e           = Playwright E2E を実行する
visual        = Playwright visual / geometry regression を実行する
```

`build` は production build（`vite build`）だけを行う。lint、typecheck、unit test を強制してから build するのは `build:verify` である。format check は `check` の責務とし、build の高速性と編集時 feedback を優先する。

GitHub Actionsの`Client` workflowはpull requestのときだけ走り、単一のjob `check`でlint・typecheck・format:checkだけを検査する。clientのunit test、coverage 100%、e2e、visualは手元の`npm run preflight`（step `client`、`client-browser`）で確認する。

## Browser Support

正式検証対象は Desktop Chromium、Desktop Firefox、Android Chrome、iOS Safari とする。Desktop Safari とその他 Chromium 系 browser は best effort とする。

Firefox は正式対応対象だが、screenshot pixel baseline はブラウザ差分が出やすいため Chromium 中心に持つ。Firefox では functional E2E と geometry assertion を重視する。

## Deferred Technology Decisions

次の判断は個別 ADR または tasks で扱う。

- server path routing への移行。
- PWA plugin / service worker 実装方式。
- OpenAPI codegen。
- Storybook。
- `@tanstack/react-virtual` などの virtualization library。
- error monitoring。
- i18n。
- Renovate による client dependency 自動更新。

client dependency 自動更新は Renovate を使う。導入は公開前の残作業が完了してから行い、最初は `client/` の npm
dependency だけを対象にする。更新 PR は `Client` workflow、host visual gate、必要に応じた device gate を通す。LLM 由来の
supply-chain 混入リスクを下げるため、Renovate の release age 制御で 1 週間以内に公開された package version は自動採用せず、
少なくとも 1 つ前の安定版または 7 日以上経過した版を候補にする。
