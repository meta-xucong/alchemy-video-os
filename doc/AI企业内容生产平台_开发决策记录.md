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
