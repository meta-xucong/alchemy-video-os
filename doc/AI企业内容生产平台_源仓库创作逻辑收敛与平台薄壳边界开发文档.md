# AI 企业内容生产平台：源仓库创作逻辑收敛与平台薄壳边界开发文档

版本：`2.3.0`

日期：`2026-09-24`

状态：`READY_FOR_AUDIT`

实现口径：`IMPLEMENTED / LOCAL_TECHNICAL_AND_INFRA_GATES_PASS / EXTERNAL_VALIDATION_PENDING`

主执行方案：`AI企业内容生产平台_反自造逻辑治理与源仓库收敛完整优化方案.md`

> **当前对账（2026-09-24）**：本文的来源边界已按主执行方案完成实现，并通过本地技术门禁及隔离 PostgreSQL/Redis/BullMQ/MinIO 集成回归；代码、配置、文档、安全历史净化和 Git 验收交付也已收口，G01 当前仍仅为 `READY_FOR_AUDIT`。原始 source 在 CanonicalSourceBundle 中冻结/hash 可追踪，exact dialogue 逐字保留；最终 Provider visual prompt 是 LLM 语义投影，不能描述成整体 source byte-for-byte 直传。deterministic planner 与旧 reference/object heuristics 仍在显式 Mock/历史兼容子路径中，不应宣称全仓删除。正文中的“当前失败/待实施”段落作为实施前证据保留；最新边界、外部凭据轮换要求和剩余真实环境证据见 `AI企业内容生产平台_反自造逻辑治理与源仓库收敛验收报告.md` 与 `AI企业内容生产平台_G01验收交接清单.md`。

前置专项审计：`AI企业内容生产平台_反自造逻辑与通用LLM边界专项审计报告.md`

执行门禁：完整修改顺序以主执行方案为准；本文保留固定 upstream 事实、局部边界和原五阶段证据，不再单独决定开工次序。

## 1. 目的与结论

本文件用于收敛视频创作链路，纠正历史开发中“把平台自造创作算法误写成固定源仓库能力”的问题，并给出可直接执行、可审计的代码收敛边界。

核心结论：

1. 真实 Provider 路径由自然语言 LLM 导演依据源文本和固定 upstream 原则决定分段、画面表达及必要镜头；平台本地代码不得另建平行导演算法。
2. 平台只保留身份、工作区、Control API、队列、持久化、Provider 适配、对象存储、错误映射、幂等、恢复和可验证校验等薄壳。
3. 无法证明来源、用户授权或平台边界必要性的创作推断必须 `fail-closed`。
4. “音乐智能匹配”是用户明确授权的 `PLATFORM_OWNED` 能力，可以保留，但不能宣称为 OpenMontage 原生算法。
5. 文档修订基线并非“实现尚未开始”：当时真实 LLM 与 Mock deterministic planner 仅部分隔离，参考图顺序、Prompt 超限处理和真实路径启发式尚未收敛；这些历史缺口现已按主执行方案处理并进入 `READY_FOR_AUDIT`。

最初的文档修订阶段未修改代码、公共契约、数据库、GitHub 或 VPS，也未调用真实 Provider；后续代码实施与验证记录以主执行方案、章节审计和验收报告为准。
## 2. 文档修订时的仓库基线

文档修订开始时的本地事实：

- 分支：`main`；HEAD：`36a7ceba08f2c62fbf9f78e77e56c6973ce5f07c`；与 `origin/main` 为 `+0/-0`。
- 工作区不是干净基线：已有 14 个 tracked 修改、1 个 tracked 删除（`apps/control-api/start-control-api.sh`）以及本文件这一未跟踪文档。
- 这些既有代码差异早于本次文档修订，不能归入“本轮仅新增文档”，也不能在后续收敛时被覆盖或回滚。
- 本文件描述的是当前工作区代码，而不是只描述 HEAD 或远端 `origin/main`。

实施前基线状态应表述为：

> 已完成部分真实/Mock 路径隔离和若干 fail-closed 校验；整体创作逻辑收敛尚未完成，不能宣称全平台 `ACCEPTED`。

