# Infrastructure entry points

This directory keeps the local development stack and the VPS deployment entry
points side by side. The VPS adapter is only an operations wrapper; it does not
replace or copy the canonical deployment package.

## Boundaries

- `local/` contains local start, restart, and verification helpers. Keep the
  local MVP independent of a VPS, DNS, TLS, SSH relay, or real Provider key.
- `compose/` contains the local Compose topology and its source notes.
- `deploy/` is the canonical full-stack Video VPS package. Its Compose file,
  private environment example, Nginx configuration, Dockerfiles, and deployment
  runbook remain the single source of truth for the VPS stack.
- `vps/` is a thin, safe VPS-facing entry point. It references `deploy/` by
  relative path and does not contain a second Compose file, Nginx file, or env
  template.
- `upstream/` is reserved for local source-retrieval material and must not be
  treated as a deployable application directory or committed to the platform
  repository.

## VPS entry point

From the repository root on the VPS, read [`vps/README.md`](vps/README.md) and
use [`vps/scripts/compose-vps.sh`](vps/scripts/compose-vps.sh). The wrapper
defaults to the private environment file
`/opt/alchemy-video/secrets/video.env` and delegates to
`deploy/docker-compose.video.yml`.

The private environment file, htpasswd file, certificates, Docker volumes, and
Provider credentials stay outside Git. The VPS adapter never enables a real
Provider or shared-credit flow by itself; those gates remain in the canonical
deployment documentation and the project authorization process.
