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

if [ ! -f "$COMPOSE_PATH" ]; then
  printf 'Canonical Compose file not found: %s\n' "$COMPOSE_PATH" >&2
  exit 2
fi

if [ ! -f "$VIDEO_ENV_FILE" ]; then
  printf 'Private env file not found: %s\n' "$VIDEO_ENV_FILE" >&2
  exit 2
fi

compose() {
  docker compose --env-file "$VIDEO_ENV_FILE" -f "$COMPOSE_PATH" --profile edge "$@"
}

is_service() {
  case "$1" in
    control-api|task-worker|workflow-worker|production-worker|document-worker|document-runtime|media-runtime|studio-web|edge)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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
    compose up -d --force-recreate control-api task-worker workflow-worker production-worker document-worker document-runtime media-runtime studio-web edge
    ;;
  smoke)
    [ "$#" -eq 0 ] || { printf '%s\n' 'smoke does not accept extra arguments.' >&2; exit 2; }
    smoke
    ;;
  *)
    printf '%s\n' 'Usage: compose-vps.sh {config|up|ps|logs|restart-app|smoke} [log-service ...]' >&2
    exit 2
    ;;
esac
