# AI 企业内容生产平台：衔接与合成源仓库纠偏开发方案

状态：`IMPLEMENTED_PENDING_AUDIT`（A 方案已落代码并完成本地数据库、Runtime、Worker 与真实片段合成验证；正式章节状态仍以总控/状态账本为准）

版本：`v1.0.0`（2026-09-28）

适用范围：C12/C12.1 的多段视频衔接、顺序合成、音频连续性和最终 VideoVersion 产出。

本文件是执行方案及审计边界。A 方案已由 ADR-0076 选定：`UNAVAILABLE/FAILED -> direct cut + NEEDS_ATTENTION`；实现仅做既有仓储、Worker 和 Runtime 薄壳纠偏，不新增来源没有的 evaluator、评分、阈值、repair 或 Provider 协议。正式章节状态仍需独立审计后再升级。

## 1. 用户目标与非目标

### 1.1 用户目标

1. 多个已通过技术质检的真实视频片段，按规划顺序可靠合成为一个可播放的完整成片。
2. 片段边界使用来源已有的首尾帧、连续性提示和媒体合成能力；能够表达直接剪切、淡变或已有的受控转场。
3. 衔接检查不可用时，不能把“无法检查”伪装成通过，也不能让整条生产链永久卡在 `REVIEWING`。本方案倾向于来源式安全直切并公开 `NEEDS_ATTENTION`，但当前领域/API 契约对未通过语义的淡变与直切存在冲突，必须先完成契约对账；本文件不自行选择最终公开语义。
4. 保留片段顺序、实际媒体时长、音轨和工作区/项目归属；Worker 重启、重复事件和重试不重复提交 Provider 或重复生成修复事实。
5. 任何平台薄壳改动都能指向固定来源文件、符号或规则，并有行为测试证明。

### 1.2 非目标

- 不引入新的视觉语义算法、评分、阈值、自动变速、静默补帧或通用“智能剪辑”算法。
- 不把视觉 LLM 评估器、`HandoffEvaluatorPort`、`HandoffReview`、`TransitionRepair` 宣称为 Huobao、Seedance 或 OpenMontage 的原始代码。
- 不在本章新增 Provider 协议、公开 HTTP 字段、数据库跨模块读取、LLM 导演提示词或新的状态枚举。
- 不把 `UNAVAILABLE`/`FAILED` 改写成 `PASS`，不在评估不可用时凭空创建桥接视频或转场时长。
- 不以本方案解决人工审美、口型、中文听感或真实语义质量认证；这些继续是外部门。
- 不在本轮接入新的外部视觉模型、VPS、Veyra、计费或真实 Provider；真实 Provider 只在实现通过离线门禁后按既有授权流程验收。

## 2. D/I/A 路由与硬边界

本章采用 multi-agent-dev-v2 路由：

| 轴 | 本章结论 | 约束 |
|---|---|---|
| D（设计歧义） | `D0` | 来源只定义媒体工具、提示词连续性和合成选择，不定义统一语义评估器；缺口保持平台可选能力，不扩大来源语义。 |
| I（实现范围） | `I1` | 只调整已有 C12.1 事件消费、合成前置、Runtime adapter 和测试；不新增公开契约。 |
| A（审计风险） | `A1` | 重点审计误把平台自造 evaluator 当来源实现、`all-PASS` 门控、无来源转场阈值、重复 Provider 调用和未授权状态升级。 |

不可越过的验收底线：

1. 来源无法证明的功能标为 `PLATFORM_OWNED`、`UNAVAILABLE` 或 `BLOCKED`。
2. 评估器在本方案不授权生产路径创建或调用；既有实现只能兼容读取历史事实。未来若继续保留，必须另立用户授权 ADR。
3. 不得新增一套与 OpenMontage 决策树平行的转场算法。
4. 只有在 §2.1 契约/ADR 明确选择 source-first 语义后，`UNAVAILABLE`/`FAILED` 才能走来源式安全直切；运行保持 `NEEDS_ATTENTION`，而不是报告 `GOOD`。对账前保持 `BLOCKED`。

### 2.1 领域/API 契约冲突（当前阻断）

当前不能直接进入代码实现。现有契约存在两个相互冲突的硬表述：

- `doc/AI企业内容生产平台_领域模型与API事件契约.md` 约 181–187 行要求语义未通过时采用受限画面/音频淡变，并把 C12 多段合成描述为边界淡变。
- 同一契约约 215–218 行以及现有 C12.1 设计约定 `UNAVAILABLE/FAILED` 只记录 `NEEDS_ATTENTION`、不创建修复，并采用直切。

