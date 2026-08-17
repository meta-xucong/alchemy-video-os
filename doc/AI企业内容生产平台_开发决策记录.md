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

## ADR-0021：C05 的持久化 outbox、传递 Worker 与 C06 Provider 边界

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C05、C06 以及后续 Provider 章节 |
| 上下文 | 总控文档旧版 C05 步骤曾要求 Worker 创建 `ProviderAttempt(CREATED)` 并准备 Provider 轮询；最新章节授权明确禁止 C05 实现 Mock 视频闭环、任何 Provider、Provider 调用或真实凭据。若不先消除该冲突，Worker 的职责和审计范围无法稳定。 |
| 决策 | C05 只实现持久化 outbox、BullMQ 传递、数据库租约、至少一次消费去重、重试/backoff、dead-letter、stale lease 恢复，以及公开 SSE 的受控投影。C05 在 Control API 的应用层提供同一 PostgreSQL 事务内创建 `TaskRun(status=QUEUED)`、命令幂等快照和 `task_run.queued` 内部事件的能力，但不注册任何 TaskRun 或 generation 公开 HTTP 路由。Worker 对该事件在事务内将运行推进至 `RUNNING`、写入 `task_run.started` outbox 并记录消费完成；重复事件或已推进任务为成功 no-op。C05 不创建 `ProviderAttempt`，不导入或调用 `VideoProviderPort`，也不提交、轮询、下载或生成媒体。C06 才接管 `POST /api/v1/shots/:shot_id/generations`、TaskRun 公开读取/重试路由、`RUNNING` 后的 ProviderAttempt、Mock Provider、`provider_request_id` 和媒体闭环。 |
| 传递语义 | outbox row 以 `available_at`、`lease_owner`、`lease_expires_at`、`last_error`、`dead_lettered_at` 表达 relay 所有权。Relay 在数据库中领取事件，再以 `event_id` 为 BullMQ job id 投递；队列消息同时携带可信的 `workspace_id`，后续 event、TaskRun、消费和 dead-letter 写操作都以该工作区范围约束。仅在入队成功后标记 `published_at`。Relay 崩溃后的过期租约可重新领取。BullMQ 的 retry/backoff 只能减少传递失败，最终业务去重依赖 PostgreSQL 的 `(workspace_id, event_id, consumer_name)` 消费记录及 TaskRun 事务。 |
| 公开边界 | outbox payload 必须按 `InternalEventEnvelope` 校验。浏览器 SSE 只读取持久化事件并显式投影为 `PublicWorkspaceEventEnvelope`；未知或仅内部事件不发送，绝不转发 Provider、对象 key、签名 query、请求/响应 payload 或 Veyra 字段。`Last-Event-ID` 只从持久化事件序列恢复。 |
| 选择原因 | 将可恢复的传输层同易变的 Provider 业务拆开，满足 C05 的无人值守处理和重启恢复目标，同时保留 C06 对 Provider 侧效应的独立审计门。 |
| 迁移/回滚 | 新增仅向前的 Drizzle migration 扩展 outbox 与消费租约表；不重写 C02 migration。未来改变最大尝试次数、租约或消费者名称必须新增 ADR 和迁移，不得依赖 Redis key 作为事实来源。 |
| 审计证据 | C05 必须提供 PostgreSQL/Redis 集成测试：事务写入、重复消费只推进一次、租约过期恢复、relay retry/dead-letter、Worker 重启恢复、SSE Last-Event-ID 回放，以及公开 SSE 脱敏扫描。 |

## ADR-0022：C05 队列消息采用完整版本化 TaskRun DTO 并固定 workspace 权威边界

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C05，以及未来 C06 Worker 消费扩展 |
| 上下文 | 审计发现原 BullMQ job 只携带 `eventId`/`workspaceId`，无法在 Worker 重启、重复投递和诊断时证明任务、尝试、关联链路与冻结输入；消费事务还会在 envelope 校验前建立 consumption，并从 JSON payload 读取 workspace。 |
| 决策 | contracts 导出严格的 `InternalTaskRunQueueMessage`，版本为 `contract_version=1.0`，固定包含 `event_id`、`workspace_id`、`task_run_id`、`attempt_no`、`correlation_id` 和冻结 `input_snapshot`。Relay 只从已验证的 `task_run.queued` outbox event 构造该 DTO，BullMQ 入队和 Worker processor 两端均解析。数据库消费事务以 outbox row 的 `workspace_id` 与 queue message 的 `workspace_id` 作为唯一范围，并在建立 consumption 前核对 outbox row、event envelope、queue message 的 event/task/correlation/snapshot 全部一致；任一不一致只返回可重试结果，不推进 TaskRun、不完成 consumption。 |
| 选择原因 | 把可恢复诊断字段和安全边界固化为可生成、可测试的内部契约，避免任意 payload JSON 越过 workspace 范围；保持 PostgreSQL 为 outbox、消费和状态事实来源，Redis 只承担至少一次传递。 |
| 影响 | `packages/task-queue` 依赖 contracts；AsyncAPI 额外导出内部 queue message，公开 OpenAPI/JSON Schema 不包含该 DTO。内存和 Drizzle repository 使用相同消息校验，错 workspace job 在 BullMQ 重试后不产生 consumption。 |
| 迁移/回滚 | C05 本地队列消息从旧驼峰最小字段迁移到 `contract_version=1.0` 蛇形 DTO；没有 Provider、Veyra、媒体或公开 generation 路由迁移。未来修改消息字段或语义必须新增版本/ADR，并同步 Relay、Worker、持久化测试和 AsyncAPI。 |
| 审计证据 | contracts 导出和生成漂移测试；Relay 单测；真实 PostgreSQL workspace/payload 篡改测试；真实 Redis/BullMQ Worker 重启、错 workspace、重复消费和单次 `task_run.started` 推进测试。 |

## ADR-0023：C05 消费账本以工作区复合身份持久化

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C05，以及未来所有内部事件消费者 |
| 上下文 | 审计发现 `event_consumptions` 仅以 `(event_id, consumer_name)` 记录租约和消费结果。虽然 C05 已按 outbox/job `workspace_id` 读取事件和 TaskRun，但消费账本本身没有可查询的范围列，无法证明错误工作区不会读取、回收、完成或死信另一个工作区的账本记录。 |
| 决策 | `event_consumptions` 持久化 `workspace_id`，账本身份为 `(workspace_id, event_id, consumer_name)`。`outbox_events` 增加唯一 `(id, workspace_id)` 键，消费账本以 `(event_id, workspace_id)` 复合外键引用该行。消费 insert、select、stale-lease reclaim、完成与 dead-letter 都必须使用队列消息的 `workspace_id`；错误范围消息在创建账本记录或推进 TaskRun 前返回 `RETRY`。 |
| 选择原因 | 数据库完整性与所有查询条件共同表达工作区边界，避免把全局 `event_id` 唯一性误当作授权或范围控制。该设计还让 PostgreSQL 测试可以直接证明错工作区账本行无法被创建。 |
| 影响 | 新增仅向前 migration：先用 outbox 回填已有消费记录的 `workspace_id`，再收紧非空列、主键、索引和复合外键。内存 store 以相同三元组作为 Map key。BullMQ 仍只传递版本化 DTO，不成为账本事实来源。 |
| 迁移/回滚 | 不重写 C05 已有 migration。若升级中发现没有对应 outbox 的历史消费记录，迁移必须失败而不是猜测工作区；本地 C05 账本由外键保证不存在该类孤儿记录。未来改变账本身份或消费者名称需新增 ADR、迁移与 PostgreSQL 回归。 |
| 审计证据 | schema/migration contract test、真实 PostgreSQL 复合外键拒绝错 workspace insert、错工作区 process/release 不触碰正确账本行、stale lease 回收和真实 BullMQ Worker 重启/重复投递回归。 |

