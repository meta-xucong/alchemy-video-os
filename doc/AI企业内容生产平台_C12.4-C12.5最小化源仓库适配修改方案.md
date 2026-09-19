# AI 企业内容生产平台：C12.4/C12.5 最小化源仓库适配修改方案

状态：`FROZEN / HISTORICAL_BASELINE`（2026-08-30 起冻结；已有实施证据保留，硬门尚未收口）  
适用章节：C12.4、C12.5  
更新时间：2026-08-30

> 本文把当前旁白/音乐问题收缩为最小可接受修改。它不授权真实 Provider、TTS、Veyra、共享积分、VPS、部署、网络调用或 Git 操作。未被本文明确列入的代码和能力保持冻结。自 2026-08-30 起本文冻结为历史基线，不再作为当前源能力清单、冲突裁定或新增实现授权；当前统一依据《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》执行。

> **2026-09-01 语音路线冲突覆盖（SUPERSEDED）**：本文把“完整 canonical script 单次 Piper”作为主要正式旁白路径的文字，仅在“selector 已明确选择 Piper 的离线 fallback”这一条件下保留；它不能再被解释为所有新任务的权威 spoken track，也不能据此静音已具备来源证据的 Provider native audio。现行 native/TTS owner、来源 `TTSSelector`、样音 gate 和 provider-specific 字段边界，以《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》为准。本文关于样音/正式资产隔离、实际时长、`_full_mix` 和 fail-closed 的非冲突证据继续保留；本文仍是历史基线，不授权新增实现。

> **当前输入口径（2026-09-01；历史基线说明）**：自动旁白不要求用户上传音频或样音；服务器生成的样音仍需人工审批，正式旁白必须是独立实测资产。本文出现的上传音频仅指兼容/历史路径，不能覆盖最新执行文档。

## 1. 决策结论

不做整仓回滚，也不把任一参考仓库整体复制进平台。采用以下三层策略：

1. 保留平台已有的 Control API、Domain、Persistence、Worker、Storage、Mock、工作区隔离、幂等和 C11.2 资料事实链。
2. 对音频行为只保留参考仓库中已有的实现和语义，平台只做权限、对象存储、DTO、错误和任务边界的薄壳适配。
3. 对尚未完成或无法由来源证明的路径直接 `fail-closed`，不以自造 fallback、阈值、协议或 UI 语义掩盖缺口。

该方案的第一目标是“不能错误交付”，而不是在一轮改动中覆盖全部媒体能力。C12.4/C12.5 在所有硬门完成并独立审计前继续保持 `IMPLEMENTED_PENDING_AUDIT`。

## 2. 底层复用规则（不可放宽）

“只移植原仓库代码，做薄壳适配，不自己写新逻辑；修改和删减都以原仓库的代码为标准做参照”是本项目的底层规则，具体执行如下：

- 先定位固定 commit 中的原始文件、函数、类型、字段、参数和测试，再决定迁入方式。
- 参考仓库已有能力优先直接移植；平台只允许增加输入/输出转换、workspace/权限校验、对象存储读写、错误归一化、任务幂等和公开脱敏。
- 禁止在已有来源能力上另写平行算法、隐含阈值、自动改写、替代协议、静默回退或自定义 UI 语义。
- 任何修改、删减、重命名或替换，必须记录来源文件/符号、保留内容、平台适配点、舍弃原因和行为回归测试。
- 来源没有对应安全实现时，默认保持禁用或显式阻断；不能以“为了可用”为理由自行补造逻辑。
- 平台自己的身份、工作区、Control API、持久化、队列、审计和安全边界属于必要外壳，不得误删；但它们不得改变来源媒体/内容逻辑的含义。
- 同一能力存在内存实现、数据库实现或兼容读取器时，必须保持同一来源语义；不能只修一条实现让测试表面通过。

## 3. 当前基线与问题范围

- C11.2 本地范围已 `ACCEPTED`；不得因为本方案重开该章节。
- C12.4/C12.5 是唯一当前音频实施切片，仍为 `IMPLEMENTED_PENDING_AUDIT`。
- 先前的 444/18/0、94/94 等计数仅是历史快照；本方案当前可复核证据以文末 2026-08-30 深审计对账为准（根 `447 passed / 18 explicit skip / 0 fail`，Media Runtime `97/97`，OpenMontage audio adapters `7/7`，Control API `53 pass / 1 explicit service-gated skip / 0 fail`，Production Worker `43/43`）。这些是结构/边界证据，不是中文口音或真实 Provider 质量证明。
- 当前已知高风险路径：样音可能被当作完整旁白、完整旁白 section window 尚未实际消费、多 cue Piper 不是连续旁白、AUTO 无曲目可能静默无 BGM。

