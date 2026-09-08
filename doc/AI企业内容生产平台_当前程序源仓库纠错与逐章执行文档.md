# AI 企业内容生产平台：当前程序源仓库纠错与逐章执行文档

状态：`ACTIVE / EXECUTION_BASELINE`

生效日期：2026-08-31

适用范围：当前工作区已有代码、契约、测试、来源登记和审计记录的修正、补全与验收。

本文是执行清单，不是对任何章节的自动授权。正式章节状态仍以《AI企业内容生产平台_正式开发总控文档.md》和 `.codex-longrun/state.json` 为准；本文件不能覆盖 `AGENTS.md`、领域/API 契约或本地 MVP 范围。

> **2026-09-01 语音路线冲突覆盖（SUPERSEDED）**：本文 E04/E10/E12 中把本地 Piper 写成主要旁白路线的描述，只能证明已验收的 Piper 原始参数/离线产物边界，不能成为所有新任务的声音 owner，也不能覆盖原生 Provider 音频或来源 TTS selector。语音路由、样音门和 native/TTS 冲突裁定以《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》为准；本文的状态、证据、未完成硬门和禁止真实调用规则继续有效。

> **2026-09-01 自动旁白输入覆盖（SUPERSEDED）**：当前自动视频流程不要求用户上传旁白或样音；样音由服务端 native Provider/显式 Doubao 生成并经人工审批，正式旁白必须是独立实测资产。本文中样音上传、`NARRATION_SAMPLE` 或 `USER_SOURCE_AUDIO` 只表示兼容/历史角色，不得作为新任务前置条件；通用图片、资料、Logo、MUSIC 上传仍有效。最新执行顺序以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》为准。

> **2026-09-01 本机实测授权覆盖**：用户已授权 Aiself Grok 原生音频与显式 Doubao 对照；该授权仅适用于最新自动音频文档规定的同项目本机产物，默认/CI Mock、Veyra/共享积分/VPS/部署/Git 边界不变。本文历史“真实 Provider/TTS 禁止”文字按默认章节安全门解释。

## 1. 执行结论

当前程序不是“全部迁移完成”。本地 Mock MVP、资料转换和若干媒体适配切片可以继续使用，但 C12.4/C12.5 仍不能作为完整的旁白、BGM、字幕和成片质量交付版本。

当前唯一允许的总体结论是：

- C11.2：本地范围 `ACCEPTED`；
- C12.4/C12.5：`IMPLEMENTED_PENDING_AUDIT`；
- C12.4-S01 Pixabay/MUSIC：`ACCEPTED`（仅切片；独立审计已通过）；
- C12.4-S02 Piper：历史 `READY_FOR_AUDIT` 快照（已由当前 E04 对账 supersede）；
- C12.4-S03 OpenMontage `_full_mix` 独立 speech tracks：`ACCEPTED`，仅代表该切片；
- C12.4-S04：历史 `IN_PROGRESS / verifying`（不活动）；
- E03/HB-STORYBOARD-TIMING：`ACCEPTED`（仅 8–15 秒窄切片）；
- E04/Piper pace：`ACCEPTED`（仅 Piper 原始参数/未映射 pace 窄切片，独立审计已通过）；
- E05/OpenMontage `_full_mix` + ALCHMED8：`ACCEPTED`（仅已表达字段窄切片，独立审计已通过）；
- E06 approved full narration 窗口与 cue-only 边界：`ACCEPTED`（仅来源可表达窄切片，独立审计已通过）；
- E07 transition/xfade 与有效时长：`ACCEPTED`（仅 uniform source-expressed transition 窄切片；混合 transition、continuous narration 非 cut 和其它未表达形态保持 `BLOCKED/DEFERRED`）；
- E09 转写、字幕和 REQUIRED 事实链：`ACCEPTED`（仅 source-expressed checked timing→8/42 SRT→FFmpeg fallback 窄切片，独立审计已通过）；
- E10 Studio 样音、正式资产与 TimelinePlan：`ACCEPTED`（仅 approval fact、独立正式资产和 TimelinePlan identity/window 窄切片）；完整 Studio/voice/provider 语义仍 `DEFERRED/BLOCKED`；
- E11/S08 内部 measured-duration feedback、decision-log 幂等与 compose 前 consumer fail-closed：`ACCEPTED`（仅窄切片；完整 E11 自动重规划/视觉延长仍 `DEFERRED/BLOCKED`）；
- E08 `_segmented_music` 与 HyperFrames timed audio：`ACCEPTED`（仅来源可表达窄切片），已完成当前活动切片；固定 OpenMontage 来源的独立 operation/独立音频文件薄适配、定向证据和独立验收均完成；完整 renderer/其它硬门仍未关闭；
- E12 真实 TTS、中文口音和其它外部能力：`BLOCKED`；缺少用户指定的 provider/profile、调用次数、素材范围、额度上限、凭据和外部授权；本地 Piper/结构夹具不替代真实口音验收；
- 真实 Provider、真实 TTS、Veyra、共享积分、VPS、DNS、TLS、部署和 Git 写入：关闭。

“ACCEPTED”只对明确的切片或本地章节范围有效，不代表所有源能力都已迁入。

## 2. 不可改变的底层规则

每一个执行章节都必须先回答“这一步是否确实移植了固定来源中的代码、字段、参数、校验或流程”。不能指向固定来源的新增行为，必须停止并标为 `UNREFERENCED`、`DEFERRED` 或 `BLOCKED`，不能先写完再补来源说明。

允许的平台薄壳仅限于：

- 输入/输出 DTO 和字段 mapper；
- workspace、project、权限和身份边界；
- Storage、对象键、MIME、SHA-256、byteSize、ffprobe 校验；
- 队列、事务、幂等、重试、重启恢复；
- 错误归一化、日志脱敏和公开投影。

禁止：

- 第二套算法、评分、时长修正、变速、静默填充、自动改写或自动补曲；
- 第二套 AudioPlan、ALCHMED9、并行 Provider/TTS 协议或静默 fallback；
- 把来源宿主的目录、Backlot、`events.jsonl`、进程状态或原始凭据带入平台事实源；
- 用静态命中、类型检查或一次偶然成功代替行为和媒体产物证据；
- 未经单独授权调用真实 Provider/TTS/Veyra、付费服务、VPS 或部署。

