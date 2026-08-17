# AI 企业内容生产平台：正式开发总控文档

## 0. 文档状态

| 项目 | 内容 |
| --- | --- |
| 文档性质 | 开发基线、阶段门禁和审计总控文档 |
| 当前版本 | `0.1.0-local-baseline` |
| 当前阶段 | 开发前准备完成，等待建立 monorepo |
| 当前允许范围 | 本地 MVP、Mock Provider、离线契约测试 |
| 当前禁止范围 | 真实视频调用、真实共享积分、VPS、域名、生产部署 |
| 唯一长期架构参考 | `AI企业内容生产平台_代码实现与仓库整合详细方案.md` |
| 当前阶段唯一执行参考 | `AI企业内容生产平台_本地MVP执行规格.md` |
| 契约唯一参考 | `AI企业内容生产平台_领域模型与API事件契约.md` |
| 审计记录 | `AI企业内容生产平台_章节审计记录.md` |

本文件把“系统要做什么”转化为“先做什么、做到什么算完成、凭什么允许进入下一章”。每次开发只能处于一个 `IN_PROGRESS` 章节；前一章节没有达到 Exit Gate，不得把后一章节标记为完成。

## 1. 使用方式和优先级

每个章节都使用相同的开发记录结构：

1. 目标与非目标。
2. 前置条件。
3. 涉及模块和文件。
4. API、事件和数据变更。
5. 实现步骤。
6. 测试要求。
7. 验收标准。
8. 审计证据。
9. Exit Gate。

文档优先级：

1. 用户最新明确要求。
2. 根目录 `AGENTS.md`。
3. 本文件的阶段顺序和门禁。
4. `AI企业内容生产平台_领域模型与API事件契约.md` 的公共契约。
5. 当前章节引用的专项文档。
6. 长期方案和源仓库原始实现。

发生冲突时，先在“开发决策记录”中写明选择和原因，再修改受影响文档；不能只改代码绕过冲突。

## 2. 总体目标和范围

平台长期目标是让企业用户通过网页完成：企业资料导入、品牌上下文整理、脚本与分镜创作、参考资产绑定、AI 视频镜头生成、媒体处理、质量检查、审阅、版本化导出和用量审计。

所有视频创作能力统一遵循 `AI企业内容生产平台_通用叙事点与生成片段编排规范.md`：

```text
用户故事/素材
  -> NarrativeBeat（叙事点）
  -> GenerationSegment（实际生成片段）
  -> Video TaskRun
  -> Media Runtime 合成/QC
  -> VideoVersion（最终成片）
```

叙事点数量不等于真实 Provider 调用数量。一个生成片段才允许创建一个视频 TaskRun；多个叙事点可以在满足 Provider 时长、预算和连续性约束的前提下合并进一个生成片段。任何新题材、新 Provider、新前端入口或新媒体能力都必须沿用这条主链路，不能恢复“一个逻辑镜头一次真实调用”、字符切片或浏览器循环提交的旧模式。该规则由 ADR-0041 固化。

第一条可验证链路不是完整 Agent，而是：

```text
Dev Identity
  -> Workspace / Project
  -> Asset upload to MinIO
  -> Shot
  -> TaskRun
  -> BullMQ Worker
  -> MockVideoProvider
  -> validated MP4 Asset
  -> SSE + browser playback
```

长期能力分阶段加入：

| 阶段 | 能力 | 是否当前开工范围 |
| --- | --- | --- |
| A | 本地基础设施、契约、工作区、项目、资产 | 是 |
| B | TaskRun、Worker、Mock 视频闭环 | 是 |
| C | SUB2API 视频 adapter 离线契约 | A/B 通过后 |
| D | 真实 Grok/Seedance 能力认证 | 用户明确提供 Key 后 |
| E | 共享积分的本地端口、精度、幂等与离线契约 | Provider 认证后 |
| F | MarkItDown 企业资料 Runtime | MVP 稳定后 |
| G | Seedance Prompt Package、脚本、分镜 | 资料链路稳定后 |
| H | OpenMontage 媒体 Runtime、QC、成片 | 单镜头稳定后 |
| I | VPS、域名、真实 Veyra 联动、生产部署、Codex 入口 | 所有本地章节验收后 |

## 3. 统一工程基线

### 3.1 规范目录

编码时采用以下目录名；旧文档中的 `apps/web`、`apps/api`、`apps/worker` 视为早期简称，正式实现统一使用下面的名称。

