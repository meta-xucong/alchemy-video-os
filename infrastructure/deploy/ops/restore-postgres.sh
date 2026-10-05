#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be supplied by the secret manager}"
: "${BACKUP_FILE:?BACKUP_FILE must be an explicit dump file}"
if [[ "${CONFIRM_RESTORE:-}" != "I_UNDERSTAND_DATA_REPLACEMENT" ]]; then
  echo "set CONFIRM_RESTORE=I_UNDERSTAND_DATA_REPLACEMENT to restore; this replaces database contents" >&2
  exit 2
fi
[[ -f "$BACKUP_FILE" ]] || { echo "backup file not found" >&2; exit 2; }
if [[ -f "$BACKUP_FILE.sha256" ]]; then sha256sum --check "$BACKUP_FILE.sha256"; fi
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$BACKUP_FILE"
echo "restored=$BACKUP_FILE"