每做一步必须再次复核来源映射、冲突集合、依赖方向和负向边界；发现偏离时先停在当前章节，不跨章“顺手修复”。

## 3. 固定来源和三份 OpenMontage 的处理

当前已固定并可复核的来源：

| 来源 | 固定版本 | 当前快照 |
|---|---|---|
| `huobao-drama` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` |
| `Seedance-2.5` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` |
| `markitdown` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` |
| `OpenMontage` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` |

`sub2api-video-mcp`、本地 `sub2api` 和 `Alchemy Media Agent System` 只作为协议/字段事实参考，不得声称已复制其实现。

用户此前指出原始资料中有三个 OpenMontage。当前工作区只发现一个 `upstream/openmontage` 快照，因此必须先判定：

1. 如果“三个 OpenMontage”是三个独立仓库或不同 commit，分别登记 URL、commit、目录、符号和许可证；在完成前，跨三者的“全量迁移”结论为 `BLOCKED`。
2. 如果“三个”是同一仓库内的三个能力族，则至少拆成独立来源行，例如 `_full_mix`、`_segmented_music`/HyperFrames timed audio、`video_stitch`/字幕链，不能用一个 `OpenMontage` 概念行代替。

不能猜测另外两个仓库的名称、版本或语义。

## 4. 当前迁移覆盖总表

| Source ID | 当前覆盖 | 当前判断 |
|---|---|---|
| `HB-STORYBOARD-TIMING` | `packages/creative-planning` | `PARTIAL`；E03 8–15 秒窄切片=`ACCEPTED`，子镜头语义仍未映射 |
| `HB-PROVIDER-SHELL` | `packages/provider-video`、`apps/task-worker` | `PARTIAL`；保留平台 Port/Mock，不代表真实 Provider 已迁入 |
| `SD-SOUND-INTENT` | Prompt/creative planning | `PARTIAL`；声音意图和参考约束存在，未认证 Provider 能力保持关闭 |
| `SD-TIMELINE-CAPABILITY` | Prompt/profile | `PARTIAL`；不能把能力说明当作已认证 API |
| `MD-CONVERT-STREAM` | `services/document-runtime` | `MAPPED`；C10 本地范围已验收 |
| `OM-FULL-MIX` | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、`runtime.py` | `PARTIAL`；E05 已接受（仅已表达 ALCHMED8 字段），E06 section-window 边界继续单独验收 |
| `OM-SEGMENTED-MUSIC` | `services/media-runtime/adapters/openmontage_audio/segmented_music.py` + `runtime.py` 内部 helper | 历史快照（原为 `IN_PROGRESS/implementing`）；现行以正式总控/章节审计记录的 E08 `ACCEPTED` 窄切片为准；完整 renderer/其它硬门仍未关闭 |
| `OM-HYPERFRAMES-AUDIO` | `services/media-runtime/adapters/openmontage_audio/hyperframes_audio.py` + `runtime.py` 内部 helper | 历史快照（原为 `IN_PROGRESS/implementing`）；现行以正式总控/章节审计记录的 E08 `ACCEPTED` 窄切片为准；完整 renderer/其它硬门仍未关闭 |
| `OM-VIDEO-STITCH` | 后续 Media Runtime | `DEFERRED` |
| `OM-TRANSCRIBE-SUBTITLE` | Runtime/Worker captions loopback | `ACCEPTED`（E09 仅 source-expressed checked timing→8/42 SRT→FFmpeg fallback 窄切片）；普通 Studio REQUIRED 事实链及 richer modes未闭合 |
| `OM-VOICE-SAMPLE-GATE` | Studio/Control API/持久化 | `PARTIAL`；样音审批和正式资产链未闭合 |
| `OM-LONG-NARRATION` | planning/consumer/runtime | 历史快照（原为 `READY_FOR_AUDIT`）；现行 E11/S08 为 `ACCEPTED` 窄切片，完整 E11 仍 `BLOCKED`（仅内部 measured-duration feedback/consumer fail-closed；自动重规划/视觉延长仍 `DEFERRED/BLOCKED`） |
| `OM-TTS-PROFILES` | 本地 Piper adapter | `PARTIAL`；E04/S02=`ACCEPTED`（仅本地命令语义），真实云 TTS/口音未认证 |
| `OM-PIXABAY` | Runtime Python adapter + Control API/Studio 薄壳 | `ACCEPTED`（仅 S01 切片；E03 8–15 秒窄切片已接受） |

该表只是当前入口；完整矩阵必须补上实际改动涉及的 Huobao Prompt/Agent、Seedance editing/troubleshooting、OpenMontage Artifact/analysis/video/audio/subtitle/voice/TTS 全部稳定符号，以及三份 OpenMontage（若确为三份）的独立行。

## 5. 逐章执行顺序

以下 `E` 编号是本文件的执行章节，不自动创建或升级正式章节。每章完成后必须写入来源登记、测试日志、章节审计和状态账本；上一章未达到 Exit Gate，不得进入下一章。

### E00：冻结基线与差异盘点

**目的**：防止在既有脏工作区上误删、误回滚或把历史改动归因到本轮。

**执行内容**：

1. 只读保存 `git status --short`、`git diff --stat`、上游四（或更多）快照的 HEAD/工作树状态。
2. 将每个当前改动文件分为 `SOURCE_MAPPED`、`PLATFORM_OWNED`、`DEFERRED`、`UNREFERENCED` 或 `HISTORICAL_DOC`。
3. `infrastructure/deploy`、VPS/relay 脚本、Veyra HTTP/credit bridge、额外 document/reference intelligence 和并行总设计文档暂不删除，只冻结为后续范围；不得把它们当作本地 MVP 完成证据。
4. ALCHMED1–7、旧 `_mix_narration_track`/`_mix_music_track` 保留兼容读取，但单独标记为 legacy，不计入新的 OpenMontage source-complete 证据。

**Exit Gate**：没有未解释的用户改动；没有任何文件因为“看起来多余”被直接删除；矩阵和冲突清单开始建立。

### E01：补全多源符号矩阵与冲突裁定

**来源**：四个固定仓库及已登记的协议参考；若存在其它 OpenMontage，先补其固定基线。

**执行内容**：

