# Video OS：Sub2API / Alchemy Veyra 桥接适配器开发设计

## 1. 目的与结论

本设计为 Video OS 增加一个专用的 Veyra 桥接适配器，承接 Alchemy 门户身份、Sub2API 账户和视频扣费之间的协议联动。适配器只负责服务间协议编排和边界校验，不把 Sub2API 用户表、余额账本、Alchemy 会话、Video 项目数据库或 Provider 任务状态合并到一起。

已核查来源仓库 `meta-xucong/sub2api-adapted`，基线为分支 `custom/main`、commit `37480b1fb`。该仓库确实包含桥接所需的事实实现：

- `backend/internal/veyra/ticket.go`：随机票据、TTL、单次消费。
- `backend/internal/veyra/routes.go`：`data` envelope、内部 token、ticket exchange、account 和 debit 路径、`402/409` 语义。
- `backend/internal/veyra/session.go`：Portal JWT 到用户账户的解析。
- `backend/internal/veyra/intent.go`：当前仅有 `home`、`sub2api`、`alchemy`、`aggregate`，尚无 `video` intent。
- `backend/internal/service/video_billing.go` 与 `video_billing_resolution.go`：Grok 视频按模型、分辨率、秒数归一化和单价查找。

因此，Video OS 可以复用既有协议和计费规则，但不能声称源仓库已经完成 Alchemy 到 Video 的完整接入。`video` Portal target、无 query ticket 的 handoff、Video 本地 session、external identity 映射和 billing recovery 仍是后续跨仓库发布工作。

## 2. 适配器边界

新增 `VideoVeyraBridgeAdapter`，组合现有 `VeyraSub2ApiIdentityAdapter` 与 `VeyraSub2ApiCreditAdapter`：

```ts
interface VideoVeyraBridgeAdapter {
  exchangeVideoTicket(input: { ticket: string }): Promise<VeyraExternalIdentity>;
  getAccount(input: { externalUserId: number }): Promise<CreditAccount>;
  debit(input: CreditDebitInput): Promise<CreditDebitResult>;
}
```

硬性规则：

1. `exchangeVideoTicket` 固定要求 `expectedIntent="video"`；`alchemy` 或其他 intent 一律拒绝。
2. 适配器只接受注入的 transport 和 service token，不读取 `process.env`、`.env`、浏览器 Cookie 或 URL。
3. token、ticket、Provider key、prompt、媒体 URL 和原始上游 body 不进入返回 DTO、日志或异常消息。
4. account 只用于预检和公开的安全余额摘要；Video 不复制余额，也不本地计算余额。
5. debit 只在产物校验成功后的 `BILLING_PENDING` 阶段调用，幂等键由冻结的 `billing_rule_key + task_run_id` 组成。
6. 适配器不创建本地 session，不写数据库，不直接调用 Provider；本地 session、external identity 和 billing attempt 由 Control API/Worker 后续装配。

## 3. 外部协议映射

| 能力 | Sub2API 路径 | 适配器行为 |
| --- | --- | --- |
| 换取 Video 身份 | `POST /api/veyra/internal/login-ticket/exchange` | 发送 `{ticket}`，验证 `data.intent=video` 和未来时间的 `expires_at` |
| 账户查询 | `GET /api/veyra/internal/users/{user_id}/account` | 验证用户 ID、状态、余额精度和并发字段 |
| 原子扣费 | `POST /api/veyra/internal/billing/debit` | 发送 snake_case 请求，严格回验 user、amount、idempotency key |

所有请求使用 `X-Veyra-Internal-Token`。错误统一复用现有 `AUTH_*`、`CREDIT_*` 错误码：`402 -> CREDIT_INSUFFICIENT`，`409 -> CREDIT_CONFLICT`，`401/403 -> AUTH_FORBIDDEN`，网络/5xx -> 可重试的 `CREDIT_UNAVAILABLE`。

## 4. Alchemy 入口与部署边界

Alchemy “生视频（DEMO）”的正式入口需要在 `sub2api-adapted` 中新增 `video` intent/target，并采用不含 query ticket 的一次性 handoff。适配器不把 ticket 拼接到 URL；在跨仓库入口尚未发布前，Video 页面仍保持独立入口。

推荐发布顺序：

1. Sub2API 增加 `video` intent、Portal allowlist 和独立 service credential。
2. Alchemy Portal 只为已登录用户申请 Video ticket，并跳转到 Video 的一次性 callback；不把 ticket 写入日志、localStorage 或长期 URL。
3. Video Control API 兑换 ticket、校验 intent、upsert external identity，再签发 Video 自己的 HttpOnly/Secure 会话。
4. Video Worker 通过本适配器查询账户、完成 Provider 产物校验后扣费并写 usage receipt。
5. 在一名测试用户、有限 ticket/debit 次数和固定额度内执行 canary，再扩大入口。

本次实现已完成 Video OS 端协议适配器、真实 HTTPS transport、视频专用 POST 回调会话、Portal 视频入口和离线契约测试；真实运行仍由 `VEYRA_AUTH_ENABLED` 及私有变量显式开启，不会改变默认 Mock 或 Worker-only Provider 密钥边界。

生产变量为 `VIDEO_VEYRA_INTERNAL_BASE_URL`、`VIDEO_VEYRA_INTERNAL_TOKEN`、`VIDEO_SESSION_SECRET`。共享账户通过 `GET /api/v1/me/credits` 返回受控 DTO；票据不会进入 URL、日志或浏览器持久化状态。

## 5. 测试与验收

- Video intent 缺失、intent mismatch、过期 ticket、单次消费错误映射。
- `data` envelope、内部 token、账户和 debit 字段映射。
- `402/409/401/403/5xx` 错误归一化。
- 金额八位小数安全转换和响应指纹回验。
- 同一 debit 输入可重放；不同金额、source 或 reference 不可伪造为成功。
- 静态检查证明适配器不读取环境、不导入 persistence/Provider/Studio、不记录 secret。

真实 ticket、account、debit 和 VPS 发布仍属于 C13-A 后续门禁，不能由离线测试替代；本地协议、回调、会话和扣费状态机已具备可验证实现。

## 6. 来源登记

- 来源：`https://github.com/meta-xucong/sub2api-adapted`
- 分支：`custom/main`
- Commit：`37480b1fb`
- 复用：Veyra ticket/intent、`data` envelope、内部 token、account/debit 字段、402/409 语义、Grok 视频计费归一化。
- 未复用：Sub2API users/balance ledger、Portal JWT/session、Alchemy Cookie/JSONL、完整 Portal 页面、进程内任务状态。
- 本地改造：组合既有 `packages/credit-veyra` Identity/Credit Port，增加固定 `video` intent 的桥接门面、HTTPS transport、POST 回调签名会话、Portal 视频入口和 Worker 下载后扣费状态机。

> **2026-09-01 当前音频口径**：C13-A/Veyra 设计不要求用户上传旁白/样音；自动视频优先保留 Provider 原生音频，显式 Doubao 替换仍走最新自动音频文档的服务端路径。C13-A 的 Veyra、共享积分和部署边界继续后置/阻断；本机 Grok/Doubao 对照不构成 Veyra 启用或本章状态变更。
