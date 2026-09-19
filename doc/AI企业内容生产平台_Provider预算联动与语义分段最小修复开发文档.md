# AI 企业内容生产平台：Provider 预算联动与语义分段最小修复开发文档

> 状态：代码切片 `ACCEPTED`；VPS 账户桥接/真实 Provider `DEFERRED`
> 任务 ID：`seg-replan-20260912`
> 基线：`411ea5faa6968e7cc0528721c4e2bb61715412d6`；工作区已有未提交改动属于基线，不覆盖、不回滚。

## 1. 用户目标

用户要求在保留现有智能分段和 4096 UTF-8 保护的前提下，修复“提示词预算超限后递增分段导致内容重复、段落窗口重叠、剪辑不顺”的问题，并完成开发文档、独立审计、代码审计、模拟测试和一次真实 Provider 生成测试。

本轮只解决分段规划与预算联动的最小缺口。代码切片的验收以固定来源、独立审计和本地模拟证据为准；AISelf 账户桥接、VPS 环境和真实 Provider 产物属于部署后的独立集成门，明确延后到 VPS 登录态下验证，不伪造或复制登录态。

## 2. 目标与非目标

### 2.1 目标

1. 目标时长在当前 Provider 单段能力内且提示词未超限时，继续只规划一个 Provider 片段。
2. 只有当前 Provider 时长上限或 `PROMPT_BUDGET` 预检要求时，才沿用现有 `minimumGenerationSegmentCount` 递增重规划。
3. 每个生成片段消费连续、保序、互不重叠的叙事事件窗口；同一事件只能归属一个片段。
4. 预算重规划请求的段数超过可表达的源事件数量时，不递增到不可表达的段数，沿用已有无进展/fail-closed 路径；普通时长上限导致的续段仍可保留，但续段不复制源叙事事件文本。
5. `beats.generationSegmentSequence` 与 `shotSpecs[].narrativeBeatSequences` 必须来自同一窗口边界，不能因为不同的索引公式而错位。
6. 每个片段只携带自己的视觉动作和自己的对白窗口；全局连续性/参考图规则仍作为共享约束，不变成新的叙事事件。

### 2.2 非目标

- 不删除智能分段机制，不把所有请求强制变成单段。
- 不修改 `runtime-profile` 的 4096 保护、压缩语义、sidecar、错误码或 Provider 适配器。
- 不修改公开 HTTP/事件/数据库 schema、任务状态、计费、字幕、TTS、BGM、参考图协议或 UI。
- 不新增字符切片、评分器、语速/时长修正、静默填充、自动改写、Provider 回退或新阈值。
- 不把 Grok 的 1–15 秒能力泛化为 Seedance 或其它路由的能力；Provider 差异只由现有 profile 表达。
- 不在模拟测试前调用真实 Provider；不执行 Git 提交、推送、VPS 或部署操作。
- 本轮不把 AISelf 账户桥接、VPS 登录态或真实 Provider 产物作为代码切片 `ACCEPTED` 的前置条件；这些只可在正式 VPS 集成测试中验证，未验证前保持 `DEFERRED`。

## 3. 固定来源与可复用边界

| 来源 | 固定内容 | 本轮映射 | 边界 |
|---|---|---|---|
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` `backend/workspace/skills/storyboard-breaker/SKILL.md` | 先识别叙事节拍；节拍/因果链边界优先；一个分镜段落是一个生成任务；段内承载多个子镜头；台词不得塞入演不完的段落 | 继续使用现有 `extractNarrativeSentences`、`distributeDialogueLines`、时长/容量校验；修正同一事件的段归属 | 不按字符切源，不添加新的词速、评分或节拍识别器 |
| `huobao-drama` `prompt-generator/video-prompt/SKILL.md` | 以 description 为唯一来源，镜头顺序保留，时间轴不遗漏/重排 | 每段 prompt 只使用本窗口的 `narrativeGoal`/motion beats，保留原序 | 不把旁白或全局约束重新当作视觉事件 |
| `Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` `references/long-video.md` | 时间相位、起止状态、连续性锁；不要重演已完成动作；新场景才切段/延长 | 片段窗口与 `startState`/`endState`、既有交接策略保持一致 | 不新增 Seedance 之外的长视频协议或强制时间戳 |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` `skills/creative/video-gen-prompting.md`、`lib/shot_prompt_builder.py` | 五类提示结构、短提示更易留出创作空间、避免一个片段承载无关多场景 | 只修规划窗口；继续使用既有 compiler 的五类字段与短结构 | OpenMontage 没有通用 4096 压缩或自动重规划算法，本轮协调逻辑不是上游原码 |
| 当前 `runtime-profile`/Workflow sidecar | 预算预检、`PROMPT_BUDGET`、`source_prompt/generated_prompt_parts` | 仅用既有错误触发规划重跑；最终快照继续保持 source-first | 不通过字符串猜 provenance，不改变压缩器 |

