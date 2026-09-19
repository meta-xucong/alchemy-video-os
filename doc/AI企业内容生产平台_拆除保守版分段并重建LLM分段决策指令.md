# 指令：拆除保守版分段实现，按已批准设计重建 LLM 分段决策

> 状态：`IMPLEMENTED_PENDING_AUDIT`（2026-09-19 已按本指令重建并完成离线回归；真实 LLM→Provider/E2E 与独立审计仍待补）
> 收件：Codex
> 性质：**方向性纠正**，不是小幅修补。你上一轮实施的「保守版」必须从根源删除。

> 执行对账：`packages/creative-planning` 全包 `83/83`、`apps/workflow-worker` 全包 `37/37`，两包及工作区 typecheck 通过；全部为本地 fixture/mock，未调用真实 LLM、Provider、VPS、网络或 Git。当前不得写成 `ACCEPTED`。

---

## 1. 判定：保守版为什么是错的

你上一轮按《原仓库自然语言导演分段与口播保真开发文档》§4.2 的字面边界，实现了「`DeterministicPlanningModel` 机械决定片段数量/时长/台词归属，LLM 只返回顶层自然语言字符串数组补充视觉提示词」。

这个设计思路被用户明确否决，理由是**事实性的**：

1. **机械均分正是用户最初报告的「时间规划不合理」的根源**（无标签 source 里主题/风格占前段、视觉动作挤后段）。恢复 `distributeEvents`/`distributeDuration` 到真实路径 = 恢复原始问题。
2. **上位文档 §4.2 写的「如需让 LLM 决定分段，必须另立契约和审计任务」已经完成**。那份「另立契约」就是《AI企业内容生产平台_原仓库LLM分段决策移植与机械切分拆除设计文档》（用户批准），且已实施并通过真实端到端验证（run `prd_01M2REXQVMHGXQ5FBFW8GG7MPD`：3 段全 ACCEPTED / TECHNICAL PASS / SUCCEEDED，LLM 决策的 3×10s 时长精确落地，口播逐字保真）。你实施的是**过时状态**，却把已验收的新实现删掉了。
3. 你的总结**未声明删除了一个已验收成果**——这是流程层面的错误：任何覆盖已验收实现的行为必须显式声明并说明依据。

**结论：恢复 LLM 分段决策（下称「目标设计」），删除保守版的分段协议。**

---

## 2. 现状与可恢复性

- 目标设计的代码**无 git 提交、无 stash、无备份副本**，已被你的修改覆盖，**必须按 §4 的规格重建**。
- 重建依据全部在案：
  - 权威设计：`doc/AI企业内容生产平台_原仓库LLM分段决策移植与机械切分拆除设计文档.md`（§3 目标设计、§3.4 校验硬门、§3.7 选项A、§4 边界、§5 测试）
  - 上位文档：`doc/AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md`
  - 上游锚定（已核对一致）：huobao `f04d705`、Seedance `ebc68d3`、openmontage `4eab34c`
- 以下内容你已正确保留，**不要动**：
  - `dialogue_lines` 持久化链：`schema.ts` 的 `dialogue_lines jsonb` 列、迁移 `0025_add_shot_spec_dialogue_lines.sql`、`ControlStoryboardShotSpec.dialogueLines?`、`serializeShotSpec` 读取、InMemory/Drizzle 写入、`serializers.ts` 输出、`execution-service.ts` buildDraft 的 `dialogueLines` 投影
  - 系统提示中的**语言规则**（跟随源文本语言、禁英文层标签）与**注入防御句**（已登记 PLATFORM_OWNED）
  - 测试中对旧 envelope 字段的负向断言

---

## 3. 要拆除的保守版内容

以下是你上一轮引入/恢复的，本轮全部拆除（真实路径层面）：

1. `packages/creative-planning/src/index.ts`:
   - `LlmFreeformPromptPlanningModel.plan` 中 `await new DeterministicPlanningModel().plan(input)` 作为真实路径骨架——删除；
   - `readLlmVisualPrompts`（:250，顶层字符串数组校验）——删除，替换为 §4.3 的分段校验器；
   - 系统提示中「只返回一个顶层 JSON 字符串数组」「不能增删片段」「不要返回时长、台词归属、片段编号」等表述——替换为 §4.4 的分段契约。
2. **不要删除** `DeterministicPlanningModel` 类及其依赖函数（`distributeEvents`、`distributeDuration`、`distributeDialogueLines`、`splitLongDialogueClause`、`hasCinematicEditorialBoundary`、`hasExplicitSceneChange`、`narrativePlanningInput` 等）——**mock 模式仍依赖它们**，它们继续存在，只是真实路径不再调用。

---

## 4. 目标设计重建规格（完整，照此实现）

### 4.1 LLM 输出契约

单次 LLM 调用返回顶层 JSON 数组，每项是**仅含三键的对象**（exactKeys，不得多键少键）：

