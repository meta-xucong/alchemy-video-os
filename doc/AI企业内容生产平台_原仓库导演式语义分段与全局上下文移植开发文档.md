# AI 企业内容生产平台：原仓库导演式语义分段与全局上下文移植开发文档

> 文档版本：v1.0（2026-09-17）
> 文档状态：`HISTORICAL_SUPERSEDED（2026-09-17）`。
> 本文曾授权 `source_ownership/source_spans`、UTF-16 偏移和连续覆盖校验；该内部结构化 envelope 已被《AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md》取代，不再作为当前实现授权。
> 本文保留固定来源的导演语义、审计证据和未被新文档覆盖的历史边界；不得据此把旧实现标为 `ACCEPTED`，全平台及其它硬门继续保持 `DEFERRED/BLOCKED`。

## 1. 目标与范围

本章把“先按 source 做导演式语义归属，再生成分段提示词”接入现有 `PlanningModelPort` 内部 seam，解决无标签商品测试1中主题、风格、声音政策占用前段而视觉动作集中后段的问题。既有 duration policy、dialogue capacity、segment count/max-min 规则仍由确定性规划器拥有；LLM 只在既有片段骨架上返回 source ownership 和每段视觉补充。

本章不改变公开 HTTP/DB/事件字段、领域公共类型、Provider adapter/profile、任务状态、4096 UTF-8 compactor、音频/字幕/BGM、Studio、VPS、Git 或真实 Provider 调用。来源仓库只贡献导演过程、`description`/`atmosphere` 分离、section/scene ownership、global/progression/locks/引用顺序；来源没有定义本地 JSON envelope，也没有定义本地压缩算法。

## 2. 固定来源与可移植语义

所有来源均固定到以下 commit；这里只移植可证明的过程语义，不复制来源宿主的 Agent、工作区状态、Provider 协议或持久化模型。

| 来源 commit | 固定文件 | 本章采用的语义 | 明确不声称来源定义 |
| --- | --- | --- | --- |
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md`、`backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`、`backend/src/agents/index.ts` | 先识别 narrative beat/turning point；段内 `description` 承载可见动作和有序子镜头；`atmosphere` 单独承载光线、色调、声音和氛围；源顺序与段内 ownership 保持不变。 | 本地 `source_ownership` JSON、平台段数规则、压缩器或数据库字段。 |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/pipelines/explainer/script-director.md`、`skills/pipelines/explainer/scene-director.md`、`lib/shot_prompt_builder.py` | script section 是内容骨架；scene/shot 只消费所属 section 的 description 和职责；每个视觉单元必须有可见内容；提示词层按已有字段顺序组装。 | 本地 section schema、时间轴/转场实现、平台事件或 JSON 协议。 |
| `Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/long-video.md`、`skill/seedance-25/references/prompting.md`、`skill/seedance-25/references/references.md` | Global/Throughout/locks 与 timestamp/progression 分离；先写物理动作，再写必要的叙事原因；持续锁与引用顺序跨段保留。 | 本地 envelope、duration policy、字符/事件比例、4096 压缩算法或 Provider 字段。 |

## 3. 平台字段映射

请求侧继续调用现有 `buildSemanticSourceEvidence` 与 `buildSemanticSourceManifest`。source 文本、顺序、解析后的 source unit 文本、hash、asset/reference 顺序和对白均由平台派生；模型不能回传或改写这些事实。

| Source/内部事实 | 现有平台落点 | 约束 |
| --- | --- | --- |
| `sourceEvidence.sourceUnits[{sequence,text}]` | 私有 director context；manifest 中保留 sequence/hash | sequence 是不可变身份；模型只能引用它。 |
| `role: GLOBAL` | 现有 `stylePreferences`/共享 visual constraints、character/continuity locks 和 compiler context | 不进入 `beats`、`narrativeBeatSequences` 或 `motion_beats[].source_description`。 |
| `role: VISUAL` 的 `source_spans` | 现有 `PlannedScriptBeat`、段内 `narrativeGoal`、`motionPlan` 的 source description 和 `narrativeBeatSequences` | 只投影到唯一 generation segment；按 source 顺序一次覆盖。 |
| `segments[{sequence,visual_prompt}]` | 现有 segment-local `visualPrompt`，随后由既有 compiler 组装 | 只补本段画面创意；不返回 duration、dialogue、reference 或 source 事实。 |
| `sourceEvidence.dialogueLines` | 既有 dialogue extraction、capacity、narration/native-audio owner | 台词逐行、标点、引用顺序不交给 LLM 改写。 |
| `sourceAssetIds`、`referenceAnchors` 和绑定 | 既有 reference policy/map 与输入顺序 | director 只读；不得重排、增加或删除。 |
| segment count/duration/依赖 | 既有 `DeterministicPlanningModel` 骨架 | LLM 不得新增 Provider 请求、时长、段序或依赖。 |

