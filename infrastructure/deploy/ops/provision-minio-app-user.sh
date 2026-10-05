#!/usr/bin/env bash
set -euo pipefail

: "${MINIO_ALIAS:?Set MINIO_ALIAS to an mc alias authenticated as MinIO root/admin}"
: "${MINIO_ROOT_USER:?Set MINIO_ROOT_USER to the configured MinIO root username}"
: "${S3_BUCKET:?Set the exact application bucket name}"
: "${S3_ACCESS_KEY:?Set the dedicated application access key}"
: "${S3_SECRET_KEY:?Set the dedicated application secret key}"

mc_cmd() {
  env -i PATH="$PATH" HOME="${HOME:?HOME must be set}" MC_CONFIG_DIR="${MC_CONFIG_DIR:-$HOME/.mc}" mc "$@"
}

mc_version="$(mc_cmd --version 2>&1)"
[[ "$mc_version" == *"RELEASE.2025-08-13T08-35-41Z"* ]] || {
  echo "Use the tested MinIO client RELEASE.2025-08-13T08-35-41Z." >&2
  exit 2
}

if [[ ! "$S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "S3_BUCKET must be a lowercase 3-63 character bucket name." >&2
  exit 2
fi
if [[ "$S3_ACCESS_KEY" == "$MINIO_ROOT_USER" || ${#S3_SECRET_KEY} -lt 32 ]]; then
  echo "Use a non-root access key and a unique application secret of at least 32 characters." >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
policy_template="$script_dir/../minio/video-app-policy.json"
[[ -f "$policy_template" ]] || { echo "MinIO application policy template is missing." >&2; exit 2; }
policy_name="alchemy-video-app-$S3_BUCKET"
if mc_cmd admin user info "$MINIO_ALIAS" "$S3_ACCESS_KEY" >/dev/null 2>&1; then
  echo "Application user already exists; refusing to reuse an identity with unverified inherited/group policies." >&2
  exit 3
fi
if mc_cmd admin policy info "$MINIO_ALIAS" "$policy_name" >/dev/null 2>&1; then
  echo "Application policy already exists; inspect it and choose a fresh dedicated identity/policy before provisioning." >&2
  exit 3
fi

policy_file="$(mktemp)"
trap 'rm -f -- "$policy_file"' EXIT
sed "s/__S3_BUCKET__/$S3_BUCKET/g" "$policy_template" > "$policy_file"

umask 077
mc_cmd admin policy create "$MINIO_ALIAS" "$policy_name" "$policy_file" >/dev/null
mc_cmd admin user add "$MINIO_ALIAS" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc_cmd admin policy attach "$MINIO_ALIAS" "$policy_name" --user "$S3_ACCESS_KEY" >/dev/null
mc_cmd admin user policy "$MINIO_ALIAS" "$S3_ACCESS_KEY" >/dev/null

printf 'Configured new MinIO application user and bucket-scoped policy for %s.\n' "$S3_BUCKET"
