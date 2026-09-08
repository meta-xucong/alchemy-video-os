# C12.2 OpenMontage 终检与真实成片质量门禁开发设计

状态：`READY_FOR_AUDIT`

## 1. 目标

把 OpenMontage `final_review.schema.json`、`source_media_review.py`、`variation_checker.py`、`slideshow_risk.py` 和媒体抽样能力接入当前 C12 合成链路，解决“容器技术检查通过，但没有证明实际成片被检查”的问题。

本章只吸收来源中已有能力，不新增自创的视觉模型或评分规则。视觉语义、对白转写、字幕核对在本地没有可验证运行时的情况下必须显式标记 `UNAVAILABLE`，不能伪造通过。

## 2. 终检范围

合成完成后、产物写入对象存储前执行一次内部 `FINAL_REVIEW`：

- `technical_probe`：容器、时长、分辨率、帧率、编码、文件大小、音频流。
- `visual_spotcheck`：至少抽样开头、中段和结尾 4 帧，确认帧可读并检查黑帧。
- `audio_spotcheck`：确认音频流、声道、采样率和全片异常静音风险。
- 黑帧检查沿用 OpenMontage 的失败闭环，但允许明确的淡黑转场窗口：连续黑场不超过 1 秒时记录为 `NEEDS_ATTENTION` 提醒，不将其误判为渲染失败；超过 1 秒仍阻断发布。这样兼容源仓库允许的 0.5–1.0 秒 fade-through-black，同时继续拦截缺素材或渲染断帧。
- `promise_preservation`：记录当前渲染运行时和是否存在静默降级；语义承诺核对无可用评估器时为 `UNAVAILABLE`。
- `subtitle_check`：没有字幕契约时标记 `NOT_EXPECTED`，不臆测字幕存在性。
- `transcript_comparison`：没有转写器时标记 `UNAVAILABLE`。
- 规划阶段的 `variation_checker` 与 `slideshow_risk`：按上游原始阈值检查镜头尺寸/运动/灯光/峰值/纹理/镜头意图、重复和静态风险；只写入私有计划审计提示，不改写用户故事、不增加 Provider 请求。
- `broken_overlays`、`missing_assets`、`unreadable_text`：当前运行时没有对应 evaluator 时保持未发现值，但必须在 `issues` 中明确“未配置检查”，不能把 `false` 解读为已完成语义确认。

黑帧检查沿用 ffmpeg `blackdetect`，使用 `pix_th=0.1` 的常规黑度阈值；高阈值会把低亮度奇幻/夜景画面误判为整段黑帧，不能作为发布门禁。

## 3. 状态与发布规则

- 技术检查失败：`FAILED`，不得创建成功 VideoVersion。
- 技术检查通过但语义/转写评估不可用：QC 报告为 `NEEDS_ATTENTION`，保留成片供用户查看，但不显示为“全部质量检查通过”。
- 语义评估器以后接入且返回问题：按来源 `revise/fail` 规则阻止完成或触发有界重做；本章不实现新的视觉模型。

## 4. 边界

- 终检只在 loopback Media Runtime 执行，不把本地路径、临时帧或 Provider 响应暴露给浏览器。
- QC 详情存内部 JSON；公开 `QcReport` 只返回安全摘要和状态。
- 不修改 Provider 请求字段、TaskRun 状态机、Veyra、VPS、DNS、部署或 Git 历史。
- 旧 QC 报告、旧运行时响应和旧快照继续可读；新增字段全部可选。

## 5. 验收

- Runtime 单测覆盖四帧抽样、黑帧检测、音频探测、语义不可用降级。
- Production Worker 测试确认合成后先终检，再写入成片资产；终检 `NEEDS_ATTENTION` 不伪造 `PASS`。
- 契约/持久化测试确认内部详情不进入公开 DTO。
- 真实 Provider 生成一条成片，检查实际文件、帧、音轨和数据库 QC 状态。

> **2026-09-01 当前音频口径**：C12.2 终检面对自动生成的视频音频，不把用户上传旁白/样音作为前置；原生 Grok 音频保留，显式 Doubao 替换后仍按同一 QC/产物事实链检查。真实本机对照只按最新自动音频文档执行，不改变本章默认 Mock 与未完成门禁。
