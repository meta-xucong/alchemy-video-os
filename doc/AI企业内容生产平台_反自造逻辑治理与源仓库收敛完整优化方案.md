# AI 企业内容生产平台：反自造逻辑治理与源仓库收敛完整优化方案

版本：`2.4.0`

日期：`2026-09-24`

状态：`READY_FOR_AUDIT`

实现口径：`IMPLEMENTED / LOCAL_TECHNICAL_AND_INFRA_GATES_PASS / EXTERNAL_VALIDATION_PENDING`

上游依据：

- `AI企业内容生产平台_反自造逻辑与通用LLM边界专项审计报告.md`
- `AI企业内容生产平台_源仓库创作逻辑收敛与平台薄壳边界开发文档.md`

本文件是两轮审计后的主执行方案。与上述两份文件发生执行顺序冲突时，以本文件为准；上述文件继续保留为问题证据和来源边界说明。

## 本地实施与待审计结果（2026-09-24）

WP-00 至 WP-12 已按依赖顺序完成代码实现、本地技术门禁和隔离基础设施集成回归，但尚未完成正式章节独立验收。当前只允许进入 `READY_FOR_AUDIT`，不得据此宣称平台级 `ACCEPTED`、生产稳定或可部署。核心结果：

- 真实创作链接收完整 Canonical Source Bundle 和带不可变引用的 Semantic Director Decision；确定性检查器只证明引用身份、精确 span、顺序、范围与 Provider 边界，不证明视觉语义蕴含关系或 source 全量覆盖；
- 文档关键词分类、二元词 overlap、固定权重与固定条数事实选择已退出生产导出面；
- 参考图用途、台词、分段、镜头和对象连续性不再由真实路径的关键词/正则重新推断；
- deterministic planner/compiler 与关键词、对象、换手启发式已迁入显式 `./mock`/`./mock-heuristics` 子路径；它们仍为 Mock/历史兼容存在，不能描述成全仓删除；
- 真实 Provider 视觉 prompt 是 LLM 的 `visual_decision` 投影；原始 source 在 CanonicalSourceBundle 中冻结并哈希，精确台词逐字保留，但整体 source 不会 byte-for-byte 直接成为 Provider prompt；
- 新 DeliveryPlan-backed 媒体合成只写完整 AudioPlan/ALCHMED8；ALCHMED1–7 只保留历史读取，最终删除等待用户授权的数据盘点；
- BGM token、匹配、评分、标签优先与稳定 tie-break 整套明确登记为用户授权的 `PLATFORM_OWNED` 能力，且只有用户显式选择 AUTO 才运行；
- 未执行的 QC 保持 `UNAVAILABLE/null`，没有真实 repair task/artifact 时不写 succeeded/ACCEPTED；
- 跨商品、剧情、工业、教育、金融/法律、抽象艺术以及中英混合语料的本地通用性回归已通过，但这不是实际 LLM 或成片质量证明。

测试证据必须分层记录：实现方在隔离 PostgreSQL/Redis/BullMQ/MinIO 全部启用时的历史根级结果为 `783 passed / 0 skipped / 0 failed`；独立复核人在 `5a9d354` 当前环境复跑为 `763 passed / 20 skipped / 0 failed`，20 个 skip 主要是 PostgreSQL、Redis/BullMQ、MinIO 环境门，未按通过计。`contracts:generate`、18 项目 typecheck、全仓 build、Media Runtime `152 passed + 7 subtests`、Python compile、secret scan 和 `git diff --check` 均有通过证据。真实 LLM/Provider、VPS、真实媒体语义 QC、人工质量和生产历史盘点仍待独立证据。

本地 PostgreSQL→scheduler→Worker、Redis/BullMQ 重启恢复与 MinIO 实物存取证据已经闭合。当前仅剩真实 LLM 语义质量、真实 Provider/Pixabay、VPS/生产配置、真实媒体多模态 QC、人工质量、生产 ALCHMED 历史盘点、外部凭据轮换证明和独立审计签字。审计分支与 PR 只用于验收交付；本轮不合并、不部署。

## 1. 总目标

本次优化不是局部替换几个正则，也不是再造一套更复杂的结构化算法，而是重建清晰的语义所有权：

> 真实模式下，所有需要理解自然语言、图片用途、叙事关系、创作意图或内容相关性的决定，只能由看到完整上下文的 LLM 作出；平台确定性代码只负责保存事实、校验引用身份/顺序/范围、执行协议、限制能力、恢复任务，并在结构或来源无法确认时 fail-closed。它不声称证明语义蕴含关系或完整覆盖。

只有两类例外可以由平台自建：

1. 用户明确授权的能力，例如 BGM 智能匹配；
2. 身份、权限、API、队列、持久化、对象存储、幂等、恢复、Provider 适配、技术校验等必要薄壳。
## 2. 统一判断标准

每段逻辑必须先回答三个问题：

