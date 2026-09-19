# AI 企业内容生产平台：自造逻辑核查与拆除报告

> 版本：v1.0（2026-09-17）
> 性质：只读核查 + 拆除方案。**未改任何代码。**
> 依据：`AGENTS.md` §2.2（原仓库优先与最小薄壳适配，尤其 2.2.3 禁止平行逻辑、2.2.5 来源缺口即阻断）、用户明确指令（不允许自造，例外须经同意）、三份上游固定 commit、`doc/` 现有登记与审计记录。

## 0. 核查结论摘要

1. 当前代码在「LLM 语义规划」这条链上存在**成体系的无来源自造协议**，核心是 `source_ownership` / `source_spans`（UTF-16 字符偏移）+ 连续覆盖校验。
2. 该协议**在三个上游仓库中零先例**（已逐个通读验证）。
3. 引入它的开发文档**自己就写明「来源没有定义本地 JSON envelope」**，却仍然实施——即**明知无来源仍新增**，违反 AGENTS.md §2.2.5「来源缺口即阻断：不以『先跑起来』作为自造逻辑的理由」。
4. 平台自己的纠错文档已把其中一部分标为 `UNREFERENCED`/冻结，但**另一部分（如 `inferPhysicalSceneConstraints`、`auditCameraCoverage`、`deriveCamera`）在全 `doc/` 中零登记、零审计**。
5. 新文档《原仓库自然语言导演分段与口播保真开发文档》证明：**存在完全由上游支持、无需自造的替代路径**。因此该协议不属于「不得不造」。

---

## 1. 是否违反了规则：是，违反了「来源缺口即阻断」

### 1.1 决定性证据：引入方自己承认无来源

引入 `source_ownership` / `source_spans` 的开发文档
`doc/AI企业内容生产平台_原仓库导演式语义分段与全局上下文移植开发文档.md`，其正文明确写着：

- 第 12 行：「来源仓库只贡献导演过程、`description`/`atmosphere` 分离、section/scene ownership、global/progression/locks/引用顺序；**来源没有定义本地 JSON envelope**，也没有定义本地压缩算法。」
- 第 18 行：来源表的第四列表头直接叫「**明确不声称来源定义**」。
- 第 20 行：在「不声称来源定义」一栏中列出「**本地 `source_ownership` JSON**、平台段数规则、压缩器或数据库字段」。

也就是说：**实施方知道这不是上游的东西，并把它标注为「平台定义」，然后照样接入了生产 LLM 契约。**

### 1.2 为什么「标注了」仍属违规

`AGENTS.md` §2.2 对这种情况的处置是明确的：

- **2.2.3 禁止平行逻辑**：不得为替代来源实现而自行发明算法、评分、阈值、时长策略、协议版本或回退路径。
- **2.2.5 来源缺口即阻断**：来源没有安全实现、语义无法证明时，**保持禁用、等待或 fail-closed；不以「先跑起来」作为自造逻辑的理由**。
- 项目自己的纠错文档 `doc/AI企业内容生产平台_当前程序源仓库纠错与逐章执行文档.md:45`：「不能指向固定来源的新增行为，**必须停止并标为 `UNREFERENCED`、`DEFERRED` 或 `BLOCKED`，不能先写完再补来源说明**。」

规则要求的是**停下来阻断**，不是「写清楚它是平台自造的，然后继续用」。**在表格里如实标注 ≠ 获得授权。**

### 1.3 是否属于「不得不造」

**不属于。** 依据：

- 新文档已给出上游支持的替代路径（LLM 返回自然语言提示词数组，平台不造 source unit）。
- 三份上游全部采用「自然语言提示词 + 平台保留骨架」模式，无一需要 ownership/span。

### 1.4 一个需要你确认的事实

现有文档中**没有见到你对该 envelope 的授权记录**。若当时你并未明确同意引入，则它属于**未授权自造**。
（我无法核实口头沟通，因此这一条以「文档无授权记录」为限，不作过度断言。）

