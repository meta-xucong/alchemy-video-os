# AI 企业内容生产平台：三仓库创作与音频合成最小迁移收敛开发文档

状态：`IMPLEMENTED_PENDING_AUDIT`
版本：`v1.0.0`（2026-09-28）
适用范围：视频创作提示词、分镜段落、参考图顺序、片段拼接、项目级 BGM 与原生音频的边界收敛。
本文件只授权“来源代码/规则的迁移 + 平台边界的薄适配”，不授权重新设计创作算法。

## 1. 目标与硬约束

本轮目标是把当前生产路径中可由三份固定上游明确支持的能力，收敛到同一条来源优先路径：

1. 用 Huobao 的分镜段落与叙事节拍规则承载段落，不再用平台自造的关键词、对象推断或机械均分替代创作判断。
2. 用 Seedance 的提示词结构、参考图声明、单一 owner 和声音意图规则约束每段提示词；原始引用标签、顺序和用户明确台词保持不变。
3. 用 OpenMontage 的 stitch、`audio_mixer.full_mix` 和明确的音频角色完成片段合成；项目级 BGM 只作为一条全片音乐轨。
4. 保留现有 Control API、workspace、权限、对象存储、队列、幂等、错误映射和审计，这些是平台薄壳，不改来源媒体语义。
5. 保留用户明确授权的 AUTO 选曲与 Pixabay 单次补曲；这部分登记为 `PLATFORM_OWNED`，不得写成上游原生推荐算法。

以下硬约束不可放宽：

- 固定来源以具体 commit、文件和符号为准；没有来源证据的行为保持 `UNAVAILABLE`、`DEFERRED` 或 `BLOCKED`。
- 不新增并行算法、评分、阈值、协议、公开字段、静默回退、自动 TTS、自动变速、补静音、字幕推断或音频分离。
- 原生 Provider 音轨是否包含 BGM 没有通用上游事实。保持其既有 owner，不猜成“纯人声”，由 OpenMontage `full_mix` 将其作为 source/SFX 与明确的项目级 MUSIC 轨混合；不做音频分离。
- 任何单段/多段行为都必须保留源文本、台词、参考图的原始顺序；不能用测试全绿掩盖来源无法证明的语义。

## 2. D/I/A 冻结

| 轴 | 冻结结论 | 理由 |
|---|---|---|
| D | `D1` | 三个上游分别定义分镜、提示词和媒体合成，但没有统一的 Provider 原生音轨所有权协议；需要先明确冲突边界。 |
| I | `I2` | 影响 creative planning、Provider prompt、Persistence composition input 和 Python Runtime，需保持跨层同一语义。 |
| A | `A1` | 需要核对来源复用、原生音频与 MUSIC 冲突、参考图顺序、重试和全片音频连续性。 |

本轮只有一个 writer；实现前必须冻结具体文件清单和 diff。独立审计员只读复核固定版本，不能审计自己的修改。

## 3. 固定来源矩阵

### 3.1 Huobao-drama

固定 commit：`f04d705603bd0257bcec6b8f44fd04ea3ea9b795`

