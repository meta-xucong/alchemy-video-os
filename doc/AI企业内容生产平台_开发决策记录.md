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

决策：平台对用户可见的创作与成片事实继续采用三层模型；后台执行层允许在 `NarrativeBeat` 与 `GenerationSegment` 之间增加私有动作节拍：

```text
NarrativeBeat（叙事点）
  -> MotionBeat（私有动作节拍，可选兼容层）
  -> GenerationSegment（实际生成片段）
  -> VideoVersion（最终成片）
```

`NarrativeBeat` 负责故事事件、人物状态、场景和情绪，不直接创建 Provider TaskRun。`MotionBeat` 只描述同一连续片段中的可观察动作、时间位置和起止姿态，不创建 Provider TaskRun，也不改变公开片段数量。`GenerationSegment` 按目标总时长、Provider capability、预算和叙事边界分组，每个生成片段恰好对应一次可恢复的 Video TaskRun。所有已验收生成片段由 Media Runtime 合成新的不可覆盖 `VideoVersion`。

30 秒内容默认优先规划为 2 段 × 15 秒。15 秒以内的动作和运镜使用同一段内的时间轴表达；只有超过 Provider 的安全时长上限，或用户明确写出编辑性场景切换时，才增加 Provider 片段。实际结果必须满足 Provider 的安全时长范围、片段总时长等于目标时长，并且按场景、动作和情绪边界分组，不能按字符数或逻辑镜头数量机械切片。

`ProductionRun` 的公开进度显示生成片段数量，不显示历史 TaskRun 数量。旧的 Shot/TaskRun/VideoVersion 保持只读兼容；新的长叙事 revision 通过独立的叙事点、生成片段映射和版本化 ProductionRun 迁移，不原地改写旧快照。

连续性仍分为叙事连续、画面交接连续和最终成片连续。后续生成片段只能使用前一段通过 QC 的交接事实；如果 Provider 不支持多参考图和交接首帧并用，必须显式记录风险，不能静默降级或承诺逐帧无缝。

考虑过的方案：

1. 保持一个逻辑 Shot 对应一个真实 Provider 调用。
2. 按字符数或固定秒数把故事切成大量短任务。
3. 让浏览器按逻辑镜头循环提交 Provider。
4. 先生成叙事点，再按能力和叙事边界合并为生成片段，最后统一合成。

选择原因：方案 4 把非专业用户看到的故事结构与 Provider 的工程限制解耦，能控制真实调用次数、保留长故事的叙事顺序、支持局部失败重试，并且为任何 Provider 和题材复用同一套规则。

影响：需要在后续实现中补充 `NarrativeBeat`、可选私有 `MotionBeat`、`GenerationSegmentSpec` 及其映射契约，更新 Storyboard/ProductionRun 公开投影、C12 调度、交接帧、QC、合成和 Studio 进度展示。C09 的单 Shot 兼容接口暂不删除；真实 Provider、Veyra、VPS、DNS、部署和 Git 操作边界不因本 ADR 改变。动作节拍的实施和验收由 ADR-0050/C11.3 单独管理。

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

## ADR-0043：C12 交接帧与用户参考图采用有序视觉输入，Studio 勾选来源回到 CreativeBrief

状态：ACCEPTED

日期：2026-08-17

影响章节：C11、C12；不改变公开手工 Shot 生成模式、Veyra、VPS、DNS、部署或共享积分。

上下文：用户复核真实多段成片后指出两类问题：一是首尾帧衔接不应只靠提示词和最终转场，后续片段应直接拿前段尾帧作为开场承接；二是前端参考图默认未勾选，但后台真实生成又使用了参考图，说明页面状态与不可变 CreativeBrief 来源不一致。只读诊断显示，Studio 旧逻辑从“最新 Shot 的 reference_bindings”恢复勾选，而最新 Shot 往往是 C12 自动生成的内部片段，可能只绑定 `DERIVED` 交接帧；后台则按最新 `CreativeBriefRevision.source_asset_ids` 使用用户素材。

决策：Studio 的参考图勾选只从最新 CreativeBrief 中仍然 READY 的 `USER_UPLOAD:IMAGE` 恢复；没有历史 brief 的新项目才默认全选已确认上传图片。用户上传图片后仍立即默认勾选；用户主动取消后，下一次提交会把选择写入新的 brief。Studio 不再从最新生成 Shot 的绑定反推用户勾选状态，避免派生交接帧污染页面。

C12 后续片段的 `HANDOFF_FIRST_FRAME` 不再丢弃用户参考图。前段通过 QC 后，Media Runtime 继续派生 HandoffAsset；Production Scheduler 只有拿到该 HandoffAsset 后才调度依赖片段，并按“第 0 位 HandoffAsset + 第 1 位起最多 6 张用户上传参考图”的顺序创建内部 Shot、ReferenceBinding 与 TaskRun 快照。当前 SUB2API profile 没有独立尾帧字段或已认证逐帧连续能力，因此 Provider 输入仍走受控 `REFERENCE_SET` 多参考通道，PromptPackage 明确说明第一张参考图是交接开场帧。公开手工 Shot 模式仍保持 `FIRST_FRAME` 与 `REFERENCE_SET` 互斥。

选择原因：该方案同时解决画面承接和参考图一致性，且不新增浏览器工程概念、不暴露 Provider 字段、不改公开 HTTP DTO，也不把派生交接帧回流成用户素材。它把“用户想要的素材选择”和“后台为了连续性追加的派生帧”分层保存，便于审计和重试。

限制：有序多参考能让上游同时看到交接帧和用户参考图，但它不是已认证的 literal 首帧+尾帧双关键帧能力，不能承诺人体、服装、场景逐帧完美。若后续仍出现明显漂移，需要继续增加语义 QC、失败段自动诊断、桥接/转场镜头生成或新的 Provider 能力认证。

迁移/回滚：不修改旧 TaskRun、Asset、HandoffAsset 或 VideoVersion。既有项目重新生成时创建新的 CreativeBrief/Storyboard/ProductionRun/VideoVersion；回滚只停止新规则生成，不解释或覆盖旧成片。

审计证据：Studio 静态回归证明勾选由 CreativeBrief 恢复且不读取最新 Shot 绑定；Production Repository 集成回归证明第二段快照为 `[handoff, user-reference]` 的有序 `REFERENCE_SET`；CreativePlanning/Provider runtime 回归证明 PromptPackage 和 7 图上限一致；C12 E2E/本地测试通过后追加到章节审计记录。

## ADR-0044：以语义衔接质检和有界自动修复补齐 C12 成片连续性

状态：SUPERSEDED

日期：2026-08-17

影响章节：C12.1；C13-A 继续后置，不改变 Veyra、VPS、DNS、部署、共享积分或公开单 Shot 生成契约。

上下文：ADR-0042 和 ADR-0043 已修复确定性的音轨、用户参考素材和“前段交接帧优先”问题，但上游视频模型仍可能在相邻片段之间产生人物、服装、场景、构图或动作方向漂移。现有固定淡变只能遮蔽硬切，不能判断是否存在语义断裂，也不能以可审计方式决定何时需要真正的短过渡画面。

