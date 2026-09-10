# Video VPS Deployment Package

This package supports two explicit browser-auth modes for `video.aiself.vip`:

- private verification: `LOCAL_AUTH_MODE=dev`, `VEYRA_AUTH_ENABLED=false`, and the Basic Auth edge file;
- AISelf bridge: `VEYRA_AUTH_ENABLED=true`, the Video Portal handoff, and the Video OS `__Host-video_session` cookie. In this mode the application session replaces Basic Auth for browser routes; `VEYRA_CREDIT_ENABLED` is a separate switch and is only enabled for an authorized shared-credit canary.

The local defaults remain fail-closed and do not contact AISelf. The bridge follows the existing Alchemy flow: `https://aiself.vip/_veyra/return?target=video` issues a one-time ticket, the Portal POSTs it to `/auth/veyra/callback`, and Control API exchanges it through the private Veyra transport. Video OS never accepts a ticket in a URL query.

The only public unauthenticated surfaces are the short-lived opaque `/provider-input/<token>` relay used by the video Provider and presigned S3 object requests on `assets.video.aiself.vip`. Neither surface exposes an application session, object key, Provider credential, or MinIO Console.

## Required DNS and VPS

Use one new Video VPS only. Do not install this package on the existing Sub2API, Alchemy, ERP, website, relay, or agent hosts.

Before starting containers, point both records to that VPS:

```text
video.aiself.vip          A/AAAA -> Video VPS
assets.video.aiself.vip   A/AAAA -> Video VPS
```

Open only TCP `80`, `443`, and the VPS SSH administration port. PostgreSQL, Redis, MinIO API/Console, Control API, Worker, and Studio remain inside the Compose network.

## Relay-only local verification

Before the full Video OS is deployed, the Video VPS can be used as an isolated HTTPS
relay for the local real-provider worker. This mode does not start the Compose stack and
does not expose the local API, MinIO, Redis, or PostgreSQL ports. The relay edge is kept
in the separate `nginx/video.aiself.vip.relay.conf` file and proxies only
`/provider-input/` to `127.0.0.1:18080`; every other path returns `404`.

The current target host is Debian 12 at `43.251.227.106` (SSH `31467`, user
`shaihaoagent`). Its existing SSH policy now permits **remote TCP forwarding only** for
this account; agent forwarding, stream-local forwarding, and TUN remain disabled. The
local tunnel is:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -R 127.0.0.1:18080:127.0.0.1:3133 `
  shaihaoagent@43.251.227.106 -p 31467
```

The relay-only Nginx site and ACME webroot have been installed on the otherwise empty
host, but a trusted certificate cannot be issued until `video.aiself.vip` has an
authoritative `A` record pointing at `43.251.227.106`. Do not enable the full-stack
`video.aiself.vip.conf` on this host until the complete Video OS deployment gate is
accepted. The relay path is intentionally HTTP-only until Certbot succeeds; real
reference-image requests must remain disabled until HTTPS is active.

## Private Environment

1. Copy `.env.video.example` to a root-owned private directory outside this Git checkout, for example `/opt/alchemy-video/secrets/video.env`.
2. Replace every placeholder with a unique value. Keep `AUDIO_FREE_ONLY=true` for the local MVP; workspace-owned READY MUSIC assets remain the only music source. Do not put the video Provider key in the Control API, and do not commit this file.
4. For private verification mode, create the Basic Auth file at the absolute `VIDEO_EDGE_HTPASSWD_FILE` path. Use an interactive command so the password is never written into shell history or deployment logs:

```sh
install -d -m 0700 /opt/alchemy-video/secrets
docker run --rm -it \
  -v /opt/alchemy-video/secrets:/out \
  --entrypoint htpasswd httpd:2.4-alpine \
  -c -B /out/video-users.htpasswd <your-browser-user>
```

Set owner to root and mode `0600` on `/opt/alchemy-video/secrets/video-users.htpasswd`. The browser user name and password are only the private verification login, not a Veyra identity. Do not use this file as the application login in AISelf bridge mode.

## TLS Bootstrap

The Compose default serves only ACME challenges over HTTP. Start it with the copied private environment and then request both certificates:

```sh
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml --profile edge up -d --build
docker run --rm \
  -v "$PWD/infrastructure/deploy/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/infrastructure/deploy/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d video.aiself.vip -d assets.video.aiself.vip --email <operations-email> --agree-tos --no-eff-email
```

Set `EDGE_NGINX_CONFIG=./nginx/video.aiself.vip.conf` in the private environment and recreate only the edge service:

```sh
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml --profile edge up -d --force-recreate edge
```

The same certificate must contain both host names because this package uses one renewal command. The active Compose mount is `infrastructure/deploy/certbot/conf`; if Certbot is run from a separate host directory, copy the resulting `conf` tree into that mount before recreating `edge`. The production deployment installs a daily `alchemy-video-renew.timer` which performs this copy and recreates `edge` after a successful renewal.

The edge container must be able to read the Basic Auth file. Keep the file root-owned with mode `0640` and grant read access to the container's Nginx UID (101); mode `0600` on the host makes Nginx return a misleading HTTP 500 because the mounted file is unreadable inside the container.

