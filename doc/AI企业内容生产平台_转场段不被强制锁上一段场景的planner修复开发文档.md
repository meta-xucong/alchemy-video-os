# AI 企业内容生产平台：转场段不被强制锁上一段场景的 planner 修复开发文档

> 本窄片只修复「分镜设计了转场到新场景的生成段，却被 planner 强制沿用上一段场景」的规划缺陷。
> 不修改公共字段、状态机、任务流程、Provider 协议、API、QC、媒体处理或 UI 语义。

## 1. 背景与问题定性

### 1.1 现象

项目「保险AI介绍」的生产运行中，seg#2 的分镜明确设计为「镜头从手机屏幕急速拉远甩镜，墨绿驾驶舱界面在深色空间展开」——即从 seg#1 的居家卧室**转场到全新的数字驾驶舱场景**。但实际生成的视频画面延续了 seg#1 的卧室场景，未发生转场。

### 1.2 根因（已定位到代码）

`packages/creative-planning/src/index.ts:844` 的 `shotReferencePolicy`：

```typescript
const shotReferencePolicy = (input: PlanningInput, sequence: number): ReferencePolicy => {
  if (input.sourceAssetIds.length > 0 && sequence === 1) return "REFERENCE_SET";
  if (input.sourceAssetIds.length > 0 && sequence > 1) return "HANDOFF_FIRST_FRAME";
  return "TEXT_TRANSITION";
};
```

只要项目有用户上传的参考图（`sourceAssetIds.length > 0`），第 2 段及以后**无差别**返回 `HANDOFF_FIRST_FRAME`，进而 `createMotionPlan`（同文件 599-600 行）把 `scene_lock` 写死为「沿用上一段验收交接帧中的场景、空间和光线关系」。该判断**完全不读取分镜的转场叙事意图**。

`hasExplicitSceneChange`（同文件 877 行）这个能识别「场景切换」的正则，只被用于决定是否拆段（`shouldSplitShortNarrative`），**没有被用于决定 referencePolicy**——这是设计断裂。

### 1.3 规则违反确认

该 `shotReferencePolicy` 是自 commit `834c66b`（本地 MVP 基线）一次性写入的**自造逻辑**，不来自任何上游仓库：

- `huobao-drama` 的 `firstFrameUrl/lastFrameUrl`（`backend/src/services/generation.ts:211-224`）只是用户在前端显式选填的双帧传参，planner 不自动锁定场景；其 storyboard-breaker 只拆段，不强制交接帧。
- `Seedance-2.5` 有「continue vs new scene」路由（见 §2），正是处理该场景的既有机制，但未被移植。
- `OpenMontage` 有显式 transition 字段（见 §2），同样未被移植。

因此本修复属于「删除/替换自造逻辑，回归上游既有机制」，符合 AGENTS.md 的底层复用规则。

## 2. 固定来源与复用映射

| 来源 | 固定版本 | 复用的文件/符号/规则 | 本地薄适配 |
| --- | --- | --- | --- |
| `Seedance-2.5` | 见 THIRD_PARTY_NOTES.md 当前固定 commit | `skill/seedance-25/references/long-video.md` 第 5-10 行路由表：「Continue the same accepted footage → Native extension」/「Start a genuinely new scene → Intentional cut or a new generation from canonical references」；第 69-89 行转场段提示词公式（transition type + source ending + transition mechanism + destination opening + framing change + continuity locks）；第 91-93 行 continuity locks 只携带身份/服装/道具/方向等身份级锁 | 让 planner 在「延续段」与「转场段」之间路由；转场段不绑定上一段交接帧、不锁场景画面，只保留身份级 continuity lock |
| `huobao-drama` | 见 THIRD_PARTY_NOTES.md 当前固定 commit | `backend/workspace/skills/storyboard-breaker/SKILL.md` 第 28-32 行段落类型（过渡段含「转场」）；第 14 行「子镜头之间不跨场景（scene_id 是段落级绑定）」；第 52、58-61 行「scene_id 可明确匹配则回填，否则允许新场景」 | 以「段落 scene_id 是否与上一段相同」+「段落是否为过渡/转场类型」作为「该段是延续还是转场」的判定输入 |
| `OpenMontage` | 见 THIRD_PARTY_NOTES.md 当前固定 commit | `schemas/artifacts/edit_decisions.schema.json` 第 47-58 行每个 cut 的显式 `transition_in`/`transition_out`+`reason`；`lib/shot_prompt_builder.py` 第 157-159 行「transition 类型场景不生成视频提示词」 | 转场段的提示词不再携带「沿用上一段场景」的场景锁 |

## 3. 核心原则（来自上游，逐条可溯源）

### 3.1 路由原则（Seedance-2.5 long-video.md §Choose the route）

每个非首段在生成前先路由：

- **延续段**（与上一段同场景、连续动作）→ 沿用既有 `HANDOFF_FIRST_FRAME`，锁上一段交接帧与场景。
- **转场段**（分镜明确切换到新场景）→ **不**使用上一段交接帧作为场景锁；改用「转场段提示词」，从项目 canonical 参考图重新锚定人物身份，场景由本段叙事目标决定。

### 3.2 转场段只保留身份级锁（Seedance-2.5 long-video.md §Continuity locks）

