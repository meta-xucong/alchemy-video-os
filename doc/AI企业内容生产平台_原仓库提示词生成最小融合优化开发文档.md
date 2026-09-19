# AI 企业内容生产平台：原仓库提示词生成最小融合优化开发文档

> 历史范围说明：本文件保留提示词生成窄片的来源与边界。4096 UTF-8 的内部
> `sourcePrompt/generatedPromptParts` sidecar 已由后续《原仓库原则驱动的4096UTF8
> 保真保护性压缩开发文档》扩展贯通至 Workflow、持久化调度和 Production Worker；
> 与该后续文档冲突的“仅 provider-video 内部调用”表述以后一版为准。

## 1. 目的与范围

本窄片只修复“结构化计划被重复展开成长提示词”的生成阶段，不修改 4096 UTF-8 字节门控、Provider 协议、公共字段、状态机、任务流程或真实 Provider 配置。实现与测试范围限定为：

- `packages/creative-planning/src/index.ts` 及其提示词/计划定向测试；
- `packages/provider-video/src/prompt-compiler.ts` 及其提示词定向测试。

本次不截断、不改写用户原始口播，不新增压缩阈值、摘要模型、静默回退、公开 API 或 UI 语义；4096 UTF-8 的二阶段保护性压缩（先省略 sidecar 派生段，再按固定白名单处理可选源句）以后续《原仓库原则驱动的4096UTF8保真保护性压缩开发文档》为准。

## 2. 固定来源与复用映射

| 来源 | 固定版本 | 复用的文件/符号/规则 | 本地薄适配 |
| --- | --- | --- | --- |
| `huobao-drama` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md` 的 segment/子镜头/台词边界与“不得新增台词”；`backend/workspace/skills/prompt-generator/video-prompt/SKILL.md` 的按时间组织、动作与台词映射、引用锚定 | 现有 deterministic planner 保留源段顺序；只减少重复 prose，不改变 source dialogue/segment assignment |
| `Seedance-2.5` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/SKILL.md` 与 `skill/seedance-25/references/prompting.md` 的 `[subject/scene] + [visible action/endpoint] + Camera + Light + Sound + critical locks` 紧凑形状；`skill/seedance-25/references/references.md` 的 one owner per dimension、引用标签原样保留、详细规则放结构化控制 | 将现有派生合同收敛为每段必要事实；不改变已有 `referenceMap`/`motionPlan` |
| `OpenMontage` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/creative/video-gen-prompting.md` 的五类事实（主体/动作/场景/空间/摄影）与“短提示词给模型更多创作空间”；`skills/creative/prompting/grok-prompting.md` 的 Grok `[shot]+[camera]+[subject]+[main motion]+[environment]+[lighting]+[tone]`；`lib/shot_prompt_builder.py:build_shot_prompt` 的五层按存在字段拼接、不复用固定长前缀 | 逐 beat 只写 action/camera/end；全局锁和对象详细状态保留在现有结构化 metadata，文本只保留一次必要摘要 |

## 3. 不可变内容与可压缩内容

### 3.1 必须原样保留

1. 用户提供的 source prompt/visual description 的事实和顺序；本窄片不对其做截断或自动改写。
2. 分段 `dialogueLines`/`provider_text` 的完整字符、顺序和原有段落边界。native owner 的 `Character says: "..."` 只生成一次。
3. 已声明的 reference anchors/roles，不翻译、重编号或按上传顺序猜测。
4. 必要的段内主动作、主运镜、场景、开闭状态和音频 owner 语义。

### 3.2 只压缩表达，不丢失语义

- 语音、连续性、道具、摄影和禁止项的重复解释性句子；
- 同一事实同时出现在 beat、全局和 `motionInstruction` 的重复文本；
- 已完整保存在 `motionPlan`/`referenceMap`/snapshot 的逐对象状态与详细禁止项；
- 事实来源定位元数据在 prompt 中的重复展示（来源仍保留在结构化字段）。

## 4. 实现规则

1. 先保留 source-aligned narrative/dialogue，再追加最小的引用、声音和五类视觉事实。
2. `motionPlan` 继续完整 schema 校验、hash 和返回；不改变其结构或内容。
3. 文本时间线每个 beat 只输出一个 `action`、一个 `camera` 和一个 `end`，不再串入全部 `object_states`、逐 beat 详细 `prohibited_changes` 或重复对象描述；结构化 beat 仅保留全局锁和每对象一次实例锁，详细禁止项只保存在结构化对象锁中。
4. 全局只保留一次必要 continuity lock；来源明确的对象名称/交接关系可做一次短声明，详细规则只在结构化计划中保留。
5. native audio 必须包含完整 quoted script；platform narration 只保留平台 owner、可见口型/窗口与禁额外对白语义。
6. reference roles/anchors 用短 ownership 声明表达，并保持原始 anchor 字符串；`role → image` 映射严格保留传入顺序，角色描述可以独立去重，但不得重排图片位置。
7. 不在本模块新增 4096 检查或截断；生成后的字符串仍交给现有 runtime profile 处理，超限继续 fail-closed。

### 4.1 结构化契约边界

本窄片移除 planner 层对视觉约束、对象锁和禁止项的静默 `slice`；现有 `GenerationSegmentMotionPlanSchema` 的数组上限仍是可表达能力边界，超出时由既有 schema 校验拒绝并保持 fail-closed。`domain` 的 `extractKeyVisualObjectLocks` 自身已有最多 12 个对象的来源/契约边界，不将单个快照能力泛化为无限保真；超出结构化契约的输入必须标记为不可表达，不能丢弃尾部后继续生成。

## 5. 定向验收

- 保险 AI 三段样本：每段 `dialogueLines`/native `provider_text` 完整，段间无串线；
- native quoted script 完整且只出现一次，platform narration owner 语义不变；
- 多 beat 文本每 beat 只有一个 action/camera/end，重复禁止项/对象状态不进入 prompt，返回的 `motionPlan` 仍完整；
- reference role/anchor 保留原值；
- 编译 prompt 相比当前 12K–15K 样本显著缩短；不以任意截断换取长度，当前源内容或必要事实无法安全容纳时仍由既有门控阻断；
- creative-planning、provider-video 的定向测试与 typecheck 通过；不调用真实 Provider/TTS/网络。

## 6. 变更登记

本窄片仅修改上述两个生成模块及其测试和本开发文档。没有新的公开字段、协议、状态、Provider 调用或 UI 语义。所有文字缩减均是对固定来源的紧凑表达适配；无法由来源支持的行为保持原实现或 fail-closed。
