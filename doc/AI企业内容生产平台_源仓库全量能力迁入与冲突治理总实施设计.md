# AI 企业内容生产平台：源仓库全量能力迁入与冲突治理总实施设计

状态：`DRAFT_FOR_USER_REVIEW`。本文件是后续多章节实施的总设计，不改变当前任何运行状态、公开 API、数据库 schema 或 Provider 配置。文中的 `P0...P8` 是依赖阶段，不是已登记的正式章节号；正式实施前必须先更新《AI企业内容生产平台_正式开发总控文档.md》的章节注册、依赖与 Exit Gate，然后一次只启动一个章节，并为公共契约变化补 ADR、迁移和版本化测试。

> **2026-09-01 语音路线专项覆盖（SUPERSEDED）**：本文中将 `PLATFORM_NARRATION` 作为当前 Grok/Sub2API 方案、把 Piper 作为本地默认降级，或把 Provider dialogue 统一静音的路线文字，均属于旧总设计提案，现由《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》覆盖。现行必须先依据固定来源能力决定唯一 audio owner：已认证 native-audio Provider 保留其音轨；否则按 OpenMontage `TTSSelector`/样音 gate 选择具体 TTS。当前自动旁白不要求用户上传音频/样音，样音由服务端生成并经人工审批；通用参考、资料和 MUSIC 上传仍保留。本文的领域模型候选、质量门禁、自然时长和 fail-closed 目标仍保留为历史设计，但不得据此新增字段、协议、状态或外部调用。

> **2026-09-01 当前执行覆盖**：本文件仍是历史总设计，不单独授权章节开发。自动旁白只走服务端生成/Provider 原生音轨，不以用户上传 spoken audio 为前置；默认与 CI 仍为 Mock，最新执行文档的本机 Grok/Doubao 对照是唯一例外。凡本文旧段落把上传旁白或 Piper 默认写成现行流程，均标记为历史/兼容并以最新执行文档为准。

## 1. 目标

将当前已验证的本地内容制作闭环升级为可解释、可恢复、可验收的企业级工作流。迁入目标不是复制源仓库的 Agent、Backlot、项目目录或页面状态，而是吸收其已验证的规则、Artifact 语义、质量门禁和恢复机制，并保持平台自己的以下边界：

```text
Web -> Control API -> Domain / Persistence / Contracts
Worker -> Domain / Persistence / Provider / Storage / Contracts
Media Runtime -> Internal API only
```

本轮重点解决已经暴露的质量缺口：

1. 旁白文本、发音、停顿、音色、实际时长和画面切点没有形成闭环。
2. 成片终检能判断容器和粗略转写，但不能可靠地决定重做旁白、重剪、重生成镜头或阻断发布。
3. 视频类型、交付承诺、渲染器、口型同步能力和降级路径没有在制作前冻结。
4. 企业资料仍以受限 Markdown 全文进入 Prompt，缺少可追溯事实包和冲突处理。
5. 角色、场景、关键道具的契约字段部分存在，但实体库、去重、参考资产和全链路绑定不完整。

## 2. 来源范围与取舍

| 来源 | 必须迁入的高价值能力 | 明确不迁入 |
| --- | --- | --- |
| Huobao Drama | 剧本到场景/角色/道具的分层；8-15 秒段；台词容量；段内 3 秒时间轴；台词来源约束；实体去重 | 短剧业务表、MySQL、进程内轮询、直接 Provider 调用、页面密钥 |
| Seedance 2.5 | 参考素材按维度单一归属；声音策略；时间轴；原生长视频、延长、视频编辑、音频/视频参考的能力认证模型 | 将文档中任一能力当作所有 API/profile 的默认能力；未认证请求字段 |
| MarkItDown | `convert_stream`、格式探测、标准 Markdown 输出、安全边界 | URL/本地路径转换、插件、MCP 进程、任意网络访问 |
| OpenMontage | Delivery Promise、Proposal/Script/Asset/Edit/FinalReview Artifact 语义；TTS selector/样音；实际时长反馈；字幕；音频编排；视觉 QA；Avatar/lip-sync 路由；恢复和质量决策 | Backlot、自由 Agent、project_dir、events.jsonl、文件路径作为事实源、未认证 Provider |
| sub2api-video-mcp | 提交/轮询/下载协议、离线夹具、错误归一化 | MCP 进程状态、Provider 凭据、直接浏览器调用 |
| 本地 Alchemy / Sub2API | Veyra 身份、账户、扣费幂等、成功后 debit、receipt 语义 | 用户/余额表、Cookie、JSONL 账本、固定价格、生产环境配置 |

## 3. 当前基线与确认缺口

### 3.1 已可复用的基础

- 工作区隔离、命令幂等、TaskRun/ProviderAttempt、Outbox、Worker 恢复和对象存储边界已存在。
- `MotionBeat`、参考角色、关键道具锁、交接帧、分段技术 QC、合成、共享配乐、Piper 旁白、faster-whisper 转写和局部恢复均已落地。
- 已存在 `VoicePerformance`、`DeliveryCue`、`NarrationCue`、`MediaRuntimeCompositionPlan` 等内部 schema。
- 已存在 `CONTINUOUS_NARRATION` 和“成片失败只重试合成”的恢复路径；该恢复不得产生新的 ProviderAttempt。

### 3.2 不能再被视为已完成的能力

