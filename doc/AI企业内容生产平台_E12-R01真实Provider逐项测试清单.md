# AI 企业内容生产平台：E12/R01 真实 Provider 逐项测试清单

> 清单状态：`IN_PROGRESS`
>
> 本清单只用于收集 E12/R01 的可复核证据，不自动改变 `.codex-longrun/state.json`、正式总控、章节审计记录或 C12.4/C12.5 总体状态。当前正式状态仍为 `E12/R01=BLOCKED`、`C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`。

## 1. 执行边界

- 固定真实视频 profile：现有登记的 `aiself-grok / grok-imagine-video-1.5`；固定协议参数沿用既有 C09 认证和 `run-real-provider-canary.mjs`，不在清单中另造时长、分辨率、比例或轮询规则。
- 自动旁白只测试两条已登记 owner：Provider native audio；操作者明确选择的 Doubao `seed-tts-2.0` / `zh_female_meilinvyou_uranus_bigtts`。不启用 Piper 默认 fallback。
- 所有真实调用只从服务端现有未入库环境读取密钥；不把 key、token、签名 URL 或原始 Provider payload 写入文档、日志或 Git。原始 Provider request ID 仅允许保存在受控的内部 `ProviderAttempt` 数据库记录中，用于恢复/幂等；文档、日志、公开 DTO、审计记录只记录脱敏 hash 或存在性。
- 本地默认仍为 `VIDEO_PROVIDER=mock`。真实测试必须显式启动 `VIDEO_PROVIDER=sub2api`，测试完成后恢复 mock。
- 本轮真实调用前固定登记：Control API 与 Task Worker 均为 `VIDEO_PROVIDER=sub2api`；T05 最多 1 次单段提交，T06 最多 1 次固定茅山多段提交，T07 最多 1 次显式 Doubao，T08–T09 仅复用上述运行或离线夹具，不另开 Provider 提交。费用/额度上限沿用用户本轮明确授权及当前账户实际可用额度，不在代码中新增硬限制；若达到上游拒绝/余额不足立即停止该项。
- 正式 E12/R01 的多段样本固定为历史项目“茅山温泉・桃李春风 松弛的生活”的同一脚本/视觉素材、30 秒、480P；“保险AI介绍”只作为独立技术回归样本，不替代正式多段验收。
- 不修改公开契约、状态机、Provider 协议、计费规则、VPS/Git 发布状态；没有来源证据的能力保持 `UNAVAILABLE/BLOCKED`。

## 2. 顺序清单

