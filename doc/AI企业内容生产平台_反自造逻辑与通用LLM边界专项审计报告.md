# AI 企业内容生产平台：反自造逻辑与通用 LLM 边界专项审计报告

版本：`2.2.0`

日期：`2026-09-24`

状态：`AUDIT_BASELINE / REMEDIATION_IMPLEMENTED / G01_READY_FOR_AUDIT`

主执行方案：`AI企业内容生产平台_反自造逻辑治理与源仓库收敛完整优化方案.md`

> **整改结果（2026-09-24）**：本报告的 P0/P1 已按主执行方案完成实现、本地技术门禁和隔离 PostgreSQL/Redis/BullMQ/MinIO 集成回归，G01 当前为 `READY_FOR_AUDIT`，不是平台级 `ACCEPTED`。正文问题描述保留为原始审计证据；当前代码边界、provenance checker 的能力上限、缺失集成证据和最新本地测试见 `AI企业内容生产平台_反自造逻辑治理与源仓库收敛验收报告.md`。

本报告作为问题证据和处置依据保留；完整修改顺序、依赖关系与 Exit Gate 以主执行方案为准。

## 1. 审计目的

本报告从“除用户明确授权能力和必要平台薄壳外，禁止平台自造语义逻辑”的原则出发，对 `D:\AI\alchemy_video_OS` 当前工作区进行专项审计。

本轮不以“测试是否通过”为主要判断标准，而是检查每一项行为是否具备以下至少一种合法来源：

1. 用户明确输入或授权；
2. 固定 upstream 的具体文件、字段、算法或执行顺序；
3. Provider 已认证能力、限制或协议；
4. 身份、权限、API、队列、持久化、对象存储、幂等、恢复、校验等必要平台薄壳。

凡不能归入上述范围、却会解释用户语义、决定创作内容、替用户选择策略或把未知事实变成确定事实的代码，均视为自造逻辑或过度开发。

## 2. 核心结论

当前仓库仍存在系统性的自造逻辑，且不只是少量历史函数。主要问题已经形成五条并行语义链：

- 文档事实由关键词分类、二元词重叠和手工权重选择；
- 参考图职责由关键词打分、文件名窗口和单图视觉分类推断；
- 用户文本在前端、规划器、Provider 编译器和生产仓库被多次正则重解释；
- 真实 LLM 结果仍经过 deterministic compiler、必填 motion schema 和平台模板再次加工；
- 连续性、旁白和 QC 中存在固定阈值、语言特例、伪“已检查”及未执行即“修复成功”的状态。

因此，现状不能仅靠删除几个正则修好。需要建立“单一语义 owner”架构：语义决策由一个具备完整上下文的 LLM 阶段完成，确定性代码只验证证据、顺序、完整性、Provider 能力和协议边界。

## 3. 判断口径：结构化不是原罪，结构化替代思考才是

允许保留的结构化内容：

- ID、顺序、引用关系、状态、时间、哈希、MIME、尺寸、Provider 参数；
- LLM 输出的最小决策 envelope；
- 精确 source reference、dialogue ID、asset ID 和 evidence reference；
- 不改变语义的 mapper、serializer、validator 和 sidecar。

禁止继续使用的“伪结构化”：

- 用关键词表把任意文本强行归入固定类别；
- 用正则猜人物、场景、道具、左右手、转场、情绪或镜头；
- 用分数、阈值和固定权重替代语义判断；
- schema 强制要求并不存在的创作事实，随后用 sentinel 填满；
- downstream 再次解析 source prose，制造第二套事实；
- 未真正执行或未真正检查，却写入 `CHECKED`、`ACCEPTED`、`succeeded` 或布尔 `false`。

## 4. 审计范围

已审计的真实调用链包括：

- `apps/document-worker`
- `packages/document-intelligence`
- `apps/control-api`
- `packages/reference-analysis`
- `packages/domain`
- `apps/workflow-worker`
- `packages/creative-planning`
- `packages/provider-video`
- `apps/task-worker`
- `packages/persistence`
- `apps/production-worker`
- `services/media-runtime`
- `apps/studio-web`
- 相关 `packages/contracts` schema

固定 upstream 继续以 Huobao、Seedance 2.5 和 OpenMontage 的已锁定 commit 为依据。

## 5. P0：应从真实生产路径删除或立即禁用

### P0-01 Deterministic 文档理解器默认运行在生产 Worker

位置：

- `packages/document-intelligence/src/index.ts`
- `apps/document-worker/src/knowledge-execution-service.ts`
- `apps/document-worker/src/index.ts`

当前行为：

- `categoryRules` 用中英文关键词将文本分为 BRAND、PRODUCT、CTA、COMPLIANCE 等固定类别；
- 未命中规则的内容默认进入 PRODUCT；
- 数字正则生成 NUMERIC_CLAIM；
- 手工规则判断冲突、注入风险、视觉缺口和分析质量；
- `DocumentKnowledgeExecutor` 默认实例化 `DeterministicDocumentUnderstandingAdapter`，真实 Document Worker 未注入其它 analyzer。

