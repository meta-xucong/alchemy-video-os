# VPS adapter

This adapter is for a full-stack Video OS running on the Video VPS. It does
not use the developer workstation, a reverse SSH relay, or a local file as a
runtime dependency. The local MVP remains under `infrastructure/local/` and
`infrastructure/compose/`.

The canonical VPS implementation is still under `infrastructure/deploy/`:

- Compose: `infrastructure/deploy/docker-compose.video.yml`
- Private env example: `infrastructure/deploy/.env.video.example`
- Edge configs and Dockerfiles: `infrastructure/deploy/`
- Deployment and real-Provider gates: `infrastructure/deploy/README.md`

The canonical Compose stack also includes private `media-runtime` and
`control-media-runtime` services. They are separate containers addressed only
through Compose DNS (`media-runtime:3433` and `control-media-runtime:3433`),
with no host ports and no shared `service:` network namespace. Their internal
readiness checks gate the production worker and Control API; AUTO Pixabay
import therefore remains private without coupling a Runtime process to its
caller.

This directory deliberately contains no copied Compose, Nginx, or environment
template. See [`compose/README.md`](compose/README.md) for the synchronization
rule.

## Private inputs

The wrapper defaults to `/opt/alchemy-video/secrets/video.env`. Keep that file
outside the checkout and populate it from the canonical example using private,
operator-chosen values. Do not put passwords, signing keys, Provider keys,
Veyra tokens, certificates, or htpasswd files in Git.

The private env path may be overridden only when the operator has an equivalent
private layout. The Compose path is intentionally fixed to the canonical file
under `infrastructure/deploy/` so a second VPS definition cannot be selected:

```sh
VIDEO_ENV_FILE=/opt/alchemy-video/secrets/video.env \
  sh infrastructure/vps/scripts/compose-vps.sh config
```

The wrapper must be run from the repository root. It accepts the legacy
`docker-compose` binary used by the current Video VPS and the Docker Compose
plugin used by newer hosts; it does not change the canonical env defaults and
does not print environment contents.

## Safe commands

All commands below are run from the repository root. The wrapper selects the
canonical Compose file and the `edge` profile for the full-stack deployment.

```sh
# Validate interpolation and the canonical Compose model; does not start containers.
sh infrastructure/vps/scripts/compose-vps.sh config

# Build and start the full stack, including the edge service.
sh infrastructure/vps/scripts/compose-vps.sh up

# Show service state.
sh infrastructure/vps/scripts/compose-vps.sh ps

# Show the default application/edge logs (or name approved service names).
sh infrastructure/vps/scripts/compose-vps.sh logs
sh infrastructure/vps/scripts/compose-vps.sh logs control-api task-worker edge

# Recreate application-facing services only; data services are not targeted.
sh infrastructure/vps/scripts/compose-vps.sh restart-app

# Check that invalid provider-input HEAD and GET requests return empty 404s.
sh infrastructure/vps/scripts/compose-vps.sh smoke
```

`smoke` uses `VPS_ORIGIN` when set, otherwise
`https://video.aiself.vip`. It does not send a Provider request and does not
require an application login because the `/provider-input/` route is the
unauthenticated short-lived relay surface. A failure means the edge or Control
API route needs operator investigation; it does not authorize enabling a real
Provider.

The wrapper intentionally has no stop or volume-removal action. Do not use
`docker compose down` or `docker compose down -v` as an operational shortcut:
the canonical runbook requires retaining PostgreSQL, Redis, MinIO, TaskRun,
ProviderAttempt, and generated-asset state.

## Runtime boundaries

Only the Nginx edge is public. PostgreSQL, Redis, MinIO, Control API, Worker,
and Studio ports remain private to the Compose network as defined by the
canonical file. The adapter does not expose health endpoints, Provider
credentials, request IDs, object keys, or internal URLs.

`VIDEO_PROVIDER=mock` remains the default until the documented real-Provider
authorization, profile certification, TLS, private edge login, and Worker-only
secret checks have all passed. Veyra identity and shared-credit enablement are
independent later gates.

## Sources and change rule

This adapter adds no Provider, media, state-machine, or business logic. Its
paths, service names, profile selection, private env location, and invalid-token
check are thin operational references to:

- `doc/AI企业内容生产平台_VPS常驻化与去SSH隧道开发文档.md`
- `infrastructure/deploy/README.md`
- `infrastructure/deploy/docker-compose.video.yml`
- `infrastructure/deploy/.env.video.example`

When the canonical deployment package changes, update this adapter's references
and command examples in the same change. Never fork the Compose, Nginx, or env
contract here.
