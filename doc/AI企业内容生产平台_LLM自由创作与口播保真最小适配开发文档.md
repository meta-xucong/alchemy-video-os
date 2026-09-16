# AI 企业内容生产平台：LLM 自由创作与口播保真最小适配开发文档

> 文档状态：`READY_FOR_AUDIT`（本轮实现与独立审计已完成；不等同于 `ACCEPTED`）
>
> 本文是对《AI企业内容生产平台_LLM语义Prompt规划与结构化校验重构开发文档.md》的受控修订：它只改变 LLM 的创作输出边界，不改变现有 Provider、计费、任务状态、公开 API、数据库表、事件或部署语义。旧文档中要求 LLM 返回完整 `draft/sourceCoverage/motionPlan` 的部分自本文件生效后标记为历史方案；预算 fail-closed、口播保真、参考图顺序、sidecar 和重启/幂等要求继续有效。

> 本文的生产 LLM 实现授权“仅补 `visual_prompt`、不得决定 source ownership”已由《AI企业内容生产平台_原仓库导演式语义分段与全局上下文移植开发文档.md》superseded。本文的 source-first、口播逐字保真、引用顺序和预算规则继续保留；当前生产 LLM 必须遵循新文档的私有 ownership envelope。

## 1. 用户要求与问题定义

用户要求原文：

> “我只要求原提示词中明确规定死的口播文案，要一字不差的保留，其他内容都可以由 LLM 自己思考，给出认为更合适的方法，没必要对结构化。”

现行 LLM 路线要求模型同时生成完整 `StoryboardPlanDraft`、`sourceCoverage`、motion/camera 结构、机事实和自然语言，导致模型在一次响应中同时承担创意和严格 schema 填充。已有真实 smoke 出现 JSON 非法、锁字段类型错误、coverage 与 shot 数量不一致等失败。失败时 fail-closed 是正确的，但该输出形状不适合稳定的自由创作。

本方案将创意与机器边界分离：

- LLM 只负责为已有的 provider segment 生成一段自然语言 `visual_prompt`；
- 原提示词中明确标注的口播由现有源解析器和规划器保留，LLM 不得改写、增删或重新分配；
- 结构化数据只保留现有平台为了传输、持久化、状态恢复和校验而必需的最小边界，不再要求 LLM 填充领域细节。

“完全不结构化”不可执行：Provider 请求仍需要 segment、duration、reference 和 prompt 字段，平台也必须知道口播是否完整。这里的目标是“创意非结构化、传输最小结构化”，不是删除安全边界。

## 2. 基线与范围

