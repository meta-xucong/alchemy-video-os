# AI 企业内容生产平台：LLM 语义 Prompt 规划与结构化校验重构开发文档

> **历史方案（`SUPERSEDED_BY_LLM_FREEFORM_PROMPT`）**：自《AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md》发布后，本文件中“LLM 必须返回完整 `draft/sourceCoverage/motionPlan/camera` raw shape”的创作输出方案不再作为当前实现授权。source-first、口播逐字保留、参考顺序、UTF-8 budget、sidecar、fail-closed、状态/幂等和外部调用边界仍有效；当前实现和验收以新文档为准。

> `HISTORICAL_SUPERSEDED（2026-09-17）`：本文的 source ownership、source span 校验和结构化分段流程均为历史方案；当前自然语言 visual prompt 流程以《AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md》为准。本文只保留历史方案、计数和证据。

> 文档状态：`HISTORICAL_SUPERSEDED`（原 D1/D2 内部离线 seam 的实现和证据保留作历史；当前 LLM 创作输出以《AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md》为准，D3/D4/D5 仍不得被视为通过）
>
> 本文同时记录本轮已落地的 `packages/creative-planning` 内部实现和审计证据；不代表生产 Workflow、Provider、VPS、计费或正式阶段状态已修改。未闭合硬门不得进入 `READY_FOR_AUDIT` 或 `ACCEPTED`。
>
> 适用基线：仓库 `24984302a18599544d887b0eb7b414a91f38c5a4`。工作区既有未提交改动属于基线，不在本方案中覆盖、回滚或冒充本轮成果。

## 1. 用户目标与问题判定

用户要求：不要继续用 `splitIntoChunks`、固定事件索引、均匀时间窗等机械规则强行决定每段内容；应让 LLM 先理解原始叙事、台词、场景和参考图职责，再为每一个实际 Provider 片段重构一个只承担本段语义的 Prompt。结构化数据仍然保留，但只用于传输、审计和校验，不能代替导演式语义规划。

当前失败样本证明了现有路线的错位：

- 最近失败任务的 `duration=6`，prompt 为 2358 UTF-8 bytes，低于 4096；Provider 返回的实际错误为 `generate task timeout.`，因此不是字节上限拒绝。
- 同一任务的结构化 `motion_timeline` 已被压到 `0–6s`，但四个 `source_description` 仍分别包含 `0–9s`、`9–21s`、`21–28s`、`28–30s` 的全局动作计划。
- 失败任务含 5 张 `REFERENCE_SET` 图片；同一项目历史上已有多次 6 秒、5 张参考图成功记录，因此“5 张图必然不支持”没有证据。
- `packages/provider-video/src/sub2api/mapper.ts` 将 `prompt` 与 `reference_images` 分字段提交；失败样本的 prompt 未发现图片 URL 或 Markdown 语法，未证明存在图片 URL 混入 prompt。

根因分类：

1. **直接外部原因**：上游生成任务超时，当前状态映射把 `failed` 统一显示为 `PROVIDER_REJECTED`。
2. **本地设计缺口**：结构化时间轴按段长重算，但原始叙事 Prompt 没有按同一语义窗口重构，导致 6 秒段仍携带 30 秒叙事负担。
3. **不是本轮结论**：不能仅凭一次超时断言参考图数量或某个具体 Prompt 词条必然造成失败。

## 2. 方案范围

### 2.1 本方案要做

1. 在现有 `PlanningModelPort` 边界内增加一个可选的 LLM 语义规划实现；LLM 负责识别叙事节拍、段落边界、动作因果、段落台词和每段的 Provider Prompt。
2. 保留 `StoryboardPlan`、`ShotSpec`、`MotionPlan`、`PromptPackage`、`capabilitySnapshot`、`motionPlanHash` 等现有结构，作为内部传输、追踪、重启恢复和审计事实。
3. 每个 Provider 片段只携带该片段覆盖的源段落/节拍和必要的连续性锁，不把完整 30 秒源叙事复制到每个 6 秒片段。
4. 在提交前以现有 Provider profile、UTF-8 budget、参考图顺序、音频/字幕策略和状态机规则做确定性校验；不通过就 fail-closed。
5. 让 Wokey、KIE/Grok 等 Provider 共用经验证的语义规划结果，Provider 适配器只做字段和能力映射，不重新发明分段逻辑。

### 2.2 本方案明确不做