```json
[
  {"duration_seconds": 12, "visual_prompt": "…该段自然语言视觉导演…", "dialogue_line_sequences": [1]},
  {"duration_seconds": 8,  "visual_prompt": "…", "dialogue_line_sequences": []}
]
```

段落数量、每段时长、台词归属**全部由 LLM 决定**（huobao 模式）。

### 4.2 LLM 输入（context）

`LlmFreeformPlanningContext` 收敛为：`sourceText`（完整原文，**不截断**）、`targetDurationSeconds`、`durationBounds`（默认 min=8/max=15；已认证 Provider 的既有 `durationPolicy` 可明确提供其它边界，并由调用方原样传入）、`minimumSegments`（来自 `minimumGenerationSegmentCount`，若有）、`dialogueLines`（`extractDialogueLines(input.sourceText.trim())` 的编号列表）、`stylePreferences`、`sourceAssetIds`。本窄片不新增或推导 Provider 时长阈值。

### 4.3 校验硬门（全部 fail-closed；错误码沿用 `LLM_PLANNER_MALFORMED` / `LLM_PLANNER_UNAVAILABLE`；客户端异常/超时=UNAVAILABLE，响应不合规=MALFORMED；无降级、无重试猜测、无机械回退）

1. 响应是数组；每项是非数组对象且 exactKeys 三键；
2. `duration_seconds` 为安全整数且落在调用方传入的 `durationBounds` 内（默认 8≤d≤15；Provider-specific 边界只能来自既有 profile/durationPolicy）；
3. **Σ duration === targetDurationSeconds（完全相等）**；
4. 数组长度 ≥ max(1, minimumSegments)（minimumSegments 存在时）；
5. `visual_prompt` 非空字符串；**不含任何口播原文**（复用 `containsAuthoredDialogue`）；**不是整段 source 回灌**（复用 `containsForeignSemanticSource` 语义）；
6. `dialogue_line_sequences` 为整数数组；扁平化后**严格等于 [1..M]**（M=dialogueLines 数）：每条恰好一次、全局按序递增、不重复不遗漏；无口播时每项必须为空数组；
7. **每段容量**：该段被引用台词的 `countSpokenCharacters` 总和 ÷ 4.5 + 2 ≤ 该段 duration（huobao 台词下限代码化）；
8. 构建完成后防御性再跑既有 `assertStoryboardPlan`（active `durationPolicy` + 总量 invariant）。

### 4.4 系统提示（在现有版本上增改，保留语言规则与注入防御句）

- 响应契约：顶层 JSON 数组、每项三键、除此外无任何字段；段落数量与每段时长由你决定；
- huobao 分段决策规则（可溯源，见设计文档 §3）：
  - 节拍识别与强制切段：【开场】【触发】【高潮】【收尾】等标记，或地点转移、规则揭示、情绪爆发、反转等叙事转折点；节拍边界强制切段，同一节拍子镜头归入同段，不把一条因果链（铺垫-发生-反应）切散；
  - 总量锚定：Σ duration_seconds 必须正好等于目标总时长；
  - 节奏分层：过渡段（赶路/空镜/环境建立/转场）8-10s；叙事段（常规推进/对话）10-15s；爆点段（特写/规则揭示/情感爆发/反转）12-15s；
  - 台词下限（硬规则）：段时长 ≥ 段内台词字数 ÷ 4.5字/秒 + 2s；装不下必须拆到下一段；
- 台词只引用编号：`dialogue_line_sequences` 只写编号引用，**编号从 1 开始**（第 1 条台词编号是 1，没有编号 0）——这是上轮实测抓到的真实缺陷：模型默认 0 基索引导致校验失败重试耗尽；每条恰好一次、按原序全局递增；无台词段写空数组；绝不复述/改写/翻译/新增台词，口播原文由平台按编号逐字注入；
- 保留现有：huobao 导演规则（有序可见动作/不新增台词）、Seedance 四层+`@`原样、openmontage 中文五层、语言规则、每段只导演自己片段、返回 `[]` 的阻断约定。

### 4.5 骨架构建（`buildLlmSegmentedDraft`，设计文档 §3.7 选项A）

校验通过后构建 `StoryboardPlanDraft`（沿用既有类型与模板）：

