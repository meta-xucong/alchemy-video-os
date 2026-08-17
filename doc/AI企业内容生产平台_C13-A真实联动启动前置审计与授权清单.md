# AI 企业内容生产平台：C13-A 真实联动启动前置审计与授权清单

状态：`BLOCKED_PENDING_AUTHORIZATION`

日期：2026-08-16

关联文档：

- `AI企业内容生产平台_正式开发总控文档.md`
- `AI企业内容生产平台_C09-B三VPS联动设计.md`
- `AI企业内容生产平台_C09-C真实Provider运行时接入.md`
- `AI企业内容生产平台_C09-C图生与多参考素材适配设计.md`
- `AI企业内容生产平台_Sub2API与Alchemy共享积分适配规范.md`
- `AI企业内容生产平台_VPS与SUB2API视频接入补充方案.md`

## 1. 结论

C09-C、C10、C11、C12 已具备进入 C13-A 的本地技术前置条件：Provider adapter、参考图 relay 设计、本地长叙事编排、逐段 Mock 执行、QC、交接帧、版本化成片、播放下载和审计记录均已完成。

但 C13-A 的真实执行会触达真实 Provider、Veyra、Sub2API、Alchemy、VPS、DNS、TLS、密钥、扣费和部署边界。当前只能完成启动前置审计和授权清单，不能执行任何真实动作。

## 2. 当前允许继续做的事

在没有新的明确授权前，只允许：