决策：新增私有 `HandoffReview` 和 `TransitionRepair`。技术 QC 通过后，受控 `HandoffEvaluatorPort` 只接收有界边界帧与最小连续性摘要，返回 `PASS`、`BLEND`、`BRIDGE_REQUIRED`、`UNAVAILABLE` 或失败。`PASS` 直接合成，`BLEND` 使用既有淡变，`BRIDGE_REQUIRED` 最多生成或编排一个 1 至 3 秒的本地媒体运行时转场并记录修复计划；`UNAVAILABLE` 或失败只直切并公开投影为“衔接检查未完成”，不创建没有语义依据的修复。每个边界最多一次自动修复，整次 `ProductionRun` 的自动修复上限冻结；自动转场不改变用户看到的主生成片段数量或用户目标总时长，也不在 C12.1 新增真实 Provider 调用。

选择原因：把“内容连续”从提示词期待转为持久化、可恢复、可测的后台质量流程，同时保留面向非专业用户的一键创作体验。自动转场只在必要时触发且有次数、时长和恢复守卫，避免无限调用、无限修复或把工程细节抛给用户。

限制：第一阶段只实现注入式本地夹具评估器和 Mock/离线回归，不认证新的真实视觉评估模型，也不承诺逐像素首尾一致。评估器的原始图像、模型回答、评分、Prompt、Provider、对象 key、临时文件与命令行一律不公开。语义评估不可用时只能降级为直切和明确状态，不能伪造通过或伪造转场修复。

迁移/回滚：通过前向迁移新增私有关系和安全公开字段；不修改历史 TaskRun、ProviderAttempt、Asset、HandoffAsset 或 VideoVersion。回滚仅停止新的质检/修复调度，保留已有事实和旧成片只读；C12.1 本地修复没有桥接 Provider 任务，重复恢复只可回放既有评估、修复事实与合成计划。未来认证视觉模型桥接时必须另立 ADR、能力认证和恢复语义。

审计证据：`AI企业内容生产平台_C12.1语义衔接质检与自动转场修复开发设计.md`、Contracts/Domain/Persistence/Production Worker/Media Runtime/Studio 回归、多片段的 PASS/BLEND/BRIDGE_REQUIRED/UNAVAILABLE 夹具、Worker 重启和重复事件回归、公开边界扫描及独立 C12.1 Exit Gate。

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

## ADR-0053：DeliveryPlan 与 NarrationPlan 作为 Provider 前置审批状态机

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C12.7B；不改变历史 ProductionRun、TaskRun 或 Provider 协议。

上下文：现有“开始制作”会直接确认 ProductionRun，无法在视频提交前冻结交付承诺、声音策略、样音审批和能力降级。源仓库的 proposal/checkpoint 能力不能直接以文件状态进入平台事实。

决策：新增 `DeliveryPlanRevision` 与 `NarrationPlanRevision`。它们拥有独立 `DRAFT -> PREFLIGHT_BLOCKED|AWAITING_APPROVAL -> APPROVED -> CONSUMED|SUPERSEDED` 状态，失败或撤销只能阻止新制作，不改写历史成片。未批准的 preflight 不创建 `production_run.confirmed`，也不占用现有活动 ProductionRun 锁。

迁移/回滚：仅前向新增表、契约和事件；关闭本能力时历史流程只读兼容，不迁移旧 ProductionRun。

审计证据：Contracts、Domain、Persistence schema、Control API preflight 和公开 SSE 脱敏测试。

## ADR-0054：SpokenForm、Glossary、VoiceAuthorization 与 BrandPolicy 默认 fail-closed

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C12.7B、C12.8。

决策：`AI`、品牌、人名、型号、日期/编号等歧义词必须由 `PronunciationGlossaryRevision` 或用户批准的样音冻结，不自动猜测为内容正确。真实人声、头像、授权音频/视频和 Logo 默认禁止克隆、模仿或暗示代言；只有 `VoiceAuthorization` 与 `BrandPolicyRevision` 均处于可用状态且未过期时，后续计划才可使用对应输入。

迁移/回滚：撤销只影响新 DeliveryPlan；历史 VideoVersion 仍按原始事实播放和审阅。

审计证据：状态机、授权撤销、公开投影脱敏和跨工作区 schema 测试。

## ADR-0055：BudgetReservation 与 Veyra debit 分离

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C13-A。

决策：`BudgetReservation` 只保存平台侧估算、用户批准和超预算阻断事实，金额使用十进制字符串。它不得维护余额、模拟扣费、替代 Sub2API/Veyra debit 或写 UsageRecord；真实 debit 仍只在 C13-A 按成功产物后幂等 receipt 执行。

审计证据：契约和 schema 均不包含 Veyra token、余额或 debit payload；预算超额只阻断 Provider 前置提交。

## ADR-0056：CapabilityProfile 认证决定 Web 可见能力

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C09-C、C12.7B、C12.9。

决策：视频、TTS、字幕、Avatar/lip-sync、编辑和输出变体能力必须按 feature 独立记录认证状态。只有 `OFFLINE_CERTIFIED` 可进入本地 Mock/fixture 流程，只有 `LIVE_CERTIFIED` 且经授权的真实能力才可在普通项目选择器出现；`DISABLED`、`REVOKED` 或未知 feature 必须 fail-closed。

审计证据：Domain 能力可见性测试、公开 DTO 不暴露 provider 原始字段。

## ADR-0057：QualityGateDecision 将 QC 事实转成可恢复行动

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C12.8。

决策：`QcReport` 继续保存技术/语义检查事实；`QualityGateDecision` 保存行动路由：`PRESENT`、`REVISE_NARRATION`、`REVISE_EDIT`、`REGENERATE_SEGMENT`、`BLOCK` 或 `AWAITING_HUMAN_APPROVAL`。`REVIEW` 不能自动等价为发布通过，只有 `PRESENT` 或授权人工批准才允许导出相应 variant。

审计证据：严重度/action 领域测试、公开安全投影和恢复命令后续测试。

## ADR-0058：OutputProfile 与字幕/重构图不覆盖原始 VideoVersion

状态：ACCEPTED

日期：2026-08-29

影响章节：C11.7/C12.7A、C12.8。

决策：默认只冻结 16:9 原始输出；横版、竖版、方形、字幕烧录、sidecar 字幕和重构图必须在 `OutputProfileRevision` 中显式选择。所有派生输出都是新 Asset/variant，不裁切、不替换、不重新评级历史成功 VideoVersion。

审计证据：契约和 schema 验证 variants 必须显式，默认字幕策略按项目类型冻结。


## ADR-0045：C11.1 以冻结 Markdown 结果而非原始资料进入规划

状态：ACCEPTED

日期：2026-08-17

影响章节：C10、C11.1；不改变 C12、C13-A 或既有视频任务。

决策：原始 `USER_UPLOAD/DOCUMENT` Asset 只表达用户选择。新建 CreativeBriefRevision 必须在同一 workspace/project 中冻结其唯一成功的 `DocumentConversion` 和 `READY/DERIVED/text-markdown` 结果 Asset，随后由 Workflow Worker 以每份 5,000 字符、最多四份、总计 18,000 字符读取这些准确结果。Markdown 正文只作为私有规划上下文和 PromptPackage 约束；确定性公开计划只显示资料参与和一致性要求，不能复述原句。公开 DTO/SSE/日志不返回正文、对象 key、签名 URL、Prompt 或内部哈希。

