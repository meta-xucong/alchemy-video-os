# 账户栏与项目历史可见性适配方案

> 状态：本地最小实现，供 C13-A 账户桥接和后续审计使用。本文不改变正式总控章节状态，也不宣称生产验收通过。

## 1. 固定来源与范围

本适配只在现有 Control API、Veyra 账户桥接、项目仓储和 Studio Web 之上增加薄壳能力。固定来源是《领域模型与API事件契约》§3.1/§4、《Sub2API 与 Alchemy 共享积分适配规范》§5/§8，以及 C13-A Video 身份桥接实施记录；身份字段和登录票据继续复用 C13-A，账户、余额预检、成功后 billing receipt、`usage_records` 和共享积分时序继续复用共享积分规范。公开接口仍只使用 `/api/v1`，浏览器不接触内部路由、Provider 原生字段、对象 key、票据或 token。

本轮冻结范围是：账户栏、`GET /api/v1/me/history`、管理员只读的跨工作区项目详情、公开账户摘要脱敏，以及对应隔离测试。普通 `/api/v1/projects`、所有写入路由和其他子路由继续使用当前 workspace 语义。

## 2. 权限与查询边界

- `CurrentIdentity.role` 和 `isAdmin` 是只读能力提示，由已签名、已验证的 `VeyraExternalIdentity.role` 规范化派生；只有规范化后的精确 `admin` 才能形成候选管理员能力，`administrator`、`owner`、`user` 和 DevIdentity 不是管理员。
- 跨工作区能力不是由浏览器参数或缓存 role 授予。每次 history/detail 请求都通过 `videoVeyraBridge.getAccount(externalUserId)` 实时确认账户 `status=active` 且规范化 role 为精确 `admin`。无 bridge、无 external id、桥接失败、非活动或普通 role 均回落到当前 workspace scope。
- 管理员 history 先取得显式 workspace 目标，再逐 workspace 调用带 `workspace_id` 的 `listProjects`；管理员详情同样先解析所属 workspace，再将资产、TaskRun、planning 等只读查询全部限定到该 workspace。不能使用裸的跨 workspace project 查询，也不放宽任何写路由。
- history 响应明确 `scope=WORKSPACE|ALL_WORKSPACES`、`is_admin` 和非 `DELETED` 的公开 `Project[]`。query 参数不改变范围；credits 只返回安全账户摘要，不返回 `external_user_id`。

## 3. 前端与默认 flags

Studio Web 默认布局显示登录入口或当前账户、账户状态/余额（账户服务不可用时安全降级）、管理员标识和项目历史链接。`history.vue` 只调用 `useControlApi` 的 public history 方法，按后端 `scope/is_admin` 展示项目卡片；不自行推断管理员身份、不缓存 token/Veyra/余额、不直连内部 API。账户栏失败不阻塞项目工作页。

本地默认配置保持不变：`LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。因此本地开发通常展示安全的不可用账户状态，不能把它解释为真实余额或生产账户状态。

## 4. 计费接线与生产验收边界

现有单镜头 `TaskRun` 链路保留账户 active 预检、产物成功后的共享积分扣费、receipt 和 usage 审计；本轮没有新增 debit、余额计算或改变成功后扣费时序。

自动生产入口现在在创建 ProductionRun 前复用同一条账户 active 预检，并将 `external_user_id + BillingRuleSnapshot` 写入既有 `production_runs.budget_guard` 私有 JSONB；调度器逐段读取该事实，经 `ProductionTaskRunInput` 和 Worker snapshot 原样传给既有 `VideoBillingExecutor`。这不是项目级父账单，也不改变状态机：只有每段 Provider 产物下载、MIME/SHA/ffprobe 和对象写入成功后才进入 `BILLING_PENDING` 并按既有幂等键扣 Video OS 服务费，失败路径不扣费。

配置页 `GET /api/v1/me/billing-policy` 与 Studio `/settings/billing` 只读展示服务端当前生效的全局倍率、固定附加费和兼容模型倍率；浏览器不能修改配置，修改环境变量后需重启 Control API/Worker。真实 Veyra usage/debit 仍只在显式开启 `VEYRA_CREDIT_ENABLED=true` 的部署执行，本地默认保持关闭。计费失败通过既有任务重试入口执行 `BILLING_FAILED -> BILLING_PENDING`，不会重新提交 Provider；临时信用服务故障由 Worker 重启恢复并继续使用原任务与同一幂等键。
当服务端已配置倍率/固定附加费但 bridge 或已验证 AISelf 身份不可用时，创建任务必须 fail-closed，不允许继续生成而漏掉 Video OS 服务费；旧固定金额与 usage 规则混配同样阻断。

## 5. 最小验证矩阵

- identity：只有规范化 `admin` 才为候选管理员；`administrator`、`user|owner` 和 DevIdentity 为非管理员；bootstrap/session 篡改失败关闭。
- history：普通用户只见自己的 workspace；实时 active 管理员可见多个 workspace；`DELETED` 不见；query 参数不能扩权；bridge 缺失、失效或普通 role 回落 workspace scope。
- detail/写入：已验证管理员可读跨 workspace detail，普通用户跨 workspace 为 404；管理员不能跨 workspace PATCH/DELETE 或通过其他子路由写入。
- frontend static：账户栏有登录/历史/安全错误状态；history 使用 public `/api/v1/me/history` 并呈现后端 scope；源码无 internal/provider/token/localStorage 暴露。
- 既有 `me/credits`、身份桥接和 billing 测试继续运行；credits DTO 断言不含 `external_user_id`。
- 自动生产快照包含 billing 私有事实，生产 Worker snapshot 保留该事实；无数据库时的 integration 测试仍按环境缺失保持 skip，不以静态路径代替真实数据库证据。
