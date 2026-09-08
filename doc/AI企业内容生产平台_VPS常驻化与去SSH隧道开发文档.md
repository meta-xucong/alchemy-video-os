# AI 企业内容生产平台：VPS 常驻化与去 SSH 隧道开发文档

> 版本：2026-09-09
>
> 状态：`DRAFT / PLAN_ONLY`。本文件只定义部署和运维收口方案，不自动改变正式开发总控、章节状态或 Provider 契约。
>
> 目标：将当前“本机服务 + VPS 反向 SSH relay”的验证拓扑，收口为“Video VPS 内部完整运行 Control API、Worker、Studio、数据库、队列和对象存储，VPS 直接访问 Aiself/Sub2API”的常驻拓扑。完成后，本机关闭、重启或离线不应影响已提交任务和参考图交付。

## 1. 现状和问题边界

### 1.1 已有能力

现有代码和部署资料已经提供以下能力，原则上只需验证并部署，不重新设计业务逻辑：

- `video.aiself.vip` 的 HTTPS 入口、`/provider-input/<opaque-token>` 参考图 relay 和无效 token `404` 行为。
- Control API、Task Worker、Workflow/Production Worker、Studio、PostgreSQL、Redis、MinIO 的 Compose 组合。
- Sub2API 视频协议：提交、状态查询、`/content` 下载；当前 Aiself 路由和 `grok-imagine-video-1.5` profile。
- 参考图同源校验、HEAD/GET 预检、MIME/大小/SHA 校验和 15 分钟 token TTL。
- Provider request ID 持久化、Worker 重启恢复、产物写入平台对象存储和下载校验。
- Compose 中已有 `restart: unless-stopped`、数据库/Redis/MinIO 健康检查，以及 Edge/Worker 的内部端口隔离。

### 1.2 当前主要问题

当前本地验证路径为：

```text
本机 Studio/Control API/Worker
        │
        ├── 本机直接访问 Aiself/Sub2API
        └── 反向 SSH -R 127.0.0.1:18080:127.0.0.1:3133
                    │
                    └── VPS Nginx -> video.aiself.vip/provider-input/
```

该路径的问题不是 Provider 业务逻辑，而是运行时依赖本机：

1. 本机休眠、重启、网络变化会同时影响 Worker、Control API 和参考图 relay。
2. 全栈重启脚本可能杀掉 relay；relay 需要另行恢复。
3. 当前 Studio 侧可能显示 `reconnect_available=false`，不能把 UI 的重连提示当成可靠的系统守护。
4. VPS 上的 relay-only 模式不能证明完整 Video OS 已在 VPS 常驻运行。
5. Alchemy/Veyra 账户、ticket、余额和扣费目前仍是独立后置能力，不能假设已与视频任务生产闭环。

## 2. 复用来源和不可改变的边界

本方案只复用现有项目和固定文档中的部署事实，不新增视频算法、Provider 协议、音频逻辑或业务状态：

| 来源 | 本方案复用内容 | 不做的事 |
| --- | --- | --- |
| `AI企业内容生产平台_VPS与SUB2API视频接入补充方案.md` | Compose 拓扑、端口建议、Aiself 三段式协议、Worker-only Key、轮询/下载和回滚原则 | 不复制 Sub2API/Alchemy 数据库或运行时 |
| `AI企业内容生产平台_C09-C参考图稳定交付优化开发文档.md` | `video.aiself.vip`、token、TTL、预检、MIME/大小/SHA、Edge 超时 | 不再依赖随机 Quick Tunnel 或本机 relay |
| `infrastructure/deploy/README.md` | DNS/TLS、Basic Auth、私有 env、real-provider gate、只重建受影响服务 | 不在未授权时开启真实 Provider 或共享积分 |
| `VIDEO_RELAY_RUNBOOK.md` | 当前 VPS、Compose 路径、部署/回滚命令、无效 token 验收 | 不把 relay-only 记录当成全栈常驻证明 |
| `AGENTS.md` | 密钥隔离、状态机、Worker 恢复、禁止 `down -v`、来源可追溯 | 不修改公共契约或越过 C13-A 授权门 |

当前正式状态继续保持：`E12/R01=BLOCKED`，`C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`。本文件不是状态升级凭据。

## 3. 目标拓扑

完成后的唯一生产拓扑：