| 编号 | 检查项 | 执行方式/固定来源 | 通过证据 | 状态 |
|---|---|---|---|---|
| T00 | 环境与密钥边界 | 检查 Docker、PostgreSQL、Redis、MinIO、Control API、Studio；确认真实模式只由显式启动参数开启 | Docker 三容器 healthy；PostgreSQL TCP 可达；Control API/Studio=200；当前栈明确为 `VIDEO_PROVIDER=mock` | `PASS` |
| T01 | 已选 Provider/Profile/owner 对账 | 对照实际启用 profile 对应的固定来源符号（如 OpenMontage `tools/audio/piper_tts.py::_generate`、`tools/audio/tts_selector.py::TTSSelector`、`tools/audio/audio_mixer.py::AudioMixer._full_mix`、`tools/video/grok_video.py::GrokVideo.supports/execute`、`tools/audio/doubao_tts.py::DoubaoTTS`）及当前 Runtime/Worker；不建立跨 Provider 的统一 registry/rank | 已选 native/Doubao 路由和局部能力事实可复核；未来 profile 仍须逐个提供来源映射，auto/unknown 继续 fail-closed；统一 registry/rank 为 `DEFERRED` | `DEFERRED（统一 registry/rank）；按已选 profile 单独复核` |
| T02 | 离线回归 | contracts、creative-planning、workflow-worker、provider-video、production-worker snapshot、persistence | 最新隔离根回归以 test-log 最新条目为准；本轮定向 domain `70/70`、creative-planning `95/95`、workflow-worker `38/38`、provider-video `70/70`、production-worker `72/72`、task-worker `53 pass / 5 existing infrastructure skip / 0 fail`；旧计数仅作历史，skip 保留为环境门禁，不冒充通过 | `PASS（跳过项保留）` |
| T03 | PostgreSQL 跨层 sidecar | 迁移后运行 persistence 全套，复核 JSONB→scheduler→factory→snapshot、重启、重复初始化和参考顺序 | 在停止业务 Worker、保留 PostgreSQL/Redis/MinIO 的隔离条件下，显式 `DATABASE_URL` 全套 `91 pass / 0 fail / 0 skip`；另有 `production-repository.integration.test.ts` `4/4`。侧车 JSONB→scheduler→factory→snapshot 与错误分类通过。未设置 `DATABASE_URL` 的普通命令仍保留既有环境 skip；全栈并行运行时 outbox relay 可能竞争领取测试事件，不能把并行运行结果当稳定 DB 证据；无跨模块反向 import | `PASS（隔离 DB 集成）` |
| T04 | 真实 LLM 规划 smoke | 复用既有 `REFERENCE_VISION_*` endpoint/key/model；固定两行中文口播、视觉描述和两个 anchor；不提交视频。两个 anchor 仅是规划输入事实，不等同于两个图片绑定 | 记录调用时间、模型/profile、响应 hash/字节数和失败闭环；规划可解析、段数/引用顺序稳定、规范化后对白逐字一致；失败必须 fail-closed | `PARTIAL`（固定样本 `3/3`，通用稳定性未证） |
| T05 | Grok native 单段真实成片 | 复用 `infrastructure/local/run-real-provider-canary.mjs --real-call` 的既有 profile/参数；本轮 1 次提交、无自动重试 | `prd_01M2F8KEBAQQQT8GRJ9560XB29` 单段运行成功；`provider_attempts` 1 条、`SUCCEEDED`，request ID 仅留内部 DB（证据 hash `894dc03f…9fabc9`）；产物 `vvr_01M2F8QDNQG7EMDWKKW9JAV3C1` 下载 `video/mp4`，SHA-256 `231B0C1C…920DE`，1,511,963 bytes，ffprobe 15.042s / 1280×720 H.264 + AAC 48kHz stereo；native 音轨存在 | `PASS` |
| T06 | 真实多段成片 | 只使用固定历史项目“茅山温泉・桃李春风 松弛的生活”的同一脚本/视觉素材，目标 30 秒/480P，沿用现有段落规划，不手工改写分段；最多一次生产运行，实际 Provider POST 数按冻结分段计划登记 | 历史超限运行 `prd_01M2F90YVWPPGWAGMEZER01XS9` 仍保留为失败证据；修正 segment-local sidecar/真实 relay 后，`prd_01M2FKWAT8FZW0EKN8BAB2DS7C` 的 2/2 段均 `ACCEPTED`，真实成片 `vvr_01M2FM98E6DPZFG2PNNZXDAADX` / `ast_01M2FM7XVH660XE22SR6XYXR9S`，`30.084s`、`848x480`、H.264/AAC、Composition QC=`PASS`、音轨存在且无异常静音，music=`OFF`；未重复提交已成功的段 | `PASS` |
| T07 | Doubao 显式旁白对照 | 仅在操作者明确选择 Doubao 时执行；沿用已登记 voice/profile，不改变 native 默认 owner；本轮 1 次显式 Runtime 调用 | `POST /internal/v1/media/narration` 返回 200；`audio/mpeg`，221,532 bytes，SHA-256 `084e6b3e…24f342`，`ffprobe` 11.064s / MP3 24kHz mono；voice `zh_female_meilinvyou_uranus_bigtts`、resource `seed-tts-2.0`；未选择 Doubao 时未调用；用户已确认人工听感验收通过 | `PASS` |
| T08 | BGM/字幕/参考图边界 | 只复用现有 `TEXT`/`FIRST_FRAME`/`REFERENCE_SET` 参考类型、`MUSIC`/`OFF` 音乐策略和已核对字幕事实；不开新 Provider 提交 | 既有 fixture：media-runtime-client `25/25`、Control API Pixabay/production routes `12/12`、Studio project-flow `24/24`；T05 真实产物验证 `REFERENCE_SET` + `MUSIC/OFF` + `caption_policy=OFF`，T08 真实保险 AI 4 图 + `MUSIC` + `caption_policy=REQUIRED` 产物验证 `music_applied=true`、字幕 CHECKED/expected/present/captions_present 均为 true、Composition QC PASS | `PASS` |
| T09 | 重启/重复/失败恢复 | 在已取得 provider request ID 后重启 Worker，或模拟下载/QC/计费失败；同一命令的重复点击只验证幂等恢复；本轮不追加 Provider 提交 | 既有 Task Worker recovery `24/24`，加上本轮唯一真实 request 的持久化→Task Worker 停止→同栈重启→`recovery.completed recovered=1`→成功产物；同一 `provider_attempt`/request 仍各 1 条、无第二次 POST。上游逐请求 HTTP 方法计数不可见，保留该证据边界 | `ACCEPTED（窄片）` |
| T10 | 人工质量验收 | 用户明确决定不将中文口音、断句、停顿、语速、情绪、音画匹配、样音审批和最终听感作为本轮验收门；既有试听记录只保留历史证据 | 不再要求 Mock/静态测试替代人工判断，也不因缺少人工证据阻断技术收口 | `OUT_OF_SCOPE/DEFERRED` |
| T11 | 独立审计与发布门 | 复核请求 ID、产物事实、日志脱敏、文档账本和未完成边界 | 独立审计只能给出“符合/不符合/证据不足”及是否允许提交 `READY_FOR_AUDIT→ACCEPTED` 的意见；正式账本、Git、VPS/发布状态不由清单自动修改，未通过保持 BLOCKED | `PENDING` |

## 3. 每次真实调用必须登记的最小事实

