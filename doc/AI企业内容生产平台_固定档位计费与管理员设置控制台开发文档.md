# 固定档位计费与管理员设置控制台开发文档

## 目标

在不修改 Sub2API 原生余额、用量记录、Provider 路由或扣费接口的前提下，将 Video OS 的客户扣费规则切换为管理员可配置的固定档位。每个档位由模型、分辨率、时长和固定积分组成；任务创建时冻结匹配到的档位，媒体产物下载、校验和入库成功后，继续调用现有 Veyra `CreditPort.debit`，失败不扣费，重试沿用既有扣费幂等语义。

收费表尚未提供时不预填业务价格。固定模式没有匹配档位时必须在 Provider 提交前阻断，不能猜价、按邻近档位收费或静默放行。

## 来源与薄壳边界

- Alchemy Media 固定档位设置来源：`custom_media_agent_2_0/app/services/veyra_billing_settings.py` 的 `DEFAULT_RULES`、`billing_settings_path`、`get_billing_settings`、`update_billing_settings`、临时文件写入/替换；对应管理员读写路由为 `app/main.py` 的 `/api/v2/veyra/billing/settings`，并使用已验证管理员权限。
- Alchemy 的实现只作为设置存储、版本化规则和管理员边界参考；Video OS 不复制 Alchemy 用户表、单体账本或图片固定费率。
- Video OS 继续复用现有 `BillingRuleSnapshot`、`CreditPort.debit`、成功产物后扣费和 `billingIdempotencyKey`。固定档位仅生成 `chargeAmount` 快照，不读取或改写 Sub2API 的原生 `actual_cost`。
- Control API 的管理员认证只复用现有 `resolveVerifiedAdminAccess`：AISelf 会话角色是提示，必须再次查询活动 Veyra 账户并确认 `admin`。浏览器不接触内部 token。
- JSON 文件是当前没有设置表时的最小服务端适配；路径由 `VIDEO_BILLING_SETTINGS_PATH` 指定，写入采用临时文件后原子替换。文件可继续读取既有 raw `{enabled, tiers}`，服务端只在内部保存的同一文件元数据键中记录管理员命令 request hash 与原始结果；该键在 API 读取时剥离，不属于公开字段。设置和幂等记录一次性替换，避免半写。管理员更新的读—校验—写事务还由同路径的内部独占锁串行化，保证跨进程同一幂等键不会出现两个 `NEW`，不改变公开字段或计费语义。陈旧锁仅在元数据可解析且 PID 明确已不存在时回收，并通过同目录唯一 reclaim 路径原子 rename 争抢；活动锁超时返回 `busy`，损坏或无 PID 元数据返回 `invalid` 并拒绝回收。同步等待、异常断电后的 `fsync` 耐久性和极端 PID 复用不是本地文件适配的绝对分布式锁保证范围；未配置文件时返回禁用、空档位，不产生默认收费。

## 固定档位模型

```text
FixedVideoBillingTier {
  key: string                 # 稳定规则键
  label: string               # 管理员可读名称
  model: string               # Provider profile model
  resolution: string          # 例如 480p / 720p
  duration_seconds: integer   # 与任务 duration 精确匹配
  charge_amount: decimal      # 现有 credit decimal，必须 > 0
  enabled: boolean
}

FixedVideoBillingSettings {
  enabled: boolean
  tiers: FixedVideoBillingTier[]
}
```

更新时拒绝重复 `key`，也拒绝多个启用档位同时匹配同一 `model + resolution + duration_seconds`。匹配只接受一个 `enabled` 且三项完全相等的档位；没有唯一匹配时 fail-closed。不得加入按时长插值、区间回退、倍率计算、最低余额猜测或其它新定价算法。

### `model` 的 Provider/profile 隔离决议