结论：这是正在运行的生产语义算法，不是 Mock，也不是 MarkItDown 薄壳。MarkItDown 只提供转换能力，没有授权这套分类、冲突和置信度算法。

处理：

- 从真实 Worker 删除默认 deterministic analyzer；
- Markdown 结构解析只保留标题、表格、locator、hash 和原文区间；
- 文档事实提取、冲突判断和与当前任务的相关性由 LLM 基于完整上下文完成；
- 每条事实必须携带可核对的 source locator 和原文证据；
- LLM 不可用或证据不足时保持 `NEEDS_CONFIRMATION/BLOCKED`。

### P0-02 Deterministic 事实选择器在 Control API 和 Workflow 中默认启用

位置：

- `packages/document-intelligence/src/index.ts`：`DeterministicFactSelector`、`rankFact`
- `apps/control-api/src/app.ts`
- `apps/workflow-worker/src/execution-service.ts`

当前行为：

- Han bigram、英文 token overlap 决定相关性；
- BRAND/COMPLIANCE、SELLING_POINT 等类别使用手工权重；
- 固定选择上限 24、12、8；
- Control API 和 Workflow 默认使用该 selector。

结论：该逻辑会让不同行业、语言和表达方式被同一套产品营销词典支配，严重违背通用性要求。

处理：真实路径删除 token overlap、类别权重和固定 semantic ranking。保留的上限只能作为上下文资源预算，不能决定“什么事实更重要”；选择应由 LLM 输出 evidence-referenced fact refs，平台只校验 ref 存在、作用域正确且未超预算。

### P0-03 参考图职责由关键词和单图内容猜测

位置：

- `packages/domain/src/reference-roles.ts`
- `packages/reference-analysis/src/index.ts`
- `apps/control-api/src/app.ts`
- `packages/persistence/src/creative-planning-repository.ts`

当前行为：

- `roleTerms` 对 SCENE/SUBJECT/STYLE 中英文词做计分；
- 按“第 N 张”、文件名附近 100–160 字、这张/其它图片等正则推断角色；
- 单张图片视觉分析在看不到用户任务和其它图片时，仍被要求选择主要用途；
- `confidence >= 0.7` 等固定阈值决定是否采用；
- 同一套启发式在内存和数据库实现中重复。

结论：图像内容不是图像用途。人物照片既可控制身份，也可控制风格或构图；产品场景图同理。单图分类和关键词窗口都不能产生可靠意图事实。

处理：

- 删除真实路径的 `roleTerms`、`roleFromText`、文件名窗口和 remainder clause 推断；
- 上传时视觉分析只记录可观察事实，不记录“用户想让它控制什么”；
- 优先使用用户显式角色；没有显式角色时，由一个同时看到完整 source、全部图片及其顺序的 LLM 生成 reference plan；
- plan 必须保持 canonical order，并说明每项证据和控制维度；
- 无法确定时阻断，不默认 STYLE，也不按上传位置猜测。

### P0-04 对象、持有关系和左右手转移由正则制造

位置：

- `packages/domain/src/visual-object-locks.ts`
- `packages/provider-video/src/prompt-compiler.ts`
- `packages/creative-planning/src/index.ts`

当前行为：

- 固定道具词表识别拂尘、长剑、手机、包装盒等；
- 用“手持/拿着/递给/换到”等词猜对象和左右手关系；
- 自动生成 `instance_count=1`、holder、transfer、prohibited changes；
- 将猜测写成 Provider 连续性锁和 motion object state。

结论：这是典型的领域过拟合和事实制造。词表永远覆盖不了多数场景，且代词、否定、隐喻、多人交互都可能被误判。

处理：从真实路径删除对象名、holder 和 transfer 正则。只有用户显式结构化事实、已确认视觉证据或 LLM 带 source evidence 的决定可以生成对象锁。没有证据时不创建锁，不补单实例结论。

### P0-05 同一源文本被四套正则重复解释

重复解析位置至少包括：

- `packages/creative-planning/src/index.ts`：`extractDialogueLines`、`stripSpokenDialogue`
- `packages/provider-video/src/prompt-compiler.ts`：`extractDialogueLines`
- `packages/persistence/src/production-repository.ts`：`deriveTranscriptScript`
- `apps/studio-web/app/pages/projects/[project_id].vue`：前端 narration 提取

当前差异包括不同标签词、不同引号规则、不同字符上限、不同去重和截断方式。`deriveTranscriptScript` 甚至最多保留四项并截到 1,200 字符。

风险：同一句话可能在规划时被当作台词，在生产门禁时却不被识别；也可能被重复注入或静默丢失。任何 downstream parser 都可能成为新的语义权威。

