# AI 企业内容生产平台：C12.4 连续旁白轨道与分段视频音频编排开发设计

状态：`FROZEN / HISTORICAL_DESIGN`（2026-08-30 起冻结；章节状态仍以正式总控文档为准）

当前执行裁定（已由新方案取代）：本文只保留 C12.4 的历史设计和来源背景。当前源仓库映射、跨仓库冲突、薄壳边界和逐项验收以《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》为准；样音不是正式旁白资产、完整旁白优先一次生成并测量、无法实际消费的时间窗保持 `BLOCKED`/`UNAVAILABLE` 等既有边界不变。本文不再授权新增实现。

现行使用补充（2026-09-01，覆盖历史输入假设）：当前自动旁白不要求用户上传音频；样音和正式旁白由已确定 owner 的 native Provider 或显式 Doubao 服务端生成。本文中“显式用户上传音频”仅保留为历史/兼容资产语义，不得作为新自动旁白任务的必经步骤；通用 MUSIC/参考素材上传仍按现行契约。

> **2026-09-01 语音路线冲突覆盖（SUPERSEDED）**：本历史设计中“新任务统一使用 `PLATFORM_NARRATION`、无条件移除 `PROVIDER_DIALOGUE`、Piper/平台旁白作为最终 spoken track”的路线被《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》覆盖。现行规则先依据固定来源能力选择唯一音频 owner：已认证的 native-audio Provider 可以保留其生成音轨；只有明确选择 TTS owner 时才进入来源 `TTSSelector`。本文的 AudioPlan/绝对时间/样音与正式资产隔离/无法表达即阻断等非冲突边界继续作为历史证据保留；章节状态和新增授权仍以正式总控、state 和多源矩阵为准。

## 1. 目的

本章解决 C12 多段 AI 视频成片中的口播断裂、段间空白、音色/语速跳变和音频累计漂移问题。设计依据来自上游仓库的可复用能力，而不是重新发明一套媒体规则：

- `upstream/OpenMontage/skills/creative/video-stitching.md`：AI 片段自带音频通常不连续；跨段成片应移除不连续的 AI 音频，使用统一音乐/旁白轨道；同主题切换可使用 J-cut/L-cut；音频需统一响度并验证每个衔接点。
- `upstream/OpenMontage/skills/pipelines/explainer/compose-director.md`：先生成完整 narration 音频，按绝对时间戳进入合成，统一转写并检查是否完整覆盖成片。
- `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`：每个分镜段 8–15 秒，台词必须满足段内最低时长；装不下的台词必须进入后续段落。
- `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`：台词只能来自对应分镜段，长台词按时间段拆分，不得创作额外台词。
- `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`：原生 30 秒或更长视频优先使用时间轴脚本；跨段需继承声音状态、未完成台词和准确端点。

本章不把 OpenMontage 的 Backlot、Remotion、Agent 状态或本地目录引入平台事实源，只把音频所有权、时间轴、合成和验收规则适配到现有 Control API、Worker、Storage、Media Runtime 和持久化边界。

## 2. 审计结论

当前实现已经吸收了分段规划、台词边界、Prompt 连续性锁、交接帧和基础媒体 QC，但没有完整吸收上游的音频编排方案。

当前行为位于 `services/media-runtime/runtime.py::compose_video_bundle`：

1. 读取每个视频片段的内嵌音频；
2. 没有音频的片段补静音；
3. 通过 `concat` 或 `acrossfade` 拼接片段音频；
4. 只验证最终存在音频流和技术时长。

这会把每段 Provider 独立生成的口播当作同一条连续声音，无法保证：

- 段间没有额外停顿；
- 音色、语速、起腔和呼吸一致；
- 句末不会被 `acrossfade` 截断；
- 多段音频时间误差不会累积；
- 完整文案只出现一次并覆盖整条成片。

因此当前代码与上游方案存在一个明确缺口，而不是单纯的 Prompt 质量问题。

## 3. 与现有契约的冲突及兼容决策

### 3.1 来源音轨保留规则冲突

现有正式总控文档的 C12 规则曾写为“合成不得丢弃来源音轨”。这条规则对普通用户上传视频、环境声和未被平台接管的素材音频仍然有效，但对 AI 生成片段的独立口播音频会与 OpenMontage 的跨段规则冲突。

本章将其精化为“音频所有权”规则：

| 音频所有权 | 默认处理 | 原因 |
| --- | --- | --- |
| `PLATFORM_NARRATION`（历史/兼容 owner） | （历史/兼容）统一铺设整条旁白；默认静音 Provider 片段口播 | 旁白必须由一条连续轨道拥有；当前 owner 由 native/显式 TTS 事实决定 |
| `PROVIDER_DIALOGUE` | 仅在没有统一旁白轨道时保留 | 兼容旧任务和单段视频 |
| `PROVIDER_AMBIENCE` | 可保留并混入统一旁白下方 | 环境声属于画面，不是口播 |
| `USER_SOURCE_AUDIO` | 默认保留，除非用户明确静音 | 用户素材的原始事实不能被无条件丢弃 |
| `MUSIC` / `SFX` | 由音频混音计划决定 | 需要统一响度、ducking 和时轴 |

