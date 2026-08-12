# AI 企业内容生产平台开发规则

## 1. 项目使命

本项目要建设一个面向企业的 AI 内容生产平台：用户通过网页创建项目、上传企业资料和媒体资产、形成品牌/内容上下文、生成脚本与分镜、调用视频模型生成镜头，再经过质量检查和媒体工具处理，最终形成可审阅、可追溯、可导出的内容资产。

平台不是四个参考仓库的简单拼接，也不是某一个仓库的改名版。参考仓库分别贡献能力：

- `huobao-drama`：前端产品骨架、Nuxt 3 页面组织、任务式交互和部分 Provider 调用思路。
- `Seedance-2.5`：Seedance 视频生成的参数组织、专业提示词策略、参考图/镜头约束和验证规则。
- `markitdown`：企业文档、PDF、表格、演示文稿等资料的安全转换入口。
- `OpenMontage`：结构化内容 Artifact、媒体分析、视频处理和质量检查工具。
- `sub2api-video-mcp`：SUB2API 视频接口的请求字段、提交/轮询/下载协议和 MCP 工具化经验。
- 本地 `sub2api` 与 `Alchemy Media Agent System`：Veyra 登录票据、账户查询、共享积分扣费和幂等语义的事实参考。

最终产品的核心原则是：**复用成熟能力，重新建立平台自己的领域模型、内部 API、事件、状态机、资产存储和审计边界。**

## 2. 必读文档

开始任何编码、重构、Provider 接入或部署工作前，必须先阅读 `doc/` 中与任务相关的文档。文档发生冲突时，优先级如下：

1. 用户最新明确要求。
2. 本文件 `AGENTS.md` 的硬性规则。
3. `doc/AI企业内容生产平台_领域模型与API事件契约.md` 的数据、状态和 API 契约。
4. `doc/AI企业内容生产平台_本地MVP执行规格.md` 的当前阶段范围。
5. 其他详细方案和专项规范。

建议阅读顺序：

1. `doc/AI企业内容生产平台_开发前文档准备清单.md`
2. `doc/AI企业内容生产平台_本地MVP执行规格.md`
3. `doc/AI企业内容生产平台_领域模型与API事件契约.md`
4. `doc/AI企业内容生产平台_代码实现与仓库整合详细方案.md`
5. `doc/AI企业内容生产平台_SUB2API视频能力认证与测试夹具规范.md`
6. `doc/AI企业内容生产平台_Sub2API与Alchemy共享积分适配规范.md`
7. `doc/AI企业内容生产平台_VPS与SUB2API视频接入补充方案.md`
8. `doc/AI企业内容生产平台_完整开发方案.md`

`VPS与SUB2API视频接入补充方案.md` 只在真实 Provider、VPS 或部署阶段阅读和执行；它不能覆盖本地 MVP 的范围限制。

正式开发顺序、章节依赖、每章 Exit Gate 和审计证据以 `doc/AI企业内容生产平台_正式开发总控文档.md` 为准。每次只能有一个章节处于 `IN_PROGRESS`；章节必须经过 `READY_FOR_AUDIT`，并在 `doc/AI企业内容生产平台_章节审计记录.md` 写入测试和证据后，才能变为 `ACCEPTED`。

如果实现需要修改公共字段、状态、事件或模块边界，先更新对应契约文档或新增 ADR，再写代码。代码与文档冲突时，不得默默选择一方并继续扩大改动范围。

### 2.1 学习用途与来源记录

按用户当前要求，本项目用于学习和本地研究，不以商用发布为当前目标；实现阶段不要因为参考仓库的许可证问题阻塞代码工作，也不要擅自进行许可证重构或替换依赖。

但每次复用外部代码仍应在适配模块、源码头部或 `THIRD_PARTY_NOTES.md` 中记录来源仓库、commit/tag、复用路径和本地修改点。不得把外部代码改名后声称为平台原创；未来如果转为商用或公开发布，必须重新进行许可证、依赖和分发审查。

## 3. 当前工作阶段

### 3.1 当前默认阶段：本地 MVP

除非用户明确切换阶段，所有工作都视为本地开发。当前目标是完成无外部密钥、无 VPS、无域名依赖的网页闭环：