- profile/model、模式、目标时长/分辨率/比例、参考素材数量与角色；
- task/run/attempt 的内部 ID；Provider request ID 原值只在受控内部 `ProviderAttempt` 数据库记录保存，证据/日志/文档/公开 DTO 只保存脱敏 hash；
- submit 次数、poll/recovery 次数、最终状态；
- 下载 MIME、字节数、SHA-256、ffprobe 时长/音轨；
- NarrationAsset/TimelinePlan/section window 是否实际存在并被 Compose 消费；
- BGM、字幕、参考图、native/Doubao owner 的最终事实；
- 失败时的应用错误码和 retryable，不记录上游密钥或原始 payload。

### 3.1 已执行调用登记（本轮）

- `T04`：既有 REFERENCE_VISION 语义规划固定样本 3 次，3/3 返回可解析规划；不提交视频。
- `T05`：profile `aiself-grok / grok-imagine-video-1.5`，Control API 与 Task Worker 均 `VIDEO_PROVIDER=sub2api`；目标 15 秒/720P/16:9，1 张合成参考图，1 次生产提交、0 次自动重试；结果为单段成功。预算边界为本轮用户授权下的单次该 profile 调用，未发生重复提交。
- `T06`：早期一次运行在 Provider 提交前被 4096 fail-closed 阻断，后续真实多段复测已通过（见 §3.4）；`T07`：已执行 1 次显式 Doubao，产物通过格式/完整性预检但人工听感仍待验收。

### 3.3 T06 提示词冗余纠偏（离线，不改变真实调用次数）

- 历史 T06 的两份已批准 PromptPackage 分别为 5206/5125 UTF-8 bytes，且 capability snapshot 没有当前 `source_prompt/generated_prompt_parts` sidecar；因此按既有 provenance 规则只能阻断，不能从旧字符串猜测并删除内容。
- 当前编译器对同一茅山 source 的 segment-local 复现为约 3330/2952 bytes（native owner、无对象锁、相同 30 秒规划），说明“拆段后每段复制完整 source”不是确定性 compiler 的必然行为；真正需要防守的是 LLM `visual_prompt` 把整段 source/其它 segment projection 原样回灌。
- 本轮新增 fail-closed guard 和系统提示，禁止该回灌；不做截断、摘要、静默删除。最终复跑 creative-planning `83/83`、workflow-worker `38/38` 通过；本条记录当时尚未取得真实 T06 多段产物，后续真实产物见 §3.4，不能再按本条旧快照判定当前 T06。
- 随后用当前本地栈重新生成 planning revision `cbr_01M2FEPGKEPPENTH5EQ1A203TH` / storyboard `sbr_01M2FEPH0AJBF9J992AEGPY5SC`，未批准、未创建 production run：两段 PromptPackage 为 `3810/3462` bytes，sidecar source 为 `348/119` bytes；行为核对确认跨段口播和视觉 source 未互相复制，且均低于 4096。该段本身仍只是规划证据；后续真实 Provider 成片及 T06 当前对账见 §3.4。
- 受控 Mock 生产继续被既有交付门阻止：创建 production run 返回 `DELIVERY_PLAN_STATE_INVALID`，原因是旁白样音审批与 READY Timeline 尚未完成；未创建 TaskRun、未调用 Provider。该项与本轮 T06 source-local 提示词修正无关，仍保留为 E12/R01 的独立硬门。

### 3.2 独立口径复核

独立审计员已复核本清单第二次修订：request ID、来源符号、T05/T06/T07 证据和 T08/T09/T10 的 `PARTIAL/PENDING` 边界一致；未发现把 canary 误写成完整旁白验收，也未发现正式账本或 Git/VPS 自动升级。该复核只证明清单口径符合，不替代 T10 人工验收或 E12/R01 的正式 Exit Gate。

### 3.4 2026-09-14 真实多段证据更新

- T06 的旧 `PROMPT_BUDGET` 阻断记录仍作为历史失败样本保留，但不能覆盖后续真实修复后的产物事实。当前可复核的真实 30 秒/480P 茅山运行是 `prd_01M2FKWAT8FZW0EKN8BAB2DS7C`：2/2 段 `ACCEPTED`，成片 `vvr_01M2FM98E6DPZFG2PNNZXDAADX`、资产 `ast_01M2FM7XVH660XE22SR6XYXR9S`，`30.084s`、`848x480` H.264/AAC、Composition QC=`PASS`、`has_audio=true`、`unexpected_silence=false`，本轮 `music=OFF`。
- 该更新只把 T06 从 `BLOCKED` 对账为 `PASS`；T08/T09/T10 仍分别为 `PARTIAL/PARTIAL/PENDING`，因此 E12/R01 总体仍不能关闭。所有新增成片证据均来自真实 LLM/真实 Sub2API/Grok，不以 Mock 代替。

### 3.5 2026-09-14 T08 真实 BGM/字幕尝试边界