1. 它是在验证已经存在的事实，还是在猜测事实？
2. 它是否有用户授权、固定 upstream、Provider 协议或平台运行必要性？
3. 输入稍微换行业、语言、表达方式或创作类型后，它是否仍然成立？

按答案统一归类：

- `SOURCE_FACT`：用户原文、已批准资料、精确台词、已确认图片事实、Provider 能力事实；
- `LLM_DECISION`：LLM 基于完整上下文作出的语义或创作决定，必须带证据引用；
- `PLATFORM_SHELL`：权限、状态机、队列、持久化、校验、协议映射和恢复；
- `PLATFORM_OWNED`：用户明确允许的自建能力，目前主要是 BGM 智能匹配；
- `MOCK_ONLY`：只服务测试夹具，不得被真实 Worker 引用；
- `BLOCKED`：无法证明来源或必要性的逻辑，真实路径必须删除、禁用或 fail-closed。

结构化数据本身不是问题。问题在于用固定关键词、枚举、评分和默认值冒充理解。允许保留最小结构化传输，但不得强迫系统填写不存在的语义事实。

## 3. 当前问题的合并诊断

两轮审计确认，当前问题不是单点，而是多套平行语义系统同时解释同一份输入。
### 3.1 输入理解层

- 文档通过关键词分类、中文二元词重叠和手工权重提取、筛选事实；
- 参考图通过角色词表、编号、文件名附近文本和单图分析推断用途；
- 台词、旁白和视觉描述被前端、规划器、Provider compiler、Persistence 多次正则解析；
- 对象、左右手、转移关系和连续性通过固定道具词表及正则推断。

### 3.2 创作规划层

- 真实 LLM 输出仍经过 deterministic compiler 再导演；
- 本地代码通过字符容量、固定分段、场景切换词和动作词继续影响真实计划；
- 强制 motion schema 要求 opening/closing state、camera、pose、transition 等字段，事实不存在时使用 sentinel 填充；
- 同一 source 可能被重复写入 source、visual prompt、motion prose 和 dialogue contract。

### 3.3 Provider 与媒体层

- Prompt 超限会删除被正则识别的 source 子句；
- 参考图在 snapshot 后仍会按角色二次重排；
- Provider compiler 会再次提取对象、台词、转移和锁，并生成额外 prose；
- 连续性 repair 存在未生成真实产物却记录 succeeded/accepted 的路径。

### 3.4 产品与验收层

- 前端会自动批准 storyboard 和 delivery plan，并代用户选择字幕、声音、预算等策略；
- Final Review 会把未检查项写成 false 或 CHECKED；
- 固定 CLIP 类别被当作语义审核；
- 旧协议、旧 wire、重复 parser、重复 selector 和 Mock/真实代码长期共存，增加了错误入口。
## 4. 目标架构

目标架构只保留一个真实语义权威，避免多个模块各自“理解一次”。

### 4.1 Canonical Source Bundle

进入 LLM 前先冻结一个只含原始事实的输入包：

- 原始 source text 在 CanonicalSourceBundle 中按原始字符冻结并哈希，用于追踪和引用；它不等于最终 Provider 视觉 prompt；
- 用户明确设置和批准状态；
- 文档原文、标题、表格、页码或 section locator、SHA；
- 参考图 canonical order、asset ID、SHA、MIME 及客观视觉描述；
- Provider capability profile 和硬限制；
- 已批准的历史决定，仅以 ID 和不可变快照进入。

平台可以裁剪传输大小，但不能在裁剪时判断语义重要性。超过上下文预算时，由 LLM 检索阶段选择带 locator 的证据，或直接阻断。

### 4.2 Unified Semantic Director

真实模式只允许一个逻辑语义权威。它可以在内部使用两次 LLM 调用，但必须表现为同一条可审计链：

1. `UNDERSTAND`：识别精确台词、相关事实、图片用途、明确约束和不确定项；
2. `PLAN`：基于上述证据形成分段、视觉表达、参考图使用和必要镜头决定；
3. 可选 `CRITIQUE`：只检查遗漏、无证据事实和自相矛盾，不另造第三套计划。

没有 LLM 时真实模式明确 `UNAVAILABLE/BLOCKED`，不得回退关键词、正则、评分或 deterministic planner。
### 4.3 Evidence-Referenced Decision

LLM 输出采用最小、通用、可选字段，而不是固定行业本体。每项决定携带可校验的不可变引用；“引用存在”不等同于平台已证明该视觉决定由引用事实必然推出，也不等同于覆盖了 source 的全部重要事实。每项决定至少携带：

- `decision_id`；
- `kind`；
- 自然语言 `value` 或精确文本 ID；
- `evidence_refs`，指向 source span、document locator 或 asset ID；
- `confidence`；
- `requires_user_decision`；
- 适用的 segment 或全局范围。

台词必须额外保存 exact text、原顺序和 source span；图片必须引用 canonical asset ID；文档事实必须引用不可变 locator。没有证据的字段应缺失，而不是填 sentinel。

