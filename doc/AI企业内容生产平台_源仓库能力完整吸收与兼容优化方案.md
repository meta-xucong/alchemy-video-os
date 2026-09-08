# AI 企业内容生产平台：源仓库能力完整吸收与兼容优化方案

## 1. 文档状态

状态：`HISTORICAL DESIGN BASELINE`（非章节状态；正式章节状态以 formal/state 为准）

> **2026-09-01 语音路线专项覆盖（SUPERSEDED）**：本文第 3.4 节及其它把 TTS 描述为“Provider 之后的后置结构化接口”的文字，不再作为当前音频 owner/路由依据。固定 OpenMontage 的 `GrokVideo.native_audio`、Huobao `generate_audio` 与 `TTSSelector` 是条件化的两条来源路线：先选唯一 owner，native owner 不追加 TTS，TTS owner 才按 registry selector 生成。当前自动旁白不要求用户上传音频或样音；样音由服务端生成并经人工审批，通用参考/资料/MUSIC 上传仍保留。本文的 `VoicePerformance`、`NarrationCue`、cue 对齐和不可用时显式阻断等非冲突内容继续保留；具体冲突以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》为准。本状态不等于代码或真实 TTS 已验收，也不授权外部调用。

> **2026-09-01 本机对照例外**：用户已授权本机 Aiself Grok/Doubao 产物对照；该例外只按最新执行文档运行，不改变本文历史设计状态、默认 Mock、或 Veyra/部署后置边界。

目标：把本轮审计发现的、源仓库已经解决而当前版本仍自行推断的能力，转换为平台内部可测试、可回滚、可兼容的实现。本文只覆盖创作规划、Provider Prompt、参考素材和媒体质量检查，不改变 TaskRun、计费、对象存储和公开 SSE 的边界。

来源：

- `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`
- `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`
- `upstream/seedance-2.5/skill/seedance-25/references/prompting.md`
- `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`
- `upstream/openmontage/schemas/artifacts/script.schema.json`
- `upstream/openmontage/lib/verify_scene_pacing.py`
- `upstream/openmontage/skills/pipelines/explainer/executive-producer.md`

## 2. 审计结论

当前版本已经吸收了 Huobao 的时长容量估算、Seedance 的交接锁、OpenMontage 的技术探测和部分画面变化预检。本轮实现已补齐结构化参考锚点、口播性能契约、源动作主运镜和离线 cue 对齐检查；独立 TTS 的真实反馈环仍按本文边界后置。

本轮前的主要偏差是：参考职责未完整穿过 Worker、规划器按片段序号创造固定运镜、缺少场景/角色/道具锚点、缺少 voice performance 契约，以及没有 cue 对齐门禁。上述前四项和离线对齐门禁已在本轮实现；OpenMontage 的实际旁白时长反馈环仍没有真实 TTS 输入，因此只完成结构化接口和确定性离线校验，不能假装真实 TTS 闭环已经完成。

## 3. 兼容性和冲突处理

### 3.1 Provider 时长与 Huobao 8-15 秒段

Huobao 的 8-15 秒是编辑段上限约束，Seedance 又要求简单动作不要强行增加时间轴。平台继续保留 `GenerationSegment` 作为一次 Provider 调用，并采用：

- 有明确事件/对白边界时，按源 `【镜头N】` 形成多个 MotionBeat；
- 单一连续动作只有一个 MotionBeat，不凭空增加镜头；
- 总时长仍由平台的 Storyboard revision 冻结，未使用的时长只能成为同段视觉尾拍；
- Provider 的 15 秒上限仍由运行时 profile 校验。

这不会改变公开状态机，也不会把逻辑叙事点数量等同为 Provider 调用数量。

### 3.2 参考 role 与既有 `ReferenceBinding.role`

现有 `ReferenceBinding.role` 是公开素材绑定枚举，不能直接改写。新增的 `VisualReferenceRole` 只作为内部 Provider 无关语义，仍由 Control API 在创建不可变 snapshot 时写入。旧 snapshot 缺少 role 时保持可读，并进入 `STYLE` 保守降级；无法安全确定 role 时阻止真实提交，而不是猜测。

