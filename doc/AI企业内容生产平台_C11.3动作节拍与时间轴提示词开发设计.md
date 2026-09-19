# AI 企业内容生产平台 C11.3：动作节拍与时间轴提示词开发设计

## 0. 文档状态

| 项目 | 内容 |
| --- | --- |
| 状态 | `READY_FOR_AUDIT` |
| 关联章节 | C11、C11.2、C12、C12.1 |
| 目标 | 补齐从故事分镜到可执行动作时间轴的中间层 |
| 默认运行方式 | 本地确定性 Planner、Mock Provider、无外部文本模型 |
| 真实 Provider | 不由本设计授权，仍遵守 C13-A 和 profile 能力门禁 |
| 兼容策略 | 保留旧 `StoryboardShotSpec`、`narrative_beat_sequences`、`GenerationSegment` 和历史快照 |

> **2026-09-01 当前音频口径**：自动视频的旁白由 Provider 原生音轨或服务端显式 Doubao 生成，不要求用户上传音频/样音；本章只负责动作节拍与 PromptPackage，默认/CI Mock 和本章真实 Provider 后置边界不变。

本设计解决当前规划链路的质量缺口：系统已经能够区分叙事点和生成片段，但仍可能把多个动作压缩进一段自然语言，导致 Provider 自行猜测动作顺序、起始姿态、镜头运动和结束状态。

本设计不是把 Huobao、Seedance 或 OpenMontage 的单体运行时复制到平台，而是提取其结构化分镜、时间轴提示词和媒体 QC 语义，适配现有 `Control API -> Workflow Worker -> Production Worker -> ProviderPort` 边界。

## 1. 与旧设计的兼容关系

旧链路保持不变：

```text
CreativeBriefRevision
  -> ScriptRevision
  -> StoryboardRevision
  -> ProductionRun
  -> GenerationSegment
  -> Video TaskRun
  -> VideoVersion
```

新 revision 的内部规划链增加一个不可公开的动作层：

```text
CreativeBriefRevision
  -> ScriptRevision
  -> NarrativeBeat
  -> MotionBeat
  -> GenerationSegment
  -> Video TaskRun
```

兼容规则：

1. 旧 `StoryboardShotSpec` 继续作为生成片段级兼容实体，不删除、不改写历史记录。
2. 旧 `narrative_beat_sequences` 继续保存叙事点与生成片段的归属。
3. 新 revision 额外保存 `motion_plan` 私有快照；旧 revision 没有该字段时使用兼容编译器。
4. 一个 `GenerationSegment` 仍然只创建一个主视频 `TaskRun`。
5. `MotionBeat` 不直接创建 Provider 任务，也不会改变用户看到的主片段数量语义。
6. 历史 `TaskRun`、`ProductionRun`、`VideoVersion` 不回填、不原地重编译；重新生成必须创建新的 revision 和新的 ProductionRun。

## 2. 上游能力复用边界

### 2.1 Huobao Drama

复用以下结构语义：

- 8-15 秒分镜段落；
- 每段 2-4 个子镜头；
- 按动作、视角、对象和场景边界拆分；
- `description` 中按 `【镜头N】` 描述画面、动作、表情、对白和旁白；
- 视频提示词按约 3 秒时间段编译。

不复用：短剧专用表、MySQL、进程内任务状态、自由 Agent 直接写平台数据库、原始 Provider 请求和本地路径。

### 2.2 Seedance-2.5

复用时间戳提示词、全局连续性锁、动作路径、站位、镜头节奏和首尾状态表达。

不把 Seedance 的能力描述当成 Grok/SUB2API 的能力保证；任何字段必须先经过当前 profile capability snapshot 校验。

### 2.3 OpenMontage

复用结构化 scene/edit timeline、媒体分析、音画覆盖和 QC 结果的思想。

不迁入 Backlot、`events.jsonl`、自由导演 Agent、文件系统作为事实源或 Provider 全局路由。