- 使用同一茅山项目、同一 `REFERENCE_SET`、已批准 `caption_policy=REQUIRED` 的 delivery plan `dpr_01M2G288MA0Y4T10VWMTSFE4CX`，并显式指定既有 MUSIC 资产 `ast_01M13FB5CXN84NEBHRQR735CSC`；未修改 Provider、字幕或音乐契约。
- 首次提交前 relay 曾因旧 Quick Tunnel 掉线而失败；重建为 `--protocol http2` 后显式重试，旧 request ID 按 C09 规则先废弃并新建 attempt。上游随后返回 `Video request not found`，符合“上游清理旧 request 后显式重试”的既有恢复路径，但本次重试又收到 `Concurrency limit exceeded for account, please retry later`，未获得视频产物。
- 数据库事实：production `prd_01M2G28RHSQG33B9W0MFJRBR9G` 保持 `BLOCKED`，失败段 task/attempt 均未发布资产；没有把本次失败归因于 BGM、字幕或参考图参数。T08 仍为 `PARTIAL`，待上游并发槽位可用后再执行一次有界真实复测；不新增自动重试或并发阈值。

### 3.6 2026-09-14 T08 真实 BGM + REQUIRED 字幕复测（技术证据通过）

- 使用同一“保险AI介绍”项目的已批准 4 图 `REFERENCE_SET` 与既有 source/storyboard，创建新的 `caption_policy=REQUIRED`、`voice_mode=PLATFORM_GENERIC` delivery plan，并显式指定工作区现有 `MUSIC` 资产；未启用 Mock，未改公开契约或 Provider 参数。
- 真实生产 `prd_01M2G8YQGVCSFZX4QM377AD4PF` 的 3/3 段均 `ACCEPTED`，最终版本 `vvr_01M2G99G6X0688C5C0YF7EFF4N`、资产 `ast_01M2G985188GPE7DCJDM0PYZ9Z`；总时长 `30.126s`，产物 `6,644,642` bytes，`848x480` H.264/AAC，48kHz 双声道。
- Composition QC=`PASS`；数据库 QC 事实为 `music_applied=true`、`subtitle_check.status=CHECKED`、`subtitles_expected=true`、`subtitles_present=true`、`technical_probe.captions_present=true`、`unexpected_silence=false`。下载产物保存在 `.codex-longrun/local-acceptance/real-t08-insurance-bgm-caption-20260914.mp4`。
- 结论：BGM 选择、字幕 REQUIRED 传播、参考图、真实 Provider 生成、下载和合成闭环均有客观证据，T08 更新为技术 `PASS`。这不替代人工听感，也不关闭 T09 的真实重启恢复或 T01/T04/T07/T11 的正式边界；E12/R01 仍保持 `BLOCKED`。

### 3.7 2026-09-15 字幕抑制与生产侧车回归（技术证据，不升级状态）

- Provider prompt compiler、creative-planning 与 Sub2API mapper 统一写入固定来源约束“全程无字幕；no subtitles, no captions。字幕只在后期统一添加。”；带 `audio_owner` 的真实快照缺少该约束时在提交前以既有 `PROMPT_BUDGET`/协议错误 fail-closed，历史无 `audio_owner` 快照保持兼容读取。
- 本地定向测试：provider-video `70/70`、creative-planning `85/85`、workflow-worker `38/38`、production-worker `72/72`；本地 PostgreSQL persistence 全套 `84/84`，包含 PromptPackage 侧车写入/读取、二段依赖调度、生产快照和提示词预算阻断；typecheck 与 `git diff --check` 通过，0 skip。
- 真实本地 Sub2API/Grok canary 在重启后的全栈上成功：`prd_01M2HFQKB1DSVKGRF7EV6VP354`，`vvr_01M2HFV8Q6QG9DHS68PJTXEETQ`，`ast_01M2HFTDBZMCFTY8S59NV995JJ`，`15.042s`、`1,703,485` bytes；此前同一代码切片的真实字幕抑制产物 `real-caption-suppression-canary.mp4` 经 ffprobe 确认只有 H.264/AAC，无字幕流，抽帧未见 Provider 字幕。
- 该条只关闭“Provider 原生字幕与后期字幕重复”的技术缺口；用户已确认 T10 人工质量通过。T09 Worker 真实重启/重复产物、T01/T04/T07 的已选 profile 来源/稳定性边界、T11 独立审计及完整 NarrationAsset/TimelinePlan/AudioPlan/section windows/复杂转场仍为未闭合硬门。统一 registry/rank 不属于当前要求。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。

### 3.8 2026-09-15 全仓回归与人工验收对账（技术通过，正式状态不升级）

- 在业务 Worker 停止、PostgreSQL/Redis/MinIO 保持运行的隔离条件下执行根 `pnpm test`：18 个工作区包合计 `687 pass / 0 fail / 7 skip`。7 个 skip 均为已有的 MinIO/BullMQ 集成环境门禁，不是失败或静默通过。Control API `82/82`、production-worker `72/72`、task-worker `48/53`（5 个 BullMQ 集成 skip）、persistence `84/84` 均可复核。
- 本轮唯一代码测试纠偏是更新 `apps/control-api/tests/c06-task-routes.test.ts` 的旧提示词精确断言，使其验证原始描述前缀与新增字幕抑制约束，而不否认已批准的编译结果；没有改变公开契约、状态机或 Provider 协议。全仓 typecheck 与 `git diff --check` 通过。
- 本地全栈已重启，Control API/Studio health 均返回 `200`；未新增真实 Provider 调用。用户已确认人工质量验收通过，因此 T07/T10 不再因人工试听待定。
- 结论：自动化技术回归与当前人工质量证据通过；这不关闭 T09 的真实 Worker request-id 重启/重复产物证据、T01/T04 的完整 owner/profile/LLM 稳定性审计、T11 独立账本对账，以及 Runtime 仍明确拒绝的 approved full narration section windows、完整 AudioPlan/非 cut 连续旁白和混合转场边界。故 `E12/R01` 继续 `BLOCKED`、总体 `C12.4/C12.5` 继续 `IMPLEMENTED_PENDING_AUDIT`。

