# AI 企业内容生产平台

这是一个学习用途的企业 AI 内容生产平台，目标是把企业资料、脚本、分镜、视频 Provider、媒体 Runtime、质量检查和版本化资产组织成可审计的模块化系统。

当前仓库的 C01（本地 monorepo 和 PostgreSQL/Redis/MinIO 基础设施）已由审计员确认为 `ACCEPTED`。ADR-0012 将 PostgreSQL 宿主端口定为 `15432`；C02（Contracts、Domain、Persistence）已通过独立审计，等待受限 Git 备份完成。默认使用 Mock Provider，不调用真实视频 API，不启用 Sub2API 共享积分，不操作 VPS 或域名。

## 开始阅读

1. [AGENTS.md](AGENTS.md)
2. [正式开发总控文档](doc/AI企业内容生产平台_正式开发总控文档.md)
3. [开发决策记录](doc/AI企业内容生产平台_开发决策记录.md)
4. [本地 MVP 执行规格](doc/AI企业内容生产平台_本地MVP执行规格.md)
5. [领域模型、API 与事件契约](doc/AI企业内容生产平台_领域模型与API事件契约.md)
6. [章节审计记录](doc/AI企业内容生产平台_章节审计记录.md)

## 当前状态

- C01.0 上游复用审计：已通过
- C01 Monorepo 与本地基础设施：`ACCEPTED`
- 应用源码：仅有 Control API 健康端点和 Studio 健康状态基座
- C02 Contracts、Domain、Persistence：`ACCEPTED`（等待 `c02-accepted` 备份复核）
- 真实视频 Key：不配置
- Veyra/共享积分：关闭
- VPS、域名和生产部署：延期

每个章节完成后必须在章节审计记录中写入测试命令、证据路径和 Exit Gate 结论。

C01 已通过审计并已备份为 `c01-accepted`。C02 已通过审计；主线现在只可执行 C02 的受限提交、推送和 `c02-accepted` 标签。备份复核前不得进入 C03。

## C01 Local Start

ADR-0012 规定宿主机端口为 PostgreSQL `15432`、Redis `6380`、MinIO API `9002`、MinIO Console `9003`。Docker 容器内仍使用 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`、Console `9001`；API 为 `3032`，Studio 为 `3031`。这是本机端口隔离，不改变容器间服务地址。

```powershell
pnpm install
pnpm infra:up
pnpm dev
```

`pnpm dev` starts the Control API on `3032` and rebuilds then starts the Studio's local Nuxt/Nitro server on `127.0.0.1:3031`. This is the C01 local runtime contract because `nuxt dev` is not responsive on the current Windows/Node 24 combination.

The local dependencies use PostgreSQL on 15432, Redis on 6380, MinIO API on 9002, and the MinIO console on 9003. The API health endpoint is http://127.0.0.1:3032/api/v1/health and the Studio runs at http://127.0.0.1:3031.

Before auditing C01, run:

```powershell
pnpm typecheck
pnpm test
docker compose -f infrastructure/compose/docker-compose.local.yml config
docker compose -f infrastructure/compose/docker-compose.local.yml ps
curl.exe --noproxy "*" http://127.0.0.1:3032/api/v1/health
curl.exe --noproxy "*" http://127.0.0.1:3031/
```

Stop the local dependencies with:

```powershell
pnpm infra:down
```

Use `Ctrl+C` in the `pnpm dev` terminal to stop the API and Studio processes.