两者会改变公开 `continuity_status`、composition plan 和最终音频/画面语义，不能由执行员猜测哪一段优先。本方案记录 source-first 倾向：Huobao 的默认 concat 与 OpenMontage 的明确 operation 更接近“没有已验证转场计划即 cut”；但在 ADR/契约正式选定前，所有涉及该分支的实现均为 `BLOCKED`。不得通过增加字段、悄悄修改契约或把直切命名成淡变来规避阻断。

## 3. 固定来源与当前实证

### 3.1 固定来源基线

| 来源 | 固定 commit | 相关文件/符号 | 可引用语义 |
|---|---|---|---|
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/src/services/ffmpeg-merge.ts`：`mergeEpisodeVideos`、concat list、FFmpeg merge | 按 storyboard 序号排序；使用已生成产物；建立 concat 列表；校验工具可用与文件存在；输出标准化 H.264/AAC MP4；保存合成事实。 |
| OpenMontage | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/video_stitch.py`：`_stitch`、`_stitch_cut`、`_stitch_crossfade`、`_stitch_fade_through_black` | 先验证/归一化片段，再按明确 operation 和 transition 合成；`cut` 为顺序 concat；`crossfade`/`fade` 使用 FFmpeg filter；记录输入和 transition。 |
| OpenMontage | 同上 | `skills/creative/video-stitching.md`：Stitching workflow、Transition Selection、Audio Continuity、QA checklist、`edit_decisions` | 根据素材关系选择 hard cut/crossfade/fade-through-black；边界帧检查；分辨率/FPS/色彩/音频电平/总时长/播放检查；跨片段 BGM 作为单轨混音，避免边界突断。 |
| OpenMontage | 同上 | `tests/qa/test_06_video_stitch.py`、`tests/qa/test_05_video_compose.py`、`tests/tools/test_audio_mixer_*.py` | 只证明工具和音频混合行为；不证明存在视觉 LLM evaluator 或统一门控。 |
| Seedance-2.5 | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/long-video.md`：Choose route、Native extension、Extension with a cut or transition、Continuity locks | 同一镜头优先 native extension；新场景使用 intentional cut/new generation；延长只作用于延长部分；明确 source ending/destination opening/physical bridge；只携带必要身份、服装、道具、运动向量、相机阶段、灯光、未完成对白和 exact endpoint。 |
| Seedance-2.5 | 同上 | `skill/seedance-25/references/troubleshooting.md` | 将 continuity/transition/audio 归类排障；逐次只改一个变量；优先从观察到的真实终态继续；文本、mix、trim、color 等优先在后处理中完成。 |

### 3.2 本次真实运行证据

当前工作区最近一次真实测试事实应原样保留，不得扩写为完整验收：

- 真实模型：`sub2api / grok-imagine-video-1.5`。
- 3 个主片段最终全部成功，片段技术 QC 为 `3/3 PASS`，实际时长约 10 秒/段。
- 两个相邻边界写入 `HandoffReview=UNAVAILABLE/EVALUATOR_UNAVAILABLE`。
- ProductionRun 停留 `REVIEWING`，`continuity_status=NEEDS_ATTENTION`，没有 `VideoVersion`。
- `music_plan=OFF`，本次没有验证 BGM、跨段音频混音或最终音轨。
- 首次有两段在参考图 relay 阶段失败，随后通过官方段重试成功；这证明可恢复，不证明首次稳定。

本实证直接暴露的缺口是：`completeHandoffReview` 只有在 `allPassed` 时发出 `composition_requested`，与现有文档和 composition input 已经实现的 `UNAVAILABLE/FAILED -> PASS 直切`分支不一致。

## 4. 来源矩阵：允许移植、薄壳与禁止声称

| 目标能力 | 来源事实 | 可直接移植/等价调用 | 平台薄壳 | 不可声称 |
|---|---|---|---|---|
| 有序 concat | Huobao `mergeEpisodeVideos`；OpenMontage `_stitch_cut` | 按主片段 sequence 排序、建立受控 concat 输入、统一输出 | 对象存储 bytes/asset metadata、workspace/project 查询、事件幂等 | “来源提供语义连续性判定” |
| 过渡合成 | OpenMontage `_stitch_crossfade`/`_stitch_fade_through_black` 与 Transition Selection | 仅对已有 composition plan 选择来源支持的 `cut`/`crossfade`/`fade` | 把已验证 Asset IDs 映射为 Runtime 字节，不暴露路径/ffmpeg 参数 | 自造评分、默认时长、自动选桥接内容 |
| 首尾帧检查 | OpenMontage `frame_sampler`/`video-stitching.md` 边界检查规则；平台已有 `EXTRACT_BOUNDARY_FRAMES` | 抽取相邻片段真实尾帧/首帧并持久化受控派生 Asset | 权限、哈希、MIME、大小、生命周期 | “首尾帧检查等于语义 PASS” |
| 原生延长 | Seedance `long-video.md` Native extension | 若 Provider profile 已认证 extension，使用已接受源视频和仅针对延长部分的提示 | Provider adapter 的字段 mapper、request ID、重试恢复 | 未认证时伪造 extension 或把独立片段合成称为 extension |
| 连续性提示 | Seedance `Continuity locks` 与 extension/cut template | 在已有 PromptPackage 中保留真实 source ending/destination opening/locks | 只传已批准的段级事实，保持参考图原序 | 新增“全片锁”推断或重写用户源文案 |
| 音频连续性 | OpenMontage `video-stitching.md` Audio Continuity、audio_mixer tests | 来源片段音轨保留；跨段 BGM 作为一条 track；边界按已支持 fade/duck/mix 执行 | AudioPlan/Asset ownership 映射和字节校验 | 自造响度阈值、自动 TTS、静默补音 |
| HandoffReview 审计记录 | 三个来源均无同名实体，但现有领域/API 契约已规定平台审计薄壳 | 本章新写仅允许唯一的 `UNAVAILABLE`/`FAILED` 安全审计事实；`PASS`/`BLEND`/`BRIDGE_REQUIRED` 只能兼容读取已有历史记录，不承担来源语义判定 | workspace/project/boundary、事件幂等、安全摘要和状态投影 | 不能写成 OpenMontage/Seedance/Huobao 的能力 |
| 语义视觉 evaluator | 三个来源均无对应实现 | 本章不移植、不创建或调用；仅兼容读取已有 HandoffReview 历史事实 | 不新增配置、输入/输出或生产回退 | 不能写成 OpenMontage/Seedance/Huobao 原码 |
| TransitionRepair 领域记录 | 三个来源均无统一实体/事件 | 只兼容读取已有历史记录，本章不新写 repair | 兼容读写和审计投影 | 不能声称来源提供自动 repair 或桥接算法 |

## 5. 删除、禁用与保留清单

### 5.1 生产路径必须删除或禁用的门控

1. `completeHandoffReview` 中 `allPassed` 才发 `compositionRequestedEvent` 的硬门。
2. 任何“没有 evaluator 就不允许合成”的分支。
3. 任何把 `BLEND`/`BRIDGE_REQUIRED` 自动变成已接受 Repair、而没有 Runtime 产物和 QC receipt 的路径。
4. 任何根据分数、相似度、默认时长或未来源阈值推导转场的逻辑。
5. 任何在 `UNAVAILABLE`/`FAILED` 时自动创建新 Provider 任务或重新提交主片段的路径。
6. 任何把 `UNAVAILABLE` 或 `FAILED` 重写为 `PASS`、`GOOD` 或 `ACCEPTED` 的投影。

### 5.2 审计薄壳与禁止新增的历史能力

- `HandoffReview` 是现有领域/API 契约允许的最小运行时审计记录，不是来源能力，也不承担语义判定。本章仅允许按既有 `handoff_review.requested/completed` 事件写入唯一的 `UNAVAILABLE`/`FAILED` 安全审计结果；`PASS`/`BLEND`/`BRIDGE_REQUIRED` 只能兼容读取已有历史记录，本章禁止创建或判定这些结果。来源登记必须标 `PLATFORM_OWNED`。
- `HandoffEvaluatorPort` 与 `OpenAiCompatibleHandoffEvaluator` 不是来源代码；本章不授权生产路径创建或调用 evaluator。没有 evaluator 时不提取边界帧、不调用视觉模型，直接消费现有 requested event 并写 `UNAVAILABLE`（契约冲突未解决时仍保持 `BLOCKED`）。
- `TransitionRepair` 表和事件只能兼容读取已存在记录；本章不创建新的 repair。未来若要继续生产调用或创建 repair，必须另立用户授权 ADR，证明来源能力、Runtime 产物、QC 和幂等事实。
- 前端可以显示“衔接检查未完成/需要人工注意”，但在契约冲突解决前不得承诺直切或淡变，也不能显示“已自动修复”。

### 5.3 必须保留的事实

- 主片段顺序、源 Asset、sha256、MIME、ffprobe duration。
- `HandoffReview` 的安全结果和 `NEEDS_ATTENTION` 状态。
- 每个 boundary 的 idempotency、event_id、重启恢复和历史审计。
- Provider request ID；评估不可用不得触发重复视频提交。

## 6. 精确代码落点与实施顺序

本节只给执行材料，执行员不得超出列出的文件和行为范围。

### Step 0：来源/契约冻结（先做）

- 读取本方案、C12.1 设计、领域/API 契约及当前 diff。
- 在来源登记中记录上述固定 commit 和“evaluator/repair 为 PLATFORM_OWNED”边界。
- 不改公开 DTO、事件枚举或数据库字段；如实现发现必须改变，先停为 `BLOCKED`，提交 ADR 再决定。

### Step 1：仓储状态机纠偏

目标文件：`packages/persistence/src/production-repository.ts`。

- **前置阻断**：先完成 §2.1 的 ADR/契约对账；在对账完成前，Step 1 不得修改生产状态语义。
- 在 `completeHandoffReview`（约 2837–2928）保留 review 写入、`decideContinuityRepair` 和 `NEEDS_ATTENTION`，不创建/调用 evaluator 或 repair。
- 对账通过后，才可把“全部 review 已完成”作为 composition 触发条件，而不是 `allPassed`；最终采用 cut 或受限淡变必须严格按 ADR/契约选定的唯一语义。此处的 `PASS`/`BLEND`/`BRIDGE_REQUIRED` 仅是已有历史 review 的兼容输入，本章不创建或判定。
- `BLEND`/`BRIDGE_REQUIRED` 没有来源支持且已接受的实际 Runtime plan 时必须保持 `BLOCKED/NEEDS_ATTENTION`，不能自动创建或伪造 repair；本章不写入这两类新结果。
- `UNAVAILABLE`/`FAILED` 是本章允许新写的唯一 review 结果；只能在契约明确选择 source-first 直切后记录 `NEEDS_ATTENTION` 并发出现有 `video_version.composition_requested`，否则保持 `BLOCKED`，不猜测。
- `packages/persistence/src/production-repository.ts:3277-3315` 的 `handoff_review.requested` 消费分支当前按 review 数量达到预期就直接插入 composition event，重复事件可能重复插入。必须复用现有 `lockProductionRun` + `outboxEvents` 查询 `workspaceId`、`projectId`、`aggregateType="production_run"`、`aggregateId=run.id`、`eventType="video_version.composition_requested"` 只插一次；同一批次只允许一个 composition event，不得新增 schema/公开协议或依赖日志去重。

### Step 2：组成输入与 Runtime 复核

目标文件：

- `packages/persistence/src/production-repository.ts:2837-2928` 的 `completeHandoffReview` 与 `:3277-3315` requested failure branch。
- `packages/persistence/src/production-repository.ts:2200-2565` 的 `findProductionCompositionInput`。
- `apps/production-worker/src/media-service.ts:414-462` 的 handoff review consumer；无 evaluator 时不读帧、不调用模型，直接提交 `UNAVAILABLE` 审计记录。
- `services/media-runtime/runtime.py:_openmontage_transition_plan:2104-2147` 与 composition handler `:2541`；现有函数已经对 mixed transition/duration 做 source `video_stitch` fail-closed，不得声称需要新算法。

要求：

- 保持当前对 `UNAVAILABLE/FAILED` 的 `transitions.push("PASS")` 直切分支仅作为待契约对账的候选实现；不改名为语义 PASS。契约未选定前该分支必须标 `BLOCKED`，不得进入生产。
- 主片段按 sequence 排序；每段实际 bytes/MIME/SHA/duration 重新校验。
- Runtime 只接收受 schema 限制的 composition plan/bytes，不接收任意 ffmpeg 参数、Provider URL 或本地路径。
- 依据 OpenMontage `cut`/`crossfade`/`fade` 实现已有 plan；不在本轮增加新的 transition type。OpenMontage `video_stitch` 单次 operation 只表达一个 `transition` 与一个 `transition_duration`；若多个边界需要不同 transition/时长而当前 Runtime/来源工具无法表达，必须 `BLOCKED/fail-closed`。只有已验证的现有 `video_compose` cut-level 能力才可使用，禁止新增 per-boundary 算法。
- 失败只写 `video_version.failed`，不重新提交主片段；可从同一 composition event 安全重试。

### Step 3：Production Worker evaluator 边界

目标文件：`apps/production-worker/src/handoff-evaluator.ts`、`media-service.ts`、`index.ts`。

- 本章不授权 Production Worker 创建或调用 evaluator；`HandoffReview` 仍可按现有契约写入唯一审计记录，但 evaluator/视觉判定只能兼容读取已有历史事实。
- `handoff-evaluator.ts` 的协议错误/网络失败历史结果按 `FAILED`/`UNAVAILABLE` 保存，不能放宽 schema、不能猜测 PASS；本章不重新启用 evaluator，未来若需启用必须另立用户授权 ADR。
- Media Worker 在 `media-service.ts:414-462` 无 evaluator 时不提取边界帧、不调用视觉模型；直接以既有 requested event 写入 `UNAVAILABLE`，然后按 §2.1 契约结果继续编排或保持 `BLOCKED`。
- Media Worker 不因本章新增视觉比较、评分、retry 次数或自动回退；已有首尾帧派生仅按来源和契约需要保留。
- 启动日志不得出现 key、URL query 或原始回答；检查实际消费事件的 Worker，避免旧进程抢事件。

### Step 4：OpenMontage/Seedance/Huobao 薄壳适配

目标文件按现有模块定位，不得复制完整上游仓库：

- Huobao `ffmpeg-merge.ts` 的顺序/输入存在性/concat/标准编码语义，映射到平台 Runtime adapter。
- Huobao 允许“部分拼接、跳过未生成镜头”的公开剧集语义不适用于平台 ProductionRun；平台缺段必须拒绝合成并保持可重试，不能照搬 skip。
- OpenMontage `video_stitch.py` 的 operation/transition/normalize/音轨映射，保持原调用顺序。
- OpenMontage `video_stitch` 单次 operation 的 `transition`/`transition_duration` 是全局单值；混合边界或不同 duration 若当前 Runtime/来源工具无法表达，必须 `BLOCKED/fail-closed`，不得在平台新增 per-boundary 选择算法。
- OpenMontage `video-stitching.md` 的边界检查和 QA 项变成内部验证清单，不变成新算法。
- Seedance `long-video.md` 的 native extension 只在 Provider profile 明确支持且 source asset 已接受时可选；否则走 intentional cut/new generation，不伪造 extension。
- Seedance continuity locks 只进入已有 PromptPackage source facts，不新增对象推理、关键词评分或段间重写。

### Step 5：测试与文档对账

- 先改定向测试，再运行包测试；不为“全绿”删除能证明 source-first/fail-closed 的负向测试。
- 同步章节审计记录、来源登记和 progress/test-log，区分 `IMPLEMENTED`、`READY_FOR_AUDIT`、`ACCEPTED`、`BLOCKED`。
- 测试计数只记录最新实际运行值，保留 skip 和外部未测边界。

## 7. 目标状态机（契约对账后的候选状态机）

### 7.1 HandoffReview 处理

```text
全部主片段技术 QC 通过
  -> 为每个相邻 boundary 写 handoff_review.requested
   -> 每个 review 完成并持久化（本章新写仅 UNAVAILABLE/FAILED；PASS/BLEND/BRIDGE_REQUIRED 仅兼容读取既有历史记录）
  -> 所有 review 完成
       ├─ 全部 PASS（仅已有历史记录）
       │    -> continuity_status=GOOD
       │    -> composition_requested
       ├─ 有 BLEND/BRIDGE_REQUIRED 且有既有合法 ACCEPTED repair/plan（仅已有历史记录）
       │    -> 使用该 plan
       │    -> continuity_status=NEEDS_ATTENTION 或既有安全状态
       │    -> composition_requested
       ├─ 有 BLEND/BRIDGE_REQUIRED 但没有合法 repair/plan
       │    -> 不创建 repair；在领域/API 契约完成对账前保持 BLOCKED
       └─ 有 UNAVAILABLE/FAILED
            -> continuity_status=NEEDS_ATTENTION
            -> 不创建 repair、不伪造 PASS
            -> composition_requested
            -> Runtime hard cut