同一 source unit 内含多个已作者化的 Huobao 子镜头、Seedance phase 或 OpenMontage section description 时，使用私有 source span 表达边界；平台按返回的字符区间直接切片，不以 arrow、关键词、字符比例或本地正则猜测子镜头。无法证明区间完整覆盖时 fail-closed。

## 4. 私有 director envelope

LLM 一次返回以下私有 envelope。它只存在于 Workflow 内部 transport 和 planning seam，不进入公开 HTTP、数据库、outbox/SSE 事件或持久化 snapshot：

```json
{
  "source_ownership": [
    { "source_unit_sequence": 1, "role": "GLOBAL" },
    {
      "source_unit_sequence": 2,
      "role": "VISUAL",
      "source_spans": [
        { "start": 0, "end": 12, "segment_sequence": 1 },
        { "start": 12, "end": 28, "segment_sequence": 2 }
      ]
    }
  ],
  "segments": [
    { "sequence": 1, "visual_prompt": "只补充本段画面创意" },
    { "sequence": 2, "visual_prompt": "只补充本段画面创意" }
  ]
}
```

这里的 `start`/`end` 是对应 `sourceEvidence.sourceUnits[].text` 的 UTF-16 字符偏移，采用 `[start,end)`；平台从冻结 evidence 切片，模型不返回 span 文本。每个 source unit 在 `source_ownership` 中恰好出现一次：GLOBAL 不带 span；VISUAL 必须带一个或多个 span，并且 span 从 `0` 连续覆盖至该 unit 的 `text.length`，不得有 gap、overlap、重复或越界。一个 VISUAL unit 的多个 span 可以归属连续的多个既有 generation segment，从而表达一个无标点 description 中的多个作者子镜头，而不复制或丢弃分隔符。

`source_ownership` 的 source unit 序号必须为 `1..M` 原序；每个 span 的 `segment_sequence` 必须为既有 `1..N` 且全局非递减。director envelope 不允许无 visual owner 的 duration-only trailing 段；一旦出现则沿既有 `LlmSemanticPlanningError` fail-closed，不伪造前段 source。`segments` 必须逐一返回既有片段的 `sequence`，不能改变数量、时长或引用边界。

## 5. 校验与生成顺序

1. 先由确定性 planner 生成既有 duration/dialogue/segment skeleton；real mode 复用现有 LLM transport，`VIDEO_PROVIDER=mock` 继续只使用确定性 planner。
2. 请求中附带 source evidence/manifest；模型只做 GLOBAL/VISUAL ownership 和 `visual_prompt`。
3. 读取 envelope 时校验 exact keys、角色枚举、整数序号、span exact keys 和 segment exact keys；未知 role、额外字段、缺失字段、空 prompt、JSON 不可解析均映射到既有 `LLM_PLANNER_MALFORMED`。
4. 服务端校验 manifest source text hash、asset 顺序、source unit hash、dialogue hash；校验 ownership 的完整原序、span 范围/连续性/覆盖、segment 非递减、无重复/遗漏/重排/重叠/幻觉和每段可见 owner。
5. GLOBAL source 只进入已有共享约束/编译器 context，不创建 beat；VISUAL span 按 source 顺序创建 beat，并只投影到其唯一 segment。每段 `motion_beats` 都有可见 source 内容；director envelope 不允许无 visual owner 的 trailing 段；一旦出现则沿既有 `LlmSemanticPlanningError` fail-closed，不伪造前段 source。
6. 每段 `visual_prompt` 只允许本段创意补充；若复述对白、完整 source、GLOBAL source、其它 segment 的 span/source projection，返回既有 `LLM_PLANNER_MALFORMED`。不对模型文本做截断、改写或静默过滤。
7. 任一 LLM timeout/unavailable、来源无法表达、span 不可验证或校验失败均沿既有 `LlmSemanticPlanningError` fail-closed；不得退回 `distributeEvents` 作为 source ownership，也不新增错误码、阈值或重试协议。