```text
apps/
  studio-web/                 Nuxt 3 前端
  control-api/                Hono Control API，唯一业务数据库写入口
workers/
  workflow-worker/            后续 Director/Script/Storyboard 状态机
  provider-worker/            视频 Provider 提交、轮询、下载和恢复
  prompt-worker/              后续 Prompt Compiler
  render-worker/              后续媒体渲染
  qc-worker/                  后续质量检查
services/
  document-runtime/           后续 Python + MarkItDown
  media-runtime/              后续 Python + OpenMontage 工具箱
packages/
  contracts/                  Zod、OpenAPI、JSON Schema、事件
  domain/                     纯领域模型、状态机、Ports
  persistence/                Drizzle、迁移、Repository
  provider-adapters/          Huobao/SUB2API 等 Provider adapter
  seedance-skill/             Seedance Skill 原文、manifest、compiler
  artifact-schemas/           OpenMontage Artifact 的平台 schema
  storage-client/             S3/MinIO、object key、签名 URL
  credit-veyra/               Veyra CreditPort，后续启用
  observability/              trace、日志、outbox、审计
  test-fixtures/              Mock、契约和媒体 fixtures
upstream/                     固定 commit 的源仓库快照或 subtree
infrastructure/
  compose/                    本地 Compose
  postgres/
  redis/
  minio/
contracts/                    导出的 OpenAPI、AsyncAPI、JSON Schema
tests/
  unit/
  contract/
  integration/
  e2e/
doc/                          开发基线、专项规范和审计记录
```

### 3.2 命名层次

为兼顾 Huobao/Sub2API 的变量复用和平台自己的模块边界，采用四层命名规则：

| 层 | 规则 | 示例 |
| --- | --- | --- |
| TypeScript 变量/类型 | `camelCase` / `PascalCase` | `taskRunId`, `VideoGenerationRecord` |
| 平台 HTTP/Event JSON | `snake_case` | `task_run_id`, `provider_request_id` |
| PostgreSQL 列名 | `snake_case` | `workspace_id`, `created_at` |
| 外部 Provider payload | 保留上游原名 | `model`, `prompt`, `request_id`, `user_id` |

平台边界必须有显式 serializer/mapper，不能依靠散落在路由中的隐式重命名。Huobao 的 `VideoGenerationRecord` 保留为内部 Provider-compatible 类型，Control API 的公开 DTO 仍遵守平台 JSON 契约。

### 3.3 唯一控制面和通信方式

- Web 和未来 Codex CLI 只能调用 `/api/v1/*`。
- 服务间只能使用受保护的 `/internal/v1/*`、队列命令和 outbox 事件。
- Web 不得直连数据库、Redis、MinIO 管理 API、Provider 或 Veyra。
- Provider adapter 只实现 `VideoProviderPort`，不导入业务数据库和页面代码。
- Credit adapter 只实现 `CreditPort`，不接触 prompt、对象 URL 和视频 API Key。
- 模块不得通过另一个模块的数据库表、Redis key、文件目录或进程内变量通信。
- Control API 在事务内写业务数据和 outbox；Worker 通过持久化命令推进任务。

### 3.4 本地硬性默认值

```dotenv
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

本地 MVP 无真实视频 API Key、Veyra Token、域名或 VPS 依赖。真实开关缺失或不完整时，系统应失败关闭，不能隐式回退到外部服务。

## 4. 章节总览和依赖图

```mermaid
flowchart TD
  C0[第 0 章 文档与决策基线] --> C1[第 1 章 Monorepo 与本地基础设施]
  C1 --> C2[第 2 章 Contracts / Domain / Persistence]
  C2 --> C3[第 3 章 Control API 与 Dev Identity]
  C3 --> C4[第 4 章 Asset / Project / Shot 工作台]
  C2 --> C5[第 5 章 Queue / Outbox / Worker]
  C4 --> C5
  C5 --> C6[第 6 章 Mock 视频闭环]
  C6 --> C7[第 7 章 SUB2API 离线 Adapter]
  C7 --> C8[第 8 章 真实 Provider 能力认证]
  C8 --> C9[第 9 章 共享积分本地边界]
  C6 --> C10[第 10 章 MarkItDown 资料链路]
  C10 --> C11[第 11 章 Prompt / Script / Storyboard]
  C11 --> C12[第 12 章 OpenMontage / QC / 成片]
  C9 --> C13[第 13 章 发布前审计与部署准备]
  C12 --> C13
