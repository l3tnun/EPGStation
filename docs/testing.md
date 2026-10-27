# テストの実施方法

EPGStation の build、test、静的な検査、全体の検査（preflight）の実施方法をまとめる。

## 1. 前提

- Docker（rootful、buildx）。Docker image の確認と、hosted runner を模擬する container に使う。
- mise。`mise.toml` が Node 24.21.0 / 26.11.1 を指定する。`mise install` で両方を入れておく（`node-matrix` は `mise exec node@26` を使う）。
- host の `python3` と PyYAML（`import yaml`）。`scripts/ci-rehearsal/setup.sh` と `scripts/ci-rehearsal/job.sh` が `.github/workflows/*.yml` の step の `run` を取り出すのに使う。
- `npm run preflight -- --all` を流す場合は、使える CPU が 4 個以上、memory が 7 GiB 以上（8 GB の機械）。模擬 container の CPU 帯と memory の上限、worker 数は、実行する環境から決まる（§「実行の構成」）。
- `TZ=Asia/Tokyo`。server の test はこの時刻帯を前提にする。
- git の `user.name` / `user.email`。server の test が一時 repository で git を呼ぶ。
- DB の fixture image（`mysql:9.7`、`mariadb:12.3`。それぞれ最新の LTS を版で固定した tag）が pull 済みであること。DB の query の結合 test は SQLite・MySQL 9.7・MariaDB 12.3 で流れ、MySQL・MariaDB を使う他の結合 test も同じ版で流れる。
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
- Docker image の確認（Node 24 のみ）: `docker-image.integration.test.ts` を単独で実行する。Debian・Alpine それぞれについて、依存 image から production image を `--network=none` で構築し、実 tuner の代役（stub）と専用 network に起動して `/api/version`（`package.json` の version と一致）と `/` の応答を確かめ、image の中に開発用の package（`typescript`・`eslint`・`prettier`・`vitest`）、client の `node_modules`、`.git`・`.github` が無く、実行に要る package と client の build 済みの成果物が在ることを確かめ、container・network・image を片付ける。registry への push・login は行わない。実行は `npm run preflight -- --only docker-gate-node24`（先に `--only deps-prepare`。§6）。依存 image が揃っていなければ `not-prepared` で失敗する。ほかの失敗の理由は `build-failed`・`start-failed`・`response-invalid`・`image-content-invalid`・`cleanup-failed` で、server と stub の log が message に出る。
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

### mutation testing

重要な module について、単体 test が挙動を確かめているかを Stryker で確かめる。コードに小さな変更（mutant）を入れ、単体 test が失敗すれば「殺した」、全部通れば「生き残った」と数える。coverage が 100% でも、通るだけで何も確かめていない test は生き残りとして見える。手動または定期で流す検査で、preflight・CI には入らない。

| 対象 | command | 設定 | incremental の cache |
| --- | --- | --- | --- |
| server | `npm run mutation:server` | `stryker.server.config.mjs`、`vitest.mutation.server.config.ts` | `test/server/.artifacts/mutation/incremental.json` |
| client | `client/` で `npm run mutation:client` | `client/stryker.client.config.mjs`（vitest は通常の `client/vite.config.ts`） | `client/.artifacts/mutation/incremental.json` |
| DB の query の class（`src/model/db/`） | `npm run mutation:db`（下の手順で DB を起動してから） | `stryker.db.config.mjs`、`vitest.mutation.db.config.ts` | `test/server/.artifacts/mutation/incremental-db.json` |
| 配信の本体（`src/model/service/stream/` の stream の model・HLS file の削除・録画済みの使用権と再生元） | `npm run mutation:delivery` | `stryker.delivery.config.mjs`、`vitest.mutation.delivery.config.ts` | `test/server/.artifacts/mutation/incremental-delivery.json` |