| 缺口 | 已观察事实 | 根因 |
| --- | --- | --- |
| 播音稿断句/读音 | 引号进入 cue；`10点41分`、`0.4秒`、`AI` 原样交给 Piper；分号和逗号形成机械短停顿 | 文本提取、播音稿规范化、发音词典和 TTS 参数之间没有 mapper |
| 节奏与画面错位 | 文案按字符数平均分给 15 秒视觉段，实际音频时长却是不同的 | 规划发生在真实 TTS 之前，绝对时间轴只绑定视频段起点 |
| 质量“通过”不代表自然 | 转写容错可避免 ASR 误报，但会掩盖读音/节奏问题 | QC 缺少 canonical spoken script、样音、人类批准和严重度路由 |
| 正面说话口型 | 当前只有无说话画面 + 后期旁白的降级路径 | 没有认证的 talking-head/lip-sync Provider 或音素级验收 |
| 企业资料事实 | Markdown 截断并重复进入 Prompt；C11.2 仍为 `PENDING` | 没有知识修订、事实定位、冲突处理和按段事实包 |
| 交付承诺 | `promise_preservation` 当前是固定的 ffmpeg 通过值 | 未冻结视频类型、真实运动要求、渲染器和允许降级 |
| 字幕与视觉文字 QA | 转写存在，但字幕默认 `NOT_EXPECTED`；文字可读性/品牌 OCR 未实检 | 未引入字幕资产和文字/叠加层质量路径 |

## 4. 目标工作流

```text
受控资料 -> Fact Context -> Delivery Plan -> Canonical Script
  -> Spoken Script / pronunciation map -> TTS sample -> human or preset approval
  -> measured narration assets -> Timeline Plan -> Storyboard / PromptPackage
  -> ProductionRun snapshot -> Provider segments -> composition / captions / QC
  -> recoverable decision: present | revise narration | revise edit | regenerate segment | block
```

任何箭头都必须由版本化 Artifact、数据库事实或内部事件承载；不得由浏览器 store、临时目录、模型上下文或 Provider 原始响应承担。

## 5. 新的内部领域模型

### 5.0 所有新实体的强制平台契约

本章中的 Revision 不是 Worker 内 JSON，也不是 OpenMontage 项目目录文件。每个新实体必须至少具有：

```ts
type ScopedRevision = {
  id: string;              // 采用实体前缀 ULID
  workspace_id: string;
  project_id: string;
  revision: number;
  status: string;
  source_revision_id?: string;
  created_at: string;
  updated_at: string;
};
```

共同不变量：

1. 所有 Repository 查询先以 `workspace_id + project_id` 过滤；不能查到后再补权限判断。
2. 被 ProductionRun 引用后版本不可变。修订必须新建 Revision，绝不原地修改文本、时间轴、批准结论或 Provider 参数。
3. 每个创建、批准、拒绝、重试和恢复命令使用 `Idempotency-Key`；同键不同 body 返回 `IDEMPOTENCY_CONFLICT`。
4. 状态推进、版本关系和 outbox 事件在同一数据库事务内写入。媒体二进制、词级时间戳和字幕放 Asset/派生 Asset，数据库只保存受控元数据、哈希和关系。
5. 未完成或被拒绝的 Revision 不能被 Workflow Worker、Production Worker 或 Provider adapter 当作生产输入。

新增实体的迁移必须同时定义：Drizzle schema/迁移、Repository、Zod schema、内部事件、公开安全投影、权限检查、dedupe unique index、失败恢复和历史兼容读法。缺其中任一项不得进入实现。

### 5.1 DeliveryPlanRevision

在创建 `ProductionRun` 前冻结一份私有 `DeliveryPlanRevision`，不修改已批准的 CreativeBrief/Storyboard。建议字段：

```ts
type DeliveryPlanRevision = {
  id: string; // dpr_
  workspace_id: string;
  project_id: string;
  creative_brief_revision_id: string;
  promise_type: "MOTION_LED" | "DATA_EXPLAINER" | "SCREEN_DEMO" | "AVATAR_PRESENTER" | "HYBRID" | "LOCALIZATION";
  motion_required: boolean;
  renderer_family: "SOURCE_VIDEO" | "MOTION_GRAPHICS" | "PRESENTER" | "SCREEN_CAPTURE" | "HYBRID";
  render_runtime: "FFMPEG" | "REMOTION" | "HYPERFRAMES";
  audio_mode: "PLATFORM_NARRATION" | "PROVIDER_DIALOGUE" | "USER_SOURCE_AUDIO" | "SILENT";
  lip_sync_requirement: "FORBIDDEN" | "OPTIONAL" | "REQUIRED";
  caption_policy: "REQUIRED" | "OPTIONAL" | "OFF";
  duration_policy: "FLEXIBLE" | "EXACT";
  target_duration_seconds: number;
  min_duration_seconds: number;
  max_duration_seconds: number;
  approved_fallback?: "VOICEOVER_GRAPHICS" | "STILL_LED";
  quality_floor: "DRAFT" | "PRESENTABLE" | "BROADCAST";
};
```

规则：

- `AVATAR_PRESENTER + lip_sync_requirement=REQUIRED` 必须在生成前找到已认证 lip-sync/talking-head profile；否则只可由用户批准后转 `VOICEOVER_GRAPHICS`，或阻断。
- `MOTION_LED + motion_required=true` 不得在渲染失败时静默降级为静态图片或 Ken Burns；必须 `BLOCK` 或走已批准降级。
- （历史路线，语音 owner 已由 ADR-0063/语音专项文档覆盖）当前 Grok/Sub2API profile 只能创建 `PLATFORM_NARRATION + lip_sync_requirement=FORBIDDEN` 的视觉旁白方案；它不能被标成 Avatar。现行是否使用平台旁白必须先由已认证 profile 的 native/TTS owner 事实决定。
- 该 revision 一经用于 ProductionRun 即不可修改；调整承诺、渲染器、音频或时长策略必须创建新 revision。

