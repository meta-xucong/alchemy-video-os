# AI企业内容生产平台：SUB2API 视频能力认证与测试夹具规范

> **2026-09-01 当前执行口径**：自动旁白不要求用户上传音频或样音；音频由 Provider 原生轨或服务端显式 Doubao 生成。用户已授权的真实调用只用于最新自动音频文档规定的本机 Grok/Doubao 对照；本规范的认证快照、CI 和默认配置仍保持 Mock/离线夹具，Veyra、共享积分、VPS、部署不在范围内。旧的“仅提供 Key 后才可真实验证”是默认安全门，已由本轮明确授权覆盖为本机例外，不代表自动启用或章节验收。

## 1. 目的与原则

本规范验证 SUB2API 视频线路能否安全接入 `VideoProviderPort`，并把真实调用所得的协议事实固化为脱敏夹具。认证不是产品功能，不在本地 MVP 默认执行，不提交 API Key，也不修改 VPS、域名或 Sub2API 服务端。

参考本地 `sub2api-video-mcp` 的协议实现，当前已知视频 API 边界为：

- `POST /videos/generations` 提交生成。
- `GET /videos/{id}` 查询状态。
- `GET /videos/{id}/content` 下载最终视频。
- 请求字段沿用 `model`、`prompt`、`duration`、`resolution`、`ratio`；图生视频通过 `image: { "image_url": "..." }` 传入。
- MCP 的默认轮询间隔为 5 秒；适配器必须自行支持持久化恢复，不能以 MCP 进程内存作为任务真相。

认证结果必须区分“供应商声称支持”与“在当前账号/当前线路/当前日期实际验证通过”。前者写配置，后者写 capability snapshot。

## 2. 文件与模块布局

```text
packages/provider-video/
  src/sub2api/
    adapter.ts                 # 唯一真实 HTTP 客户端
    mapper.ts                  # SUB2API payload <-> VideoProviderPort
    errors.ts                  # HTTP/业务状态归一化
    capabilities.ts            # 已认证 capability snapshot 读取
    adapter.contract.test.ts   # MockTransport 离线测试
tools/sub2api-video-certifier/
  src/cli.ts                   # 手工显式运行的认证命令
  src/cases.ts                 # CERT 测试用例表
  reports/.gitkeep             # 本地报告，不提交真实响应
  capability-snapshots/.gitkeep # 本地、脱敏、待独立审计的能力快照
fixtures/providers/sub2api/
  schema-version.json
  grok-imagine-video-1.5/
    text-to-video.request.json
    submit.response.json
    status.processing.json
    status.succeeded.json
    content.metadata.json
  seedance/
    .gitkeep
```

所有 fixture 必须是合成或已脱敏内容。`provider_request_id` 可替换为 `req_fixture_001`；URL 使用 `https://example.invalid/...`；不得保存 prompt 中的私人素材、用户对象键、API Key、内部 Token、Cookie、签名 URL 或完整视频二进制。

## 3. 配置分层与启动保险

```dotenv
# .env.example：可提交，永远不含真实值
VIDEO_PROVIDER=mock
SUB2API_VIDEO_BASE_URL=
SUB2API_VIDEO_API_KEY=
SUB2API_VIDEO_PROFILE=grok-imagine-video-1.5
CERTIFY_LIVE_VIDEO=false
CERTIFY_MAX_SUBMISSIONS=0
```

通用真实认证只允许同时满足以下条件。C08 当前授权进一步收紧为精确 Grok-only CLI guard，见 ADR-0029 和 C08 矩阵：

1. 开发者把 Key 写入未提交的 `.env.local` 或操作系统密钥存储。
2. 命令显式传入 `--live`。
3. 目标 profile 已被用户明确允许测试。
4. C08 的 `--live --profile grok-imagine-video-1.5 --max-submissions 1 --budget-usd 1.00` 以及 `--stop-after-submit` 或 `--resume` 均精确匹配；未匹配时不得读取任何环境变量。

任一条件不满足时，certifier 只跑离线夹具，并打印 `LIVE_CALLS_SKIPPED`；它不得读取 base URL 或 Key，也不得 fetch。API 和 worker 也必须在 `VIDEO_PROVIDER=sub2api` 且 Key 缺失时启动失败，不能悄悄降级到真实默认 URL。

## 4. 适配器设计

### 4.1 外部与内部字段映射