处理：

- source 只在一个 LLM 语义阶段解释一次；
- 输出稳定的 `dialogue_id + exact_text + source_ref + segment_id`；
- 下游只能按 ID 映射和逐字校验，不再从 prose 中重新提取；
- 旧正则仅允许保留在显式 legacy import 工具中，不得参与新生产任务。

### P0-06 Provider Prompt Compiler 仍在承担导演职责

位置：`packages/provider-video/src/prompt-compiler.ts`

当前行为：

- 再次提取对象、台词和转移动作；
- 自行生成单实例、手部交接、口型、嘴部中性、末尾停姿、禁止 filler 等长篇指令；
- 从 source 字符串 marker 判断是否已经编译过某类合同；
- 多份模板可能与 LLM visual decision 和 source 重复。

结论：Provider compiler 应是 mapper，不应成为第二导演或第二文本理解器。

处理：改为出站 allowlist 投影。仅可拼接：本段 source facts、已验证 LLM decision、精确 dialogue、已认证 Provider 必需指令、与实际 URL 顺序一致的 reference plan。任何对象、口型、情绪、镜头、转移或终点都不能在此推导。

### P0-07 Prompt 超限逻辑会删除 source 内容

位置：`packages/provider-video/src/runtime-profile.ts`

当前行为：`sourceCompactionPatterns` 在超出 4096 UTF-8 字节时删除识别出的 source 子句。虽然不是按字节截断，但仍属于未获授权的静默改写。

处理：

- 删除所有 source clause compaction；
- 只允许删除 sidecar 可证明属于平台生成的完整 `generatedPromptParts`；
- source 本身超限时由 LLM 重新规划合法 segment；
- 仍无法承载时返回 `PROMPT_BUDGET`，不得摘要、删句、折叠或改写。

### P0-08 必填 motion/shot schema 强迫系统制造不存在的事实

位置：`packages/contracts/src/creative-planning.ts`

重点：

- `StoryboardShotSpecSchema` 强制要求 start_state、end_state、transition_summary、continuity_note；
- `MotionBeatSchema` 强制要求 subject_refs、start_pose、end_pose、shot_size、camera_movement；
- `GenerationSegmentMotionPlanSchema` 强制要求 scene_lock、opening/closing、transition、complexity_score；
- object holder/transfer 被固化为有限枚举和三阶段交接模型。

后果：真实 LLM 没有这些事实时，只能填 `PLATFORM_OWNED_*` sentinel，再依赖字符串过滤防止外泄。这是 schema 导致的事实伪造。

处理：

- 真实 LLM 路径停用该强制 motion shape；
- 通过 ADR 将创作字段改为可选、来源标注或独立 provenance-referenced extension；
- 只有 source/LLM 真正提供的字段才存在；
- Provider 不需要的内部字段不得为了兼容而填假值；
- 旧 schema 仅用于历史快照读取和 Mock，不再授权新真实计划。

### P0-09 连续性“自动修复”存在伪执行和伪成功

位置：

- `packages/domain/src/continuity.ts`
- `packages/persistence/src/production-repository.ts`
- `apps/production-worker/src/handoff-evaluator.ts`
- `apps/production-worker/src/media-service.ts`

当前行为：

- BLEND 默认 600ms，BRIDGE 默认 2000ms，并做 1–3 秒 clamp；
- repair row 可直接写成 `ACCEPTED`；
- 同一事务里同时发 `transition_repair.requested` 与 `transition_repair.succeeded`，但没有对应的真实修复产物；
- production worker 当前还默认接入 fixture evaluator，真实 evaluator 并未配置；
- fixture 输入中甚至硬编码 `characterCount: 1`。

结论：这是过度开发出的“修复系统外观”，不是已实现的可靠能力。

处理：立即禁用真实路径自动 BLEND/BRIDGE 接受和成功事件。保留边界帧提取及客观检查能力；发现问题时使用 cut、人工复核或 LLM 提议，但没有真实执行和产物证据不得写 succeeded。相关表和事件如需删除，先走 ADR；在此之前只能保留为不可触发的历史兼容。

### P0-10 前端自动批准并注入未经用户确认的交付策略

位置：`apps/studio-web/app/pages/projects/[project_id].vue`：`startAutomatedProduction`

当前行为：

- 自动请求 storyboard 后立即调用 approve；
- 创建 delivery plan 时固定 `FLEXIBLE + 20%`、字幕 OFF、lip sync OFF、PLATFORM_GENERIC、budget 0；
- 随后自动批准 delivery plan；
- 前端自己正则解析 narration 并创建 section。

结论：审批门禁被变成程序自签；固定策略不是薄壳，也不是用户明确选择。

处理：