| 来源位置 | 可迁移语义 | 平台适配 |
|---|---|---|
| `backend/workspace/skills/storyboard-breaker/SKILL.md` 的分镜段落定义与四步流程 | 一个 segment 是一个视频生成任务；段落承载 2–4 个子镜头；同一段不跨场景；先识别叙事节拍，再按动作/视角切子镜头。 | 把已存在的 storyboard/shot DTO 映射为平台 `ShotSpec`；保留 workspace、权限和持久化，不照搬 Huobao 的进程内状态。 |
| 同文件的 8–15 秒与台词容量规则 | 8–15 秒是来源段落边界；台词必须能在段内演完，不能把一句台词机械截断。 | 只在已启用 Huobao 段落路径使用；用户明确要求总时长不足 8 秒时保持一个精确单段，但仍尊重所选 Provider 已声明的 min/max 能力，不以平台规则覆盖真实能力。该短时长兼容必须单测并登记为边界适配。 |
| `description`、`result`、`atmosphere`、`bgm_prompt`、`sound_effect` 字段说明 | 画面、结果和声音意图是创作输入；声音字段是短而具体的意图，不是自动选曲器。 | 仅映射到现有 PromptPackage/MusicPlan 输入，不新增二次解析器。 |
| `backend/src/services/ffmpeg-merge.ts::mergeEpisodeVideos`（如当前分支使用） | 按 storyboard 顺序组织已生成视频，建立 concat 输入并输出标准 MP4。 | 仅负责对象字节/元数据/工作区隔离和错误映射；缺段不得照搬“跳过未生成镜头”的短剧语义。 |

Huobao 没有项目级 BGM 语义推荐、Provider 原生音轨分离或通用语义 evaluator；这些不能冒充来源能力。

### 3.2 Seedance-2.5

固定 commit：`ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7`

| 来源位置 | 可迁移语义 | 平台适配 |
|---|---|---|
| `skill/seedance-25/references/prompting.md` 的 default drafting flow 与 universal structure | 先确定单一意图，先声明参考图，再写主体/可见动作/终点；简单镜头使用紧凑结构，只加入保护身份、连续性、声音和交付所需的约束。 | Prompt compiler 只做字段拼接和安全映射，不做关键词评分、对象正则推理或段落重写。 |
| `references/prompting.md` 的 reference declaration | `@` 标签保持原拼写、语言、空格和数量；每个引用声明它控制什么、不能转移什么。 | 保持 `visualInput.references` 的原始数组顺序；role 去重只影响描述，不得重排真实图片与编号的绑定。 |
| `references/prompting.md` 的 sound policy 与 final quality pass | 明确 ambience/SFX/dialogue/music/silence；明确字幕和 BGM 意图；不输出无依据的通用质量词。 | 既有 provider prompt 只补来源所需的声音意图。若存在外部 MusicPlan，提示词声明 Provider 不额外生成 BGM；不能因此宣称原生音轨一定无音乐。 |
| `references/long-video.md` 的 extension/cut/continuity locks | 已有来源视频才可做认证的 extension；新场景使用 intentional cut；只携带必要的结尾/开头/身份/运动事实。 | 未认证 Provider 不伪造 extension；连续性不足时保持已有 cut/fail-closed，不新增桥接内容。 |

Seedance 不提供本地曲库选择器、Pixabay 推荐、后期音频混音或 Provider 音轨所有权判定。

### 3.3 OpenMontage

固定 commit：`4eab34c5cfcccaa4f1970554928feccce73ee930`

| 来源位置 | 可迁移语义 | 平台适配 |
|---|---|---|
| `tools/video/video_stitch.py` 的 cut/crossfade/fade-through-black 路径 | 先校验/归一化片段，再按明确 operation 合成；cut 是顺序拼接，其他 transition 必须已有 plan。 | 只接受已批准且可表达的 composition plan；不根据分数或默认阈值自动选择 transition。 |
| `skills/creative/video-stitching.md` 的 sequential stitching、AI clip chaining、audio continuity | 按叙事 sequence 排序；跨片段 BGM 作为单轨后混，不能每段重新起歌；连续性问题需要边界帧/真实事实，不能由“感觉相似”替代。 | 复用现有 Runtime/Worker 字节校验、对象隔离和 QC 投影；不可用的语义检查保持 `UNAVAILABLE/NEEDS_ATTENTION`。 |
| `tools/audio/audio_mixer.py::AudioMixer.full_mix`、`_track_filters` | 以 `speech`、`music`、`sfx`/`primary` 等角色接收轨道；支持 start、fade、ducking 和 normalize；一次 full_mix 组合全片轨道。 | 只传现有 AudioPlan 已明确的轨道；项目级 BGM 用一个覆盖全片的 `music` track；不切成每片独立 BGM。 |
| `tools/audio/pixabay_music.py::PixabayMusic.execute`、`_search`、`_parse_bootstrap` | query → 搜索页/会话 → bootstrap JSON；bootstrap 无结果时 HTML fallback；结果按 30–120 秒默认窗口筛选，无匹配时回退完整结果；选择筛选结果第一条并下载。 | 该来源逻辑只能由已有受控 Runtime adapter 调用；本地 MVP/当前正式总控未授权恢复外部网络补曲，因此本轮不启用 Pixabay fallback、不新增第二 scraper、不把它写成平台已验收能力。用户授权的 AUTO 选曲仍保留为既有 `PLATFORM_OWNED` 设计项，待对应章节和网络证据通过后再单独审计。 |