- 不把 LLM 输出直接当作可提交的未经验证字符串。
- 不取消结构化计划、审计字段、sidecar 或 `motionPlan`；它们从“内容作者”降为“事实/约束/审计载体”。
- 不新增公开 HTTP 字段、数据库公共字段、事件类型、任务状态、计费规则或 Provider 协议。
- 不删除或静默缩减用户参考图；profile 明确不支持时拒绝，不猜测、不丢图。
- 不做字符切片、按字数硬拆、固定 7.5 秒、固定重试次数、自动降级 Provider 或静默 fallback。
- 不把参考视觉分析器直接冒充为叙事规划器；现有 `ReferenceVisionAnalyzerPort` 只负责图像用途/对象候选。
- 不在本阶段调用真实 Provider、AISelf、VPS、TTS、网络或计费。
- 不修改本地 Mock 默认配置；`VIDEO_PROVIDER=mock` 仍保持离线可测试。

## 3. 固定来源与可复用边界

| 来源 | 固定文件/规则 | 本方案复用 | 不能声称来源直接提供 |
|---|---|---|---|
| huobao-drama | `backend/workspace/skills/storyboard-breaker/SKILL.md:20-22,34-51` | 先识别叙事节拍和因果边界；同一节拍尽量留在一个段落；段内按动作/视角/对象拆子镜头；台词满足段落时长下限 | 当前代码的 `splitIntoChunks` 或通用 LLM API 不是 Huobao 原码 |
| huobao-drama | `backend/workspace/skills/prompt-generator/video-prompt/SKILL.md:22-39` | `description` 是唯一内容来源；按 `【镜头N】` 保序映射；台词只能来自源描述；首段建立空间；不跨场景 | 不得新增原文没有的对白、镜头或剧情 |
| Seedance-2.5 | `references/prompting.md:3-24,44-66` | 先确定意图、参考职责、可见动作、镜头、光线、声音和终点；简单片段不强行写时间戳；引用标签和输入顺序原样保持 | 固定仓库没有通用“LLM 自动拆段/压缩”服务 |
| Seedance-2.5 | `references/long-video.md:12-45` | 多阶段视频用少量可读阶段；每阶段有叙事职责、起点、终点、连续性；已完成动作不能在下一段重播 | 不把 Seedance 30 秒模板当成所有 Provider 的时长协议 |
| OpenMontage | `lib/shot_prompt_builder.py:82-160` | 只按已有字段生成五层短 Prompt：Camera、Movement、Subject、Lighting、Style；空字段不补造内容 | OpenMontage 没有 LLM 规划器或 4096 压缩算法 |
| OpenMontage | `skills/creative/video-gen-prompting.md:39-64,260-310` | 五类提示骨架、参考角色、动作时间顺序、一个主运镜、可观察终点、声音/字幕/BGM 显式 | 不把其经验性建议变成新的全局评分、阈值或 Provider 协议 |

结论：固定来源支持“语义识别、节拍组织、短 Prompt 编译”的方法边界，但没有可直接复制的通用 LLM 自动重构实现。LLM 规划器属于平台新增薄壳，必须单独标记来源边界、内部契约和行为证据，不能宣称“原仓库完整移植”。

## 4. 现有实现应保留和替换的边界

### 4.1 保留

- `PlanningModelPort` 作为规划入口；`DeterministicPlanningModel` 保留给本地 Mock、离线夹具和无 LLM 环境。
- `StoryboardPlanDraft`、`PlannedShotSpec`、`GenerationSegmentMotionPlan` 和 `CompiledPromptPackage` 的现有领域边界。
- `motionPlanHash`、`capabilitySnapshot.source_prompt/generated_prompt_parts` 和 Workflow → Persistence → ProductionTaskRunInput → runtime 的 sidecar 传递。
- Provider profile 对 duration、resolution、ratio、reference mode、audio owner、字幕/BGM 语义的已有校验。
- `runtime-profile` 的 under-ceiling 原样通过、超限 fail-closed 和既有 `PROMPT_BUDGET` 错误分类。
- 参考图输入顺序和角色映射；Wokey 的多图能力不能因 KIE/Grok 的不确定性被静默削弱。

### 4.2 由 LLM 取代的内容决策

- 不再由事件数组索引单独决定“哪几个事件属于第 N 段”。
- 不再由均匀时间窗把一个跨 30 秒的源动作硬投影到 6 秒段。
- 不再用正则分数替代对场景转折、因果链、动作终点和台词段落的理解。
- 不再把整段 source narrative 作为每个片段的 `narrativeGoal`，再由下游猜测该段应该执行哪一部分。

LLM 只负责上述语义选择；格式、边界、状态、引用和安全性仍由确定性层校验。

## 5. 目标流程

### 5.1 输入冻结

规划器接收现有 `PlanningInput` 能表达的事实：

- 原始 narrative/description 和其段落、`【镜头N】` 或现有 beat 顺序；
- 原始 dialogue lines 及其段落边界；
- target duration 与已解析 Provider duration policy；
- 场景、角色、道具、参考图 roles/anchors 和上一段 accepted end state；
- style/fact/document context 的已授权片段；
- Provider 的 reference/audio/subtitle/BGM 能力快照和当前 prompt byte budget。