- 対象 file は各設定の `mutate` に列挙している。一部だけ流すには `-- --mutate <path>` を渡す（例: `npm run mutation:server -- --mutate src/util/StrUtil.ts`）。行の範囲は `path:開始行-終了行`。複数の file はコンマで区切る（`--mutate a.ts,b.ts`。`--mutate` を複数回書くと最後の 1 つだけが効く）。
- DB の class の単体 test は query builder を偽物にしているので、`mutation:db` は persistence の単体 test に加えて、実 DB で query の正しさを見る結合 test（`persistence/{repositories,queries,transactions,storage-deletion-candidate,doubles-parity}.integration.test.ts`）も流す。結合 test が mutant ごとに container を作らないよう、MySQL 9.7 を先に起動したままにする。`docker run --rm --name <名前> --publish 127.0.0.1:<port>:3306 --tmpfs /var/lib/mysql:rw,nosuid,nodev,size=1g --env MYSQL_ROOT_PASSWORD=<password> mysql:9.7 --innodb_use_native_aio=0 --max-connections=400` で立て、環境変数 `EPGS_TEST_MYSQL_*`（`_HOST`・`_PORT`・`_USER`〈既定 root〉・`_PASSWORD`）で接続先を渡す。test は接続先に無作為の名前の database を作って消す。run が終わったら container を止める。製品に MySQL と MariaDB を区別する code は無く、mutant が通る経路は同じなので、MariaDB 12.3 の接続先にも同じ MySQL を使い回す（MariaDB 固有の解釈の違いは通常の結合 test の suite が毎回確かめる）。この環境変数は DB の結合 test 全般が読む（未指定なら今までどおり test が container を作る）。ただし TLS 専用の利用者や CA 証明書を使う test（`connection-ssl`・`orm-cli`）は、この変数を付けずに流す。
- 配信の本体は、process の起動・file の書き出し・HTTP の配信を確かめる結合 test（`media-delivery/*.integration.test.ts` など。Docker は使わない）が単体 test だけでは見えない動作を覆っているので、`mutation:delivery` は単体 test に加えてそれらを流す。dry-run が約 6 分、11 file・約 1,400 mutant で約 50 分かかる。
- それ以外は単体 test（spec・imp）だけを流す。server は mutant を入れた `src` を sandbox で compile して test に読ませるため、最初に build の時間がかかる。全 test を直列に流す確認（dry-run）が毎回あり、server は約 5 分、client は約 6 分が下限になる。
- 既定は `ignoreStatic: true`（module 先頭の定数表の mutant を除く）と `concurrency: 2`。memory は server で約 5 GB、client で約 2 GB になるので、ほかの重い run と同時に流さない。client は test の runner 1 本あたり約 1 GB 増える（`concurrency` 2 で約 2 GB、6 では約 6.4 GB に達し、process ごとの memory の上限を超えうる）ので、`concurrency` を上げるときは上限を確かめる。
- module 先頭の定数表の mutant（report の `static: true`）は、この設定では判定できない。`ignoreStatic` でもその行を覆う test だけで実行されるが、module の読み込みが mutant の有効化より先に済むため、test が値を確かめていても「生き残った」と出る。端末の表の score にも数えられるので、定数表の多い file の score は低く出る。定数表の値は、値そのものを確かめる test で守る（Stryker の結果では確かめられない）。
- cache は git の管理外。`EPGS_MUTATION_INCREMENTAL_FILE` で場所を変えられる。消えても全 mutant を流し直すだけで結果は変わらない。run を止めたときは、Stryker がそこまでの結果を書き出そうとするので、途中までの結果が残ることがある。書き出しが終わる前に process が kill されると、途中で切れた（不正な JSON の）file が残り、次の run が `ProjectReader.readIncrementalReport` の `SyntaxError` で、始まってすぐ失敗する。そのときは、その file を消すか、`EPGS_MUTATION_INCREMENTAL_FILE` を別の場所へ向ける（新しい file になるだけで、全 mutant が流し直しになる）。長い run は対象を分けて流す。
- cache は file ごとに結果を持つ。`--mutate` で対象を絞って流しても、cache に入っているほかの file の結果は消えずに残るので、対象を絞った run を重ねて cache を育てられる。mutant の結果を使い回すのは、その mutant を覆う test の file が前回から変わっていないときだけで、test の file を変えると、その file の test が覆う mutant は流し直しになる。使い回した件数は log の `Incremental report:` の行（`N of M mutant result(s) are reused.`）で分かる。
- cache は、test を足しても前回の生き残りを流し直さないことがある。足した test が mutant を殺すかを確かめるときは、対象を絞って `--force` を付けて流す（例: `npm run mutation:server -- --force --mutate src/util/StrUtil.ts`）。
- 同じ checkout で複数の run を同時に流すときは、cache・report・sandbox の場所を run ごとに分ける。分けないと、cache と report を互いに上書きし、server・DB・配信の本体の設定は sandbox（`.stryker-tmp`）も共有する。cache は `EPGS_MUTATION_INCREMENTAL_FILE` で分けられるが、report と sandbox は command の引数で変えられないので、元の設定を読み込んで上書きする設定 file を run ごとに作り、`npx stryker run <その file>` で流す（作った file は commit しない）。client の例（`client/` に置く）:

    ```js
    import base from './stryker.client.config.mjs'

    const name = process.env.RUN_NAME ?? 'run'

    export default {
      ...base,
      incrementalFile: `.artifacts/mutation/incremental-${name}.json`,
      tempDirName: `.stryker-tmp-${name}`,
      jsonReporter: { fileName: `reports/mutation/${name}/report.json` },
    }
    ```

    server・DB・配信の本体も同じ形で、`htmlReporter` の `fileName` も分ける。`.stryker-tmp*` は各設定の `ignorePatterns` と git の無視、client の lint・format の無視に入っている（root の lint・format は `src/` などだけを見る）ので、並んだ sandbox が別の run へ複製されたり検査の対象になったりはしない。同時に流すと CPU が飽和して最初の dry-run が遅くなり、設定の `dryRunTimeoutMinutes`（30 分）を超えて止まることがある。その場合は同じ設定 file でこの値を上げるか、同時の本数を減らす。CPU が飽和すると、dry-run の中の test が vitest の既定の 5 秒の時間制限で落ちて run が止まることもある（build 済みの module を最初に読み込む時間がその test の時間に入る test がある）。同時に動く worker の数（各 run の `concurrency` の合計）は CPU の数より少なくする。memory も run の数だけ要る（上の目安）。