| `VideoProviderPort` | SUB2API 请求/响应 | 规则 |
| --- | --- | --- |
| `input.model` | `model` | 原样保留，值必须属于已认证 profile |
| `input.prompt` | `prompt` | 原样保留，不在 adapter 拼接业务 Prompt |
| `input.duration` | `duration` | 由 capability 范围校验后传递 |
| `input.resolution` | `resolution` | 枚举由认证记录决定 |
| `input.ratio` | `ratio` | 统一使用如 `16:9` 的字符串 |
| `input.referenceImageUrl` | `image.image_url` | 只传短时、服务端生成的读取 URL |
| `ProviderSubmission.providerRequestId` | 返回体的 `id` 或 `request_id` | mapper 兼容已认证字段，持久化为内部 `provider_request_id` |
| `ProviderStatus.phase` | 返回体的 `status` 或 `state` | 归一化为 `PROCESSING | SUCCEEDED | FAILED` |
| `download()` | `GET /videos/{id}/content` | 返回 `{ stream, mimeType, contentLength? }`；MIME/长度来自响应 metadata，Worker 以实际 MIME、长度、SHA-256 和 ffprobe 校验，不能默认 `video/mp4` |

在获得真实响应前，`id`/`request_id`、`status`/`state` 属于待认证的兼容分支，不能假定其中任一字段是唯一真相。首轮线上认证确认后，把实测字段固定入 `capabilities.ts` 和 fixture。

### 4.2 provider profile

```ts
type VideoProviderProfile = {
  provider: "sub2api";
  profile: string;
  model: string;
  enabled: boolean;
  inputModes: Array<"text_to_video" | "image_to_video">;
  durations: number[];
  resolutions: string[];
  ratios: string[];
  pollIntervalMs: number;
  maxPollAttempts: number;
  certifiedAt?: string;
  evidenceId?: string;
};
```

初始只登记、但不启用候选 profile。C08 当前仅认证 `grok-imagine-video-1.5` 文生；Seedance、图生和任何第二 profile 都未获授权。Seedance 的精确模型名、时长、分辨率、比例、图生字段必须来自另一轮 live certification，不允许仅根据仓库名或 UI 猜测填写。

`pollIntervalMs` 默认 5000，`maxPollAttempts` 默认 120；单次 worker lease 小于该总时长时，必须持久化 `next_poll_at` 并由下一次 job 接管。轮询次数、状态、原生响应摘要写入 `provider_attempts`。

## 5. 离线夹具契约测试

离线测试是 CI 必跑项目，不使用网络。每个 profile 至少覆盖：

| 编号 | 场景 | 输入 | 预期 |
| --- | --- | --- | --- |
| `CONTRACT-001` | 文生视频提交 | 最小合法 `prompt` | 正确构造 `POST /videos/generations`，无额外字段 |
| `CONTRACT-002` | 图生视频提交 | 一个 `referenceImageUrl` | 仅映射为 `image.image_url` |
| `CONTRACT-003` | 提交响应 | 脱敏成功响应 | 得到非空 `providerRequestId` |
| `CONTRACT-004` | 处理中查询 | `processing` fixture | 映射为 `PROCESSING`，不下载 |
| `CONTRACT-005` | 成功查询与下载 | `succeeded` + content metadata | 映射为 `SUCCEEDED`，返回实际 MIME/可用长度与流；C06 以该 metadata 校验后才保存 |
| `CONTRACT-006` | 失败查询/提交 | 上游失败 fixture | 生成带 `PROVIDER` 阶段的 `PROVIDER_REJECTED` 或 `PROVIDER_UNAVAILABLE` 安全失败；`GET /videos/{id}` 的 `429/503` 返回 `FAILED { code: PROVIDER_UNAVAILABLE, retryable: true }`，C06 保持已提交 TaskRun 为 `PROVIDER_PROCESSING` 并交给当前 delivery 重试，不重提 |
| `CONTRACT-007` | 非法响应/下载 | 无 ID、无状态、非 JSON、404 或无效 MIME | 结构响应为 `PROVIDER_PROTOCOL_INVALID`；下载 404/metadata 无效为 `DOWNLOAD_INVALID`，都不重提 |
| `CONTRACT-008` | 脱敏 | 含 `Authorization`、签名 URL 的 fixture 输入 | 持久化审计中不出现敏感字段 |

下载完成后的最小验证为：响应状态 `2xx`、文件大于零、允许的 `Content-Type`、SHA-256 计算成功、`ffprobe` 能读取视频流。`ffprobe` 失败应标记 `DOWNLOAD_INVALID`，保留临时诊断摘要但删除临时二进制。

本地 C06 的短暂轮询失败语义：在已持久化 `provider_request_id` 后，`429`/`503` 不立即写 `FAILED` 或 `RETRY_SCHEDULED`，而是保持 `PROVIDER_PROCESSING`，由 BullMQ 同一 delivery 的重试或启动扫描的最多三次恢复接管；每次恢复只查询或下载，绝不再次 `POST /videos/generations`。delivery/扫描耗尽后，既有 C06 收敛为公开可见、可显式 retry 的 `FAILED`。C08 引入 `next_poll_at` 和延迟入队后，才使用持久化 `RETRY_SCHEDULED -> QUEUED` 轮询调度。

## 6. 真实认证用例

真实调用只在用户提供 Key 并允许具体 profile 后执行。每个用例最多提交一次任务；重试只查询同一 `provider_request_id`。C08 当前只允许 Grok 的 `LIVE-GROK-001`，不执行图生或 Seedance。