### 4.4 Deterministic Provenance Verifier

确定性代码只做无需理解语义的 provenance/结构验证：

- evidence ref 是否存在并属于当前 workspace/project；
- exact text 是否与 source span 完全一致；
- 图片 asset ID、role projection 和 URL 顺序是否一致；
- segment 时长、总和和 Provider 上下限是否合法；
- 是否重复、越界、引用未知 ID 或违反协议；
- SHA、MIME、字节数、ffprobe、状态机、幂等和权限。

Verifier 不得判断“这句话是不是动作”“这张图是不是人物图”“这个事实是不是重要”，也不能证明 `visual_decision` 与引用事实之间的语义蕴含关系或 source 覆盖完整性；这些仍属于 LLM、真实多模态 QC 与人工审阅边界。

### 4.5 Pure Projectors

下游只做投影：

- Provider Prompt Projector：把已批准决定映射为 Provider prose；
- Reference Projector：按 canonical order 生成编号、角色和 URL；
- Media Plan Projector：把已批准音视频决定映射到固定 OpenMontage 操作；
- UI Serializer：展示计划和待用户决定项，不自行批准或补默认策略。
## 5. 总体修改顺序

顺序原则：先阻止静默伤害和假成功，再建立替代架构；新语义链稳定后，从输入端向下游切换；最后清理遗留兼容层。不得先删掉所有旧代码再临时补一套新规则。

### 阶段 0：冻结基线与建立台账

目标：在不改业务语义的前提下，确保后续每次删除都可定位、可验证、可回退。

工作项：

1. 保存当前 HEAD、工作区差异、测试基线和关键最终 Provider snapshot；
2. 建立“语义逻辑台账”，逐项记录文件、符号、真实调用入口、分类和处置；
3. 暂停新增关键词、正则、评分、默认值和特殊场景分支；
4. 明确 Mock、历史读取和真实生产三种边界；
5. 标记所有会写 PASS、CHECKED、ACCEPTED、APPROVED、succeeded 的入口。

本阶段不执行 commit、push、数据库迁移或部署，除非另获授权。

Exit Gate：

- 当前未提交差异已完整记录；
- 每项 P0/P1 都有 owner、调用链和计划处置；
- 新增代码审查规则能阻止新的 semantic regex/keyword score 进入真实路径。

### 阶段 1：止血与真实性门禁

目标：先消除会静默改写、自动批准或伪造成功的行为，不等待完整 LLM 架构完成。
阶段 1 工作项：

1. 删除 source 二次压缩中的删句路径；超限只允许删除有 sidecar 证明的平台生成部分；
2. 禁止前端自动 approve storyboard、delivery plan 和 narration 决定；
3. `MusicPlan` 缺失时不得默认 AUTO，必须要求用户明确选择 AUTO/MANUAL/OFF；
4. Handoff repair 未实际执行且无产物时，不得记录 succeeded 或 ACCEPTED；
5. 未执行的 QC 项改为 `UNKNOWN/UNAVAILABLE/NOT_CHECKED`，不得写 false 或 CHECKED；
6. 真实模式缺少 LLM、provenance 或关键用户决定时统一阻断；
7. 删除或禁用 `characterCount: 1`、预算 0、固定 20% 等伪事实默认值；
8. 保留技术检查，但技术检查不得替代语义检查。

本阶段允许产品暂时显示“需要决定”或“能力不可用”，不允许为了维持旧流程而偷偷回退。

Exit Gate：

- 原始 source 在 CanonicalSourceBundle 中保持原文与 hash 可追踪；exact dialogue 与其 source span byte-for-byte 一致；Provider 视觉 prompt 明确标记为 LLM 语义投影而非原文副本；
- 没有用户动作时没有 APPROVED；
- 没有真实执行产物时没有 succeeded/ACCEPTED；
- 没有检查证据时没有 PASS/CHECKED/false；
- 真实模式无 LLM 时没有 deterministic fallback。

### 阶段 2：ADR 与最小语义契约

目标：先定义唯一语义所有权和最小 provenance，再开始迁移功能。

必须新增 ADR，说明：

- 哪些旧公共/内部 schema 强迫填写假事实；
- 哪些字段改为可选或迁入历史只读结构；
- 是否需要数据库迁移及向后读取策略；
- 新旧计划如何在同一版本窗口内共存；
- Mock 如何与真实语义模块物理隔离。
阶段 2 工作项：

1. 定义 `CanonicalSourceBundle`；
2. 定义通用 `EvidenceRef` 和 `SemanticDecision`；
3. 定义 exact dialogue、reference usage、document evidence 和 segment decision 的最小内部结构；
4. 所有创作字段默认可选，不允许 sentinel；
5. 增加 source hash、model/version、decision hash 和审批状态；
6. 明确真实 Worker 只能消费带 provenance 的新计划；
7. 旧 schema 仅允许历史读取和 Mock，不再创建新的真实记录。