- client の全 file を 1 回の run で流すと長く、止めたり kill したりしたときに cache が失われたり壊れたりすることがある。分けると、各部分の cache が小さく独立するので、1 つの部分の失敗が他に及ばない。全 file の一覧を何個かに分けて流す。各部分は、上の例と同じく、`mutate` の部分、cache、report、sandbox を部分ごとに持つ設定 file にし、`base.mutate` を `PART` 環境変数で切る（`PART` は 0 から `PARTS - 1`）。例（`client/` に置く）:

    ```js
    import base from './stryker.client.config.mjs'

    const part = Number(process.env.PART ?? 0)
    const parts = Number(process.env.PARTS ?? 4)
    const name = `part${part}`

    export default {
      ...base,
      mutate: base.mutate.filter((_, index) => index % parts === part),
      incrementalFile: `.artifacts/mutation/incremental-${name}.json`,
      tempDirName: `.stryker-tmp-${name}`,
      jsonReporter: { fileName: `reports/mutation/${name}/report.json` },
    }
    ```
- 結果は端末の表と `reports/mutation/` の report（server は `reports/mutation/server/report.html`、client は `client/reports/mutation/report.json`）に出る。生き残った mutant を読み、test を足す、または等価・冗長として記録する。
- report の json は `node scripts/mutation/summarize.mjs <report.json> [<file の部分文字列>]` で集計できる。file ごとの mutant 数・Killed・Survived・NoCoverage・Timeout・score と、生き残りの一覧（行・mutator・置き換え後・static かどうか）が出る。
- 既知の生き残り（test を足さないと判断して理由を付けたもの）は [mutation-known-survivors.md](mutation-known-survivors.md) にある。流した後は集計の生き残りをこの一覧と見比べ、載っていないものだけを扱う。対象 file の決め方と新しい module を足す手順は、steering の Mutation Testing 節（server・DB は `.kiro/steering/server-testing.md`、client は `.kiro/steering/testing.md`）にある。
- Stryker は vitest 4.1.12 の組で動作を確認している。vitest の版を変えたら、score が 0% でない（全 mutant が「test 無しで生存」になっていない）ことを確かめる。
- Stryker が動かす test は、設定によって決まる。client の設定は、Stryker の vitest runner の `vitest.related`（既定で有効）により、mutate する file を vitest へ渡し、その file へ import でたどり着ける test file だけを動かす。たどり着けない test は動かさないので、sandbox で動くかどうかは結果に影響しない。server の設定（配信の本体の設定も同じ）は、test が src ではなく build 済みの `dist` を読むため `vitest.related` を無効にしており、単体 test の層は全件を動かす。動かす test のうち 1 つでも dry run で失敗すると、run は「initial test run に失敗した test がある」として止まる。ただし、test file の読み込み（`describe` の中で直接行う処理を含む）で失敗した file は、Stryker は失敗と数えず、その file の test は 1 件も動かないまま run が続く（log にも出ない）。sandbox で成り立たない test を、このような読み込みでの失敗に任せず、下のとおり明示して除外するのはこのため。
- 動かす test は sandbox で成り立つ必要がある。src の file の text を読む test は、その file が mutate 対象だと成り立たない。Stryker は mutate する file を書き換える（mutant の切り替えを挟み、整形し直し、末尾の改行を落とす）ので、その file の実物は sandbox に無いからである。server では `application-runtime/spec/compiled-snapshot-coverage.test.ts` がこれに当たる。網羅率の除外の印の行を末尾に持つ src の file の実物の text を読んで、網羅率を測る道具を確かめる test で、src の code を実行しないため mutant を殺せず、除外しても mutation の結果は変わらない。除外は `vitest.mutation.server.config.ts` と `vitest.mutation.delivery.config.ts` の `exclude` に書く。client では、src の text を読む静的な guard の test が 2 つある（`unittest/spec/dashboard/dashboardLayout.spec.test.tsx` は `src/features/dashboard/lib/dashboardFormat.ts` を、`unittest/imp/searchRule.scrollFab.imp.test.ts` は `src/features/search/rule/lib/pageScroll.ts` と `src/features/search/rule/components/SearchResultSection.tsx` を読む）。これらは sandbox では失敗するが、読む file を import しないので `vitest.related` により動かない。mutate する file から import でたどり着ける位置に、src の text を読む test が現れたときは、理由を添えて mutation 用の設定で除外する（client は通常の `vite.config.ts` を使うので、除外には mutation 専用の vitest 設定が要る）。それ以外の動かす test は sandbox で動く。sandbox は repository を複製した directory で、次の 2 点が通常の実行と違うので、test はそれに合わせてある。(1) server の test は vitest の threads pool・worker 1 で動き、その中では `process.env.TZ` を実行中に切り替えても効かない。時刻帯を固定する test（`shared-foundation/imp/date-util-timezone.test.ts`）は、`TZ=UTC` で起動した子 process の中で確かめる。(2) sandbox へ複製する file は設定の `ignorePatterns` で決まる。server の設定は client を複製しない（`/client/*`）が、依存の image の計画の test（`application-runtime/docker-dependency-images.spec.test.ts`）が読む `client/package.json` と `client/package-lock.json` は複製する。client の設定は `public/`（画像）と `src` の `.module.css` を複製する。これらを読む test（`detail-metadata.spec.test.tsx`・`dashboardItemRoutes.spec.test.tsx`）も sandbox で動く。docs や `.github` など、server の設定が複製しない path を読む test を足すときは、その path を `ignorePatterns` から外す。