### 3.9 2026-09-15 E12/R01 Piper 收口与真实 canary 对账（不升级状态）

- `services/media-runtime/runtime.py` 的显式 `PIPER_PYTHON_PATH` 现在先探测绑定解释器的 `piper` 模块；探测失败不回退同目录或 PATH 可执行文件；未显式绑定时保留受控本地 Runtime 的既有优先级。对应回归只修改 Runtime 与其测试。
- Media Runtime 全量 unittest=`147/147 pass / 0 fail / 0 skip`；`py_compile runtime.py main.py`、`git diff --check` 通过。此前根工作区回归仍为 `687/0/7`，skip 保持原环境门禁口径。
- 本地真实 Sub2API/Grok canary 仅执行一次：`prd_01M2HJ8D7VYHQG6XMY9CRSD1J2`、`vvr_01M2HJCB7X5DD5D89RXD8APP0V`、`ast_01M2HJB8B03NTNYGWM6GJSJCPR`，`15.042s`、`1,405,221` bytes；Control API/数据库健康，未调用其他 Provider/TTS/Veyra/VPS。
- 该 canary 条目当时没有在 request-id 持久化后重启 Task Worker，仅作为当时的中间快照；T09 后续现场恢复证据见 §3.10。单一 full-track 跨多个 section window、连续旁白跨 non-cut/混合转场、未被实际启用 profile 支持的 owner 语义、LLM 通用稳定性及完整正式资产跨层证据继续保持 `BLOCKED/DEFERRED`；统一 registry/rank 维持 `DEFERRED`。

### 3.10 2026-09-15 T09 现场恢复复测（窄片 ACCEPTED，不升级总体状态）

- 唯一真实任务 `tsk_01M2HKM02GF98JK47CR1SXSWFP` 先持久化 request，再停止旧 Task Worker；随后使用同一本地栈脚本启动新 Task Worker（PID=`10456`），没有新增 Provider POST。
- Worker 启动日志出现 `task_worker.recovery.completed`（`recovered=1, failed=0`）。任务最终 `SUCCEEDED`，结果资产 `ast_01M2HKZ2JS51RWH6EWB27VKQ3J`，`video/mp4`、`3,333,783` bytes、SHA-256 前缀 `9c059c2713118e6ed58e`。
- 对应 `provider_attempts` 保持一条 attempt、一条 distinct request、最终 `SUCCEEDED`；数据库只见一条 `provider_attempt.submitted` 事件，未见重复 attempt/产物。现有 Worker 分支在已有 request-id 时只走状态查询/下载。
- 独立审计将 T09 现场恢复窄片判为 `ACCEPTED`。由于当前日志/数据库不记录上游逐请求 HTTP 方法计数，不能声称已取得代理层 GET/POST 抓包；这不影响“不重复提交”的数据库与代码证据。
- （早期 T09 快照，已由 §3.11 的隔离复跑 supersede）本轮当时 provider-video `70/70`、creative-planning `85/85`、workflow-worker `38/38`、production-worker `72/72`、persistence `72 pass / 12 skip / 0 fail`（普通命令未设置 `DATABASE_URL`）；根 `pnpm test` 为 `672 pass / 20 skip / 0 fail`。skip 保留为环境门禁；当前正式对账采用 §3.11 的 `84/84` DB 与 `687/0/7` 隔离根回归。

### 3.11 2026-09-15 PostgreSQL 隔离复跑与 Worker 竞争边界（技术证据，不升级状态）

- 为排除业务 Worker 竞争领取共享 outbox 测试事件的影响，停止四个业务 Worker，仅保留 PostgreSQL/Redis/MinIO，执行 `$env:DATABASE_URL='postgresql://video_local:video_local@127.0.0.1:15432/video_local'; pnpm --filter @alchemy-video/persistence test`：`84 pass / 0 fail / 0 skip`。该运行覆盖 PromptPackage 侧车 JSONB 写入/读取、二段调度、生产快照、提示词预算阻断和错误分类；另行隔离的 C12/TaskRun 集成均通过。
- 根 `pnpm test` 在业务 Worker 停止时的最新可复核汇总仍为 `687 pass / 0 fail / 7 skip`；7 个 skip 是既有 MinIO/BullMQ 环境门禁，不能改写成行为通过。全栈恢复后 Control API、Media Runtime、Studio readiness 均返回 HTTP `200`。
- 复核发现 `ProductionOutboxRelay` 与 `TaskOutboxRelay` 在未提供 workspace 过滤时会领取共享测试数据库中的全部生产事件；因此业务 Worker 与 persistence 集成并行运行可能造成事件被提前消费，表现为偶发恢复/二段断言失败。这是测试隔离边界，不是生产状态机或数据模型缺陷；后续 DB 集成证据必须在 Worker 停止或独立数据库/队列下取得。
- `createDefaultProductionTaskRunInputSnapshot` 仍是 Mock 兼容工厂，故不把内部 `sourcePrompt/generatedPromptParts` 侧车写入公开 `VideoGenerationInputSnapshot`；真实 Control API/Production Worker 使用注入的 provider runtime factory 传递侧车。该边界保持不变，不新增公共契约字段。
- 本条只更新 T03 证据和测试条件；T11 独立账本、完整 NarrationAsset/TimelinePlan/AudioPlan/section windows、full-track 多 section、连续旁白 non-cut/混合转场仍未闭合。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。