```

章节状态只允许：`PENDING`、`IN_PROGRESS`、`BLOCKED`、`READY_FOR_AUDIT`、`ACCEPTED`。状态变更写入 `AI企业内容生产平台_章节审计记录.md`。

## 5. 第 0 章：文档、决策和来源基线

### 5.1 目标与非目标

目标是让开发者无需再次猜测范围、目录、命名、来源、测试和密钥边界。非目标是写更多宏观愿景或提前部署。

### 5.2 前置条件

- 已阅读 `AGENTS.md` 和 `doc/` 下相关文档。
- 当前工作区中的文档已纳入本项目 `doc/`。
- 确认当前为学习/本地开发用途，不因许可证审查阻塞编码。

### 5.3 需要创建或确认的文件

- `AGENTS.md`
- `doc/AI企业内容生产平台_正式开发总控文档.md`
- `doc/AI企业内容生产平台_开发决策记录.md`
- `doc/AI企业内容生产平台_安全与密钥规则.md`
- `doc/AI企业内容生产平台_测试与验收策略.md`
- `doc/AI企业内容生产平台_第三方来源与复用登记.md`
- `doc/AI企业内容生产平台_章节审计记录.md`
- `.gitignore`、`.env.example`、`README.md`

### 5.4 实现步骤

1. 固定本总控文档为开发基线。
2. 确认目录、命名、事件和状态机约定。
3. 登记源仓库 commit、迁入文件、复用点和改动点。
4. 写下当前不做事项和真实调用门禁。

### 5.5 测试和验收

- 文档链接和引用文件全部存在。
- 目录名、事件名、状态名在文档中无未解释冲突。
- `AGENTS.md` 与本总控文档的硬规则一致。

### 5.6 审计证据和 Exit Gate

证据：决策记录、来源登记、文档检查输出、审计记录初始条目。全部存在后将第 0 章置为 `ACCEPTED`，才可创建源码目录。

## 6. 第 1 章：Monorepo 与本地基础设施

### 6.1 目标与非目标

目标是建立可重复启动的 pnpm monorepo 和 PostgreSQL、Redis、MinIO 本地依赖。非目标是接 Provider、Veyra、Python Runtime 或部署 VPS。

### 6.2 前置条件

- 第 0 章 `ACCEPTED`。
- Node.js、pnpm、Docker Desktop 可用。

### 6.3 涉及模块和文件

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
apps/studio-web/
apps/control-api/
packages/contracts/
packages/domain/
packages/persistence/
packages/storage-client/
infrastructure/compose/docker-compose.local.yml
.env.example
```

### 6.4 实现步骤

