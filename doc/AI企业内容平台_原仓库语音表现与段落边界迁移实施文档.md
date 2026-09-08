# AI 企业内容平台：原仓库语音表现与段落边界迁移实施文档

状态：`HISTORICAL / SUPERSEDED FOR STRUCTURED SEGMENT EXECUTION`。本文仍保留固定来源与既有载体的审计证据，不改变正式总控、`.codex-longrun/state.json` 或任何章节状态；结构化分段/旁白时间窗的现行执行规则以《AI企业内容平台_原仓库结构化分段与旁白时间窗完整迁移开发文档.md》为准。

固定来源：`upstream/openmontage@4eab34c5cfcccaa4f1970554928feccce73ee930`。

## 1. 与旧文档的关系和范围

本文件不再作为结构化分段实现的授权清单。其关于多 cue、正式 NarrationAsset、TimelinePlan、样音审批和真实 Provider 的未完成结论继续有效；其中与现行 source-unit 分段规则冲突的描述均为历史快照，不能覆盖新文档、`AGENTS.md`、领域契约或正式总控。

本文是《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》的窄化实施记录，补充其 voice-performance/段落边界的代码载体和当前阻断；不覆盖 `AGENTS.md`、领域/API 契约或正式总控。旧文档中的历史状态、一次性 fixture 和“已落地”描述不能被本文重新解释为完整 R01/R01.2 验收。

本轮只映射已有脚本、spoken section、TimelinePlan、Storage/Runtime 和 Worker 载体。无公共字段、事件、端点、第二 AudioPlan 或新算法；不调用真实 Provider/TTS，不要求上传旁白，不自动选择 Piper/Doubao，不做 pace 数值换算、变速、裁切或补静音。

## 2. 固定 OpenMontage 事实

| 来源 | 事实 | 本平台允许保留的含义 |
| --- | --- | --- |
| `skills/meta/voice-performance-director.md:9-12,14-40` | narration-led script 有顶层 `voice_performance` 和 section `delivery_cues`；cue 有 `pace`、`energy`、`emphasis_words`、`pause_before_seconds`、`pause_after_seconds`、`delivery_note`、`provider_text`。 | `provider_text` 是 provider-facing utterance；显示文本不能替代它。显式 pause 才是 pause 事实。 |
| `skills/meta/voice-performance-director.md:72-93` | 先从最敏感 section 生成样音，检查 voice、pace、pause、emphasis、情绪弧线并记录批准；结构化 cue 存在时不能从 raw script 生成最终旁白。 | 未具备样音人工审批事实时保持 `BLOCKED`；样音不能冒充正式资产。 |
| `skills/pipelines/explainer/asset-director.md:69-99,212-218,257-258` | 先样音后批量；生成 section 时读取 `voice_performance`/`delivery_cues`，优先 `provider_text`，记录已应用设置并检查实测时长。 | 只使用现有脚本/资产/测量端口，不自行补 provider 选择或时间策略。 |
| `skills/pipelines/explainer/compose-director.md:141-143,195-207,214-218,352-361,442` | narration 按实测时长和时间关系编排；FFmpeg fallback 以 tracks 顺序层叠、duck、normalize；字幕从完整 narration 生成，末句和漂移需要终检。 | 只消费已声明的绝对窗口和正式资产；未表达的多 cue/多窗口继续 fail-closed。 |
| `tools/audio/audio_mixer.py::AudioMixer._full_mix` (`:479-633`) | `speech`/`music`/`sfx` track 以 `path`、role 和可选 `start_seconds` 输入，可有 `target_duration`，由一个 source filter graph 混合。 | 复用现有 ALCHMED8/Runtime AudioPlan consumer；不另造混音协议。 |

## 3. 段落边界规则

1. `provider_text` 保留来源的连续文本。相同行内的标点和文字仍是同一 utterance；不同行的换行/段落只保留为来源边界，不推导任何 pause 时长。
2. `pause_before`/`pause_after` 只有在现有规范化 spoken section 中显式存在时才可消费。不得把换行、字符数或 `SLOW`/`FAST`/`BRISK` 等符号直接转成 Piper 的 `length_scale`、静音或其它数值。
3. section identity、顺序和 `start_ms/end_ms` 必须来自现有 `TimelinePlan`；不能按文本长度自动切分、累计相对偏移或从整轨 metadata 猜 section 音频。
4. 正式旁白必须是独立、已批准关系可追溯、并有 MIME/SHA-256/byte size/ffprobe duration 事实的资产。样音、reference audio 和正式 `NarrationAssetVersion` 不互换。

