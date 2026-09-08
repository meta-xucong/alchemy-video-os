# AI 企业内容生产平台：第三方来源与复用登记

当前映射基线：`AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md`

> 本登记保留四个来源的固定版本、历史复用记录和已有证据。自 2026-08-30 起，源仓库能力是否已对应到平台、多个来源之间的冲突裁定以及逐项验收状态，以新的多源迁移矩阵为准；本文件中的概览或历史快照不能单独证明完整迁移，也不能授权新增代码或外部调用。

> **2026-09-01 语音路线专项对账（SUPERSEDED）**：登记中把 Piper/`PLATFORM_NARRATION` 当作所有新任务默认 spoken owner、或把 Provider dialogue 一概移除的旧文字，已由《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》覆盖。当前自动旁白不要求用户上传音频/样音；样音由服务端 native Provider 或显式 Doubao 生成并经人工审批，通用图片/资料/MUSIC 上传仍保留。该文档只裁定来源语义，不代表代码已修复或任何状态升级；本登记的 source commit、历史证据、未授权和 `BLOCKED` 结论继续有效。

> **2026-09-01 当前操作模式（ACTIVE）**：本机已获授权使用 Aiself Grok 原生音频优先和显式 Doubao TTS（`seed-tts-2.0` / `zh_female_meilinvyou_uranus_bigtts`）进行实际茅山项目对照。该授权不要求、也不引入用户上传旁白/样音；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 仅为兼容/隔离角色。仓库模板、CI 和无授权环境仍保持 `VIDEO_PROVIDER=mock`；真实凭据不写入登记、代码、fixture、日志或状态。

## 1. 使用规则

当前项目是学习和本地研究用途。按照用户要求，开发阶段不因许可证问题阻塞源码复用；但所有复用必须保留来源、固定版本、迁入路径、改动原因和回归测试。未来如果公开发布或商用，必须单独进行许可证和分发审查。

`upstream/` 是仅供本机溯源和摘取的固定 commit 克隆目录，必须保持在平台 Git 之外。迁入时只能将经过审计的文件或符号复制到明确的 adapter、runtime、skill 或 fixture 目标模块；禁止复制后丢失来源，也禁止把 `upstream/` 作为 subtree、submodule、gitlink 或完整快照纳入平台仓库。

### 1.1 原仓库优先与薄壳适配硬规则

本登记同时承担底层复用规则的证据职责：

- 只要固定 commit 已有对应代码、字段、参数、校验或流程，优先直接移植，或保持与原实现等价的调用顺序；平台只增加必要的输入/输出、权限、workspace、对象存储、错误归一化、幂等和脱敏薄壳。
- 不得在来源能力之上自行创造平行算法、阈值、协议、自动改写、静默回退或 UI 语义。修改和删减必须指向具体来源文件/符号/规则，并写明原因和行为测试。
- 来源没有安全对应实现、能力尚未认证或语义无法证明时，保持禁用、等待或 fail-closed；不能用“兼容”“优化”替代来源证据。
- 平台自己的 Control API、领域模型、持久化、队列、工作区隔离和审计边界可以保留，但不得改变来源媒体/内容逻辑的含义。
- 内存实现、数据库实现、Runtime、兼容读取器和 fixture 必须共享同一来源语义；上游已有实现时不得另写第二套等效逻辑。

每次登记必须回答“移植了什么、薄壳改了什么、删减了什么、为什么删减、如何证明行为未漂移”；没有这些字段的改动不得进入当前章节。

## 2. 参考仓库基线

