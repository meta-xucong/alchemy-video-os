# AI 企业内容生产平台：场景音乐意图与单曲 AUTO 选曲最小适配开发文档

版本：`0.1.0`

状态：`IMPLEMENTED_PENDING_AUDIT`

日期：2026-09-23

## 1. 目标与范围

当前 AUTO 音乐每次都落到同一首曲目：现有选择器只使用 brief/style 文本与资产元数据的既有平台评分，并以创建时间作最终排序；它没有消费分镜级音乐意图，也没有在等价候选间轮换。

本轮只修正“音乐选择依据不足”这一问题，维持 OpenMontage 的单曲覆盖全片语义：

1. 移植 Huobao storyboard 的可选 `bgm_prompt` 分镜意图；它是简洁的音乐/氛围提示，不是多曲时间线。
2. 将每段的 `bgm_prompt` 作为内部 PromptPackage 音乐意图事实，汇入现有 AUTO 候选匹配文本；不改 Provider 提示词，不让画面描述冒充音乐意图。
3. 在得分完全相同的合格 MUSIC 候选中，以当前 production run id 做稳定哈希轮换：同一 run 重试得到同一首，不同新 run 在等价候选中不会永远固定最新创建曲目。
4. 保留现有 `MUSIC` 角色、workspace 资产边界、目标时长覆盖、手动曲目、OFF 和 Pixabay 单一路径。

本轮不做：按场景切换多首 BGM、BPM/相似度/情绪模型、同义词生成、随机选择、自动变速/循环/补静音、字幕/旁白/Provider/计费/VPS 改造。

本文件仅在“单曲 AUTO 候选的音乐意图补充与等分候选 tie-break”范围内取代《原仓库片段编排与媒体融合最小迁移开发文档》关于“不得新增音乐选择算法”的旧限制；该旧文档关于单曲覆盖全片、OpenMontage 音频映射、转场和其它范围的规则继续有效。

## 2. 固定来源与结论

| 来源 | 固定依据 | 本轮复用结论 |
| --- | --- | --- |
| Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md` 的分镜字段与质量要求；`backend/src/agents/tools/storyboard-tools.ts` 的 `bgm_prompt`；`backend/src/db/schema.ts` 的 `bgmPrompt` | `bgm_prompt` 是可选、简洁、分镜级音乐意图；不负责选曲或轮换。 |
| Seedance `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/SKILL.md`、`references/prompting.md`、`references/references.md` | 声音/BGM 意图必须显式，音乐属于 audio owner；未要求时不添加 BGM。 |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` | `asset-director.md`、`compose-director.md`、`tools/audio/pixabay_music.py` | 一条成片使用一首音乐并检查覆盖时长；Pixabay 负责 query→筛选→首条下载，没有场景评分、跨运行去重或轮换。 |

三份来源都没有完整的“按场景自动选曲 + 避免重复 + 曲目轮换”算法。因此下列哈希轮换是明确的 `PLATFORM_OWNED` 薄壳，仅用于等分候选的最终 tie-break，不冒充上游能力。

## 3. 实现契约

### 3.1 LLM/规划边界

- LLM 返回数组仍以 `duration_seconds`、`visual_prompt`、`dialogue_line_sequences` 为必需字段。
- 允许可选 `bgm_prompt` 字符串；无音乐依据时可省略。出现其它字段仍 fail-closed。
- `bgm_prompt` 只作为内部 source-aligned intent 进入 `PlannedShotSpec` 和 PromptPackage capability snapshot；不注入视觉 prompt，不改原始台词/画面事实。
- 空白 `bgm_prompt` 视为未提供；不做翻译、同义词、关键词扩写或情绪推断。

### 3.2 选曲边界

1. 先沿用现有 `READY + AUDIO + audio_role=MUSIC + workspace scope + object/SHA/MIME/byteSize + duration >= target` 谓词。
2. 评分文本由已有 `music_plan.style_hint`、brief/style 和各 segment 的 `bgm_prompt` 原文拼接；既有 token match 与 duration-fit 规则保持不变，仅补充来源事实。
3. 只在最高分候选内部按 `sha256(production_run_id + asset_id)` 的稳定顺序选择；同一 run 的重试顺序不变，不使用时间、随机数或全局历史表。
4. `MANUAL`、`OFF`、无合格候选和 Pixabay fallback 的现有语义不变。Pixabay 仍只在 AUTO 无合格本地候选时调用一次，不能因为“匹配分低”而额外联网。

