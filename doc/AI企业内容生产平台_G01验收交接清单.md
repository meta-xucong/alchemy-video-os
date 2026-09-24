# AI 企业内容生产平台：G01 反自造语义治理验收交接清单

版本：`1.1.0`

日期：`2026-09-24`

状态：`ACCEPTED`（仅限 G01 本地治理与代码边界；外部发布门仍阻断）

主线安全基线：`1a4d95ba9e79e04540c1f7af61b917053735d1e5`

验收分支：`codex/g01-audit-handoff-20260924`

验收 PR：`https://github.com/meta-xucong/alchemy-video-os/pull/2`（Draft，禁止未经验收直接合并）

## 1. 本次验收范围

G01 只验收“反自造语义治理与单一语义所有权”改造：真实模式的语义决定只能来自完整上下文 LLM，平台只做 provenance/结构/协议验证；Mock、历史兼容和用户授权的 BGM 产品能力分别隔离。它不自动验收真实模型质量、VPS、生产部署或人工审美。

## 2. 非测试工作完成清单

- [x] CanonicalSourceBundle、EvidenceRef、SemanticDirectorDecision 最小契约；
- [x] exact dialogue、document evidence、reference usage 和 segment decision 单一 owner；
- [x] provenance checker 能力上限写入代码和文档，不宣称语义蕴含或完整覆盖；
- [x] deterministic planner/compiler 迁入显式 Mock 子入口；
- [x] reference/object/narrative heuristics 迁入 Mock/历史兼容子入口；
- [x] 文档关键词、二元词 overlap、手工权重和固定事实 selector 退出真实链；
- [x] Provider compiler 退化为 pure projector；
- [x] source 静默删句/摘要/截断路径退出真实链；
- [x] Studio 分镜与交付两次人工确认；
- [x] BGM mode 必须显式 AUTO/MANUAL/OFF，缺失不再默认 AUTO；
- [x] 未执行 QC 保持 UNKNOWN/UNAVAILABLE/null；
- [x] 无真实 evaluator 时不伪造 handoff repair 成功；
- [x] 新 DeliveryPlan-backed 写入统一 ALCHMED8；旧 wire 只读；
- [x] ALCHMED1–7 生产只读盘点、迁移、保留和回滚 runbook 已落盘；生产历史数据盘点本身未执行；
- [x] 主方案、总控、语义台账、ADR、来源登记、章节账本、验收报告同步；
- [x] 凭据暴露仓库处置、旧 PR 关闭、主线历史净化和 ignore guard；
- [x] 审计分支重放到净化主线并准备新 PR；
- [x] 不合并、不部署。

## 3. 已有技术证据（历史证据与本轮独立复跑分列）

- 实现方历史隔离基础设施回归：在临时 PostgreSQL、Redis DB 15 和本地 MinIO 全部启用时为 `783 passed / 0 skipped / 0 failed`；该结果保留为历史证据，不冒充本轮复跑结果；
- 独立复核人在 `5a9d354` 上当前复跑根级测试：`763 passed / 20 skipped / 0 failed`；20 个 skip 主要是 PostgreSQL、Redis/BullMQ、MinIO 环境门，未按通过计；
- 独立复核 `pnpm typecheck`、`pnpm build` 通过，build 仅有既有 Nuxt `DEP0155` 警告；
- Media Runtime：`152 passed / 0 failed`，另 `7 subtests passed`；
- secret pattern 扫描与 `git diff --check` 通过；
- 独立复核执行 `contracts:generate` 后，三个合同文件虽一度显示工作区修改，但工作区 blob hash 与 HEAD 完全一致且 `git diff` 为空；现已恢复为 clean，无内容变更；
- production root export/import 和 Workflow composition root 负向门的历史证据继续保留。

详细命令、分包计数和证据分层见 `AI企业内容生产平台_反自造逻辑治理与源仓库收敛验收报告.md`。

## 4. 验收同事重点检查

### 4.1 真实链

- 真实 Workflow 是否只加载 semantic-only 入口；
- 无 LLM/无 provenance/有 unresolved 时是否 fail-closed；
- 下游是否仍从 prose 重解析台词、对象、镜头、图片用途；
- Provider prompt 是否只投影已验证 decision、exact dialogue、canonical references 和必要认证指令；
- reference 编号、asset ID、role、relay URL 和 Provider URL 是否同序。

