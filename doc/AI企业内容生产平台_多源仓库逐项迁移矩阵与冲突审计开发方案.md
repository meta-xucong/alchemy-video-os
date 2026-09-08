# AI 企业内容生产平台：多源仓库逐项迁移矩阵与冲突审计开发方案

状态：`ACTIVE / DESIGN_BASELINE`

生效日期：2026-08-30

适用范围：当前本地 MVP 以及已经进入平台工作区的参考仓库能力。本文只定义来源追踪、冲突处理、薄壳迁移、测试和审计方法；语音专项的最新执行口径见《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》，不自动开启新的章节、Provider、TTS、网络服务或部署工作。

## 1. 方案定位与旧方案冻结

此前以 C12.4/C12.5 为中心、再按 S01-S09 汇总能力的方案自本文件生效日起冻结。语音专项旧文档另由《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》覆盖其当前 owner/样音口径。冻结文件仍保留历史实施记录和已有证据，但不再承担以下职责：

- 不再作为参考仓库能力的完整清单；
- 不再把某个阶段未接入的平台运行路径写成“原仓库没有”；
- 不再把 S04 作为音频、字幕、转场、Studio、口音和超长旁白的总容器；
- 不再作为新增代码、契约、协议、UI 或外部调用的授权来源。

冻结文件包括：

- `AI企业内容生产平台_C12.4-C12.5最小化源仓库适配修改方案.md`；
- `AI企业内容生产平台_C12.4-C12.5逐项源仓库迁移与验证开发文档.md`；
- `AI企业内容生产平台_C12.4连续旁白轨道与分段视频音频编排开发设计.md`；
- `AI企业内容生产平台_C12.5口播语速优先与弹性总时长编排开发设计.md`。

语音路线专项的当前执行文档为 `AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md`。它不取代本文的来源主键、跨仓库矩阵或状态账本；仅在音频 owner、native Provider/TTS 路由、来源 selector 和样音门发生冲突时提供更细的源符号对照。其余冻结文件中的非冲突证据继续保留为历史记录。

S01-S09 编号继续保留，改为实施和验收批次。参考仓库能力的唯一事实表是本文规定的“多源迁移矩阵”；正式章节状态仍以《AI企业内容生产平台_正式开发总控文档.md》为准。

本文不得覆盖 `AGENTS.md`、领域/API 契约、本地 MVP 范围或用户最新明确要求。当前 C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`，S01/E02、E03/HB-STORYBOARD-TIMING 8–15 秒、E04/Piper pace、E05/OpenMontage `_full_mix` + ALCHMED8、E06 approved full narration 窗口/cue-only、E07 transition/xfade 有效时长、E08 segmented/HyperFrames timed-audio、E09 转写/字幕/FFmpeg fallback、E10 approval/formal asset/TimelinePlan 和 E11/S08 measured-duration feedback 的来源可表达窄切片已为 `ACCEPTED`；E12/R01 当前为 `BLOCKED`，已有 native/Doubao source route/Runtime smoke 仅是用户授权的产物/连通性证据且不构成当前验收，完整中文口音/native owner/registry/rank 仍 `BLOCKED`；E07 混合 transition、continuous narration 非 cut 及其它未表达形态仍 `BLOCKED/DEFERRED`；S04 的历史 `IN_PROGRESS/verifying` 记录已移出活动态；付费 Kling/本地 Wav2Lip 口型同步按用户决定 `DEFERRED`，不作为当前范围阻断；本文本身不升级总体状态。

语音专项覆盖规则（2026-09-01）：矩阵中旧的“Piper/`PLATFORM_NARRATION` 默认 owner”描述只作为历史快照；当前冲突裁定见《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》。矩阵单行状态仍按本文与正式总控记录，不能因专项文档而提前 `READY_FOR_AUDIT` 或 `ACCEPTED`。

自动旁白现行口径（2026-09-01）：用户不需要上传旁白或样音；样音由 native Provider 或操作者显式选择的 Doubao 在服务端生成，并在通过人工审批后才可继续正式资产/TimelinePlan。`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 仅为兼容角色，不进入当前自动旁白输入。详细执行顺序、真实对照和冲突覆盖以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》为准。

## 2. 固定来源基线

当前工作区已登记的四个源仓库及固定 commit：

| 来源 | 固定 commit | 本机目录 | 主要职责 |
| --- | --- | --- | --- |
| `huobao-drama` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` | Nuxt/Hono 产品骨架、任务交互、分镜节拍和部分 Provider 字段 |
| `Seedance-2.5` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` | 提示词结构、参考归属、声音意图、时间轴和能力说明 |
| `markitdown` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` | 授权对象流的文档/PDF/表格/演示文稿转换 |
| `OpenMontage` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` | Artifact、媒体分析、音频/视频处理、转写、字幕和 QC |

`sub2api-video-mcp`、本地 `sub2api` 和 `Alchemy Media Agent System` 是协议或字段事实参考，不等同于当前 `upstream/` 下的源码快照；必须在矩阵中单独标注为 `PROTOCOL_REFERENCE`，不能声称已经复制了其实现。

每次审计前必须只读确认各来源的 `HEAD`、工作树和固定 commit。上游目录只作溯源和摘取，不进入平台 Git。

## 3. 范围边界

### 3.1 必须纳入矩阵的内容

1. 当前平台代码、契约、测试或文档已经声称提供的源仓库能力。
2. 当前工作区改动实际触及的源仓库语义。
3. 多个来源对同一个平台字段、时长、资产角色、声音意图、任务或失败路径的定义。
4. 已发现但尚未选择平台运行路径的源能力，例如 OpenMontage `_segmented_music` 和 HyperFrames timed audio。
5. 明确不迁入的源仓库宿主能力，例如 Backlot、项目目录、`events.jsonl`、短剧业务表、任意 URL converter 和个人助手入口。

### 3.2 不得借矩阵扩大范围的内容

- 新增 Provider、TTS、曲库、评分模型、时长算法、静默 fallback 或 UI 语义；
- 真实 Provider/TTS/Veyra/共享积分、网络、VPS、SSH、DNS、TLS、部署和付费调用；
- 将多个来源的算法混合成第三套算法；
- 把源仓库的本地目录、进程内状态、全局 Agent 或原始凭据当作平台事实源。

## 4. 矩阵的规范行

每个矩阵条目以“来源仓库 + 固定 commit + 文件 + 符号/规则”为稳定主键。禁止只写仓库名、目录名或概念名。

