# C07 上游复用矩阵：SUB2API 离线 Adapter

状态：`ACCEPTED`（仅授权受限 Git 备份；远端 ref 复核前不得启动 C08）
日期：2026-08-14
章节边界：只实现离线 `Sub2ApiVideoProvider`、可注入 transport、请求/响应 mapper、错误归一化、脱敏 fixture、仅内部且默认 disabled 的 capability registry/snapshot，以及 `CONTRACT-001` 至 `CONTRACT-008`。不进行真实 HTTP、Key 读取、Veyra/共享积分、C08 认证或 C09 计费。

## 1. 来源与固定版本

| 来源 | 固定版本 | 本机事实 | C07 用途 |
| --- | --- | --- | --- |
| `sub2api-video-mcp` | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | 只按来源登记中的协议基线参考；不在 C07 将 MCP server、凭据或完整快照复制进平台 Git | 三段式视频接口、字段命名、提交/查询/下载语义 |
| `huobao-drama` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | 本机 `upstream/huobao-drama` 仅供溯源，已被 `.gitignore` 排除 | 借鉴 Provider adapter 的职责分层和既有字段意图；不迁入其直接 HTTP 实现 |
| 平台 C06 `@alchemy-video/provider-video` | C06 accepted `1e192c71cfda4636ef457eadc50ad4acafc895b3` | 平台现有端口和协议错误类型 | 以现有 `VideoProviderPort`、`VideoGenerationInput`、`ProviderStatus` 为唯一内部边界 |

`upstream/` 不是 C07 的提交来源目录，也不会作为 submodule、gitlink、subtree 或完整快照进入平台 Git。C07 只登记协议和经过审计的薄适配，不声称把外部 MCP 代码迁入平台。

## 2. 复用矩阵

| 目标模块 | 上游文件 / 符号 / 变量 | 平台薄适配位置 | 保留内容 | 舍弃内容与最小修改理由 | 回归测试 |
| --- | --- | --- | --- | --- | --- |
| 请求字段 mapper | `sub2api-video-mcp` 的视频生成请求边界；`model`、`prompt`、`duration`、`resolution`、`ratio`、`image.image_url` | `packages/provider-video/src/sub2api/mapper.ts` | 保留外部 snake_case 字段和可选图生嵌套字段。端口内可选 `referenceImageUrl` 是服务端在执行时解析的短时读取 URL，不进入冻结 `input_snapshot` | 舍弃 MCP 工具参数包装、会话状态和任意浏览器 URL；C07 不接入对象 URL 解析器，未来调用端必须在工作区授权后显式注入该临时 URL，避免外部协议污染领域模型 | CONTRACT-001、002 |
| 提交/查询/下载路径 | `sub2api-video-mcp` 的 `POST /videos/generations`、`GET /videos/{id}`、`GET /videos/{id}/content` | `packages/provider-video/src/sub2api/adapter.ts` | 保留三段式路径、`request_id`/`id`、`status`/`state` 的兼容读取，以及下载 `Content-Type`/`Content-Length` metadata | 不复用 MCP server、工具注册、进程内轮询和任务事实；transport 由构造器注入，持久化恢复由 C06 Worker 负责，且 C06 只能按实际 metadata 校验下载 | CONTRACT-003、004、005 |
| Provider 端口接入 | Huobao `backend/src/services/adapters/types.ts` 的 `VideoGenerationRecord`、`VideoProviderAdapter`；`backend/src/services/generation.ts` 的 submit/poll 职责切分 | 现有 `packages/provider-video/src/port.ts`，新增 `sub2api/adapter.ts` | 保留 `model`、`prompt`、参考图、提交/状态/下载阶段意图 | 不导入 Huobao 的 `AIConfig`、MySQL、全局 registry、直接 Provider 请求、进程内任务状态或无限定时器；平台统一通过 `VideoProviderPort` | CONTRACT-001 至 005、端口 typecheck |
| HTTP transport | 上游协议所需的 HTTP 动词、路径、JSON body 和响应 metadata | `packages/provider-video/src/sub2api/transport.ts` 的可注入接口；测试使用 in-memory fake | 保留 request method/path/body/headers 的可观察边界，支持响应状态、headers、JSON 和流 | 不在 adapter 内调用全局 `fetch` 以隐藏网络；生产 transport 只作为后续显式装配点，C07 测试 transport 不联网、不读环境 Key | CONTRACT-001 至 007、无网络断言 |
| 错误归一化 | 上游 HTTP 状态与业务失败状态的协议事实 | `packages/provider-video/src/port.ts` 与 `sub2api/errors.ts`，复用 `VideoProviderProtocolError` 和平台应用错误分类 | 将不可解析响应归为 `PROVIDER_PROTOCOL_INVALID`；统一 typed failure 含 `code/retryable/stage`，明确区分拒绝、暂不可用和下载响应错误 | 不暴露上游文案、Authorization、签名 URL 或完整 response；C06 按 stage 保留错误，不把拒绝/404 降级为可重试。查询 `429/503` 在已提交边界内保持 `PROVIDER_PROCESSING` 并由 delivery 重试，避免错误终态化或重提 Provider | CONTRACT-006、007、008，跨包 Worker 回归 |
| 脱敏 fixture | 认证规范中的合成 response fixture 约束 | `fixtures/providers/sub2api/` 与 `packages/provider-video/tests/` | 使用 `req_fixture_001`、`https://example.invalid/...`、最小 JSON 和字段名 snapshot | 不保存真实 request ID、私有 prompt、对象 key、签名 query、Bearer、Cookie、视频二进制或认证报告 | CONTRACT-003、006、008 |
| capability registry / snapshot | 认证规范 4.2 的 `VideoProviderProfile` 和 `video.provider.sub2api.<profile>.enabled` 规则 | `packages/provider-video/src/sub2api/capabilities.ts`，只由 adapter 组合根读取；不由 Control API/Studio 导出 | 新增版本化内部 registry，候选 Grok profile 固定 `enabled: false`；保留 profile 字段、disabled 原因和未认证边界 | 不猜测未认证 Seedance 的 model、时长、分辨率、比例或认证日期；不实现公开 `GET /capabilities/video`、不将 registry 传给浏览器、不改变 `VIDEO_PROVIDER=mock`。C08 在用户授权实测后才可追加认证 snapshot 并启用 profile | registry 单测：全部 profile disabled；公开 contracts/OpenAPI/Studio 无模型列表；无环境 Key 读取 |