1. 创建 workspace 和最小 package。
2. 启动 PostgreSQL 16、Redis 7、MinIO。
3. 固定本地宿主端口：PostgreSQL `15432`、Redis `6380`、MinIO API `9002`、Console `9003`。Docker 容器内端口仍为 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`、Console `9001`；依据 ADR-0012，API `3032` 与 Web `3031` 不变。
4. 创建健康检查和根 README 的启动命令。
5. 把本地凭据写入 `.env.example`，不写真实凭据。

### 6.5 测试和验收

- `pnpm install --frozen-lockfile` 成功。
- `docker compose -f infrastructure/compose/docker-compose.local.yml config` 成功。
- PostgreSQL、Redis、MinIO healthcheck 均通过。
- API/Web package 可以被 workspace 识别，但可以暂时只提供 health endpoint。

### 6.6 审计证据和 Exit Gate

证据：Compose 文件、锁文件、启动日志、`README.md`、健康检查输出。所有本地服务可重复启动/停止后，第 1 章进入 `ACCEPTED`。

## 7. 第 2 章：Contracts、Domain 和 Persistence

### 7.1 目标与非目标

目标是把领域对象、状态机、HTTP DTO、事件、错误码和数据库迁移落成代码。非目标是编写页面和真实 Provider。

### 7.2 前置条件

- 第 1 章 `ACCEPTED`。
- 以 `AI企业内容生产平台_领域模型与API事件契约.md` 为唯一契约来源。

### 7.3 必须落地的模型

`users`、`workspaces`、`workspace_members`、`projects`、`assets`、`shots`、`reference_bindings`、`task_runs`、`provider_attempts`、`usage_records`、`outbox_events`、`command_deduplications`。

### 7.4 实现步骤

1. 在 `packages/contracts` 创建 Zod schema、错误码和事件类型。
2. 在 `packages/domain` 实现状态转换和不变量。
3. 在 `packages/persistence` 创建 Drizzle schema 和按章节迁移。
4. 为所有 workspace 资源加授权查询条件。
5. 创建 OpenAPI、AsyncAPI、JSON Schema 导出命令。
6. 写纯领域和契约测试。

### 7.5 测试和验收

- 所有状态迁移和非法迁移有测试。
- 同一个幂等键同请求可回放，不同请求体返回冲突。
- 金额使用十进制字符串/`numeric(18,8)`。
- 数据库迁移可从空库执行，表和索引符合契约。
- 导出的契约与 Zod schema 无漂移。

### 7.6 审计证据和 Exit Gate

证据：schema 文件、迁移 SQL、契约导出物、单测报告、数据库结构快照。没有未决字段和状态冲突时，第 2 章 `ACCEPTED`。

## 8. 第 3 章：Control API 与 Dev Identity

### 8.1 目标与非目标

目标是提供唯一控制面、开发身份和工作区权限。非目标是 SSO、登录票据和 Veyra。

### 8.2 API 范围

```text
GET  /api/v1/health
GET  /api/v1/me
GET  /api/v1/workspaces
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/:projectId
PATCH /api/v1/projects/:projectId
```

### 8.3 实现步骤

1. 实现 Hono app、统一 response/error middleware 和 `request_id`。
2. 实现 `DevIdentityAdapter`，固定 `usr_dev_owner` / `ws_dev_default`。
3. 实现 workspace member authorization。
4. 实现项目 CRUD、输入校验和命令幂等。
5. 给 Web 提供最小 API client。

### 8.4 测试和验收

- 未授权 workspace 资源返回 `WORKSPACE_FORBIDDEN`。
- 项目创建重复提交不会产生重复项目。
- 健康检查可区分 API 进程与依赖服务状态。
- API 不直接调用 Provider、Veyra 或 MinIO 管理接口。

### 8.5 审计证据和 Exit Gate

证据：路由清单、API contract test、授权测试、请求日志脱敏样例。网页可以稳定读取开发身份和项目后，第 3 章 `ACCEPTED`。

## 9. 第 4 章：Asset、Project、Shot 工作台

### 9.1 目标与非目标

目标是让用户通过 Web 上传资产、创建分镜、编辑生成参数。非目标是生成视频和文档解析。

### 9.2 API 范围

```text
POST /api/v1/projects/:projectId/assets/upload-requests
POST /api/v1/assets/:assetId/confirm-upload
GET  /api/v1/assets/:assetId/download-url
POST /api/v1/projects/:projectId/shots
PATCH /api/v1/shots/:shotId
```

### 9.3 实现步骤

1. 用服务端规则生成 object key 和 presigned URL。
2. 浏览器直传 MinIO，API 确认对象、MIME、大小和 hash。
3. 用 `Asset(kind=IMAGE|VIDEO|AUDIO|DOCUMENT, origin=USER_UPLOAD|GENERATED|DERIVED)` 统一媒体资产。
4. 创建 `Shot`、`ReferenceBinding` 和生成参数 snapshot。
5. 复用 Huobao 的媒体预览和工作台交互，但替换其业务模型和本地磁盘路径。

### 9.4 测试和验收

- 图片上传、刷新和预览闭环通过。
- 不能读取其他 workspace 的资产。
- 任意浏览器提交的对象 key 被忽略或拒绝。
- 分镜编辑不触发任务；修改后生成必须产生新的 `TaskRun` 输入 snapshot。

### 9.5 审计证据和 Exit Gate

证据：Playwright 上传/预览截图、对象 metadata、授权测试、Shot API contract test。用户能够创建项目、上传图片、创建分镜后，第 4 章 `ACCEPTED`。

## 10. 第 5 章：Outbox、Queue 和可恢复 Worker

### 10.1 目标与非目标

目标是把长任务从 HTTP 进程中移出，支持至少一次投递、去重、重试、死信和 Worker 重启恢复。非目标是 Provider 业务本身。

### 10.2 实现步骤

1. 在 Control API 的应用层实现事务创建 `TaskRun`、`CommandDeduplication` 和 `task_run.queued` outbox 的能力；不得在 C05 注册 TaskRun/generation 公开 HTTP 路由。
2. Relay 将 outbox 投递到 BullMQ。
3. Worker 领取 `task_run.queued`，在事务内持久化 `QUEUED -> RUNNING`、消费去重和 `task_run.started` outbox；重复消息为成功 no-op。
4. Relay 和 Worker 实现 retry/backoff、dead-letter 与 stale lease 恢复；Redis/BullMQ 仅是传递层，PostgreSQL 是 outbox/消费事实来源。
5. 任务消息携带 `event_id`、`workspace_id`、`task_run_id`、`attempt_no`、`correlation_id` 和输入 snapshot；Worker 以消息中的 `workspace_id` 约束 event、TaskRun 和消费记录的后续读取/更新。`event_consumptions` 必须持久化 `workspace_id`，以 `(workspace_id, event_id, consumer_name)` 作为账本身份，并以复合外键或可验证的同工作区事务完整性关联 outbox；不能把全局 `event_id` 唯一性作为工作区范围的替代。
6. ProviderAttempt、`provider_request_id`、提交、轮询和下载移至 C06；C05 不导入或调用任何 Provider。

### 10.3 测试和验收

- 队列重复投递只产生一次业务推进。
- Relay/Worker 在投递或消费中断后，过期 lease 可恢复且不会重复推进 TaskRun。
- 队列 transient 错误遵循 retry/backoff；到达上限时持久化 dead-letter，不把 Worker 故障伪装成业务成功。
- C05 不创建 ProviderAttempt、不会有 Provider request ID，也不会执行 submit；这些验证属于 C06。
- SSE 能从 outbox/事件记录恢复，不依赖页面内存。

### 10.4 审计证据和 Exit Gate

证据：PostgreSQL outbox/消费记录、Redis/BullMQ retry/dead-letter、Worker 重启恢复测试、TaskRun `QUEUED -> RUNNING` 时间线、SSE Last-Event-ID 回放和公开字段脱敏扫描。任务在无人打开网页时仍能由持久化 relay/Worker 正确推进后，第 5 章 `ACCEPTED`。

## 11. 第 6 章：Mock 视频生成闭环

### 11.1 目标与非目标

目标是无外部 Key 生成可播放 MP4，并验证整个 TaskRun/Asset/SSE 闭环。非目标是真实模型效果。

### 11.2 Provider 合约

```ts
interface VideoProviderPort {
  submit(input: VideoGenerationInput): Promise<ProviderSubmission>;
  getStatus(input: { providerRequestId: string }): Promise<ProviderStatus>;
  download(input: { providerRequestId: string }): Promise<ProviderDownload>;
}

