# AI 企业内容生产平台：长叙事后端领域与编排开发设计

状态：`DESIGN_BASELINE`（C11/C12 的既有实现保留兼容边界；后续长叙事迁移必须按统一叙事点/生成片段模型演进。）

> **2026-09-01 当前口径**：自动旁白由 Provider 原生音轨或服务端显式 Doubao 生成，不要求用户上传 spoken audio；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 仅兼容既有资产。默认/CI 仍为 Mock，本机真实对照不改变本设计的契约、章节范围或后置 Veyra/部署门禁。

关联章节：C10、C11、C11.3、C12。本文只定义后端领域、公开控制面、内部编排和验收；对应页面行为见 `AI企业内容生产平台_长叙事前端项目工作台交互设计.md`。平台级“叙事点 → 动作节拍 → 生成片段 → 最终成片”规则以 `AI企业内容生产平台_通用叙事点与生成片段编排规范.md`、C11.3 设计文档和 ADR-0041 为准。

## 1. 范围与非目标

本设计把“长原文 -> 多段连续视频 -> 完整成片”建成持久化、可审计的制作链。它不会通过字数切片、浏览器循环提交或自由 Agent 直接写数据库来实现。

本设计不做以下事情：

- 不修改当前 C09-C 的 `POST /shots/:shotId/generations {}` 单 Shot 契约。
- 不让浏览器调用 Provider、Worker、Media Runtime、对象存储或内部 API。
- 不把 Planning Model、视频 Provider、Veyra、队列或渲染器的原始字段放进公开 DTO、事件、日志或浏览器持久化状态。
- 不在 C11 自动提交真实视频。真实多段制作须在 C12 离线门禁后按单独授权进行。

## 2. 与现有模型的衔接

现有 `Project -> Shot -> TaskRun -> ProviderAttempt -> Asset` 保持兼容：C09 的一个 Shot 仍可对应一个单段视频，但长叙事的新模型中，真正创建 Provider TaskRun 的单位是 `GenerationSegment`，而不是每一个逻辑叙事点。TaskRun 的不可变 `input_snapshot`、幂等键、Provider request ID 恢复和媒体校验规则不改变。

需要新增的是上游创作 revision、整体编排事实与最终成片事实，而不是替换 TaskRun：

```text
Project
  -> CreativeBriefRevision
  -> ScriptRevision
  -> StoryboardRevision
       -> NarrativeBeat[]
       -> MotionBeat[] (private execution plan)
       -> GenerationSegmentSpec[]
            -> Shot -> TaskRun[] -> generated VIDEO Asset
  -> ProductionRun
  -> VideoVersion -> final VIDEO Asset

DERIVED IMAGE Asset + AssetDerivation = HandoffAsset
```

`HandoffAsset` 是“已接受视频的一个交接帧”这一逻辑角色，不是第二套资产存储。它使用现有 `Asset(kind=IMAGE, origin=DERIVED)`，并通过新的来源关系记录源视频、源 Shot、源 TaskRun、提取时间和 QC/批准状态。这样仍遵守对象 key 只由服务端生成、二进制只放对象存储的边界。

## 3. 拟议领域对象

以下为 C11/C12 的拟议 schema，当前不是已生效的公开契约。