1. 每一行使用“仓库 + commit + 文件 + 符号/规则”作为稳定主键。
2. 补齐输入、输出、单位、默认值、错误、调用顺序、副作用、平台落点、语义所有者、舍弃原因和测试证据。
3. 对 `duration`、`pace`、`music`、`narration`、`reference`、`start/end`、错误状态逐项列出来源冲突；不得默默合并。
4. 明确语义所有者：分镜/台词由 Huobao/Seedance 规划，音频混音由 OpenMontage 工具，资料转换由 MarkItDown，身份/权限/Storage/队列由平台契约负责。
5. 没有平台运行路径的来源写 `NOT_MAPPED` 或 `DEFERRED`，不能写成“原仓库没有”。

**禁止**：在矩阵完成前新增 S05、第二套 AudioPlan、协议、阈值、UI 或外部调用。

**Exit Gate**：所有当前改动都有来源或明确的 `PLATFORM_OWNED/DEFERRED/UNREFERENCED` 判定；三份 OpenMontage 的身份问题已解决或显式阻断。

### E02：Pixabay 单路径纠错（对应 S01）

**来源**：`upstream/openmontage/tools/audio/pixabay_music.py` 的搜索页 → bootstrap → HTML MP3 回退 → 默认时长筛选 → 无匹配回退全部 → 首条选择 → MP3 下载顺序。

**当前问题**：

- `services/media-runtime/adapters/openmontage_audio/pixabay_music.py` 已有源对齐实现；
- `apps/control-api/src/index.ts` 已有 `HttpPixabayMusicClient` loopback；
- 历史问题（已 superseded）：`apps/control-api/src/app.ts:508` 曾在未注入客户端时创建 Node `PixabayMusicAdapter`；当前实现改为未注入即阻断，代码/测试已移除该第二套抓取器。

**允许的修改**：

1. 只保留 Python Runtime 作为来源网络逻辑；Control API 只使用注入的 `HttpPixabayMusicClient`。
2. Runtime 未配置时返回已有 `PROVIDER_UNAVAILABLE`/`BLOCKED`，不能改为直接抓取。
3. 保留用户已授权的显式 Pixabay 导入；导入资产由服务端固定为 `AUDIO + READY + metadata.audio_role=MUSIC`。
4. `NARRATION_SAMPLE`、`USER_SOURCE_AUDIO`、未分类 `AUDIO` 不得进入 AUTO 音乐选择。
5. 只允许来源返回的 HTTPS `cdn.pixabay.com` 音频 URL；保留 MIME、大小、SHA 和对象幂等校验。

**禁止**：Freesound/Suno/其它曲库、自动补曲、排序推荐、无查询自动联网、Control API 备用抓取器。

**验证**：无 Runtime 配置时阻断；loopback 正向导入；非法 MIME/URL/超大对象拒绝；同一 idempotency key 重放；样音跨角色回归；Studio 只在显式 query 时调用；Runtime finite supplemental fixture（`2026-08-31T08:25:25+08:00`）拒绝 `NaN`、`Infinity`、`-Infinity` duration。

**Exit Gate**：技术证据已通过独立审计并同步账本，S01/E02 已 `ACCEPTED`（仅切片）。

### E03：Huobao 分镜时长边界纠错

**来源**：`upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`。

**源规则**：分镜段 8–15 秒；同段承载 2–4 个子镜头；台词容量为 `字符数 / 4.5 + 2 秒表演余量`；装不下的台词拆到下一个段落。

**当前状态**：`ACCEPTED`（仅正式段时长边界窄切片；2–4/2–6 子镜头语义仍明确排除，不代表完整 Huobao 迁移）。

**当前风险（前两项为实施前历史快照）**：

- `packages/domain/src/creative-planning.ts` 及 `StoryboardShotSpecSchema` 的 1–15 秒边界已由本切片收口为来源要求的 8–15 秒；
- 规划器短目标均分可能产生小于 8 秒段的风险已通过既有 `STORYBOARD_SPEC_INVALID` 入口 fail-closed，不增加余数修复算法；
- `hasCinematicEditorialBoundary`、`editorialCount` 等评分/正则分支仍尚未完成来源证明，保持 `UNREFERENCED`/冻结。

**允许的修改**：

1. 先对照 Huobao `storyboard-breaker` 与 `prompt-generator/video-prompt` 的原始拆分顺序；保持源规则，不凭本地观感重写。
2. 对无法形成合法 8–15 秒段的输入，沿已有错误/阻断路径处理；不得发明新的 remainder、慢放或填充算法。
3. 对没有固定来源的评分、正则和动作数量分支先标 `UNREFERENCED` 并冻结，只有补齐来源行后才能决定保留或删除。

**验证**：15 秒、多事件、长台词、无法容纳台词、跨场景和角色/道具绑定的正负测试；确认不生成小于 8 秒的源段，也不凭空拆出第二个 Provider 调用。

**Exit Gate**：规划器、Domain、契约和测试共享同一来源规则；没有新的本地阈值。该窄切片已完成 READY→ACCEPTED 独立审计流程；E04 为当前唯一活动章节。

### E04：旁白 pace 契约与 Piper 边界纠错（对应 S02）

**当前状态**：`ACCEPTED`（仅 Piper pace/原始参数窄切片；总体能力仍不代表完成）。

**来源**：`upstream/openmontage/tools/audio/piper_tts.py`、`tts_selector.py`、`voice-performance-director.md`。

**源事实**：Piper 暴露数值 `length_scale` 和 `sentence_silence`，没有平台 `SLOW/FAST` 符号映射；`PiperTTS._generate` 的 subprocess timeout 为 300 秒。

**当前问题**：

- `services/media-runtime/adapters/openmontage_audio/piper.py` 当前只保留 `NATURAL=1.0`，这是正确的保守边界；
- `packages/contracts/src/creative-planning.ts` 的 `DeliveryCue` 使用 `BRISK`；
- `packages/contracts/src/narration-quality.ts` 与 Runtime 使用 `FAST`；
- 历史登记仍有 `SLOW=1.15/FAST=0.85`，与当前源事实冲突。

**允许的修改**：