### 4.2 用户决定与真实性

- Studio 是否仍可能自动 approve 或自动开始制作；
- 缺失 music mode 是否可能触发 AUTO；
- 未检查项是否可能写成 false/CHECKED/PASS；
- 无真实修复产物时是否可能写 succeeded/ACCEPTED。

### 4.3 Mock、legacy 与生产边界

- 生产根是否导出或直接导入 deterministic planner/compiler；
- 旧 heuristics 是否可能被真实链 fallback；
- 新写路径是否可能降级 ALCHMED1–7；
- 历史 decoder 是否只读且没有制造新语义。

### 4.4 安全与版本控制

- 新 PR 是否基于净化后主线；
- 当前树和 PR diff 是否无原始凭据；
- 凭据脚本是否缺失且被精确忽略；
- 旧 PR #1 是否保持关闭；
- `origin/codex/backup-20260919-snapshot@12446154` 是否继续被明确标记为非验收、不可直接合并的孤立 WIP 归档；
- 是否有外部密钥轮换和用量日志复核证明；
- 是否未发生合并、tag、发布或部署。

## 5. 不应由实现方伪造完成的外部门

- 真实 LLM 对多行业、多语言输入的语义正确性与覆盖；
- 真实 Provider/Pixabay 的当前协议、费用、恢复和产物；
- VPS/生产配置与线上健康；
- 真实成片 source-aligned 多模态 QC；
- 人工审美、台词听感、节奏和品牌质量；
- 生产 ALCHMED 历史只读盘点和迁移执行；
- 外部账号凭据轮换与调用日志复核；
- 独立审计签字。

这些项目没有证据时应保持 `PENDING/BLOCKED/UNAVAILABLE`，不能退回关键词、正则、默认值或 Mock 来补绿。

## 6. 验收决定模板

鉴于真实 LLM/Provider/VPS、生产 ALCHMED 数据盘点、真实成片语义 QC、人工质量和外部凭据轮换仍明确未完成，本轮正式决定只允许二选一：

```text
[x] ACCEPTED_WITH_EXTERNAL_GATES
    代码与本地治理边界接受；真实 LLM/Provider/Pixabay、VPS/生产配置、生产 ALCHMED 历史数据、真实成片 QC、人工质量和外部凭据轮换继续作为发布前阻断。

[ ] RETURN_FOR_FIX
    阻断问题：__________
    证据位置：__________
    必须修复：__________
```

验收人：Codex 独立复核

日期：2026-09-24

复核基线：`f9843562d2b9ca56db94373c7e7b5407b8e08753`；本决定随本次文档收口提交固化。

正式章节状态：`ACCEPTED`（范围限定于 G01；不表示平台生产可用，也不关闭 E12/R01 或 C12.4/C12.5）。

## 7. 可直接转发的验收摘要

> G01“反自造语义治理与单一语义所有权”已完成非测试实现、代码边界收敛、配置/文档/ADR/状态账本同步、历史兼容退役 runbook、安全历史净化和 Git 验收交付。真实链现统一为 CanonicalSourceBundle → Semantic Director → evidence-referenced decision → provenance/结构验证 → pure projector；deterministic planner 与旧 heuristics 仅存在于显式 Mock/历史兼容入口，真实链无 fallback。Studio 不再自动审批，BGM mode 必须显式选择，未检查/未执行状态不再伪装为通过。测试证据分两层：实现方历史全基础设施回归为 783/0/0；独立复核人在 5a9d354 上当前复跑为 763/20/0，20 个 skip 是未配置的 PostgreSQL、Redis/BullMQ、MinIO 环境门。Media Runtime 为 152/0，另 7 个 subtests；typecheck、build、secret scan 和 diff check 通过。`origin/codex/backup-20260919-snapshot` 明确保留为非验收孤立 WIP 归档，PR #2 仍是唯一验收入口。G01 正式状态已按范围限定收口为 ACCEPTED；未完成的真实 LLM/Provider/VPS/成片语义 QC/人工质量/生产 ALCHMED 历史盘点/外部凭据轮换证明不得被写成已通过。