## 6. 全体の検査（preflight）

```bash
npm run preflight -- --all
```

hosted CI が実行しない検査を含め、公開してよい状態かを手元で確かめる。**PR を受けるとき（merge の条件）と公開前に、これを流して全 step が `exit=0` であることを確かめる。** CPU 4 個・memory 8 GB の機械から流せる。

### step

| 順 | step | 中身 |
| --- | --- | --- |
| 1 | `stale-containers` | 強制終了された run が残した `epgs-docker-check-*`・`ar-9-17-*`・`epgstation-persistence-*` の container、`epgs-docker-check-*` の network、`epgstation-docker-check-*` の image を削除する。長命の container A・B と `epgstation-deps-*` の依存 image は残す |
| 2 | `rehearsal-setup` | hosted runner を模擬する container を 2 つ作る（ubuntu 24.04 / Docker 28.0.4〈overlay2〉/ 新規 user / `TZ=UTC`）。container A（`epgs-runner-rehearsal`）は `server-check` と `docker-gate-node24` 用、container B（`epgs-runner-rehearsal-b`）は `client` と `client-browser` 用。CPU 帯と memory の上限は「実行の構成」で決まる |
| 3 | `deps-prepare` | Docker image の確認に使う依存 image（base image の pull、OS package の層、npm の依存関係の層）を container A の nested daemon と host の daemon に揃える。外部へ取りに行くのはこの step だけ。揃っていれば `docker image inspect` だけで終わる。取得に失敗したら exit 75 で止まり、test は 1 つも始めない |
| 4 | `server-check` | root の lint・typecheck・format check（PR の server `check` job と同じ検査）を container A で実行する |
| 5 | `docker-gate-node24` | Docker image の確認（§5）を container A で単独に実行する。Node 24 |
| 6 | `client` | client の lint・typecheck・format:check・unit test・coverage 100%（`coverage:gate`）・dev server の確認（`npm run test:dev-server`）を container B で実行する |
| 7 | `client-browser` | client の bundle、e2e、visual を実 browser で container B で実行する |
| 8 | `node-matrix` | Node 24 / 26 matrix（§5）。host で実行する |

