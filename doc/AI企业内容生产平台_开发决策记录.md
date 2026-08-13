# AI 企业内容生产平台：开发决策记录

本文件记录影响多个模块、目录、数据契约或外部接入的不可随意反转决策。普通实现细节不在此记录；需要修改已接受决策时，新增 ADR 条目，不覆盖原记录。

## 决策状态

| 状态 | 含义 |
| --- | --- |
| `PROPOSED` | 提议，尚未作为实现依据 |
| `ACCEPTED` | 当前开发基线，后续代码必须遵守 |
| `SUPERSEDED` | 已被新决策替代，保留用于审计 |
| `REJECTED` | 明确不采用 |

## ADR-0001：采用 TypeScript monorepo 作为控制面

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-12 |
| 范围 | 前端、Control API、Worker、Contracts、Domain |
| 决策 | 使用 pnpm workspace；Nuxt 3、Hono、Drizzle、BullMQ、Zod；Python 仅用于后续 MarkItDown/OpenMontage Runtime |
| 原因 | 前后端共享契约，复用 Huobao 技术骨架，减少 MVP 双运行时复杂度 |
| 影响 | Python 服务通过内部 API 接入，不直接共享数据库内部实现 |

## ADR-0002：Control API 是唯一业务数据库写入口

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | Web 和 Worker 不直接互相调用进程函数；业务写入由 Control API 或受控内部 API 完成；Worker 通过持久化 TaskRun 和 outbox 工作 |
| 原因 | 支持审计、重启恢复、未来 CLI 复用和模块替换 |
| 拒绝方案 | 复用 Huobao 的 Web 进程内 `processTask`、内存轮询和本地文件作为生产事实 |

## ADR-0003：统一目录使用正式运行面命名

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 使用 `apps/studio-web`、`apps/control-api`、`workers/provider-worker`、`packages/*`、`services/*`；早期文档中的 `apps/web`、`apps/api`、`apps/worker` 只作简称 |
| 原因 | 与长期整合方案和独立部署责任一致 |
| 影响 | 新代码、新测试和新文档不再使用旧简称作为真实路径 |

## ADR-0004：领域契约和外部 Provider 字段分层

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | TypeScript 内部使用 camelCase，平台 HTTP/Event/数据库使用 snake_case，外部 Provider payload 保留其原字段；边界通过 mapper/serializer 转换 |
| 原因 | 最大化复用 Huobao/SUB2API 字段，同时避免外部命名污染数据库和 API |
| 例子 | 内部 `taskRunId` -> 平台 JSON `task_run_id`；Provider `request_id` -> 内部持久化 `provider_request_id` |

## ADR-0005：TaskRun 是长任务唯一事实来源

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 所有异步生成、解析、渲染和 QC 都由 TaskRun、ProviderAttempt、OutboxEvent 和事件记录驱动 |
| 原因 | 进程重启、浏览器关闭、重复投递和上游轮询不能丢任务或重复提交 |
| 影响 | 页面 store、Redis 临时状态、OpenMontage `events.jsonl` 不能作为任务真相 |

## ADR-0006：资产使用对象存储，数据库保存可审计元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 本地使用 MinIO S3 API，媒体二进制不进入数据库；保存 object key、MIME、大小、SHA-256、版本和 workspace/project 关系 |
| 原因 | 使本地和未来 VPS 的存储边界一致，避免容器共享本地路径 |

## ADR-0007：本地默认 Mock，真实 Provider 显式开启

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | `VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false` 为本地默认；真实调用必须通过 capability 认证、显式开关和用户授权 |
| 原因 | 本地开发和 CI 不消耗外部额度、不暴露 Key、不依赖网络 |

## ADR-0008：Sub2API 是共享余额唯一权威

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 不复制 Sub2API 用户、余额或扣费账本；只通过 CreditPort 调账户和扣费接口，并保存 usage receipt |
| 原因 | 保持余额、原子扣减、并发和幂等裁决只有一个权威 |
| 扣费时序 | 余额预检 -> Provider 产物验证 -> `BILLING_PENDING` -> 幂等扣费 -> 成功发布结果 |

## ADR-0009：学习用途不阻塞源码复用

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 当前仅用于学习和本地研究，不因参考仓库许可证阻塞实现；仍登记源仓库、commit、迁入文件和本地改动 |
| 未来条件 | 如果转为商用或公开分发，必须重新进行许可证、依赖和分发审查 |

