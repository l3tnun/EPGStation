#!/bin/bash
# Run one hosted-CI job inside the rehearsal container built by setup.sh.
#   job.sh local <node-version> server-check -    (server.yml: lint, typecheck, format check)
#   job.sh local <node-version> client-check -    (client.yml: lint, typecheck, format check)
#   job.sh local <node-version> shard <i/n>       (full server test suite, not a hosted CI job)
#   job.sh local <node-version> serialized <layer>/<path under test/server>   (e.g. integration/application-runtime/docker-image.integration.test.ts)
#   job.sh local <node-version> deps-prepare -    (the Docker image gate's dependency images, built into
#                                                  this container's nested daemon; the only place that fetches)
#   job.sh tree:<40-hex tree id> ...       (a content tree, e.g. the worktree content `npm run preflight` verifies)
#   job.sh <40-hex candidate sha> ...      (fetches the pushed commit through `gh auth token`)
# "local" ships the repository's HEAD commit as a git bundle, so unpushed commits can be rehearsed.
# "tree:<id>" ships a parentless commit carrying exactly that tree (so it may hold uncommitted changes):
# the commit is bundled through a temporary ref that is removed again, and the container checks that the
# `HEAD^{tree}` it checked out is the requested tree. The workflow steps that run and the image digest
# the container is compared with are also read from that tree (`git show <tree>:<path>`), not from the
# working directory.
# server.yml and client.yml both declare a single `check` job whose first two steps (Materialize
# candidate; Install pinned mise and the Node toolchain) are byte-identical between the two files,
# so those two steps are always read from server.yml regardless of which job is being rehearsed.
# `shard` and `serialized` run the full server test suite, which is not part of any hosted CI
# job (server.yml only lints/typechecks/format-checks); they stay here because
# `npm run preflight` uses them to rehearse the heavier local-only gates in the same container.
set -euo pipefail
REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
NAME=${EPGS_REHEARSAL_NAME:-epgs-runner-rehearsal}
SHA=$1; NODE=$2; KIND=$3; ARG=$4
WS=/home/runner/work/EPGStation/EPGStation
WORKFLOW="$REPO_ROOT/.github/workflows/server.yml"
CLIENT_WORKFLOW="$REPO_ROOT/.github/workflows/client.yml"
# Everything this script reads from the repository to decide what runs (the workflow steps, the image
# digest) comes from the candidate tree when one is named, not from the working directory as it is by
# now: a file edited after the tree was fixed must not change what is verified.
TREE_ID=""
TREE_REF=""
TREE_INPUTS=""
cleanup() {
  [ -z "$TREE_REF" ] || git -C "$REPO_ROOT" update-ref -d "$TREE_REF" 2>/dev/null || true
  [ -z "$TREE_INPUTS" ] || rm -rf -- "${TREE_INPUTS:?}"
}
trap cleanup EXIT
if [[ "$SHA" == tree:* ]]; then
  TREE_ID=${SHA#tree:}
  if ! [[ "$TREE_ID" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ci-rehearsal: tree:<id> needs a 40-hex tree id (got '$TREE_ID')" >&2
    exit 1
  fi
  mkdir -p "${TMPDIR:-$REPO_ROOT/test/server/.artifacts}"
  TREE_INPUTS=$(mktemp -d "${TMPDIR:-$REPO_ROOT/test/server/.artifacts}/ci-rehearsal-inputs.XXXXXX")
  git -C "$REPO_ROOT" show "$TREE_ID:.github/workflows/server.yml" > "$TREE_INPUTS/server.yml"
  git -C "$REPO_ROOT" show "$TREE_ID:.github/workflows/client.yml" > "$TREE_INPUTS/client.yml"
  WORKFLOW="$TREE_INPUTS/server.yml"
  CLIENT_WORKFLOW="$TREE_INPUTS/client.yml"
fi
# The image holds the toolchain and both dependency trees so a rehearsal fetches none of it. That
# only stays honest while the image still matches what the repository declares, so the digest is
# recomputed here and compared with the one the image recorded. A mismatch stops the run: falling
# back to fetching would reinstate the failures the image removes, and running anyway would test a
# toolchain or a dependency tree that is not the declared one.
if [ -n "$TREE_ID" ]; then
  EXPECTED_DIGEST=$(node "$REPO_ROOT/scripts/ci-rehearsal/image-digest.mjs" --tree "$TREE_ID")
else
  EXPECTED_DIGEST=$(node "$REPO_ROOT/scripts/ci-rehearsal/image-digest.mjs")
fi
IMAGE_DIGEST=$(docker inspect --format '{{index .Config.Labels "org.epgstation.rehearsal.digest"}}' "$NAME" 2>/dev/null || true)
if [ "$IMAGE_DIGEST" != "$EXPECTED_DIGEST" ]; then
  echo "ci-rehearsal: the container does not match what the repository declares." >&2
  echo "  expected ${EXPECTED_DIGEST:0:12}, container has ${IMAGE_DIGEST:0:12}" >&2
  echo "  the toolchain pins or a package manifest changed; rebuild with scripts/ci-rehearsal/setup.sh" >&2
  exit 1
fi

# ~/.docker holds the buildx state and is kept, but the docker CLI creates it as whoever ran it
# first. A root-owned one leaves the runner unable to read its own config, and the CLI then cannot
# find its plugins, so buildx stops existing partway through a rehearsal. The ownership is put back
# below rather than the directory removed.
# Everything tracked is re-materialized from the candidate below, so the workspace is emptied --
# except the two node_modules, which the image installed from the very lockfiles this digest covers.
# The client tree is moved aside first: emptying the workspace would take the directory holding it,
# and recreating an empty one afterwards is not the same thing.
docker exec "$NAME" bash -c "set -e
mkdir -p $WS
if [ -d $WS/client/node_modules ]; then
  rm -rf /home/runner/work/_temp/client-node-modules
  mv $WS/client/node_modules /home/runner/work/_temp/client-node-modules
fi
find $WS -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
mkdir -p $WS/client
if [ -d /home/runner/work/_temp/client-node-modules ]; then
  mv /home/runner/work/_temp/client-node-modules $WS/client/node_modules
fi
chown runner:runner $WS $WS/client
rm -rf /home/runner/.gitconfig /home/runner/.config
[ -e /home/runner/.docker ] && chown -R runner:runner /home/runner/.docker || true
: > /home/runner/work/_temp/github_path
chown runner /home/runner/work/_temp/github_path"
step_script() { python3 - "$1" "$2" "$3" <<'PY'
import sys, yaml
workflow, job, name = sys.argv[1:4]
for step in yaml.safe_load(open(workflow))['jobs'][job]['steps']:
    if step['name'] == name:
        print(step['run'])
PY
}
run_step() { # name, extra docker-exec env flags, script
  echo "::group::$1  $(date -u +%H:%M:%S)"
  docker exec -i -u runner -w "$WS" $2 "$NAME" bash -c "$3"
  echo "::endgroup:: $(date -u +%H:%M:%S)"
}
# The two workflows' `check` job both start with the same two steps (Materialize candidate;
# Install pinned mise and the Node toolchain); either file's copy reads the same text, so
# server.yml is used for both regardless of which job is being rehearsed.
JOB=check
BASE="-e CI=1 -e TZ=UTC -e DO_NOT_TRACK=1 -e HOME=/home/runner -e RUNNER_TEMP=/home/runner/work/_temp -e GITHUB_REPOSITORY=l3tnun/EPGStation -e GITHUB_PATH=/home/runner/work/_temp/github_path -e PATH=/home/runner/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if [ "$SHA" = local ]; then
  LSHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
  bundle=$(mktemp)
  git -C "$REPO_ROOT" bundle create "$bundle" HEAD >/dev/null 2>&1
  docker cp "$bundle" "$NAME:/home/runner/work/_temp/candidate.bundle"; rm -f "$bundle"
  docker exec "$NAME" chown runner /home/runner/work/_temp/candidate.bundle
  run_step "Materialize candidate (local $LSHA)" "$BASE" "git init --quiet . && git fetch --quiet --no-tags /home/runner/work/_temp/candidate.bundle HEAD && git checkout --quiet --detach $LSHA && git remote add origin https://invalid.local/candidate.git && rm -f /home/runner/work/_temp/candidate.bundle"
elif [[ "$SHA" == tree:* ]]; then
  # A parentless commit that carries exactly the tree. It goes into the bundle through a temporary ref,
  # which is removed as soon as the bundle exists (or when this script stops before that).
  TSHA=$(GIT_AUTHOR_NAME=rehearsal GIT_AUTHOR_EMAIL=rehearsal@epgstation.invalid GIT_COMMITTER_NAME=rehearsal GIT_COMMITTER_EMAIL=rehearsal@epgstation.invalid \
    git -C "$REPO_ROOT" commit-tree "$TREE_ID" -m "rehearsal candidate tree $TREE_ID")
  TREE_REF=refs/epgstation-rehearsal/$$
  git -C "$REPO_ROOT" update-ref "$TREE_REF" "$TSHA"
  bundle=$(mktemp)
  git -C "$REPO_ROOT" bundle create "$bundle" "$TREE_REF" >/dev/null 2>&1
  # Cleanup only: the bundle already exists. Two rehearsals started together can contend for the
  # packed-refs lock, and a failed delete must not fail a step whose verdict does not depend on it
  # (the exit trap deletes the ref again, and the ref name is unique to this pid).
  git -C "$REPO_ROOT" update-ref -d "$TREE_REF" || true
  docker cp "$bundle" "$NAME:/home/runner/work/_temp/candidate.bundle"; rm -f "$bundle"
  docker exec "$NAME" chown runner /home/runner/work/_temp/candidate.bundle
  run_step "Materialize candidate (tree $TREE_ID)" "$BASE" "git init --quiet . && git fetch --quiet --no-tags /home/runner/work/_temp/candidate.bundle $TREE_REF && git checkout --quiet --detach $TSHA && [ \"\$(git rev-parse 'HEAD^{tree}')\" = $TREE_ID ] && git remote add origin https://invalid.local/candidate.git && rm -f /home/runner/work/_temp/candidate.bundle"
else
  TOKEN=$(gh auth token)
  run_step "Materialize candidate" "$BASE -e EPGSTATION_CANDIDATE_SHA=$SHA -e EPGSTATION_READ_TOKEN=$TOKEN" "$(step_script "$WORKFLOW" $JOB 'Materialize candidate')"
fi
run_step "Install pinned mise and the Node toolchain" "$BASE -e MISE_YES=1" "$(step_script "$WORKFLOW" $JOB 'Install pinned mise and the Node toolchain')"
# Neither hosted `check` job (lint/typecheck/format check only) touches a fixture database or a
# fixture git repository, so this setup is only needed for the full server test suite (`shard`,
# `serialized`), which is not part of any hosted CI job -- server.yml does not run tests, so these
# commands are pinned here directly instead of being read out of server.yml's steps.
case "$KIND" in
  client-*|*-check|deps-prepare) ;;
  *)
    run_step "Pull database fixture images" "$BASE" \
      'set -euo pipefail
for image in mysql:8.4 mysql:lts mariadb:10.11; do
  for attempt in 1 2 3; do
    docker pull -q "$image" && break
    [[ $attempt -lt 3 ]] || exit 1
    sleep 15
  done
done'
    run_step "Configure git identity" "$BASE" \
      "set -euo pipefail
git config --global user.name 'EPGStation CI'
git config --global user.email ci@epgstation.invalid"
    ;;
esac
# `npm ci` deletes node_modules and reinstalls it, so running it would discard what the image
# installed and go back to the network. The digest check above is what allows skipping it: the
# lockfiles it covers are the ones the image installed from, and the image build runs `npm ci`
# itself, so a lockfile that does not match its package.json fails there.
echo "::group::Install dependencies (from the image)  $(date -u +%H:%M:%S)"
echo "node_modules ships in the image (${IMAGE_DIGEST:0:12}); skipping npm ci"
echo "::endgroup:: $(date -u +%H:%M:%S)"
case "$KIND" in
  client-*|*-check|deps-prepare) ;;  # server-only build; the hosted `check` job doesn't build the server either
  *) run_step "Build server for tests" "$BASE" "mise exec node@$NODE -- npm run test:server:build" ;;