## 4. 最小改动边界

### 4.1 允许修改的现有文件

- `packages/persistence/src/narration-quality-repository.ts`
- `packages/persistence/src/approved-narration-timeline.ts`
- `packages/persistence/src/production-repository.ts`
- `apps/production-worker/src/media-service.ts`
- `services/media-runtime/runtime.py`
- 上述模块已有的定向行为测试、`UPSTREAM.md` 和章节审计文字

除非现有契约无法表达安全边界，不新增表、迁移、Provider、公开 API 或新的音频协议。不得使用破坏性 Git 操作。

### 4.2 明确不在本轮做的内容

- 不新增 ALCHMED9 或第二套 AudioPlan。
- 不接入 Freesound 或其他未授权外部曲库；Pixabay 仅按第 10 节用户明确授权恢复的 OpenMontage 源适配和显式导入路径执行。
- 不改 Piper 声音模型来“模拟”中文口音。
- 不增加自动数字/缩写改写、自动慢放、`atempo`、`rubberband`、无来源尾部补音或自定义评分阈值。
- （历史基线约束；现行本机 Grok/Doubao 授权以自动音频正式文档及 formal/state 为准）不开启真实 TTS、真实视频 Provider、Veyra、共享扣费、VPS、域名、TLS、部署或生产路由。
- 不复制 OpenMontage 的 Backlot、Agent、全局注册表、项目目录或事件文件作为平台事实源。

## 5. P0：四项最小修改

### 5.1 样音只做审批凭据，不能做正式整轨

涉及：`narration-quality-repository.ts`、`approved-narration-timeline.ts`。

- `approveNarrationScriptRevision` 只记录已有 `sample_asset_id` 的样音审批事实，不再把样音字节登记为正式 `NarrationAssetVersion`。
- 正式 `NarrationAssetVersion` 只能在完整脚本旁白已经生成、测量并通过校验后写入；沿用现有表和对象关系，不新增平行模型。
- `createTimelinePlan`、`hasReadyTimelinePlan` 和 approved timeline loader 必须要求正式版本，并拒绝 `asset_id == sample_asset_id` 的记录。
- `narration_asset_version.ready` 事件只代表正式旁白版本 ready，不代表自动生成样音的审批完成；当前流程不要求用户上传样音。
- 内存仓储和 Drizzle 仓储必须同步修改。

来源依据：OpenMontage `voice-performance-director.md` 的 sample gate 和 `asset-director.md` 的 approved sample/provider/settings 约束。若无法证明正式整轨身份，返回已有的 `INVALID_TIMELINE`/媒体不可用结果，禁止继续合成。

### 5.2 正式旁白只走完整文本的一次生成（历史 TTS 窄切片；owner 路由已 SUPERSEDED）

涉及：`apps/production-worker/src/media-service.ts`、`services/media-runtime/runtime.py`。

- 有正式旁白资产时，Worker 直接读取其 bytes；不得再次 TTS。
- 没有正式资产但存在完整 canonical script 时，只调用现有 Piper 一次，保存测量时长；不得逐 cue 作为正式成片音轨。
- 多 cue 且没有正式整轨时，保持现有兼容接口但在合成前阻断，或明确标记为 draft，不得报告正式成功。
- 旁白超出视觉目标时回到文案/画面规划；禁止裁切、变速或静默填充。
- 旁白不足时只有已有音乐或明确 HOLD/B-roll 尾段才能覆盖目标时长，否则阻断。

来源依据：OpenMontage `compose-director.md`、`executive-producer.md` 和 C12.5 的自然语速优先规则。Piper 的 `length_scale`/`sentence_silence` 只按原仓库数值参数传递；原仓库没有 `pace -> length_scale` 的符号映射，因此本地 Piper 对 SLOW/FAST 保持 fail-closed，不承担时长填充。

### 5.3 AUTO 没有音乐时必须显式阻断

涉及：`packages/persistence/src/production-repository.ts`。