## 4. 允许修改范围

- `packages/creative-planning/src/index.ts` 及其测试：可选 `bgm_prompt` 解析和 `PlannedShotSpec.bgmPrompt` 传递。
- `apps/workflow-worker/src/semantic-planning-client.ts` 及其测试：只补充可选字段的自然语言契约。
- `apps/workflow-worker/src/execution-service.ts` 及其测试：将 `bgmPrompt` 写入既有 PromptPackage 私有 `capabilitySnapshot`，不新增公开 API 或数据库列。
- `packages/persistence/src/production-repository.ts` 及其测试：读取已持久化 capability snapshot 的 `bgm_prompt`，并加入现有评分文本；抽取稳定 tie-break helper。
- 本文、来源登记和相关测试记录的最小同步。

不得修改 Provider 协议、公开 HTTP 字段、数据库 schema/迁移、AudioPlan、媒体 Runtime、Pixabay 网络路径、计费和部署。

## 5. 验收门

- 旧三字段 LLM fixture 继续通过；含合法 `bgm_prompt` 的 fixture 逐段保留；额外未知字段、非字符串意图 fail-closed。
- PromptPackage capability snapshot 在 workflow 测试中保留对应 `bgm_prompt`，未改变 prompt/台词/视觉字段。
- 生产组合：两个等分合格 MUSIC 候选在同一 run 选择稳定；不同 run 可在候选集合中选择不同曲目；高匹配分仍优先于轮换。
- MANUAL/OFF、不合格短曲、样音/USER_SOURCE_AUDIO 隔离和 Pixabay fallback 回归测试继续通过。
- 定向包测试、typecheck、diff 检查通过；不调用真实 Provider/网络，不宣称人工听感验收。

## 6. 审计边界

`musicMetadataTokens`、内容命中、duration-fit、标签优先、`scoreMusicAsset`、`selectAutoMusicAsset` 和稳定 tie-break 整套均为用户明确授权的 `PLATFORM_OWNED` 产品能力；它们不是 OpenMontage、Pixabay、Huobao 或 Seedance 的原生推荐算法。新生产任务只有在用户显式选择 `AUTO` 后才可运行，缺失模式必须拒绝，不能隐式 AUTO。固定来源只支持“显式音乐意图、单曲覆盖全片、候选由制作方决定”。不得在文档或 UI 中称为 OpenMontage 原生智能推荐。若未来需要真正的逐场景多曲编排，必须另立设计并取得来源/用户授权。

## 7. 本轮定向证据（2026-09-23）

- `@alchemy-video/creative-planning`：93/93 pass，0 skip；覆盖旧三字段兼容、可选 `bgm_prompt`、坏类型/未知字段 fail-closed。
- `@alchemy-video/workflow-worker`：38/38 pass，0 skip；覆盖私有 PromptPackage `capabilitySnapshot.bgm_prompt` 保留。
- `@alchemy-video/persistence`：95 tests = 83 pass、12 skip、0 fail；覆盖分镜 sidecar 意图影响匹配、同 run 重试稳定、不同 run 同分候选可轮换、高分候选优先。12 个 skip 是既有 `DATABASE_URL` 集成边界。
- creative-planning、workflow-worker、persistence typecheck 通过，`git diff --check` 通过；本轮没有真实 Provider、Pixabay 网络、VPS 或 Git 操作。

## 8. 审计返工记录（2026-09-23）

- 独立审计发现初版 tie-break 只对 `production_run_id` 做哈希，未把候选 `asset_id` 纳入摘要；已改为对每个候选计算 `sha256(production_run_id + asset_id)`，按摘要排序取首项，保持高分优先、同 run 重试稳定和无随机选择。
- 独立审计发现仓库中曾误提交含真实 Provider/relay 凭据的本地启动脚本；该脚本已删除，凭据不得进入源码、文档或测试。真实 Provider 仍只能通过本地未入库环境配置显式启用。
- 当前范围仍为 `PENDING_AUDIT`；本节修正已通过执行侧定向 persistence 测试和 typecheck，等待独立复审后才能升级状态。