| 字段 | 要求 |
| --- | --- |
| `Source ID` | 例如 `OM-AUDIO-FULL-MIX`，一个源语义单元一个 ID |
| `Source` | 仓库、commit、相对路径、类/函数/规则/测试 |
| `Source semantics` | 输入、输出、默认值、单位、错误、顺序和副作用 |
| `Platform target` | 目标模块、文件、符号和调用方向 |
| `Semantic owner` | 谁拥有该操作的媒体/内容语义；只能有一个 |
| `Thin adaptation` | 仅列权限、workspace、Storage、DTO、队列、幂等、错误和脱敏 |
| `Conflict set` | 其它来源对同字段或同流程的定义，以及冲突点 |
| `Decision` | 采用来源、保持独立 mapper、暂不选择或阻断的理由 |
| `Excluded` | 被排除的宿主依赖及原因 |
| `Positive evidence` | 来源等价输入产生的行为或产物 |
| `Negative evidence` | 缺失、非法、冲突、重复、重启、越权和未支持边界 |
| `Integration evidence` | API → Persistence → Worker → Runtime → Storage/Outbox |
| `Status` | 来源覆盖状态和验收状态分别填写 |

来源覆盖状态只表示“源能力与平台的对应关系”：

```text
MAPPED       已有明确平台落点
PARTIAL      只迁入源语义的明确子集
NOT_MAPPED   源能力存在，但尚未选择平台运行路径
DEFERRED     源能力存在，但明确不在当前阶段
EXCLUDED     源宿主能力按架构边界不迁入
SOURCE_UNAVAILABLE  固定来源中确实没有安全对应实现
```

验收状态沿用正式开发规则：

```text
NOT_STARTED -> IMPLEMENTED -> READY_FOR_AUDIT -> ACCEPTED
                                      \-> BLOCKED
```

`IMPLEMENTED_PENDING_AUDIT` 只用于章节或总体范围，不用于矩阵单行。

## 5. 多源冲突处理规则

### 5.1 先确定语义所有者

同一个平台字段不等于同一个源语义。按操作确定所有者：

- 分镜节拍、台词边界和参考归属：由 Huobao/Seedance 对应规划规则负责；
- 音频混音、音轨角色、fade、ducking、normalize：由 OpenMontage 选定音频工具负责；
- 文档转换：由 MarkItDown converter 负责；
- 平台身份、workspace、权限、对象、队列、事务、公开 DTO 和审计：由平台契约负责。

来源宿主的路径、数据库、进程状态和 Provider 调用不因“语义所有者”而进入平台。

### 5.2 同字段不同含义不得静默合并

若多个来源定义了 `duration`、`music`、`dialogue`、`reference`、`start/end` 或错误状态，必须分别记录：

1. 来源原始含义和单位；
2. 平台字段的规范含义；
3. 哪个来源拥有当前操作；
4. mapper 如何转换；
5. 哪些来源语义不能在该操作中使用；
6. 证明不发生静默覆盖的测试。

如果现有契约无法解决冲突，条目保持 `BLOCKED` 或 `DEFERRED`，不得自行选择默认值、阈值、fallback 或新协议。

### 5.3 当前音频链的明确判定

- OpenMontage `_full_mix` 是当前 FFmpeg 混音路径的来源；它消费 speech/music/sfx tracks、`start_seconds`、volume/fade、ducking、normalize 和 target duration。
- OpenMontage `_segmented_music` 是另一个来源操作；它有 `[start,end]` 音乐窗口，但不能被自动伪装成 `_full_mix` 的同一输入契约。
- HyperFrames 的 timed audio 依赖独立音频文件和 `data-start/data-duration`；不能把单个整轨 bytes 载荷推断切成多个文件。
- Huobao 的台词容量估算只能用于规划；实际旁白时长必须来自已生成资产的 WAV/ffprobe 事实。
- Seedance 的声音策略负责提示词和参考意图；它不能静默改变 OpenMontage 的混音图，也不能自动添加 BGM。
- MarkItDown 不拥有音频混音语义；它只负责授权对象流的资料转换和安全边界。

## 6. 源能力到平台模块的初始映射

以下是矩阵的初始种子，不代表所有条目已经完成：

| Source ID | 来源 | 平台目标 | 当前覆盖判断 |
| --- | --- | --- | --- |
| `HB-STORYBOARD-TIMING` | `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md` | `packages/creative-planning` | `PARTIAL`；E03 8–15 秒窄切片=`ACCEPTED`（仅切片），子镜头语义仍未映射 |
| `HB-PROVIDER-SHELL` | `upstream/huobao-drama/backend/src/services/adapters/types.ts`、`backend/src/services/generation.ts` | `apps/task-worker`、ProviderPort | `PARTIAL`；不迁入进程内轮询和短剧表 |
| `SD-SOUND-INTENT` | `upstream/seedance-2.5/skill/seedance-25/SKILL.md`、`references/prompting.md`、`references/references.md` | `packages/creative-planning`、Prompt Compiler | `PARTIAL` |
| `SD-TIMELINE-CAPABILITY` | `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`、`references/capabilities.md` | Prompt/能力 profile | `PARTIAL`；未认证 Provider 能力保持禁用 |
| `MD-CONVERT-STREAM` | `upstream/markitdown/packages/markitdown/src/markitdown/_markitdown.py::MarkItDown.convert_stream` | `services/document-runtime` | `MAPPED`/按 C10 范围验收 |
| `OM-FULL-MIX` | `upstream/openmontage/tools/audio/audio_mixer.py::_full_mix` | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、`runtime.py` | `PARTIAL`；E05=`ACCEPTED`（仅已表达的 ALCHMED8 字段窄切片） |
| `OM-SEGMENTED-MUSIC` | `upstream/openmontage/tools/audio/audio_mixer.py::_segmented_music` | `services/media-runtime/adapters/openmontage_audio/segmented_music.py` + `runtime.py` 内部 helper | `ACCEPTED`（窄切片）；来源操作薄适配、fixture/受控产物证据、纠察复核和独立验收完成 |
| `OM-HYPERFRAMES-AUDIO` | `upstream/openmontage/tools/video/hyperframes_compose.py::_resolve_audio_refs`、HTML audio contract | `services/media-runtime/adapters/openmontage_audio/hyperframes_audio.py` + `runtime.py` 内部 helper | `ACCEPTED`（窄切片）；独立音频 refs/timing 薄适配、fixture 证据、纠察复核和独立验收完成 |
| `OM-VIDEO-STITCH` | `upstream/openmontage/tools/video/video_stitch.py` | S05 Media Runtime | `ACCEPTED`（E07 仅 uniform source-expressed transition 窄切片；混合/continuous non-cut 保持 `BLOCKED/DEFERRED`） |
| `OM-TRANSCRIBE-SUBTITLE` | `upstream/openmontage/tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py`、`tools/video/remotion_caption_burn.py` | S06 Media Runtime | `ACCEPTED`（E09 仅 source-expressed checked timing→8/42 SRT→FFmpeg fallback 窄切片）； richer source modes/Studio fact chain `DEFERRED/BLOCKED` |
| `OM-VOICE-SAMPLE-GATE` | `upstream/openmontage/skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md` | S07 Studio/Control API | `ACCEPTED`（E10 仅 approval fact + 独立正式资产 + TimelinePlan identity/window 窄切片）；完整 Studio/voice 语义仍 `DEFERRED/BLOCKED` |
| `OM-LONG-NARRATION` | `upstream/openmontage/skills/pipelines/explainer/compose-director.md`、`executive-producer.md` | S08 规划和 consumer | `ACCEPTED`（仅 E11/S08 内部 measured-duration feedback/consumer fail-closed 窄切片；自动重规划/视觉延长仍 `DEFERRED/BLOCKED`） |
| `OM-NATIVE-AUDIO` | `upstream/openmontage/tools/video/grok_video.py::GrokVideo` | provider-specific video adapter / Worker audio preservation | `PARTIAL/NOT_MAPPED`；native 音频保留已作为现有 owner 边界适配，来源 profile/capability 完整认证仍缺；其中 `lip_sync` 按用户决定 `DEFERRED`，不得追加 Piper 替换 |
| `HB-NATIVE-AUDIO` | `upstream/huobao-drama/backend/src/services/adapters/volcengine-video.ts`、`services/generation.ts` | 对应 provider-specific adapter（仅在 profile 固定后） | `PARTIAL/PROFILE_REQUIRED`；`generate_audio` 与 `reference_audio` 的来源差异已登记，不能扩散到通用 Sub2API DTO |
| `OM-TTS-SELECTOR` | `upstream/openmontage/tools/audio/tts_selector.py::TTSSelector` | `services/media-runtime/adapters/openmontage_audio/selector.py` | `PARTIAL`；auto/unknown 无 registry fail-closed，显式 provider 走 availability gate；完整 registry discovery/rank 仍未迁移 |
| `OM-TTS-PROFILES` | `upstream/openmontage/tools/audio/piper_tts.py`、`doubao_tts.py` 及其他 TTS adapters | S02/S09 Runtime profile | E04/S02=`ACCEPTED`（Piper 窄切片）；E12/R01 Doubao 显式 route=`VERIFYING`（历史，已回收为 `BLOCKED`），profile smoke 已完成且仅为历史证据；中文口音/完整 owner/registry 仍 `BLOCKED` |
| `OM-PIXABAY` | `upstream/openmontage/tools/audio/pixabay_music.py`、音乐选择流程 | S01 音乐源 adapter | `ACCEPTED`（仅 S01 切片） |

