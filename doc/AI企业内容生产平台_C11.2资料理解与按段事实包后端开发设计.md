# C11.2：资料理解、事实包与按段检索后端开发设计

状态：`IN_PROGRESS`

## 1. 要解决的问题

C10 已将企业文件转换为 Markdown；C11.1 将成功转换的 Markdown 以不可变引用、字符上限和私有 PromptPackage 的方式接入创作。这解决了来源、权限和泄露问题，但不等于系统理解了资料。

对于长篇 PPT、方案书和产品资料，C11.1 的“每份取开头 5,000 字符，再附加到每个镜头 Prompt”的方式会丢失后半段事实、无法识别冲突，并把同一批无关文本重复发送到所有片段。以“副本镇江茅山高端度假别墅营销方案.pptx”为例，已转换 Markdown 为 23,167 bytes，必然超过单份 C11.1 上下文上限；它不适合直接作为视频生成输入。

C11.2 将路径改为：

```text
DocumentConversion Markdown
  -> DocumentKnowledgeRevision（结构、明确事实、来源定位、风险）
  -> CreativeBriefFactContext（按本次创作冻结的项目事实包）
  -> SegmentFactPack（每个叙事段的少量相关事实）
  -> 私有 PromptPackage
```

浏览器始终面对“资料已理解、会用于本次创作”的产品语义；Markdown、对象 key、完整原文、模型提示词和内部检索分数均不得成为浏览器协议。

## 2. 范围与非目标

本章实现可恢复、可审计的资料理解和按段事实选择，不改视频 Provider、Veyra、计费、VPS、SSH、DNS、TLS、部署或 Git 发布。所有默认测试使用本地 fixture、Mock 和确定性适配器；不得读取 `.env.local` 或调用外部文本/视觉模型。

本章包含：

- 成功 `DocumentConversion` 的自动理解任务、重试和公开安全状态。
- Markdown 的标题/幻灯片/列表/表格结构化分段，保留来源定位。
- 仅抽取可定位的明确事实、营销约束和待确认风险；资料里的指令不是系统指令。
- 项目级事实冲突检测、CreativeBrief 的不可变事实快照和按叙事段选择。
- PromptPackage 只接收短小、结构化、可追溯的 `SegmentFactPack`，不接收原始 Markdown。

本章不包含：

- 将 C10 的 Markdown 当作知识库全文检索或向量数据库。
- OCR、图像理解、图表/平面图语义识别或网页抓取。视觉为主而文本不足的资料必须明确标记为 `PARTIAL`，不得编造成事实；这属于后续独立的视觉资料理解能力。
- 真实文本模型、自由 Agent、自动修改用户资料、自动确认推断性卖点或自动创建视频任务。
- 修改历史 C10 Conversion、C11.1 Brief、Storyboard、TaskRun、ProductionRun 或 VideoVersion。

## 3. 核心原则

1. **转换与理解分离。**`DocumentConversion=SUCCEEDED` 只表示文件可被安全转换，不表示其内容已可用于营销创作。
2. **事实先于生成。**所有进入脚本、分镜和视频 Prompt 的资料信息必须来自冻结的事实快照，并带来源定位、置信等级和类别。
3. **按段检索，不复制全文。**每个生成片段只获得与自身叙事目的相关的事实包；全局品牌约束与片段事实分别有界。
4. **资料是不可信数据。**资料文本、页内指令、URL、伪造系统提示或模型要求只可作为待抽取内容，不能改变执行步骤、权限、网络访问或工具调用。
5. **冲突不静默决策。**同一项目的相同事实类别出现互斥明确值时，系统不能随机选一条写入营销内容；未解决冲突不进入对应事实包。
6. **版本可重放。**后续重新理解、重新上传或更换资料只产生新的知识修订和新的 CreativeBrief；历史生成保持原样可追溯。

## 4. 领域模型与状态

### 4.1 新增私有实体

| 实体 | 标识/关键字段 | 不变量 |
| --- | --- | --- |
| `DocumentKnowledgeRevision` | `dkr_`、workspace/project/document/conversion、Markdown SHA-256、analyzer/version、status、analysis quality | 只针对一个成功 Conversion；同一 conversion + Markdown SHA + analyzer version 至多一个活动理解任务；成功结果不可原地覆盖。 |
| `DocumentKnowledgeSection` | `dks_`、knowledge revision、sequence、heading、source locator、content hash、evidence kind | 保留结构和定位，不把整段原文投影到公开接口。`evidence_kind` 为 `TEXT`、`TABLE` 或 `VISUAL_UNAVAILABLE`。 |
| `DocumentFact` | `dft_`、knowledge revision、category、statement、confidence、source section/locator、statement hash | 仅存明确可引用的短事实或明确风险；没有来源定位的推断不能升级为事实。 |
| `CreativeBriefFactContext` | brief revision、fact、sequence、frozen fact snapshot、selection reason | CreativeBrief 创建时复制所选事实快照；以后资料重分析不得改变它。 |