OpenMontage 也没有“原生 Provider 音轨一定是 speech”的事实。其 `grok_video.py` 只声明 `native_audio=True`，并不保证返回音轨不含 BGM。

## 4. 当前平台逻辑的收敛分类

### 4.1 允许保留的薄壳

- Control API 的认证、workspace 条件、幂等、对象存储和事件投影。
- `PromptPackage`、`AudioPlan`、`MusicPlan`、Runtime bundle、Worker 重启恢复等平台边界。
- `selectAutoMusicAsset`：既有用户授权的 `PLATFORM_OWNED` 选曲薄壳，只选择一条全片音乐，不冒充上游算法；没有合格本地曲目时只调用既有受控 Runtime Pixabay 路径，导入结果按明确资产身份复用，网络失败保持 `PROVIDER_UNAVAILABLE`。
- Provider profile 的能力开关、错误映射和“未认证即禁用”。

### 4.2 必须移除、禁用或降为 mock-only 的自建逻辑

以下行为若在真实生产路径存在，必须停止并回退到来源路径；不得用注释掩盖：

1. 通过关键词表、对象名正则、左右手/换手推断、情绪分数、文件名猜测来生成创作事实。
2. 用固定均分、平台自造上限或未经来源证明的时长公式替代 Huobao 的节拍/段落规则和 LLM 的自然创作判断。
3. 把一段完整 source/台词复制到每个子段，或在下游再次解析/改写已绑定台词。
4. 把真实图片按 role 重新排序，导致 Prompt 中 `image N` 与实际输入错位。
5. 为每个视频片段单独选一首 BGM，或在 stitch 后把每段音乐重新拼接成多首曲子。
6. 在没有来源事实时把 native audio 直接当成纯 speech；它保持 source/SFX owner，可与明确的全片 MUSIC 轨一起交给 OpenMontage `full_mix`，不得增加音频分离器或自动 TTS fallback。
7. 没有真实 evaluator/产物时创建 PASS、自动 repair、桥接内容或暗中改变 transition。
8. 用压缩器截断、全局折叠空白、追加固定 suffix 或删掉未证明的 source block 来绕过 Provider 上限。

确定只用于 Mock/兼容读取的旧逻辑可以保留，但必须在来源登记与测试中明确 `MOCK_ONLY` 或 `LEGACY_READ_ONLY`，不得让真实路径调用。

### 4.3 未被来源覆盖的边界

- 自动判断 Grok/KIE 等 Provider 原生音轨是否含 BGM。
- 原生音频分离、自动降噪、自动变速、补静音、口型同步和听感质检。
- 用视觉/音频模型自动决定 crossfade 时长或生成桥接画面。
- 通用 source registry/profile rank。

以上均保持 `UNAVAILABLE`、`DEFERRED` 或 `BLOCKED`，不能通过一次真实样片改写为通用能力。

## 5. 最小薄适配设计

### 5.1 创作与分镜适配

