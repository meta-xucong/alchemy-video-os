# AI 企业内容平台：原仓库分镜段落与 Provider 调用边界收敛开发文档

> 文档类型：正式开发方案（先审计，后实现）
> 当前状态：`PENDING / DESIGN_ONLY`（当前正式总控仅允许 G02；未获得章节授权前不得实施）
> 本轮风险轴：设计 `D0`；后续实现预计 `I2`；独立审计预计 `A1`
> 本文只规定分镜段落与 Provider 调用边界，不执行代码、真实 Provider、VPS、Git 或状态升级。

## 1. 目的与问题判定

最近一次 30 秒护肤品样本被规划为 `4+4+4+3+4+4+3+4` 八个 Provider 片段。虽然每段均返回了结果，但这把同一段落内部的子镜头误当成了八次 Provider 调用，造成片段过短、内容重复、交接帧增多和连续性审查无法收口。

该行为不是 Huobao 原仓库的分镜语义，也不是 OpenMontage 或 Seedance 定义的通用分段算法。问题在于当前平台让 LLM 直接返回任意数量的 `segments[]`，生产路径只校验总时长和局部字段，没有把来源的“一个分镜段落对应一个视频任务、段内可切子镜头”作为共享硬门。

本方案的目标是：

1. 将“Provider 段”恢复为原仓库的分镜段落边界。
2. 将 `【镜头N】` 子镜头保留在同一个 Provider prompt 内，不把每个 3 秒提示行提升为独立任务。
3. 复用已存在的 Provider profile 能力事实，支持明确允许短于 8 秒的 profile；不为默认/未知 Provider 猜测能力。
4. 删除当前生产路径中没有来源依据的等时切分、自由段数、用连续性阶段掩盖非法规划等行为。

## 2. 不变的底层规则

本方案受 `AGENTS.md`、领域/API 契约和正式总控文档约束：

- 先固定来源，再实现；每一条新行为必须指向来源文件、符号、字段或已授权的最小适配。
- 不新增平行算法、关键词评分、固定等分、额外阈值、静默回退、自动改写、自动补长或 Provider 协议。
- 来源没有安全对应实现时，保持 `UNAVAILABLE`、`DEFERRED` 或 fail-closed。
- 本文不新增公开 API 字段、数据库字段、事件、计费、音频、字幕、BGM、UI 或部署能力。
- 任何旧文档、历史测试或偶然成功的产物均不能覆盖固定来源和现行契约。

## 3. 固定来源与可移植语义

来源基线必须在实现前复核，以下映射是本方案唯一允许的创作分段依据。