| 来源 | 固定基线 | 复用范围 | 不复用范围 | 目标模块 |
| --- | --- | --- | --- | --- |
| [Seedance-2.5](https://github.com/allenGKC/Seedance-2.5) | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | Skill、capabilities、prompting、references、校验思路 | 个人助手安装脚本、个人 UI 假设、未验证 API 参数 | `packages/seedance-skill` |
| [markitdown](https://github.com/microsoft/markitdown) | `fd239d5d2be43d9b68329730206b9312c7d5a388` | converter、`MarkItDown`、`convert_stream`、`StreamInfo` | 用户 URL 直连、无边界插件、直接充当知识库 | `services/document-runtime` |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `BaseTool`、`ToolResult`、`ToolRegistry`、Artifact schema、媒体/QC 工具 | 自由 Agent 全局编排、Backlot 事实源、全部 Provider | `services/media-runtime` |
| [huobao-drama](https://github.com/chatfire-AI/huobao-drama) | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | Nuxt、Hono、Drizzle、页面组件、媒体预览、Provider adapter、生成字段 | 短剧业务模型、进程内无限轮询、纯本地磁盘、Key 页面 | `apps/studio-web`、`apps/control-api`、`workers/provider-worker` |
| [sub2api-video-mcp](https://github.com/meta-xucong/sub2api-video-mcp) | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | 视频三段式协议、字段、轮询、下载、MCP 工具命名 | MCP 进程内状态作为平台任务事实 | `packages/provider-adapters/sub2api` |

## 3. C01 本机快照审计

本表只覆盖用户指定的四个 GitHub 仓库。C01 未拉取或读取 `sub2api-video-mcp`，它仍是后续 C07 的独立协议参考。

| 来源 | URL | 固定 commit / HEAD | 本机目录 | 状态 | 许可证提示 |
| --- | --- | --- | --- | --- | --- |
| Seedance-2.5 | `https://github.com/allenGKC/Seedance-2.5.git` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：MIT |
| markitdown | `https://github.com/microsoft/markitdown.git` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：MIT |
| OpenMontage | `https://github.com/calesthio/OpenMontage.git` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：GNU AGPL v3 |
| huobao-drama | `https://github.com/chatfire-AI/huobao-drama.git` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` | detached HEAD、clean、与固定 commit 一致 | 未发现根 `LICENSE`；`backend/package.json` 声明 ISC |

审计命令确认 `.gitignore` 的 `upstream/` 规则命中，且 `git ls-files --stage -- upstream` 输出为空。上游快照永远不进入平台 Git 索引；复用矩阵、文件级符号、测试位置和不可复用原因见《AI企业内容生产平台_C01上游复用矩阵.md》。

## 4. 本地代码事实参考

| 来源位置 | 参考内容 | 复用限制 |
| --- | --- | --- |
| `D:\AI\SSH\sub2api` | Veyra routes、ticket、account、atomic debit、idempotency fingerprint | 不复制用户/余额表和账本；只实现 HTTP adapter |
| `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0` | `VeyraSub2APIClient`、billing rules、generation 成功后扣费、usage receipt | 不复制自签 session、JSONL 账本、图片固定费率和单体状态 |

## 5. 迁入登记模板

每次从上游迁入代码或重要变量时，新增记录：

```text
来源仓库：
来源 commit/tag：
本地目标路径：
迁入文件/符号：
保留的变量/类型：
平台改动：
舍弃原因：
适配器边界：
回归测试命令：
审计日期：
```

## 6. 来源完整性检查

- [ ] 目标模块存在 `UPSTREAM.md` 或等效登记。
- [ ] 来源 commit/tag 可复现。
- [ ] 迁入代码没有把外部全局状态带进 Domain。
- [ ] 复用的变量字段有 mapper 或 serializer 边界。
- [ ] 上游升级必须重新跑回归测试并更新登记，不允许无记录覆盖。

## 7. C06 复用登记

| 来源仓库 | 固定 commit | 本地目标路径 | 迁入/借鉴符号 | 平台改动与舍弃原因 | 回归测试 |
| --- | --- | --- | --- | --- |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/media-validator.ts` | `backend/src/utils/ffmpeg.ts` 的 `probeBinary` / `checkFfmpegSuite` 思路 | 采用静态工具先探测、失败关闭；改为独立验证端口，舍弃 `fluent-ffmpeg`、全局路径配置、静态媒体处理与本地业务状态。 | provider/media 单测、C06 MinIO/Worker E2E |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/port.ts`、`apps/task-worker/src/execution-service.ts` | `backend/src/services/adapters/types.ts` 的 `VideoGenerationRecord` / `VideoProviderAdapter` 字段意图，`generation.ts` 的 submit/poll 职责切分 | 保留 `model`、`prompt`、提交/查询/下载阶段；改为平台 `VideoProviderPort`、持久化 ProviderAttempt 与 workspace-scoped TaskRun。舍弃直接 Provider HTTP、MySQL、进程内轮询、配置/密钥读取。 | Mock 无网络、重启恢复、公开脱敏测试 |

`AI企业内容生产平台_C06上游复用矩阵.md` 是本章逐文件和测试位置的完整记录。任何 C06 实际迁入的代码会在目标模块 `UPSTREAM.md` 追加修改点。

## 8. C07 复用登记

| 来源仓库 | 固定 commit | 本地目标路径 | 迁入/借鉴符号 | 平台改动与舍弃原因 | 回归测试 |
| --- | --- | --- | --- | --- | --- |
| sub2api-video-mcp | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | `packages/provider-video/src/sub2api/{adapter,capabilities,errors,mapper,transport}.ts` | 视频协议路径 `POST /videos/generations`、`GET /videos/{id}`、`GET /videos/{id}/content`；`model`、`prompt`、`duration`、`resolution`、`ratio`、`image.image_url`、`id`/`request_id`、`status`/`state` 字段语义、下载 Content-Type/Content-Length 传播，以及 disabled profile/snapshot 边界 | 仅按文档化协议做 injected transport 的离线薄适配和内部 disabled registry/snapshot；未迁入 MCP server、工具注册、进程内轮询、HTTP 客户端、环境 Key、公开模型列表、认证或任何任务事实。真实 transport 与 profile 认证留给 C08。 | CONTRACT-001 至 008、metadata/invalid MIME/404 断言、registry disabled/no-public-list assertions、global-fetch guard、无网络 fake transport |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/sub2api/` | `backend/src/services/adapters/types.ts` 的 `VideoGenerationRecord` / `VideoProviderAdapter` 适配职责；`backend/src/services/generation.ts` 的 submit/poll 阶段划分 | 只借鉴 adapter 边界，复用平台既有 `VideoProviderPort`；下载 metadata 与 typed failure 是平台内部薄适配；舍弃 `AIConfig`、MySQL、全局 registry、直接 Provider HTTP、定时器、短剧业务与密钥配置。 | `sub2api-*.test.ts` 22/22、task-worker C07 cross-package 5 cases、typecheck |

`AI企业内容生产平台_C07上游复用矩阵.md` 是 C07 的逐文件实施与审计记录。C07 未从 `upstream/` 复制源码；该目录仍只供本机溯源且不得进入 Git 索引。

## 9. C08 认证准备来源登记

| 来源 | 固定 commit | C08 使用方式 | 不可直接当作事实的内容 | 认证前回归 |
| --- | --- | --- | --- | --- |
| sub2api-video-mcp | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | 三段式路径、`model`/`prompt`/`duration`/`resolution`/`ratio`/`image.image_url` 字段和轮询节奏的待认证协议假设 | 实际 model ID、账号可用范围、状态字段、下载响应 headers、计费与线路可用性；它们只能由 C08 受控 live evidence 确认 | C07 `CONTRACT-001` 至 `CONTRACT-008`、metadata 与 typed failure 跨包回归 |
| 平台 C07 adapter 与合成 fixtures | `c07-accepted^{}` = `41d414cf1b6767c39f251445278831328e1620cf` | 作为无网络 mapper、脱敏和恢复不重提的基线 | 任何 fixture response、disabled capability snapshot 或候选 Grok 名称都不是已认证 profile | Provider `23/23`、本机服务 Worker `23/23`（C07 审计证据） |
| [xAI 官方模型与定价文档](https://docs.x.ai/docs/models)（审计复核） | 审计员于 2026-08-14 访问并复核；A 段禁止联网重抓 | `grok-imagine-video-1.5` 文生、duration `1..15`、480p `USD 0.08/秒`，仅用于选择固定 `1s/480p/16:9` 与十进制 `USD 1.00` budget guard | 不是 SUB2API 协议/能力证据，不能推断其请求字段、模型路由、status/state、ratio、下载 headers 或账号资格 | certifier budget/guard tests；真实认证只在 C08 A 段独立复审后执行 |

C08 当前没有迁入任何上游源码，也没有采集真实响应、请求 ID、下载 URL 或媒体二进制。受控认证计划和离线测试矩阵见 `AI企业内容生产平台_C08认证准备与测试矩阵.md`；`upstream/` 继续被 `.gitignore` 忽略，不得加入平台 Git。

## 10. C09 离线共享积分来源登记

| 来源 | 本地目标路径 | 保留的语义/字段 | 平台改动与不可复用边界 | 回归测试 |
| --- | --- | --- | --- | --- |
| `D:\AI\SSH\sub2api` 的 `backend/internal/veyra/routes.go`、`billing.go` | `packages/credit-veyra/`、`packages/contracts/`、`packages/persistence/` | `data` 包装、`user_id`、`amount`、`idempotency_key`、`source`、`reference_id`、`balance_after`、`replayed`，以及 `402/409` 与 request fingerprint 语义 | 不复制 Go handler、用户/余额/ledger 表、原子余额服务、Token guard 或浮点业务计算；以注入 fake transport、十进制字符串和平台 receipt 适配。 | fake transport contract、decimal、receipt replay/conflict、workspace persistence |
| `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0` 的 `VeyraSub2APIClient`、generation billing 调用顺序 | `packages/credit-veyra/` 与 C09 文档 | account/debit 路径映射及“产物验证后 debit，成功后 usage receipt”职责顺序 | 不复制 Python HTTP client、环境读取、自签 session、Cookie、JSONL 账本、图片固定费率或 `float` 比较；C09-A 不装配真实 client/Worker。 | transport path/header/body assertions、无 env/fetch/static scans |

C09-A 不从 `upstream/` 迁入源码；本机事实参考只用于薄适配语义。`upstream/` 继续受 `.gitignore` 保护，绝不进入索引、submodule 或 gitlink。

## 11. C11.3 动作节拍与时间轴提示词适配登记

本节登记设计阶段的复用边界；截至 2026-08-19 尚未声称已迁入上游 Agent 或完成 C11.3 代码验收。

| 来源 | 固定基线 | 计划适配目标 | 保留的语义 | 明确不复用 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `upstream/huobao-drama` `backend/workspace/skills/storyboard-breaker/SKILL.md`、`prompt-generator/video-prompt/SKILL.md`、`backend/src/agents/index.ts` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/creative-planning`、`apps/workflow-worker` | 8-15 秒同场景时间轴；每个子镜头一个可见主动作；仅在真实动作存在时生成 2-4 个子动作；动作/镜头/主体边界、相机和音频字段 | 自由 Agent、短剧工作区、进程内状态、直接写库、上游页面和 Provider 调用 | `ADAPTED`；creative-planning/workflow-worker tests |
| `upstream/seedance-2.5` `skill/seedance-25/references/long-video.md`、`references/prompting.md`、`references/troubleshooting.md` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `packages/creative-planning` PromptPackage compiler | 简单动作不强行时间轴；复杂动作使用有序时间戳；全局连续性锁、动作先于抽象情绪、起止状态和“开始→触发→变化→反应→终点” | 未认证 Provider 能力、模型名、官方 API 请求、浏览器参数面板 | `ADAPTED`；creative-planning/workflow-worker tests |
| `upstream/OpenMontage` scene/edit director 与 Artifact 结构 | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `services/media-runtime`、C12 QC/合成报告 | 时间轴 Artifact、片段/场景顺序和可追溯 QC 结构 | Backlot、自由工具执行、workspace 文件作为平台事实、全局 Agent 编排 | `PLANNED` |

适配原则：先在平台自己的 `MotionBeat`、`GenerationSegmentMotionPlan`、`PromptPackage` 和 `TaskRun.input_snapshot` 契约中固定版本，再以薄 mapper 读取上游稳定字段。任何实际迁入必须补充目标文件、修改点、测试命令和审计日期；未完成前不得把上游文档描述成已实现能力。

## 12. C11.6/C12.1 最终来源核验（2026-08-23）

| 来源文件 | 本地目标 | 本轮保留/适配内容 | 冲突处理与回归 |
| --- | --- | --- | --- |
| `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md` | `packages/creative-planning/src/index.ts`、`packages/contracts/src/creative-planning.ts` | 对白时长下限作为私有 `dialogue_duration_seconds` 与 Prompt 约束；MotionBeat 继续承载段内子镜头 | 不把子镜头暴露给新手用户；旧快照字段 optional；creative-planning 18/18 |
| `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`、`editing.md`、`prompting.md` | creative planner/compiler 与 C12 handoff | 起止状态、连续性锁、参考归属、时间戳和物理转场说明 | 未认证 provider extension 不启用；Prompt 按 profile 预算压缩；provider/workflow 回归通过 |
| `upstream/openmontage/lib/source_media_review.py`、`variation_checker.py`、`slideshow_risk.py`、`tools/analysis/transcriber.py`、`tools/video/video_compose.py`、`schemas/artifacts/final_review.schema.json`、`tools/video/video_stitch.py` | `services/media-runtime`、`packages/contracts/src/media-runtime.ts`、`packages/creative-planning/src/openmontage-variation-audit.ts`、`apps/production-worker/src/media-runtime-client.ts` | ffprobe 音频通道/采样率、首尾帧抽样、合成保留音频、variation/slideshow 原始检查、faster-whisper/VAD/word timestamps、原始 0.9 词准确率和标点泄漏检查 | 依赖未安装或未认证时显式 unavailable；不暴露路径/模型响应；C12.3 runtime/client 回归覆盖 |
| `sub2api-video-mcp` 协议登记、`tools/sub2api-video-certifier`、`fixtures/providers/sub2api` | `packages/provider-video/src/sub2api` | 提交/轮询/下载字段和错误归一化 | `upstream/` 无源码快照，不声称迁入；只使用离线夹具，真实 profile 继续能力门禁 |

完整冲突、覆盖状态和后置项见《AI企业内容生产平台_参考仓库能力吸收与冲突矩阵.md》。
## C12.3 来源补充

新增复用 `upstream/openmontage/tools/analysis/video_understand.py` 的 CLIP 关键帧分类路径，落点为 Media Runtime 私有终检。保留来源模型能力和显式不可用降级，不迁入 OpenMontage 的路径、Backlot、Agent 或自由模型调用。

## C12.4 连续旁白与分段视频音频编排来源登记

| 来源文件 | 本地目标 | 保留/适配内容 | 明确不复用 | 状态 |
| --- | --- | --- | --- | --- |
| `upstream/OpenMontage/skills/creative/video-stitching.md` | `services/media-runtime`、C12.4 AudioPlan | AI 片段音频不连续时移除、统一旁白/音乐轨道、J-cut/L-cut、LUFS、静音/漂移检查 | Backlot、Remotion、Agent 状态、自由本地目录事实 | `DESIGN_AUDIT_REQUIRED` |
| `upstream/OpenMontage/skills/pipelines/explainer/compose-director.md` | `packages/contracts`、`apps/production-worker`、`services/media-runtime` | 完整 narration asset、绝对时间戳、统一混音、完整转写和最终音频 QC | OpenMontage 私有 Artifact、工具直接写库和公开路径 | `DESIGN_AUDIT_REQUIRED` |
| `upstream/OpenMontage/tools/audio/audio_mixer.py`、`tools/audio/music_library.py`、`tools/audio/pixabay_music.py`、`tools/audio/suno_music.py` | `packages/contracts`、`apps/production-worker`、`services/media-runtime` | `full_mix` 的 asplit/sidechain ducking、normalize、音乐库资产选择和自动音乐 Provider 入口 | OpenMontage 自由路径、Backlot、工具直接写库；本轮仅接受受控 AUDIO Asset | `ADAPTED_IMPLEMENTED_PENDING_AUDIT` |
| `upstream/OpenMontage/tools/audio/audio_mixer.py::_track_filters/_full_mix` | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、`services/media-runtime/runtime.py`、`apps/production-worker/src/{media-service.ts,media-runtime-client.ts}` | 独立 formal speech `{path, role, start_seconds}`、source fade-before-adelay、speech/music/sfx 顺序、sidechain `ratio=9`/`level_sc=1`/`mix=0.9`、target `apad/atrim`、loudnorm；ALCHMED8 仅作既有私有 carrier | 不复制 Backlot/项目目录/ToolRegistry；不新增 ALCHMED9、第二套 AudioPlan、逐 cue Piper、变速、裁剪或补静音 | `ACCEPTED (C12.4-S03)` |
| 现有 ALCHMED8 `AudioPlan` 字段（与上行 `_full_mix` 输入契约协调） | `packages/contracts/src/media-runtime.ts`、`apps/production-worker/src/media-runtime-client.ts`、`services/media-runtime/runtime.py` | S04 只消费已有 identity/ownership/asset/window/gain/fade/transcript/music-window 字段；旧 ALCHMED1–7 仅兼容读取 | 不新增 ALCHMED9、第二套 AudioPlan、字段猜测、静默 fallback 或公共 UI/API 语义 | `历史 IN_PROGRESS (C12.4-S04；现行 formal/state 以 E12/R01=BLOCKED 为准)` |
| `upstream/huobao-drama/.../storyboard-breaker/SKILL.md`、`prompt-generator/video-prompt/SKILL.md` | `packages/creative-planning` | 段内台词边界、8-15 秒、台词时长下限和不得新增对白 | 短剧业务模型、进程内轮询、页面 mock | `ADAPTED` |
| `upstream/seedance-2.5/skill/seedance-25/references/long-video.md` | `packages/creative-planning`、C12 handoff/audio contract | 原生长视频时间轴、声音状态、未完成台词和精确端点连续性 | 未认证模型能力和外部 API | `ADAPTED` |

冲突记录（历史，语音 owner 部分已由 ADR-0063/《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》supersede）：现有 C12 旧规则“来源片段有音轨时最终不得丢弃”被精化为 `AudioOwnership`。历史无 AudioPlan 的任务使用 `LEGACY_PRESERVE`；只有在明确选择 `PLATFORM_NARRATION` 作为 owner 时，才移除被明确分类为 `PROVIDER_DIALOGUE` 的 Provider 音频；若 source-verified native Provider 是 owner，则保留其音轨。用户源音频、环境声、音乐和音效按策略保留。该段的历史证据仍保留，当前冲突裁定以新语音专项文档为准。

### 音频免费能力边界（默认/未授权环境）

默认/未授权本地栈通过 `AUDIO_FREE_ONLY=true` 只开放工作区已授权 `READY` 音乐资产、本地 FFmpeg 混音、Piper 本地兼容路径、faster-whisper 转写和 CLIP 检查；控制面展示资产能力状态。付费音乐、云端曲库和云端 TTS 默认禁用，不读取或要求对应密钥。用户已单独授权的本机 Aiself Grok/Doubao 对照不改变该默认值，执行顺序以最新自动音频开发文档为准。自动配乐从同一工作区共享的 READY 音乐资产中选择；无受控曲目时返回不可用/阻断，显式 OFF 才允许无 BGM。

## C12.5 口播语速优先与弹性总时长来源登记

本节仅登记设计阶段的规则吸收，尚未声称代码已经完成：

| 来源文件 | 本地目标 | 保留/适配内容 | 明确不复用 | 状态 |
| --- | --- | --- | --- | --- |
| `upstream/huobao-drama/.../storyboard-breaker/SKILL.md` | `packages/creative-planning` | 8–15 秒段界、叙事/环境段节奏、台词最低时长和按语义边界后移台词 | Agent 工作区、短剧模型、进程内任务事实 | `DESIGN_ONLY` |
| `upstream/huobao-drama/.../prompt-generator/video-prompt/SKILL.md` | Prompt Compiler | 段内台词来源、3 秒时间轴无重叠、无台词段使用环境/动作声 | 页面 mock、自由生成台词 | `DESIGN_ONLY` |
| `upstream/seedance-2.5/.../long-video.md`、`prompting.md` | `packages/creative-planning` | 30 秒时间轴脚本、声音状态/未完成台词/准确端点锁、台词适配分配时间 | 未认证原生长视频能力、Provider API | `DESIGN_ONLY` |
| `upstream/openmontage/schemas/artifacts/script.schema.json` | `packages/contracts` | `pacing_profile`、`pause_policy`、section 实际起止和 delivery cues | OpenMontage Artifact/数据库 | `DESIGN_ONLY` |
| `upstream/openmontage/.../executive-producer.md`、`edit-director.md`、`compose-director.md`、`core/remotion.md` | `apps/production-worker`、`services/media-runtime` | 实际旁白时长反馈、画面跟随旁白、超长回脚本或延长画面、禁止慢放 | Remotion/Backlot/Agent 执行状态 | `DESIGN_ONLY` |

适配决策和冲突点见《AI企业内容生产平台_C12.5口播语速优先与弹性总时长编排开发设计.md》及 ADR-0052。实现前必须补充内部契约、薄 mapper、回归测试和审计日期。

## C12.6 尾段声音边界补充登记

| 来源文件 | 本地目标 | 保留/适配内容 | 明确不复用 | 状态 |
| --- | --- | --- | --- | --- |
| `upstream/huobao-drama/.../prompt-generator/video-prompt/SKILL.md` | `packages/creative-planning`、`packages/provider-video` | 无对白段改为环境/动作声；段内台词边界保持来源分镜 | 短剧 Agent、页面 mock、自由补词 | `ADAPTED` |
| `upstream/seedance-2.5/.../prompting.md` | Prompt Compiler | 显式 `SILENCE/AMBIENT-ONLY` 声音策略并重复全局锁 | 未认证模型能力、官方 API | `ADAPTED` |
| `upstream/OpenMontage/.../talking-head/compose-director.md`、`tools/video/silence_cutter.py` | `services/media-runtime` | 超过 5 秒长静音质量提醒；允许有意视觉 hold 但要求缩短或改为空镜/非说话画面 | OpenMontage Backlot、自由工具状态、自动 lip-sync 修复 | `ADAPTED` |

实现证据与冲突处理见《AI企业内容生产平台_源仓库能力完整吸收与兼容优化方案.md》C12.6-E；未引入新的视觉模型或公开 API 字段。
# C12.4/C12.5 旁白与音频 QC 移植记录（历史快照，已由文末 2026-08-30 14:22 对账 supersede）

本标题以下至最新对账前的计数和路径描述保留为来源迁移轨迹，不作为当前证据；当前可复核测试计数和边界只以文末 14:22 记录为准。

- 上游：`calesthio/OpenMontage`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`；参考 `tools/audio/piper_tts.py`、音频混音与 compose/QC 规则。
- 移植文件：`services/media-runtime/runtime.py`、`services/media-runtime/main.py`、`services/media-runtime/UPSTREAM.md`、`services/media-runtime/adapters/openmontage_audio/{piper.py,selector.py}`、`apps/production-worker/src/media-service.ts`、`apps/production-worker/src/media-runtime-client.ts`、`packages/persistence/src/approved-narration-timeline.ts`、`packages/persistence/src/production-repository.ts`、`packages/creative-planning/src/index.ts`。
- 最小边界适配：完整 `scriptText` 单次旁白优先；旧 `narrationSegments` 仅兼容历史数据；保留平台 loopback/字节流边界，不引入上游 Backlot 或路径协议。
- 测试证据：`pnpm --filter @alchemy-video/creative-planning test` 36/36；`pnpm --filter @alchemy-video/production-worker test` 34/34；`pnpm --filter @alchemy-video/persistence test` 41 通过、10 个既有 `DATABASE_URL` 门控 skip；在 `services/media-runtime` 工作目录执行 `python -m unittest discover -s tests -v` 44/44。
- 状态：本轮实现已验证，C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`，未标记 ACCEPTED。
- TTS 选择审计：已核对 OpenMontage `tools/audio/tts_selector.py` 与 Doubao/OpenAI/Google 适配；平台当前没有可安全复用的 TTS Port/凭据边界，故不接入外部调用。中文口音保持外部阻塞，默认继续 Piper 离线 fail-closed。
- 本轮复核确认上述 provider 均要求各自密钥（Doubao `DOUBAO_SPEECH_API_KEY`、OpenAI `OPENAI_API_KEY`、Google API/服务账号）；未移植不存在的平台 TTS Port，避免自造协议。
- 时长边界采用 OpenMontage explainer 的“超出视频超过 1 秒才报错”规则；目标有余量时由视觉尾段/音乐床承接，显式 music OFF 不启用音乐。
- C12.7B READY TimelinePlan/APPROVED script/精确 asset-version 已按 workspace/project 严格查询并 fail-closed；approved AUDIO bytes 由 Worker 读取后进入 ALCHMED5。ALCHMED5 对完整 approved track 仍从 0 秒播放，section-level windows 尚未编码进 full-track bundle；无 asset-version 的 plan 只走已有绝对 cues，因此本章仍是 `IMPLEMENTED_PENDING_AUDIT`。
- 新增薄适配：`services/media-runtime/adapters/openmontage_audio/{piper.py,selector.py}`，来源为上述 OpenMontage commit；仅复用参数/metadata/离线选择语义，云 provider 保持禁用。
- approved C12.7B 音频资产现通过内部 `narrationAsset` 元数据由 Worker StoragePort 读取并进入 ALCHMED5；公开 DTO 不变。

### C12.4/C12.5 当前复核更正（2026-08-30 10:13）

- 最新定向证据：creative-planning 38/38、production-worker 41/41、persistence 57/57（显式本地 PostgreSQL；无数据库模式仍有 10 个门控 skip）、media-runtime 64/64；根 `pnpm typecheck`、`pnpm build` 和显式本地服务 `pnpm test` 均通过，根测试当前为 450 pass / 5 explicit skip / 0 fail。
- Worker 现在用持久化 cue/provider_text 拼接 canonical transcript 进入 final review；仅有 segments 且顶层脚本为空时不再跳过脚本/ASR 对比，空 cue 文本直接 QC_FAILED。连续旁白遇到无 delivery/ownership 事实的 source track 也在 Piper/compose/落库前 fail-closed，避免未知对白双播；这不是 ambience/user 音频分类的完成证明。
- 以上仅是本地离线实现与回归证据，C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`。完整 AudioPlan 字段与 approved full-track section windows、transition coverage、cue-only full-narration-first、Studio 样音审批闭环和中文口音认证仍未完成；无真实 Provider/TTS/Veyra/网络调用。

### C12.4/C12.5 语速参数与外部音频范围更正（2026-08-30；历史快照，已由 E04 对账 supersede）

- （历史快照，已 superseded）`services/media-runtime/adapters/openmontage_audio/piper.py` 曾登记 `NATURAL/SLOW/FAST` 到 `1.0/1.15/0.85` 的映射；上游没有该 symbolic pace 映射，当前 E04 仅保留来源默认 `NATURAL=1.0`，SLOW/FAST/BRISK 在 Piper 前 fail-closed。`pause_before_ms` 只由绝对 `start_ms` 校验，`pause_after_ms` 进入 `sentence_silence`；Piper 不支持的非中性 energy 和混合 pace 仍 fail-closed。
- 定向证据：media-runtime `test_runtime.py` 75/75、OpenMontage adapter tests 4/4。上述证据不代表中文口音质量已认证，默认 Piper 仍是离线 fallback。
- Freesound/free-music 代码不属于指定上游移植；本轮已移除其目录、路由、类型、UI 与环境注入，当前验收只使用工作区已授权 MUSIC 资产或明确 OFF 分支。OpenMontage/Pixabay 仅保留来源登记，未启用网络抓取。

### C12.4/C12.5 源音轨滤镜与 SSML 适配证据（2026-08-30）

- 复用 `upstream/openmontage/tools/audio/audio_mixer.py::_track_filters`：`services/media-runtime/runtime.py` 现在在连续旁白且 ownership 明确时，把 source track 的 numeric `gain_db`、非零 `fade_in_ms`/`fade_out_ms` 放在段落时间戳重置前执行；旧 LEGACY 策略不套用，避免改变历史音轨语义。
- `provider_text` 的 Piper 适配保留 timed `<break>` 的批准停顿事实；无时长或与 `pause_after_ms` 冲突的 SSML 显式拒绝，不能把时长静默丢失。该适配不创建新协议，也不引入时间拉伸。
- 证据命令/结果：`python -m unittest discover -s tests -p 'test_runtime.py' -v`（在 `services/media-runtime` 工作目录）78/78；`python -m unittest discover -s adapters -p 'test_*.py' -v` 4/4；`pnpm --filter @alchemy-video/contracts test` 36/36；`pnpm --filter @alchemy-video/production-worker typecheck` 通过；`pnpm --filter @alchemy-video/production-worker test` 42/42。
- 当前状态仍 `IMPLEMENTED_PENDING_AUDIT`；以上不是字幕、Studio 审批事实、approved full-track section windows 或中文口音质量的完成证明。

### C12.4/C12.5 字幕/受控 Runtime 新增证据（2026-08-30）

- OpenMontage 来源路径：`tools/subtitle/subtitle_gen.py`（word-timestamp cue grouping）与 `tools/video/remotion_caption_burn.py`（FFmpeg subtitles fallback）。平台薄适配位于 `services/media-runtime/runtime.py`、`services/media-runtime/main.py`、`apps/production-worker/src/media-runtime-client.ts` 与 `apps/production-worker/src/media-service.ts`；只接受 checked transcript/timing，不从 script 猜时间，缺能力时 fail-closed。
- 本地启动边界：`apps/control-api/tests/c12-local-e2e.mjs` 在存在时使用 `.codex-longrun/c10-document-runtime-venv`，并将同一解释器传给 `MEDIA_TRANSCRIBER_PYTHON_PATH`/`PIPER_PYTHON_PATH` 与本地 `HF_HOME`。Runtime capability 会探测该解释器中的 `faster_whisper`；解释器不一致或缺模块返回 `UNAVAILABLE`。未启用真实 Provider/TTS 或网络。
- 新增/复核证据：media-runtime `test_runtime.py` 87/87，OpenMontage adapter tests 4/4，production-worker 43/43，contracts 36/36；persistence MUSIC gain mapper 覆盖缺省映射 `0 dB`、合法数值和非法后缀拒绝。Python 命令必须从 `services/media-runtime` 工作目录运行。
- 当前边界：REQUIRED 字幕的端点与 Worker 触发已接通，但完整 Studio 审批事实、approved full-track section windows 实际消费、cue-only full-narration-first 连续韵律、transition coverage、完整 AudioPlan 字段消费及中文口音认证仍为 `IMPLEMENTED_PENDING_AUDIT` 门禁；上述测试不等同于真实音频质量或外部 Provider 验收。

### C12.4/C12.5 本轮 catalog 清理与本地音乐入口（2026-08-30 12:38）

- 复用边界：当前页面仅使用项目详情中服务端确认的 `AUDIO + READY + metadata.audio_role=MUSIC` 资产；音乐上传通过既有 `createUploadRequest` 的受限 `purpose=MUSIC` 映射为 server-owned 角色，浏览器 metadata 不可覆盖。通用 AUDIO 未声明 purpose 时保持未分类；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 仅是 legacy/optional 角色映射，供兼容既有 sample/reference/source 资产使用，不是当前自动旁白输入，且均不会被 AUTO 音乐查询选中。AUTO/MANUAL/OFF 三态只改变已授权项目资产的选择，不创建外部曲目。
- 移除范围：本轮撤除非指定上游 Freesound/free-music catalog 的 Control API 路由、contracts 类型、Studio 目录组件/调用、local/deploy 环境注入与同步脚本；历史记录不作为迁移证据。OpenMontage `pixabay_music.py` 仅保留来源登记，未启用网络抓取或 capability AVAILABLE 声明。
- 证据：Control API 45 pass/1 service-gated skip；Studio Web 36/36、typecheck/build PASS；`rg` 仅命中 negative test 与历史审计文字，当前代码/契约/UI/环境/deploy 无外部 catalog 引用；未调用网络或真实 Provider/TTS。
- 当前 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。音乐入口不代表 BGM 自动生成已完成；无 READY MUSIC 时页面明确提示不混入。approved full-track section windows、cue-only full-narration-first、Studio 样音/旁白审批/TimelinePlan 闭环、普通 REQUIRED 字幕事实链、transition coverage 和中文口音认证仍待审计。
- 2026-08-30 对账（已由下方最新记录 supersede）：AUDIO 角色仅通过服务端白名单 purpose 映射，通用 AUDIO/旁白样音不会被 AUTO 音乐选择；多 cue 在 OpenMontage `_full_mix` 接线前保持 fail-closed，不能作为 full-narration-first/approved section-window 证据；无真实 Provider/TTS/网络调用。

### C12.4/C12.5 最新源映射与行为证据（2026-08-30 14:22）

- 固定来源：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`；本轮逐项对照 `skills/pipelines/explainer/compose-director.md`、`executive-producer.md`、`tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::_full_mix` 与 `voice-performance-director.md`。平台改动只位于 `packages/persistence/src/{narration-quality-repository.ts,approved-narration-timeline.ts,production-repository.ts}`、`apps/production-worker/src/media-service.ts`、`services/media-runtime/runtime.py` 及定向测试/审计文字。
- 保留/适配：样音审批只写既有 `narration_script.approved` 事实；正式整轨必须是显式、实测、独立的 `sample_approved=false` 版本；Worker 只向既有 Piper 接口发送一次完整 canonical 文案；AUTO 音乐沿用服务端 `AUDIO + READY + metadata.audio_role=MUSIC` 事实筛选。
- 来源缺口处理：OpenMontage `_full_mix` 的 speech-track absolute-start 消费尚未接入平台 Runtime，因此多 cue/未消费 full-track section windows 统一 fail-closed；没有新增 atempo、padding、裁剪、网络曲库、Provider/TTS 协议或 UI 语义。
- 最新行为证据：Persistence `52 pass / 10 explicit DATABASE_URL-gated skip / 0 fail`；Production Worker `43/43`；Media Runtime `92/92`（`python -m pytest -q`，从 `services/media-runtime` 执行）；Control API `47 pass / 1 explicit service-gated skip / 0 fail`。未调用真实 Provider/TTS/Veyra/网络/VPS，未执行 Git。
- 状态：C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`。approved full narration section-level 时间窗、完整 AudioPlan 语义、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、REQUIRED 字幕事实链、中文口音认证和超长旁白 consumer 行为测试仍是未完成硬门。

### 明确授权后恢复 OpenMontage Pixabay（2026-08-30）

- 最新用户要求已明确授权外部网络；此前“仅保留来源、不启用网络抓取”的历史记录由本节针对 Pixabay 的恢复说明 supersede，其他真实 Provider/TTS/Veyra/计费/部署边界不变。
- 复用来源：`upstream/OpenMontage/tools/audio/pixabay_music.py`，`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`。保留搜索页 → `__BOOTSTRAP_URL__` → HTML MP3 fallback → 时长筛选（默认 30–120 秒）→ 无匹配回退全部 → 首条选择 → MP3 下载的原顺序。
- 薄适配路径：`services/media-runtime/adapters/openmontage_audio/pixabay_music.py` 负责来源网络逻辑；`services/media-runtime/main.py` 提供受保护 loopback 入口；`apps/control-api/src/pixabay-music.ts`/`app.ts` 负责运行时传输、工作区权限、幂等、对象存储、实际 MIME/字节/SHA 校验；Studio 只提交显式 query。
- 资产事实：导入结果仅由服务端标记为 `AUDIO + READY + metadata.audio_role=MUSIC`；`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 和未声明角色不会被 AUTO 选中。没有自动补曲、排序、推荐或第二套音乐目录逻辑。
- 安全边界：运行时下载只允许 HTTPS `cdn.pixabay.com`，禁止页面返回任意主机；未配置 Media Runtime 时能力保持阻断，不绕过内部 API。原工具稳定性仍为 `EXPERIMENTAL`，页面结构变化可能导致无结果/不可用。
- 验证：原仓库 Python 路径对 `ambient` 与 `upbeat` 各完成一次真实 Pixabay 搜索和 MP3 下载；`ambient` 首条匹配时长 106 秒、20 条结果、过滤后 4 条、下载约 3.4 MB。定向回归测试与运行时测试另见本轮命令记录。

### C12.4/C12.5 最终深审计来源对账（2026-08-30 17:05）

- 本轮逐项复核的唯一音频来源仍为 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::_full_mix`、`tools/audio/pixabay_music.py` 及对应 explainer/voice-performance 规则。平台代码只增加受控 Runtime、workspace、对象、幂等、错误归一化和公开脱敏边界；没有新增旁白算法、时长回退、Provider 协议或 UI 语义。
- 适配事实：Runtime 采用有界分块 JSON；混音保持来源 `ratio=9`、`level_sc=1`、`mix=0.9` 及正衰减到线性音量的换算；Control API 对 FFmpeg/Piper 缺少受控路径、模型、sidecar 或 launcher 的情况报告 `NOT_CONFIGURED`，不凭静态声明报告成功。通用 `AUDIO`、`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 不会被强制标成 `MUSIC` 或进入 AUTO。
- 最新证据：Media Runtime `97 passed / 0 failed`；OpenMontage audio adapters `7/7`；Control API `53 pass / 1 explicit service-gated skip / 0 fail`；Production Worker `43/43`；根 `pnpm test` `447 passed / 18 explicit environment-gated skips / 0 failed`；`pnpm typecheck`、`pnpm build`、`git diff --check` 通过。旧计数均保留为历史迁移轨迹，不作为当前验收证据。
- 结论：C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。approved full narration section-level 时间窗实际消费、完整 AudioPlan、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音和超长旁白 consumer 行为仍未收口；不得用结构性测试门控宣称已解决。真实 Provider/TTS/Veyra/共享积分/VPS/DNS/TLS/部署/Git 仍未执行。

### C12.4-S01 Pixabay / MUSIC 角色薄适配与审计（2026-08-30 17:45；历史，已 superseded）

- 来源与符号：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`，`upstream/openmontage/tools/audio/pixabay_music.py`；复用搜索、bootstrap/HTML 回退、时长筛选、首条选择和 MP3 下载的原有顺序。
- 适配路径：`services/media-runtime/adapters/openmontage_audio/pixabay_music.py`、`services/media-runtime/main.py`、`apps/control-api/src/pixabay-music.ts`、`apps/control-api/src/app.ts`。新增内容仅是 loopback/workspace/object/idempotency/脱敏边界，以及平台已有媒体校验所需的 `audio/mpeg`、字节数和 SHA-256 检查；非音频响应拒绝是输入安全边界，不是新选曲逻辑。
- 角色事实：上传 purpose 由 `packages/contracts/src/resources.ts` 的闭合枚举约束，服务端把音乐导入资产固定为 `MUSIC`；`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 和未分类 AUDIO 不能进入 AUTO。跨角色回归覆盖了调用者 metadata 试图覆盖角色的情况；当前自动旁白由服务端 native/Doubao 生成，不以用户上传为前提。
- 当前证据：Control API `55 pass / 1 explicit service-gated skip`；Media Runtime adapters `8/8`；Media Runtime `97/97`；根 `pnpm test` `449 pass / 18 explicit environment-gated skips / 0 fail`；typecheck/build/diff check/state validator 全部通过。既有授权 Pixabay smoke 仍是唯一真实源可达性证据，本轮没有额外真实网络或 Provider/TTS/Veyra 调用。
- 切片状态（历史快照）：`READY_FOR_AUDIT`；该状态已由后续 E02 对账 supersede，不代表当前状态。C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`。

### E02 最新 focused 证据（2026-08-31）

Node `PixabayMusicAdapter` 条目为历史记录，已由 loopback-only 实现 supersede。基础精确验证（`last_verified_at=2026-08-31T01:52:23+08:00`）：合并 Control API 命令 `23/23`（Pixabay client `6/6` + Control API `17/17`）；独立窄切片为 client `6/6`、Runtime source adapter `4/4`、handler `3/3`、Control API 角色/导入/幂等 `5/5`、capability BLOCKED `1/1`、loopback 集成 `1/1`，另有 Studio explicit Pixabay/no-auto-catalog fixture `1/1`；均无 skip，全部使用 fixture/mock。补充验证（`last_verified_at=2026-08-31T08:25:25+08:00`）为 Runtime finite fixture `1/1`，拒绝 `NaN`、`Infinity`、`-Infinity` duration。S01/E02 已通过独立审计并为 `ACCEPTED`（仅切片）；“E03 尚未启动”是 E02 快照，现行 E03 状态见下方登记；未调用真实网络。

### E03/HB-STORYBOARD-TIMING 来源迁移登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`（commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`） | `packages/domain/src/creative-planning.ts::assertStoryboardPlan`、`packages/contracts/src/creative-planning.ts::StoryboardShotSpecSchema`、`packages/creative-planning/src/index.ts` | 复用来源正式分镜段 8–15 秒边界；规划器只复用既有 `STORYBOARD_SPEC_INVALID` 阻断路径，不改写来源拆分流程 | editorial 评分、dialogue 分组、remainder、MotionBeat/子镜头语义没有固定来源等价，保持 `UNREFERENCED`/冻结；E03 窄切片=`ACCEPTED`（仅切片） |

定向证据：creative-planning `38/38`、domain `43/43`、contracts `36/36`，已运行 `pnpm contracts:generate`；0 skip/fail，全部本地 fixture/单元测试。未调用真实 Provider/TTS/Veyra/网络/VPS，未执行 Git 写操作。纠察员已完成独立复核，E03 窄切片已完成 `READY_FOR_AUDIT`→`ACCEPTED`，仅覆盖 8–15 秒正式分镜段边界，不代表完整 Huobao 规则。

### E04/S02 Piper pace 与原始参数来源登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/audio/piper_tts.py::PiperTTS._generate`、`tools/audio/tts_selector.py::TTSSelector`、`skills/meta/voice-performance-director.md`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/adapters/openmontage_audio/piper.py`、`services/media-runtime/adapters/openmontage_audio/selector.py`、`services/media-runtime/runtime.py` | 保留来源 `--model/--speaker/--length-scale/--sentence-silence/--output_file`、stdin、WAV 实测和 `timeout=300`；仅 NATURAL 使用来源默认 `length_scale=1.0`；未映射 symbolic pace 在 Piper 前 fail-closed | 来源没有平台 `SLOW`/`FAST`/`BRISK` 数值映射，禁止恢复历史 `1.15/0.85` 或改名；云 TTS 仅元数据，未接入执行；E04=`ACCEPTED`（仅窄切片） |

定向证据：adapter source-conformance（Piper 参数、NATURAL-only pace、selector 本地边界）`4/4`；Runtime Piper/WAV/错误与未映射 symbolic pace `6/6`，补充 SLOW/FAST/BRISK fail-closed `1/1`；contracts export `32/32`。全部为本地 fixture/mock，0 skip、0 fail；未调用真实 TTS/Provider/Veyra/网络/VPS/Git。E04 已完成独立审计并为 `ACCEPTED`（仅 Piper pace/原始参数窄切片）。

### E05/OpenMontage `_full_mix` 与 ALCHMED8 来源登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/audio/audio_mixer.py::_track_filters/_full_mix`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、`services/media-runtime/runtime.py`、`apps/production-worker/src/media-service.ts` | 仅消费现有 ALCHMED8 identity/ownership/asset/start/end/gain/fade/transcript/music-window 字段；保留来源 speech/music/sfx、absolute start、fade→delay、ducking、target-duration、normalize；平台只提供 workspace/StoragePort/MIME/SHA/byteSize/ffprobe/临时路径薄壳 | 不新增 ALCHMED9、第二 AudioPlan、逐 cue Piper、SLOW/FAST 映射、atempo、裁剪、补静音、网络/Provider；E05=`ACCEPTED`（仅已表达字段窄切片） |

E05 已完成独立审计并 `ACCEPTED`（仅已表达字段窄切片）。实际定向实跑（全部本地 fixture/mock，0 skip/fail）为 Runtime `18 passed / 94 deselected`、full-mix adapter `3/3`、Production Worker `53/53`；覆盖 independent speech、music-only、SFX/source preservation、角色/资产/跨工作区、gain/fade/ducking、目标时长、不可表达窗口 fail-closed、对象冲突、Worker 重启/重复和受控 FFmpeg/ffprobe 产物。该结论不关闭 approved section windows、transition/xfade、字幕、Studio、中文口音和超长旁白 consumer；这些转入 E06 及后续切片。

### E06/OM-VOICE-WINDOWS 来源登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| OpenMontage explainer narration/asset 规则、`audio_mixer.py::_full_mix` speech-track 输入（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/runtime.py`、现有 ALCHMED8/Worker asset checks | 只复用独立正式 section 资产的 identity/duration/start 与来源 speech-track；平台仅保留既有 workspace/project/Storage/错误边界 | partial/multiple windows、样音复用、cue-only 多 cue 与无法测量资产继续 fail-closed；E06=`ACCEPTED`（仅来源可表达窄切片） |

E06 已形成定向实现证据并由纠察员独立审计通过，标记 `ACCEPTED`（仅来源可表达窄切片）：Runtime `17 passed / 95 deselected`、full-mix adapter `3 passed / 8 deselected`、Persistence approved narration timeline `13 passed`、Production Worker 选择集 `6 passed`（2026-08-31T10:10:04+08:00；全部本地 fixture/mock，0 fail/skip，无 TTS/网络/外部服务）。证据覆盖 AudioPlan identity/absolute windows、完整整轨兼容、独立 section speech tracks、HOLD/cue-only 边界、样音/正式资产隔离、版本/工作区/MIME/SHA/时长校验及缺失/未批准路径 fail-closed。transition/xfade、字幕、Studio、中文口音和超长旁白 consumer 继续阻断。

### E07 transition/xfade 与有效时长来源登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/video/video_stitch.py` 与 explainer `edit-director.md`/`compose-director.md`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | 现有 Media Runtime transition/compose 路径（待来源审计） | 先固定来源符号、参数、滤镜顺序、有效时长和产物语义；仅允许既有 workspace/Storage/ffprobe/错误边界薄壳 | 未定位或未证明的 xfade/acrossfade 常量、桥接修正和字幕窗口保持 `BLOCKED/DEFERRED`；E07=`BLOCKED`（映射子项 `UNREFERENCED`） |

来源审计结论（历史阻断快照）：OpenMontage 的 `_stitch_cut`、`_stitch_crossfade`、`_stitch_fade_through_black`、`_get_xfade_offset=max(0, clip_duration-transition_duration)` 与 `_chain_xfade`（累积 offset、无 `tpad`）已定位，但当时未证明平台 `PASS/BLEND/BRIDGE` 的语义映射；该段已由用户后续授权和下方当前登记 supersede。

### E07 transition/xfade 与有效时长当前登记（2026-08-31）

- 用户已授权最小平台映射：`PASS→cut`、`BLEND→crossfade`、`BRIDGE→fade-through-black`。固定来源为 `tools/video/video_stitch.py` 的 `_stitch_cut`/`_stitch_crossfade`/`_stitch_fade_through_black`、`_get_xfade_offset`（`max(0, …)` 后 round）和 `_chain_xfade`（累积 offset、无 `tpad`）。
- 平台目标为 `services/media-runtime/runtime.py`；仅迁移来源 transition type、0.1–5.0 秒 source schema、offset/effective-duration 语义。cut 的既有 filter concat 只作时间轴等价薄壳，不声称来源 concat-demuxer/`-c copy` 编码等价。
- 定向 fixture/mock 证据：`python -m pytest -q tests/test_runtime.py -k "maps_pass_to_source_cut or maps_bridge_to_source_fadeblack or cumulative_offset_rounding or rejects_mixed_source_transition_plan or rejects_different_bridge_durations or continuous_narration_crossfade"` → `6 passed / 113 deselected / 0 failed / 0 skipped`；纠察员独立复核通过，无真实 Provider/TTS/Veyra/网络/VPS/Git。
- 状态：E07 来源可表达 uniform transition 窄切片=`ACCEPTED`；mixed transition、不同 bridge duration、continuous narration 非 cut、target mismatch 等来源未表达形态保持 `BLOCKED/DEFERRED`。该条“下一活动切片为 E09”是历史顺序快照，现行活动为 E10；E08 segmented/HyperFrames 仍需独立授权；C12.4/C12.5 总体继续 `IMPLEMENTED_PENDING_AUDIT`。

### E09/OM-TRANSCRIBE-SUBTITLE 来源登记（2026-08-31）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/analysis/transcriber.py`（`WhisperModel`, `word_timestamps=True`, `vad_filter=True`）、`tools/subtitle/subtitle_gen.py::_build_cues/_hmsms`、`tools/video/remotion_caption_burn.py::_render_ffmpeg`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/runtime.py::transcribe_video_bytes`, `_subtitle_srt_from_transcript`, `burn_captions_video_bytes`, `main.py` loopback handlers | 仅保留 source-expressed CPU/int8 transcriber flags、词级时间/概率舍入、8词/42字符 cue、SRT 毫秒进位与 FFmpeg `subtitles` fallback；平台薄壳只负责受控解释器、输入/MIME/SHA/ffprobe、REQUIRED fail-closed、音轨保留和 burned marker | GPU/device/model/language metadata、diarization、Remotion 主渲染、VTT/JSON/correction/highlight 和脚本文本推时序不在当前契约，保持 `DEFERRED/BLOCKED`；E09=`ACCEPTED`（仅 source-expressed 窄切片） |

行为证据：focused Runtime `11/11`（`111` deselected、0 skip/fail），完整 Runtime `122/122`，全部本地 fixture/mock；独立纠察员复核通过。修复了 cue flush 后误复用前一 cue 文本的来源偏差；未新增协议、算法、阈值或外部调用。E10 Studio 样音/正式资产/TimelinePlan 为当前唯一活动切片；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### E10 Studio 样音、正式旁白资产与 TimelinePlan 来源登记（2026-08-31 11:26:59；窄切片已验收）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | 既有 `packages/persistence/src/narration-quality-repository.ts`、`approved-narration-timeline.ts`、`apps/production-worker/src/media-service.ts` 与 Studio 现有公开编排 | 仅复用“样音先审批、正式资产独立且可测量、TimelinePlan 显式窗口/资产事实”的来源边界；平台保留既有 workspace/project/版本/MIME/SHA/字节数/时长和 fail-closed 薄壳 | source 顶层 `voice_performance`/完整 `delivery_cues`、最敏感 section 选择/人工听感、approved sample path/provider settings manifest、provider-specific mapping、完整 Studio UI/API 和真实 TTS 未映射，保持 `DEFERRED/BLOCKED`；E10=`ACCEPTED`（仅窄切片） |

本轮新鲜 fixture/mock 证据（全部 `0` fail/skip、无 Provider/TTS/网络/Veyra/VPS/Git）：creative-planning narration quality `7/7`；persistence narration-quality + approved-timeline `16/16`；Control API C12.7B `2/2`；Production Worker `7/7`；Studio project-flow/project-shell `24/24`。纠察员独立审计通过，E10 以 approval fact + 独立正式资产 + measured TimelinePlan identity/window 的窄切片完成 `READY_FOR_AUDIT→ACCEPTED`，不代表完整样音 UI/API 或中文口音质量。平台既有 `normalizeNarrationSections` 与 `buildNarrationTimeline` 不登记为 OpenMontage 算法等价。

### E11 超长旁白 consumer 来源登记（2026-08-31 13:19；S08 窄切片 ACCEPTED；完整 E11 未验收）

| 来源文件/符号 | 本地目标 | 允许的薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/skills/pipelines/explainer/compose-director.md`、`executive-producer.md`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | 现有 narration consumer/TimelinePlan 规划与 Worker 消费路径 | 仅复用测量旁白时长、超长改稿/重新生成或延长视觉尾段、禁止慢放/裁剪/补静音和既有 visual hold/ambient 关系 | `scene-director.md:146-169` 仅同源审计候选/`DEFERRED`，非当前开发授权；无来源的阈值、评分、时长修正、Provider 选择、第二协议/UI 状态保持 `DEFERRED/BLOCKED` |

E11 逐符号映射：`compose-director.md:80-107` 为时长预算→TTS 原始参数/`audio_duration_seconds` 超长反馈→Pixabay 参数；`:140-143` 为旁白/音乐覆盖与 ducking 前置校验；`:190-210` 为 Remotion 音频路径及不可用时 FFmpeg `audio_mixer` 的 layer→music→duck→normalize→输出顺序。`executive-producer.md:233-242` 为逐文件探测→`EP_STATE.narration_durations`→`1.15` 超长 SEND_BACK 或 `25%` 内 scene-plan 调整→总时长更新；平台未实现自动重规划/弹性时长。`scene-director.md:146-169` 只保留审计映射，不复用或授权开发。

既有 consumer 落点为 `services/media-runtime/runtime.py:1983-2022,2504-2524` 与 `apps/production-worker/src/media-service.ts:464-485,513-595`；本轮薄适配将实测 `narration_durations`/总时长写入私有 decision log，并在 compose 前对来源 `SEND_BACK`、`ADJUST_SCENE_PLAN` 及规则重叠的 `SOURCE_DECISION_REQUIRED` fail-closed。没有新增 CompositionPlan/ALCHMED 字段、协议、时长修正或自动重规划；来源未规定重叠优先级，故不自动选择动作。

最新本轮实际回归追加（2026-08-31 13:27）：Contracts `37/37`、Domain `48/48`、Production Worker 全量 `56/56`、E11 选择集 `7/7`；Persistence 幂等集成在项目自带本地 PostgreSQL 容器上 `1/1`；相关 `tsc --noEmit`、`validate_state.py`、`git diff --check` 均通过。全部为本地 fixture/mock 或本地数据库、`0` fail、无 Provider/TTS/网络/Veyra/VPS/Git 或其它外部调用。纠察员已独立审计，该证据将内部 feedback 窄切片收口为 `ACCEPTED`；自动 SEND_BACK 执行、视觉延长/重规划/弹性时长仍 `DEFERRED/BLOCKED`，完整 E11 未验收，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。

### E08/OM-SEGMENTED-MUSIC + OM-HYPERFRAMES-AUDIO 启动登记（2026-08-31 13:54:48；历史启动快照）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/audio/audio_mixer.py::AudioMixer.execute/_segmented_music`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/adapters/openmontage_audio/segmented_music.py` + `runtime.py` 内部 helper | 保留来源 `operation="segmented_music"`、`video_path`/`music_path`、`music_volume`、`segments[{start,end}]`、`fade_duration`、`output_path`、按 start 排序的 volume/fade、重叠窗口 `+` additive、`amix normalize=0` 和视频/音频输出顺序；平台只加受控 workspace/Storage/MIME/SHA/ffprobe/错误/幂等边界 | 不并入 `_full_mix`，不添加平台自造音乐窗口算法、阈值或第二 AudioPlan；实现证据已补，待独立 Exit Gate |
| `upstream/openmontage/tools/video/hyperframes_compose.py::_resolve_audio_refs` + `skills/core/hyperframes.md:143-162`（同 commit） | `services/media-runtime/adapters/openmontage_audio/hyperframes_audio.py` + `runtime.py` 内部 helper | 接受独立已授权音频文件，保留 narration/music 文件、track/volume、`data-start`/`data-duration` 和 optional/zero end fallback；平台只加权限、workspace/project、Storage、MIME/SHA/ffprobe 和幂等薄壳 | 不照搬来源缺失时静默 `continue` 或 basename 路径 fallback；不切整轨 bytes，不新增公开 UI/API/Provider/网络协议；实现证据已补，待独立 Exit Gate |

启动段来源确认及“尚无实现/未改代码”均为历史快照。当前 E08 仍是唯一活动切片，代码落点和证据见下方 checkpoint；`MediaRuntimeCompositionPlan`/ALCHMED8 未新增 HTML 公共载荷。

平台 fail-closed 边界保留：invalid/non-finite/out-of-range `[start,end]`、缺失或越权独立 audio asset、workspace/project/role/MIME/SHA/ffprobe 不一致、未验证 HTML timing 均拒绝；来源适配器本身保留 overlap additive/输入顺序，既有 CompositionPlan/Runtime helper 在平台边界拒绝 overlap。E11/S08 仍仅为已接受窄切片，启动段的 E08 状态文字为历史 `IN_PROGRESS/implementing`；当前 E08 来源可表达窄切片已由 `READY_FOR_AUDIT/verifying` 收口为 `ACCEPTED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`；不调用真实 Provider/TTS/Veyra/网络/VPS/Git。

### E08/OM-SEGMENTED-MUSIC + OM-HYPERFRAMES-AUDIO 实施 checkpoint（2026-08-31 14:40；ACCEPTED 窄切片）

- `segmented_music.py::OpenMontageSegmentedMusicMixer` 镜像固定来源 `_segmented_music` 的参数、排序、fade expression、重叠窗口 `+` additive、`amix normalize=0` 和输出映射；`hyperframes_audio.py::OpenMontageHyperFramesAudio` 镜像 `_resolve_audio_refs`/HyperFrames HTML audio timing、track 2/3、optional/explicit-zero end fallback 与 source volume default。仅加既有 workspace/project、MIME/SHA/byte-size/ffprobe、路径和错误事实边界。
- Runtime helper 保持 segmented 独立，不并入 `_full_mix`；`resolve_hyperframes_audio_refs` 要求显式 workspace/project scope；无公开 API/UI/Provider/协议变化。现有 `MediaRuntimeCompositionPlan.music_segments_ms` 约束在 Runtime 边界阻止重叠。
- 定向证据（全部本地 fixture/mock，0 skip、无外部调用）：adapter focused `14/14`；Runtime focused `3 passed / 122 deselected / 0 failed / 0 skipped`；Runtime full `125 passed / 0 failed / 0 skipped`；adapter combined `25 passed / 0 failed / 0 skipped`，并包含受控 ffmpeg/ffprobe/WAV 产物夹具。
- 纠察员已完成技术来源/范围/计数复核，独立验收通过，E08 来源可表达窄切片由 `READY_FOR_AUDIT/verifying` 收口为 `ACCEPTED`。完整 HyperFrames renderer、重启/重复整合、完整 AudioPlan/section windows、Studio/字幕/中文口音/超长旁白硬门继续 `DEFERRED/BLOCKED`。

### E12/OM-TTS-PROFILES 真实 TTS 与中文口音授权登记（2026-08-31；历史阻断快照，已 superseded）

| 来源文件/符号 | 本地目标 | 复用与薄适配 | 未复用/状态 |
| --- | --- | --- | --- |
| `upstream/openmontage/tools/audio/piper_tts.py`、`tools/audio/tts_selector.py` 及已登记云 TTS adapters（固定 commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | 现有 `services/media-runtime/adapters/openmontage_audio/piper.py`、`selector.py` 与后续受控 Runtime profile 入口 | 当前只确认 Piper 原始参数/结构适配；真实 provider/profile 只有在材料和授权齐备后才能做来源映射与薄壳边界 | 中文口音听感、云 TTS provider mapping、真实请求/产物和计费均未验证；E12=`BLOCKED` |

- 进入 E12 需要用户逐项提供具体 provider/profile、调用次数、源素材范围、额度上限、凭据注入方式和外部调用授权。本段记录时材料缺失，不能将本地 Piper 结构测试、静态 capability 或既有视频结果写成口音验收证据；该段为历史快照。
- 在阻断解除前不新增语速数值映射、时长修正、第二协议、UI/API 或网络路径，不调用真实 Provider/TTS/Veyra、共享积分、网络、VPS 或付费服务。总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`。

### E12 本轮用户授权真实视频、Piper 与音乐实测登记（2026-08-31 16:05；BLOCKED，未验收）

- 固定来源仍为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 Piper/selector 与已登记媒体语义；本轮未新增 adapter、字段或协议。用户授权仅用于调用现有 30 秒/480P 视频 Provider、现有本地 Piper 端点和既有音乐组成路径。
- 保险AI项目真实 canary `prd_01M1BD7G2CHTQPPPBA2QZSV0Q1` 使用明确的四图 SUBJECT/SCENE/STYLE 角色、两个 15 秒段，Provider each once 成功；最终 `848x480`/`30.084s`/`6460435` bytes，Composition QC=`PASS`，`music_applied=true`，`-14.2 LUFS`、`-1.7 dBTP`、无意外静音。该证据只覆盖视频/音乐产物，不是中文口音验收。
- 同项目歧义角色输入被既有门禁拒绝（`prd_01M1BD21H6TGKJ94F4A8V2PYF2` 无 Provider task）；修正为逐图明确来源后才成功，未改 role resolver。Piper 单次输出为 `audio/wav`/`716680` bytes/`16250ms`/`22050Hz mono`，不替代正式 narration asset 或人工听感。
- Pixabay 显式导入返回 `503 PROVIDER_UNAVAILABLE`、外部页面 `403`；未启用第二抓取器或静默回退。没有创建正式 `NarrationAssetVersion`/完整 `TimelinePlan`，没有把样音提升为正式旁白。
- 状态保持 E12=`BLOCKED`（云 TTS/profile、中文口音、完整 approved narration/section windows、Studio/TimelinePlan 等硬门无足够证据），总体 C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`。上述实测不构成 `READY_FOR_AUDIT`/`ACCEPTED`。
- 根级 `pnpm test`（2026-08-31 20:44）实际为 `470 passed / 19 explicit skips / 0 failed`，覆盖 18 个 workspace 项目；skip 为环境门控，不作为通过，本次回归未新增外部调用。

## 13. 原仓库语音路线与旁白质量迁移修复登记（2026-09-01；设计对账，未实施）

执行依据：`AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md`。本节只登记待迁移的固定来源和与旧方案的冲突，不把计划写成实现事实。

| 来源仓库/commit | 来源文件/符号 | 目标模块 | 必须保留 | 旧冲突及裁定 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/grok_video.py::GrokVideo` | provider-specific video adapter / Worker | `native_audio`、`lip_sync`、单次生成、MP4 实际音轨 | 旧路径统一静音 Provider dialogue 并追加 Piper；改为 native owner 时保留来源音轨，不追加 TTS | `NOT_MAPPED / E12 BLOCKED` |
| huobao-drama `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/src/services/adapters/volcengine-video.ts`、`generation.ts` | 对应 provider adapter | `generate_audio` 与 `reference_audio` 的区别、生成/下载顺序 | 不把 `reference_audio` 当最终旁白，不把字段扩散到通用 Sub2API 请求 | `PARTIAL / PROFILE_REQUIRED` |
| OpenMontage 同上 | `tools/audio/tts_selector.py::TTSSelector` | Runtime selector | registry discovery、rank、preferred/allowed、availability | 旧 `PROVIDERS` tuple/auto→Piper 被标为冲突；不得新增平台评分 | `PARTIAL` |
| OpenMontage 同上 | `tools/audio/piper_tts.py::PiperTTS::_generate` | Piper adapter | stdin、原始参数、WAV、`timeout=300` | Piper 只作 selector 明确选择的离线 fallback；不作全局 owner，不补 pace 映射 | `E04 ACCEPTED（窄切片）` |
| OpenMontage 同上 | `skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md` | Planning/Studio/Persistence | `voice_performance`、`delivery_cues`、`provider_text`、样音 gate、正式 asset 独立 | 固定 `platform-generic-zh`/未批准样音批量生成被标为冲突 | `E10 ACCEPTED（窄切片）/完整语义 BLOCKED` |
| OpenMontage 同上 | `tools/audio/audio_mixer.py::_full_mix`、explainer compose/QC | Runtime/Worker | speech/music/sfx、绝对起点、ducking、normalize、target duration、实际时长/转写终检 | 现有 `_full_mix` 窄切片保留；完整 owner/section/timeline/QC 仍需独立证据 | `E05/E11 ACCEPTED（窄切片）` |

本登记不声称上述 `NOT_MAPPED`/`PARTIAL` 已完成；真实 TTS、云 profile、中文口音和 native Provider profile 仍按 E12 授权门禁处理。旧 C12.4/C12.5 语音路线条目保留为历史快照，并以“SUPERSEDED（voice route）”解释，不删除审计轨迹。

## OM-DOUBAO source-shaped mapper 与用户授权 smoke（2026-09-01；历史快照，MAPPER_ONLY/PARTIAL，已 superseded）

| Source ID | 固定来源文件/符号 | 平台落点 | 保留/薄适配 | 当前状态 |
| --- | --- | --- | --- | --- |
| `OM-DOUBAO` | `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`，`tools/audio/doubao_tts.py::DoubaoTTS` | `services/media-runtime/adapters/openmontage_audio/doubao.py`（private mapper） | source submit/query URL、`X-Api-*` headers、`req_params`、`voice_id`/`resource_id` 覆盖、错误提示和 key redaction；不引入 HTTP/注册/公共字段 | `MAPPER_ONLY/PARTIAL` |

- 环境只登记 source 名称 `DOUBAO_SPEECH_API_KEY` 与 `DOUBAO_SPEECH_VOICE_TYPE`，真实值留在仓库外；本次用户授权 profile 为 `seed-tts-2.0` / `zh_female_vv_uranus_bigtts`。source `DoubaoTTS.execute` 一次 smoke 完成，MP3 `57372` bytes、metadata `2506` bytes；无 `ffprobe`，不声明时长。
- 同一 MP3 由仓库 bundled `ffprobe-static` 离线测得 `2.856000s`、`mp3`、24 kHz mono；该补充仅为产物事实，不改变 `MAPPER_ONLY/PARTIAL` 或 E12 阻断。
- 离线 fixture `7 passed / 9 deselected / 0 skipped`（含输入覆盖及非法值 fail-closed），`py_compile` 与 `git diff --check` 通过。此证据不构成平台 Runtime/Worker provider owner、正式 NarrationAsset/TimelinePlan、中文口音或 E12 Exit Gate；E12/R01 继续 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。
- 先前登记中“未新增 Doubao mapper/未做真实 source smoke”的文字属于授权前历史快照；不得据本补记启用云路由、修改公共契约、进入 R02、调用 Veyra/计费或把 secret 写入任何仓库产物。

## R01 原仓库语音 owner 边界实施登记（2026-09-01 00:53；历史快照，已 superseded；局部 IMPLEMENTED，完整 BLOCKED）

| Source ID | 固定来源文件/符号 | 平台目标 | 本轮保留/薄适配 | 当前状态 |
| --- | --- | --- | --- | --- |
| `OM-TTS-SELECTOR` | `tools/audio/tts_selector.py::TTSSelector._providers`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`） | `services/media-runtime/adapters/openmontage_audio/selector.py` | 删除平台手工 provider tuple；无 registry 时 `auto`/空值返回 `UNAVAILABLE`，显式 `piper`/`piper_tts` 才保留；未新增评分/协议 | `IMPLEMENTED`（registry/rank 正向映射仍 `BLOCKED`） |
| `OM-PIPER` | `tools/audio/piper_tts.py::PiperTTS::_generate` | 既有 Runtime Piper path | approved narration asset/`inspectAudio`/实际 WAV 事实保持；不改变来源参数或 timeout；不作为隐式 owner | `E04 ACCEPTED` 窄切片 |
| `OM-NATIVE-AUDIO` | `tools/video/grok_video.py::GrokVideo.supports["native_audio"]` | 当前 provider profile/`VideoProviderPort` | 本轮未伪造 owner；现有契约没有可核验 native audio 字段，因此保留 `UNAVAILABLE/BLOCKED` | `NOT_MAPPED / E12 BLOCKED` |
| `R01-WORKER-GUARD` | 来源 owner/正式 asset 事实与既有 Worker QC 路径 | `apps/production-worker/src/media-service.ts:538-543` | 无 approved narration bytes/tracks 且存在 canonical script/cue 时沿用 `QC_FAILED`，阻止裸 script 默默进入 Piper；不新增字段 | `IMPLEMENTED`（局部安全边界） |

定向证据：selector `2 passed / 9 deselected / 0 skipped`；Production Worker `26 passed / 0 failed / 0 skipped`；`git diff --check` 无错误，仅既有换行提示；全部为本地 fixture/mock。本段为实现前期历史快照，已由下方 native-first/Doubao 当前证据 supersede；完整 R01 的 profile certification、Runtime registry discovery/rank、正式旁白资产/时间线和人工听感仍未闭合，不能升级 `READY_FOR_AUDIT`/`ACCEPTED`，不得进入 R02。

## E12/R01 显式 Doubao Runtime 薄壳（2026-09-01；历史 VERIFYING，当前 BLOCKED）

| Source ID | 固定来源文件/符号 | 平台落点 | 保留/薄适配 | 当前状态 |
| --- | --- | --- | --- | --- |
| `OM-DOUBAO` | OpenMontage `tools/audio/doubao_tts.py::DoubaoTTS`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930` | `services/media-runtime/adapters/openmontage_audio/doubao.py` → `runtime.py::synthesize_doubao_narration_bytes` → `main.py` 显式 narration route → Worker client | 原 submit/query/download 顺序、URL、headers、body、voice/resource 覆盖、timeouts、status/error、metadata；平台只加内部 loopback 字段、bytes/MIME/SHA/size/ffprobe 和 secret/signed-URL 脱敏 | `IMPLEMENTED / BLOCKED（仅历史实现证据）` |
| `OM-TTS-SELECTOR` | `tools/audio/tts_selector.py::TTSSelector._providers/_select_best_tool`，同 commit | `selector.py` | 无 registry 时 auto/unknown fail-closed；显式 Doubao 需 `DOUBAO_SPEECH_API_KEY`，显式 Piper 保留既有 fallback；不新增本地排名 | `IMPLEMENTED`（registry/rank 正向映射仍 BLOCKED） |

- 真实 key 只从用户指定的仓库外 secret 文件/环境读取，未写入代码、文档、日志、fixture 或结果；voice/resource 使用 `zh_female_vv_uranus_bigtts` / `seed-tts-2.0`。
- 最新定向证据：Media Runtime Python `151/151`、Doubao/selector adapters `24/24`、Production Worker Runtime Client `23/23`，0 skip/fail；handler fixture 覆盖显式字段/MIME 与 auto fail-closed；Worker typecheck、`py_compile`、`git diff --check` 通过。
- 用户授权真实 Runtime smoke 返回 `audio/mpeg`、`37212` bytes、bundled ffprobe `1850ms`。这只是 source/profile 连通性和产物格式事实，不是中文口音人工验收、正式 NarrationAsset/TimelinePlan、native owner 或完整章节验收。
- 前述 `OM-DOUBAO MAPPER_ONLY/PARTIAL` 段落为授权前历史快照，保留作审计轨迹；当前代码事实以本节为准。E12/R01 不升级 `ACCEPTED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`，其它 section windows、AudioPlan、Studio、字幕和长旁白硬门继续阻断。

## 当前状态回收（2026-09-01；现行口径）

- E12/R01 当前为 `BLOCKED`：完整 owner、source registry/rank、正式 narration asset/TimelinePlan、approved section windows 和人工中文口音硬门未闭合。上节 `VERIFYING`、显式 route 与真实 smoke 仅保留为历史证据，不构成当前验收或新的外部调用授权。
- C12.4/C12.5 维持 `IMPLEMENTED_PENDING_AUDIT`。`OM-DOUBAO` adapter 仍隔离保留、默认不启用；`apps/production-worker/src/index.ts` 已移除 `MEDIA_RUNTIME_NARRATION_PROVIDER` 全局启动注入。

### 当前自动旁白输入和本机对照补充（2026-09-01）

- 新的自动旁白流程不要求用户上传音频或样音；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 仍是兼容角色和隔离测试事实，不是当前 spoken 输入。样音由 native Provider 或操作者显式选择的 Doubao 在服务端生成，人工审批后才可建立独立正式 NarrationAssetVersion。
- 用户已授权本机 Aiself Grok native 与显式 Doubao 对照；这只改变本机调用授权，不改变默认 Mock、章节状态或 Veyra/共享积分/VPS/Git 边界。既有 canary 和后续对照产物均须按技术事实与人工听看分开登记，不能直接写成 `ACCEPTED`。

## 2026-09-01 R01 native-first / explicit-Doubao canary（当前证据，未验收）

- 用户本轮明确授权：优先使用视频 Provider 原生音频；原生音频无法满足听感时，仅由操作者显式选择 Doubao TTS，不引入静默自动 fallback、第二公共协议或新的语速/时长算法。平台默认仍为 Mock。
- 固定来源仍为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/video/grok_video.py::GrokVideo.supports["native_audio"]` 与 `tools/audio/doubao_tts.py::DoubaoTTS`。原生 canary 通过既有 `sub2api:grok-imagine-video-1.5` 路径生成 `848x480`、`15.042s` MP4（`video/mp4`，`5071855` bytes），含一条 AAC 44.1kHz stereo 音轨；本地 bundled ffprobe/静音检查通过，但离线 Whisper 未形成可靠的中文台词证据，不能宣称口音/语义合格。
- 显式 Doubao Runtime canary 使用仓库外注入的 `DOUBAO_SPEECH_API_KEY`、`seed-tts-2.0`、`zh_female_meilinvyou_uranus_bigtts`，按 source submit→poll→download 返回 `audio/mpeg`、`157212` bytes、Runtime duration `7850ms`，ffprobe `7.848s`、24kHz mono；无 `>=0.5s` 尾静音，内部自然停顿约 `0.585s`，响度约 `-24.3 LUFS`、true peak `-9.3 dBFS`。密钥、task/request/url 未写入仓库或日志。
- 该证据只证明固定来源的 profile/链路/产物边界。source `TTSSelector._providers/_select_best_tool` 的 registry discovery/rank 尚未在平台 Runtime 正向映射；正式 `NarrationAssetVersion`、TimelinePlan/section windows、样音审批与人工中文口音仍为 `BLOCKED`。`OM-NATIVE-AUDIO`、`OM-TTS-SELECTOR` 保持 `PARTIAL/BLOCKED`，不得据 canary 升级 R01 或进入 R02。

## 2026-09-01 R01 分段旁白绝对时间窗薄适配登记（局部 IMPLEMENTED；未验收）

- 固定来源：OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_full_mix`（speech `start_seconds`、music ducking、`target_duration`、`apad/atrim`）及 Explainer Edit/Compose Director 的 section duration/tail coverage 规则。
- 平台落点：`services/media-runtime/runtime.py:2617-2625`、`apps/production-worker/src/media-service.ts:56-68,462-509`、`packages/persistence/src/approved-narration-timeline.ts:80-85,311`。仅把本地“section 必须等长”改为 source 语义：实测旁白不得超出绝对 PRIMARY 窗口；短旁白仅在已声明完整 MUSIC 或连续 HOLD/BROLL 窗口覆盖时进入现有 `_full_mix`；无覆盖仍 fail-closed。没有新增变速、裁切、静音、重规划、协议或 provider。
- 本地行为证据：Runtime `131/131`、Worker `27/27`、Persistence `20/20`，typecheck/py_compile/state validator 通过；全为 fixture/mock。用户项目分段复测产物 `.codex-longrun/media-review/maoshan-project-doubao-segmented-bgm-composed.mp4` 已登记于 test-log/progress，未新增真实 TTS/Provider/网络调用。
- 状态：R01/E12 仍 `BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`；正式 narration asset/TimelinePlan、source registry/profile、Studio 审批、REQUIRED 字幕和人工中文听感硬门继续保留，不进入 R02。

## 2026-09-01 13:44 R01 本地产物复核登记（不升级）

- 仅复核前条已登记的用户项目分段旁白合成产物与本地 Control API health；无新的来源代码、协议、Provider/TTS 调用或状态变更。
- 证据：产物 `848x480/30.084s/H.264/AAC mono 48kHz`，尾静音检测未发现 `>=0.5s` 区间；health/database=`ok`。R01/E12 仍 `BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

## 2026-09-01 P0/P1 源仓库未到位能力补齐登记（辅助回执，不升级状态）

| Source ID | 固定来源文件/符号 | 平台落点 | 本轮复用/薄适配 | 当前状态 |
| --- | --- | --- | --- | --- |
| `OM-AUDIO-FACTS` / N01 | OpenMontage 既有音频检查与 approved narration asset/window 规则；固定 commit `4eab34c5cfcccaa4f1970554928feccce73ee930` | `services/media-runtime/runtime.py`、`apps/production-worker/src/media-service.ts`、`packages/persistence/src/approved-narration-timeline.ts` | ffprobe format facts → canonical MIME；stream/format 时长各自 finite 且大于 0 后沿用 source-aligned `max`；保留 SHA/byteSize/正时长/absolute window；不猜扩展名或时长 | `IMPLEMENTED`；技术 `READY_FOR_AUDIT` 建议，inspect `3/3`（含 NaN/Infinity fail-closed）；restart/repeat/全量窗口证据待审计 |
| `OM-FULL-MIX` / N02 | `tools/audio/audio_mixer.py::_track_filters`、`_full_mix` | `services/media-runtime/adapters/openmontage_audio/full_mix.py`、Runtime/Worker ALCHMED8 | 仅补 source SFX 夹具；role/start/volume/fade/ducking/normalize/target-duration 顺序不变 | `IMPLEMENTED`；技术 `READY_FOR_AUDIT` 建议，完整组合/restart/repeat 待审计 |
| `OM-VOICE-PERFORMANCE` / N03 | `skills/meta/voice-performance-director.md`、`skills/pipelines/explainer/asset-director.md` | 现有 narration script/approval/formal asset/TimelinePlan 边界 | 发现现有 strict approval 契约不能承载实际 sample provider/voice/model/settings；不以 `piper-local/platform-generic-zh` 硬编码冒充来源 | `BLOCKED/DEFERRED`；需 ADR/契约边界、实际样音及人工 Sample Gate |
| `OM-TRANSCRIBE-SUBTITLE` / N04 | `tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py`、`tools/video/remotion_caption_burn.py::_render_ffmpeg` | `services/media-runtime/runtime.py`、`main.py`、`apps/production-worker/src/media-service.ts` | checked timestamps→source 8-word/42-char SRT→FFmpeg subtitles；仅追加 `-movflags use_metadata_tags` 令既有 marker 可被 MP4 ffprobe 复核 | `IMPLEMENTED`；技术 `READY_FOR_AUDIT` 建议，Worker 全链及人工/丰富模式待审计 |

本条为 N 执行清单的来源登记，不是正式章节状态账本。定向证据详见 `.codex-longrun/test-log.md`/`progress.md` 和《源仓库未到位能力补齐与 R-E 交叉验证执行文档》；未调用真实 Provider/TTS/Veyra/网络/VPS/付费服务，未执行 Git 写入。E12/R01 继续 `BLOCKED`，C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。

## 2026-09-02 原仓库语音表现与段落边界窄适配登记（辅助记录，不升级状态）

| 固定来源 | 平台落点 | 复用/薄适配 | 当前状态 |
| --- | --- | --- | --- |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`skills/meta/voice-performance-director.md`、explainer `asset-director.md`/`compose-director.md`、`tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::AudioMixer._full_mix` | `packages/creative-planning/src/index.ts`、`packages/domain/src/narration-quality.ts`、`packages/persistence/src/approved-narration-timeline.ts`、`apps/production-worker/src/media-service.ts:629-689`、`services/media-runtime/main.py`/`runtime.py` | 保留 authored multiline `provider_text`；单 cue 显式 Piper 传既有 segment metadata；Doubao/其它 provider 默认 cue 仅传 canonical text；非默认 delivery 无对应来源消费能力时 fail-closed。没有新增协议、算法、语速映射、静音填充、裁切或 UI。 | `IMPLEMENTED`（窄适配；正式 R01/E12 仍 `BLOCKED`） |

本条证据：Production Worker `66/66`、creative-planning `44/44`、Runtime 旁白窄测 `9/9`，Worker typecheck 与 diff check 通过；全部 fixture/mock 或 bundled media、0 skip、无真实 Provider/TTS/网络/Veyra/VPS/Git。多 cue/full-mix、正式 NarrationAsset/TimelinePlan/section windows、样音审批和人工中文听感仍未闭合；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

## 2026-09-02 原仓库结构化分段与旁白时间窗迁移（辅助记录，不升级状态）

| 固定来源 | 平台落点 | 复用/薄适配 | 当前状态 |
| --- | --- | --- | --- |
| Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`：`backend/workspace/skills/storyboard-breaker/SKILL.md`、`workspace/skills/prompt-generator/video-prompt/SKILL.md` | `packages/creative-planning/src/index.ts` 的 `extractDialogueLines`、`dialogueUnitsForCapacity`、`distributeDialogueLines`、`dialogueDurationSeconds`、`chooseGenerationSegmentCount`、`planSegmentDurations` | 保留作者多行 source unit 和顺序；按来源 8–15 秒及 `chars/4.5+2` 容量门规划；仅在单行已有句读/分隔标点处形成连续片段；无合法边界不任意切字而 fail-closed；使用既有 duration distributor，不改变 Provider/AudioPlan 契约 | `IMPLEMENTED`（规划窄适配；视觉 section owner/正式 TimelinePlan 仍 `DEFERRED`） |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`skills/pipelines/explainer/script-director.md`、`scene-director.md`、`voice-performance-director.md`、`asset-director.md`、`compose-director.md` | 同上私有 `dialogueLines`/`VoicePerformance` carrier 与既有 approved narration consumer | 保留 `provider_text` 与实测 duration 的下游事实边界；本轮不伪造 `script_section_id`、absolute window、独立 NarrationAsset、第二 AudioPlan 或完整 consumer | `PARTIAL / BLOCKED`（正式资产/时间窗硬门未闭合） |

- 最新定向行为证据：`pnpm --filter @alchemy-video/creative-planning test`=`45/45 pass`、`pnpm --filter @alchemy-video/creative-planning typecheck`=`PASS`、`pnpm --filter @alchemy-video/workflow-worker test`=`16/16 pass`；新增保险 AI 三行归属、同一行句读连续分配、无边界超长行 fail-closed、native prompt 不含邻段台词和逐段容量断言。全部本地 fixture/mock，无真实 Provider/TTS/网络/Veyra/VPS/Git。
- 旧等字符均分、固定 12 秒 seed、从视觉组重新抽取对白和任意字符切块均已移除/禁止；本条不声称 visual event 与正式 script section 已建立一一 owner。`hasCinematicEditorialBoundary` 等既有视觉评分仍是历史平台逻辑，不作为 Huobao 原规则的等价证明。
- 本条只支持技术 `READY_FOR_AUDIT` 评审候选，不自动切换状态；`E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 保持不变。实测音频、NarrationAsset/TimelinePlan、完整 AudioPlan/section windows、字幕、Studio 审批、重启/重复和人工中文听感仍为硬门。

## 2026-09-04 转场段不被强制锁上一段场景的 planner 修复登记（辅助记录，不升级状态）

| 固定来源 | 平台落点 | 复用/薄适配 | 当前状态 |
| --- | --- | --- | --- |
| Seedance-2.5：`skill/seedance-25/references/long-video.md` §Choose the route 路由表（continue same footage → Native extension / new scene → Intentional cut 或从 canonical references 重新生成）、§Continuity locks（转场段只携带身份/服装/道具等身份级锁）、§Extension with a cut or transition | `packages/creative-planning/src/index.ts` 的 `shotReferencePolicy`、`createMotionPlan` 的 `scene_lock` | 按段路由「延续 vs 转场」：延续段沿用既有 HANDOFF_FIRST_FRAME + 锁上一段交接帧场景；转场段（sceneId 与上一段不同，或本段文本含显式转场信号）改用 REFERENCE_SET，从 canonical 参考图锚定人物身份但不锁上一段场景画面 | `IMPLEMENTED`（规划窄适配） |
| Huobao：`backend/workspace/skills/storyboard-breaker/SKILL.md` 段落类型（过渡段含转场）、「scene_id 是段落级绑定」「scene_id 变化即新场景」 | 同上 `shotReferencePolicy` 的 sceneId 判定分支 | 以 `sourceShotBindings[sequence].sceneId` 与上一段 sceneId 是否不同作为转场的首要事实信号 | 同上 |
| OpenMontage：`schemas/artifacts/edit_decisions.schema.json` 显式 `transition_in`/`transition_out`、`lib/shot_prompt_builder.py` transition 场景不生成视频提示词 | `createMotionPlan` 的 `transition_in`/`transition_out` 表达位沿用现有字段 | 转场段 scene_lock 不再携带「沿用上一段场景」文案，仅保留身份级连续锁 | 同上 |

- 根因：`shotReferencePolicy`（自 commit `834c66b` 本地 MVP 基线起）对有参考图的多段视频第 2 段起无差别强制 HANDOFF_FIRST_FRAME，`scene_lock` 写死「沿用上一段场景」，不读取分镜转场意图——系本地自造逻辑，不来自任何上游。本次以 Seedance 路由 + Huobao scene_id + OpenMontage transition 概念替换。
- 边界：仅改 `packages/creative-planning/src/index.ts` 的 `shotReferencePolicy`/`createMotionPlan(scene_lock)`/调用点及其定向测试。延续段、首段（REFERENCE_SET）、无参考图（TEXT_TRANSITION）行为零变化；sceneId 缺失时 fail-closed 到延续段。未新增枚举值/正则/阈值/启发式评分/公开 API/UI/环境变量；未改 schema 字段、持久化、QC、media-runtime、TaskRun。
- 缺陷修正：首版误用全篇级 `hasExplicitSceneChange`（对整段 sourceText 测试）判定每段转场，会误伤延续段；已改为对本段文本 `group.join(" ")` 测试的按段判定，全篇级信号仍专供 `shouldSplitShortNarrative` 拆段用。
- 行为证据：`packages/creative-planning` 测试 `50/50 pass`、`tsc --noEmit` 通过；新增防回归用例证明「全篇含转场词但本段无→仍判延续段 HANDOFF_FIRST_FRAME」。全部本地 fixture/mock，无真实 Provider/TTS/网络/Veyra/VPS/Git 写入。
- 本条只作技术候选，不自动升级任何正式章节状态。真实项目「保险AI介绍」seg#2 的转场效果待用户验收确认。