## ADR-0010：部署与域名延期

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 当前不操作 VPS、DNS、HTTPS、生产 Sub2API、`video.aiself.vip` 或共享积分真实开关 |
| 原因 | 先在本地完成可审计的 MVP 和 Provider 契约，减少部署状态污染开发验证 |

## ADR-0011：C01 本机基础设施使用隔离宿主端口（已替代）

| 项目 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED` |
| 日期 | 2026-08-13 |
| 影响章节 | C01 |
| 上下文 | Windows 动态保留范围 `54239-54338` 包含原 PostgreSQL 宿主端口 `54329`；已有用户 Docker/WSL relay 使用 `6379`、`9000`、`9001`。这些服务不属于本项目，不能为 C01 停止或重配。 |
| 决策 | C01 宿主端口固定为 PostgreSQL `54350`、Redis `6380`、MinIO API `9002`、MinIO Console `9003`。Docker 网络内端口保持 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`、Console `9001`。Control API `3032` 与 Studio `3031` 不变。 |
| 考虑过的方案 | 释放原端口、修改其他项目容器、或对每次启动使用临时端口。 |
| 选择原因 | 非破坏性重映射不影响其他项目，规避 Windows 端口保留，且为本地开发提供稳定、可复现的连接信息。 |
| 影响 | Compose、`.env.example`、本地 MVP 规格、README 和 C01 审计记录必须使用新宿主端口；应用容器间连接继续使用服务名和容器内端口。 |
| 迁移/回滚 | 清理仅带有原 `compose` 项目标签且配置文件指向本仓库的旧 `Created` C01 容器，再使用顶层 Compose name `alchemy-video-local` 创建新容器。若未来端口再次冲突，新增 ADR 后再变更，禁止临时漂移。 |
| 审计证据 | 用户授权的端口重映射指令；C01 记录中的 Compose 启动、`pg_isready`、`redis-cli ping`、MinIO health 结果。 |
| 替代原因 | Windows 动态保留范围随后扩展至 `54339-54438`，覆盖了 PostgreSQL 宿主端口 `54350`；见 ADR-0012。 |

## ADR-0012：C01 PostgreSQL 使用 15432 隔离宿主端口

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C01 |
| 上下文 | ADR-0011 选择的 PostgreSQL 宿主端口 `54350` 后被 Windows 动态排除范围 `54339-54438` 覆盖，Docker 无法绑定。用户已授权以非破坏性方式最终修订 C01 端口，并确认 `15432` 未被占用且不在排除范围。 |
| 决策 | C01 宿主端口固定为 PostgreSQL `15432`、Redis `6380`、MinIO API `9002`、MinIO Console `9003`。Docker 网络内端口保持 PostgreSQL `5432`、Redis `6379`、MinIO API `9000`、Console `9001`。Control API `3032` 与 Studio `3031` 不变。 |
| 选择原因 | `15432` 避开当前 Windows 动态端口保留和其他项目容器，同时仅重建本项目 PostgreSQL 容器，不影响已健康的 C01 Redis 和 MinIO。 |
| 影响 | Compose、`.env.example`、本地 MVP 规格、正式总控文档、README、C01 审计记录和 Compose 来源说明都使用 `15432`；容器间服务地址和容器端口不变。 |
| 迁移/回滚 | 仅在 Docker 标签确认 `project=alchemy-video-local`、`service=postgres`、配置文件指向本仓库时，删除此前 `Created` 的 PostgreSQL 容器并按新映射重建。保留 Redis、MinIO、命名卷和其他 Compose 项目。后续若需变更端口，必须新增 ADR。 |
| 审计证据 | C01 记录中的新 Compose config、标签确认、端口监听、`pg_isready`、Redis/MinIO healthcheck、API/Web loopback 验证。 |