状态机与事件：

```text
DRAFT -> PREFLIGHTING -> AWAITING_APPROVAL -> APPROVED -> CONSUMED
PREFLIGHTING -> NEEDS_DECISION | FAILED
NEEDS_DECISION -> DRAFT | AWAITING_APPROVAL
AWAITING_APPROVAL -> REJECTED | APPROVED
FAILED -> PREFLIGHTING (显式重试)
```

- 私有事件：`delivery_plan.preflight_requested`、`delivery_plan.ready_for_approval`、`delivery_plan.approved`、`delivery_plan.rejected`、`delivery_plan.failed`。
- 只有 `APPROVED` 的 DeliveryPlanRevision 可创建 ProductionRun；`CONSUMED` 只表示已冻结到至少一个 ProductionRun，不阻止创建基于新 revision 的新计划。
- 对当前单击生成流程的兼容方式：旧 brief 没有 DeliveryPlanRevision 时保持历史读取；新项目的“开始制作”先创建 preflight，不创建 Provider TaskRun。浏览器仍只经 Control API 轮询/SSE 获得安全状态。

### 5.2 NarrationScriptRevision 与 SpokenForm

保留用户显示文案，并独立冻结仅供 TTS 的播音稿。禁止在原文上原地替换。

```ts
type NarrationScriptRevision = {
  id: string; // nsr_
  workspace_id: string;
  project_id: string;
  delivery_plan_revision_id: string;
  status: "DRAFT" | "NORMALIZED" | "NEEDS_DECISION" | "APPROVED" | "REJECTED";
  source_script_hash: string;
  display_sections: Array<{ id: string; text: string }>;
  spoken_sections: Array<{
    id: string;
    display_text: string;
    provider_text: string;
    pronunciation_guides: Array<{ source: string; spoken: string; reason: string }>;
    delivery: { pace: string; energy: string; emphasis: string[]; pause_before_ms: number; pause_after_ms: number };
  }>;
  language: "zh-CN";
  normalization_version: string;
};
```

播音稿规范化只在可证明语义等价时自动执行：

- 删除外层引号、孤立引号、Markdown 标记和非语义换行。
- 按语义把 `10点41分` 变为“十点四十一分”、`0.4秒` 变为“零点四秒”、`47条` 变为“四十七条”。
- `AI`、品牌名、人名、型号、手机号、日期、金额、百分比、版本号和英文缩写默认进入 `pronunciation_guides`，不能凭猜测改写。
- 数字存在多种读法时，例如 `101`、日期、编号或金额，必须标记 `NEEDS_CONFIRMATION`，由用户或批准的 workspace glossary 决定。
- 中文显示文案、播音稿、发音映射和原因均可追溯；浏览器只展示用户可编辑的显示文案和可选的播音预览，绝不展示 Provider key、内部路径或原始转写。

`NarrationScriptRevision` 只有 `APPROVED` 才可生成正式 NarrationAssetVersion。预览可从 `NORMALIZED` 生成，但预览 Asset 不能直接作为正式 ProductionRun 输入，除非其哈希、voice preset、provider settings 和批准结论完全一致。

### 5.3 NarrationAssetVersion 与 TimelinePlan

生成 TTS 后创建不可变资产版本，记录真实时长和词级时间戳。然后再冻结最终时间轴：

```ts
type NarrationAssetVersion = {
  id: string; // nav_
  workspace_id: string;
  project_id: string;
  narration_script_revision_id: string;
  asset_id: string;
  provider: string;
  voice_id: string;
  provider_settings: Record<string, string | number | boolean>;
  duration_ms: number;
  sample_approved: boolean;
  word_timestamps_asset_id?: string;
};

type TimelinePlan = {
  id: string; // tlp_
  workspace_id: string;
  project_id: string;
  delivery_plan_revision_id: string;
  narration_asset_version_id?: string;
  effective_duration_ms: number;
  narration_sections: Array<{ section_id: string; start_ms: number; end_ms: number; visual_role: "PRIMARY" | "BROLL" | "HOLD" }>;
  visual_segments: Array<{ sequence: number; start_ms: number; end_ms: number; provider_duration_seconds: number }>;
};
```

`TimelinePlan` 必须在视频 Provider 提交前完成。它替代“根据字符数把第二段固定放到 15 秒”的做法。若 Provider 只支持 8-15 秒，平台以实际旁白 section 为中心分配可承载的视觉段，并只在无口播 B-roll/hold 上填充余量。

正式状态和恢复：

```text
NarrationAssetVersion: CREATED -> GENERATING -> READY | FAILED
TimelinePlan: DRAFT -> READY | NEEDS_DECISION | FAILED
```

- `READY` narration 必须保存 SHA-256、实际 `duration_ms`、采样率、声道、语言、voice preset/version 和受控 provider settings。
- 生成器返回的词级时间戳必须由独立 Asset 保存；没有词级时间戳只能标记 `TIMING_COARSE`，不能声明可烧录逐词字幕。
- TimelinePlan 以实际 narration section 时间为权威，并明确映射为现有 `AudioPlan` / `MediaRuntimeCompositionPlan`：旁白为 `PLATFORM_NARRATION`，音乐、SFX、用户源音频和 Provider ambience 各有 ownership；不得用隐式“前段视频时长相加”推导偏移。
- Narration retry 只生成新的 NarrationAssetVersion 和 TimelinePlan；未提交视频时可重新规划，已提交视频时只能创建新 ProductionRun 或走不改变视觉片段的 composition/edit retry。