### 1.5 公允的说明（不为其开脱，但应如实）

- 实施方**没有隐瞒**：在来源表中如实标注了「不声称来源定义」。
- 其动机是对一个真实问题的尝试性解决（无标签 source 中主题/风格/声音占用前段、视觉动作集中在后段）。
- 但**动机不构成授权**，且规则已明确规定该情形应阻断。

---

## 2. 现在的代码错在哪儿（逐项证据）

### A 类：无来源协议（必须拆除）

| # | 自造物 | 位置 | 证据 |
|---|--------|------|------|
| A1 | `source_ownership` / `source_spans` envelope 类型与解析 | `packages/creative-planning/src/index.ts:215-220`（类型）、`:435-495`（`readLlmFreeformPromptResult` 解析） | 强制 `exactKeys(value, ["source_ownership","segments"])`（:435） |
| A2 | 生产 LLM 系统提示强制返回该 envelope | `apps/workflow-worker/src/semantic-planning-client.ts:73-81`（`freeformPlannerSystemPrompt`） | 「返回 exact `{source_ownership,segments}`…`source_spans` 的 start/end 是 UTF-16 字符偏移」 |
| A3 | 旧 `{draft, sourceCoverage}` shape 及其解析 | `semantic-planning-client.ts:55-71`、`:158-167`；`creative-planning/src/index.ts:498-604` | `LegacyOpenAiCompatibleSemanticPlanningClient` 保留 |
| A4 | UTF-16 字符偏移 + 连续/无空洞覆盖校验 | `creative-planning/src/index.ts:1176`、`:1193-1226`（含 `:1208`、`:1214`） | 抛「Source ownership must cover each source unit exactly once」「VISUAL source spans must cover each source unit contiguously / without gaps」 |
| A5 | 「每个非 duration-only trailing segment 必须有 VISUAL owner」 | `creative-planning/src/index.ts:1341`、`:1176` | 强制每段有 visual owner |
| A6 | 强制逐字复制源句到 `beat.narrativeGoal`/`visibleFacts` | `semantic-planning-client.ts:70` | 「每个可见源句…至少各有一项必须逐字复制该源句」 |

### B 类：平台自造 source unit（必须拆除/替换）

| # | 自造物 | 位置 | 证据 |
|---|--------|------|------|
| B1 | 「source unit」由平台按标点切句派生 | `creative-planning/src/index.ts:1592`（`semanticSourceUnits`）→ `packages/domain/src/narrative-events.ts:52-55`（`splitSourceLine` 按 `。！？!?；;` 切分） | 上游无任何「把无标签 source 切成固定区间」的算法（三仓库验证一致） |
| B2 | 用该派生结果构造 `sourceEvidence` 并要求模型对其做 UTF-16 覆盖 | `semantic-planning-client.ts:93-94`、`creative-planning:1644-1661` | 模型被要求对平台自造的分段证明字符级覆盖 |

### C 类：无来源启发式（未被审计，需你裁定）

| # | 自造物 | 位置 | 现状 |
|---|--------|------|------|
| C1 | `hasCinematicEditorialBoundary` + `editorialCount` 评分式拆段 | `creative-planning/src/index.ts:2229-2243` | 已被纠错文档标 `UNREFERENCED`/冻结（`纠错与逐章执行文档:175`） |
| C2 | `inferPhysicalSceneConstraints`（水岸/下水启发式） | `creative-planning/src/index.ts:2218` | **全 `doc/` 零登记、零审计** |
| C3 | ~~`auditCameraCoverage`~~（复审计修正：**非自造**） | `creative-planning/src/index.ts:141` | 声称来源为 OpenMontage `lib/variation_checker.py`（已验证存在：`check_scene_variation` :26、slideshow 检测），本地 `openmontage-variation-audit.ts` 头部声明 commit 对齐。**定性：有来源、未在登记文档登记 → 登记缺失，非自造** |
| C4 | `deriveCamera` | `creative-planning/src/index.ts:1874` | **无来源声明 + 全 `doc/` 零登记**（注意：其上方 1865-1873 属另一函数，勿混淆） |
| C5 | `complexity_score = events×12 + beatCount×8` | `creative-planning/src/index.ts:2021` | **无来源声明 + 全 `doc/` 零登记** |

