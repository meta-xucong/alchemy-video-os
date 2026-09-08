# AI 企业内容平台：原仓库结构化分段与旁白时间窗完整迁移开发文档

版本：`1.0.0`

状态：`ACTIVE / SOURCE_MIGRATION_SLICE`（仅作为 C12.5-S01 辅助执行文档；不得替代 AGENTS.md、领域契约、正式总控或章节审计记录）

> **边界声明**：标题中的“完整迁移”指本文件对来源规则的完整对照；本轮实际只实现 authored source-unit/容量规划窄片，正式 visual beat owner、section/time window、NarrationAsset 和 AudioPlan 仍未完成，不能据此宣称整条链路已完成。

生效日期：2026-09-02

## 0. 目的与问题边界

本文件只处理“同一份自动生成视频文案被错误按近似等长切成多个 Provider 片段，导致段落归属、旁白边界和画面语义错位”的窄问题。当前保险 AI 30 秒样本的事实是：第一段同时承载了第一句和下一段开头，第二段从中间句开始；用户希望同一行连续、换行代表作者段落边界。

本轮只允许把固定版本原仓库的段落/容量/时间事实映射到现有 `creative-planning` 私有规划载体和既有测试。不得新增公开字段、事件、AudioPlan、TimelinePlan、Provider 协议、TTS Provider、变速/裁切/补静音/自动重规划或用户上传音频路径。正式 `NarrationAsset`、绝对 section window、完整 AudioPlan consumer、产物和人工听感仍须走既有硬门，不能由本文件宣称完成。

## 1. 固定来源和不可泛化的事实

所有实现必须能回指以下固定 commit 的具体文件/符号；没有来源对应的行为保持 `DEFERRED`/`BLOCKED`。

| 来源 | 固定位置 | 必须保留的语义 |
| --- | --- | --- |
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md:8-15` | 一个 storyboard paragraph 对应一个视频生成任务；每段 8–15 秒；一个场景内含 2–4 个子镜头，每个 2–6 秒。 |
| 同上 | `SKILL.md:20-22` | 先识别叙事 beat；beat 边界强制分段；不得拆开因果链；总时长预算约按字符/500/分钟；段数约按 12 秒目标但不能机械套用。 |
| 同上 | `SKILL.md:26-38` | transition 8–10 秒、narrative 10–15 秒、climax 12–15 秒；硬容量为 `segment duration >= dialogue chars / 4.5 + 2s`；超长对白移动/拆到下一段，不塞满当前段。 |
| 同上 | `backend/src/agents/index.ts:73-104` | 先识别 beats，再把每个段落的描述和对应旁白保存在同一 source unit；不得因 Provider 调用方便而重排文本。 |
| 同上 | `backend/workspace/skills/prompt-generator/video-prompt/SKILL.md:20-52` | `【镜头N】` 依原顺序映射连续片段；对应子镜头的对白只属于该段；来源只明确 3 秒念不完时拆为连续多段，本平台不改写文本，并以既有句读/分隔标点作为安全边界。 |
| `openmontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `skills/pipelines/explainer/script-director.md`、`schemas/artifacts/script.schema.json` | 脚本 section 具有稳定 `id`、`text`、`start_seconds`、`end_seconds`；文本和时间窗是后续资产/剪辑的事实来源。 |
| 同上 | `skills/pipelines/explainer/scene-director.md` | 每个 scene 绑定 `script_section_id` 和绝对 `start/end`；每个 section 先预算词数，不能超过时间窗；以实测 TTS 时长回馈，超窗须回到规划。 |
| 同上 | `skills/meta/voice-performance-director.md` | voice performance、delivery cue、`provider_text`、显式 pause/pace/emphasis 属于结构化来源；换行本身不是数值化停顿。 |
| 同上 | `skills/pipelines/explainer/edit-director.md`、`compose-director.md` | 旁白按 section/绝对窗口消费；音乐和视觉尾段只能在已有事实中覆盖空白；合成前做时长/完整转录/空档检查。 |

## 2. 迁移到当前程序的最小映射

| 原仓库载体 | 当前载体 | 适配规则 |
| --- | --- | --- |
| source paragraph / storyboard beat | `extractDialogueLines`、`dialogueLines`（`packages/creative-planning/src/index.ts` 私有规划字段） | 保留原始换行形成的 source unit；同一行不被均分，不按输入顺序猜测视觉归属。 |
| `provider_text` / delivery cue | 现有 `VoicePerformance.delivery_cues[].provider_text`、`buildDialogueInstruction` | 只传原文；不补词、不把换行转换为 Piper/Doubao 数值、不生成第二份脚本。 |
| 8–15 秒与 `chars/4.5+2` | `dialogueDurationSeconds`、规划前的容量门 | 每个承载对白的 provider 段独立满足来源硬门；无法在合法来源边界满足则返回既有 fail-closed 错误。 |
| source 顺序 | `distributeDialogueLines` 的顺序装箱 | 先放完整作者行；只有单一过长行才可沿原有句读/分隔标点形成连续片段；无合法边界不做任意字符切块。 |
| visual segment count | 现有 `chooseGenerationSegmentCount` | 取 Provider 8–15 秒下限、明确 visual beat 和 source dialogue capacity 的共同最小值；不得用固定 12 秒 seed 或等字符数制造调用。 |
| OpenMontage absolute section window | 现有规划输出之外的既有 TimelinePlan/approved narration consumer | 本轮不伪造公共 section id/window；规划器只保证 source ownership 和容量，正式窗口仍由既有 approved asset 路径提供。 |