转场段的 continuity lock 只携带：人物身份、发型、服装、道具归属、身体方向、运动向量、光线方向、氛围、未完成对白、确切的上一段结束点。**不锁场景画面本身**（地点/空间布局允许改变）。

### 3.3 转场判定原则（huobao-drama storyboard-breaker §拆分流程/§场景关联规则）

「该段是否转场」由分镜事实决定，不由 planner 猜测：

1. 若该段的 `scene_id` 与上一段不同 → 转场。
2. 若该段的叙事文本含显式转场信号（`转场至/镜头切换/画面切至/场景切换/地点切换`，以及 Seedance long-video 已列出的 extreme push/pull 物理转场配合目的地开场，例如「镜头…拉远甩镜…界面/场景/空间…展开」）且其叙事目标描述了新的地点/空间 → 转场。
3. 否则 → 延续。

### 3.4 转场表达原则（OpenMontage edit_decisions + shot_prompt_builder）

转场段在结构化 motion plan 中以 `transition_in`/`transition_out` 标记其转场性质（沿用现有 `transition_in`/`transition_out` 字段的表达位），供下游合成期消费；转场段不生成「沿用上一段场景」的场景锁文本。

## 4. 改动边界（允许改 / 不允许改）

### 4.1 允许改

仅限 `packages/creative-planning/src/index.ts` 及其定向测试：

1. `shotReferencePolicy`：增加「转场段」分支。转场段返回允许新场景的策略（不强制 HANDOFF_FIRST_FRAME）。
2. `createMotionPlan` 的 `scene_lock`：延续段保持「沿用上一段验收交接帧中的场景」；转场段改为「切到本段声明的新场景，仅保持人物身份/服装/道具连续」。
3. 转场段的 visual_input/参考图组装：转场段不强制把上一段交接帧作为 HANDOFF 锚定场景；人物身份仍由 canonical 参考图（SUBJECT/STYLE 角色）锚定。

### 4.2 不允许改

- 不改公共字段名、`GenerationSegmentMotionPlanSchema` 的既有字段含义、`ProductionSegment`/`Shot` 的持久化结构。
- 不改 `TaskRun`/`ProviderAttempt`/QC/media-runtime 的任何逻辑。
- 不改 `REFERENCE_SET`（首段）与 `TEXT_TRANSITION`（无参考图）的既有行为。
- 不新增公开 API、UI 语义、Provider 调用、环境变量。
- 不引入新的评分、阈值或回退算法——转场判定只复用现有显式信号、分镜 scene_id 事实，以及上游 extreme push/pull + destination opening 的窄文字映射。
- 无法由上游来源支持的行为，保持原实现或 fail-closed，不另造。

## 5. 实现规则

1. **先源后实现**：转场判定必须能从分镜的 `scene_id` 字段或现有 `hasExplicitSceneChange` 正则指向具体来源事实；没有来源信号时默认延续段（保持现状，fail-closed 到既有行为）。
2. **延续段行为零变化**：延续段的 `HANDOFF_FIRST_FRAME`、`scene_lock` 文案、参考图组装必须与当前实现完全一致。
3. **转场段最小差异**：转场段只改「不锁场景画面 + 不强制交接帧为场景锚」，人物/服装/道具的身份级锁与参考图绑定保持不变。
4. **scene_lock 文案分流**：延续段用原文案；转场段用「转场到新场景」文案。文案差异必须对应 referencePolicy 差异，不能出现「文案说转场但 policy 仍锁场景」或反之。
5. **可测试**：每个分支（首段/延续段/转场段/无参考图）都有定向测试覆盖 referencePolicy 与 scene_lock 的实际输出。

## 6. 定向验收

- **转场段**：分镜 scene_id 与上一段不同（或文本含显式转场信号且叙事目标为新地点）时，referencePolicy 不为 HANDOFF_FIRST_FRAME，scene_lock 不含「沿用上一段场景」。
- **延续段**：scene_id 与上一段相同、无转场信号时，referencePolicy 仍为 HANDOFF_FIRST_FRAME，scene_lock 与现状一致。
- **首段**：仍为 REFERENCE_SET，行为不变。
- **无参考图**：仍为 TEXT_TRANSITION，行为不变。
- **回归**：creative-planning 全部既有定向测试通过；新增转场段测试通过；typecheck 通过；不调用真实 Provider/TTS/网络。
- **真实数据验证**：用「保险AI介绍」项目重新生成 seg#2，确认其画面切到「墨绿驾驶舱」新场景而非延续卧室。

## 7. 变更登记

本窄片仅修改 `packages/creative-planning/src/index.ts` 及其定向测试与本开发文档。来源登记写入 `THIRD_PARTY_NOTES.md`（Seedance-2.5 路由、huobao 段落类型/scene_id、OpenMontage transition 字段）。无新的公开字段、协议、状态、Provider 调用或 UI 语义。所有改动均是对上述固定来源的薄适配；无法由来源支持的行为保持原实现或 fail-closed。

## 8. 风险与回滚

- **风险**：转场判定误判（把该延续的段当成转场）会导致画面断裂。缓解：默认 fail-closed 到延续段；只有分镜有明确转场信号才走转场分支。
- **回滚**：改动集中在单一文件单一函数簇，`git revert` 即可回到现状。
