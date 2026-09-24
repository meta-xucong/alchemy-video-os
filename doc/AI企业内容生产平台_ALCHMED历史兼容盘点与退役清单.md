# AI 企业内容生产平台：ALCHMED 历史兼容盘点与退役清单

版本：`1.0.0`

日期：`2026-09-24`

状态：`NEW_WRITE_CONVERGED / HISTORICAL_READ_ONLY_PENDING_DATA_INVENTORY`

主执行方案：`AI企业内容生产平台_反自造逻辑治理与源仓库收敛完整优化方案.md`

## 1. 目的

本文件登记 `ALCHMED1`–`ALCHMED8` 私有媒体合成 envelope 的当前用途、写入边界和退役门禁，防止继续为历史 wire 新增语义分支。

本轮结论：

- 所有带 `DeliveryPlanRevision` 的新生产任务必须冻结完整 `AudioPlan`，统一写入 `ALCHMED8`；
- `ALCHMED1`–`ALCHMED7` 只允许历史读取、旧任务重放和兼容测试，不允许承载新产品行为；
- 未经授权读取生产数据库、对象存储或历史快照，因此不能宣称旧 wire 已无人使用，也不能直接删除 decoder；
- 旧 decoder 的最终删除必须有数据盘点、迁移证明、ADR 和历史回放测试。

## 2. 当前版本登记

| Wire | 历史承载内容 | 当前写入政策 | Decoder 政策 |
| --- | --- | --- | --- |
| `ALCHMED1` | 仅片段字节，无 composition plan | 新 DeliveryPlan 禁止；仅旧无计划调用兼容 | 只读 |
| `ALCHMED2` | 基础 transition plan | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED3` | legacy continuous narration policy | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED4` | legacy music-only payload | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED5` | legacy narration/music payload | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED6` | advanced mix 参数与窗口 | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED7` | ownership windows，无完整 identity/mix metadata | 新 DeliveryPlan 禁止 | 只读 |
| `ALCHMED8` | 完整 `AudioPlan`、asset identity、ownership、gain/fade、narration sections 与 payload identity | 当前唯一新写 wire | 读写 |

## 3. 新写路径证明

`packages/persistence/src/production-repository.ts` 对所有带 `deliveryPlanRevisionId` 的新 production run 构造完整 `audio_plan`：

- 有已批准平台旁白时，使用 `CONTINUOUS_NARRATION`；
- 没有平台旁白时，使用 `LEGACY_PRESERVE`，并显式冻结一个 `HOLD` section 及所有 source segment ownership tracks；
- 每条 track 必须携带 `asset_id` 和显式 `gain_db`；
- 新任务不再只写 legacy `audio_tracks`。

`apps/production-worker/src/media-runtime-client.ts` 的 encoder 在 `audio_plan` 存在时无条件选择 `COMPOSITION_COMPLETE_AUDIO_PLAN_MAGIC`，即 `ALCHMED8`。

行为测试同时验证：

1. DeliveryPlan-backed native audio 产生完整 legacy-preserve AudioPlan；
2. encoder 输出前 8 字节为 `ALCHMED8`；
3. HOLD section、source asset identity 与 ownership 被完整编码；
4. approved narration 仍使用完整 AudioPlan；
5. 历史 ALCHMED1–7 fixture 继续可解码。

## 4. 旧 writer 的限制

旧 writer 分支目前仍保留在 `encodeMediaCompositionBundle()`，原因是：

- 历史/测试调用可能直接传入不含 AudioPlan 的旧 plan；
- 未经生产数据盘点，不能证明所有持久化重放任务都已有 DeliveryPlan；
- 删除旧 writer 会阻断旧任务重放和兼容测试。

限制：

- 旧 writer 不得被新 Control API / Workflow / Persistence 流程调用；
- 不得在 ALCHMED1–7 上新增字段、状态或 fallback；
- 任何新媒体能力必须先进入完整 AudioPlan，并只由 ALCHMED8 承载；
- 旧 writer 的单元测试只证明历史兼容，不构成新产品授权。

## 5. Decoder 保留边界

`services/media-runtime/runtime.py` 继续识别 ALCHMED1–8，但：

- ALCHMED1–7 未携带的 ownership/identity 不得被猜测；
- 未知 ownership 默认保留 source audio 或 fail-closed，不得静默删除；
- ALCHMED7 的 ownership bytes 不是完整可信 AudioPlan；
- 只有 ALCHMED8 可以携带完整 narration asset、section、gain/fade、music identity 和独立 narration payload metadata；
- decoder 不得把旧 payload 自动升级成新语义事实。

## 6. 尚未完成的数据盘点

本轮未执行：

- 生产 PostgreSQL 查询；
- 对象存储扫描；
- VPS 日志扫描；
- 历史队列 payload 抽样；
- 线上 production run / video version 重放。

因此以下事实仍未知：

- 仍可重试的 active/failed run 中各 ALCHMED 版本数量；
- 对象存储中旧 envelope 的数量和最后访问时间；
- 是否存在无 DeliveryPlan 但业务仍需恢复的历史任务；
- 历史版本是否全部可迁移成 AudioPlan；
- 旧 decoder 的最早安全删除日期。

这些未知项不允许被写成“没有历史数据”。

## 7. 最终删除门禁

删除任一 ALCHMED1–7 writer/decoder 前，必须同时满足：

1. 用户授权只读盘点生产数据；
2. 数据库、队列、对象存储和日志中完成版本统计；
3. 所有可恢复历史任务均已完成、取消或迁移；
4. 提供旧 envelope → AudioPlan 的确定性迁移工具，或证明无需迁移；
5. 对每个存在数据的旧版本完成回放测试；
6. 新任务连续观察期只产生 ALCHMED8；
7. 新增 ADR 说明删除范围、回滚方法和保留期限；
8. 合并前由独立审计确认没有隐藏 caller。

任何一项缺失，旧 decoder 继续只读保留。

## 8. 代码审查硬门

后续 PR 出现以下情形默认拒绝：

- 为 ALCHMED1–7 新增字段或新产品行为；
- 新任务因缺失 metadata 静默降级到旧 wire；
- 用默认值制造 ownership、gain、asset identity 或 narration section；
- 将旧 decoder 的兼容行为描述为当前推荐实现；
- 未经数据盘点直接删除 decoder；
- 以“历史兼容”为由新增另一套 mixer 或 Prompt/Audio semantic fallback。

## 9. 当前验收口径

WP-11 对 wire 的验收只包括：

- 新 DeliveryPlan 写入已收敛到 ALCHMED8；
- 旧版本明确降级为 read-only compatibility；
- 固定语义启发式和 real-process Mock imports 已物理隔离；
- 历史 decoder 删除明确标记为等待授权数据盘点。

本文件不宣称历史 wire 已全部退役，也不授权访问生产数据。
