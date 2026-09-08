# AI 企业内容生产平台：C12.4/C12.5 逐项源仓库迁移与验证开发文档

状态：`FROZEN / HISTORICAL_BASELINE`

适用范围：C12.4 连续旁白与音频编排、C12.5 口播优先与弹性总时长；仅本地 MVP、Mock/loopback 和已授权的 Pixabay 源适配。

更新时间：2026-08-30；当日冻结

> 本文保留原有 S01-S09 的历史实施顺序、证据和未完成项，不再作为当前源仓库能力清单或新增实现授权。当前以《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》作为多源文件/符号映射、冲突审计和逐项验收基线；正式章节状态仍以《AI企业内容生产平台_正式开发总控文档.md》为准。

> **2026-09-01 语音路线冲突覆盖（SUPERSEDED）**：本文 S02 将 Piper 单次完整脚本写成主线、S09 才处理其它 TTS 的顺序，以及“平台旁白优先/Provider dialogue 非最终”的无条件表述，均被《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》覆盖。现行顺序先确定 source-verified audio owner，再按 native Provider 或来源 `TTSSelector` 选择；Piper 只在明确选中时执行。本文的 S01 Pixabay、S03 `_full_mix`、时长禁止变速、样音/正式资产隔离和历史测试记录只作非冲突证据，不能代替新的 owner/selector/sample gate，也不能改变正式总控状态。

> **2026-09-01 自动旁白输入覆盖（SUPERSEDED）**：当前自动视频流程不要求用户上传旁白或样音；样音由服务端 native Provider/显式 Doubao 生成后再人工审批。本文中上传音频或 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 的描述仅保留兼容历史与角色隔离事实，不得作为新任务前置条件。通用图片、资料、Logo、MUSIC 上传仍有效。最新执行顺序以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》为准。

> **2026-09-01 实际操作覆盖（ACTIVE）**：用户已授权本机 Aiself Grok native 优先、显式 Doubao 替换和茅山历史项目对照；本文件的离线迁移证据与章节状态仍不因该授权自动升级。仓库/CI 默认保持 Mock，真实密钥只由未入库进程环境读取。

> **2026-09-01 当前输入统一**：自动旁白仅由服务端生成或保留 Provider 原生音轨；用户上传旁白/样音不属于当前任务前置。通用图片、资料、Logo、MUSIC 上传和旧 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 兼容角色不受影响。

## 1. 目的和硬规则

本文件把“只移植原仓库代码，做薄壳适配，不自己写新逻辑；修改和删减都以原仓库代码为标准做参照”落实为可执行的逐项验收流程。

每一项能力必须完成以下闭环后，才能写成 `ACCEPTED`：

```text
固定来源文件/符号
  -> 记录输入、输出、默认值、错误和副作用
  -> 只做平台边界薄适配
  -> 正向行为测试
  -> 负向/不支持边界测试
  -> Control API/Worker/Runtime 集成测试
  -> 真实媒体产物或受控等价夹具复核
  -> 审计记录、状态账本和来源登记同步
```

禁止以下做法：

- 仅以 `rg` 命中源码、类型通过或单元测试通过宣称源能力已迁移。
- 在 OpenMontage 已有算法外另写一套时长、混音、转场、字幕、评分或 Provider fallback 逻辑。
- 从一条整轨旁白猜切多段音频，或以 `atempo`、`rubberband`、静音填充、裁剪掩盖时长问题。
- 把样音、普通 `AUDIO`、环境声或用户源音频伪装成正式旁白或 `MUSIC`。
- 新增第二套 AudioPlan、ALCHMED9、平行审批工作流或自定义 UI 语义。
- 在本地 MVP 阶段开启真实视频 Provider、真实 TTS、Veyra/共享积分、VPS、DNS、TLS、部署或 Git 写入。

平台允许保留的薄壳只包括：workspace/project 权限、对象存储读写、短期内部传输、DTO/版本兼容、队列/幂等、错误归一化、产物 MIME/SHA/ffprobe 校验、公开脱敏和审计事件。这些边界不能改变来源媒体逻辑的含义。

## 2. 版本、范围和状态

