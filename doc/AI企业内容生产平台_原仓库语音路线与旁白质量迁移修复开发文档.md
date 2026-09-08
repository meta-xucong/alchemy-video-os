# AI 企业内容生产平台：原仓库语音路线与旁白质量迁移修复开发文档

状态：`SUPERSEDED / HISTORICAL_BASELINE`（当前执行以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》为准；E12/R01 状态仍以正式总控/state 为准）

生效日期：2026-09-01

适用范围：当前平台的原生视频音频、旁白 TTS、样音审批、音频所有权、时长编排、混音和音频质量验收。本文是对既有 C12.4/C12.5 语音方案的冲突修复版开发文档；它不改变公共契约、章节状态或本地 MVP 范围。

> 本文只把固定来源已有的代码、字段、参数、校验和流程重新排列成可执行的历史迁移清单，不创造第三套语音架构。当前自动旁白不要求用户上传音频：样音和正式旁白均由 native Provider 或操作者显式选择的来源 TTS 在服务端生成，人工只负责试听/审批；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 仍是兼容角色而非当前输入前提。本文中与该口径冲突的“用户上传旁白/样音”“Piper 默认 owner”文字均为历史快照，由《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》覆盖。本文本身不改变章节状态；没有固定来源或平台契约无法安全表达的能力保持 `UNAVAILABLE`、`DEFERRED` 或 `BLOCKED`。

> **2026-09-01 本机授权**：允许以现有 Aiself Grok native 和显式 Doubao 进行同项目实际对照，但不把一次真实产物写成章节验收；默认/CI Mock、无用户上传旁白和 Veyra/部署边界保持不变。

## 0. 优先级、冲突和状态规则

### 0.1 文档优先级

本文件只在“语音路线与旁白质量”这一专项范围内覆盖旧方案的冲突文字。优先级保持：

1. 用户最新明确要求；
2. 根目录 `AGENTS.md`；
3. `AI企业内容生产平台_领域模型与API事件契约.md`；
4. `AI企业内容生产平台_本地MVP执行规格.md`；
5. `AI企业内容生产平台_正式开发总控文档.md` 的阶段、状态和门禁；
6. 本文件的源仓库语音路线裁定；
7. 旧 C12.4/C12.5 语音设计及历史审计快照。

本文件不得覆盖 `AGENTS.md`、公共 DTO/事件/状态、正式总控账本或多源迁移矩阵。若本文件需要改变公共字段或模块边界，必须先另立契约/ADR，未完成前保持阻断。

### 0.2 当前状态

- C12.4/C12.5 总体继续为 `IMPLEMENTED_PENDING_AUDIT`；不得因本文落地而升级。
- 已验收的 S01/E02、E03、E04、E05、E06、E07、E08、E09、E10、E11 只代表各自来源可表达窄切片；不能被重新解释为完整语音质量或中文口音验收。
- E12 的真实 TTS、云 profile、中文口音、完整 approved narration/TimelinePlan 仍为 `BLOCKED`，除非另有明确用户授权和可复核产物证据。
- 本轮已按用户授权执行 R01 的最小代码/fixture 迁移，并将固定 OpenMontage Doubao source 链接入显式 Runtime/Worker loopback；不改变章节总状态或任何外部系统。R01 的 native owner/profile、source registry/rank 正向映射和人工口音门仍保持 `BLOCKED/DEFERRED`。

## 1. 要解决的实际问题

当前错误路线把“平台后期 Piper 旁白”当成所有新任务的权威声音，因而出现：

- 原生视频 Provider 已经生成的正确人声被后期旁白替换或静音；
- Piper 收到未经来源处理的中文数字、缩写、标点和断句，造成口音、读字和停顿错误；
- 15 秒视频片段时长被误当作语音预算，导致语音被拖慢、截断或末尾空白；
- 样音、正式旁白和用户源音频的身份边界不稳定；
- BGM、旁白和 Provider 原生音频没有单一 owner，重复混入或静默缺失无法审计。

原仓库的解决方式不是再写一套“更聪明”的变速/断句算法，而是先确定声音 owner，再选择原生音频或来源 TTS 路线，先过样音门，再按实际音频时长编排和终检。本文只迁移这条来源流程。

## 2. 固定来源基线

### 2.1 已核验的来源