当前实现状态以上方“当前对账”和主执行方案为准：代码已实现并通过本地门禁，但正式状态仍为 `READY_FOR_AUDIT`。

后续每一步修改前，都必须重新检查工作区差异并在现有改动上继续，不得把本文件当成“仓库无代码改动”的证明。

## 3. 固定 upstream 与准确来源事实

| 来源 | 固定 commit 与路径 | 可直接引用的事实 |
| --- | --- | --- |
| Huobao | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`；`backend/workspace/skills/prompt-generator/video-prompt/SKILL.md` | `description` 是画面、动作、台词和旁白来源；镜头顺序保持；不遗漏、不合并、不新增对白；一个 storyboard 段内允许连续子镜头。 |
| Huobao | 同 commit；`backend/workspace/skills/storyboard-breaker/SKILL.md` | storyboard segment 为 8–15 秒、通常含 2–4 个子镜头；按叙事节拍、场景转移和因果链组织；同时明确包含字数/时长容量公式。 |
| Seedance 2.5 | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7`；`skill/seedance-25/references/prompting.md` | 使用紧凑自然语言描述主体、可见动作、终点、一个有动机的镜头方案、光线、声音和关键锁；简单动作不强制时间戳。 |
| Seedance 2.5 | 同 commit；`skill/seedance-25/references/references.md` | 每个控制维度只能有一个 owner；`@` 标签必须逐字节保留，不得翻译、改号、重拼或静默替换。 |
| OpenMontage | `4eab34c5cfcccaa4f1970554928feccce73ee930`；`lib/shot_prompt_builder.py` | 将已有结构化字段映射为自然语言层；缺少字段时不应由平台另造事实。 |
| OpenMontage | 同 commit；`tools/audio/pixabay_music.py` | 搜索 → 时长筛选 → 无匹配时回退全部结果 → 取第一条 → 下载；不含语义推荐评分算法。 |
### 3.1 Huobao 公式的准确处理

Huobao 固定源码明确包含以下规则，不能再写成“upstream 没有字符数或固定时长公式”：

- 目标总时长约为剧本字数 ÷ 500 字/分钟；段落数约为总时长 ÷ 12 秒，允许一定浮动；
- 段落时长至少满足台词/旁白字数 ÷ 4.5 字/秒 + 2 秒表演余量；
- video prompt 还包含 3 秒网格及 `duration ÷ 3` 的内部时间段表达。

本项目的明确取舍是：

- 真实 Provider 路径不由本地 deterministic 代码用这些公式决定分段；
- 可以把 upstream 的容量原则作为 LLM 导演提示和结果合法性校验依据；
- 本地仅验证 Provider 时长上下限、总时长、台词完整性和可表达性，不按字符数机械切割用户源文；
- Mock fixture 可以继续使用 deterministic 规划，但不得被描述为真实创作能力。

### 3.2 Seedance 镜头判断的准确处理

Seedance 明确允许并要求“一个有动机的镜头方案”。因此边界不是“源文没写 camera 就绝不能出现 camera”，而是：

- LLM 导演可以依据源事实选择一个有动机、不过度、不会遮挡关键动作的镜头方案；
- 平台本地正则、关键词表或固定映射不得替 LLM 自动推导景别、角度、运镜、opening/closing state 或 transition；
- 用户已明确给出的镜头、动作终点和关键锁必须优先于 LLM 选择；
- 无法安全判断时应省略可选镜头信息或阻断，不得填入平台占位值冒充画面事实。

### 3.3 参考图顺序的准确处理

Seedance 的硬事实是 `@` 标签不可改号或替换。项目进一步确定以下平台规则：

1. 普通参考图的 canonical order 是持久化 `reference_bindings.position` 顺序。
2. 显式 handoff 场景可由平台建立 `[handoff, 原用户参考图顺序]`，但该顺序必须在 Prompt、snapshot、relay URL 和 Provider mapper 中保持一致。
3. snapshot 建立后不得再按 `SCENE/SUBJECT/STYLE` 角色进行第二次排序。
4. Prompt 中的 `image N` / `@图片N`、角色列表和实际 Provider URL 必须逐项对应。
5. 角色推断只能补充职责，不能改变 canonical order。
## 4. 统一分类口径