本模型不新增 `provider` 或 `profile` 字段：现有 `model` 不是展示别名，而是选定 `VideoProviderRuntimeProfile.model` 原样写入不可变 `VideoGenerationInputSnapshot` 的 provider/profile model key。因而固定档位的身份是精确的 `model + resolution + duration_seconds`，Grok 行只会被 `grok-imagine-video-1.5` profile 命中；不同 profile（例如未来的 Seedance-like model key）必须使用自己的 `model` 行，未知或没有对应行时在 Provider 提交前阻断。

当前实现不把 `grok-imagine-video-1.5` 当作全局默认，也不把 `provider` transport mode 当作计费匹配条件。若未来某两个 Provider/profile 必须复用同一个 model 字符串，现有 model key 将不再足以消歧；在补充契约/ADR 和回归测试前不得启用该组合。Seedance 价格目前未提供，因此本轮不新增或启用任何 Seedance 计费行。

## 已确认的 Grok 档位价格（2026-09-16）

价格来源为用户提供的 `wokey_grok_video_pricing.html`：`grok-imagine-video-1.5` 的 Wokey 实付美元单价为 480p=`0.0056/s`、720p=`0.0098/s`、1080p=`0.0175/s`，支持 1–15 秒。

固定档位金额按以下唯一公式在录入前计算，运行时只使用已保存的固定结果，不再重复计算或读取上游实际用量：

```text
charge_amount = upstream_usd_total × 7 × 1.2 + 1
upstream_usd_total = per_second_usd × duration_seconds
```

其中 `7` 是用户指定的 USD→RMB 换算，`1.2` 是基础比例，末尾 `1` 是每个 Provider 片段任务的固定人民币服务费。所有结果以最多 8 位小数的十进制字符串写入 `charge_amount`；本表数值可被十进制精确表示，不使用二进制浮点。

| 时长 | 480p（元/积分） | 720p（元/积分） | 1080p（元/积分） |
| ---: | ---: | ---: | ---: |
| 1s | 1.04704000 | 1.08232000 | 1.14700000 |
| 2s | 1.09408000 | 1.16464000 | 1.29400000 |
| 3s | 1.14112000 | 1.24696000 | 1.44100000 |
| 4s | 1.18816000 | 1.32928000 | 1.58800000 |
| 5s | 1.23520000 | 1.41160000 | 1.73500000 |
| 6s | 1.28224000 | 1.49392000 | 1.88200000 |
| 7s | 1.32928000 | 1.57624000 | 2.02900000 |
| 8s | 1.37632000 | 1.65856000 | 2.17600000 |
| 9s | 1.42336000 | 1.74088000 | 2.32300000 |
| 10s | 1.47040000 | 1.82320000 | 2.47000000 |
| 11s | 1.51744000 | 1.90552000 | 2.61700000 |
| 12s | 1.56448000 | 1.98784000 | 2.76400000 |
| 13s | 1.61152000 | 2.07016000 | 2.91100000 |
| 14s | 1.65856000 | 2.15248000 | 3.05800000 |
| 15s | 1.70560000 | 2.23480000 | 3.20500000 |

录入时三列使用同一个 `model=grok-imagine-video-1.5`，`resolution` 使用运行时规范化值 `480p`、`720p`、`1080p`，`duration_seconds` 使用表中秒数，`charge_amount` 使用对应单元格。该表只属于 Grok profile；它不会为其它 Provider/profile 提供默认价格。固定 `+1` 按当前固定档位模型对每个 Provider 片段收取一次；例如 30 秒被拆成两个 15 秒片段时，两个片段分别匹配 15 秒档位并各自包含一次固定服务费。若将来要改为整部 ProductionRun 只收一次服务费，需要另行定义生产级聚合规则，不能在本档位中隐式改变。

## 服务端行为

