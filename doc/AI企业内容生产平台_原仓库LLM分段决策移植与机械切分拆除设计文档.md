# AI 企业内容生产平台：原仓库 LLM 分段决策移植与机械切分拆除设计文档

> 文档版本：v1.0（2026-09-18）
> 文档状态：`IMPLEMENTED_PENDING_AUDIT`（2026-09-19 已按本设计重建代码并完成离线定向验证；尚未独立 ACCEPTED）
> 用户指令（2026-09-18）：「如需让 LLM 决定分段，必须另立契约和审计任务——这个在原仓库里有设计吗？我要你把源仓库的内容拿过来，如果有自造的逻辑删掉。以这个思路设计修改方案。」
> 上位文档：《AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md》（已实施的 envelope 拆除是其前置窄片）。
> 依据链：《AI企业内容生产平台_自造逻辑核查与拆除报告.md》→ 本设计。

## 1. 对用户问题的直接回答

**原仓库有这个设计，而且就是 huobao-drama 的核心工作方式。**

huobao 的分镜拆解不是确定性代码做的，而是 **LLM Agent 按技能规则决定分段**，代码只做外壳。完整流水线（已逐文件核实）：

```
前端 doBreakdown()（episode.vue:2721-2742）
  → POST /agent/storyboard_breaker/chat（routes/agent.ts:28-104）
  → agent.generate（maxSteps:20，多轮工具调用）
      ├─ 工具 read_storyboard_context（storyboard-tools.ts:107-225）
      │    返回：剧本全文原文（:118，无平台预切分）+ 角色/场景/道具全量 + 已有分镜
      ├─ LLM 按 SKILL.md 规则自行拆分（节拍边界强制切段）
      └─ 工具 save_storyboards（:227-306，zod schema 即输出契约）
            每段 {shot_number,title,duration,description,result,
                  atmosphere,scene_id,character_ids,prop_ids}
            → 全删重建落库
```

关键事实（与我们的差异）：

| 维度 | huobao（上游） | 我们当前（自造） |
|------|--------------|----------------|
| 段落数量 | **LLM 定**（总量锚定≈总时长÷12s±20% 只是 SKILL 指令） | 确定性代码算（`chooseGenerationSegmentCount`） |
| 每段时长 | **LLM 给**（节奏分层 8-10/10-15/12-15s 是指令） | 代码机械均分（`distributeDuration`/`planSegmentDurations`） |
| 内容归属 | **LLM 按叙事节拍分**（【开场】【触发】【高潮】标记、转折点） | 代码机械均分（`distributeEvents` 按序均分） |
| 台词归属 | **LLM 写进 description 的【镜头N】** | 代码按容量分配（`distributeDialogueLines`） |
| 输入 | 剧本**全文原文**一次给足，无预切分 | 平台先按标点切句再机械分配 |
| 平台校验 | 仅 zod 类型 + 绑定合法性（无时长/容量代码校验） | 8-15s invariant（`assertStoryboardPlan`） |
| 失败处理 | 工具 throw → LLM 自行修正；**无机械切分降级路径** | fail-closed |

## 2. 当前分段链路的自造清单（拆除对象）

| # | 自造物 | 位置 | 登记状态 | 处置 |
| --- | --- | --- | --- | --- |
| S1 | `distributeEvents`（事件按序机械均分到段） | `creative-planning/src/index.ts` | **登记=0** | 删除 |
| S2 | `distributeDuration`（时长机械均分） | 同上 | **登记=0** | 删除 |
| S3 | `hasCinematicEditorialBoundary`（评分式拆段，C1） | 同上 :2229 | 已冻结 UNREFERENCED | **正式删除** |
| S4 | `hasExplicitSceneChange` 作为拆段依据（:887 `shouldSplitShortNarrative`） | 同上 | 登记=1 但用途是平台启发式 | 拆段决策交还 LLM（huobao 节拍语义），删除该用途 |
| S5 | `splitLongDialogueClause`（长台词切分） | 同上 | **登记=0** | 删除 |
| S6 | `narrativePlanningInput` 的拆段用途（无标签文本切事件→分配） | 同上 | **登记=0** | 拆段用途删除；句子抽取仅保留给确定性规划器（mock 模式）与 C 类待裁定项 |
| S7 | `chooseGenerationSegmentCount`/`planSegmentDurations` 作为**决策者** | 同上 | 登记=1（huobao 适配） | **降级为校验边界**：其 huobao 语义（≈÷12s 锚定、8-15s、chars/4.5+2s）改写进 LLM 指令 + 平台校验，不再由代码做决定 |
| S8 | `distributeDialogueLines`/`dialogueUnitsForCapacity` 作为分配者 | 同上 | 登记=1 | 同上：容量规则转为校验，分配交给 LLM |

