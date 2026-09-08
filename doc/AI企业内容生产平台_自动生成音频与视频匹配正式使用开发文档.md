# AI 企业内容生产平台：自动生成音频与视频匹配正式使用开发文档

版本：`1.3.0`

状态：`ACTIVE / REAL_LOCAL_IMPLEMENTATION_BASELINE`

生效日期：2026-09-01

本版本性质：`CURRENT EXECUTION + GAP-CLOSURE PLAN + SOURCE-PARITY UPDATE`

## 0. 权威性与冲突处理

本文是当前“自动生成视频、自动生成旁白、原生音频优先、显式 Doubao 对照”的唯一执行文档。它只在语音/音画匹配范围内覆盖早期文档；不覆盖 `AGENTS.md`、领域/API 契约、正式总控文档的状态账本，也不自动把任何章节标成 `READY_FOR_AUDIT` 或 `ACCEPTED`。本版本把用户已授权的真实 Aiself Grok/Doubao 本机操作模式写入执行基线，但不改变仓库/CI 的 Mock 默认值。

本文覆盖并 supersede 早期文档中把“用户上传旁白/样音”写成必需输入、把 Piper/`PLATFORM_NARRATION` 写成所有新任务默认 spoken owner、或把 Provider dialogue 无条件静音的现行口径。历史段落和历史产物保留用于审计，不能继续作为当前实现依据。通用参考图片、企业资料、Logo、MUSIC 资产上传仍然有效；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 角色仍保留用于兼容既有资产和隔离测试，但当前自动旁白流程不要求、也不使用用户上传音频。所有开发文档中的“上传旁白/上传样音”若未明确标注历史或兼容，均按本段修正为“服务端生成”。

### 0.1 当前口径（所有相关文档必须一致）

