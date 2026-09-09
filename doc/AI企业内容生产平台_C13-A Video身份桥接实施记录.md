# C13-A：Video OS AISelf/Veyra 身份桥接实施记录

状态：`IMPLEMENTED_PENDING_EXTERNAL_CANARY`

本记录只覆盖 Video OS 的身份入口适配；不表示真实 Veyra、共享扣费、Provider、DNS、TLS 或 VPS canary 已验收。

## 来源与薄壳映射

| Video OS 行为 | 固定来源 | 本地薄壳 |
| --- | --- | --- |
| Portal 目标 `video`、`/_veyra/return` 回跳 | `sub2api-adapted` `custom/main` 的 `backend/internal/veyra/intent.go`、`portal_dist/app.js` | Video OS 只把 `target=video` 作为受控登录入口，不复制 Portal session |
| 一次性票据交换 | `backend/internal/veyra/routes.go` 的 `POST /api/veyra/internal/login-ticket/exchange` | `VeyraSub2ApiIdentityAdapter` 通过注入 transport 发送 POST body，强制 `intent=video` |
| Alchemy 入口回跳形状 | `Alchemy Media Agent System` 的 `/_veyra/return?target=alchemy` 及 `VeyraSub2APIClient` | Video 使用独立 `target=video` 和 `/auth/veyra/callback`，不共享 Alchemy cookie、数据库或 JSONL |
| 本地 Video 会话 | C09-B/C13-A 设计 | `__Host-video_session`、Secure、HttpOnly、SameSite=Lax、Path=/；票据不落 URL/日志/浏览器存储 |
| 工作区映射 | Video OS `createVeyraIdentitySeed`/`ControlPlaneStore.ensureIdentity` | `usr_veyra_<externalId>` 与 `ws_veyra_<externalId>` 仅写 Video OS 本地数据库 |

## 当前实现

- `GET /auth/login`（以及兼容别名 `/auth/veyra/login`）只重定向到配置的 AISelf Portal `/_veyra/return?target=video`；协议不接受任意回调 URL。
- `POST /auth/veyra/callback` 只接收 form body 的 `ticket`，服务端交换并校验 `intent=video`、过期时间和账户身份；不支持 query ticket。
- `VEYRA_AUTH_ENABLED` 只控制身份桥。登录始终通过同一 Veyra account lookup 校验账户为 active；`VEYRA_CREDIT_ENABLED` 独立控制生成前信用预检与产物成功后的 debit 装配，身份 canary 不要求正扣费金额。
- 轻量媒体服务费复用 Sub2API 现有 `usage_logs`，通过受保护 `GET /api/veyra/internal/users/{user_id}/usage/{request_id}` 读取已结算 `actual_cost`；Worker 再按冻结的 `actual_cost × 0.20 + 1` 计算 Video OS 额外费用。该端点是只读事实适配，不新增 Sub2API 账本；Provider 未成功、下载/媒体校验未通过或 usage 未结算时不进入 debit。
- Studio 通过同源 `/auth/` 代理访问 Control API，未登录时显示“前往 AISelf 登录”，不在前端存储 ticket、Veyra token 或外部身份凭据。
- 本地默认 `LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false` 不变。

## 未闭合外部门

1. Sub2API/Veyra 生产实例必须实际部署并启用 `video` target、`video_base_url` 和 Video 专用 service token；仓库中的离线/未提交适配不能替代生产证据。
2. Video VPS 私密环境必须注入 `VIDEO_VEYRA_INTERNAL_TOKEN` 与 `VIDEO_SESSION_SECRET`；两者不得写入仓库或日志。
3. 只有 identity-only canary（含 active account lookup、但不 debit）通过后，才允许切换 Nginx 去除 Basic Auth；只有另行授权后才打开 `VEYRA_CREDIT_ENABLED` 与真实 debit。
4. 真实 ticket、账户、扣费、Provider、DNS、TLS 和 VPS 结果仍需按 C13-A 授权清单记录，不能以本地 fixture 代替。

## 验证范围

- Control API：Portal redirect 无 ticket、POST callback、inactive account 拒绝、`__Host-` cookie、固定 intent 负向路径。
- Studio：同源 `/auth/` 代理和未登录入口仅显示 AISelf 登录，不读取内部地址或凭据。
- 默认配置：auth/credit flags 关闭时不访问 AISelf；credit 开启而 auth 关闭时 fail-closed。
