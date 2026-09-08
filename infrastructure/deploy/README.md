# Video VPS Deployment Package

This package prepares a single private verification deployment for `video.aiself.vip`. It does not implement the future Veyra identity, shared-credit debit, Portal ticket, or public multi-user release. The current Control API has only `LOCAL_AUTH_MODE=dev`, so the edge configuration requires HTTP Basic Auth for every browser route until the C09-B identity work is accepted.

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
4. Create the Basic Auth file at the absolute `VIDEO_EDGE_HTPASSWD_FILE` path. Use an interactive command so the password is never written into shell history or deployment logs:

```sh
install -d -m 0700 /opt/alchemy-video/secrets
docker run --rm -it \
  -v /opt/alchemy-video/secrets:/out \
  --entrypoint htpasswd httpd:2.4-alpine \
  -c -B /out/video-users.htpasswd <your-browser-user>
```

Set owner to root and mode `0600` on `/opt/alchemy-video/secrets/video-users.htpasswd`. The browser user name and password are the private verification login, not a Veyra identity.

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
2. The Basic Auth gate protects `https://video.aiself.vip/projects`; the Control API and MinIO Console have no published host port.
3. Browser upload succeeds through `https://assets.video.aiself.vip` and a single reference image can be read through the short-lived `/provider-input/` route without emitting token text in edge logs.
4. The Worker-only `SUB2API_VIDEO_BASE_URL` and `SUB2API_VIDEO_API_KEY` are stored in the private environment file. Control API, Studio, Git, and browser state must not contain them.
5. `REFERENCE_DELIVERY_SIGNING_KEY` is identical in Control API and Worker; `REFERENCE_DELIVERY_ORIGIN=https://video.aiself.vip`.
6. A current, bounded real-call authorization names `aiself-grok`, `grok-imagine-video-1.5`, the maximum manual submissions, the money cap, and allowed non-sensitive test material. A click on **开始生成视频** is then the only action that sends the POST to the Provider.

After those checks, change only `VIDEO_PROVIDER=sub2api` in the private environment and recreate `control-api` and `task-worker`. Do not restart database, Redis, MinIO, or the existing Sub2API/Alchemy services.

## Operational Checks

```sh
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml config --quiet
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml ps
docker compose --env-file /opt/alchemy-video/secrets/video.env -f infrastructure/deploy/docker-compose.video.yml logs --tail=100 control-api task-worker edge
```

The deployed Control API must report the workspace music library as the default source. If no authorized READY MUSIC asset exists, AUTO/MANUAL requests must report an actionable unavailable result rather than silently adding external audio.

Health paths are intentionally internal diagnostics. Verify the browser experience only through `https://video.aiself.vip/projects` after Basic Auth. Do not expose `/internal/*`, database ports, MinIO Console, Worker logs, Provider URLs, Provider request IDs, signing tokens, or private environment files.

## Rollback

To stop new real submissions, set `VIDEO_PROVIDER=mock` and recreate `control-api` plus `task-worker`. Retain PostgreSQL, Redis, MinIO, TaskRuns, ProviderAttempts, and generated assets so an already submitted task can be inspected or recovered without a duplicate Provider submit.