1. 先建立两个契约的字段语义和 mapper；不能把 `BRISK` 静默改名为 `FAST`，也不能恢复 `1.15/0.85`。
2. 没有来源 profile 的非 `NATURAL` 值继续在 Piper 前 fail-closed。
3. 保持源命令参数、stdin、`sentence_silence` 和 timeout=300；不添加旧的 `-i/-f` 协议。
4. 清理或明确标注旧文档中的 pace 映射为历史快照，不把它当作当前实现事实。

**验证**：NATURAL 命令精确断言；SLOW/FAST/BRISK 冲突路径不调用 Piper；超时、WAV 合法性、实测时长和正式资产/样音隔离测试。

**未完成边界**：中文口音、云 TTS、真实 Provider 和完整多 cue 声学连续性不在本章关闭。

### E05：OpenMontage `_full_mix` 与 ALCHMED8 收口（对应 S03/S04）

**当前状态**：历史快照（原为 `READY_FOR_AUDIT/verifying`）；现行 E05 为 `ACCEPTED` 窄切片。

**来源**：`upstream/openmontage/tools/audio/audio_mixer.py::_track_filters`、`_full_mix`。

**必须保留的源语义**：

- `speech`、`music`、`sfx` 角色；
- 每轨 `start_seconds`、线性 `volume`、fade；
- 一个全局 ducking 开关及来源 `ratio=9`、`level_sc=1`、`mix=0.9`；
- `target_duration` 的 `apad/atrim` 和 loudnorm 顺序；
- music-only 仍走来源 `_full_mix` 的 `amix`/target/normalize 路径。

**允许的修改**：

1. 只消费已有 ALCHMED8 的 identity、ownership、asset、start/end、gain/fade、transcript 和 music window 字段。
2. 继续使用 workspace/project-scoped Asset + StoragePort；校验 MIME、SHA、byteSize、ffprobe duration。
3. dB 到来源线性 `volume` 的 mapper 只能复用已登记的来源换算；不得把 dB 当 compressor ratio。
4. 保留 ALCHMED1–7 兼容读取，但不新增 ALCHMED9 或第二套 AudioPlan。

**验证**：独立 speech tracks、music-only、sfx 保留、角色冲突、跨 workspace、缺资产、gain/fade/ducking、目标时长、对象冲突、Worker 重启和重复执行；必须有受控 FFmpeg/ffprobe 产物。

**本轮实现证据**（全部本地 fixture/mock，0 skip/fail）：Runtime focused `18 passed / 94 deselected`；OpenMontage full-mix adapter `3/3`；Production Worker `53/53`。证据覆盖 source filter 顺序与绝对起点、independent speech/music-only/SFX、角色与资产/跨工作区边界、gain/fade/ducking、目标时长、不可表达窗口 fail-closed、对象冲突、重启/重复和受控 FFmpeg/ffprobe 产物。主线与纠察员均确认未新增 ALCHMED9、第二 AudioPlan、算法阈值、静默回退或外部调用。

**Exit Gate 申请**：实现证据已齐备，提交独立审计；在审计记录写入结论前不得标记 `ACCEPTED`，其余 section-window、transition/xfade、字幕、Studio、中文口音和超长旁白硬门继续阻断。

**Exit Gate**：只证明 ALCHMED8 到来源 `_full_mix` 的已表达字段；不能用该结果宣称完整 C12.4/C12.5。

### E06：approved full narration 窗口与 cue-only 边界（已接受窄切片）

**当前状态**：`ACCEPTED`（仅来源可表达窄切片；独立审计已通过；当前活动切片已切换为 E07）。

**来源**：OpenMontage explainer 的完整 narration/asset 规则与 `_full_mix` 的 speech-track 输入。

**源能力判定**：`_full_mix` 能消费带绝对 `start_seconds` 的 speech tracks，但不能凭一个整轨 bytes 自动表达多个 section 的 end/window，也不能把 `_segmented_music` 冒充成旁白操作。

**允许的修改**：

1. 已有独立、非样音、实测的每个 PRIMARY section 资产，可以按来源 speech-track `{path, role, start_seconds}` 进入 mixer。
2. 只有唯一 `PLATFORM_NARRATION`、覆盖全目标且从 0 开始的单整轨，才继续走当前完整整轨兼容形态（历史兼容形态；当前自动 owner 仍需 native/显式 TTS 来源事实）。
3. 来源无法精确表达的 partial/multiple window、缺失 asset version、cue-only 多 cue，继续返回已有阻断错误。
4. 不逐 cue 调 Piper，不裁剪、变速、补静音，不从脚本文本推测音频窗口。

**验证**：section identity/start/duration 不一致拒绝；多平台旁白轨拒绝；正式资产与样音对象不可复用；独立多段 speech 的绝对起点产物；没有来源证据时不调用 Piper/compose。

**本轮定向证据**（2026-08-31T10:10:04+08:00，全部本地 fixture/mock，0 fail/skip）：Runtime `17 passed / 95 deselected`；OpenMontage full-mix adapter `3 passed / 8 deselected`；Persistence approved narration timeline `13 passed`；Production Worker 选择集 `6 passed`。覆盖 AudioPlan identity/absolute windows、完整整轨兼容、独立 section speech tracks、HOLD/cue-only 边界、样音/正式资产隔离、版本/工作区/MIME/SHA/时长校验、缺失资产和未批准时间线 fail-closed。未新增逐 cue Piper、时长修正、裁剪、变速、补静音、第二协议或外部调用。

**Exit Gate**：上述证据已由纠察员独立审计通过，E06 窄切片标记 `ACCEPTED`。只有来源可表达且有产物证据的形态可以 `READY_FOR_AUDIT`；其余保持 `BLOCKED/DEFERRED`。

### E07：转场/xfade 与有效时长（窄切片已验收）

**来源**：`upstream/openmontage/tools/video/video_stitch.py` 及 explainer `edit-director.md`/`compose-director.md`。

**当前状态/风险**：`ACCEPTED`（仅来源可表达 uniform transition 窄切片）。平台 `PASS→cut`、`BLEND→crossfade`、`BRIDGE→fade-through-black` 已按用户授权映射到固定 OpenMontage 符号；混合 transition、continuous narration 非 cut、不同 bridge duration 和 target mismatch 仍 fail-closed。

**允许的修改**：