避免把新契约设计成另一套刚性本体。`ACTION/STATE/CONTROL`、`SUBJECT/SCENE/STYLE` 等枚举只在 Provider 或既有协议确实要求时投影，不作为全局理解模型。

Exit Gate：

- 任一语义字段都能追溯到证据或用户决定；
- 缺失事实可以自然缺失，不需要占位符；
- 新契约不包含行业关键词表、语义分数或固定镜头状态；
- ADR 已通过审计后才允许进入实现。

### 阶段 3：实现统一 LLM Semantic Director

目标：建立新真实语义链，但暂不立刻删除所有旧读路径。

工作项：

1. 新建单一 `SemanticDirectorPort`，真实环境只接 LLM 实现；
2. 输入完整 source bundle，而不是先经过关键词裁剪的结果；
3. 输出精确台词、文档证据、参考图用途、segment 决定和不确定项；
4. 要求每项决定带 evidence refs；
5. 增加独立 deterministic verifier，只验引用、顺序、时长和协议；
6. 对长文档使用 LLM evidence retrieval，不使用二元词重叠；
7. 对高风险或复杂输入可增加 LLM critique，但不得产生另一套平行计划；
8. LLM 超时、返回无证据事实或冲突时 fail-closed。
阶段 3 的输出先以离线 snapshot 和 shadow verification 验证，不允许同一真实请求同时由新旧 planner 各自决定后再“择优”。真实切换只能是明确开关，旧逻辑不得作为 fallback。

Exit Gate：

- 覆盖多行业、多语言、纯视觉、长文档、多图、对白和无对白样例；
- 所有决定都能回放到不可变 source；
- verifier 不含语义关键词或手工相关性评分；
- 相同输入和冻结模型配置产生结构稳定、证据完整的输出；
- 新链不可用时明确阻断。

### 阶段 4：从输入端开始切换语义所有权

目标：按上游到下游顺序，逐条切断旧语义链。每完成一个子阶段，旧实现立即退出真实入口，不能长期双轨。

#### 4A. 文档理解与事实选择

删除真实入口中的：

- `DeterministicDocumentUnderstandingAdapter` 默认实例；
- `categoryRules`、中文二元词 tokens、`rankFact` 和固定类别权重；
- `DeterministicFactSelector` 在 Control API/Workflow 的真实调用；
- 固定 24/12/8 条事实的语义选择含义。

保留 Markdown 转换、标题/表格/页码、locator、SHA 和大小限制。由 Semantic Director 选择证据；数量上限只作为传输预算。

#### 4B. 参考图理解

删除真实入口中的角色词表、编号附近文本评分、文件名语义推断、remainder shortcut 和单图用途分类。图片分析只描述可观察内容，不决定其用途。

Semantic Director 同时看到全部图片和完整任务后输出 reference usage；canonical order 自始至终保持不变。
#### 4C. 台词与旁白

建立唯一 dialogue owner。Semantic Director 只返回 source span 和 exact text；平台验证 exact text 与 source 完全一致。

删除或停止真实调用：

- 前端 narration 正则；
- Persistence 的 `deriveTranscriptScript` 二次解析；
- Provider compiler 的台词再次提取；
- Creative Planning 中与新 canonical dialogue 重复的 parser；
- 最多四段、固定字符截取和不同引号规则。

下游只传 dialogue ID、exact text、segment ID 和明确 audio owner，不得再从 prose 猜台词。

#### 4D. 对象、动作关系和连续性事实

删除真实入口中的固定道具词表、持有/左右手/换手正则、自动 `instance_count=1` 和三阶段 handoff 制造逻辑。

保留用户明确事实和视觉分析的客观事实。需要连续性锁时，由 Semantic Director 带 source/image evidence 输出；无证据则不生成锁。

#### 4E. 分段、场景和镜头

删除真实路径中的动作词表、状态词表、场景切换正则、机械分段和 deterministic camera derivation。

LLM 依据完整 source、Provider 能力和固定 upstream 原则决定 segment；平台仅验证时长、总和和引用。Huobao 的字数/时长公式可作为 LLM 指导或告警，不得由本地代码机械执行。

Exit Gate：

- 真实调用链不再 import 或实例化上述 deterministic semantic components；
- 同一 source 只被 Semantic Director 理解一次；
- 更换行业、语言和表达方式不需要新增关键词；
- 所有旧实现转入 Mock、历史读取或直接删除。
### 阶段 5：简化创作 schema 与 Provider 边界

目标：让 schema 表达真实存在的事实，让 compiler 退化为纯 projector。

工作项：