矩阵补全时必须继续增加“明确排除”行，而不是只增加已实现行。

OM-PIXABAY 最新验证（基础 `last_verified_at=2026-08-31T01:52:23+08:00`）：合并 Control API 命令 `23/23`（Pixabay client `6/6` + Control API `17/17`）；独立窄切片为 client `6/6`、Runtime source adapter `4/4`、handler `3/3`、Control API 角色/导入/幂等 `5/5`、capability BLOCKED `1/1`、loopback `1/1`、Studio explicit Pixabay/no-auto-catalog `1/1`；均为 fixture/mock、0 skip；另有 `last_verified_at=2026-08-31T08:25:25+08:00` 的 Runtime finite supplemental fixture `1/1`，拒绝 `NaN`、`Infinity`、`-Infinity` duration。窄切片与合并命令覆盖重叠、不另行相加。该证据已通过独立审计，矩阵状态为 `ACCEPTED`（仅 S01 切片），E03 已进入下一独立执行切片。

## E03/HB-STORYBOARD-TIMING 当前执行对账（2026-08-31）

- 固定来源为 `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `backend/workspace/skills/storyboard-breaker/SKILL.md`；段落硬边界为 8–15 秒，台词容量按 `字符数 / 4.5 + 2`，装不下沿来源规则阻断/移到后续段，不引入新的余数、慢放或填充算法。
- 本轮最小适配只把正式 `StoryboardShotSpec`/Domain 校验下限收口到 8 秒，并在 DeterministicPlanningModel 生成后复用既有 `STORYBOARD_SPEC_INVALID` 校验；无法组成合法 `[8,15]` 段时 fail-closed。未改 MotionPlan `motion_beats` 兼容 schema、editorial score、remainder 分配、台词贪心分组或 UI/API。
- 当前状态 `ACCEPTED`（仅 8–15 秒窄切片）；creative-planning `38/38`、domain `43/43`、contracts `36/36`（全 fixture/local，0 skip）已通过并完成 READY→ACCEPTED 独立审计流程。未映射子镜头语义不在本切片结论内；E04/Piper pace 已进入下一独立执行切片。

## E04/S02 Piper pace 当前执行对账（2026-08-31）

- 固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/piper_tts.py::PiperTTS._generate`、`tools/audio/tts_selector.py::TTSSelector` 与 `skills/meta/voice-performance-director.md`；本地只复用原始参数/stdin/WAV 实测/`timeout=300`，不构造 symbolic pace 数值。
- `services/media-runtime/adapters/openmontage_audio/piper.py` 仅保留来源默认 `NATURAL=1.0`；`SLOW`、`FAST`、`BRISK` 无固定来源映射，Runtime 在调用 Piper 前 fail-closed。selector 的云 provider 仅为 metadata，未形成第二执行路径。
- 定向证据：adapter source-conformance `4/4`、Runtime Piper/WAV/error/unsupported pace `6/6`，补充 SLOW/FAST/BRISK fail-closed `1/1`、contracts export `32/32`；全为 fixture/mock，0 skip/fail，无真实 TTS/Provider/Veyra/网络/VPS/Git。
- 当前状态：E04/S02=`ACCEPTED`（仅 Piper pace/原始参数窄切片）；E05/OpenMontage `_full_mix` + ALCHMED8=`ACCEPTED`（仅已表达字段窄切片）；E06 approved full narration 窗口与 cue-only 边界=`ACCEPTED`（仅来源可表达窄切片）；E07 uniform transition/xfade 与有效时长=`ACCEPTED`（仅来源可表达窄切片；混合 transition、continuous narration 非 cut 和其它未表达形态保持 `BLOCKED/DEFERRED`）；总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`。

## E05/OM-FULL-MIX + ALCHMED8 当前执行对账（2026-08-31）

- 固定来源为 OpenMontage `audio_mixer.py::_track_filters/_full_mix`；本地 `full_mix.py` 保留 volume→fade→ffprobe fade-out→absolute `adelay` 顺序、speech/music/sfx 分组、source ducking (`ratio=9`、`level_sc=1`、`mix=0.9`)、target `apad/atrim`、loudnorm 和 music-only `amix` 路径。Runtime 只把已有 ALCHMED8 字段映射到来源 track，平台差异限于 workspace/Storage/MIME/SHA/byteSize/ffprobe/受控命令边界。
- 定向实跑证据（本地 fixture/mock，0 skip/fail）：Runtime `18 passed / 94 deselected`；full-mix adapter `3/3`；Production Worker `53/53`。覆盖 independent speech、music-only、SFX/source preservation、角色/资产/跨 workspace、gain/fade/ducking、目标时长、不可表达窗口 fail-closed、对象冲突、Worker 重启/重复和受控 FFmpeg/ffprobe 产物。
- E05 已完成独立审计并为 `ACCEPTED`（仅已表达 ALCHMED8 字段窄切片）；该证据不关闭 approved section windows、transition/xfade、字幕/转写、Studio、中文口音或超长旁白 consumer 等其它矩阵条目。E07 已完成来源可表达 uniform transition 窄切片独立审计并为 `ACCEPTED`；“E09 为当前唯一活动切片”是历史快照，现行活动为 E10。

## E06/OM-VOICE-WINDOWS 当前执行对账（2026-08-31）

- 固定来源为 OpenMontage explainer 的 narration/asset 规则与 `audio_mixer.py::_full_mix` speech-track 输入；仅允许已有独立、非样音、已测量 PRIMARY section 资产按 `{path, role: "speech", start_seconds}` 消费，或唯一从 0 覆盖全目标的 `PLATFORM_NARRATION` 整轨走兼容形态。
- 来源无法表达的 partial/multiple windows、缺失 asset version、样音冒充正式资产和 cue-only 多 cue 继续已有 fail-closed；不逐 cue 调 Piper，不裁剪、变速、补静音，不从脚本文本推断窗口。
- E06 已完成 `READY_FOR_AUDIT`→`ACCEPTED`（仅来源可表达窄切片）；transition/xfade、字幕、Studio、中文口音和超长旁白 consumer 继续阻断。

### E07 transition/xfade 与有效时长当前执行对账（2026-08-31；窄切片已验收）

- 用户已授权最小平台映射：`PASS→cut`、`BLEND→crossfade`、`BRIDGE→fade-through-black`。固定来源为 `tools/video/video_stitch.py` 的 `_stitch_cut`/`_stitch_crossfade`/`_stitch_fade_through_black`、`_get_xfade_offset`（`max(0, …)` 后 round）和 `_chain_xfade`（累积 offset、无 `tpad`）。
- `services/media-runtime/runtime.py` 仅做既有 Runtime 的薄壳映射：统一 source transition 使用 0.1–5.0 秒 schema 值，移除无来源的 `tpad`，保留 source offset/effective-duration 语义；cut 的 filter concat 只声明时间轴等价，不宣称来源 concat-demuxer/`-c copy` 编码等价。
- 定向 fixture/mock 证据：`python -m pytest -q tests/test_runtime.py -k "maps_pass_to_source_cut or maps_bridge_to_source_fadeblack or cumulative_offset_rounding or rejects_mixed_source_transition_plan or rejects_different_bridge_durations or continuous_narration_crossfade"` → `6 passed / 113 deselected / 0 failed / 0 skipped`；纠察员独立复核通过，无真实 Provider/TTS/Veyra/网络/VPS/Git。
- Exit Gate：E07 来源可表达 uniform transition 窄切片=`ACCEPTED`；mixed transition、不同 bridge duration、continuous narration 非 cut 及 target mismatch 均已在 FFmpeg 前 `QC_FAILED`，保持 `BLOCKED/DEFERRED`。该历史记录的下一活动切片为 E09，现行活动已推进至 E10；E08 segmented/HyperFrames 仍需独立授权，总体 C12.4/C12.5 维持 `IMPLEMENTED_PENDING_AUDIT`。

### E09/OM-TRANSCRIBE-SUBTITLE 当前执行对账（2026-08-31；窄切片已验收）

- 固定来源为 OpenMontage `tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py::_build_cues/_hmsms` 与 `tools/video/remotion_caption_burn.py::_render_ffmpeg`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- `services/media-runtime/runtime.py` 仅做 source-expressed 薄壳：受控 CPU/int8 word timestamps，8词/42字 cue grouping，SRT 毫秒进位，checked timing 后走来源 FFmpeg `subtitles` fallback；缺能力/timing 在 FFmpeg 前 fail-closed。修复 cue flush 后必须从当前词重新起 cue的来源偏差。
- 定向 fixture/mock 证据：Runtime focused `11 passed / 111 deselected / 0 failed / 0 skipped`；完整 Runtime `122 passed / 0 failed / 0 skipped`；纠察员独立复核通过。无模型、TTS、Provider、网络、Veyra、VPS 或 Git。
- E09 source-expressed transcript/subtitle/FFmpeg fallback 窄切片=`ACCEPTED`。GPU/device/model/language metadata、diarization、Remotion 主渲染、VTT/JSON/correction/highlight、脚本文本推时序、中文口音和完整 Studio REQUIRED 事实链保持 `DEFERRED/BLOCKED`。下一活动切片为 E10 Studio 样音/正式资产/TimelinePlan；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### E06 定向证据提交（2026-08-31；提交前快照，已由下方状态对账 supersede）

- 固定来源：OpenMontage explainer narration/asset 规则及 `audio_mixer.py::_full_mix` speech-track 输入（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`）。实现仅消费独立、非样音、已测量 PRIMARY section 资产或唯一从 0 覆盖全目标的整轨兼容形态；其它窗口/样音/cue-only 多 cue 均保持 fail-closed。
- 新鲜本地 fixture/mock 证据（2026-08-31T10:10:04+08:00）：Runtime `17 passed / 95 deselected`；full-mix adapter `3 passed / 8 deselected`；Persistence approved narration timeline `13 passed`；Production Worker 选择集 `6 passed`；均 0 fail/skip，无 TTS、网络或外部服务。
- 提交时证据支持 E06 已表达 source window/asset 边界的 `READY_FOR_AUDIT` 申请；该状态已由后续独立审计收口为 `ACCEPTED` 窄切片。不关闭 transition/xfade、字幕、Studio、中文口音或超长旁白 consumer 等后续硬门；未新增逐 cue Piper、时长修正、裁剪、变速、补静音或第二协议。