## 3.12 本轮逐项执行顺序与停止门（2026-09-15）

本节把本轮验证计划固化为唯一执行清单。每项完成后才进入下一项；出现 `BLOCKED`、`不符合` 或关键 `证据不足` 时立即停止后续真实调用，保留当前结果并向用户报告，不通过改代码、降低标准或重复 Provider 调用“绿化”。

| 顺序 | 项目 | 实际验证方法 | 必须保存的证据 | 通过条件 | 当前门 |
|---|---|---|---|---|---|
| 0 | T00 环境基线 | 检查 Docker、PostgreSQL、Redis、MinIO、Control API、Media Runtime、Studio readiness；真实模式只允许显式启动 | 时间、健康 HTTP 状态、Provider 模式、数据库地址是否为测试库 | 全部健康；无隐式真实 Provider/TTS/Veyra | `PASS`（已复核） |
| 1 | T03 DB/sidecar 基线 | 停止业务 Worker，显式 `DATABASE_URL` 跑 persistence 全套；随后恢复本地栈 | 命令、退出码、88/88 计数、sidecar JSONB→scheduler→factory→snapshot 事实 | `88/88`、0 skip；不得与 Worker 共享 outbox 竞争 | `PASS`（隔离证据） |
| 2 | T01 已选 Provider/Profile/owner | 只读对照实际启用 profile 的固定 commit 具体符号、Runtime/Worker owner；未知 profile 必须阻断；不建立统一 registry/rank | 来源路径/符号、选定 profile 的能力快照和 fail-closed 结果 | 只能接受来源可证明的已选 profile；统一 registry/rank 不作为通过条件 | `DEFERRED（统一 registry/rank）；选定 profile 按需复核` |
| 3 | NarrationAsset/TimelinePlan/section windows | 使用现有自动生成 native/Doubao 音频，不引入用户上传；写入正式资产、TimelinePlan 和独立 section window，经 DB→scheduler→compose | asset/version/section/window identity、Compose 消费记录、失败边界；persistence 88/88 + independent section fixture 14/14 | 每个 PRIMARY section 身份/窗口精确消费；越界、未批准、跨 workspace fail-closed | `READY_FOR_AUDIT` |
| 4 | AudioPlan/转场 | 只验证 ALCHMED8 已有 identity、start/gain/fade 及 CUT/BLEND/BRIDGE；用 fixture 验证不支持边界 | 输入 AudioPlan、Runtime 轨道和拒绝样例；来源支持的独立 section 轨道通过 | full-track 跨多 section、non-cut 连续旁白、复杂 xfade/变速/补静音保持 `OUT_OF_SCOPE/DEFERRED` 并 fail-closed | `READY_FOR_AUDIT（窄片）` |
| 5 | T04 LLM 规划 | 固定样本做 3 次受控规划调用，不提交视频；使用现有解析器/Schema 验证 | 模型/profile、响应 hash、解析包、对白/换行/参考顺序差异 | 硬事实稳定且逐字保真；不要求自由 prose 字节相同；失败必须 fail-closed | `PARTIAL`；出现不稳定即停 |
| 6 | T11 真实账本 | 仅在用户明确授权真实计费环境后执行一次成功、一次失败/不可发布和一次幂等重放核对 | task/attempt、Sub2API usage、Video OS UsageRecord、扣费 key/replayed | 成功恰扣一次；失败不扣；重放不重复；否则停在 T11 | `PENDING`（本地计费关闭） |
| 7 | 固定真实成片复测 | 仅前置门通过后，复用茅山 30s/480P 固定样本，最多一次新 Provider 运行 | 脱敏 request、段数、产物 SHA/ffprobe、音轨/BGM/字幕/QC、人工验收 | 全链路事实一致；不把一次成片扩展为通用稳定性 | `DEFERRED` |
| 8 | 独立审计/收口 | 冻结版本，由独立审计对照本清单、状态和章节记录 | 审计结论、未完成项、状态账本 | 只有全部必需证据 `ACCEPTED` 才能讨论状态升级 | `PENDING` |

本轮已从第 0 项开始；T00 已通过，T03 已有隔离通过证据。统一 registry/rank 已按范围决策移出活动门；后续只在实际选定 provider/profile 时复核其来源能力。NarrationAsset/TimelinePlan、AudioPlan、LLM 和账本仍按各自证据门执行，不因该范围调整而自动通过。

