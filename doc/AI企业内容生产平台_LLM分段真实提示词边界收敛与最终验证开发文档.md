# AI企业内容生产平台：LLM 分段真实提示词边界收敛与最终验证

## 1. 目标

在现有 `5affe0c` 版本上收敛真实 LLM 分段路径，修复内部平台占位值泄漏到最终 Provider 提示词的问题，并用来源可追溯、最小薄壳和可复核测试证明：

- LLM 负责片段数量、时长、视觉描述和台词行归属；
- 台词文本由平台从原始输入逐字保护，不由 LLM 改写；
- 既有内部 storyboard/motion DTO 所需字段不能被伪造为故事事实；
- 无来源事实时，最终提示词不得出现平台占位符；应省略该指令或 fail-closed；
- 不恢复 `source_ownership`、`source_spans`、UTF-16 envelope，不新增结构化导演协议。

## 2. 来源与硬约束

- `AGENTS.md` §2.2：来源优先、薄壳适配、无来源即禁用或 fail-closed。
- Huobao `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`：8–15 秒段落、叙事节拍、台词时长下限（字数÷4.5+2 秒）。
- Huobao `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`：一个分镜段落对应一个 8–15 秒视频，描述来源顺序保真。
- Seedance `upstream/Seedance-2.5/references/prompting.md`、`references/references.md`：自然语言层次、引用顺序和 critical locks；不新增平台 envelope。
- OpenMontage `upstream/OpenMontage/lib/shot_prompt_builder.py` 与 `video-gen-prompting.md`：按存在字段紧凑拼接，不补造事实。

## 3. 本轮允许修改

唯一写入者只能修改：

- `packages/creative-planning/src/index.ts`
- `packages/creative-planning/tests/semantic-planner.test.ts`
- `apps/workflow-worker/src/semantic-planning-client.ts`
- `apps/workflow-worker/tests/semantic-planning-client.test.ts`
- `apps/workflow-worker/tests/execution-service.test.ts`

允许增加本开发文档及来源登记/测试记录的最小文字；不得修改公开 contracts、数据库 schema、任务状态、Provider 协议、VPS、真实账户或密钥。

## 4. 必须修复

### 4.1 占位值不得进入最终提示词

`PLATFORM_OWNED_*` 只能作为内部 DTO 的缺省占位，不能被 `DeterministicStoryboardCompiler` 拼进 `prompt` 或 `generated_prompt_parts`。无可证明来源的 opening/closing/camera/scene/continuity 字段，最终输出应省略对应自然语言指令；如果既有 DTO 无法安全省略，则显式 `LLM_PLANNER_MALFORMED`，不得发送带占位符的 Provider 请求。

### 4.2 保留已通过的三键 LLM 契约

真实路径继续只接受顶层数组，数组项恰好包含：

`duration_seconds`、`visual_prompt`、`dialogue_line_sequences`。

不恢复旧 source ownership/spans，不恢复确定性分段回退，不新增 source envelope。

### 4.3 口播保护边界

保留现有 source-first 台词提取和逐字注入；为“带标签多行口播、闭合/不闭合引号、口播后视觉段落”补行为测试。无法可靠识别时必须阻断，不得猜测。

## 5. 验收证据

1. creative-planning、workflow-worker 定向测试全绿，0 skip。
2. 两包 typecheck 通过。
3. 新增行为测试：真实 LLM 规划结果经 compiler 后，`prompt` 和 `generated_prompt_parts` 均不含 `PLATFORM_OWNED_`。
4. 新增负例：无法表达必要字段时 fail-closed，不调用 Provider。
5. `rg` 确认旧 envelope 仅可存在于负向测试，不存在生产实现。
6. 真实测试仅在用户授权的本地 Provider 环境执行；不触碰 VPS，不把真实 key 写入日志或仓库。

## 6. 明确不做

- 不引入新的 source ownership/span/schema；
- 不恢复机械均分、关键字导演、自动补写旁白、自动语速或音频算法；
- 不修改 VPS、GitHub 以外的外部系统；
- 不把当前测试绿灯等同于人工听感或全链路商业验收。