1. 将 start/end state、pose、camera、transition、complexity、object state 等改为可选或历史只读；
2. 删除 `PLATFORM_OWNED_*` sentinel 的新建路径；
3. 将 `DeterministicStoryboardCompiler` 移出真实 Worker 构造链；
4. Provider compiler 删除对象、转移、台词和镜头再解析；
5. Provider prose 只读取已验证的 segment decision；
6. 建立 generated parts allowlist 和 provenance；
7. 4096 字节超限只删除可证明的平台生成部分；source 本身超限则重新规划或阻断；
8. 修复参考图 canonical order，snapshot 后不得按角色二次排序；
9. Prompt 编号、asset ID、role projection、relay URL 和 Provider URL 逐项一致；
10. Provider 必需指令必须来自已认证 capability，不得以经验补写。

这里需要区分：

- LLM 可以选择有动机的镜头方案；
- Provider projector 不能自己选择镜头；
- schema 可以承载镜头决定；
- schema 不能强迫每段必须有镜头字段。

Exit Gate：

- 最终 Provider snapshot 中每段引用身份、顺序和来源均可追溯；这不等于平台已证明视觉语义正确或完整覆盖；
- 原始 source 保持冻结/hash 可追踪，exact dialogue byte-for-byte 保真；Provider visual prompt 是单独标识的 LLM 语义投影；
- 生产导出面不含 sentinel、内部字段 prose、重复全文或第二次语义推断；Mock 专用占位值只允许存在于显式 mock 子路径；
- 1–7 张参考图从绑定到 Provider 顺序完全一致；
- 无法表达时返回明确错误，不进行摘要、删句或隐式改写。

### 阶段 6：用户决定与 BGM 能力治理

目标：恢复用户对产品策略的真实控制，同时保留用户明确授权的 BGM 智能匹配。
阶段 6 工作项：

1. UI 展示 storyboard、delivery、voice、caption、lip sync、duration tolerance 和 budget 决定；
2. 用户未明确批准时，不发送 approve 命令；
3. 删除自动 FLEXIBLE 20%、caption OFF、lip sync OFF、voice PLATFORM_GENERIC、budget 0 等代决策；
4. BGM 模式必须显式选择；缺失不是 AUTO；
5. `OFF` 不选择或导入音乐；`MANUAL` 只使用明确 asset；`AUTO` 才进入智能匹配；
6. AUTO 的音乐意图由 Semantic Director 从完整上下文形成，而不是项目名或关键词命中；
7. 时长、MIME、作用域和角色仍由确定性代码过滤；
8. 候选语义排序优先使用 LLM/embedding 等通用语义能力；无能力时 AUTO 阻断或要求 MANUAL；
9. 现有 token scorer 作为用户已授权的临时实现可以在迁移窗口保留，但不得作为通用语义典范或其它模块的 fallback；
10. Pixabay 继续保持来源顺序：搜索、时长筛选、无匹配回退、首条下载。

音乐稳定 tie-break、重试幂等和完整时长覆盖属于可保留的 `PLATFORM_OWNED/PLATFORM_SHELL`；不得新增随机选曲、自动变速、多曲剧情时间线或未经授权的情绪模型。

Exit Gate：

- 所有策略字段都有用户动作或明确批准记录；
- BGM 未选择时没有 AUTO 行为；
- AUTO 的语义意图有 LLM evidence；
- MANUAL/OFF 不经过自动搜索或评分；
- Pixabay adapter 未被平台排序逻辑污染。

### 阶段 7：媒体、连续性与 QC 真实性重构

目标：保留固定来源的媒体能力，删除伪修复、伪检查和不通用语义判定。

#### 7A. 媒体合成

保留 OpenMontage 可追溯的 cut/crossfade/fade、full_mix、segmented_music、显式音轨、ducking、fade、loudness、MIME/SHA/ffprobe 和必要的有限静音输入。
合成层不得根据内容自动选择转场、自动变速、自动补剧情节拍或创建第二套混音。OpenMontage 无法等价表达的计划使用 cut 或 fail-closed；cut 作为中性机械拼接，不代表平台作出了创作判断。

#### 7B. 连续性

- fixture evaluator 只能存在于测试；
- 真实 handoff evaluator 必须同时看到边界帧和已批准 segment decisions；
- `BLEND/BRIDGE` 必须来自有证据的 LLM/用户决定或固定计划；
- repair 必须有真实 task、产物、SHA 和验收后才能 succeeded；
- 没有 evaluator 时标记 UNAVAILABLE/NEEDS_ATTENTION，不自动宣告 GOOD；
- 禁止硬编码 characterCount、场景摘要和统一 repair 时长冒充内容判断。

#### 7C. QC

将 QC 明确拆为两类：

1. 技术 QC：容器、编码、时长、分辨率、音轨、响度、静音、黑帧、SHA；由确定性工具执行；
2. 语义 QC：人物/产品/动作/参考图/台词/终点是否符合计划；由多模态 LLM 对 source decision 和真实成片逐项核对。

固定 CLIP 类别、中文特例、AI→艾艾、关键词泄漏和手工阈值可以作为诊断信号，但不能单独判定语义 PASS。ASR 输出是测量证据，不是绝对真值；不确定时进入 REVIEW。

Exit Gate：

