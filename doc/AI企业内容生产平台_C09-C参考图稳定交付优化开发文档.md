# C09-C 参考图稳定交付优化开发文档

状态：`IMPLEMENTED_PENDING_AUDIT`（仅 C09-C 参考图稳定交付切片）  
日期：2026-09-05  
范围：Alchemy Video OS（Aiself）Video VPS 与 task-worker；不修改 Sub2API。

## 1. 背景与已确认事实

Grok/KIE 视频接口只接收公网可读取的 `image_urls`。平台当前把私有对象存储图片包装成短时、不可枚举的 HTTPS `provider-input/<token>` URL。生产 `video.aiself.vip` 已在独立 Video VPS 上由 Nginx 直连 `control-api:8032`；Control API 会校验 AES-GCM token、workspace/project/asset、READY 状态、SHA-256、MIME 与 8 MiB 上限后再流式返回图片。

已确认生产边界：

- `video.aiself.vip` DNS 指向 Alchemy Video VPS（43.251.227.106），容器 edge 的活动配置是直连 Control API，不是临时 relay。
- 本地全栈验证使用 Quick Tunnel；该通道域名随机、DNS/QUIC 曾出现超时，因此只能作为诊断通道，不能作为 Provider 图片来源。
- KIE 的失败发生在提交阶段时没有 `provider_request_id`；在真正提交前确认公网 relay 可读，可以把本地/边缘交付故障挡在 Provider 计费调用之外。

## 2. 目标与非目标

目标：

1. 生产 Worker 只使用固定的 `https://video.aiself.vip` 参考图通道。
2. Provider POST 前对每一张参考图执行轻量 HEAD 预检，确认 HTTP 状态、MIME 与大小；临时网络/5xx 使用极少量、有界的本地预检重试。
3. 延长但严格限制 token TTL，覆盖排队和 KIE 异步抓取窗口，同时不把 token/URL 写入持久化记录或日志。
4. 让 relay 对 HEAD/GET 的响应确定、无缓存、无认证继承、无连接过早断开。
5. 失败时在没有创建 ProviderAttempt/Provider request 前返回既有 `PROVIDER_UNAVAILABLE`，由任务恢复机制重试；已经持久化 request ID 后绝不重新提交。

非目标：

- 不修改 Sub2API、Smart Router、Provider 协议、模型映射、计费或轮询上限。
- 不把任意 URL 变成可抓取目标，不放宽图片 MIME/大小/项目隔离。
- 不对同一视频任务增加 Provider 二次提交；预检只验证 Aiself 自己的 relay。
- 不在本补丁中引入 KIE File Upload API 或第二套对象存储协议；该方案保留为后续独立变更。

## 3. 最小实现方案

### 3.1 Worker 交付预检

`createWorkerReferenceDeliveryPort` 在签发每个 URL 后调用内部 `preflightReferenceUrl`：

1. URL 必须与配置的 HTTPS origin 完全一致，路径必须是 `/provider-input/` 前缀，且不得包含 query/fragment；这一步阻断 SSRF/配置漂移。
2. 先发送 `HEAD`。要求 2xx（生产期望 200）、`Content-Type` 为 `image/jpeg|image/png|image/webp`，`Content-Length` 为正数且不超过 8 MiB。
3. HEAD 返回 405/501 或缺少长度时，发送一次受同一超时控制的 `GET`，读取至多 `8 MiB + 1` 字节以确认真实大小；不把图片写入磁盘。
4. 网络错误、408/425/429/5xx 只做最多 2 次额外预检，退避 250ms、750ms；错误 MIME、越界大小、4xx（除上述可恢复状态）立即 fail-closed。
5. 所有 URL 通过预检后才创建 ProviderAttempt 并 POST。预检失败抛出可恢复的 `PROVIDER_UNAVAILABLE`，不会产生 Provider request ID，也不会增加上游计费。

预检通过后 URL 仍只存在于当前调用栈和 Provider 请求体；不写入 TaskRun、ProviderAttempt、事件或日志。

### 3.2 配置

| 环境变量 | 默认值 | 约束 |
| --- | ---: | --- |
| `REFERENCE_DELIVERY_ORIGIN` | `https://video.aiself.vip` | 仅 HTTPS origin，无凭据/query/fragment |
| `REFERENCE_DELIVERY_TTL_MS` | `900000`（15 分钟） | 60 秒至 1 小时；非法值启动即失败 |
| `REFERENCE_DELIVERY_PREFLIGHT_ENABLED` | real provider 为 `true` | 仅显式 `false` 可关闭，建议仅诊断使用 |
| `REFERENCE_DELIVERY_PREFLIGHT_TIMEOUT_MS` | `5000` | 500 至 30000 毫秒 |
| `REFERENCE_DELIVERY_PREFLIGHT_RETRIES` | `2` | 0 至 3 次额外预检 |

Mock 模式保持现有离线行为，不访问公网。生产 compose 将上述变量只注入 Video Worker；Control API 仅继续持有签名密钥。

### 3.3 Edge/Control API 响应