### 5.4 CanonicalVisualEntityRevision

复用 Huobao 的实体化思路，但不引入短剧表：

- `CharacterDefinitionRevision`：外观、服装、身份参考 asset、版本和已批准角色设定图。
- `SceneDefinitionRevision`：地点、时段、空间布局、光线、无人物场景参考 asset。
- `KeyObjectDefinitionRevision`：仅限推动叙事且需要固定外观的 0-3 个关键物件。

`StoryboardShotSpec` 使用不可变 ID 引用这些 revision；没有明确上下文时不得凭空创建角色、场景或道具 ID。当前可选的 `scene_id / character_ids / prop_ids` 仅在实体来源已存在时填充。

### 5.5 Fact Context 与 SegmentFactPack

按 C11.2 设计实现 `DocumentKnowledgeRevision`、`DocumentFact`、`CreativeBriefFactContext` 和 `SegmentFactPack`。只有带来源定位的明确事实可进入营销内容；数值、资质、价格、合规、医疗/金融承诺必须具有 `EXPLICIT` 证据。冲突或图表不可读时默认不进入 Prompt。

### 5.6 VoiceAuthorization、Glossary 与 BrandPolicyRevision

外部声音、真人头像、品牌、Logo、产品包装和受保护设计不能只依靠 Prompt 文字。新增三个独立的受控事实：

| 实体 | 最小字段 | 规则 |
| --- | --- | --- |
| `VoiceAuthorization` | workspace/project、voice source asset、person/organization、allowed uses、expires_at、consent evidence asset、status | 默认不允许 voice clone、公众人物模仿或暗示性代言；无授权只能使用平台通用声音 |
| `PronunciationGlossaryRevision` | term、spoken form/phonetic form、language、scope、source、approval status | 对 `AI`、品牌、人名、型号、日期/编号读法等歧义词不可自动猜测；使用时冻结 revision hash |
| `BrandPolicyRevision` | approved names/logos/claims、forbidden identifiers、legal copy policy、source facts、status | OCR/视觉 QA 只能对照已批准事实；检测到未知品牌或不允许 Logo 时进入 `REVISE_EDIT` 或 `REGENERATE_SEGMENT` |
| `ReferenceUsagePolicyRevision` | asset/revision、每个维度 owner、允许迁入项、明确排除项、rights source、approval status | 图像、视频、音频分别只能拥有已授权的身份/场景/动作/相机/音色/节奏维度；拥有文件不等于拥有声音、Logo 或人物肖像权 |

所有授权/品牌实体必须带 workspace/project 范围、批准人、失效时间和撤销状态。撤销不改写历史 VideoVersion，但阻止其被新计划、新 TTS 或新 Avatar 复用。Seedance 的“拥有参考素材不等于拥有声音/Logo 使用权”在此作为硬门禁实现。

### 5.7 CapabilityProfileRevision 与成本/决策记录

将当前零散 runtime profile 扩展为私有 `CapabilityProfileRevision`，但只将已认证能力映射到 Web：

```ts
type CapabilityProfileRevision = {
  id: string; // cpr_
  provider: string;
  model_or_tool: string;
  status: "DISABLED" | "OFFLINE_CERTIFIED" | "LIVE_CERTIFIED" | "REVOKED";
  features: Record<string, { certified: boolean; limits: Record<string, string | number | boolean> }>;
  certification_fixture_version: string;
  last_verified_at?: string;
};
```

能力必须分别认证：TTS 的 SSML/速度/音色/词级时间戳；视频的音频/视频参考、首尾帧、原生长视频、延长、编辑；Avatar 的 talking-head/lip-sync；字幕/OCR 的语言和准确性。没有 `LIVE_CERTIFIED` 的付费或真实能力不得在普通项目选择器中出现。

同时新增：

- `CreativeDecisionLog`：记录时长策略、降级、样音批准、术语读法、renderer 选择、人工 QC 决定，关联 source revision 与 actor；不存 Prompt、密钥或签名 URL。
- `BudgetReservation`：仅作为平台的预估/批准/保留事实，金额使用十进制字符串；不替代 Sub2API 余额或 debit。真实计费仍只在 C13-A 走现有 receipt 语义。
- 样音、视频小样和音乐小样均须关联 decision log；批准/拒绝/超预算/配额不足必须有安全事件和可恢复状态。

### 5.8 OutputProfileRevision 与 QualityGateDecision

输出形态和质量决定也必须有平台事实，不能由 FFmpeg 命令临时决定：

```ts
type OutputProfileRevision = {
  id: string; // opr_
  workspace_id: string;
  project_id: string;
  delivery_plan_revision_id: string;
  variants: Array<{
    id: string;
    aspect_ratio: "16:9" | "9:16" | "1:1" | "custom";
    resolution: string;
    codec: string;
    caption_mode: "BURNED" | "SIDECAR" | "OFF";
    reframe_policy: "NONE" | "APPROVED_AUTO" | "MANUAL";
  }>;
};

type QualityGateDecision = {
  id: string; // qgd_
  workspace_id: string;
  project_id: string;
  video_version_id: string;
  checks: Array<{ code: string; severity: "BLOCK" | "REVISE" | "REVIEW" | "INFO"; confidence: number; action: string }>;
  final_action: "PRESENT" | "REVISE_NARRATION" | "REVISE_EDIT" | "REGENERATE_SEGMENT" | "BLOCK" | "AWAITING_HUMAN_APPROVAL";
  decided_by: "RUNTIME" | "USER" | "AUTHORIZED_REVIEWER";
};
```