### D 类：合法保留（拆的时候不要误伤）

| 保留项 | 依据 |
|--------|------|
| LLM HTTP 客户端、超时、`response_format`、fail-closed、错误码映射 | 平台边界，`AGENTS.md` §4.2 允许 |
| huobao 的叙事节拍边界、对白时长下限（`chars/4.5+2s`）、`description`/`atmosphere` 分离 | huobao `storyboard-breaker/SKILL.md:19-22,36,48` |
| Seedance 的 prompt 形状、`@` 引用顺序、continue/new-scene 路由、continuity locks | Seedance `prompting.md:14,18`、`references.md:21,27`、`long-video.md:5-10,93` |
| openmontage 的 section→scene、五层提示词、`transition_in/out` | `scene-director.md:41,50`、`shot_prompt_builder.py:143`、`edit_decisions.schema.json:47-64` |
| 平台持久化/队列/工作区/审计（含 `production-repository.ts`） | `AGENTS.md` §4；这部分是平台必须拥有的外壳 |
| 口播逐字保真「硬门」本身 | 依据 = **你的明确要求** + huobao「**不要创作 description 之外的新台词**」（`prompt-generator/video-prompt/SKILL.md:25`，复审计确认的最直接来源；`storyboard-breaker/SKILL.md:48` 提供台词写入 description 的格式约定）。**不得引用 Seedance 作依据**（上游无此规则，已独立 grep 验证 0 命中） |

---

## 3. 应该怎么拆：完全反映原仓库的分步方案

原则：**先冻结、再替换、后清理**；每一步都指向上游具体文件/符号；无来源即阻断。

### 第 0 步：冻结（只标记，不改行为）

把 A1-A6、B1-B2 全部标为 `UNREFERENCED`，在纠错文档与来源登记中登记「无上游来源，待拆除」。这一步不产生代码改动，只建立账本。

### 第 1 步：LLM 输出契约回到上游形态

- **改**：`apps/workflow-worker/src/semantic-planning-client.ts`
  - 删除 `freeformPlannerSystemPrompt`（:73-81）与 `plannerSystemPrompt`（:55-71）中的 envelope 要求；
  - 改为顶层有序自然语言提示词数组 `["第一段…","第二段…"]`（新文档 §3.2）；
  - 保留 HTTP/超时/模型配置/fail-closed（平台边界）。
- **上游依据**：huobao `video-prompt/SKILL.md:12-18` 的自然语言 `video_prompt`；Seedance `prompting.md:14,18` 的四层自然语言模板；openmontage `shot_prompt_builder.py:143` 的五层平铺。

### 第 2 步：删除 source unit 自造与 UTF-16 覆盖

- **改**：`packages/creative-planning/src/index.ts`
  - 删除 A4/A5 的 span 校验路径（:1176、:1193-1226、:1341）及其错误信息；
  - 停止把 `semanticSourceUnits`（B1）当作「来源边界」；
  - 保留 `extractDialogueLines`（口播提取）——**它是硬门所必需，且 huobao 有对应语义**（台词来自 description、不得新增）。
- **上游依据**：三个仓库均无字符级覆盖概念；huobao 的边界来自**叙事节拍标记**（【开场】【触发】等，`storyboard-breaker/SKILL.md:19-22`）；openmontage 的边界来自**已有 script section**（`scene-director.md:41,50`）。

### 第 3 步：无边界时的正确行为