### 3.13 2026-09-15 T01 停止记录（历史快照，已被范围决策覆盖）

- 独立纠察只读复核确认：`services/media-runtime/adapters/openmontage_audio/selector.py:21-29` 只提供显式 `piper/piper_tts`、`doubao/doubao_tts` 的薄路由；`packages/provider-video/src/runtime-profile.ts:229-231` 只登记 `audioOwner=NATIVE_PROVIDER`，没有统一跨 Provider profile registry。
- `selector.py:5-8,15-19` 的 `auto`、空值和 unknown 继续 fail-closed。该事实保留为运行边界，但“先建立统一 registry/rank 才能继续”已被 2026-09-15 范围决策 supersede。
- 既有测试和 native/Doubao smoke 只能证明已选固定链路与产物格式，不能替代该 profile 自身的正式 NarrationAsset/TimelinePlan、approved section windows 或人工中文听感证据。
- 历史结论：当时 T01=`PARTIAL/BLOCKED` 并停止后续调用；当前不再把统一 registry/rank 作为活动阻断，正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 仍保持原值。

## 3.14 2026-09-15 离线产物 Provider 溯源修正（技术证据，不升级状态）

- 发现并修正一处不依赖外部服务的内部溯源缺口：`TaskRunStore.ensureGeneratedAsset` 原先把生成视频资产私有 metadata 的 `generated_by` 固定写为 `mock`；现在由已持久化的 `ProviderAttempt.provider` 原样传入 PostgreSQL 与 Control API 内存实现。公共序列化器仍不暴露该私有字段，未改变 API、事件、状态机或 Provider 协议。
- 行为证据：task-worker `49 pass / 5 existing BullMQ skips / 0 fail`（含非 mock provider provenance 回归）；Control API `82 pass / 1 existing service-gated skip / 0 fail`；persistence `74 pass / 12 existing DATABASE_URL skips / 0 fail`；全工作区 typecheck 通过，state JSON 与 `git diff --check` 通过。全部为本地代码/夹具/服务验证，无新 Provider/TTS/Veyra/网络/VPS/Git 调用。
- 该修正只关闭资产私有 provenance mismatch；T01 已选 profile 的来源/能力证据、正式 NarrationAsset/TimelinePlan/section windows、完整 AudioPlan/复杂转场、LLM 通用稳定性和 T11 真实计费仍保持 `PARTIAL/BLOCKED/PENDING`。统一 registry/rank 按范围决策为 `DEFERRED`。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。

## 4. 通过口径

单项通过不等于整体通过。人工听感/口音/停顿/音画匹配/样音审批，以及固定来源未定义的 full-track 跨 section、non-cut 连续旁白、复杂 xfade、自动变速/补静音/重新切片等，已明确移出本清单验收门，统一记为 `OUT_OF_SCOPE/DEFERRED`，不再要求通过，也不以 Mock 或静态测试替代它们。

当前仍需证据的技术/外部门仅包括：实际启用 profile 的来源与 owner 对账、代码和数据库行为、Worker 重启/幂等、正式资产与 section window 的跨层事实，以及在用户授权并部署到 VPS 后的 Veyra/共享积分账本联调。统一 registry/rank 不属于通过条件。任何仍在范围内的门缺证据都保持 `BLOCKED`，不得用一次成功 canary、静态源码命中或 Mock 绿测替代。

Veyra/共享积分不是本地代码门：本地只能验证 adapter、错误映射和幂等分支；真实扣费、成功后扣费、失败不扣费和 `replayed` 对账必须在 VPS 的真实 AISelf/Sub2API 环境完成。该项可作为下一阶段受控部署验证，不代表当前代码状态已 `ACCEPTED`。

## 2026-09-15 本地旁白 section window 溢出一致性修正（技术证据，不升级状态）

- `packages/persistence/src/narration-quality-repository.ts` 的 InMemory/Drizzle TimelinePlan 创建与 READY 检查现在拒绝 `measured narration duration > PRIMARY section window`；这是与 `approved-narration-timeline.ts` 既有 OpenMontage 窗口规则的边界对齐，原有测量容差保持不变，没有新增时长算法、公开字段或 Provider 行为。
- 定向 C12.7B 测试覆盖：超出 section window 但仍落在旧容差内的正式资产在创建阶段 fail-closed；同一 section 形态在 READY 检查阶段也 fail-closed。`pnpm --filter @alchemy-video/persistence test`=`74 pass / 0 fail / 12 existing DATABASE_URL skips`；`pnpm --filter @alchemy-video/persistence typecheck`通过。
- 本项仅关闭本地 persistence 的 section-window overflow 不一致；完整 NarrationAsset/TimelinePlan 跨层证据、full-track 多 section、AudioPlan/复杂转场、T01 已选 profile 的来源能力证据、T11 真实账本仍未闭合。统一 registry/profile certification 不属于当前要求。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 保持不变；本轮未调用真实 Provider/TTS/Veyra/网络/VPS/Git。

## 2026-09-15 本地旁白资产事实一致性修正（技术证据，不升级状态）