## 7. S01-S09 的新用法

S01-S09 只作为执行批次。每个批次开始前必须列出它负责的 `Source ID`，结束时只关闭这些条目：

1. 固定来源和语义记录完成；
2. 目标模块和依赖方向确认；
3. 冲突已解决，或明确记录为 `BLOCKED/DEFERRED`；
4. 只做来源代码/规则的直接迁移和边界薄适配；
5. 完成来源等价、负向、集成和产物验证；
6. 同步来源登记、测试日志、章节审计和状态账本。

阶段通过不代表其它矩阵条目通过。例如 S04 通过只能证明 ALCHMED8 到当前 `_full_mix` 运行路径的映射，不代表 `_segmented_music`、HyperFrames、字幕、Studio 或真实 TTS 已迁移。

## 8. 当前改动的追溯审计流程

在继续编码前，先对现有工作区做一次只读审计：

1. 列出当前所有用户改动和本轮变更文件；不覆盖、回滚或删除用户改动。
2. 对每个目标文件/符号反查固定来源；没有来源的新增行为标记为 `UNREFERENCED`。
3. 找出同一目标字段被多个来源定义的冲突集合。
4. 检查实现是否把来源宿主路径、数据库、进程状态或 Provider 调用带入平台。
5. 检查是否存在第二套算法、阈值、协议、静默 fallback 或平行 UI 语义。
6. 为每个变更补齐矩阵行、来源登记和回归测试；无法证明的保持阻断。