- 前端只展示 LLM 提案和调用显式命令；
- storyboard、delivery policy、caption、voice、lip sync、预算需用户确认或已有明确项目策略；
- 未选择时不得偷偷赋值并批准；
- narration 不得在 Vue 中解析，应使用已批准的语义结果。

### P0-11 Final Review 写入未经检查的否定结论

位置：`services/media-runtime/runtime.py`：`final_review_video_bytes`

当前行为：

- `broken_overlays=false`、`missing_assets=false`、`unreadable_text=false` 即使没有对应检测；
- `promise_preservation.status=CHECKED`、`runtime_swap_detected=false`、`silent_downgrade_detected=false`，但本地输入不足以完成这些比较；
- “未配置语义检查”与布尔 false 同时存在，易被上层当成通过。

结论：未知不能表示为 false，未检查不能表示为 CHECKED。

处理：没有证据的字段改为 `UNAVAILABLE/UNKNOWN` 或不输出；只让 ffprobe、MIME/SHA、实际帧和实际音频测量产生确定结论。语义/承诺保持需要比较源计划与成片的真实模型或人工证据。

### P0-12 固定 CLIP 类别被冒充为通用视觉语义 QC

位置：`services/media-runtime/runtime.py`：`visual_semantic_review`

当前行为：只在四帧上，从 indoor、outdoor、portrait、action、night、abstract、text-overlay 等固定类别中取 argmax，却不与本段 source facts、人物、产品、动作终点或参考图比较。

结论：它既不通用，也无法证明“视频是否按要求生成”。固定类别甚至会给复杂商业、教育、工业和抽象内容错误标签。

处理：删除该固定分类作为验收依据。视觉语义 QC 应由能看到 source decision、reference plan 和时序采样的多模态 LLM 完成，并逐项返回 evidence；能力不可用时保持 UNAVAILABLE。

## 6. P1：应改为 LLM 决策、仅限 Mock，或完成降复杂度

### P1-01 Deterministic planner 必须物理隔离到 Mock

位置：`packages/creative-planning/src/index.ts`：`DeterministicPlanningModel` 及其辅助函数。

其中包括：

- narrative 关键词分类；
- 字符容量和时长公式；
- `deriveCamera`；
- `inferPhysicalSceneConstraints`；
- `hasCinematicEditorialBoundary`；
- `chooseGenerationSegmentCount`、`planSegmentDurations`；
- event/duration 均分；
- 自动 motion beat 和 object state。

当前真实入口已不直接选择 deterministic planner，这是正确的；但这些函数仍与真实 LLM adapter、compiler 和公共类型位于同一生产模块，测试也大量把 deterministic 输出转换成真实 fixture。

处理：将整套 deterministic 创作逻辑迁到 `mock`/fixtures 专用模块，真实构建不依赖它。Mock 只能验证队列、状态和媒体闭环，不应被描述为创作质量基准。

### P1-02 真实 LLM 路径仍受场景正则和旧 reference policy 干预

位置：`packages/creative-planning/src/index.ts`：`explicitSceneChangePattern`、`hasExplicitSceneChangeSignal`、`shotReferencePolicy`、`buildLlmSegmentedDraft`。

问题：LLM 已经看到完整 source 并负责 segment decision，平台却又用中文正则判定是否存在场景变化，并据此阻断或更改 handoff/reference policy。这会对不同语言、隐含转场和非影视表达失效。

处理：LLM segment decision 应直接返回带 evidence 的 scene continuity decision；平台只校验它引用了有效 source/binding。正则不能覆盖 LLM 语义判断。

### P1-03 Huobao 8–15 秒被当成真实 Provider 硬下限

位置：`apps/workflow-worker/src/execution-service.ts`：`resolvePlanningDurationPolicy`，以及 LLM system prompt。

Huobao 的 8–15 秒是其 storyboard 组织原则，不是 Grok/Sub2API 已认证的唯一硬限制；Seedance 还覆盖更短简单片段。当前代码会让低于 8 秒的合法 Provider 任务直接失败。

处理：

- Provider 已认证范围作为硬限制；
- Huobao 8–15 秒作为 source-guided 建议；
- LLM 根据内容和 Provider 能力选择；
- 不用某一来源仓库的创作习惯冒充跨 Provider 协议限制。

### P1-04 LLM system prompt 含领域特例和过度模板

位置：`apps/workflow-worker/src/semantic-planning-client.ts`。

问题包括护肤“泛红逐渐减轻、肤色更均匀”等产品特例，以及对所有任务强制大量同一措辞。特例会诱导模型把护肤表达迁移到其它产品；过长规则也会挤压实际上下文。

处理：删除所有行业案例，用抽象规则表达“保留 source 明确声明的可见起点、变化和终点，不新增功效”。Prompt 只包含跨场景稳定原则、输出 schema 和来源约束。

### P1-05 `isPlatformBoundaryShell` 等字符串过滤应由 provenance 取代

位置：`packages/creative-planning/src/index.ts`。