选择原因：直接引用原始资料无法证明转换完成，也会让失败资料在浏览器刷新后悄然进入规划；只保存一个可变资料列表又无法让审阅版本复现。冻结 conversion/result 关系保留 C10 的来源链，同时使 Worker 在不访问原始文件或任意路径的前提下得到有限、可重放的上下文。

后果：C11.1 增加私有 `creative_brief_document_contexts` 和 `DOCUMENT_CONTEXT_INVALID` 语义。资料读取失败停止该次规划并走已有重试/失败路径；不会重新转换资料、替换历史引用或创建视频任务。

审计证据：C11.1 设计、领域契约、Repository/Worker/HTTP/Studio 测试和公开边界扫描。该 ADR 不授权 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

## ADR-0046：C11.2 以可定位事实包替代 Markdown 全文进入创作

状态：PROPOSED

日期：2026-08-18

影响章节：C10、C11.1、C11.2、C11、C12；不改变 C13-A、Veyra、共享积分、VPS、DNS、部署或现有历史生成。

上下文：C11.1 已安全冻结成功 Conversion 的 Markdown，但固定开头字符截取既无法覆盖复杂 PPT 的后半段内容，也无法按叙事段过滤资料；同一资料原文被附加到所有镜头 Prompt，导致重点漂移、冲突事实无法处理，并可能扩大真实 Provider 输入。资料转换成功不等于资料已被理解。

决策：新增私有 `DocumentKnowledgeRevision`、结构段、可定位 `DocumentFact` 和 `CreativeBriefFactContext`。资料理解与创作规划分离：Document Worker 成功转换后通过 outbox 投递理解任务；新 Brief 只冻结同一 Conversion/SHA 的 READY 知识修订中被选中的事实快照；每个 GenerationSegment 只接收相关事实和全局品牌/合规锁。原始 Markdown、chunk、对象 key、hash、Prompt、检索分数、模型和选择理由不进入公开 DTO/SSE/日志。资料冲突、视觉缺失和没有来源定位的推断默认不得进入营销结论。

考虑过的方案：继续扩大 C11.1 字符上限会继续丢失语义边界并把更多无关文本复制到每个片段；直接接入向量库或自由文本 Agent 会引入未认证模型、外部凭据和不可审计写入；让用户手动切块会违反面向非专业用户的一键创作目标。

选择原因：结构化事实包既保留 C10 的来源链和 C11.1 的不可变性，又把复杂资料的处理变成可恢复、可测试的后台工作。首版可由无网络确定性解析器安全实施；未来真实文本/视觉理解只能替换受控端口，不能绕过事实、快照和 Provider 边界。

影响：新增 C11.2 专项后端/前端设计、领域/事件契约、迁移、Document Knowledge Worker、事实选择器、Studio 资料状态与回归。C11.1 历史 Brief 和所有历史视频版本只读兼容；新的资料理解失败、冲突或部分可读不能被伪装成已结合资料生成。

迁移/回滚：只前向新增知识和事实快照表。历史成功 Conversion 可以逐个 backfill，但不会修改历史 Brief 或发起视频任务；回滚仅停止新任务创建，已存在 Revision/FactContext/Storyboard/TaskRun/VideoVersion 保留可读。

审计证据：`AI企业内容生产平台_C11.2资料理解与按段事实包后端开发设计.md`、`AI企业内容生产平台_C11.2资料理解前端交互设计.md`、Contracts/Domain/Persistence/Document Intelligence/Workflow/Studio/E2E 回归、公开字段和无网络扫描。该 ADR 在独立验收前不授权真实文本或视觉模型、Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

## ADR-0047：为已实测 SUB2API profile 增加出站 Prompt 压缩上限

状态：ACCEPTED

日期：2026-08-18

影响章节：C09-C、C12；不改变公开输入、历史 TaskRun、参考素材契约或 C13-A 外部边界。

上下文：xAI 官方视频文档没有公布 Prompt 字节上限，平台因此保留了 20,000 字节的可调安全预算。但本地真实 `aiself-grok / grok-imagine-video-1.5` 请求返回了明确的“最多支持 4096 字节 UTF-8 文本”拒绝。该限制可能来自当前 SUB2API/profile 网关，不能写成 xAI 通用规范；继续把 20,000 字节原样送入该 profile 会在 Provider submit 前失败。

决策：保留 20,000 字节作为平台/资料预算，不在浏览器或 Control API 入口拒绝用户原文；在内部 `VideoProviderRuntimeProfile` 为该 profile 声明 4,096 字节出站压缩上限。创建不可变 TaskRun 执行快照时，使用配置预算与 profile 上限的较小值做确定性 UTF-8 安全压缩。Shot 继续保存原始创作描述，历史任务不改写；未来 profile 认证出不同能力时只调整内部 profile 配置和对应证据。

选择原因：同时满足非专业用户不需要手工缩写、平台不伪造官方限制、真实请求不被已知网关规则立即拒绝三项要求。压缩发生在任务快照生成前，Worker 实际提交的 Prompt 与持久化快照一致，避免 Provider 请求与审计事实分叉。

审计证据：最新失败 TaskRun 的只读数据库证据（13,457 UTF-8 字节、两张参考图、`PROVIDER_REJECTED` 4096 文案）；Provider Runtime 35/35、Production Worker 22/22、类型检查和本地真实栈重启验证。未自动重试真实任务，未访问 Veyra/VPS/DNS/TLS，未执行 Git 写入。

## ADR-0048：保留多参考图的主体与场景语义

状态：PROPOSED

日期：2026-08-18

影响章节：C09-C、C12；不改变公开 ReferenceBinding 枚举、C13-A、Veyra、VPS、DNS、部署或历史 TaskRun。

上下文：本机真实成功任务已经证明两张参考图能够完成 relay 和 Provider 接收，但成片主要采用第一张人物图，第二张场景图变成泛化环境。此前 `REFERENCE_SET` 快照没有内部角色，Prompt 只说“参考图是视觉来源”，无法告诉上游哪张图片锁定场景。

决策：在不可变 `visual_input.references` 中增加可选的内部角色。新任务不再依据上传位置分配角色；用户文字说明优先，随后由视觉分析单元识别 `SUBJECT`、`SCENE` 或 `STYLE`，C12 的交接帧为 `HANDOFF`。Worker relay 按 `HANDOFF -> SCENE -> SUBJECT -> STYLE` 排序，Prompt Compiler 同步加入角色约束。旧快照没有角色时保持兼容，不回写历史事实。

选择原因：不增加面向非专业用户的工程表单，不修改公开数据库枚举，又让真实 R2V 请求拥有可审计、确定性的场景优先语义。单图仍只声明主体，不虚构场景能力。

限制：该 ADR 的位置规则已被 ADR-0049 取代；角色和排序只能提高上游采用场景图的概率，不能承诺逐帧或逐像素一致。

审计证据：Contracts 角色兼容解析、Control API 快照角色推断、Production Repository C12 快照、Worker relay 排序、Prompt Compiler、Studio 标签和对应单测/集成测试；本 ADR 在测试通过前保持 `PROPOSED`，不授权 Git、VPS、SSH、DNS、Veyra 或部署。
## ADR-0049 参考图角色解析采用用户说明优先