原文作为不可信内容数据传入，不能把原文中的“忽略规则”“调用工具”“泄露密钥”等文本当成规划指令。

### 5.2 LLM 语义规划

LLM 在内部规划调用中先完成：

1. 识别作者显式节拍、场景边界、动作切换、视角切换、对象切换和台词段落；
2. 按因果链和段落语义形成 provider segment windows；
3. 为每个 window 生成只描述该 window 的 `narrativeGoal`/Prompt source；
4. 给出该 window 的起始状态、结束状态、动作终点、声音/字幕/BGM意图和所需参考 roles；
5. 标记未能安全归属的源文本、无法满足时长的台词或无法表达的跨场景内容。

LLM 输出使用现有领域类型转换为 `StoryboardPlanDraft`/`PromptPackage`；source coverage 只作为内部校验事实，不新增公开 API。若现有类型无法表达“源片段对应关系”，先提交 `DESIGN_QUESTION`，不得把 JSON 任意塞入现有字段。

### 5.3 确定性校验与编译

LLM 输出进入现有 compiler 前，必须依次通过：

1. **Coverage**：每个原始段落/beat/dialogue line 恰好被一个 segment 覆盖；连续性锁可复制，但已完成动作和完整剧情不能复制。
2. **Order**：源顺序、台词顺序、参考图输入顺序、handoff 顺序不变。
3. **Scene**：不跨越来源没有声明的场景；显式转场必须同时有上一段终点和下一段起点。
4. **Duration**：每段在 profile 允许范围；台词不能放入无法完成的窗口；6 秒片段不得携带未拆解的 0–30 秒动作计划。
5. **Prompt shape**：沿用现有 PromptPackage 和 OpenMontage 五层短骨架；只保留该段真正需要的 subject/action/scene/spatial/camera、声音和关键锁。
6. **Budget**：以最终 UTF-8 prompt 和 sidecar 复核 Provider budget；不截断、不全局折叠空白、不删除无法证明为派生的 source。
7. **Reference**：role→image 仍按输入顺序；不因 profile 不确定而静默删除参考图。
8. **Safety/contract**：schema、hash、任务状态、幂等、错误码和 workspace 权限不变。

任何一项失败都返回明确的内部规划/预算/不支持错误，保持 Provider 未提交、计费未发生、原始输入可重试；不得用“看起来合理”的字符串继续提交。

### 5.4 Provider 适配

规划器只产出已经验证的 segment semantic draft。现有 Provider adapter 继续负责：

- `model/prompt/duration/resolution/ratio` 映射；
- `REFERENCE_SET`/`FIRST_FRAME`/`TEXT` 字段映射；
- profile 能力校验和 URL/MIME/数量边界；
- submit/status/download、request ID 恢复和错误归一化。

KIE/Grok 与 Wokey 的差异只在 profile/adapter 能力事实中表达；不能让某一 Provider 的失败反向改变全局语义规划，也不能把一个 profile 的参考图数量经验硬编码成全局限制。

## 6. LLM 规划内部边界

### 6.1 最小内部结果

不新建公开 DTO。实现时优先让 LLM 结果映射到现有 `StoryboardPlanDraft`；内部临时结果至少要能证明：

- segment 顺序和目标时长；
- 被覆盖的现有 source beat/paragraph/dialogue identity；
- segment-local narrative goal/prompt source；
- start/end state、transition summary；
- 使用的 reference roles/anchors；
- 未覆盖或不可表达的 source 单元。

不得只返回一串无法追溯到源文本的 prose。若缺少 source identity，必须阻断而不是猜测映射。

### 6.2 LLM 失败与降级

- `LLM planner` 未配置、超时、返回非法 JSON、schema 不匹配、覆盖不完整或生成超预算：真实 Provider 模式保持 `UNAVAILABLE`/`BLOCKED`，不静默走另一套未知规划逻辑。
- 本地 `VIDEO_PROVIDER=mock` 继续使用现有 `DeterministicPlanningModel`，以保证离线测试确定性；这不是生产模式的自动 fallback。
- 用户显式重新提交时，重新创建新的规划版本和任务幂等范围；已获得 Provider request ID 的任务不重新 submit。
- 不在本方案中增加固定重试次数、温度、评分阈值或新 Provider fallback；这些必须有独立来源或后续授权。

## 7. 4096 与语义重构的关系

4096 是当前 Aiself/Sub2API profile 的实测/路由约束，不是三个固定上游统一公布的限制。它应当成为 LLM 规划的输入约束，而不是事后对已生成 Prompt 做破坏性剪裁。

正确顺序：

