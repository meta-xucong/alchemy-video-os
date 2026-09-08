# AI 企业内容生产平台：C12.5 口播语速优先与弹性总时长编排开发设计

状态：`FROZEN / HISTORICAL_DESIGN`（2026-08-30 起冻结；章节状态仍以正式总控文档为准）

当前执行裁定（已由新方案取代）：本文只保留 C12.5 的历史设计和来源背景。当前源仓库映射、跨仓库冲突、薄壳边界和逐项验收以《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》为准；自然语速和实测时长优先、禁止变速/静默填充、来源没有安全实现时保持阻断等既有边界不变。本文不再授权新增实现。

现行使用补充（2026-09-01，覆盖历史输入假设）：当前自动旁白不要求用户上传音频或样音；样音由 native Provider 或显式 Doubao 服务端生成并经人工审批。本文中涉及上传音频的描述仅是历史/兼容路径，不能成为新自动视频流程的前置条件；自然语速、实测时长和来源 fail-closed 规则继续有效。

> **2026-09-01 语音路线冲突覆盖（SUPERSEDED）**：本文中“新制作默认 `CONTINUOUS_NARRATION` + `PLATFORM_NARRATION`”以及把统一 Piper/平台旁白作为所有任务 spoken owner 的表述，仅保留为历史方案，已由《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》覆盖。自然语速、实际旁白时长驱动画面、超长回到改稿/画面规划、禁止 atempo/rubberband/裁切/无来源补静音等来源规则继续有效；native Provider 音频或来源 TTS 的选择必须由已核验能力和审批事实决定，不能静默预设。

## 1. 目的与结论

当前 30 秒制作被机械拆成两个 15 秒片段，第二段为了填满固定时长而降低口播速度。问题根因不是单次 Provider 随机性，而是本地规划器把目标总时长平均分配给 Provider 片段，并把片段时长当成声音时长。

本设计直接继承源仓库的已有规则：**旁白实际时长和自然语速优先，画面时长跟随旁白；目标时长不足时调整规划，目标时长有余时用无口播的画面节拍填充，禁止用慢速播放或要求模型拖长台词填满片段。**

本设计不新增第二套音频架构，复用 [C12.4 连续旁白轨道与分段视频音频编排开发设计](./AI企业内容生产平台_C12.4连续旁白轨道与分段视频音频编排开发设计.md) 中的 `AudioPlan`、`AudioOwnership` 和 `PLATFORM_NARRATION`（历史/兼容 owner token；当前 owner 需由 native/TTS 来源事实决定）。

### 当前落地策略

（历史设计快照，已由自动音频正式执行文档 supersede）当时真实 Provider 入口尚未接入独立 TTS 旁白资产，因此本轮采用“自然语速优先、同段视觉尾拍填充”的可验证路径：规划器按源仓库的台词容量估算拆分 8–15 秒视觉段，口播段按自然语速承载完整台词；目标时长有余时只安排动作、环境声或干净的视觉尾段，不要求模型拖慢，也不把无台词段伪装成口播段。独立旁白资产和 `AudioPlan` 的跨段视觉尾段填充仍沿用 C12.4，待媒体运行时拥有实际旁白时长后启用。

实现注意：用户常以“口播文案”标题后接未加引号的整段文字。该格式与带引号对白具有同等语音权威性，必须在保留原始换行的阶段先提取；若先把换行压平，规划器会把口播误判为普通视觉事件并回退到 3x10 秒等机械分配，直接造成末段台词塞不下和语音混乱。

## 2. 源仓库依据与最大化复用