```text
浏览器
  │ HTTPS
  ▼
VPS Nginx / TLS：video.aiself.vip
  ├── /             -> studio-web
  ├── /api/         -> control-api
  ├── /api/v1/events -> control-api（SSE 长连接）
  └── /provider-input/ -> control-api（短期公开 relay）

control-api / workers
  ├── PostgreSQL（仅 Compose 网络）
  ├── Redis/BullMQ（仅 Compose 网络）
  ├── MinIO/S3（仅 Compose 网络或受控资产域名）
  └── https://aiself.vip/v1（仅 Provider Worker 读取 API Key）
```

硬性边界：

- 公网只开放 Nginx 的 `80/443` 和约定的 SSH 管理端口。
- PostgreSQL、Redis、MinIO Console、Control API、Worker 不发布公网端口。
- 生产参考图不再经本机反向 SSH；Edge 直接转发到 VPS 内的 `control-api:8032`。
- 浏览器永远不持有 Sub2API Key、签名密钥、Provider request ID 或 Veyra ticket。
- 上游视频完成后立即下载到平台对象存储；不把 Aiself content URL 当永久资产。

## 4. 实施章节

### VPS-01：部署基线和归档

1. 以 GitHub 归档分支为待部署输入，先固定 commit 和镜像摘要。
2. 在 VPS 记录当前 Compose、Nginx、证书和镜像摘要；私有 env 单独备份但不打印内容。
3. 核对 VPS 磁盘、Docker、Compose、可用内存、DNS 和端口占用。
4. 明确部署模式为“full-stack”，不能继续把 relay-only 当生产模式。
5. 建立可回滚的旧镜像 tag 和配置备份；禁止 `docker compose down -v`。

Exit Gate：部署输入、回滚输入和数据卷均可定位；没有密钥、token、媒体或 `.env` 进入 Git。

### VPS-02：完整 Compose 常驻栈

1. 在 `/opt/alchemy-video` 下运行 Video OS 独立 Compose stack。
2. 启动 `studio-web`、`control-api`、Workflow/Task/Production Worker、Document/Media Runtime（按已启用能力）、PostgreSQL、Redis、MinIO、Edge。
3. 保留现有 `restart: unless-stopped` 和 healthcheck；若实际 Compose 服务缺少这两项，只按现有部署结构补齐，不新增业务进程。
4. 所有 Worker 使用同一数据库、队列和对象存储网络；不通过本机文件、进程变量或 SSH 隧道共享事实。
5. 验证 VPS 重启后 Compose 能自动恢复，且已有 `provider_request_id` 的任务只恢复查询/下载，不重复提交。

Exit Gate：VPS 重启演练后，API、队列、存储和 Worker 全部恢复；数据库/Redis/MinIO 数据卷不丢失；无重复 Provider POST。

### VPS-03：私有配置和密钥隔离

私有文件建议放在：

```text
/opt/alchemy-video/secrets/video.env
/opt/alchemy-video/secrets/video-users.htpasswd
```

沿用已有变量，不新增公开配置协议：

```dotenv
VIDEO_PROVIDER=mock                         # real gate 前保持 mock
SUB2API_VIDEO_BASE_URL=https://aiself.vip/v1
SUB2API_VIDEO_API_KEY=<仅 provider-worker>
SUB2API_GROK_MODEL=grok-imagine-video-1.5
REFERENCE_DELIVERY_ORIGIN=https://video.aiself.vip
REFERENCE_DELIVERY_PREFLIGHT_ENABLED=true
REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS=5000
REFERENCE_DELIVERY_PREFLIGHT_RETRIES=2
REFERENCE_DELIVERY_TTL_MS=900000
```

已有 Provider 运行参数继续使用来源文档值：轮询间隔 5 秒、最大等待 1800 秒、下载超时 600 秒、初始并发 1。若 profile 尚未通过真实能力认证，保持 `mock` 或 `BLOCKED`，不在 UI 中猜测开放。

安全要求：

- `SUB2API_VIDEO_API_KEY` 只注入 Provider Worker；Control API、Studio、GitHub、浏览器和普通日志不得出现。
- `REFERENCE_DELIVERY_SIGNING_KEY` 必须由 Control API 与 Worker 共享，但只存在私有 env/secret 中。
- `.env.local`、Veyra ticket、SSH 口令、签名 URL、Cookie 和对象 key 不进入 GitHub。
- 若启用 Alchemy/Veyra，ticket 交换和 debit 仍走既有内部端口；不复制 Alchemy 数据库、Cookie 或余额账本。

Exit Gate：`docker compose config --quiet` 通过，容器环境无密钥泄露，Worker-only Key 检查通过。

### VPS-04：Nginx、DNS、TLS 和参考图直连