后续审计必须把每一项逻辑归入以下一类，不得混写：

### 4.1 `SOURCE_FACT`

用户原文、已批准项目事实、已确认视觉分析、显式参考角色、Provider 能力认证结果或固定 upstream 的直接行为。只能保留、校验和映射，不能改写其含义。

### 4.2 `SOURCE_GUIDED_LLM_DECISION`

固定 upstream 授权自然语言导演判断的内容，例如 narrative beat 归属、同场景子镜头组织、一个有动机的镜头方案和可见终点。只能由真实路径 LLM 作出，平台本地代码不得以正则或固定公式平行实现。

### 4.3 `PLATFORM_SHELL`

身份、权限、API、队列、持久化、状态机、幂等、重启恢复、relay、对象存储、MIME/SHA/ffprobe、错误归一化、PromptPackage/sidecar 和 Provider mapper。可以自建，但不得改变创作或媒体语义。

### 4.4 `PLATFORM_OWNED`

用户明确授权的平台能力。当前仅明确包括音乐 token 匹配、内容命中、时长适配、标签优先、稳定 tie-break 及其必要流程。必须在源码与第三方登记中明确标注，不能冒充 OpenMontage 原生算法。

### 4.5 `BLOCKED`

无法指向 `SOURCE_FACT`、`SOURCE_GUIDED_LLM_DECISION`、`PLATFORM_SHELL` 或明确 `PLATFORM_OWNED` 授权的行为。真实 Provider 路径必须禁用或 fail-closed。

## 5. 当前代码已具备的部分能力

以下是审计确认的当前事实，不再列为“尚未开始”：

- `apps/workflow-worker/src/semantic-planning-client.ts` 只在 Mock 模式创建 `DeterministicPlanningModel`；真实模式缺少 LLM 配置时返回 `LLM_PLANNER_UNAVAILABLE`。
- 真实 LLM 响应被限制为 `duration_seconds`、`visual_prompt`、`dialogue_line_sequences` 和可选 `bgm_prompt`。
- 当前校验要求台词编号完整、唯一、按源顺序，并阻止 visual prompt 复制完整 source 或逐字台词。
- `PLATFORM_OWNED_*` 占位值已有出站过滤；当前未提交改动还避免固定“本段开始/本段结束/按分段顺序承接”进入 Provider prose。
- Pixabay adapter 当前保持固定源码的搜索、时长筛选、无匹配回退、第一条下载顺序。
- AUTO/MANUAL/OFF 音乐语义及音乐角色隔离已有定向测试。

这些局部能力不等于整体完成；后续不得用单元测试绿色替代最终 Provider 输入快照审计。
## 6. 当前必须修复的已知冲突

### 6.1 参考图 canonical order 被下游重排

`apps/control-api/src/app.ts` 按 binding position 建立 reference 列表，但 `apps/task-worker/src/reference-delivery.ts` 又按 `HANDOFF → SCENE → SUBJECT → STYLE` 排序。现有测试还明确保护“SCENE 优先于 SUBJECT”。

这会造成 Prompt 中的 `image N` 与 Provider 实际第 N 个 URL 不一致。目标修复是删除 snapshot 之后的角色排序，并让 Prompt、snapshot、relay 和 Provider mapper 共用一份 canonical list。

### 6.2 Prompt 超限会静默删除 source 子句

`packages/provider-video/src/runtime-profile.ts` 的 `sourceCompactionPatterns` 会在 4096 UTF-8 字节超限时删除识别出的完整 source 子句。它不是按字节截断，但仍属于静默改写用户源内容，与本文件目标冲突。

目标规则：

1. 只允许删除可由 sidecar 证明属于平台生成的完整 `generatedPromptParts`；
2. `sourcePrompt` 字节必须保持不变；
3. source 本身超限时，先请求语义 planner 增加合法 segment；
4. 仍无法满足时返回 `PROMPT_BUDGET`，不得删句、摘要或改写。