“移除 AI 音频”只针对被平台声明为 `PROVIDER_DIALOGUE` 且已存在 `PLATFORM_NARRATION` 的片段，不是对所有来源音频做无条件删除。

### 3.2 旧数据兼容

- 历史 `TaskRun`、`ProductionRun`、`VideoVersion` 和已生成资产不重写、不重新混音。
- 历史成片没有音频所有权字段时，按 `LEGACY_PRESERVE` 读取，保持当前行为。
- （历史/兼容路径）新建带完整旁白脚本的制作（单段或多段）默认生成 `PLATFORM_NARRATION` 音频计划；没有旁白资产时降级为 `LEGACY_PRESERVE` 并在 QC 中标记 `NEEDS_ATTENTION`，不得悄悄静音。当前自动流程不预设该 owner。
- Mock Provider 继续支持原有无音频/固定音频 fixture；只有显式提供旁白 fixture 时才测试统一旁白路径。

### 3.3 Provider 能力兼容

- 当前 `grok-imagine-video-1.5` 仍按 1–15 秒 Provider 片段运行，继续使用 C12 分段和交接帧。
- Seedance 的原生 30 秒/超长时间轴属于独立能力 profile；认证后可绕过主片段拆分，但仍使用同一 `AudioPlan` 和 QC 契约。
- 不把当前 Grok 的 15 秒上限伪装成原生长视频；不因新增音频轨道而扩大 Provider 时长、模型或公开参数范围。

## 4. 目标领域模型

新增内部概念 `AudioPlan`，属于 ProductionRun 的不可变输入快照或其私有派生版本。它不向浏览器公开 Provider 原始字段、对象 key 或签名 URL。

```ts
type AudioOwnership =
  | "PLATFORM_NARRATION"
  | "PROVIDER_DIALOGUE"
  | "PROVIDER_AMBIENCE"
  | "USER_SOURCE_AUDIO"
  | "MUSIC"
  | "SFX"
  | "LEGACY_PRESERVE";

type AudioTrackPlan = {
  track_id: string;
  ownership: AudioOwnership;
  asset_id: string;
  start_ms: number;
  end_ms: number;
  gain_db: string;
  duck_under_narration: boolean;
  fade_in_ms?: number;
  fade_out_ms?: number;
};

type AudioPlan = {
  version: 1;
  target_duration_ms: number;
  narration_asset_id?: string;
  tracks: AudioTrackPlan[];
  stitch_policy: "CONTINUOUS_NARRATION" | "SEGMENT_AUDIO" | "LEGACY_PRESERVE";
  transcript_script?: string;
  transcript_timing_asset_id?: string;
};
```

要求：

- `start_ms` / `end_ms` 使用最终成片的绝对时间轴，不使用“上一段实际时长加总”的隐式偏移。
- `narration_asset_id` 指向平台生成或用户授权的 AUDIO Asset；数据库只保存元数据和对象关系。没有独立旁白 Asset 时，Worker 必须按每个已接受视频段的绝对起始时间生成并混入受控旁白片段，不能把整条旁白从 0 秒播放后再用静音填充尾段。
- 统一旁白轨道的文本来源必须是已确认的完整脚本，不能从 Provider 返回文本猜测。

（历史实现记录，已由自动音频正式执行文档覆盖）本轮实现补充了 OpenMontage 对齐的音乐混音入口：有受控音乐字节时使用版本化 `ALCHMED4` composition bundle，Media Runtime 对音乐执行低音量铺底、淡入淡出、旁白 sidechain ducking 和 `loudnorm`；连续旁白通过 loopback Media Runtime 的 Piper 本地模型先生成完整 WAV，再以 `ALCHMED5` 受控字节段传输，并替换 Provider 独立对白为唯一主旁白轨道；没有音乐或旁白资产的旧 `ALCHMED1/2/3` bundle 保持原行为。音频字节只能由 Worker 从已授权 AUDIO Asset 读取，禁止传入本地路径或任意 URL。音乐资产按工作区共享曲库选择，资产仍保留来源项目归属以满足审计和对象存储隔离。
- `transcript_script` 是私有审计字段，不进入公开 DTO、SSE、日志或 Provider 原始响应。

## 5. 端到端流程

```text
CreativeBrief / Script
  -> Storyboard dialogue boundaries
  -> AudioPlan draft
  -> server-generated narration asset (upload is legacy compatibility only)
  -> absolute timestamp alignment
  -> ProductionRun freeze
  -> segment video generation
  -> accepted segment video with provider audio muted or classified
  -> Media Runtime video stitch
  -> AudioPlan mix / duck / normalize
  -> full-track transcription and QC
  -> VideoVersion
```