### 3.3 结构化字段与旧快照

所有新增字段均为 optional 或带默认值。旧 TaskRun、PromptPackage 和 Storyboard snapshot 不迁移、不重写；新 revision 才填充结构化字段。Provider adapter 只接收 `ResolvedVisualInput` 和已经编译的 prompt，不读取数据库或上游仓库字段。

### 3.4 实际 TTS 与当前 Provider 自带口播（历史路由，已由语音专项文档覆盖）

本文原先按“当前 Provider 没有独立 TTS 资产输入”收敛为仅结构化离线契约；该路由判断已被覆盖。现行必须先按已核验的 native-audio profile 或 `TTSSelector` 选择唯一 owner；`VoicePerformance`、`NarrationCue`、实际时长和禁止 atempo/rubberband 的非冲突边界仍然有效。没有 profile 证据时继续 `BLOCKED`。

### 3.5 视觉语义评估器不可用

OpenMontage 的 CLIP/语义评估器缺失时继续返回 `UNAVAILABLE`，不得伪造通过。本方案新增的是确定性结构和时间对齐校验，不改变这一 fail-closed 规则。

## 4. 目标数据流

```text
故事/资料
  -> NarrativeBeat
  -> SourceShotBinding(scene/character/prop/reference anchors)
  -> MotionBeat(source action + one primary camera + cue range)
  -> PromptPackage(reference declarations + timeline + voice performance)
  -> Provider TaskRun
  -> actual transcript/cue review
  -> OpenMontage technical + alignment + variation QC
```

## 5. 实现范围

### C12.6-A：契约扩展

- 新增 `VoicePerformance`、`DeliveryCue`、`NarrationCue` schema。
- Storyboard shot 增加可选 `scene_id`、`character_ids`、`prop_ids`、`reference_anchors`。
- MotionBeat 增加可选 `source_description`、`reference_anchors` 和 `narration_cue_ids`。
- GenerationSegmentMotionPlan 增加可选 `voice_performance`。

### C12.6-B：源分镜驱动规划

- 每个源动作最多生成一个对应 MotionBeat；只在源文本有明确编辑边界时生成多个 Provider 段。
- 删除按片段序号固定分配的运镜模板。
- 运镜由源事件中的可观察动作推导；无法推导时使用一个稳定主运镜，不创造无来源的第二运动。
- 每个 beat 的 `action`、起止状态和时间必须可追溯到源 narrative beat。

### C12.6-C：参考职责编译

- Provider 输入保持当前 URL 传输协议。
- URL 顺序、Prompt 中的 image 编号和 `role` 必须由同一个排序函数生成。
- Prompt 逐类声明控制范围和禁止迁移范围，特别是 scene 不得被替换成泛化背景，subject 不得从其他图迁移。

### C12.6-D：口播和对齐门禁

- 由源文案生成 `VoicePerformance` 默认值，但不改变原文字节。
- 新增纯函数 `check_narration_alignment`：检查 cue 覆盖范围、连续性、与视觉 landmark 的最大误差。
- Media Runtime 有 cue 时才执行该门禁；没有 cue 时保留现有整段转写流程。
- 默认容差 `0.5s`，不能通过删除 cue 绕过检查。

### C12.6-E：台词结束后的声音边界与长静音处理

本次尾段问题复核了源仓库的已有处理方式：

- Huobao `prompt-generator/video-prompt/SKILL.md` 规定无对白子段使用环境声/动作声，而不是继续写对白。
- Seedance `references/prompting.md` 要求显式声明 `dialogue`、`ambience` 或 `silence` 声音意图，并在全局锁中重复关键声音策略。
- OpenMontage `talking-head/compose-director.md` 使用 `silence_cutter` 做渲染前静音标记，超过 5 秒的长静音建议缩短；`explainer/scene-director.md` 将旁白控制在成片约 85–90%，把剩余时间留给视觉呼吸和 hold。

