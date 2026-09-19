# Upstream Migration Record

Source repository: https://github.com/chatfire-AI/huobao-drama.git
Source commit: f04d705603bd0257bcec6b8f44fd04ea3ea9b795

| Target file | Upstream file and symbol | Preserved structure | Platform adaptation | Regression test |
| --- | --- | --- | --- | --- |
| docker-compose.local.yml | docker-compose.yml: services, healthcheck, restart, volumes | Compose service declaration, healthcheck and restart conventions | Replaced MySQL and huobao-drama service with PostgreSQL 16, Redis 7 and a fixed MinIO image; uses Compose name `alchemy-video-local`, host ports 15432/6380/9002/9003, and named volumes only. Container ports remain 5432/6379/9000/9001 per ADR-0012. | docker compose -f infrastructure/compose/docker-compose.local.yml config; docker compose ... up -d; docker compose ... ps |

No upstream database, application service, local data bind mount, workspace mount, credential or provider configuration was migrated.
