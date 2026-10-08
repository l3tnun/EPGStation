# テストの実施方法

EPGStation の build、test、静的な検査、全体の検査（preflight）の実施方法をまとめる。

## 1. 前提

- Docker（rootful、buildx）。Docker image の確認と、hosted runner を模擬する container に使う。
- mise。`mise.toml` が Node 24.18.0 / 26.4.0 を指定する。`mise install` で両方を入れておく（`node-matrix` は `mise exec node@26` を使う）。
- host の `python3` と PyYAML（`import yaml`）。`scripts/ci-rehearsal/setup.sh` と `scripts/ci-rehearsal/job.sh` が `.github/workflows/*.yml` の step の `run` を取り出すのに使う。
- `npm run preflight -- --all` を流す場合は、CPU が 12 以上（模擬 container の CPU 帯が既定で `0-3` と `4-11`。変えるには `EPGS_PREFLIGHT_CPUSET_A` / `EPGS_PREFLIGHT_CPUSET_B`）と、memory が container 2 つ分（模擬 container は 1 つにつき `--memory=16g`）。
- `TZ=Asia/Tokyo`。server の test はこの時刻帯を前提にする。
- git の `user.name` / `user.email`。server の test が一時 repository で git を呼ぶ。
- MySQL の fixture image（`mysql:8.4`、`mysql:lts`、`mariadb:10.11`）が pull 済みであること。
- `ffmpeg`・`ffprobe` が PATH にあること（libx264・mpeg2video・aac・mp2 の encoder を持つもの）。本物の ffmpeg を使う結合 test が、lavfi で合成の極小の動画を作る。
- tuner server の fixture image（`chinachu/mirakurun:latest`、`mirakc/mirakc:latest`）が pull 済みであること。`test/server/tuner-access/real-tuner-server.integration.test.ts` が、外へ出られない Docker network に tuner 無しで起動する。
- test は `npm run` 経由で起動する（`npm_execpath` を使う test がある）。
- 依存 package は `npm run all-install` で入れる（§2）。

memory を制限した環境（`systemd-run --user --scope -p MemoryMax=` など）で実行する場合、上限は 16 GB 未満に置く。Node は cgroup の上限から heap の上限を決めるが、その判断は process ごとに独立して行われ、同時に動く process 数では割られない。上限が 16 GB 未満なら 1 process の取り分は 2,349 MB で一定、16 GB 以上では 4,496 MB になる。server の test は worker を CPU 数だけ起動するため、上限を 16 GB 以上にすると合計が増える。4 CPU・15 GB では peak が 12.6〜12.9 GB で収まる。

## 2. build

```bash
npm run all-install   # root と client の依存を入れる
npm run build         # build-server と build-client
```

- `npm run build-server`: `lint:src`（`eslint --fix src/`）→ `format`（`prettier --check --write 'src/**/*.ts'`）→ `compile`（`tsc`）の順。lint と format は修正を書き戻す。
- `npm run build-client`: client の `npm run build`。これは `vite build` だけを行う（`bundle` と同じ）。

## 3. 日常の test

| command | 内容 |
| --- | --- |
| `npm run test:server` | server の全 test（spec → imp → integration。serialized real-process file は各層の後に実行される） |
| `npm run test:server:spec -- <path>` | spec 層の test。file を指定できる |
| `npm run test:server:imp -- <path>` | imp 層の test。file を指定できる |
| `npm run test:server:integration -- <path>` | integration 層の test。file を指定できる |
| `cd client && npm run test:run` | client の unit test（`unittest/spec` と `unittest/imp`） |
| `npm run ci` | `npm run test:server` と client の `npm run test:run` |

## 4. 静的な検査

PR の `check` job（§7）が実行する検査と同じ。

| 対象 | command | 内容 |
| --- | --- | --- |
| root | `npm run lint:check` | ESLint（`src/`、`test/server/`、`scripts/server-test/`）。修正は書き戻さない |
| root | `npm run format:check` | Prettier の整形差分（`src/**/*.ts`） |
| root | `npm run typecheck` | `tsc --noEmit` |
| client | `npm run lint` | ESLint |
| client | `npm run typecheck` | `tsc --noEmit` |
| client | `npm run format:check` | Prettier の整形差分 |