| 对象 | 核心字段 | 不变量 |
| --- | --- | --- |
| `CreativeBriefRevision` | `id`、`project_id`、`revision`、`source_text`、`target_duration_seconds`、`style_preferences`、`source_asset_ids`、`status` | 原文和用户明确偏好不可被 Planner 原地改写；修改创建新 revision |
| `ScriptRevision` | `id`、`creative_brief_revision_id`、`revision`、`beats`、`status` | 每个 beat 有叙事目标、事件顺序、角色/场景事实与可见信息 |
| `StoryboardRevision` | `id`、`script_revision_id`、`revision`、`total_duration_seconds`、`continuity_level`、`status` | NarrativeBeat 和 GenerationSegmentSpec 的顺序、映射和总时长可计算；批准后冻结 |
| `NarrativeBeat` | `id`、`storyboard_revision_id`、`sequence`、`narrative_goal`、`event`、`characters`、`location`、`start_state`、`end_state`、`generation_segment_id` | 故事层叙事点，不直接创建 Provider TaskRun；每个叙事点必须且只能属于一个生成片段 |
| `MotionBeat` | `sequence`、`start_seconds`、`end_seconds`、`action`、`subject_refs`、`start_pose`、`end_pose`、`shot_size`、`camera_movement`、`continuity_locks`、`prohibited_changes` | 私有动作执行单元；必须有可观察动作、结束姿态和不重叠时间范围；不直接创建 TaskRun |
| `GenerationSegmentMotionPlan` | `version`、`duration_seconds`、`motion_beats`、`opening_state`、`closing_state`、`scene_locks`、`character_locks`、`prop_locks`、`transition_in`、`transition_out`、`complexity_summary` | 生成片段的冻结动作计划；时间轴覆盖完整片段；旧 revision 可缺省并走兼容编译器 |
| `GenerationSegmentSpec` | `id`、`storyboard_revision_id`、`sequence`、`duration_seconds`、`narrative_beat_ids`、`motion_plan_version`、`motion_plan_hash`、`start_state`、`end_state`、`reference_policy`、`transition`、`depends_on_sequence` | 实际 Provider 生成单位；时长受能力注册表约束；一个片段只创建一个视频 TaskRun |
| `StoryboardShotSpec` | 兼容字段和旧 revision 的只读投影 | C09/旧版本兼容；新长叙事不再把逻辑叙事点直接当成 Provider 生成单位 |
| `PromptPackage` | `id`、`generation_segment_spec_id`、`compiler_version`、`prompt`、`visual_constraints`、`reference_map`、`capability_snapshot` | 由已批准 GenerationSegmentSpec 确定性生成；不覆盖用户原文或旧版本 |
| `ProductionRun` | `id`、`project_id`、`storyboard_revision_id`、`status`、`accepted_segment_count`、`total_segment_count`、`budget_guard` | 一个明确确认的制作批次；公开进度按生成片段统计，不与单 Shot TaskRun 共用状态 |
| `AssetDerivation` | `derived_asset_id`、`source_asset_id`、`source_task_run_id`、`derivation_type=HANDOFF_FRAME`、`accepted_at` | 交接帧只能来自同项目已验收结果；不得引用未通过 QC 的视频 |
| `VideoVersion` | `id`、`project_id`、`production_run_id`、`storyboard_revision_id`、`asset_id`、`status`、`duration_ms`、`qc_report_id` | 成片不可覆盖；新合成产生新版本 |
| `QcReport` | `id`、`subject_type`、`subject_id`、`kind`、`status`、`safe_summary` | 原始模型/媒体工具输出脱敏，且结果可追溯到输入资产 |

`CreativeBriefRevision.source_text` 可来自用户直接粘贴，也可指向 C10 产生的文档 Artifact。文档转换与故事规划职责不同：C10 不对故事下结论，C11 不允许任意 URL 或本地路径进入 Planner。

## 4. 状态机与依赖图

### 4.1 Revision

`CreativeBriefRevision`、`ScriptRevision` 与 `StoryboardRevision` 使用统一的审阅语义：

```text
DRAFT -> PLANNING -> READY_FOR_REVIEW -> APPROVED
                               |              |
                               +-> FAILED     +-> SUPERSEDED
```

`APPROVED` revision 不可原地编辑。用户修改故事、节奏、参考素材或某一段内容时，创建新的下游 revision；旧 revision、TaskRun 和 VideoVersion 仅可读取和追溯。

### 4.2 ProductionRun

`ProductionRun` 是整体制作状态，建议状态为：

```text
DRAFT -> PLANNING -> PLAN_READY -> CONFIRMED -> GENERATING -> REVIEWING -> RENDERING -> SUCCEEDED
                                                   |              |             |
                                                   +-> BLOCKED    +-> FAILED   +-> FAILED
```

- `PLAN_READY` 仅表示故事计划完成，未创建视频 TaskRun。
- `CONFIRMED` 由用户“开始制作完整视频”动作进入，并固定这次 StoryboardRevision、允许镜头数和预算边界。
- `BLOCKED` 只表示后续镜头等待前序镜头、交接帧、人工确认或已声明能力；不是 Provider 失败。
- `FAILED` 只表示本次整体制作无法继续。已有接受镜头和旧 VideoVersion 保留。

现有 C09 Shot/TaskRun 状态机完全保留。一个新的 `GenerationSegmentSpec` 实例化为一个可执行 Shot/TaskRun，兼容层可以继续使用 `StoryboardShotSpec` 名称；每个生成片段仍最多一个非终态 TaskRun。不要将 ProductionRun 的 `GENERATING` 映射为某个 TaskRun 的状态，也不要按 NarrativeBeat 数量创建任务。

### 4.3 依赖调度

1. 规划器先建立 NarrativeBeat，再依据 Provider 安全时长、预算和叙事边界将其分组为 GenerationSegmentSpec，并为生成片段建立有向无环图。
2. Scheduler 只为所有前置条件已满足的 GenerationSegment 创建一个 TaskRun。存在交接需求时，前一生成片段成功、QC 通过并形成 HandoffAsset 后，下一生成片段才具备资格。
3. 第 N 个生成片段失败时，只阻塞依赖 N 的后续片段；N 之前已经接受且不受影响的片段不重跑。
4. 用户局部重做第 N 个生成片段时，创建该片段的新 TaskRun/选择结果，并把受影响后续片段标为需要重新规划或重新生成；不修改旧快照。
5. 所有必需生成片段都有已接受结果后，才创建 `RENDER` TaskRun 与 VideoVersion；渲染失败不覆盖片段结果或旧成片。