1. LLM 以当前 segment 目标时长、source coverage 和 profile budget 生成 segment-local Prompt；
2. 现有 compiler 只补必要的来源支持字段和平台 sidecar；
3. `runtime-profile` 做最终 UTF-8 检查；
4. 仍超过 budget 时，该 segment 进入语义重规划/阻断路径，但不得用字符切片或复制全文解决；
5. 若无法在已有 source boundary 上安全拆分，明确 `PROMPT_BUDGET`/规划阻断，不提交 Provider。

本方案不授权改动 `runtime-profile` 的 source-first 保真规则，也不把 compactor 变成第二个 LLM 编译器。

## 8. 与现有方案的冲突处理

《AI企业内容生产平台_Provider预算联动与语义分段最小修复开发文档.md》和《AI企业内容生产平台_4096超限后一次语义重规划开发文档.md》中的确定性 `distributeEvents`/递增段数方案只能作为历史实现与本地 Mock 兼容依据，不能继续作为生产语义导演。它们关于以下内容继续有效：

- Provider budget 必须 fail-closed；
- 不按字符静默截断；
- 源顺序、台词、参考图顺序和 sidecar 必须保真；
- Provider 未提交前不扣费；
- 现有状态、幂等和重启恢复语义不变。

它们关于“仅增加段数即可解决语义窗口”“把结构化 motion beat 当作完整 Prompt 导演”的部分在本设计落地后应标为 superseded；在代码未实施、审计未通过前不得修改正式状态账本或宣称替代已完成。

## 9. 实施分阶段与唯一写入边界

本轮已获代码实施授权，但仍按最小写入边界执行：D1/D2 允许写入 `packages/creative-planning/src/index.ts`、其离线 fixture，以及仅用于证明既有内部 sidecar 传递的 `apps/workflow-worker/tests/execution-service.test.ts` 测试夹具；不得修改 Workflow 生产装配、persistence 实现/schema、Provider、前端、部署或公共 HTTP/数据库契约。

当前执行结果：

1. **D1 内部规划端口：`IMPLEMENTED_PENDING_AUDIT`**。`LlmSemanticPlanningModel` 仍实现现有 `PlanningModelPort`，但模型只返回严格私有 raw `{draft,sourceCoverage}`；`creative-planning` 的 canonicalizer 从冻结 `PlanningInput` 和 raw coverage 派生 source text/asset identity、dialogue、bindings、版本、计数、continuity/camera mode 与 motion hash，再交给既有 strict validator。模型不得返回或自报这些 machine facts，缺失/未知字段即 fail-closed。
2. **D2 离线 fixture：`IMPLEMENTED_PENDING_AUDIT`**。`packages/creative-planning/tests/semantic-planner.test.ts` 只使用 Deterministic fixture 作为被校验的 LLM 返回值，覆盖 source 顺序/哈希、中文多行台词、参考 anchor、motion/camera、超时、预算和不回退；`apps/workflow-worker/tests/execution-service.test.ts` 追加的测试把同一 fixture 经 executor、JSON sidecar 和既有 production snapshot factory 走通，并验证超预算时只保留调用方 sidecar 的原序完整块，未改变生产装配。
3. **D3 compiler/runtime/Workflow 集成：`BLOCKED`**。虽已保留受显式环境开关控制的 OpenAI-compatible client 薄壳，生产运行仍不能因 client 存在而宣称可用；raw canonicalizer 未通过完整生产接入审计前，不得静默回退或调用真实 Provider。
4. **D4 失败/幂等跨层验证：`BLOCKED`**。新增测试只覆盖 executor→JSON sidecar→production snapshot factory 的局部路径，仍不证明 DB/scheduler/runtime 的完整 LLM sidecar、错误映射、重启和计费副作用。
5. **D5 独立审计：`BLOCKED`**。本轮独立审计指出 D3/D4 及来源身份、参考映射和跨段连续性证据不足；未满足真实 Provider 验收门。

允许修改的文件、实现者和测试范围必须在每一阶段重新冻结；不能一次性改动 workflow、persistence、provider、frontend 和部署。

## 10. 验收矩阵