### 実行の構成

step を始める前に、`scripts/preflight-resources.mjs` が選んだ step の道具（rootful の Docker、`rehearsal-setup` なら `python3` と PyYAML、`node-matrix` なら mise）を確かめ、使える CPU（`taskset` などで絞った実行ではその範囲）と memory（host は `MemTotal` と cgroup の `memory.max` の最小、Docker は `docker info` の `MemTotal`）から構成を決める。道具が足りないとき、CPU が 4 個未満・memory が 7 GiB 未満のとき、指定が使えないときは、理由を出して step を 1 つも始めずに終わる。

1. 1〜3（`stale-containers`・`rehearsal-setup`・`deps-prepare`）を順に単独で実行する。
2. container A の系統（`server-check` → `docker-gate-node24`）と container B の `client` を流す。container A と物理 core を共有しない CPU が 4 個以上あり、Docker の memory が 24 GiB 以上なら同時に、それ以外は A の系統の後に `client` を流す。
3. 両方が終わってから、`client-browser` を使える CPU のすべてで単独に実行する。
4. 最後に `node-matrix` を単独で実行する。

物理 core は、各 CPU の `/sys/devices/system/cpu/cpu<N>/topology/thread_siblings_list` で決まる。SMT の機械では番号の離れた CPU が同じ core を共有する（例: 8 core・16 thread で CPU i と i+8）。

