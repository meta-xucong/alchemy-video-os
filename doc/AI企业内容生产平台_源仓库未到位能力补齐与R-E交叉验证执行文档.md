# AI 企业内容生产平台：源仓库未到位能力补齐与 R/E 交叉验证执行文档

状态：`ACTIVE / AUXILIARY_EXECUTION_PLAN`

生效日期：2026-09-01

适用范围：只盘点固定参考仓库中已经存在、但当前平台尚未完整迁入的能力，并为后续逐项补齐、行为测试和独立审计提供执行顺序。自动旁白专项当前不要求用户上传音频，按《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》执行；通用参考图片、资料、Logo、MUSIC 上传不受影响。

> 本文是《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》和《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》的交叉执行清单，不是新的状态账本，也不是自动开发授权。正式章节状态以《AI企业内容生产平台_正式开发总控文档.md》和 `.codex-longrun/state.json` 为准；公共契约、模块边界和本地 MVP 规则以 `AGENTS.md`、领域/API 契约和本地 MVP 执行规格为准。

> **当前真实操作例外（2026-09-01）**：用户已明确授权本机 Aiself Grok 原生音频与显式 Doubao 的同项目对照；该例外只用于产物/听感验证，不改变 Mock/CI 默认，也不要求或恢复用户上传旁白/样音。Veyra、共享积分、VPS、部署和 Git 仍禁止；未具备来源证据的能力继续 `DEFERRED/BLOCKED`。

## 1. 底层规则

1. 每一项都必须能指向固定仓库、固定 commit、具体文件和符号/规则。只有概念描述而没有来源实现的内容，不得被包装成已迁移算法。
2. 允许的“薄壳适配”仅限现有 DTO/字段 mapper、workspace/project/权限、Storage、MIME/SHA/byteSize/ffprobe、队列、事务、幂等、重启恢复、错误归一化和脱敏。
3. 不新增第二套算法、第二个 AudioPlan、静默 fallback、猜测的阈值、变速、裁剪、补静音、自动改稿、自动补曲、并行 Provider/TTS 协议或 UI 语义。
4. 原仓库只有规则没有算法时，只能做规则校验和 fail-closed；不能自行发明拆分、评分、排序、时长修正或质量阈值。
5. 原仓库的宿主目录、Backlot、`events.jsonl`、进程内状态、原始凭据和页面 mock 不是平台事实源。
6. 一次只推进一个正式章节；本文件的候选项必须先在正式总控中登记，再进入 `IN_PROGRESS`。代码、测试和文档证据齐全后，才可申请 `READY_FOR_AUDIT`，独立审计通过后才可 `ACCEPTED`。
7. 真实 Provider/TTS/Veyra/共享积分、外部网络、VPS、部署和付费能力不因本文件自动开启。缺证据时保持 `UNAVAILABLE`、`DEFERRED` 或 `BLOCKED`。

## 2. 固定来源和当前账本

| 来源 | 固定 commit | 本机快照 | 本次使用范围 |
| --- | --- | --- | --- |
| `huobao-drama` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` | 分镜段/子镜头规则、Provider 轮询和 provider-specific 音频字段 |
| `Seedance-2.5` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` | 声音意图、参考归属、能力说明和时间轴语义 |
| `markitdown` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` | 本次无新增未迁入项；资料转换已按 C10 范围映射 |
| `OpenMontage` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` | 音频混音、旁白资产、TTS selector、样音、字幕、HyperFrames 和长旁白规则 |

用户提到的另外两套 OpenMontage 没有独立 URL、commit 和本机路径，仍是多源矩阵中的 `BLOCKED` 身份项。本文件不得把单一 `OpenMontage` 快照的语义泛化为三套来源均已核验。

### 2.1 当前正式状态（只读对账）