- `OutputProfileRevision` 必须在 Provider/编辑开始前冻结；现有 16:9 版本保持兼容，不能默默裁切为竖版或方版。
- `QualityGateDecision` 与 `QcReport` 互补：QcReport 保存技术/语义检查事实，Decision 保存行动和人工批准。`REVIEW` 不得自动等价为发布通过；只有明确的 `PRESENT` 或被授权的人类批准才可导出相应 Variant。
- 字幕、封面、sidecar SRT/VTT、导出包均是派生 Asset；外部发布继续属于后续受控能力，不在本地阶段自动上传。

## 6. 关键冲突与裁决

| 冲突 | 裁决 | 实现约束 |
| --- | --- | --- |
| 用户原文 vs 播音可读性 | 保留 display text，另建 provider text | 任何规范化可回溯；歧义读法须确认 |
| 目标时长 vs 自然语速 | 目标为策略约束，不是强迫语速 | `EXACT` 模式重写文案或要求批准；禁止 atempo/rubberband 伪造自然感 |
| Provider dialogue vs 平台旁白 | 一条成片只能有一个 master spoken track | `PLATFORM_NARRATION` 静音 Provider dialogue；保留可分类 ambience/user audio |
| 旁白生成后才知道时长 vs ProductionRun snapshot 不可变 | 在 Provider submit 前完成 TTS 预检与 TimelinePlan | 已提交的 TaskRun 不能因语音调整原地改变；需新 ProductionRun 或 composition-only retry |
| 新样音审批 vs 现有单击创建 ProductionRun | 将 preflight 放入独立 DeliveryPlan/NarrationPlan 状态机 | 样音不是 TaskRun；未批准不得写 `production_run.confirmed` 或占用活动运行锁 |
| 当前 Grok 15 秒 profile vs Seedance 原生长视频 | Provider capability profile 决定路线 | 未认证 profile 禁止暴露原生 30-180 秒、音频参考、尾帧延长或视频编辑能力 |
| 要求口型同步但没有模型 | 显式分流，不提示词伪造 | `REQUIRED` 无能力时阻断或经批准转旁白图形；不得生成“可能对不上”的正脸口播 |
| TTS/Avatar 参考 vs 真实人声、肖像与品牌权利 | 用 VoiceAuthorization/BrandPolicyRevision 先验证 | 未授权不得克隆、模仿、代言或复用 Logo；撤销只阻止新制作，不改写历史 |
| 图像/视频/音频参考职责 vs 现有 ReferenceBinding | 保留公开 ReferenceBinding，新增私有 ReferenceUsagePolicyRevision | 每个维度只有一个授权 owner；视频动作参考不得迁入人物、Logo、声音或场景 |
| 黑底文字卡 vs 真实黑屏 | 检查可见内容而非只看亮度 | OCR/文字区域/帧内容确认；品牌不符属于 `REVISE_ASSETS`，不是技术黑屏 |
| ASR 容错 vs 错误被掩盖 | 分离 canonical spoken comparison 和 display semantic comparison | 容错只能标为 `ASR_AMBIGUOUS`，不可把发音质量直接标 PASS |
| OCR 发现未知文字 vs 没有品牌真值 | 仅对已批准 BrandPolicy/Fact Context 判断违规 | OCR 低置信或缺少品牌真值进入人工复核，不能自动静默通过或删除画面 |
| OpenMontage 文件状态 vs 平台数据库 | 只映射 Artifact 字段与工具结果 | 不读取 Backlot、events.jsonl、project_dir 作为事实 |
| 本地免费模式 vs 云 TTS 选择器 | 选择器可用但受能力/成本/授权限制 | （历史默认路线，已由 ADR-0063 覆盖）`AUDIO_FREE_ONLY=true` 时 Piper 可作为明确降级；界面不能暗示广播级表现 |
| 成本预估 vs Veyra 权威扣费 | BudgetReservation 只用于批准和停止昂贵调用 | 不维护本地余额；真实 debit 仍是 C13-A 的成功产物后幂等流程 |
| 多输出比例/字幕导出 vs 现有单一 VideoVersion | 每个 OutputProfile variant 创建派生 Asset 和 QualityGateDecision | 不裁切或替换原始成功版本；人工重构图与自动重构图必须可追溯 |
| 历史版本兼容 vs 新质量门禁 | 历史只读，新增 revision 才使用新 Artifact | `LEGACY_PRESERVE` 不重混；不得迁移或伪造旧验收 |

## 7. 分阶段实施顺序

正式实施以单章节串行推进。每阶段完成审计后才允许进入下一阶段。

### P0：C11.7 / C12.7A 交付与语音预检基础

范围：最小 `DeliveryPlanRevision`、`CapabilityProfileRevision`、`VoiceAuthorization`、`PronunciationGlossaryRevision`、`BrandPolicyRevision`、`CreativeDecisionLog`、`BudgetReservation` 及其状态机/事件/公开安全投影。

这是后续样音、旁白和 Avatar 的前置依赖，不直接提交视频 Provider。默认本地模式只开放已认证的本地 Piper 预览；云 TTS、voice clone 和 Avatar 必须另行得到用户授权与能力认证。

Exit Gate：

- 所有新实体具备 workspace/project 范围、状态机、外键、唯一约束、命令幂等和 outbox 事件。
- 未认证的 provider feature、无授权声音/品牌和超预算计划在 Provider submit 前 fail-closed。
- 当前单击制作流在未批准时只显示 preflight/approval 状态，绝不创建活动 ProductionRun。

### P1：C12.7B 旁白质量闭环