- 未执行项均为 UNKNOWN/UNAVAILABLE；
- 最终 PASS 只在所有 required checks 有实际证据时出现；
- continuity repair 有真实产物闭环；
- 技术 QC 和语义 QC 互不冒充；
- 媒体合成与固定 OpenMontage 行为可逐项对照。

### 阶段 8：遗留协议与重复实现退役

目标：新链稳定后删除过度开发形成的维护负担。
阶段 8 工作项：

1. 盘点数据库与快照中 ALCHMED1–8 的实际使用量；
2. 对仍需读取的旧版本建立只读 decoder，不再产生旧版本；
3. 合并重复的 narration、reference、fact、music 和 prompt parser；
4. 删除真实代码中的 deterministic planner、selector、keyword classifier 和 fixture evaluator；
5. 将 Mock planner、fixtures 和测试工具迁入独立 mock/test 包；
6. 删除不再可达的状态、事件和兼容字段；
7. 合并 InMemory/Drizzle 中重复的业务语义，只保留共享 verifier 和纯 persistence 差异；
8. 统一音频默认参数来源，防止多层默认值漂移；
9. 清理旧文档中仍授权关键词扩展或伪源仓库逻辑的表述。

任何数据库字段、公共 DTO、事件或 wire 删除都必须在 ADR、数据盘点和向后读取测试后执行，不能仅凭静态未引用判断。

Exit Gate：

- 真实 bundle 只产生一个当前版本；
- Mock 与真实包之间无反向依赖；
- 同一种 source 语义只有一个 parser/owner；
- 重复默认值和不可达兼容分支已清理；
- 历史数据仍可只读查看，不会触发旧行为。

### 阶段 9：完整验证与真实 Provider 验收

目标：证明系统具备通用性，而不是只对当前样例变绿。

测试语料必须覆盖：

- 商品广告、人物剧情、工业流程、教育说明、金融/法律资料、抽象艺术；
- 中文、英文和中英混合；
- 纯视觉、原生对白、平台旁白和完全无音频；
- 单图、多图、同一图片多用途、图片用途与内容表象不一致；
- 长文档、表格、冲突事实、无关材料和提示注入文本；
- 短视频、长视频、同场景连续动作、明确转场和无转场；
- 无 BGM、手动 BGM、自动 BGM；
- Provider 上限、超限、超时、无 LLM 和部分能力不可用。
验证梯度：

1. 类型、lint、compile、`git diff --check`；
2. verifier 单元测试；
3. LLM 契约与 malformed/timeout/fail-closed 测试；
4. 跨包调用链测试；
5. 数据库、BullMQ、恢复和幂等集成测试；
6. 最终 Provider request 离线 snapshot；
7. 本地 Mock 端到端，但 Mock 只验证流程，不作为创作质量证据；
8. 经用户单独授权后，限定 profile、次数和预算执行真实 Provider；
9. 对真实产物运行技术 QC、语义 QC 和人工抽查。

禁止通过增加测试样例对应关键词来修复失败。失败应回到：

- LLM 上下文是否完整；
- 证据引用是否清楚；
- prompt 是否存在歧义；
- contract 是否强迫假事实；
- Provider 能力是否确实可表达。

最终 Exit Gate：

- 真实路径无 semantic regex/keyword scoring fallback；
- source、台词和参考图顺序全链路可证明；
- 用户决定均有明确审批记录；
- 未知状态不会伪装为通过；
- BGM 例外边界清晰；
- 真实 Provider 结果在多类场景中达到一致行为；
- 所有测试、集成和真实证据分别报告，不互相替代。

## 6. 建议的独立变更包

为控制风险，每个变更包只处理一种责任，不能把删除、迁移、UI 和媒体重构混在一个大提交中。
| 变更包 | 内容 | 前置依赖 |
| --- | --- | --- |
| WP-00 | 基线、语义台账、禁止新增启发式检查 | 无 |
| WP-01 | source 不可改写、取消自动批准、修正 UNKNOWN/成功状态、禁用假 repair | WP-00 |
| WP-02 | ADR、CanonicalSourceBundle、EvidenceRef、最小 SemanticDecision | WP-01 |
| WP-03 | Semantic Director、verifier、离线 snapshot | WP-02 |
| WP-04 | 文档理解与事实选择切换 | WP-03 |
| WP-05 | 参考图用途、canonical order 与对象事实切换 | WP-03 |
| WP-06 | canonical dialogue/narration 单一 owner | WP-03 |
| WP-07 | 分段、镜头与 creative planning 切换 | WP-04/05/06 |
| WP-08 | schema 可选化、移除 sentinel、Provider pure projector、Prompt 预算 | WP-07 |
| WP-09 | UI 用户批准与 BGM 显式模式 | WP-03，部分可与 WP-07 并行 |
| WP-10 | 连续性、媒体和 QC 真实性 | WP-08/09 |
| WP-11 | legacy wire、重复 parser、Mock 隔离和清理 | WP-10 |
| WP-12 | 全量回归、离线快照与真实 Provider 验收 | WP-11 |