| 范围 | 当前状态 | 本文件中的含义 |
| --- | --- | --- |
| C11.2 | `ACCEPTED`（本地范围） | 不重新开启资料理解章节 |
| C12.4/C12.5 | `IMPLEMENTED_PENDING_AUDIT` | 总体仍未闭合，不因候选清单升级 |
| E02/S01 Pixabay | `ACCEPTED`（窄切片） | 已移植到位，本文件不重开 |
| E03/HB storyboard | `ACCEPTED`（8–15 秒窄切片） | 子镜头规则仍未完整迁移 |
| E04/S02 Piper | `ACCEPTED`（原始参数窄切片） | 不代表完整 TTS owner |
| E05/OM full_mix | `ACCEPTED`（已表达 ALCHMED8 字段窄切片） | 完整多轨/section 消费仍有缺口 |
| E06/旁白窗口 | `ACCEPTED`（来源可表达窄切片） | 完整正式资产和全量窗口仍需验证 |
| E07/转场 | `ACCEPTED`（uniform source-expressed） | mixed/continuous non-cut 保持阻断 |
| E08/分段音乐与 HyperFrames timed audio | `ACCEPTED`（窄切片） | 完整 renderer 未迁移 |
| E09/转写字幕 | `ACCEPTED`（checked timing→SRT→FFmpeg） | REQUIRED 事实链和 richer mode 未闭合 |
| E10/样音与 TimelinePlan | `ACCEPTED`（窄切片） | 完整 Studio/voice 语义未闭合 |
| E11/S08/长旁白 | `ACCEPTED`（测量反馈窄切片） | 自动 SEND_BACK/视觉重规划未闭合 |
| E12/R01 | `BLOCKED` | native owner、registry/rank、中文口音和正式资产证据不足 |
| R02–R06 | `DEFERRED/BLOCKED` | 受 R01 前置事实和各自 Exit Gate 约束，不能顺延伪造完成 |

### 2.2 与既有 R/E 文档的冲突裁定

| 既有文档 | 本文件的使用方式 | 冲突时的裁定 |
| --- | --- | --- |
| `AI企业内容生产平台_正式开发总控文档.md` | 唯一正式章节状态、活动章节和 Exit Gate 账本 | 优先于本文件；本文件不得升级状态或开启章节 |
| `AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md` | 来源 commit、文件/符号主键、覆盖状态和多源冲突事实 | 优先于本文件的来源判断；本文件只能细化执行顺序 |
| `AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md` | R01–R06 的 audio owner、TTS selector、样音和混音语义 | 仅在语音专项内覆盖旧 Piper 默认路线；不改变正式状态和公共契约 |
| `AI企业内容生产平台_C12.4-C12.5逐项源仓库迁移与验证开发文档.md` | S01–S09 的历史证据和切片编号 | 作为历史证据；与当前矩阵、正式总控不一致的状态/范围文字视为 superseded |
| `AI企业内容生产平台_当前程序源仓库纠错与逐章执行文档.md` | 已有薄壳规则、禁止项和四账本要求 | 作为执行约束；本文件不得放宽其禁止范围 |
| `AI企业内容生产平台_源仓库全量能力迁入与冲突治理总实施设计.md` | 长期能力背景和已登记缺口 | `DRAFT_FOR_USER_REVIEW` 内容不能直接授权实现、外部调用或新增契约 |

因此，本文件的“可做”只表示“已有来源且可能在当前契约内做薄适配”，不表示对应 R/E 章节已经 `READY_FOR_AUDIT` 或 `ACCEPTED`。

## 3. 来源能力缺口总表

覆盖状态和章节验收状态分开记录。`PARTIAL` 不等于完成，`READY_FOR_AUDIT` 不等于 `ACCEPTED`。