| 源实现 | 直接继承的规则 | 平台适配方式 |
| --- | --- | --- |
| `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md` | 单段 8–15 秒；叙事段 10–15 秒；转场/环境段 8–10 秒；台词最低时长为字符数 / 4.5 + 表演余量；台词装不下必须后移 | 继续使用现有 `GenerationSegment`，只把等分时长替换为按台词容量和叙事节拍规划 |
| `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md` | 台词只能来自对应分镜；长台词按段拆分；时间轴 3 秒粒度且无空洞/重叠；无台词段使用环境/动作声 | 复用现有 Prompt Compiler 的段内台词与 MotionBeat 输出，不新增台词，不把空镜段伪装成口播段 |
| `upstream/seedance-2.5/skill/seedance-25/references/long-video.md` | 30 秒使用时间轴脚本；每段有叙事职责、起止点和连续性锁；声音状态、未完成台词、准确端点必须继承 | 将完整 `AudioPlan` 时间轴和 C12 交接状态编译为私有约束；只对已认证原生长视频 profile 使用原生时间轴 |
| `upstream/seedance-2.5/skill/seedance-25/references/prompting.md` | 台词必须适合被分配的时间；时间戳不能有间隙/重叠；简单动作不强行切时间戳 | 继续由规划器确定段边界，Prompt 只表达已确定的语速和动作，不要求 Provider 拖慢 |
| `upstream/openmontage/schemas/artifacts/script.schema.json` | `voice_performance.pacing_profile`、`pause_policy`、section 实际起止时间、delivery cues 和 pronunciation guides | 映射到内部脚本/旁白计划；第一段确认的语速配置作为后续段的节奏基准 |
| `upstream/openmontage/skills/pipelines/explainer/executive-producer.md` | 先比较字数与时长；生成实际旁白后探测真实时长；超出时回到脚本或调整场景计划；每段旁白不得长于对应画面 | 把实际旁白探测作为规划反馈回路，不在合成阶段裁切或变速 |
| `upstream/openmontage/skills/pipelines/explainer/edit-director.md` | 画面切点跟随实际旁白时长；检查无间隙/重叠、起点对齐和 A/V 同步 | `AudioPlan` 使用最终成片绝对时间轴，画面段只提供承载和填充 |
| `upstream/openmontage/skills/pipelines/explainer/compose-director.md`、`core/remotion.md` | 旁白预算约占成片 85–90%；旁白超长则改文案或延长画面，不能慢放音频；可延长最后场景 | 复用“缩短文案 / 延长视觉尾段”的二选一，不引入 atempo/rubberband |

## 3. 当前实现冲突

当前 `packages/creative-planning/src/index.ts` 中以下逻辑与源仓库规则冲突：

1. `chooseGenerationSegmentCount` 之后调用 `distributeDuration(target, count)`，把总时长等分为 15+15 等固定片段。
2. `distributeDialogueLines` 以固定片段数组分配台词，而不是先建立旁白实际时间轴。
3. `dialogueDurationSeconds` 只能作为规划下限估算，不能作为最终音频时长。
4. Motion prompt 中的 “Reserve at least ... seconds” 容易被解释为必须把声音填满该段；它应改为“按确认语速完成台词，剩余时间只安排视觉动作或环境声”。

兼容原则：不修改已有 `TaskRun` 状态机、Provider submit/status/download 契约、历史运行和默认 Mock；先扩展内部规划/音频契约，再替换等分算法。

## 4. 目标编排规则

### 4.1 语速基准

- `pacing_profile`、`pause_policy` 和发音提示来自已确认脚本；第一段通过验收的实际旁白速度作为后续段的节奏基准。
- 后续段不得通过降低 `speaking_rate`、拉长音频或增加无意义停顿来满足固定片段时长。
- 口播文本仍只能来自脚本和对应分镜，禁止 Provider 自行补词、重复句子或总结。

### 4.2 时长决策

先生成完整旁白或可验证的旁白 fixture，探测每个 section 的实际 `audio_duration_seconds`，再计算视觉时间轴：

```text
narration_end = 最后一个旁白 section 的绝对结束时间
effective_duration = narration_end + 必要的动作/转场尾段
```

- `effective_duration < target_duration`：保持自然语速；按源仓库的环境/转场段规则增加无台词 B-roll、动作尾段或空镜，直到目标时长，或在策略允许时直接缩短成片。
- `effective_duration > target_duration`：不慢放、不硬切音频。优先按 OpenMontage 规则回到脚本重写；若仅略超且在项目允许的弹性范围内，延长画面时间轴承载完整旁白；超过范围则缩短目标或要求用户确认。
- 目标时长是软约束，不是每个 Provider 片段的语音预算。Provider 的 8–15 秒约束只作用于视觉生成段，不能改变旁白自然速度。

### 4.3 分段规则

- 先按语义边界、叙事职责和台词容量拆分，再把视觉段限制在 Provider 能力范围内；不再先等分 30 秒再塞台词。
- 叙事/口播段优先 10–15 秒；转场、环境、物件特写优先 8–10 秒；纯视觉段的 `dialogueLines` 为空。
- 一句台词若超过当前段容量，只在自然语义边界拆分并把“未完成台词”写入连续性锁；不重复上一段结尾。
- 需要填充的时间使用无台词视觉段或同段视觉尾拍，不能复制上一句口播。