1. 仅保留来源对应的操作、参数和输出时长语义的薄壳 mapper。
2. 以本地真实媒体夹具验证段首、段尾、重叠和 A/V 总时长；cut filter concat 只声明时间轴等价，不宣称来源 concat-demuxer/`-c copy` 编码等价。
3. 无法指向来源的当前常量或桥接修正保持兼容/阻断，不添加新的转场算法。

**本轮证据**：`python -m pytest -q tests/test_runtime.py -k "maps_pass_to_source_cut or maps_bridge_to_source_fadeblack or cumulative_offset_rounding or rejects_mixed_source_transition_plan or rejects_different_bridge_durations or continuous_narration_crossfade"` → `6 passed / 113 deselected / 0 failed / 0 skipped`；纠察员独立审计通过，全部 fixture/mock，无外部调用。

**Exit Gate**：E07 来源可表达 uniform transition 窄切片已 `ACCEPTED`；其余未表达形态保持 `BLOCKED/DEFERRED`。下一活动章节为 E09；该句为历史顺序记录，现行活动已推进至 E10；E08 segmented/HyperFrames 仍需独立授权。

### E08：`_segmented_music` 与 HyperFrames timed audio

**来源**：`audio_mixer.py::_segmented_music`、`hyperframes_compose.py::_resolve_audio_refs` 及其 HTML audio contract。

**当前状态**：E08 窄切片已 `ACCEPTED`。启动段“尚未落地”是历史快照；当前实现、证据与独立验收均已登记；该结论不等于完整 HyperFrames/AudioPlan 能力完成。

**允许的修改**：

1. `_segmented_music` 作为独立操作迁移 `[start,end]` 音乐窗口和来源 fade 表达；不能改写成 `_full_mix` 输入。
2. HyperFrames 只在有独立音频文件和已验证 `data-start/data-duration` 时适配；不能把一个整轨 bytes 猜切成多个文件。
3. 每一项独立建立内部 DTO、权限/Storage 薄壳、正负产物测试和来源登记。

**固定来源映射**：`AudioMixer.execute` 的 `operation="segmented_music"`→`_segmented_music`；函数输入为 `video_path`、`music_path`、`music_volume`、`segments[{start,end}]`、`fade_duration`、`output_path`，按来源顺序构造分段 volume/fade、`amix normalize=0` 和视频/音频输出。`hyperframes_compose.py::_resolve_audio_refs` 与 `skills/core/hyperframes.md:143-162` 将独立 narration/music 文件映射为 HTML `<audio>` 的 `data-start`/`data-duration`；平台拒绝来源的静默缺失跳过和 basename fallback。

**平台差异/边界**：独立适配器现在只接收受控临时路径或已授权独立 asset；Runtime 复用既有 Storage/workspace/project/MIME/SHA/ffprobe/错误边界。来源适配器保留 `_segmented_music` 的按 start 排序与重叠窗口 `+` 累加、HyperFrames 的输入顺序与显式零 end→composition-duration 语义；平台现有 `MediaRuntimeCompositionPlan.music_segments_ms` 的有序非重叠约束仍在 Runtime helper 边界执行。不得把 segmented music 并入 `_full_mix`，不得把整轨 bytes 猜切，增加公开 UI/API/Provider/协议或新阈值。

**状态**：用户已明确授权，E08 来源可表达窄切片现为 `ACCEPTED`；启动段“未改代码/测试”是历史快照。平台边界中的 invalid/non-finite/out-of-range window、缺失/越权独立 asset、workspace/project/role/MIME/SHA/ffprobe 不一致和未验证 HTML timing 仍 fail-closed；来源本身允许的 overlap 由适配器保留，现有 CompositionPlan helper 另行执行已有非重叠契约。该验收不关闭完整 HyperFrames renderer、完整 AudioPlan/section windows、重启/重复产物整合、Studio、字幕、中文口音或长旁白硬门。

#### E08 implementation checkpoint（2026-08-31 14:39；已 ACCEPTED 窄切片）

- `segmented_music.py::OpenMontageSegmentedMusicMixer` 镜像固定 OpenMontage `AudioMixer._segmented_music`：受控 `video_path`/`music_path`、按 `start` 排序的 source volume/fade expression、重叠窗口保持 `+` additive、`amix ... normalize=0`、视频/音频 map、AAC 输出；不并入 `_full_mix`。Runtime `segment_music_video_bytes` 仅补已有 MIME/SHA/ffprobe/临时文件边界，并在现有 `music_segments_ms` 计划契约处拒绝重叠窗口。
- `hyperframes_audio.py::OpenMontageHyperFramesAudio` 镜像 `_resolve_audio_refs`/HyperFrames HTML audio contract：独立 narration/music asset → `data-start`/`data-duration`，保留 source optional/explicit-zero end fallback 和 music `value or default`；平台只补 workspace/project、角色、MIME、byteSize、SHA-256、ffprobe 事实校验，拒绝来源的静默缺失/路径 fallback。Runtime helper 要求调用者提供 workspace/project scope，不新增公开 API/HTML 协议。
- 定向行为/产物证据（全部本地 fixture/mock，0 skip、无 Provider/TTS/Veyra/网络/VPS/Git）：`python -m unittest adapters.openmontage_audio.test_segmented_music adapters.openmontage_audio.test_hyperframes_audio` → `14/14`；`python -m pytest -q tests/test_runtime.py -k "segment_music_video_bytes or hyperframes_audio_runtime_helper"` → `3 passed / 122 deselected / 0 failed / 0 skipped`；两适配器真实受控 ffmpeg/ffprobe fixture 均执行并校验 MP4/WAV 时序；`python -m pytest -q tests/test_runtime.py` → `125 passed / 0 failed / 0 skipped`；合并 adapter discover → `25/25`。
- 本 checkpoint 只证明来源可表达的独立操作和平台事实边界；不宣称完整 HyperFrames renderer、第二 AudioPlan、Studio/UI/API、重启产物整合、字幕/口音或 C12.4/C12.5 总体完成。纠察员已完成来源/范围/证据复核并通过独立验收，E08 窄切片由 `READY_FOR_AUDIT` 收口为 `ACCEPTED`。

### E09：转写、字幕和 REQUIRED 事实链

**来源**：`tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py`、`tools/video/remotion_caption_burn.py`。