- 起始代码基线：`e3c078e7fef6c7a2050b946b854f36569ea7d4af`。
- 工作区已有未提交修改和未跟踪文件均视为基线，不覆盖、不回滚、不冒充本轮成果。
- 当前正式账本保持 `.codex-longrun/state.json` 的 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`；本方案不升级任何章节状态。
- 本轮只允许修改：
  - `packages/creative-planning/src/index.ts` 及其 LLM/编译器定向测试；
- `apps/workflow-worker/src/semantic-planning-client.ts`、必要的 `execution-service.ts` 适配和对应定向测试；
  - 本文及旧 LLM 文档的历史/交叉引用文字。
- 不允许修改 `packages/contracts`、数据库 schema、公开 HTTP/API、事件、Provider adapter、runtime-profile、计费、前端、VPS、AISelf、真实视频/TTS 或 Git。

本轮实际写入边界与上述一致：仅新增/调整 creative-planning 与 workflow-worker 的内部 freeform 适配及其测试；没有改公开契约、持久化 schema、Provider、运行时、计费、部署或正式状态。

## 3. 来源与复用边界

| 固定来源 | 可复用事实 | 本方案的最小适配 |
|---|---|---|
| Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` `prompt-generator/video-prompt/SKILL.md`、`storyboard-breaker/SKILL.md` | description 是唯一内容来源；镜头/台词顺序保留；一个 provider 片段承担自己的动作和段落 | 继续使用现有 source parser、已确定的 segment window；不让 LLM 改写台词 |
| Seedance `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` `references/prompting.md`、`references/references.md` | 提示词采用短自然语言层次；引用标签和输入顺序原样保留；只保留明确 critical lock | LLM 输出只是一段自然语言 visual prompt；reference transport 仍走既有顺序 |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` `lib/shot_prompt_builder.py`、`skills/creative/video-gen-prompting.md` | 按已有字段拼接五类提示；空字段不补造；不把复杂结构强塞进短提示 | 既有 compiler 仍负责平台字段 mapper；不声称 OpenMontage 提供 LLM planner |

三个上游都没有通用 LLM planner、自由文本协议或 4096 压缩器。因此新增的 LLM HTTP 薄壳和最小内部结果必须标记为平台适配，不能称为原仓库原码。

## 4. 目标设计

### 4.1 创意输出

LLM client 的私有响应只允许一个最小 envelope；这个 envelope 不是 `PlanningModelPort` 的返回类型：

```json
{
  "segments": [
    { "sequence": 1, "visual_prompt": "自然语言画面、动作、镜头和氛围描述" }
  ]
}
```

`LlmFreeformPromptPlanningModel` 先用现有 `DeterministicPlanningModel` 生成兼容骨架，再把 envelope 按序合并到骨架的内部可选 `PlannedShotSpec.visualPrompt`，最后仍返回既有 `StoryboardPlanDraft`。约束只有：

1. `segments` 必须按既有 segment 数量和顺序返回；不允许模型改变当前 duration policy 或公开任务结构。
2. `visual_prompt` 是自然语言，不要求 `shotSpecs`、`motionPlan`、`sourceCoverage`、hash、计数、对象锁或 camera schema。
3. LLM 不输出口播文本。编译器使用规划器已经提取的明确口播原文；如果 `visual_prompt` 重复完整口播行，则 fail-closed，避免双重发声。
4. 现有规划器/编译器把 source-owned narrative projection 和口播送入最终 prompt；其中只有明确口播要求逐字保真。`visual_prompt` 只是该 segment 的生成性视觉补充，不替换 source projection，也不声称对未标注视觉原文做 byte-for-byte 保真；不得把整段 `sourceText`、其它 segment 的 source projection 或当前段已经注入的 source projection 原样复制回补充文本。
5. 未知字段、缺段、乱序、空 prompt、非法响应、超时或 LLM 不可用均返回现有 `LLM_PLANNER_MALFORMED`/`LLM_PLANNER_UNAVAILABLE`，不自动修复、不重试、不回退到另一套生产规划逻辑。

### 4.2 兼容现有领域边界

现有 `PlanningModelPort.plan(input): Promise<StoryboardPlanDraft>`、`StoryboardPlanDraft`、`PromptPackage`、`capabilitySnapshot` 和持久化结构保持不变。为不改变公开/持久化契约，`PlannedShotSpec` 只增加一个内部、可选、未落库的 `visualPrompt` 适配字段；Workflow 在调用现有 `StoryboardCompilerPort` 时把它作为一段生成性文本传入。既有 duration、motion、reference、sidecar、hash 和状态机仍由确定性层负责。

现有 `DeterministicPlanningModel` 只提供兼容骨架（已确定的 segment 数、时长、source/dialogue 归属和旧领域字段），不是 LLM 失败时的 fallback：

- LLM 成功后才把 `visualPrompt` 附加到骨架并继续编译；
- LLM 失败时整个真实规划失败，不能返回骨架或旧的完整结构化规划；
- 本轮不让 LLM 修改 segment 数和 duration，以免同时改变分段语义、预算重规划和 Provider 负担；如需让 LLM 决定分段，必须另立契约和审计任务。

### 4.3 请求内容

LLM 请求使用既有 `SEMANTIC_PLANNER_*` OpenAI-compatible client，不新增 API key 或外部协议。`LlmFreeformPromptPlanningModel` 根据兼容骨架把私有 `segmentContext` 传给 client；LLM 不决定 segment 数。请求仅提供：

- 原始 source 文本和现有 source evidence；
- 已确定的 segment 序号、目标时长、该段 source narrative projection 和已解析口播行；
- 已有 style、reference role/anchor 和必要 provider budget 事实。

系统提示应明确：自由撰写视觉内容，不输出 JSON 之外的解释，不输出台词，不添加源文没有的人物/事实；但不得再要求完整 draft、coverage、motion/camera schema。响应必须使用合法 JSON envelope；无法满足时返回 `{}`，由调用方阻断。

### 4.4 最小确定性校验

确定性层只做以下检查：

- envelope 和字段 exact-key；
- sequence 覆盖既有 segments 一次且按序；
- `visual_prompt` 非空；
- 口播原文由现有 planner/编译器逐字保留，且视觉 prompt 不重复完整口播行；
- 视觉补充不得原样包含完整冻结 source、其它 segment 的 source projection 或自身已经由 compiler 注入的 source projection；无法证明归属时直接 `LLM_PLANNER_MALFORMED`，不在压缩器里静默删除；
- Provider UTF-8 budget 只由 Workflow 的实际 segment-local compiler/runtime 预检负责，避免在 LLM 层用完整 brief/fact/document 上下文再跑一套不一致的预算计算；预算失败仍沿用既有 `PROMPT_BUDGET` 语义重规划。
- 最终 compiler/runtime 继续执行现有 UTF-8 budget、reference 顺序、motion schema、sidecar、workspace、状态、幂等和错误映射。

不新增评分、相似度阈值、字符截断、自动改写、自动重试、fallback、静默删图或“看起来合理”的补字段。

## 5. 代码落点与唯一写入边界

### D1：creative-planning 内部适配

- 在 `packages/creative-planning/src/index.ts` 增加最小 `LlmFreeformPromptPlanningModel`（或等价内部实现），复用既有 `PlanningModelPort`、`DeterministicPlanningModel`、source/dialogue parser 和 `LlmSemanticPlanningError`。该模型先取得兼容骨架，再用 private `segmentContext` 调 client；不得把最小 envelope 直接当作 `PlanningModelPort` 返回值。
- 增加可选 `PlannedShotSpec.visualPrompt` 与 `CompilationInput.visualPrompt` 内部字段；不进入 `packages/contracts`、DB schema、公开 DTO 或事件。
- 保留旧 `LlmSemanticPlanningModel` 仅作为历史兼容实现；生产装配不得继续使用完整 raw schema。

### D2：workflow client/装配

- `apps/workflow-worker/src/semantic-planning-client.ts` 改为请求最小 `segments/visual_prompt` envelope；保留既有 URL、Bearer、HTTP、JSON、AbortController 和显式启用规则。
- `LegacyOpenAiCompatibleSemanticPlanningClient` 仅作为显式历史离线 fixture 的 raw-schema transport；`createSemanticPlanningClientFromEnv` 永不返回它，生产 real 分支只返回 freeform client/model。
- `createPlanningModelFromEnv` 在真实模式选择新的 freeform model；`VIDEO_PROVIDER=mock` 仍走确定性的既有 planner。
- `apps/workflow-worker/src/execution-service.ts` 只把内部 `visualPrompt` 传给 compiler；compiler 将它放在 `generated_prompt_parts` 的第一项（source projection 之后、既有平台 directives 之前），按原文本写入 `capabilitySnapshot` sidecar；不改变 persistence、scheduler、provider 或计费路径。持久化时不新增字段，内部适配字段在编译后自然消失。

### D3：测试

- creative-planning：最小 envelope 正向、字段/顺序/空 prompt/重复口播负向、source/dialogue 保真、LLM 不可用无 fallback。
- creative-planning：增加整段 source/跨 segment projection 原样回灌的负向行为测试；不得通过字符串截断或自动改写修复。
- workflow-worker：请求不再包含旧完整 schema 指令；segments context 原序传入；visual prompt 进入每个对应 PromptPackage；口播仍字节/文本原样。
- workflow-worker：只使用实际 `segmentFactPack` + sidecar 的 compiler/runtime 预算预检；不再在 freeform planner 内对完整 brief 上下文重复计算一套预算。
- provider-video/production-worker：只运行受影响的已有回归，不改变 runtime-profile 或生产契约。
- 真实 LLM/Provider/TTS 不进入普通测试；如需真实 smoke，另行取得授权并将其作为证据，不把一次成功视为稳定验收。

## 6. 审计与 Exit Gate

独立审计必须针对冻结版本核对：

1. LLM 是否只输出自然语言 visual prompt，而非又回到完整结构化 schema；
2. 明确口播是否由现有 source parser/编译器逐字保留，换行、标点、引号和顺序是否不变；
3. segment 数、时长、reference 顺序、sidecar、motion/hash、状态和公开契约是否未改变；
4. 是否新增了无来源评分、阈值、重试、自动修复、fallback、压缩或协议；
5. source 文本是否仍进入最终 prompt，visual prompt 是否只作为 segment-local 生成文本；
6. Mock/real 分支是否明确分离，LLM 失败是否安全阻断；
7. 测试是否绑定当前版本，未把历史 49/49、55/55、76/76 等计数冒充本轮证据。

Exit Gate 只能在 creative/workflow 定向测试、typecheck、diff 审计和必要的 sidecar 回归均通过后判 `READY_FOR_AUDIT`。以下事项仍保持 `BLOCKED`：真实 LLM 稳定性、DB→scheduler→runtime 完整行为、真实 Provider/E2E、人工中文口音/口播质量、正式 NarrationAsset/TimelinePlan 和整体 C12.4/C12.5 接受。未完成审计前禁止 GitHub 推送、VPS 部署或真实 Provider 调用。

## 7. 与旧方案的关系

旧文档《AI企业内容生产平台_LLM语义Prompt规划与结构化校验重构开发文档.md》：

- 关于 source-first、口播逐字保留、参考图顺序、UTF-8 budget、fail-closed、sidecar、状态/幂等和不调用真实 Provider 的规则继续有效；
- 关于“LLM 必须返回完整 `draft/sourceCoverage/motionPlan/camera` raw shape”的段落自本文件生效后标记为 `SUPERSEDED_BY_LLM_FREEFORM_PROMPT`；
- 旧文档中的真实 smoke 计数只属于历史版本，不得与本轮测试混用；
- D1/D2/D3/D4/D5 及 E12/R01 的正式状态仍以 state/formal/audit 三账本为准，本方案不自动升级。

## 8. 交付记录模板

```text
任务 ID：LLM-FREEFORM-20260914
CONTRACT_REV：v1.3.1-route-guard
COMPLEXITY_GATE：ESCALATE_REQUIRED
唯一写入者：executor（creative-planning + workflow-worker 指定文件）
AUDIT_OWNER：independent-auditor
基线：e3c078e7fef6c7a2050b946b854f36569ea7d4af + 工作区已有 dirty baseline
状态：DESIGN_DRAFT → IMPLEMENTED_PENDING_AUDIT → READY_FOR_AUDIT（不得直接 ACCEPTED）
禁止：修改公开契约/状态/事件、Provider/TTS/VPS/Git/计费、自动重试/fallback/截断/评分/新阈值
```

## 9. 本轮初始实现与独立审计记录（2026-09-14；历史快照，T06 纠偏见 §10）

- 实现结果：`LlmFreeformPromptPlanningModel` 已在既有确定性 segment/duration/reference/dialogue 骨架上，仅合并 LLM 返回的 ordered `visual_prompt`；真实模式 factory 选择 freeform，Mock 即使启用 LLM 环境仍保持 Deterministic；旧 raw client 仅显式历史 fixture 路径。
- 口播与边界：visual prompt 重复已解析口播时 fail-closed；既有 compiler 继续保留口播、段序、时长、引用顺序和 sidecar；visualPrompt 只进入内部 `generated_prompt_parts`，不进入公开/持久化 shot 字段。
- 定向测试（初始实现历史快照）：`pnpm --filter @alchemy-video/creative-planning test` = **81/81 pass, 0 fail, 0 skip**；`pnpm --filter @alchemy-video/workflow-worker test` = **38/38 pass, 0 fail, 0 skip**。该计数不代表 §10 纠偏后的最终复跑。
- 类型与差异检查：两个包 `typecheck` 均通过；`git diff --check` 通过。测试全部为本地 fixture/mock；本轮未调用真实 LLM、Provider、TTS、网络、VPS 或 Git。
- 独立审计：审计员对纠偏后的代码和测试结论为核心项“符合”；确认生产 client 仅接受 `LlmFreeformPlanningContext`、旧 raw 隔离、fenced JSON fail-closed、real/mock 分离、freeform timeout 与引用顺序证据齐全。审计未修改文件。
- 未闭合边界：真实 LLM 稳定性、DB→scheduler→runtime 完整行为、真实 Provider/E2E、人工口播/字幕质量、正式 NarrationAsset/TimelinePlan 和总体 `E12/R01=BLOCKED` 仍保持原状态；本窄片不是全平台 `ACCEPTED`。
- 发布门槛：依照 `AGENTS.md`，当前只具备 `READY_FOR_AUDIT` 候选证据，未取得正式 `ACCEPTED` 前不执行 GitHub 推送或 VPS 部署。

## 10. 2026-09-14 T06 提示词冗余纠偏（本轮）

- 根因核对：分段后的确定性 `source_prompt` 已按 `narrativeGoal + 本段 dialogueLines` 生成；真正可导致“每段带整段内容”的入口是 freeform LLM 的 `visual_prompt` 回灌，以及 freeform planner 对完整 brief/fact/document 上下文做第二次预算预检。前者会把同一源段落/其它段投影再次注入 `generated_prompt_parts`，后者可能与 Workflow 的 segment-local sidecar 不一致。
- 最小修正：`LlmFreeformPromptPlanningModel` 对完整 source、任一 source-owned beat/shot projection 的原样回灌 fail-closed；不做字符截断、摘要或静默删除。移除 freeform 层的重复 UTF-8 预算预检，预算唯一由 Workflow 实际 segment-local compiler/runtime 执行，从而沿用既有 `PROMPT_BUDGET` 递增语义重规划。
- 定向证据（最终复跑）：creative-planning `83/83`、workflow-worker `38/38`，creative-planning/workflow-worker typecheck 通过，`git diff --check` 通过；均为本地 fixture/mock，无真实 LLM、Provider、TTS、网络、VPS 或 Git。
- 本地历史茅山项目重新生成 planning revision `cbr_01M2FEPGKEPPENTH5EQ1A203TH` / storyboard `sbr_01M2FEPH0AJBF9J992AEGPY5SC`（未批准、未创建 production run）：两个 PromptPackage 分别为 `3810` 与 `3462` UTF-8 bytes，source sidecar 分别为 `348` 与 `119` bytes，均有 11 个 generated parts；SQL 行为核对确认第 1 段不含第 2 段口播，第 2 段不含第 1 段口播及第 1 段视觉 source。该证据只证明本地编译/持久化链路，不是 T06 真实 Provider 产物。
- 边界：历史已批准 PromptPackage 若没有私有 sidecar 仍按既有规则 fail-closed，不从旧 prompt 字符串猜 provenance；本轮不改 `runtime-profile`、公开契约、数据库 schema、任务状态或正式 `E12/R01` 账本。