`DocumentKnowledgeRevision.status`：

```text
CREATED -> QUEUED -> RUNNING -> READY
QUEUED | RUNNING -> FAILED
FAILED -> QUEUED（用户显式“重新理解”或受控恢复）
```

`analysis_quality` 为 `COMPLETE | PARTIAL | NEEDS_CONFIRMATION`。它说明可提取文本的覆盖情况，不是“营销内容真实正确”的保证。`VISUAL_UNAVAILABLE`、损坏表格、无法定位的数字或冲突事实会使结果至少为 `PARTIAL` 或 `NEEDS_CONFIRMATION`。

### 4.2 事实类别与置信规则

首版固定类别：`BRAND`、`PRODUCT`、`LOCATION`、`AUDIENCE`、`SELLING_POINT`、`AMENITY`、`STYLE`、`CTA`、`COMPLIANCE`、`NUMERIC_CLAIM`、`RISK`。每条事实必须有：

```ts
type FrozenFact = {
  factId: string;
  category: FactCategory;
  statement: string; // 受控短句，不是 Markdown 段落
  confidence: "EXPLICIT" | "INFERRED" | "NEEDS_CONFIRMATION";
  source: { documentId: string; conversionId: string; sectionSequence: number; locator: string };
};
```

- `EXPLICIT`：资料文字或表格中可定位的直接陈述，可默认用于创作。
- `INFERRED`：由多个明确事实归纳的表达，只能作为内部创作方向，不能生成数值、资质、承诺或 CTA。
- `NEEDS_CONFIRMATION`：冲突、无法定位、视觉为主或合规敏感内容；默认不进入事实包。

数值、价格、面积、距离、资质、客户名称、排名和法律/金融/医疗类宣传只允许以 `EXPLICIT` 加来源定位进入候选集；冲突时一律降为 `NEEDS_CONFIRMATION`。

## 5. 控制面、事件和队列

### 5.1 触发与恢复

1. Document Worker 成功保存 Markdown Asset 后，在同一业务推进中写 `document_knowledge.queued` outbox 事件。
2. 独立 `document-knowledge` Worker 读取被冻结的 Markdown Asset，校验 workspace、MIME、大小、SHA-256 和 analyzer version 后理解资料。
3. 成功时事务写入 Revision、Section、Fact 和 `document_knowledge.succeeded`；失败写规范化错误和 `document_knowledge.failed`。
4. 同一事件重投只回放已完成结果；Worker 重启恢复 `RUNNING` 任务时不能重复插入 Section/Fact 或覆盖 `READY` revision。
5. 历史成功 Conversion 可通过受控 backfill 逐个排队理解；backfill 不创建 CreativeBrief、更不创建视频任务。

新增内部事件：

```text
document_knowledge.queued
document_knowledge.started
document_knowledge.succeeded
document_knowledge.failed
```

公开 SSE 只显示 `document_id`、`conversion_id`、`knowledge_revision_id`、安全 status、`retryable` 与 `analysis_quality`。不含事实正文、来源原文、chunk、hash、模型、评分、对象 key、Markdown 或提示词。

### 5.2 浏览器 API

保留 C10/C11.1 路由。新增或扩展的公开协议必须由 `packages/contracts` 先定义：

```text
GET  /api/v1/projects/:project_id/documents
  -> 每份资料附带安全的 understanding status、quality 和可用摘要计数

GET  /api/v1/document-knowledge-revisions/:knowledge_revision_id
  -> 已授权项目用户可见的短摘要、事实类别/短句、置信等级与来源页/章节标签

POST /api/v1/document-knowledge-revisions/:knowledge_revision_id/retry {}
  Idempotency-Key
  -> 仅 FAILED revision 可重新排队
```

`POST /api/v1/projects/:project_id/creative-brief-revisions` 仍由用户的一键创作触发。对被选中的 DOCUMENT Source Asset，Control API 改为要求：成功 Conversion 对应 `DocumentKnowledgeRevision=READY`，且其 Markdown SHA-256 相同。否则返回 `422 DOCUMENT_KNOWLEDGE_NOT_READY` 或 `DOCUMENT_KNOWLEDGE_INVALID`，不创建 Brief、outbox、TaskRun 或 ProviderAttempt。

错误新增：`DOCUMENT_KNOWLEDGE_NOT_READY`、`DOCUMENT_KNOWLEDGE_INVALID`、`DOCUMENT_KNOWLEDGE_ACTIVE_CONFLICT`、`DOCUMENT_FACT_CONFLICT`、`DOCUMENT_FACT_CONTEXT_INVALID`。它们只表达用户可行动的状态，不能转发 Runtime、模型或解析异常。