- 状态：ACCEPTED
- 决策：参考图的内部角色按“用户创作说明 > 显式主体绑定 > 视觉分析单元”解析；`HANDOFF` 首帧绑定保持最高优先级；未解析时进入等待，不执行位置回退。用户在故事输入框中明确写出的图片职责必须进入不可变 TaskRun 快照，并影响 Provider relay 排序和提示词中的输入序号映射。
- 原因：非专业用户不应被迫按固定顺序上传图片；此前只按位置推断会丢失用户已经说明的场景/主体关系。
- 边界：视觉分析通过显式配置的 OpenAI-compatible 多模态适配器完成；没有 `REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_API_KEY`、`REFERENCE_VISION_MODEL` 或置信度不足时，系统保持等待并提示用户，不调用位置回退，也不把失败伪装成识别成功。
- 验证：Domain 24/24、Reference Analysis 2/2、Creative Planning 6/6、Provider Video 36/36、Studio 33/33、Control API 参考素材回归与 typecheck 通过；公开序列化不输出视觉分析元数据，C11/C12 生产快照对未解析角色保持 WAITING。

## ADR-0050：以 MotionBeat 补齐叙事点到生成片段的动作编排

- 状态：PROPOSED
- 日期：2026-08-19
- 影响章节：C11.3、C12；兼容 C11、C11.1、C11.2、C12.1 的既有事实，不改变 C13-A 外部边界。
- 上下文：当前平台已经能把 `NarrativeBeat` 分组为 `GenerationSegment`，但现行编译器主要按句子和等分规则形成段落，缺少同一片段内的动作顺序、时间位置、结束姿态和镜头运动约束。这会放大人物动作不自然、服装/场景连续性漂移和首尾状态不明确等质量问题。上游 `huobao-drama` 的 storyboard-breaker/prompt-generator、Seedance 的长视频提示词和 OpenMontage 的时间轴 Artifact 已提供可复用思路，但不能直接把上游 Agent 或文件工程当作平台事实源。
- 决策：在 `NarrativeBeat` 与 `GenerationSegment` 之间增加私有 `MotionBeat` 和 `GenerationSegmentMotionPlan`。新 revision 先生成 2-4 个可观察动作节拍，再按场景、因果、能力和预算边界形成生成片段。`PromptPackage` 按参考素材职责、全局连续性锁、项目事实、动作时间轴、音频提示和禁止项确定性编译；动作计划版本、哈希和来源叙事点序号进入不可变执行快照。公开 DTO/SSE/日志不暴露动作工程字段，旧 revision 没有动作计划时继续使用兼容编译器。
- 考虑过的方案：继续沿用句子等分；把整段原文直接交给视频 Provider；让前端显示分镜/动作时间轴供用户手工修正；复制上游自由 Agent 和本地 workspace 文件。
- 选择原因：MotionBeat 只增加后台执行层，不破坏现有公开项目/任务体验；结构化时间轴可测试、可重放、可在 Provider 能力认证前使用 Mock 验证，同时保留上游成熟的动作与提示词字段语义。
- 影响：新增 C11.3 设计文档、私有计划 schema/校验、PromptPackage 编译输入和 TaskRun 快照字段；C12 需要在调度、QC 和合成报告中保留动作计划版本。不会回填或重写历史 Storyboard、TaskRun、VideoVersion，也不会增加用户操作步骤。
- 迁移/回滚：只向前为新 revision 写入动作计划；历史快照缺失时按旧编译器读取。若 C11.3 验证失败，关闭新 revision 的 MotionPlan 编排并回退到兼容编译，保留已经创建的新事实和历史成片只读可追溯。
- 审计证据：`AI企业内容生产平台_C11.3动作节拍与时间轴提示词开发设计.md`、领域/API 契约更新、creative-planning/Workflow Worker/PromptPackage/TaskRun 快照测试、公开脱敏扫描和 Mock E2E。该 ADR 在独立验收前不授权真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

## ADR-0051：以 AudioPlan 统一连续旁白与分段视频音频所有权

> **语音路线部分已由 ADR-0063（2026-09-01）SUPERSEDED**：本条中“存在 `PLATFORM_NARRATION` 即默认静音 Provider dialogue”的无条件路由不再适用；仅在明确选择该 owner 时执行。native Provider 音频可按来源能力成为最终 owner。AudioPlan、历史兼容和 fail-closed 边界仍保留。

- 状态：PROPOSED
- 日期：2026-08-25
- 影响章节：C12.4、C12.1、C09-C；不改变历史 TaskRun/ProductionRun/VideoVersion、Provider submit/status/download 协议、默认 Mock、Veyra 或部署边界。
- 上下文：当前 Media Runtime 会保留每个 AI 片段的内嵌音频，并以 concat/acrossfade 拼接。真实 30 秒样本证明视频生成成功，但段间口播出现明显停顿。OpenMontage `video-stitching.md` 明确指出 AI 片段音频通常不连续，应在跨段成片时移除不连续的 AI 音频，使用统一音乐/旁白轨道，并以绝对时间戳、J-cut/L-cut、响度和完整转写校验保证连续性。现有总控文档“来源片段有音轨时不得丢弃”与该规则存在范围冲突。
- 决策：引入私有 `AudioPlan` 和 `AudioOwnership`。存在 `PLATFORM_NARRATION` 时，Provider dialogue 不再拥有最终旁白，Media Runtime 默认将其静音并按绝对时间轴混入完整旁白；用户源音频、环境声、音乐和音效按所有权保留。没有 AudioPlan 的历史任务使用 `LEGACY_PRESERVE`，保持可回放和行为兼容。画面转场结论不自动决定音频跨淡。
- 选择原因：这是对上游已验证音频架构的薄适配，不是无条件删除声音；同时保留旧成片、Mock 和非旁白用户素材，解决当前真实问题而不穿透模块边界。
- 迁移/回滚：新任务只向前写入 AudioPlan 和音频资产关系；历史事实不回写。若旁白资产、时长或转写不可用，任务停在可恢复媒体门禁，不静默回退为错误音频。关闭连续旁白策略时使用 `LEGACY_PRESERVE`，不重新提交已完成 Provider 任务。
- 审计证据要求：C12.4 设计文档、内部契约、AudioPlan/ownership 单测、三段含 AI 音频 fixture 的 Media Runtime 合成测试、响度/静音/转写检查、旧任务回放测试和一次受控真实 30 秒样本。该 ADR 在 C12.4 独立 Exit Gate 前保持 `PROPOSED`，不授权 VPS、Veyra、部署、Git 写入或无界真实 Provider 调用。

## ADR-0052：口播语速优先，视觉时长跟随实际旁白并允许空镜填充

> **语音 owner 部分已由 ADR-0063（2026-09-01）SUPERSEDED**：本条的自然语速、实际时长和禁止变速规则继续有效；“统一平台旁白作为默认 spoken owner”的前提改为依来源能力选择 native Provider 或 TTS owner。旧决策原文保留用于审计。

