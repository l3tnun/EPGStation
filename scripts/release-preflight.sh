#!/bin/bash
# Manual runner for the checks beyond what hosted CI runs, plus the same server check job (docs/testing.md).
# Not included: the on-device suite, the commit-time secret scan, and the arm builds of docker.yml.
#   scripts/release-preflight.sh --list
#   scripts/release-preflight.sh --only <step> [--only <step> ...]
#   scripts/release-preflight.sh --all            # every step, including node-matrix
# Every step verifies the worktree's content as it was when this script started (uncommitted changes and
# non-ignored untracked files included), not HEAD. Each step writes its log under $EPGS_PREFLIGHT_LOG_DIR
# (default: test/server/.artifacts/preflight/<tree>/<UTC start time>/, a new directory per run).
set -uo pipefail
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$REPO_ROOT"
# 検証する中身（作業場所の中身の tree id）は開始時に一度だけ求め、全 step がその中身を検証する。実行中に
# file を書き換えても step ごとに中身は変わらない。HEAD や未 commit の変更の有無は合否の条件ではなく、
# 何を検証したかの記録である。
CANDIDATE=$(node scripts/server-test/worktree-content.mjs) || { echo "release-preflight: the worktree content could not be determined (is this a git repository with a commit?)" >&2; exit 1; }
TREE=$CANDIDATE
HEAD_TREE=$(git rev-parse --verify --quiet 'HEAD^{tree}' || echo unknown)
LOG_DIR=${EPGS_PREFLIGHT_LOG_DIR:-$REPO_ROOT/test/server/.artifacts/preflight/${TREE:0:12}/$(date -u +%Y%m%dT%H%M%SZ)}
# coverage mode の worker 数は 8 で calibrate されている。CPU がそれより少ない host では
# 割り当てが過剰になり、real process と millisecond 境界を見る row が時間に追いつけず、
# 走るたびに落ちる。node-matrix の Node 24 leg (run-coverage-gate-cli.mjs 経由の
# test:server:coverage) にも同じ理由で渡す。availableParallelism は CPU affinity mask を見るので、
# taskset で絞った実行でもその数になる。下げる方向にだけ効く。全 step の子 process に伝わるよう
# export する（この変数を読むのは coverage mode の run-tests.mjs だけなので他 step には無害）。
export EPGSTATION_TEST_MAX_WORKERS=$(node -e 'process.stdout.write(String(require("node:os").availableParallelism()))')