| 来源 | 固定版本 | 文件/符号 | 本文使用的事实 |
| --- | --- | --- | --- |
| OpenMontage | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/grok_video.py::GrokVideo` | `supports["native_audio"] = True`、`lip_sync = True`；视频与 dialogue/lip-sync、SFX、ambient、BGM 可在单次生成中一起产生；该路径不再追加 TTS。 |
| OpenMontage | 同上 | `tools/audio/tts_selector.py::TTSSelector` | 通过 `registry.get_by_capability("tts")` 自动发现 TTS；`rank` 只返回评分，生成按用户偏好、可用性和来源评分选择，不维护平台自造 provider 元组。 |
| OpenMontage | 同上 | `tools/audio/piper_tts.py::PiperTTS::_generate` | `text` 经 stdin；保留 `model`、`speaker_id`、`length_scale`、`sentence_silence`、`output_path`；`timeout=300`；输出 WAV 并实际测量；仅适合离线/隐私 fallback，不是最佳中文表现保证。 |
| OpenMontage | 同上 | `tools/audio/doubao_tts.py::DoubaoTTS` | `speech_rate`、`enable_timestamp`、`voice_id`、`resource_id`、`sample_rate`、`format` 等来源字段；标注 natural Mandarin、long text 和 timestamp 能力；真实调用仍需授权。 |
| OpenMontage | 同上 | `tools/audio/dashscope_tts.py::DashScopeTTS`、`openai_tts.py`、`google_tts.py` 等 | 各自 provider 的字段、状态和能力只能通过 selector/registry 选择；不能把其中一家参数冒充通用 TTS 参数。 |
| OpenMontage | 同上 | `skills/meta/voice-performance-director.md` | 顶层 `voice_performance`：`performance_intent`、`pacing_profile`、`energy_curve`、`pause_policy`、`provider_notes`；section `delivery_cues`：pace、energy、emphasis、pause、`delivery_note`、`provider_text`；先做最敏感 section 样音并审批。 |
| OpenMontage | 同上 | `skills/pipelines/explainer/asset-director.md` | 每个 script section 生成独立 narration asset；样音先于批量生成；记录 provider/voice/settings；背景音乐是一条覆盖全片的独立 track；音乐不可用必须在 manifest 写明 `music_status="unavailable"`，不能静默无音乐。 |
| OpenMontage | 同上 | `skills/pipelines/explainer/compose-director.md`、`executive-producer.md` | 先探测实际旁白时长；超长回到改稿/画面规划，不能慢放、裁切或补造旁白；检查旁白覆盖、BGM 覆盖/ducking、完整转写、末句、静音间隙和最终音频。 |
| OpenMontage | 同上 | `tools/audio/audio_mixer.py::AudioMixer::_full_mix` | 输入 tracks 的 `path`、`role`（`speech`/`music`/`sfx`）、`start_seconds`、volume/fade；按 source filter graph、ducking、normalize、`target_duration` 混音。 |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/src/services/adapters/volcengine-video.ts`、`backend/src/services/generation.ts` | `generate_audio` 是视频 Provider 的原生音频开关；`reference_audio` 是输入参考，不等于最终旁白；生成并下载的 MP4 自带音频由视频任务保存，不再隐式追加 TTS。 |
| Seedance-2.5 | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/references.md`、`prompting.md` | 声音、音色、节奏、环境声、音乐和对白要声明 owner；一个受控维度不得存在两个竞争 owner；占有参考素材不等于获得声音权利。 |

### 2.2 未核验来源

用户此前提到的另外两套来源 `OpenMontage-2`、`OpenMontage-3` 未提供独立 URL、commit 和本机路径。它们在多源矩阵中继续分别标记为 `BLOCKED`，不得继承本文件的 OpenMontage 快照或语义。本文只使用上表已固定的 `upstream/openmontage`。

## 3. 原仓库语音路线（必须保持的语义）

### 3.1 先决定唯一音频 owner

声音 owner 的选择是来源流程，不是平台自行新增的自动降级：

1. **原生 Provider 音频 owner**：选中的视频 profile 有固定来源证据表明支持 `native_audio`/`generate_audio`，且该能力已经过本平台的 profile 授权和认证时，Provider 负责最终对白/口型同步/环境声；保留生成 MP4 的实际音轨，不再调用 Piper 或其它 TTS 替换它。
2. **平台 TTS owner**：视频 profile 不提供、未选择或未认证原生音频时，才按 `TTSSelector` 选择一个可用 TTS provider，生成独立 narration asset，再由时间轴/混音负责合成。TTS 选择不能写死为 Piper。
3. **用户源音频 owner**：用户明确授权的 source audio 只按既有资产角色使用，不得被当成 TTS 或音乐。
4. **静音/环境声 owner**：仅在交付计划明确选择 silence/ambience 时成立；不能因为 TTS 或音乐失败而静默伪装成成功。

同一个任务只能有一个最终 spoken-track owner。若既有 `AudioPlan`/交付契约不能表达选定 owner，先阻断并更新契约/ADR；不能通过额外私有字段或第二套 AudioPlan 偷渡语义。

### 3.2 原生视频音频路线

- `GrokVideo` 的 `supports["native_audio"]`、`lip_sync`、`best_for` 和单次 `execute` 是原生路线的来源证据。
- Huobao 的 `generate_audio` 只在其具体 Provider adapter 的来源请求中使用；来源表达式 `record.generateAudio !== 0 && record.generateAudio !== false` 不能被改写成平台全局默认。`reference_audio` 由来源 payload 作为 `{ type: "audio_url", audio_url: { url }, role: "reference_audio" }` 传入，始终是参考输入，不能被当作输出音轨。
- 通用 `packages/provider-video`/Sub2API 请求当前没有来源证明的 `generate_audio` 公共字段；不能为了“统一”把它加到通用 DTO。只有找到对应 Provider 的固定来源字段、契约和测试后，才可在该 adapter 内薄适配。
- 原生音频路径不得走“先生成 Provider dialogue、再强制静音、再用 Piper 配音”的固定分支。只有明确选择平台 TTS owner 时，才按已有所有权字段移除被归类为 Provider dialogue 的音轨。

### 3.3 TTS selector 路线

直接复刻 `TTSSelector` 的选择顺序：

- `_providers()` 调 `registry.ensure_discovered()` 后用 `registry.get_by_capability("tts")` 自动发现；
- `operation="rank"` 只做排序/展示，不生成音频；
- 生成时读取 `preferred_provider`、`allowed_providers`，先满足显式偏好，再按来源评分和可用性选 provider；
- 无可用 provider 返回来源错误，不自动把请求改成 Piper；
- `fallback_tools` 和 provider matrix 只沿用来源条目；不得另写 `PROVIDERS` tuple 或无来源排序权重。

来源 selector 已公开的输入字段保持原名和含义：

```text
text, voice_id, voice_language, voice_speed, model_id,
stability, similarity_boost, style, instructions,
speaking_rate, speed, pitch, input_type, voice_performance,
sample_mode, output_format, preferred_provider,
allowed_providers, operation, output_path
```

`operation="rank"` 只返回来源 ranking；`operation="generate"` 才调用被选中的具体工具。平台不把这些字段压缩成一个 `voice_mode` 数值，也不把某一 provider 的字段转成所有 provider 的公共默认。

平台适配仅允许把 registry 状态映射到已有 capability/preflight DTO，并加 workspace、权限、幂等、对象和错误边界；不把 OpenMontage registry、Backlot、项目目录或进程状态当作平台事实。

### 3.4 Piper 只是来源定义的离线 fallback

当 TTSSelector 明确选中 Piper（或本地 profile 明确指定 Piper）时，才使用：

```text
text -> stdin
--model <model>
--speaker <speaker_id>
--length-scale <length_scale>
--sentence-silence <sentence_silence>
--output_file <output_path>
timeout = 300
```

保留来源的字段名、默认值和 WAV 产物；以 WAV/ffprobe 实测时长为事实。来源没有 `SLOW`/`FAST`/`BRISK -> length_scale` 的符号映射，不能补数值映射、atempo、rubberband、裁切或静音填充。Piper 的 `user_visible_verification` 明确要求听取生成音频验证可懂度；Piper 不是中文口音通过的证据。

Piper 来源的 `idempotency_key_fields` 为 `text`、`model`、`speaker_id`、`length_scale`；平台只能在任务/资产边界增加自己的幂等键，不能改变来源字段组成或把样音与正式整轨共用一个事实。

### 3.5 voice performance 与样音门

- Narration-led script 先具备来源顶层 `voice_performance` 和 section `delivery_cues`；不能直接把原始 script 当作已经完成的播音稿。
- 有 `provider_text`/`delivery_cues` 时，TTS 必须使用它；没有被选中 provider 支持的 SSML/break 时，不能伪造支持。
- 先生成最敏感 section 的样音，试听并确认音色、速度、停顿、重音、情绪弧线；样音不通过先调整来源允许的 provider/voice/settings，再重新样音，不能直接批量生成。
- 批量生成必须保持已批准的 provider、voice、model 和表达设置；改变其中任何一项都要重新过样音。
- 样音是审批凭据，不是正式整轨。正式旁白必须是独立、已测量、与样音有可追溯设置关系的资产。

### 3.6 时长、编排和终检

- 先生成/取得实际旁白，再据实际 `audio_duration_seconds` 规划画面时间轴；Provider 的 8–15 秒视觉段约束不等于语音速度约束。
- 旁白超出画面：按来源回到脚本缩短或延长可承载的画面；禁止慢放、硬切最后一句、无来源补静音。
- 旁白不足：只用已声明的音乐、环境声、HOLD/B-roll 视觉尾段覆盖；没有可证明的尾段则阻断。
- 多个独立 section 只有在各自有实测音频、绝对 `start_seconds` 且由 `_full_mix` 的 `speech` tracks 消费时才开放；不能从整轨按 metadata 猜切。
- `AudioMixer::_full_mix` 保留 source `speech/music/sfx`、fade、ducking、normalize、`target_duration` 和输出顺序。`_segmented_music`、HyperFrames timed audio、video stitch 是独立来源操作，不混成新的协议。
- 最终检查复用来源的 ffprobe、转写和人工复核：音频流存在、完整 narration、末句未截断、无异常静音间隙、BGM 覆盖且可听、ducking 不遮蔽人声、无 clipping。没有可用转写/时间戳时显式 `UNAVAILABLE`/阻断。

## 4. 现有程序与本版本的冲突裁定

下表只描述待修复的来源语义偏差，不表示本轮已经改代码。

| 现有落点 | 已观察的旧逻辑 | 与来源的冲突 | 本版本的唯一修复方向 | 当前判断 |
| --- | --- | --- | --- | --- |
| `services/media-runtime/adapters/openmontage_audio/selector.py` | 自维护 `PROVIDERS` tuple，`preferred="auto"` 固定返回 Piper，云 provider 仅 metadata | 违背 `TTSSelector._providers()` 的 registry discovery、偏好/可用性/评分选择；把 Piper 误作通用默认 | 按来源 selector/registry 语义薄适配；无可用 provider 直接阻断；不新增平台排序算法 | `PARTIAL / BLOCKED_FOR_ROUTE` |
| `services/media-runtime/runtime.py::synthesize_narration_bytes` | 文档和路径把 Piper 当“authoritative local narration track” | 原生音频 owner 时不应再合成；Piper 只能是被明确选中的 TTS provider/fallback | 保留 Piper 原始命令适配，但只由选定 TTS 路径调用；原生 owner 路径直接保留 Provider MP4 音频 | `PARTIAL` |
| `services/media-runtime/runtime.py::synthesize_narration_segments_bytes` | 只支持一个 cue，多 cue fail-closed | 单 cue 阻断可作为安全边界，但不是来源的完整 section TTS/`_full_mix` 语义 | 在独立 measured section assets 与来源 `_full_mix` 消费证据齐备前继续阻断；不得宣称连续旁白完成 | `BLOCKED_FOR_MULTI_SECTION` |
| `apps/control-api/src/app.ts` | approval endpoint 固定 `sample_provider="piper-local"`、`platform-generic-zh`、`length_scale=1` | 样音 provider/voice/settings 应来自来源选定和审批事实，不能硬编码伪造中文 profile | 复用现有审批/资产契约承载来源设置；无法表达时阻断，不新增 public enum | `PARTIAL / BLOCKED` |
| `packages/persistence/src/production-repository.ts` | 无正式资产时从 brief/sourceText 直接触发 Piper | 违背 asset-director 的正式资产与样音门；原始 brief 不是已批准播音稿 | 只有已批准正式 asset 或明确选定 TTS 路径才可进入 Worker；裸 script fallback fail-closed | `CONFLICT` |
| `apps/creative-planning/src/index.ts::buildDialogueInstruction` | 无条件要求 Provider dialogue 不作为最终语音 | 只有平台 TTS owner 时才可移除 Provider dialogue；原生 owner 时会误删来源正确人声 | 依据已批准 owner 条件生成声音策略；不新增第二套 Prompt 语法 | `CONFLICT` |
| `apps/studio-web/app/pages/projects/[project_id].vue` | 自动 delivery plan 使用 `voice_mode="PLATFORM_GENERIC"` | 该值绕过 source provider/voice/sample gate，造成错误的“默认 Piper/通用音色” | 保留现有契约字段；要求 owner/provider/settings 有来源事实，否则让用户/审批流程明确选择或阻断 | `CONFLICT` |
| `packages/provider-video/src/sub2api/mapper.ts`、`packages/contracts/src/resources.ts` | 通用请求没有 `generate_audio` | 不能把 Huobao 的 provider-specific 字段硬塞到 Sub2API 通用协议 | 仅在固定 Provider 来源、profile、契约和测试齐备时做 adapter 层薄适配；否则保持 unavailable | `SOURCE_BOUNDARY` |
| `apps/production-worker/src/media-service.ts` | 已有连续旁白/ownership 门禁，但主要围绕平台旁白路径 | 需要先区分 native owner 与 TTS owner，不能默认进入 Piper/静音 Provider dialogue | 复用现有 TaskRun/Asset/AudioPlan 和恢复语义，按来源 owner 分支；未能安全表达的分支 fail-closed | `PARTIAL` |

## 5. 源代码到平台的迁移矩阵

每一行必须能回指固定文件/符号。平台改动只能是薄壳，不改变来源输入、输出、默认值、错误、顺序和副作用。

| Source ID | 来源实现 | 平台目标 | 保留内容 | 允许的薄适配 | 不得添加 | 当前覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| `OM-NATIVE-AUDIO` | `grok_video.py::GrokVideo` | `packages/provider-video` 的已认证 provider adapter、Worker 音频保存 | `native_audio`、`lip_sync`、单次生成和 MP4 实际音轨 | profile/capability snapshot、任务 ID、Storage、MIME/SHA/ffprobe、错误归一化、恢复 | 通用 TTS 替换、强制静音、第二音轨 owner、未认证字段 | `NOT_MAPPED / E12 BLOCKED` |
| `HB-NATIVE-AUDIO` | Huobao `volcengine-video.ts`、`generation.ts` | 对应 provider-specific adapter（若 profile 固定） | `generate_audio`、`reference_audio` 的输入/输出区别、下载 MP4 | DTO mapper、权限、ProviderAttempt、产物校验 | 将 `reference_audio` 当成最终人声；给通用 Sub2API 加无来源字段 | `PARTIAL / PROFILE_REQUIRED` |
| `OM-TTS-SELECTOR` | `tts_selector.py::TTSSelector` | `services/media-runtime/adapters/openmontage_audio/selector.py` 或等价 Runtime adapter | registry discovery、`preferred_provider`、`allowed_providers`、`operation=rank`、来源 scoring/fallback | 受控 registry 读取、能力快照、workspace/权限、错误/审计投影 | `PROVIDERS` 手工 tuple、auto 固定 Piper、静默跨 owner fallback | `PARTIAL` |
| `OM-PIPER` | `piper_tts.py::PiperTTS::_generate` | `services/media-runtime/adapters/openmontage_audio/piper.py`、Runtime | stdin、原始命令字段、默认值、WAV、`timeout=300` | 受控临时路径、Storage、MIME/SHA/ffprobe、应用错误 | pace 数值映射、变速、裁切、补静音、中文口音承诺 | `PARTIAL / E04 narrow ACCEPTED` |
| `OM-DOUBAO` | `doubao_tts.py::DoubaoTTS` | `services/media-runtime/adapters/openmontage_audio/doubao.py` → explicit Runtime/Worker loopback | `speech_rate`、timestamp、voice/resource/format、submit→poll→download、source timeout/metadata | 凭据边界、脱敏、内部 bytes/MIME/SHA/size/ffprobe | 自动选音、fallback、把字段泛化到 Piper/公开视频 DTO、时长修正 | `历史 IMPLEMENTED / VERIFYING，当前 BLOCKED`（完整 E12 口音/owner 仍 BLOCKED） |
| `OM-VOICE-PERFORMANCE` | `voice-performance-director.md` | Script/Planning 私有输入、现有 narration quality/approval | `voice_performance`、`delivery_cues`、`provider_text`、样音 gate | schema mapper、版本关系、审批事件、对象/权限 | generic NATURAL 文案、原文直接 TTS、未批准设置批量生成 | `PARTIAL / E10 narrow ACCEPTED` |
| `OM-ASSET-DIRECTOR` | `asset-director.md` | Persistence/Worker/Studio 现有资产流程 | section narration asset、样音先行、独立背景音乐、manifest `music_status` | Asset version、Storage、幂等、公开脱敏、workspace | 样音冒充正式整轨、音乐不可用时静默无 BGM | `PARTIAL` |
| `OM-COMPOSE-QC` | `compose-director.md`、`executive-producer.md` | Runtime/Worker composition、QC、审计 | 实测时长反馈、脚本/画面回规划、BGM/ducking、转写/最终试听 | 现有 QC DTO、TaskRun/ProductionRun、错误归一化 | `atempo`、裁切、静音伪填、静态检查冒充听感 | `PARTIAL / S08 narrow ACCEPTED` |
| `OM-FULL-MIX` | `audio_mixer.py::_track_filters/_full_mix` | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、Runtime | track role/path/start/fade、ducking、normalize、target duration | 临时路径、对象读取、MIME/SHA/ffprobe、产物持久化 | 自造 `adelay/amix` 图、把 `_segmented_music` 混成同一协议 | `PARTIAL / E05 narrow ACCEPTED` |
| `SEEDANCE-SOUND-OWNER` | `references.md`、`prompting.md` | PromptPackage/owner 既有字段 | 声音意图、单一 owner、参考音频权利边界 | 私有 prompt 编译、能力快照、脱敏 | 同一维度同时让 Provider 和 TTS 负责、猜测权利 | `PARTIAL` |

## 6. 分阶段实施顺序与 Exit Gate

这些阶段是执行顺序，不是当前状态升级。每阶段只能在正式总控登记后独立实施。

### R01：声音 owner 与能力事实（前置）

目标：用现有契约/能力快照表达 native owner、TTS owner、USER_SOURCE 或 SILENT；不能用 `PLATFORM_GENERIC` 作为未决的默认答案。

实施：

1. 对照固定 provider source，登记 `native_audio`/`generate_audio`/`reference_audio` 的具体 profile 事实。
2. 若现有 `AudioPlan`/DeliveryPlan 无法表达 owner，先更新契约/ADR；不在 Runtime 偷塞字段。
3. Native owner 路径保留 Provider MP4 音频；TTS owner 路径才允许进入 selector。

Exit Gate：有正/负 fixture 证明 native owner 不调用 TTS、TTS owner 不重复保留被声明为 Provider dialogue 的音轨、reference audio 不会成为输出；无 profile 证据则 `BLOCKED`。

### R01 实施与独立纠察记录（2026-09-01 00:53；局部 IMPLEMENTED，完整 R01 BLOCKED）

- `services/media-runtime/adapters/openmontage_audio/selector.py` 已按固定 `TTSSelector._providers()` 语义移除手工云 provider tuple；当前 Runtime 没有来源 registry，因此 `auto`/空值明确 `UNAVAILABLE`，只有显式 `piper`/`piper_tts` 保留 OpenMontage 原始 Piper fallback。未新增 provider 字段、评分、阈值或网络调用。
- `apps/production-worker/src/media-service.ts` 在 `CONTINUOUS_NARRATION` 且没有 approved narration bytes/tracks、同时存在 canonical script 或 cue 时，于 synthesis 前沿用现有 `QC_FAILED` 失败路径；不会把持久化层生成的 cue/script 默默送入 Piper。已有 approved narration asset/`inspectAudio`/时长反馈路径保持。
- 定向 fixture：`services/media-runtime` selector `2 passed / 9 deselected / 0 skipped`；`apps/production-worker` media-service `26 passed / 0 failed / 0 skipped`；均为本地 mock，无真实 Provider/TTS/网络/Veyra/VPS/Git。`git diff --check` 无错误，仅保留既有换行提示。
- 本记录只证明“无 owner 不隐式 Piper + 显式 Piper fallback”的局部边界。OpenMontage native `GrokVideo` 在当前 provider profile/公共 `VideoProviderPort` 中仍没有可核验的 `native_audio`/`generate_audio` capability，Runtime 也没有来源 registry 的 discovery/rank/positive provider fixture；因此 R01 完整 Exit Gate 仍为 `BLOCKED`，不得升级 `READY_FOR_AUDIT`/`ACCEPTED`，不得进入 R02。

### R02：TTSSelector 来源迁移

实施：

1. 删除/隔离平台自维护 provider tuple 的语义，按来源 registry discovery、rank、preferred/allowed provider 和 availability 选择。
2. 只保留来源已有 provider 的字段和 fallback 列表；云 provider 仍以 metadata/disabled profile 存在，未授权不联网。
3. 没有可用 provider 时返回已有 `UNAVAILABLE`/应用错误，不静默切 Piper。

Exit Gate：registry discovery、rank 不生成、偏好选择、不可用阻断、provider matrix 和幂等行为测试全通过；无手工排序或新评分阈值。

### R03：voice performance 与样音 gate

实施：

1. 从现有 script/section 事实映射来源 `voice_performance`/`delivery_cues`；不改写用户显示原文。
2. 生成最敏感 section 样音，记录 provider/voice/model/settings；审批后才允许批量。
3. 样音和正式 narration asset 分离；settings/provider/voice 变化必须重新样音。

Exit Gate：样音未批准、设置漂移、缺 `provider_text`/cue、跨 workspace 或把样音当正式资产时均阻断；通过的样音与正式资产有可审计关系。

### R04：原生音频与 TTS 生成

实施：

1. Native profile 使用来源原生音频字段/调用顺序；下载的实际 MP4 音轨直接进入产物事实。
2. TTS profile 使用 selector 选中的具体 provider 字段；Piper 仅在明确选中时按原始命令和 `timeout=300` 执行。
3. 任何 provider-specific 字段不扩散到通用 `VideoGenerationInputSnapshot`/Sub2API mapper；无法表达就阻断。

Exit Gate：native fixture 证明无重复 TTS；TTS fixture 证明 `provider_text`、参数、WAV/实际时长；真实 provider/TTS 仍需用户授权，未授权只做 fixture。

### R05：实际时长、TimelinePlan 与来源混音

实施：

1. 以独立、实测 narration assets 形成已有 TimelinePlan/AudioPlan；不从整轨猜切 section。
2. 多段 speech 只通过来源 `_full_mix` 的 absolute `start_seconds`、role、fade、ducking、normalize、target duration 消费。
3. 超长回到文案/画面规划；短旁白只由明确音乐/环境/HOLD/B-roll 覆盖；没有事实则阻断。

Exit Gate：独立 section 产物、目标时长、间隙/重叠、BGM 覆盖、重启/重试和不可表达窗口均有行为/媒体证据；不得用结构绿测代替产物。

### R06：最终音频质量与交付

实施：

1. 按选择的 renderer 路径复用来源音频处理：Remotion 路径不再额外调用 `audio_mixer`；FFmpeg 仅作为来源规定的 fallback。
2. 用最终产物 ffprobe/转写/人工试听复核完整 narration、末句、口音、节奏、BGM、ducking、静音和 clipping。
3. 失败按来源动作区分 `REVISE_NARRATION`、`REVISE_EDIT`、`BLOCK`；不把所有错误归为成功或静默降级。

Exit Gate：有脱敏、可重放的最终 QC 事实；缺少转写/听感/中文 profile 时明确 `UNAVAILABLE/BLOCKED`，不升级章节。

## 7. 验证清单（只接受行为和媒体证据）

### 7.1 单元/契约

- `TTSSelector` 的 registry discovery、`rank`、preferred/allowed provider、无 provider 错误；不存在固定 auto→Piper 断言。
- `PiperTTS` 的 stdin、原始参数、默认值、`timeout=300` 和 WAV 输出；非法/未映射 pace fail-closed。
- Native provider 的 capability/profile DTO 与 provider-specific `generate_audio`/`reference_audio` 分离；通用 Sub2API 请求不凭空增加字段。
- `voice_performance`/`delivery_cues`/`provider_text` 的 schema 和设置版本关系；样音/正式资产角色隔离。

### 7.2 Runtime/Worker 行为

- Native owner 产生带音频的 MP4 时，调用计数证明没有 Piper/TTS 二次生成，原音频流保留。
- TTS owner 只调用被 selector 选中的 provider；Piper 只有明确选择时执行；选择失败不静默 fallback。
- 样音未批准、正式 asset 缺失、provider/voice/settings 漂移、跨工作区、MIME/SHA/ffprobe 不一致均阻断。
- 独立 narration sections 由 `_full_mix` 按绝对起点消费；未形成完整 measured windows 时多 cue 继续阻断。
- 22 秒旁白/30 秒目标和超长旁白场景按来源回到视觉/文案规划；没有 `atempo`、裁切、无来源 padding。
- AUTO BGM 只选明确 `MUSIC` asset；音乐不可用有 manifest 状态，不静默生成“无 BGM 成功片”。

### 7.3 产物/人工

- 对 WAV/MP3/OGG/MP4 检查实际 MIME、字节数、SHA、ffprobe、audio stream 和 duration。
- 最终音频转写与 canonical spoken script 对比；无词、末句截断、异常静音、BGM 不可听或 clipping 不能被结构性测试掩盖。
- 口音、断句、重音、速度和情绪必须人工试听；无授权 provider/profile 或无可听产物时保持 `BLOCKED`。

所有测试都要记录固定来源、命令、fixture/产物、pass/fail/skip 和是否外部调用。静态 `rg`、类型检查和单次成功不能单独作为 Exit Gate。

## 8. 禁止事项与兼容边界

禁止：

- 把 Piper 设成所有任务的隐式权威旁白；
- 无条件静音所有 Provider dialogue；
- 以 `PROVIDERS` tuple、平台自造评分、`SLOW/FAST` 数值、atempo、rubberband、裁切、静音填充、自动数字/缩写改写或新 SSML 协议修复听感；
- 新增第二套 AudioPlan、第二套审批工作流、通用 `generate_audio` 字段或隐藏的 native/TTS fallback；
- 把样音、普通 `AUDIO`、`USER_SOURCE_AUDIO` 当作正式旁白或音乐；
- 把 OpenMontage registry、Backlot、project_dir、events.jsonl 或临时路径当平台事实；
- 在没有用户授权时调用真实 TTS/Provider、网络、Veyra、共享积分、VPS、部署或 Git。

兼容：历史没有 AudioPlan 的任务继续 `LEGACY_PRESERVE`；历史视频、TaskRun、NarrationAssetVersion、VideoVersion 不原地重写。新路径若无法由来源和现有契约安全表达，先阻断而不是改变历史语义。

## 9. 与旧开发文档的对照和覆盖

以下是本版本与旧文档的明确关系。`SUPERSEDED` 只覆盖列出的语音路线文字；旧文档中的非冲突来源证据、状态历史和已验收窄切片继续保留，不能当作当前实现授权。

| 旧文档 | 旧结论 | 本版本裁定 | 标记方式 |
| --- | --- | --- | --- |
| `AI企业内容生产平台_C12.4连续旁白轨道与分段视频音频编排开发设计.md` | 新任务默认 `PLATFORM_NARRATION`，Provider dialogue 作为非最终音频；完整 Piper/平台旁白优先 | owner 先决；native provider 音频可为最终 owner，TTS 只在明确选择时执行；保留 AudioPlan、绝对时间、样音/正式资产隔离和 fail-closed | 语音 owner/强制静音段落 `SUPERSEDED`；时间轴和混音来源段 `RETAINED/HISTORICAL` |
| `AI企业内容生产平台_C12.5口播语速优先与弹性总时长编排开发设计.md` | 默认 `CONTINUOUS_NARRATION + PLATFORM_NARRATION`，通过统一平台旁白解决全部口播 | 自然语速/实际时长规则保留，但 owner 不能预设为平台 Piper；native path 保留 Provider 音频 | 默认 owner/Piper 路线 `SUPERSEDED`；时长反馈、禁止变速/裁切 `RETAINED` |
| `AI企业内容生产平台_C12.4-C12.5最小化源仓库适配修改方案.md` | 完整 script 一次 Piper 是主要正式路径 | Piper 仅是 selector 明确选择的离线 fallback；正式 asset/sample、`_full_mix` 和阻断规则保留 | Piper 全局权威表述 `SUPERSEDED` |
| `AI企业内容生产平台_C12.4-C12.5逐项源仓库迁移与验证开发文档.md` | S02 把 Piper 单次生成作为独立迁移主线，S09 再补 provider | 迁移顺序先 owner/capability，再 selector/sample，再具体 TTS；原 S02 证据只证明 Piper 窄切片 | 语音路线章节 `SUPERSEDED`；S01/S03/S08 等不冲突证据 `RETAINED` |
| `AI企业内容生产平台_当前程序源仓库纠错与逐章执行文档.md` | E04/E10/E12 以本地 Piper 作为主要旁白验证路径 | 本地 Piper 结果只证明 fallback/产物边界，不能替代 native owner、selector、中文口音和人工样音 | E04/E10/E12 语音路线描述 `SUPERSEDED`；状态/证据 `HISTORICAL` |
| `AI企业内容生产平台_源仓库能力完整吸收与兼容优化方案.md` | 当前 Provider 没有独立 TTS，TTS 只作为后置结构化接口 | 以来源 `TTSSelector` 与 native capability 双路线为准；保留 `VoicePerformance`/cue 结构和不可用阻断 | 第 3.4 节路由判断 `SUPERSEDED` |
| `AI企业内容生产平台_源仓库全量能力迁入与冲突治理总实施设计.md` | `audio_mode` 提案可把 Grok/Sub2API 当前标为 `PLATFORM_NARRATION`，本地 Piper 为默认降级 | `audio_mode` 仅作为候选领域字段；真正 owner 必须有 profile/source 事实，native audio 不得被统一改成平台旁白 | 语音 owner/default fallback 段 `SUPERSEDED`；领域模型提案仍 `DRAFT/HISTORICAL` |
| `AI企业内容生产平台_开发决策记录.md` ADR-0051/0052 | `PLATFORM_NARRATION` 作为连续旁白默认 owner | 由本文件对应的新 ADR 覆盖；native/TTS owner 条件化，保留自然时长与历史兼容 | ADR-0051/0052 保留原文并标 `SUPERSEDED (voice route)` |
| `AI企业内容生产平台_正式开发总控文档.md`、`AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md` | 章节状态/来源矩阵账本 | 不被本文改写；仅增加本文件为语音专项参考，并继续按 state/formal/audit 账本 | `RETAINED / STATUS AUTHORITY` |

## 10. 实施记录模板

每次实际迁移必须追加一行，不得只写“已适配”：

```text
Source ID：
固定仓库/commit：
来源文件/符号：
输入/输出/默认值/错误/副作用：
平台目标文件/符号：
保留的原始变量和调用顺序：
必要薄壳（workspace/权限/Storage/DTO/幂等/错误/脱敏）：
删减内容及来源依据：
正向行为和媒体产物证据：
负向/重启/重复/跨工作区证据：
人工/真实调用证据（未授权则 BLOCKED）：
状态：NOT_STARTED | IMPLEMENTED | READY_FOR_AUDIT | ACCEPTED | BLOCKED
审计日期：
```

若只通过静态源码搜索、类型检查或结构夹具，状态最多为 `IMPLEMENTED`，不能写 `READY_FOR_AUDIT`/`ACCEPTED`。测试 skip 必须保留，不得折算为 pass。

## 11. 完成定义

语音修复只有同时满足以下条件，才可提交相应窄切片审计：

1. 音频 owner 能由固定来源和现有契约唯一解释；无 owner 事实即阻断。
2. Native provider、TTS selector、Piper fallback、样音 gate、正式 asset、TimelinePlan、`_full_mix` 和最终 QC 各自有来源映射，不存在平行算法。
3. 代码/测试只增加平台边界薄壳，保持 workspace、Storage、幂等、恢复、MIME/SHA/ffprobe、错误和脱敏；不把边界误写成媒体算法。
4. 有正向、负向、重启/重复和必要的受控媒体产物证据；人工听感或真实 provider 缺失时明确保留 `BLOCKED`。
5. 旧任务和非冲突文档继续兼容；新文档、正式总控、矩阵、来源登记和审计记录的状态口径一致。

本文件完成的是“方案冻结和旧方案冲突裁定”，不是代码已经修好，也不是中文口音或真实 TTS 已验收。

## 12. E12 Doubao source mapper 与用户授权 smoke 补记（2026-09-01；MAPPER_ONLY/PARTIAL，完整 E12 BLOCKED）

- 用户已明确提供外部 Doubao Speech 凭据并授权一次来源级连通性 smoke。凭据只保留在本机外部 secret/用户环境，未写入仓库；来源环境名为 `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`，本次实际 profile 为 `seed-tts-2.0` 与 `zh_female_vv_uranus_bigtts`。
- `services/media-runtime/adapters/openmontage_audio/doubao.py` 仅按固定 OpenMontage `tools/audio/doubao_tts.py::DoubaoTTS`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`）保留 submit/query URL、请求 header/body、输入 `voice_id`/`resource_id` 覆盖、错误提示和 secret redaction。它不执行 HTTP、不注册 provider、不接入 selector、不改变 Runtime/Worker/Contracts/API；这是一层 source-shaped private mapper，不是平台 TTS route。
- `test_doubao.py` 与 selector fixture `7 passed / 9 deselected / 0 skipped`，并通过 `py_compile`/`git diff --check`。source `DoubaoTTS.execute` smoke 完成并产出 MP3 `57372` bytes、metadata `2506` bytes；主机无 `ffprobe`，没有 duration 断言。
- 使用仓库 bundled `ffprobe-static` 对同一 MP3 做离线补充检查：`codec=mp3`、24 kHz、mono、`2.856000s`、57372 bytes；不新增外部调用或平台协议。
- 以上 smoke 只证明来源凭据/resource/voice 能连通，不能证明平台 owner/profile、正式 NarrationAsset/TimelinePlan、section windows 或中文口音听感。`OM-DOUBAO=MAPPER_ONLY/PARTIAL`，E12/R01 仍 `BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`；原文关于平台未注册 cloud route 的限制继续有效。