- 状态：`PROPOSED`
- 日期：2026-08-25
- 影响章节：C12.5、C12.4、C12.1；不改变历史运行、TaskRun 状态机、Provider submit/status/download 协议、默认 Mock、Veyra、VPS 或部署边界。
- 上下文：当前规划器先将 30 秒目标等分为 15+15 秒，再把台词塞入固定片段，导致后段口播被拖慢、段间产生停顿或切掉最后一句。该行为与 huobao 的台词最低时长和弹性分段规则、Seedance 的时间轴脚本要求，以及 OpenMontage 的“按实际旁白时长调整画面、禁止慢放音频”规则不一致。
- 决策：复用 C12.4 的 `AudioPlan`。以脚本节奏配置和实际旁白时长为权威；先按语义边界和台词容量规划 8–15 秒视觉段，再由实际旁白时间轴确定画面承载。目标时长有余时使用无台词视觉/环境段或尾拍填充；目标时长不足时回到脚本重写，或在允许的弹性范围内延长画面；禁止使用等分时长作为口播预算、禁止 atempo/rubberband、禁止 Provider 自行补词或重复台词。
- 选择原因：该决策直接继承源仓库已有字段、校验和反馈闭环，只在平台内部做薄 mapper；能同时解决语速不一致、音频截断和机械 15+15 拆分，而不新增第二套音频事实源。
- 迁移/回滚：历史任务按原行为回放；新任务向前写入旁白实际时长、弹性时长策略和 AudioPlan。关闭新策略时使用 `LEGACY_PRESERVE`，不重新提交已完成 Provider 任务。
- 审计证据要求：C12.5 设计文档、旁白 section 实际时长/节奏 DTO、按台词容量分段单测、22 秒旁白填充 30 秒和 33 秒旁白超长两个 fixture、A/V 时间轴与转写 QC、历史 `LEGACY_PRESERVE` 回放测试。该 ADR 在 C12.5 Exit Gate 前保持 `PROPOSED`，不授权真实 Provider、VPS、Veyra、部署或 Git 写入。

## ADR-0059：新生产提交必须消费已批准的 DeliveryPlanRevision

- 状态：`IN_PROGRESS`
- 日期：2026-08-29
- 影响章节：C11.7、C12.7A、C12；不改变历史无计划运行的读取、Provider 协议、默认 Mock、Veyra、VPS、DNS、部署或 Git 边界。
- 决策：Control API 的新 `ProductionRun` 命令必须显式携带 `delivery_plan_revision_id`。该 revision 必须属于同一 workspace/project、绑定同一 approved storyboard、状态为 `APPROVED` 且没有阻断原因。创建成功后在同一持久化事务内将计划转为 `CONSUMED` 并记录不可变的 production run 引用；幂等重放只返回原 run。`production_runs.delivery_plan_revision_id` 在数据库层保持 nullable，以便已存在的历史行继续可读，但没有该引用的旧运行不得被新 API 当作新的提交依据。当前迁移不声明反向复合外键，改由事务内的 workspace/project/storyboard 作用域查询、行锁和领域门禁共同保证引用一致性，避免循环表初始化导致的 Drizzle schema 递归类型问题。
- 原因：仅在路由前置查询批准状态会在重启、并发和多实例部署中产生批准检查与运行创建分叉；只在前端传递或隐藏按钮也不能构成领域门禁。把计划引用写入生产运行并由事务锁定计划，才能证明 Provider 调度使用的是经过批准且未被再次消费的交付事实。应用层的复合作用域校验是当前可验证的实际约束，不能在没有数据库外键的情况下宣称数据库已提供同等保护。
- 迁移/回滚：只向前增加 nullable 引用列和消费更新；不回填或改写历史运行。关闭新入口时保留历史读取，新的无计划生产命令仍拒绝，已消费计划不可重新批准或重复创建运行。若后续需要数据库级复合外键，必须另立 schema/迁移决策并先解决循环初始化与历史数据校验。
- 审计证据要求：Contract/OpenAPI 字段校验、Control API workspace/project/状态门禁、InMemory 与 Drizzle 幂等和消费测试、确认事件引用、Worker 重启恢复及公开 DTO/SSE 安全扫描。该 ADR 在独立验收前不授权真实 Provider、共享扣费、Veyra、VPS、SSH、DNS、部署或 Git 写入。

## ADR-0060：原仓库优先、薄壳适配和最小增量

状态：`ACCEPTED`

日期：2026-08-30

影响范围：所有参考仓库迁入、适配器、Runtime、规划器、Worker、Studio 及后续章节；不改变平台既有 Control API、领域、持久化、队列、工作区和审计边界。

上下文：近期旁白与音频编排增量出现了与来源语义重叠的自定义路径，导致样音/正式旁白身份混淆、分段旁白和完整旁白混用、AUTO 音乐静默缺失以及多个兼容协议继续扩张。平台需要一个比“尽量复用”更严格、可审计且能阻止过度开发的底层约束。

决策：

1. 只移植参考仓库固定 commit 中已有的代码、字段、参数、校验和流程；来源已有实现与平台契约兼容时，直接移植原代码或保持等价调用顺序。
2. 平台只允许在边界处增加输入/输出转换、workspace/权限校验、对象存储读写、错误归一化、任务幂等和公开脱敏等薄壳适配。平台自己的身份、Control API、持久化、队列和审计逻辑不被删除，但不得改变来源媒体/内容语义。
3. 禁止在来源能力之上另写平行算法、阈值、协议版本、自动改写、静默回退或 UI 状态含义。任何修改、删减、重命名或替换都必须注明具体来源文件/符号/规则、保留内容、平台适配点、舍弃原因和行为回归。
4. 来源没有安全对应实现、能力未认证或语义无法证明时，保持 `UNAVAILABLE`、`DEFERRED`、`BLOCKED` 或 fail-closed，不得用“先跑起来”补造逻辑。
5. 内存、数据库、Runtime、兼容读取器和 fixture 必须遵循同一来源语义；不允许只修一条实现或用静态源码检查冒充行为证据。
6. 先执行最小错误路径修正，再考虑扩展；扩展前必须有契约、来源登记、定向行为测试和审计 Exit Gate。原《AI企业内容生产平台_C12.4-C12.5最小化源仓库适配修改方案.md》已冻结为历史基线；当前 C12.4/C12.5 以《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》作为来源追踪、跨仓库冲突和逐项增量清单。

考虑过的方案：

- 整仓回滚到某一个参考仓库：拒绝，会丢失平台必要的模块边界、已验收本地 MVP 和 C11.2 事实链。
- 保留所有自定义兼容层并继续叠加：拒绝，会继续制造来源语义漂移和无法审计的分支。
- 仅保留平台外壳、把来源逻辑全部重写：拒绝，违背最大化复用和来源优先原则。

迁移/回滚：本 ADR 不要求立即删除历史代码或重写用户改动。后续回退只针对明确的活动路径，优先关闭/隔离自定义分支，保留历史快照和兼容读取；不得使用破坏性 Git 操作。旧协议和旧成片只有在有来源等价替代、行为测试和审计证据后才可移除。

审计证据要求：每个迁入或修改的适配模块都有来源登记；测试同时覆盖来源行为和平台边界；文档只引用最新可复核计数，历史计数明确标注为历史。该 ADR 不授权真实 Provider/TTS、Veyra、共享扣费、VPS、SSH、DNS、TLS、部署、付费调用或 Git 发布。

## ADR-0061：S03 独立旁白轨道载体边界

状态：`ACCEPTED`（仅 C12.4-S03 切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）

日期：2026-08-30

来源映射：OpenMontage `asset-director.md` 的 section narration asset（asset id/path/duration）、`edit-director.md` 的 `asset_id + start_seconds` 绝对 EDL，以及 `audio_mixer.py::_full_mix/_track_filters` 的 `{path, role, start_seconds, volume, fades}` 轨道语义。