并行原则：

- WP-04、WP-05、WP-06 可以在共同 contract 稳定后并行开发，但必须分别切换和审计；
- WP-09 的 UI 展示可提前做，审批行为切换需与后端门禁同时上线；
- WP-10 不能早于稳定的 Provider/Media plan；
- WP-11 不能在历史数据盘点之前执行。

每个变更包必须包含：

- 修改文件和符号清单；
- 删除/保留/迁移理由；
- 新旧调用链图；
- 单元、集成、snapshot 证据；
- 工作区差异保护声明；
- 未解决问题和下一包依赖。
## 7. 主要代码处置矩阵

### 7.1 从真实路径删除或禁用

| 位置 | 处置 |
| --- | --- |
| `packages/document-intelligence/src/index.ts` | 删除 deterministic 分类、二元词 overlap、手工 rank；只保留通用接口或替换为 LLM 实现 |
| `apps/document-worker/src/knowledge-execution-service.ts` | 不再默认构造 deterministic analyzer |
| `packages/domain/src/mock/narrative-events.ts` | ACTION/STATE/CONTROL 等关键词分类仅保留为显式 Mock/历史兼容，生产根导出面不可见 |
| `packages/domain/src/mock/reference-roles.ts` | 角色词表、编号附近文本、文件名和 remainder 推断仅保留为显式 Mock/历史兼容 |
| `packages/domain/src/mock/visual-object-locks.ts` | 固定道具、左右手和 transfer 正则仅保留为显式 Mock/历史兼容 |
| `packages/provider-video/src/prompt-compiler.ts` | 删除对象、台词、转移再解析和自造锁 prose |
| `packages/provider-video/src/runtime-profile.ts` | 删除 `sourceCompactionPatterns` 和 source 删句 |
| `apps/studio-web/app/pages/projects/[project_id].vue` | 删除 narration 正则及自动批准链 |
| `packages/persistence/src/production-repository.ts` | 删除 dialogue 二次解析、伪 repair 成功和非 BGM 语义启发式 |
| `services/media-runtime/runtime.py` | 固定 CLIP 语义类别和未检查即 false/CHECKED 退出验收 |

### 7.2 重构优化

| 位置 | 目标 |
| --- | --- |
| `packages/creative-planning/src/index.ts` | 生产安全根仅导出 provenance checker 与非语义薄壳；deterministic planner/compiler 位于显式 `./mock` 子路径 |
| `apps/workflow-worker/src/semantic-director-client.ts` | 统一 Semantic Director 适配器，输入完整 source bundle，输出 evidence-referenced decisions；不宣称确定性语义证明 |
| `apps/workflow-worker/src/semantic-execution-service.ts` | 只编排读取、LLM 调用、provenance 校验、投影和持久化，不再重分段或二次选择事实 |
| `packages/contracts/src/creative-planning.ts` | 通过 ADR 将强制创作字段可选化，移除 sentinel 需求 |
| `packages/reference-analysis/src/index.ts` | 只输出客观可见内容，不单图决定用途 |
| `apps/task-worker/src/reference-delivery.ts` | 只按 canonical order relay，不按 role 重排 |
| `apps/production-worker/src/media-service.ts` | 使用真实 evaluator/产物状态，拆分技术 QC 与语义 QC |
| `apps/production-worker/src/media-runtime-client.ts` | 收敛为一个当前 wire，旧版本只读 |
| `packages/persistence/src/creative-planning-repository.ts` | 保存决定及 provenance，不再推断 reference/object semantics |

### 7.3 明确保留

- Control API、workspace、权限、队列、Worker、outbox、事务、幂等和恢复；
- 对象存储、relay、MIME、SHA、大小、ffprobe 和下载校验；
- Provider submit/poll/download、错误归一化和能力认证；
- 固定 OpenMontage 适配器中可逐行对照的行为；
- PromptPackage、source hash、evidence refs 和内部 sidecar；
- 用户明确授权的 BGM 智能匹配及其幂等、时长和安全边界。
## 8. 明确禁止的修复方式

后续任何阶段不得采用以下方式“快速修好”：

- 给现有关键词表继续加同义词；
- 给关键词 overlap 调权重或增加阈值；
- 为某个案例增加行业、人物、产品、护肤、房地产或中文特例；
- 再写一套备用 parser 与旧 parser 互相兜底；
- LLM 不可用时回退 deterministic semantic logic；
- 用默认值替用户作出审批、声音、字幕、预算或音乐决定；
- 为满足非空 schema 填 sentinel 或空洞自然语言；
- 把未知写为 false，把未检查写为 CHECKED；
- 用 Mock 绿测证明真实创作质量；
- 用静态源码命中证明运行时链路已经收敛；
- 为了让现有测试通过而保留错误产品语义。