## 3. 当前缺口

当前 `packages/creative-planning` 的确定性实现存在以下限制：

1. 通过句号和分号切分文本，尚未稳定区分可见动作、状态、解释、素材用途说明和场景变化；“第一张图是人物、第二张图是场景”等说明可能被误当成剧情。
2. 按目标片段数量平均分配事件，没有按动作完成、因果链和场景边界分组。
3. 15 秒以内默认只生成一个片段，无法根据动作复杂度决定是否拆分。
4. `StoryboardShotSpec` 没有子镜头、动作时间、景别、角度、运镜、结果姿态和音频提示字段。
5. `narrative_beat_sequences` 只是归属数组，未参与动作编译。
6. `StoryboardCompiler` 只有叙事目标、开始状态、结束状态和过渡说明，没有输出时间轴提示词。
7. C12.1 主要检查相邻片段边界，尚未检查单一生成片段内部的动作顺序和动作完成度。

这些缺口会使“缓慢行走、枝条接近、气流拨开、保持衣物干燥”被压成一段描述，最终由 Provider 自行补全动作。

## 4. 目标领域模型

### 4.1 NarrativeBeat

`NarrativeBeat` 是故事层单元，继续保留旧字段，并允许增加以下内部字段：

```ts
type NarrativeBeatKind =
  | "ACTION"
  | "STATE"
  | "SCENE_CHANGE"
  | "EMOTION_TURN"
  | "EXPOSITION"
  | "TRANSITION";

type NarrativeBeat = {
  sequence: number;
  kind: NarrativeBeatKind;
  narrativeGoal: string;
  visibleFacts: string[];
  characters: string[];
  location?: string;
  props: string[];
  emotion?: string;
  startState: string;
  endState: string;
  estimatedDurationSeconds?: number;
  generationSegmentSequence?: number;
};
```

公开 Script DTO 只投影安全摘要；字段新增必须向后兼容。

### 4.2 MotionBeat

`MotionBeat` 是一个在单一连续片段内可执行的可见动作单元，只保存于私有 Storyboard/PromptPackage/TaskRun 快照：

```ts
type MotionBeat = {
  sequence: number;
  startSeconds: number;
  endSeconds: number;
  subjectRefs: string[];
  action: string;
  expression?: string;
  startPose?: string;
  endPose?: string;
  shotSize?: string;
  cameraMovement?: string;
  soundCue?: string;
  continuityLocks: string[];
  prohibitedChanges: string[];
  sourceNarrativeBeatSequences: number[];
};
```

不允许把抽象情绪单独作为动作；必须转为可观察的表情、姿态、视线、呼吸或身体运动。

### 4.3 GenerationSegmentMotionPlan

```ts
type GenerationSegmentMotionPlan = {
  version: string;
  durationSeconds: number;
  sceneLock: string;
  characterLocks: string[];
  propLocks: string[];
  motionBeats: MotionBeat[];
  openingState: string;
  closingState: string;
  transitionIn?: string;
  transitionOut?: string;
  complexityScore: number;
};
```

约束：

- `motionBeats` 时间连续、无重叠、覆盖整个生成片段；
- 每个片段默认 2-4 个主要动作；
- 一个动作必须有明确结束状态；
- 同一片段不得出现无法通过连续性解释的场景、时间或人物切换；
- 计划时长必须与 `GenerationSegment.duration_seconds` 相等。

## 5. 规划算法

### 5.1 输入

Planner 读取：

1. 用户故事和风格偏好；
2. 已冻结的项目事实包；
3. 已确认参考素材职责；
4. Provider capability snapshot；
5. 目标总时长和预算 guard；
6. 历史交接摘要（仅用于新 revision 的规划，不修改旧事实）。

### 5.2 结构化理解

首版采用无网络确定性规则，并预留 `StructuredPlanningModelPort`：

