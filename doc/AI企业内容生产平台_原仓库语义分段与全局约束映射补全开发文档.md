# AI 企业内容生产平台：原仓库语义分段与全局约束映射补全开发文档

> 文档版本：v1.0（2026-09-16）
> 当前状态：`ACCEPTED（仅本轮语义分段/全局约束窄片；不代表整体平台）`
> 适用范围：C11/C12 规划阶段的“源内容→叙事点→生成片段”映射；不改变 Provider、合成、计费、身份或部署边界。

> 无标签 source ownership 的 `BLOCKED` 条款及其旧结构化实现均为历史记录；当前自然语言 LLM 输出边界以《AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md》为准。本文仍保留 2026-09-16 显式标签窄片的 `ACCEPTED` 历史证据、旧计数和原始测试记录，不删除或改写。

## 1. 文档定位与硬边界

本文件是现有正式总控、领域/API 契约、C11.6、Provider 预算联动、提示词编译和多源迁移矩阵的专项补充清单。它不能替代 `AGENTS.md`、正式开发总控文档或领域/API 契约，也不自动开启新章节、升级状态或授权真实 Provider/VPS/Git 操作。

本轮只解决一个规划缺口：当一个 30 秒需求被既有 Provider 时长上限规划为两个片段时，标题、风格、氛围、声音政策等全局信息不得被算作叙事事件，造成首段内容稀疏、后段堆叠；每个片段只携带自己拥有的可见源内容，不能复制整段故事。同时移除对白剥离路径中没有来源依据的固定 1600 字引号上限，避免超长引号导致后续视觉源被一起吞掉。

底层规则保持不变：

1. 源文本、台词、引用顺序和明确约束仍是唯一事实来源；不得凭空补人物、动作、场景、台词或结尾。
2. 先复用固定 commit 的代码、字段、顺序和校验；平台只做 workspace、权限、快照、DTO、队列、错误和脱敏等薄壳。
3. 不新增字符评分、长度权重、均衡分配、时间修正、自动改写、静默回退或第二套分段协议。
4. 不能由来源或现有内部事实证明的分段，保留 `UNAVAILABLE`/`DEFERRED`/`BLOCKED`/fail-closed，不用一次成片效果替代证据。
5. 本专项不修改 4096 UTF-8 compactor；不修改 `NarrationAsset`、`TimelinePlan`、`AudioPlan`、字幕、BGM、对象锁、Provider adapter、persistence schema、TaskRun 状态或 Studio UI。

## 2. 现状证据与问题归因

### 2.1 可复核的生产样本

VPS 项目“商品测试1”（30 秒、480P、无旁白、纯音乐）产生两个 15 秒片段。其源文案包含：

- 标题/主题：30 秒高端护肤品商业广告、轻奢、祛痘、新加坡制造；
- 全局风格：明亮、纯净、真实摄影、珍珠白与银色、避免明显 CG；
- 有序视觉动作：精华液滴、肌肤微距、吸收/舒缓、城市、实验室研发与灌装、瓶身棚拍、女性使用、水润肌肤、产品 Hero Shot；
- 全局声音/文字政策：无旁白、无字幕、纯音乐 BGM。

当前计划的第一段承载标题/主题与风格句，第二段承载大部分九项视觉动作和声音政策。结果是第一段可见动作稀少，第二段内容过密。两段的 15 秒时长和总时长均符合已有 Provider 时长规则，失败点在源单位归类和分配，不是 Provider 时长返回错误。

### 2.2 当前代码链路（只作后续实现定位）