## 4. 当前载体对照

| 当前落点 | 已有载体 | 结论 |
| --- | --- | --- |
| `packages/contracts/src/creative-planning.ts::VoicePerformanceSchema`、`DeliveryCueSchema` | 保存 `voice_performance`、`delivery_cues`、`provider_text`、显式 pause、emphasis 和 pronunciation 字段。 | 规划阶段可承载来源形状；本地枚举/单位是适配事实，不能宣称覆盖所有 provider 能力。 |
| `packages/contracts/src/narration-quality.ts::NarrationSpokenSectionSchema`、`NarrationDeliverySchema` | 保存规范化 `provider_text`、pronunciation、pace、energy、`pause_before_ms`/`pause_after_ms`。 | 内部 spoken-section 载体；缺 provider text 的旧快照不能静默回落 raw script。 |
| `packages/persistence/src/approved-narration-timeline.ts::findApprovedNarrationTimeline` | 校验 workspace/project、approved script/formal asset、资产身份及 MIME/SHA/bytes/duration、section identity/order 和绝对窗口；把 `spoken.provider_text`、pronunciation、显式 pause、pace、energy 映射为 `narrationSegments`。 | 载体方向与 source 的 approved asset + absolute window + measured facts 一致。回归测试只证明映射，不证明生成完成。 |
| `apps/production-worker/src/media-runtime-client.ts::HttpMediaRuntimeClient.synthesizeNarration` | 可传输 `segments` 及其 `provider_text`、pronunciation、pause、pace、energy；`text`/`segments` 互斥。 | transport 有来源字段载体，但不负责 owner/provider 决策。 |
| `services/media-runtime/main.py::parse_narration_payload`、`runtime.py::synthesize_narration_segments_bytes` | 校验并接收 segment metadata；不支持的多 cue/SSML/energy 等情况保持失败关闭。 | 是保守边界，不能当作 OpenMontage 多 section full-mix 已完成的证据。 |

## 5. 已落地的窄适配与仍然阻断的边界

`apps/production-worker/src/media-service.ts:629-689` 现在只对“单个 cue”做来源字段的薄适配：当显式 provider 是 `piper`/`piper_tts` 时，向现有 Runtime segment carrier 传递 `provider_text`、绝对 `start_ms`、pronunciation、显式 pause、pace 和 energy；当选用 Doubao 或其它 provider 时，默认 cue 只发送 canonical `provider_text`，而带非默认 delivery 的 cue 直接 fail-closed，避免把不被 provider 消费的字段静默丢失。该分支没有新增 provider、协议或时间算法。

这不等于完整语音链已完成：Runtime 的分段 Piper 路径仍只允许来源已验证的单 cue；multi-cue、独立正式 section asset/full-mix、样音审批和正式资产链继续保持 `UNAVAILABLE`/`BLOCKED`，不得用 fixture 绕过。`provider_text`/`delivery_cues` 存在时也不得回落到另一份 raw script；没有可消费的来源事实就停止。

另，`packages/persistence/src/approved-narration-timeline.ts:97,273` 的未声明 gap 常量注释引用 scene-director 语义；它不是本文件新增的 voice-performance 来源保证，需单独审计，本轮不修改。

## 6. 本轮窄验证

本轮已验证：

- `pnpm --filter @alchemy-video/creative-planning test -- tests/narration-quality.test.ts`：44 passed、0 failed、0 skipped；直接断言 multiline `provider_text` 的换行边界、`pace=NATURAL` 和显式 pause 默认值。
- `pnpm --filter @alchemy-video/production-worker test`：66 passed、0 failed、0 skipped；包含单 cue Worker request capture（Doubao 默认 cue 只传 canonical text、非默认 delivery 在 Runtime 前 fail-closed）、现有 Runtime transport 的结构化字段回归和既有 composition 回归。
- `pnpm --filter @alchemy-video/production-worker exec tsc --noEmit`：通过。
- `services/media-runtime` 定向旁白测试：9 passed、0 failed、0 skipped；全部 fixture/mock，无真实 Provider/TTS/网络。

这些证据只覆盖窄适配，不代表 R01/R01.2 READY 或 ACCEPTED。后续仍需来源支持的正式 multi-cue/full-mix consumer、独立测量资产/TimelinePlan、样音批准和真实产物人工听看证据；在此之前不升级状态。