| ID | 验收条件 | 证据 |
|---|---|---|
| LLM-01 | 6 秒目标 + 0–30 秒源叙事时，输出按语义窗口分配，任何 6 秒 Prompt 不含未归属的全局 30 秒动作 | 本地 fixture 的 source coverage 和最终 Prompt 对照 |
| LLM-02 | 原文段落、台词和 `【镜头N】` 顺序完整，无遗漏、重复或新增对白 | 逐项 identity/byte/顺序断言 |
| LLM-03 | 场景/人物/道具/参考图 role 不被模型臆造，role→image 保持输入顺序 | PromptPackage + mapper fixture |
| LLM-04 | 每段有起点、终点、动作终点和必要连续性；下一段不重播已完成动作 | segment plan fixture |
| LLM-05 | 最终 UTF-8 prompt 在 profile budget 内；超限不截断、不压缩未知 source、不提交 Provider | runtime-profile/worker fixture |
| LLM-06 | LLM 缺失、非法 JSON、覆盖不完整、schema 错误和超时均 fail-closed | 失败路径单测 |
| LLM-07 | Mock 无网络且仍可确定性生成；真实模式不静默 fallback 到 Deterministic planner | mode separation test |
| LLM-08 | Workflow → PromptPackage → DB → ProductionTaskRunInput → runtime 保留 segment-local source 和 sidecar | 跨层行为测试 |
| LLM-09 | 已取得 Provider request ID 后重启/重试只 GET，不重复 submit；未提交或预算失败不扣费 | Worker/计费边界测试 |
| LLM-10 | Wokey 多图能力不被 KIE/Grok 的 profile 经验全局削弱；不支持时显式阻断 | profile capability fixtures |
| LLM-11 | Provider 错误仍按现有错误类型/状态机映射；timeout 不被无依据地伪装成成功 | adapter/status tests |
| LLM-12 | 文档、来源登记、阶段状态和测试计数只在最终版本绑定后同步；不把设计文档当完成事实 | 审计账本核对 |

## 11. 独立审计清单

审计者必须独立检查：

1. 是否真的使用 LLM 进行语义规划，而不是把更多正则、分数、固定切片塞进旧 planner；
2. LLM 结果是否可以追溯到原始 source identity，是否存在静默遗漏、复制、改写或新增；
3. 结构化类型是否只作为事实/校验/传输，是否有未授权的公共 API/schema/状态/事件变化；
4. `sourcePrompt` 是否变成 segment-local，是否仍把整段 30 秒文本注入每个短片段；
5. 参考图是否仍分字段映射、顺序不变，是否出现为某 Provider 静默删图；
6. LLM 不可用、输出非法、预算超限和 Provider timeout 是否安全阻断且无计费/submit 副作用；
7. 是否新增了固定温度、评分、尝试次数、阈值、fallback 或协议而没有来源；
8. 本地 Mock、真实 profile 和跨层持久化是否执行同一 source semantics；
9. 测试是否对最终固定版本运行，是否把历史 49/49、55/55 等旧证据冒充新版本；
10. 未完成的真实 Provider、人工听感、端到端视觉质量和 LLM 供应商稳定性必须保留为未验证项。

## 12. 当前结论

本设计方向比继续扩展确定性切片更符合用户目标：LLM 做语义理解和每段 Prompt 重构，结构化层做约束和审计。当前已在 `creative-planning` 内实现可注入、可离线验证的 D1/D2 seam，能够拒绝缺少 source identity、覆盖不完整、重复/伪造 beat、错误引用顺序、无效 motion/camera、超时和超预算结果；它不能保证上游永不超时，也不能声称固定原仓库已经提供该完整 LLM 实现。

当前总体状态为 `IMPLEMENTED_PENDING_AUDIT / BLOCKED`：D1/D2 仅为内部 raw seam 与离线 fixture；`SemanticPlanningResult`、`StoryboardPlanDraft` 及 source hash/asset 顺序字段继续保持原包内形状，raw source manifest 和 canonicalizer 不是 HTTP/DB/event 公共契约。D3 生产 Workflow 接入、D4 跨层行为证据、D5 真实 Provider/E2E/人工质量验收均未闭合。在这些硬门闭合前，不得提交、推送、部署或调用真实 Provider。

## 13. 历史基线（raw canonicalizer 之前；已由 §16 supersede）