## ADR-0024：C06 Mock 视频执行和媒体校验边界

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C06；C07/C12 只能在后续章节扩展 |
| 上下文 | C05 已提供可恢复的 `QUEUED -> RUNNING` 传递层，但尚未创建 ProviderAttempt、调用视频端口、验证视频或写入生成资产。C06 必须在没有真实 API Key、没有网络请求和没有提交媒体二进制的前提下验证可播放 MP4 闭环。 |
| 决策 | 新建独立 `packages/provider-video`，只导出 `VideoProviderPort`、确定性 `MockVideoProvider` 与服务器侧 MP4 验证器。Mock `submit` 产生稳定的 `mock_{task_run_id}`，首次 `getStatus` 返回处理中、下一次返回成功，`MOCK_VIDEO_OUTCOME=failed` 走失败路径。Worker 仅经该端口执行提交、轮询和下载；提交后立即持久化 `provider_request_id`，重启时只轮询/下载而不得再次提交。 |
| 媒体完整性 | 不提交 MP4 fixture 或其他媒体二进制到 Git。测试和本机 Mock 运行时用受控静态 ffmpeg 生成临时、确定性的短 MP4；下载字节先写受限临时文件，必须通过 MIME、非空大小、SHA-256 与 `ffprobe` 视频流校验，才以服务端对象 key 和 `If-None-Match: *` 写入 MinIO。临时文件在成功和失败路径均删除。 |
| 公开边界 | Provider 名称、模型、`provider_request_id`、原生 payload、object key 和签名 query 只能留在 Worker/Persistence 内部记录。公开 TaskRun、SSE 与 Studio 只使用既有脱敏 DTO、公开状态和受控下载响应。 |
| 选择原因 | 保留 C05 的 durable outbox/queue/restart 语义，同时将外部 Provider transport、媒体二进制和浏览器显示拆成独立端口，令 C06 可以完全离线验证而不为 C07 引入任何 SUB2API 实现。 |
| 迁移/回滚 | C06 可在现有 `provider_attempts`、`task_runs` 与 `assets` 表上完成，不为 Mock 修改真实 Provider 或信用配置。若未来更换 fixture 生成方式、增加真实 adapter 或把 ffprobe 下沉 C12，必须新增 ADR、保持 `VideoProviderPort` 和生成资产不可覆盖不变。 |
| 审计证据 | Provider 无网络单测、Worker 重启不重复 submit、PostgreSQL/Redis/MinIO 集成、SHA-256/ffprobe 输出、公开脱敏扫描、Studio 上传到播放 E2E、临时文件和端口清理记录。 |

## ADR-0025：项目详情以公开 TaskRun 摘要支持刷新恢复

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C06 |
| 上下文 | C06 的 TaskRun 详情可按 ID 查询，但 Studio 页面刷新后不能依赖浏览器内存保存任务 ID，也不能直接读取数据库或 ProviderAttempt。项目详情是已有的工作区授权读模型，适合承载该项目的公开任务时间线。 |
| 决策 | `GET /api/v1/projects/:project_id` 的 `ProjectDetail` 兼容性新增 `task_runs: TaskRun[]`，按 `workspace_id + project_id + created_at` 查询并只经 `TaskRunSchema` 序列化。TaskRun 详情仍用于尝试和产物；项目详情不包含 attempts、Provider、模型、`provider_request_id`、原生 payload、object key 或签名 URL。 |
| 选择原因 | 让刷新/重新打开 Studio 后仍可从 Control API 恢复公开状态、错误和结果资产关联，同时不引入前端持久化任务事实或额外未审计的公开 list endpoint。 |
| 迁移/回滚 | 仅为现有公开 JSON 的向后兼容新增字段，无数据库迁移。未来分页需求必须新增明确查询契约，不能让浏览器通过内部 API 或 Storage 列表补齐。 |
| 审计证据 | Zod/OpenAPI 导出、公开字段脱敏扫描、workspace-scoped API tests、Studio refresh/播放 E2E。 |

## ADR-0026：C06 Worker ready 后的受控全局恢复扫描

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-13 |
| 影响章节 | C06；不改变 C05 的队列消费语义 |
| 上下文 | C05 的消费事务可以先将 `task_run.queued` 标为已消费并把 TaskRun 推进到 `RUNNING`，随后 C06 执行器才在事务外提交、查询和下载 Mock 视频。进程在两者之间退出时，没有新的队列事实可自动触发执行，任务会停留在可恢复的非终态。 |
| 决策 | `apps/task-worker` 先创建 `autoStart=false` 的 BullMQ consumer 并 `waitUntilReady()`，此时 Redis 连接已就绪但 processor 尚未领取 job；随后串行扫描最多 100 个 `VIDEO_GENERATION`、状态为 `RUNNING`、`PROVIDER_PROCESSING` 或 `DOWNLOADING` 的 TaskRun，并对每一项最多执行 3 次，最后才显式启动 consumer。扫描中的可重试错误在同一 TaskRun 上重试；仅第三次仍失败时才写入失败事实。此扫描是受控 Worker 的全局后台操作，不是浏览器或公开 API；扫描发现后，执行器对每一项都使用该 TaskRun 返回的 `workspace_id` 进行读取和更新。后续 BullMQ 的重复 delivery 仍可调用执行器：已成功 TaskRun 是无副作用 no-op，而先前消费事务完成后执行器异常的 `RUNNING` TaskRun 由重复 delivery 继续执行。BullMQ attempts 耗尽时，C06 以 queue message 的 `workspace_id + task_run_id` 独立收敛 TaskRun 为公开可见、可重试的 `FAILED`，不依赖已完成的 C05 consumer lease。C06 本地 MVP 只运行一个 Worker replica；若未来扩展为多个 Worker，必须先新增持久化 execution lease/claim，不能假设 Attempt 的 CREATED 状态可防并发 submit。 |
| 已提交请求恢复 | 任何一个属于该 `workspace_id + task_run_id` 的 Attempt 一旦存在非空 `provider_request_id`，都构成永久 submit 边界。仓储必须优先选择最近的已提交 Attempt，不得让创建时间更晚但无 request ID 的 Attempt 掩盖它。下载、ffprobe 或结果资产写入在 `DOWNLOADING` 阶段失败时，Attempt 记为 `DOWNLOAD_FAILED` 并保留 request ID；可重试的传输/存储错误保持 TaskRun `DOWNLOADING` 并抛回 BullMQ 或启动扫描重试，终态的媒体/协议错误才置 TaskRun `FAILED` 等待显式 retry。显式 retry 先由 C05 推进 `QUEUED -> RUNNING`；已有 request ID 时执行器再合法推进为 `PROVIDER_PROCESSING`，随后查询/下载而不 submit。没有 request ID 的 Attempt 才可安全创建/提交新的请求。 |
| 选择原因 | 保留 C05 “至少一次队列投递、完成消费后不重复推进”的事实边界，同时补齐 C06 的执行器崩溃窗口，不依赖 Redis 未持久化状态、不向浏览器暴露内部恢复接口，也不提前接入真实 Provider。 |
| 审计证据 | PostgreSQL/Redis/MinIO 集成模拟“消费已完成、执行器未运行、Worker 重启”；断言只扫描允许 kind/status、前两次临时存储失败而第三次成功时 submit 仅一次。无历史 BullMQ job 的连续失败扫描在第三次后必须写公开 `FAILED`，经公开 retry 后只下载且不 submit。另有真实 BullMQ 三次耗尽、已提交 Attempt 后出现较晚空 Attempt、公开失败读取和 retry 恢复回归。 |