固定判断“本段开始/本段结束/按分段顺序承接”只能挡住当前三种值。任何改词、翻译或历史快照都会绕过。

处理：source、LLM decision、platform directive 必须在类型上分离；出站 prompt builder 只读取允许 provenance，而不是猜字符串来源。

### P1-06 Narration normalization 含语言特例和自动改写

位置：

- `packages/domain/src/narration-quality.ts`
- `packages/creative-planning/src/narration-quality.ts`
- `services/media-runtime/runtime.py`

问题包括数字转中文、全大写缩写识别、固定 pace/energy、默认 pause、AI/UI/ML/AR/VR 特例和“AI→艾艾”ASR hack。这些规则只覆盖少数语言和读法，且可能改变品牌、金额、型号和专有名词。

处理：

- display text 永不自动改写；
- provider_text 由 LLM/TTS provider 在明确 pronunciation glossary 下产生；
- 任何改写都必须保留 source、normalized proposal 和审批记录；
- 无批准 glossary 时逐字传递或 fail-closed。

### P1-07 Transcript 比对阈值和中文覆盖算法不能作为通用硬门

位置：`services/media-runtime/runtime.py`：`compare_transcript_to_script`。

当前包含 0.75–1.15 CJK coverage、0.9 Latin accuracy、集合匹配、插字子序列及特殊词修正。它既不能可靠处理同音字、数字、方言、多语言，也可能放过错序和漏词。

处理：保留原始 ASR token、时间戳和基础技术事实；由多语言 LLM 结合 source script 做语义及逐字差异报告。确定性代码只检测完全可证明的缺失、空轨和时间越界；不再用手工阈值自动宣判台词正确。

### P1-08 获授权的 BGM 智能匹配仍应从 token 算法升级为语义判断

位置：`packages/persistence/src/production-repository.ts`。

允许保留的能力：AUTO/MANUAL/OFF、MUSIC 角色隔离、时长覆盖、稳定幂等 tie-break 和 Pixabay fallback。

需要替换的实现：

- `musicMetadataTokens`；
- `hasMusicContentMatch`；
- 手工分数 `匹配数*10 + 时长2分`；
- 标签优先规则；
- 英文 transport stopwords。

处理：LLM 读取用户音乐意图和受信候选 metadata，返回带理由的候选排序；确定性代码继续校验 MUSIC 角色、作用域、时长、媒体完整性，并在等价候选中使用稳定 tie-break。LLM 不可用时不猜。

### P1-09 BGM 未显式选择时不能默认为 AUTO

位置：`packages/contracts/src/media-runtime.ts`：`MusicPlanSchema.default({})` 与 `mode` 默认 AUTO。

能力获授权不等于每次任务都授权自动选曲。缺失字段应表示未选择，而不是自动触发远程搜索、下载和混音。

处理：新生产命令要求显式传入 AUTO、MANUAL 或 OFF；历史缺省值仅作为兼容读取，不能用于新写入。

### P1-10 音频混音默认值分散且互相不一致

位置：

- `packages/contracts/src/media-runtime.ts`
- `apps/production-worker/src/media-runtime-client.ts`
- `packages/persistence/src/production-repository.ts`
- `services/media-runtime/runtime.py`

当前同时存在 0.08/0.12/0.20 音量、8/18 dB ducking、不同 fade 默认。部分值能在 OpenMontage 不同 skill 找到，但平台把不同用途的示例混成多套隐式策略。

处理：建立一个明确 source profile，注明固定 upstream 文件和适用场景；所有 mapper 只传递该 profile 或用户选择，不在四层分别补默认。旧值只用于历史快照读取。

### P1-11 UI 的 segment 预估是另一套机械分段器

位置：`apps/studio-web/app/components/studio/StoryPlanningPanel.vue`：`estimateGenerationSegments`。

当前按 `ceil(duration/15)` 后均分，虽标注为估算，仍会向用户展示确定段数和时长，强化一套与 LLM 实际规划不同的认知。

处理：删除伪预测；UI 只展示 Provider 单段上限和“最终由 AI 根据内容规划”，或展示 LLM 已产生的真实计划。

### P1-12 Delivery preflight 中仍有伪事实和固定政策

位置：`packages/persistence/src/delivery-preflight-repository.ts`。

问题：`estimatedAmount` 固定传 `0`，`requiresSampleApproval` 永远 true，voice/lip-sync 只靠固定枚举阻断。这些状态外壳可以保留，但不能用假预算或固定政策冒充真实 preflight。

处理：只使用实际 capability、已冻结费用和用户选择；缺少事实时阻断或 UNKNOWN。审批状态机保留，自动填充政策删除。

### P1-13 参考图下游二次排序破坏语义对应

位置：`apps/task-worker/src/reference-delivery.ts`。