**保留（平台外壳，全部登记）**：口播提取 `extractDialogueLines`（逐字硬门）、参考图绑定与 `referencePolicy` 推导、音频 owner、`assertStoryboardPlan`（默认 8-15s；服从已解析的 active duration policy）、预算 sidecar、编译器、mock 模式的 `DeterministicPlanningModel`（夹具生成器，不变）。

## 3. 目标设计（huobao 语义的薄壳移植）

### 3.1 调用形态：一次 LLM 调用完成「分段 + 每段视觉导演」

huobao 是单 agent 一次会话产出全部分镜。我们对齐：真实模式不再有「确定性骨架 → LLM 补充」两段式，改为**单次 LLM 调用产出完整分段方案**。

### 3.2 LLM 输入（对齐 huobao `read_storyboard_context` 的输入形态）

- 完整用户原始创作描述（**原文整篇，不做任何平台预切分**——S1/S6 的拆除动机）；
- 目标总时长 + 时长政策边界（min/max 段时长、段数上限）；
- 已提取的口播清单（受保护文本，编号列出；仅声明「必须原样保留、由平台注入」，不要求回写）；
- 参考资产与 anchor、风格偏好、音频 owner 事实。

### 3.3 LLM 输出契约（顶层 JSON 数组，内部 transport）

```json
[
  { "duration_seconds": 9,
    "visual_prompt": "自然语言视觉提示词（有序可见动作、终点、必要的镜头/光线/氛围）",
    "dialogue_line_sequences": [1, 2] },
  { "duration_seconds": 13, "visual_prompt": "…", "dialogue_line_sequences": [3] }
]
```

- 数组长度 = 段落数（LLM 决定），每段时长 LLM 给出（对齐 huobao：duration 由 LLM 给）；
- `dialogue_line_sequences` 是**平台外壳**：口播逐字保真是用户硬门，台词原文必须由平台注入、不能让 LLM 复述（复述即有改写风险），故用「编号引用式归属」。此为必要的平台边界，登记为 `PLATFORM_OWNED`，语义对应 huobao「台词写在对应段落」；
- 除上述三键外不允许任何字段（无 beat/motion/camera/scene schema——对齐已实施的 envelope 拆除原则）。

### 3.4 平台校验硬门（全部有 huobao 来源，代码化为 fail-closed）

| 硬门 | 来源 |
| --- | --- |
| 每段服从 `durationBounds`（默认 8-15 秒；已认证 Provider 的既有 `durationPolicy` 可明确提供其它边界） | 默认 huobao SKILL「每个段落时长 8-15 秒」；Provider-specific 例外只能由已有 profile/policy 传入，不能由 LLM 或本窄片新增 |
| Σ时长 = 目标总时长（政策容差内） | huobao「总量锚定」 |
| 段数受 `durationBounds.minDurationSeconds` 与目标总时长自然约束（ceil(target/minDuration)） | 平台既有 Provider duration policy；不另造段数阈值 |
| 口播覆盖：每条提取的台词恰好被引用一次、按原序、不重复不遗漏 | huobao「台词装不下必须拆到下一个段落」+ 我们的平台口播硬门 |
| 每段台词容量：段内台词字数 ÷ 4.5 + 2s ≤ duration | huobao「台词时长下限（硬规则）」 |
| `visual_prompt` 非空、不含口播原文、不含整段 source | 上位文档 §8.1 既有禁集 |
| 任一不满足 → `LLM_PLANNER_MALFORMED`，**无机械切分降级** | huobao 本无降级路径 + AGENTS.md fail-closed |

### 3.5 系统提示（仅含可溯源上游规则）

按 huobao SKILL.md 语义改写：叙事节拍识别与强制切段（【开场】等标记、地点转移/规则揭示/情绪爆发/反转等转折点）、总量锚定（≈÷12s±20%）、节奏分层（过渡段 8-10s/叙事段 10-15s/爆点段 12-15s）、台词下限（÷4.5+2s）、子镜头不跨场景；加上 Seedance 四层自然语言形状与 `@` 引用原样、openmontage 五层紧凑层次（沿用已实施的自然语言导演提示）。保留平台自有的注入防御句（已登记 `PLATFORM_OWNED`）。

### 3.6 校验通过后的骨架构建（平台外壳）