| 項目 | 値 |
| --- | --- |
| container A の CPU 帯 | 使える CPU の先頭 4 個 |
| container B の `client` の CPU 帯 | 同時に流すときは、container A と物理 core を共有しない CPU のすべて。順に流すときは使える CPU のすべて |
| container B の `client-browser` の CPU 帯 | 使える CPU のすべて |
| 各 container の memory の上限 | 16 GiB と Docker の memory の小さい方 |

container B の CPU 帯は、`client` と `client-browser` の各 step の初めに `docker update --cpuset-cpus` で合わせる。

worker 数は、CPU の数と、memory から求めた上限（(memory − 1 GiB) ÷ 1 worker の量。1 未満にはしない）の小さい方になる。

| 対象 | CPU からの上限 | 1 worker の量 |
| --- | --- | --- |
| `node-matrix` の server test（`EPGSTATION_TEST_MAX_WORKERS`） | 使える CPU の数 | host の memory から 0.75 GiB |
| `client` の `coverage:gate`（`EPGSTATION_COVERAGE_GATE_MAX_WORKERS`） | `client` の CPU 帯の CPU 数と 8 の小さい方。同時に流すときは 4 以下 | container B の上限から 0.75 GiB |
| `client-browser` の Playwright（`PLAYWRIGHT_WORKERS`） | 使える CPU の物理 core の数と 8 の小さい方 | container B の上限から 1 GiB |

同時に流すときの `coverage:gate` の上限 4 は、`docker-gate-node24`（CPU の pinning では隔離できない I/O・メモリ帯域の重い job）と同時に走るときに timeout しない値である。Playwright の上限 8 は、e2e と visual がすべて通ることを確かめた最大の worker 数である。`--only` で選んだ step は 1 つずつ流し、`client` にも使える CPU のすべてを渡す。

決めた構成は開始時に表示し、`summary.tsv` の 2 行目（`# resources`）に記録する。次の環境変数で決め打ちできる。

| 変数 | 内容 |
| --- | --- |
| `EPGS_PREFLIGHT_CPUSET_A` / `EPGS_PREFLIGHT_CPUSET_B` | container A の CPU 帯 / 同時に流すときの container B の `client` の CPU 帯（例: `0-3`、`4-7,12`）。使える CPU の外を含むとき、同時に流すのに A と B が重なるときは失敗する |
| `EPGS_PREFLIGHT_PARALLEL` | `1` で同時に、`0` で順に流す |
| `EPGS_PREFLIGHT_MEMORY` | host と Docker の memory をこの値以下として扱う（例: `8g`、`7680m`） |
| `EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS` | 同時に流すときの `coverage:gate` の上限 |

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
| `.github/workflows/server.yml` | pull request のときだけ | 単一 job `check`（Node 24.21.0）。root の lint・typecheck・format:check |
| `.github/workflows/client.yml` | pull request のときだけ | 単一 job `check`（Node 24.21.0）。client の lint・typecheck・format:check |
| `.github/workflows/docker.yml` | `master` への push と tag（PR では走らない） | Docker image を Docker Hub へ公開する |

- push では `server.yml`・`client.yml` は走らない。push 前に、模擬 container（`bash scripts/ci-rehearsal/setup.sh` で作る）で同じ job を通す。

  ```bash
  scripts/ci-rehearsal/job.sh local <node> server-check -
  scripts/ci-rehearsal/job.sh local <node> client-check -
  ```

- server の全 test、coverage、client の unit test・coverage 100%・e2e・visual、Docker image の確認、Node 26 は hosted CI で実行されない。これらは §6 の preflight が検査する。

## 8. preflight に含まれないもの

- 実機の device suite: [client/device/README.md](../client/device/README.md)。
- `docker.yml` が公開する arm64（`linux/arm64`）の build: 手元では確かめていない。Docker image の確認（§5）は `linux/amd64` だけを対象にする。
- mutation testing（§5）: 手動または定期で流す。preflight の合否には数えない。
- commit 時の秘密情報・個人情報の検査: [docs/betterleaks.md](betterleaks.md)。pre-commit hook が staged な変更を検査する。