## 9. 真实 Provider 端到端验证（2026-09-23）

- 使用本地完整栈的显式 `VIDEO_PROVIDER=sub2api`，真实 Grok profile `grok-imagine-video-1.5`，15 秒、480P、两张参考图、字幕关闭；未改 Git/VPS，也未把凭据写入仓库。
- 任务 `prd_01M36MHFPT5E3FJAM03C47HAN9` 完成 `GENERATING → REVIEWING → SUCCEEDED`；片段 `ACCEPTED`，视频版本 `vvr_01M36MSQWNRGQVD5RZWZCB7T04`，产物 `ast_01M36MRSZZEXMNRE0RMRPS3H5C`。
- 产物复核：H.264 848×480、AAC 双声道，视频/音频均约 `15.042s`，MP4 可下载播放；交付计划为 `caption_policy=OFF`。
- 该项目没有 READY 的 `MUSIC` 资产，因此本次真实成片验证的是“无合格本地音乐时不伪造 BGM、保留 Provider 原生音频”的分支；同分选曲、意图匹配和 Pixabay fallback 仍以定向行为测试为证据，不能把本次产物写成已验证自动选出具体曲目。
- 真实产物让本窄片具备端到端证据，但不改变总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`，也不替代人工听感和外部账本验收。

## 10. AUTO 来源元数据接通窄片（2026-09-23；实现前冻结）

### 10.1 目标与非目标

AUTO 当前只把 `mood/style/genre/selection_hint/bpm/metadata.filename` 送入已有 token match；漏掉既有 `metadata.tags`、Pixabay 查询和曲目标题，因此曲库里有标签的曲目可能与未分类曲目同分。本窄片仅把已经持久化的来源字段接入该选择过程，并让真实描述标签在同分时先于未分类曲目，再沿用逐 run 稳定哈希。

非目标：不生成或猜测标签，不做 LLM/音频分析/外部服务，不新增推荐算法、词典、阈值、评分权重或网络路径；不修改角色隔离、workspace 范围、时长谓词、Pixabay 来源选择/下载协议、公开契约、数据库 schema、Provider、Runtime、计费或部署。`Unknown` 等来源占位文本不得成为“已分类”依据，也不得作为可匹配标签。

### 10.2 固定来源与既有实现

| 依据 | 已有事实 | 本轮处理 |
| --- | --- | --- |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`，`upstream/openmontage/tools/audio/pixabay_music.py::PixabayMusic.execute/_parse_bootstrap` | query 是调用输入；来源结果提供 `title`、`artist`、`duration`、rating、download count 和 Pixabay id；来源没有平台音乐标签或 AUTO 推荐算法 | 保持来源选择、下载与结果含义不变；不伪造 tags/mood/style |
| 现有 `apps/control-api/src/pixabay-music.ts::HttpPixabayMusicClient.execute` 与 `apps/control-api/src/app.ts::importPixabayMusicAsset` | loopback 已传回 query/title；确认 Asset 时已保存 `pixabay_query`、`pixabay_title`、`source_title`、`source_artist`、`filename` 和来源统计 | 不增加 Provider/Runtime 字段；补回归断言，保证 query/title 可追溯 |
| `packages/persistence/src/production-repository.ts::scoreMusicAsset/selectAutoMusicAsset` | 已有 brief/style token match、duration-fit 与同分逐候选 `sha256(production_run_id + asset_id)` 稳定 tie-break；`metadata.tags` 也已用于现有非音乐资产排除判断 | 仅补齐现有字段输入与同分分类优先级；最高既有分数仍优先，分类优先之后继续原哈希 tie-break |

### 10.3 冻结行为

1. 既有匹配文本可消费 `pixabay_query`、`source_title`、`pixabay_title`、`filename`、`metadata.filename`、字符串字段 `genre/style/mood/selection_hint/bpm` 及 `tags` 字符串数组；保留当前 token match 机制，不对空值或占位 `unknown` 造标签。
2. 原 score 完全相同的候选中，具有至少一个非空、非 `unknown` 的现有分类字段（`tags/genre/style/mood/selection_hint/bpm`）者优先于没有此类字段者；`pixabay_query`、标题和文件名只提供可匹配原文，不单独伪装成已分类标签。
3. 同一分类层级仍按原逐候选 SHA-256 稳定排序；同一 run 重试保持稳定。`READY + AUDIO + audio_role=MUSIC` 隔离、workspace scope、已有资产对象完整性、目标时长覆盖与原 token score 均不变。
4. Pixabay 导入继续通过已有 Control API/Runtime 路径；确认写入已有 query/title/filename metadata。只补验证，不增加抓取、重试或 fallback 行为。