- 主控来源/范围复核：`符合`。固定来源仍只支持分镜语义、保序、短 Prompt 骨架；本文没有把新 planner 冒充为上游原码，也没有改动 `runtime-profile`、contracts、HTTP、DB、事件或 Provider。
- 执行差异：`packages/creative-planning/src/index.ts:166-635`、`packages/creative-planning/tests/semantic-planner.test.ts` 与 `apps/workflow-worker/tests/execution-service.test.ts` 的测试夹具；新增 sourceTextHash/sourceAssetIds 仅作为包内注入 seam 的输入绑定事实，当前未进入公开 API/数据库/事件。既有用户改动和其它模块未覆盖。
- 最新行为证据：`pnpm --filter @alchemy-video/creative-planning test` = `74/74 pass, 0 fail, 0 skip`；`pnpm --filter @alchemy-video/workflow-worker test` = `32/32 pass, 0 fail, 0 skip`；`pnpm --filter @alchemy-video/provider-video test` = `66/66 pass, 0 fail, 0 skip`；`pnpm --filter @alchemy-video/production-worker test` = `72/72 pass, 0 fail, 0 skip`；相关 typecheck 通过；`git diff --check` 通过。全部为本地 fixture/mock，无网络、Provider、VPS 或计费副作用。creative fixture 证明重复且有序的源台词不会被 `Set` 静默合并，超 160 字带引号台词和超 120 字未引号台词均完整保留；无合法分隔点时由既有容量门显式阻断。Workflow 的 32/32 只证明注入式语义规划结果进入现有 executor/PromptPackage/生产快照工厂的局部行为，不等同 DB/scheduler 端到端证据。
- 独立审计：`BLOCKED（历史）`。当时审计者确认 source hash/asset 顺序与 fail-closed 校验有效，但指出 Workflow 仍固定 `new DeterministicPlanningModel()`（`apps/workflow-worker/src/index.ts:35-44`），没有真实 LLM 装配；这些结论已由 §15、§16 的后续变更覆盖，不能作为当前实现证据。
- 历史结论：`D1/D2 IMPLEMENTED_PENDING_AUDIT`，`D3/D4/D5 BLOCKED`；当前口径以 §16 及其后续审计记录为准，正式 E12/R01 与总体状态仍不得升级。

## 14. 2026-09-13 真实 LLM 视觉 smoke 证据（仅视觉分析，不升级状态）

- 使用仓库既有 `packages/reference-analysis/src/index.ts::OpenAiCompatibleReferenceVisionAnalyzer`，从 `.env.local` 的 `REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_API_KEY`、`REFERENCE_VISION_MODEL` 读取配置（仅记录环境变量名，不记录值），输入已有 fixture `.codex-longrun/compare-frames/latest-4_8.jpg`；一次真实请求结果脱敏为 `status=OK, role=SUBJECT, confidence=0.95, object_count=5, elapsed_ms=8236`。
- 本条是 ReferenceVisionAnalyzer 的视觉分析能力证据，不等于 `LlmSemanticPlanningModel` 或 Workflow planner 证据。未输出 key、完整 URL/query、响应正文或图片，未写持久化产物；本次真实网络外部边界仅为上述一次视觉分析请求，未调用 Provider/TTS/Veyra/VPS/Git。
- `apps/workflow-worker/src/index.ts` 仍为 `new DeterministicPlanningModel()`；D3 production planner、D4 DB/scheduler/runtime、D5 acceptance 继续 `BLOCKED`。`.codex-longrun/state.json`、`E12/R01` 和总体 `C12.4/C12.5` 状态不升级。

## 15. 2026-09-13 用户授权的 D3 最小接入（历史记录；raw 细化见 §16）

本节记录本轮用户明确授权的“复用已有 LLM 思考能力并接入生产规划入口”实现，不改变正式章节账本、公共 HTTP/数据库契约、事件或 Provider 协议。唯一写入范围为 Workflow Worker 的内部装配、适配器夹具、部署环境透传和本文件；既有 D1/D2 代码与其它用户改动属于基线，未回滚或覆盖。

### 15.1 来源和边界

- 规划语义仍由 `packages/creative-planning` 的 `PlanningModelPort` seam 负责；OpenAI-compatible client 只返回严格私有 raw `{draft,sourceCoverage}`。`creative-planning` canonicalizer 从冻结输入、source manifest 和 raw coverage 派生 `SemanticPlanningResult` 的 source hash、asset 顺序、dialogue、bindings、版本、计数、continuity/camera mode 与 motion hash，再继续走既有 Storyboard/PromptCompiler/schema/UTF-8 budget 校验；这些 machine facts 不由模型自报。
- 新增 `apps/workflow-worker/src/semantic-planning-client.ts` 只是 OpenAI-compatible `POST /chat/completions` 的内部薄壳，沿用现有 `OpenAiCompatibleReferenceVisionAnalyzer` 的 Bearer、`temperature:0`、`response_format:json_object`、AbortController 和 45 秒默认超时形状；它不复用视觉 analyzer 的图像协议，也不把视觉结果当作规划结果。
- `SEMANTIC_PLANNER_ENABLED=true` 是唯一启用条件。启用时优先读取 `SEMANTIC_PLANNER_BASE_URL/API_KEY/MODEL`，缺省可显式复用同一组 `REFERENCE_VISION_*` 环境变量；未启用或凭据不全时，真实 `sub2api` 模式返回 `LLM_PLANNER_UNAVAILABLE`，不静默回退到 Deterministic planner。`VIDEO_PROVIDER=mock` 仍固定使用原 Deterministic planner。
- Workflow Worker 通过 `createPlanningModelFromEnv` 选择 planner；Local 启动脚本和 VPS compose 只向该 Worker 做进程级/容器级透传，不把密钥写入仓库或其它服务日志。没有新增公开字段或持久化列，既有 capabilitySnapshot sidecar 仍按原链路传递。

