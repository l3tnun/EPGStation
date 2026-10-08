#!/bin/bash
# Builds the rehearsal runner image and starts a container from it: ubuntu 24.04, 4 CPUs (cpuset),
# 16 GiB, Docker-in-Docker with the runner image's Docker 28.0.4 and buildx 0.36.1 on the overlay2
# store, user "runner", TZ=UTC. Requires a rootful Docker on the host.
#
# This is the only step that fetches mise, the Node toolchain, the dependency trees and the
# Playwright browsers. A rehearsal then runs against what the image holds, so a slow or failing
# remote cannot decide whether the gate passes. The image is tagged and labelled with the
# digest of everything it bakes in; `job.sh` recomputes that digest and refuses to run against an
# image that does not match, which is what keeps the caching from quietly testing the wrong
# toolchain. Re-run this after changing any of those inputs -- `job.sh` says so when it stops.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$HERE/../.." && pwd)
NAME=${EPGS_REHEARSAL_NAME:-epgs-runner-rehearsal}
CPUSET=${EPGS_REHEARSAL_CPUSET:-0-3}
IMAGE=${EPGS_REHEARSAL_IMAGE:-epgs-runner-rehearsal}
DIGEST=$(node "$HERE/image-digest.mjs")
SHORT=${DIGEST:0:12}

# The install step is the authority on which mise the rehearsal uses; taking the version and its
# checksum from there keeps this from drifting into a second, quieter pin.
step=$(python3 - "$REPO_ROOT/.github/workflows/server.yml" <<'PY'
import sys, yaml
workflow = yaml.safe_load(open(sys.argv[1]))
for step in workflow['jobs']['check']['steps']:
    if step['name'] == 'Install pinned mise and the Node toolchain':
        print(step['run'])
        break
else:
    raise SystemExit('server.yml: install step not found')
PY
)
MISE_VERSION=$(printf '%s\n' "$step" | sed -n 's/^mise_version=\(.*\)$/\1/p')
MISE_SHA256=$(printf '%s\n' "$step" | sed -n 's/^mise_sha256=\(.*\)$/\1/p')
BUILD_NODE=$(sed -n 's/^node = \["\([^"]*\)".*/\1/p' "$REPO_ROOT/mise.toml")
for required in MISE_VERSION MISE_SHA256 BUILD_NODE; do
    if [ -z "${!required}" ]; then
        echo "ci-rehearsal setup: could not read $required from the pinned sources" >&2
        exit 1
    fi
done

echo "building $IMAGE:$SHORT (mise $MISE_VERSION, node $BUILD_NODE)"
docker build \
    --file "$HERE/Dockerfile.runner" \
    --tag "$IMAGE:$SHORT" \
    --build-arg "MISE_VERSION=$MISE_VERSION" \
    --build-arg "MISE_SHA256=$MISE_SHA256" \
    --build-arg "BUILD_NODE=$BUILD_NODE" \
    --build-arg "IMAGE_DIGEST=$DIGEST" \
    "$REPO_ROOT"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --init --privileged --name "$NAME" --hostname runner \
    --cpuset-cpus="$CPUSET" --memory=16g \
    -v "$NAME-docker:/var/lib/docker" \
    -e TZ=UTC -e DEBIAN_FRONTEND=noninteractive \
    "$IMAGE:$SHORT" >/dev/null

# The nested daemon is started here rather than baked in: it owns the overlay2 store on the mounted
# volume, which only exists once the container runs.
# `docker exec` without -d kills the process group when the session ends, so a
# background dockerd started in that session is gone before the next exec. -d
# reparents it to the container's init. Readiness is checked as `runner`, the
# same user later pulls and tags images.
docker exec -d "$NAME" sh -c 'dockerd --storage-driver=overlay2 >/var/log/dockerd.log 2>&1'
dockerd_ready=0
for _ in $(seq 1 30); do
    # `docker info --format ...` on the Docker 28 CLI still exits 0 when it cannot reach the
    # daemon -- it prints "Cannot connect to the Docker daemon ..." to stderr and leaves the
    # template fields empty, but the exit code alone looks like success. `docker version
    # --format '{{.Server.Version}}'` fails (non-zero) in that same case, and its output is
    # empty unless a real server answered, so both the exit code and a non-empty version are
    # required before the daemon counts as ready.
    if server_version=$(docker exec -u runner "$NAME" docker version --format '{{.Server.Version}}') && [ -n "$server_version" ]; then
        echo "nested dockerd ready: $server_version"
        dockerd_ready=1
        break
    fi
    sleep 2