该流程先审计 S01-S04 的既有改动，再决定是否允许后续批次。没有完成来源和冲突对账，不得以“补测试”代替迁移证明。

## 9. 测试和校验方案

### 9.1 来源等价层

- 命令参数、字段名、单位、默认值、错误和调用顺序；
- 源 filter graph、converter、prompt 约束或 schema 的等价行为；
- 源仓库已有测试向量优先复用，不能用自造阈值替代。

### 9.2 平台边界层

- workspace/project 权限、对象 key、MIME/SHA/byteSize/ffprobe；
- DTO/事件/错误映射和公开脱敏；
- 队列、事务、幂等、重复投递和 Worker 重启。

### 9.3 行为和产物层

- 正向、负向、冲突角色、跨 workspace、缺失资产和未支持字段；
- 音频/视频真实夹具的时长、轨道、起点、fade、字幕 marker 和可播放性；
- 产物写入前后重试以及对象冲突不可覆盖；
- Studio 样音/正式资产/TimelinePlan 的事实链。

### 9.4 外部和人工层

真实 Provider/TTS/Veyra、网络、付费和部署不进入普通 CI。需要口音、听感、字幕观感或真实服务时，单独记录用户授权、profile、次数、额度和人工结论；未授权保持 `BLOCKED`。

静态源码命中、类型检查和测试计数只能作为辅助证据，不能替代行为或产物证据。每次测试只记录最新可复核计数，skip 保留为 skip。

## 10. 文档、状态和证据同步

每个条目的状态变更必须同时更新：

- 本文迁移矩阵；
- `AI企业内容生产平台_第三方来源与复用登记.md`；
- `AI企业内容生产平台_章节审计记录.md`；
- `AI企业内容生产平台_正式开发总控文档.md`；
- `.codex-longrun/state.json`、`progress.md`、`test-log.md` 和 `blockers.md`。

同步规则：

1. 矩阵行没有证据，章节不得升级；
2. 阶段历史快照不能覆盖当前状态账本；
3. 计划、实现、待审计、已验收和阻断必须逐项区分；
4. “来源存在但未接入当前运行路径”写 `NOT_MAPPED/DEFERRED`；
5. “来源真正不存在”才写 `SOURCE_UNAVAILABLE`；
6. 任何冲突未决时，保持当前阶段不变并记录阻断原因。

## 11. 完成定义

当前范围内的一项源能力只有在以下条件同时满足时才算迁移成功：

1. 有固定来源文件/符号和平台目标落点；
2. 语义所有者唯一，跨仓库冲突有决定记录；
3. 代码只包含直接迁移和必要的薄壳适配；
4. 正向、负向、集成和必要的媒体产物证据齐全；
5. Worker 重启、重复、越权和敏感信息边界有证据；
6. 不支持能力明确保持 `DEFERRED/BLOCKED`；
7. 文档、状态账本和测试记录一致。

“完整迁入”只适用于矩阵中已声明的当前范围，不等于复制上游全部宿主工程。对整个 C12.4/C12.5 的交付声明，还必须满足所有在范围内的 S 批次和正式章节 Exit Gate；任何真实 Provider/TTS/口音或外部部署结论必须另有授权和证据。

## 12. 当前执行顺序

```text
冻结旧 C12 方案
  -> 盘点四个来源和当前工作区改动
  -> 补全源符号到平台落点矩阵
  -> 对同字段/同流程做跨仓库冲突决定
  -> 复核 S01-S04 已有迁移和证据
  -> 仅按用户授权逐条补全
  -> 行为/集成/产物测试
  -> 独立审计和状态对账
```

在矩阵和冲突对账完成前，不启动新章节，不扩大 S04，不调用真实外部服务，不执行 Git 写入。

### E01 多源符号矩阵与冲突裁定（2026-08-31）

| 来源（固定 commit/path/symbol） | 来源语义 | 平台目标/所有者 | 薄壳适配与冲突裁定 | 状态/证据 |
|---|---|---|---|---|
| huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795；`storyboard-breaker` 时长规则 | 分镜口播容量按 8–15 秒与台词预算约束 | creative-planning / storyboard domain | 历史快照曾记录平台允许 1–15 秒；E03 已按来源收口正式段边界，子镜头语义仍单列为未映射，禁止用自造阈值掩盖 | PARTIAL；E03 8–15 秒窄切片=`ACCEPTED` |
| huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795；Nuxt project/task flow | 项目、参考图、任务式交互 | Studio / Control API | 仅复用交互骨架，领域状态仍归平台 API；样音审批未形成闭环 | PARTIAL/NOT_MAPPED |
| Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7；固定 skill/reference paths 不足以证明媒体运行时 | prompt、reference、duration 参数语义 | provider-video PromptPackage | 与 Huobao/平台短段规则冲突时记录，不改公共契约；未找到可核验 OpenMontage 同名副本 | BLOCKED（来源 path/URL 需独立核验） |
| markitdown@fd239d5d2be43d9b68329730206b9312c7d5a388；`_markitdown.py:MarkItDown.convert_stream` | 受控对象流转换、格式选择 | document-runtime | 仅增加授权对象流/loopback 边界，不接受任意 URI | SOURCE_MAPPED；既有 runtime 证据 |
| OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930；`tools/audio/piper_tts.py:PiperTTS._generate` | canonical script 经 stdin；`--model/--speaker/--length-scale/--sentence-silence/--output_file`；WAV/实测时长；subprocess timeout=300 | media-runtime Piper adapter | E04/S02=`ACCEPTED`（仅窄切片）；仅 NATURAL=1.0 有来源，SLOW/FAST/BRISK 无来源映射，保持 fail-closed | SOURCE_MAPPED；云 TTS/口音仍未认证 |
| OpenMontage；`tools/audio/audio_mixer.py:_full_mix/_track_filters` | speech/music/sfx tracks、absolute start、fade→delay、duck/normalize、正 target、缺轨失败 | media-runtime / ALCHMED8 | `_full_mix` 与 `_segmented_music`/HyperFrames 是不同协议，不混用；仅消费已有 ALCHMED8 字段 | SOURCE_MAPPED；S03 ACCEPTED；S04 为历史 verifying、不活动 |
| OpenMontage；`skills/pipelines/explainer/asset-director.md` | 每 section 独立 narration asset、asset id/path/duration、时长校验 | persistence/Worker asset facts | 无独立 section asset 或样音冒充正式资产即 fail-closed | PARTIAL/NOT_MAPPED |
| OpenMontage；`skills/pipelines/explainer/edit-director.md` | narration asset_id + absolute start/end；有序、无重叠、对齐视觉 | TimelinePlan/AudioPlan | 现有整轨与 section windows 尚未全量实际消费 | PARTIAL |
| OpenMontage；`skills/pipelines/explainer/compose-director.md` | 先 probe duration，超长回规划；不裁剪/变速/静默伪填 | composition/final review | 现有兼容路径仍有未闭合 full-track/尾段门 | PARTIAL/FAIL-CLOSED |
| OpenMontage；`subtitle_gen.py` / `remotion_caption_burn.py` | checked timing 生成字幕并烧录 | runtime captions | REQUIRED 字幕事实链与 Studio 传递未完整证明 | PARTIAL/NOT_MAPPED |
| OpenMontage；`voice-performance-director.md` | provider_text、pause/pace/energy、样音审批 | narration quality | 中文口音与样音→正式资产隔离仍需人工/事实证据 | PARTIAL |
| 其他名为 OpenMontage 的目录/快照 | 无固定 URL、commit、path 可核验 | 不分配平台所有者 | 不猜测、不纳入迁移证据 | BLOCKED（独立来源不可核验） |
| OpenMontage-2（待核验身份占位） | URL/commit/path 未提供 | 不分配平台所有者 | 禁止继承 OpenMontage@4eab34c… 的快照或语义；待用户提供固定来源后再建符号矩阵 | BLOCKED（缺少固定 URL+commit+path） |
| OpenMontage-3（待核验身份占位） | URL/commit/path 未提供 | 不分配平台所有者 | 禁止继承 OpenMontage@4eab34c… 的快照或语义；待用户提供固定来源后再建符号矩阵 | BLOCKED（缺少固定 URL+commit+path） |
| OpenMontage transitions/bridge（未定位固定符号） | transition 时长应进入视觉预算 | composition | 无固定来源符号与证据，保持阻断 | BLOCKED |

