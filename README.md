# AI 企业内容生产平台

这是一个学习用途的企业 AI 内容生产平台，目标是把企业资料、脚本、分镜、视频 Provider、媒体 Runtime、质量检查和版本化资产组织成可审计的模块化系统。

当前仓库的 C01（本地 monorepo 和 PostgreSQL/Redis/MinIO 基础设施）至 C08（真实 Provider 能力认证）均已通过审计并完成既定备份或受限裁定。C09（Veyra 身份与共享积分）的 C09-A 是唯一 `IN_PROGRESS` 章节：它只建立离线 CreditPort、精确金额、Veyra 响应归一化和 usage receipt 幂等准备，尚未装配真实身份、余额查询或扣费。

## 开始阅读

1. [AGENTS.md](AGENTS.md)
2. [正式开发总控文档](doc/AI企业内容生产平台_正式开发总控文档.md)
3. [开发决策记录](doc/AI企业内容生产平台_开发决策记录.md)
4. [本地 MVP 执行规格](doc/AI企业内容生产平台_本地MVP执行规格.md)
5. [领域模型、API 与事件契约](doc/AI企业内容生产平台_领域模型与API事件契约.md)
6. [章节审计记录](doc/AI企业内容生产平台_章节审计记录.md)
7. [C08 认证准备与测试矩阵](doc/AI企业内容生产平台_C08认证准备与测试矩阵.md)
8. [C09 上游复用矩阵](doc/AI企业内容生产平台_C09上游复用矩阵.md)

## 当前状态

- C01.0 上游复用审计：已通过
- C01 Monorepo 与本地基础设施：`ACCEPTED`
- C02 Contracts、Domain、Persistence：`ACCEPTED`（`c02-accepted` 已备份复核）
- C03 Control API 与 Dev Identity：`ACCEPTED`（已完成备份复核）
- C04 Asset、Project、Shot 工作台：`ACCEPTED`（`c04-accepted` 远端备份复核通过）
- C05 Outbox、Queue 和 Worker：`ACCEPTED`（`c05-accepted` 远端备份已复核）
- C06 Mock 视频生成闭环：`ACCEPTED`；共享测试隔离、Worker `17/17`、Studio failure/retry E2E、根 `82/82`、迁移和基础设施健康均已独立复验，远端备份已复核
- C07 SUB2API 离线 Adapter：`ACCEPTED`；`origin/main` 与 `c07-accepted^{}` 均已复核为 `41d414cf1b6767c39f251445278831328e1620cf`
- C08 真实 Provider 能力认证：`ACCEPTED`（ADR-0030 受限裁定）；真实 capability/profile 仍默认 disabled，未装配进 Worker、API 或 Studio
- C09 Veyra 身份与共享积分（C09-A 离线基础）：`IN_PROGRESS`；内部 CreditPort、injected fake transport、精确金额和 provider-scoped usage receipt 已完成本地验证，等待审计复审
- 当前应用能力：开发身份、默认工作区、项目创建/列表/详情/更新、Asset 预签名上传/确认/下载、Shot/ReferenceBinding、Mock TaskRun/outbox/Worker、公开 SSE 回放与 Studio 可播放 MP4；真实 SUB2API Adapter 不在运行时装配
- 真实视频 Key：不配置
- Veyra/共享积分：关闭
- VPS、域名和生产部署：延期

每个章节完成后必须在章节审计记录中写入测试命令、证据路径和 Exit Gate 结论。

C01 至 C07 均已完成受限备份；C07 `c07-accepted^{}` 与 `origin/main` 已复核为 `41d414cf1b6767c39f251445278831328e1620cf`。C08 已按 ADR-0030 受限 `ACCEPTED`，但真实 profile 仍 disabled。C09-A 不读取 Veyra 凭据、不创建默认 HTTP transport、不访问外部网络，也不装配到 Worker、API 或 Studio；C10 或任何后续章节不得开始。既有用户 `.env.example` 改动不属于任何章节暂存范围。

## C01 Local Start

ADR-0012 规定宿主机端口为 PostgreSQL `15432`、Redis `6380`、MinIO API `9002`、MinIO Console `9003`。Docker 容器内仍使用 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`、Console `9001`；API 为 `3032`，Studio 为 `3031`。这是本机端口隔离，不改变容器间服务地址。

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm infra:up
pnpm dev
```

`pnpm dev` starts the Control API on `3032` and rebuilds then starts the Studio's local Nuxt/Nitro server on `127.0.0.1:3031`. The Control API requires a local `DATABASE_URL` from `.env.local` or its process environment; it does not silently use process-local memory. Studio forwards only public `/api/v1/**` requests. At runtime it reads `CONTROL_API_ORIGIN` from the Studio process, then falls back to Nuxt runtime config and `http://127.0.0.1:3032`; the browser never receives that upstream address. This is the local runtime contract because `nuxt dev` is not responsive on the current Windows/Node 24 combination.

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
