# AI 企业内容生产平台：原仓库自然语言导演分段与口播保真开发文档

> 文档版本：v1.0（2026-09-17）  
> 文档状态：`HISTORICAL_SUPERSEDED`（2026-09-19 起，真实模式的片段数量/时长/台词归属改由 LLM 三键分段契约决定；本文仅保留前置自然语言/口播边界）  
> 适用范围：LLM 参与的“既有片段 → 自然语言视频提示词”规划窄片。  
> 正式账本仍以 `AGENTS.md`、领域/API 契约、正式开发总控和章节审计记录为准；当前 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不因本文改变。

## 0. 文档定位与历史方案对账

本文曾是“LLM 自由创作、原始口播保真、按既有片段生成提示词”的实施方案，现仅保留自然语言、口播保真和安全边界。片段数量、时长和台词归属的现行方案以《AI企业内容生产平台_原仓库LLM分段决策移植与机械切分拆除设计文档.md》及 2026-09-19 重建记录为准；本文不再授权确定性骨架约束真实 LLM。它不把参考仓库没有定义的 ownership、字符偏移、JSON 场景模型或压缩算法包装成来源能力。

与本文冲突的旧表述按下表处理：

| 旧文档 | 处理 | 仍可保留的内容 |
| --- | --- | --- |
| 《AI企业内容生产平台_原仓库导演式语义分段与全局上下文移植开发文档.md》 | 已标记 `HISTORICAL_SUPERSEDED`；其中 `source_ownership/source_spans`、UTF-16 连续覆盖和按 source unit 验证不再授权 | 三份上游的导演语义、提示词形状和审计历史 |
| 《AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md》 | “当前生产 LLM 必须返回私有 ownership envelope”的段落已标记被本文取代 | 口播不能由 LLM 改写、引用顺序、预算 fail-closed、平台边界 |
| 《AI企业内容生产平台_LLM跨层侧车行为与发布验收开发文档.md》 | 旧 ownership sidecar 的行为证据只作历史；按本文重新实现后再复核 | 仅作为跨层证据和发布门槛参考，不新增协议 |
| 《AI企业内容生产平台_LLM语义Prompt规划与结构化校验重构开发文档.md》 | 已标记 `HISTORICAL_SUPERSEDED` | 历史失败样本和 fail-closed 经验 |
| 《AI企业内容生产平台_自然语言导演分段实施与自造envelope拆除开发文档.md》 | 已标记 `HISTORICAL_SUPERSEDED`；仅保留本轮实施记录，不再作为授权或状态依据 | 允许范围、旧实施步骤和历史验收口径 |
| `多源仓库逐项迁移矩阵与冲突审计开发方案.md` 中 2026-09-17 source ownership 条目、`章节审计记录.md` 中对应审计条目 | 保留当时的测试/审计事实，但标记为 `HISTORICAL_SUPERSEDED`；不得作为当前实现授权 | 固定来源核对、测试计数和未闭合风险的历史证据 |

本文不废止 4096 UTF-8 保护性压缩文档。现有 `sourcePrompt/generatedPromptParts` 是运行时预算侧车，不是 LLM 创作输出；其内部传递继续按既有文档和契约处理，不在本窄片重写。

## 1. 用户目标与结论

用户只要求原提示词中明确写死的口播文案一字不差保留；画面、动作、镜头、节奏等非口播内容交给 LLM 结合完整上下文自行导演。当前方案的结论如下：

1. 创意内容采用自然语言，不要求 LLM 返回 `source_ownership`、`source_spans`、`beat`、`motion`、`camera`、`object`、`role` 或其它场景字段。
2. 片段数量、目标时长、参考图绑定、音频 owner 和任务状态继续由现有平台规划器/契约拥有；LLM 不重新发明时长或拆段算法。
3. LLM 每个既有片段只返回一段自然语言视觉提示词。一个有序字符串数组只是现有内部调用的最小传输容器，不是来源仓库的新领域模型，也不进入公开 API、数据库字段或事件。
4. 口播由现有 source parser/compiler 从用户原文提取并按既有音频 owner 规则注入最终 Provider prompt；LLM 不生成、改写、翻译、补全或重新分配口播。
5. 结果不满足最小边界时直接 fail-closed，不使用确定性猜测、自动 fallback、箭头/关键词/字数拆分或静默删改。