1. 输入仍来自用户的 authored source、已确认参考图和已有项目上下文。
2. Semantic Director/LLM 只负责按来源提示词结构生成自然语言视觉描述与段落决策；平台只校验 JSON 外形、原始台词逐字/顺序、参考图索引和来源允许的时间边界。
3. source 为空、台词映射不完整、参考图编号与输入不一致或 LLM 输出无法映射时，直接 `BLOCKED/FAIL_CLOSED`。
4. 不新增第二个确定性规划器；确定性 planner 只留给已有 Mock 测试。

这里的 source-first 指“保留 authored source 事实、台词和顺序”，不把平台现有的
`sourcePrompt`/`generatedPromptParts` 正规化结果宣称为原始 brief 的逐字副本；任何
无法证明的语义覆盖仍只能登记为 `UNAVAILABLE/BLOCKED`。当前 `sub2api:Grok` 的
能力快照若仍为 `enabled=false`，不得因为本文件而公开或提交真实 Provider。

### 5.2 参考图适配

1. 以 `visualInput.references` 的输入顺序为 canonical order。
2. Prompt 的 `@图片N`/`image N` 只由该顺序生成；role 描述可以去重，但不得改变真实 asset binding。
3. UI/Control API 可以保存 role 与用途，但不凭图片内容猜测“主体/背景/动作/道具”；未声明用途保持待确认或直接交给 LLM 的自然语言上下文，不制造对象锁。

### 5.3 声音与 BGM 适配

1. Seedance sound policy 只表达 `dialogue/ambience/music/silence` 意图；若 `MusicPlan=OFF`，明确不要求 Provider 生成 BGM。
2. `MusicPlan=AUTO|MANUAL` 时，现有选择器只确定一条 MUSIC 资产；这条资产必须作为项目级 full-track 输入，覆盖整个 composition target。
3. Runtime 调用 OpenMontage `full_mix`：使用已有 `speech`/`music` 角色、start、fade、ducking 和 normalize；不得建立 per-segment music graph。
4. `NATIVE_PROVIDER` 音频继续按原 owner 保留，并作为 OpenMontage `full_mix` 的 source/SFX 轨，与唯一项目级 MUSIC 轨共同混合；不把原生轨改名为 speech、不做音频分离、不建立 per-segment BGM。
5. 不新增音频分离、音轨识别或“先混再猜”的回退；所有混合仍由固定 OpenMontage `full_mix` 的既有角色、时间窗、fade、ducking 和 normalize 语义完成。

### 5.4 视频拼接适配

1. 按 `sequence` 排序，使用已存在的 Runtime stitch operation。
2. 同场景/连续动作默认只消费已有 cut plan；crossfade/fade-through-black 只能来自明确的来源表达字段，不能由新阈值推导。
3. 任何多个边界需要不同 transition 而现有 OpenMontage operation 无法表达时，直接 fail-closed，不新增 per-boundary 算法。
4. 片段缺失、MIME/SHA/duration 不一致、下载未完成或 workspace 不匹配时，不合成、不计费、不发布结果。

## 6. 允许修改的文件与禁止触碰边界

实现阶段只允许在下列已有模块内做最小修改；本轮文档阶段不改业务代码：

- `packages/creative-planning/src/index.ts`、`semantic-director.ts`：移除真实路径的自建 planner/字段推断，保留来源形状映射。
- `apps/workflow-worker/src/semantic-director-client.ts`、`semantic-execution-service.ts`：只保留来源提示词和校验边界。
- `packages/provider-video/src/prompt-compiler.ts`：参考顺序、声音意图、source-first 保真。
- `packages/persistence/src/production-repository.ts`：只收敛 composition input、AudioPlan 和 ownership fail-closed；保留 AUTO selector 的既有平台薄壳。
- `services/media-runtime/runtime.py`：只将既有 AudioPlan/CompositionPlan 映射到 OpenMontage stitch/full_mix；不写新的 FFmpeg 图。
- 对应包的定向测试、来源登记、章节审计和 progress/test-log。