# 16 thread 開発機での並列化: (server-check → docker-gate-node24) / (client → client-browser) は
# 互いに依存せず、それぞれ別の container・別の CPU 帯を使うので同時に流せる。模擬 container は WS (/home/runner/work/EPGStation/EPGStation) が固定で
# job ごとに初期化されるため、同じ container で 2 つの job を同時には流せない -- そこで
# client/client-browser 用に 2 つ目の container (epgs-runner-rehearsal-b) を rehearsal-setup で
# 追加で作る。2 系統が CPU を取り合わないよう、container A と B は互いに素な CPU 帯に固定する。
REHEARSAL_NAME_B=${EPGS_REHEARSAL_NAME_B:-epgs-runner-rehearsal-b}
PREFLIGHT_CPUSET_A=${EPGS_PREFLIGHT_CPUSET_A:-0-3}
PREFLIGHT_CPUSET_B=${EPGS_PREFLIGHT_CPUSET_B:-4-11}
# container B の CPU 帯は container A と互いに素だが、docker-gate-node24 (image の build で
# I/O・memory 帯域を使う) を同時に流すと、CPU pinning では隔離できない共有資源の競合が起きる。
# 計測（実測、taskset での模擬ではなく実際に並列 group を流して確認。この値は host 側でも重い test を同時に
# 流した条件で測ったもので、docker-gate-node24 と client の 2 系統だけを流した構成では測っていない。
# 下の値は安全側に置く）: client/vite.config.ts の既定
# coverageGateMaxWorkers(CPU 数と 8 の小さい方 = 8)のまま同時に流すと、327 file 中の
# upload-submit.spec.test.tsx の重い test が 5000ms の既定 timeout を超えて落ちた
# (単独では 327 file 全 pass だった)。worker 4 まで下げると timeout の失敗は
# 再発しなかったが、最遅 test は目標の 60%(3000ms) を超えたまま(67%/73%)だった -- 3000ms 未達の
# 主因は CPU pinning で分離できる範囲を越えた共有資源競合(disk I/O・メモリ帯域)と見ている。
# worker を下げるほど安全側に効く一方で下げすぎるとcoverage:gate自体が遅くなるため、
# `--all` の並列 group でだけ 4 に下げる(単独 `--only client` や client-check には影響しない)。
PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS=${EPGS_PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS:-4}
# 同じ理由で client-browser の Playwright worker 数も並列 group でだけ下げる。実測: 並列
# group で実際に docker-gate-node24 などと同時に client-browser (既定 6 workers、
# client/playwright.config.ts の CPU 数由来の値) を流したところ、e2e の 2 test が locator の
# 5000ms / click の 30000ms timeout で落ちた（孤立実行や taskset 単体での模擬では再現しなかった
# 負荷）。coverage:gate と同じ根拠（共有 I/O・メモリ帯域競合）と見て、こちらも並列 group 中だけ
# 下げる。
PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS=${EPGS_PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS:-2}
STEPS=(
  "stale-containers|remove epgs-docker-check-*, epgstation-docker-check-*, ar-9-17-* and epgstation-persistence-* leftovers (containers, plus the check networks and images) from killed runs|bash scripts/preflight-clean-stale-containers.sh"
  "rehearsal-setup|hosted runner lookalike containers (once): container A ($PREFLIGHT_CPUSET_A CPUs) for server-check/docker-gate-node24, container B ($PREFLIGHT_CPUSET_B CPUs, $REHEARSAL_NAME_B) for client/client-browser|EPGS_REHEARSAL_CPUSET=$PREFLIGHT_CPUSET_A bash scripts/ci-rehearsal/setup.sh && EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B EPGS_REHEARSAL_CPUSET=$PREFLIGHT_CPUSET_B bash scripts/ci-rehearsal/setup.sh"
  "deps-prepare|Docker image の確認の依存 image（base image の pull、OS package 層、npm の依存関係の層）を手元に揃える。外部へ取りに行くのはこの step だけ。container A の nested daemon と host の daemon（node-matrix の Node 24 の回が使う）の両方へ揃える。取得に失敗したら exit 75 で、test は始めない|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.18.0 deps-prepare - && node scripts/server-test/prepare-dependency-images.mjs"
  "server-check|server static checks (lint, typecheck, format check; the same checks as the pull request server check job), in lookalike container A|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.18.0 server-check -"
  "docker-gate-node24|Docker image check (build the production images from the prepared dependencies, start them against a stub, probe /api/version and /, clean up; Debian and Alpine), docker-image.integration.test.ts alone, Node 24, in lookalike container A|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.18.0 serialized integration/application-runtime/docker-image.integration.test.ts"
  "client|client static checks, unit tests, the 100% coverage gate, and the vite dev server check, in lookalike container B|EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.18.0 client-static -"
  "client-browser|client bundle, e2e and visual against real browsers, in lookalike container B|EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.18.0 client-browser -"
  "node-matrix|Node 24 / 26, each in its own fresh workspace: npm ci, build-server, then one server-test run (Node 24's run also measures src/**'s C0/C1 and requires both at 100%; a test failure, a broken measurement, or a well-formed C0/C1 under 100% all fail it; Node 26 runs the plain suite once)|node scripts/server-test/run-node-acceptance-matrix.mjs --candidate $CANDIDATE"
)
# node-matrix runs Node 24 and Node 26 each in their own fresh workspace: `npm ci` →
# build-server → one server-test run per major. Node 24's run alone measures src/**'s
# C0/C1 (see run-coverage-gate-cli.mjs) and requires both at 100%, failing closed on any
# shortfall (in addition to a test failure or a broken measurement). The standalone Docker
# image check (docker-gate-node24) is Node 24 only.
# deps-prepare は Docker image の確認の依存 image を揃える、外部へ取りに行く唯一の step。docker-gate-node24
# (container A の nested daemon) と node-matrix の Node 24 の回 (host の daemon) の test 本体は
# 取得せず、揃っていなければ「準備されていない」(not-prepared) で落ちる。`--only docker-gate-node24` や
# `--only node-matrix` で切り分けるときは、先に `--only deps-prepare` を実行する。
ALL_DEFAULT=(stale-containers rehearsal-setup deps-prepare server-check docker-gate-node24 client client-browser node-matrix)
usage() { sed -n 2,7p "$0"; }
list() { for row in "${STEPS[@]}"; do IFS='|' read -r name desc cmd <<<"$row"; printf '%-24s %s\n    %s\n' "$name" "$desc" "$cmd"; done
  printf '\n--all order: stale-containers, rehearsal-setup, deps-prepare, then in parallel [server-check -> docker-gate-node24] and [client -> client-browser], then node-matrix\n'; }