平台边界：允许在现有 TimelinePlan/AudioPlan/ALCHMED8 内部兼容扩展逐轨已测 AUDIO 资产载荷；旧单 `narrationBytes` 必须保持兼容。Worker 只能通过既有 workspace/project Asset + StoragePort 读取并校验 bytes，Runtime 只能使用受控临时路径；不接受 URL、任意本地路径、第二套 AudioPlan 或新 magic。

本轮收口：现有 `TimelineNarrationSection`、`narrationAssetVersions` 与 `ProductionCompositionInput` 已在不新增公共协议的前提下支持按 PRIMARY section 全有或全无的正式非样音资产及独立实测 duration；ALCHMED8 复用既有私有载荷承载逐轨 bytes/track identity，Worker 通过已有 StoragePort 校验后交给 Runtime。Runtime 仅将受控临时文件映射为来源 `{path, role: "speech", start_seconds}`，调用 `full_mix.py` 对 OpenMontage `_full_mix` 的薄适配；旧单 `narrationBytes` 保持兼容，缺少独立事实仍 fail-closed。

证据：`services/media-runtime/tests/test_runtime.py` `101 passed`（含 payload identity、绝对窗口、时长不一致和 compose 接线路径）；`services/media-runtime/adapters/openmontage_audio/test_adapters.py` `11 passed`（含来源滤镜图、缺轨/非法 target fail-closed 和受控 ffmpeg/ffprobe 实际媒体夹具）；Production Worker `45/45`；Persistence `53 pass / 10 explicit DATABASE_URL-gated skip`；Contracts `36/36`；Domain `43/43`；根 `pnpm test` `452 passed / 18 explicit environment-gated skips / 0 failed`，typecheck/build 通过。未调用真实 Provider/TTS/Veyra/计费/网络/VPS/Git。

独立 Exit Gate 复核于 2026-08-30 完成，S03 标记为 `ACCEPTED`，仅表示本切片的来源等价、负向边界、Worker→Runtime 集成和受控媒体产物证据齐全，不宣称章节验收。approved full-track section-level windows、完整 AudioPlan 语义、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、REQUIRED 字幕事实链、中文口音及超长旁白 consumer 行为仍按总控文档保留为硬门；S04 仅按用户授权开始 `IN_PROGRESS`，不得提前标记完成。

## ADR-0062：Huobao 正式分镜段 8–15 秒边界

状态：`ACCEPTED`（仅 E03/HB-STORYBOARD-TIMING 8–15 秒迁移切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）

日期：2026-08-31

来源映射：固定 `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `backend/workspace/skills/storyboard-breaker/SKILL.md`。来源明确每个分镜段为 8–15 秒；台词容量按 `字符数 / 4.5 + 2 秒表演余量`，装不下时应沿来源边界移到后续段落。

决策：仅将平台 `StoryboardShotSpec` 的正式段时长契约和既有 `assertStoryboardPlan` 入口收口到 8–15 秒；规划器生成无法满足该边界的结果时复用既有 `STORYBOARD_SPEC_INVALID` 失败路径，不新增余数分配、慢放、填充、裁剪或 Provider 调用算法。`GenerationSegmentMotionPlan` 的 1–15 秒兼容 schema、`MotionBeat` 计数、editorial 评分、对话贪心分组和 remainder 分配与来源子镜头语义尚未完成等价映射，继续按 `UNREFERENCED`/冲突项冻结，不能借本 ADR 推广为已迁移。

证据：`@alchemy-video/creative-planning` `38/38`、`@alchemy-video/domain` `43/43`、`@alchemy-video/contracts` `36/36`，并已运行 `pnpm contracts:generate`；0 skip/fail。纠察员已独立复核并完成 READY→ACCEPTED 状态流程。未调用真实 Provider/TTS/Veyra/网络/VPS，未执行 Git 写操作。该 ACCEPTED 仅覆盖 8–15 秒边界切片，不覆盖 Huobao 2–4/2–6 子镜头、MotionPlan 或未映射规划语义。

## ADR-0063：按原仓库能力选择唯一语音 owner，禁止无条件后期 Piper

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED`（语音路线设计裁定；代码迁移和真实能力仍待各自章节审计） |
| 日期 | 2026-09-01 |
| 影响章节 | C12.4、C12.5、E12；不改变公共状态机、默认 Mock、历史运行、Veyra、计费、VPS、部署或 Git 边界 |
| 来源 | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `grok_video.py::GrokVideo`、`tts_selector.py::TTSSelector`、`piper_tts.py::PiperTTS`、`voice-performance-director.md`、explainer `asset-director.md`/`compose-director.md`/`executive-producer.md`/`audio_mixer.py::_full_mix`；Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `volcengine-video.ts`/`generation.ts`；Seedance `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` 的 sound policy |
| 上下文 | 当前平台把后期 Piper 作为所有新任务的权威旁白，导致正确的 Provider 原生人声被替换/静音，同时裸 script 进入 Piper 造成中文断句、读音和速度问题。来源明确区分 native audio、参考音频、TTS selector、Piper fallback 和样音 gate。 |
| 决策 | 先依据已固定且已认证的 profile 选择唯一 spoken/audio owner：native Provider owner 时保留其单次生成的实际音轨，不追加 TTS；TTS owner 时通过来源 `TTSSelector` 的 registry discovery、偏好、可用性和来源评分选择具体 provider；Piper 仅在明确选中时按原始 stdin/参数/`timeout=300` 执行。样音先审批、正式旁白独立且实测；最终时间轴和 `_full_mix` 只消费已证明的 owner/asset。 |
| 兼容 | 复用既有 AudioPlan/DeliveryPlan/Asset/TaskRun/ProviderPort；不新增第二套 AudioPlan 或通用 `generate_audio` 字段。Huobao 的 `generate_audio` 只在对应 provider adapter 有固定来源证据时使用，`reference_audio` 永远是输入参考。无法由现有契约表达 owner 时 fail-closed，先立契约/ADR。历史无 AudioPlan 任务继续 `LEGACY_PRESERVE`。 |
| 拒绝方案 | 拒绝平台 `PROVIDERS` 手工 tuple、auto 固定 Piper、无条件静音 Provider dialogue、自动 native→TTS 静默 fallback、pace 数值映射、atempo/rubberband、裁切/补静音、裸 script 直接合成和把样音当正式整轨。 |
| 迁移/回滚 | 先做 source owner/profile 事实和离线 fixture，再迁移 selector、sample gate、正式 asset、TimelinePlan 和 Runtime/Worker 分支；任何一环缺证据即保持 `UNAVAILABLE/BLOCKED`。回滚只关闭新 owner 路径或恢复旧兼容读取，不改写历史产物、不重提已成功 Provider。 |
| 审计证据 | Native fixture 必须证明音频保留且 TTS 调用次数为零；TTS fixture 必须证明 selector 选择、`provider_text`、原始参数、样音/正式资产和 WAV/实际时长；最终 fixture/产物必须证明 `_full_mix`、BGM/ducking、转写、末句、静音和 MIME/ffprobe。真实 Provider/TTS/中文口音仅在单独授权后验证；本 ADR 不授权外部调用。 |

ADR-0051/0052 中关于“所有新任务固定 `PLATFORM_NARRATION`/后期 Piper”的语音路线由本 ADR 覆盖；其自然语速、实际时长、历史兼容和禁止变速等非冲突边界继续保留，旧 ADR 原文不删除。

## ADR-0064：Doubao TTS 私有执行边界与 Runtime 阻断（历史快照，已 superseded）