```

上图只有在 §2.1 ADR/契约选定唯一语义后才能实现；对账前不授权任何生产状态迁移。对账后，`composition_requested` 是“所有 review 已落库”的编排事实，不是语义通过事实。`VideoVersion.succeeded` 仍必须经过 Runtime 产物、媒体 QC、对象存储写入及既有状态机；任何失败都不得发布可下载结果。

### 7.2 原生延长与独立片段

```text
Provider profile 支持 native extension 且源视频已 ACCEPTED
  -> 采用 Seedance native extension，新增提示只作用于延长部分
Provider 不支持或能力未认证
  -> 不伪造 extension
  -> 按故事规划生成独立片段
  -> 采用 OpenMontage/Huobao 顺序合成
```

### 7.3 参考图与交接帧顺序

- 用户参考图保留原始 binding position/role 顺序。
- C12 内部交接帧只能作为下一段的内部 `HANDOFF/FIRST_FRAME` 输入，不能回写为用户新素材。
- 首尾帧提取必须来自同一 workspace/project、同一 accepted segment，哈希和 MIME 可验证。
- 不把交接帧推断为人物、道具或场景对象，也不重新排序其他参考图。

## 8. OpenMontage 对齐的转场与音频决策

仅使用来源已定义的决策树：

| 边界事实 | 计划 |
|---|---|
| 同一场景/连续动作、无明确时间或主题跳转 | `cut` / concat |
| 主题变化、时间经过、柔和情绪变化 | `crossfade` |
| 明确段落开始/结束或重大场景断裂 | `fade-through-black` |
| 需要音频连续 | 依 OpenMontage audio mixer 作为单轨处理，避免每段独立截断；不得自造 duck/fade 数值 |
| 来源存在不同 FPS/编码/分辨率 | 先按 OpenMontage normalize/ffprobe 语义归一化，再 stitch |

实际执行必须依赖已经存在的 composition plan。没有来源事实或已批准 plan 时，不凭空选择 transition；最小安全行为是 `cut` 并标 `NEEDS_ATTENTION`。

重要能力边界：OpenMontage `video_stitch` 的一次调用只有一个全局 `transition` 和一个 `transition_duration`，不是任意边界的转场计划解释器。若同一成片的不同边界需要不同 transition 或不同 duration，而当前平台已有 Runtime/`video_compose` 无法表达，必须在输入侧 `BLOCKED/fail-closed`；不能把多次调用、隐藏默认值或字符串拼接包装成新算法。只有已验证的现有 cut-level `video_compose` 能力可以在契约允许时使用。

总时长必须以实际 ffprobe 时长和已声明的 overlap/transition 为准。不得使用未来源的“默认 2 秒桥接”“相似度阈值”或自动拉伸掩盖时长不符。

## 9. 测试矩阵

### 9.1 Domain 单测

- 已有历史 `PASS` -> 仅验证兼容读取映射为 `GOOD`、无 repair；本章不创建或判定 `PASS`。
- 已有历史 `BLEND`/`BRIDGE_REQUIRED` -> 只验证兼容读取，不生成实际 repair；没有 ADR/契约选定的执行语义时必须 `BLOCKED`，本章不创建或判定这两类结果。
- `UNAVAILABLE`/`FAILED` -> 不伪造 PASS；在契约未对账时 `BLOCKED`，对账通过后才验证 `NEEDS_ATTENTION` 与来源式直切。
- 结果枚举、理由码、摘要脱敏和幂等不变。
- 当契约同时声明“受限淡变”和“UNAVAILABLE 直切”时，Domain/编排测试必须阻断实现进入生产，而不是任选其一。
- `HandoffReview` 作为现有平台审计薄壳可写入一次安全结果，但不能由 Domain 测试推导任何来源语义通过。

### 9.2 Persistence/仓储集成

- 2 段/3 段全部 review 为 `UNAVAILABLE`：所有 review 落库后只发一个 `composition_requested`，run 不停在 `REVIEWING`，不写 repair。
- 混合已有历史 `PASS` + 本章新写 `UNAVAILABLE`：仍发一个 composition event，continuity 为 `NEEDS_ATTENTION`；不得新写 `PASS`。
- 重复 `handoff_review.completed` 与重复 `handoff_review.requested`：不重复 review、不重复 composition event；复核 `(workspace_id, production_run_id, event_type)` 的现有 outbox/事务事实。
- `HandoffReview` 活动薄壳：同一 boundary 只允许一条审计记录，本章只写 `UNAVAILABLE/FAILED` 安全摘要，不产生 evaluator/repair 事实；`PASS/BLEND/BRIDGE_REQUIRED` 仅读取历史。
- `BLEND`/`BRIDGE_REQUIRED` 无 ACCEPTED repair：不伪造 repair 或 PASS，契约对账前必须记录 `BLOCKED`。
- `video_stitch` 混合边界/不同 transition duration 超出单次 operation 表达能力：`BLOCKED/fail-closed`；不得静默拆成自造 per-boundary 算法。
- 复合工作区/项目边界、非法序号、缺段、重复边界 fail-closed；缺段不得照搬 Huobao 的部分拼接跳过语义。

### 9.3 Worker/Runtime

- 无 evaluator：不提取首尾帧、不调用视觉模型，直接以既有 requested event 写唯一 `UNAVAILABLE` 审计记录；契约对账前不得据此进入生产合成。
- evaluator 协议错误：保留历史 `FAILED` 事实，不重试或新增 Provider submit；重新启用 evaluator 必须另立 ADR。
- Runtime `cut`、`crossfade`、`fade` 分别使用固定离线媒体 fixture，验证可播放、顺序、音轨和实际时长。
- 缺 MIME/SHA/ffprobe/对象或跨项目 asset：拒绝合成。
- Worker 重启、过期 lease、重复 outbox 不增加 Provider submit/repair 次数。
- 缺失 boundary source、跨项目 asset 或缺段时，HandoffReview/合成均拒绝；不得照搬 Huobao 的 skip。
- `video_stitch` mixed transition/duration fixture 必须触发既有 `_openmontage_transition_plan` fail-closed，而不是新增拆分调用。

### 9.4 跨层/真实 fixture

- 3 个真实已生成片段 + 两个 `UNAVAILABLE` review：在契约对账并选择 source-first 直切后，才可验证最终获得可播放 VideoVersion，公开状态为 `NEEDS_ATTENTION`；对账前应保持 `BLOCKED`。
- 真实 Grok 仅在本地得到用户授权后执行；记录 profile、次数、参数、request ID 脱敏摘要，不把 key/签名 URL 写入报告。
- 本轮原测试使用 `music_plan=OFF`；若要验收 BGM，另开明确测试矩阵并使用 `AUTO/MANUAL` 事实，不能把本轮结果扩写。

## 10. 真实 Provider 验收步骤

1. 确认控制面、Production Worker、Media Runtime 都来自同一工作区版本；清理旧 worker 前保留监听端口进程并校验 PID。
2. 使用一个已批准的 30 秒项目和已有 READY 参考图；记录新 `ProductionRun`，不修改旧快照。
3. 先执行 3 段/3 段技术 QC；确认 provider request ID 已持久化，重启不重复 submit。
4. 先验证 §2.1 ADR/契约已选定唯一语义；未完成时不得进行真实合成验收。若最终选定 source-first 直切，再让历史 `UNAVAILABLE` 事实验证可播放 VideoVersion 和 `NEEDS_ATTENTION`。
5. 本章不单独认证或调用 evaluator；如用户另行授权，必须另立 ADR、固定来源/能力证据和独立测试，不得用一次 PASS 推导永久能力。
6. 使用 `ffprobe` 检查最终分辨率、帧率、时长、音轨；检查中间 review、composition plan、资产哈希和事件去重。
7. 如最终合成失败，只允许重试 composition，不重新提交已成功 Provider 片段；保存失败原因和可恢复状态。

## 11. 回滚与风险

### 11.1 回滚

- 代码回滚必须使用版本化提交或工作区保存点，禁止 `git reset --hard`/覆盖用户改动。
- 数据回滚只通过已有迁移/事务和幂等事件；不删除历史 `HandoffReview`、旧 VideoVersion 或 ProviderAttempt。
- 若新 composition path 未通过，临时关闭该章节生产入口，保留片段和 review，禁止回退到“评估不可用即伪造 PASS”。

### 11.2 风险登记

| 风险 | 处理 |
|---|---|
| 来源没有语义 evaluator | 标 `PLATFORM_OWNED/UNAVAILABLE`；不把它变成合成硬门。 |
| OpenMontage transition 仅有工具/规则，未覆盖全部媒体编码 | 对未覆盖输入 fail-closed，使用已有 normalize/ffprobe；不猜测。 |
| Provider 不支持 native extension | 使用独立片段 + 顺序合成；不伪造 extension。 |
| relay 首次失败 | 单独调查 relay/重试；不得把一次成功称为稳定。 |
| BGM/TTS 未在本轮验证 | 保留为独立证据缺口，不能混入衔接验收。 |
| 旧 worker 抢事件 | 启动前 PID/端口核验，事件 consumer lease 和日志确认。 |
| 契约双重语义 | ADR/领域契约没有选定淡变或直切前，所有相关实现与真实验收保持 BLOCKED。 |
| 组合事件重复 | `handoff_review.requested` 消费分支不能只按 review 数量发事件；必须复用 workspace/run/event_type 的现有 outbox/事务事实。 |
| 单次 stitch 无法表达混合边界 | 直接 BLOCKED/fail-closed；不新增 per-boundary 算法，不照搬 Huobao 缺段跳过。 |

## 12. 退出门与明确阻断项

### 12.1 实现退出门

- [ ] `completeHandoffReview` 不再以 `allPassed` 作为 composition 前置门。
- [ ] 领域/API 契约先完成 §2.1 对账并通过 ADR；未完成时实现保持 BLOCKED。
- [ ] 仅在契约选定 source-first 直切后，`UNAVAILABLE/FAILED` 才经过既有 composition input 分支并保持 `NEEDS_ATTENTION`。
- [ ] 生产路径没有新增/调用 evaluator；没有新增评分、阈值、桥接时长或 Provider 协议。
- [ ] OpenMontage/Huobao/Seedance 来源映射登记到固定文件/符号/commit。
- [ ] Domain、仓储、Worker、Runtime 和跨层行为测试全部通过，skip 单独记录。
- [ ] 重启/重复事件/失败重试不重复 Provider submit 或 repair。

### 12.2 不能在本章伪造为完成的事项

- 未配置/未认证的真实视觉 evaluator：`UNAVAILABLE`，不是 `PASS`。
- 任意复杂转场、连续旁白跨非 cut 镜头、自动变速或补静音：`DEFERRED/BLOCKED`。
- 真实 BGM 自动匹配、Pixabay 下载、Doubao TTS：不属于本次衔接纠偏证据。
- 人工审美、口型、中文口音和完整多模态质量：外部门。
- 未经用户授权的真实 Provider/VPS/计费调用：停止并等待授权。

只有当契约对账完成、12.1 全部通过并由独立审计员确认，章节才可进入 `READY_FOR_AUDIT`；通过真实 Provider 还不能直接把本章节标为 `ACCEPTED`，必须同步测试日志、来源登记、章节审计记录和未完成硬门。

## 13. 自审结论（实现后对账）

上一版文档的契约阻断已由用户选择 A 并以 ADR-0076 固化，本轮实现与独立审计结果如下：

1. Huobao、OpenMontage、Seedance 的可复用内容均定位到固定 commit 的具体文件/符号/规则。
2. 明确区分了来源媒体能力与平台自造 `HandoffEvaluatorPort`/`TransitionRepair`；没有把平台扩展伪装成原仓库逻辑。
3. 已修复真实故障：所有 review 完成但 `allPassed=false` 时仍会发唯一 `composition_requested`，运行不再永久停在 `REVIEWING`；`UNAVAILABLE/FAILED` 保持 `NEEDS_ATTENTION` 并采用既有 cut。
4. 生产 Worker 不装配 evaluator；没有新增评分、阈值、repair、Provider 协议或静默回退。重复完成、失败和 composition retry 均复用 workspace/project/run/event_type 事实去重。
5. 实测证据：Persistence `107/107`（启用本地 PostgreSQL）、Production Worker `78/78`、Media Runtime `141 passed + 7 subtests`、相关 typecheck 和 `git diff --check` 通过；真实已有 Grok 片段重试合成生成 `VideoVersion SUCCEEDED`，时长 `30.125s`、`848x480`、H.264/AAC，公开 continuity 为 `NEEDS_ATTENTION`。
6. 独立审计结论为实现语义 PASS、证据可复核；正式章节仍保持 `IMPLEMENTED_PENDING_AUDIT`，未宣称 `ACCEPTED`。人工审美、复杂转场、BGM/TTS、VPS 和其它章节硬门不属于本轮证明。

本轮状态：`IMPLEMENTED_PENDING_AUDIT`。实现、离线审计、数据库行为测试及真实片段合成已完成；正式章节需按总控文档同步测试日志/来源登记并由独立审计员决定是否进入 `READY_FOR_AUDIT`。