## 5. 与 C12.4 AudioPlan 的关系

（历史路线，owner 部分已由 ADR-0063/语音专项文档 SUPERSEDED）新制作默认使用 `stitch_policy=CONTINUOUS_NARRATION` 和 `AudioOwnership=PLATFORM_NARRATION`：Provider 片段保留口型和表演参考，但其 `PROVIDER_DIALOGUE` 不拥有最终口播；最终旁白按绝对时间戳混入。现行实现必须先依据已核验来源能力选择 native Provider 或 TTS owner；只有明确选择 `PLATFORM_NARRATION` 时才移除 Provider dialogue。环境声、用户源音频、音乐和音效仍按所有权规则处理。没有旁白计划的历史任务继续 `LEGACY_PRESERVE`。

这样可以把“视频模型是否把一段声音拉到 15 秒”和“最终成片是否需要 30 秒”解耦，直接消除当前第二段变慢、段间停顿和音频被切掉的问题。

## 6. 实施顺序与复用边界

1. 在 `packages/contracts` 增加内部的旁白 section 实际时长、节奏配置和弹性时长策略 DTO；字段命名优先映射 OpenMontage Artifact，不复制其数据库或 Agent 状态。
2. 在 `packages/creative-planning` 将 `dialogueDurationSeconds` 保留为预检下限，新增“按旁白时间轴规划段落”的薄适配；删除/停用 `distributeDuration` 对有口播任务的等分路径。
3. 在 Prompt Compiler 复用 huobao/Seedance 的段内台词、时间戳和连续性锁规则，明确剩余时间为视觉承载，不要求慢速口播。
4. 在 Worker/Media Runtime 复用 C12.4 `AudioPlan`，探测真实旁白时长后生成绝对时间轴，按实际旁白调整画面，不重复提交已成功的 Provider 任务。
5. 用 OpenMontage 的反馈闭环做 QC：旁白超长回脚本，轻微超长调画面，最终检查无间隙/重叠、完整转写、最后一句未截断和自然语速一致性。

不复制上游 Backlot、Remotion、Agent、workspace 文件或 Provider 私有状态；只移植规则、字段语义、校验条件和必要的薄 mapper。每次复制/适配都必须在 `THIRD_PARTY_NOTES.md` 或对应适配模块记录来源和修改点。

## 7. 测试与 Exit Gate

- 30 秒目标、实际旁白 22 秒：保持自然语速并生成约 8 秒无台词视觉填充；不得把第二段语速降低。
- 30 秒目标、实际旁白 33 秒：不得裁切最后一句或变速；进入脚本重写/弹性延长路径。
- 语义拆分后每段 8–15 秒，台词容量满足字符数 / 4.5 + 表演余量；纯视觉段无台词。
- 同一 `pacing_profile` 下多段旁白速度一致，段间无额外重复词和异常停顿。
- `PLATFORM_NARRATION` 下最终只有一条权威旁白；若选择 native Provider，则该 Provider 音轨为唯一 spoken owner。`LEGACY_PRESERVE` 历史任务行为不变。（旧的“所有新任务固定平台旁白”前提已 SUPERSEDED。）
- Worker 重启、Provider 查询恢复、媒体重试不重复提交、不重复旁白、不截断已成功资产。

本设计只有在上述契约、规划器、Media Runtime 和回归测试完成后，才能进入 `READY_FOR_AUDIT`；本文件本身不授权真实 Provider、VPS、Veyra 或部署操作。

## 8. 相关文件

- `doc/AI企业内容生产平台_C12.4连续旁白轨道与分段视频音频编排开发设计.md`
- `doc/AI企业内容生产平台_开发决策记录.md`（ADR-0051、ADR-0052）
- `packages/creative-planning/src/index.ts`
- `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`
- `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`
- `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`
- `upstream/openmontage/schemas/artifacts/script.schema.json`
- `upstream/openmontage/skills/pipelines/explainer/executive-producer.md`
- `upstream/openmontage/skills/pipelines/explainer/edit-director.md`
- `upstream/openmontage/skills/pipelines/explainer/compose-director.md`