### 5.1 旁白准备

（历史 MVP/兼容路径）本地 MVP 曾使用固定音频 fixture、显式用户上传音频或 loopback Media Runtime 的本地 Piper 旁白；后续真实 TTS 通过独立 `NarrationProviderPort` 接入。当前自动旁白由已确定 owner 的 native Provider 或显式 Doubao 服务端生成，视频 Provider 不负责平台统一旁白的事实来源。

旁白准备必须记录：完整脚本文本哈希、音频 SHA-256、MIME、时长、采样率、声道、目标语言和版本。旁白时长超出目标成片时长时，必须回到规划阶段调整文案或时长，不能在最终合成中静默截断。

### 5.2 视频片段生成

（历史统一旁白路径）现有分段 Prompt 继续携带段内台词，保证画面口型和动作参考；但在统一旁白模式下新增私有声音策略。Provider 音频不再承担完整口播责任：Worker 在合成前用受控脚本调用 loopback Runtime 的 Piper 生成单条完整旁白，若模型不可用则返回可重试的 Runtime 错误，不带着缺失口播继续合成：

```text
Provider audio is not the master narration track.
Keep the visual speaking performance and mouth movement aligned to this segment's assigned dialogue,
but the final edit uses the platform narration track as the only authoritative spoken audio.
Do not add extra words, greetings, summaries, or repeated dialogue.
```

这不会改变 Provider 请求公开字段，也不会把平台旁白对象 URL 暴露给浏览器。

### 5.3 合成

Media Runtime 按以下优先级处理：

1. 先按序拼接视频画面并计算最终时间轴；
2. 读取 `AudioPlan`；
3. `CONTINUOUS_NARRATION` 模式下，移除/静音被标记为 `PROVIDER_DIALOGUE` 的片段音频；
4. 按绝对时间戳加入统一旁白；
5. 保留允许的环境声、用户原始音频、音乐和音效；
6. 按上游规则做响度归一化、旁白 ducking、边界微淡变；
7. 生成最终 MP4 并探测音轨、时长和转写。

同主题、不同角度的边界可使用 0.3–0.5 秒 J-cut/L-cut；同一连续动作默认硬切且只做零交叉/5ms 微淡变，避免切掉最后一个字。`BLEND` 画面转场不得自动等价为音频跨淡；音频策略必须由 `AudioPlan` 明确决定。

## 6. 与现有模块的兼容边界

| 模块 | 变化 | 不变项 |
| --- | --- | --- |
| `packages/contracts` | 增加内部 AudioPlan/Track DTO；公开 DTO 只增加安全状态摘要 | 不公开 Provider 音频 URL、对象 key、Prompt |
| `packages/domain` | 增加音频所有权和音频策略校验 | TaskRun 状态迁移、台词分段规则不变 |
| `packages/persistence` | 新增 narration/audio plan/track 元数据和版本关系 | 工作区条件、资产对象边界、历史记录不可变 |
| `apps/production-worker` | 在成片前冻结 AudioPlan，向 Media Runtime 发送受控内部 DTO | 不直接访问 Web；不绕过 Control API 或状态机 |
| `services/media-runtime` | 支持静音 Provider dialogue、统一旁白、绝对时间轴、混音和转写 QC | 继续校验 MIME、SHA-256、ffprobe、时长和音频流 |
| `packages/provider-video` | 只接收声音策略提示，不承担平台主旁白存储 | submit/status/download 协议不变 |
| Studio Web | 显示“连续口播/片段原声”安全状态和 QC 摘要 | 不显示内部路径、密钥、对象 key 或 Provider 原文 |

## 7. 需要修正的现有逻辑

### 7.1 必须修改

- `compose_video_bundle` 不能再把“存在音频流”作为“必须保留原音轨”的唯一依据。
- Composition bundle 必须携带 `AudioPlan` 或明确的 `LEGACY_PRESERVE` 策略。
- 统一旁白模式必须从视频片段中剥离 Provider dialogue，不能只对独立片段音频做 `acrossfade`。
- 绝对时间轴必须在合成前计算并持久化，不能以当前片段实际探测时长递推旁白偏移。
- QC 必须检查整条旁白转写、最后一个字、静音间隔和音频漂移。

### 7.2 不应修改

- 不修改 `TaskRun` 合法状态矩阵。
- 不修改“一个 GenerationSegment 至多一个活动 TaskRun”的约束。
- 不修改 Provider request ID 持久化和 Worker 重启恢复规则。
- 不修改 `REFERENCE_SET`、HandoffAsset、C12.1 语义衔接状态和自动修复上限。
- 不把旁白音频加入浏览器直传 Provider 的路径。