当前按 `HANDOFF → SCENE → SUBJECT → STYLE` 重排 snapshot 中的 references。Prompt 编号和 Control API 的 canonical order 可能仍按 binding position，造成 image N 与实际 URL 错位。

处理：snapshot 建立后禁止角色排序；handoff 的插入顺序在 snapshot 生成时一次确定，后续 Prompt、role、asset ID、relay URL 和 Provider URL 共用同一数组。

### P1-14 OpenMontage variation/risk 评分只能作为来源审计提示

位置：`packages/creative-planning/src/openmontage-variation-audit.ts`。

该模块能指向固定 OpenMontage 来源，因此不是平台自造。但它仍使用 generic phrase、比例阈值、shot-size repetition 和 hero moment 等特定创作评价。

处理：允许保留为可选 upstream advisory 或 Mock 诊断；不得自动修改真实 LLM 计划、阻断不适用题材或制造新镜头。最终是否采用建议由 LLM 结合任务语境判断。

### P1-15 ALCHMED1–8 和平行音频路径属于明显过度开发

位置：

- `apps/production-worker/src/media-runtime-client.ts`
- `services/media-runtime/runtime.py`

当前为历史兼容保留八个私有二进制版本，并同时存在 OpenMontage full_mix、legacy narration mix、legacy music mix、segmented music 等多条路径。大量分支只为兼容旧快照，新增需求容易继续复制算法。

处理：

- 新任务只写一个当前版本和一条来源明确的 AudioPlan 路径；
- ALCHMED1–7 只读，不再新增行为；
- 完成历史数据迁移后删除旧编码器和旧 mixer；
- `full_mix`、`segmented_music` 仅在它们各自 fixed upstream 语义适用时调用；
- 不用 legacy fallback 悄悄补齐新计划。

### P1-16 内存/数据库双实现重复语义规则

多个 repository 在 InMemory 和 Drizzle 类中复制 role、fact、preflight、状态和筛选逻辑。复制会让修复只发生在一条路径，测试却继续假绿。

处理：将纯规则收敛为共享函数；repository 只负责存取、事务和作用域。语义决策由上游 LLM service 完成，不能各 repository 再解释一次。

## 7. 可保留的必要薄壳与来源能力

以下内容不属于本次删除对象：

- 用户、workspace、权限、Control API；
- Queue/Worker、outbox、消费幂等、重启恢复和 dead-letter；
- 数据库事务、状态机、唯一约束和历史快照读取；
- 对象存储、服务端 object key、presigned/relay、MIME、SHA、大小和 ffprobe；
- Provider submit/poll/download、字段 mapper、错误归一化和认证能力边界；
- PromptPackage/sidecar 作为来源和出站字段的证据载体；
- 精确 reference canonical order 和 asset role 的显式绑定；
- 固定 upstream 可追溯的 Doubao、Pixabay、OpenMontage stitch、full_mix、segmented_music、subtitle 格式化等适配；
- Provider 已认证的时长、图片数量、分辨率和 4096 字节边界；
- 用户明确授权的 BGM 智能匹配产品能力；
- 明确用户选择的字幕、音频 owner、TTS Provider 和音乐模式；
- 技术 QC：容器、轨道、时长、分辨率、黑帧、静音、响度等可测事实。

保留不等于可以继续扩展。薄壳只能传递、验证和恢复，不能反过来创造创作语义。

## 8. 允许使用正则、关键词和确定性阈值的边界

允许：

- ID、SHA-256、URL、MIME、数字格式、RFC3339 等语法验证；
- 明确协议字段、枚举和 Provider 状态映射；
- exact marker 或 source locator 的机械解析，但不得从其附近内容推断语义；
- 安全防护和敏感信息脱敏；
- Provider/upstream 明确给出的技术阈值；
- 用户明确授权的 deterministic tie-break、幂等 key 和资源上限。

禁止：

- 关键词决定角色、类别、事实重要性、镜头、情绪、动作、场景或道具；
- 正则从自然语言猜台词归属、人物关系、左右手、功效或转场；
- 手工分数决定创作选择；
- 无来源阈值决定语义正确/错误；
- 未知时默认到某个创作类别；
- 将“匹配到词”视为事实证据。

安全过滤可以使用 deterministic defense-in-depth，但只能标记风险或阻断，不得借安全名义改写用户内容或生成替代内容。

## 9. 目标架构：单一语义 owner + 确定性证据门

### 9.1 文档理解

输入：完整 Markdown、表格结构、source locator、用户当前任务。

LLM 输出最小结构：

- `fact_id`
- `exact_statement`
- `source_locator`
- `evidence_quote`
- `relevant_to_task`
- `conflict_refs`
- `needs_confirmation`

平台只校验 locator、quote、hash 和作用域，不按固定营销类别或词频排序。

### 9.2 创作规划

一个 LLM 调用拥有完整 source、已批准事实、全部参考图说明、Provider capability 和目标时长。它输出：