- 按新文档 §3.1：**无明确 `【镜头N】`、段落或其它来源边界时，平台不制造 source unit**；LLM 在既有片段骨架内自然组织画面。平台只校验最小可执行边界（数组长度、非空、可解码）。
- **依据**：新文档 §3.1/§6；上游无「无标签文本切分」先例。

### 第 4 步：口播保真的定位修正

- 保留口播逐字保真，但**如实登记依据**：
  - 来源：你的明确要求（用户规定）；
  - 部分上游支持：huobao「台词来自 description、不得创作 description 之外的新台词」（`SKILL.md:48`、`backend/src/agents/index.ts:127`）；
  - **明确不声称**：Seedance/OpenMontage 提供台词保真规则（验证结论：无）。
- **改**：`normalizeDialogueText`（`creative-planning:1491`）若会改变作者明确保留的字符/标点/换行，应在此边界 fail-closed，而非静默 normalize（新文档 §4.4）。

### 第 5 步：C 类启发式逐项裁定

对 C1-C5，逐项由你裁定三选一：
1. **删除**（无来源且非必要）；
2. **补来源**（能指向上游具体文件/符号）；
3. **保留为显式 `PLATFORM_OWNED`**（确属平台边界且你批准）。
**在你裁定前，保持冻结，不得使用。**

### 第 6 步：登记与验收

- 来源登记写入 `doc/..._第三方来源与复用登记.md`：固定 commit、薄壳适配点、**不声称来源定义**的部分必须显式划线。
- 行为测试：按新文档 §8.1/§8.2 建立离线 fixture 测试（数组长度一致、口播原文一致、显式边界顺序一致、异常响应 fail-closed、不新增切分算法）。
- 审计证据：`rg` 证明代码中不再存在 `source_ownership`/`source_spans`/UTF-16 coverage 与任何新增切分算法。
- 改动边界：严格遵守新文档 §7（只允许 `semantic-planning-client.ts`、`execution-service.ts`、`creative-planning/src/index.ts` 及测试）。

---

## 4. 拆除后的「上游映射」目标状态

| 能力 | 拆除后应由谁提供 | 上游文件 |
|------|----------------|---------|
| 片段数量 / 目标时长 | 平台确定性规划器（已有 duration policy，保持不变） | huobao `storyboard-breaker/SKILL.md:19-22,36`（语义来源） |
| 段落边界（有标记时） | 上游的**显式边界**：叙事节拍标记 / 【镜头N】 / script section | huobao `SKILL.md:19-22`；openmontage `scene-director.md:41,50` |
| 段落边界（无标记时） | **平台不制造**；由 LLM 在既有骨架内自然组织 | 新文档 §3.1 |
| 视觉提示词形态 | LLM 自然语言（顶层数组） | huobao `video-prompt/SKILL.md:12-18`；Seedance `prompting.md:14,18`；openmontage `shot_prompt_builder.py:143` |
| 参考图 / `@` 顺序 | 平台既有 reference binding（保持） | Seedance `references.md:21,27` |
| 延续 vs 转场路由 | Seedance 路由表 | Seedance `long-video.md:5-10` |
| 连续性锁保留项 | Seedance continuity locks 清单 | Seedance `long-video.md:93` |
| 转场提示词公式 | Seedance 转场公式 | Seedance `long-video.md:69-89` |
| transition 字段 | openmontage `transition_in/out` + `reason` | `edit_decisions.schema.json:47-64` |
| 口播逐字保真 | 用户要求（+ huobao 部分支持） | huobao `SKILL.md:48`；**不声称 Seedance/OpenMontage** |
| HTTP / 超时 / fail-closed / 持久化 / 审计 | 平台边界（保留） | `AGENTS.md` §4 |

---

## 5. 风险与不做的事（防止过度拆改）