范围：`NarrationScriptRevision`、播音稿规范化、引号/孤立 cue 修复、数字/缩写发音词典、TTS 参数 mapper、样音、实际时长、TimelinePlan、AudioPlan 映射、canonical transcript QC。

依赖：P0；不需要真实视频 Provider。

Exit Gate：

- “显示文案”和“播音稿”可逐 section 审阅；孤立引号、空 cue、未映射缩写被拒绝。
- Piper 至少支持确定性 `length_scale` 和句间停顿；支持 SSML 的 Provider 只能经 CapabilityProfileRevision 使用。
- 数字、时间、百分比、金额、版本号、英文缩写、品牌术语各有 fixture；歧义值不能自动通过。
- 先生成样音，未批准时不得创建 ProductionRun；已批准 voice preset 只能在授权、Glossary 与参数哈希相同的条件下复用。
- 实测时长决定 TimelinePlan；短于/长于时进入 B-roll、文案修订或用户确认，而非拖慢音频。

### P2：C11.2 资料知识与事实包

范围：执行既有 C11.2 设计，替代原始 Markdown 重复注入。该阶段优先于“资料驱动的品牌/合规口播”。

Exit Gate：长文后半段事实可检索；每个 SegmentFactPack 有来源定位；冲突、视觉不可读和高风险数字不进入文案。

### P3：C11.7B Proposal、成本与预览门禁

范围：补全 DeliveryPlan 的 renderer/runtime freeze、输出媒体 profile、成本预估/保留、voice/music/visual sample、批准状态与安全公开投影。

Exit Gate：生成前可回答“交付是什么、是否需要真实运动/口型、允许什么降级、当前 profile 能否满足”；不满足时不提交昂贵 Provider。

### P4：C12.8 编辑决策、字幕、输出变体与可恢复质量路由

范围：受控 `EditDecisionRevision`、word-timestamp captions、ASS/SRT/烧录策略、输出媒体 profile、横竖版/重构图策略、视觉文字 OCR、品牌检查、QC severity 和 `REVISE_NARRATION / REVISE_EDIT / REGENERATE_SEGMENT / BLOCK` 路由。

Exit Gate：字幕基于最终旁白生成；字幕不遮脸；终检不会以统一 `NEEDS_ATTENTION` 掩盖必须重做的错误；composition retry、edit retry、segment retry 分别不重复 Provider。

### P5：C11.8 角色/场景/道具实体与参考资产

范围：CanonicalVisualEntityRevision、去重、角色设定图、场景建立图、关键物件图、SourceShotBinding 全链路传递。

Exit Gate：实体 ID、参考图角色、Prompt 引用和实际输入顺序一致；不从上传顺序猜职责；明确的对象换手只按同一实例推进。

### P6：C09-C / Provider 能力认证扩展

范围：为 Seedance 或其他真实 profile 单独认证音频参考、视频参考、原生 30-180 秒、延长、首尾帧、编辑和多图限制；每项能力独立启用。

Exit Gate：离线 fixture、字段 mapper、错误归一化、额度上限和实际受控调用全部通过；未认证字段不得出现在 Web 或普通计划器中。

### P7：C12.9 Avatar、lip-sync 与本地化专项

范围：仅对 P0 已定义且 P6 已认证的 capability profile 增加 Avatar/talking-head/lip-sync、授权音频/视频参考、本地化配音和 no-avatar fallback。

Exit Gate：无 lip-sync 能力时不允许 `REQUIRED` 制作进入 Provider；有能力时使用同一条已批准 narration asset，检查口型偏差、人物身份、语言、字幕和授权范围。翻译/配音不得改变原始视频版本，必须创建新的 Localization DeliveryPlanRevision。

### P8：C13-A 共享积分与部署

范围：仅在前述本地章节 `ACCEPTED` 后，按已存在 Veyra 设计执行身份、预检、debit、receipt、限额、VPS/部署。

## 8. 质量决策模型

`FinalReview` 必须从当前三态扩展为内部严重度与行动路由：

| 发现 | 严重度 | 行动 |
| --- | --- | --- |
| 容器、MIME、帧率、真实黑屏、无音轨 | `BLOCK` | 不发布，保留片段，修复合成 |
| 旁白截断、canonical spoken mismatch、发音词典未覆盖 | `REVISE_NARRATION` | 重新生成 narration/timeline，不重提视频 |
| 字幕遮脸、字幕不同步、品牌/文字 OCR 不符、错误片尾卡 | `REVISE_EDIT` 或 `REGENERATE_SEGMENT` | 先重剪；视觉源错误才重做受影响段 |
| 相邻镜头语义衔接失败 | `REPAIR_TRANSITION` 或 `REGENERATE_DEPENDENTS` | 保留前序 accepted segment |
| ASR 低置信或同音歧义 | `NEEDS_HUMAN_REVIEW` | 不自动标为内容正确 |
| 全部必需门禁通过 | `PASS` | 可发布/导出 |

所有 action 必须是持久化命令和 outbox 事件。浏览器只看安全摘要、可执行按钮和版本状态；不得得到 Prompt、对象 key、内部评分、Provider 或本地路径。

## 9. 数据迁移、兼容与回滚

### 9.1 与现有实体的关系