- segment ID 和顺序；
- 本段 source refs；
- 精确 dialogue IDs；
- visual decision；
- 可选且有 evidence 的 camera/reference/continuity decision；
- unresolved items。

平台验证：

- 所有 source/dialogue 是否完整、唯一、按序覆盖；
- 所有 evidence ref 是否存在；
- 时长和 Provider 参数是否可用；
- reference order 是否一致；
- unresolved 是否需要阻断。

平台不得再做 narrative 分类、分镜推断或镜头补全。

### 9.3 Prompt 编译

Prompt builder 是纯函数：

`segment source facts + LLM decision + exact dialogue + certified provider directives`

它不读取完整 source 文本做正则，不调用任何 infer/score/detect 函数，不生成未提供字段。

### 9.4 BGM

LLM 只在用户显式 AUTO 时对候选 metadata 做语义比较；平台负责候选资格、时长、角色、作用域、下载安全和稳定 tie-break。没有合格候选或 LLM 不可用时 fail-closed。

### 9.5 QC

分为两层：

- 技术 QC：确定性工具检查文件事实；
- 语义 QC：多模态 LLM 将实际视频与 segment source facts、reference plan、dialogue 和可见终点逐项比较。

每项结果必须是 `PASS / FAIL / UNAVAILABLE` 并附 evidence。没有检查不得写 false 或 PASS。

## 10. 全量整改分类矩阵

| 区域 | 当前逻辑 | 归类 | 处理 |
| --- | --- | --- | --- |
| 文档转换 | MarkItDown 流、SHA、locator | 必要薄壳/来源能力 | 保留 |
| 文档事实分类 | categoryRules/数字/关键词 | 自造 | 真实路径删除，改 LLM |
| 文档事实选择 | bigram、手工权重 | 自造 | 删除，改 provenance-referenced LLM |
| 参考图事实分析 | 可观察人物/物体/场景描述 | 可保留但需去意图化 | 只保留客观事实 |
| 参考图 role | 关键词、文件名窗口、单图分类 | 自造 | 删除，联合 LLM/用户显式角色 |
| reference order | binding position/handoff canonical | 必要薄壳 | 保留并统一 |
| 下游 role 排序 | SCENE 优先等 | 自造/错误适配 | 删除 |
| narrative classifier | ACTION/STATE/CONTROL 关键词 | 自造 | 仅 Mock；真实改 LLM |
| 对象/左右手 | 道具词表、transfer regex | 自造 | 删除 |
| deterministic segment/camera | 公式、均分、deriveCamera | Mock fixture | 迁出真实模块 |
| LLM segment decision | 自然语言导演 | Source-guided | 保留并补 evidence |
| scene-change regex | 中文转场词 | 自造 | 删除，改 LLM decision |
| motion sentinel | PLATFORM_OWNED_* | 兼容债务 | 真实路径移除，ADR 简化 schema |
| dialogue extraction | 四套 regex | 自造/重复 | 删除，单一 LLM 输出 exact IDs |
| Provider mapper | 参数、错误、协议 | 必要薄壳 | 保留 |
| Provider prose enrichment | 对象、口型、转移模板 | 自造 | 删除 |
| Prompt generated-part compaction | sidecar 整项删除 | 必要边界 | 可保留 |
| Prompt source compaction | 删除 source clause | 未授权改写 | 删除 |
| continuity frame extraction | 真实边界帧 | 技术能力 | 保留 |
| continuity auto repair | 固定 BLEND/BRIDGE 和伪成功 | 自造/过度开发 | 禁用并退役 |
| narration exact text | source-owned | 来源事实 | 保留 |
| narration 数字/缩写改写 | 语言特例 | 自造 | 改 LLM+审批 |
| narration timing | 已测音频与硬上限 | 技术事实 | 保留 |
| transcript 手工覆盖率 | 0.75/0.9 等 | 自造 | 降为原始证据，改 LLM QC |
| BGM 产品能力 | AUTO/MANUAL/OFF | 用户授权 | 保留 |
| BGM token score | 关键词/权重 | 自造实现 | 改 LLM 语义匹配 |
| BGM stable tie-break | hash/idempotency | 用户授权薄壳 | 保留 |
| Pixabay 顺序 | search/filter/fallback/first/download | 固定来源 | 保留 |
| 音频 mix/stitch | 固定 OpenMontage adapter | 固定来源 | 保留 |
| 多套混音默认 | 分散的隐式参数 | 过度开发 | 合并为单 source profile |
| UI segment estimate | ceil+均分 | 自造 | 删除 |
| UI 自动 approve | 自动签署策略 | 未授权 | 删除 |
| 技术 Final Review | ffprobe/实际测量 | 必要 QC | 保留 |
| 固定 CLIP categories | 无 source 对照分类 | 自造 | 删除 |
| 未检查字段=false/CHECKED | 伪证据 | 错误 | 改 UNKNOWN/UNAVAILABLE |
| ALCHMED1–8 | 历史并行协议 | 过度开发 | 新写单版本，旧版只读退役 |