done
if [ "$dockerd_ready" -ne 1 ]; then
    docker exec "$NAME" tail -20 /var/log/dockerd.log >&2 || true
    echo "ci-rehearsal setup: nested dockerd did not accept connections from runner" >&2
    exit 1
fi
# The fixture databases are pulled by a workflow step on every run. `docker pull` contacts the
# registry even when the image is already present, so a slow or unreachable registry fails a
# rehearsal over images that never changed -- and the tags float, so two pulls at different times
# can hand the same rehearsal different databases. Copying them in from the host settles both: the
# nested daemon holds exactly what the host holds, by digest, and the pull that follows finds them
# already there.
for image in mysql:8.4 mysql:lts mariadb:10.11; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "pulling $image on the host so the rehearsal does not have to"
        docker pull -q "$image" >/dev/null
    fi
    host_digest=$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')
    # Run as `runner`: the docker CLI writes into the caller's ~/.docker, and a root-owned one there
    # leaves the runner unable to read its own config -- which stops the CLI from finding its
    # plugins, so `docker buildx` disappears mid-rehearsal.
    container_digest=$(docker exec -u runner "$NAME" docker image inspect "$image" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)
    [ "$host_digest" = "$container_digest" ] && continue
    # Pulled by digest rather than copied in: `docker save` drops the RepoDigests, and the fixture
    # runtime reads that field to identify which database it is talking to. Naming the digest also
    # pins what arrives, so the floating tag cannot hand the rehearsal a different database than the
    # host resolved.
    echo "aligning $image in the rehearsal to ${host_digest##*@}"
    docker exec -u runner "$NAME" docker pull -q "$host_digest" >/dev/null
    docker exec -u runner "$NAME" docker tag "$host_digest" "$image"
done

# The dependency images (both layers: OS packages, then npm) are built by the preparation step
# (scripts/server-test/prepare-dependency-images.mjs) and kept so a later run does not fetch the
# same packages again; the gate itself only reads them and removes only what it created -- an image
# an earlier run left behind is, to a later one, someone else's. Pruning them is therefore this
# script's job: it owns the daemon rather than a single run of it. Tags are derived from each
# layer's own inputs, so anything not matching the current ones is unreachable by any future run.
current_deps=$(node "$HERE/deps-image-tags.mjs" 2>/dev/null || true)
if [ -n "$current_deps" ]; then
    for tag in $(docker exec -u runner "$NAME" docker images --format '{{.Repository}}:{{.Tag}}' --filter 'reference=epgstation-deps-*' 2>/dev/null || true); do
        printf '%s\n' "$current_deps" | grep -qx "$tag" && continue
        echo "removing superseded dependency image $tag"
        docker exec -u runner "$NAME" docker rmi -f "$tag" >/dev/null 2>&1 || true
    done
fi

# The container above was just recreated, so no run is using this nested daemon right now: any
# epgstation-docker-check-* tag found here belongs to a run that has already ended, not one in
# progress.
#
# A finished Docker image check removes the images, containers and network it created (names
# epgstation-docker-check-<flavor>:<id> and epgs-docker-check-*), but a run killed before its
# cleanup, or a `docker rmi` that itself failed, leaves its image tag in place. No later run reads a
# stale tag as evidence of anything, so removing it here does not destroy another run's result.
for pattern in 'epgstation-docker-check-*' 'epgs-docker-check-*'; do
    for tag in $(docker exec -u runner "$NAME" docker images --format '{{.Repository}}:{{.Tag}}' --filter "reference=$pattern" 2>/dev/null || true); do
        echo "removing leftover image $tag"
        if ! docker exec -u runner "$NAME" docker rmi -f "$tag" >/dev/null 2>&1; then
            echo "ci-rehearsal setup: could not remove leftover image $tag (still in use?)" >&2
            exit 1
        fi
    done
done
for pattern in 'epgstation-docker-check-*' 'epgs-docker-check-*'; do
    remaining=$(docker exec -u runner "$NAME" docker images --format '{{.Repository}}:{{.Tag}}' --filter "reference=$pattern" 2>/dev/null || true)
    if [ -n "$remaining" ]; then
        echo "ci-rehearsal setup: leftover image(s) still present after cleanup: $remaining" >&2
        exit 1
    fi
done

echo "ready: $NAME ($IMAGE:$SHORT)"