## Real Provider Gate

Keep `VIDEO_PROVIDER=mock` until all following checks pass:

1. Both HTTPS host names resolve to the new Video VPS and have valid certificates.
2. In private verification mode, the Basic Auth gate protects `https://video.aiself.vip/projects`; in AISelf bridge mode, the application returns an auth-required state and the Portal entry at `/auth/login` (with `/auth/veyra/login` retained as a compatibility alias) is the only login path. The Control API and MinIO Console have no published host port.
3. Browser upload succeeds through `https://assets.video.aiself.vip` and a single reference image can be read through the short-lived `/provider-input/` route without emitting token text in edge logs.
4. The Worker-only `SUB2API_VIDEO_BASE_URL` and `SUB2API_VIDEO_API_KEY` are stored in the private environment file. Control API, Studio, Git, and browser state must not contain them.
5. `REFERENCE_DELIVERY_SIGNING_KEY` is identical in Control API and Worker; `REFERENCE_DELIVERY_ORIGIN=https://video.aiself.vip`.
6. A current, bounded real-call authorization names `aiself-grok`, `grok-imagine-video-1.5`, the maximum manual submissions, the money cap, and allowed non-sensitive test material. A click on **开始生成视频** is then the only action that sends the POST to the Provider.

After those checks, change only `VIDEO_PROVIDER=sub2api` in the private environment and recreate `control-api` and `task-worker`. Do not restart database, Redis, MinIO, or the existing Sub2API/Alchemy services.

## AISelf bridge activation

Do not remove the Basic Auth edge gate until the following identity-only canary is ready:

1. Set `VEYRA_AUTH_ENABLED=true`, `VEYRA_CREDIT_ENABLED=false`, a unique `VIDEO_SESSION_SECRET`, the private `VIDEO_VEYRA_INTERNAL_TOKEN`, and `VIDEO_VEYRA_PORTAL_BASE_URL=https://aiself.vip`.
2. Ensure the Sub2API Portal has the allowlisted `video` target and points its `video_base_url` at `https://video.aiself.vip`.
3. Set `EDGE_NGINX_CONFIG=./nginx/video.aiself.vip.veyra.conf` to use the Veyra edge configuration without `auth_basic`; keep `video.aiself.vip.conf` as the Basic Auth rollback file. The `/auth/` location must proxy to Control API so the Portal POST reaches `/auth/veyra/callback`.
4. Verify one authorized account can enter through `https://video.aiself.vip/auth/login`, receives a `__Host-video_session` cookie, reads `/api/v1/me`, and can log out. A ticket in a query string, a missing/expired ticket, or an inactive account must fail closed.
5. Only after identity evidence is accepted may `VEYRA_CREDIT_ENABLED=true` be enabled. The Video OS service-fee rule is `VIDEO_BILLING_SURCHARGE_MULTIPLIER=0.20` plus `VIDEO_BILLING_FIXED_FEE=1`; `VIDEO_BILLING_MODEL_RATES_JSON` is an optional legacy/model-specific surcharge map, and a positive `VIDEO_BILLING_CHARGE_AMOUNT` remains only for the legacy fixed-price path. Dynamic billing reads the settled source row through the protected Sub2API Veyra usage endpoint and stays fail-closed until that endpoint is deployed. Because Sub2API already settles its own `actual_cost`, Video OS debits only the separate service fee and never debits the base amount again.

If any prerequisite is missing, keep Basic Auth and `VEYRA_AUTH_ENABLED=false`; do not expose an unauthenticated Studio surface.

## Operational Checks

```sh
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml config --quiet
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml ps
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml logs --tail=100 control-api task-worker edge
```

The deployed Control API must report the workspace music library as the default source. When no authorized READY MUSIC asset exists, AUTO may perform the single configured OpenMontage/Pixabay import through the private `control-media-runtime` sidecar; MANUAL and OFF never invoke that fallback. If the sidecar or token is unavailable, AUTO must report an actionable `PROVIDER_UNAVAILABLE` result rather than silently dropping music.

The two Media Runtime processes are private Compose services, not shared
network namespaces: `production-worker` calls `http://media-runtime:3433/` and
`control-api` calls `http://control-media-runtime:3433/`. Each Runtime binds
only inside the Compose network, publishes no host port, and exposes port
`3433` only for Compose DNS clients. `/internal/health/live` checks process
liveness and `/internal/health/ready` checks the configured local ffmpeg,
ffprobe, and Runtime token without calling a paid Provider. The worker and
Control API wait for their corresponding Runtime readiness before starting.

Health paths are intentionally internal diagnostics. Verify the browser experience only through `https://video.aiself.vip/projects` after Basic Auth. Do not expose `/internal/*`, database ports, MinIO Console, Worker logs, Provider URLs, Provider request IDs, signing tokens, or private environment files.

## Rollback

To stop new real submissions, set `VIDEO_PROVIDER=mock` and recreate `control-api` plus `task-worker`. Retain PostgreSQL, Redis, MinIO, TaskRuns, ProviderAttempts, and generated assets so an already submitted task can be inspected or recovered without a duplicate Provider submit.