## 5. Prompt、能力和连续性

`PlanningModelPort` 与 `VideoProviderPort` 是不同端口。前者仅产出 schema 校验的 Script/Storyboard 草案；后者仅接收一个已冻结 Shot 的 VideoGenerationInput。不得借用视频 Provider 处理长文本规划。

```ts
interface PlanningModelPort {
  plan(input: PlanningInput): Promise<StoryboardDraft>;
}

interface StoryboardCompilerPort {
  compile(input: ApprovedShotSpec & {
    stylePreferences: string;
    motionPlan?: MotionPlanDraft;
  }): Promise<PromptPackage>;
}
```

`MotionPlanningPort` 是可选的内部规划端口，不能被浏览器调用，也不能调用 VideoProvider。Planner 输出必须包含 NarrativeBeat 的角色、场景、关键道具、开始/结束状态、事件顺序，再输出 GenerationSegmentSpec 的必要事件集合、时长、参考素材职责和连续性风险；C11.3 再为每个新片段生成冻结的 MotionPlan。`StoryboardCompilerPort` 只针对一个已批准生成片段写执行 PromptPackage，并把冻结的 `stylePreferences`、事实引用和动作时间轴编译为人物身份、服装、场景、角色数、自然人体结构、动作顺序和边界承接约束；它不会公开原始 PromptPackage。

当前 `VideoPromptCompiler` 只保留 C09-C 单 Shot 的“非空描述 + 已保存规格”功能。C11 新的 PromptPackage 不能覆盖它，也不能隐式改变用户原文；需要在内部快照上记录 `prompt_package_id`/版本和 capability snapshot，再由 Worker 构建 Provider 输入。

连续性策略由 `reference_policy` 显式选择：

| 策略 | 发送的视觉输入 | 适用场景 | 限制 |
| --- | --- | --- | --- |
| `REFERENCE_SET` | 1 至 7 张用户上传角色/风格参考图 | 身份、风格或产品一致性优先 | 第 1 段默认使用 |
| `HANDOFF_FIRST_FRAME` | 第 0 位为上一段已接受的 Derived HandoffAsset；第 1 位起最多 6 张用户上传参考图 | 画面切入、动作或地点承接优先，同时稳定身份、服装和场景 | 使用多参考通道表达有序组合，不承诺逐帧无缝 |
| `TEXT_TRANSITION` | 无图，通过场景/转场说明衔接 | 可接受明显转场或 B-roll | 不提供视觉连续性保证 |

系统不能静默把用户参考图丢弃为纯 `HANDOFF_FIRST_FRAME`，也不能在缺少前序交接帧时假装完成连续性。若一个 Shot 同时需要多图身份参考和前段交接，C12 调度器按“交接帧第 0 位 + 用户参考图第 1 位起”的顺序创建内部 Shot/TaskRun；当该策略无法满足能力或素材条件时，必须形成可见风险与建议：改为转场连接、等待交接帧通过 QC，或等待更强关键帧能力认证。

## 6. 公开控制面与事件

以下路由仅为 C11/C12 拟议公共表面；实际字段须先进入 `领域模型与API事件契约.md`、Zod 与 OpenAPI 后才能实现。

| 命令或查询 | 用途 | 幂等与安全 |
| --- | --- | --- |
| `POST /projects/:id/creative-brief-revisions` | 保存故事、总时长、风格和已选素材 | 独立 `Idempotency-Key`；不含 Provider 字段 |
| `POST /creative-brief-revisions/:id/plan` | 创建 PlanningRun，产出 Script/Storyboard 草案 | 同 key 回放同一规划运行；不创建视频任务 |
| `GET /storyboard-revisions/:id` | 读取面向用户的故事计划 | 只返回受控标题、摘要、镜头顺序、时长和风险 |
| `POST /storyboard-revisions/:id/approve` | 冻结计划 | 已批准 revision 不可被原地修改 |
| `POST /production-runs` | 确认后开始完整制作 | 固定 storyboard、镜头数、预算 guard；不接收 prompt/provider |
| `POST /production-runs/:id/segments/:segmentId/regenerate` | 局部重做一个生成片段 | 新 TaskRun/版本，按依赖规则阻塞后续；旧 Shot 路由仅保留 C09 兼容 |
| `GET /production-runs/:id` | 读取整体公开进度 | 不返回队列、Provider、request ID 或对象 key |
| `GET /projects/:id/video-versions` | 读取完整成片版本 | 与镜头片段分开，不将任意成功 TaskRun 当成成片 |