E01 裁定（历史状态对账）：总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`；S04 的 `IN_PROGRESS/verifying` 为历史记录，已移出活动态；当时 S01/E02 为 `ACCEPTED`（仅切片），当时 E03 尚未启动。该句为历史快照；现行 E03/HB-STORYBOARD-TIMING 状态与证据以本文前述“当前执行对账”及正式总控文档为准。字幕、Studio sample approval、长旁白、transition、完整 section windows 与多源冲突均不得宣称完成。

### E10/OM-VOICE-SAMPLE-GATE 迁移与审计提交（2026-08-31 11:26:59；IN_PROGRESS）

- 固定来源：OpenMontage `skills/meta/voice-performance-director.md` 与 `skills/pipelines/explainer/asset-director.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。来源顺序为样音先审批、再生成正式旁白；正式资产需独立于样音、可测量，并保持 provider/voice/settings 一致。
- 平台仅复用既有 approval event、独立非样音 READY asset-version、workspace/project/version/MIME/SHA/byte-size/duration 校验和显式 TimelinePlan absolute section windows；缺失审批/资产/时间线、样音对象复用、版本漂移、重叠、跨工作区均 fail-closed。没有新增公共契约、Provider 映射、算法或 UI 语义。
- 新鲜 fixture/mock 证据：creative-planning `7/7`、persistence `16/16`、Control API `2/2`、Production Worker `7/7`、Studio `24/24`，全部 `0` fail/skip、无外部调用。该证据可提交 E10 窄切片 `READY_FOR_AUDIT` 评审，但本矩阵状态仍 `PARTIAL/IN_PROGRESS`，等待独立审计和四账本确认。
- 不得从本窄切片推导 source 顶层 `voice_performance`/完整 section `delivery_cues`、最敏感 section 自动选择或人工听感、样音路径/provider settings manifest、OpenAI/Google/ElevenLabs 映射、完整 Studio 样音→正式资产→TimelinePlan UI/API、真实 TTS/中文口音，亦不得把平台 `normalizeNarrationSections`/`buildNarrationTimeline` 写成来源算法；均保持 `DEFERRED/BLOCKED`。

### E11/OM-LONG-NARRATION 来源盘点与 S08 窄切片（2026-08-31 13:19；ACCEPTED；完整 E11 未验收）

