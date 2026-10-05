#!/usr/bin/env bash
set -euo pipefail

: "${MINIO_ALIAS:?MINIO_ALIAS must name an authenticated mc alias}"
: "${MINIO_BUCKET:?MINIO_BUCKET must be explicit}"
: "${BACKUP_DIR:?BACKUP_DIR must be an explicit backup directory}"
: "${CONFIRM_RESTORE:?set CONFIRM_RESTORE=I_UNDERSTAND_DATA_REPLACEMENT}"
[[ "$CONFIRM_RESTORE" == "I_UNDERSTAND_DATA_REPLACEMENT" ]] || { echo "restore confirmation invalid" >&2; exit 2; }
[[ -d "$BACKUP_DIR" ]] || { echo "backup directory not found" >&2; exit 2; }
if [[ -f "$BACKUP_DIR.sha256" ]]; then sha256sum --check "$BACKUP_DIR.sha256"; fi
mc mirror --overwrite "$BACKUP_DIR" "$MINIO_ALIAS/$MINIO_BUCKET"
echo "restored=$BACKUP_DIR"