复杂 transition/section 时间窗若现有 `GenerationSegment`/`MotionPlan` 无法表达，维持 `DEFERRED`/fail-closed；本章不伪造 OpenMontage 完整时间轴，也不改变 compiler、4096 compactor、音频、字幕、BGM 或 provider adapter。

## 6. 旧文档 superseded 关系

- `AI企业内容生产平台_LLM语义Prompt规划与结构化校验重构开发文档.md` 标记为 `HISTORICAL_SUPERSEDED`。其中完整 raw `draft/sourceCoverage/motionPlan/camera` 输出方案不再授权；其 source-first、台词保真、引用顺序、预算、sidecar、fail-closed 和外部边界只作为历史依据，当前执行以本文为准。
- `AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md` 仍保留 source-first、口播、引用和预算规则；其中“生产 LLM 仅补 `visual_prompt`、不得决定 ownership”的实现授权由本文 superseded，生产 LLM 现在必须返回本文的私有 ownership envelope。
- `AI企业内容生产平台_原仓库语义分段与全局约束映射补全开发文档.md` 保留 2026-09-16 显式标签窄片 `ACCEPTED` 历史证据；其中无标签 source ownership 的 `BLOCKED` 条款由本文覆盖。旧文档、旧计数、旧测试证据不删除或重写。

## 7. 定向测试矩阵

| 场景 | 通过条件 |
| --- | --- |
| 无标签“商品测试1”完整源，30 秒 | 既有 policy 仍为 2 段；主题/风格/声音不在 beats、`narrativeBeatSequences` 或 motion source description；九个视觉动作由 LLM span 按原序恰好一次映射，两个 segment 均有 visual owner；prompt 不复制全故事。具体分组不固化为 4+5。 |
| Huobao `【镜头N】`/`atmosphere` | description 子镜头和 atmosphere 分离；顺序、anchor 和本段 owner 保留。 |
| Seedance Global/Throughout/timestamp | global/locks 进入共享通道；timestamp/progression 进入 visual span；不把 global 伪装成 beat。 |
| OpenMontage section/scene | section ownership 保留；每个执行 section 有视觉内容；无法映射的时间窗保持 deferred/fail-closed。 |
| envelope 失败路径 | malformed、unknown role、missing/duplicate/reordered/overlap/fabricated source 或 span、纯 global、无 visual、leading/interior empty、timeout/unavailable 均 fail-closed，不退回 deterministic ownership。 |
| 保真回归 | 多行中文、中文标点、ASCII 引号、`@anchor`、dialogue/reference 顺序保留；Mock、显式标签和既有 deterministic/legacy planner 回归通过。 |

## 8. Exit Gate

只有以下证据全部具备，本文才可从 `IMPLEMENTED_PENDING_AUDIT` 进入正式审计：

1. 改动只落在本文列出的文档、`creative-planning` semantic planner/test 和 `workflow-worker` semantic client/test 边界；无公共 contracts/domain/persistence/provider/runtime/audio/subtitle/VPS/Git 改动。
2. creative-planning 与 workflow-worker 定向测试、typecheck 和 `git diff --check` 通过；真实 Provider/TTS、网络、VPS、Git 未执行。
3. 固定 commit、字段映射、私有 envelope、span 覆盖证据和旧文档关系可复核；没有把来源仓库误写成本地 JSON 或压缩算法来源。
4. 失败路径保持既有错误语义和 fail-closed；没有静默回退、硬编码关键词/评分/4+5 分组、额外时长或请求数。
5. 完整 transition 时间窗、Provider 画面质量、音频/字幕/BGM、人工审核和真实产物仍明确为 deferred，不作为本章完成条件。