esac
if [ "$KIND" = server-check ] || [ "$KIND" = client-check ]; then
  # Rehearses the actual hosted `check` job (lint, typecheck, format check) byte-for-byte: each
  # step's command is read straight out of the workflow file being rehearsed, not re-typed here.
  # `Install dependencies` itself is skipped like everywhere else in this script -- node_modules
  # ships in the image and the digest check above is what makes that a faithful substitute.
  check_workflow="$WORKFLOW"; [ "$KIND" = client-check ] && check_workflow="$CLIENT_WORKFLOW"
  run_step "Lint" "$BASE" "$(step_script "$check_workflow" $JOB 'Lint')"
  run_step "Typecheck" "$BASE" "$(step_script "$check_workflow" $JOB 'Typecheck')"
  run_step "Format check" "$BASE" "$(step_script "$check_workflow" $JOB 'Format check')"
elif [ "$KIND" = deps-prepare ]; then
  # Puts what the Docker image gate consumes into this container's nested daemon (base images by the
  # digest the product Dockerfiles pin, the OS-package and npm dependency layers, the gitleaks
  # image). The gate's test body fetches nothing, so this is the one place that goes out to a
  # registry or a package mirror; with everything already present it only inspects local images. It
  # needs no node_modules: the script imports nothing outside the repository and node:*. Exit 75 means
  # a fetch failed (not a test failure).
  run_step "Prepare dependency images" "$BASE" "mise exec node@$NODE -- node scripts/server-test/prepare-dependency-images.mjs"