| Source ID / 来源符号 | 当前平台落点 | E 系列交叉结果 | R 系列交叉结果 | 最小可执行动作 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `HB-STORYBOARD-TIMING`；`storyboard-breaker/SKILL.md` 的 2–4 子镜头、2–6 秒和台词容量 | `packages/creative-planning/src/index.ts`、`packages/contracts/src/creative-planning.ts` | E03 只验收 8–15 秒段边界；子镜头语义未映射 | 不属于 R01 主线，但会影响 R05 的时间轴 | 对显式 `motion_beats` 做来源约束校验和负向 fixture；不自动拆镜头 | `PARTIAL`；可补校验，不可发明拆分算法 |
| `OM-ASSET-WINDOW`；`asset-director.md`、`edit-director.md` 的独立 narration asset/section `asset_id`/absolute window | `packages/persistence`、`apps/production-worker`、`services/media-runtime/runtime.py` | E06/E10 仅来源可表达窄切片 | R03/R05 的正式资产和 TimelinePlan 前置 | 只消费已有 approved、非 sample、可测量的 section asset；校验 identity/window/workspace/project | `PARTIAL`；P0，可直接做薄适配 |
| `OM-FULL-MIX`；`audio_mixer.py::_track_filters/_full_mix` 的 role/start/fade/duck/normalize/target | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、`runtime.py` | E05 已验收部分 ALCHMED8 字段 | R05 仍缺完整多轨消费 | 复用源 filter graph，补齐现有 AudioPlan 能表达的 speech/music/sfx 轨；不可表达即阻断 | `PARTIAL`；P0，可直接做来源消费 |
| `OM-VOICE-PERFORMANCE`；`voice-performance-director.md` 的 `voice_performance`、`delivery_cues`、`provider_text`、样音失败条件 | `packages/contracts`、`packages/creative-planning`、Studio/Worker 既有字段 | E10 只验收 approval fact/正式资产/window 窄切片 | R03 仍缺完整样音到正式资产闭环 | 复用既有字段做来源规则校验、设置身份和审批事实绑定；不做口音/自然度算法 | `PARTIAL`；P1，可做工程侧部分 |
| `OM-TRANSCRIBE-SUBTITLE`；`transcriber.py`、`subtitle_gen.py`、`remotion_caption_burn.py` | `services/media-runtime/runtime.py`、Worker caption path | E09 窄链路已验收 | R06 仍缺最终音频/字幕人工质量闭环 | 只闭合已有 `REQUIRED` fact→TimelinePlan→Worker→SRT/FFmpeg 路径；不引入 richer model | `PARTIAL`；P1，可做现有契约范围 |
| `OM-TTS-SELECTOR`；`tts_selector.py::TTSSelector`、`tool_registry.py::ToolRegistry` | `services/media-runtime/adapters/openmontage_audio/selector.py` | E04/Piper 窄片已验收；E12 不足 | R01/R02 的 registry discovery/rank 未迁移 | 只有在原 registry、工具树和 `lib.scoring` 均可固定复用时，才原样移植；否则 auto 继续阻断 | `PARTIAL`；条件可做 |
| `OM-HYPERFRAMES-RENDERER`；`hyperframes_compose.py::_resolve_audio_refs` 及 HTML contract | `services/media-runtime/adapters/openmontage_audio/hyperframes_audio.py` | E08 只验收 timed-audio resolver | R05/R06 仅能引用定时音频事实 | 保持 resolver 窄适配；完整 renderer 需原仓库外 HyperFrames npm 依赖 | `PARTIAL`；当前不可完整闭合 |
| `OM-COMPOSE-QC`；`compose-director.md`、`executive-producer.md` | `services/media-runtime`、Worker QC | E11/S08 只验收测量反馈和 fail-closed | R05/R06 的最终交付判断仍不完整 | 复用已有 measured duration、脚本/字幕/音频 QC 事实；动作只映射来源已有 `REVISE_NARRATION`/`REVISE_EDIT`/`BLOCK` | `PARTIAL`；可补事实链，不可自动改稿 |
| `HB-PROVIDER-SHELL`；Huobao `types.ts`、`generation.ts` 的 submit/poll/download | `packages/provider-video/src/port.ts`、Worker | 现有本地 Mock/ProviderPort 已覆盖平台边界 | 不属于 R01，但影响 R04 的 provider-specific 适配 | 保持平台 Worker 状态机；只有固定 profile 后才补 provider-specific 字段 | `PARTIAL`；条件可做 |
| `HB-NATIVE-AUDIO`；`volcengine-video.ts` 的 `generate_audio` 与 `reference_audio` | provider-specific adapter 预留 | E12/R01 仍无完整 owner 证据 | R01/R04 前置缺口 | 仅在具体 provider profile/契约固定后做独立 mapper；不得扩散到通用 Sub2API DTO | `PARTIAL/PROFILE_REQUIRED`；当前阻断 |
| `SD-SOUND-INTENT`；Seedance `prompting.md`/`references.md` | Prompt Compiler/Planning | 当前为 `PARTIAL`，已有部分声音 owner/参考约束 | 影响 R01/R04，但不替代 provider 认证 | 只映射已有 PromptPackage 字段；缺公共字段时先 ADR，不在提示词中偷塞协议 | `PARTIAL`；可审计，暂不扩契约 |
| `SD-TIMELINE-CAPABILITY`；Seedance capabilities/long-video | Provider profile | 未认证能力保持禁用 | R04 前置 | 记录能力事实和 profile 状态，不把文档能力当成可调用 API | `PARTIAL/BLOCKED` |