`/provider-input/` 保持 `auth_basic off`、`Cache-Control: no-store`、`access_log off`、`proxy_buffering off`，并显式设置 HTTP/1.1、连接头及 10 秒连接/发送、30 秒读取超时。Control API 的无内容 404/503（含 HEAD）返回 `Content-Length: 0`，避免不支持规范 HEAD 的抓取器等待连接超时。

## 4. 安全与兼容性边界

- Token 继续使用 AES-256-GCM；生产签名密钥不进入仓库、镜像构建参数、日志或响应。
- 预检只访问 Worker 自己生成的同源 opaque URL，不接受用户提供的 URL，不跟随跨 origin 重定向。
- 读取上限沿用 Control API 的 8 MiB 与三种图片 MIME；HEAD 缺少长度时 GET 也有字节上限。
- 预检失败发生在 `ensureProviderAttempt` 之前；已有 request ID 的恢复路径完全不变，避免重复计费。
- 该补丁只改 Aiself Video OS 文件、Video VPS 的 task-worker/control-api/edge 服务；Sub2API VPS、数据库、Redis、MinIO 数据卷不重建、不修改。

## 5. 测试与验收

必须通过：

- task-worker：同源 URL 校验、HEAD 200、HEAD 405→GET、瞬态 503→成功、错误 MIME/超大/4xx fail-closed、超时取消、7 张并发预检，以及预检失败时 Provider submit 次数为 0。
- control-api：provider-input 成功 GET/HEAD、无效 token/对象不匹配返回 404 且 `Content-Length: 0`。
- TypeScript build/typecheck 与现有 task-worker/control-api 定向测试。
- Video VPS 只读验收：edge→control-api、Worker→`https://video.aiself.vip/provider-input/<invalid-token>` 均快速返回 404；部署后只重建受影响服务并观察健康检查。

## 6. 发布、回滚与停止条件

发布前备份 Video VPS 的 compose/env/Nginx 配置和当前镜像摘要。发布只更新 task-worker、control-api、edge；不执行 `down -v`，不触碰 Sub2API。若健康检查失败、Provider-input 404 延迟异常或 Worker 启动配置错误，立即用备份镜像/配置恢复这三个服务；数据库和对象存储不回滚。

本方案不承诺改变 KIE 自身 5xx/额度/权限问题；它只确保图片交付可观测、可恢复且不会因 Aiself relay 短暂不可达而盲目发起一次注定失败的提交。

## 7. 本轮实现与审计结果

- `apps/task-worker/src/reference-delivery.ts` 已实现同源 URL 校验、HEAD/GET 预检、超时取消、MIME/长度校验、有限退避和 15 分钟 TTL。
- `apps/control-api/src/app.ts` 已为 provider-input 的无内容 404/503 补充 `Content-Length: 0`。
- `infrastructure/deploy/docker-compose.video.yml`、`.env.video.example` 和两份 edge 配置已加入稳定 relay 参数；生产默认值为 preflight=true、5000ms、2 次重试、900000ms TTL。
- 本地 task-worker 测试 `42` 项中 `37` 通过、`5` 个既有环境门控跳过；无失败；task-worker/control-api typecheck 通过，Control API 定向测试 `65` 通过、`1` 个既有环境门控跳过。
- 2026-09-05 已在 Video VPS 只更新 `control-api`、`task-worker`、`edge`：内部健康 `database=ok`，公网无效 token HEAD `404`、`Content-Length: 0`、约 0.30 秒；部署后容器均 running、restart=0；容器内预检 smoke 通过。
- 未修改 Sub2API、Smart Router、数据库、Redis、MinIO 数据卷，也未发起新的真实付费视频生成请求。旧镜像保留 rollback tag 与配置备份，待独立审计窗口确认后再清理。

## 8. 2026-09-06 本地中继连接生命周期窄修（仅补充审计证据）

本轮只修复对象流的释放时机，不改变参考图的 workspace/project/asset、READY、SHA-256、MIME、字节数或 8 MiB 校验语义：

- `packages/storage-client/src/index.ts` 的 `inspectObject` 接受调用方 `AbortSignal`，HEAD 与完整 GET 共用取消信号；哈希读取成功或失败后都显式关闭底层对象体，`readObject` 的流取消也保证关闭底层对象体。
- `apps/control-api/src/app.ts` 的 provider-input HEAD 转发请求取消信号；GET 在 MIME/长度不匹配返回 404 前取消已取得的对象流。
- `apps/task-worker/src/reference-delivery.ts` 的 HEAD→GET 预检在所有分支结束时取消响应体，避免带 `Content-Length` 的 GET 连接悬挂。

定向证据：storage-client `6 pass / 1 skip`（仅 MinIO 环境门控跳过）、task-worker provider-runtime `12/12 pass`、storage-client build 与 control-api typecheck 通过；均为本地 fixture/mock，无 Provider 调用。完整本地栈已按 `VIDEO_PROVIDER=sub2api` 重启，Control API/Studio 可达；公网 relay 有效图片 token 并发 HEAD `4/4=200`，GET `200`、`765528` bytes、MIME `image/png`、SHA-256 与对象记录一致；无效 token HEAD `404`。反向 SSH relay/watchdog 已恢复为单一 `-R 127.0.0.1:18080:127.0.0.1:3133` 隧道。