平台按 LLM 分段结果构建既有 `StoryboardPlanDraft`：每段 `dialogueLines` 按引用取提取原文、`referencePolicy` 按既有规则推导（首段 REFERENCE_SET/后续 HANDOFF 或转场感知）、`startState/endState/transitionSummary` 沿用既有平台模板、motionPlan 按 §3.7 构建。编译、预算 sidecar、持久化链路不变。

### 3.7 关键决策点：motionPlan 的内容来源（需用户拍板）

机械事件分配（S1）拆除后，每段 motion beats 的内容从哪来：

- **选项 A（推荐）**：以该段 LLM `visual_prompt` 的句子为该段 beats 内容，平台按序结构化（每句一个 beat、均分该段时长）。性质=平台把 LLM 已创作的本段内容结构化为既有 schema，**不是跨段身份切分**；对齐 huobao「description 的每个【镜头N】映射为连续时间段」（`agents/index.ts:127`）。登记为平台结构化外壳。
- 选项 B：motionPlan 退化为单 beat 覆盖全段。改动最小，但属自造退化形态，且丢失时间轴信息。
- 选项 C：Provider prompt 中移除机械时间轴，motionPlan 仅作持久化最小骨架。prompt 契约大改，风险最高。

**推荐 A**。备选 B/C 均可 discussion。

### 3.8 预算重规划循环

`execution-service` 的 budget 重试循环保留：超限时以 `minimumGenerationSegmentCount` 提示重规划，LLM 在更细的段数下限内重新分段（huobao 语义：装不下拆到下一段）。

## 4. 边界

**允许改**：`packages/creative-planning/src/index.ts`、`apps/workflow-worker/src/semantic-planning-client.ts`、（如需）`apps/workflow-worker/src/execution-service.ts` 的重规划循环、两包测试、登记文档、本文。
**禁止改**：`packages/contracts`、数据库 schema、任务状态/事件、Provider adapter、`runtime-profile.ts`、前端、计费、VPS、真实外部调用。
**禁止引入**：新的机械切分/评分/均分/降级路径；mock 模式行为变化。

## 5. 定向测试与验收

1. LLM 返回的分段：段数/时长/台词归属全部合规时 → 骨架按其构建，口播逐字进对应段 prompt；
2. 台词漏配/重复/乱序、时长越界、总量不符、空 prompt、对象响应、超时 → 全部 fail-closed；
3. 无标签多段 source（商品测试1类）：主题/风格不再被机械塞进前段——分段由 LLM 按节拍决定（**这是本窄片要解决的原问题的直接验证点**）；
4. mock 模式回归：`DeterministicPlanningModel` 输出不变；
5. `rg` 证明 S1-S7 的机械分配/评分代码清零；
6. 两包测试全绿 + typecheck；不触网、不计费。

## 6. 不做的事

- 不让 LLM 决定口播文本（硬门不变）；
- 不动 mock 模式与确定性规划器本体（仅真实模式切换到 LLM 分段）；
- 不在本窄片处理 C2/C4/C5 待裁定项；
- 不引入任何无来源评分/阈值/降级。

## 7. 2026-09-19 重建实施记录（待独立审计）

- 真实 LLM 路径已移除确定性骨架调用：`LlmFreeformPromptPlanningModel.plan` 直接把完整 `sourceText`、`durationBounds`、可选 `minimumSegments`、逐字 `dialogueLines` 和既有风格/参考资产顺序交给客户端；`DeterministicPlanningModel` 只保留给 mock。
- 内部响应契约已恢复为顶层数组的三个键：`duration_seconds`、`visual_prompt`、`dialogue_line_sequences`。校验器拒绝额外字段、对象/字符串根、范围越界、总时长不相等、台词漏配/重复/乱序、口播容量不足、整段 source/台词回灌；不做自动修补、重新分配或机械 fallback。
- `buildLlmSegmentedDraft` 只把已验证的 LLM 分段决策薄适配到现有 `StoryboardPlanDraft`、`motionPlan`、`referencePolicy`、compiler 和 sidecar；口播仍按编号从平台提取器逐字取回，视觉 prompt 仅在有台词段注入一次，无台词段由本段 `narrativeGoal` 承载，避免重复。
- `apps/workflow-worker/src/semantic-planning-client.ts` 已同步三键契约、节拍/时长/台词编号从 1 开始的提示规则；请求体不设置与数组根冲突的 `response_format: json_object`。
- 离线证据：creative-planning 全包 `83/83`，workflow-worker 全包 `37/37`；两包及工作区 typecheck 已通过。证据均为本地 fixture/mock；真实 LLM/Provider/E2E 与独立审计仍需补证，不能据此写成 ACCEPTED。