## 8. 迁移与失败策略

- 旧 `ProductionRun` 没有 AudioPlan：读取为 `LEGACY_PRESERVE`，维持历史成片可回放。
- 新连续旁白任务缺少旁白资产、时长探测失败或时间轴无法覆盖全片：在 Provider submit 前进入可恢复失败/等待，不提交昂贵视频任务。
- 旁白生成成功但视频段失败：旁白资产保留为不可变版本，重试只重做受影响视频段。
- 视频段成功但混音或转写失败：保留已接受视频段，进入 `DOWNLOADING`/媒体重试路径，不重复提交 Provider。
- 统一旁白模式下发现片段仍有未分类人声：QC 标记 `NEEDS_ATTENTION`，不能宣称“连续口播通过”。

### 8.1 成片合成重试

若所有主片段均为 `ACCEPTED`，但最终旁白、混音、容器探测或终检失败，平台必须保留这些不可变片段和已持久化 `provider_request_id`。此时公开 Control API 只允许显式 `POST /api/v1/production-runs/{production_run_id}/composition/retry`：

- 仅 `ProductionRun=FAILED` 且每个主片段已接受时可调用；其他状态一律拒绝；
- 事务内将运行恢复为 `REVIEWING`，写新的 `video_version.composition_requested` outbox 事实；
- Media Runtime 重新生成旁白、混音和终检，绝不创建 Shot、TaskRun 或新的 ProviderAttempt；
- 命令使用标准 Idempotency-Key，重复调用只回放进度。

终检不能将“黑底但仍有可见文字或品牌图形”的片尾卡当作无内容黑屏；只对连续无可见内容的黑帧阻断。该类深色卡保留为人工审阅提示，不掩盖真正黑屏、静音或转写缺失。

## 9. 测试和 Exit Gate

### 9.1 领域/契约

- AudioPlan 绝对时间轴无重叠、无负时长、覆盖目标时长。
- （历史/兼容规则）`PLATFORM_NARRATION` 存在时，Provider dialogue 默认被静音；`LEGACY_PRESERVE` 保留旧行为。当前 owner 需有 native/TTS 来源事实。
- 公开 DTO 不含音频对象 key、签名 URL、Provider 音频响应或私有转写文本。
- 同一旁白资产和计划版本幂等回放，不创建第二条音频事实。

### 9.2 Media Runtime

- 三段带独立 AI 音频的 fixture 在连续旁白模式下最终只保留一条主旁白。
- 三段无音频/混合音频 fixture 都能按策略合成。
- J-cut/L-cut、硬切微淡变和普通 BLEND 的音频行为分别可验证。
- 最终音频响度、静音间隔、转写完整性和总时长均可检查。
- 片段音频被移除时，环境声和用户源音频按所有权规则保留。

### 9.3 集成/E2E

- Mock 模式无网络、无真实 Key 仍全量通过。
- Worker 重启不重复生成旁白、不重复提交视频 Provider。
- Provider 片段已成功但统一混音失败时可重试媒体步骤。
- 30 秒真实本地样本验证：三段视觉片段、单条连续旁白、无明显段间空白、完整脚本转写。

### 9.4 Exit Gate

只有同时满足以下条件，C12.4 才能进入 `READY_FOR_AUDIT`：

1. 上述来源规则已登记在第三方来源与复用记录中；
2. C12 旧音轨规则的冲突已在正式总控文档和开发决策记录中明确修正；
3. 连续旁白和旧 `LEGACY_PRESERVE` 两条路径均有测试；
4. 真实 Provider 只作为受控质量样本，不改变默认 Mock、Veyra、VPS 或部署边界；
5. QC 能区分“音频存在”与“旁白连续且完整”；
6. 审计证据包含最终音频时长、转写结果、响度/静音检查和合成计划摘要。

## 10. 来源与复用记录

本章直接复用以下上游思路并做平台边界适配：

| 来源 | 复用内容 | 不复用内容 |
| --- | --- | --- |
| OpenMontage `video-stitching.md` | AI 音频剥离、统一音乐/旁白、J-cut/L-cut、LUFS、音频连续性检查 | Backlot、Agent 状态、本地项目目录 |
| OpenMontage `explainer/compose-director.md` | 完整旁白资产、绝对时间戳、完整转写、最终音频 QC | Remotion 组件和 OpenMontage 私有 Artifact |
| huobao `storyboard-breaker` | 8–15 秒段、台词最低时长、台词不能跨错段 | 公开短剧业务模型和进程内任务事实 |
| huobao `prompt-generator/video-prompt` | 段内台词来源、时间轴覆盖和不新增台词 | 其页面 mock 和旧轮询实现 |
| Seedance `long-video.md` | 原生长视频时间轴、声音状态和未完成台词的连续性锁 | 未认证 Provider 能力和平台外部 API |