这里的“自然语言”是创作形态，不是取消平台必须具备的任务、Provider、参考图、音频和预算边界。平台仍通过已有内部 DTO/队列传递任务，但不把这些传输字段当成上游创作语义。

## 2. 固定来源与可移植语义

所有来源均固定到以下干净 commit。本文只摘取能在文件/符号中复核的语义；参考仓库没有定义的内部 envelope、压缩器、来源证明协议和价格/状态规则，不得声称为原样移植。

| 来源 commit | 固定文件/符号 | 本文采用的语义 | 本文明确不复制 |
| --- | --- | --- | --- |
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md`；`backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`；`backend/src/agents/index.ts` | 先看叙事 beat/因果链；`description` 承载观众实际看到的有序动作和子镜头；`atmosphere` 单独表达光线、色调、声音和氛围；台词/旁白不能脱离 description 被创作；显式 `【镜头N】` 保持顺序 | 不把其 8–15 秒、2–4 子镜头数值硬写进当前平台策略；不复制 Agent 工作区、业务模型或 Provider 协议 |
| `Seedance-2.5@ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/prompting.md`；`skill/seedance-25/references/references.md`；`skill/seedance-25/references/long-video.md` | 提示词可采用 reference declaration、简短 overview、必要的 progression/timestamp、global locks；只有多阶段/对白/剪辑需要时才写时间推进；一个维度一个 owner；`@` 引用按输入顺序原样保留；不重复已完成动作、明确终点和连续性 | 不复制其示例 JSON、Provider 参数、时长上限或本地角色/ownership 字段；不把 timestamp 示例变成新的机器时间轴协议 |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/pipelines/explainer/script-director.md`；`skills/pipelines/explainer/scene-director.md`；`lib/shot_prompt_builder.py::build_shot_prompt` | 从 script section 的自然语言职责导演可见场景；每个视觉单元有清晰可见内容；在字段存在时按 Camera/Movement/Subject/Lighting/Style 的紧凑层次组装，不给每个镜头附加大段固定 prose | 不复制其 project/events/Backlot、数据库、编辑器状态、0.5–1 秒留白等建议作为本平台新阈值；不声称它定义本平台 LLM 输出数组 |

三份上游都没有“把一段无标签 source 按字符/箭头切成固定区间”的算法，也没有 `source_ownership/source_spans` 或通用 4096 压缩器。因此本方案不补造这些能力。

## 3. 当前输入与输出边界

### 3.1 给 LLM 的输入

复用现有 `PlanningModelPort` 和现有模型客户端，不新增公开字段。发送给 LLM 的内容使用普通文本消息分区表达，内容来自已有事实：

- 完整用户原始创作描述（不在 planner 内按箭头、关键词、字符数或相邻句猜分段）；
- 现有规划器已经确定的片段序列、目标时长、前后片段连续性和参考图绑定；
- 已有风格/氛围上下文；
- 由现有 parser/compiler 提取的 authored dialogue（仅作为“必须原样保留”的受保护文本，不要求 LLM 回写）。

原始描述作为创作上下文整体传入。无明确 `【镜头N】`、段落或其它来源边界时，平台不自行制造 source unit；LLM 可以在既有片段骨架内自然组织画面，但平台不宣称对每个视觉事实提供字符级覆盖证明。

### 3.2 LLM 的输出

LLM 只返回与既有片段一一对应的有序自然语言视觉提示词：

```json
["第一段的自然语言视觉提示词", "第二段的自然语言视觉提示词"]
```

