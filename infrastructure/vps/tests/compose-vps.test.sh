#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd -P)
TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/compose-vps-test.XXXXXX")
trap 'rm -rf "$TEMP_ROOT"' EXIT HUP INT TERM

mkdir -p "$TEMP_ROOT/bin"
cat > "$TEMP_ROOT/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"

if [[ ${1:-} == compose && ${2:-} == version ]]; then
  exit 0
fi

if [[ ${1:-} == compose ]]; then
  shift
  while (($#)); do
    if [[ $1 == ps ]]; then
      shift
      [[ ${1:-} == -q ]] && shift
      service=${1:-}
      if [[ ${MOCK_MISSING_SERVICE:-} == "$service" ]]; then exit 0; fi
      printf 'container-%s\n' "$service"
      exit 0
    fi
    if [[ $1 == up ]]; then
      shift
      printf 'up %s\n' "$*" >> "$MOCK_DOCKER_LOG"
      exit 0
    fi
    shift
  done
  exit 0
fi

if [[ ${1:-} == inspect ]]; then
  shift
  [[ ${1:-} == --format ]] && shift
  format=${1:-}
  shift
  id=${1:-}
  service=${id#container-}
  if [[ $format == '{{.State.Status}}' ]]; then
    if [[ ${MOCK_STOPPED_SERVICE:-} == "$service" ]]; then printf 'exited\n'; else printf 'running\n'; fi
    exit 0
  fi
  if [[ $format == *com.docker.compose.project.working_dir* ]]; then
    working_dir=$MOCK_EXPECTED_WORKING_DIR
    compose_path=$MOCK_EXPECTED_COMPOSE_PATH
    if [[ ${MOCK_MISMATCH_SERVICE:-} == "$service" ]]; then working_dir=/old/release; fi
    if [[ ${MOCK_MISMATCH_COMPOSE_SERVICE:-} == "$service" ]]; then compose_path=/old/compose.yml; fi
    printf '%s|%s\n' "$working_dir" "$compose_path"
    exit 0
  fi
fi

exit 64
MOCK_DOCKER
chmod +x "$TEMP_ROOT/bin/docker"
cat > "$TEMP_ROOT/bin/docker-compose" <<'MOCK_COMPOSE'
#!/usr/bin/env bash
set -euo pipefail
exec docker compose "$@"
MOCK_COMPOSE
chmod +x "$TEMP_ROOT/bin/docker-compose"

export PATH="$TEMP_ROOT/bin:$PATH"
export MOCK_DOCKER_LOG="$TEMP_ROOT/docker.log"
export MOCK_EXPECTED_COMPOSE_PATH="$REPO_ROOT/infrastructure/deploy/docker-compose.video.yml"
export MOCK_EXPECTED_WORKING_DIR="$(dirname "$MOCK_EXPECTED_COMPOSE_PATH")"
VIDEO_ENV_FILE="$TEMP_ROOT/video.env"
printf '%s\n' 'PRIVATE_SENTINEL=must-not-be-printed' > "$VIDEO_ENV_FILE"
export VIDEO_ENV_FILE
WRAPPER="$REPO_ROOT/infrastructure/vps/scripts/compose-vps.sh"
sh "$WRAPPER" restart-app >/dev/null
if ! grep -Fq 'up -d --build --no-deps --force-recreate control-api task-worker workflow-worker production-worker document-worker document-runtime media-runtime control-media-runtime studio-web edge' "$MOCK_DOCKER_LOG"; then
  printf '%s\n' 'restart-app did not rebuild/recreate the exact application service set.' >&2
  exit 1
fi
if grep -Eq 'up .* (postgres|redis|minio|migrate)( |$)' "$MOCK_DOCKER_LOG"; then
  printf '%s\n' 'restart-app unexpectedly targeted a data or migration service.' >&2
  exit 1
fi

sh "$WRAPPER" verify-app >/dev/null

if MOCK_MISMATCH_SERVICE=workflow-worker sh "$WRAPPER" verify-app >"$TEMP_ROOT/mixed.out" 2>&1; then
  printf '%s\n' 'verify-app accepted a mixed release directory.' >&2
  exit 1
fi
grep -Fq 'different Compose working directory: workflow-worker' "$TEMP_ROOT/mixed.out"

if MOCK_MISMATCH_COMPOSE_SERVICE=control-api sh "$WRAPPER" verify-app >"$TEMP_ROOT/wrong-compose.out" 2>&1; then
  printf '%s\n' 'verify-app accepted a different Compose config file.' >&2
  exit 1
fi
grep -Fq 'different Compose file: control-api' "$TEMP_ROOT/wrong-compose.out"

if MOCK_MISSING_SERVICE=production-worker sh "$WRAPPER" verify-app >"$TEMP_ROOT/missing.out" 2>&1; then
  printf '%s\n' 'verify-app accepted a missing application service.' >&2
  exit 1
fi
grep -Fq 'Application service is missing: production-worker' "$TEMP_ROOT/missing.out"

if grep -R -Fq 'PRIVATE_SENTINEL' "$TEMP_ROOT"/mixed.out "$TEMP_ROOT"/wrong-compose.out "$TEMP_ROOT"/missing.out "$MOCK_DOCKER_LOG"; then
  printf '%s\n' 'The deployment wrapper leaked private environment content.' >&2
  exit 1
fi

printf '%s\n' 'compose-vps wrapper tests passed.'