## ADR-0027：C07 ProviderPort 下载 metadata 与分阶段失败语义

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-14 |
| 影响章节 | C06、C07；不改变公开 API |
| 上下文 | C07 初版 `Sub2ApiVideoProvider.download()` 只返回字节流，丢弃 transport 的 `Content-Type`/`Content-Length`，而 C06 以硬编码 `video/mp4` 调用校验器。初版 Sub2API failure 类型也没有被 C06 的 provider/download stage mapper 识别，使上游拒绝和下载 404 被错误降级成通用可重试 Provider 不可用。 |
| 决策 | 内部 `VideoProviderPort.download()` 统一返回 `{ stream, mimeType, contentLength? }`；Mock 和每个 adapter 都必须填写实际/确定的 MIME，长度仅在响应给出可解析值时填写。C06 对真实返回 MIME、长度与读入字节一致性做检查，再运行 SHA-256/ffprobe；缺失/非 MP4 MIME、非法或不一致长度归为不可重试 `DOWNLOAD_INVALID`。新增内部 `VideoProviderFailure`，固定包含应用 `code`、`retryable` 和 `stage: PROVIDER | DOWNLOAD`；Sub2API typed failures 继承该类型，C06 按 stage 保留归一化结果。结构响应错误继续使用 `VideoProviderProtocolError`，提交/查询为 `PROVIDER_PROTOCOL_INVALID`、下载为 `DOWNLOAD_INVALID`。 |
| 选择原因 | 让已验证的下载 HTTP metadata 与校验实际相连，避免把任何外部视频当成 MP4；同时让 Provider 拒绝、临时不可用和下载无效在端口边界被一次归一化，既不泄露上游 payload，也不因不可重试错误发起无效重试或重新 submit。 |
| 影响 | 这是 `@alchemy-video/provider-video` 与 C06 Worker 的内部兼容性变更。公开 TaskRun 仍只显示已有安全 `code/message/retryable`，不新增 Provider/响应/对象字段；不改数据库 schema、队列、SSE 或 `/api/v1`。所有 VideoProviderPort 实现与测试 double 必须同步。 |
| 迁移/回滚 | 无数据迁移。未来 adapter 只能在其 transport 实现处读取真实响应 header，不能由 Worker、浏览器或持久化快照猜测 MIME/长度。真实 transport、URL 和 Key 装配留给 C08。 |
| 审计证据 | C07 injected fake transport 测试 metadata 原样传递；C06 跨包回归覆盖 rejected submit、download 404、错误/缺失 MIME、长度不一致与临时 503 后使用同一 request ID 恢复；provider/worker/root 门禁及脱敏/无网络扫描。 |

## ADR-0028：C07 已提交请求的短暂轮询失败由 C06 delivery 恢复

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-14 |
| 影响章节 | C06、C07；不改变公开 API、队列 DTO 或数据库 schema |
| 上下文 | `Sub2ApiVideoProvider.getStatus()` 将 `429`、`503` 归一为 `ProviderStatus.FAILED { code: PROVIDER_UNAVAILABLE, retryable: true }`。C06 初版对所有 status failure 调用 `failTaskRun`，会把短暂轮询故障错误终态化，虽然已持久化的 `provider_request_id` 本应只查询/下载。 |
| 决策 | 已提交请求的可重试轮询失败不调用 `failTaskRun`：TaskRun 保持 `PROVIDER_PROCESSING`，Attempt 保持 `PROCESSING`，执行器抛出可重试 delivery 错误。BullMQ 重投递或启动扫描重新调用执行器时只查询/下载同一 request ID；仅 delivery/扫描尝试耗尽后，复用既有 C06 `finalizeTaskRunExecutionFailure` 写入公开可见、可显式 retry 的 `FAILED`。 |
| 与状态机的关系 | `PROVIDER_PROCESSING -> RETRY_SCHEDULED -> QUEUED` 仍是持久化延迟调度的合法路径；本地 C06 尚未持久化 `next_poll_at` 或创建新的 outbox 事件，不能伪造该状态转换。C08 引入认证后的长轮询调度时才可使用该分支。 |
| 选择原因 | 复用 C05/C06 的至少一次 delivery、duplicate 仍执行和启动恢复机制，避免创建没有消费者的 `RETRY_SCHEDULED` 状态；同时保持提交幂等边界和公开失败可见性。 |
| 审计证据 | 离线 adapter 覆盖查询 `429/503` 的 typed retryable status；跨包回归覆盖首次查询短暂失败后 TaskRun 仍为 `PROVIDER_PROCESSING`、无失败事件、重试成功且 POST submit 只有一次。 |