### 6.3 真实路径仍经过带启发式的 compiler

真实 LLM 规划结果仍由 `DeterministicStoryboardCompiler` 投影；`packages/provider-video/src/prompt-compiler.ts` 还包含 `extractObjectNames`、`detectTransfer` 等正则推断，并可能生成对象实例、左右手转移和连续性 prose。

目标规则：

- 已确认的结构化对象事实可以映射为锁；
- 仅从用户自然语言正则猜测出的对象或转移不得进入真实 Provider prompt；
- 无结构化来源时省略该锁或 fail-closed；
- compiler 只拼接 allowlist 中的来源事实、LLM 决策和必要平台指令，不再承担导演职责。

### 6.4 平台 shell 过滤仍依赖固定字符串

`isPlatformBoundaryShell` 依赖“本段开始/本段结束/按分段顺序承接”三个精确中文值。该修复能挡住当前占位 prose，但不是稳定的类型边界。

目标是以结构化 provenance 或独立字段区分 source 与 platform shell；最终 Provider prompt 构建只能读取 allowlist，不依赖字符串猜测来源。

### 6.5 音乐能力的来源标注不完整

旧登记主要把哈希 tie-break 标为 `PLATFORM_OWNED`，但 token 提取、内容命中、评分、时长适配和标签优先同样属于平台自建能力。源码注释、第三方来源登记和音乐开发文档必须统一更正。
## 7. 目标实现边界

### 7.1 分段与自然语言导演

1. 输入以原始 description、明确段落、台词、场景绑定、参考角色和已冻结事实为准。
2. 真实模式由 LLM 判断 narrative beat、同场景子镜头归属、必要拆段和一个有动机的镜头方案。
3. 同一场景、同一因果链和连续动作优先放在一个 8–15 秒生成 segment 内；内部可用自然语言表达连续子镜头。
4. 只有明确场景转移、因果边界、Provider 时长上限或台词容量无法承载时才拆段。
5. 每段只携带本段事实和本段台词；不得复制完整剧本、完整台词集或全部全局约束。
6. 本地代码只验证响应 schema、时长边界、总和、台词覆盖、引用合法性和 Provider 能力，不决定创作归属。
7. 真实模式无 LLM、LLM 返回无法验证的结果或合法分段仍超限时，明确阻断。

### 7.2 Provider prompt

最终 prose 只允许按以下来源优先级组成：

`本段 SOURCE_FACT → 本段 SOURCE_GUIDED_LLM_DECISION → 必要 PLATFORM_SHELL 指令`

必要平台指令的 allowlist 限于：

- 已认证 Provider 必需的字幕/音频所有权指令；
- 与实际 URL 顺序完全一致的参考图角色声明；
- 已确认结构化事实对应的身份、道具和连续性关键锁；
- Provider 明确要求的参数语义。

禁止：

- 改写、翻译、摘要、截断或重复用户台词；
- 用正则新增用户没确认的人物、对象、左右手转移、功效、情绪、镜头或终点；
- 输出内部字段名、sentinel、占位 prose 或完整 motion sidecar；
- 以“安全优化”为名删除 sourcePrompt 中的内容；
- 将同一事实同时写入 source、visual supplement、motion prose 和 dialogue contract 多次。

### 7.3 Provider 与媒体合成

- 保留 Provider 字段 mapper、错误归一化、请求恢复和已认证 4096 字节边界。
- 保留 OpenMontage 已有的 `cut/crossfade/fade`、显式音频轨、全片音乐窗口、ducking、fade 和 loudness 参数映射。
- 混合转场、不同边界时长或 OpenMontage 不能等价表达的计划继续 fail-closed。
- 不新增第二套转场、自动变速、剧情节拍、任意静音修补或平行混音算法。
- OpenMontage 为合成所需的有限 `anullsrc/apad/atrim` 只作为已存在的媒体边界行为，不得被包装成创作决策。
### 7.4 明确授权的音乐匹配

允许保留：