- InMemory/Drizzle `hasReadyTimelinePlan` 现在会校验 READY AUDIO 资产的实测 `durationMs` 与正式 `NarrationAssetVersion.durationMs` 一致；依据是同一 persistence 包内 `approved-narration-timeline.ts` 的既有严格资产事实校验。TimelinePlan 创建阶段原有测量容差未改变。
- 新增回归覆盖资产元数据时长漂移；persistence 全套=`74 pass / 0 fail / 12 existing DATABASE_URL skips`，workspace typecheck 通过。Drizzle 数据库行为仍因未设置 `DATABASE_URL` 保留 skip，代码已通过类型检查。
- 本项只关闭 READY 资产事实漂移，不代表正式 NarrationAsset/TimelinePlan 跨层、完整 AudioPlan、Provider/profile 认证或 T11 真实账本完成。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变；无真实外部调用。

## 2026-09-15 统一 registry/profile 范围决策（当前口径覆盖历史 T01 停止记录）

- 不建立跨 Provider 的统一 source registry、排序表或通用 profile certification。固定来源没有对应的统一实现，新增它会形成平台自造的平行逻辑，因此该项从当前活动硬门移除，状态为 `DEFERRED`，不是 `ACCEPTED`。
- 实际启用的 Provider/profile 仍需按自己的固定来源符号、现有 adapter 和能力快照逐个核对；只有明确选择且能证明来源语义的 profile 才能运行。`auto`、空值和未知 profile 继续 `UNAVAILABLE/BLOCKED`，不增加隐式选择或自动回退。
- 该决定只调整范围和审计口径，不修改代码、公开契约、状态机、Provider 协议或计费语义。旧 T01 停止记录保留为历史证据；正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。

## 2026-09-15 用户明确排除项与本轮技术收口

以下不再作为当前清单的验收门：中文口音、断句、停顿、语速、情绪、音画听感、样音人工审批和最终人工质量；单一 full-track 跨 section 自动偏移、non-cut 连续旁白、任意复杂 xfade、自动变速/补静音/重新切片，以及固定来源未定义的通用音频算法。统一状态为 `OUT_OF_SCOPE/DEFERRED`，现有不支持路径继续 fail-closed，不新增替代算法。

本轮已补齐并验证的可执行技术窄片：

- `approved-narration-timeline.ts` 与 `narration-quality-repository.ts` 的 InMemory/Drizzle 资产身份、实测时长、PRIMARY section window 和重复底层 AUDIO identity 校验；
- TTS-owner 独立 section 正向 composition fixture：`production-repository.native-audio.test.ts` `14/14`；
- 隔离 PostgreSQL persistence 全套 `88/88 pass / 0 fail / 0 skip`，以及 production-worker `72/72`、workflow-worker `38/38`、Media Runtime `147/147`、workspace typecheck；
- ALCHMED8 的既有 identity/start/gain/fade 与 CUT/BLEND/BRIDGE 窄转场证据。
- `narration_asset_version_id` 由 Control/Worker 在 Runtime 前完成关系核对；ALCHMED8 wire 只发送来源已有的 section/asset/window/track 字段，版本 ID 不作为 Runtime 二进制字段。
- 当前证据是各层局部行为组合；尚无一条独立真实正式资产从 PostgreSQL→scheduler→factory→Runtime→Compose 的端到端行为测试，因此本窄片只能提交 `READY_FOR_AUDIT` 候选，不能宣称 `ACCEPTED`。

因此 T03 已为 `PASS`，T10 按用户决定 `OUT_OF_SCOPE/DEFERRED`，正式 section 资产/TimelinePlan 窄片与来源 AudioPlan 窄片可提交 `READY_FOR_AUDIT`。这不自动修改 E12/R01 或 C12.4/C12.5 总账；独立审计仍需确认账本一致性。未调用新的 Provider/TTS/Veyra/VPS/Git。

## 2026-09-16 最新验收范围与回归计数对账

- 按用户最新指令，中文口音、断句、停顿、语速、情绪、音画听感、样音审批，以及固定来源没有定义的通用复杂音频算法，不再作为本轮考核项；它们记为 `OUT_OF_SCOPE/DEFERRED`，现有不支持路径继续 fail-closed，不把“直接放行”写成代码能力已验收。
- 本轮其余可本地闭合项沿用同一版本的最新证据：根回归 `718 pass / 20 skip / 0 fail`，domain `70/70`、creative-planning `95/95`、workflow-worker `38/38`、provider-video `70/70`、production-worker `72/72`、task-worker `53 pass / 5 existing infrastructure skip / 0 fail`；隔离 PostgreSQL persistence `91/91`，生产仓储集成 `4/4`。所有结果为 fixture/mock 或隔离本地数据库，无新增真实 Provider/TTS/Veyra/网络/VPS/Git 调用。
- 未被本轮排除的证据边界仍保持原值：正式 `NarrationAsset/TimelinePlan` 的单条全链路 Compose 行为证据、外部 T11 账本、未逐个来源核验的未来 profile、OpenMontage 无法表达的 full-track 跨 section/非 cut 组合，继续 `BLOCKED/DEFERRED`；正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。