## 5. 個別の検査

### server

- coverage: `npm run test:server:coverage`。単体 test（spec・imp）だけを測り、`src/**` の C0/C1 を 100% で要求する。結合 test は測らない。
- Docker image の確認（Node 24 のみ）: `docker-image.integration.test.ts` を単独で実行する。Debian・Alpine それぞれについて、依存 image から production image を `--network=none` で構築し、実 tuner の代役（stub）と専用 network に起動して `/api/version`（`package.json` の version と一致）と `/` の応答を確かめ、image の中に開発用の package（`typescript`・`eslint`・`prettier`・`vitest`）と client の `node_modules` が無く、実行に要る package と client の build 済みの成果物が在ることを確かめ、container・network・image を片付ける。registry への push・login は行わない。実行は `npm run preflight -- --only docker-gate-node24`（先に `--only deps-prepare`。§6）。依存 image が揃っていなければ `not-prepared` で失敗する。ほかの失敗の理由は `build-failed`・`start-failed`・`response-invalid`・`image-content-invalid`・`cleanup-failed` で、server と stub の log が message に出る。
- Node 24 / 26 matrix: `node scripts/server-test/run-node-acceptance-matrix.mjs`（`--candidate <tree>` は任意）。major ごとに独立した fresh workspace（linked worktree、`npm ci` から入れ直す）で `npm ci → build-server →` server の test を流す。
  - Node 24 の回: 単体 test の coverage 計測を 1 度（`scripts/server-test/run-coverage-gate-cli.mjs`）、結合 test を 1 度流す。`run-coverage-gate-cli.mjs` は `npm run test:server:coverage` を実行し、`coverage-final.json` から `src/**` の C0/C1 と file ごとの未到達 statement / branch 数、除外 record・function-granularity 除外の内訳を集計して `coverage-gate-report.json` に記録する。C0/C1 は両方 100% を要求し、test の失敗、集計自体の破綻（coverage data が読めない、対象 file が 0 件など）、100% 未満のいずれでも非 0 で終わる。母数を減らせるのは `scripts/server-test/compiled-snapshot-coverage.mjs` の `COVERAGE_EXCLUSION_AUTHORIZATIONS` table のレビュー済み除外と、構文だけの span を statement に数えない仕様だけで、gate 自体は除外を行わない。
  - Node 26 の回: `npm run test:server` を 1 度流す。
  - 両 major の server test 本体は `EPGSTATION_TEST_MAX_WORKERS` を 8（`scripts/server-test/node-matrix-worker-cap.mjs` の `NODE_MATRIX_MAX_WORKERS`）に揃える。呼び出し元が渡した値が 8 より小さければその値を使う。
  - `--candidate` が無ければ、実行時点の作業場所の中身（未 commit の変更と、ignore されていない未追跡の file を含む）を検証する。検証した中身の tree・取り出し元・HEAD の tree・HEAD との違いの有無は `test/server/.artifacts/evidence/node-acceptance-matrix.json` の `candidate` に記録する。
  - ほかの重い job と並行させない。

### client

`client/` の変更は次の順で検証する。

| 順 | command（`client/` で実行） | 内容 |
| --- | --- | --- |
| 1 | `npm run lint` | ESLint |
| 2 | `npm run typecheck` | `tsc --noEmit` |
| 3 | `npm run format:check` | Prettier の整形差分 |
| 4 | `npm run test:run` | `unittest/spec` と `unittest/imp` |
| 5 | `npm run coverage:gate` | `client/src/**` の statements / branches / functions / lines を 100% で要求する |
| 6 | `npm run bundle` | Playwright が配信する `dist/` を作る |
| 7 | `npm run e2e` | Playwright の E2E（4 project） |
| 8 | `npm run visual` | Playwright の geometry regression |