- `musicMetadataTokens`
- `hasMusicContentMatch`
- `scoreMusicAsset`
- `selectAutoMusicAsset`
- AUTO 意图汇入候选选择、稳定重试和必要 Pixabay fallback

整套 token 匹配、内容命中、时长适配、标签优先和稳定 tie-break 均标记为 `PLATFORM_OWNED`。其边界为：

- `OFF` 不选择或导入音乐；
- `MANUAL` 只使用明确指定、通过作用域和媒体校验的 MUSIC asset；
- `AUTO` 只在明确音乐意图下运行，且不能把 narration sample、用户原音或普通 AUDIO 当成 MUSIC；
- Pixabay query 只是搜索来源，不是返回曲目语义正确的证明；
- Pixabay adapter 不加入本地评分、排序、随机化或多曲时间线；
- 不新增 BPM 模型、情绪模型、自动变速或随机选曲。

## 8. 允许修改的文件范围

| 目标 | 文件 |
| --- | --- |
| 真实/Mock planner 隔离与 LLM 投影 | `packages/creative-planning/src/index.ts`、`packages/creative-planning/tests/` |
| LLM 提示与 Workflow | `apps/workflow-worker/src/semantic-planning-client.ts`、`apps/workflow-worker/src/execution-service.ts`、`apps/workflow-worker/tests/` |
| 参考图 canonical order | `apps/control-api/src/app.ts`、`apps/task-worker/src/reference-delivery.ts`、`apps/task-worker/tests/`、相关 Provider mapper 测试 |
| Provider prompt allowlist 与对象启发式 | `packages/provider-video/src/prompt-compiler.ts`、`packages/provider-video/tests/` |
| Prompt 预算与 fail-closed | `packages/provider-video/src/runtime-profile.ts`、Workflow/Provider 对应测试 |
| 音乐匹配与来源登记 | `packages/persistence/src/production-repository.ts`、对应测试、音乐开发文档、第三方来源登记 |
| Pixabay 来源边界 | `apps/control-api/src/pixabay-music.ts`、`services/media-runtime/adapters/openmontage_audio/pixabay_music.py` 及对应测试 |
| 媒体合成回归 | `apps/production-worker/src/`、`services/media-runtime/runtime.py` 及对应测试；只有发现与固定来源不一致时才修改 |

不得在本方案下直接修改公开 contracts、事件、数据库 schema、计费、VPS、Git 历史或 Provider 协议。确需改变时，先新增 ADR 并停止当前实施。
## 9. 分阶段实施顺序与 Exit Gate

本文原五阶段保留，但必须在专项审计报告的 P0 清理阶段之后执行。P0 清理包括切断真实生产路径中的 deterministic 文档理解、事实选择、关键词参考图职责、对象/转移正则、source 二次解析、Provider 自造 prose、source compaction、伪连续性修复、前端自动审批和伪 QC 结论。

P0 Exit Gate：

- 真实模式缺少 LLM 或明确用户决定时 fail-closed；
- 不得回退关键词、正则、评分、固定类别或 deterministic semantic planner；
- 每项 LLM 决定必须带有效 source/evidence refs；
- 未检查结果不得写成 PASS、CHECKED、ACCEPTED、succeeded 或布尔 false。

P0 通过后，再按以下阶段顺序执行；每阶段单独审计，前一阶段未通过不得把后续改动混入。

### 阶段 1：统一参考图 canonical order

改动目标：

- 删除 Task Worker 在 snapshot 之后的 role-priority 排序；
- 普通引用保持 binding position；handoff 明确放在用户引用之前；
- Prompt 编号、role、asset ID、relay URL 和 Provider URL 顺序完全一致；
- 更新目前保护 `SCENE → SUBJECT` 重排的测试。

Exit Gate：至少覆盖普通 SUBJECT/SCENE、HANDOFF+用户引用、1–7 张引用、重启恢复和一次真实 mapper 离线快照；任何逐项错位均失败。

### 阶段 2：收敛 4096 字节处理

改动目标：

