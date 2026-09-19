# C12.3 来源转写与语义终检适配开发设计

状态：`IMPLEMENTED_AND_CORRECTED`

## 1. 来源范围

只复用固定 OpenMontage 快照中的：

- `tools/analysis/transcriber.py`：faster-whisper、词级时间戳、语言识别和可选说话人信息。
- `tools/video/video_compose.py::_compare_transcript_to_script`：脚本/转写 token 比对、90% 覆盖阈值和 TTS 标点泄漏检查。
- `tools/analysis/visual_qa.py`：FFmpeg 抽帧、技术探测和音频级别检查。
- `schemas/artifacts/final_review.schema.json`：终检分层和显式推荐动作。

不迁入 OpenMontage 的自由 Agent、Backlot、项目目录、临时文件事实源或外部模型调用。

## 2. 平台适配

Media Runtime 新增 loopback `TRANSCRIBE_VIDEO` 工具：输入只接受受控 MP4 字节，输出只包含脱敏的语言、时长、segments 和 word_timestamps。Runtime 仅在 `faster-whisper` 可导入时执行；缺少依赖返回 `status=UNAVAILABLE` 与明确 issues，不得降级成空转写。

终检保留现有技术、抽帧、音频和语义不可用边界；Production Repository 从已批准 Creative Brief 自动抽取**明确标记的对白/旁白**，Worker 以 UTF-8 Base64 私有字段传给 Runtime，再使用上游 token 比对规则生成 `CHECKED` 结果。纯画面叙述、营销描述和普通故事梗概不再被当成应说出的台词；没有明确声音意图时，`transcript_comparison.status=NOT_EXPECTED` 且不产生低匹配告警；有明确对白但转写依赖不可用时才返回 `UNAVAILABLE`。用户不需要选择或绑定脚本。上下文限制为 1,200 字符，避免长文本进入 HTTP 头。

这一判定直接沿用来源规则：Huobao `storyboard-breaker` 只对分镜中显式写出的对白/旁白计算台词时长，Seedance prompt 规则要求声音意图明确声明。来源仓库没有更高层的“叙事文本是否为对白”分类器，因此平台只增加这个最小边界适配，不引入自由 Agent 或自创语义评分模型。

视觉语义 evaluator 采用 OpenMontage `video_understand.py` 的 CLIP 分类路径，作为独立、可认证的 loopback 能力；本章不创造图像评分模型。没有 `transformers/torch` 或模型缓存时继续 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW`。该分类结果只证明来源模型完成关键帧分析，不宣称逐像素人物/道具连续性。

## 3. 安全与兼容

- 不开放浏览器或公网转写接口；只允许带 Runtime token 和 operation id 的 loopback 调用。
- 输入、输出和错误不包含本地路径、Provider、对象 key、密钥或原始响应。
- 新字段全部可选，旧 Worker、旧 QC 和旧快照继续可读。
- 模型下载、GPU、HF token、说话人分离不是本地默认前置条件；能力探测失败必须可诊断。

## 4. 验收门禁

- Runtime：无依赖时结构化 unavailable；注入 fake transcriber 时验证词级输出；脚本/转写比较覆盖命中、低覆盖和标点泄漏。
- Worker/Contracts：转写 DTO 解析、错误归一化和公开边界扫描通过。
- 真实转写只有在安装并固定 `faster-whisper` 模型后单独认证；未认证不能将 C12.2 标为 `ACCEPTED`。
- 视觉 evaluator 只有在安装 CPU PyTorch/Transformers、固定 CLIP 模型并通过固定成片夹具后才返回 `CHECKED`。
- 参考图 relay 仍是独立外部能力门禁。

> **2026-09-01 当前音频口径**：C12.3 的转写/终检不要求用户上传旁白或样音；自动视频优先使用 Provider 原生音轨，显式 Doubao 替换只由最新自动音频执行文档授权。本章历史的真实转写/Provider 禁用描述仍约束默认/CI，不构成当前本机实际对照的额外授权。