## 13. E12/R01 Doubao 显式 Runtime 薄壳实施复核（2026-09-01；历史 VERIFYING，当前 BLOCKED/已回收）

本节覆盖第 12 节授权前的 MAPPER_ONLY 文字；第 12 节保留为历史审计快照，不再描述当前代码。

- 固定来源仍为 OpenMontage `tools/audio/doubao_tts.py::DoubaoTTS`（`4eab34c5cfcccaa4f1970554928feccce73ee930`）。适配器逐项保留 `_headers`、`_submit_body`、`_generate`、`_poll_query`、`_audio_duration` 的 URL、headers/body、预查询 sleep、status 2/3、timeout、metadata 和 voice/resource 语义；只把结果搬运为平台内部 bytes/MIME/SHA/size/duration。
- `main.py` 仅在显式 `preferred_provider=doubao|doubao_tts` 调用 Runtime Doubao helper；`selector.py` 对 auto/unknown 无 registry 继续 fail-closed，显式 Doubao 需 API key，显式 Piper 保留离线兼容。没有自动选择、第二 provider、变速、补静音、UI 或计费逻辑。
- 为跨进程适配新增的 schema/client 字段全部是 loopback 私有 source fields（voice/resource/format/sample_rate/speech_rate/timestamp/usage/poll/timeout），不进入公开视频 DTO、AudioPlan 或 Provider 通用协议。Worker 外层 timeout 跟随 source `timeout_seconds`。
- 证据：Media Runtime `151/151`、Doubao/selector adapter `24/24`、Worker Runtime Client `23/23`，0 skip/fail；handler fixture 覆盖显式字段/MIME 与 auto fail-closed，typecheck/py_compile/diff-check 通过。
- 用户授权真实 Runtime smoke 使用 `seed-tts-2.0`/`zh_female_vv_uranus_bigtts` 返回 `audio/mpeg`、37212 bytes、bundled ffprobe 1850ms。仅证明 source/profile/格式和调用链，不证明人工普通话口音、正式 narration asset/TimelinePlan、native owner 或完整 R01/E12 Exit Gate。
- 历史状态（已回收）：本窄切片 `IMPLEMENTED/VERIFYING`，当前完整 E12/R01=`BLOCKED`；总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，不得进入 R02。无来源支持的 registry/rank、native owner、section windows、Studio 审批、REQUIRED 字幕和超长 consumer 行为继续保留；本节 route/smoke 仅为历史证据，不构成当前验收或新的外部调用授权。