## 4. 现状根因（基线证据）

1. `apps/workflow-worker/src/execution-service.ts` 已在 `PROMPT_BUDGET` 后递增 `minimumGenerationSegmentCount`，但它复用的 planner 尚未证明每轮输出的视觉窗口不重叠。
2. `packages/creative-planning/src/index.ts` 的 `distributeEvents` 使用连续索引切片，但 `beats` 使用另一套 `floor(index * count / eventCount)` 计算；在 `eventCount=5,count=4` 时，第二个事件会被标给第 1 段，而实际窗口在第 2 段，产生 beat/shot 错位。
3. 当 `count > events.length` 时，现有 `shotSpecs` 用最后一个事件回退填充空组，必然把同一视觉事件复制到多个片段。
4. 现有自适应循环解决的是“能否通过预算预检”，不是“每段承载哪个源窗口”；因此必须只修窗口边界与归属，不新增第二套规划算法。

## 5. 冻结的最小实现

### 5.1 统一窗口边界

- 保留现有连续索引切片公式，新增一个内部窗口归属结果（或等价纯函数），同时供 `groups` 和 `beats.generationSegmentSequence` 使用。
- `count <= events.length` 时，每个窗口非空、顺序递增、互不重叠；不得改变既有事件的文本。
- 预算重规划（`minimumGenerationSegmentCount > 1`）的 `count > events.length` 请求会先被限制在可表达的事件数，Workflow Worker 下一轮观察到无段数进展后沿用原始 `PROMPT_BUDGET` fail-closed。
- 普通时长上限造成的 `count > events.length` 仅用于承载同一连续动作的后续时段：续段的 `narrativeBeatSequences` 为空、视觉目标使用既有结束状态承接，不把最后一个源事件再次写入 prompt；显式场景边界仍沿用既有 `STORYBOARD_SPEC_INVALID` 规则。
- `primaryEvent` 只能读取本窗口首个事件；取消最后事件回退。

### 5.2 递增重规划

- 继续只捕获 `UnsupportedVideoGenerationInputError.code === "PROMPT_BUDGET"`。
- 每轮仍调用同一个 `PlanningModelPort`，只增加既有内部 `minimumGenerationSegmentCount`；不增加固定重试次数。
- 规划器无法表达更多连续源窗口、时长边界不允许继续增加或没有进展时，安全阻断，不调用 Provider、不创建计费事实。
- `runtime-profile`、sidecar、公开契约和任务状态保持不变。

### 5.3 片段内容不变量

- `shotSpecs[i].narrativeGoal` 只含窗口 `i` 的视觉事件。
- `shotSpecs[i].narrativeBeatSequences` 与 `beats[*].generationSegmentSequence` 完全一致。
- 每个对白段仍由既有 `distributeDialogueLines` 按源换行/语义边界分配；不把其它段对白加入当前 prompt。
- 参考图、角色/道具连续性和 start/end state 继续按既有 policy 传递；不重复已完成动作。

## 6. 允许改动与唯一写入边界

唯一执行写入者只允许修改：

- `packages/creative-planning/src/index.ts`
- `packages/creative-planning/tests/deterministic-planner.test.ts`（或仓库当前对应 planner 测试文件）
- `apps/workflow-worker/tests/execution-service.test.ts`（仅补充跨轮/窗口归属证据）

主控负责本文件的实施记录和审计对账；执行者不得修改 `AGENTS.md`、公共 contracts、`runtime-profile.ts`、persistence/schema、Provider adapter、状态账本或部署配置。发现需要越过边界时必须先报告 `DESIGN_QUESTION`。

## 7. 验收矩阵