- 本项目当前业务是“自动生成视频，并由 Provider 原生音频或服务端 TTS 生成匹配音频”；用户不需要、也不会被要求上传旁白、样音或其它 spoken audio。通用图片、资料、Logo、MUSIC 上传不受影响。
- `NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 只保留为兼容既有资产和跨角色隔离测试；它们不能触发自动旁白、不能进入 AUTO BGM，也不能代替服务器生成的样音/正式 `NarrationAssetVersion`。
- 真实本机操作模式已获本轮授权：视频使用现有 Aiself `Sub2ApiVideoProvider`（`VIDEO_PROVIDER=sub2api`），优先保留 Grok 原生音频；只有操作者明确选择替换时，才使用 OpenMontage `DoubaoTTS`，当前语音 profile 为 `seed-tts-2.0` + `zh_female_meilinvyou_uranus_bigtts`。该模式不等于生产部署、共享积分或 Veyra 开启。
- `VIDEO_PROVIDER=mock`、`LOCAL_AUTH_MODE=dev`、`VEYRA_AUTH_ENABLED=false` 仍是仓库模板、CI 和无授权环境的默认值；真实值只存在未入库的本机环境，绝不写入代码、文档、fixture、日志或状态账本。
- 真实模式不建立新公开音频协议：服务器生成样音/正式资产只走现有内部 outbox → Media Runtime queue/Worker/Storage 端口；当前没有新增 `narration-audio` 公开路由，Studio 触发闭环未完成时必须保持 `BLOCKED`。

### 0.3 本版本已落地的最小来源适配

- `apps/production-worker/src/media-runtime-client.ts` 的显式 Piper 与 Doubao client deadline 均与 OpenMontage `piper_tts.py::_generate`、`doubao_tts.py::_poll_query` 的 `timeout=300` 对齐；未选定 provider 的通用请求仍使用既有 90 秒 fail-closed 兼容边界。
- 该修正只恢复来源已有的超时事实和回归测试，不引入语速数值映射、atempo、裁剪、补静音、自动 fallback 或新的 TTS 协议。
- R01.2 的服务器生成样音/正式资产 identity、对象事实和重试路径继续复用现有 persistence/Worker/Storage；未新增用户上传旁白路由。Studio 的完整“生成→试听→批准→正式资产→TimelinePlan”仍是待审计硬门，不能用内部 fixture 代替。

### 0.3.1 兼容字段说明（不改变 audio owner）

现有 `DeliveryPlan` 载荷中的 `voice_mode: "PLATFORM_GENERIC"` 仅是历史兼容字段，不能被解释为平台旁白 owner、Piper 默认或用户上传音频要求。实际 owner 必须从已认证的 Provider profile snapshot 读取：`NATIVE_PROVIDER` 保留 Grok 原生音轨，明确选择时才是 `DOUBAO_TTS`；没有 profile owner 继续 `UNAVAILABLE`/`BLOCKED`。本说明只消除字段歧义，不新增字段、协议或路由。

### 0.2 遗留问题逐项闭环计划（本版本唯一执行清单）

以下小项只允许在固定来源已有语义上做平台薄壳适配。每项必须先有来源映射，再有代码/契约（若需要）、行为测试、产物证据和四账本对账；没有来源支持的部分保持 `DEFERRED`/`BLOCKED`，不得用自造算法填空。

| 编号 | 要解决的遗留问题 | 仅允许复用的来源事实 | 当前落点与完成条件 |
| --- | --- | --- | --- |
| R01-A | native owner 与显式 Doubao owner 冲突 | OpenMontage `GrokVideo.supports/execute`、`DoubaoTTS`、`TTSSelector` | `runtime-profile`/Runtime/Worker 只保留一个 owner；native 不发 TTS，Doubao 只有明确 provider；完成条件为 owner 互斥、密钥隔离、一次提交和产物事实测试 |
| R01-B | 自动样音、正式 `NarrationAssetVersion`、重放/重启身份 | `voice-performance-director.md`、`asset-director.md` 的样音先行、provider/voice/settings、实际时长 | 由现有内部 generation event→queue→Worker→Storage 写入服务器生成 `AUDIO/GENERATED`；样音与正式资产分离，身份包含 script/generation kind/section/provider/voice/settings/sample，重复消费仅复用相同 bytes/facts；不得要求上传音频 |
| R01-C | approved section-level 绝对时间窗与 TimelinePlan/AudioPlan consumer | `audio_mixer.py::_full_mix` 的 `start_seconds/target_duration`、explainer compose 的窗口/尾段事实 | 只消费已声明且可表达的绝对窗口、独立正式资产和实测时长；超窗、未消费、多窗口、复杂连续非 cut 直接阻断；不加 atempo、裁切、隐式补静音或第二 AudioPlan |
| R01-D | 转场、字幕和长旁白恢复 | OpenMontage `video_stitch`/`SubtitleGen`/executive producer 的已验证字段和恢复顺序 | 仅复用已有 transition/xfade、checked transcript→SRT→FFmpeg、measured-duration feedback；重启/重复只查询已有 request/asset；来源未表达的自动重规划/视觉延长/人工质量保持阻断 |
| R01-E | Huobao 2–4 子镜头/2–6 秒等细语义 | Huobao storyboard-breaker 与 Seedance long-video 固定规则 | 只在现有 `PromptPackage`/私有 planning snapshot 能逐字段承载并有来源测试时迁移；不能把逻辑 beat 数直接变成 Provider 调用数；未完成字段保持 `DEFERRED` |
| R01-F | Studio 生成→试听→批准→正式资产→TimelinePlan | OpenMontage “先样音、后批量生成”流程；平台现有 Control API/审计边界 | 生成入口只能是现有版本化命令/内部 outbox 的薄壳；不新增用户音频上传，不把样音当正式资产；人工批准、中文口音和 `REQUIRED` 字幕均须单独事实，未具备时不升级章节 |
| R01-G | 真实茅山对照 | 既有 Aiself Grok/Sub2API 与 Doubao source adapter | 同一历史项目、同一脚本/画面、480p：先 native，再由操作者显式选择 Doubao；记录 ffprobe/MIME/SHA/时长/尾静音/提交次数和人工结果。真实对照不改变 Mock/CI 默认，不等于章节验收 |

本清单中的“完成”只表示工程证据完成；`R01-F` 的人工审批、中文听感和 `REQUIRED` 字幕事实必须由真实项目和人工复核后才能关闭。任何旧文档把上述事项写成用户上传前提、自动 Piper、静默 fallback 或可由静态命中替代行为证据的段落，均为 `HISTORICAL/SUPERSEDED`。

## 1. 当前目标和使用模式

目标是让同一份已批准脚本在网页中生成一版 Provider 原生音频成片；只有操作者明确选择替换音频时，才生成一版 Doubao TTS 对照成片。两版均必须沿同一画面、同一脚本、同一时间事实链执行，最后由技术检查和人工试听/观看共同判断。

实际使用配置采用现有 Aiself Grok 的 `Sub2ApiVideoProvider` 适配器（`VIDEO_PROVIDER=sub2api`）和现有 Media Runtime Doubao 薄壳；不在平台内直连 xAI 或另造第二个视频协议。仓库默认和 CI 仍保持 `VIDEO_PROVIDER=mock`、`LOCAL_AUTH_MODE=dev`、`VEYRA_AUTH_ENABLED=false`，真实配置只能通过未入库的本机环境显式启用。本轮用户已授权使用 Aiself Grok 与 Doubao，当前操作 profile 为 Grok `grok-imagine-video-1.5`、Doubao `seed-tts-2.0`/`zh_female_meilinvyou_uranus_bigtts`；该授权不扩展到 Veyra、共享积分、VPS、SSH、DNS、TLS、部署或 Git。

音频 owner 规则固定为：

1. 能力快照和产物证据确认 `NATIVE_PROVIDER` 时，保留 Grok MP4 内的原生音轨，不再调用 TTS。
2. 原生结果被人工/客观检查判定不可接受时，操作者显式选择 `DOUBAO_TTS`，按来源 Doubao 请求链生成替换音频，再按既有 `AudioPlan`/`_full_mix` 组合。
3. 没有 owner、profile 能力或正式资产事实时保持 `UNAVAILABLE`/`BLOCKED`；不得自动 native→Doubao、不得默认 Piper、不得自动审批样音。

## 2. 固定来源与允许的薄壳

所有实现和删减必须能指向下表的固定 commit、文件和符号。平台只增加现有 workspace/project/权限、Storage、MIME/SHA/byte-size/ffprobe、队列、事务、幂等、错误归一化和脱敏薄壳。

| 来源 | 固定文件/符号 | 必须保留的来源语义 | 平台适配落点 |
| --- | --- | --- | --- |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/grok_video.py::GrokVideo.supports`、`execute` | `native_audio=True`；视频提交/轮询/下载一次完成，原生音频随 MP4 返回 | `packages/provider-video` 的已存在 `sub2api` profile/Worker；只做能力快照、产物校验和 owner 绑定，不新增 `generate_audio` |
| OpenMontage 同上 | `tools/audio/doubao_tts.py::DoubaoTTS` | `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`；`seed-tts-2.0`；submit→预查询等待→poll→download；source headers/body、status 2/3、timeout、metadata 顺序 | `services/media-runtime/adapters/openmontage_audio/doubao.py`、既有 Runtime/Worker loopback；只做临时文件、bytes/MIME/SHA/size/ffprobe 和 secret 脱敏 |
| OpenMontage 同上 | `tools/audio/tts_selector.py::TTSSelector._providers/_select_best_tool` | registry discovery、preferred provider、无候选失败；不凭空创建 provider tuple | `selector.py` 保留显式 provider；无 registry 时 `auto`/unknown fail-closed，不实现新排序/自动 fallback |
| OpenMontage 同上 | `skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md` | top-level `voice_performance`、section `delivery_cues`、`provider_text`；先生成样音供人试听，再批量生成；记录 provider/voice/settings；实测 `audio_duration_seconds` | 复用现有 Script/Asset/TimelinePlan 字段；样音和正式资产分离，人工结果写审批事实，不猜测口音 |
| OpenMontage 同上 | `skills/pipelines/explainer/compose-director.md`、`tools/audio/audio_mixer.py::AudioMixer._full_mix` | 旁白按绝对时间窗进入合成；已声明音乐/视觉尾段覆盖短音频；track role/start/gain/fade/duck/target 顺序 | 既有 ALCHMED8/Media Runtime/Worker；不能新增第二 AudioPlan、atempo、裁切、补静音或未来源转场 |
| Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/src/services/adapters/volcengine-video.ts`、`generation.ts` | `generate_audio` 是该视频请求的 provider-specific 字段；`reference_audio` 是参考输入 | 仅作为字段语义参考；不得把它跨映射成 Grok 的新字段，也不得把用户上传参考音频变成当前旁白输入 |
| Seedance `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/long-video.md`、prompting 规则 | 声音 owner、时间轴脚本、段间状态和端点需在 PromptPackage 中可追溯 | 继续使用现有 PromptPackage/Provider profile；无来源能力时阻断 |
| 本地 `sub2api-video-mcp` 适配事实 | `POST /videos/generations`、状态、内容下载 | `model/prompt/duration/resolution/ratio/image` 和持久 request id/轮询/下载 | 继续使用 `Sub2ApiVideoProvider`；不把 provider 原始响应泄露给 Web |

## 3. 自动旁白事实链（不含用户上传）

严格按以下顺序实现，任何一步缺少来源事实就停止在 `BLOCKED`：

```text
approved script + voice_performance/delivery_cues
  -> source native capability check
  -> Grok native MP4  (NATIVE_PROVIDER; keep provider audio)
  -> objective ffprobe/MIME/SHA/duration + human review
  -> [仅操作者显式选择替换时]
     Doubao generated sample (server-created AUDIO/GENERATED)
       -> human sample approval fact
       -> Doubao formal narration (server-created AUDIO/GENERATED)
       -> measured NarrationAssetVersion (sample_approved=false)
       -> TimelinePlan with absolute section windows
       -> ALCHMED8 / OpenMontage _full_mix
       -> final ffprobe/QC + human review