| 项目 | 内容 |
| --- | --- |
| 状态 | `SUPERSEDED`（授权前仅 mapper 的历史快照；由 ADR-0065 覆盖） |
| 日期 | 2026-09-01 |
| 来源 | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/doubao_tts.py::DoubaoTTS`：`_headers`、`_submit_body`、`_poll_query`、`_generate`、`_audio_duration` |
| 上下文 | 来源 Doubao 执行链使用 `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`、`voice_id/resource_id`、MP3/OGG/PCM、submit→poll→download 和完整 query metadata；当前平台 Runtime narration DTO、`/internal/v1/media/narration` 和 Worker client 固定 Piper/WAV，且没有可核验的 owner/profile/registry 映射。 |
| 决策 | 只允许 `services/media-runtime/adapters/openmontage_audio/doubao.py` 内部保存来源字段、构建请求、执行显式 profile 的 source 顺序并返回私有产物事实；测试使用 mock transport。`DOUBAO_SPEECH_API_KEY` 只从进程环境读取且不写入结果/日志；默认 Mock、既有 Piper、selector auto 和现有 narration 路由保持不变。 |
| 契约边界 | 私有产物可携带 `audio/mpeg`、实际 SHA/字节数、task id、voice/resource、source format 和 query metadata；不把这些字段加入公开 DTO、通用 `MediaRuntimeNarrationRequest`、`VideoProviderPort`、AudioPlan 或 Sub2API mapper。 |
| 阻断 | 在现有 owner/profile 事实和跨进程 MP3 inspection/Storage 载体出现前，不把该 adapter 接入 `main.py`、`runtime.py`、Worker composition 或 selector；不能声称已启用 Doubao、中文口音或正式旁白资产。 |
| 审计证据 | 只接受固定 source 字段/调用顺序、显式 env/profile 缺失 fail-closed、submit/poll/download mock、MIME/SHA/metadata/时长事实和 secret redaction 测试；本 ADR 不授权真实 Provider 网络调用。 |

## ADR-0065：用户授权的 OpenMontage Doubao 显式 Runtime 薄壳（2026-09-01）

| 项目 | 内容 |
| --- | --- |
| 状态 | `历史 IMPLEMENTED / VERIFYING，当前 BLOCKED`（仅 E12/R01 显式 Doubao 窄切片；不代表 E12 或 C12.4/C12.5 完整验收） |
| 来源 | 固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/audio/doubao_tts.py::DoubaoTTS._headers/_submit_body/_generate/_poll_query/_audio_duration`；selector `TTSSelector._providers/_select_best_tool` |
| 授权 | 用户明确允许使用仓库外 `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`，profile=`seed-tts-2.0`/`zh_female_vv_uranus_bigtts`，进行一次真实 Runtime smoke；secret 不写入仓库、日志、fixture 或响应 |
| 决策 | 仅把 source submit→poll→download 链以薄壳落到 `doubao.py` → `runtime.py` → `main.py` 显式 `preferred_provider=doubao|doubao_tts` → Worker loopback；保留 source URL/header/body、voice/resource、format/sample-rate/speech-rate/timestamp/usage、poll/timeout、status/error、metadata 顺序。selector auto/unknown 无 registry 时 fail-closed，显式 Doubao 需 key，显式 Piper 保留旧离线兼容。 |
| 适配边界 | 只复用既有内部 bytes/MIME/SHA/size/ffprobe/临时目录/错误脱敏；source fields 是 loopback 私有字段，不扩散到公开视频 DTO、AudioPlan、UI、计费或第二协议。缺失 Content-Type 按 source 接受，MIME 由 source format 映射；Worker outer timeout 跟随 source `timeout_seconds`。 |
| 验证 | 本地 Media Runtime `151/151`、Doubao/selector adapters `24/24`、Worker Runtime Client `23/23`、handler explicit/auto fixtures、typecheck/py_compile/diff-check 全通过；用户授权真实 Runtime smoke 返回 `audio/mpeg`、`37212` bytes、bundled ffprobe `1850ms`。 |
| 未关闭 | source registry/rank 正向映射、native audio owner、正式 NarrationAsset/TimelinePlan、approved section windows、Studio 样音审批、REQUIRED 字幕、人工中文口音和超长 consumer 仍 `BLOCKED/DEFERRED`；不进入 R02，不升级 `ACCEPTED`。 |

ADR-0065 覆盖 ADR-0064 中“未接入 Runtime/Worker/Contracts/API、route disabled”的当前事实表述；ADR-0064 原文保留为授权前历史审计轨迹。

## ADR-0066：视频生成快照记录来源音频 owner