## 3. CONTRACT-001 至 CONTRACT-008 实施清单

| 编号 | 断言 |
| --- | --- |
| CONTRACT-001 | 最小文生视频只发 `POST /videos/generations` 及约定字段，不夹带平台内部字段 |
| CONTRACT-002 | `referenceImageUrl` 只映射为 `image.image_url`，不发送平台 object key 或签名 query |
| CONTRACT-003 | 脱敏提交响应的 `id` 或 `request_id` 映射为非空 `providerRequestId` |
| CONTRACT-004 | processing/status fixture 映射为 `PROCESSING`，不会触发 download |
| CONTRACT-005 | succeeded fixture 映射为 `SUCCEEDED`，download 返回流、实际 MIME 和可用长度；C06 以 metadata 校验字节、SHA-256、长度和 `ffprobe` |
| CONTRACT-006 | 上游明确失败映射为带 `PROVIDER` stage 的 `PROVIDER_REJECTED`，只保留脱敏错误摘要和 retryable 语义；查询 `429/503` 为 `PROVIDER_UNAVAILABLE/retryable=true`，C06 delivery 重试只查询、不重提 |
| CONTRACT-007 | 缺少 ID、状态或 JSON 结构非法映射为 `PROVIDER_PROTOCOL_INVALID`；下载 404/metadata 无效映射 `DOWNLOAD_INVALID`，都不能因为错误而重提 |
| CONTRACT-008 | fixture、错误和审计摘要扫描拒绝 Authorization、Bearer、Cookie、签名 URL query、真实 Key、object key 和完整原生 payload |

### Capability registry 离线断言

1. C07 新建的内部 registry/snapshot 只能列出明确的候选 metadata；每个条目必须为 `enabled: false`。
2. 未经 C08 实测，不写入 Seedance 精确 model、`durations`、`resolutions`、`ratios`、`certifiedAt` 或 `evidenceId`；空候选集合优先于猜测值。
3. `VIDEO_PROVIDER=mock` 仍是唯一默认运行时选择；C07 不在 Worker 装配 `Sub2ApiVideoProvider`，也不读取任何 Provider Key。
4. Contracts/OpenAPI、Control API 和 Studio 均不得导出或显示该内部 registry、候选 model 或 enabled flag。

## 4. 模块边界与后续工作

- C07 不改 `TaskRun` 状态机、ProviderAttempt 持久化、队列消息或公开生成 API；C06 Worker 继续是调用端口的唯一运行时消费者。
- `VideoGenerationInput.referenceImageUrl` 仅是 ProviderPort 的可选、短生命周期执行参数，不是公开 DTO、TaskRun 快照、事件、日志或数据库字段；C07 不在 Worker 中解析或装配它。
- C07 新增的 capability registry/snapshot 只在 `@alchemy-video/provider-video` 内部读取，所有 profile 默认 disabled；它不是公开模型列表、feature flag 写入器或 Worker 装配开关。
- C07 不读取 `SUB2API_VIDEO_API_KEY`、`.env.local` 或任何系统密钥存储。transport 的真实实现和显式 Key 装配留给 C08，并要求用户先指定 profile、次数、额度和素材。
- C07 不实现 `VeyraIdentityAdapter`、`CreditPort`、预检/扣费、usage receipt 或 `VEYRA_AUTH_ENABLED=true`。
- 默认 `VIDEO_PROVIDER=mock`、`CERTIFY_LIVE_VIDEO=false` 不变；C07 的离线 fixture 不会改变默认 Provider，也不会出现在公开 capabilities。
- 任何真实响应字段的固定、profile enable 或认证报告必须在 C08 重新审计，不能以本地 fixture 推断线上能力。