## 4. 可执行章节和 Exit Gate

以下是候选执行顺序，不代表当前章节已经启动。每个候选都要在正式总控登记后单独执行，完成后再由纠察员独立审计。

### N01：正式旁白资产与 section absolute window（对应 E06/E10、R03/R05）

来源：`asset-director.md`、`edit-director.md`、现有 `NarrationAssetVersion`/`TimelinePlan`/ALCHMED8 字段。

只做：

- 一个 script section 对应一个已批准、非样音、可测量的正式 narration asset；
- 复用已有 `asset_id`、section identity、`start_ms/end_ms`、workspace/project、MIME/SHA/ffprobe；
- Worker 读取现有 StoragePort，Runtime 通过已有 ALCHMED8 传递 source-expressed tracks；
- 缺 asset、重复 identity、跨工作区、窗口不合法、时长不匹配时在 compose 前阻断。

禁止：逐 cue 重新调用 Piper、猜测切点、变速、裁剪、补静音、第二 AudioPlan、静默跳过。

Exit Gate：正向产物能证明独立 asset 按 source absolute start 被 `_full_mix` 消费；缺失/重复/越权/时长不一致均有行为测试和媒体证据；状态只可从 `IN_PROGRESS` 申请 `READY_FOR_AUDIT`。

### N02：完整 source-expressed AudioPlan 与 `_full_mix` 消费（对应 E05、R05）

来源：`audio_mixer.py::_track_filters`、`_full_mix`。

只做：复用 source 的 role、绝对 `start_seconds`、volume/fade、ducking、normalize、`target_duration` 和 missing-track failure；继续区分 `_full_mix` 与 `_segmented_music`。

禁止：自造 filter graph、改变 source 的单位/顺序、把音乐窗口合并成第二协议、静默兼容未知轨道。

Exit Gate：speech/music/sfx 的来源可表达组合均有 ffmpeg/ffprobe 产物和负向边界；不支持的 partial/multiple/ambiguous window 明确 `QC_FAILED`；Worker 重启/重复不会二次提交或覆盖不可变产物。

### N03：voice performance 与样音事实门（对应 E10、R03）

来源：`voice-performance-director.md`、`asset-director.md`。

只做：把已有 `voice_performance`/`delivery_cues`/`provider_text` 绑定到现有 script/section revision；记录 provider、voice、model、settings 身份；样音批准后才允许正式资产；设置漂移重新回到样音门。

禁止：通用“自然”文案冒充质量事实、自动调整中文口音、来源没有的 provider/voice 映射、把样音升级为正式资产。

Exit Gate：缺 cue/provider_text、未批准、设置漂移、跨工作区或样音角色误用均阻断；正向关系可被 Persistence/Control API/Worker 复核；中文听感仍需人工验收。

### N04：现有 REQUIRED 字幕事实链（对应 E09、R06）

来源：`transcriber.py`、`subtitle_gen.py`、`remotion_caption_burn.py`。

只做：使用已有 checked transcript 和 TimelinePlan 时序，经 source 8-word/42-char 分组生成 SRT；按来源选择 Remotion 或 FFmpeg fallback；将 `REQUIRED` 事实贯通到 Worker 和最终产物。

禁止：从脚本文字猜时间、引入 WhisperX/diarization 作为必需依赖、改变字幕格式协议、以静态源码命中代替产物检查。