| 项目 | 内容 |
| --- | --- |
| 状态 | `IMPLEMENTED_PENDING_AUDIT`（R01 最小 owner 适配；不代表 R01/E12 或 C12.4/C12.5 完整验收） |
| 日期 | 2026-09-01 |
| 来源 | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/video/grok_video.py::GrokVideo.supports["native_audio"]`；`tools/audio/tts_selector.py::TTSSelector` 的显式 provider 选择边界 |
| 决策 | 在现有私有 `VideoGenerationInputSnapshot` 增加可选 `audio_owner`，仅记录 `NATIVE_PROVIDER`、`TTS` 或 `LEGACY_PRESERVE`。`sub2api/grok-imagine-video-1.5` profile 映射为来源声明的 `NATIVE_PROVIDER`；Mock profile 不写入该字段。Workflow/Control API 只把该事实写入不可变快照和私有 capability snapshot，不扩展公开 TaskRun DTO、VideoProviderPort 或通用 `generate_audio`。 |
| 生产消费 | Persistence 读取已接受片段的 owner：全部明确为 `NATIVE_PROVIDER` 或 `LEGACY_PRESERVE` 时保留片段实际音轨并跳过平台 TTS；任一片段 owner 缺失、非法或与其它片段不一致时 fail-closed；历史全无 owner 的任务继续旧兼容行为。原生 owner 与 approved platform narration timeline 同时存在时阻断，避免双重音轨。 |
| Prompt | Creative-planning 与 provider prompt compiler 在 `NATIVE_PROVIDER` 下不生成“platform narration supplies final audible speech / provider must not carry audible dialogue”抑制语义；其它 owner/历史调用保持原有来源对齐提示。 |
| 拒绝方案 | 不新增 `generate_audio` 公共字段、第二 AudioPlan、硬性用量/金额上限、native 失败后的静默 TTS/Piper 回退、手工 provider tuple、变速/补静音/裁切或新的评分协议。Doubao 仍只能由已有显式 `preferred_provider` 路径调用。 |
| 证据 | Provider/runtime snapshot、prompt compiler、creative-planning native/legacy 正负 fixtures；Persistence owner 一致性单测。真实 Provider/TTS、人工中文口音和正式 NarrationAsset/TimelinePlan 仍需独立实测/审计，不在本 ADR 中自动接受。 |

ADR-0066 只解决 owner 事实的最小表达与消费边界；R02 selector registry/rank、R03 样音/正式资产、完整 TimelinePlan、section windows 和人工听感仍按总控文档保持 `DEFERRED/BLOCKED`。

## ADR-0067：自动生成样音与正式旁白资产（覆盖用户上传前提）

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED`（仅作为 R01 实施基线；代码、真实产物和人工验收仍需独立 Exit Gate） |
| 日期 | 2026-09-01 |
| 来源 | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md`、`tools/audio/tts_selector.py`、`tools/audio/doubao_tts.py`、`tools/video/grok_video.py`；Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 仅用于区分 `reference_audio` 与 provider-specific `generate_audio` |
| 决策 | 自动视频流程不要求用户上传旁白或样音。先依据固定来源和已认证 profile 选择唯一 audio owner：Grok native owner 保留 MP4 音轨且不调用 TTS；操作者明确选择替换时，按来源 Doubao submit→poll→download 生成服务器样音，人工审批后再生成独立正式 `NarrationAssetVersion`。样音行不得直接作为正式旁白或 TimelinePlan 资产。 |
| 兼容 | 既有通用图片、资料、Logo、MUSIC 上传及 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 角色继续保留；后两者仅用于兼容和隔离测试，不构成当前自动旁白输入。现有 `sample_asset_id` 仍可表示服务器生成样音，正式资产/TimelinePlan 继续使用已有契约。 |
| 禁止 | 不默认 Piper、不自动 native→Doubao fallback、不自动审批、不把 Huobao `reference_audio` 跨映射成 Grok 旁白、不新增第二 AudioPlan/协议、数值语速映射、时长修正、变速、裁切、补静音或口型算法。 |
| 证据与状态 | 必须分别记录 provider/voice/settings、实际 MIME/SHA/bytes/ffprobe duration、sample approval、正式资产与绝对 section windows；静态命中、fixture 或一次 canary 不能替代人工中文听感。公共字段不足时先补 ADR/契约再实现；证据不足保持 `UNAVAILABLE`/`BLOCKED`。默认 `VIDEO_PROVIDER=mock` 不变。 |

ADR-0067 覆盖旧 ADR/设计文档中把用户上传样音写成当前必需输入的语义；旧文本保留为历史审计上下文，不删除、不回写历史产物。

## ADR-0068：R01.2 服务器样音与正式旁白资产的内部执行边界

| 项目 | 内容 |
| --- | --- |
| 状态 | `IMPLEMENTED_PENDING_AUDIT`（内部边界已落代码；不升级 R01/E12 或总体状态） |
| 日期 | 2026-09-01 |
| 来源 | 固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`skills/meta/voice-performance-director.md` 的 `voice_performance`/Sample Gate；`skills/pipelines/explainer/asset-director.md` 的 Sample Preview/Generate Narration；`tools/audio/tts_selector.py::TTSSelector` 与 `tools/audio/doubao_tts.py::DoubaoTTS` |
| 决策 | R01.2 若实现，只能由 Control API 在事务内登记现有内部命令事实并写入既有 outbox，由现有 Media Runtime queue/Worker 调用已有 Runtime/Storage 端口。样音与正式 `NarrationAssetVersion` 必须是两个服务器生成的 `AUDIO/GENERATED` 资产；样音必须先获得显式人工审批，不能自动审批、不能要求用户上传旁白或样音。正式资产只能在审批事实之后独立生成、实测并以 `sample_approved=false` 注册，TimelinePlan 只能消费该正式版本。 |
| 事实绑定 | 样音和正式资产必须绑定同一 approved script revision、来源 `provider_text`/delivery cues、显式 provider、voice、provider settings；正式资产另须保存实际 MIME、SHA-256、byte size 和 Runtime/ffprobe `duration_ms`。现有 `sample_asset_id` 只能作为审批所听样音，不能直接升级为正式资产。 |
| Provider 边界 | native owner 继续保留 Provider MP4 音轨且不调用 TTS；替换只允许调用方明确选择已有 Doubao 路径并满足其现有 key/profile guard。Piper 仅保留显式兼容路径，不得默认或作为静默 fallback。Control API 不得直连 Provider/TTS，Worker 不得从 composition 偷渡样音生成。 |
| 复用与禁止 | 优先复用现有事务幂等、outbox、Media Runtime queue、Worker、Storage、Asset 和 `NarrationQualityStore`。不得新增第二音频协议、第二 AudioPlan、独立状态机、时长修正/变速/裁切/补静音、Provider 选择算法或公开敏感字段；任何新增内部 DTO/event 必须在契约中版本化并逐字段映射固定来源。 |
| 当前审计结论 | R01.2 已按本 ADR 补齐内部 `narration_audio.generation_requested` DTO/event、`NarrationQualityStore` 服务器生成资产操作、既有 Media Runtime queue/Worker/Storage 消费和 provider/voice/settings identity/幂等校验；定向本地 fixture 已通过。代码没有新增公开 `narration-audio` 路由，Studio 的生成→试听→批准→正式资产→TimelinePlan 触发闭环、真实产物和人工听感仍未闭合，因此 R01.2 与 E12 继续 `BLOCKED`，不得标记 `READY_FOR_AUDIT`/`ACCEPTED`。 |

ADR-0068 不改变公开 API、TaskRun/AudioPlan 语义或默认 Mock 配置；它只把 R01.2 的最小安全执行边界和当前阻断事实固定下来。

## ADR-0069：Video VPS 固定 relay 与参考图提交前预检

| 项目 | 内容 |
| --- | --- |
| 状态 | `IMPLEMENTED_PENDING_AUDIT`（仅 C09-C 参考图交付稳定性切片） |
| 日期 | 2026-09-05 |
| 范围 | Aiself/Alchemy Video OS 的 Video VPS、Control API 与 task-worker；不包含 Sub2API/Smart Router |
| 背景 | 生产 `video.aiself.vip` 位于独立 Video VPS，当前直连 Control API；本地 Quick Tunnel 曾出现随机域名和 DNS/QUIC 超时。KIE/Grok 在提交阶段无法读取参考图时不产生 provider request id，原有泛化错误难以区分 relay 故障。 |
| 决策 | Worker 对自己签发的同源 opaque `provider-input` URL 在 ProviderAttempt 创建前做 HEAD 预检；HEAD 不可用时受限 GET 验证 MIME/字节数；网络/408/429/5xx 仅做有界预检重试。生产默认 origin 固定为 `https://video.aiself.vip`，token TTL 提升至 15 分钟但限制在 60 秒–1 小时。Edge 保持无认证、无缓存、流式转发并显式设置超时。 |
| 安全边界 | 预检不接受用户 URL、不跟随跨 origin 重定向、不记录 token/URL；继续使用 AES-GCM、workspace/project/asset/hash/MIME/8 MiB 校验。Control API 的无内容错误响应显式 `Content-Length: 0`。 |
| 兼容/计费 | Mock 模式不访问网络；文本任务不预检。预检失败在 ProviderAttempt/Provider POST 前归一为既有可恢复 `PROVIDER_UNAVAILABLE`，不会创建上游任务或额外计费。已有 provider request id 的恢复与“不重复提交”规则不变。 |
| 拒绝方案 | 不修改 Sub2API、Smart Router、Provider 协议、调度策略、轮询/提交最大次数；不把 generations 自动改为 edits，不把 KIE 文件上传协议混入本切片。 |
| 证据要求 | 必须有 task-worker/control-api 定向测试、build/typecheck、Video VPS edge/Control API/Worker relay 只读健康检查；真实付费 Provider 生成不是本 ADR 的验收条件。 |

ADR-0069 只解决 Aiself 自有参考图交付链路的可达性与可审计性，不宣称 KIE 上游稳定性、余额或权限已被改变。