## ADR-0013：C01 Studio 使用可验证的本地 Nitro 启动契约

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C01 |
| 上下文 | 当前 Windows/Node `24.14.1` 与已解析 Nuxt `3.21.11` 组合下，原 `nuxt dev --port 3031` 会监听端口但在 30 秒内不返回 HTTP。正式总控要求 README 标准 `pnpm dev` 路径可重复启动、停止并提供可验证服务，不能把该失败隐藏在审计记录中。 |
| 决策 | Studio `dev` 脚本使用 `scripts/serve-local.mjs`：每次先构建现有 Nuxt 项目，再以 `HOST=127.0.0.1`、`PORT=3031` 启动其 Nuxt/Nitro Node 产物。根 `pnpm dev` 保持为并行启动 Studio 与 Control API，但不再调用无响应的 `nuxt dev`。 |
| 选择原因 | 保留 Nuxt 3 页面、客户端 `/api/v1` 边界、端口和 workspace 结构，以最小适配保证标准本地命令可实际响应 HTTP。 |
| 影响 | README、Studio package scripts、UPSTREAM 记录、回归测试与 C01 验收步骤必须说明本地 Nitro 启动器。此决策仅定义 C01 本机运行契约，不改变未来部署方式、业务路由、Provider、密钥或模块边界。 |
| 迁移/回滚 | 用 `pathToFileURL` 导入 Windows 绝对产物路径，避免 Node ESM `d:` URL 错误。若未来 Nuxt dev runtime 修复，可经新 ADR 恢复热更新模式；不得在没有可重复 HTTP 验证的情况下改回。 |
| 审计证据 | C01 记录中两次 `pnpm dev` 的 `curl.exe --noproxy "*"` API/Web HTTP 成功、进程树停止和端口释放证据。 |

## ADR-0014：TaskRun 状态机以领域契约的完整迁移图为准

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C02，以及未来 C04-C09 |
| 上下文 | `AGENTS.md` 5.2 的简写遗漏了领域契约已经定义的 `DOWNLOADING -> SUCCEEDED`、`FAILED -> QUEUED` 和 `QUEUED -> ABANDONED`。C02 的 Zod、领域和 PostgreSQL enum 已包含相关状态，领域代码已实现三条边，但文档规则、前向迁移和审计状态未形成可复核的一致基线。 |
| 决策 | `doc/AI企业内容生产平台_领域模型与API事件契约.md` 3.2 的迁移图是 TaskRun 的唯一完整合法边集合；`AGENTS.md` 5.2 同步为完整执行摘要。`DOWNLOADING -> SUCCEEDED` 仅用于本地 Mock 或未启用计费；`FAILED -> QUEUED` 是用户显式重试；`QUEUED -> ABANDONED` 仅表示尚未提交 Provider 的本地取消。 |
| 选择原因 | 保留无真实 Key 的本地闭环、可审计的显式用户重试和安全的提交前取消，同时保证领域、Zod、数据库和后续 Worker 使用同一状态机。 |
| 影响 | Zod 和 Drizzle enum 固定 11 个状态；领域迁移矩阵必须逐边测试；部分唯一索引只把 `SUCCEEDED`、`FAILED`、`ABANDONED` 视作已终止运行。C02 用新的前向迁移将已应用的本地数据库收敛到此索引定义，不能重写已有迁移。 |
| 迁移/回滚 | 新增仅向前的 Drizzle migration，先删除再以相同名称创建 `task_runs_one_active_shot_key`。任何未来状态变动必须新增 ADR、修改领域契约、生成 Zod 导出、创建前向迁移并补齐矩阵测试。 |
| 审计证据 | C02 的 Zod/领域/迁移一致性测试、空库迁移、现有本地库重放和索引谓词检查。 |

## ADR-0015：浏览器 SSE 与内部事件采用独立契约

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C02，以及未来 C03、C05、C06 |
| 上下文 | C02 审计发现公开 OpenAPI 曾把 `InternalEventEnvelope` 注册为 `/api/v1/events` 的 SSE payload，生成物因而暴露 `provider_request_id`。内部 outbox/队列需要 Provider 追踪字段，浏览器却不应接收这些字段。 |
| 决策 | 定义 `PublicWorkspaceEventEnvelope` 作为唯一浏览器 SSE DTO；OpenAPI 和公开 JSON Schema 只导出公开集合。`InternalEventEnvelope` 只由 AsyncAPI、outbox 和队列使用，允许其既有的内部 Provider 尝试事件。仅内部事件不投影到浏览器；公开任务详情中的尝试记录只暴露执行状态和时间，不暴露 Provider、模型、request ID 或原始 payload。公开状态把内部 `PROVIDER_PROCESSING` 归一为 `PROCESSING`，使公开契约不包含 Provider 词汇或身份。 |
| 选择原因 | 将同一业务变化的公开展示与内部诊断/恢复信息明确分层，避免浏览器、OpenAPI 代码生成器或未来 CLI 获得 Provider 传输细节，同时保留 Worker 恢复所需的内部审计。 |
| 影响 | C05 必须在 outbox relay 中实现显式内部事件到公开 SSE 投影；C03 的 HTTP handlers 只能序列化公开 DTO。所有公开 OpenAPI 路径及其可达 components 都要回归扫描 `provider_request_id`、`provider`、request/response payload、`object_key`、签名 URL query 和 Veyra 字段。 |
| 迁移/回滚 | 尚未实现浏览器 SSE handler 或已发布 API，因此无数据迁移。后续新增事件先定义内部事件，再决定是否需要一个字段更少的公开投影；不能复用内部 envelope。 |
| 审计证据 | Contracts 导出测试、公开 OpenAPI 全文敏感字段拒绝测试、AsyncAPI 内部字段存在性测试和生成物扫描。 |

