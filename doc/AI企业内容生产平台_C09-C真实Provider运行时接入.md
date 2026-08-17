# AI 企业内容生产平台：C09-C 真实 Provider 运行时接入

状态：`IMPLEMENTED_AWAITING_AUDIT`

范围说明：本文保留 C08 文生真实运行时基线，并记录 ADR-0034 已实现的图生与一至七张独立参考素材代码路径。实现已通过离线/Mock 验证；它不等于真实图生已开放。真实 I2V/R2V 仍等待 Video VPS 专用 HTTPS relay 的部署审计，以及本次调用的 profile、次数、费用上限和素材范围授权。

本文件落实 ADR-0033。目标是让用户提供的 `aiself-grok` SUB2API 配置可以被产品 Worker 使用，同时保持浏览器、Control API、Veyra、VPS 和部署边界不变。

## 运行面

| 进程 | 允许的配置 | 禁止的配置/行为 |
| --- | --- | --- |
| Studio | 同源 `/api/v1/*` | Provider 名称、模型、地址、密钥、原始任务 ID 或响应 |
| Control API | `VIDEO_PROVIDER` 与数据库/对象存储配置 | `SUB2API_VIDEO_BASE_URL`、`SUB2API_VIDEO_API_KEY`、任何 dotenv 文件读取 |
| Task Worker | `VIDEO_PROVIDER`、数据库/队列/对象存储配置；仅 `sub2api` mode 可读取 SUB2API base URL/key；真实图片任务另需 `REFERENCE_DELIVERY_ORIGIN` 与 `REFERENCE_DELIVERY_SIGNING_KEY` | 将密钥、relay token/URL 或原始请求/响应写入日志、数据库、事件、公开 DTO 或文件 |

默认 `VIDEO_PROVIDER=mock`。要进入真实 mode，Control API 与 Task Worker 都必须显式设置 `VIDEO_PROVIDER=sub2api`；仅 Worker 拥有这两个 SUB2API 环境变量。任何模式不一致都会由 Worker 在提交前以安全错误终态化，而不是把 Mock 请求送往真实线路或反之。

## 公开与内部契约

浏览器调用 `POST /api/v1/shots/:shot_id/generations` 时只提交严格空对象：

```json
{}
```

Control API 从已保存的 `Shot` 与同项目 `reference_bindings` 建立不可变 `TaskRun.input_snapshot` 并通过 outbox 交给 Worker。无绑定映射为 `TEXT`；一张 `FIRST_FRAME` 为开场画面；一至七张有序 `STYLE` / `SUBJECT` 为独立参考素材。该快照以及 Provider/model/request ID 只属于内部存储、队列与 Worker；TaskRun 的公开响应、项目详情、任务详情和 SSE 均不返回它们。

## 已认证能力与拒绝规则

当前真实 profile 使用 `grok-imagine-video-1.5` 和固定画幅 `16:9`。C08 的 `1s / 480p` 是一次受限文生认证的成本下限，不是产品默认创作质量；本机 MCP 的当前 `aiself-grok` 证据已覆盖 `5s / 720p / 16:9` 的独立参考素材路径。Studio 第三步将时长 `1..15` 秒与清晰度 `480p|720p` 作为明确的可保存设置显示，默认 `5s / 720p`。Control API 只从 `Shot.generation_settings.video_settings` 读取这两个值，并在创建 TaskRun 前校验范围；自然语言中的数字不再改写模型参数。`ratio` 为公开显示但不可修改的当前 profile 能力，必须为 `16:9`。其他可选组合只代表协议可接受范围，不扩大为已完成的真实画质认证。ADR-0034 已实现公开单 Shot 的 `FIRST_FRAME` 与一至七张 `REFERENCE_SET` 输入映射：前者写入 `image.image_url`，后者写入 `reference_images[].url`；公开手工入口保持互斥。C12 自动多段成片按 ADR-0043 使用有序 `REFERENCE_SET` 承载“第 0 位交接帧 + 用户参考图”，不开放尾帧字段，也不宣称逐帧连续能力。参考素材协议最多七张，但当前独立视觉端到端证据只有两张。Seedance 和 Veyra 计费仍未开放。

Control API 只校验并保留已保存的创作描述作为 Worker 专用提示词（只去除首尾空白）。它不在前后追加模板、翻译、偏好或参数说明，因此发送给 Aiself 的 `prompt` 与用户的创作描述一致。该步骤从受控 `video_settings` 取得规格，但不是浏览器直连模型、不会读取密钥，也不会声明已完成脚本 Agent 或内容政策审核。TaskRun 只保存该执行提示词和冻结后的规格；原始想法继续由 Shot 保存。平台不恢复 4096 字节本地硬拒绝。

真实图片任务在 Worker submit 前由 `ReferenceDeliveryPort` 为已授权私有图片创建短时 HTTPS relay URL。Control API 的无认证 `GET` / `HEAD /provider-input/:token` 只接受不透明、加密、带到期和 workspace/project/asset/SHA/MIME 绑定的 token；它只流式返回受控图片 MIME，未命中或篡改返回 404，存储暂不可用返回 503。token、URL、对象 key 和 Provider 字段不持久化也不公开。真实 mode 缺少 relay origin 或签名密钥时，带图片 TaskRun 在 ProviderAttempt 和 submit 之前安全失败，不能回退为文生。