### 15.2 本轮实现与测试状态

| 子项 | 状态 | 证据/范围 |
|---|---|---|
| D3.1 Workflow planner 装配 | `IMPLEMENTED_PENDING_AUDIT` | `apps/workflow-worker/src/index.ts` 使用 `createPlanningModelFromEnv`；Mock/real 分支显式分离 |
| D3.2 OpenAI-compatible 适配器 | `IMPLEMENTED_PENDING_AUDIT` | `apps/workflow-worker/src/semantic-planning-client.ts`；非 2xx、非法 JSON、空 choices、URL 安全、超时均 fail-closed |
| D3.3 离线边界测试 | `IMPLEMENTED_PENDING_AUDIT` | `apps/workflow-worker/tests/semantic-planning-client.test.ts`；仅 fake `fetch`，无真实网络/密钥 |
| D3.4 Local/VPS 环境透传 | `IMPLEMENTED_PENDING_AUDIT` | `infrastructure/local/start-full-local-stack.ps1`、`infrastructure/deploy/docker-compose.video.yml`、`.env.video.example`；默认仍关闭 |
| D4 DB→scheduler→runtime 行为证据 | `BLOCKED` | 尚缺真实数据库/调度/工厂一体化 fixture，既有数据库缺失时的 skip 不能替代 |
| D5 独立审计与真实视频质量 | `BLOCKED` | 需独立审计固定版本后再进行真实 LLM/Provider/E2E；本节不把一次 HTTP 200 smoke 当作规划成功 |

### 15.3 验收边界

本轮必须先通过 Workflow Worker、creative-planning 和 provider-video 的定向测试与 typecheck，再由独立审计复核来源、差异、密钥隔离和 Mock/real 分支。真实 LLM smoke 仅验证当前已授权 endpoint 能返回可解析 raw JSON；只有 raw canonicalizer 派生出完整 `SemanticPlanningResult` 并通过既有 source/coverage/schema 校验时，才允许进入真实 Provider 生成。若模型输出不完整，保持 `LLM_PLANNER_MALFORMED`/`UNAVAILABLE`，不补造 hash、coverage、动作、时长或参考关系。