## ADR-0016：C03 将项目列表作为显式工作区控制面读取

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C03 |
| 上下文 | 本地 MVP 执行规格要求项目“新建、重命名、列表、进入项目”，但此前 C03 路由清单和 HTTP 资源表只列出创建、详情和更新。页面若要显示项目，不能绕过 Control API 直接读取数据库。 |
| 决策 | 在 `/api/v1` 新增 `GET /projects`，返回当前身份默认工作区的 `Project[]`。该路径由相同的 workspace member authorization 保护，并使用 `ProjectListSuccess` 公开 DTO。 |
| 选择原因 | 用最小公开查询补齐已冻结 MVP 的项目列表能力，保持 Web -> Control API -> Persistence 的依赖方向和工作区隔离。 |
| 影响 | 更新领域 HTTP 表、C03 路由清单、Zod/OpenAPI/JSON Schema 生成物和 C03 contract tests；不新增资产、分镜、任务、事件或 Provider 行为。 |
| 迁移/回滚 | 无数据库迁移。若未来加入工作区选择，仍通过身份授权后的显式 workspace 上下文执行，不允许 Web 直连数据层。 |
| 审计证据 | C03 OpenAPI 导出、API workspace authorization 和项目列表回归测试。 |

## ADR-0017：C04 上传命令回放只固定资产身份，不持久化签名 URL

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C04，以及未来 C06/C10/C12 |
| 上下文 | `Idempotency-Key` 要求同一命令不得创建第二个 Asset；S3 预签名 URL 却短时有效，并且其 query 不能进入数据库、事件、日志或幂等快照。 |
| 决策 | 上传申请的幂等快照只保存公开 Asset 元数据。相同 scope、key、请求 hash 回放同一 `asset_id`；当 Asset 仍为 `PENDING_UPLOAD` 时，Control API 在响应阶段重新签发短时上传 URL。确认后的同键回放只返回同一 READY Asset，不再签发上传 URL。 |
| 选择原因 | 同时满足命令至多创建一个 Asset、浏览器可从中断中恢复上传、签名 URL 不被持久化，以及 READY 二进制不能被后续上传覆盖。 |
| 影响 | `command_deduplications.response_snapshot` 不得包含 upload/download URL、对象 key 或签名 query。上传 URL 仅作为本次公开 HTTP 响应的短生命周期字段；浏览器完成 PUT 后立即确认且不将 URL 写入状态存储。 |
| 迁移/回滚 | 无 schema 迁移。未来改为 multipart 或一次性令牌时仍必须把凭据从命令快照、日志和事件中隔离。 |
| 审计证据 | C04 API/仓储测试覆盖同键回放、READY 后不重签、不同 body 冲突，以及公开契约和日志的敏感字段扫描。 |

## ADR-0018：浏览器仅在受控响应中获得短时预签名 URL

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C04，以及未来 C06/C10/C12 |
| 上下文 | AGENTS 的“浏览器不得获得签名 URL query”表述与同一文件的“API 生成上传/下载签名 URL”、C04 HTTP 契约和本地 MVP 的浏览器直传要求冲突。 |
| 决策 | Control API 完成身份、workspace、Asset 状态与 object key 授权后，可在当前 HTTP 响应 body 中交付短时、单对象、单操作预签名 URL。URL 的签名 query 不是可持久化的公开 DTO 字段，不得进入 OpenAPI/JSON Schema、数据库、命令快照、事件、日志、错误消息或浏览器持久化状态。 |
| 选择原因 | 保留浏览器直传和短期下载能力，避免 API 代理大媒体，同时维持对象 key 与 S3 管理凭据的服务端边界。 |
| 影响 | `UploadRequestSchema` 和 `AssetDownloadUrlSchema` 只描述本次响应的 URL 字符串；契约导出测试继续拒绝 query 样例和内部 object key。Studio 只能在内存中立即消费 URL，刷新后必须重新向 Control API 申请。 |
| 迁移/回滚 | 无数据库迁移。若未来需要分片、CDN 或一次性令牌，仍通过 Control API 授权，不可扩大为长期公开对象路径。 |
| 审计证据 | C04 URL 生命周期、敏感字段/日志扫描、workspace 授权和 MinIO 集成测试。 |