1. `VIDEO_BILLING_MODE=fixed_tiers` 时，Control API 从设置存储读取档位；旧环境变量用量加服务费模式仍只为历史快照和兼容测试保留。
2. 直接镜头生成在创建不可变 `TaskRun.input_snapshot` 前校验 AISelf 账户并精确匹配 `model + resolution + duration_seconds`，写入 `billing_rule.chargeAmount`、`billingRuleKey=tier.key`、`source=video:fixed-tier-v1`。
3. ProductionRun 创建时冻结管理员设置快照、provider/profile model key 和登录账户 ID 到私有 `budget_guard`。调度每个 segment 时按该快照精确匹配模型、分辨率和时长，生成同样的固定 `BillingRuleSnapshot`；无匹配档位将 segment 置为不可重试的 `FAILED` 并使 production run 进入既有 `BLOCKED`，绝不创建或提交 Provider TaskRun。
4. Worker 只在下载、MIME、SHA、ffprobe 和对象写入成功后执行已有 debit。固定 `chargeAmount` 不需要 usage reader；余额不足/临时信用错误沿用 `BILLING_PENDING`、`BILLING_FAILED` 和重试状态，Provider 不重复提交。
5. 共享 Provider key 的 usage-owner 防护只对仍使用 `usagePricing` 的历史规则生效；固定档位不因静态 Provider key 所属账户不同而错误拒绝登录用户。

## 管理员 API 与页面

- `GET /api/v1/admin/billing-settings`：仅已验证 AISelf 管理员可读，返回当前设置。
- `PUT /api/v1/admin/billing-settings`：仅已验证管理员可写，接受 `Idempotency-Key` 和完整 `{enabled, tiers}`，相同键相同请求重放原结果，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。普通用户返回 `AUTH_FORBIDDEN`。
- `/api/v1/me/billing-policy` 继续作为普通账户的只读生效摘要；固定模式返回 `FIXED_TIERS`、`SERVER_SETTINGS` 和档位列表，不返回外部用户 ID、token、Provider 原始响应或文件路径。
- Studio `/settings/billing` 保持账户栏入口；管理员显示启用开关和档位表单（增删改、保存），普通账户仅查看摘要。页面提示“产物成功并校验后扣费”，不把前端输入当作收费事实。

## 验证与退出门

- Contracts：档位字段、正金额、重复键/重复匹配拒绝，公开 schema 和 OpenAPI 路由一致。
- Control API：管理员读写、非管理员 403、持久化重载、幂等重放/冲突、固定档位精确快照、无匹配在提交前阻断、旧用量模式兼容。
- Persistence：ProductionRun 私有快照写入/读取、每段精确解析、无匹配 segment fail-closed；已有数据库缺失时保留 skip，不用内存测试冒充 DB 证据。
- Worker：固定 `chargeAmount` 不读取 usage，成功产物才扣费，失败/重复恢复沿用现有 receipt 幂等。
- Studio：管理员编辑控件存在，普通用户无写入方法且不访问内部 API。
- 文件设置适配：旧 raw 文件、重启/跨实例重放与冲突、并发同键的 `1×NEW + 1×REPLAY + conflict` 行为均有定向证据；锁的同步等待、异常断电后的 `fsync` 耐久性和极端 PID 复用仍不是本地文件适配的保证范围。
- 用户已提供 Grok/Wokey 价格表，本文件登记了按 `×7×1.2+1` 计算出的档位金额；本轮不把价格自动写入运行时设置文件，也不自动启用扣费，需管理员在控制台复核后保存。仍不调用真实 Provider/Veyra，不部署 VPS，不执行 Git 操作。固定模式只有在价格表录入并完成真实扣费验收后才可标记为生产启用。

## 与旧方案的关系

《AI企业内容生产平台_轻量视频倍率计费方案.md》中的 `actual_cost × 0.20 + 1` 是历史 `USAGE_PLUS_SERVICE_FEE` 模式；本文件定义的 `FIXED_TIERS` 在显式启用时优先。旧字段和快照继续可读，不能与固定档位规则混合写入同一快照。