- `E11/S08` 内部 measured-duration feedback、decision-log 幂等和 compose 前 consumer fail-closed 窄切片已完成独立审计并收口为 `ACCEPTED`；不得把该切片写成完整 E11。当前开发授权仅为固定 OpenMontage `skills/pipelines/explainer/compose-director.md` 与 `executive-producer.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`；`scene-director.md:146-169` 仅同源审计候选/`DEFERRED`，不构成当前开发授权；本阶段不将任何平台自有算法泛化为来源事实。
- 仅允许迁移来源明确的 measured narration duration、超长改稿/重新生成或视觉尾段延长决策、禁止慢放/裁剪/补静音，以及已表达的 visual hold/ambient 关系。没有固定来源的阈值、评分、时长修正、Provider 选择、第二协议或 UI 状态保持 `DEFERRED/BLOCKED`。
- 固定来源逐符号映射已登记：`compose-director.md:80-107` 为 85–90% 时长预算、2.0–2.5/2.5–3.0 words/sec、OpenAI TTS 原始参数与 `audio_duration_seconds` 超长反馈、Pixabay `query/min_duration/max_duration=300/output_path`；`:140-143` 为 narration/music 覆盖与 ducking 前置校验；`:190-210` 为 Remotion 音频路径及不可用时 FFmpeg `audio_mixer` 的 layer→music→duck→normalize→输出顺序。`executive-producer.md:233-242` 为 actual duration 探测、`EP_STATE.narration_durations`、`1.15` 超长 SEND_BACK、`25%` 内 scene-plan 调整及总时长更新；这些重规划/延长行为在平台未实现，不得声称已完成。
- 既有 consumer 落点 `services/media-runtime/runtime.py:1983-2022,2504-2524`、`apps/production-worker/src/media-service.ts:464-485,513-595` 继续只消费已测量资产并对尾段/超长 fail-closed；本轮 S08 薄适配将来源 `EP_STATE.narration_durations` 记录到私有 decision log，`SEND_BACK`、`ADJUST_SCENE_PLAN` 和规则重叠的 `SOURCE_DECISION_REQUIRED` 均在 compose 前阻断。没有新增 CompositionPlan/ALCHMED 字段、协议、时长修正或自动重规划。
- 来源冲突仅做边界协调：compose-director `>1s` 与 executive-producer `1.15/25%` 规则的重叠没有来源优先级，平台不选择动作，保留 `source_actions=[SEND_BACK,ADJUST_SCENE_PLAN]` 并 fail-closed。
- 最新本轮实际回归证据（全部本地 fixture/mock，0 fail）：Contracts `37/37`、Domain `48/48`、Production Worker 全量 `56/56`，E11 选择集 `7/7`；Persistence 幂等集成在项目自带本地 PostgreSQL 容器上 `1/1`；相关 `tsc --noEmit`、`validate_state.py`、`git diff --check` 均通过，无 Provider/TTS/Veyra/网络/VPS/Git 或其它外部调用。独立审计已将该内部 feedback 窄切片收口为 `ACCEPTED`；E11 完整自动 SEND_BACK/视觉延长/重规划/弹性时长保持 `DEFERRED/BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### E08/OM-SEGMENTED-MUSIC + OM-HYPERFRAMES-AUDIO 启动与来源映射（2026-08-31 13:54:48；历史启动快照）

- E08 是当前唯一活动切片；E11/S08 内部 measured-duration feedback 窄切片仍为 `ACCEPTED` 历史结果，完整 E11 自动重规划/视觉延长保持 `DEFERRED/BLOCKED`；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。本段“只做对账/未改代码”是启动时历史快照，当前实现证据见下方 checkpoint。
- 固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/audio/audio_mixer.py::AudioMixer.execute` 将 `operation="segmented_music"` 独立分派到 `_segmented_music`；该函数接收 `video_path`、`music_path`、`music_volume`、`segments[{start,end}]`、`fade_duration`、`output_path`，按 `start` 排序构造分段 volume/fade 表达，保留旁白 unity（`amix normalize=0`），并把视频流与 shaped music 混合后输出。该操作不得并入 `_full_mix`。
- 同一固定来源 `tools/video/hyperframes_compose.py::_resolve_audio_refs` 与 `skills/core/hyperframes.md:143-162` 将 `asset_manifest.assets[]` 的独立音频文件解析为 narration/music HTML `<audio>`，以 `data-start`/`data-duration`（及来源的 track/volume 关系）表达时间窗；平台只接受已授权、已验证的独立音频 asset/file 和有限属性，不能照搬来源缺失时静默 `continue`、basename 路径 fallback，不能把一个整轨 bytes 猜切为多个文件。
- 当前平台差异：`services/media-runtime/adapters/openmontage_audio/` 只有 `_full_mix`、Piper、Pixabay 等既有 adapter，`services/media-runtime/main.py`/`runtime.py` 没有独立 `segmented_music` operation 或 HyperFrames audio resolver；`MediaRuntimeCompositionPlan`/ALCHMED8 也没有该来源 HTML 载荷。后续如实现，只能在既有受控 Runtime/Storage/权限边界内做内部薄适配，不新增公开 UI/API/Provider/网络协议。
- 待实施的 fail-closed 证据范围：平台 invalid/non-finite/out-of-range windows、missing independent asset、workspace/project/role/MIME/SHA/ffprobe 不一致及未验证 `data-start`/`data-duration` 均拒绝；来源适配器保留 `_segmented_music` 的 overlap `+` additive 与 HyperFrames 的输入顺序，既有 `MediaRuntimeCompositionPlan.music_segments_ms` 在 Runtime 边界拒绝 overlap。保持 `_segmented_music` 独立于 `_full_mix`，不新增阈值、算法、静默 fallback 或第二 AudioPlan。启动段“尚无测试计数”是历史快照，当前证据见下方。

### E08/OM-SEGMENTED-MUSIC + OM-HYPERFRAMES-AUDIO 实施 checkpoint（2026-08-31 14:40；ACCEPTED 窄切片）

- 来源薄适配落点：`services/media-runtime/adapters/openmontage_audio/segmented_music.py::OpenMontageSegmentedMusicMixer` 镜像 `_segmented_music` 的 source 参数、排序、fade expression、overlap additive `+`、`amix normalize=0` 和输出映射；`hyperframes_audio.py::OpenMontageHyperFramesAudio` 镜像 `_resolve_audio_refs`/HTML `data-start`/`data-duration`、track 2/3、optional/zero end fallback 与 source volume default。仅增加既有 workspace/project、Storage facts、MIME/SHA/byte-size/ffprobe、路径和错误薄壳。
- Runtime `segment_music_video_bytes` 保持 segmented operation 独立，并在既有 CompositionPlan windows 契约处做有序非重叠门禁；`resolve_hyperframes_audio_refs` 要求显式 workspace/project scope，不新增公开 API/UI/Provider/协议。
- 本地行为/产物证据：adapter focused `14/14`；Runtime focused `3 passed / 122 deselected / 0 failed / 0 skipped`；Runtime full `125 passed / 0 failed / 0 skipped`；adapter combined `25 passed / 0 failed / 0 skipped`。受控 ffmpeg/ffprobe/WAV fixtures 实际执行，全部 fixture/mock、0 skip，无外部调用。
- 纠察员已完成技术来源/范围/计数复核，独立验收通过，E08 窄切片由 `READY_FOR_AUDIT/verifying` 收口为 `ACCEPTED`。完整 HyperFrames renderer、重启/重复整合、完整 AudioPlan/section windows、Studio/字幕/中文口音/超长旁白等硬门保持 `DEFERRED/BLOCKED`。

### E12/OM-TTS-PROFILES 真实 TTS 与中文口音授权门（2026-08-31；BLOCKED）

- 来源主键仍为固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的已登记 TTS adapters/selector。当前已迁移并验收的只有 Piper 原始参数/结构窄切片；不能把本地结构测试推导为中文口音或真实 Provider 质量结论。
- 真实 TTS/口音验证所需的 provider/profile、调用次数、源素材范围、额度上限、凭据注入方式和外部调用授权尚未齐备，矩阵状态保持 `BLOCKED`。在材料齐备前不新增 mapper、数值语速、时长修正、协议、UI 或网络路径。
- E12 的 `READY_FOR_AUDIT` 只能在上述材料提供后完成来源映射、离线 preflight、明确授权的真实调用与听感/产物证据时提交；现阶段不执行真实 Provider/TTS/Veyra、共享积分、网络、VPS 或付费调用。总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### E12 用户授权实测对账（2026-08-31 20:44；BLOCKED，未验收）

- 上述授权前阻断段为历史快照。用户随后授权使用现有程序能力并指定 `480p`；既有 Control API→Production Worker→`sub2api:grok-imagine-video-1.5` 30s canary、一次本地 Piper WAV 和现有 MUSIC 组成结果已在正式总控、章节审计、来源登记及长任务账本登记。该证据只覆盖现有路径/产物边界，不扩展矩阵中的来源语义。
- 最新根回归 `pnpm test` 实际为 `470 passed / 19 explicit skips / 0 failed`（18 workspace projects）；本地 fixture/mock，未新增外部调用。E12 仍 `BLOCKED`：云 TTS profile/中文口音、正式 NarrationAssetVersion/TimelinePlan、approved section windows、完整 AudioPlan、Studio/REQUIRED 字幕、transition/xfade 和长旁白 consumer 硬门未闭合。总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### R01 原仓库语音 owner 局部迁移对账（2026-09-01 00:53；局部 IMPLEMENTED，完整 BLOCKED）

