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
# 模擬 container の CPU 帯と memory の上限、2 系統を同時に流すかどうか、test の worker 数は、選んだ step が決まった後に
# scripts/preflight-resources.mjs が実行する環境の CPU と memory から決める（PREFLIGHT_* の変数。step の command は
# それを実行時に読む）。模擬 container は WS (/home/runner/work/EPGStation/EPGStation) が固定で job ごとに初期化される
# ため、同じ container で 2 つの job を同時には流せない。そこで client/client-browser 用に 2 つ目の container
# (epgs-runner-rehearsal-b) を rehearsal-setup で作る。
REHEARSAL_NAME_B=${EPGS_REHEARSAL_NAME_B:-epgs-runner-rehearsal-b}
STEPS=(
  "stale-containers|remove epgs-docker-check-*, epgstation-docker-check-*, ar-9-17-* and epgstation-persistence-* leftovers (containers, plus the check networks and images) from killed runs|bash scripts/preflight-clean-stale-containers.sh"
  "rehearsal-setup|hosted runner lookalike containers (once): container A for server-check/docker-gate-node24, container B ($REHEARSAL_NAME_B) for client/client-browser, on the CPU bands and memory limit preflight-resources.mjs decided|EPGS_REHEARSAL_CPUSET=\$PREFLIGHT_CPUSET_A EPGS_REHEARSAL_MEMORY=\$PREFLIGHT_CONTAINER_MEMORY bash scripts/ci-rehearsal/setup.sh && EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B EPGS_REHEARSAL_CPUSET=\$PREFLIGHT_CPUSET_B EPGS_REHEARSAL_MEMORY=\$PREFLIGHT_CONTAINER_MEMORY bash scripts/ci-rehearsal/setup.sh"
  "deps-prepare|Docker image の確認の依存 image（base image の pull、OS package 層、npm の依存関係の層）を手元に揃える。外部へ取りに行くのはこの step だけ。container A の nested daemon と host の daemon（node-matrix の Node 24 の回が使う）の両方へ揃える。取得に失敗したら exit 75 で、test は始めない|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.21.0 deps-prepare - && node scripts/server-test/prepare-dependency-images.mjs"
  "server-check|server static checks (lint, typecheck, format check; the same checks as the pull request server check job), in lookalike container A|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.21.0 server-check -"
  "docker-gate-node24|Docker image check (build the production images from the prepared dependencies, start them against a stub, probe /api/version and /, clean up; Debian and Alpine), docker-image.integration.test.ts alone, Node 24, in lookalike container A|scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.21.0 serialized integration/application-runtime/docker-image.integration.test.ts"
  "client|client static checks, unit tests, the 100% coverage gate, and the vite dev server check, in lookalike container B|EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.21.0 client-static -"
  "client-browser|client bundle, e2e and visual against real browsers, in lookalike container B|EPGS_REHEARSAL_NAME=$REHEARSAL_NAME_B scripts/ci-rehearsal/job.sh tree:$CANDIDATE 24.21.0 client-browser -"
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
  printf '\n--all order: stale-containers, rehearsal-setup, deps-prepare, then [server-check -> docker-gate-node24] and [client -> client-browser] (at once or one after the other, as preflight-resources.mjs decides), then node-matrix\n'; }
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

# 道具の確認と構成の決定。足りないもの・使えない指定があれば、step を 1 つも始めずに終わる。
resources=$(node scripts/preflight-resources.mjs --steps "$(IFS=,; echo "${selected[*]}")") || exit 1
eval "$resources"
export PREFLIGHT_CPUSET_A PREFLIGHT_CPUSET_B PREFLIGHT_CONTAINER_MEMORY
# node-matrix と coverage mode の run-tests.mjs が読む（下げる方向にだけ効く）。coverage mode の worker 数は 8 で
# calibrate されていて、CPU や memory がそれに足りない host で 8 のまま流すと、real process と millisecond の境界を見る
# test が時間に追いつかない。他の step には無害。
export EPGSTATION_TEST_MAX_WORKERS=$PREFLIGHT_SERVER_WORKERS

mkdir -p "$LOG_DIR"
echo "log: $LOG_DIR"

# 検証する中身を、HEAD との違いと一緒に開始時に記録する（合否の条件ではない）。
if [[ $HEAD_TREE == "$CANDIDATE" ]]; then uncommitted=no; else uncommitted=yes; fi
echo "candidate (worktree content tree): $CANDIDATE  HEAD tree: $HEAD_TREE  uncommitted changes: $uncommitted"
echo "# candidate=$CANDIDATE head-tree=$HEAD_TREE uncommitted-changes=$uncommitted" >> "$LOG_DIR/summary.tsv"
echo "$PREFLIGHT_RESOURCES_RECORD"
echo "$PREFLIGHT_RESOURCES_RECORD" >> "$LOG_DIR/summary.tsv"
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

# `--all` がそのまま ALL_DEFAULT を選んだときは、重い 2 系統
# [server-check → docker-gate-node24] / [client → client-browser] を、構成が同時と決めていれば同時に
# (それぞれ別 container・別 CPU 帯を使う)、そうでなければ A の系統の後に B の系統を流す。stale-containers と
# rehearsal-setup はその前に単独で、node-matrix はその後に単独で実行する。`--only` で
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
    if [[ $PREFLIGHT_PARALLEL -eq 1 ]]; then
      run_chain "$fail_a" server-check docker-gate-node24 &
      pid_a=$!
      # 同時に流す間は、coverage:gate と Playwright の worker 数を同時に流すときの上限まで下げる
      # (preflight-resources.mjs の PARALLEL_* 参照)。この subshell の export は親 shell や他の chain には伝わらない。
      ( export EPGSTATION_COVERAGE_GATE_MAX_WORKERS=$PREFLIGHT_PARALLEL_CLIENT_COVERAGE_GATE_MAX_WORKERS
        export PLAYWRIGHT_WORKERS=$PREFLIGHT_PARALLEL_CLIENT_PLAYWRIGHT_WORKERS
        run_chain "$fail_b" client client-browser ) &
      pid_b=$!
      wait "$pid_a" "$pid_b"
    else
      run_chain "$fail_a" server-check docker-gate-node24
      ( export EPGSTATION_COVERAGE_GATE_MAX_WORKERS=$PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS
        export PLAYWRIGHT_WORKERS=$PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS
        run_chain "$fail_b" client client-browser )
    fi
    for failfile in "$fail_a" "$fail_b"; do
      while read -r step; do [[ -n $step ]] && failed+=("$step"); done < "$failfile"
      rm -f "$failfile"
    done

    run_step node-matrix || { record_failure node-matrix; failed+=(node-matrix); }
  fi
else
  export EPGSTATION_COVERAGE_GATE_MAX_WORKERS=$PREFLIGHT_CLIENT_COVERAGE_GATE_MAX_WORKERS
  export PLAYWRIGHT_WORKERS=$PREFLIGHT_CLIENT_PLAYWRIGHT_WORKERS
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