| 现有实体/行为 | 新增关系 | 不允许的冲突 |
| --- | --- | --- |
| `CreativeBriefRevision` | 可关联多个 DeliveryPlanRevision；旧 brief 没有关联时保持当前流程只读兼容 | 不把 DeliveryPlan 字段塞入历史 brief 或覆盖用户 source_text |
| `ScriptRevision` / `StoryboardRevision` | 由 TimelinePlan 产生新 revision，或引用同一已批准脚本的无视觉改动 narration revision | 不在已批准 storyboard 上原地修改时长、台词或镜头序列 |
| `ProductionRun` | 只引用 `APPROVED` DeliveryPlan、NarrationScript、NarrationAsset、TimelinePlan 的不可变快照 | 不在 `CONFIRMED` 后重新选择声音、Glossary、renderer 或 duration policy |
| `TaskRun` / `ProviderAttempt` | 继续只描述视频 Provider submit/status/download | 样音、TTS、字幕、OCR、编辑重试不得伪装为 VideoGeneration TaskRun 或重提 request ID |
| `MediaRuntimeCompositionPlan` / `AudioPlan` | 从 TimelinePlan 编译；记录全部 track ownership、绝对时间与 mix 参数 | 不以隐式片段时长或临时目录推导旁白偏移 |
| `ReferenceBinding` | 继续承担公开已选素材事实；私有 ReferenceUsagePolicyRevision 冻结维度授权和排除项 | 不改变上传顺序为职责，不因音频/视频参考绕过授权 |
| `VideoVersion` / `QcReport` | 每次 narration/edit/composition 产物均创建新版本及质量报告；OutputProfile variant 产生派生 Asset 与 QualityGateDecision | 不覆盖成功资产；不能用新 QC 改写历史版本结论 |
| `UsageRecord` / Veyra | BudgetReservation 仅预估/批准；真实 debit 仍走 C13-A | 不以预算预留模拟余额、扣费或 receipt |

### 9.2 活动锁、恢复与状态机

- `AWAITING_APPROVAL` 等 preflight 状态只属于 DeliveryPlan/NarrationPlan，不属于 `ProductionRun`，因此不应占用现有 `production_runs_one_active_project_key`。
- 一旦 ProductionRun 已 `CONFIRMED`，只允许现有的 segment retry、narration retry、edit retry、composition retry 等受控命令；它们必须明确是否会创建新的 TaskRun。默认答案是不会。
- 新的内部事件必须列出 contract version、aggregate、causation、correlation、workspace 和 project；消费者以 event_id 去重，并为长时间 TTS/OCR/Avatar 作业维护 lease/reclaim 语义。
- 数据库迁移必须提供 forward-only schema 和可操作的回退 runbook；不删除历史列、不批量重写旧版本、不迁移旧媒体二进制。

1. 新实体和字段均新增；不重写既有 CreativeBrief、TaskRun、ProductionRun、VideoVersion。
2. 历史版本继续按 `LEGACY_PRESERVE`，只能下载/播放/审阅，不自动补字幕、重配音或重新评级。
3. 新的 public API 先在 Contracts/OpenAPI/JSON Schema/ADR 定义，再迁移 Persistence、Worker、Studio；旧客户端保留兼容投影。
4. 每个新 Revision 使用前校验 workspace/project/source revision 一致；所有查询在 SQL 层带 `workspace_id`。
5. 音频、字幕、样音、词级时间戳均作为 Asset/派生 Artifact 存储；数据库不存对象二进制、预签名 URL 或 Provider 原始响应。
6. 恢复操作必须区分 narration retry、edit retry、composition retry、segment retry。任何一种都不得默认转为 Provider submit。
7. 任一未认证 TTS/Avatar/Seedance profile 默认禁用；失败显式写应用错误码和安全摘要。

### 9.3 必须先写的 ADR 与契约清单

在任何实现前，至少新增或更新：

1. DeliveryPlan/NarrationPlan 的公开命令、审批投影和私有状态机 ADR。
2. SpokenForm 规范化、Glossary、VoiceAuthorization 与 BrandPolicy 的授权/撤销 ADR。
3. 预算预留与真实 Veyra debit 分离 ADR。
4. CapabilityProfile 认证、失效和 Web 可见性 ADR。
5. QualityGate severity/action、人工批准和版本导出 ADR。
6. 字幕/输出媒体 profile/重构图与原始 VideoVersion 不可变性的 ADR。

## 10. 验证矩阵

### 10.1 离线

- 规范化：引号、中文/阿拉伯数字、金额、日期、版本号、英文缩写、品牌名和多音字。
- 语音：Piper/云 TTS mapper、样音批准、实际时长偏差、绝对时间轴、跨段无重叠、语义断句、Glossary 版本冻结、撤销授权和 provider settings replay。
- 规划：FLEXIBLE/EXACT 时长策略、B-roll 填充、超长文本回退、旧快照兼容。
- 资料：Markdown 结构、事实定位、冲突、敏感数字、跨工作区、Prompt 注入防护和 `VISUAL_UNAVAILABLE` 降级。
- 视觉：角色/场景/道具绑定、参考职责、授权范围、OCR 品牌真值、字幕遮挡、黑底文字卡、真实黑屏和未知文字低置信复核。
- 预算：免费/付费 profile、预算预留、超额拒绝、批准后重放、Veyra 未启用时的 fail-closed。
- 能力：每个 CapabilityProfile feature 的 disabled/offline/live/revoked 分支，不能用一个成功 profile 推断另一 feature 可用。
- 恢复：Worker 重启、样音重试、旁白重试、编辑重试、合成重试、segment retry 均不重复 ProviderAttempt 或 debit。

### 10.2 集成与 E2E