## 5. 预期验证证据

1. `packages/provider-video` typecheck/test 在无网络、无 Key、无 `.env.local` 下通过，内部 capability registry 的候选 profile 均断言为 disabled。
2. `CONTRACT-001` 至 `CONTRACT-008` 均由可读 fixture 和可注入 fake transport 覆盖；测试中断言未调用全局网络。
3. 公开 contracts/OpenAPI/Studio 的扫描证明没有 capability registry、候选 model 或 enabled flag；`pnpm contracts:generate`、根 typecheck/test/build 不出现生成物漂移或敏感字段。
4. 在 `READY_FOR_AUDIT` 阶段，`git ls-files --stage -- upstream` 与暂存区均为空；审计接受后才允许受限暂存、提交、推送和 tag。无论阶段如何，`upstream/`、`.env*`、媒体、测试输出与本地卷都不得进入 C07 提交。

## 6. 已完成实现与审计退回（2026-08-14）

- 实际迁入 C07 文件：`packages/provider-video/src/sub2api/{adapter,capabilities,errors,mapper,transport}.ts`、`packages/provider-video/tests/sub2api-*.test.ts`、`packages/provider-video/tests/support/fake-sub2api-transport.ts` 与 `fixtures/providers/sub2api/` 合成 JSON/text fixture。没有复制上游完整文件或媒体二进制。
- 初始离线 Provider 测试曾通过 `19/19`，但审计发现旧 `download()` 只交付 stream，且 C06 未能消费 typed failure；该证据不足以满足 CONTRACT-005 至 007，C07 已回退 `IN_PROGRESS`。
- 纠正目标：端口改为 `{ stream, mimeType, contentLength? }`，Mock/Sub2API/C06 全链路以真实 MIME 和长度检查；`VideoProviderFailure` 将 `code/retryable/stage` 交给 C06，新增 injected fake transport 跨包回归覆盖 rejected submit、download 404/错误 MIME 与暂时 503 后不重提。
- 无论修复结果如何，C07 继续禁止外部 HTTP、Key、Veyra、Worker/API/Studio 装配、C08+ 和 Git 写操作。

### 6.1 审计纠正实现证据

- ADR-0027 将平台内部端口修订为 `ProviderDownload { stream, mimeType, contentLength? }` 与 `VideoProviderFailure { code, retryable, stage }`。这是平台薄适配，不复制上游 HTTP 客户端、凭据或业务状态；Mock 和 injected Sub2API transport 同时实现该端口。
- C06 现在按 adapter 实际返回的 MIME、可用长度、SHA-256 和 `ffprobe` 验证下载；缺失/错误 MIME、错误长度及 404 均收敛为不可重试 `DOWNLOAD_INVALID`。下载或轮询的临时 `503/429` 在已提交边界内保持可恢复；轮询保持 `PROVIDER_PROCESSING` 并由现有 delivery/恢复循环查询，所有已有 `provider_request_id` 路径只查询/下载，回归断言仍为一次 submit。
- 历史 ADR-0027 复证中，`pnpm --filter @alchemy-video/provider-video typecheck` 与离线 CONTRACT suite `22/22`、完整本地 Worker PostgreSQL/Redis/MinIO suite `22/22` 均通过。最新 ADR-0028 复证新增轮询 `429/503` 后，Provider suite 为 `23/23`，无服务变量的 Worker suite 为 `18` 通过、`5` 个既有集成 skip，带本机 PostgreSQL/Redis/MinIO 的 Worker suite 为 `23/23`。
- 再次通过 `pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build`、`pnpm db:generate` 无漂移、显式 `DATABASE_URL` 的 `pnpm db:migrate`、Persistence `12/12`、BullMQ `1/1`、MinIO `1/1` 和 Compose health。
- 扫描确认 adapter source 不含默认 fetch、env/dotenv、Key、Authorization/Bearer/Cookie、object key 或签名 query；`apps/` 对 adapter 的仅有引用在 Task Worker 测试中，非运行时装配。C07 已由独立审计接受，且 `origin/main` 与 `c07-accepted^{}` 已复核为 `41d414cf1b6767c39f251445278831328e1620cf`；旧 `IN_PROGRESS` 与 `READY_FOR_AUDIT` 叙述仅为历史审计轨迹。C08 只能在另行取得真实调用明确授权后认证 profile。