Exit Gate：字幕开启/缺事实/非法时间的正负行为测试齐全；最终 MP4 有可复核字幕和音频；丰富转写模式仍单独 `DEFERRED/BLOCKED`。

### N05：Huobao 子镜头约束校验（对应 E03）

来源：`storyboard-breaker/SKILL.md`。

只做：对已经显式给出的 `motion_beats` 校验每段的来源子镜头数量、时长连续性和台词容量；无法证明来源约束时 fail-closed。

禁止：自行决定等分、余数分配、字符贪心、镜头评分或自动把一个 8–15 秒 beat 拆成多个 beat。

Exit Gate：来源规则的正向/负向 fixture 和现有 E03 回归均通过；不改变既有 MotionPlan 公共字段，若必须改契约先走 ADR。

### N06：TTSSelector registry/rank（对应 E12/R01、R02）

前置：固定来源 registry、工具树、`lib.scoring.rank_providers` 和 provider capability/profile 事实可复核。

只做：原样移植 discovery、preferred/allowed、availability 和 rank；无可用 provider 时返回现有 `UNAVAILABLE`。

禁止：手工 provider tuple、平台自造评分/阈值、默认云路由、auto→Piper 静默 fallback。

没有上述前置事实时，R01/R02 保持 `BLOCKED/DEFERRED`，不以“实现了 selector 文件”替代 Exit Gate。

## 5. 明确不列入当前执行的项目

以下内容即使在某个参考仓库或文档中存在，也不能在本轮直接补齐：

- E11 自动 SEND_BACK、视觉延长、自动重规划：来源规则存在阈值冲突，不能擅自选优先级。
- OpenMontage 完整 HyperFrames renderer：当前项目没有对应 npm 依赖和可核验运行契约。
- WhisperX、diarization、丰富 VTT/JSON/Remotion 模式：需要额外模型/依赖和独立契约。
- Huobao/Seedance 的真实 native audio、`generate_audio`、长视频和音频引用：必须有具体 profile、能力认证和 provider-specific mapper。
- E12/R01 中文口音、真实 TTS owner、正式人工试听：一次 canary 或 WAV/MP3 产物不能替代认证。
- Wav2Lip/Kling、Veyra、共享积分、VPS、DNS、TLS、部署和付费服务。
- 未提供 URL/commit/path 的 OpenMontage-2、OpenMontage-3。

## 6. R/E 交叉验证表

| E 系列切片 | 已接受范围 | 仍未迁移的来源能力 | 对应 R 系列 | 交叉结论 |
| --- | --- | --- | --- | --- |
| E01 | 多源身份/冲突矩阵文字 | 另外两套 OpenMontage 身份仍未知 | 全部 R | 只能证明来源登记方法，不证明三源实现 |
| E02/S01 | Pixabay 单一路径、MUSIC 角色、显式导入 | 无本项缺口 | 不适用 | 不重开 |
| E03 | 8–15 秒正式段 | 2–4 子镜头、2–6 秒子镜头语义 | 影响 R05 | 仅可新增来源校验，不可新增拆镜头算法 |
| E04/S02 | Piper stdin、原始参数、WAV 实测 | 完整 owner/registry/云 profile | R01/R02/R04 | Piper 不是默认 owner |
| E05 | 已表达 ALCHMED8 `_full_mix` 字段 | 完整多轨和 section asset 消费 | R05 | N01/N02 的主要前置 |
| E06 | 来源可表达旁白窗口/cue-only 边界 | 全量正式资产和完整 absolute windows | R03/R05 | 不能把窄切片写成完整旁白 |
| E07 | uniform cut/crossfade/fade-through-black | mixed transition、continuous non-cut | R05/R06 | 未有来源等价语义就继续阻断 |
| E08 | segmented music、HyperFrames timed audio | 完整 renderer、重启/重复整合 | R05/R06 | 不新增第二 AudioPlan |
| E09 | checked transcript→SRT→FFmpeg | REQUIRED Studio 事实链、丰富模式 | R06 | N04 只补已有链路 |
| E10 | approval fact、正式 asset、TimelinePlan identity/window 窄切片 | 完整 Studio/voice/provider 语义 | R03/R05 | N03 只补事实门 |
| E11/S08 | measured duration feedback、幂等、consumer fail-closed | 自动 SEND_BACK/视觉重规划 | R05/R06 | 阻断原因仍是来源冲突，不是代码遗漏 |
| E12 | 一次历史 native/Doubao 产物与工程回归 | profile certification、人工口音、正式资产/TimelinePlan | R01/R02/R04 | 继续 `BLOCKED`，不进入 R02 |