| 位置 | 现行行为 | 本专项判断 |
| --- | --- | --- |
| `packages/domain/src/narrative-events.ts::extractNarrativeSentences/classifyNarrativeSentence` | 按标点/换行拆句，`ACTION/STATE/EXPOSITION/CONTROL` 分类；未命中的句子默认为 `ACTION` | 保留现有类型和解析顺序；不能继续堆词表或引入评分。 |
| `packages/creative-planning/src/index.ts::narrativePlanningInput` | `ACTION` 句进入 `events`；`STATE/EXPOSITION` 进入 `visualConstraints` | 后续只允许把已证明的全局句送入现有约束通道，不作为事件。 |
| `::chooseGenerationSegmentCount` | 由 `durationPolicy`、显式场景边界、现有对话容量和历史最小重试约束决定段数 | 仍由 C11.6/预算文档拥有；本专项不因事件数量单独增加 Provider 调用。 |
| `::distributeEvents` | 按现有分组逻辑把事件映射到段 | 不把该分配器包装成“语义理解”；没有源边界时不得靠它证明因果分段。 |
| `LlmFreeformPromptPlanningModel` | 先调用确定性规划器，再让 LLM 为已确定段落补视觉文字 | 当前生产路径不会让 LLM 选择段数或事件归属；不能用其绿测证明语义分段已闭合。 |
| `PromptPackage` 编译 | 将段内叙事目标、全局约束、台词和引用信息编入私有提示词 | 只允许注入当前段的源单位；全局上下文可按现有编译器语义复用，不复制完整故事。 |

## 3. 固定来源与可迁移语义

所有来源均以固定 commit 复核；下表是本专项唯一来源登记。来源宿主目录、全局状态、Agent 或 Provider 凭据不迁入平台。