## 14. 2026-09-01 native-first / explicit-Doubao 当前实测对账（未验收）

- 用户最新授权覆盖：视频 Provider 原生音频优先；只有原生结果被人工/客观检查判定不可接受时，才由操作者显式选择 Doubao。该规则不等同于自动质量评分或静默 fallback，平台默认仍为 Mock，也不增加平台自造的用量/金额硬限制。
- Native 来源映射：OpenMontage `GrokVideo.supports["native_audio"]` → 既有 `sub2api:grok-imagine-video-1.5` canary。产物为 `848x480`、`15.042s`、一条 AAC 44.1kHz stereo；ffprobe、覆盖时长和尾静音客观检查通过，但本地 Whisper 未给出可靠中文台词，故不把 native 结果写成中文口音/语义合格。
- Doubao 来源映射：OpenMontage `DoubaoTTS` → 既有 Runtime 显式 `preferred_provider=doubao`。`seed-tts-2.0` + `zh_female_meilinvyou_uranus_bigtts` 产出 `audio/mpeg`、`157212` bytes、`7.848s`、24kHz mono；无 `>=0.5s` 尾静音，内部停顿约 `0.585s`，响度约 `-24.3 LUFS`、true peak `-9.3 dBFS`。离线 Whisper 结果接近目标文本但仍有字词误识别，不能替代人工听感。
- 本地行为补全：persistence native/TTS fixture `7/7` pass、0 skip，覆盖 native preserve/no-TTS、approved narration 冲突 fail-closed、TTS owner 连续旁白以及 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 不成为最终输出。该证据只闭合局部 owner/资产隔离边界。
- 仍需人工/外部事实：Profile 的 source registry/rank 正向映射与 capability certification、正式 `NarrationAssetVersion`/TimelinePlan/section windows、样音审批、中文口音/断句/速度/情绪听感。因这些门未闭合，E12/R01 继续 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，不得进入 R02。