该数组仅是内部 transport。数组元素不得再包裹 `source_ownership`、`source_spans`、`segment_sequence`、`motionPlan`、`camera`、`object`、`role` 等创作 schema；不要要求模型输出 JSON 场景树、字符偏移或机器时间轴。模型若返回对象、额外字段、缺段、空字符串或不可解码内容，按失败处理。

提示词内容可自然地包含主体、动作、终点、必要的镜头/光线/氛围、引用和连续性；这些维度只在实际需要时出现，遵循三份上游的短提示形状，不把完整原文机械复制到每个片段。

## 4. 口播保真与音频 owner

1. 现有 authored dialogue 提取器仍是口播唯一事实来源。明确写在原提示词中的口播必须保留原文字符、标点和作者换行语义；不能由 LLM 重新措辞或翻译。
2. 最终 Provider prompt 的口播块由现有 compiler 按已确定的 `dialogueGroups`/音频 owner 注入；本方案不新增“按字数重分配”或跨片段偏移算法。
3. 已认证 Provider 原生音轨继续由既有 native owner 规则控制；显式选择 Doubao 时才使用既有 TTS 路径。本文不改 Piper、BGM、字幕、混音或 NarrationAsset/AudioPlan 契约。
4. 如果现有 parser 的 normalize 会改变用户明确要求保留的 authored 文本，不能让 LLM 或压缩器掩盖差异；应在该既有边界上 fail-closed，并另行提出有来源依据的修复。

## 5. 源仓库语义到平台薄壳的映射

### 5.1 Huobao 映射

- 将 `description` 作为可见动作/镜头顺序的主要自然语言来源，将 `atmosphere` 作为光线、色调、声音和情绪补充。
- 若原文已有 `【镜头N】`，提示 LLM 依照原顺序组织对应片段；不遗漏、不合并、不新增用户没有写的台词。
- Huobao 的“一个段落可含多个子镜头”只是提示语义参考；实际片段边界仍沿用平台现有规划器，不把上游数值复制为新规则。

### 5.2 Seedance 映射

- 在自然语言提示中按需要声明参考图用途、整体概览、动作/终点/阶段推进和全局连续性锁。
- 只有确有多阶段、对白或剪辑时才使用自然语言时间推进；不生成独立 timestamp schema。
- 引用图的 `@` 标签与输入顺序交由现有 reference binding 保持，LLM 不重排真实图片。

### 5.3 OpenMontage 映射

- 让每个既有片段具备清晰的可见叙事职责和画面内容；不把无关的全文说明复制到每个片段。
- 在存在相应信息时采用紧凑的 Camera、Movement、Subject、Lighting、Style 顺序；缺少的层不补造。
- OpenMontage 的脚本/场景自然语言导演方式可作为 LLM 指令来源，但其本地目录、事件文件、渲染状态和时间留白建议不进入本平台契约。

## 6. 最小运行流程

1. 复用现有确定性规划器得到片段数、目标时长、参考绑定、音频 owner 和已有连续性上下文。
2. 以完整 source 和上述上下文调用现有 LLM seam；system/user 文本仅加入本节第 5 节可追溯的上游规则。
3. 解析顶层有序字符串数组；数组长度必须等于既有片段数，每项非空。
4. 将每项自然语言提示词与现有平台已拥有的 reference/audio/provider 边界合成为现有 `PromptPackage`；保留既有 `sourcePrompt/generatedPromptParts` 预算侧车，不把它当成 LLM 输出协议。
5. 使用现有 UTF-8 预算检查。未超限按既有 exact 语义；超限沿用现有 fail-closed/已审计路径，不在本方案新增压缩、截断、suffix、marker 去重或重排。
6. 任一 LLM 响应超时、不可解码、数量不符、空项或包含旧结构化 envelope 时，按现有 planning failure 返回，不提交 Provider、不创建成功产物、不触发扣费。

本流程不尝试从无标签文本推导新的 source offset，也不通过箭头、关键词、句长或字符比例切片。片段内容是否自然均衡由 LLM 在已有片段骨架内完成；平台只校验可执行的最小边界。