run_step() {
  local wanted=$1 row name desc cmd
  for row in "${STEPS[@]}"; do
    IFS='|' read -r name desc cmd <<<"$row"
    [[ $name == "$wanted" ]] || continue
    local log=$LOG_DIR/$name.log started=$(date -u +%FT%TZ)
    echo "=== $name: $desc"
    echo "    $cmd"
    echo "    log: $log"
    bash -c "$cmd" >"$log" 2>&1
    local status=$?
    printf '%s\t%s\t%s\texit=%s\ttree=%s\n' "$started" "$(date -u +%FT%TZ)" "$name" "$status" "$TREE" >>"$LOG_DIR/summary.tsv"
    echo "    exit=$status"
    return $status
  done
  echo "unknown step: $wanted" >&2; return 2
}
selected=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --list) list; exit 0 ;;
    --only) selected+=("$2"); shift ;;
    --all) selected+=("${ALL_DEFAULT[@]}") ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done
[[ ${#selected[@]} -gt 0 ]] || { usage; exit 2; }

mkdir -p "$LOG_DIR"
echo "log: $LOG_DIR"

# 検証する中身を、HEAD との違いと一緒に開始時に記録する（合否の条件ではない）。
if [[ $HEAD_TREE == "$CANDIDATE" ]]; then uncommitted=no; else uncommitted=yes; fi
echo "candidate (worktree content tree): $CANDIDATE  HEAD tree: $HEAD_TREE  uncommitted changes: $uncommitted"
echo "# candidate=$CANDIDATE head-tree=$HEAD_TREE uncommitted-changes=$uncommitted" >> "$LOG_DIR/summary.tsv"
failed=()
# 最初の失敗で止めると、後続 step が捨てられ、「1 つ直す → --all 全体を回す → 別の step で落ちる →
# また全体を回す」が繰り返される。そこで、失敗を即座に log と stderr へ出して外から見張る側が気づける
# ようにしたうえで、残りの step も走り切り、最後に失敗した step をまとめて報告する。
# 1 回の run で全ての失敗が取れる。
record_failure() { # step name -> 即座に stderr と summary.tsv へ報告する。background subshell からも呼べる。
  local step=$1
  echo "FAILED-STEP: $step (この時点で失敗を記録し、残りの step も実行して全ての失敗を集める)" >&2
  echo "FAILED-STEP: $step" >> "$LOG_DIR/summary.tsv"
}
run_chain() { # failfile, step... : step を順に実行し、失敗しても chain を止めず残りも実行する。
              # 失敗は即座に record_failure で報告しつつ、その名前を failfile にも書く -- この
              # 関数は並列 group ではバックグラウンド subshell として動くため、親 shell の
              # `failed` 配列を直接更新できない (subshell の変数は親に伝わらない)。親側は `wait`
              # の後に各 failfile を読んで `failed` 配列を組み立てる。
  local failfile=$1; shift
  local step
  for step in "$@"; do
    if ! run_step "$step"; then
      record_failure "$step"
      echo "$step" >> "$failfile"
    fi
  done
}

# `--all` がそのまま ALL_DEFAULT を選んだときだけ、重い 2 系統
# [server-check → docker-gate-node24] / [client → client-browser] を同時に流す (それぞれ別 container・
# 別 CPU 帯を使うため干渉しない)。stale-containers と
# rehearsal-setup は並列 group の前に単独で、node-matrix はその後に単独で実行する。`--only` で
# 個別に選ぶ通常の切り分け実行は単純な逐次実行になる。
default_selected=0
deps_prepare_failed=0
if [[ ${#selected[@]} -eq ${#ALL_DEFAULT[@]} ]]; then
  default_selected=1
  for i in "${!ALL_DEFAULT[@]}"; do
    [[ ${selected[$i]} == "${ALL_DEFAULT[$i]}" ]] || { default_selected=0; break; }
  done
fi

if [[ $default_selected -eq 1 ]]; then
  run_step stale-containers || { record_failure stale-containers; failed+=(stale-containers); }
  run_step rehearsal-setup || { record_failure rehearsal-setup; failed+=(rehearsal-setup); }
  # 依存 image の用意は、外部へ取りに行く唯一の step。取得に失敗したら（exit 75）test は 1 つも
  # 始めない: docker-gate と node-matrix は「準備されていない」で必ず落ちるので、走らせても
  # 取得の失敗を test の失敗に見せかけるだけになる。
  if ! run_step deps-prepare; then
    record_failure deps-prepare
    failed+=(deps-prepare)
    echo "deps-prepare が失敗したため、test の step は始めません (log: $LOG_DIR/deps-prepare.log)" >&2
    deps_prepare_failed=1
  fi
  if [[ $deps_prepare_failed -eq 0 ]]; then
    fail_a=$(mktemp)
    fail_b=$(mktemp)
    run_chain "$fail_a" server-check docker-gate-node24 &
    pid_a=$!
    # coverage:gate と Playwright の worker 上限を並列 group 中だけ下げる（上の
    # PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS / PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS 定義のコメント
    # 参照）。この subshell の export は親 shell や他の chain には伝わらない。
    ( export EPGSTATION_COVERAGE_GATE_MAX_WORKERS=$PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS
      export PLAYWRIGHT_WORKERS=$PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS
      run_chain "$fail_b" client client-browser ) &
    pid_b=$!
    wait "$pid_a" "$pid_b"
    for failfile in "$fail_a" "$fail_b"; do
      while read -r step; do [[ -n $step ]] && failed+=("$step"); done < "$failfile"
      rm -f "$failfile"
    done

    run_step node-matrix || { record_failure node-matrix; failed+=(node-matrix); }
  fi
else
  for step in "${selected[@]}"; do
    if ! run_step "$step"; then
      failed+=("$step")
      record_failure "$step"
      # 取得の失敗の後は test を始めない（上の default の run と同じ。理由はそちらを参照）。
      if [[ $step == deps-prepare ]]; then
        echo "deps-prepare が失敗したため、後続の step は始めません (log: $LOG_DIR/deps-prepare.log)" >&2
        break
      fi
    fi
  done
fi
echo "summary: $LOG_DIR/summary.tsv"
if [[ ${#failed[@]} -gt 0 ]]; then echo "FAILED: ${failed[*]}"; exit 1; fi
echo "ALL PASSED (${#selected[@]} steps)"