## 6. 理解、选择与编译流程

### 6.1 `DocumentUnderstandingPort`

`packages/document-intelligence` 定义端口；Domain、Control API、Studio、Provider Adapter 均不得直接依赖具体解析器：

```ts
interface DocumentUnderstandingPort {
  analyze(input: {
    conversion: FrozenConversionReference;
    markdown: ReadableStream<Uint8Array>;
    analyzerVersion: string;
  }): Promise<DocumentKnowledgeDraft>;
}
```

首版实现为无网络的 `DeterministicDocumentUnderstandingAdapter`：按标题、PPT 幻灯片边界、列表、表格和显式标签分段，提取可定位短句、数值候选和风险。它不得把“模型理解”伪装成已完成：无法由结构规则可靠提取的信息要保留为 `PARTIAL`/`NEEDS_CONFIRMATION`。

未来可增加经单独认证的 `TextReasoningAdapter`，但必须实现同一严格 schema、保留 source locator、禁止自行写数据库或触发视频。它的真实凭据、调用次数和费用上限属于独立授权，不能因 C11.2 自动开启。

### 6.2 项目事实选择

Workflow Worker 不再使用 `BoundedDocumentContextReader` 将 Markdown 文本传入 `PlanningModelPort`。它通过 `FactSelectionPort` 按下列输入产生 `CreativeBriefFactContext`：

```text
用户的单一创作输入 + 时长 + 风格 + 已选资料的 READY KnowledgeRevision
  -> 全局品牌/合规事实
  -> 本次创作的相关产品、受众、卖点和场景事实
  -> 冲突与待确认清单
```

首版选择器必须可确定性运行：以类别、来源优先级、创作输入关键词和结构位置排序；其选择理由只在内部审计保存。未来语义选择器也只能输出同一 `FrozenFact` schema，不能返回自由文本 Prompt。

默认事实预算是结构预算而非 Provider 字符串闸门：每个 Brief 最多 24 条可用事实；每个生成片段最多 8 条相关事实，外加最多 12 条全局品牌/合规锁。单条 statement 在抽取阶段受限，所有超出的候选先按相关性删减并记录安全摘要。该策略不恢复已废弃的 4096-byte Prompt 限制，也不限制一至七张参考图；它只禁止无关原文进入片段。

### 6.3 计划与每段 PromptPackage

`PlanningModelPort` 接收 `CreativeBriefFactContext[]`，据此生成脚本、叙事点和分段计划。公开 Script/Storyboard 仅显示“已结合项目资料”和安全的事实类别/数量；不回显 Markdown 或完整内部 Prompt。

`Workflow Worker` 在每个 `GenerationSegment` 编译前调用 `SegmentFactSelector`，把得到的不可变 `SegmentFactPack` 交给 `StoryboardCompilerPort`；编译器不得回退到 brief-wide 事实集合。只获取：

1. 全局 `BrandLocks`：身份、风格、合规禁用项和不可违背的明确事实。
2. 该段 `SegmentFacts`：与本段可见事件、场景、动作、CTA 相关的短事实。
3. 对应 `fact_refs`：仅用于内部审计和 QC 溯源。

编译器将这些结构化事实转写为私有 PromptPackage，不再拼接 `[PROJECT_DOCUMENT_FACTS]` 原文块。任一段没有相关资料事实时仍可使用用户创作输入和视觉素材生成；它不会因为缺资料而把其他段的全部资料复制进来。历史直接调用编译器的兼容入口仍可读取 `factContexts`，但新 Workflow 路径只传递当前段的 pack，并将该 pack 的 `fact_refs` 固化到私有引用映射。

## 7. 冲突、质量与失败策略

| 情况 | 后台行为 | 用户可见结果 |
| --- | --- | --- |
| 资料未理解完成 | 不创建使用该资料的 Brief | “正在理解项目资料，完成后即可用于创作” |
| 理解失败 | 保留原始文件和 Conversion，允许受控重试 | “这份资料暂时无法理解” |
| 资料以图片/图表为主 | 标记 `PARTIAL`，仅使用可定位文字事实 | “部分图表内容还不能自动读取” |
| 明确事实冲突且与本次创作相关 | 从候选事实包移除，并标记 `NEEDS_CONFIRMATION` | 简短地显示需确认的两项信息；未确认不生成该宣传结论 |
| 资料包含提示注入或执行指令 | 按普通不可信文本处理，不执行 | 不显示技术错误；必要时提示“资料中有不可用于创作的内容” |
| 读取、SHA/MIME 或版本不一致 | 失败关闭并走 Worker 重试 | “资料暂时不可用，请稍后重试” |

不得为了让“一键生成”看似成功而自动选择冲突价格、虚构图表结论、静默跳过用户明确选中的资料，或让资料失败后继续声明“已结合资料生成”。