禁止新增：公开 API/合同字段、数据库表或状态、第二音乐 scraper、第二评分器、Provider 协议、LLM 之外的语义模型、字幕/转场新算法、音频分离器、部署脚本、VPS/Git 发布操作。

## 7. 分阶段执行与验收门

### S0：来源与差异盘点

- 固定三个 commit，记录目标符号、当前调用点和预计删除/保留原因。
- 对每个“自建逻辑”给出 `REMOVE`、`MOCK_ONLY`、`PLATFORM_OWNED` 或 `BLOCKED`。
- 未完成盘点不得改代码。

### S1：创作/分镜收敛

- source/台词/参考图顺序行为测试。
- 非来源关键词、对象锁、机械均分在真实路径不得触发；Mock 负向隔离。
- 8–15 秒段落规则与短于 8 秒单段适配有明确测试。

### S2：拼接/音频收敛

- cut/明确 transition 使用 OpenMontage 路径。
- AUTO/MANUAL/OFF；一条全片 MUSIC；native owner 通过 OpenMontage `full_mix` 与该轨混合，AudioPlan tracks 按绝对 `start_ms` 保序。
- 不同段不重新起 BGM；重复事件和 Worker 重启不重复提交/导入。

### S3：独立审计与回归

- creative-planning、workflow-worker、provider-video、persistence、production-worker 定向测试。
- `pnpm typecheck`、`pnpm build`、`git diff --check`。
- 审计员以冻结 diff 为准返回 `PASS`、`FAIL` 或 `INSUFFICIENT_EVIDENCE`。

### S4：真实 Provider（后置）

仅在 S0–S3 通过并得到新的真实调用授权后，使用固定 30 秒/480P 项目做一次验证：

- 3 个片段均有 provider request ID、下载和技术 QC；
- 最终只存在一条全片 BGM track；
- native+MUSIC 只能走明确的 OpenMontage `full_mix` 轨道映射，不得把 native 音频改名为 speech 或创建 per-segment BGM；
- 产物状态、计费、重启恢复另按已有部署/共享积分门验收。

真实产物不能替代来源审计，也不能把人工听感写成技术 PASS。

## 8. 回滚与兼容

- 不改公共合同和数据库 schema；任何需要改合同的发现都返回主控重新冻结。
- 保留旧 ALCHMED 兼容读取，但新任务只写现有完整 AudioPlan；不能并行写第二套音乐计划。
- 若某个来源能力不兼容，关闭该能力并使用现有安全失败路径；禁止恢复被删的自建算法作为静默 fallback。
- 每个阶段单独冻结 diff，失败只回退该阶段的改动，不回滚用户已有无关改动。

## 9. 当前状态与证据口径

- 远端 `origin/codex/g01-audit-handoff-20260924` 当前与 `HEAD=6826dc1` 一致，已保存已提交快照。
- 工作区存在既有未提交改动；按 `AGENTS.md`，在本章审计通过前不得把它们直接提交或推送。
- 本文是设计材料，不等于代码已迁移，也不等于真实 Provider、VPS、计费或人工质量已通过。
- 当前总账 `E12/R01=BLOCKED`、`C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 保持不变；不得因本文创建而升级章节状态。

## 10. 来源登记要求

实现完成后必须在《第三方来源与复用登记》及《章节审计记录》中逐项登记：

- 固定 commit、文件/符号和实际复用方式；
- 平台薄壳的输入输出边界；
- 删除或降级的自建逻辑及对应负向测试；
- AUTO/Pixabay 作为 `PLATFORM_OWNED` 的明确授权；
- native audio 未知所有权保持 fail-closed 的证据；
- 测试计数、skip、真实调用和未完成硬门。

未具备上述证据时，状态只能是 `IMPLEMENTED_PENDING_AUDIT` 或 `BLOCKED`，不得写成 `ACCEPTED`。