| 编号 | profile | 场景 | 成功标准 |
| --- | --- | --- | --- |
| `LIVE-GROK-001` | `grok-imagine-video-1.5` | 固定 `1s/480p/16:9` 文生；总 submit=1、预算=`USD 1.00` | POST 前 reservation 后 `--stop-after-submit`；在 recovery TTL 内可多次 `--resume`，每次仅 GET/poll/download，提交、轮询、下载通过媒体校验 |
| `LIVE-GROK-002` | 未授权 | 图生视频 | 不执行，`LIVE_CALLS_SKIPPED` |
| `LIVE-GROK-003` | 同上 | 进程恢复 | 原始 ID 只由已忽略、权限受限、15 分钟有效的 regular recovery state 保存；无 raw ID 的 active claim 串行保护 resume。retryable poll/download 可在 TTL 内由后续 `--resume` 继续，始终只查询/下载；reservation 永远禁止第二 POST，报告仅含 hash |
| `LIVE-SED-001` | 未授权 | 最短文生视频 | 不执行，`LIVE_CALLS_SKIPPED` |
| `LIVE-SED-002` | 未授权 | 图生视频 | 不执行，`LIVE_CALLS_SKIPPED` |

认证 prompt 必须短、无人物肖像、无品牌、无私有参考图。C08 固定使用合成文生 prompt，不接受图像输入或用户素材；prompt 不写入 report、日志、fixture 或终端输出。

实时报告只存本地 `tools/sub2api-video-certifier/reports/<timestamp>.json`，结构如下：

```json
{
  "evidenceId": "cert_20260812_grok_001",
  "profile": "grok-imagine-video-1.5",
  "model": "grok-imagine-video-1.5",
  "caseId": "LIVE-GROK-001",
  "recordedAt": "2026-08-12T00:00:00Z",
  "terminalStatus": "SUCCEEDED",
  "providerState": "SUCCEEDED",
  "providerRequestIdHash": "sha256:...",
  "requestFieldNames": ["model", "duration", "resolution", "ratio"],
  "responseFieldNames": ["id", "status"],
  "downloadValidation": {"mimeType": "video/mp4", "sha256": "...", "ffprobeOk": true},
  "redactions": ["authorization", "request_id", "download_url"]
}
```

报告中的 request ID 用 hash 替代原值。`providerState` 只能是 `PROCESSING`、`SUCCEEDED` 或 `FAILED`；失败时才允许增加 `providerFailure`，其只能是 `classification/code/stage/retryable` 的白名单结构，不能包含 message、detail、URL、header 或原始 payload。没有通过媒体校验就不能把 profile 标为 `enabled`，即使接口返回了成功状态。

## 7. 失败分类与功能门禁

| 认证结果 | 解释 | 系统行为 |
| --- | --- | --- |
| `CERTIFIED` | 提交、轮询、下载、媒体校验全部通过 | profile 可在受控环境启用 |
| `PARTIAL` | 能提交但未完成或缺少某输入模式 | 仅记录证据，不在产品公开该能力 |
| `REJECTED` | 模型/参数被上游拒绝 | 关闭该 profile，保留错误分类 |
| `UNAVAILABLE` | 认证线路、网络或账号暂不可用 | 保持禁用，稍后再测 |
| `PROTOCOL_DRIFT` | 响应结构与 fixture 不一致 | 阻断 adapter 发布，先升级 mapper/fixture |

产品 feature flag 为 `video.provider.sub2api.<profile>.enabled`，只允许由认证报告生成的变更开启。前端可见模型列表由 API 的 `GET /capabilities/video` 返回，不读取环境变量，也不硬编码候选模型。

## 8. 与共享积分的关系

认证动作默认不走视频平台的共享积分 adapter：它直接消耗用户提供的 SUB2API 视频 API Key 所属额度。产品任务接入共享积分后，认证结果只说明提供方协议可用，**不**说明费率、扣费或身份打通已经验证。

共享积分完整接入前需要分别通过：

1. `CreditPort` fake server 契约测试。
2. 真实 Sub2API `video` intent/票据/账户/扣费沙箱验证。
3. 视频任务成功后一次扣费、worker 崩溃后回放不重复扣费的端到端测试。

三项均通过后才允许 `VIDEO_PROVIDER=sub2api` 与 `VEYRA_AUTH_ENABLED=true` 同时在部署环境开启。

## 9. 实施完成定义

- `adapter.contract.test.ts` 在无网络、无 Key 时稳定通过。
- mock provider 仍是本地默认，certifier 不会由 CI、前端或 worker 自动调用。
- 每个启用 profile 都有版本化 capability snapshot、脱敏夹具和一份本地认证报告。
- 生产任务日志能以 `task_run_id`、`provider_attempt_id`、`provider_request_id_hash` 关联，不存明文 request ID 或密钥。
- 正式接入 Key 前，由用户明确给出要认证的模型、允许的测试次数和额度上限。
