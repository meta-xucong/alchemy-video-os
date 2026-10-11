#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)

CALLER_ROOT=$(pwd -P)
if [ "$CALLER_ROOT" != "$REPO_ROOT" ]; then
  printf '%s\n' 'Run this wrapper from the repository root.' >&2
  exit 2
fi

cd "$REPO_ROOT"

VIDEO_ENV_FILE=${VIDEO_ENV_FILE:-/opt/alchemy-video/secrets/video.env}
VPS_ORIGIN=${VPS_ORIGIN:-https://video.aiself.vip}
LOG_TAIL=${LOG_TAIL:-100}

COMPOSE_PATH=$REPO_ROOT/infrastructure/deploy/docker-compose.video.yml

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_FLAVOR=legacy
elif docker compose version >/dev/null 2>&1; then
  COMPOSE_FLAVOR=plugin
else
  printf '%s\n' 'Neither docker-compose nor the Docker Compose plugin is available.' >&2
  exit 2
fi

if [ ! -f "$COMPOSE_PATH" ]; then
  printf 'Canonical Compose file not found: %s\n' "$COMPOSE_PATH" >&2
  exit 2
fi

if [ ! -f "$VIDEO_ENV_FILE" ]; then
  printf 'Private env file not found: %s\n' "$VIDEO_ENV_FILE" >&2
  exit 2
fi

compose() {
  if [ "$COMPOSE_FLAVOR" = legacy ]; then
    docker-compose --env-file "$VIDEO_ENV_FILE" -f "$COMPOSE_PATH" --profile edge "$@"
  else
    docker compose --env-file "$VIDEO_ENV_FILE" -f "$COMPOSE_PATH" --profile edge "$@"
  fi
}

is_service() {
  case "$1" in
    control-api|task-worker|workflow-worker|production-worker|document-worker|document-runtime|media-runtime|control-media-runtime|studio-web|edge)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

APP_SERVICES="control-api task-worker workflow-worker production-worker document-worker document-runtime media-runtime control-media-runtime studio-web edge"

verify_app() {
  expected_working_dir=$(dirname "$COMPOSE_PATH")
  expected_compose_path=$COMPOSE_PATH
  failed=0

  for service in $APP_SERVICES; do
    container_ids=$(compose ps -q "$service")
    if [ -z "$container_ids" ]; then
      printf 'Application service is missing: %s\n' "$service" >&2
      failed=1
      continue
    fi

    for container_id in $container_ids; do
      status=$(docker inspect --format '{{.State.Status}}' "$container_id")
      labels=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container_id")
      actual_working_dir=${labels%%|*}
      actual_compose_path=${labels#*|}
      if [ "$status" != running ]; then
        printf 'Application service is not running: %s\n' "$service" >&2
        failed=1
      fi
      if [ "$actual_working_dir" != "$expected_working_dir" ]; then
        printf 'Application service has a different Compose working directory: %s\n' "$service" >&2
        failed=1
      fi
      if [ "$actual_compose_path" != "$expected_compose_path" ]; then
        printf 'Application service has a different Compose file: %s\n' "$service" >&2
        failed=1
      fi
    done
  done

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  printf '%s\n' 'All application services are running from the same canonical Compose working directory and file.'
}

logs() {
  if [ "$#" -eq 0 ]; then
    compose logs --tail="$LOG_TAIL" control-api task-worker edge
    return
  fi

  for service in "$@"; do
    if ! is_service "$service"; then
      printf 'Unsupported log service: %s\n' "$service" >&2
      exit 2
    fi
  done
  compose logs --tail="$LOG_TAIL" "$@"
}

smoke() {
  smoke_root=${VPS_ORIGIN%/}/provider-input/__invalid__
  smoke_dir=$(mktemp -d "${TMPDIR:-/tmp}/alchemy-video-vps-smoke.XXXXXX")
  trap 'rm -rf "$smoke_dir"' EXIT HUP INT TERM

  head_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 --head "$smoke_root")
  head_status=$(printf '%s' "$head_status" | tr -d '[:space:]')
  if [ "$head_status" != 404 ]; then
    printf 'Invalid-token HEAD expected 404, got %s\n' "$head_status" >&2
    exit 1
  fi

  get_status=$(curl -sS -o "$smoke_dir/body" -w '%{http_code}' --max-time 30 "$smoke_root")
  get_status=$(printf '%s' "$get_status" | tr -d '[:space:]')
  body_bytes=$(wc -c < "$smoke_dir/body" | tr -d '[:space:]')
  if [ "$get_status" != 404 ] || [ "$body_bytes" != 0 ]; then
    printf 'Invalid-token GET expected empty 404, got status=%s bytes=%s\n' "$get_status" "$body_bytes" >&2
    exit 1
  fi

  printf '%s\n' 'Invalid-token HEAD/GET smoke passed (404, empty GET body).'
}

action=${1:-}
shift 2>/dev/null || true

case "$action" in
  config)
    [ "$#" -eq 0 ] || { printf '%s\n' 'config does not accept extra arguments.' >&2; exit 2; }
    compose config --quiet
    ;;
  up)
    [ "$#" -eq 0 ] || { printf '%s\n' 'up does not accept extra arguments.' >&2; exit 2; }
    compose up -d --build
    ;;
  ps)
    [ "$#" -eq 0 ] || { printf '%s\n' 'ps does not accept extra arguments.' >&2; exit 2; }
    compose ps
    ;;
  logs)
    logs "$@"
    ;;
  restart-app)
    [ "$#" -eq 0 ] || { printf '%s\n' 'restart-app does not accept extra arguments.' >&2; exit 2; }
    compose up -d --build --no-deps --force-recreate control-api task-worker workflow-worker production-worker document-worker document-runtime media-runtime control-media-runtime studio-web edge
    ;;
  verify-app)
    [ "$#" -eq 0 ] || { printf '%s\n' 'verify-app does not accept extra arguments.' >&2; exit 2; }
    verify_app
    ;;
  smoke)
    [ "$#" -eq 0 ] || { printf '%s\n' 'smoke does not accept extra arguments.' >&2; exit 2; }
    smoke
    ;;
  *)
    printf '%s\n' 'Usage: compose-vps.sh {config|up|ps|logs|restart-app|verify-app|smoke} [log-service ...]' >&2
    exit 2
    ;;
esac