```

样音是 provider/native 或显式 Doubao 自动生成的服务器资产，不是上传控件的前置条件；样音审批只记录“声音、停顿、强调、语气可接受”的人工事实，不能把样音行直接当正式旁白。正式 `NarrationAssetVersion` 必须绑定同一 script revision、provider、voice、provider settings、MIME、SHA、byte size 和实测 `duration_ms`；`TimelinePlan` 只能引用独立正式版本，不能引用样音。

原生分支只有在固定 Grok profile 的 `native_audio` capability snapshot 与下载 MP4 的真实音频流均可复核时才算可用。原生结果不可接受不会自动切换 Doubao；操作者必须用同一项目、同一镜头和同一脚本显式启动替换分支。当前服务器生成请求沿现有内部 outbox → Media Runtime queue/Worker/Storage 端口执行，未新增公开 `narration-audio` 路由；Studio 尚无完整触发闭环时保持 `BLOCKED`。

当前契约已有的 `sample_asset_id` 只表示审批所听的服务器生成样音资产。若要新增 provider/voice/settings 字段或公开操作，必须先更新领域/API 契约并写 ADR；不能在 Control API 里写死 `piper-local` 或 `platform-generic-zh` 来伪造来源事实。

## 4. 时长、字幕和混音边界

- 旁白文本优先使用已编译的 `provider_text`/`delivery_cues`；不能重新拼写、补写或按字符数造台词。
- 以 Runtime/ffprobe 的实际音频时长为事实。禁止用 `atempo`、变速、截断、循环、无来源静音或视觉延长去填目标时长。
- 实际时长超出批准视觉窗口时，沿来源的 SEND_BACK/重新规划边界阻断；短于窗口时，仅消费 TimelinePlan 已声明的音乐、环境声或 HOLD/BROLL 尾段。没有明确覆盖事实也阻断。
- 只有已验证、可表达的 section `start_ms/end_ms` 才能进入 `_full_mix`；未消费、多窗口、复杂连续非 cut 或 transition/xfade 语义继续 fail-closed。
- `REQUIRED` 字幕必须有 checked transcript/word timestamps → SRT/字幕工具 → FFmpeg 产物事实；缺证据时标记不可用，不把静态 schema 命中当通过。
- 口型同步不属于本轮自动链路；Wav2Lip/Kling 仍按用户决定延期，不为其增加自造 API、模型或算法。

## 5. 分章节执行与 Exit Gate

当前沿用 E12/R01 单一活动切片，不新建平行章节。每一小项都按“来源映射→最小代码→定向行为测试→审计记录→状态对账”推进：

| 小项 | 允许落点 | 最小 Exit Gate |
| --- | --- | --- |
| R01.1 owner/profile | `runtime-profile.ts`、`sub2api` Worker、Media Runtime owner gate | native profile 证据与无 TTS/显式 Doubao 互斥测试；无证据保持 BLOCKED |
| R01.2 自动样音与正式资产 | 现有 Runtime、Storage、Asset/NarrationAssetVersion persistence、内部 outbox/Media Runtime queue | server-generated sample 与 formal asset 可区分、同脚本/provider/voice/settings、幂等/重启不重复；不新增上传旁白路由或公开 `narration-audio` 路由；当前内部生成/存储/Worker 代码已有定向证据，Studio 触发和人工 approval 事实仍是硬门 |
| R01.3 TimelinePlan/AudioPlan consumer | 现有 `narration-quality`、ALCHMED8、`media-service.ts` | 正式资产身份、绝对 section windows、MIME/SHA/bytes/duration 被实际消费；不可表达组合 fail-closed |
| R01.4 final QC | 现有 ffprobe/transcriber/subtitle/`_full_mix` | 产物事实、字幕事实、尾静音/短尾覆盖可复核；不宣称人工质量 |
| R01.5 双版本真实对照 | 现有 Aiself Grok/Sub2API 与显式 Doubao route | 茅山项目同画面同文案 native/Doubao 两版均有审计产物；客观检查和人工听看分别记录；不改变默认 Mock |

R01.2/R01.3 若发现公共命令或持久化字段不足，先在 `doc/AI企业内容生产平台_开发决策记录.md` 写 ADR，再改契约、schema、实现和测试。没有安全来源对应的完整 section windows、自动选最敏感 section、registry/rank、连续非 cut 转场、字幕人工事实或中文口音，保持 `DEFERRED/BLOCKED`，不以结构性绿测替代。

## 6. 茅山温泉真实对照验收

真实测试使用网页历史项目“茅山温泉・桃李春风 松弛的生活”的已保存脚本、镜头、参考资产和同一目标（30 秒、480p）。在本机实际使用模式中，以显式 `VIDEO_PROVIDER=sub2api` 生成并保存 native 版本；人工/客观检查需要替换时，再用同一画面/脚本显式选择 Doubao（`seed-tts-2.0`、`zh_female_meilinvyou_uranus_bigtts`）生成第二版。不得另造保险或无关文案作为对照；不把用户上传音频加入测试前置。

每版至少记录：输出文件、分辨率、总时长、视频/音频 codec、音频 MIME、采样率/声道、SHA-256、音频实测时长、尾部静音检查、字幕/QC 结果、Provider request 是否只提交一次。人工验收单独记录：普通话口音、断句、语速、情绪、画面语义、是否出现与文案无关的画面或额外台词。技术检查通过不等于人工验收通过；任一硬门缺失，R01 只能 `IMPLEMENTED_PENDING_AUDIT`/`BLOCKED`。

## 7. 规则复核清单（每一步必答）

1. 这一步能否指向固定 commit 的具体文件、符号和原测试？
2. 是否只是 DTO/Storage/权限/错误/幂等/审计薄壳？若不是，停止并写 ADR。
3. 是否误把用户上传旁白/样音、Huobao `reference_audio` 或通用 AUDIO 当成当前 spoken 输入？
4. native owner 是否阻止 TTS，Doubao 是否只有显式选择，Piper 是否没有默认注入？
5. 是否保留 provider_text、实际时长、绝对窗口和 `_full_mix` 的来源顺序？
6. 是否有行为/产物证据，而非静态命中；skip、人工质量和外部未测试边界是否原样保留？
7. 状态是否只在独立审计后升级，且四账本一致？

## 8. 当前明确不做

不接用户上传旁白/样音业务路径；不删除通用图片、资料、Logo、MUSIC 上传或 Pixabay；不新增第二视频/TTS协议、自动 fallback、语速数值映射、时长修正、lip-sync、Veyra/共享积分、VPS/部署或 Git 操作。真实 Aiself Grok 与 Doubao 仅在本文件第 6 节授权的本机茅山对照及其后续同项目实际生成中使用，密钥只从未入库环境读取；实际使用模式仍不改变仓库/CI 的 Mock 默认。

## 9. 当前遗留硬门与交付判定

截至 2026-09-01，R01.2 的内部生成、幂等和 provider/voice/settings identity 代码已有本地行为证据，Doubao client 也遵循来源 300 秒默认 deadline；这只能标记 `IMPLEMENTED_PENDING_AUDIT`，不能直接标记 R01/E12 `READY_FOR_AUDIT`。以下任何一项缺失都保持 `BLOCKED`：

1. 固定 Grok profile 的 `native_audio` capability snapshot、真实下载产物和单次 ProviderAttempt 证据；
2. 服务器生成样音的人工审批事实、独立正式 `NarrationAssetVersion`、完整 `TimelinePlan` 与每个 PRIMARY section 的绝对窗口；
3. 完整 ALCHMED8/AudioPlan consumer、可表达的 transition/xfade、cue-only full-narration-first 和超长旁白重启/重复产物行为；
4. Studio 现有脚本/交付计划页面的生成→试听→批准→正式资产→TimelinePlan 触发闭环，以及 `REQUIRED` 字幕事实链；
5. 用户对真实产物的普通话口音、断句、语速、情绪、画面语义人工验收。一次 canary、结构性测试或静态文档命中均不能替代这些门。

真实模式切换只代表本机可执行配置，不是章节状态升级。每次真实调用后必须回写产物事实、调用次数、失败原因和人工验收状态（不写密钥、原始 token、签名 URL 或完整 Provider payload），再由独立审计员决定是否推进。