### 10.4 本轮允许文件与定向验收

- `packages/persistence/src/production-repository.ts`、`packages/persistence/tests/production-repository.test.ts`：补充来源字段匹配、`tags` 数组、真实标签优先于未分类同分、`unknown` 不构成标签、角色隔离/时长/稳定 tie-break 回归。
- `apps/control-api/tests/pixabay-auto-fallback.test.ts` 或 `apps/control-api/tests/pixabay-music.test.ts`：断言导入 Asset metadata 保留实际 query/title/source title/filename。仅当此行为测试暴露实现缺口时，才在已允许的 `apps/control-api/src/app.ts` 或 `apps/control-api/src/pixabay-music.ts` 做最小映射修正。
- 不新增 API、schema、迁移、Provider 字段、评分分支以外的选曲器或媒体分析；验收只使用现有 fixtures/mock，不调用真实 Pixabay/Provider。

本节是前述 3.2 “现有 AUTO 候选匹配与 tie-break”边界的最小补充；不改变本文其它来源、产品、媒体或章节状态。实现完成后仍需独立审计，不能自标 `ACCEPTED`。

### 10.5 执行证据（2026-09-23）

- Persistence `production-repository.test.ts`：最终 `10/10` pass；覆盖 Pixabay query/title、字符串 `tags` 数组匹配，`Unknown` 占位及非字符串 tags 元素排除，真实描述标签同分优先，MUSIC 角色隔离、目标时长覆盖及 run+asset SHA-256 tie-break。
- Control API `pixabay-music.test.ts` + `pixabay-auto-fallback.test.ts`：`12/12` pass；覆盖 loopback query/title 解码和导入 Asset 对 `pixabay_query`、`pixabay_title`、`source_title`、`filename` 的持久化；AUTO fallback/幂等、短曲、本地已有候选、MANUAL/OFF 和禁用 capability 回归。
- `pnpm --filter @alchemy-video/persistence exec tsc --noEmit`、`pnpm --filter @alchemy-video/control-api exec tsc --noEmit` 均退出 `0`；均为本地 fixture/mock，未调用真实 Pixabay/Provider、Veyra、网络或 VPS。
- 仅补已有选择器元数据输入与测试；Pixabay 导入器当前已写入 query/title/filename，故本轮没有改 `app.ts`、`pixabay-music.ts`、公共契约、数据库 schema 或 Provider/Runtime 协议。状态保持 `IMPLEMENTED_PENDING_AUDIT`，等待独立审计。
- 独立审计返工：首轮负向验证发现调用点先展开 `tags`、导致 helper 看不到原数组；现改为整数组传入，`metadata.tags` 只接受字符串成员。数字/对象夹具既不增加 token match，也不触发同分标签优先。返工后 persistence `10/10`、Control API 两项测试 `12/12`，两包 typecheck 重新通过；状态仍待独立复审。

### 10.6 独立复测返工：排除文件/运输泛词（实现前冻结）

- 触发事实：`filename=latest-selected-bgm.mp3` 中的 `bgm` 会与 brief 中通用的 BGM 用语相等，当前 token match 因此可能压过真正带音乐内容标签的曲目。
- 同一 `musicMetadataTokens` helper 必须在评分与“已有分类标签”判定中排除以下有限、逐 token、大小写归一后的泛词：`unknown`、`bgm`、`music`、`audio`、`latest`、`selected`、`pixabay`、`track`。这些词仅表示来源/运输/文件命名或未知占位，不计作匹配证据或已分类标签；不做子串排除，不新增通用词库。
- 保留 `instrumental`、`ambient`、`beauty` 等实际内容标签；保留 token 分数权重、duration-fit、最高分选择、显式标签同分优先、逐候选 run+asset SHA-256 tie-break、MUSIC 角色/workspace 隔离、时长过滤及 Pixabay fallback 原义。
- 必须补 filename-only 泛词负向夹具，以及 `instrumental/ambient/beauty` 正向夹具；若测试边界同时可观察分类层，证明这些泛词也不会触发分类优先。
- 非目标：不新增推荐算法、评分权重/阈值、用户可配置停用词表、自动标签或新的数据/协议/外部调用。审计返工证据只追加到本文及章节审计/来源登记，状态保持 `IMPLEMENTED_PENDING_AUDIT`。

