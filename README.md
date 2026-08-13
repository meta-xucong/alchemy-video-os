# AI 企业内容生产平台

这是一个学习用途的企业 AI 内容生产平台，目标是把企业资料、脚本、分镜、视频 Provider、媒体 Runtime、质量检查和版本化资产组织成可审计的模块化系统。

当前仓库的 C01（本地 monorepo 和 PostgreSQL/Redis/MinIO 基础设施）、C02（Contracts、Domain、Persistence）、C03（Control API 与 Dev Identity）、C04（Asset、Project、Shot 工作台）和 C05（Outbox、Queue 和 Worker）均已通过独立审计；C05 尚待受限 Git 备份。C05 不公开 generation 或 TaskRun HTTP 路由；该 API、Mock 视频闭环与 Provider 都属于 C06。默认使用 Mock 配置，不调用真实视频 API，不启用 Sub2API 共享积分。

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
- C02 Contracts、Domain、Persistence：`ACCEPTED`（`c02-accepted` 已备份复核）
- C03 Control API 与 Dev Identity：`ACCEPTED`（已完成备份复核）
- C04 Asset、Project、Shot 工作台：`ACCEPTED`（`c04-accepted` 远端备份复核通过）
- C05 Outbox、Queue 和 Worker：`ACCEPTED`（消费账本工作区范围纠偏已验证，待 `c05-accepted` 受限备份）
- 当前应用能力：开发身份、默认工作区、项目创建/列表/详情/更新、Asset 预签名上传/确认/下载、Shot/ReferenceBinding 与命令幂等；C05 已实现内部 TaskRun/outbox/Worker 能力和公开 SSE 回放，generation/TaskRun HTTP 路由仍等待 C06
- 真实视频 Key：不配置
- Veyra/共享积分：关闭
- VPS、域名和生产部署：延期

每个章节完成后必须在章节审计记录中写入测试命令、证据路径和 Exit Gate 结论。

C01 至 C04 均已完成受限备份。C05 已通过独立审计，仅授权主线执行 C05-only 的受限 `git add`、提交、推送和 `c05-accepted` tag；远端备份复核完成前不得启动 C06。

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