1. 按段落、章节、显式场景头和标点建立候选事件；
2. 识别动作动词、场景地点、角色、道具、时间和情绪转折；
3. 先识别并剥离“参考图角色、上传顺序、生成请求”等控制说明；原文仍保留给参考图角色解析，但不进入叙事点、动作节拍或 Provider Prompt 的剧情部分；
4. 将文学解释和人物静态状态归类为 `EXPOSITION` / `STATE`，转为全局视觉约束而不是独立动作；
5. 将场景、时间、人物关系或因果转折标记为强制边界；
6. 保存每个动作的来源叙事点序号，确保可追溯。

未来接入文本模型时只能通过受控 Port 返回同一 schema；模型不能直接写数据库、创建 TaskRun 或绕过事实包。

### 5.3 动作复杂度

复杂度评分由以下因素组成：

- 可见主动作数量；
- 场景/时间切换数量；
- 角色数量及相互作用；
- 摄影机运动变化；
- 道具交接或遮挡；
- 对白/旁白时长；
- 服装、姿态、方向或空间连续性风险。

评分只用于后台分组，不展示为工程术语。

### 5.4 片段分组

分组优先级：

1. 场景、时间和空间布局不能被无意义地切断；
2. “铺垫 -> 动作 -> 结果”优先保持在同一片段；
3. 一个片段默认承载 2-4 个 `ACTION` MotionBeat；静态状态、世界观解释和控制说明不消耗动作预算；
4. 超过 4 个主动作、出现多个场景或动作方向冲突时拆分；
5. 简单内容即使文字较长也不强行拆分；
6. 片段时长受 Provider 能力限制，所有片段总时长严格等于目标时长。

例如 15 秒茅山场景应优先形成：

```text
0-3 秒：建立庭院，人物保持自然站姿
3-9 秒：人物缓慢向前行走
9-12 秒：枝条接近袖口，被气流拨开
12-15 秒：继续前行并落到稳定结束姿态
```

“修士与凡人的区别”进入人物气质、动作克制和衣物状态锁，不单独创建 Provider 动作。

### 5.5 时间轴分配

- 建立镜头通常保留 2-3 秒；
- 普通动作通常保留 3-6 秒；
- 反应或结果至少保留 2 秒；
- 台词/旁白按实际可读时长计算，并保留表演余量；
- 每个时间段必须写起始状态、可见动作、镜头状态和结束状态；
- 时间轴不允许让 Provider 自己补全未声明的关键动作。

## 6. PromptPackage 编译

新编译顺序固定为：

```text
参考图职责
  -> 全局身份/服装/场景/人体锁
  -> 项目事实包
  -> 时间轴动作
  -> 音频与对白提示
  -> 禁止项与结束状态
```

真实 profile 的出站 Prompt 仍使用平台预算与 profile 上限的较小值；压缩时优先删除解释性冗余，不删除时间轴动作、参考图职责、结束状态和安全约束。

PromptPackage 私有字段建议增加：

- `motion_plan_version`；
- `motion_timeline`；
- `motion_source_narrative_beats`；
- `fact_refs`；
- `capability_snapshot`。

公开 API、SSE、日志和浏览器不得返回完整 Prompt、动作原文、Provider 字段、对象 key、签名 URL 或内部评分。

## 7. Worker、重试和连续性

1. C11 规划阶段只创建 Script/Storyboard/PromptPackage，不调用 Provider。
2. C12 Scheduler 从已确认 ProductionRun 创建带 `motion_plan` 的不可变 TaskRun 快照。
3. Worker 重启后只能恢复已有 Provider request ID；不能重新提交相同动作计划。
4. 失败重试创建新 revision/TaskRun，但保留旧动作计划和旧结果。
5. 需要前段交接的片段仍使用 C12 的 HandoffAsset 优先策略。
6. C12.1 继续处理相邻片段语义衔接；新增的镜头内动作 QC 不替代 HandoffReview。

## 8. 前端边界

