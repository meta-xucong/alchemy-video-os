# AI 企业内容生产平台：ALCHMED 历史兼容盘点与退役清单

版本：`1.1.0`

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

## 10. 生产只读盘点执行 runbook

本节完成生产盘点的非测试准备，不代表已经访问生产环境。执行者必须是获授权的生产管理员，并在只读凭据、维护窗口和备份可用的前提下运行。

### 10.1 授权与前置条件

执行前必须记录：

- 授权人、执行人、开始/结束时间和工单编号；
- PostgreSQL、队列/Outbox、对象存储和日志的只读访问范围；
- 生产数据库备份时间与可恢复性；
- 对象存储版本化/保留策略；
- 查询超时、最大扫描行数和最大对象头读取字节数；
- 输出目录、访问权限和保留期限；
- 禁止下载完整用户媒体、禁止记录签名 URL/对象密钥/原始媒体字节。

任一条件缺失，盘点保持 `BLOCKED`。

### 10.2 统一盘点 manifest

只读结果必须输出一份脱敏 manifest，每行至少包含：

| 字段 | 说明 |
| --- | --- |
| `manifest_version` | 固定为 `1.0` |
| `wire_version` | `ALCHMED1`–`ALCHMED8` 或 `UNKNOWN` |
| `workspace_id_hash` | workspace ID 的带盐哈希，不写原值 |
| `project_id_hash` | project ID 的带盐哈希，不写原值 |
| `production_run_id_hash` | ProductionRun ID 的带盐哈希 |
| `task_or_event_id_hash` | 可恢复任务/事件身份哈希 |
| `object_identity_hash` | object key 的带盐哈希，不写 object key |
| `object_version_hash` | 对象版本/ETag 的安全哈希 |
| `status` | terminal / retryable / active / orphaned |
| `byte_size` | 对象或 payload 大小 |
| `created_at` | 创建时间 |
| `last_accessed_at` | 能可靠获得时填写，否则 `null` |
| `recoverability` | replayable / migration_required / retention_only / unknown |
| `evidence_source` | database / outbox / queue / object_header / log |

manifest 不得包含用户文本、Prompt、媒体内容、凭据、URL、对象 key 或 Provider request ID。

### 10.3 PostgreSQL 只读盘点

1. 在只读事务中列出仍 active/retryable 的 ProductionRun、TaskRun、composition event 和 VideoVersion；
2. 仅提取识别 wire 所需的版本字段、状态、时间、关联身份和对象引用；
3. 先按 workspace/project/status 聚合，再对非 ALCHMED8 或 UNKNOWN 条目生成 manifest 行；
4. 对没有对象引用、跨 workspace 不一致或状态冲突的行标记 `orphaned`，不自动修复；
5. 查询必须设置 statement timeout，不使用写锁，不更新任何业务行。

### 10.4 Outbox、队列与日志盘点

1. 统计未发布、未消费、dead-letter 和可恢复 composition 事件；
2. 只读取 event type、版本、状态、workspace scope 和对象引用，不输出 payload 正文；
3. 队列中若存在 ALCHMED1–7 或无版本 payload，标记 `migration_required`；
4. 日志只用于确认最后访问时间和处理结果，不把日志中的 URL、token、object key 或原始 request ID 写入 manifest；
5. 任何仍可重试的旧 wire 都阻断 decoder 删除。

### 10.5 对象存储头部扫描

1. 从数据库/事件引用生成对象候选集，不做无界 bucket 全量下载；
2. 仅使用 HEAD 和有界 Range GET 读取识别 magic 所需的前 8 字节；
3. 校验 workspace/project 关联、MIME、Content-Length、对象版本和 magic；
4. 未知 magic、对象缺失、长度异常或身份不一致均标记 `UNKNOWN/orphaned`；
5. 不保存对象头原始字节，不输出对象 key，不刷新对象访问时间（若存储后端支持只读元数据路径则优先使用）。

## 11. 盘点决策矩阵

| 发现 | 处置 | 是否可删除旧 decoder |
| --- | --- | --- |
| ALCHMED1–7 数量为 0，且观察期只产生 ALCHMED8 | 进入独立删除 ADR 与回放复核 | 仍需独立审计后才可 |
| 仅存在 terminal 历史对象，业务不再恢复 | 按保留期归档，保留只读 decoder 至期限结束 | 否 |
| 存在 active/retryable 旧任务 | 停止退役；逐项完成、取消或迁移 | 否 |
| 存在 orphaned/UNKNOWN | 停止退役；先做数据治理和来源确认 | 否 |
| 旧对象可确定性转成完整 AudioPlan | 创建新 ALCHMED8 派生产物并保留 provenance | 旧对象保留至审计/保留期结束 |
| 旧对象缺少 ownership/identity | 不猜测、不补默认；保留兼容读取或人工处置 | 否 |

## 12. 迁移原则与产物

迁移工具尚未获授权运行，但实现/审查时必须遵守：

- 不原地覆盖历史对象，不修改已成功 VideoVersion；
- 迁移只创建新的 ALCHMED8 派生产物和新的不可变 provenance 记录；
- 输入旧对象、输出新对象、转换器版本、SHA-256、执行人和时间必须可追溯；
- 缺失 AudioPlan identity、ownership、gain、section 或 asset identity 时 fail-closed；
- 不重新提交视频 Provider，不重做已成功媒体；
- 每个批次有最大对象数、最大字节数、失败阈值和可暂停点；
- 迁移失败保留旧对象可读，不将部分结果发布为成功；
- 完成后进行只读双读比对，再由独立审计决定是否切换读取。

## 13. 回滚方案

出现异常时：

1. 停止迁移 job 和新读路由切换；
2. 新写路径继续保持 ALCHMED8，不恢复旧 writer；
3. 读取回退到原只读 decoder；
4. 不删除新旧对象，不回写历史状态；
5. 对已生成 ALCHMED8 派生产物标记不可发布或单独隔离；
6. 以同一 manifest 和批次 ID 复盘，不重新提交 Provider；
7. 修复后从未完成批次继续，不重复迁移已校验对象。

## 14. 生产执行签字清单

盘点或迁移只有在以下材料齐全时才可写成“已完成”：

- [ ] 授权工单与只读/写入边界；
- [ ] 备份和恢复演练证据；
- [ ] 脱敏 manifest 及其 SHA-256；
- [ ] 数据库、Outbox/队列、对象头和日志四类统计对账；
- [ ] active/retryable/orphaned/UNKNOWN 为零，或有逐项处置记录；
- [ ] 迁移批次报告、失败报告和回滚演练；
- [ ] 连续观察期只产生 ALCHMED8；
- [ ] 独立审计签字；
- [ ] 新 ADR 批准 decoder 删除范围和保留期限。

在此之前，本文件状态保持 `HISTORICAL_READ_ONLY_PENDING_DATA_INVENTORY`。