| Source ID | 固定来源 | 目标/保留语义 | 当前覆盖 |
| --- | --- | --- | --- |
| `OM-TTS-SELECTOR` | `tools/audio/tts_selector.py::TTSSelector._providers`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930` | Runtime selector 去除手工 provider tuple；无 registry 时 `auto`/空值 `UNAVAILABLE`，显式 Piper 仍可选 | `IMPLEMENTED`（registry/rank 正向映射缺失） |
| `OM-PIPER` | `tools/audio/piper_tts.py::PiperTTS::_generate` | 既有 approved narration asset 与实测 WAV 路径保持；Piper 不作隐式 owner | `E04 ACCEPTED` 窄切片 |
| `OM-NATIVE-AUDIO` | `tools/video/grok_video.py::GrokVideo.supports["native_audio"]` | 当前 provider profile/`VideoProviderPort` 没有可核验 owner，保持不映射/阻断 | `NOT_MAPPED / E12 BLOCKED` |
| `R01-WORKER-GUARD` | 来源正式 asset/owner 边界 + 既有 QC 路径 | 连续旁白有 script/cue 但无 approved narration bytes/tracks 时沿用 `QC_FAILED`，不默默进入 Piper | `IMPLEMENTED`（局部安全边界） |

定向证据：selector `2 passed / 9 deselected / 0 skipped`；Worker `26 passed / 0 failed / 0 skipped`；`git diff --check` 无错误，仅既有换行提示；全部本地 fixture/mock。R01 完整 Exit Gate 仍被 native owner/profile、Runtime registry discovery/rank 和 `packages/provider-video/src/prompt-compiler.ts:33` 旧 PLATFORM_NARRATION 语义阻断；不得升级 `READY_FOR_AUDIT`/`ACCEPTED` 或进入 R02。

### R01/OM-DOUBAO source-shaped mapper 补充（2026-09-01；MAPPER_ONLY/PARTIAL，E12 BLOCKED）

| Source ID | 固定来源 | 目标/保留语义 | 当前覆盖 |
| --- | --- | --- | --- |
| `OM-DOUBAO` | `tools/audio/doubao_tts.py::DoubaoTTS`，OpenMontage commit `4eab34c5cfcccaa4f1970554928feccce73ee930` | `services/media-runtime/adapters/openmontage_audio/doubao.py` 仅保留 source submit/query URL、`X-Api-*` headers、`req_params`、`voice_id`/`resource_id` 输入覆盖、错误提示与 secret redaction | `MAPPER_ONLY/PARTIAL`；未执行 HTTP、未注册 selector、未改 Runtime/Worker/Contracts/API |

离线 fixture `7 passed / 9 deselected / 0 skipped`，`py_compile` 与 `git diff --check` 通过。用户授权的 source-level smoke 以 `seed-tts-2.0`/`zh_female_vv_uranus_bigtts` 完成并得到 MP3 `57372` bytes、metadata `2506` bytes；这只是来源/API credential 证据，不能关闭 provider owner/profile、正式 narration asset/TimelinePlan、中文口音或 E12 Exit Gate。总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`，不得进入 R02。

### E12/R01 OM-DOUBAO 显式 Runtime 迁移矩阵补记（2026-09-01；历史 VERIFYING，已回收为 BLOCKED）

| 来源（固定 commit/path/symbol） | 来源语义 | 平台目标/所有者 | 薄壳适配与冲突裁定 | 状态/证据 |
|---|---|---|---|---|
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`；`tools/audio/doubao_tts.py::DoubaoTTS._generate/_poll_query/_headers/_submit_body` | source `DOUBAO_SPEECH_API_KEY`/voice、`seed-tts-2.0`、MP3/OGG/PCM、submit→poll→download、预查询 sleep、status 2/3、source timeout/metadata | `services/media-runtime/adapters/openmontage_audio/doubao.py`；显式 Runtime narration owner | 仅补既有 Runtime 的内存 bytes、MIME、SHA/size、ffprobe、临时路径和 secret/signed-URL 脱敏；不排名、不 fallback、不新建协议 | `MAPPED/IMPLEMENTED`; adapter 13 tests |
| 同上；`tools/audio/tts_selector.py::TTSSelector._providers/_select_best_tool` | registry discovery、preferred/availability、auto 无候选时失败 | `selector.py` + `main.py` 显式 provider gate | 平台无 source registry 时 auto/unknown fail-closed；显式 Doubao 需 key；显式 Piper 保留既有兼容路径 | `PARTIAL/BLOCKED`（历史 VERIFYING；registry/rank 正向映射仍 BLOCKED） |
| 同上；`tools/audio/doubao_tts.py::DoubaoTTS.execute` result facts | output/metadata path 与 measured duration | `runtime.py::synthesize_doubao_narration_bytes`、Worker loopback client | 复用现有内部 narration DTO，source fields 不进入公开视频 DTO/AudioPlan；Worker timeout 跟随 source `timeout_seconds` | `MAPPED/BLOCKED`（历史实现证据；handler/client fixtures + 1 authorized Runtime smoke） |

- 本轮最新定向证据：Media Runtime Python `151/151`、Doubao/selector adapters `24/24`、Production Worker Runtime Client `23/23`，全部 fixture/mock、0 skip/fail；`py_compile`、Worker typecheck、diff check 通过。
- 用户授权真实 Runtime smoke：`seed-tts-2.0`/`zh_female_vv_uranus_bigtts` 返回 `audio/mpeg`、`37212` bytes、bundled ffprobe `1850ms`；不记录 key/task/request/url。该证据仅证明 profile/链路/格式，不等于人工口音、正式 NarrationAsset/TimelinePlan、native owner 或完整章节验收。
- 之前 `MAPPER_ONLY/PARTIAL`、`VERIFYING` 与“未改 Runtime/Worker/Contracts/API”的行保留为历史快照；当前 E12/R01=`BLOCKED`，其实现/route/smoke 证据不构成当前验收或新的外部调用授权。总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`，其它硬门继续 BLOCKED/DEFERRED。

### 当前状态回收（2026-09-01；现行口径）

- E12/R01=`BLOCKED`；完整 owner、source registry/rank、正式 narration asset/TimelinePlan、approved section windows 和人工中文口音硬门未闭合。Doubao adapter 仍隔离保留且默认不启用。
- `apps/production-worker/src/index.ts` 已移除 `MEDIA_RUNTIME_NARRATION_PROVIDER` 全局启动注入；C12.4/C12.5 维持 `IMPLEMENTED_PENDING_AUDIT`。