新增内部事件拟议为 `creative_brief.planning_requested`、`storyboard_revision.ready_for_review`、`production_run.confirmed`、`production_run.progressed`、`production_run.blocked`、`handoff_asset.accepted`、`video_version.succeeded` 和 `video_version.failed`。它们必须使用既有 envelope 和 outbox；浏览器 SSE 只得到公开投影，不得到 Provider/模型、输入 prompt、内部 object key、签名 URL、队列或 trace 信息。

## 7. Worker 与媒体运行时

| 组件 | 输入 | 允许职责 | 禁止职责 |
| --- | --- | --- | --- |
| Control API | 公开命令 | 权限、幂等、状态迁移、事务/outbox、公开投影 | 直接调用 Planner、Provider 或渲染器 |
| Workflow Worker | Planning/Production 事件 | 调用 PlanningModelPort、验证 Artifact、构建依赖图、创建符合条件的 Shot 命令 | 直接写未授权的 Provider 请求或绕过 Control API 状态机 |
| Provider Worker | 单个 GenerationSegment 对应的 Video TaskRun | 现有 submit/poll/download/校验/归档恢复 | 规划长文本、推断相邻片段、重复提交已有 request ID |
| Media Runtime | 明确工具命令与已授权 Asset | 抽帧、转场、拼接、字幕、QC、渲染 | 任意本地目录访问、自由工具执行、自己成为数据库事实来源 |

Media Runtime 的每个动作通过受保护的内部 API 接收明确工具名、输入 Asset ID 和受控参数；结果转换为 Asset/Artifact，最终仍由 Control API 写入版本和公开状态。临时帧、媒体文件、原始工具输出和本地目录不能成为可恢复的事实来源。

## 8. 安全、计费和恢复

- 所有 Project、revision、Shot、TaskRun、Asset、ProductionRun 和 VideoVersion 查询都按 `workspace_id` 过滤。
- 原文、文档与参考素材进入 Planner 前必须是同项目已授权的持久化事实；不接受 URL、路径、浏览器文件句柄或未确认 Asset。
- PlanningModelPort 和 Provider 的密钥只由各自服务端适配器读取；公开错误只用应用错误码和可行动文字。
- `ProductionRun` 在确认时冻结本次允许的镜头数和费用上限。未启用 Veyra 时不显示伪造成本；真实模式下必须先通过余额/额度规则，且真实多段调用仍需用户有界授权。
- 每个命令、每个 Shot TaskRun、每个渲染任务和每次扣费都有独立幂等语义。Provider request ID 一经持久化，重启只可查询/下载。
- Planner、QC 和渲染故障有独立错误码与重试策略；它们不能被伪装为视频 Provider 拒绝。

## 9. 迁移与兼容策略

1. 先增加表、关系、schema 与新公开 DTO，不修改现有 Shot、TaskRun、Asset 或 TaskRun 输入快照的既有语义。
2. 现有项目保留“单 Shot 成果”可读视图；只有创建新的 CreativeBriefRevision 后才进入故事计划工作流。
3. Studio 结果区改为读取 VideoVersion 作为“完整成片”，现有成功 TaskRun 视频改为“镜头片段”，避免历史视频丢失或被错误标为最终成片。
4. Feature flag 仅在所有 C11/C12 Mock/fixture 回归通过后开启；停用时停止新计划/ProductionRun，保留已创建数据的只读访问。

## 10. 后端验收矩阵

- 长故事 fixture 按事件边界产生有序 Script/Storyboard；短故事产生一段计划；两者都通过 schema 验证。
- 规划命令在任何成功/失败/重试分支中均为零次视频 Provider POST。
- Storyboard 批准前不能创建 ProductionRun；同幂等键回放不创建第二个 planning 或 production run。
- 每个 StoryboardShotSpec 在 capability 范围内；新 revision 的 MotionPlan 时间轴必须通过结构校验并写入不可变 TaskRun 快照；交接帧和用户参考图必须按有序视觉输入组合，素材缺失或能力不足在创建视频任务前形成可公开的阻塞建议。
- 前段未接受时，依赖 Shot 不可提交；第 N 段重做只影响 N 和依赖它的后续段。
- HandoffAsset 必须是同项目、已验收视频派生的 READY 图片；篡改来源、跨 workspace、过期 relay 或不支持 MIME 全部拒绝。
- Provider Worker、Workflow Worker 和 Media Runtime 重启后均能从持久化事实恢复，且不重复 Planner/Provider/Render 提交。
- VideoVersion 可追溯至 StoryboardRevision、选定镜头、交接帧、Render TaskRun 与 QC；失败渲染不覆盖旧版本。
- 契约、事件和日志扫描拒绝 Provider、密钥、原始 prompt、object key、签名 query、Veyra 字段和内部队列细节进入浏览器。