- 创建项目 -> 导入资料 -> 资料理解 -> 选择/确认事实 -> 样音 -> 批准 -> 生成 -> 合成 -> 字幕 -> QC -> 导出。
- 无 Avatar 能力时，`REQUIRED` 口型同步请求必须停在批准/阻断页面；批准降级后走旁白画面。
- VoiceAuthorization/BrandPolicy 被撤销后，新计划必须被阻止，历史 VideoVersion 仍可只读播放。
- 同一 idempotency key 重放 sample approval、DeliveryPlan approval、narration retry、composition retry 时不得产生第二个资产、第二个事件或第二次 Provider submit。
- Mock 无网络无密钥全量通过；真实 Provider 只执行用户指定 profile、次数、素材与额度上限。

## 11. 明确的实施前决策

以下设计已经提出推荐方案，但在写代码前必须由用户确认：

1. 默认时长策略是否采用 `FLEXIBLE`，建议允许目标时长上下各 20%，超出则要求批准；还是所有项目默认 `EXACT`。
2. 客户可见的口播是否必须经过样音批准；建议企业介绍、品牌片、Avatar 均强制，已批准 workspace voice preset 可受控复用。
3. `AI`、品牌词和产品术语的默认读法是否要求用户在项目 Glossary 明确配置；建议不自动猜测。
4. 是否允许接入云 TTS/Avatar Provider；本地 Piper 仅应定位为免费、隐私友好的预览/降级，而非广播级默认。
5. 字幕策略是否默认 `REQUIRED`；建议企业介绍、演示和社媒成片默认烧录字幕，纯氛围片可关闭。
6. 是否允许真实人声、头像、授权音频/视频和品牌 Logo 作为生成或参考输入；建议默认禁止克隆/模仿，必须逐项目留存授权范围与失效日期。
7. 对每次制作、样音、云 TTS、Avatar 和 Provider 重生成的预算上限如何设定；建议先做本地 BudgetReservation，再按 C13-A 使用 Veyra 权威扣费。
8. 是否需要横版、竖版、方形等输出变体；建议在 DeliveryPlan 中显式选择，不能将现有 16:9 成片悄悄裁切为其他比例。

## 12. 来源覆盖与明确后置清单

本表是“全量”承诺的审计基线。后续每个条目必须补平台模块、测试位置、来源 commit 和状态；没有状态的源能力不得声称已吸收。

| 来源能力 | 目标阶段 | 当前状态 | 冲突/后置理由 |
| --- | --- | --- | --- |
| Huobao 剧本改写、场景/角色/道具提取与近名去重 | P5 | `PLANNED` | 改为企业 CanonicalVisualEntityRevision，不迁入短剧 episode 表 |
| Huobao 角色三视图、白底道具图、无人物场景建立图 | P5 | `PLANNED` | 必须先有实体 revision、授权和用户审批 |
| Huobao 8-15 秒、台词容量、3 秒段内时间轴 | P1 | `PARTIAL` | 容量/时间轴已部分适配；必须改为真实 TTS 时长反馈 |
| Seedance 单一维度参考职责、声音策略、未完成台词锁 | P0/P5 | `PARTIAL` | 已有 reference role/Prompt；授权和音频/视频 reference profile 尚缺 |
| Seedance 原生 30-180 秒、延长、首尾帧、视频编辑、音频/视频参考 | P6 | `DEFERRED_UNTIL_CERTIFIED` | 不能依据文档自动开放任何字段 |
| Seedance 安全、真人/声音/Logo 授权和未知 donor 降级 | P0 | `MISSING` | 必须落实 VoiceAuthorization/BrandPolicy/ReferenceUsagePolicy |
| MarkItDown `convert_stream` 与 MIME/流安全 | 已完成 | `ADAPTED` | 保持 stream-only、plugins disabled |
| MarkItDown OCR/LLM/image/audio converter | C11.2 后续专项 | `REJECTED_UNTIL_CERTIFIED` | 不能用插件、任意 URL 或视觉推断绕过资料事实边界 |
| OpenMontage Delivery Promise、proposal、checkpoint、decision log、cost reservation | P0/P3 | `MISSING` | 必须映射为数据库事实，不能使用项目目录 checkpoint |
| OpenMontage script voice performance、provider text、发音指南、样音、TTS selector | P1 | `PARTIAL` | 当前 schema 存在，但未映射到 Piper/provider settings |
| OpenMontage narration actual duration、edit decisions、AudioPlan、字幕 | P1/P4 | `PARTIAL` | 绝对时间存在，实测反馈/字幕/输出变体未完成 |
| OpenMontage visual QA、OCR/文字、品牌、final-review action 路由 | P4 | `PARTIAL` | 技术探测存在；真实文字/品牌真值与细粒度行动未完成 |
| OpenMontage Avatar/talking-head/lip-sync/localization | P7 | `DEFERRED_UNTIL_CERTIFIED` | 需要授权、capability certification 和专门验收 |
| OpenMontage media profiles、export bundle、publish log | P3/P4 | `MISSING` | 需要输出变体和导出 Artifact，不直接发布到外部平台 |
| SUB2API 视频三段式协议、MIME/长度/恢复 | 已完成 | `ADAPTED` | 继续隔离 Provider credential 和原始响应 |
| SUB2API 的其他模型能力 | P6 | `DEFERRED_UNTIL_CERTIFIED` | profile feature 独立认证、独立额度上限 |
| Alchemy/Veyra 身份、预检、debit/replay/receipt | P8 | `DESIGN_ONLY` | 必须等待 C13-A 授权，不能用 BudgetReservation 替代 |

## 13. 完成定义

本总设计只有在所有阶段按顺序完成、每个阶段具有 ADR/契约/迁移/测试/审计证据，并且所有未认证能力保持禁用时，才能称为“完整迁入”。任何只复制 Prompt、Schema 或工具文件但未形成预检、实际执行、验收和恢复闭环的工作，均不得标为完成。
