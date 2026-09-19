# AI 企业内容生产平台：C08 认证准备与测试矩阵

## 1. 当前结论

状态：`ACCEPTED`。C07 已完成离线 adapter 的远端备份复核：`origin/main` 与 `c07-accepted^{}` 均为 `41d414cf1b6767c39f251445278831328e1620cf`。C08 已按 Grok-only 的受限授权完成一次 `LIVE-GROK-001` 文生提交和同一 request 的 GET-only 恢复；下载的实际 MIME、长度、SHA-256 和 ffprobe 均通过。认证报告和由其派生的 local capability snapshot 均为 hash-only、受忽略的本地证据。

认证所需的 Key 仅在两次精确 live 命令的当前进程中从用户提供的已忽略本地环境读取，未输出、记录或提交。现在调用上限已耗尽，不得再次执行 stop-after-submit 或 resume，不得向 SUB2API 发送请求，不修改 `VIDEO_PROVIDER`，不启用 capability profile，也不访问 VPS、Veyra、共享积分、DNS 或部署资源。C09 及后续章节保持 `PENDING`，本轮不执行 Git 操作。

## 2. 输入来源与复用边界

| 来源 | 固定版本 | C08 可复用内容 | 必须重新认证的内容 |
| --- | --- | --- | --- |
| `sub2api-video-mcp` | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | `POST /videos/generations`、`GET /videos/{id}`、`GET /videos/{id}/content` 的协议假设；提交、轮询、下载的职责拆分 | model ID、参数可用范围、状态字段、下载 headers、账号线路和额度实际行为 |
| C07 `Sub2ApiVideoProvider` | `c07-accepted^{}` = `41d414cf1b6767c39f251445278831328e1620cf` | injected transport 边界、mapper、typed failure、实际 MIME/长度下载 DTO、脱敏 fixture 和恢复不重提语义 | 任何候选 profile 的可用性；内部 snapshot 中的 `enabled: false` 不是认证结论 |
| SUB2API 视频能力认证与测试夹具规范 | 当前仓库文档 | 认证保险、用例编号、报告脱敏规则、CONTRACT-001 至 CONTRACT-008 | 不替代用户的本次授权和 live evidence |
| [xAI 官方模型与定价文档](https://docs.x.ai/docs/models)（审计复核） | 审计员于 2026-08-14 访问并复核；A 段不联网复抓 | `grok-imagine-video-1.5` 的文生、duration `1..15`、480p `USD 0.08/秒`，仅用于成本最低输入选择和本地预算 guard | 不是 SUB2API 协议或认证事实；不得据此猜测其 model、状态、ratio、下载 header 或响应字段 |

本章不复制上游源码，也不把 `upstream/` 纳入 Git。C07 已有的合成 fixture 仅作离线回归，不可改名为真实响应 fixture。

## 3. 实时认证授权关卡

开始任意一次真实请求前，必须由用户明确给出以下四项。当前授权已收敛为下表的唯一组合；任何偏离都必须保持离线并报告 `LIVE_CALLS_SKIPPED`。

| 必填授权 | 需要明确的值 | 约束 |
| --- | --- | --- |
| 目标 profile | `grok-imagine-video-1.5` | 只验证文生；禁止图生、Seedance 和第二 profile；profile 继续 disabled |
| 调用上限 | 总 `1` 次 submit | 只允许 `LIVE-GROK-001` 的一次 POST；恢复只查询/下载同一 `provider_request_id` |
| 额度上限 | `USD 1.00` | 本地 cents guard 必须证明固定估算 `USD 0.08` 不超过上限；不访问 Veyra 或执行扣费 |
| 测试素材 | 无品牌、无人像、无用户资产的合成文生 prompt | 固定为最低成本 `duration=1`、`resolution=480p`、`ratio=16:9`、`reference_asset_ids=[]`；不得传 reference image |

Key 只能由用户放入未提交的本地安全环境或操作系统密钥存储。认证实现只在用户明确批准后检查其注入是否满足启动保险；Key、Token、ticket、URL query 和原始 header 均不得出现在终端输出、fixture、日志、数据库、事件、报告或 Git diff 中。

原始 `provider_request_id` 的唯一允许恢复位置固定为 `tools/sub2api-video-certifier/recovery/`。`.gitignore` 只忽略该目录内容，并只允许未来保留不含运行数据的 `.gitkeep`；live certifier 必须在创建目录时限制文件系统权限给运行它的单一 OS 身份。实现不得把 raw ID 写入 `tmp/`、`temp/`、系统临时目录、reports、日志、数据库、事件、fixture、浏览器或其他任意临时位置。唯一 POST 前必须在该目录原子写入无 raw ID 的 submission reservation；reservation、报告、regular recovery 或 active claim 任一存在均永久禁止第二 POST，即使前次网络结果不明。`--stop-after-submit` 是唯一可创建 raw recovery 的受控中断：raw state 最多保留 `15` 分钟。每次精确 `--live --resume` 以一个无 raw ID 的 active claim 串行执行，只可 GET/poll/download；retryable poll/download 可在 TTL 内经后续显式 resume 继续，绝不 POST。过期状态必须在无网络时删除；成功、不可重试最终失败、超限和其他受控退出均删除 raw recovery。

## 4. 认证执行顺序

获授权后的 C08 实现与执行必须按以下顺序，并且每一步失败都停止后续提交：

1. 保持 Mock 为默认路径；certifier 只有参数精确为 `--live --profile grok-imagine-video-1.5 --max-submissions 1 --budget-usd 1.00`，且附带 `--stop-after-submit` 或 `--resume` 时，才允许读取安全环境并创建仅供该工具使用的 transport；其他路径只输出 `LIVE_CALLS_SKIPPED`，不读 env、不 fetch。
2. 先跑 C07 离线合同和静态脱敏扫描，确认 public API、Worker、Studio 均未装配 profile，capability snapshot 仍 disabled。
3. 在 B 段只执行一次 `LIVE-GROK-001` 的最低成本文生提交，并以 `--stop-after-submit` 写入唯一 recovery state。持久化或报告只保存请求/响应字段名、安全状态摘要和 `provider_request_id` 的 SHA-256 hash。
4. 以精确的 `--live --resume` 命令取得唯一 active claim，查询/下载同一请求并执行媒体校验；retryable poll/download 在有界 GET-only 尝试后可释放 claim 并在 TTL 内由后续 resume 继续。不得图生、Seedance、第二 profile 或第二 POST。
6. 下载必须检查 HTTP `2xx`、实际 MIME、可用内容长度、非空字节、SHA-256 和 `ffprobe`。任何失败都保持 profile disabled，且不替换已有成功产物。
7. 仅当提交、轮询、下载与媒体校验全部通过，才生成版本化的、脱敏 capability snapshot 和仅本地保存的认证报告。浏览器公开能力仍需后续受控 API 工作，不能由环境变量或本章计划直接暴露。

## 5. 离线 Fixture 与测试矩阵

下表是 C08 开始前必须保持可复现的无网络基线。所有数据为合成内容，URL 仅可使用 `example.invalid`，且检查不得包含 `Authorization`、`Bearer`、`Cookie`、object key、签名 query、真实 request ID 或媒体二进制。

| 编号 | 层级 | 场景 | 预期 | 实现/证据位置 |
| --- | --- | --- | --- | --- |
| `C08-OFF-01` | Provider mapper | 文生请求 | 仅映射 `model`、`prompt`、`duration`、`resolution`、`ratio` | C07 `CONTRACT-001` |
| `C08-OFF-02` | Live guard | 图生、Seedance、第二 profile 或非精确参数 | `LIVE_CALLS_SKIPPED`，零 env read、零 fetch、零 POST | certifier guard tests |
| `C08-OFF-03` | Submission | `id` 与 `request_id` 兼容、缺失 ID 拒绝 | 非空 ID 才持久化；结构异常为 `PROVIDER_PROTOCOL_INVALID` | C07 `CONTRACT-003`、`CONTRACT-007` |
| `C08-OFF-04` | Polling | `status` 与 `state`、处理中、429/503 | 已提交任务保持 `PROVIDER_PROCESSING`；只查询恢复，submit count 不增加 | C07 `CONTRACT-004`、`CONTRACT-006`、Worker 跨包回归 |
| `C08-OFF-05` | Download | 2xx、流读取、`video/mp4`、长度、SHA-256、ffprobe | 单次 GET-only 尝试必须覆盖下载、流读取和验证；流中断归一为可恢复 `PROVIDER_UNAVAILABLE/DOWNLOAD`，404、缺失/错误 MIME、非法长度和 ffprobe 失败为最终 `DOWNLOAD_INVALID` | C07 `CONTRACT-005`、`CONTRACT-007`、C06 worker tests、certifier stream recovery tests |
| `C08-OFF-06` | Errors | 拒绝、临时不可用和下载错误 | 保留 `code`、`retryable`、`stage`；拒绝不重试，暂时故障恢复不重提 | C07 `CONTRACT-006`、typed failure regressions |
| `C08-OFF-07` | Privacy | fixture、错误和报告输入扫描 | 只保留安全字段名、`provider_state` 与 `classification/code/stage/retryable`；拒绝认证 header、签名 URL、对象 key、Cookie、message 和原始 payload | C07 `CONTRACT-008`、certifier 报告回归、静态扫描 |
| `C08-OFF-08` | Capability | 未认证 profile | 内部 snapshot immutable 且 `enabled: false`；没有 OpenAPI、API 或 Studio 模型列表导出 | `sub2api-capabilities.test.ts` |
| `C08-OFF-09` | Certifier | 精确 live guard、预算/次数、本地 HTTPS、hash-only report | 不满足 guard 时零 env/fetch；精确 `1s/480p/16:9` 输入的估算 `USD 0.08` 不超过 `USD 1.00` | certifier injected fake transport tests |
| `C08-OFF-10` | Recovery | stop-after-submit、submission reservation、active claim、15 分钟 TTL | 原始 ID 仅位于 recovery；resume 只 GET；retryable poll/download 保留 state 供 TTL 内继续恢复；成功/不可重试失败/过期/超限清理 raw state，永远不能第二 POST | certifier recovery lifecycle tests |

真实认证不得把原始响应覆盖这些 fixture。协议漂移须单独生成合成且脱敏的新 fixture，并更新 mapper 测试与来源登记后再考虑下一次认证。

## 6. 有界 Live 用例矩阵

下表仅在授权关卡完整满足后可执行。每一行均需要用户授权的调用上限尚有余额；没有自动续跑或自动切换 profile。

| 编号 | 前置 | 最多 submit | 成功标准 | 失败后的系统行为 |
| --- | --- | --- | --- | --- |
| `LIVE-GROK-001` | A 段已获 `READY_FOR_LIVE` 审计；精确参数和 HTTPS 安全环境均通过 | 1 | reservation 后以 `--stop-after-submit` 用 `1s/480p/16:9` 提交一次；TTL 内可由 active claim 串行执行 `--resume` 查询、下载、MIME、长度、SHA-256、ffprobe | 保持 disabled，记录 `REJECTED`、`UNAVAILABLE` 或 `PROTOCOL_DRIFT` 的脱敏报告；绝不第二 POST |
| `LIVE-GROK-002` | 未授权 | 0 | 不执行图生 | `LIVE_CALLS_SKIPPED` |
| `LIVE-GROK-003` | `LIVE-GROK-001` 的未过期 recovery state | 0 | 一个 active claim 下的显式 `--resume` 仅 GET/poll/download；短暂错误可在 TTL 内再次 resume | active claim、过期或无状态均不触发 POST；reservation 永远禁止第二 submit |
| `LIVE-SED-001` | 未授权 | 0 | 不执行 | `LIVE_CALLS_SKIPPED` |
| `LIVE-SED-002` | 未授权 | 0 | 不执行 | `LIVE_CALLS_SKIPPED` |

认证结论只可为 `CERTIFIED`、`PARTIAL`、`REJECTED`、`UNAVAILABLE` 或 `PROTOCOL_DRIFT`。只有完整媒体校验通过的 profile 才可在后续受控变更中考虑标记 `CERTIFIED`；本章不会开启公开能力，也不会接入 Veyra/扣费。

## 7. 脱敏证据与清理

实时报告仅允许写入已忽略的 `tools/sub2api-video-certifier/reports/` 本地目录。每项证据最多记录：认证 case、profile/model、时间、终态、安全字段名列表、request ID hash、下载 MIME、SHA-256、ffprobe 是否成功和红删字段列表。Provider 状态只可记录归一化枚举 `PROCESSING`、`SUCCEEDED` 或 `FAILED`。发生 Provider/下载异常时，报告只可增加 `{ classification, code, stage, retryable }`：`classification` 仅为 `REJECTED`、`UNAVAILABLE`、`PROTOCOL_DRIFT` 或 `DOWNLOAD_INVALID`；`code` 是既有应用错误码，`stage` 是 `PROVIDER` 或 `DOWNLOAD`，`retryable` 是布尔值。不得记录 error message、detail、URL、原始状态文本、header、请求/响应 payload 或任何未经白名单化的上游值。

完整成功报告可由无网络的本地命令派生为版本化 capability snapshot，唯一位置为已忽略的 `tools/sub2api-video-certifier/capability-snapshots/`。snapshot 只包含报告已经允许的字段、已验证的单一文生输入范围与 `enabled: false`、`promotion: REQUIRES_INDEPENDENT_AUDIT`；它不读取环境、不访问 Provider，也不能修改 `packages/provider-video`、Worker、Control API、Studio 或 feature flag。此文件是独立审计的输入，不是 profile 启用动作。

为支持进程中断恢复，live certifier 只可在 `tools/sub2api-video-certifier/recovery/` 中受忽略、权限受限的临时本地恢复状态短暂保存原始 `provider_request_id`。该目录必须限制为运行 certifier 的单一 OS 身份可读写；状态只供同一 certifier 的恢复查询/下载读取，不得写入 report、日志、数据库、事件或 Git，也不得传给浏览器，且不得复制到其他临时目录。成功、最终失败、调用上限耗尽或认证进程受控退出后必须删除该状态；认证报告始终只保留 request ID hash。

不得记录或提交：Key、Authorization、Cookie、ticket、原始 request ID、完整 prompt、参考图 URL、对象 key、签名 URL、原始响应体、媒体二进制、截图、测试输出或本地卷。完成、最终失败或超限后应删除临时下载文件、`tools/sub2api-video-certifier/recovery/` 中的临时恢复状态、临时报告以外的运行输出和测试生成资源；profile 默认恢复为 disabled，直到独立审计接受认证证据。

## 8. 当前阻塞与下一步

`LIVE-GROK-001` 已在用户提供的本地安全环境中完成唯一一次提交及同一 request 的 GET-only 恢复；报告结果为 `SUCCEEDED`，regular recovery 与 active claim 已清理，仅保留无 raw ID 的 submission reservation 以永久阻止第二 POST。hash-only 成功报告已生成 local capability snapshot，并完成重新审计后接受 C08。不得再执行 stop-after-submit、resume、图生、Seedance或部署。后续 C09 只可先实现离线 adapter、fake server 和状态机，不得读取 Veyra 凭据或访问外部积分接口。

> **2026-09-01 当前音频口径**：C08 认证不要求用户上传旁白/样音；自动视频的原生 Provider 音频优先，显式 Doubao 替换由最新自动音频文档单独约束。本文历史的真实调用限制、认证状态和 Veyra 禁止项仍有效；当前本机对照不构成 C08 新认证或部署授权。