## 8. 迁移与兼容

- 新增 `document_knowledge_revisions`、`document_knowledge_sections`、`document_facts`、`creative_brief_fact_contexts` 及 workspace/project 复合外键、不可变约束、索引和前向迁移。
- C11.1 的 `creative_brief_document_contexts` 和历史 PromptPackage 保持只读兼容；不能回填正文或改写其历史生成。
- 已成功 Conversion 可按 conversion/version 创建知识修订；仅新建 CreativeBrief 使用 C11.2 事实包。历史 Brief 重新生成时必须创建新 revision，不能原地换上下文。
- 回滚时停止创建新的 C11.2 Brief 和知识任务；已有知识修订、事实快照、Storyboard、TaskRun 和 VideoVersion 继续可读，不能通过回滚重新放开全文 Prompt 拼接。

## 9. 测试与 Exit Gate

1. **Contracts/Domain：**状态机、公开脱敏、幂等冲突、错误码、事件 envelope、事实类别和 `EXPLICIT/INFERRED/NEEDS_CONFIRMATION` 校验。
2. **Persistence：**workspace/project 隔离、conversion SHA 冻结、同一理解任务去重、成功结果不可覆盖、重试与 Worker 恢复、历史 C11.1 Brief 不变。
3. **Document Intelligence：**长 PPT/PDF/DOCX/XLSX fixture 的完整结构读取；后半段卖点可被选择；表格、中文、UTF-8、注入文本、冲突数值和视觉缺失都覆盖；无网络、无本地任意路径访问。
4. **Workflow：**CreativeBrief 只冻结 READY 事实；每段 PromptPackage 只含相关 facts 和 refs，源码/快照扫描不再存在 Markdown 原文块；无相关事实时不跨段复制；冲突事实不能进入宣传结论。
5. **Control API/Studio E2E：**上传资料后自动经历“整理 -> 理解 -> 可用于创作”；用户能以非工程化方式查看摘要或暂不采用资料；一键生成不显示模型、队列、Prompt、对象 key 或原文；刷新、重试、跨项目隔离和移动布局通过。
6. **回归与边界：**C10、C11.1、C11、C12、C12.1、Mock Provider 的现有测试通过；无真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

本章只有在“复杂资料不再全文/开头截断地进入每个镜头、每条实际使用的营销事实可追溯、冲突与视觉缺失不被伪装为已理解、历史版本不被改写”同时成立后，才可进入 `READY_FOR_AUDIT`。

### 9.1 当前实现进度（2026-08-30）

- P0/P1 已落地：知识修订、Section/Fact、SHA 冻结、确定性分析器、公开详情/重试 API、事实选择器、不可变 Brief 快照和安全事件投影。
- P2 已落地：Conversion 成功事务自动写入 `document_knowledge.queued` Outbox；独立 BullMQ 队列、Relay、Document Worker 启动接线、Markdown MIME/SHA 校验，以及 Workflow/Prompt Compiler 的 READY 快照输入。
- READY-only 门禁已落地：选择 DOCUMENT 资料创建 Brief 时，必须存在同项目、同 Conversion、同 Markdown SHA 的 READY KnowledgeRevision；否则返回 `DOCUMENT_KNOWLEDGE_NOT_READY` 或 `DOCUMENT_FACT_CONTEXT_INVALID`，不创建 Brief 或后续任务。
- 按段事实包已接入 Workflow：每个新生成段由 `DeterministicFactSelector` 只选择全局品牌/合规锁和本段关键词相关事实，`StoryboardCompilerPort` 不再接收 brief-wide `factContexts`；私有 `referenceMap.fact_refs` 与实际 Prompt 内容保持一致。旧的直接编译调用保留兼容，但不属于新 Workflow 事实边界。
- 数值冲突现在在确定性理解阶段显式标记为 `NEEDS_CONFIRMATION`，使知识质量和前台“需要补充确认”摘要一致；冲突候选仍不会进入 CreativeBrief 或 SegmentFactPack。
- 尚未宣告本章 `READY_FOR_AUDIT`：真实 PostgreSQL/Redis/MinIO 联调、Studio“整理 -> 理解 -> 可用于创作”E2E 和独立审计仍是剩余 Exit Gate；RUNNING 知识任务的前台重启恢复已加入 `DocumentKnowledgeExecutor.recover`，本地无 `DATABASE_URL` 时相关数据库联调仍保持跳过。

> **2026-09-01 当前音频口径**：C11.2 资料理解链路不把用户上传旁白/样音作为自动视频输入；音频 owner 由后续 Provider 原生或显式 Doubao 服务端生成路径决定。本文早期的真实 Provider/TTS 关闭语句仍是本章默认/CI 边界，不覆盖最新自动音频文档限定的本机对照，也不改变本章状态。