| 来源 | 固定文件/符号 | 可直接迁移的语义 | 平台薄壳落点 |
| --- | --- | --- | --- |
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md`；`backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`；`backend/src/agents/index.ts` 的 storyboard breaker 流程 | 先识别 narrative beats/turning points，再形成段落；setup→event→reaction 等因果链保持在一起；一个段为 8–15 秒，内部可含 2–4 个连续子镜头；`description` 写可见动作，`atmosphere` 单独写光线、声场和氛围；按源顺序，不遗漏、合并或新增。 | `NarrativeBeat`、现有 `MotionBeat`、`GenerationSegment` 和 `PromptPackage`；不迁入 Huobao 的短剧表、进程 Agent 或轮询。 |
| `seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/long-video.md`；`references/white-model-storyboard.md`；`references/prompting.md`、`references/references.md` | 全局 setting/look/locks 与 timestamp/phase script 分开；动作先于抽象说明；细腻动作使用较少且较长 phase，清晰动作可用较短 phase；不能每两秒塞入新地点、人物、镜头技巧和剧情转折；只携带持续存在的 continuity locks；引用标签和输入顺序保留。 | 现有 `stylePreferences`、`visualConstraints`、reference map、motion plan 和段内源投影；不新增 Provider 字段或时间戳协议。 |
| `openmontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/pipelines/explainer/script-director.md`；`scene-director.md`；`edit-director.md`；`schemas/artifacts/script.schema.json`；`schemas/artifacts/scene_plan.schema.json`；`lib/shot_prompt_builder.py` | 先有 script backbone/section，再按 section 的 start/end 形成 1–3 个场景；每个场景有 `script_section_id`、时间窗和叙事/信息职责；检查全覆盖、无空洞、无旁白超窗；提示词按已有五层字段拼接，未填字段不补长 prose。 | 仅用于规划证据、段内时间/覆盖审计和已有 PromptPackage 组装；不在本专项假造完整 `TimelinePlan`、旁白时长或编辑器工程。 |

### 3.1 来源没有提供的内容

三份来源都没有“按字符数评分后自动均衡段落”、`globalSourceUnitSequences` 之类的平台协议，也没有通用 4096 压缩器。后续实现可以在私有规划边界中表达“全局上下文/可执行视觉单位”这两个来源语义，但必须由明确源标签、既有结构字段或可审计的语义规划结果提供证据；不能仅凭一个新正则或命名假设删除源内容。

本轮代码中已有的中文输入标签（例如“全局风格”“全局声音/文字政策”“视觉描述”“备注”“说明”）只作为平台兼容拼写保留，不是 Huobao、Seedance 或 OpenMontage 的逐字实现，也不计入本专项的源仓库迁移验收。它们不再扩展词表、评分或推断；若后续需要把这类标签作为来源能力验收，必须先提供固定来源证据，否则维持 `DEFERRED/UNREFERENCED`。

## 4. 术语和不变量

### 4.1 源单位

`SourceUnit` 是现有解析器从冻结 `sourceText` 得到的有序、不可变文本单元，身份沿用现有 sequence/hash/coverage 事实。保留源文本内容、标点、语义行/段顺序和引用锚点；解析时将 CRLF 归一化为 LF，视觉 beat 沿现有 planner 的字符串组装规则输出，不能把这种归一化描述成 byte-for-byte 保真。对白 provider-facing 字段另按既有 dialogue 规则保留行边界。不得对源单位做字符截断、同义改写或跨段复制。

### 4.2 全局上下文

全局上下文是影响所有片段但不构成一个可执行动作的源事实，例如明确的风格、光线、色彩、摄影质感、声音/字幕政策、品牌锁、标题/主题和负向约束。它应进入现有 `stylePreferences`、`visualConstraints`、fact/continuity lock 或 PromptPackage 的共享上下文，不占用 `narrativeBeatSequences`。

只有以下证据可以把单元标为全局上下文：

1. 已有输入字段（如 `stylePreferences`、资料事实或现有 reference/lock 绑定）；
2. 来源明确的标签/块（如 `atmosphere`、`sound`、`global setting`、`【镜头N】`/时间轴以外的全局段）；
3. 已启用的语义规划端返回可验证的角色/覆盖事实，且使用现有内部规划边界，不改变公开契约。

无法证明时，不得静默丢弃：若现有 plan 能把它作为可见源单位保留，就保留；若会造成不可表达或错误重复，则走既有规划失败/fail-closed，登记 `BLOCKED`。

### 4.3 可执行视觉节拍

可执行视觉节拍是源文本明确要求观众看到的动作、状态变化、地点/主体变化或因果结果。一个因果链应在同一源边界内保持，不因字符数量、事件数量或固定秒数机械切断。

### 4.4 生成片段与 MotionBeat

- `GenerationSegment` 仍是一次 Provider 请求，时长和数量由 C11.6/Provider budget 现有规则决定。
- `MotionBeat` 仍是同一片段内的私有动作节拍，不创建 Provider 请求；仅在源事实和现有 schema 能表达时使用。
- 全局上下文不是 MotionBeat；不能生成空的“风格节拍”或把同一整段视觉清单写进每个片段。

## 5. 最小迁移设计（后续编码按此执行）

### 5.1 输入保持原样，增加最小角色映射

1. 继续以冻结 `sourceText` 为源；`sourceTextHash`/既有 source manifest 保持不变。
2. 复用 `extractNarrativeSentences`、`extractVisualConstraints`、`stylePreferences`、显式 reference/lock 和已有 source labels；不新增通用词语评分器。
3. 已有结构化字段或来源标签先映射为“全局上下文”或“可执行视觉单位”。映射只改变内部归属，不改源文字。
4. 对未标注的自由文本，不引入“标题必为第一句”“风格必为某些关键词”等新猜测。若启用现有语义规划客户端，可让其在私有规划结果中给出源单位角色与连续覆盖；返回结果必须经过 source hash/顺序/完整覆盖校验。当前 raw schema 无法表达角色时，保持该路径 `BLOCKED`，不要悄悄把 global 重新算成 ACTION。

### 5.2 段数和时长不改所有权

1. `durationPolicy.min/max`、8–15 秒边界和 `ceil(target/max)` 的 Provider 最小段数继续由 C11.6/预算文档负责。
2. 30 秒在没有明确场景切换且能由现有段模型表达时，仍可默认两个约 15 秒片段；这不是“每段必须 15 秒”的新协议。
3. 全局句不得单独促成额外 Provider 调用。增加段数只能来自已有显式场景/时间边界、已认证能力或可审计的既有语义规划结果；不能因事件数量或提示词字节数编造新阈值。
4. 一个源动作如果无法在现有 8–15 秒段内完整表达，沿 Huobao 的源边界移动或使用已有失败门；不得按字符截断、慢放、补静音、重复动作或把同一动作复制到两个段。

### 5.3 按连续源边界分配

1. 先从可执行视觉单位中形成有序 beat，再按明确的场景/因果/时间边界组成连续段；全局上下文不参与分配。
2. 保留现有 segment sequence、`narrativeBeatSequences`、dialogue ownership、reference policy 和依赖顺序；同一源单位只能有一个 owner。
3. 当存在显式 `【镜头N】`、timestamp 或 OpenMontage section window 时，优先一一映射并禁止跨边界合并。
4. 当没有任何可审计边界时，不能把现有 `distributeEvents` 的比例结果称为“智能分段”。确定性路径只可保留来源顺序并在既有容量门内失败；真实语义分组必须走已有语义规划端且通过完整 coverage 校验。
5. 不要求或硬编码“4+5”这类样本分组。具体边界由源中明确的 scene/section/causal boundary 或可验证 planner 结果决定；测试验证顺序、覆盖、无重复和全局不占 beat，而不是固化某一组数。

### 5.4 每段 Prompt 只注入本段内容

1. `narrativeGoal`、`motionPlan` 和段内 source projection 只能包含该段拥有的可执行视觉单位。
2. `stylePreferences`、已声明的全局氛围/声音/字幕政策按现有编译器作为共享上下文复用；不能把全局上下文扩写成新的长 prose。
3. 台词仍由现有 dialogue extraction/owner 负责，按原段落和顺序保留；不能因视觉分段把后段台词带入前段。
4. 引用图片只沿现有 `referenceMap`/输入顺序绑定；本专项不改变对象锁、角色解析或 relay。
5. Prompt compiler、4096 compactor 和 provider profile 不改规则。若单段在原文完整保留后仍超限，沿既有 `PROMPT_BUDGET` fail-closed，不在本专项偷偷截断或另写压缩器。

## 6. 多源冲突和现有文档对账

| 现有依据 | 继续有效的内容 | 本文只补什么 | 明确不覆盖 |
| --- | --- | --- | --- |
| `AI企业内容平台_C11.6真实镜头分段与运镜稳定性开发设计.md` / ADR-0041、ADR-0050 | MotionBeat 与 Provider segment 分离；15 秒以内尽量一个请求；段数受 Provider 与叙事边界控制；2–4 个子镜头只在可表达时使用 | 全局句不再作为 executable event；分组必须先识别源节拍 | 不改时长策略、MotionPlan schema、运镜 preset 或 Provider 次数 |
| `AI企业内容生产平台_Provider预算联动与语义分段最小修复开发文档.md` | 预算重试、连续/有序/不重复 source window 和既有失败码 | 把“全局上下文”排除在 source window 之外；未证明时 fail-closed | 不新增 budget retry、评分、阈值或公开字段 |
| `AI企业内容生产平台_原仓库提示词生成最小融合优化开发文档.md` | source-first、台词/视觉事实保序、每段只写自己的内容 | 将全局 setting/atmosphere 作为共享上下文而非 beat | 不改 prompt compiler 的五层形状、字幕抑制、引用映射 |
| `AI企业内容生产平台_原仓库原则驱动的4096UTF8保真保护性压缩开发文档.md` | under-ceiling 原样；over-ceiling 只按已证明事实或 fail-closed | 无 | 不改 compactor、sidecar、4096 错误分类 |
| `AI企业内容生产平台_领域模型与API事件契约.md`、正式总控 | 公开字段、状态、任务、快照和依赖方向 | 仅规划内部映射和测试证据 | 不改契约、数据库、事件、状态、身份、计费或部署 |
| C12.4/C12.5 历史窄片与 E12/R01 | 既有音频 owner、字幕、BGM、样音和审核边界 | 仅在无音频输入时验证视觉分段不污染这些字段 | 不宣称 NarrationAsset/TimelinePlan/AudioPlan 或人工质量闭合 |

历史文档原文不删除；若某一旧测试/文字把“所有句子都是事件”或“比例分配即语义分段”写成当前事实，应在实现审计记录中标为历史/被本文 superseded，并保留原证据。

## 7. 允许的写入边界与顺序

本轮已按以下边界实施；这些边界仍是唯一允许的写入范围，纠察者只读审计，不修改被审文件。

1. `packages/domain/src/narrative-events.ts`：仅复用/收口已有 `ACTION/STATE/EXPOSITION/CONTROL` 和显式源结构；不得扩展成词表评分器或公开类型。
2. `packages/creative-planning/src/index.ts`：仅调整 source-unit→global context/visual beat 的内部映射、连续 coverage 和现有 PromptPackage 输入；移除对白剥离的无来源固定长度上限；不改公共 DTO、Provider profile、compactor 或持久化 schema。
3. 需要改变语义 planner raw shape 时，先单独写 ADR/内部契约说明并停止依赖它的实现；未获批准前必须保持 `BLOCKED`，不得把新字段当成既有来源能力。
4. `packages/creative-planning/tests/*`、`apps/workflow-worker/tests/*`：只添加与上述映射、coverage、顺序和不重复有关的定向行为测试。
5. 不触碰 `packages/provider-video/src/runtime-profile.ts`、`packages/contracts`、persistence migration、Studio UI、VPS、真实 Provider/TTS、计费、网络和 Git。

### 7.1 本次发布审计范围

为避免把工作区其它历史改动带入本专项，本次可发布切片只包含以下文件及其对应测试：

- `packages/domain/src/narrative-events.ts`
- `packages/domain/tests/narrative-events.test.ts`
- `packages/creative-planning/src/index.ts`
- `packages/creative-planning/tests/deterministic-planner.test.ts`
- `packages/creative-planning/tests/semantic-planner.test.ts`
- 本文与 `AI企业内容生产平台_章节审计记录.md` 中针对本切片的对账文字。

task-worker、计费、C13、基础设施和未跟踪文件不属于本切片。中文输入标签兼容分支也不作为“原仓库已移植”能力计入接受条件。

## 8. 验证矩阵

### 8.1 来源和计划层

| ID | 夹具/检查 | 通过条件 |
| --- | --- | --- |
| SGM-01 | “商品测试1”原文，30 秒、无旁白 | 段数仍由现有 Provider policy 得到 2；标题/风格/声音政策不出现在 `narrativeBeatSequences`；九项视觉源单位按原顺序、恰好一次分配。 |
| SGM-02 | 相同 brief 的 `stylePreferences` 已显式填写、sourceText 只保留视觉动作 | 共享 style 只进入现有约束；不得生成“风格节拍”；视觉事件不重复。 |
| SGM-03 | Huobao `【镜头1】`/`【镜头2】` 顺序夹具 | 标签顺序不变；每个显式镜头不跨段合并；在源能表达时每段 2–4 个连续子镜头。 |
| SGM-04 | Seedance global setting + timestamp script 夹具 | global setting 只作共享上下文；phase 按源顺序；不把后续动作提前或重复，不添加每两秒的新场景。 |
| SGM-05 | OpenMontage script sections/scene windows 夹具 | `script_section_id`、start/end 和 scene ownership 连续；无 gap/overlap；本专项不伪造完整音频时间轴。 |
| SGM-06 | 没有标签、无法证明 global/beat 角色的自由文本 | 不静默删除或重排；现有表示不足时返回既有 fail-closed 错误，不能假绿。 |
| SGM-07 | 30 秒仅一个不可再分视觉源单位 | 保持 source 完整；不重复到第二段；无法表达时阻断，而不是复制/字符切割。 |

### 8.2 Prompt 和跨层

| ID | 夹具/检查 | 通过条件 |
| --- | --- | --- |
| SGM-08 | 每个生成片段编译提示词 | 只含本段 source projection/动作和本段台词；共享全局约束按现有字段注入一次；不含完整其它段落。 |
| SGM-09 | 多行中文、中文标点、ASCII 引号、`@anchor` | 源文本内容、语义行/段顺序和引用锚点保留；CRLF 只做既有 LF 归一化；对白 provider-facing 字段保留行边界，不因分段改变 dialogue extraction 或 reference 顺序。 |
| SGM-10 | source coverage/hash/sequence | 所有可执行 source units 恰好一个 owner；全局上下文不伪装成 beat；段序连续、无空 leading window。 |
| SGM-11 | 现有 15 秒、30 秒和 >30 秒 duration fixtures | C11.6/预算计数与时长断言原样通过；不因风格句数量增加 Provider 请求。 |
| SGM-12 | prompt budget regression | under-ceiling byte-for-byte；over-ceiling 继续沿现有 compactor/fail-closed；本专项不截断、压缩或重排文本。 |

### 8.3 必须运行的命令（实现阶段）

```text
pnpm --filter @alchemy-video/domain test
pnpm --filter @alchemy-video/creative-planning test
pnpm --filter @alchemy-video/workflow-worker test
pnpm --filter @alchemy-video/provider-video test
pnpm typecheck
git diff --check
```

只有新增/修改文件对应的行为测试、来源复核和独立审计都绑定到同一版本后，才能把本专项从 `IMPLEMENTED` 提交 `READY_FOR_AUDIT`。本专项不接受静态 `rg` 命中、旧日志或一次真实成片替代行为证据。

## 9. “商品测试1”期望结果（说明性，不是硬编码分组）

在没有显式场景标签时，只有在已有输入字段、来源标签或通过校验的语义规划结果证明了角色归属，合规结果才应满足以下条件；无法证明时必须按第 4.2 节 fail-closed，不能把本节的样本期望当作自动猜测规则：

1. 仍由 30 秒与 Provider 上限得到现有数量（通常为两个约 15 秒段），而不是因为九个动作或三条风格句新增调用。
2. 如果角色证据成立，“轻奢/真实摄影/珍珠白/避免 CG/无旁白/无字幕/纯音乐”作为共享 global context，不占用动作 beat。
3. 如果角色证据成立，精华液、肌肤、吸收舒缓、城市、实验室、瓶身、人物使用、水润肌肤、Hero Shot 九个源动作保持顺序且只出现一次；具体在哪个边界切分由源明确边界或已验证 planner 决定，测试不固化 4+5 等偶然分组。
4. 如果现有 MotionPlan/8–15 秒约束无法无损承载源表达，应在 Provider 提交前明确阻断，而不是让第一段空、第二段堆、或把动作重复进两段。

上述结果只说明“源到分段”的结构正确，不代表 Provider 画面一定忠实、转场一定无缝或人工质量已通过。

## 10. 审计清单与 Exit Gate

独立审计必须逐项回答：

- 是否逐一指向 Huobao/Seedance/OpenMontage 的固定文件、符号或规则？
- 是否仍保持 C11.6 的 Provider duration/segment ownership？
- 是否把 global context 从 executable beats 排除且没有丢源事实？
- 是否有新增词表、评分、阈值、比例、静默回退、复制或截断？若有，立即拒收。
- 是否证明每个 source unit 的顺序、唯一 owner、coverage/hash 和每段 prompt 局部性？
- 是否误触公开契约、状态、事件、persistence、compactor、音频或部署边界？
- 测试是否覆盖正常、无边界、不可表达、重复、跨段和重启/回放所涉及的现有路径？

Exit Gate：

1. 代码差异只在第 7 节边界内；
2. 既有 domain/creative/workflow/provider 回归与新增 SGM 行为测试绑定同一版本通过，明确 skip/外部未测边界；
3. 来源登记、正式总控和章节审计只补证据，不伪造章节状态；
4. 未完成项继续保持 `DEFERRED/BLOCKED`，尤其是完整 NarrationAsset/TimelinePlan/AudioPlan、复杂转场、真实 Provider 产物和人工听感；
5. 独立审计结论为“符合”后，才可提交 `READY_FOR_AUDIT` 候选；本文件本身不触发 `ACCEPTED`、Git、VPS 或真实调用。

## 11. 本轮明确不做

- 不改 `chooseGenerationSegmentCount` 的 Provider 上限、30 秒默认 2 段规则或既有预算重试；
- 不新增按字符数、字节数、事件数量、关键词分数或“第一段/第二段平衡度”的算法；
- 不把所有自由文本交给一个没有 coverage 证明的 LLM 后直接信任；
- 不新增公共 `global_context`/`source_role`/`scene_window` 字段；如私有 planner 形状确需变化，先 ADR 和契约回流；
- 不实现单一旁白跨 section 偏移、复杂 AudioPlan、自动变速/补静音/重新切片、任意 xfade、字幕/BGM/口型算法；
- 不调用真实 Provider/TTS、网络、Veyra、VPS、SSH、DNS、TLS、部署或 Git。

## 12. 文档对账记录

本轮实施对账（2026-09-16）：已复核现有 C11.6、Provider budget、原仓库提示词、4096 compactor、领域/API 契约、正式总控和多源迁移矩阵，并仅修改第 7 节允许的五个文件：`packages/domain/src/narrative-events.ts`、`packages/domain/tests/narrative-events.test.ts`、`packages/creative-planning/src/index.ts`、`packages/creative-planning/tests/deterministic-planner.test.ts`、`packages/creative-planning/tests/semantic-planner.test.ts`。实现复用 Huobao `description/atmosphere` 与顺序规则、Seedance `Global/Throughout/look/locks/timestamp phases` 形状、OpenMontage section 边界语义；对白-only 和未标注 exposition 的 fallback 是既有兼容路径，未新增公开字段、状态、持久化、Provider、音频/BGM/字幕、4096 compactor 或部署逻辑。本轮另移除了既有规划器对负向约束的统一重排，使全局约束继续按源出现顺序进入现有约束通道；这属于删除非来源排序，不是新增分配算法，并移除了对白剥离正则中无来源的固定 1600 字上限。

定向行为证据（初次复验基线，已由后续复验覆盖）曾为：domain `69/69`、creative-planning `92/92`、workflow-worker `38/38`、provider-video `70/70`。独立审计后的最新窄片复验为 domain `70/70`、creative-planning `95/95`，均 `0 skipped`；本地 PostgreSQL persistence integration `4/4`、persistence 全量 `91/91`，根回归最新 `718 pass / 20 skip / 0 fail`（20 个 skip 为既有环境门控）。新增夹具覆盖 CRLF 的既有 LF 归一化、Huobao `atmosphere`、Seedance `Global/Throughout`、timestamp phases、`@anchor` 保序、超长引号后的视觉尾部保留，以及全局约束不占 beats。全仓 `pnpm typecheck` 与 `git diff --check` 通过。独立纠察已允许本窄片 `ACCEPTED`；OpenMontage `script_section_id/start/end` 完整 ownership、raw semantic planner 的 global role、逐字段 byte-level source 保真等仍按本文件和正式总控标记为 `DEFERRED/BLOCKED/证据不足`，不可宣称已闭合。

正式总控与 `.codex-longrun/state.json` 未在本轮修改；总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`、`E12/R01=BLOCKED` 等现行状态保持原值。本专项窄片已通过独立审计，可按用户授权发布；这不授予其它章节或真实 Provider/TTS/Veyra/网络/VPS 能力的验收资格。

补充证据对账（2026-09-16）：为关闭此前仅有静态路径的证据缺口，在项目自带本地 PostgreSQL（`127.0.0.1:15432/video_local`）上运行既有 `production-repository.integration.test.ts`，结果 `4/4` 通过；同一数据库配置下 persistence 全量 `91/91` 通过，未跳过。该运行验证了已有 `PromptPackage.capabilitySnapshot` sidecar 经数据库读取、调度和 `ProductionTaskRunInputFactory` 的行为传递，未修改 persistence/schema/公开契约。根回归此前基线为 `712 pass / 20 skip / 0 fail`，最新复核为 `718 pass / 20 skip / 0 fail`；20 个 skip 仍是既有 DB/MinIO/BullMQ 环境门控，不能当作无条件集成证据。该补充只完善审计证据，不改变总体 `IMPLEMENTED_PENDING_AUDIT` 或任何 DEFERRED/BLOCKED 边界。

最终窄片验收（2026-09-16）：独立纠察复核确认本轮代码仅把已有来源中可证明的全局上下文与可执行视觉单位分开，保持源顺序、唯一归属和既有 Provider 段数策略；未新增密度评分、事件阈值、分段协议、公开字段或跨模块状态。故本文件所述“语义分段/全局约束映射”窄片标记为 `ACCEPTED`，仅限列明文件与测试；完整 OpenMontage section ownership、无标签文本的 global 角色、逐字段 byte-level 保真、NarrationAsset/TimelinePlan/AudioPlan、复杂转场、真实 Provider 和人工质量仍为 `DEFERRED/BLOCKED/OUT_OF_SCOPE`。