平台适配采用同一条源仓库路径，不新增口型检测模型或自创评分：

1. Prompt Compiler 在完整台词契约后追加 `POST-DIALOGUE SOUND POLICY`，把最后一个字之后明确编译为 `SILENCE/AMBIENT-ONLY` 的无对白视觉保持；禁止继续口播、发声、口型同步和新的说话动作，人物保持源分镜结束姿态。
2. MotionPlan 的既有 `prop_locks` 和时间轴文本携带同一声音边界，避免只有 Provider Prompt 的单点约束。
3. Media Runtime 继续保留“整段几乎全静音”的异常判定；对单个超过 5 秒的长静音新增源仓库式质量提醒，允许有意的空镜/环境尾段存在，但要求缩短或改成非说话画面后再审阅。

这里的“闭口/中性下颌”只是把源仓库的“无对白、无说话口型”翻译成 Provider 可执行的可见状态，不是新增视觉模型或独立 lip-sync 算法。

## 6. 测试和 Exit Gate

必须通过：

1. 旧 snapshot 在新增 optional 字段下仍可解析。
2. 同一组参考图的 URL 顺序和 Prompt image 编号一致。
3. scene/character/prop/reference anchor 字段不可被规划器凭空生成。
4. 单一连续动作只产生一个 camera movement；多事件只使用源事件对应的 beat，不出现固定“第二段侧跟拍”模板。
5. 完整口播脚本不重复、不新增、不跨段重播。
6. cue 有 gap、overlap、超出视觉时间或超过 `0.5s` 对齐误差时返回 `NEEDS_ATTENTION`。
7. 有对白 Prompt 明确包含 `SILENCE/AMBIENT-ONLY` 尾段策略；无对白 Prompt 不被附加对白契约。
8. Media Runtime 对超过 5 秒的静音返回质量提醒而非伪造通过或误判为 Provider 协议失败。
9. Mock、Provider adapter、Worker 重启和旧公开 API 契约测试全部通过。
10. 真实 Provider 只在本地显式授权配置下运行一版 30 秒目标、480p 输出；不修改 VPS、域名、Veyra 或共享积分。

## 7. 二次审计重点

代码完成后逐项核对：

- 是否仍存在按 `sequence` 选择镜头的固定数组；
- Provider 临时输入是否保留 role 语义；
- 新字段是否穿透到公开 DTO 或泄露签名 URL；
- 规划器是否把估算时长误当成真实旁白时长；
- 台词结束后的视觉尾段是否明确是 `silence/ambient-only`，而不是让人物继续说话表演；
- 长静音是否按源仓库规则生成审阅提醒，而不是被技术探测误报为完整通过；
- 没有 ASR/TTS/CLIP 依赖时是否明确 `UNAVAILABLE`；
- 文档是否把“接口已落地”误写成“真实 TTS 已完成”。

## 8. 不在本章实现

不复制 Huobao 的 Agent/Backlot 状态、不引入 OpenMontage 文件系统事实源、不改变 SUB2API/Veyra 协议、不接 VPS 生产部署、不把真实密钥写入仓库。

## 9. 本轮落地结果

实现后的真实复验使用当前项目的 6 张用户图片和完整中文口播，规划为 2 个 15 秒 Provider 段；临时 relay 修复后最终得到 30.084 秒、848x480、H.264/AAC 成片。首轮暴露的“已编译 Prompt 再次追加对白”已通过 Provider 编译器幂等保护修复。技术 QC 通过；由于当前环境未启用 faster-whisper/CLIP，不把语义和逐字口播检查标记为自动通过。

## 10. 尾段复核补充

对上述真实成片做 `silencedetect` 后，约从 22.86 秒至片尾出现约 7.2 秒静音；最后 2 秒仍有张嘴和手势。该证据确认问题是“视觉尾拍允许存在，但声音边界没有写成 Provider 可执行契约”，不是音频轨损坏。现已按 C12.6-E 补齐声音边界和长静音质量提醒；本轮未重复提交真实 Provider，避免把同一素材的费用调用当作离线规则验证。