### 6.1 R 系列交叉结论

| R 阶段 | 来源缺口 | E 系列已有证据 | 当前判断 |
| --- | --- | --- | --- |
| R01 owner/能力事实 | native owner、profile capability、正式 TTS owner | E04/E10/E12 只有窄切片或历史 canary | `BLOCKED` |
| R02 TTSSelector | registry discovery/rank/preferred/allowed | E04 只证明显式 Piper；无 registry 正向证据 | `DEFERRED/BLOCKED` |
| R03 voice performance/sample | 完整 cue、样音审批、设置不可变、正式资产关系 | E10 窄切片 | 可从 N03 开始，不能直接 ACCEPT |
| R04 native/TTS generation | provider-specific 请求、原生音频 owner、实际音轨 | E04 Piper、E12 历史 Doubao/native | `BLOCKED`，需 profile 认证 |
| R05 duration/TimelinePlan/mix | section windows、完整 AudioPlan、来源 `_full_mix` 全量消费 | E05/E06/E08 窄切片 | N01→N02 可补来源可表达部分 |
| R06 final quality/delivery | 最终字幕/转写/QC/人工听感和动作路由 | E07/E09/E11 窄切片 | N04 可补工程事实；人工质量仍外部门 |

## 7. 每章统一验证与审计格式

每个 N 章节必须单独记录：

1. 来源 commit、文件、符号/规则和摘取范围。
2. 当前平台目标文件、调用方向和薄壳改动点。
3. 冲突来源、采用理由和明确排除项。
4. 契约/状态/事件是否变化；变化必须先有 ADR 和迁移。
5. 正向行为测试、负向行为测试、重启/重复/越权测试及媒体产物证据。
6. 测试命令、实际计数、skip 和外部调用边界；静态 `rg`、typecheck 或一次 canary 不能独立作为验收证据。
7. 章节审计记录中的 `IMPLEMENTED`、`READY_FOR_AUDIT`、`ACCEPTED`、`BLOCKED` 明确区分。
8. 四账本（`.codex-longrun/state.json`、正式总控、progress/test-log、章节审计/来源登记）对账后，才允许提交 Exit Gate。

## 8. 建议执行顺序和停止条件

建议顺序：`N01 → N02 → N03 → N04 → N05 → N06`。其中 N01/N02 最直接对应当前旁白与画面对齐问题；N06 必须等待 R01 的 registry/profile 前置事实，不应为了“进入 R02”而先造 registry。

任一项出现以下情况，立即停在当前章节并记录为 `DEFERRED`/`BLOCKED`：

- 找不到固定来源文件/符号或发现来源只给原则没有算法；
- 需要新增公共字段、状态、事件、协议、UI 语义而未有 ADR/用户授权；
- 需要猜测时长、阈值、排序、fallback、provider owner 或音频角色；
- 需要真实 Provider/TTS/Veyra/网络/VPS/付费调用；
- 只能得到静态命中、类型检查或结构性绿测，不能得到行为和媒体产物证据；
- 与另一个来源发生语义冲突且无法由更高优先级文档裁定。

