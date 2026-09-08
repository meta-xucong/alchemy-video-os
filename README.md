# AI 企业内容生产平台

这是一个学习用途的企业 AI 内容生产平台，目标是把企业资料、脚本、分镜、视频 Provider、媒体 Runtime、质量检查和版本化资产组织成可审计的模块化系统。

当前仓库的 C01 至 C11.2 本地范围已完成并有审计记录；C11.2“资料理解、事实包与按段检索”保持本地 `ACCEPTED`。当前 C12.4/C12.5 总体仍为 `IMPLEMENTED_PENDING_AUDIT`，现行自动旁白/native-first/Doubao 对照执行口径见[自动生成音频与视频匹配正式使用开发文档](doc/AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md)。历史记录中的 C12.7B `ACCEPTED` 只表示该历史本地闭环已审计，不代表完整媒体能力或外部系统已启用。

底层开发规则已经固化：只移植固定 commit 中参考仓库已有的代码、字段、参数、校验和流程，平台只做必要的薄壳适配；修改和删减必须以原仓库代码/文档/测试为参照并留有来源和回归证据，来源没有安全对应实现时保持禁用或 fail-closed。详见根目录 [AGENTS.md](AGENTS.md)、[ADR-0060](doc/AI企业内容生产平台_开发决策记录.md) 和当前[多源仓库逐项迁移矩阵与冲突审计开发方案](doc/AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md)。

## 开始阅读

1. [AGENTS.md](AGENTS.md)
2. [正式开发总控文档](doc/AI企业内容生产平台_正式开发总控文档.md)
3. [开发决策记录](doc/AI企业内容生产平台_开发决策记录.md)
4. [多源仓库逐项迁移矩阵与冲突审计开发方案](doc/AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md)
5. [本地 MVP 执行规格](doc/AI企业内容生产平台_本地MVP执行规格.md)
6. [领域模型、API 与事件契约](doc/AI企业内容生产平台_领域模型与API事件契约.md)
7. [章节审计记录](doc/AI企业内容生产平台_章节审计记录.md)
8. [C08 认证准备与测试矩阵](doc/AI企业内容生产平台_C08认证准备与测试矩阵.md)
9. [C09 上游复用矩阵](doc/AI企业内容生产平台_C09上游复用矩阵.md)
10. [冻结的 C12.4/C12.5 历史最小方案](doc/AI企业内容生产平台_C12.4-C12.5最小化源仓库适配修改方案.md)
11. [自动生成音频与视频匹配正式使用开发文档](doc/AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md)

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
- C09 Veyra 身份与共享积分本地边界：`ACCEPTED`；真实 Veyra 登录、余额、扣费和 VPS 联动明确后置至 C13-A
- C10/C11/C11.1 企业资料、规划与受控创作链路：本地范围已完成并按审计记录保持历史不变
- C11.2 资料理解、事实包与按段检索：`ACCEPTED`；真实本地 PostgreSQL/Redis/MinIO 链路、Studio/Worker 黑盒和公开边界已验证
- 历史 C12.7B 本地旁白质量闭环：`ACCEPTED`；不构成当前可继续开发后续 C12 子章节的授权
- C12.4/C12.5 连续旁白与音频编排：`IMPLEMENTED_PENDING_AUDIT`；仅本地 Mock/loopback，完整多源迁移矩阵、AudioPlan、approved full-track section windows、Studio 审批闭环与真实中文口音仍待审计
- 当前应用能力：开发身份、默认工作区、项目创建/列表/详情/更新、Asset 预签名上传/确认/下载、Shot/ReferenceBinding、Mock TaskRun/outbox/Worker、公开 SSE 回放与 Studio 可播放 MP4；真实 Aiself Grok/Doubao 仅在显式本机 profile 下装配，默认不启用
- 真实视频/TTS Key：只从未入库的本机环境读取，不写入仓库、日志、契约或前端；当前实际对照使用说明见最新开发文档
- Veyra/共享积分：关闭
- VPS、域名、Veyra、共享积分扣费和生产部署：明确关闭/延期；Aiself Grok 与 Doubao 本机对照仅按用户已给出的有界授权执行

本地默认配置必须保持：

```dotenv
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

历史章节的 `ACCEPTED` 或 `READY_FOR_AUDIT` 记录仅是审计状态，不是接触外部系统的授权。C12.4/C12.5 在完整 Exit Gate 和独立审计确认前不得标记 `ACCEPTED`；默认本地 CI 不调用真实 Provider/TTS，只有最新开发文档明确授权的本机 Aiself Grok/Doubao 对照例外，Veyra、共享积分、VPS、DNS、部署、付费扣费和 Git 写入仍不得执行。

每个章节完成后必须在章节审计记录中写入测试命令、证据路径和 Exit Gate 结论。

C01 至 C11.2 的本地范围均以正式总控和章节审计记录为准；当前只允许按最新开发文档收口 C12.4/C12.5，不得借历史章节状态开启其他章节或外部系统。真实 Aiself Grok/Doubao 仅限已授权的本机茅山对照；Veyra/VPS/Git 边界继续关闭；既有用户 `.env.example` 改动不属于任何章节暂存范围。

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
