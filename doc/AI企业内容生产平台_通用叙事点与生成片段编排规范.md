# AI 企业内容生产平台：通用叙事点与生成片段编排规范

版本：`1.0.0`
状态：`DESIGN_BASELINE`
适用范围：所有文本生视频、图生视频、长叙事、广告、宣传片、短剧片段和后续多媒体成片流程
关联文档：`AI企业内容生产平台_长叙事自动编排与连续成片设计.md`、`AI企业内容生产平台_长叙事后端领域与编排开发设计.md`、`AI企业内容生产平台_领域模型与API事件契约.md`

本规范是平台级通用规则。以后任何项目、题材、Provider、时长或参考素材组合，都必须先经过本规范定义的“叙事点 → 生成片段 → 最终成片”三层编排。项目之间只允许改变规划结果，不允许改变这条主链路。

## 1. 核心问题

用户提交的通常是故事、广告创意、产品介绍或一段长原文，而视频 Provider 只能稳定地生成有限时长的单段视频。以下做法禁止作为平台主流程：

- 把每一个逻辑镜头都直接变成一次 Provider 调用。
- 把长文本按字符数、字数或固定行数机械切片。
- 将“请把以上内容写成剧本/分镜/视频”等创作指令误当作一个需要生成的剧情事件。
- 让浏览器循环提交多个生成请求。
- 用多个短片段数量冒充最终成片时长。
- 让 Provider 自己理解整篇长故事并承担剧本、分镜和连续性编排。

平台必须把“内容理解”和“视频生成”解耦：

```text
用户故事/素材
    ↓
叙事理解与故事计划
    ↓
NarrativeBeat（叙事点）
    ↓
GenerationSegment（实际生成片段）
    ↓
Video TaskRun（一次真实 Provider 调用）
    ↓
质量检查、交接帧、转场与合成
    ↓
VideoVersion（最终成片）
```

## 2. 三层统一模型

### 2.1 NarrativeBeat：叙事点

叙事点是故事层和用户理解层的最小单元，不直接对应 Provider 调用。

至少包含：

- `sequence`
- `narrative_goal`
- `event`
- `characters`
- `location`
- `props`
- `emotion`
- `start_state`
- `end_state`
- `estimated_duration_seconds`
- `continuity_requirements`
- `generation_segment_id`

叙事点可以很多。30 秒宣传片可能有 6 个，也可能有 18 个；叙事点数量不决定 Provider 调用次数。

### 2.2 GenerationSegment：生成片段

生成片段是经过能力和时长约束后的实际视频生成单元。每个生成片段只对应一次 Provider TaskRun。

至少包含：

- `sequence`
- `duration_seconds`
- `narrative_beat_ids`
- `prompt_package`
- `reference_policy`
- `depends_on_segment_sequences`
- `start_state`
- `end_state`
- `continuity_note`
- `budget_cost_estimate`

一个生成片段可以承载多个叙事点，但必须形成一个可连续拍摄的视觉动作或场景单元。不能把互不相关的场景强行塞进同一片段。

### 2.3 VideoVersion：最终成片

最终成片由所有已验收的 GenerationSegment 按顺序经过 Media Runtime 合成产生。最终成片是不可覆盖的新版本：

- 片段失败不会伪造最终成片。
- 片段重做不会覆盖旧片段或旧成片。
- 重新合成也必须创建新的 `VideoVersion`。

## 3. 通用拆分算法

### 3.1 输入

规划器必须同时读取以下事实：

1. 用户目标总时长。
2. Provider 能力 Profile：
   - 最小安全生成时长。
   - 推荐生成时长。
   - 最大生成时长。
   - 支持的清晰度和比例。
   - 支持的参考图模式。
3. 叙事点数量和复杂度。
4. 场景、人物、地点、道具和情绪的变化。
5. 连续性要求。
6. 项目预算和单次制作上限。

Provider 的字段、模型名和接口细节只能存在于服务端能力注册表，不能由用户或浏览器传入。

### 3.2 默认策略