type ProviderDownload = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  contentLength?: number;
};
```

Mock 规则：submit 返回 `mock_{taskRunId}`；第一次状态查询为 `PROCESSING`，第二次为 `SUCCEEDED`；成功复制固定 MP4 fixture；`MOCK_VIDEO_OUTCOME=failed` 验证失败路径。

### 11.3 实现步骤

1. 实现 `MockVideoProvider`。
2. 实现 `POST /api/v1/shots/:shotId/generations`。
3. Worker 执行提交、轮询、下载、ffprobe、SHA-256 和 Asset 写入。
4. 发送 `provider_attempt.submitted`、`task_run.progressed`、`task_run.succeeded`/`task_run.failed`。
5. Web 展示任务状态、事件和 `<video>` 播放。

### 11.4 测试和验收

- 浏览器从上传到播放 MP4 全链路通过。
- 刷新页面、关闭 Web、重启 Worker 不影响任务。
- 失败可见且可显式 retry。
- 没有任何真实网络调用和真实 Key 读取。

### 11.5 审计证据和 Exit Gate

证据：E2E 视频、任务状态时间线、事件 snapshot、MP4 SHA-256、ffprobe 输出、无网络测试。Mock 闭环通过后，第 6 章 `ACCEPTED`，这是本地 MVP 的第一处主要里程碑。

## 12. 第 7 章：SUB2API 离线 Adapter

### 12.1 目标与非目标

目标是把 `sub2api-video-mcp` 的协议转换为平台 ProviderPort，并在无网络下完成契约测试。非目标是实测 API 和共享积分。

### 12.2 固定外部协议

```text
POST /videos/generations
GET  /videos/{id}
GET  /videos/{id}/content
```

保留 `model`、`prompt`、`duration`、`resolution`、`ratio`、`image.image_url` 等上游字段。`id`/`request_id` 和 `status`/`state` 在真实认证前只能由 mapper 兼容读取，不能把未验证字段写死为已认证能力。

### 12.3 实现步骤

1. 创建 `Sub2ApiVideoProvider` 和可注入的 HTTP transport；下载端口必须返回流、实际 MIME 与可用时的长度 metadata。
2. 创建 request/response mapper 和错误归一化；Provider 失败必须携带内部 `code`、`retryable` 与 `stage`，以便 Worker 不把不可重试拒绝降级为通用暂不可用。已提交 request 的轮询 `429/503` 必须由 C06 delivery 恢复查询且不得终态化或重提。
3. 迁入脱敏 fixtures，加入 `CONTRACT-001` 至 `CONTRACT-008`。
4. 确保 API Key 只由 Worker 读取。
5. 更新 capability registry，但默认 profile 为 disabled。

### 12.4 测试、审计和 Exit Gate

必须通过：提交、图生字段、处理中、成功下载、失败、轮询 `429/503` 恢复查询且单次 submit、非法响应、脱敏和 ffprobe 测试。证据是 fixtures、mapper 测试报告、capability snapshot 和凭据扫描。无网络 CI 通过后，第 7 章 `ACCEPTED`。

## 13. 第 8 章：真实 Provider 能力认证

### 13.1 进入条件

- 第 7 章 `ACCEPTED`。
- 用户或审计员已记录当前 profile、允许的调用次数、额度上限和测试素材；任何未获记录的 profile、图生或 Seedance 参数保持禁止。
- Key 存于本地未提交环境，命令显式 `--live`。

### 13.2 实施步骤

1. 当前受限授权仅用 Grok 最短文生视频验证提交、轮询和下载。
2. 当前不得验证图生；任何单图生测试必须先取得独立 profile、次数、额度和素材授权。
3. 验证进程中止、短暂 poll/download 故障后的 GET-only 恢复查询，不得重复提交。
4. Seedance 的 model ID、字段、时长、比例和分辨率属于另一轮受控认证，禁止猜值或借用本轮额度。
5. 生成 hash-only 脱敏认证报告；capability snapshot 在独立审计和后续受控变更前保持 disabled。

### 13.3 Exit Gate

只有提交、轮询、下载、MIME、SHA-256 和 ffprobe 全通过，profile 才能标记 `CERTIFIED`。真实认证报告不能进入普通 CI，也不能把真实 request ID、Key、票据和签名 URL 提交到仓库。

## 14. 第 9 章：共享积分本地边界

### 14.1 进入条件

- 第 8 章目标 Provider 已认证。
- 已完成 fake server 契约测试。

### 14.2 固定原则

Sub2API 是余额和原子扣费的唯一权威；视频平台不复制账本。未来真实联动沿用：

```text
POST /api/veyra/internal/login-ticket/exchange
GET  /api/veyra/internal/users/{user_id}/account
POST /api/veyra/internal/billing/debit
Header: X-Veyra-Internal-Token
```

余额预检不是预授权。未来真实模式中，视频成功下载并验证后进入 `BILLING_PENDING`，以 `billing_rule_key + task_run_id` 扣费。`402` 为 `CREDIT_INSUFFICIENT`，`409` 为 `CREDIT_CONFLICT`；充值重试只能扣费，不能再次 submit 视频。真实登录、账户、debit、feature flag、VPS 与跨系统联动移至 C13-A，不属于 C09 的本地 Exit Gate。

### 14.2.1 C09-A：离线基础范围

C09-A 只建立可替换的内部 `CreditPort`、`NoopCreditAdapter`、注入式 Veyra transport 契约、精确十进制 mapper 与 usage receipt 幂等准备。adapter 不提供默认 HTTP client，不读取环境变量、Token 或 URL；fake transport/fake server 只在测试进程中使用。

本子阶段不装配 Worker、Control API 或 Studio，不新开公开 DTO、浏览器路由、队列消息或真实扣费。失败 envelope 的结构不变；为完整表达内部 Veyra mapper 的其他拒绝，既有应用错误码枚举可向后兼容地增加 `CREDIT_REJECTED`，但 C09-A 不新增会从公开路由产生该错误的运行时路径。`NoopCreditAdapter` 只表达本地 mock 的“计费不可用”，不得把 debit 伪装为成功；TaskRun 的既有状态图不在 C09-A 改动。`usage_records` 只作为外部扣费 receipt，需按 `(credit_provider, idempotency_key)` 唯一，不能成为余额账本。

### 14.2.2 C09-B：三 VPS 联动设计归档

C09-B 只保留 `AI企业内容生产平台_C09-B三VPS联动设计.md` 与 ADR-0032 所定义的设计、来源和验收矩阵。Video OS 必须作为与 Sub2API/Veyra、Alchemy 平级的第三台 VPS；三方不得共享数据库、JSONL、Cookie/session、对象存储、队列、进程内状态或服务 secret。`video` intent/target、private overlay/service identity、无 query ticket POST handoff、local session、billing attempt/recovery、feature flags 和 rollout/rollback 均已归入 C13-A 的后期受控实现，不在 C09 写代码或调用外部系统。

在 C13-A 获得测试用户、ticket/debit 次数、额度上限、素材、网络/VPS/DNS/TLS 变更和维护窗口的明确授权前，禁止读取凭据、真实 ticket exchange/account/debit、Provider 调用、SSH、部署或任何 flag 启用。

### 14.2.3 C09-C：受控真实视频运行时接入

仅在用户明确要求将已认证的 SUB2API 视频 profile 接入产品运行时后，允许在不触碰 Veyra、VPS、DNS、TLS 和部署的前提下实现 Worker 内的 HTTPS transport、Provider factory、Control API 内部快照策略和 Studio 的公开命令收敛。密钥和 base URL 只能由 Worker 读取；Control API 可读取非敏感的运行模式，但浏览器不得接收 Provider、模型、地址、密钥或原始 Provider 数据。

默认仍必须为 `VIDEO_PROVIDER=mock`。真实 mode 只能使用经过 C08 认证并在 ADR 中列明的精确基础参数范围。ADR-0034 已离线实现单张 `FIRST_FRAME` 与一至七张 `REFERENCE_SET` 的输入契约；ADR-0037 将用户可见且可保存的时长限定为 `1..15` 秒、清晰度限定为 `480p|720p`、比例限定为 `16:9`，未受控或超出范围的规格、缺失或不完整的 relay 配置、尾帧、混合模式、模型和任何 Seedance 能力必须在创建任务前明确拒绝。运行时装配、离线回归和受控本地启动不等于真实付费调用；每次真实 POST 仍需单独记录 profile、调用次数、费用上限和素材范围，且不得启动 Veyra 或部署工作。

图生与多参考素材扩展以 ADR-0034 和 `AI企业内容生产平台_C09-C图生与多参考素材适配设计.md` 为设计准入：首帧图生与独立参考图必须互斥；独立参考图按已声明契约可接受一至七张，且文档必须区分协议上限与已完成端到端验证的样本数。平台不以本地 4096 字节硬上限拒绝该路线，而由上游的安全归一化拒绝语义处理超长请求。已完成 `ReferenceDeliveryPort`、私有对象到短时 Provider HTTPS relay、公开 DTO 脱敏和 Worker 恢复的离线/Mock 验证；尚未部署公开 HTTPS relay，因此不能提前对用户图片发出真实 Provider 请求。

### 14.3 C09 Exit Gate

C09 只要求本地 `CreditPort`、`NoopCreditAdapter`、注入式 Veyra transport/mapper、精确金额、usage receipt 幂等准备、公开边界和离线/Mock 回归通过。C09 不能读取真实 Veyra 凭据、访问真实账户、执行 debit、启用 feature flag、SSH、部署或变更 VPS。真实 Veyra 的成功扣费、同 key 回放/冲突、余额不足、Token 错误、服务暂不可用、Worker 崩溃恢复、usage 唯一性和生产 rollout/rollback 均属于 C13-A 的 Exit Gate。

## 15. 第 10 章：MarkItDown 企业资料链路

### 15.1 目标与边界

将 PDF、DOCX、PPTX、XLSX 等已上传资料转换为可追溯 Markdown Artifact。MarkItDown 只做格式转换，不做知识库、事实判断或品牌画像。

### 15.2 实现步骤

1. 创建 `document-runtime` Python/FastAPI 内部服务。
2. 只接收 Control API 传来的已授权对象流。
3. 调用 `MarkItDown(...).convert_stream(stream, stream_info=StreamInfo(...))`。
4. 保存转换结果、warnings、converter 和来源 Asset 引用。
5. 后续再实现切块、Embedding、事实引用和 BrandProfileRevision。

### 15.3 测试和 Exit Gate

PDF/DOCX/PPTX/XLSX fixture 转换通过；`convert_stream` 不允许任意网络访问；结果可追溯到原始 Asset；错误可重试且不污染源资产。证据齐全后第 10 章 `ACCEPTED`。

## 16. 第 11 章：Prompt、Script 和 Storyboard

### 16.1 目标和复用

复用 Seedance Skill、Huobao storyboard 拆分思路和 OpenMontage Artifact schema，但使用平台自己的 revision、引用和审批模型。

### 16.2 实现步骤

1. 将 Skill 原文、manifest、capability 和 compiler 放入 `packages/seedance-skill`。
2. 定义 `PromptPackage`、`ScriptArtifact`、`ScenePlanArtifact` 版本 schema。
3. 实现 Workflow Worker 的显式状态机，而不是自由 Agent 直接推进数据库。
4. 让每个 Prompt/Script/Storyboard revision 绑定事实引用、参考资产和审批状态。
5. 输出可确认的 `ProductionRun` 计划；C12 的依赖调度器才可从已确认计划产生 `GenerateShotCommand` 并交给 Provider Worker。

长叙事采用 `AI企业内容生产平台_长叙事自动编排与连续成片设计.md` 的总览、`AI企业内容生产平台_长叙事后端领域与编排开发设计.md` 的后端边界，以及 `AI企业内容生产平台_长叙事前端项目工作台交互设计.md` 的页面边界。原文必须先成为 `CreativeBriefRevision`，再产生 `ScriptRevision` 与有序 `StoryboardRevision`；不得按字符数截断后直接循环创建视频任务。每个 `ShotSpec` 只承载一个可见叙事事件，并记录开始/结束状态、连续性约束、参考素材职责和能力范围内的建议时长。`ProductionRun` 记录整体计划和进度，但不取代单 Shot 的 `TaskRun`。

规划阶段只产生可审阅的结构化 Artifact，不能调用视频 Provider；C11 用户确认“开始制作完整视频”后只创建并冻结 `ProductionRun`，不创建或提交任何视频 TaskRun。C12 再按依赖图创建符合条件的 Shot 任务。长文规划需要独立、可认证的 `PlanningModelPort`，不能把视频 Provider 当作文本 Agent，也不能让自由 Agent 直接写数据库。当前 profile 的首帧与多参考图互斥、无已认证尾帧能力；任何视觉连续性降级必须在计划中可见，不能承诺帧级无缝衔接。

### 16.3 Exit Gate

用户可以确认脚本和分镜；分镜包含事实引用和 ReferenceBinding；PromptPackage 可被 schema 验证；已确认 ProductionRun 能追溯画像、脚本、分镜和 prompt 版本。长叙事 fixture 必须生成有序计划而非字数切片；计划确认前后均为零次视频提交，确认结果幂等且可追溯。逐段幂等提交与前序镜头/交接帧依赖阻塞属于 C12 Exit Gate。

## 17. 第 12 章：OpenMontage、QC 和成片

### 17.1 目标和边界

把 OpenMontage 作为受控 Media Runtime 工具箱，复用 `BaseTool`、`ToolResult`、`ToolRegistry`、媒体分析、拼接、字幕和 QC，不让自由 Agent 控制全局工程。

### 17.2 实现步骤

1. 迁移必要 Artifact schema 和工具。
2. 通过内部 API 接收明确工具名、输入 Asset 和参数。
3. 以 `ToolResult.artifacts` 转换为平台 Asset/Artifact DTO。
4. 实现视频抽帧、ffprobe、拼接、字幕和质量报告。
5. 支持 8-12 个镜头版本化合成，失败镜头可标记而不破坏全部工程。

对需要连续画面的长叙事，C12 从已接受镜头提取 `HandoffAsset`，在前序通过基础 QC 后才允许提交依赖它的后续镜头。当前 provider 只支持首帧或多参考图，不能混用且不支持已认证尾帧；因此视觉连续性必须通过交接帧、明确转场和最终合成逐层实现，不可描述为模型保证的逐帧连续。新的故事输入只能使用用户上传且已确认的素材；派生交接帧不得回流为新的多参考来源。合成不得丢弃来源音轨；对尚无语义级首尾衔接验收的边界，必须使用有界的画面/音频淡变并保持规划总时长。任何局部重做只能重算受影响镜头和依赖它的后续镜头，不能覆盖既有接受版本。

### 17.3 Exit Gate

成片 MP4 具备完整来源链；当来源片段有音轨时最终成片也有可解码音轨；未验证衔接边界有可追溯的受控转场；工具执行可审计、可重试、无任意本地目录访问；QC 报告能关联到镜头和版本；成片播放和下载通过。

## 18. 第 13 章：发布前审计和部署准备

### 18.1 C13-A：真实 Veyra 与 VPS 联动

C13-A 只在 C09、C10、C11、C12 全部 `ACCEPTED` 后开始。它接收 C09-B 的既有三 VPS 设计，实施并验证 Video OS 与 Sub2API/Veyra、Alchemy 的受控联动：`video` intent/target、私有 overlay/service identity、一次性 POST ticket handoff、host-only session、账户预检、产物验证后 debit、billing attempt/recovery、feature flag、限额和发布/回滚。

开始前必须有用户对测试用户、ticket/debit 次数、额度上限、素材范围、网络/VPS/DNS/TLS 变更和维护窗口的明确授权。C13-A 不得以本地离线测试或旧 Provider 成功视频推断真实 Veyra 权限、余额、扣费或跨 VPS 联动已经可用。

启动前置审计和授权清单以 `AI企业内容生产平台_C13-A真实联动启动前置审计与授权清单.md` 为准。该文件只允许整理 runbook、授权项、离线 fake 测试与默认 fail-closed 预检；在授权参数补齐前，不得读取 secret、SSH、发真实 HTTP、改 VPS/DNS/TLS 或开启真实 feature flag。

### 18.2 当前只准备，不执行部署

必须准备但当前不执行：VPS 资源、域名 DNS、反向代理、TLS、持久化卷、数据库备份/回滚、密钥注入、日志监控、限流、费用告警、Sub2API `video` intent 和权限配置。

### 18.3 发布前审计

- 依赖和第三方来源可追溯。
- 所有 secret scan、日志脱敏、workspace isolation 通过。
- 数据库迁移、回滚和备份恢复通过。
- Provider、Credit、Worker、Media Runtime 的失败和恢复路径通过。
- C13-A 的真实 Veyra 账户、扣费幂等、余额不足、故障恢复、三 VPS 边界、feature flag 与回滚演练通过。
- 真实 feature flags 默认关闭，域名不硬编码。

### 18.4 最终 Exit Gate

全部章节 `ACCEPTED`，审计记录完整，未关闭风险有责任人和处理计划，才可进入部署设计。域名和 VPS 工作另开部署任务，不能在本地开发任务中顺便执行。

## 19. 每章标准审计模板

每次章节完成必须在审计记录中填写：

```text
章节编号：Cxx
章节名称：
状态：IN_PROGRESS / READY_FOR_AUDIT / ACCEPTED / BLOCKED
实施日期：
实现提交或工作区快照：
修改文件：
新增 API / 事件 / 数据库变更：
测试命令：
测试结果：
验收证据路径：
未完成项：
风险与后续动作：
审计人：
Exit Gate 结论：
```

没有测试结果和证据路径的章节不得标记为 `ACCEPTED`。

## 20. 正式开工判定

本项目进入编码前必须满足：

- 文档基线和决策记录已落盘。
- 目录、命名、事件、状态机没有未解释冲突。
- `.gitignore`、`.env.example`、本地 Compose 和 README 已准备。
- 第 0 章和第 1 章的依赖工具可用。
- 真实 Provider、Veyra、VPS 和域名均保持关闭。

满足后，唯一允许的第一个编码任务是：**第 1 章 Monorepo 与本地基础设施**。不得从真实视频 API、共享积分或完整 Agent 开始。