Worker 对真实线路使用 `POST /videos/generations`、`GET /videos/{id}`、`GET /videos/{id}/content`。HTTPS base URL 必须没有认证信息、query 或 fragment；若其带 path prefix，例如 `/v1`，所有请求保留该 prefix，且拒绝路径穿越。网络异常归一为可恢复的 `PROVIDER_UNAVAILABLE`；协议异常保持为安全的既有应用错误。得到 request ID 后只轮询/下载，不重复 submit。

## 验证和调用门禁

离线验证覆盖：Mock 默认、真实 profile 内部快照、HTTPS/path-prefix、未配置/不安全 URL 拒绝、单首帧与一至七张参考输入 mapper、relay token 篡改/到期/隔离、公开 DTO 脱敏、Worker 在投递失败时零 submit/零 ProviderAttempt，以及拿到 Provider request ID 后的长轮询恢复。测试使用 injected fake fetch/relay，不读 `.env.local`，不访问真实 Provider。

本阶段的受控真实 mode 启动不创建视频任务。首次真实 POST 必须另行记录本次 profile、调用次数、费用上限和素材范围。C08 已消耗的一次认证 submit 不可复用为新的付费调用授权。

## 本机受控真实图生验收（2026-08-15）

用户要求在部署前先从本机 Studio 验证完整真实图生链路。该验收不是 VPS 部署，也不改变公开 API、领域状态或默认 Mock 配置。真实任务只能由用户明确授权的本机页面人工点击或受该授权委托的等价浏览器操作创建；启动、健康检查、上传和项目编辑都不得自行创建 Provider 任务。

`aiself-grok` 的当前客户端契约要求 `image.image_url` 或 `reference_images[].url` 为 Provider 可读取的 HTTPS URL。平台不得把私有 MinIO 地址、对象 key 或浏览器预签名 URL 交给 Provider，也不应把用户图片上传到公共图床。因此本机验收使用独立端口上的 Control API 和 Worker，并通过只允许 `GET`/`HEAD` 的本机 relay 提供短时、不透明 `/provider-input/<token>` URL。该电脑的 Tailscale Funnel 受 tailnet 策略拒绝，故本次采用已验签的 `cloudflared` Quick Tunnel 作为临时 HTTPS 传输；它使用随机域名且不创建 DNS 记录。Tunnel 只代理这一条路径；根路径和其他 API 均返回 404，Control API、MinIO、Redis、PostgreSQL 与 Worker 不对公网暴露。

本机 relay 使用的 `REFERENCE_DELIVERY_SIGNING_KEY` 仅存放在 Git 忽略的本地运行器中，Control API 和 Worker 共用；Worker 另配置受限 Funnel HTTPS origin。视频 API Key 仍只由 Worker 从现有忽略的 `.env.local` 读取。若 relay、Funnel、签名密钥或真实 Worker 任一项未就绪，带图任务必须在 Provider submit 前失败，禁止回退为文生或 Mock。

该运行方式仅用于一个有界人工验收，不取代部署拓扑。真实点击前仍必须记录 profile、调用次数、费用上限和素材范围；Veyra 继续关闭，且不得在本机测试中调用账户或扣费接口。

## 2026-08-16 当前项目真实运行复核

在用户明确要求按当前 Studio 保存内容进行一次真实验证后，首先发现本机 `3133` Control API 是代码修正前启动的常驻 Node/tsx 进程。该进程不会热更新，导致页面已显示 `5 秒 / 480p / 16:9` 时，旧编译逻辑仍从描述中的数字冻结为 `15 秒 / 480p / 16:9`。这条任务已获得 Provider request ID 并进入异步轮询，但以归一化 `PROVIDER_REJECTED` 终态结束；因此它不能用来评判已修正的前端规格路径。

停止并重启该本机 Control API 后，使用同一页面、同一已绑定的两张 `REFERENCE_SET` 图片和当前可见 `5 秒 / 480p / 16:9` 创建一条新的 TaskRun。审计确认其冻结快照与页面一致，Provider request ID 已持久化，随后同一请求成功完成；Worker 将结果归档为 `VIDEO / GENERATED / READY`，公开预览 URL 的受控 GET 返回 `200`、`video/mp4` 与非空字节。该证据证明 Studio -> Control API -> outbox -> Worker -> HTTPS relay -> Aiself -> 轮询/下载/校验/归档的本机闭环可用，但不把单次成功扩大为所有内容、参数组合或七图视觉质量的保证。

本机受控运行器的操作规则因此补充为：任何修改 Control API、Worker 或 Studio 源码后，必须重启相应常驻进程并重新做 `/api/v1/health` 检查，不能把旧进程的行为当作新源码验收结果。重启不会重放已经持久化 Provider request ID 的任务；它只允许恢复查询或下载。