| 来源与固定版本 | 文件/符号 | 必须保留的语义 | 平台薄壳适配 |
|---|---|---|---|
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md`，分镜段落定义与四步拆分流程 | 一个分镜段落 = 一个视频生成任务；默认每段 8–15 秒；段内 2–4 个子镜头，**每个子镜头 2–6 秒**；先识别叙事 beat；beat/场景/因果边界优先；不能机械等分；对白容量 `duration >= chars / 4.5 + 2s` | 仅把来源规则映射到现有私有规划输入和 Provider task 建立前的共享校验，不复制 Huobao 的数据库或 Agent 状态 |
| 同上 | `backend/src/agents/index.ts` 的 `storyboard_breaker` 指令 | 段落按 beat 组织，`description` 携带对应画面和旁白，段落 `duration` 为 8–15 秒 | 生产与认证共用同一套边界校验，不能只在认证脚本中限制 |
| 同上 | `backend/workspace/skills/prompt-generator/video-prompt/SKILL.md` | `description` 是视频 prompt 的唯一内容来源；`【镜头N】` 在段内映射为连续 3 秒提示行；顺序保留；3 秒行是段内提示，不是独立 Provider 调用；不跨场景、不新增台词 | 只负责 segment 内 prompt 编译和引用绑定，不提升内部时间行成为新的 Provider segment |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/pipelines/explainer/script-director.md:86-102`、`skills/pipelines/explainer/scene-director.md:39-50`、`schemas/artifacts/script.schema.json:34-44`、`backlot/state.py:_find_script_section` | script section 的 `id/text/start_seconds/end_seconds` 与 scene 的 `id/start_seconds/end_seconds/script_section_id` 有明确 owner；时间窗不由字符串顺序猜测 | 只在已有 Timeline/approved consumer 能力存在时使用；本轮不伪造新的 section/window 字段 |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/grok_video.py:107-110` 的 `GrokVideo.input_schema.duration` | 已知 Grok 工具输入是整数 `1..15` 秒；这只是一个能力事实，不是所有 Provider 或所有 Sub2API profile 的通用规则 | 只在当前 capability snapshot 明确声明并通过校验时使用该范围；不按 Provider/model 名称猜测，能力缺失或未认证时 fail-closed |
| `Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/prompting.md`、`skill/seedance-25/references/references.md` | 引用顺序、全局锁、每维 owner 和 prompt 组织；不提供通用 Provider 段数算法 | 仅保留引用顺序与全局锁，不能从 Seedance 规则推导新的分段阈值 |

来源没有“固定 30 秒必须两段”“固定 30 秒最多三段”“固定 12 秒种子”“任意 Provider 通用 8 秒下限例外”这些算法。Huobao 的拆分流程仍提供“目标总时长约除以 12 秒、允许 ±20%”的**非机械参考锚点**；实现不得把它写成 `ceil(target / 12)` 的硬公式。若某个目标恰好为 30 秒，且同时满足默认每段 8–15 秒和总时长精确相等，那么可行整数段数自然落在 2–3 段；这只是边界的数学结果，不能实现为独立的段数上限、认证门或 Provider 策略。唯一的平台短时长兼容规则是用户明确要求的“总时长小于 8 秒时保持一个精确 Provider 段”。

## 4. 统一规划规则

### 4.1 Provider 段与子镜头的边界

1. 一个 Huobao 分镜段落对应一个 Provider generation task。
2. 一个段落内部允许 2–4 个 `【镜头N】` 子镜头；在默认 Huobao 语义下每个子镜头 2–6 秒。子镜头可以换景别、角度或主体，但不能跨场景。
3. `prompt-generator/video-prompt` 中的 `0-3秒`、`3-6秒` 等时间行只描述同一 Provider 段内部的切镜节奏，不能拆成多个 Provider task。
4. 段落的 `description`、台词、场景、角色、道具和引用必须在该段内闭合；不得把整段故事复制到每个子段。

如果自然语言视觉 prompt 没有显式写出 `【镜头N】` 或时间行，平台不反向猜测子镜头数量，也不凭关键词补造镜头；只有输入明确表达了这些来源标记时，才执行对应的 2–4 个子镜头和 2–6 秒范围校验。这样保持 freeform source 的原意，并符合来源缺少事实时不自造逻辑的规则。

### 4.2 默认 8–15 秒边界

在没有已认证 Provider profile 能力事实时，沿用 Huobao 默认：每个 Provider 段 `8 <= duration <= 15`。段落类型可依据来源规则选择过渡 `8–10`、叙事 `10–15`、爆点 `12–15`，但不能把这些区间变成与内容无关的固定模板。

段内承载对白或旁白时，必须通过来源容量门：

```text
duration >= segment_dialogue_characters / 4.5 + 2
```

装不下的整行台词应移动到下一个合法 beat。Huobao 只要求 3 秒念不完时拆成连续提示段；若平台需要在单一过长 source unit 内细分，沿用既有平台“句读/分隔标点”安全边界，并明确标记为 PLATFORM_ADAPTED，不得把该边界宣称为 Huobao 原仓库规则。不得用慢放、补静音、裁切、循环或重写来伪造容量通过。

### 4.3 短时长例外（仅限用户明确授权的兼容规则）

用户明确要求总时长小于 8 秒时，不再因为 Huobao 默认下限直接拒绝：目标 `1–7` 秒保持一个 Provider 段，时长精确等于目标值；不得补长、拆分或填充静音。该规则是本平台唯一的短时长薄壳适配，不是某个 Provider 的能力推断，也不能放宽真实 Provider 自身已声明的请求边界。

它不放宽默认 2–4 子镜头及每个 2–6 秒的来源语义；若短目标无法表达所需的多个子镜头或对白容量，则保留一个 Provider 段但对该内容 fail-closed，不用拆分、补长或伪造子镜头通过。

### 4.4 目标超过 15 秒

目标超过单段上限时，规划器只能依据 source beat、场景边界、因果链和对白容量形成多个合法段。LLM 可以提出段落边界及段内视觉描述，但不能自由决定一个脱离来源边界的任意 `segments[]` 数量。

- 先识别 beat，再分配完整作者段落；同一 beat 内的子镜头留在同一 Provider 段。
- 不把来源的“约 `target / 12`、±20%”写成 `ceil(target / 12)` 硬公式；也不使用字符等分、每句一个 Provider 调用或固定 `3/4` 秒切片。该来源锚点只能辅助判断整体节奏，不能覆盖 beat、场景和容量边界。
- 对 30 秒目标，不存在独立的“最多三段”策略；如果最终计划使用默认 `8..15` 段落边界，2–3 段只是满足总时长的数学结果。最终分段仍由 beat、场景、因果链和容量决定，不在代码中写死 `15+15` 或任何段数上限。
- 任意原始规划若产生 `4+4+4+3+4+4+3+4` 这类越过来源下限的计划，必须在 Provider submit 前拒绝并返回现有可识别的规划错误；不能交给 handoff/QC 阶段再失败，也不能自动把错误计划拼成“看似完整”的成片。
- 如果无法同时满足目标时长、合法段边界、场景连续性和对白容量，则 fail-closed，并保留可诊断原因。

## 5. 当前错误实现的替换边界

以下是实现时必须审计和收敛的现有路径，不是新增公开契约：

| 现有位置 | 当前风险 | 目标行为 |
|---|---|---|
| `apps/workflow-worker/src/semantic-director-contract-surface.ts` | 只要求“设计 executable segments”，没有来源段落/子镜头边界 | 将 Huobao 的段落、beat、场景和容量规则放入语义导演的来源约束；不得加入自造评分或固定段数 |
| `apps/workflow-worker/src/semantic-director-canonicalizer.ts` | 直接接受任意数量的 raw `segments[]`，未统一校验 8–15、子镜头归属和容量 | 在保留现有 DTO 的前提下，增加来源等价的共享校验；非法计划在 canonicalize 阶段 fail-closed |
| `apps/workflow-worker/src/semantic-execution-service.ts` | 直接把每个 raw segment 投影为 Provider shot/task | 只有通过共享来源校验的“分镜段落”才能投影；段内时间行只进入该段 prompt |
| `apps/workflow-worker/src/semantic-director-certifier.ts` | 历史认证路径曾把 30 秒 `2–3` 写成显式检查 | 认证与生产均只复用来源段落/能力边界；段数不再作为独立认证门 |
| `packages/creative-planning/src/index.ts` | 既有规划接缝可能被重新引入机械等分 | 保持已有 profile-derived policy；不以本方案新增第二套 planner 或时长公式 |
| `packages/provider-video/src/prompt-compiler.ts` | 可能把 segment 内 `3 秒`提示行误当成独立调用输入 | 只编译一个段落对应的 prompt，保留子镜头顺序、引用和台词，不创建额外 task |

本轮不改 `packages/contracts` 公共 DTO、数据库迁移、音频/字幕/BGM、计费、Provider adapter、UI、VPS 或 Git。若实现确实需要改变公开契约，必须先停下并新增 ADR，不得在本方案下隐式扩展。

## 6. 实施步骤与来源回顾门

每一步完成后必须回答“它移植了哪个固定来源语义”，并记录在来源登记/章节审计中：

1. 复核固定 commit、文件、符号和现行契约；确认没有同义旧实现可直接复用。
2. 以 Huobao storyboard paragraph/description 为 segment source unit，整理现有 semantic director 的边界适配。
3. 将来源校验做成认证与生产共用的内部函数；不复制两套近似规则。
4. 接入已存在的 profile-derived `1..15` 短时长事实；Mock/未知保持默认 Huobao policy。
5. 在 execution service 和 prompt compiler 处确认段内子镜头不升级为 Provider task。
6. 删除或停用没有来源依据的等时切分、固定 12 秒、每句一段、全故事重复注入和连续性阶段兜底。
7. 运行定向行为测试、类型检查和差异检查；任何失败保持 fail-closed，不以修改测试期望制造绿灯。

## 7. 验收测试清单

所有测试均应先使用本地 fixture/mock，不调用真实 Provider、网络、Veyra、VPS 或 Git。

### 7.1 短时长与 profile

- 已配置且允许该目标时长的 profile：`1/6/7/8/12/15` 秒各只生成一个段，时长精确相等，不补长、不拆分；该行为来自用户明确的短时长兼容规则，不从某个 Provider 的 profile 名称推断额外能力。
- Provider 自身若拒绝目标时长、身份/能力未认证或请求字段无法表达，仍按既有能力门 fail-closed；不能把短时长兼容误写成 Provider 认证结果。
- capability 明确允许的 `1/6/7` 秒样本若需要 2–4 个子镜头而无法满足每个 2–6 秒，或对白容量门不成立，必须验证为 fail-closed；只有可表达的单一视觉单元/合法 source unit 才允许精确单段。

### 7.2 来源段落边界

- `16/17/30` 秒在默认 Huobao policy 下只接受合法 `8..15` 段；对 30 秒样本，若出现 4 个以上 Provider 段，应因这些段无法同时满足 8 秒下限而失败，而不是命中一个独立的“最多三段”门。
- beat/场景/因果边界优先；同一段内 2–4 个 `【镜头N】` 保持在一个 Provider prompt。
- 子镜头内 `0-3/3-6/...` 时间行顺序保留，不产生额外 Provider task。
- 台词按原行顺序归属；不把下一段首句塞入前一段；容量不足直接报告，不慢放、不补静音、不改词。

### 7.3 非法计划与跨层一致性

- `4+4+4+3+4+4+3+4` 等非法 raw plan 在 Provider submit 前失败。
- 认证与生产路径调用同一校验，不能出现认证拒绝而生产接受，或反之。
- segment prompt 不包含其他段完整故事；不重复注入所有台词/参考图/场景。
- 重启、重复提交、幂等、Provider 状态和下载行为沿用既有测试，不在本轮新增旁路状态机。

### 7.4 必须记录的证据

测试记录要写明命令、通过/失败/跳过、fixture/mock 与未覆盖真实边界。静态 `rg`、类型检查或单次真实成片不能替代行为测试。

## 8. Exit Gate 与状态

本开发文档完成只代表设计门通过，当前状态保持 `PENDING / DESIGN_ONLY`。由于正式总控当前只允许 G02，本方案不能自行进入实现；只有总控明确授权对应章节后，才可按下列 Exit Gate 进入 `IN_PROGRESS`：

1. 固定来源映射和冲突审计通过；
2. 生产/认证共享校验的定向测试通过；
3. creative-planning、workflow-worker、provider-video 类型检查通过；
4. `git diff --check` 通过且无公共契约、状态、事件或模块边界漂移；
5. 章节审计记录、来源登记和测试账本同步；
6. 未调用真实 Provider/网络/VPS/Git，且没有密钥或媒体进入差异。

实现完成后只能提交 `READY_FOR_AUDIT`，不能由执行员直接写 `ACCEPTED`。真实 Provider、连续性/Handoff、人工质量和正式产物仍是独立外部门，不因本方案绿测而自动通过。

## 9. 与历史文档的关系

本文件只统一本次“Provider 段与段内子镜头边界、短时长 profile 例外、非法 8 段计划拦截”范围：

- 《AI企业内容平台_原仓库结构化分段与旁白时间窗完整迁移开发文档.md》：保留其来源证据；本文件对 Provider 段边界和短时长适配的表述优先，尚未完成的 NarrationAsset/TimelinePlan/AudioPlan 仍不视为完成。
- 《AI企业内容生产平台_短时长单段Provider规划最小优化开发文档.md》：保留其历史短时长样例，但其中 `30 -> 15+15` 不是固定来源算法；本文件将其改为“按 beat/场景/容量决定，且只接受来源段落边界”，不再写入独立的 2–3 段或最大段数策略，并补充段内子镜头不得升级为 Provider task；未获总控授权前不修改旧文档状态。
- 《AI企业内容生产平台_原仓库导演式语义分段与全局上下文移植开发文档.md》及 LLM 分段类文档：其历史 LLM envelope、机械 planner 或与本文件冲突的段数表述只作历史参考；本文件不继承没有来源依据的固定段数/结构化字段。
- 《AI企业内容生产平台_源仓库创作逻辑收敛与平台薄壳边界开发文档.md》及总控/契约文档：继续作为更高优先级边界，不因本文件而被覆盖。

任何旧文档都不得被静默删除或改写；若后续实现改变状态，必须由正式总控和章节审计记录同步对账。

## 10. 反自造逻辑检查表

- [ ] 每个新增校验都能指向固定来源文件/符号或用户明确的短时长例外。
- [ ] 默认段落保留每个子镜头 2–6 秒；短时长 profile 例外不被误写成任意 Provider 的通用分镜能力。
- [ ] 没有固定 `ceil(target/12)`、字符等分、每句一段或 3 秒独立 Provider 调用。
- [ ] 没有把 Mock/未知 profile 当成 Grok，也没有静默补长、慢放、补静音、裁切或改写。
- [ ] `【镜头N】` 仍是单段内 source mapping，引用和台词顺序未重排。
- [ ] 生产、认证、内存、数据库、Runtime 和测试夹具使用同一语义。
- [ ] 来源缺失时是 `UNAVAILABLE/DEFERRED/BLOCKED` 或既有错误，不是自造成功路径。
- [ ] 未新增公共字段、数据库迁移、事件、Provider 协议、UI 或部署逻辑。
- [ ] 章节状态、测试计数和来源登记没有把计划写成完成事实。

## 11. 2026-09-29 边界纠偏记录

- 已移除生产/认证路径中曾存在的“目标 30 秒时段数必须不超过 3”显式门；固定来源没有该段数协议。30 秒在默认 8–15 秒且总时长精确相等时自然只能落在 2–3 段，是数学结果，不是平台策略。
- 保留唯一获授权的短时长兼容：目标小于 8 秒时保持一个精确 Provider 段；实现同时检查所选 capability 的 `min_duration_seconds/max_duration_seconds`，不按 Provider 名称猜测能力。
- 生产与认证仍共享 Huobao 段落边界校验；`Mock/unknown` 不会继承未声明的能力，能力门不满足时 fail-closed。
- 定向证据：`semantic-director-canonicalizer.test.ts` 与 `semantic-director-certifier.test.ts` 共 28/28；workflow-worker 全套 102/102；workflow-worker typecheck 通过；`git diff --check` 通过。均为本地 fixture/mock，未调用真实 Provider、VPS 或 Git。
- 本文代码范围已落地，当前文档状态为 `IMPLEMENTED_PENDING_AUDIT`；本条记录不改变正式总控、章节状态或真实 Provider 验收结论。