正式状态仍以 `.codex-longrun/state.json`、正式总控和章节审计记录为准：E12/R01 继续 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`；本节的 `IMPLEMENTED_PENDING_AUDIT` 不是 ACCEPTED，也不授权跳过 D4/D5。

## 16. 2026-09-13 raw canonicalizer 适配（历史口径；由 LLM 自由创作方案 supersede）

本节覆盖前文“模型直接返回完整 `SemanticPlanningResult`”的历史描述，仅同步本轮允许文件内的最小实现，不改变 `PlanningModelPort.plan(input): Promise<StoryboardPlanDraft>`、`SemanticPlanningResult`、`StoryboardPlanDraft`、公开 HTTP/DB/event 契约、持久化或 Provider 协议。

- LLM raw 顶层必须 exact 为 `{draft,sourceCoverage}`。`draft` 只含 `title/summary/continuityNote/beats/shotSpecs`；shot 使用现有语义字段、现有 `motionPlan` schema（去掉 `version`）和 `cameraShot` shape。`dialogueLines`、绑定字段、`motionPlanHash`、`plannerVersion`、计数、continuity/camera mode、source hash/asset identity 均不在 raw 中。
- `sourceCoverage.segments` 只含 `segmentSequence/sourceBeatSequences/dialogueLineSequences`。creative-planning 复用现有 source parser、normalize、SHA-256、schema/invariant helpers，严格拒绝缺失、越界、重复、重排、未知字段、`shots`、snake_case、模型自报 hash/version/count、篡改台词或绑定；重复但不同 occurrence 的相同源文本按序号身份保留。
- canonicalizer 只派生 machine facts：source text/asset identity、dialogue 原序、bindings、版本、计数、continuity/camera mode 和 motion hash；不调用 `DeterministicPlanningModel.plan()` 补 shape，不复用其分段/时长/相机算法，不静默修补模型语义。固定 `DeterministicPlanningModel` 仍仅用于 Mock。
- OpenAI-compatible client 保持 `temperature:0`、`response_format:json_object`、AbortController、默认/可配置 `max_tokens=4096` 和 URL/HTTP fail-closed；system prompt 带 raw 字段骨架、枚举、source manifest（只读序号/hash）以及“不可完整输出就返回 `{}`”。请求另携带由同一既有 source parser 生成的私有 `sourceEvidence`（按序原文与台词，仅供模型复制；不进入 raw/持久化契约）。不做二次调用、自动重试或 fallback。

D1/D2 仍为 `IMPLEMENTED_PENDING_AUDIT`；D4 DB→scheduler→runtime 副作用证据、D5 独立验收与真实 Provider 仍为 `BLOCKED`。本轮测试只使用本地 fixture/mock，无真实 LLM、Provider、网络、Veyra、VPS 或 Git 操作。

## 17. 2026-09-13 真实语义规划 smoke 与最终审计边界

- 使用已配置的 OpenAI-compatible 视觉/LLM endpoint 做了受控真实规划 smoke；密钥、完整 URL、响应正文和输入资料均未写入日志或文档。为避免把一次成功的 HTTP 请求误当作规划通过，测试只记录脱敏的 raw 结构与校验结果。
- 结果：接口可达；临时将 `SEMANTIC_PLANNER_MAX_TOKENS` 先提高到 `8192`、再提高到 `16384`，并在请求中加入同一 parser 产出的 `sourceEvidence` 后，固定两句样本的三次受控调用中 `1` 次完整通过（返回 `2` 个 shot/`2` 个 beat），`1` 次上游不可用，`1` 次仍因 canonicalizer 判定 storyboard/source 事实不一致而阻断。没有提交真实视频 Provider，也没有计费副作用。
- 随后仅补充既有 `GenerationSegmentMotionPlanSchema` 的字段类型说明（字符串锁、对象锁和连续 motion beat），未改变 raw shape、校验器或 fallback。追加受控调用仍出现“完整通过”和 `LLM_SOURCE_COVERAGE_INVALID`/`LLM_PLANNER_MALFORMED` 两类结果，未形成稳定通过率；这证明 fail-closed 仍有效，但不能把当前 endpoint 当作可稳定生产的语义规划器。
- 该结果证明 fail-closed 边界工作，不证明当前供应商模型已稳定满足 raw contract；真实多段/长文案 planner 仍为 `BLOCKED`，不能通过增加重试、自动补字段或回退 Deterministic planner 来“变绿”。
- 以“保险AI介绍”历史多行口播+视觉意图样本做的追加受控调用返回 `LLM_PLANNER_UNAVAILABLE`；未因上游瞬时不可用而重复提交视频或放宽校验，故该真实样本仍未进入 Provider 生成。
- 独立静态审计确认：raw parser/canonicalizer、platform-derived facts、Mock/real 分支和测试范围符合本节设计；另保留一个部署安全边界：`apps/workflow-worker/src/semantic-planning-client.ts::endpointFor` 复用既有视觉适配器的 HTTP(S)+userinfo/query/hash 校验，但没有新增 host allowlist/私网 DNS 过滤。该 URL 必须由受信任部署管理员配置；若未来允许不受信任配置来源，须先补来源/安全 ADR，当前不自动扩展。
- 最新离线证据：creative-planning `76/76`、workflow-worker `36/36`、provider-video `66/66`、production-worker `72/72`，均 `0 skip`；相关 typecheck 和 `git diff --check` 通过。workflow/creative 夹具只验证 raw canonicalization 和 sidecar 局部链路，仍不等同 DB→scheduler→runtime 完整 D4。
- 正式账本不变：`.codex-longrun/state.json` 继续 `E12/R01 BLOCKED`、总体 `C12.4/C12.5 IMPLEMENTED_PENDING_AUDIT`；本节不授权 GitHub 推送、VPS 部署或真实视频 Provider 生成。

## 18. 2026-09-14 schema 提示纠偏复核（仍不升级状态）

- 仅修正 `apps/workflow-worker/src/semantic-planning-client.ts` 的已有 schema 文字：`character_locks`/`prop_locks` 明确为字符串数组，`scene_lock` 等明确为字符串；补充现有 validator 已要求的“一个 shot 对应一个 sourceCoverage segment”和合法 JSON 自检说明。未改变 raw shape、解析器、校验器、重试/fallback、公开契约或生产状态。
- `apps/workflow-worker` 定向测试 `36/36 pass, 0 skip`；随后使用当前配置的真实 OpenAI-compatible endpoint 做 3 次固定短样本 smoke，结果 `1 pass / 2 fail`，失败仍为 `LLM_SOURCE_COVERAGE_INVALID`（模型偶发 coverage/shot 不一致）。因此模型输出仍不具备稳定生产可用性；没有 Provider/TTS/Veyra/VPS/Git 或计费副作用。
- 结论：schema 提示矛盾已消除，但 D3/D5 仍 `BLOCKED`；D1/D2 仍 `IMPLEMENTED_PENDING_AUDIT`，D4 数据库跨层行为证据仍 `BLOCKED`。不得以本轮 1/3 smoke 或离线绿测推进 GitHub/VPS 发布。
