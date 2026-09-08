# AI 企业内容生产平台：安全与密钥规则

## 1. 适用范围

本规则适用于本地开发、离线测试、真实 Provider 认证、共享积分接入和未来部署。当前本地阶段必须采用最严格的“无真实凭据”模式。

> **本轮限定例外（2026-09-01）**：用户已授权本机一次性 Aiself Grok/Doubao 对照；凭据只通过未入库进程环境临时注入到对应 Worker/Runtime，完成后清理。该例外不改变默认/CI 无真实凭据、不要求用户上传旁白/样音，也不启用 Veyra、共享积分或部署。

## 2. 密钥分类和归属

| 凭据 | 使用模块 | 当前状态 | 允许出现的位置 |
| --- | --- | --- | --- |
| `SUB2API_VIDEO_API_KEY` | `provider-worker` | 本地关闭 | Worker 私有环境/密钥存储 |
| `VEYRA_INTERNAL_TOKEN` | `packages/credit-veyra` | 本地关闭 | 服务端私有环境/密钥存储 |
| `VEYRA_SESSION_SECRET` | 身份适配器 | 本地关闭 | 服务端私有环境/密钥存储 |
| S3/MinIO secret | `storage-client` | 本地使用假值 | `.env.local`，不得提交 |
| 数据库密码 | persistence | 本地使用假值 | Compose/.env.local，不进入日志 |

任何 Key 不得出现于：

- Git、Markdown 真实示例、测试 fixture、Playwright snapshot、数据库普通字段。
- 浏览器请求、localStorage、URL query、SSE、事件、任务 payload、错误消息。
- 结构化日志、trace 属性、Provider 原生 response 持久化。

## 3. 本地默认安全配置

```dotenv
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
SUB2API_VIDEO_API_KEY=
VEYRA_INTERNAL_TOKEN=
```

`VIDEO_PROVIDER=mock` 时不能偷偷读取或验证真实视频 Key。`VEYRA_AUTH_ENABLED=false` 时不得读取 Veyra Token、请求账户、生成票据或创建扣费记录。

## 4. 网络和对象存储

- Web 只能访问 Control API 和由 API 签发的短期上传/下载 URL。
- API/Worker 不允许把用户可控 URL 直接传给文档 converter 或 Provider；引用资产必须来自已授权对象存储。
- MarkItDown Runtime 使用服务端下载流和 `convert_stream`，禁止任意 URI 网络访问。
- Provider 下载完成必须落入平台对象存储；上游 content URL 不作为永久资产。
- object key 由服务端根据 workspace/project/asset 生成；客户端提交的 key 不可信。
- 下载到临时文件后进行大小、MIME、SHA-256 和 `ffprobe` 检查，失败文件按生命周期清理。

## 5. 身份和工作区隔离

- 本地使用 `DevIdentityAdapter`，固定 `usr_dev_owner` 和 `ws_dev_default`。
- 未来 Veyra ticket 只由服务端一次性消费；不得记录票据原文。
- 本地授权依据是 `workspace_members`，不是外部 Sub2API `user_id`。
- 所有 Repository 查询必须带 `workspace_id` 或通过关系可证明地回溯到 workspace。
- 外部用户 ID 只能作为 Veyra adapter 输入和审计字段，不作为本地权限凭据。

## 6. 日志和脱敏

允许记录：`request_id`、`correlation_id`、`task_run_id`、`provider_attempt_id`、状态、错误码、重试次数、hash。

必须脱敏或禁止记录：Authorization、API Key、内部 Token、ticket、session cookie、presigned URL query、完整 prompt 中的私人资料、完整 Provider response 和对象私有路径。

Provider 审计只保存字段名、状态、原生错误 code、响应摘要和 hash。日志测试必须搜索敏感字段模式并失败。

## 7. 真实调用门禁

真实视频认证必须同时满足：

1. 用户指定 profile、测试次数、额度上限和测试素材。
2. `.env.local` 或密钥存储中存在 Key。
3. 命令显式使用 `--live`。
4. `CERTIFY_LIVE_VIDEO=true`。
5. `CERTIFY_MAX_SUBMISSIONS` 为有限正整数。

共享积分必须另外通过 fake server 契约测试，真实 `VEYRA_AUTH_ENABLED=true` 只能在明确授权下启用。测试报告不得提交真实 request ID、Key、余额和签名 URL。

## 8. 事故处理

如果凭据疑似泄露：立即停止真实调用，撤销/轮换凭据，删除本地报告和日志副本，记录事故时间和影响范围。不得使用 Git 历史重写代替凭据轮换。

如果发现跨 workspace 数据：停止相关接口，保留失败测试和数据库快照，先修复 Repository 条件和授权测试，再恢复功能。

## 9. 审计清单

- [ ] `.gitignore` 覆盖 `.env*`（保留 `.env.example`）、reports、临时媒体和本地卷。
- [ ] 凭据扫描无命中。
- [ ] 日志脱敏测试通过。
- [ ] Web 无法访问内部 API、Provider 和 Veyra。
- [ ] 跨 workspace 读取/下载测试通过。
- [ ] 真实 feature flag 默认关闭。