1. 阅读和整理本仓库已有文档、测试、部署模板和审计记录。
2. 写 C13-A 设计、runbook、回滚手册、授权清单和验收矩阵。
3. 做离线代码审计、静态扫描、Mock/fake transport 测试。
4. 验证默认配置仍为 fail-closed：`LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。
5. 检查公开 DTO、SSE、日志和测试 fixture 不泄露 key、ticket、签名 URL、对象 key 或 Provider 原始响应。

## 3. 当前禁止做的事

在用户补齐第 4 节授权参数前，禁止：

1. 读取 `.env.local`、VPS 私有环境文件、真实 API Key、Veyra token、session secret 或 SSH key 内容。
2. 调用 `aiself.vip`、`alchemy.aiself.vip`、SUB2API 视频接口、Veyra internal API 或任何真实 Provider。
3. SSH 登录 VPS、修改 Nginx、DNS、TLS、Compose、systemd、生产数据库、对象存储、Sub2API Portal 或 Alchemy 服务。
4. 开启 `VIDEO_PROVIDER=sub2api`、`VEYRA_AUTH_ENABLED=true`、`VEYRA_CREDIT_ENABLED=true` 或任何真实 feature flag。
5. 发起 ticket exchange、account 查询、debit、真实视频提交、真实轮询、真实下载或付费调用。
6. `git add`、提交、推送、tag、强制同步或重写历史。

## 4. 启动 C13-A 必须由用户一次性明确的授权参数

| 授权项 | 必填内容 | 为什么需要 |
| --- | --- | --- |
| 测试用户范围 | 允许使用的 Veyra user/account，是否仅 owner | 避免误触真实用户数据和余额 |
| ticket 次数上限 | 允许签发/消费多少次 Video ticket | 控制登录桥真实验证范围 |
| debit 次数和额度 | 最大扣费次数、单次金额、总额度、币种或积分单位 | 防止无限扣费或误扣 |
| Provider profile | `aiself-grok`、Seedance 或其他 profile；每个 profile 的调用次数 | 防止旧授权被扩大复用 |
| 测试素材 | 允许用于真实视频的图片、文本、项目或 fixture | 避免隐私、版权和内容安全风险 |
| VPS 范围 | 新 Video VPS 的 host 标识、是否允许 SSH、允许改哪些服务 | 防止误改 Sub2API/Alchemy/其他 VPS |
| DNS/TLS 范围 | 是否允许配置 `video.aiself.vip`、`assets.video.aiself.vip`、证书和反代 | 域名和证书是外部生产边界 |
| 维护窗口 | 可接受的执行时间、最长中断、失败后通知方式 | 控制真实服务变更风险 |
| 回滚负责人 | 失败时是否由 Codex 执行回滚，或只报告等待人工 | 防止自动扩大破坏面 |
| Git 发布策略 | 是否允许新分支、提交、推送；目标远端和分支 | 当前工作区有大量未提交变更，不能默认发布 |

## 5. 推荐执行顺序

### Phase 0：本地静态预检

1. 确认 C09-C、C10、C11、C12 审计记录均为 `ACCEPTED`。
2. 扫描代码中真实 Provider/Veyra/VPS 开关，确认默认 fail-closed。
3. 复核部署包 `infrastructure/deploy/` 不包含真实 secret。
4. 复核运行时：Control API 和 Studio 不读取视频 Key；Worker 才能读取 Provider secret。

完成标准：无外部调用、无密钥读取、无部署动作；只形成预检报告。

### Phase 1：C13-A 离线实现审计

1. 设计 `VeyraIdentityAdapter` 的 ticket exchange、intent 校验、host-only session 和 workspace mapping。
2. 设计 `CreditPort` 真实装配、billing rules、billing attempts、debit replay 和 crash recovery。
3. 设计 Sub2API Portal `video/video-mobile` target 的 allowlist 和 POST handoff。
4. 写 fake transport 测试覆盖 expired/reused ticket、402、409、401/403、5xx、debit replay 和 billing retry 不重复 submit。

完成标准：仍无真实网络；所有测试使用 fake server 或离线 fixture。

### Phase 2：Video VPS 空壳部署

1. 只部署 `VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false` 的 Video stack。
2. 验证 `video.aiself.vip`、`assets.video.aiself.vip`、Basic Auth、TLS、S3 CORS、私有对象存储、健康检查和日志脱敏。
3. 不显示 Portal target，不签发 ticket，不查询 account，不 debit，不提交 Provider。

完成标准：匿名访问被挡住，登录桥未开启，Mock 页面可运行。

### Phase 3：Veyra identity canary

1. 只对授权测试用户启用 `video` target 和 ticket exchange。
2. 验证一次性 POST handoff、intent=video、过期/重复/伪造 ticket 拒绝、host-only session、logout/revoke。
3. 保持 `VEYRA_CREDIT_ENABLED=false` 和 `VIDEO_PROVIDER=mock`。

完成标准：能安全登录 Video Studio，但没有真实扣费和真实 Provider。

### Phase 4：真实 Provider canary

1. 使用已授权 profile、次数、素材和费用上限。
2. Worker-only 注入 `SUB2API_VIDEO_BASE_URL` 与 `SUB2API_VIDEO_API_KEY`。
3. 只提交最小测试任务，持久化 provider_request_id 后只允许恢复查询/下载，不重复 submit。
4. 成品下载后完成 MIME、SHA-256、ffprobe、对象存储归档和公开播放验证。

完成标准：一条真实任务可以端到端成功或以可审计原因失败；无凭据泄露。

### Phase 5：共享积分 canary

1. 开启单个冻结 billing rule 和极小额度。
2. 提交前做 account preflight；余额不足时不得入 Provider queue。
3. 视频产物验证后进入 `BILLING_PENDING`，用固定 key 执行 debit。
4. 验证 success、replayed、402、409、5xx、远端成功本地崩溃后的 receipt 补写。

完成标准：真实扣费幂等可审计，billing retry 不触发第二次 Provider submit。

## 6. C13-A 验收矩阵

| 类别 | 必须证明 | 证据 |
| --- | --- | --- |
| Portal target | `video`/`video-mobile` 是枚举 allowlist，不接受任意 URL | Sub2API 测试和部署 diff |
| Ticket | POST handoff，无 URL ticket；过期、重复、intent mismatch 均拒绝 | 浏览器与日志脱敏测试 |
| Session | `__Host-video_session` host-only、HttpOnly、Secure、SameSite=Lax | 浏览器 Cookie 检查 |
| Workspace | 外部身份只能映射到 Video 本地 workspace，不跨 Alchemy/Sub2API 读库 | API/DB 测试 |
| Provider | Worker-only 读取 key；submit 后恢复只 poll/download | ProviderAttempt 和 Worker 日志 |
| Relay | `/provider-input/<token>` 不泄露 object key，GET/HEAD 单资源短 TTL | relay token 测试和 access log 扫描 |
| Credit | account unavailable/insufficient 不提交 Provider | Control API/Worker 集成测试 |
| Debit | success/replayed 只写一条 usage receipt | Veyra 响应与本地 DB 对账 |
| Recovery | 远端 debit 成功、本地崩溃后只 replay debit，不重生成视频 | fault injection 测试 |
| Rollback | 关闭 credit/provider flags 后不再产生新真实提交或扣费 | 回滚演练记录 |
| Observability | 日志、事件、DTO、DB 普通字段无 key/ticket/signature/object key/provider raw body | secret scan 和抽样 |

## 7. 最小授权文本模板

如果要真正进入 C13-A，可以让用户按下面格式给出一次性授权：

```text
授权进入 C13-A 真实联动 canary。
测试用户：
ticket 上限：
debit 上限与总额度：
Provider profile 与调用次数：
测试素材范围：
允许 SSH/VPS 范围：
允许 DNS/TLS 范围：
维护窗口：
失败时是否允许 Codex 自动回滚：
是否允许 Git 分支/提交/推送：
```

没有这份授权时，本项目只能继续做离线审计、设计和 Mock/fake 测试。

## 8. 当前状态

本文件只完成 C13-A 的启动前置审计与授权清单。真实联动仍未开始；没有读取密钥，没有 SSH，没有真实 Provider、Veyra、VPS、DNS、TLS、扣费、部署或 Git 写入。

## 9. 用户授权 Codex 自定的最小 canary 参数

2026-08-16，用户明确要求 Codex “自己设置一个测试号，自己设置合理的参数，然后继续”。据此，C13-A canary 采用下列保守参数。任何实际执行仍按 Phase 0 -> Phase 5 顺序推进；前一阶段不通过，不进入后一阶段。

| 参数 | Codex 设定值 | 约束 |
| --- | --- | --- |
| canary 名称 | `c13a-video-canary-20260816` | 只用于本次 C13-A 验证 |
| 测试用户 | 优先创建或使用专用 `video_canary_20260816`；若 Veyra 不支持安全创建，则仅使用 owner 自测账号 | 不使用普通客户账号；不扩大到多用户 |
| ticket 上限 | 最多 3 次真实 ticket 消费 | 1 次成功、1 次重复/伪造、1 次过期或失败路径；不足时停 |
| Provider profile | `aiself-grok` / `grok-imagine-video-1.5` | 不推断 Seedance 或其他 profile |
| Provider 调用上限 | 最多 2 次真实视频提交 | 1 次最小文生或连通性任务，1 次单张安全参考图任务；不做 7 图真实压测 |
| 视频参数 | `5s / 720p / 16:9` | 采用已验证默认组合；不做高分辨率或长时长 |
| 测试素材 | 合成、无真人、无品牌、无隐私的几何/色块图片和一句短描述 | 不使用用户商业素材、人物肖像或长文本 |
| debit 上限 | 仅 Phase 5；最多 1 次真实成功 debit + 1 次 replay 验证；总额上限 `0.10` 账户单位 | 如果上游最小扣费高于该值，停止并记录，不强行扣费 |
| VPS/SSH 范围 | 先只读识别 Sub2API、Alchemy 和新 Video VPS；写操作只允许落在明确标记的新 Video VPS 或 canary 配置 | 不改无关 VPS；不重启生产服务 |
| DNS/TLS 范围 | 仅当确认新 Video VPS 后，允许配置 `video.aiself.vip` 和 `assets.video.aiself.vip` 的 canary 所需记录/证书 | 不改 `aiself.vip`、`alchemy.aiself.vip` 主入口 |
| 维护窗口 | 即时 canary，每个写操作前后做 health；单个变更窗口不超过 20 分钟 | 失败即回滚到上一健康状态 |
| 回滚权限 | 允许回滚 Codex 本次创建或修改的 canary 配置、feature flag、容器和反代片段 | 不删除历史业务数据、账本或用户资产 |
| Git 策略 | 继续禁止 Git 暂存、提交、推送，直到用户验收并单独要求发布 | 当前工作区仍有大量本地改动 |

### 9.1 继续推进的当前顺序

1. Phase 0：本地静态预检和只读远程清点。
2. Phase 1：补齐 fake-transport identity/billing 测试与 fail-closed 检查。
3. Phase 2：只有在识别出安全的新 Video VPS 后，才准备 Mock 空壳部署。
4. Phase 3-5：只有前一阶段证据完整后，才打开 identity、Provider、credit canary。

## 10. Phase 1 身份入口离线实现记录

2026-08-16，按用户授权的最小 canary 参数，先完成 `VeyraIdentityAdapter` 的离线入口，不创建真实账号、不消费真实 ticket、不查询余额、不扣费、不部署。

实现边界：

- `packages/contracts/src/credit.ts` 新增内部 `VeyraLoginTicketExchangeInputSchema`、`VeyraExternalIdentitySchema` 和固定 `video` intent。
- `packages/credit-veyra/src/identity-adapter.ts` 新增 `VeyraSub2ApiIdentityAdapter.exchangeTicket()`，复用已存在的 injected transport 形态，只调用 `POST /api/veyra/internal/login-ticket/exchange` 语义。
- 票据只通过 POST body 进入服务端 adapter；不支持 URL query、localStorage 或日志传递。
- adapter 仅接受 `intent=video` 且未过期的响应；`alchemy`、重复、伪造、过期或未知响应均 fail-closed。
- 身份错误只归一化为 `AUTH_FORBIDDEN` 或 `AUTH_UNAVAILABLE`，不把上游错误、ticket、token 或响应原文写入错误消息。
- 源码仍没有默认 HTTP client、`fetch()`、`process.env` 或真实 URL；真实网络 transport 仍未实现。

验证：

- `pnpm --filter @alchemy-video/contracts test`：30/30 通过。
- `pnpm --filter @alchemy-video/contracts typecheck`：通过。
- `pnpm --filter @alchemy-video/credit-veyra test`：10/10 通过。
- `pnpm --filter @alchemy-video/credit-veyra typecheck`：通过。
- `pnpm --filter @alchemy-video/contracts generate`：通过。
- `git diff --check` 针对本次 C13-A 身份文件和相关契约：通过。

剩余 Phase 1 工作：

1. 补齐本地 session/workspace mapping 的离线契约与 fail-closed 装配测试。
2. 补齐 billing attempt/recovery 的离线执行边界，验证 402、409、5xx、debit replay 和远端成功本地崩溃后的 receipt 补写。
3. Sub2API Portal 侧 `video/video-mobile` target allowlist 仍需在部署阶段或 Sub2API 仓库中单独实现；本仓库当前只保留对 `intent=video` 的消费端校验。

## 11. Phase 1 本地身份映射与计费恢复实现记录

2026-08-16，继续完成 Phase 1 的本仓库离线实现范围。

身份映射：

- `apps/control-api/src/identity.ts` 增加 `createVeyraCurrentIdentity()` 与 `createVeyraIdentitySeed()`，把 `externalUserId=20260816` 这类 Veyra 身份映射为本地 `usr_veyra_<externalUserId>` / `ws_veyra_<externalUserId>`。
- `ControlPlaneStore` 新增通用 `ensureIdentity()`，`ensureDevIdentity()` 仍保留并委托到通用方法；本地 dev 身份行为不变。
- Control API 只在 `IdentityPort.resolve()` 明确携带 `bootstrap` 时创建 Veyra 映射；未携带 bootstrap 的身份不会被静默创建。
- 若 resolved identity 与 bootstrap 的 user/workspace 不一致，返回 `AUTH_UNAVAILABLE`，不暴露 email、ticket 或上游身份材料。
- 既有 dev 用户存在但 workspace 不匹配时仍返回 `WORKSPACE_FORBIDDEN`，避免破坏既有授权语义。

计费恢复：

- `apps/task-worker/src/billing-executor.ts` 增加独立 `VideoBillingExecutor`，只处理 `CreditPort.debit()`、`UsageReceipt` 持久化回调和 billing 状态分类；不导入或调用视频 Provider。
- debit 输入由领域层 `createBillingDebitPlan()` 冻结，幂等键固定为 `billing_rule_key + task_run_id`。
- 远端 debit 成功但本地 receipt 写入失败时，下一次执行会用同一幂等键再次调用 debit；如果上游返回 `replayed=true`，只补写一条 receipt 并标记 billing 成功。
- `402`、`409`、不可重试拒绝进入 terminal billing failure；`5xx` / 临时 credit 不可用进入 retry，不伪造 receipt。
- 错误消息只使用平台安全文案，不透传上游错误正文。

验证：

- `pnpm install --offline`：通过，零下载，只刷新 workspace link。
- `pnpm --filter @alchemy-video/control-api test`：29 通过，1 个既有服务门控 skip。
- `pnpm --filter @alchemy-video/control-api typecheck`：通过。
- `pnpm --filter @alchemy-video/persistence typecheck`：通过。
- `pnpm --filter @alchemy-video/task-worker test`：29 通过，5 个既有服务门控 skip。
- `pnpm --filter @alchemy-video/task-worker typecheck`：通过。

Phase 1 本仓库离线范围当前可视为完成。仍未完成且不得自动越过的外部边界：

1. Sub2API 服务端 `video/video-mobile` intent/target allowlist 尚未改造。
2. 安全的新 Video VPS 仍未识别，Phase 2 远程部署继续阻塞。
3. 未消费真实 ticket、未查真实 account、未执行真实 debit、未提交真实 Provider、未修改 DNS/TLS/VPS、未写 Git。