**当前实现**：source-expressed checked word-timestamp → 8/42 cue → SRT → FFmpeg loopback 和 `BURN_CAPTIONS` 内部工具已完成窄切片；普通 Studio `caption_policy=REQUIRED` 的审批/时间事实链仍未闭合。

**允许的修改**：

1. 只消费已检查的 word timestamps；复用来源 cue grouping 和字幕烧录顺序。
2. 没有同一受控解释器、模型或已批准 timing 时返回 `UNAVAILABLE/BLOCK`。
3. 不从脚本文本臆造字幕时间，不把 marker 结构存在当作字幕体验验收。
4. 补充从 Studio/Control API → Worker → Runtime → final review → 产物的集成证据。

**Exit Gate**：E09 source-expressed checked timing/SRT/FFmpeg fallback 窄切片已 `ACCEPTED`；GPU/device/model/language metadata、Remotion/VTT/JSON、脚本推时序、中文质量和普通 Studio REQUIRED 事实链保持 `PARTIAL/BLOCKED`。下一活动切片为 E10。

### E10：Studio 样音、审批、正式资产与 TimelinePlan

**来源**：`voice-performance-director.md`、explainer `asset-director.md`。

**源规则**：先生成样音并确认 voice、pace、pauses、emphasis、tone，再生成其余正式旁白；正式 narration asset 必须可追溯、可测量且与样音对象区分。

**允许的修改**：

1. 复用现有 sample approval event、narration asset version、TimelinePlan 和 workspace 权限边界。
2. 样音审批只能写审批事实，不能伪造 `narration_asset_version.ready`。
3. 正式整轨必须有独立对象、MIME/SHA/时长和 `sample_approved=false` 等已有事实。
4. UI 只呈现已有契约语义；不新增 Provider、自动审批或隐藏回退。

**验证**：样音不能被正式资产复用；审批撤销/重复、跨 workspace、TimelinePlan 缺失、对象版本漂移和 Worker 恢复测试。

**Exit Gate**：Studio 端到端事实链通过独立审计；此前的结构性 persistence 测试不能单独关闭本章。

### E11：超长旁白 consumer 与弹性总时长

**来源**：当前开发授权仅为固定 OpenMontage `compose-director.md` 与 `executive-producer.md`；`scene-director.md:146-169` 仅同源审计候选/`DEFERRED`，不构成当前开发授权。

**源规则**：先生成并测量旁白；如果文案超出画面，改稿/重新生成或延长视觉尾段；不能用音频慢放、裁剪或补静音掩盖问题。

**允许的修改**：

1. 以 WAV/ffprobe 的实际时长作为事实，不以字符估算替代。
2. 对超长输入沿已有 fail-closed/审核路径返回明确阻断，或只实现来源已有的“改稿/延长画面”分支。
3. 对短旁白保留来源允许的视觉 hold/ambient 边界，不自动添加 BGM 或填充词。

**禁止**：`atempo`、`rubberband`、任意新语速映射、自动文本改写、未经来源支持的 tail 秒数。

**Exit Gate**：长、短、无音乐、带音乐、跨段和重试行为都有实际 consumer 证据；否则硬门保持 `BLOCKED`。

### E12：真实 TTS、中文口音和其它外部能力

**来源**：OpenMontage 已有 Piper、Doubao、DashScope、OpenAI、Google 等 adapter/selector 语义；平台只可做受控 profile mapper。

**当前状态**：本地 Piper 仅是离线命令适配，中文口音未认证；真实 TTS/Provider/Veyra/计费均关闭。

**进入条件**：必须由用户单独给出 profile、调用次数、素材范围、额度上限和外部授权，并完成正式章节登记。

**执行限制**：未经授权保持 `BLOCKED`；不得以本地 Piper 的结构测试、一次真实视频或静态 capability 声明冒充口音验收。

### E13：逐章验收与证据收口

每章都必须记录：

1. 固定来源、文件、符号、commit；
2. 平台目标文件和唯一语义所有者；
3. 保留、删减、薄壳修改及其理由；
4. 正向、负向、集成、重启/重复、越权和媒体产物证据；
5. 未运行测试和显式环境 skip；
6. `NOT_MAPPED/DEFERRED/BLOCKED` 的原因；
7. 当前唯一状态和下一步，不改写历史记录。

验收顺序：

```text
E00 差异盘点
  -> E01 多源矩阵/冲突裁定
  -> E02 Pixabay 单路径
  -> E03 Huobao 时长
  -> E04 Piper/pace
  -> E05 full_mix/ALCHMED8
  -> E06 approved section/cue 边界
  -> E07 transition/xfade
  -> E09 subtitle/REQUIRED
  -> E10 Studio approval/TimelinePlan
  -> E11 long narration consumer
  -> E08 segmented/HyperFrames（需授权）
  -> E12 real TTS/accent（需单独授权）
  -> E13 独立审计与状态升级
```

E08 和 E12 即使来源存在，也不能因“排在后面”自动开启。每个章节仍需正式总控授权。

### E12 当前阻断对账（2026-08-31；历史授权前快照，已由下方实测对账 supersede）

- 本段记录时，账本以 `.codex-longrun/state.json` 为准：E12 real TTS/Mandarin accent authorization gate=`BLOCKED`，总体 C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`。E08 来源可表达窄切片保持 `ACCEPTED`，不重新开启。
- 本段记录时真实验证所需的具体 provider/profile、调用次数、源素材范围、额度上限、凭据注入方式和外部授权尚未齐备；下方记录用户后来授权的既有能力实测。本段不覆盖该实测，也不构成云 TTS/口音验收。
- 未闭合硬门原样保留：完整 AudioPlan/approved section-level windows、continuous narration 非 cut、Studio 样音/审批/TimelinePlan、REQUIRED 字幕事实链、中文口音听感和超长旁白 consumer；不得用本地结构测试、静态命中或一次视频结果宣称完成。

### E12 用户授权后实测与当前收口（2026-08-31 20:44；BLOCKED，未验收）

- 本轮根 `pnpm test` 在 18 个 workspace 项目完成，实际计数为 `470 passed / 19 explicit skips / 0 failed`；skip 保留为环境门控事实，不作为通过。测试使用本地 fixture/mock；此前用户授权的真实 30s/480p canary 与本地 Piper 产物仍按上方 E12 实测记录，不在本次根回归中重复调用。
- 状态继续以 `.codex-longrun/state.json`、正式总控、章节审计和来源登记为准：E12=`BLOCKED`，总体 C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`。正式 narration asset/TimelinePlan、approved section windows、云 TTS profile/中文口音人工证据、完整 AudioPlan、transition/xfade、Studio/REQUIRED 字幕及超长旁白 consumer 硬门继续 fail-closed。