用户仍只看到：

- 故事输入；
- 总时长、清晰度、风格和参考素材；
- 预计生成片段数量及各段时长；
- “系统会自动安排动作、镜头和衔接”的自然语言说明；
- 生成进度、失败片段重试和最终成片。

不新增分镜编辑器、时间轴编辑器、动作评分、Provider 选择或工程化确认步骤。

## 9. 代码落地边界

目标模块：

| 模块 | 责任 |
| --- | --- |
| `packages/contracts` | 私有 MotionBeat/PromptPackage schema 与公开兼容投影 |
| `packages/domain` | 动作分类、复杂度评分、时间轴不变量、分组决策 |
| `packages/creative-planning` | NarrativeBeat -> MotionBeat -> Segment 规划 |
| `apps/workflow-worker` | 规划事件消费、事实包读取、revision 持久化 |
| `packages/provider-video` | 时间轴 Prompt 编译、profile 字节预算和能力校验 |
| `packages/persistence` | 新 revision 私有快照、TaskRun input_snapshot 持久化 |
| `apps/production-worker` | 动作计划执行快照、镜头内 QC、失败恢复 |
| `services/media-runtime` | 边界帧、音轨、合成和既有 C12.1 转场 |
| `apps/studio-web` | 只增加自然语言进度，不展示工程字段 |

## 10. 测试与 Exit Gate

### 10.1 单元和契约

- 文学解释不会被误识别为独立动作；
- 素材用途和生成请求不会进入叙事点、动作节拍或剧情 Prompt，但仍可用于参考图角色解析；
- 状态与解释会压缩为有限的全局视觉锁，15 秒密集内容只保留不超过 4 个可观察动作；
- 一个简单 15 秒场景形成 2-4 个 MotionBeat；
- 超过动作复杂度阈值时按场景/因果边界拆分；
- 时间轴无重叠、无空档，覆盖完整片段；
- `motion_source_narrative_beats` 覆盖且不重复；
- 旧 Storyboard/TaskRun 快照仍可解析；
- Prompt 压缩不删除动作时间、参考职责和结束状态；
- 公开 DTO 不含 Prompt、动作原文、Provider 或内部对象字段。

### 10.2 集成和 E2E

- 18 个叙事点、30 秒内容默认按 2 个 15 秒 GenerationSegment 规划；只有明确场景切换或 Provider 上限变化才增加片段；
- 15 秒动作密集场景不会简单把所有句子塞成无时间轴 Prompt；
- C12 TaskRun 快照保存同一动作计划，Worker 重启不重复 submit；
- 失败只重试必要片段；
- 参考图、交接帧、人物服装和场景锁保持现有 C12 语义；
- C12.1 段间衔接和镜头内动作 QC 可分别审计；
- Mock 无网络全量通过，真实 Provider 不进入普通 CI。

### 10.3 Exit Gate

以下条件已全部满足，C11.3 现标记为 `READY_FOR_AUDIT`，等待独立审计：

1. 领域、契约和迁移均为向前兼容；
2. 新 revision 具备可追溯 MotionBeat 和时间轴 Prompt；
3. 旧 revision、旧 TaskRun 和旧成片可只读恢复；
4. C11.2 事实包只按段进入 PromptPackage；
5. C12 Worker、Handoff、QC、合成和重试回归通过；
6. 浏览器仍是单一创作入口，没有工程字段泄露；
7. 没有真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

## 11. 风险和限制

- 时间轴提示词提高动作可执行性，但不能保证 Provider 每次生成都无人体变形。
- 语义 QC 需要独立评估器；评估器不可用时只能明确降级，不能伪造通过。
- 真实 profile 的 Prompt 上限和参考图能力仍以已认证 profile 为准。
- 动作拆分会增加 Provider 调用次数，必须受 ProductionRun 预算 guard 约束。
- 该设计不授权 C13-A、Veyra、VPS、DNS 或生产部署。