真实视频 Provider 默认采用保守的连续片段窗口：

| 总时长 | 默认生成片段策略 | 说明 |
| --- | --- | --- |
| 15 秒 | 1 × 15 秒，或 3 × 5 秒 | 简单内容优先单段 |
| 30 秒 | 3 × 10 秒 | 默认方案 |
| 60 秒 | 6 × 10 秒 | 按叙事转折微调 |
| 90 秒 | 9 × 10 秒 | 可按场景边界调整 |
| 120 秒 | 12 × 10 秒 | 长内容按章节组织 |

实际拆分不得机械套用表格。算法必须在安全范围内选择最少且足够表达内容的生成片段数：

```text
safe_min_duration <= segment.duration <= provider_max_duration
sum(segment.duration) == target_duration
segment_count 尽量少
每个 segment 必须对应完整视觉动作或场景单元
```

如果平均时长低于 Provider 的安全下限，系统应增加总片段时长或提示用户调整总时长，不能静默创建大量不可用的超短任务。

### 3.3 按叙事边界分组

叙事点分组必须优先考虑：

- 场景切换。
- 人物关系或情绪转折。
- 一个动作是否已经完成。
- 一个事件是否可以在同一镜头内表达。
- 前后段交接帧是否有实际意义。
- 参考素材是否需要切换职责。

禁止仅依据：

- 字符数相等。
- 叙事点数量相等。
- 每段固定字数。
- 浏览器当前屏幕长度。

### 3.4 长内容和超长内容

当总时长超过单个 ProductionRun 的预算或可控范围时，规划器先拆成“制作章节”，每个章节仍完整遵循本规范：

```text
完整故事
  -> 制作章节 1
      -> NarrativeBeat -> GenerationSegment -> VideoVersion
  -> 制作章节 2
      -> NarrativeBeat -> GenerationSegment -> VideoVersion
```

章节之间保留摘要、角色状态、场景状态和上一章节结尾交接信息，不允许把整个长文本重新塞入每个 Provider 请求。

## 4. 连续性策略

连续性分成三层：

1. **叙事连续性**：事件顺序、人物目标和状态变化正确。
2. **画面交接连续性**：相邻生成片段的起始画面与前段结尾有承接。
3. **最终成片连续性**：转场、节奏、音画和最终输出可观看。

### 4.1 参考图策略

每个 GenerationSegment 必须显式选择参考策略：

- `REFERENCE_SET`：身份、产品或风格一致性优先。
- `HANDOFF_FIRST_FRAME`：上一段动作、地点或画面承接优先。
- `TEXT_TRANSITION`：允许明显转场或 B-roll，不提供视觉连续性保证。

如果 Provider 不支持“多参考图 + 交接首帧”同时发送，系统不能静默降级，必须记录风险并在用户可见的故事计划中表达“标准连续性”或“需要确认”。

### 4.2 交接帧

后续片段只能使用上一段已经通过 QC 的结果帧作为交接输入：

```text
Segment N 成功
  -> 提取尾部/终端交接帧
  -> QC 通过
  -> Segment N+1 才可入队
```

未通过 QC 的片段不能为后续片段提供连续性事实。

### 4.3 连续性质量边界

平台可以检查并报告连续性风险，但不得承诺模型提供逐帧无缝连续。质量报告至少区分：

- `STORY_CONTINUITY`
- `VISUAL_HANDOFF`
- `FINAL_COMPOSITION`

任何一项失败，都不能把最终状态伪造成成功。

## 5. 后端任务和状态规则

### 5.1 TaskRun 数量规则

```text
一个 GenerationSegment = 一个视频 TaskRun
一个 NarrativeBeat ≠ 一个 TaskRun
一个 VideoVersion ≠ 一个 TaskRun
```

同一项目中，历史版本的 TaskRun 可以存在，但当前 ProductionRun 的实际 Provider 调用数量必须等于当前 GenerationSegment 数量，不得把历史任务数当成当前生成数量。

### 5.2 不可变快照

每个 TaskRun 的 `input_snapshot` 必须记录：

