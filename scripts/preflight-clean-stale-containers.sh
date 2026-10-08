#!/bin/bash
# Remove container, network and image leftovers from killed test runs before a preflight step starts.
#
# The Docker image check (test/server/application-runtime/docker-image.integration.test.ts) creates
# `epgs-docker-check-*` containers and networks and `epgstation-docker-check-<flavor>:<id>` images,
# the application-runtime MySQL boundary test (runtime-boundaries.integration.test.ts) creates
# `ar-9-17-*` containers, and the persistence MySQL fixtures (mysql-runtime.ts, mysql-lts-runtime.ts)
# create `epgstation-persistence-*` containers. Each removes its own resources in its own cleanup
# path when the test that owns them finishes, so anything left behind comes from a run that was
# killed before that cleanup ran. A leftover MySQL fixture container is a running, unstopped
# process (it was started detached, so killing the test process does not stop it) that idles at
# ~500 MB each and accumulates across retries; a leftover check container keeps its network and
# image alive and holds the image's disk space. Report what was removed.
#
# `epgs-runner-rehearsal` and `epgs-runner-rehearsal-b` are the long-lived hosted-runner lookalike
# containers, not leftovers. Run this only when no image check or persistence test is running: this
# is the first preflight step, so in normal use nothing here is in flight yet, but a check or
# fixture in flight owns resources of its own.
#
# The same "first preflight step, nothing in flight yet" invariant makes it safe to also remove
# stale `epgstation-docker-check-*` images here: a finished check removes every image it built by
# name, so a tag surviving to the start of the next preflight run belongs to a run that already
# ended without cleaning up after itself. Any id is removed on this basis.
#
# `epgstation-deps-*` images are deliberately excluded: they are named by content hash of the
# manifests they install from, kept across runs on purpose so `apk add`/`apt-get`/`npm ci` are not
# repeated for unchanged inputs, and superseding them is the preparation step's own job
# (scripts/ci-rehearsal/setup.sh does this for the rehearsal's nested daemon). This step only
# removes what a killed check leaves behind.
set -uo pipefail
# 案A (16 thread 開発機での並列化): client/client-browser 用に 2 つ目の長命 rehearsal container
# (既定 epgs-runner-rehearsal-b、scripts/ci-rehearsal/setup.sh / release-preflight.sh の
# EPGS_REHEARSAL_NAME_B と同じ既定値) が増えたため、どちらも残す。
KEEP=(epgs-runner-rehearsal "${EPGS_REHEARSAL_NAME_B:-epgs-runner-rehearsal-b}")
is_kept() {
  local name=$1 k
  for k in "${KEEP[@]}"; do [[ $name == "$k" ]] && return 0; done
  return 1
}
removed=0
for prefix in '^epgs-docker-check-' '^epgstation-docker-check-' '^ar-9-17-' '^epgstation-persistence-'; do
  while read -r name; do
    [[ -n $name ]] || continue
    is_kept "$name" && continue
    echo "removing leftover container: $name"
    docker rm -f "$name" >/dev/null || exit 1
    removed=$((removed + 1))
  done < <(docker ps -a --filter "name=$prefix" --format '{{.Names}}')
done
echo "leftover containers removed: $removed"

networks_removed=0
while read -r name; do
  [[ -n $name ]] || continue
  echo "removing leftover network: $name"
  docker network rm "$name" >/dev/null || exit 1
  networks_removed=$((networks_removed + 1))
done < <(docker network ls --filter 'name=^epgs-docker-check-' --format '{{.Name}}')
echo "leftover networks removed: $networks_removed"

images_removed=0
while read -r tag; do
  [[ -n $tag ]] || continue
  echo "removing leftover image: $tag"
  docker rmi -f "$tag" >/dev/null || exit 1
  images_removed=$((images_removed + 1))
done < <(docker images --format '{{.Repository}}:{{.Tag}}' --filter 'reference=epgstation-docker-check-*')
echo "leftover images removed: $images_removed"