- OpenMontage 固定来源：`upstream/openmontage`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- 当前完整内部音频线只有 ALCHMED8；ALCHMED1–7 仅作历史兼容读取。
- C11.2 本地范围保持 `ACCEPTED`，不因本文件重开。
- C12.4/C12.5 是唯一活动实施切片，初始为 `IMPLEMENTED_PENDING_AUDIT`。
- C11.3、C12.2、C12.3、C12.6、C12.7B 不在本轮重新开启。
- 默认保持 `LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。

历史测试计数可以保留为迁移轨迹，但当前验收只引用最新一次可复核结果；环境跳过必须继续标记为 skip，不能折算成 pass。

## 3. 每项迁移记录模板

章节审计和《第三方来源与复用登记》中的每一项都必须填充以下字段：

| 字段 | 要求 |
|---|---|
| Item ID | 使用 `C12.4-S01` 这样的稳定编号 |
| 来源 | 固定 commit、文件、类/函数/规则、示例输入 |
| 迁入位置 | 平台 adapter/runtime/worker/contract 文件 |
| 保留语义 | 默认值、字段含义、时间单位、错误和副作用 |
| 薄适配 | 仅列权限、对象、DTO、队列、错误和安全边界 |
| 不可复用 | 说明 Backlot、项目目录、全局注册、外部凭据等原因 |
| 正向证据 | 使用来源等价输入得到可检查结果/产物 |
| 负向证据 | 未知、缺失、越界、重启、重复和跨工作区行为 |
| 集成证据 | Control API → 持久化 → Worker → Runtime → 产物 |
| 人工/真实证据 | 只有需要听感、口音或真实服务时填写；未授权则明确阻断 |
| 状态 | `NOT_STARTED`、`IMPLEMENTED`、`IMPLEMENTED_PENDING_AUDIT`、`READY_FOR_AUDIT`、`ACCEPTED` 或 `BLOCKED` |

## 4. 逐项实施顺序和 Exit Gate

### C12.4-S01：来源音频角色和 Pixabay 音乐入口

来源：

- `upstream/openmontage/tools/audio/pixabay_music.py`
- `upstream/openmontage/skills/pipelines/talking-head/asset-director.md` 的音乐选择步骤
- `upstream/openmontage/tools/analysis/audio_energy.py`（仅在有受控消费入口时迁入）

要求：

1. 保留来源的搜索页/bootstrap/HTML fallback、30–120 秒筛选、无匹配回退、首条选择和 MP3 下载顺序。
2. 平台只增加授权查询、loopback、workspace、幂等、MIME/大小/SHA 和对象存储边界。
3. Pixabay 只能由用户显式导入；不得自动搜索、推荐、排序或把失败静默成无声。
4. 服务端只把受控导入标记为 `AUDIO + READY + metadata.audio_role=MUSIC`。
5. `NARRATION_SAMPLE`、`USER_SOURCE_AUDIO`、未分类 `AUDIO` 永远不能进入 AUTO BGM。
6. 如果迁入 `audio_energy`，必须直接复用 ebur128 分析和 offset/loop 结果；没有安全平台消费方就标记为未启用，不造新协议。

Exit Gate：显式导入的真实/受控夹具、角色隔离、MIME/SHA、音乐混音和无曲目阻断均有行为证据。

历史切片状态（S01）：`READY_FOR_AUDIT`。该状态只表示当时 S01 的来源、薄适配、行为和审计证据已齐备，不改变 C12.4/C12.5 总体 `IMPLEMENTED_PENDING_AUDIT`，也不授权恢复其他曲库或外部系统；现行状态以 formal/state 为准。

### C12.4-S02：Piper 单次完整脚本旁白（历史窄切片；全局路由已 SUPERSEDED）

来源：`upstream/openmontage/tools/audio/piper_tts.py`。

要求：

- 直接复用 `--model`、`--speaker`、`--length-scale`、`--sentence-silence`、`--output_file` 和 stdin 语义。
- 完整 canonical script 只调用一次 Piper，并以实际 WAV/ffprobe 时长作为事实。
- 样音只记录审批；正式旁白必须是独立、已测量、非样音对象。
- OpenMontage 没有 symbolic `SLOW/FAST` 映射；没有来源 profile 时只允许自然默认值，其他值阻断。

Exit Gate：Piper 命令/输入/输出/时长/失败行为、样音与正式资产隔离、Worker 不重复合成都有测试。

### C12.4-S03：OpenMontage `_full_mix` 独立 speech tracks 和绝对起点

来源：`upstream/openmontage/tools/audio/audio_mixer.py::_full_mix`。

要求：

1. 只把已经独立存在且测量过的音频对象映射成来源格式：`{path, role: "speech", start_seconds}`。
2. 多段旁白必须由来源 `_full_mix` 消费；不逐 cue 重置 Piper，不自行写 `adelay/amix` 替代图。
3. 单条整轨且没有独立 section 音频时仍只从 `t=0` 播放；不得由 section 元数据猜切整轨。
4. 复用来源的 `speech/music/sfx` 角色、fade、sidechain、normalize、target duration 和默认值。
5. 平台只负责对象读取、临时路径、边界校验、错误映射和结果入库。

Exit Gate：至少有两段独立实测 speech fixture、绝对起点、无重叠/非法 gap/目标溢出测试；FFmpeg 产物通过时长、轨道和音频连续性复核。未满足时多 cue 必须保持显式阻断。

当前切片状态：`ACCEPTED`（仅 S03；不等同 C12.4/C12.5 章节 `ACCEPTED`）。已在现有 ALCHMED8 私有载荷内提供逐轨 bytes carrier，并由 Worker/Runtime 调用来源 `_full_mix`；缺失轨道、非法目标、payload identity 或测量 duration/window 不一致均 fail-closed。独立验收证据已记录；approved full-track legacy section windows、完整 AudioPlan 语义、transition/xfade、cue-only full-narration-first、Studio、REQUIRED 字幕、中文口音和超长旁白 consumer 仍未闭合。

### C12.4-S04：完整 AudioPlan 消费

来源：同一 `_full_mix` 输入契约和现有 ALCHMED8。

要求：

- ALCHMED8 的 identity、ownership、asset、start/end、gain/fade、transcript 和 music window 必须真正被 Runtime 消费。
- 不新增第二套 AudioPlan 或新的 magic；旧 ALCHMED1–7 只读兼容。
- 每条轨道的资产必须经过 workspace/project/key/MIME/SHA 校验。
- 未支持的 SFX、多音乐轨道或未知 ownership 只能返回已有错误。

Exit Gate：合同、编码/解码、Runtime 产物、重启/重复、跨工作区和敏感字段脱敏均有证据。

历史状态（S04）：`IN_PROGRESS`。Runtime 已按来源 `_track_filters/_full_mix` 消费可表达的 `MUSIC.gain_db`、track fade/start、全局 ducking，并对来源无法表达的 partial/multiple `music_segments_ms` fail-closed。完整 ALCHMED8 单条 narration bytes 现在也仅在唯一全目标 `PLATFORM_NARRATION` 与单一 `PRIMARY` section 窗口下映射为来源 `speech`；独立 section bytes 继续按 track identity/绝对起点消费，源视频剩余音频作为 `sfx`。编码器/解码器拒绝多平台旁白轨和未消费的 full-track section 窗口，旧 ALCHMED1–7 兼容路径不变。`transcript` 仍只在既有私有载荷/最终审阅事实链中携带，来源 `_full_mix` 本身没有 transcript 输入；完整字幕/转写下游属于 S06，不能在 S04 自造逻辑。现已补充既有 `storeArtifact` 的对象写入后重启窗口幂等行为证据（同 MIME/byteSize/SHA 产物可安全复用），但完整持久化集成、Studio 样音/审批/TimelinePlan 仍未形成 S04 Exit Gate，故不得升级 `READY_FOR_AUDIT`；现行状态以 formal/state 为准。

### C12.4-S05：来源转场和有效总时长

来源：`upstream/openmontage/tools/video/video_stitch.py`、explainer `edit-director.md`/`compose-director.md`。

要求：直接采用来源 cut/crossfade/fade-through-black、`xfade`/`acrossfade` 和有效时长计算；平台只适配对象和任务边界。

Exit Gate：两段/三段视频、每种允许转场、旁白/BGM 覆盖、最终 duration 和失败重试均通过实际产物检查。

### C12.4-S06：字幕和 REQUIRED 事实链

来源：`upstream/openmontage/tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py`、`tools/video/remotion_caption_burn.py`。

要求：

- 只消费 checked word timestamps；按来源 cue grouping 生成 SRT/VTT；使用来源 FFmpeg subtitles fallback。
- `REQUIRED` 没有可靠转写/时间戳时必须阻断；不能从 script 猜时间。
- Worker、Runtime marker、final review 和 Studio 操作必须来自同一事实链。

Exit Gate：真实或受控音频的 word timestamp、SRT、烧录 marker、字幕覆盖和缺能力阻断都有行为证据。

### C12.4-S07：Studio 样音、批准、正式整轨、TimelinePlan

来源：`voice-performance-director.md` 的 sample gate 和 `asset-director.md` 的人工审批门。

要求：复用现有脚本、资产版本、审批事件和 TimelinePlan API，形成单一顺序：

```text
样音试听/批准
→ 独立正式旁白资产
→ 实测时长和 transcript facts
→ READY TimelinePlan
→ ProductionRun
```

Exit Gate：Studio E2E 能证明每一步的事实来源、重复提交和样音复用均正确；没有审批事实不得创建正式 narrated ProductionRun。

### C12.4-S08：超长旁白和目标时长

来源：OpenMontage explainer producer/director 规则：改稿或延长画面，不自动拉伸已生成语音。

要求：实测旁白超过目标时，在 compose 前返回已有 QC/重规划错误；不得 `atempo`、裁剪或无来源补静音。短旁白只能由已声明的音乐或 HOLD/BROLL 尾段覆盖。

Exit Gate：Worker 行为测试证明超长请求不会进入 compose/finalReview/persistence；短旁白尾段有明确资产/视觉事实，否则阻断。

历史执行对账（2026-08-31 13:27；已由后续 S08 窄切片验收记录 supersede）：S08 内部 measured-duration feedback 窄切片为 `READY_FOR_AUDIT/verifying`。平台仅复用实测 narration facts、`EP_STATE.narration_durations` 形状和来源动作名称；`creativeDecisionLogs` 作为既有事实记录承载，按 event-derived id 做幂等重放并校验 workspace/project/sourceRevision。compose 前对 `SEND_BACK`、`ADJUST_SCENE_PLAN` 和 compose-director `>1s` 与 executive-producer `1.15/25%` 重叠区间的 `SOURCE_DECISION_REQUIRED` 一律 fail-closed，不自动改稿、重规划、延长视觉、慢放、裁剪或补静音，也不新增 CompositionPlan/ALCHMED 字段。Fresh local fixture/mock：Contracts `37/37`、Domain `48/48`、Production Worker 全量 `56/56`、E11 选择集 `7/7`；Persistence 幂等集成在项目自带本地 PostgreSQL 容器上 `1/1`，其余均 `0` fail/skip。自动 SEND_BACK 执行、视觉延长/重规划和弹性总时长仍 `DEFERRED/BLOCKED`，因此完整 S08 不可标 `ACCEPTED`；现行状态以 formal/state 为准。

### C12.4-S09：中文口音质量（现行路由以语音专项文档为准）

来源：OpenMontage 已有 Piper、Doubao、DashScope、OpenAI、Google 等 provider adapter 语义。

要求：本地无授权 profile 时不宣称口音完成；获得明确 profile、调用次数和预算授权后，按来源 provider 参数做一次样音和完整旁白人工听感验收。

Exit Gate：样音和正式成片的断句、速度、停顿、口音、BGM ducking、字幕和画面同步均被人工确认；否则保持 `BLOCKED`/未认证。

## 5. 每一项的测试层级

1. **来源等价单测**：默认值、字段、错误、filter graph/命令参数和结果结构。
2. **Runtime 行为测试**：真实 FFmpeg/Piper 或固定媒体夹具；检查 byte、MIME、ffprobe、duration、audio stream 和 marker。
3. **契约测试**：Zod DTO、ALCHMED8 编码/解码、公开投影脱敏和错误码。
4. **集成测试**：Control API → Repository → Worker → Runtime → Storage/Outbox；验证事务、幂等和重启。
5. **E2E/人工测试**：Studio 顺序、样音审批、最终视频试听/观看；真实 Provider/TTS 另立授权记录，不进入普通 CI。
6. **根级回归**：相关窄测通过后再运行 `pnpm typecheck`、`pnpm build`、串行 `pnpm test`、`git diff --check` 和 `validate_state.py`。

每次测试后追加 `.codex-longrun/test-log.md`：命令、结果、失败摘要、修复和下一条验证命令。跳过项单独记录，不能改写为通过。

## 6. 状态推进和停止条件

- `NOT_STARTED`：只有来源登记和测试计划。
- `IMPLEMENTED`：代码和窄测完成，但尚无集成/产物证据。
- `READY_FOR_AUDIT`：正向、负向、集成和文档证据齐全，等待独立审计。
- `ACCEPTED`：审计员逐项确认 Exit Gate；不代表其他章节或外部系统完成。
- `BLOCKED`：需要凭据、人工授权、真实外部服务或来源不存在，且不能安全推断。

遇到以下情形立即停止该项并记录：

- 需要新增来源没有定义的阈值、协议、fallback、UI 语义或时长算法。
- 只有样音/脚本文本，没有独立测量的正式音频事实。
- 需要真实 Provider/TTS、付费、Veyra、VPS、DNS、TLS、部署或 Git。
- 正向测试通过但真实媒体行为、资产身份或公开安全边界无法证明。

## 7. 当前启动顺序

本轮只能按以下顺序推进，不跨项宣布完成：

1. S01 Pixabay/MUSIC 角色和显式导入（已基本实现，补齐逐项审计记录）。
2. S02 Piper 单次完整脚本和正式资产边界。
3. S03 `_full_mix` 独立 speech tracks/绝对起点；独立 Exit Gate 已验收为 `ACCEPTED`（仅切片），证据见章节审计记录。
4. S04 ALCHMED8 完整 AudioPlan 实际消费；（冻结历史顺序）当时为唯一 `IN_PROGRESS`，只允许固定来源语义和既有私有载荷的薄适配；现行活动切片以 formal/state 为准。
5. S05 转场/xfade 有效时长。
6. S06 字幕事实链。
7. S07 Studio 审批/TimelinePlan E2E。
8. S08 超长旁白 consumer 行为。
9. S09 中文口音和真实质量认证（需要单独授权）。

在 S03/S04 未通过前，不得声称多段连续旁白或“30 秒 480P 中文旁白成片”完成；在 S09 未通过前，不得声称中文口音质量完成。

## 8. 当前基线和交付证据

当前最新基线（2026-08-30 23:06）：

- Media Runtime + OpenMontage audio adapters：`python -m pytest -q tests/test_runtime.py adapters/openmontage_audio/test_adapters.py` 122 passed（含受控 ffmpeg/ffprobe 实际 full-track 音视频产物和 music-only source handoff）。
- Production Worker：53/53；Persistence：53 pass / 10 explicit `DATABASE_URL`-gated skip；Contracts：36/36；Domain：43/43。
- 根 `pnpm test`：452 passed / 18 explicit environment-gated skips / 0 failed。
- `pnpm --filter @alchemy-video/production-worker typecheck`、`git diff --check`、state validation：通过；根级 `pnpm test/typecheck/build` 未在本轮重跑，上一条根级证据仍按历史记录保留。

历史状态汇总：S01、S02 保持 `READY_FOR_AUDIT`；S03 已验收为 `ACCEPTED`（仅切片）；S04 为当时唯一 `IN_PROGRESS`，S05–S09 仍保持 `NOT_STARTED`/未授权，不得用前项证据替代其它 Exit Gate。S03 的独立正式资产、绝对起点、来源 `_full_mix` 滤镜图、缺轨/非法目标/时长窗口不一致 fail-closed 和 Worker→Runtime 载荷边界均有定向证据；完整章节仍为 `IMPLEMENTED_PENDING_AUDIT`。本汇总为冻结历史快照，现行状态以 formal/state 为准。

这些数字只证明当前代码和边界测试，不证明中文口音、真实 TTS 或完整多段旁白质量。C12.4/C12.5 在 S03–S09 的 Exit Gate 全部完成并写入章节审计记录前，继续保持 `IMPLEMENTED_PENDING_AUDIT`。

（历史增量 22:49）在相同产物重试之外，补充同对象键但 MIME/byteSize/SHA 不一致的 Worker 负向回归；复用既有 `storeArtifact` 冲突分支，确认不可变产物不会被覆盖，composition persistence 不执行且租约释放保留根错误。Worker `52/52`、typecheck PASS。S04 当时仍 `IN_PROGRESS/verifying`，总体仍 `IMPLEMENTED_PENDING_AUDIT`；本项不改变来源边界，也不关闭 approved full-track section windows、完整字幕/转写下游、transition/xfade、cue-only full-narration-first、Studio、REQUIRED 字幕、中文口音或超长旁白 consumer 等硬门。

（历史增量 23:06）对照固定 OpenMontage `_full_mix` 的 music-only 分支，修正既有 ALCHMED8 `audio_plan + music_bytes` 不应落回 legacy `_mix_music_track` 的分支条件；source `amix`、target-duration、normalize、MUSIC ownership/start/fade/gain 映射和不支持窗口的 fail-closed 均保持原样。Runtime+adapter `122/122`、music-only focused `1/110 deselected`、Production Worker `53/53`、Worker typecheck、state validator、diff check 均 PASS。S04 当时仍 `IN_PROGRESS/verifying`；来源无法表达的 section offsets/多窗口、transcript 下游、transition/xfade、cue-only full-narration-first、Studio/REQUIRED 字幕、中文口音和超长 consumer 硬门继续保留。