1. `video.aiself.vip` 和 `assets.video.aiself.vip` 指向同一 Video VPS。
2. 证书覆盖两个域名，配置证书自动续期；续期后只重载 Edge，不重建数据服务。
3. 使用现有 `video.aiself.vip.conf`，不启用 relay 配置。
4. `/provider-input/` 保持无 Basic Auth、`no-store`、关闭 proxy buffering，并转发到 `control-api:8032`。
5. `/api/v1/events` 保留 HTTP/1.1、关闭 buffering、`proxy_read_timeout=3600s`。
6. `/api/` 和 Studio 继续受现有 Basic Auth/本地身份边界保护；`/internal/*`、MinIO Console、数据库和 Worker 日志不公开。
7. 上传继续走 presigned URL；大文件不能经 Control API 长时间占用 Node 进程。

Exit Gate：

- 公网访问 Studio/API 成功。
- 无效 `/provider-input/__invalid__` 的 HEAD/GET 快速返回 `404` 且空响应。
- 有效短期参考图 URL 从 VPS Worker 预检到 Control API 再到对象存储成功。
- 浏览器关闭或本机离线不影响 VPS 中的任务。

### VPS-05：Provider Worker 常驻和恢复

1. Worker 只通过 `VideoProviderPort` 调用 Aiself/Sub2API。
2. `POST /v1/videos/generations` 成功拿到 request ID 后立即持久化；后续重启禁止再次 POST。
3. 按既有 5 秒轮询和成功/失败状态映射处理任务；未知状态继续协议错误，不猜测成功。
4. 成功状态进入 `/content` 下载，校验 HTTP、MIME、字节数、SHA-256、ffprobe 后写入 MinIO。
5. 下载中断只重试下载，不重新生成；无上游内容时进入明确失败状态。
6. Provider 暂时不可用、429/5xx 等沿用现有可恢复错误；参数拒绝、审核拒绝、未知协议不静默重试。

Exit Gate：提交、轮询、下载、Worker 重启、下载重试和最终资产写入均有离线 fixture 或受控真实证据；无重复提交。

### VPS-06：数据、备份和磁盘恢复

1. PostgreSQL、Redis、MinIO 使用持久卷；不把任务/资产依赖放在容器临时层。
2. 定期备份数据库、对象元数据和必要的 MinIO 数据；备份位置与 VPS 主机分离。
3. 清理无数据库引用的 `.part` 临时文件和失败中间产物，但不得清理仍被 TaskRun/Asset 引用的对象。
4. 演练“Worker 容器重启”和“VPS 主机重启”，再演练“从备份恢复到隔离目录”；不在演练中删除生产卷。

Exit Gate：能证明 TaskRun、ProviderAttempt、Asset、对象二进制在重启后仍一致；备份可读且恢复步骤可重复。

### VPS-07：运行监控和告警

保留现有应用语义，只补运维观测：

- Control API 健康和数据库依赖状态。
- Edge/TLS、无效 token 404、有效参考图 HEAD/GET。
- Compose 容器 health、异常重启次数、Worker 队列堆积。
- Aiself `/v1/models` 的服务可达性（仅由 Worker/运维探针带 Key 访问）。
- ProviderAttempt 的提交、轮询、下载、失败 code 和恢复次数；不记录 API Key、完整 prompt 或签名 URL。
- 磁盘、对象存储和数据库容量；达到容量门时先阻止新任务或告警，不删除业务对象。

监控实现可使用 VPS 现有工具；本文件不新增一套业务协议或自造错误码。所有探针都应区分“服务不可达”“参考图不可达”“Provider 拒绝”“下载校验失败”和“积分/权限未启用”。

Exit Gate：每个故障类别都有可观测结果、人工处理路径和回滚路径；日志脱敏检查通过。

### VPS-08：Alchemy/Veyra 同步（独立后置门）

这一章不是去 SSH 隧道的前置条件，必须与常驻视频部署分开验收：

1. `video`/`video-mobile` target、一次性 login ticket、host-only session 按既有 Alchemy/Veyra 方案实现。
2. 账户查询、余额预检、成功产物后的 debit 和 debit 幂等只能由既有 Veyra 内部 API 完成。
3. 余额不足、409 幂等冲突、Veyra 暂时不可用分别映射到既有应用错误，不由 Video Worker 自造本地余额。
4. 未完成真实 Veyra 认证、扣费和恢复演练前，保持 `VEYRA_AUTH_ENABLED=false`，Video VPS 可以先以本地/无计费模式运行。

Exit Gate：真实账户、ticket、扣费次数/金额上限、恢复和审计证据由独立授权清单确认；不得用本地 mock 代替。