- 删除 `sourceCompactionPatterns` 及所有 source 子句删除路径；
- 只允许按 sidecar 删除完整 generated part；
- source 超限触发语义重分段；无法合法重分段时保持 `PROMPT_BUDGET`。

Exit Gate：对中文、多字节字符、台词、换行、重复 marker 和接近边界内容做 byte-for-byte 断言；不得出现 source 删除、截断、摘要或顺序变化。

### 阶段 3：收敛真实路径 compiler

改动目标：

- Deterministic planner 继续只服务 Mock；
- 将真实路径 compiler 改为来源 allowlist 投影；
- 删除或隔离真实路径中的对象名、左右手转移、镜头和场景正则推断；
- 以结构化 provenance 代替 `isPlatformBoundaryShell` 固定字符串判断；
- 保证每段 source、台词和 LLM visual decision 只注入一次。

Exit Gate：最终 Provider snapshot 不含 sentinel、内部 schema prose、整段 source 复制或未经确认的创作事实；无 LLM、无 provenance 或响应不可验证时明确阻断。

### 阶段 4：统一音乐 `PLATFORM_OWNED` 登记

改动目标：源码注释、测试名、音乐文档和第三方来源登记同时标明整套本地匹配算法的归属；不改变已通过的 AUTO/MANUAL/OFF 与 Pixabay 来源顺序。

Exit Gate：来源登记和代码逐项对应；不得出现“OpenMontage 智能推荐/评分”之类错误归因。

### 阶段 5：完整回归与真实 Provider 前审计

先运行静态、单元、跨包和必要集成测试，再生成离线最终 Provider 输入快照。只有所有前置门通过并另获用户对 profile、次数和额度授权后，才能调用真实 Provider。
## 10. 验收矩阵

以下“当前状态”是 2026-09-24 文档修订前审计结论，不代表目标已完成：

| # | 验收项 | 当前状态 | 完成标准 |
| --- | --- | --- | --- |
| 1 | 真实模式无 LLM 不回退 deterministic | 已通过 | 明确 `LLM_PLANNER_UNAVAILABLE/BLOCKED`，无第二 planner 调用。 |
| 2 | 同场景连续动作不被本地机械均分 | 真实 LLM 路径通过；Mock 例外 | 真实最终 snapshot 由 LLM segment decision 驱动，Mock deterministic 不可进入真实入口。 |
| 3 | 每段不重复完整 source 或完整台词集 | 单元测试基本通过 | 每个最终 Provider snapshot 只含本段事实和本段台词；跨段并集保持完整、顺序不变。 |
| 4 | 台词逐字、逐段、原顺序保留 | 单元测试通过 | 对 Unicode、换行、引号和多段台词做 byte-for-byte/序列断言。 |
| 5 | Prompt 编号与 Provider 图片 URL 顺序一致 | 失败 | canonical list 建立后不再角色重排；每个编号、role、asset ID、URL 逐项一致。 |
| 6 | `@` 标签不翻译、不改号、不替换 | 待最终快照验证 | 从 LLM 输入到 Provider mapper 全链路逐字节一致。 |
| 7 | 平台 sentinel/占位 prose 不进入 Provider prompt | 局部通过 | 不依赖固定字符串；出站 allowlist 和 provenance 测试全部通过。 |
| 8 | AUTO/MANUAL/OFF 音乐语义及角色隔离 | 已通过 | 现有行为保持，来源归属补全为 `PLATFORM_OWNED`。 |
| 9 | Pixabay 搜索/筛选/回退/首条下载顺序 | 已通过 | 与固定 OpenMontage 行为等价，安全薄壳不改变候选顺序。 |
| 10 | Prompt 超限不截断、不删 source、不静默改写 | 失败 | 只删完整 generated parts；source 不变；无法表达则 `PROMPT_BUDGET`。 |
| 11 | 无来源创作推断 fail-closed | 部分失败 | 真实路径无对象/转移/镜头正则推断；结构化事实缺失时省略或阻断。 |
| 12 | 媒体合成不产生第二套算法 | 当前未发现主要偏离 | 保持固定 OpenMontage 行为；无法等价表达的组合继续 fail-closed。 |