elif [ "$KIND" = client-static ]; then
  # The same checks the client gate has always run, moved off the host. On the host they read
  # whichever node_modules the working tree happened to hold, which is not necessarily the one the
  # lockfile describes; here they read the tree the image installed from that lockfile.
  #
  # `coverage:gate` alone covers what `test:run` would run: both are
  # `vitest run unittest` against the same vite.config.ts `test` block (environment, exclude,
  # globals, setupFiles) -- `coverage:gate` only additionally sets VITEST_COVERAGE_GATE=1, which the
  # config reads solely to turn on `coverage.thresholds`, and passes `--coverage`, which instruments
  # collection but does not change which tests run or how. Running `test:run` as well would duplicate that
  # same unittest run.
  # EPGSTATION_COVERAGE_GATE_MAX_WORKERS, if set in this script's own environment, is forwarded so
  # a caller running this alongside other heavy jobs (release-preflight.sh's parallel group) can cap
  # coverage:gate's fork pool worker count below what client/vite.config.ts would otherwise pick
  # from this container's own CPU count. Unset (the default for a standalone client-static run, e.g.
  # the push-before-hosted-CI use in AGENTS.md, which does not run alongside docker-gate-node24)
  # leaves vite.config.ts's own CPU-count-based default in place.
  coverage_gate_env=""
  [ -n "${EPGSTATION_COVERAGE_GATE_MAX_WORKERS:-}" ] && coverage_gate_env=" -e EPGSTATION_COVERAGE_GATE_MAX_WORKERS=$EPGSTATION_COVERAGE_GATE_MAX_WORKERS"
  run_step "Client static checks and unit tests" "$BASE$coverage_gate_env" \
    "cd client && mise exec node@$NODE -- npm run lint && mise exec node@$NODE -- npm run typecheck && mise exec node@$NODE -- npm run format:check && mise exec node@$NODE -- npm run coverage:gate && mise exec node@$NODE -- npm run test:dev-server"
