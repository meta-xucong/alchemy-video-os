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

## Private Environment

1. Copy `.env.video.example` to a root-owned private directory outside this Git checkout, for example `/opt/alchemy-video/secrets/video.env`.
2. Replace every `REPLACE_...` value with a unique random value. Do not copy a local `.env.local`, do not put a Provider key in the Control API, and do not commit this file.
3. Create the Basic Auth file at the absolute `VIDEO_EDGE_HTPASSWD_FILE` path. Use an interactive command so the password is never written into shell history or deployment logs:

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

The same certificate must contain both host names because this package uses one renewal command. Renew it with the same webroot mount and recreate `edge` after a successful renewal.

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

Health paths are intentionally internal diagnostics. Verify the browser experience only through `https://video.aiself.vip/projects` after Basic Auth. Do not expose `/internal/*`, database ports, MinIO Console, Worker logs, Provider URLs, Provider request IDs, signing tokens, or private environment files.

## Rollback

To stop new real submissions, set `VIDEO_PROVIDER=mock` and recreate `control-api` plus `task-worker`. Retain PostgreSQL, Redis, MinIO, TaskRuns, ProviderAttempts, and generated assets so an already submitted task can be inspected or recovered without a duplicate Provider submit.