### 10.7 真实 Provider 复测（2026-09-23）

- 使用重启后的本地完整栈与真实 `VIDEO_PROVIDER=sub2api`/Grok `grok-imagine-video-1.5`，复用 `30秒高端护肤品商业广告` 项目、两张原始参考图、批准分镜 `sbr_01M358EDJXA6E73BGEAQBVE4GG`；新建并批准交付计划 `dpr_01M36WA4F0QBRF84DY6HGBKD9B`，目标 30 秒、480P、字幕 OFF，`music_plan.mode=AUTO`、`style_hint=高级护肤品纯音乐 BGM`。
- 真实任务 `prd_01M36WB19YDPJS9CXNYNJCV0QD` 的 8/8 段均 `ACCEPTED`，最终 `SUCCEEDED`；版本 `vvr_01M36X2ZYBRS1KNGV0AS7Y81Y6`，成片资产 `ast_01M36X1S8V713WBE3D4NTNQ4ZF`。下载产物：`.codex-longrun/media-review/real-30s-commercial-bgm-generic-filter-prd_01M36WB19YDPJS9CXNYNJCV0QD.mp4`。
- `ffprobe`：`30.336s`、`848x480` H.264、48 kHz 双声道 AAC；Composition QC=`NEEDS_ATTENTION`（真实峰值 `-1.2 dB`，需人工复核），音频摘要 `has_audio=true`、`music_applied=true`、`unexpected_silence=false`。
- 本次实际选曲为 `freesound_723830_Upbeat-Country-Blues-loop-ver-3.mp3`，来源标签含 `cheerful/driving/dynamic/energetic/instrumental/uplifting`，不再被 `latest-selected-bgm.mp3` 中的 `bgm` 泛词压过；不宣称多模态或人工审美推荐。
- 真实 Provider 复测不改变公开契约、Provider 协议或正式状态；本窄片保持 `IMPLEMENTED_PENDING_AUDIT`，`E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变。人工听感与 QC `NEEDS_ATTENTION` 不被静态/技术证据替代。
- 实施复测：`pnpm --filter @alchemy-video/persistence exec tsx --test tests/production-repository.test.ts` `12/12` pass，覆盖 filename-only 泛词负向、真实标签正向、分类优先边界及此前 persistence 回归；`pnpm --filter @alchemy-video/persistence exec tsc --noEmit` 退出 `0`；`git diff --check` 退出 `0`（仅工作区 LF→CRLF 提示）。

### 10.8 AUTO 无内容命中时进入既有 Pixabay 单路径（2026-09-23；实现前冻结）

状态仍为 `IMPLEMENTED_PENDING_AUDIT`。本节只修正“候选仅满足时长或命中运输泛词时仍经 SHA tie-break 被选中”的边界；先前 3.2、10.1–10.7 对该边界的行为描述与测试结论均为历史实现记录，自本节起由本节覆盖，不代表该行为通过审计或 `ACCEPTED`。

#### 目标与非目标

- AUTO 本地选择必须至少有一个现有、非泛词音乐内容 token 命中。时长覆盖只证明候选可用，不是内容命中；候选都只有 duration-fit 或有限泛词时，不能交给 SHA-256 tie-break 随机式择曲。
- 无本地内容命中时，Control API 沿用已有 Pixabay import/query、来源时长筛选、首条结果与 Asset 确认路径调用一次；仍无满足既有 MUSIC 角色、MIME、SHA、幂等和目标时长约束的导入结果时 fail-closed。
- MANUAL 与 OFF 不进入这条 fallback。已有同幂等键回放不再次抓取或创建第二个 Asset。
- 不新增情绪/同义词、翻译、推荐评分、阈值、BPM 规则、音频分析、LLM 选曲、下载重试、第二曲库或 Provider/公开 API/schema/数据库状态变更。

#### 来源边界与实现口径

- OpenMontage 固定 commit `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/pixabay_music.py::PixabayMusic.execute` 只支持 Pixabay 查询、时长筛选和筛后首条结果；来源没有语义推荐、按内容命中本地资产或跨运行选择算法。
- 平台本地匹配只复用 `production-repository.ts` 已有描述性候选 metadata 字段、`musicMetadataTokens` 泛词过滤及 token-match 规则；`pixabay_query` 仅作为来源查询审计 metadata 保留，不是返回曲目的内容事实，也不参与命中。去掉“零内容命中仍返回 SHA winner”的分支。Control API 预检调用同一匹配 helper，并只使用现有可见 authored `music_plan.style_hint`、brief `stylePreferences` 与项目名；组合阶段仍消费已有 `musicIntentHints`。预检暂时读不到 PromptPackage 私有 sidecar，因此不得复制或新造读取通道。
- Pixabay query 仍从已有 authored `style_hint`、brief `stylePreferences` 或项目名中取一个原文值；不拼接或扩写关键词。导入后继续执行既有角色/MIME/SHA/幂等/时长验证；不因没有内容命中另选本地候选或随机取歌。

#### 定向验收与证据边界

- Persistence 行为测试证明只有 duration-fit/泛词的候选返回无选择；内容命中仍使用原评分与 SHA tie-break，高分/角色/工作区/时长隔离不变。
- Control API fixture 证明足时长但无内容命中的本地候选只触发一次现有 Pixabay 导入；OpenMontage 已按 authored query、duration filter 和 first result 完成选择/下载后，导入资产只按既有 MUSIC/对象/MIME/SHA/幂等/时长校验接受，不叠加平台 post-import 语义筛选；query metadata 保留用于来源审计；资产校验不合格时阻断；MANUAL/OFF 调用数为零。
- 所有验证使用本地 fixture/mock；不调用真实 Pixabay、Provider、Veyra、网络或 VPS。测试只能证明代码路径，不是来源网站当前可用性或真实曲目听感证据。

执行证据（2026-09-23，修正前计数，已由 10.9 覆盖）：Persistence `production-repository.test.ts` + `production-repository.native-audio.test.ts` 为 `28/28` pass；Control API `pixabay-auto-fallback.test.ts` 为 `7/7` pass；Persistence build、Persistence/Control API `tsc --noEmit` 与 `git diff --check` 均退出 `0`。fixture 覆盖无内容命中返回空、已有 `bgm_prompt` 匹配、Pixabay query 命中项目名来源、无匹配本地候选单次导入及回放不重复调用、首条曲目时长不足阻断、MANUAL/OFF 不调用。实现仍待独立审计；未执行真实 Pixabay/Provider/网络/Veyra/VPS 或 Git 写入。

### 10.9 独立审计返工：遵循 OpenMontage 首条 Pixabay 结果语义（2026-09-23；IMPLEMENTED_PENDING_AUDIT）

- 审计确认：`pixabay_query` 是 authored 搜索输入，不是本地候选的内容证据；Persistence 本地候选仍不因 query-only metadata 命中，故 AUTO 会按既有规则进入 fallback。该本地预检不改变 OpenMontage 的搜索结果语义。
- 审计同时发现此前添加的 post-import title/content matcher 是平台自造门：OpenMontage 已完成 query→duration filter→first result→download 后，Control API 又要求 track title 命中，可能拒绝原仓库已成功下载的 222 秒 MUSIC 首条结果。该门不属于来源能力，已移除。
- 当前最小实现：导入后仅按现有 `isUsableMusicAsset` 校验 MUSIC 角色、对象完整性及 MIME/SHA/目标时长等既有条件；不再以 title、`pixabay_query` 或其他内容词面命中拒绝来源首条结果。query metadata 仍保留用于来源审计。
- 为使最终组合消费同一首来源首条结果，Control API 将刚通过上述既有校验的精确 asset ID 写入现有内部 `production_runs.budget_guard` 音乐计划旁路事实；Persistence 仅对该指定 identity 绕过本地 content-match 门，仍先执行既有 MUSIC/对象/MIME/SHA/时长候选校验。没有此 identity 的本地候选继续要求内容命中；不改公开 API、schema 或 Provider 协议。
- 行为夹具：本地 query-only candidate 仍触发一次 Pixabay fallback；当 authored query 命中 brief 而已下载首条 title 不匹配时，只要其时长和既有资产条件合格，run 即成功；不合格短曲仍 fail-closed。该测试证明路径语义，不代表真实来源可用性。
- 本轮证据：`pnpm --filter @alchemy-video/persistence exec tsx --test tests/production-repository.test.ts tests/production-repository.native-audio.test.ts` 为 `29/29 pass`；`pnpm --filter @alchemy-video/control-api exec tsx --test tests/pixabay-auto-fallback.test.ts` 为 `8/8 pass`；Persistence build、Persistence/Control API `tsc --noEmit` 与 `git diff --check` 均退出 `0`。全为本地 fixture/mock；未执行真实 Pixabay/Provider/网络/Veyra/VPS。状态仍 `IMPLEMENTED_PENDING_AUDIT`，等待独立复审。

### 10.10 真实成片复测：有盖瓶子/盒子参考图（2026-09-23；IMPLEMENTED_PENDING_AUDIT）

- 独立审计 r3 通过后，重启本地完整栈，真实 Sub2API/Grok 30 秒、480P 任务 `prd_01M37BBA4PEK340490HJESPNBA` 成功：3/3 片段 `ACCEPTED`，最终合成 `SUCCEEDED`。
- 新 brief 仅绑定有盖瓶子/盒子图 `ast_01M32DFW9FWVB3TRRF6Y43CPVF`；无盖图 `ast_01M32DH0X2C8XJSYSQZFK6B900` 未进入本次输入。成片抽帧包含盒子、完整有盖瓶子、涂抹皮肤、实验室/城市镜头；未要求或推断打开瓶盖后的样子。
- 产物 `ast_01M37BKBMG8E1V24SMS1N29P36` / `vvr_01M37BMBSA4H2TYCXK6EF8H1DP`，`ffprobe-static`：H.264 848×480、30.126s、AAC 48kHz 双声道、4,181,164 bytes；Composition QC=`NEEDS_ATTENTION` 仍是人工质量复核门。
- AUTO 实际使用 Pixabay 首条合格曲目“武侠打斗纯音乐”（artist=`we-o_rd35ogy3mky6nohgw`），`music_applied=true`，integrated LUFS=`-16.3`，true peak=`-1.2dB`，`unexpected_silence=false`。这证明 fallback 与最终组合 identity 已闭合，但不宣称首条选择具备语义审美推荐；曲目是否适合护肤广告仍需人工判断。
- 本次真实运行不是模拟证据替代；正式状态仍 `IMPLEMENTED_PENDING_AUDIT`，不升级总体账本，不执行 GitHub/VPS 同步。

### 10.11 真实护肤片反馈收敛：查询语义与平台边界（2026-09-23；IMPLEMENTED_PENDING_AUDIT）

- 真实资产记录确认 Pixabay 请求使用的 authored query 是“高级护肤品纯音乐 BGM”，但 OpenMontage 固定实现仍按来源规则在时长筛选后取首条；返回标题“武侠打斗纯音乐”属于来源首条结果，不是平台新增的语义推荐或评分错误。平台不引入标题硬过滤、情绪评分或第二曲库；若需要审美保证，应由用户明确选择曲目/意图后人工试听。
- Provider prompt 边界修正仅去除 LLM 分段壳写入的 `本段开始`、`本段结束`、`按分段顺序承接` 三个默认字段，避免平台内部占位文本成为模型台词；源文本中用户明确写出的同名文字仍保留在 `source_prompt`。
- 自然语言导演规则补充：当源文本本身描述涂抹前后变化时，visual_prompt 必须保留源文已有的起始状态、动作和可见终点（例如泛红逐渐减轻、更均匀平整），不得只保留动作或擅自添加疗效。此为对 Huobao/Seedance “可见有序动作+明确终点”的薄适配，不是视觉效果算法。
- 本节只记录最小边界修正；不得据此宣称 Pixabay 已具备语义选曲或 Provider 必然生成疗效画面。仍需以真实产物与人工质量复核判断实际听感和画面呈现。