## 3. 执行规则（每一项必须自证来源）

1. 先读取并保留带标签的 `口播文案/旁白文案` 原文；多行按作者顺序形成 source units，空行只作为来源边界保存，不自动产生固定秒数停顿。
2. 先分配作者行，再生成视觉 beat。对白一旦按 source unit 绑定到段，就不得从视觉事件组重新提取或跨组补回；当前没有公开 `script_section_id`/TimelinePlan owner 时，视觉描述只能作为同场景上下文，正式 section owner 继续 `DEFERRED`，不得宣称已经完整迁移。
3. 使用来源容量 `duration >= chars / 4.5 + 2s` 做硬门；承载对白的段只能在 8–15 秒范围内。任何不能满足的文本保持 `VOICEOVER_CAPACITY_EXCEEDED`/等价不可用，不得靠放慢、atempo、裁切、循环、无来源静音或把下一行挪入当前段解决。
4. 不同行/段落之间不得跨行拼接。Huobao `video-prompt` 只明确“3 秒念不完时拆成连续多段”，并未规定本平台的标点算法；本平台为避免改写作者文本而采用已有句读/分隔标点作为安全边界。没有可证明的来源边界就整体保留并 fail-closed，这一条是本平台安全边界，不冒充 Huobao 原规则。
5. 目标时长多于旁白自然时长时，不能把剩余秒数伪装成旁白。剩余画面覆盖、音乐、HOLD/BROLL 只有在现有 AudioPlan/TimelinePlan 已有事实时才可消费；本规划器不新建尾段协议。
6. 原生 Provider 音频、显式 Doubao 和 Piper 仍遵守现有 owner 规则；本轮只调整 source 分段，不改变 owner、Provider 选择或真实调用权限。

## 4. 保险 AI 30 秒样本的验收语义

以下三行必须作为三个连续 source units，不能把第二行的首句塞入第一行：

```text
晚上十点四十一分，一条消息被秒回，这，就是智险引擎。
内容，日产四十七条；线索，二十六秒应答；面谈，零点四秒提词；计划书，八秒成稿；合规，逐项把关。
让每一位代理人，都拥有一支 AI 营销团队。
```

实现可以在既有 8–15 秒 Provider 段中产生多于两段，只要每段仍是来源顺序、每个承载段通过容量门、总视觉时长由现有规划不变量校验。若无法同时满足目标时长、8–15 秒和作者边界，必须 fail-closed；不得为了保持两个 15 秒调用而跨行重排。

## 5. 定向测试与证据

本轮代码测试必须覆盖真实行为而非静态命中：

- 带 `口播文案` 标签的多行文本保留换行和行顺序；`provider_text` 拼接后与原文一致。
- 保险 AI 样本逐段断言：第一段只含第一行，后续段不含第一行；第二、三行不会被提前放入第一段。
- 同一行内的合法句读边界可连续分配；没有合法边界的超长行返回 fail-closed，不任意按字符切片。
- 每个有对白的段满足 `8 <= duration <= 15` 及 `chars <= floor((duration-2)*4.5)`；目标 30 秒不得以固定 `[15,15]` 或等字符断言作为正确性依据。
- 编译 prompt 只出现对应段的 `provider_text`，连续段序号与实际段数一致；不新增 Provider/AudioPlan 协议。

测试记录必须注明命令、通过/失败/跳过数、是否 fixture/mock、未覆盖的真实 Provider、人工听感和正式产物硬门。静态 `rg`/类型检查不能替代行为证据。

## 6. Exit Gate 与未闭合硬门

本窄片只有在代码、定向行为测试和来源登记三者一致时，才可提交 `READY_FOR_AUDIT` 评审；不得直接 `ACCEPTED`。总体 C12.4/C12.5 和 E/R 历史状态仍由正式总控、state、章节审计记录维护。

以下事项不因本片完成而关闭：

- 正式 Script/Scene `section_id` 与 absolute `start/end` 的完整公共事实链；
- 独立 `NarrationAssetVersion`、完整 AudioPlan consumer、transition/xfade 和连续旁白组合；
- 实测音频、字幕 `REQUIRED` 事实、Studio 样音审批、中文口音/人工质量；
- Worker restart/repeat、Provider 原生音轨和 Doubao 产物的真实对照。

## 7. 与历史文档的关系

《AI企业内容平台_原仓库语音表现与段落边界迁移实施文档.md》继续保留其来源审计记录，但其中关于本规划器的“待实现/固定载荷”段落由本文件 supersede；不得把旧文档的样音、multi-cue 或正式 TimelinePlan 描述解释为本窄片已完成。若旧文档与本文件冲突，以本文件对“结构化分段”范围为准，以 `AGENTS.md`、领域契约和正式总控的状态/边界为更高优先级。

## 8. 每步回顾表

每次改动、测试或审计记录必须回答：

1. 固定来源文件/符号/行号是什么？
2. 当前修改是否只是 source text、既有私有规划载体和边界适配？
3. 是否新增了算法、阈值、协议、公共字段、Provider 或 UI？若是，立即停止并记录。
4. 是否证明了作者行 ownership、容量门和顺序，而不是只做源码命中？
5. 是否保留了未具备正式 asset/window/人工/真实产物证据的 `DEFERRED`/`BLOCKED`？
