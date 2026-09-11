# 轻量媒体服务费计费方案

## 目标

视频（以及未来接入同一计费端口的图片）任务只有在产物成功生成、下载并通过媒体校验后，才读取 AISelf/Sub2API 为该 Provider request 记录的真实 `actual_cost`。Sub2API 的真实费用保持 1 倍；Video OS 只增加一笔产品服务费：

```text
base_charge = actual_cost                         # Sub2API 已结算的真实费用
media_os_extra = actual_cost × 0.20 + 1.00000000
total_charge = base_charge + media_os_extra
```

Video OS 的 debit 只发送 `video_os_extra`，不能再次发送 `total_charge`；Sub2API 继续保留自己的原生扣费和账本。Grok、ChatGPT、Seedance 等模型不在 Video OS 复制价格表，均使用 Sub2API 返回的真实 `actual_cost`。

本方案中的“失败不扣费”特指 Video OS 的额外服务费：Provider 未成功、下载/媒体校验失败或 usage 未结算时，Video OS 不执行 debit。Sub2API 基础费用仍由其自身的原生结算规则决定，Video OS 不复制也不改写该账本。

## 来源与复用边界

- Alchemy `app/services/generation.py`：产物校验成功后 debit，固定幂等键，再写本地 usage receipt。
- Alchemy `app/services/veyra_auth.py`：账户查询与 debit 的职责分离。
- Video OS 现有 `packages/credit-veyra`、`packages/domain/src/billing.ts`、`packages/persistence/src/billing-repository.ts`：复用 Veyra account/debit envelope、十进制金额、同键 replay/conflict、receipt 持久化和 `BILLING_PENDING` 状态。
- Sub2API `usage_logs.actual_cost` 与 `billing_service.go` 的 `ActualCost = TotalCost × rateMultiplier`：只复用其“实际量”和倍率事实；不复制 Sub2API 余额、usage 表或扣费实现。Sub2API 各模型的 `rateMultiplier=1` 是基础费用口径，价格修正仍由 Sub2API 自己完成。
- 本次薄适配基于 Sub2API `custom/main` 工作树（基线 `19308bad10182d8bb556430271003d5b6780a19d`）：`backend/internal/service/usage_service.go` 复用现有 `ListWithFilters`，`backend/internal/veyra/routes.go` 仅增加受保护的 usage 读取路由；没有新增表或第二本账。

## 最小运行链路

1. Control API 创建任务时只冻结 `external_user_id`、模型名、Video OS 服务费倍率 `0.20` 和固定费 `1`；不冻结预计金额或本地模型价格。
2. Worker 获得 Provider request id，并在视频下载、MIME、SHA、ffprobe 和对象写入成功后进入 `BILLING_PENDING`。
3. Worker 通过注入的 `VideoUsagePort` 按 `external_user_id + provider_request_id` 读取唯一真实 usage 事实，并校验返回模型与快照模型一致。
4. 领域层使用十进制定点数计算 `actual_cost × multiplier + fixed_fee`，结果规范化为现有 8 位 credit decimal。
5. 复用现有 `CreditPort.debit`，幂等键仍为 `billing_rule_key:task_run_id`；成功后只写一条 `usage_records` receipt，远端 replay 只补写本地 receipt。
6. usage reader 暂时不可用或尚无记录时，已通过媒体校验的产物保持 `BILLING_PENDING`，不按预计时长/固定金额扣费，也不重新提交或下载 Provider；usage 到达后只恢复计费。模型不匹配或 actual cost 非法仍保持 fail-closed，不执行 debit。

## 配置

服务端使用一个全局服务费倍率和固定费；旧模型映射仅作为兼容覆盖：

```dotenv
VIDEO_BILLING_SURCHARGE_MULTIPLIER=0.20
VIDEO_BILLING_FIXED_FEE=1
# Optional legacy/model-specific surcharge overrides when the global value is absent.
VIDEO_BILLING_MODEL_RATES_JSON=
```

Studio 的“计费配置”页面和 `GET /api/v1/me/billing-policy` 只读展示上述服务端环境的有效值；它们不提供浏览器写入能力。启用真实扣费时必须同时开启 `VEYRA_CREDIT_ENABLED=true`、注入 Veyra bridge/Token，并重启 Control API 与 Worker；任务创建时冻结规则，不能在运行中被配置变化改写。