## 5. 发布顺序

1. **离线准备**：`docker compose config --quiet`、镜像构建、typecheck、现有测试和敏感信息扫描。
2. **VPS 仅 Mock**：先部署 full-stack，确认页面、上传、任务、对象存储、SSE、重启恢复。
3. **参考图验收**：有效/无效 token、HEAD/GET、MIME/大小/SHA、Worker 预检全部通过。
4. **Provider gate**：只有明确授权后才把私有 env 的 `VIDEO_PROVIDER` 切到 `sub2api`，只重建 `control-api`/`task-worker` 等受影响服务，不重启数据库、Redis、MinIO 或 Sub2API。
5. **受控真实任务**：使用已授权 profile 和素材完成一次提交→轮询→下载→资产入库；记录 request ID 脱敏摘要和产物校验，不把该次成功泛化为所有 profile 能力。
6. **常驻验收**：VPS 重启、Worker 重启、网络短暂中断、下载重试、浏览器刷新和 SSE 重连均通过。
7. **Alchemy/Veyra**：另行完成 VPS-08 后才打开共享积分和正式登录入口。

## 6. 回滚方案

- Provider 或 Worker 异常：将私有 env 的 `VIDEO_PROVIDER` 回到 `mock`，只重建 `control-api`/`task-worker`。
- 参考图 Edge 异常：恢复上一版 `edge` 镜像/Nginx 配置；数据库、Redis、MinIO 和已生成资产不回滚。
- 新版本导致任务恢复异常：只回滚对应 Worker 镜像，使用已持久化的 request ID 继续查询或下载。
- 证书/域名异常：恢复旧 Edge 配置并保留数据服务运行；不得删除数据卷。
- 任何回滚都必须保留 TaskRun、ProviderAttempt、Asset 和审计日志，避免回滚造成重复 Provider 提交。

## 7. 最终验收清单

### 代码和配置

- [ ] full-stack Compose 不依赖本机路径、反向 SSH 或 Quick Tunnel。
- [ ] `restart: unless-stopped`、healthcheck、内部网络和持久卷配置可复核。
- [ ] Provider Key 只进入 Worker；签名 key 仅进入 Control API/Worker。
- [ ] `VIDEO_PROVIDER=mock` 默认和真实 Provider gate 保持不变。
- [ ] 现有 C09 参考图参数未被改写：HTTPS origin、900000ms TTL、5000ms preflight、2 次额外重试。

### 功能和故障恢复

- [ ] 创建项目、上传参考图、生成任务、SSE、刷新页面和视频下载闭环。
- [ ] VPS/Worker 重启后继续原 request ID，不重复 POST。
- [ ] Provider 成功但 `/content`/ffprobe 失败时只重试下载。
- [ ] 有效参考图能从 Worker 直达 VPS Control API；无效 token 404。
- [ ] 数据库、Redis、MinIO 重启后任务和资产仍一致。

### 安全和运维

- [ ] 只有 Nginx 80/443/SSH 对外开放；无 DB/Redis/MinIO/Worker 公网端口。
- [ ] TLS 自动续期并能在续期后安全 reload Edge。
- [ ] 备份、恢复、磁盘清理、健康检查和告警均有可执行记录。
- [ ] 日志无 Key、ticket、Cookie、签名 URL、对象私钥和完整 Provider payload。
- [ ] Alchemy/Veyra 未通过独立授权门前保持关闭。

## 8. 明确不在本文件范围内

- 不改变视频 Prompt、分镜、音频、字幕、BGM、转场或时长算法。
- 不新增 Provider、KIE/Wokey 路由、自动 fallback 或第二套任务协议。
- 不在没有独立授权时读取或修改 VPS、DNS、TLS、Sub2API、Alchemy/Veyra 生产配置。
- 不把一次真实生成成功当作常驻可用证明；必须完成重启、恢复、资产校验和监控验收。
- 不把现有本地 relay 的“已连接”状态写成 VPS full-stack 已部署事实。

## 9. 当前结论

当前最小且正确的优化方向是：**保留既有业务代码和 C09 参考图逻辑，替换部署拓扑，取消本机反向 SSH relay，让 VPS 内部服务直接完成参考图交付和 Provider 出站。**

在 VPS-01～VPS-07 的证据齐全前，系统只能称为“本地可联调/relay 可验证”；VPS-08 的 Alchemy/Veyra 仍作为独立后置门，不阻塞纯视频任务在 Mock 或已授权 Provider 模式下运行，但也不能被误称为已同步完成。