## 6. 测试和证据规则

测试按四层保留：

1. 来源等价：参数、字段、单位、默认值、错误和调用顺序；
2. 平台边界：workspace、Storage、MIME/SHA/ffprobe、DTO、事件、幂等和脱敏；
3. 行为/产物：正向、负向、冲突、重启、重复、真实媒体夹具；
4. 外部/人工：真实 TTS、口音、听感、字幕观感和网络能力，单独授权和记录。

最新已有窄测可作为背景证据：Media Runtime + OpenMontage adapters `122 passed`、Production Worker `53/53`，state validator 和 `git diff --check` 通过。记录中的根回归 `447 passed / 18 explicit environment-gated skips / 0 failed` 是历史快照，本文件不把它当作本轮重新执行的全量证据。

任何章节都不能用“代码命中”“结构性门控”“绿色静态检查”替代行为或产物证据；skip 必须保留为 skip。

## 7. 当前停止条件

E01–E11 的来源可表达窄切片已经分别完成对账/验收；不得把窄切片扩写为完整能力，也不得重新开启已接受章节。当前唯一未收口的活动范围是 E12 实测后的阻断对账。

在 E12 的云 TTS profile、中文口音人工听感、正式 `NarrationAssetVersion`/`TimelinePlan`、approved section windows、完整 AudioPlan、Studio/REQUIRED 字幕和长旁白 consumer 证据齐备前，保持 `BLOCKED/DEFERRED`，不升级状态，不新增语速/时长修正、静音填充、第二协议、UI 或旁路网络逻辑。

如果来源缺失、三份 OpenMontage 身份无法确认、字段冲突不能由来源解决，继续保持 `BLOCKED/DEFERRED`，等待用户给出来源或授权，不自行补造；真实 Provider/TTS/Veyra、共享积分、VPS、部署和 Git 写入仍须单独授权。

## 8. 本文件的完成定义

只有当所有当前范围内的执行章节都具备固定来源、唯一语义所有者、薄壳适配、正负/集成/产物证据、状态对账和独立审计时，才可以把相应 Source ID 或正式切片标为 `ACCEPTED`。

“完成全部执行文档”不等于复制上游全部宿主工程，也不等于真实 Provider、口音、付费或部署完成；任何未授权外部能力必须继续保持关闭。

## E09/OM-TRANSCRIBE-SUBTITLE 收口记录（2026-08-31）

- 固定来源：OpenMontage `tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py::_build_cues/_hmsms`、`tools/video/remotion_caption_burn.py::_render_ffmpeg`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- source-expressed 窄切片已完成：受控 CPU/int8 faster-whisper 的 word timestamps/VAD 参数、词级舍入、8词/42字 cue、SRT 毫秒进位和 FFmpeg subtitles fallback。唯一生产修正是 cue flush 后按来源从当前词开启新 cue；未新增契约、协议、评分、时长算法或脚本推时序。
- 证据：Runtime focused `11/11`、完整 Runtime `122/122`，0 skip/fail；纠察员独立审计通过，全部 fixture/mock，无模型、Provider、TTS、网络、Veyra、VPS 或 Git。
- E09 标记 `ACCEPTED` 仅限上述 source-expressed 子集。GPU/device/model/language metadata、diarization、Remotion、VTT/JSON/correction/highlight、中文口音和完整 Studio REQUIRED 事实链仍 `DEFERRED/BLOCKED`。E10 Studio 样音/正式资产/TimelinePlan 为下一活动切片；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

## E10 当前执行对账（2026-08-31 11:26:59；历史快照，已由下方收口记录 supersede）

本段记录时 E10 保持 `IN_PROGRESS/implementing`；该状态已由下方独立审计收口记录 supersede，不覆盖当前 `ACCEPTED` 窄切片状态。

