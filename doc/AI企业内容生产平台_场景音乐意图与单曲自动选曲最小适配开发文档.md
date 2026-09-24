# AI 企业内容生产平台：场景音乐意图与单曲 AUTO 选曲最小适配开发文档

版本：`0.1.0`

状态：`IMPLEMENTATION_AUTHORIZED / PENDING_AUDIT`

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

`scoreMusic` 的 token match、duration-fit 和本节 tie-break 都是平台薄壳；固定来源只支持“显式音乐意图、单曲覆盖全片、候选由制作方决定”。不得在文档或 UI 中称为 OpenMontage 原生智能推荐。若未来需要真正的逐场景多曲编排，必须另立设计并取得来源/用户授权。

## 7. 本轮定向证据（2026-09-23）

- `@alchemy-video/creative-planning`：93/93 pass，0 skip；覆盖旧三字段兼容、可选 `bgm_prompt`、坏类型/未知字段 fail-closed。
- `@alchemy-video/workflow-worker`：38/38 pass，0 skip；覆盖私有 PromptPackage `capabilitySnapshot.bgm_prompt` 保留。
- `@alchemy-video/persistence`：95 tests = 83 pass、12 skip、0 fail；覆盖分镜 sidecar 意图影响匹配、同 run 重试稳定、不同 run 同分候选可轮换、高分候选优先。12 个 skip 是既有 `DATABASE_URL` 集成边界。
- creative-planning、workflow-worker、persistence typecheck 通过，`git diff --check` 通过；本轮没有真实 Provider、Pixabay 网络、VPS 或 Git 操作。