本文件不会改变当前状态：E12/R01 继续 `BLOCKED`，C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`；未登记的 N 章节不得自行启动。样音上传相关旧表述仅作为历史兼容事实，当前应理解为“服务端自动生成样音→审批事实→独立正式资产→TimelinePlan”。

## 9. P0/P1 本轮执行回执（2026-09-01）

本节只记录本执行清单的回执，不是正式状态账本，也不自动授权下一章。正式状态仍以 `.codex-longrun/state.json`、正式总控和章节审计记录为准。

| 项目 | 本轮结果 | 来源与证据 | 未闭合边界 |
| --- | --- | --- | --- |
| N01/P0 MIME 与旁白窗口 | `IMPLEMENTED`；技术上可提交 `READY_FOR_AUDIT` 评审 | OpenMontage 受控音频检查与既有 approved NarrationAssetVersion/TimelinePlan/ALCHMED8/Storage/Worker 路径；Runtime 通过 ffprobe format facts 映射 MIME，并在 stream/format 时长分别 finite 且大于 0 后沿用 source-aligned `max`；Worker 保留 SHA/byteSize/正时长/绝对窗口；定向 Runtime inspect `3/3`（含 NaN/Infinity fail-closed），本地 MP3 ffprobe 产物事实已复核 | 完整 restart/repeat 及全部 section-window 组合的独立产物证据仍需审计；不宣称 `ACCEPTED` |
| N02/P0 AudioPlan/_full_mix | `IMPLEMENTED`；技术上可提交 `READY_FOR_AUDIT` 评审 | 固定 OpenMontage `audio_mixer.py::_track_filters`、`_full_mix`；仅补既有 SFX 角色夹具，生产适配器未改造；`adapters/openmontage_audio/test_adapters.py` `11/11`，Runtime full-mix 定向证据沿用受控 ffmpeg/ffprobe 夹具 | 全量 source-expressible 组合及 Worker restart/repeat 仍需独立审计；不宣称完整 AudioPlan 或 `ACCEPTED` |
| N03/P1 voice performance/sample gate | `BLOCKED/DEFERRED` | 固定 `voice-performance-director.md`/`asset-director.md` 要求实际 sample provider/voice/model/settings、最敏感 section 人工审批及设置漂移回样音门；当前 `ApproveNarrationScriptRevisionCommandSchema` 无这些字段，`app.ts` 旧路径曾写死 `piper-local/platform-generic-zh`，不能伪造来源事实；当前流程不要求用户上传样音，样音必须由服务端 native/Doubao 生成；本轮未改代码/契约、未调用 TTS | 需先有 ADR/契约边界和真实生成样音审批事实；不得仅替换常量、自动批准或加入口音算法；正式资产/TimelinePlan 关系与中文听感仍是硬门 |
| N04/P1 REQUIRED 字幕链 | `IMPLEMENTED`；技术上可提交 `READY_FOR_AUDIT` 评审 | 固定 `transcriber.py`、`subtitle_gen.py`、`remotion_caption_burn.py::_render_ffmpeg`；仅在既有 FFmpeg 命令追加 `-movflags use_metadata_tags`，保留 source subtitles、`-c:a copy` 与既有 marker；N04 定向 `9/9`（含真实 bundled ffmpeg-static/ffprobe-static MP4 产物，0 skip），Worker `27/27` | Worker 集成边界仍为 fixture；丰富 VTT/JSON/Remotion、GPU/WhisperX/diarization 和人工字幕质量继续 `DEFERRED/BLOCKED`；不宣称 `ACCEPTED` |

本轮未修改公共契约、状态机或外部服务配置；未调用真实 Provider/TTS/Veyra/网络/VPS/付费服务，也未执行 Git 写入。P0/P1 的可提交评审项只能在正式章节审计记录补齐证据并同步四账本后再决定是否升级；N03 阻断未解除前，不得把 P1 解释为整体完成。

### 9.1 最新本地回归对账（2026-09-01 17:34）

本节仅补充可复核测试证据，不改变正式章节状态或授权范围。media-runtime `134/134`、OpenMontage adapters `11/11`、persistence approved/native/narration `20/20`、production-worker media-service `27/27`、creative-planning `39/39`、domain `48/48`、contracts `38/38` 均通过；root `pnpm typecheck` 与 `pnpm test` 均 exit `0`，最新 workspace 合计 `484 pass / 19 explicit environment skips / 0 fail`。所有测试使用本地 fixture/mock 或 bundled media，19 个 skip 保留为 PostgreSQL/MinIO/BullMQ 环境边界。N01/N02/N04 仍仅是技术 `READY_FOR_AUDIT` 候选；N03、N05、N06 仍 `BLOCKED/DEFERRED`。E12/R01 继续 `BLOCKED`，C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，不进入新正式章节。