1. 本地开发身份进入默认工作区。
2. 创建项目。
3. 上传并确认一张参考图片。
4. 创建和编辑一个分镜。
5. 提交视频生成任务。
6. 通过队列和 Worker 运行 Mock Provider。
7. 保存可播放 MP4、查询任务状态、接收 SSE 事件。
8. 刷新页面或重启 Worker 后仍能恢复状态。

本地默认配置必须满足：

```dotenv
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

本地默认不得访问真实 Seedance、Grok、SUB2API 视频 API，也不得读取或要求 API Key。Mock 任务应可确定性地产生成功、处理中和失败结果，并有固定 MP4 测试夹具。

### 3.2 后续阶段顺序

按以下顺序推进，不要跨阶段把多个高风险问题混在一次改动中：

1. **本地 MVP**：领域模型、Control API、Web、队列、Worker、MinIO、Mock Provider。
2. **离线 Provider 适配**：SUB2API adapter、字段 mapper、错误归一化、离线 fixtures。
3. **本地真实 Provider 验证**：只在用户提供 Key 并明确允许时执行；每个 profile 先认证再开放。
4. **共享积分适配**：Veyra 身份、账户查询、预检、成功后扣费和幂等审计。
5. **企业资料链路**：MarkItDown Runtime、文档 Artifact、品牌画像和检索。
6. **结构化创作链**：脚本、分镜、Prompt Compiler、角色与引用绑定。
7. **媒体 Runtime**：OpenMontage 受控工具、合成、字幕、QC 和导出。
8. **部署**：VPS、域名、HTTPS、密钥、备份、监控、限流和费用告警。

Codex/CLI 操作入口属于后期能力。实现时必须调用和网页相同的 Control API，不能通过 CLI 直接写数据库或绕过任务状态机。

## 4. 不可违反的架构规则

### 4.1 模块化和依赖方向

推荐目标结构：

```text
apps/web                  Nuxt 3 前端
apps/api                  Hono Control API
apps/worker               队列 Worker 和任务状态推进
packages/contracts        Zod DTO、错误码、事件和 OpenAPI/JSON Schema
packages/domain           实体、状态机、领域服务
packages/persistence      Drizzle schema、Repository、事务和迁移
packages/provider-video   VideoProviderPort 与 Provider adapters
packages/storage          S3/MinIO 资产读写和签名 URL
packages/credit-veyra     CreditPort 与未来 Veyra adapter
packages/observability    日志、trace、outbox relay 和审计
services/runtime-python   后续 MarkItDown/OpenMontage Python Runtime
```

依赖方向固定为：

```text
Web -> Control API -> Domain / Persistence / Contracts
Worker -> Domain / Persistence / Provider / Storage / Contracts
Python Runtime <-> Internal API -> Control API
Provider Adapter -> ProviderPort，仅可访问外部 Provider
Credit Adapter -> CreditPort，仅可访问 Sub2API Veyra 内部 API
```

必须遵守：

- Web 不得直连 PostgreSQL、Redis、MinIO 管理 API、视频 Provider 或 Veyra。
- Provider adapter 不得导入业务数据库、Nuxt、Agent 或页面代码。
- Credit adapter 不得读取 `prompt`、媒体 URL、视频密钥或项目表。
- Worker 不得由前端直接触发内部函数；只能消费持久化命令/事件并通过端口工作。
- Python Runtime 不得把本地工作目录、`events.jsonl`、Backlot 或临时文件当作平台事实来源。
- 模块间通过版本化 DTO、HTTP 内部 API、队列消息和 outbox 事件通信。
- 任何模块都不得读取另一个模块的数据库表、Redis key、对象存储路径或进程内变量作为 API 的替代品。

### 4.2 Control API 是唯一控制面

浏览器和未来 CLI 使用 `/api/v1/*`。服务间使用受保护的 `/internal/v1/*` 或队列事件。浏览器不得获得内部 API 地址、Provider 原生响应、内部对象 key、签名 URL query、Veyra Token 或任何 API Key。

API 负责：

- 身份和工作区权限校验。
- 命令幂等、事务、状态转换和 outbox 写入。
- 生成上传/下载签名 URL。
- 返回任务和资产的公开 DTO。

Worker 负责：

- 领取任务、提交/查询/恢复 Provider 任务。
- 持久化 `ProviderAttempt` 和原生响应脱敏摘要。
- 下载、校验、入库视频产物。
- 推进任务状态并发布事件。

### 4.3 数据和资产边界

- 所有有工作区归属的查询必须带 `workspace_id` 条件，不能查询后才补权限判断。
- ID 使用带实体前缀的 ULID，例如 `ws_`、`prj_`、`ast_`、`sht_`、`tsk_`、`att_`、`evt_`。
- 时间使用 UTC RFC 3339 毫秒时间；金额和积分使用 `numeric(18,8)` 与十进制字符串，禁止业务层使用二进制浮点计算金额。
- 媒体二进制放 S3/MinIO；数据库只保存元数据、对象 key、哈希、MIME、尺寸和版本关系。
- 对象 key 必须由服务端生成，至少包含 `workspace_id/project_id/asset_id`；浏览器不能提交任意对象 key。
- 预签名 URL 只短时有效，不能写入日志、事件、数据库审计或错误消息。
- 产物写入前检查 HTTP 状态、MIME、大小、SHA-256 和 `ffprobe`；失败的临时文件按生命周期清理。

## 5. 领域模型和状态机规则

### 5.1 核心实体

核心实体包括 `User`、`Workspace`、`Project`、`Asset`、`Shot`、`ReferenceBinding`、`TaskRun`、`ProviderAttempt`、`UsageRecord`、`OutboxEvent` 和 `CommandDeduplication`。

详细字段以 `doc/AI企业内容生产平台_领域模型与API事件契约.md` 为准。不要为了快速开发把多个实体压成一个 JSON 文件或把任务状态存到前端 store。

### 5.2 TaskRun 规则

合法状态包括：

```text
CREATED -> QUEUED -> RUNNING -> PROVIDER_PROCESSING -> DOWNLOADING
DOWNLOADING -> SUCCEEDED (本地 Mock 或未启用计费)
DOWNLOADING -> BILLING_PENDING -> SUCCEEDED
BILLING_PENDING -> BILLING_FAILED | RETRY_SCHEDULED
QUEUED -> FAILED | RETRY_SCHEDULED | ABANDONED
RUNNING -> FAILED | RETRY_SCHEDULED
PROVIDER_PROCESSING -> FAILED | RETRY_SCHEDULED
DOWNLOADING -> FAILED | RETRY_SCHEDULED
RETRY_SCHEDULED -> QUEUED
FAILED -> QUEUED (用户显式重试)
BILLING_FAILED -> BILLING_PENDING (充值后的显式扣费重试)
```

必须保证：

- `TaskRun.input_snapshot` 创建后不可变；修改分镜必须创建新运行。
- 一个分镜最多一个非终态运行。
- 得到 `provider_request_id` 后，Worker 重启只能恢复查询或下载，禁止重复 submit。
- 成功前不发布可下载结果；成功后结果资产不可被原地替换。
- `BILLING_FAILED` 后充值重试只能再次扣费，不能重复提交视频任务。
- `ABANDONED` 仅允许从尚未提交 Provider 的 `QUEUED` 进入；取消后属于终态。
- 非法状态迁移必须在领域层拒绝，不能只依赖 UI 禁用按钮。

## 6. API、事件和错误规则

### 6.1 HTTP

成功统一返回：

```json
{"data": {}, "request_id": "req_01J..."}
```

失败统一返回：

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "message": "The idempotency key was already used for a different command.",
    "retryable": false,
    "details": {}
  },
  "request_id": "req_01J..."
}
```

命令必须接受 `Idempotency-Key`。同一调用方、路径、键和请求体 hash 只能执行一次；相同键对应不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。

### 6.2 事件

事件必须使用统一 envelope，至少包括：

```ts
{
  event_id: string;
  event_type: string;
  occurred_at: string;
  trace_id: string;
  workspace_id: string;
  aggregate: { type: string; id: string };
  data: unknown;
  version: 1;
}
```

数据库事务内写入 outbox，事务外投递队列和 SSE。队列按至少一次投递设计，消费端按 `event_id` 去重。SSE 使用 `event_id` 作为 `id`，支持 `Last-Event-ID` 重连。事件字段只能向后兼容新增；删除或改变语义必须升版本。

浏览器 SSE 必须使用 `PublicWorkspaceEventEnvelope`，这是对持久化内部事件的受控投影。公开 SSE 不得含 `provider_request_id`、Provider 名称或模型、Provider request/response payload、`object_key`、签名 URL query、Veyra 字段、追踪或幂等内部元数据；`InternalEventEnvelope` 只用于 outbox、队列和内部 AsyncAPI。

禁止：

- 在 Redis pub/sub 中发布一个没有数据库事实记录的业务事件。
- 用日志文本代替事件。
- 让 Web 自己推断 Provider 状态或解析上游原始响应。
- 把密钥、Bearer Token、票据、签名 URL 或完整 Provider 响应原文放进事件。

### 6.3 应用错误码

外部错误统一归一化，例如：

```text
AUTH_UNAVAILABLE
AUTH_FORBIDDEN
CREDIT_INSUFFICIENT
CREDIT_CONFLICT
CREDIT_UNAVAILABLE
PROVIDER_UNAVAILABLE
PROVIDER_REJECTED
PROVIDER_PROTOCOL_INVALID
DOWNLOAD_INVALID
IDEMPOTENCY_CONFLICT
WORKSPACE_FORBIDDEN
```

前端只依赖应用错误码和 `retryable`，不依赖某个 Provider 的英文错误文案。

## 7. 参考仓库复用规则

### 7.1 复用原则

用户明确要求最大化利用原仓库代码、最大化复用变量，同时要求整体绝对模块化。执行时采用以下顺序：

1. 先定位参考仓库中的已有实现、类型、常量、校验器和测试。
2. 先复用原代码或做薄适配；只有当它与本平台边界冲突时才重写。
3. 把复用代码放入明确的 `adapters`、`runtime`、`skills` 或 `fixtures` 目录。
4. 保留稳定的外部字段名，内部通过 mapper 转换，不让外部仓库的全局状态渗透到领域层。
5. 每次复制或移植都补充来源、改动点、不可复用部分和回归测试记录。

### 7.2 各仓库边界

- **huobao-drama**：优先复用 Nuxt 3、页面组件、媒体预览、任务交互和 Provider 调用骨架。不得直接保留其公开短剧业务模型、前端 mock 数据、进程内轮询作为生产任务真相。
- **Seedance-2.5**：复用 Skill 文档、参数含义、提示词策略、参考绑定规则和校验脚本。必须编译为结构化 `PromptPackage`，不能把 Markdown 原文直接作为业务 API 响应或把时长/参考数量硬编码到页面。
- **markitdown**：复用 converter 自动选择、`convert_stream` 和标准化 Markdown 输出。服务端只接受已授权对象流；不得把用户传入 URI 直接交给 `convert_uri`，不得允许文档解析服务任意访问内网地址。
- **OpenMontage**：复用 Artifact Schema、`ToolRegistry`、`BaseTool`、`ToolResult`、媒体分析、抽帧、拼接和 QC 工具。只开放平台允许的工具；其 `project_dir`、`events.jsonl`、Backlot 和临时文件不是平台数据库。
- **sub2api-video-mcp**：复用 `POST /videos/generations`、状态查询、内容下载、`model/prompt/duration/resolution/ratio/image` 字段和轮询思路。MCP 只是调用方式参考，平台核心使用持久化 Worker 和 `VideoProviderPort`。
- **本地 sub2api**：复用 Veyra 内部路由、`data` 响应包装、Token Header、`402/409` 语义、原子扣费和请求指纹规则；不复制用户表、余额账本或扣费实现。
- **本地 Alchemy**：复用 `VeyraSub2APIClient` 的字段映射、账户查询、产物成功后扣费、billing rule 和 usage receipt 思路；不复用它的自签会话、JSONL 账本、图片固定费率或单体运行时状态。

## 8. SUB2API 视频和共享积分规则

### 8.1 视频 Provider

真实视频 Provider 只能通过 `VideoProviderPort` 接入：

```ts
interface VideoProviderPort {
  submit(input: VideoGenerationInput): Promise<ProviderSubmission>;
  getStatus(input: { providerRequestId: string }): Promise<ProviderStatus>;
  download(input: { providerRequestId: string }): Promise<ReadableStream>;
}
```

适配器必须：

- 只从 Worker 服务端环境读取视频 API Key。
- 支持提交、持久化 request ID、轮询恢复、流式下载和媒体校验。
- 将上游字段映射为平台 DTO，将状态和错误归一化。
- 对未知响应结构返回 `PROVIDER_PROTOCOL_INVALID`，不要猜测成功。
- 在未完成能力认证前，profile 只可作为禁用配置，不能从前端模型列表公开。
- 默认 `VIDEO_PROVIDER=mock`；真实调用必须由显式配置和用户授权触发。

### 8.2 共享积分

Sub2API 是余额、并发和扣费的唯一权威。视频平台不得：

- 自己维护可扣减余额。
- 通过“查询余额后更新本地余额”模拟扣费。
- 在 Provider 提交前直接扣费且没有明确补偿语义。
- 在视频成功重试时更换幂等键。
- 因 `402` 自动反复提交 Provider。

共享积分建议时序：

1. 任务创建/入队前查询账户余额，余额不足直接阻止提交。
2. 余额服务暂时不可用时，真实计费模式停在队列中重试；不能带着未知余额提交昂贵视频。
3. Provider 产物下载、MIME、SHA-256、`ffprobe` 均通过后进入 `BILLING_PENDING`。
4. 用 `billing_rule_key + task_run_id` 作为 `idempotency_key` 调用扣费。
5. 只有扣费成功或 `replayed=true` 才写 `UsageRecord` 并发布成功事件。
6. `402` 进入 `BILLING_FAILED`；用户充值后的重试只执行扣费，不重复生成。

Sub2API Veyra 当前接口事实：

```text
POST /api/veyra/internal/login-ticket/exchange
GET  /api/veyra/internal/users/{user_id}/account
POST /api/veyra/internal/billing/debit
Header: X-Veyra-Internal-Token
```

当前本地阶段不启用 `VeyraIdentityAdapter` 或真实 `CreditPort`。`NoopCreditAdapter` 只能用于本地 Mock，不得在真实计费开关打开时悄悄吞掉错误。

## 9. 密钥、隐私和安全

- 不把密钥写入代码、Markdown 示例的真实值、fixture、测试 snapshot、数据库、事件或日志。
- `.env.local`、认证报告、下载临时目录、MinIO 本地卷和测试输出加入 `.gitignore`。
- 浏览器只收到短期 presigned URL；不能拿到 S3 管理凭据或对象存储长期 URL。
- 外部用户 ID 只能用于 Veyra adapter；本地权限基于本地 `user_id` 与 `workspace_members`。
- 票据只由服务端消费一次；不得放入 localStorage、URL query、日志或错误消息。
- 外部文档只以已授权对象流进入 MarkItDown；禁止未经控制的网络访问和 SSRF。
- Provider 原生 payload 落库前脱敏；保留诊断所需的字段名、状态、错误 code 和 hash，不保留授权信息。
- 工作区隔离是每一个 Repository 查询的条件，不靠前端隐藏按钮实现。

## 10. 测试和验证

每次改动按风险选择测试范围，至少保持以下四层：

1. 领域单测：状态机、金额精度、引用绑定、错误归一化、幂等冲突。
2. 契约测试：HTTP DTO、事件 envelope、VideoProviderPort、CreditPort、脱敏。
3. 集成测试：PostgreSQL、Redis/BullMQ、MinIO、outbox、Worker 重启恢复。
4. E2E：项目、上传、分镜、生成、状态刷新、视频播放和失败重试。

必须覆盖：

- 同 `Idempotency-Key` 同请求返回原结果，不创建第二个任务。
- 同 key 不同请求体返回 `409`。
- 已拿到 `provider_request_id` 后 Worker 重启不重复 submit。
- Provider 成功但下载/ffprobe 失败时可以重试下载，不重复提交。
- Veyra `402` 映射 `CREDIT_INSUFFICIENT`，`409` 映射 `CREDIT_CONFLICT`。
- 同一扣费 key 重试只得到 `replayed=true`，本地只保留一条唯一 receipt。
- Web 不可访问任何 `/internal/*` API 或 Provider 原始凭据。
- Mock 模式在无网络、无真实 Key 时全量通过。

真实视频认证不进入普通 CI；使用 `doc/AI企业内容生产平台_SUB2API视频能力认证与测试夹具规范.md` 的离线夹具。真实调用前必须得到用户对 profile、调用次数和额度上限的明确授权。

## 11. 部署和外部系统规则

当前不得执行以下工作：

- 创建或修改 `video.aiself.vip`、DNS、反向代理、TLS 或生产路由。
- SSH 修改 VPS、重启生产服务、迁移生产数据库或改 Sub2API 配置。
- 在部署阶段之前开启真实 API Key、Veyra Token 或共享扣费。

部署阶段才处理 VPS、域名、HTTPS、持久化卷、数据库备份/回滚、密钥注入、监控、限流、费用告警，以及 Sub2API `video` intent、入口和 token 权限的配套修改。域名规划为与 `alchemy.aiself.vip` 平级的新入口，但本地代码不得硬编码域名。

## 12. 编码代理的工作方式

### 12.1 Git 备份治理

- `upstream/` 是本机仅用于溯源和摘取的目录，必须由 `.gitignore` 忽略；不得执行 `git add upstream`，不得作为 submodule 或 gitlink 纳入平台仓库。
- 章节处于 `IN_PROGRESS` 或 `READY_FOR_AUDIT` 时，只报告工作区差异、测试和审计证据；禁止 `git add`、提交、tag 和推送。
- 只有审计员确认该章节 Exit Gate 为 `ACCEPTED` 后，才可执行受限 `git add`（排除 `upstream/`、`.env*`、媒体、测试输出和本地卷）、创建 `feat(Cxx): ...` 提交、推送 `origin/main`，并标记 `cxx-accepted`。
- 提交前必须确认不包含真实 Key、ticket、签名 URL、媒体二进制、认证报告、测试输出或上游完整快照。
- 发现本地 HEAD、远端或工作区已存在的提交与当前指令不一致时，只报告差异；不得重写历史、强推、重置或擅自同步。

每次开始任务时：

1. 先读取本文件和相关 `doc/` 文档。
2. 检查工作区是否有用户未提交改动；不得覆盖、回滚或删除无关改动。
3. 用 `rg` 定位已有实现、类型、变量和测试，优先复用现有模式。
4. 先确定改动影响的契约、状态和模块，再编辑代码。
5. 对跨模块改动先补 schema、接口或事件定义，再实现双方。
6. 完成后运行与风险相称的测试，并报告未运行的测试和剩余风险。

编辑规范：

- 默认使用 ASCII；项目已有中文文档时可保留中文说明。
- 手工编辑使用 `apply_patch`；不要用 shell 重定向、内联脚本或 Python 写文件。
- 注释只解释复杂、不明显的决策，不写逐行翻译式注释。
- 不做无关格式化、依赖升级、文件移动或大范围重命名。
- 不使用破坏性 Git 命令，如 `git reset --hard`、`git checkout --`；除非用户明确要求。
- 发现与本任务重叠的用户改动时，先阅读并在其基础上工作；无法安全合并时再询问。

## 13. 需要向用户确认的情况

以下情况不能自行假设：

- 要改变本地 MVP 范围、公开 API、数据库状态或事件语义。
- 要引入一个会显著改变技术栈或目录边界的框架。
- 要执行真实 Provider 调用，但用户尚未明确 profile、次数、额度或测试素材。
- 要开启 `VEYRA_AUTH_ENABLED=true`、共享积分扣费或修改 Sub2API 侧协议。
- 要 SSH/VPS 操作、改域名、部署、重启服务或改生产数据。
- 发现用户已有改动与当前实现无法兼容。

普通编码任务不需要先等待确认；只要没有触及以上边界，就按文档直接实现、测试和交付。

## 14. 完成定义

一个功能只有同时满足以下条件才算完成：

- 代码位于正确模块，依赖方向没有反向穿透。
- 请求/响应、事件、状态转换和错误码有契约定义。
- 有针对性测试，必要时有集成或 E2E 验证。
- 日志、错误、事件和快照没有泄露密钥或私有对象信息。
- Worker 重启、重复请求和上游失败路径有明确行为。
- 文档中对应的范围、复用边界或部署状态已同步。
- 最终报告包含修改文件、验证命令、测试结果和未解决风险。