- 1〜3 は `npm run check`（lint・format:check・typecheck・dev server・spec・imp）にも含まれる。1・2・4 と build は `npm run build:verify`（lint・typecheck・`test:run`・build。`format:check` は含まない）にも含まれる。dev server の確認（`npm run test:dev-server`。vite dev server を立てて module の変換を確かめる）は `check` の一部で、表の 1〜8 には無い。`--all` の `client` step が流す（§6）。
- 5 の `coverage:gate` は 4 と同じ unittest を実行したうえで coverage の threshold（`VITEST_COVERAGE_GATE=1`）も検査するので、5 を流すなら 4 は別に要らない。
- 本物の v3 server に繋ぐ e2e: `cd client && npx playwright test -c e2e/real-server/playwright.config.ts`。6 の build が要る。global setup が server を一時 directory へ compile し、sqlite と手作りの tuner server で 2 つ（root と `subDirectory` の下）起動して、終わったら止める。browser の実行 file を指定するときは `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に置く。preflight の step にはまだ入っていない。
- 6 は 7 と 8 の前提。Playwright の `webServer` は build 済みの `dist/` を `vite preview` で配信するだけなので、`client/src` を変えたら 7 / 8 の前に 6 をやり直す。7 と 8 は同じ preview port を使うので同時に実行しない。並行して実行するときは `PLAYWRIGHT_PREVIEW_PORT` で port を分ける。

## 6. 全体の検査（preflight）

```bash
npm run preflight -- --all
```

hosted CI が実行しない検査を含め、公開してよい状態かを手元で確かめる。**PR を受けるとき（merge の条件）と公開前に、これを流して全 step が `exit=0` であることを確かめる。** 16 thread の開発機向け。

### step

| 順 | step | 中身 |
| --- | --- | --- |
| 1 | `stale-containers` | 強制終了された run が残した `epgs-docker-check-*`・`ar-9-17-*`・`epgstation-persistence-*` の container、`epgs-docker-check-*` の network、`epgstation-docker-check-*` の image を削除する。長命の container A・B と `epgstation-deps-*` の依存 image は残す |
| 2 | `rehearsal-setup` | hosted runner を模擬する container を 2 つ作る（ubuntu 24.04 / Docker 28.0.4〈overlay2〉/ 新規 user / `TZ=UTC`）。container A（`epgs-runner-rehearsal`、0-3 CPU）は `server-check` と `docker-gate-node24` 用、container B（`epgs-runner-rehearsal-b`、4-11 CPU）は `client` と `client-browser` 用 |
| 3 | `deps-prepare` | Docker image の確認に使う依存 image（base image の pull、OS package の層、npm の依存関係の層）を container A の nested daemon と host の daemon に揃える。外部へ取りに行くのはこの step だけ。揃っていれば `docker image inspect` だけで終わる。取得に失敗したら exit 75 で止まり、test は 1 つも始めない |
| 4 | `server-check` | root の lint・typecheck・format check（PR の server `check` job と同じ検査）を container A で実行する |
| 5 | `docker-gate-node24` | Docker image の確認（§5）を container A で単独に実行する。Node 24 |
| 6 | `client` | client の lint・typecheck・format:check・unit test・coverage 100%（`coverage:gate`）・dev server の確認（`npm run test:dev-server`）を container B で実行する |
| 7 | `client-browser` | client の bundle、e2e、visual を実 browser で container B で実行する |
| 8 | `node-matrix` | Node 24 / 26 matrix（§5）。host で実行する |

### 実行の構成

1. 1〜3（`stale-containers`・`rehearsal-setup`・`deps-prepare`）を順に単独で実行する。
2. 2 つの系統を同時に流す。container A の系統は `server-check` → `docker-gate-node24`、container B の系統は `client` → `client-browser`。系統ごとに CPU 帯が分かれているので互いの CPU を取り合わない。
3. 2 系統がすべて終わってから `node-matrix` を単独で実行する。

並列の系統の中で `client` の `coverage:gate`（`EPGSTATION_COVERAGE_GATE_MAX_WORKERS`）と `client-browser` の Playwright（`PLAYWRIGHT_WORKERS`）の worker 数は、それぞれ 4 と 2 に下げてある。`docker-gate-node24` は CPU の pinning では隔離できない I/O・メモリ帯域の重い job で、client の系統と同時に走るため、単独実行の既定値（`coverage:gate` は 8 workers、Playwright は 6 workers）のままだと timeout する。`--only client` / `--only client-browser` の単独実行にはこの上限は掛からない。

各 step の失敗は並列に流れていてもその場で stderr と `summary.tsv` に記録され、ほかの系統と後続の step は打ち切らずに走り切る。最後に失敗した step がまとめて報告される。`deps-prepare` が失敗したときだけは、test の step を始めない。

### 検証する中身

作業場所に未 commit の変更があってもよい。preflight は開始時に一度だけ、作業場所の中身（未 commit の変更と、ignore されていない未追跡の file を含む tree。`node scripts/server-test/worktree-content.mjs` が出力する）を決め、全 step がその中身を検証する。`node-matrix` へは `--candidate`、模擬 runner を使う step へは `job.sh tree:<id>` で渡す。実行中に file を書き換えても各 step が検証する中身は変わらず、書き換えは次の run から反映される。開始時に、検証する中身の tree・HEAD の tree・未 commit の変更の有無を表示し、`summary.tsv` の先頭付近に記録する。これらは何を検証したかの記録で、合否の条件ではない。

### 合否の判定と log

- 起動時に `log: <directory>` が表示される。その directory の `summary.tsv` で全 step が `exit=0` であれば合格。実行していない step は完了として扱わない。
- log の置き場所は `test/server/.artifacts/preflight/<tree12>/<開始時刻 UTC>/`（`<tree12>` は検証する中身の tree の先頭 12 桁。実行ごとに別の directory）。`EPGS_PREFLIGHT_LOG_DIR` で置き場所を指定できる。`summary.tsv` には step ごとの開始・終了時刻、exit、検証した tree が記録される。各 step の log も同じ directory に出る。

### 切り分け

- `npm run preflight -- --list`: step の一覧と、各 step の command、`--all` の実行順を表示する。
- `npm run preflight -- --only <step>`: 指定した step だけを逐次に実行する（`--only` は複数回指定できる。並列にはならない）。
- `--only docker-gate-node24` と `--only node-matrix` は、依存 image が揃っていないと `not-prepared` で失敗するので、先に `--only deps-prepare` を流す。
- `--only stale-containers` は、Docker image の確認・persistence の test・`test:server`・`node-matrix` のどれかが実行中のときに流さない。実行中の fixture container を残骸と誤認して削除する。

## 7. GitHub Actions との対応

| workflow | 実行契機 | 内容 |
| --- | --- | --- |
| `.github/workflows/server.yml` | pull request のときだけ | 単一 job `check`（Node 24.18.0）。root の lint・typecheck・format:check |
| `.github/workflows/client.yml` | pull request のときだけ | 単一 job `check`（Node 24.18.0）。client の lint・typecheck・format:check |
| `.github/workflows/docker.yml` | `master` への push と tag（PR では走らない） | Docker image を Docker Hub へ公開する |

- push では `server.yml`・`client.yml` は走らない。push 前に、模擬 container（`bash scripts/ci-rehearsal/setup.sh` で作る）で同じ job を通す。

  ```bash
  scripts/ci-rehearsal/job.sh local <node> server-check -
  scripts/ci-rehearsal/job.sh local <node> client-check -
  ```

- server の全 test、coverage、client の unit test・coverage 100%・e2e・visual、Docker image の確認、Node 26 は hosted CI で実行されない。これらは §6 の preflight が検査する。

## 8. preflight に含まれないもの

- 実機の device suite: [client/device/README.md](../client/device/README.md)。
- `docker.yml` が公開する arm 系（`linux/arm/v6`・`linux/arm/v7`・`linux/arm64`）の build: 手元では確かめていない。Docker image の確認（§5）は `linux/amd64` だけを対象にする。
- commit 時の秘密情報・個人情報の検査: [docs/betterleaks.md](betterleaks.md)。pre-commit hook が staged な変更を検査する。