- **beats**：按段顺序，把每段 `visual_prompt` 的句子（复用 `extractNarrativeSentences` 并过滤 CONTROL）作为该段叙事点；全局编号连续；字段沿用既有模板（`叙事点 N：…`）；
- **shotSpecs**（每段）：
  - `dialogueLines` = 被引用编号对应的**提取原文逐字**；
  - `durationSeconds` = LLM 给的值；
  - `narrativeBeatSequences` = 该段 beats 全局序号；
  - `referencePolicy` = 沿用既有 `shotReferencePolicy`（转场感知保留）；
  - `title` = `生成片段 N：` + concise(该段第一句 beat 文本)；
  - `narrativeGoal`：**有台词段** = 台词 join 成引语形态 `说：“${line}”`，以「；」相接（该形态会被既有 `stripSpokenDialogue` 清空，保证口播在最终 prompt 只出现一次）；**无台词段** = concise(该段 visual_prompt)；
  - `startState/endState/transitionSummary` 沿用既有 sequence 模板；
  - `voicePerformance` = `voicePerformanceForLines(dialogueLines)`；`cameraShot` = 既有 `cameraShotFor(...)`；
  - `motionPlan` = 既有 `createMotionPlan(...)`，`events` = 该段 visual_prompt 的句子；
- **防重复注入**：编译器把 `visualPrompt` 放进 `generatedPromptParts[0]`、`narrativeGoal` 进 `sourcePrompt`。**有台词段**：`visualPrompt = segment.visual_prompt`（注入）；**无台词段**：`visualPrompt = undefined`（goal 已承载该段视觉内容，再注入会重复）。测试必须断言最终 prompt 中该段视觉内容只出现一次、口播恰好一次。

### 4.6 客户端与运行链

- `OpenAiCompatibleSemanticPlanningClient.plan(context)` 签名随 context 更新；HTTP/超时/错误映射不动；
- **必须删除 `response_format: { type: "json_object" }`**（如还有残留）——json mode 强制对象根，与顶层数组契约冲突，真实调用恒失败。这是上轮独立审查抓到的真实缺陷，并已补防回退测试断言（`assert body.response_format === undefined`）；
- `execution-service.ts` 的 `buildDraft` 投影**已含 `dialogueLines`**（你上轮已保留），确认即可；
- 预算 sidecar、`extractDialogueLines`、`invokeLlmFreeformPlanningClient`、`LlmSemanticPlanningError` 全部不动。

---

## 5. 已知坑（上轮实施实测踩过，必须避免重蹈）

1. `response_format: json_object` 与数组根冲突（见 §4.6）；
2. 模型默认 **0 基编号**——提示词必须显式写「编号从 1 开始」并配真机探针验证；
3. **重启脚本 kill 从未真正生效**（MSYS pid ≠ Windows pid），每轮重启累积僵尸 worker（旧代码）抢队列。改完代码必须：按「保留监听 3133/3031/3433/3434 的进程、杀其余全部 `--import tsx src/index.ts` node 进程」清场，再重启，并确认新代码生效（可用进程启动时间比对文件修改时间）；
4. **worker 运行时依赖 `packages/creative-planning/dist`**：改完 src 必须重建 dist（`node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p packages/creative-planning/tsconfig.json`）再重启 worker；
5. 测试命令：`node node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs --test <files>`（pnpm 不可用、node_modules/.bin 无 shim）；typecheck 用 `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc --noEmit -p <tsconfig>`；
6. 若做真实验证：**media-runtime 未运行会导致 QC fail-closed**（生成后「本段画面检查未通过」）——先确认 3433 有监听。

---

## 6. 测试与验收

1. creative-planning 测试恢复到 **≥83**：重写 llm-freeform-planner 测试为分段决策契约——合法分段（含台词/无台词混合）骨架正确（台词逐字、beats 来自该段 visual_prompt 句子、全局编号连续）、防重复注入断言、failure 矩阵（时长越界/Σ≠target/缺漏乱序引用/容量超限/空 prompt/含口播/对象或字符串响应/超时→fail-closed）、sourceText 完整不截断、minimumSegments 生效、**mock 模式回归全绿**（证明 DeterministicPlanningModel 未动）；
2. workflow-worker 测试更新为新契约；
3. 两包 + control-api `tsc --noEmit` 通过；
4. 重建 dist；
5. **真实端到端验证（必须做，这是上轮验收过的标准）**：重启栈后建项目 → brief（含口播的无标签中文文案）→ 触发 plan → `PLANNED_OK`；验证：段落数/时长由 LLM 决定（非均分模板）、口播逐字、`dialogue_lines` 落库非空（有台词段）、visual_prompt 纯中文、无 envelope 报错；
6. **不得 commit**；不得触碰 contracts/DB schema（除既有 0025）/Provider adapter/runtime-profile/前端/计费；
7. 完成后报告：改动符号清单、校验门实现位置、测试计数、端到端证据（项目 ID + storyboard ID + 各段时长与 dialogue_lines）。

---

## 7. 登记要求

在 `doc/AI企业内容生产平台_第三方来源与复用登记.md` 追加条目：声明保守版实现已按用户决定拆除、LLM 分段决策恢复（依据 = 用户批准的设计文档 + 上游锚定），并注明此前回退未声明覆盖已验收实现的过程教训。

---

*本指令由主控 agent 依用户 2026-09-18 决定起草；规格内容逐条来自已验收实施记录与权威设计文档，可对照执行。*