任何一项仅靠源码字符串命中、注释或 Mock 绿测，均不能判定通过。最终证据必须包含调用链行为测试和最终 Provider 输入快照。
## 11. 当前审计测试基线

本文件修订前已在当前工作区执行以下本地测试：

- `@alchemy-video/creative-planning`：94 passed；
- `@alchemy-video/workflow-worker`：38 passed；
- `@alchemy-video/provider-video`：70 passed；
- `@alchemy-video/task-worker`：49 passed，5 skipped；
- `@alchemy-video/persistence`：92 passed，12 skipped；
- Control API 定向测试：35 passed。

合计：`378 passed / 17 skipped / 0 failed`。

同时：

- `git diff --check` 通过，只有 LF/CRLF 提示；
- 测试前后工作区差异集合一致；
- 未调用真实 Provider，未修改数据库、GitHub 或 VPS。

这些结果只证明当前测试集没有失败，不能证明第 5、10、11 项已达标。被 skip 的数据库/BullMQ 集成测试以及尚未建立的最终 Provider 快照测试必须在对应阶段补齐。

## 12. 与旧文档的关系

本文件取代旧文档中下列冲突表述：

- 把 deterministic planner、固定容量公式、本地正则或 source envelope 宣称为真实 Provider 的源仓库导演算法；
- 认为 Huobao 不包含字数/时长公式；
- 认为 Seedance 禁止 LLM 作任何镜头选择；
- 认为当前代码收敛“完全尚未开始”；
- 认为参考图当前全链路不重排；
- 认为现有 4096 字节处理不会修改 source。

以下旧文档保留为历史证据，但冲突部分不再授权新增实现：

- `AI企业内容生产平台_原仓库导演式语义分段与全局上下文移植开发文档.md`
- `AI企业内容生产平台_原仓库片段编排与媒体融合最小迁移开发文档.md`
- `AI企业内容生产平台_原仓库语义分段与全局约束映射补全开发文档.md`
- `AI企业内容平台_长叙事自动编排与连续成片设计.md`
- 其它把本地启发式包装成 upstream 原生能力的文档。
以下规则继续有效：

- `AGENTS.md` 的源仓库优先、薄壳适配、工作区保护和 fail-closed 规则；
- `AI企业内容生产平台_领域模型与API事件契约.md`；
- `AI企业内容生产平台_本地MVP执行规格.md`；
- Provider、资产、任务、计费、权限和安全边界；
- `AI企业内容生产平台_场景音乐意图与单曲自动选曲最小适配开发文档.md` 中用户明确授权的音乐范围，但其来源归属须按本文件补正。

文档冲突优先级仍为：用户最新明确要求 → `AGENTS.md` → 公共领域/API 契约 → 本文件 → 其它专项或历史文档。

## 13. 执行禁区

在 G01 获得独立审计结论及相应外部/部署授权前，不得：

- 合并、提交、推送或部署本轮收敛代码；
- 调用真实 Provider；
- 修改数据库 schema、公共 DTO、事件或计费语义；
- 删除平台 Control API、workspace、queue、persistence、storage、relay、校验或恢复能力；
- 为了让测试变绿而放宽 fail-closed、改写源内容或新增另一套回退算法；
- 把现有未提交改动恢复、覆盖或归因到本文件。

## 14. 最终结论

正确的收敛方式不是“一次性删除所有平台代码”，而是：

> 真实创作判断交给 source-guided LLM；平台只做可验证薄壳；没有来源或授权的本地创作推断 fail-closed；音乐匹配作为明确标注的独立 `PLATFORM_OWNED` 能力保留。

P0/P1、原五个阶段、行为测试、最终 Provider 输入快照审计和隔离本地集成测试现已完成，G01 进入 `READY_FOR_AUDIT`。

下一步是独立代码审计；之后仍需经单独授权的真实 LLM/Provider、VPS、真实媒体语义 QC、人工质量和生产历史盘点。上述证据闭合前，不得标记全平台 `ACCEPTED`，也不得宣称生产可用。