- 所属 `production_segment_id`。
- 包含的 `narrative_beat_ids`。
- 片段时长、清晰度和比例。
- PromptPackage 版本。
- 参考输入模式和已确认素材 ID。
- Provider capability snapshot。

快照创建后不可修改。修改故事、时长、参考素材或分组方式必须创建新的 revision 和新的 ProductionRun。

### 5.3 幂等与恢复

- 同一 GenerationSegment 的相同命令只能创建一次 TaskRun。
- Provider 已返回 request ID 后，Worker 重启只能查询、下载和恢复。
- 片段重试不能重复提交已有 Provider request ID。
- 片段失败只影响其依赖后续片段，已接受且不受影响的片段不得重跑。
- 合成失败不得重跑已成功的 Provider 任务，除非 QC 明确要求片段重做。

## 6. API 和公开投影

浏览器不需要知道 Provider、TaskRun 或队列细节。公开计划只返回：

- 总时长。
- 叙事点数量。
- 预计生成片段数量。
- 每个片段的用户可理解标题。
- 每个片段预计时长。
- 连续性提示。
- 预计整体制作阶段。

公开进度应表达为：

```text
正在生成第 2/3 段
正在检查第 2/3 段
正在合成完整成片
```

而不是：

```text
TaskRun 14/18
Provider Attempt 2
Queue Job 9
```

项目历史列表必须明确区分：

- 当前 ProductionRun 的生成片段。
- 历史 ProductionRun 的片段。
- 完整成片 VideoVersion。

“历史片段数量”不得再次冒充“当前镜头数量”。

## 7. 前端交互规则

面向非专业用户时，界面只展示：

1. “你的内容将被自动拆分为若干连续片段。”
2. “预计生成 3 段，最后合成为 30 秒成片。”
3. “系统会自动保持人物、场景和动作衔接。”
4. “生成失败时只重试失败片段，不重复已经完成的部分。”

工程字段、PromptPackage、参考策略枚举、队列和 Provider 名称隐藏在后台审计中。

用户可以调整：

- 故事原文。
- 总时长。
- 清晰度。
- 风格偏好。
- 参考素材。

用户不需要手工指定每段如何拆分。高级调试页面如未来开放，也不能绕过平台的能力校验、预算守卫和状态机。

## 8. 版本迁移规则

旧版“一分镜一任务”数据不能原地转换：

1. 保留旧 StoryboardRevision、Shot、TaskRun 和 VideoVersion。
2. 新建符合本规范的 StoryboardRevision。
3. 新建 GenerationSegment 映射和新的 ProductionRun。
4. 新版本生成成功后，与旧版本并列展示。
5. 前端默认展示最新完整成片，而不是历史片段总数。

## 9. 通用测试门禁

所有 Provider 和题材必须至少通过：

- 18 个叙事点、30 秒内容被分成 3 个或 6 个生成片段。
- 所有叙事点恰好归属一个生成片段。
- 片段时长总和严格等于目标总时长。
- 实际 Provider TaskRun 数量等于 GenerationSegment 数量。
- 片段依赖顺序和交接帧顺序正确。
- 失败片段可以单独重试。
- 已成功片段和旧 VideoVersion 不被覆盖。
- 最终成片可播放、可下载、可追溯。
- 旧项目历史片段数量不会影响新 ProductionRun 的片段数量。
- 刷新、Worker 重启和重复命令不会增加 Provider 调用次数。

## 10. 平台级强制规则

以后新增任何题材、Provider、媒体能力或 UI 入口，都必须回答以下问题后才能进入代码：

1. 叙事点是什么？
2. 生成片段是什么？
3. 目标时长如何满足 Provider 能力？
4. 一个生成片段是否只产生一个真实 TaskRun？
5. 相邻片段如何连续？
6. 失败和重试是否只影响必要范围？
7. 最终成片如何由已验收片段产生？

如果新功能无法回答这些问题，默认不得新增 Provider 调用或前端生成按钮，必须先补充本规范对应的 ADR、契约和测试。