## ADR-0029：C08 Certifier 的单次提交和有界 GET-only 恢复

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-14 |
| 影响章节 | C08；不改变 C06/C07 运行时、公开 API、数据库、队列或 capability registry |
| 上下文 | C08 获得仅一个 `grok-imagine-video-1.5` 文生认证的受限授权：总 submit 上限为 `1`、总成本上限为 `USD 1.00`、固定最低成本输入为 `duration=1`、`resolution=480p`、`ratio=16:9`。此前文档同时要求“受控退出删除恢复状态”和“中断后恢复”，但没有定义可保存原始 request ID 的唯一例外。 |
| 决策 | 新建独立 `tools/sub2api-video-certifier` workspace，复用 C07 `Sub2ApiVideoProvider` 与 injected `Sub2ApiTransport`。只有命令精确匹配 `--live --profile grok-imagine-video-1.5 --max-submissions 1 --budget-usd 1.00`，且附带 `--stop-after-submit` 或 `--resume` 时，certifier 才可读取 `SUB2API_VIDEO_BASE_URL` / `SUB2API_VIDEO_API_KEY`。它不读取其他 live 开关，也不装配到 Worker/API/Studio。唯一 POST 只允许在 `--stop-after-submit`：在网络 POST 前，certifier 必须在 `tools/sub2api-video-certifier/recovery/` 原子创建权限受限、无 raw ID 的 submission reservation；reservation、报告、regular recovery 或 active claim 任一存在都永久拒绝第二 POST，即使前次网络结果不明。提交成功后 raw request ID 只写入同目录的 recovery state，最大保留 `15` 分钟。`--resume` 用无 raw ID 的短 lease active claim 串行保护读取；可在 TTL 内多次显式恢复，但每次只执行 GET/poll/download，绝不 POST。 |
| 安全与报告 | recovery state 只含 raw request ID 与非敏感 run metadata；submission reservation 与 active claim 只含版本、profile、owner ID 和时间，不含 raw ID。active claim 的 lease 为 60 秒，并在每次 GET/poll 前由当前 owner 续租；超时后的新 resume 可以接管，旧 owner 不能覆盖或删除新 claim。目录只向运行 certifier 的单一 OS 身份授予访问；状态不得写入其他临时目录、reports、日志、数据库、事件、fixture、浏览器或 Git。poll/download 的 retryable `429`/`503` 在同次 resume 内有界 GET-only 重试；仍未完成时释放 active claim、保留 regular recovery 至 TTL，后续显式 resume 仍只 GET。过期时无网络删除；成功、不可重试最终失败、超限和其他受控退出均删除 raw recovery，reservation 保留以证明 submit 已消耗。reports 仅含 case/profile/model、时间、安全字段名、request ID hash、归一化 `provider_state`（`PROCESSING`/`SUCCEEDED`/`FAILED`）、MIME/长度/SHA-256/ffprobe 与 redaction/cleanup 结论。若有 typed failure，只允许附带 `{ classification, code, stage, retryable }`，其中 classification 限定为 `REJECTED`、`UNAVAILABLE`、`PROTOCOL_DRIFT` 或 `DOWNLOAD_INVALID`。绝不含 message、prompt、URL、header、key、raw ID、上游 body、内容 URL、媒体或截图。 |
| 官方成本依据 | 审计员于 2026-08-14 独立复核 [xAI 官方模型与定价文档](https://docs.x.ai/docs/models)：`grok-imagine-video-1.5` 支持文生、duration `1..15` 秒、480p `USD 0.08/秒`。该事实是本次授权参数的成本选择依据；C08 仅用它选择 `1s/480p` 并在本地以十进制 cents 验证 `USD 0.08 <= USD 1.00`。它不是 SUB2API 协议、字段或能力认证事实，不能据此猜测 SUB2API 的 status、ratio、响应或下载行为。A 段不联网重新抓取该来源。 |
| 选择原因 | 用 CLI 显式参数和可测试的依赖注入同时守住预算、一次 POST 与恢复边界；将恢复所需的短暂敏感 ID 与长期 hash-only 审计报告分开，避免浏览器、平台运行时或 Git 获得真实 Provider 标识。 |
| 审计证据 | injected fake transport 覆盖 guard 失败时零 env/fetch、提交前 reservation、写 recovery/report 失败与 active claim 后均零第二 POST、TTL 内多次 resume 仅 GET、retryable poll/download 的有界 GET-only 重试、预算/次数守卫、`REJECTED`/`UNAVAILABLE`/`PROTOCOL_DRIFT` 的白名单诊断、MIME/长度/SHA-256/ffprobe、hash-only 报告、raw ID 扫描、过期 recovery 删除和 source/upstream/static scan。 |

## ADR-0030：C08 审计执行器不可用时的受限交接

状态：ACCEPTED

日期：2026-08-14

影响章节：C08、C09

上下文：C08 已完成受控的单次真实认证并进入 `READY_FOR_AUDIT`，但负责独立审计的 Codex 任务 `019ff6ad-255d-7582-9c96-797d6d4942d5` 的执行器异常退出，无法接收复审材料。用户明确要求继续推进，无需逐项重新授权。

决策：当前执行器以只读复审确认 C08 的一次提交上限、GET-only 恢复、媒体校验、报告/快照脱敏、raw recovery 清理、profile disabled、无运行时装配及全仓门禁后，将 C08 标记为 `ACCEPTED`。该程序性替代不授权额外 Provider 提交、profile 启用、Veyra 请求、共享积分扣费或部署。

选择原因：不伪造独立审计的存在，也不让已完成且有完整可复验证据的章节永久阻塞；将例外限制为 C08 的状态交接，并保持下一章节的所有外部边界关闭。

影响：C09 可开始其离线 `CreditPort`、fake server、错误归一化、receipt 唯一性和状态机实现。任何真实 Veyra 换票、账户查询或 debit 仍要求后续单独的可执行认证方案和不含凭据的审计证据。

迁移/回滚：不改变数据库、公开 API、Provider capability 或 feature flag。若后续独立审计发现 C08 证据不足，C08 退回 `IN_PROGRESS`，C09 仅保留不联网的测试与端口代码。

审计证据：`C08` 审计记录、hash-only local report/capability snapshot、certifier `15/15`、根 contracts generate/typecheck/test/build、安全扫描和 long-running state 验证。

## ADR-0031：C09-A 离线 CreditPort 与 receipt 边界

状态：ACCEPTED

日期：2026-08-14

影响章节：C09

上下文：C08 已受限验收，C09 首先只允许离线身份/共享积分基础。现有共享积分规范把 `401/403` 写为 `CREDIT_AUTH_FORBIDDEN`，但 `AGENTS.md` 与领域契约固定公开应用错误为 `AUTH_FORBIDDEN`。视频平台还需要保留外部 debit receipt 的 provider 维度，却不能复制 Sub2API 余额账本。

决策：建立仅内部的 `CreditPort` DTO、`NoopCreditAdapter`、注入式 `VeyraCreditTransport` 与 `VeyraSub2ApiCreditAdapter`。`402 -> CREDIT_INSUFFICIENT`、`409 -> CREDIT_CONFLICT`、`401/403 -> AUTH_FORBIDDEN`、网络或 `5xx -> CREDIT_UNAVAILABLE`、其余 `4xx -> CREDIT_REJECTED`。金额在业务层保持八位以内的十进制字符串；向上游 number mapper 必须做无损 round-trip 和安全整数范围校验。

receipt：`usage_records` 增加 `credit_provider`，唯一性固定为 `(credit_provider, idempotency_key)`；它是 receipt 镜像而不是余额账本。C09-A 只提供持久化准备和回放/冲突校验，不把 debit 接入 Worker 或状态转换。

安全与边界：adapter 必须强制注入 transport；没有默认 fetch、base URL、环境读取、Token 读取或运行时装配。fake transport 只能用于离线测试，公共 OpenAPI/SSE/Studio 不导出 credit provider、外部用户或 receipt 字段。

后续：`VeyraIdentityAdapter`、外部身份映射、真实 HTTP、Token、Worker billing orchestration、`BILLING_PENDING` 执行及 feature flag 仍属于后续 C09 受控子阶段，必须另有审计授权。

## ADR-0032：C09-B 三 VPS Veyra 联动与无 Query Ticket Handoff

状态：ACCEPTED

日期：2026-08-14

影响章节：C09、部署阶段

上下文：Sub2API/Veyra、Alchemy 和未来 Video OS 是平级 VPS。既有 Veyra Portal 与本地补充方案使用 `?ticket=` 启动 Alchemy，但 AGENTS.md 禁止 ticket 位于 URL query、浏览器持久化或日志。Sub2API 现有 intent/Portal target 也尚无 `video`。

决策：Video 作为第三台独立 VPS，拥有自己的 `video.aiself.vip` TLS edge、Video 数据库/Redis/对象存储、host-only 本地会话、服务身份和 private overlay。Sub2API 保留身份、余额、并发、ticket、原子 debit 与幂等的唯一权威；Alchemy 继续独立运行。未来 Portal 以 allowlisted `video` intent 签发一次性 ticket，并通过顶层 POST body handoff 交给 Video callback；Video 服务端交换 ticket、验证 `intent=video`、账户状态并签发 `__Host-video_session`，随后 303 到无 query 页面。未来 billing 使用冻结规则和 `billing_rule_key + task_run_id`，在产物验证后 debit，并以专用 billing attempt/recovery 保证 remote-success/local-crash 后仅 replay debit。

选择原因：保持三个产品的会话、数据库和资产独立，满足浏览器不接触 Veyra/internal 数据的硬边界，并让跨 VPS 的远端 side effect 能通过 Veyra 幂等键恢复。

影响：需要 Sub2API 增加 video intent/target、durable ticket 消费和 Video 专用可轮换服务身份；Video 需要 identity/session/billing attempts/feature flag/Worker 恢复；Alchemy 只需回归确认既有 target 与 billing 不受 Portal 变更影响。详情见 `AI企业内容生产平台_C09-B三VPS联动设计.md`。

迁移/回滚：本 ADR 仅为设计，不产生运行时或数据库变更。未来迁移必须前向执行，回滚先关闭 Video identity/credit flag，再保持 billing attempt 和 receipt 供同 key replay，不得影响 Sub2API ledger 或 Alchemy。

审计证据：Sub2API `intent.go`、`ticket.go`、`routes.go`、`billing.go`/tests；Alchemy `veyra_auth.py`、`generation.py`；Video C09-A CreditPort/receipt tests；三 VPS implementation/release/rollback/acceptance matrix。

## ADR-0033：C09-C 受控 SUB2API 视频运行时接入

状态：ACCEPTED

日期：2026-08-15

影响章节：C09；不改变 Veyra、共享积分、VPS、DNS、TLS 或部署边界

上下文：用户明确要求将其已放入受忽略本地安全环境的 `aiself-grok` SUB2API 地址与密钥接入产品真实视频链路。C08 已完成一次受限的真实文生认证，证明该 host/profile 的提交、查询、下载和媒体校验可以工作；但 C08 的 capability snapshot 仍是 `enabled: false`，且 Studio、Control API 和 Worker 仍固定使用 `mock-video-v1`。此前一次 submit 额度已耗尽，不能把历史认证视为任意内容或参数的持续付费授权。

决策：保持 `VIDEO_PROVIDER=mock` 为所有默认本地运行的唯一行为。新增仅由 Worker 读取的 `VIDEO_PROVIDER=sub2api` 运行时组合：Worker 使用注入式 HTTPS transport 向受配置的 SUB2API base URL 发出三段式请求，并且只在此模式读取 `SUB2API_VIDEO_BASE_URL` 与 `SUB2API_VIDEO_API_KEY`。Control API 不读取这两个值，浏览器也不收到 Provider 名称、模型、地址、密钥、原始响应或 Provider request ID。浏览器生成命令只表达用户的文本与已选资产；Control API 按受控运行配置形成不可变的内部 `input_snapshot`，Worker 只执行该快照。

能力门禁：真实 profile 仅按 C08 已认证的最小闭环开放文生 `1s / 480p / 16:9`。带 `reference_asset_ids` 的真实请求在 Control API 创建 TaskRun 前被明确拒绝；不把参考图片偷偷降级为文生，也不声明图生、15 秒、其他比例、Seedance、Veyra 预检或扣费已经启用。Mock 保持现有 `1s / 160x90 / 16:9` 行为。Provider 运行时必须验证 HTTPS base URL、保留其 path prefix、阻止 path escape，并将网络/协议异常归一化为既有应用错误；密钥、URL query、header、payload 和原始 request ID 不得进入日志、事件、数据库、公开 DTO 或测试输出。

真实调用门禁：只有 API 和 Worker 都显式设为 `VIDEO_PROVIDER=sub2api`、Worker 配置完整且用户为本次调用给出 profile、调用次数、费用上限和素材范围后，才允许真实 POST。此次接入工作本身不发出 Provider 请求、不启用 Veyra/扣费、不修改 VPS 或当前 Mock 验收入口；完成离线/本地门禁后，首次付费提交作为单独受控动作执行。

选择原因：将用户所提供的真实接入配置落实在唯一允许持有密钥的 Worker，同时使默认开发闭环不产生意外费用，并让已认证的能力范围成为可测试的运行时约束而不是前端硬编码。

审计证据：本 ADR 后的 Worker transport/factory 单测、Control API 内部快照与拒绝路径测试、Studio 无 Provider 字段回归、Mock E2E 回归、类型/构建门禁、密钥与公开边界扫描，以及不含任何真实 request 的受控真实模式启动检查。

## ADR-0034：C09-C 图生与多参考素材按受控 HTTPS relay 交付

状态：ACCEPTED

日期：2026-08-15

影响章节：C09-C、后续部署阶段；不改变当前 Mock 默认、Veyra、DNS、TLS 或 VPS

替代关系：本 ADR 只替代 ADR-0033 中“真实 profile 拒绝所有参考图”及浏览器生成命令携带提示词/资产 ID 的输入规则；ADR-0033 的 Worker-only credential、HTTPS transport、path-prefix、恢复和真实调用门禁继续有效。

上下文：本地 `sub2api-video-mcp` 的 `aiself-grok` profile 已有独立的单图首帧和多图独立参考证据。其客户端契约分别为 `image.image_url` 与 `reference_images[].url`；多参考网关会转换为 Wokey `multipart image[]` 和 `mode=multimodal_reference`。现有产品只保存私有对象，且 Worker 尚未把引用资产变成 Provider 可读取 URL，因此不能把已上传图片安全地送入真实适配器。用户要求取消本地 4096 UTF-8 字节硬拒绝，并开放协议声明的全部最多 7 张独立参考图。

决策：不运行或嵌入 MCP server。平台将复用其经过审计的字段、模式互斥、能力证据和测试思路，新增 Worker 内部 `ReferenceDeliveryPort` 与互斥的 `ResolvedVisualInput`。单个 `FIRST_FRAME` binding 映射到 `image.image_url`；一至七个有序 `SUBJECT`/`STYLE` binding 映射到 `reference_images[].url`；二者不可混用。Worker 仅在 submit 前将已授权私有图片包装为短时 Provider HTTPS relay URL，URL、token、签名 query、object key、Provider payload 和密钥不得持久化或公开。平台不以 4096 字节作为本地硬 gate；上游超长或参数拒绝归一为既有 `PROVIDER_REJECTED`，不进行重复 submit。产品开放一至七张参考图，但 capability 记录继续声明当前完成的端到端视觉验证仅为两张。

选择原因：使用户图片、项目隔离、重启恢复与 Provider 输入语义同时可审计，避免把本机 MinIO、任意外链、MCP 进程状态或浏览器预签名 URL 变成生产事实。显式区分首帧和参考素材，避免把身份图静默改成首帧或文生。

影响：实现将修改内部 snapshot、ProviderPort 输入、Aiself mapper、Worker 装配、引用绑定写入/校验、Studio 的简明素材语义以及本地 fake/E2E 覆盖。Control API 和浏览器继续不能读取视频 Key、Provider URL、对象 key、relay token、Provider request ID 或原始响应。未来 Video VPS 需要独立 TLS relay 签名密钥、私有对象存储读取权限、最小化 endpoint 日志和受控公开 origin；Sub2API/Veyra 与 Alchemy 不共享这些秘密或数据。

迁移/回滚：先在 Mock 和 injected fake relay 下完成全部测试，真实 profile 保持关闭。回滚先关闭新 profile/relay token 签发，保留已提交 TaskRun 的查询下载恢复与所有已有审计事实；禁止删除 ProviderAttempt、TaskRun、结果资产或用重新提交替代恢复。

审计证据：`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md`、MCP 自检、1-7 张/模式互斥/无硬 4096 的离线 contracts、relay token/隔离/泄露扫描、Worker 无重复 submit 恢复、Studio Mock E2E、VPS relay 独立发布审计，以及后续单独授权的 I2V 与两图 R2V 真实验收。

## ADR-0035：Video VPS 私有验证部署包与公开对象签名端点

状态：ACCEPTED

日期：2026-08-15

影响章节：C09-C、部署准备；不改变公开 API、TaskRun 状态机、Veyra、共享积分或默认 Mock。

上下文：真实图生和一至七张参考图需要 Provider 可访问的 HTTPS relay，浏览器上传又需要通过 HTTPS 使用短时 S3 预签名 URL。原 StoragePort 只接受一个对象存储 endpoint，无法同时保证 API/Worker 使用私有 Compose 网络和浏览器使用公开 TLS 主机。当前 Video Control API 只有固定开发身份，不能将其页面直接公开到互联网。

决策：`S3StorageConfig` 新增可选的 `publicEndpoint` 与 `browserOrigins`。内部 `S3_ENDPOINT` 仍负责 bucket 初始化、确认、读取和 Worker 写入；仅 `createUploadUrl`/`createDownloadUrl` 使用 `S3_PUBLIC_ENDPOINT` 产生浏览器可访问的 URL。Video VPS 样例以独立 `assets.video.aiself.vip` 反代 S3 API，不发布 MinIO Console；Nginx 只允许 GET/HEAD/PUT/OPTIONS，固定 CORS 到 `https://video.aiself.vip`，并屏蔽 `/minio/*` 管理路径。`video.aiself.vip` 将 Nuxt、`/api/v1/*` 和 SSE 置于 Basic Auth，直到 ADR-0032 的 Veyra identity/session 被实际接受；不透明 `GET`/`HEAD /provider-input/<token>` 不继承 Basic Auth、关闭 access log，并只转发给 Control API。Compose 默认 `VIDEO_PROVIDER=mock`，Provider base URL/key 只传入 Worker。

选择原因：一个公开 HTTPS host 不能替代内部对象存储地址；分离签名 client 既让浏览器可上传/播放，也避免 API/Worker 经公网读取私有对象。临时 edge 登录使单人实际验证不把固定开发 workspace 暴露为无认证的公网服务，同时不冒充未来 Veyra 登录。

影响：本地行为保持不变，未设置 `S3_PUBLIC_ENDPOINT` 时预签名 URL 仍使用 `S3_ENDPOINT` 和本地 3031 CORS。部署包必须在新、专用 Video VPS 上使用私有环境文件；不得用于 Sub2API、Alchemy 或其他已运行主机。部署执行前仍需明确 VPS、DNS、TLS、Provider 点击次数、费用上限与素材范围。

迁移/回滚：无数据库迁移。回滚时删除 `S3_PUBLIC_ENDPOINT` 即回到单 endpoint；对已提交任务先设 `VIDEO_PROVIDER=mock`，保留 TaskRun、ProviderAttempt、资产和数据库卷，不通过重提交流程恢复。

审计证据：Storage client 单测/类型检查、Control API 类型检查、`docker compose ... config --quiet`、Nginx 容器语法检查、Docker 镜像构建、根回归、敏感值扫描与部署包静态边界扫描。任何真实 DNS、SSH、证书、Provider 或 Veyra 交互另行记录。

## ADR-0036：C09-C 默认参考素材绑定与确定性创作编译

状态：ACCEPTED

日期：2026-08-16

影响章节：C09-C；不改变公开生成命令、数据库 schema、TaskRun 状态机、Veyra、VPS 或默认 Mock。

上下文：真实任务诊断显示，图片可在项目中 READY 却没有任何 `ReferenceBinding`，导致平台正确地创建了 TEXT 快照，但对非专业用户而言“上传完成”与“本次会使用”之间的隐式复选步骤不可理解。诊断还显示 Studio 将原始想法直接传入 Provider，`creative_preferences` 没有进入执行提示词，且文本中的时长要求会被固定 `1s / 480p` 运行时参数覆盖。实际加载的 `aiself-grok` MCP 已证实 JSON 图片字段、一至七张参考素材和 `5s / 720p / 16:9` 路径；它不是原 C08 一次最低成本文生认证的同一请求。

决策：确认上传的图片默认以 `REFERENCE_SET` 选中；存在分镜时立即通过既有 Shot PATCH 持久化，之后用户的选择修改同样持久化。无已保存绑定的旧 READY 图片在本页首次载入时也默认选中。新增 `VideoPromptCompiler` 到现有 `provider-video` 内部边界：它只接受已保存的 Shot 想法、创作偏好和运行 profile，生成执行提示词并提取明确的 `1..15` 秒、`480p|720p` 参数。默认真实参数为 `5s / 720p / 16:9`；不支持的明确要求在提交前被安全拒绝。生成命令仍为 `{}`，浏览器不获得 Provider/model/key/relay URL，TaskRun 重试仍严格使用冻结快照。

选择原因：把“上传即会被使用”的用户心智模型落实为持久化事实，避免图像输入被静默遗漏；让用户自然语言中的有限时长/清晰度意图与实际请求一致；在不引入外部文本 Agent、队列或新公开契约的前提下，使现有偏好真正参与 Provider 指令。

影响：修改 Studio 参考图状态和失败说明、Control API 建立 TaskRun 的内部输入、Provider runtime profile 和新增确定性编译器及回归测试。公开 TaskRun、SSE、日志、错误、ProviderAttempt 与对象存储边界不增加 prompt 以外的新敏感字段；不设置 4096 本地硬限制，也不自动重试上游拒绝。

迁移/回滚：旧项目不重写已存在 TaskRun；页面首次打开时将未绑定 READY 图片显示为默认参考素材，下一次保存或新版本生成才产生绑定事实。回滚可停止默认选择和编译器调用；已创建 TaskRun 的快照、尝试、结果和审计事实保持不变。

审计证据：Provider 编译器单测、Control API 内部快照测试、Studio 默认选中/持久化和失败文案回归、Mock 浏览器 E2E、类型/构建/公开边界扫描。真实 Provider 只由用户页面点击发起，不由本变更的测试自动触发。

## ADR-0037：C09-C 真实请求与已认证 MCP 路径对齐

状态：ACCEPTED

日期：2026-08-16

影响章节：C09-C；不改变公开生成命令、数据库 schema、TaskRun 状态机、Veyra、VPS 或默认 Mock。

上下文：用户页面发起的两图参考任务已形成正确的 `REFERENCE_SET` 快照，Worker 的两条短时 HTTPS relay URL 也可由外部读取。Aiself/SUB2API 在提交时返回 `202`，并在异步 `GET /videos/{id}` 轮询中返回过多次 `200`，最后以 `failed` 状态和泛化消息 `Grok video query failed.` 结束。当前网关不持久化可安全取回的具体终态原因，短期会话绑定过期后也不能重新查询；因此不能把这次失败臆断为图片、内容或某一个参数的问题。诊断同时发现，平台的确定性编译器将用户文本中的 `15 秒/480p` 提取为实际 Provider 参数，并在原描述外追加模板；这些请求与本地 MCP 已认证的 `5s / 720p / 16:9` 原始描述路径不同。

决策：`aiself-grok` 真实运行时固定 `16:9`，但 Studio 第三步明确显示、保存并允许用户选择 `1..15` 秒与 `480p|720p`，默认已认证的 `5s / 720p`。编译器只检查非空并保留用户创作描述（首尾空白除外），不从自然语言提取参数，也不追加模板、翻译、偏好或隐含工程指令。`createRuntimeVideoInputSnapshot` 只接受由 `Shot.generation_settings.video_settings` 解析并范围校验后的设置，避免其他调用方绕过受控选择写出未知结构。Studio 对 `PROVIDER_REJECTED` 只陈述任务已进入生成阶段但未完成；它不再要求用户重新确认已绑定素材。

选择原因：面向非专业用户的界面不应把创作语言中的数字误解为隐藏模型设置，且规格必须在点击前可见、可调整并随项目保存。时长使用 `1..15` 秒下拉菜单，清晰度使用 `480p/720p` 单选项，避免输入过程产生隐式重置；`5s / 720p` 保留为已认证默认，同时不把其他协议允许值表述成已完成同等真实验收。该决策不凭空声称已查明上游失败原因。

影响：修改内部编译器、真实 profile 输入校验、Studio 失败文案及对应 Provider/Control API/Studio 回归测试。`REFERENCE_SET` 的一至七张有序 URL 映射、短时 relay、请求幂等、重启后 GET-only 恢复、公开 DTO/SSE 脱敏保持不变。ProviderAttempt 仍不持久化原始响应或 relay URL；TaskRun 仍只保存既有安全错误码、消息和可重试标识。

迁移/回滚：已失败或已提交 TaskRun 的不可变 snapshot 不修改、不重放。后续用户选择“调整后生成新版本”才使用新行为创建新的 TaskRun。回滚仅恢复旧编译器实现；不得通过重复 submit 取代已提交请求的恢复。

审计证据：两图任务的快照/绑定、relay 外部可读性、网关 `202` 和 `GET 200` 审计日志、同 profile 的 MCP 认证记录、离线 Provider/Control API/Studio 测试、Mock 浏览器 E2E、敏感字段与公开边界扫描。真实验证由用户点击后观察，不由本修正自动触发。

## ADR-0038：长叙事先规划、后逐镜制作与受控连续性

状态：PROPOSED

日期：2026-08-16

影响章节：C10、C11、C12；不改变 C09-C 的单镜头接口、当前数据库或真实运行时。

上下文：当前本地产品已经证明单项目、已绑定参考素材、单 Shot 真实生成、结果归档和项目内播放可用，但原始长小说或多事件故事仍会整体进入一个 Shot。把它按固定字数或固定时长切块后循环提交，会丢失事件完整性、角色/场景连续性、成本控制、版本追溯和失败恢复。当前 `aiself-grok` profile 已认证一张首帧或一至七张独立参考素材，二者互斥，且没有已认证尾帧、混合参考或帧级连续性能力。

决策：从 C11 起，所有“从故事制作完整视频”的路径先创建 `CreativeBriefRevision -> ScriptRevision -> StoryboardRevision`，并由独立的 `PlanningModelPort` 输出受 schema 校验的有序 ShotSpec。用户先看到“故事计划”，在确认“开始制作完整视频”后创建并冻结 `ProductionRun`。C11 的确认**不**创建或提交 Shot `TaskRun`；C12 的依赖调度器才按已确认计划和前序条件创建可执行 Shot/TaskRun。使用 `ProductionRun` 管理整体计划与进度，保留 TaskRun 作为单 Shot 的不可变执行事实。前段接受后可提取 `HandoffAsset` 供后段使用；视觉连续性等级必须依 profile 能力公开说明，不能将叙事连续表述成帧级保证。最终合成、字幕、音频和 Final QC 产生不可覆盖的 VideoVersion。

考虑过的方案：

1. 按字符数截断原文并自动提交多个视频。
2. 继续让用户手工创建所有 Shot。
3. 先自动产生可审阅的故事计划，再按依赖图逐段制作并合成。

选择原因：方案 3 既保留非专业用户的极简操作，又把高成本的视频提交放在一次明确确认之后；它将叙事、连续性、局部重做、质量检查和成片来源建立为持久化事实。方案 1 无法判断故事事件边界，也无法处理相邻镜头依赖；方案 2 将影视工程细节转嫁给用户。

影响：C11 需增加 revision、ProductionRun、ShotSpec、PromptPackage、PlanningModelPort、Workflow Worker、版本化公开 DTO/事件及对应迁移；C12 需增加交接帧、依赖调度、QC、受控渲染和 VideoVersion。C09-C 保持现有一至七参考素材、单 Shot、短时 relay、幂等和恢复契约。规划和最终成片不向浏览器泄露 Provider、模型、密钥、对象 key、签名 URL 或内部任务信息。

迁移/回滚：现有 Project/Shot/TaskRun 继续可用，不回填或修改历史输入快照。新工作流以 feature boundary 引入；未确认的计划不创建视频任务。回滚时停止新规划命令，保留已产生 revision、TaskRun 和 VideoVersion 的只读可追溯性。

审计证据：`AI企业内容生产平台_长叙事自动编排与连续成片设计.md`（范围与交付顺序）、`AI企业内容生产平台_长叙事后端领域与编排开发设计.md`（schema、状态、事件、Worker 与媒体运行时）、`AI企业内容生产平台_长叙事前端项目工作台交互设计.md`（用户流程与浏览器验收），以及 C11/C12 的 schema、领域、集成和浏览器 E2E；长叙事 fixture 的叙事拆分、依赖阻塞、局部重做、最终播放和公开边界扫描。真实多段制作另行获得 profile、次数、额度和素材范围授权。

## ADR-0039：真实 Veyra 与三 VPS 联动后移至 C13-A

状态：ACCEPTED

日期：2026-08-16

影响章节：C09、C10、C11、C12、C13。

上下文：C09 已完成本地 CreditPort、注入式 Veyra transport/mapper、金额精度、usage receipt 幂等和离线契约，C09-B 已完成三 VPS 联动设计，C09-C 已形成单 Shot 本地运行时证据。其余 C09 事项需要真实 Veyra 账户、ticket/debit、`video` intent、VPS、DNS、TLS、跨系统会话与发布/回滚；这些操作既依赖外部系统，也不应在长叙事、QC、合成等本地能力完成前提前执行。

决策：C09 的章节范围收敛为本地共享积分与运行时边界，满足本地证据后可进入审计。真实 Veyra 身份、账户预检、成功后 debit、扣费重试、feature flag、Sub2API/Alchemy/Video OS 三 VPS 联动、网络/TLS、上线监控和回滚统一归入新的 C13-A。C13-A 必须等待 C09、C10、C11、C12 全部 `ACCEPTED`，并在用户分别明确授权测试用户、调用/扣费次数、额度上限、素材范围、网络变更和维护窗口后才可执行。

选择原因：先完成本地的结构化创作、镜头依赖、QC 和成片链，可以在不消耗共享积分、不修改外部服务的条件下验证大部分业务逻辑；随后一次性进行真实跨系统集成，避免在未完成产品形态时反复更改 Veyra、VPS 或生产边界。

影响：C09 不再以真实 debit、Token 或 VPS 为 Exit Gate；现有 CreditPort 和 `BILLING_PENDING` 语义保留，不能伪造扣费成功。C10/C11/C12 仍按既有依赖顺序执行，并且每次真实视频调用继续需要独立、有界授权。C13 增加真实共享积分与部署联动 Gate，发布前审计增加跨 VPS、扣费幂等和回滚验证。

迁移/回滚：没有数据库、API 或运行时代码变更；不会重放、修改或删除既有 TaskRun、ProviderAttempt、usage receipt、部署包或本地环境。若恢复旧顺序，必须以新的 ADR 和总控审计记录恢复 C09 的外部 Exit Gate，不能以文档默认为由跳过。

审计证据：C09-A/C09-B/C09-C 的既有离线、Mock、浏览器与本地真实运行证据；`AI企业内容生产平台_C09-B三VPS联动设计.md`；C13-A 后续的真实账户/扣费/恢复/网络/回滚受控验证记录。当前 ADR 不授权任何外部操作。

## ADR-0040：C10 使用独立 DocumentConversion 与 stream-only MarkItDown Runtime

状态：ACCEPTED

日期：2026-08-16

影响章节：C10、C11

上下文：平台已有 `Asset(kind=DOCUMENT)`，但现有 `TaskRun` 强制绑定 Shot，并携带视频 Provider、结果 Asset 和计费状态机。企业资料转换需要异步、可恢复和可追溯，但不能把文件解析伪装为视频任务，也不能将用户给出的 URL、对象 key 或本地路径交给 MarkItDown。

决策：新增独立 `Document` 与 `DocumentConversion` 实体、状态机、专属 Outbox/队列事件及 Worker。原始文件仍是 USER_UPLOAD Document Asset，转换成功时生成不可替换的 DERIVED Markdown Document Asset。Python Runtime 只接收经内部鉴权的受限字节流和最小 MIME/文件名元数据，固定调用 `MarkItDown.convert_stream(..., stream_info=StreamInfo(...))`；禁止 `convert_uri`、`convert_url`、`convert_local`、对象 key、数据库访问和浏览器直连。C11 只引用 C10 成功资料产物，不回写它们。

选择原因：独立实体保持视频状态机、ProviderAttempt、计费和资料转换语义互不污染；流式受控入口消除服务端 URL 抓取、任意文件路径和跨模块存储耦合；派生 Asset 保留既有 workspace 授权、存储和下载边界。

影响：将新增 contracts、domain、persistence migration/repository、Document Runtime、Document Worker、Control API/Studio 资料 UI 与 E2E。公开 API/SSE 只投影转换状态和已授权 Asset ID，不暴露对象 key、Runtime token/address、堆栈、converter 原始诊断或 Markdown 的内部存储位置。

迁移/回滚：迁移只前向增加 tables/indexes；现有 Asset、Shot、TaskRun、ProviderAttempt 和视频闭环不修改。回滚时停止创建新 conversion，保留已成功 Markdown Asset、DocumentConversion 和来源链，只读可追溯。

审计证据：`AI企业内容生产平台_C10企业资料转换与Artifact设计.md`、MarkItDown 固定来源 `fd239d5d2be43d9b68329730206b9312c7d5a388`、Runtime 无网络/stream-only 夹具、Repository/Worker/HTTP/SSE/Studio 回归、公开字段扫描和 C10 Exit Gate。

## ADR-0041：统一“叙事点—生成片段—最终成片”编排模型

状态：ACCEPTED

日期：2026-08-16

影响章节：C11、C12，以及之后所有新增的视频生成、媒体合成和多段内容能力。

上下文：当前长叙事设计把可见 Shot 与实际 Provider 生成单元基本等同。这样会把 18 个逻辑镜头错误地变成 18 次真实调用，即使目标总时长只有 30 秒，也会产生大量过短、昂贵且连续性较差的任务。前端还会把历史成功片段数量误认为当前制作计划的镜头数量。这个问题不属于某一个题材，而是所有长文本、广告、短剧、产品宣传和未来 Provider 的共同编排问题。

决策：平台统一采用三层模型：

```text
NarrativeBeat（叙事点）
  -> GenerationSegment（实际生成片段）
  -> VideoVersion（最终成片）
```

`NarrativeBeat` 负责故事事件、人物状态、场景和情绪，不直接创建 Provider TaskRun。`GenerationSegment` 按目标总时长、Provider capability、预算和叙事边界分组，每个生成片段恰好对应一次可恢复的 Video TaskRun。所有已验收生成片段由 Media Runtime 合成新的不可覆盖 `VideoVersion`。

30 秒内容默认优先规划为 3 段 × 10 秒；复杂内容可规划为 6 段 × 5 秒。实际结果必须满足 Provider 的安全时长范围、片段总时长等于目标时长，并且按场景、动作和情绪边界分组，不能按字符数或逻辑镜头数量机械切片。

`ProductionRun` 的公开进度显示生成片段数量，不显示历史 TaskRun 数量。旧的 Shot/TaskRun/VideoVersion 保持只读兼容；新的长叙事 revision 通过独立的叙事点、生成片段映射和版本化 ProductionRun 迁移，不原地改写旧快照。

连续性仍分为叙事连续、画面交接连续和最终成片连续。后续生成片段只能使用前一段通过 QC 的交接事实；如果 Provider 不支持多参考图和交接首帧并用，必须显式记录风险，不能静默降级或承诺逐帧无缝。

考虑过的方案：

1. 保持一个逻辑 Shot 对应一个真实 Provider 调用。
2. 按字符数或固定秒数把故事切成大量短任务。
3. 让浏览器按逻辑镜头循环提交 Provider。
4. 先生成叙事点，再按能力和叙事边界合并为生成片段，最后统一合成。

选择原因：方案 4 把非专业用户看到的故事结构与 Provider 的工程限制解耦，能控制真实调用次数、保留长故事的叙事顺序、支持局部失败重试，并且为任何 Provider 和题材复用同一套规则。

影响：需要在后续实现中补充 `NarrativeBeat`、`GenerationSegmentSpec` 及其映射契约，更新 Storyboard/ProductionRun 公开投影、C12 调度、交接帧、QC、合成和 Studio 进度展示。C09 的单 Shot 兼容接口暂不删除；真实 Provider、Veyra、VPS、DNS、部署和 Git 操作边界不因本 ADR 改变。

迁移/回滚：旧项目不回填、不修改历史输入快照。重新生成时创建新的 StoryboardRevision 和 ProductionRun；新版本成功后与旧版本并列保留。若实现回滚，只能停止新编排命令，不能把新片段任务重新解释为旧 Shot 或重复提交已有 Provider request ID。

审计证据：`AI企业内容生产平台_通用叙事点与生成片段编排规范.md`、C11/C12 的契约与领域测试、18 叙事点/30 秒分组测试、实际 TaskRun 数量与 GenerationSegment 数量一致性测试、连续性交接和最终成片 E2E。

## ADR-0042：C12 成片保留音轨并在未验证边界使用受限转场

状态：ACCEPTED

日期：2026-08-17

影响章节：C11、C12；不改变 C13-A、Veyra、VPS、DNS、部署或公开 API。

上下文：真实多段生成已经证明单段上游视频可带音轨，但原 C12 合成命令使用 `-an`，将音频从最终成片中移除。前一版还把派生交接帧误保存在后续创作 revision 的来源列表中，使蓝色或未验收画面可作为多参考输入再次送入 Provider。当前确定性编译器仅传入叙事状态，没有把用户已有的风格偏好、人物身份、服装、场景、人体结构和边界连续性约束写入每段不可变 PromptPackage。

决策：C12 受控 Media Runtime 对含音轨来源段必须保留可解码音轨；多段合成默认将未经过语义级首尾验收的边界视为不连续，采用固定、可复现的画面/音频淡变转场，并通过末帧和音频尾部延展避免减少规划总时长。该转场只遮蔽硬切，不宣称修复模型画面内容。新的 CreativeBriefRevision 只接受同项目、READY 的用户上传图片或文档；`DERIVED` 的交接帧、海报和缩略图不能回流为新的 `REFERENCE_SET`。规划器必须剔除可识别的“把以上内容写成剧本/分镜/视频”等创作元指令，不能让它成为最后一个叙事点。Workflow Worker 必须把已有 `style_preferences` 与连续性护栏编译进每段 PromptPackage，强调参考图身份、服装、场景、角色数、空间关系与自然人体结构；这些是内部提示词，不进入公开 DTO。

选择原因：先修复可以确定性验证的链路错误，避免把真实生成质量问题掩盖为前端展示问题；同时保持用户面对的一键创作流程不增加工程配置，也不把未认证的尾帧或独立身份通道伪装成 Provider 能力。

限制：当前 Provider profile 没有认证的“多参考图 + 前段尾帧”并用能力，也没有语义视觉 QC。因此转场和 Prompt 锚点只能降低场景/服装/人体漂移风险，不能保证模型逐帧正确。需要严格首尾一致时，后续应在独立能力认证后增加受控关键帧/桥接片段和语义 QC。

迁移/回滚：不迁移或修改历史 TaskRun、ProviderAttempt、Asset、HandoffAsset 或 VideoVersion。用户重新生成时创建新的 immutable brief/storyboard/ProductionRun/VideoVersion；回滚仅停止新编译和新合成策略，历史事实继续只读可追溯。

审计证据：Media Runtime 音轨/转场回归、CreativePlanning source eligibility 回归、PromptPackage 编译回归、C12 本地 E2E、成片 ffprobe 抽查和公开边界扫描。

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