任务快照中的 `usagePricing.multiplier` 表示额外倍率，`usagePricing.fixedFee` 表示额外固定费。旧的 `VIDEO_BILLING_CHARGE_AMOUNT` 固定金额路径保持兼容，但不能与新的 usage 规则同时启用。
只要服务端配置了任一真实计费规则而 Veyra bridge 或已验证 AISelf 身份缺失，Control API 必须以 `CREDIT_UNAVAILABLE`/`AUTH_UNAVAILABLE` 阻断新任务；不能生成后再静默跳过 Video OS 服务费。全局倍率优先于模型映射，未配置规则时才保持本地无计费模式。

计费异常按任务状态机收口：成功产物落库后才进入 `BILLING_PENDING`；临时 Veyra/信用服务故障进入 `RETRY_SCHEDULED`，Worker 重启恢复时只回到 `BILLING_PENDING`，继续使用同一扣费幂等键，不重新提交 Provider。余额不足、冲突或明确拒绝进入 `BILLING_FAILED`；用户充值后通过既有“重试任务”命令回到 `BILLING_PENDING`，只重试扣费，不重新生成视频。启用计费的 Worker 同时按既有恢复扫描机制定期唤醒 `BILLING_PENDING`（单次只读取 usage、扣费和发布既有成功事件，不重提 Provider）；浏览器仍只看到公开 TaskRun 状态。

Studio 将 `BILLING_PENDING` 及可恢复的计费 `RETRY_SCHEDULED` 映射为蓝色“等待费用结算”，明确说明视频已经生成且不会重复提交；只有实际失败或不可恢复阻断才显示红色错误。

## 当前边界

自动 ProductionRun 已复用既有 `production_runs.budget_guard` 私有字段保存 billing snapshot，调度到每个 segment 的 `ProductionTaskRunInput`，再由现有 Worker billing executor 在成功产物后结算。该字段不进入公开 ProductionRun DTO，也不产生项目级重复扣费。

Sub2API 的受保护 Veyra 端点 `GET /api/veyra/internal/users/{user_id}/usage/{request_id}` 现在只读复用既有 `usage_logs`，支持原 request id 与 Grok 已有的 `grok-video:` 稳定键；Video OS 的 `VeyraSub2ApiVideoUsageAdapter` 只读取这条事实，不创建第二本账。usage 尚未落账时返回可重试的未就绪；Worker 已先保存通过校验的媒体并停在 `BILLING_PENDING`，由启动恢复或运行中的定期恢复扫描继续读取 usage 和扣费，不重复提交/下载，也不以预估金额代替。

AISelf/Sub2API 自身已经会从用户余额扣除 `actual_cost`。本方案明确要求 Video OS 再收取独立的产品服务费，因此两笔账必须在 receipt/source 中区分；Video OS 不得把 Sub2API 基础费用再次作为自己的 debit。默认 `VEYRA_CREDIT_ENABLED=false` 仍保持关闭，真实启用必须使用同一计费单位。

当前仓库尚没有独立的 `IMAGE_GENERATION` Provider/Worker 任务链；图片计费暂不虚构运行时接线。图片链路建立后应复用本方案的 `calculateUsageCharge`、十进制快照和成功后 debit 顺序，不另建倍率或失败扣费路径。因而当前实现不会对图片上传或其它非生成资产产生任何服务费。

## 验收

- 旧固定金额 billing 测试保持通过。
- 动态规则只接受正倍率、非负固定费、正 actual cost、模型完全匹配。
- 计算使用定点十进制并可重复；不同模型只改变倍率。
- Provider 产物失败、下载/媒体校验失败、usage 尚未落账或 usage 不匹配均不触发 debit；usage 未就绪保持 `BILLING_PENDING`，后续只重试用量读取和 debit，不重跑 Provider。
- 相同任务恢复或远端 replay 只产生一笔 Video OS 服务费；不成功的图片/视频任务不得进入 `BILLING_PENDING`。
- 相同任务恢复只复用同一幂等键，不重复提交 Provider。
- 本地默认 `VEYRA_CREDIT_ENABLED=false`，不调用真实 Provider、usage reader 或 debit。

本轮补充的离线证据：Worker 51 项（46 pass、5 个既有基础设施 skip；含用量暂未落账时保留已下载产物、后续只计费且不重复下载）均通过；数据库级 PostgreSQL/真实 Veyra 证据仍须在启用对应环境后单独验收，不能由内存夹具替代。