允许的正则仅限纯语法和安全边界，例如 ID、SHA、URL、MIME、数字、时间戳和明确格式标记；不得用正则解释内容意图。

## 9. 质量和通用性验收原则

### 9.1 通用性

新增测试失败时，优先改进 LLM 上下文、证据结构和通用提示，不得添加针对样例的关键词。一个方案只有在换语言、行业和叙事形式后仍成立，才可视为通用。

### 9.2 真实性

任何公开或持久化状态都必须有证据：

- APPROVED 有用户动作；
- CHECKED 有实际检查；
- PASS 有全部 required checks；
- succeeded 有实际执行和产物；
- ACCEPTED 有可验证验收；
- false 表示已检查且结果为否，不表示未检查。

### 9.3 来源保真

- 原始 source 在 CanonicalSourceBundle 中冻结并哈希，不被平台静默改写；
- exact dialogue 与 source span 逐字一致；
- Provider 视觉 prompt 明确是 LLM 语义投影，不得伪称原始 source 的 byte-for-byte 副本；
- 文档引用保留 locator，reference order 不重排；
- deterministic checker 只验证引用身份与结构，不能宣称已证明视觉投影无遗漏或无语义越界；
- downstream 不重新用关键词/正则解释 upstream prose。
## 10. 当前基线与工作区保护

本方案基于 2026-09-24 当前工作区审计：

- 净化后主线基线为 `origin/main@1a4d95ba9e79e04540c1f7af61b917053735d1e5`；验收分支为 `codex/g01-audit-handoff-20260924`，以 Draft PR #2 最新 head 为验收事实；
- `origin/codex/backup-20260919-snapshot@12446154` 明确保留为与主线无共同祖先的非验收 WIP 归档；它包含独有路径，不得直接合并，删除需仓库所有者确认。旧远端审计分支的删除仅指 `codex/audit-snapshot-20260924`；
- 工作区在本轮开始前已经是非干净状态，并同时存在 staged、unstaged、删除和未跟踪差异；不得把整个差异集合归因于本轮；
- 初始定向基线为 `378 passed / 17 skipped / 0 failed`；实现方历史隔离基础设施根级回归为 `783 passed / 0 skipped / 0 failed`；独立复核人在 `5a9d354` 当前环境复跑为 `763 passed / 20 skipped / 0 failed`，20 skip 为未配置的 PostgreSQL、Redis/BullMQ、MinIO 环境门；
- 绿测只证明相应本地行为，不证明真实 LLM 语义、生产集成、媒体质量或平台级验收。

后续每个工作包开始和结束时都必须比较工作区差异集合。不得覆盖、回滚或重新归因既有修改。审计分支的 commit/push/PR 已按 review-only 边界完成；独立验收前不得 merge、tag、部署、改生产数据库或调用未授权真实 Provider。

## 11. 文档优先级

执行优先级：

1. 用户最新明确要求；
2. `AGENTS.md` 的 source-first、薄壳和 fail-closed 原则；
3. 公共领域/API/事件契约；
4. 本完整优化方案；
5. 反自造专项审计报告；
6. 源仓库创作逻辑收敛开发文档；
7. 其它专项开发文档和历史记录。

旧文档中任何鼓励 deterministic semantic planner、关键词扩展、source envelope 复制、自动批准或伪检查的表述，不再构成实现授权。

## 12. 最终执行顺序摘要

1. 冻结基线和台账；
2. 先修 source 改写、自动批准、假成功、假 QC 和隐式 AUTO；
3. 通过 ADR 建立最小 provenance 契约；
4. 实现唯一 LLM Semantic Director 和无语义 verifier；
5. 依次切换文档、参考图、台词/旁白、对象关系、分段/镜头；
6. 简化 schema，移除 sentinel，将 Provider compiler 变为 pure projector；
7. 恢复用户显式决定，规范 BGM 例外；
8. 重构连续性、媒体和 QC 的真实性；
9. 最后退役 legacy wire、重复 parser 和 Mock 混用；
10. 完成多场景回归后，再经授权执行真实 Provider 验收。
## 13. 最终结论

合理的优化次序不是先修参考图顺序，也不是先删完整个 deterministic planner，而是先停止静默伤害和虚假状态，再建立统一替代语义链，随后从输入端向 Provider 和媒体端逐层切换。

最终目标不是“没有结构化数据”，而是：

> 结构只用于传递与 provenance 校验；理解由 LLM 完成；决定带不可变引用；用户有控制权；未知保持未知；平台不再以关键词、正则、评分、默认值或占位符冒充智能。

当前实现已完成本地技术与隔离基础设施门禁，并完成代码、配置、文档、安全历史净化及 Git 验收交付，正式状态进入 `READY_FOR_AUDIT`。这不是平台级 `ACCEPTED`：真实 LLM/Provider、真实媒体语义 QC、人工质量、VPS/生产配置、生产历史数据盘点和外部凭据轮换证明仍待独立补齐。本轮未合并、未部署、未调用新的真实 Provider。