| ID | 条件 | 证据 |
|---|---|---|
| R1 | 1–15 秒且无预算超限仍为单段，时长精确保持 | planner 行为测试 |
| R2 | 15 秒以上沿现有 profile 时长策略取最少合法段数 | planner 行为测试 |
| R3 | `count <= events.length` 时窗口连续、保序、无重叠；beat/shot 归属一致 | 5 事件/4 段 fixture |
| R4 | 预算重规划的 `count > events.length` 不复制事件，限制到可表达数并由 Worker 无进展安全收口；普通时长续段不复制源文本 | 3 事件/4 段 fixture + 单动作超时回归 |
| R5 | 预算触发只递增现有段数；多轮成功与无进展/时长边界失败均无 Provider/计费副作用 | Workflow fixture |
| R6 | 中文、多行对白、引用图 anchor、起止状态和 reference policy 在各自窗口内保真 | planner/compiler 回归 |
| R7 | provider-video、creative-planning、workflow-worker typecheck/test 与 `git diff --check` 通过 | 命令记录 |
| R8 | 独立审计确认无新公开契约、无截断/重排/静默回退/新 Provider 逻辑 | 审计记录 |
| R9 | VPS 集成门：在有效 AISelf 会话下用当前既有真实 Provider、480p、既有测试项目做一次实测；记录每段 prompt 字节、段数、任务状态、合成产物和已知质量边界 | 当前 `DEFERRED`，不阻断本代码切片验收；需在 VPS 发布后单独完成 |

## 8. 模拟与真实测试顺序

1. 先运行 creative-planning 定向测试，确认窗口/beat 归属和 fail-closed。
2. 再运行 workflow-worker 定向测试，确认 `PROMPT_BUDGET` 重规划、sidecar 和无 Provider 副作用。
3. 执行者停止写入，独立审计员复核固定差异并重跑受影响测试；审计结论只能是“符合 / 不符合 / 证据不足”。本轮独立只读审计结论为“符合”；审计员指出 Worker 无进展收口仍需以现有 Workflow 测试作为运行证据。
4. 真实 Provider 生成属于 VPS 集成门，不是本代码切片的本地验收门；必须在有效 AISelf 会话下通过正式 Control API 触发，不复制 Cookie/Token，不绕过账户桥接。
5. 若 VPS 集成测试失败，先区分 Provider/网络/relay/计费环境故障与本次规划回归；不能把未完成的真实测试写成代码切片失败，也不能把一次成功或失败替代完整质量验收。

## 9. 已知边界

- 4096 是当前 Aiself/Sub2API profile 的实测/路由约束，不是 Grok 或 Seedance 的统一官方字节上限；本轮不提高或删除它。
- Grok 官方视频生成当前单次时长为 1–15 秒；Seedance 能力必须按具体已认证 profile 判断，不能按型号名称猜测。
- 本轮保证的是源窗口不重复、不重叠和预算失败可解释，不保证 Provider 生成的动作、口型、原生音频或转场质量百分之百遵循提示词；这些仍需产物与人工验收。
- `NarrationAsset`、完整 `TimelinePlan`、复杂 transition/xfade、中文口音和完整 E12/R01 硬门仍按既有文档保留，不因本轮通过而升级总体状态。

## 10. 实施记录（由主控在每次交接后更新）

- 设计/范围：已冻结；未改变现有公共契约、状态和 Provider 保护。
- 执行：主控完成 `creative-planning/src/index.ts` 的最小窗口映射修正及对应测试；本轮未采用无可观察产出的执行者修改，既有 workflow-worker 源文件改动保持原样。
- 模拟证据：creative-planning `62/62`、workflow-worker `29/29`、provider-video `66/66`，均 `0 skip`；三包 typecheck 与 `git diff --check` 通过。
- 独立审计：最新只读审计结论“符合”；确认 `count > events.length` 时事件先分配、空续段在末尾，预算 clamp、共享 event→beat 映射和 continuation 不重复源文本，未见公共契约/Provider 改动。审计未独立重跑测试；数据库/真实 Provider 仍未测。
- 真实 Provider：已尝试沿既有 VPS Control API 入口做一次受控探测；`GET /api/v1/health` 返回 200，但创建测试项目返回 `503 AUTH_FORBIDDEN`（Video account sign-in is required），因此没有提交 Provider 任务，也没有产生扣费或产物。当前本机 Docker daemon 不可用，无法启动本地完整真实栈；未绕过 Control API 直连上游。
- 当前结论：代码切片已达到 `ACCEPTED`（固定来源、独立审计、模拟测试和类型检查均通过）；VPS 账户桥接/真实 Provider 产物为 `DEFERRED`，待部署后在有效 AISelf 会话下单独验证。该结论不改变总体平台、C12.4/C12.5 或 E12/R01 的既有状态。