- 固定来源：OpenMontage `skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。来源语义是样音先确认、正式旁白资产独立且有测量事实、TimelinePlan 使用明确 section 窗口。
- 可核对的现有薄壳：approval event 不生成正式 asset version；正式 narration 必须为独立非样音 READY 资产并通过 workspace/project/version/MIME/SHA/byte-size/duration 校验；TimelinePlan 只消费显式 absolute windows，对缺失审批/资产/时间线、样音复用、版本漂移、重叠和跨工作区 fail-closed。
- 新鲜定向 fixture/mock：creative-planning `7/7`；persistence `16/16`；Control API `2/2`；Production Worker `7/7`；Studio `24/24`；全部 `0` fail/skip、无外部调用。技术上可提交窄切片 `READY_FOR_AUDIT`，但须先由独立审计员确认并完成四账本对账。
- 不得扩展的来源缺口：顶层 `voice_performance`/完整 `delivery_cues`、最敏感 section 自动选择及人工听感、approved sample path/provider settings manifest、provider-specific TTS 映射、完整 Studio 样音到正式资产再到 TimelinePlan UI/API、真实 TTS/中文口音，以及将平台 `normalizeNarrationSections`/`buildNarrationTimeline` 冒充 OpenMontage 算法。上述保持 `DEFERRED/BLOCKED`。

## E10 Exit Gate 与 E11 启动（2026-08-31 11:30；历史快照，已由下方 E11 对账 supersede）

- E10 仅以 approval fact、独立非样音 READY narration asset、实测 duration 和 TimelinePlan identity/absolute-window/workspace/project/version/MIME/SHA/byte-size fail-closed 边界通过 `READY_FOR_AUDIT→ACCEPTED`；完整 Studio 上传→审批→正式资产→TimelinePlan UI/API、source voice-performance 结构和人工听感仍不在验收范围。
- E11 现为唯一活动章节，状态 `IN_PROGRESS/discovering`。当前 active source 仅为固定 OpenMontage `compose-director.md`、`executive-producer.md`；`scene-director.md:146-169` 仅审计候选/`DEFERRED`，不得借 E11 补入 E10 deferred 内容。
- E11 允许范围仅为 source-expressed measured narration duration、超长时改稿/重新生成或延长视觉尾段的消费边界，以及既有 visual hold/ambient 关系；禁止 atempo、stretch、crop、padding、自动改稿、任意尾段秒数、新协议、Provider 选择或 UI 状态。现有映射和行为证据只覆盖既有 consumer fail-closed，自动重规划/弹性时长仍 `DEFERRED/BLOCKED`。
- E11 source mapping：`compose-director.md:80-107`（85–90% budget、words/sec、TTS 原始参数/`audio_duration_seconds` 超长反馈、Pixabay 参数）、`:140-143`（旁白/音乐覆盖与 ducking 校验）、`:190-210`（Remotion 音频与 FFmpeg `audio_mixer` fallback 顺序）；`executive-producer.md:233-242`（逐文件探测、`EP_STATE.narration_durations`、`1.15` SEND_BACK、`25%` 内 scene-plan 调整、总时长更新）。平台不宣称实现这些自动重规划分支，`scene-director.md` 不复用。
- Fresh fixture/mock evidence：Production Worker `4/4`、Media Runtime `3/3`，均 `0` fail/skip、无外部调用；仅验证既有 measured narration、尾段/超长和重复消费 fail-closed。E11 保持 `IN_PROGRESS/discovering`，不能升级 `READY_FOR_AUDIT`/`ACCEPTED`。
- 最新本轮实际回归：Worker 全量 `pnpm exec tsx --test tests/media-service.test.ts`（cwd `apps/production-worker`）`22/22`；Runtime 全量 `python -m pytest -q tests/test_runtime.py`（cwd `services/media-runtime`）`122/122`；E11 窄测 `5/5`；`production-worker typecheck` 与根 `pnpm typecheck` 均 exit `0`（根为 `18/19` workspace）；`validate_state.py`=`OK`。全部 fixture/mock、`0` fail/skip、无外部调用。由于 `EP_STATE.narration_durations`→SEND_BACK、自动视觉延长/重规划/弹性时长尚未移植，E11 仍 `IN_PROGRESS/discovering`/`BLOCKED`，不得升级。

## E11/S08 最新实施与审计收口（2026-08-31 13:19；窄切片 ACCEPTED）

- 当前仅收口 `E11/S08` 窄切片为 `ACCEPTED`，范围仅为固定 OpenMontage `compose-director.md:80-107/140-143/190-210` 与 `executive-producer.md:233-242` 的 measured narration facts、私有 `EP_STATE.narration_durations` 形状、decision-log 幂等及 compose 前 fail-closed。`scene-director.md:146-169` 仍为审计候选/`DEFERRED`；不得将该窄切片写成完整 E11。
- 来源规则重叠不擅自裁决：compose-director `>1s` 与 executive-producer `1.15/25%` 在部分区间同时命中时记录 `SOURCE_DECISION_REQUIRED` 和 `source_actions=[SEND_BACK,ADJUST_SCENE_PLAN]`；`SEND_BACK`、`ADJUST_SCENE_PLAN`、重叠态均不进入 compose/finalReview/persistence，不新增 CompositionPlan/ALCHMED 字段、协议或时长修正。
- Fresh local fixture/mock：Contracts `37/37`、Domain `48/48`、Production Worker 全量 `56/56`，E11 选择集 `7/7`；Persistence 幂等集成在项目自带本地 PostgreSQL 容器上 `1/1`；相关 `tsc --noEmit`、`validate_state.py`、`git diff --check` 通过，0 fail、无外部调用。
- Exit Gate：仅该内部 feedback/consumer 窄切片经独立审计后为 `ACCEPTED`；自动改稿执行、视觉延长/重规划、弹性总时长、真实 TTS/Provider/Veyra/网络/VPS/Git 仍 `DEFERRED/BLOCKED`，完整 E11 不标 `ACCEPTED`，总体 C12.4/C12.5 维持 `IMPLEMENTED_PENDING_AUDIT`。

## E12 本轮优化盘点与回归收口（2026-08-31 23:12；仍 BLOCKED）

- 按固定 OpenMontage 来源、三套来源身份边界和现有契约逐项复查，没有发现可以安全新增的源仓库逻辑、协议、算法或 UI；E01–E11 已接受的均保持窄切片，不重开、不扩展。
- 受控默认本地栈 `http://localhost:3031` 的 C12 Studio UI E2E 通过：工作区 MUSIC 上传、两段 Mock 生成、Runtime 合成/QC、成片播放/下载及 390px 移动布局均成功。最终结果为确定性的 Mock 2 秒夹具，仅证明本地链路，不构成正式旁白/中文口音验收；此前失败由遗留 `sub2api` Worker 抢队列和临时端口 CORS 环境造成，未改变产品逻辑。
- 最新根回归 `pnpm test` 为 `490 tests / 471 passed / 19 explicit skips / 0 failed`；Media Runtime 与 OpenMontage 适配器联合 `150/150`，`py_compile`、`pnpm typecheck`、`pnpm build` 均通过（仅既有 Nuxt `DEP0155` trailing-slash 弃用警告）。所有测试均为本地 fixture/mock，未新增 Provider/TTS/Veyra/网络/VPS/Git 调用。
- 当前状态仍以 state/formal/matrix/audit/test-log 对账为准：E12=`BLOCKED`，总体 C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`。正式 narration asset/TimelinePlan、approved section windows、完整 AudioPlan、Studio 样音审批、REQUIRED 字幕事实链、中文口音、混合/连续非 cut 与超长旁白自动消费等硬门原样保留。

## E12 末次前端维护与验证（2026-08-31 23:25；仍 BLOCKED）

- 发现并修复一处不改变业务语义的 Studio 生命周期问题：relay 轮询定时器现在由组件既有 `onBeforeUnmount` 统一清理，避免页面卸载后残留轮询；未新增协议、Provider、网络路径或 UI 语义。
- Studio 定向回归 `37/37`、typecheck、build 均通过（仅既有 Nuxt `DEP0155` trailing-slash 弃用警告）。E12 和总体状态不变，未完成硬门继续 fail-closed。