## 7. 允许修改的代码边界（后续实施时）

只有在本文通过审计并获用户进入实施后，才允许修改下列内部实现和定向测试：

- `apps/workflow-worker/src/semantic-planning-client.ts`：把旧的 ownership/span response parser 改为顶层自然语言提示词数组解析；保留现有 HTTP、超时、模型配置和 fail-closed 行为，不新增 Provider 协议。
- `apps/workflow-worker/src/execution-service.ts`：仅做既有规划结果到现有 `PromptPackage` 的薄 mapper；不改任务状态、计费、重试和持久化契约。
- `packages/creative-planning/src/index.ts`：复用既有片段骨架、dialogue 提取、reference 顺序和预算侧车；移除对 LLM 返回 ownership/span/beat/motion 的要求，保留现有公共 `PromptPackage` 字段。
- `apps/workflow-worker/tests/*`、`packages/creative-planning/tests/*`：新增/改写离线 fixture 行为测试，证明上述边界。
- 本文、来源登记和章节审计记录：登记固定 commit、薄壳适配、测试命令和未闭合边界。

本窄片禁止修改 `packages/contracts` 的公开 DTO、数据库 schema、任务状态/事件、Provider adapter、`runtime-profile.ts`、前端、计费、VPS、AISelf 或真实外部调用。若实现发现必须改变其中任一项，先停下并更新契约/ADR，不得绕过本文直接编码。

## 8. 定向测试与审计清单

所有测试先使用本地 fixture/mock，不调用真实 Provider、TTS、网络、VPS 或计费服务。

### 8.1 LLM seam/creative-planning

- 保险 AI 多行中文对白：返回数组长度与既有片段数一致；最终 authored dialogue 与受保护原文一致，换行、标点和引号不被 LLM 改写。
- “商品测试1”无旁白三段 source fixture：完整原文传入模型；模型可自然分配画面，不再触发 UTF-16 `source spans must cover...`；不添加箭头/关键词切分。
- 显式 `【镜头N】` 与 `@` 引用：输出顺序与输入顺序一致；不重排真实 reference binding。
- 两段各自不同的自然语言视觉提示词：确认不会把完整 brief 机械复制为每段固定模板；测试只断言 transport/边界，不用自造内容评分。
- LLM 返回对象、ownership/span envelope、缺项、空项、错误 JSON、超时：全部 fail-closed；不走确定性 fallback。
- 长中文/ASCII 引号/多行 source 尾部：确认送入 LLM 的 source 未被 planner 的 slice、concise 或 normalize 静默截断；无法保留时阻断。

### 8.2 运行时预算与生产链

- 复用既有 `runtime-profile` 及 provider-video 的 UTF-8 预算测试；本窄片不重新实现压缩。
- 复用现有 `sourcePrompt/generatedPromptParts` sidecar 的生产传递测试；确认它仍是预算事实，不含旧 ownership/span 响应字段。
- 预算超限、LLM 规划失败或 sidecar 不匹配均不提交 Provider、不扣费；错误按既有应用错误码映射。

### 8.3 最小审计证据

- `rg` 能证明代码中不再要求或解析 `source_ownership`、`source_spans`、UTF-16 source coverage 作为 LLM 输出。
- `rg` 能证明本窄片没有新增箭头/关键词/字符比例切分、自动变速、静默 fallback、marker 去重、固定 suffix 或全局空白折叠。
- 测试计数只记录本次实际运行的最新结果，保留 skip/外部未测试边界；静态命中不能代替行为测试。
- diff 只落在第 7 节允许范围；无公开契约、状态、数据库、Provider、密钥、VPS 或 Git 改动。

## 9. Exit Gate 与明确未覆盖项

本文的设计 Exit Gate 只有在以下事实同时具备后才可进入代码实施审计：