## 2026-08-16 本机 C12 成片真实链路修复

用户在 C12 成片工作台验收中发现：页面刷新问题已消失，但生成结果仍是本地蓝屏演示成片，没有走真实 Provider。审计确认根因不在 Studio 展示层，而在 C12 `ProductionRun -> ProductionSegment -> Shot -> TaskRun` 调度：`DrizzleProductionRepository.scheduleEligibleSegments()` 创建每段 `TaskRun.input_snapshot` 时仍硬编码 `model: "mock-video-v1"`。因此长故事成片编排即使在真实 Worker 已具备 `sub2api` 能力时，也只会生成 Mock 任务，无法产出真实商业成片。

修复方式保持依赖方向：Persistence 不导入 Provider adapter。`DrizzleProductionRepository` 新增可注入的 `ProductionTaskRunInputFactory`，默认仍生成 Mock 快照；`apps/production-worker` 在启动时读取 `VIDEO_PROVIDER`，仅当显式为 `sub2api` 时调用 `createRuntimeVideoInputSnapshot()` 生成真实 `grok-imagine-video-1.5` 快照，并按 C12 分段持久化 `duration / resolution / ratio / visual_input`。Mock 模式继续保留 C12 计划时长，用于本地编排测试；真实模式按 Provider profile 校验 `1..15` 秒、`480p|720p`、`16:9` 以及 `TEXT / FIRST_FRAME / REFERENCE_SET`。

本机持久启动脚本同步支持显式真实模式：

```powershell
infrastructure\local\start-full-local-stack.ps1 -VideoProvider sub2api
```

默认仍为 `VIDEO_PROVIDER=mock` 与 `STUDIO_LOCAL_DEMO_MODE=true`。真实模式才会从进程环境或 `.env.local` 读取 `SUB2API_VIDEO_BASE_URL` / `SUB2API_VIDEO_API_KEY`，且只在启动 Task Worker 时短暂注入；Control API 与 Task Worker 共用一次性 `REFERENCE_DELIVERY_SIGNING_KEY`；未传入 `-ReferenceDeliveryOrigin` 时，脚本自动启动本机 `cloudflared` Quick Tunnel 指向 Control API 的 `/provider-input/<token>`。该模式不启用 Veyra、扣费、VPS、DNS、TLS 或部署。

一次合成自检已完成：使用合成参考图、新建本机项目、15 秒 / 720p / 16:9、1 张 `REFERENCE_SET`，创建 1 个真实 Provider 任务。持久化证据显示 TaskRun `SUCCEEDED`，冻结快照为 `grok-imagine-video-1.5`、`duration=15`、`resolution=720p`、`visual_input=REFERENCE_SET`、`reference_count=1`，且只有 1 条 ProviderAttempt 和 1 条已提交 request。C12 后续 QC、交接和 compose 完成，生成 `VideoVersion(SUCCEEDED)`；结果资产为 `video/mp4`，大小 1,541,708 bytes，时长 15,084 ms，短时下载 URL 可读取非空 MP4。该证据证明本机 Studio/Control API/Workflow Worker/Production Worker/Task Worker/Media Runtime 的真实成片闭环已经可用。

限制仍然保留：这不是 VPS 部署；共享积分/Veyra 仍关闭；真实 profile 的视觉质量不因一次 canary 扩大为全部内容保证。现有 Mock 旧成片不会被原地替换，用户需在真实模式下生成新版本。长文本项目会按分镜数量触发多次真实 Provider 调用，因此对多段故事仍需在 UI 上理解它会消耗多段生成额度。

## Video VPS 部署准备（未执行）

`infrastructure/deploy/` 现提供 Video VPS 的容器构建、私有 Compose、ACME bootstrap、Nginx 反代和无密钥环境样例。它不是一次部署，也不会启动真实 Provider：当前 DNS 没有 `video.aiself.vip` 或 `assets.video.aiself.vip` 的 A/AAAA 记录，SSH 主机清单也没有标记为 Video OS 的第三台 VPS。

部署包将对象存储分成两个端点：`S3_ENDPOINT=http://minio:9000` 只供 API/Worker 内网读写；`S3_PUBLIC_ENDPOINT=https://assets.video.aiself.vip` 只用于 Control API 签发给浏览器的 URL。`S3_BROWSER_ORIGINS=https://video.aiself.vip` 约束上传 CORS。浏览器页面、`/api/v1/*` 和 SSE 在 C09-B 身份实现完成前由 edge Basic Auth 保护；只有短时不透明 `/provider-input/<token>` 和签名 S3 对象请求不使用该认证。MinIO Console、数据库、Redis、Worker、Control API host ports 和 `/internal/*` 均不公开。

真实运行仍须在新 VPS 上完成以下独立门禁：双域名 TLS、私有 edge 登录、Worker-only Provider secret、相同的 relay signing key、单图 relay 实测，以及有界的 `aiself-grok` / `grok-imagine-video-1.5` 手工点击授权。部署包默认 `VIDEO_PROVIDER=mock`；改为 `sub2api` 不会由本文件或服务启动自动执行。