- `AUTO` 无可用 `MUSIC` 资产：返回可审计的不可用/阻断。
- `MANUAL` 指定资产不可用：阻断。
- 只有显式 `OFF` 才允许无 BGM。
- 继续使用服务端确认的 `READY AUDIO` 且 `audio_role=MUSIC` 资产；`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 和未声明角色不得进入 AUTO。

来源依据：领域/API 契约和 OpenMontage 音乐选择流程。不得恢复网络音乐目录。

### 5.4 尚未能实际消费的时间窗保持 fail-closed

涉及：`production-repository.ts`、`media-service.ts`、`runtime.py`。

- 如果完整 `AudioPlan` 的 section window 尚未被 Runtime 实际消费，则该计划不得声称已完成绝对时间轴。
- 单一连续整轨从 `t=0` 播放只在其覆盖事实明确且无 section gap 时允许。
- 多段旁白只有在使用 OpenMontage `AudioMixer._full_mix` 的 `speech` tracks、实测时长和绝对 `start_seconds` 后才开放。
- 未完成该适配前，多 cue 只作为兼容/草稿路径，不进入正式 `VideoVersion`。

## 6. P1：只在 P0 通过后补的来源适配

P1 不是第一轮必做项；每项都必须单独有来源登记和行为测试。

1. **源混音**：把现有平台轨道映射为 OpenMontage `speech/music/sfx`，复用 `_full_mix` 的 fade、sidechain ducking、`target_duration` 和 loudnorm；不得把 dB 数值自行解释成 compressor ratio。
2. **字幕与转写**：复用 OpenMontage `transcriber.py` 的 word timestamps 和 `subtitle_gen.py` 的 SRT/VTT；没有可靠时间戳就阻断，实际烧录结果必须复核。
3. **音频格式**：保留实际 ffprobe MIME，不把 MP3/OGG 伪标为 WAV。
4. **Studio 闭环**：复用已有 API，补齐“样音试听/批准 → 正式整轨 → 实测 TimelinePlan → ProductionRun”顺序；不新增第二套工作流。
5. **中文口音**：仅在获得明确授权后，按 OpenMontage 已有 Doubao/DashScope/OpenAI/Google provider 语义建立受控 profile；当前 Piper 只标记为离线 draft。

## 7. 最小行为测试与验收门

必须使用行为测试，不以静态源码搜索代替：

- 样音资产不能被 Timeline/Worker 作为正式旁白读取。
- 正式整轨存在时不调用 Piper；没有整轨的多 cue 请求被阻断。
- `AUTO` 无音乐阻断，`OFF` 可静音完成；样音/用户音频不进入 AUTO。
- 22 秒旁白配 30 秒目标只能通过明确音乐或 HOLD/B-roll 尾段覆盖；33 秒旁白不得裁切或变速。
- 三段绝对起点 cue 只有在独立测量并使用源 `_full_mix` 后才能开放，否则保持阻断。
- MP3、OGG、WAV 的 MIME/ffprobe 事实不被伪造。
- canonical transcript 不匹配或字幕时间戳缺失不能进入正式成功。

Exit Gate：以上 P0 行为全部通过，代码/测试均有来源映射，历史 `LEGACY_PRESERVE` 不变，且文档仍明确 C12.4/C12.5 未完成的硬门。否则状态不得改为 `ACCEPTED`。

## 8. 兼容、回滚与审计

- 历史 `TaskRun`、`ProductionRun`、`VideoVersion` 和已生成资产不重写、不重新混音。
- 旧 ALCHMED1–7 继续只读兼容；ALCHMED8 暂作过渡，不再扩展字段语义。
- 任何不满足正式旁白/音乐/时间轴事实的新增任务，进入已有可恢复失败或等待路径，不提交昂贵 Provider 任务。
- 回滚只允许关闭本轮新路径或恢复旧兼容读取，不删除历史数据，不做 `reset --hard`、强推或批量删除。
- 完成后只更新 `UPSTREAM.md`、本方案、正式总控和章节审计记录；测试记录只保留最新可复核计数，旧计数明确标为历史。

## 9. 来源清单

- [OpenMontage voice-performance-director](../upstream/OpenMontage/skills/meta/voice-performance-director.md)
- [OpenMontage compose-director](../upstream/OpenMontage/skills/pipelines/explainer/compose-director.md)
- [OpenMontage executive-producer](../upstream/OpenMontage/skills/pipelines/explainer/executive-producer.md)
- [OpenMontage AudioMixer](../upstream/OpenMontage/tools/audio/audio_mixer.py)
- [OpenMontage subtitle generator](../upstream/OpenMontage/tools/subtitle/subtitle_gen.py)
- [OpenMontage transcriber](../upstream/OpenMontage/tools/analysis/transcriber.py)
- [huobao storyboard-breaker](../upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md)
- [Seedance long-video](../upstream/Seedance-2.5/skill/seedance-25/references/long-video.md)

本方案只吸收上述来源中已经存在的代码/字段/规则；平台边界适配和每次改动的具体证据必须另记于《第三方来源与复用登记》和章节审计记录。

## 10. 明确授权的 Pixabay 恢复（2026-08-30）

（历史授权快照，2026-08-30）用户后来明确授权本轮访问外部网络并恢复原仓库 Pixabay 能力；这条授权仅 supersede 本文前述“暂不接入 Pixabay/不访问网络”的范围限制。后续本机 Grok/Doubao 授权和当前禁用项以自动音频正式文档及 formal/state 为准。

- 唯一来源仍为 `upstream/OpenMontage/tools/audio/pixabay_music.py`，固定 commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- 运行时保留原工具的搜索页、bootstrap JSON、HTML MP3 fallback、30–120 秒默认筛选、无匹配时回退全部结果、取首条和 MP3 下载顺序；Control API 只增加工作区权限、幂等、对象存储、哈希/MIME/大小确认等薄壳。
- Studio 只提供显式搜索词导入，不自动联网、不增加排序/推荐/候选目录，也不恢复 Freesound、Suno 或云端 TTS。导入资产由服务端固定为 `AUDIO + READY + metadata.audio_role=MUSIC`，旁白样音/用户源音频不会进入 AUTO。
- 运行时只接受 HTTPS `cdn.pixabay.com` 音频 URL；这是 loopback/SSRF 安全边界，不改变来源的选择逻辑。部署若未配置 `MEDIA_RUNTIME_URL`/`MEDIA_RUNTIME_TOKEN`，能力继续显示为阻断而不是绕过运行时直连。
- （截至 2026-08-30 的历史证据）本次只验证 Pixabay；其他真实 Provider、TTS、Veyra、共享积分、VPS/SSH/DNS/TLS 和 Git 操作仍未执行。

## 11. 2026-08-30 深审计最新对账（17:05）

- 本轮没有扩大 P0/P1 范围。新增/修正均回指 OpenMontage 固定 commit `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::_full_mix`、`tools/audio/pixabay_music.py` 和对应 pipeline/voice-performance 规则；平台只保留受控 Runtime、workspace、对象、错误、幂等和公开投影的薄壳适配。
- Runtime JSON 接口使用有界分块读取，避免仅信任 `Content-Length`；请求过大或非法编码在调用 Piper/Pixabay 前阻断。混音继续使用来源的 `ratio=9`、`level_sc=1`、`mix=0.9` 及正衰减到线性音量换算，不把 dB 字段自造为压缩比。Control API 只有在受控 Runtime 的 FFmpeg/ffprobe、Piper model/config/launcher 均有可见证据时才报告能力 `AVAILABLE`，否则 `NOT_CONFIGURED`。
- 最新行为/构建证据：Media Runtime `97 passed / 0 failed`；audio adapters `7/7`；Control API `53 pass / 1 explicit service-gated skip / 0 fail`；Production Worker `43/43`；根 `pnpm test` `447 passed / 18 explicit environment-gated skips / 0 failed`；`pnpm typecheck`、`pnpm build`、`git diff --check` 通过（build 仅保留既有 Nuxt/Nitro `DEP0155` 警告）。旧计数保留作迁移轨迹，不作为当前验收证据。
- 章节仍是 `IMPLEMENTED_PENDING_AUDIT`。approved full narration section-level 时间窗实际消费、完整 AudioPlan 语义、transition/xfade coverage、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、普通 `REQUIRED` 字幕事实链、中文口音认证和超长旁白 consumer 行为仍是硬门；结构性绿色测试不等于这些问题已解决。
- （历史基线）Pixabay 只在用户明确授权后恢复原仓库的显式搜索/导入；其 MUSIC 角色保持与 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 隔离。真实 Provider/TTS/Veyra/共享积分/VPS/DNS/TLS/部署/Git 仍关闭，且本轮不提交 Git；现行授权和状态以自动音频正式文档及 formal/state 为准。