1. 三份固定来源的文件、符号和本地薄壳映射可复核；没有把私有数组 transport 写成上游协议。
2. 现有片段骨架、参考顺序、音频 owner、预算侧车和错误状态未被改义。
3. LLM 仅承担自然语言视觉创作；口播由既有 parser/compiler 原样保护；无 ownership/span/字符偏移要求。
4. 8.1、8.2 的本地定向行为测试全绿，0 个未解释失败；未运行的真实 Provider/E2E 明确列为未测。

本文不验收以下事项，也不允许为了“通过”而自行补造算法：

- 没有来源依据的 source-to-segment 字符级覆盖证明、箭头/关键词自动拆分；
- 单一旁白跨多个 section 的偏移推导、连续旁白跨非 cut 镜头、复杂 xfade/变速/补静音；
- 真实 Provider/TTS、中文听感、口型、字幕人工质量；
- Studio 样音审批、完整 NarrationAsset/TimelinePlan/AudioPlan 语义；
- Veyra/共享积分、部署、VPS 和生产账户验收。

## 10. 设计决策记录

- **为何不继续 ownership/span envelope：** 三份固定上游只提供自然语言导演、引用顺序和提示词形状，没有该私有协议；当前 LLM 只收到字符串上下文，无法证明模型输出的字符来源，继续保留会制造“看似严格、实际易错”的自造校验。
- **为何仍保留有序数组：** Provider 任务必须知道已有片段对应的提示词；顶层数组是最小内部传输壳，不承载场景字段、不进入公开契约，且不改变任何上游媒体语义。
- **为何只把 authored dialogue 设为硬门：** 这是用户明确规定的不可改事实，并且 Huobao 明确要求台词来自 description、不得新增；其余视觉创作按三份上游的自然语言导演方式交给 LLM。
- **为何不把上游数值照搬：** Huobao/OpenMontage 的时长和留白建议属于各自宿主流程；当前平台已有 duration policy，直接复制会形成未授权的新阈值。只迁移可证明的语义，不迁移不兼容的宿主参数。

## 11. 本轮实施与审计对账（2026-09-18）

已落地的窄片代码仅限：

- `packages/creative-planning/src/index.ts`：先由既有 `DeterministicPlanningModel` 固化片段、时长、参考绑定和 authored dialogue，再向 LLM 发送完整 source 与冻结片段上下文；只接受等长顶层字符串数组，并把字符串作为内部 `visualPrompt` 补充。旧 ownership/span/字符偏移解析已移除；非法形状、空项、数量不符、重复 authored dialogue 和超时均 fail-closed。
- `apps/workflow-worker/src/semantic-planning-client.ts`：HTTP transport、超时、凭据和错误处理保持原 seam；系统提示只要求既有片段对应的自然语言视觉提示，不要求模型返回时长、台词归属或场景 schema。
- `packages/creative-planning/tests/semantic-planner.test.ts`、`apps/workflow-worker/tests/semantic-planning-client.test.ts`、`apps/workflow-worker/tests/execution-service.test.ts`：补充等长/保序、参考 anchor、长 source 尾部、多行口播、旧 envelope/对象/空项/错误和 sidecar 行为测试。

最新本地证据：`@alchemy-video/creative-planning` **77/77 PASS、0 skip**；`@alchemy-video/workflow-worker` **37/37 PASS、0 skip**；两包及工作区 `pnpm typecheck` 通过；`git diff --check` 无错误（仅换行格式提示）。测试使用本地 fixture/fake fetcher，无真实 LLM、Provider、网络、VPS、计费或 Git 操作。

本轮不吸收工作区中并行的 `dialogue_lines` 数据库迁移、Control API 输出、计费/部署脚本及其它历史 dirty diff；这些不属于本文允许修改边界，继续按各自章节审计。由于 Luna 独立审计子代理在本轮触发额度上限，本文状态保持 `IMPLEMENTED_PENDING_AUDIT`，不得写成 `ACCEPTED` 或宣称真实 Provider 已验证。