elif [ "$KIND" = client-browser ]; then
  # The browsers are in the image, and the bundle these serve is built here rather than reused from
  # the host, so what the browser loads is what this candidate produces.
  # PLAYWRIGHT_WORKERS, if set in this script's own environment, is forwarded the same way
  # EPGSTATION_COVERAGE_GATE_MAX_WORKERS is above: a caller running this alongside other heavy jobs
  # can cap Playwright's worker count below what client/playwright.config.ts's CPU-count-based
  # default would otherwise pick. Unset (the default for a standalone client-browser run) leaves
  # that file's own default in place.
  playwright_workers_env=""
  [ -n "${PLAYWRIGHT_WORKERS:-}" ] && playwright_workers_env=" -e PLAYWRIGHT_WORKERS=$PLAYWRIGHT_WORKERS"
  run_step "Build client bundle" "$BASE" "cd client && mise exec node@$NODE -- npm run bundle"
  run_step "Client e2e" "$BASE -e CI=1$playwright_workers_env" "cd client && mise exec node@$NODE -- npm run e2e"
  run_step "Client visual" "$BASE -e CI=1$playwright_workers_env" "cd client && mise exec node@$NODE -- npm run visual"
elif [ "$KIND" = shard ]; then
  run_step "Run shard $ARG" "$BASE -e TZ=Asia/Tokyo" "mise exec node@$NODE -- npm run test:server -- --shard $ARG"
else
  layer=${ARG%%/*}; name=${ARG#*/}
  case "$layer" in
    spec|integration) locator="test/server/$name" ;;
    *) echo "unknown layer: $layer" >&2; exit 1 ;;
  esac
  run_step "Run serialized $ARG" "$BASE -e TZ=Asia/Tokyo" "mise exec node@$NODE -- npm run test:server:$layer -- --serialized-only $locator"
fi
echo "JOB-OK $NODE $KIND $ARG"