## 11. 代码审查硬门

后续任何 PR 只要出现以下情形，默认拒绝，除非能逐项给出用户授权或固定来源：

- 新增自然语言关键词表、同义词表或行业专用正则；
- 新增 semantic score、权重、阈值、rank 或 confidence gate；
- 新增 unknown→默认类别；
- 新增 source prose 二次解析；
- 新增自动改写、摘要、截断或补全；
- 新增静默 fallback；
- 新增未经用户选择的 AUTO；
- 新增未执行即成功、未检查即 false/PASS；
- 为满足旧 schema 新增 sentinel；
- 将某个示例行业的词写进通用 system prompt；
- 把 Mock 输出作为真实路径 fixture 的语义标准。

PR 必须同时回答：

1. 该行为的 source/授权在哪里；
2. 为什么不能由 LLM 在完整上下文中判断；
3. 确定性代码只验证了什么事实；
4. 不确定时如何 fail-closed；
5. 最终 Provider/QC snapshot 如何证明没有新增语义。

## 12. 建议整改顺序（本轮不执行）

### 阶段 A：先切断正在运行的 P0 语义算法

- Document Worker 不再默认 deterministic analyzer；
- Control API/Workflow 不再默认 deterministic fact selector；
- 参考图不再使用关键词 role/lock 推断；
- Provider compiler 不再做对象、转移和台词提取；
- 关闭 source compaction；
- 关闭 continuity auto repair 伪成功；
- UI 停止自动 approve 和固定 delivery policy。

Exit Gate：真实模式缺少 LLM 或明确用户决定时必须阻断；不得回退上述旧算法。

### 阶段 B：建立单一语义产物

- DocumentFactProposal；
- ReferencePlan；
- SemanticStoryboardPlan；
- ExactDialogueMap；
- SemanticMusicDecision；
- SemanticFinalReview。

每个产物都必须带 evidence refs、uncertainty 和 source hash。下游不再读 prose 猜含义。

### 阶段 C：通过 ADR 缩减过度 schema

- motion plan 必填字段改为 optional/provenance-referenced；
- 删除新写入的 sentinel；
- 文档固定 category 改为开放标签或任务相关事实；
- AUTO_REPAIRING 等未实现状态停止新写入；
- MusicPlan 新命令要求显式 mode；
- 未检查 QC 字段支持 UNKNOWN/UNAVAILABLE。

### 阶段 D：统一媒体 profile 和退役 legacy

- 新任务只用一个 AudioPlan wire；
- mixer 参数来自一个 source profile；
- 旧 ALCHMED 和 legacy mixer 只读；
- 有迁移证据后删除旧分支。

### 阶段 E：完整行为审计

至少验证：

- 换行业、换语言、换叙事类型时没有关键词依赖；
- 原始 source bundle/hash/span 可追踪，exact dialogue byte-for-byte，reference identity/order 全链路一致；Provider visual prompt 明确是 LLM 语义投影；
- 无 LLM 时真实路径 fail-closed；
- LLM 每个决定能回指 source evidence；
- Prompt 不含 source 外事实；
- QC 未检查项不会显示通过；
- BGM 只在显式 AUTO 运行；
- Mock 与真实语义模块没有依赖关系。

## 13. 审计局限与证据边界

本报告完成了当前本地 tracked source、现有未提交代码和固定 upstream 的静态调用链审计，并确认多个默认构造器位于真实 Worker 入口。

本轮没有：

- 修改任何业务代码；
- 修改数据库或公共契约；
- 调用真实 Provider；
- 执行 VPS、GitHub、commit、push 或部署；
- 通过运行时流量证明每个历史兼容分支仍有真实数据使用。

因此，ALCHMED 历史版本和旧表字段的实际使用量需要在后续退役前做数据库/快照盘点；这不影响其“不得继续新增行为”的审计结论。

## 14. 最终结论

当前最需要治理的不是“再写一套更好的关键词”，而是彻底停止由平台代码解释自然语言语义。

正确边界是：

> LLM 在完整上下文中充分理解并作出带证据的语义决定；平台代码只负责保存原文、验证证据、执行协议、保证顺序、限制能力、恢复任务并在不确定时 fail-closed。

这并不意味着所有逻辑都交给 LLM。权限、状态机、幂等、媒体校验、Provider 协议、资源边界和可测技术事实必须继续由确定性代码负责。需要删除的是“看似确定、实际上只是平台猜测”的那一层。

在本报告 P0 项完成前，不应继续进入原开发文档的参考图顺序、Prompt 预算等单项实现阶段；否则会在旧的并行语义架构上继续打补丁。