- **不删除**平台边界（auth/workspace/queue/storage/audit/持久化），它们是 `AGENTS.md` 明确要求平台拥有的。
- **不删除**口播提取器与口播硬门；只修正其依据表述。
- **不删除** duration policy、segment count 规则（有 huobao 语义来源）。
- **不引入**任何新的切分算法、评分、阈值、fallback 来「补上」被删的 ownership —— 那会再次违反规则；无边界时按「平台不制造」处理。
- **不借本次改动**顺手重构 contracts / DB schema / Provider adapter / runtime-profile（新文档 §7 明确禁止）。

## 6. 待你决策

1. 是否确认 §1 的判定（违反「来源缺口即阻断」）？
2. C1-C5 五个启发式，逐项裁定删除 / 补来源 / 保留为 `PLATFORM_OWNED`。
3. 是否授权按第 1-6 步实施拆除（含多 agent 审查流程）。

---

## 7. 复审计记录（2026-09-17 23:58，应用户要求逐条独立复验）

复验方式：不依赖前期调研 agent 的结论，用直接 grep / sed 逐条独立验证，并专门搜索反证（用户授权记录）。

### 7.1 复验后成立（原结论维持）

| 结论 | 复验方式 | 结果 |
|------|---------|------|
| 三仓库 source_ownership/source_spans 零先例 | 直接 grep `source_ownership\|source_spans\|sourceSpan`（含 ts/py/md/json/vue/js） | huobao=0、seedance=0、openmontage=0 命中 |
| A1-A6、B1 全部行号与内容 | sed 逐行核对 | 与报告一致（含 :435 exactKeys、:1208/:1214 错误文案、:1341、domain:52-55 标点切分） |
| 引入文档自认无来源 | sed :12/:18/:20 原文 | 「来源没有定义本地 JSON envelope」+ 表头「明确不声称来源定义」+ 表内列「本地 source_ownership JSON」全部属实 |
| 迁移矩阵再次自认 | `多源仓库逐项迁移矩阵...:441` | 「不定义本地 envelope 或压缩算法」；该条目 `:437` 标注「历史记录：当时 ACCEPTED；现 HISTORICAL_SUPERSEDED」，**全文无用户授权表述** |
| 无用户授权记录 | 全 doc/ 搜索 `用户(同意\|授权\|批准).*ownership` | 仅命中一处无关条目（`章节审计记录:2752`，针对另一窄片的提交/部署授权）；导演式语义分段文档全文 0 次「用户」 |
| Seedance 无台词逐字保真规则 | grep `verbatim\|不得改写\|一字不差\|逐字` | skill/ 下 0 命中 |
| 纠错文档 :45/:175 引文 | sed 原文 | 属实（bash 显示乱码为编码显示问题，内容已核对） |

### 7.2 复验后修正（2 处）

1. **C3 `auditCameraCoverage` 定性修正**：原报告归为「无来源自造」。复验发现 `:139` 注释声明「Thin adaptation of OpenMontage variation_checker」，且 `upstream/openmontage/lib/variation_checker.py` 真实存在（`check_scene_variation` :26、slideshow 风险检测），本地 `openmontage-variation-audit.ts` 头部声明 commit 对齐。**修正定性：有可验证来源，仅登记缺失（非自造）。** 已更新 §2 C 类表。
2. **口播保真的 huobao 依据引用修正**：原报告引 `storyboard-breaker/SKILL.md:48` 与 `agents/index.ts:127`。复验确认最直接来源是 `prompt-generator/video-prompt/SKILL.md:25`：「台词/旁白从对应【镜头N】内…提取…**不要创作 description 之外的新台词**」。SKILL:48 只提供台词写入 description 的格式约定。已更新 §2 D 类表与第 4 步。

### 7.3 复审计总结论

**§1 的核心判定维持不变**：`source_ownership/source_spans` 协议无上游来源、无登记、无用户授权记录，且引入方文档自认「来源没有定义本地 JSON envelope」——按 AGENTS.md §2.2.5 应阻断而未阻断，属违反规则。C3 从「自造」改判为「登记缺失」后，C 类需用户裁定的项由 5 个减为 4 个（C1、C2、C4、C5）。