## ADR-0019：C04 命令终态覆盖缺失确认与分镜位置冲突

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C04，以及未来所有 Control API 命令 |
| 上下文 | `confirm-upload` 若先在 API 层查不到 Asset 就直接返回 404，会绕开 `command_deduplications`；资源后来出现后，同 key 请求可能错误地变为成功。另一个问题是数据库 `shots_project_position_key` 会把重复位置抛成未映射的 PostgreSQL unique violation，而内存仓储此前允许重复。 |
| 决策 | 所有 C04 写命令先经仓储幂等裁决。`confirm-upload` 在找不到 Asset 时写入 `{kind: NOT_FOUND, status: 404}` 终态；同 key/同 body 永远回放 404，同 key/异 body返回 `409 IDEMPOTENCY_CONFLICT`。同一项目内 `Shot.position` 唯一，冲突显式映射为 `409 SHOT_POSITION_CONFLICT`，并写入 `{kind: POSITION_CONFLICT}` 终态。无效对象确认也写入独立 `INVALID_UPLOAD` 终态；存储不可用仍为可重试 `503`，不固定为终态。 |
| 选择原因 | 命令幂等必须覆盖业务失败结果，而不是仅覆盖成功。将数据库唯一约束转换为稳定应用错误，使内存和 PostgreSQL 仓储、HTTP 契约与 Studio 可得到相同行为。 |
| 影响 | `AssetWorkspaceStore` 的确认校验由 Control API 注入纯布尔验证函数，仓储先裁决重放/缺失，再只对首次 PENDING 资产调用验证并在同一命令事务中记录终态。此限制不引入 Provider、Worker、outbox 或事件。 |
| 迁移/回滚 | 无 schema 迁移，现有 `shots_project_position_key` 继续作为并发最终约束。Drizzle 代码同时在写入前检查并捕获该约束的唯一冲突，避免 500。 |
| 审计证据 | C04 内存、Control API 与真实 PostgreSQL 测试覆盖 missing-confirm 后资源出现仍回放 404、异 body 409、无效引用/位置冲突的终态重放与跨 workspace 隔离。 |

## ADR-0020：C04 确认上传的声明 MIME 信任边界

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C04；后续 C12 媒体 Runtime |
| 上下文 | C04 的确认命令校验预签名对象存在、对象存储报告的 MIME、声明的 MIME、大小和 SHA-256，但不在 Control API 中解码图片或提取媒体技术元数据。独立浏览器审计发现原 E2E 错误地把文本字节标为 `image/png`，从而产生破损预览。 |
| 决策 | C04 保持轻量确认边界：确认路径继续信任已授权上传请求中的声明 MIME 与对象存储 metadata，不增加图片解码或视频探测。E2E 固定使用内嵌的有效 1x1 PNG，并验证下载 MIME、PNG 签名、IHDR 宽高和字节完全一致，作为上传/刷新/预览闭环的有效浏览器夹具。 |
| 选择原因 | 将深度媒体解析留在 C12 的受控媒体 Runtime，避免 Control API 在 C04 引入格式解码器、临时文件生命周期或视频工具依赖；同时不再让无效伪造夹具掩盖 Studio `<img>` 预览问题。 |
| 风险 | 恶意或错误客户端仍可能上传与声明 MIME 不匹配的字节，导致其后续浏览器预览失败；C04 将其识别为可信 MIME 限制。C12 必须在媒体质量门中增加图片可解码性、尺寸提取及视频 `ffprobe` 校验，并为不符合项提供明确的 `DOWNLOAD_INVALID` 或后续媒体错误。 |
| 迁移/回滚 | 无数据库迁移。若 C12 将内容探测前移到确认链路，必须先扩展公开错误契约、异步处理和大文件资源限制，再修改 API 行为。 |
| 审计证据 | `apps/control-api/tests/c04-http-e2e.mjs` 以真实 PNG PUT 后确认并下载，校验 Content-Type、PNG 签名、IHDR `1x1` 和全量字节；独立浏览器应验证 Preview 的 `naturalWidth`/`naturalHeight` 均大于 0。 |

## 新决策模板

```text
## ADR-XXXX：标题

状态：PROPOSED / ACCEPTED / SUPERSEDED / REJECTED
日期：YYYY-MM-DD
影响章节：Cxx、Cyy

上下文：
决策：
考虑过的方案：
选择原因：
影响：
迁移/回滚：
审计证据：
```
