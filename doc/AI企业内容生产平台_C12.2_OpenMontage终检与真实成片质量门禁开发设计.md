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
- 技术检查通过且实际执行的可测检查未发现问题时，QC 为 `PASS`；报告仍必须把语义/转写覆盖缺口标为 `UNAVAILABLE`/`PARTIAL`，并推荐人工复核。`PASS` 表示已执行门禁未发现缺陷，不代表所有语义能力均已验证，也不得显示成“全部质量检查通过”。
- 语义评估器以后接入且返回问题：按来源 `revise/fail` 规则阻止完成或触发有界重做；本章不实现新的视觉模型。

## 4. 边界

- 终检只在 loopback Media Runtime 执行，不把本地路径、临时帧或 Provider 响应暴露给浏览器。
- QC 详情存内部 JSON；公开 `QcReport` 只返回安全摘要和状态。
- 不修改 Provider 请求字段、TaskRun 状态机、Veyra、VPS、DNS、部署或 Git 历史。
- 旧 QC 报告、旧运行时响应和旧快照继续可读；新增字段全部可选。

## 5. 验收

- Runtime 单测覆盖四帧抽样、黑帧检测、音频探测、语义不可用降级。
- Production Worker 测试确认合成后先终检，再写入成片资产；实际发现的问题仍为 `NEEDS_ATTENTION`/`FAILED`，仅覆盖缺口不会伪装成已检查或单独降为失败。
- 契约/持久化测试确认内部详情不进入公开 DTO。
- 真实 Provider 生成一条成片，检查实际文件、帧、音轨和数据库 QC 状态。

> **2026-09-01 当前音频口径**：C12.2 终检面对自动生成的视频音频，不把用户上传旁白/样音作为前置；原生 Grok 音频保留，显式 Doubao 替换后仍按同一 QC/产物事实链检查。真实本机对照只按最新自动音频文档执行，不改变本章默认 Mock 与未完成门禁。

## 6. 2026-10-04 终检失败诊断与安全恢复补充

- Media Runtime 对内部 `QC_FAILED` 响应保留有界、脱敏的诊断文本，供 Worker 持久化排障；不返回 Provider payload、签名 URL、凭据或本地文件路径。
- 终态回调若发生在 Worker 已释放租约之后，可在消费记录无 owner/lease 且未完成时补记 dead-letter；仍保护其他 Worker 持有的有效租约。
- 对已存在的历史不完整记录，仅当同一 ProductionRun 恰有一条 FAILED VideoVersion、对应 composition consumption 至少尝试 3 次、含失败原因且无活动租约时，用户通过正式 composition retry 命令可在同一事务补记 dead-letter 并创建一个 replacement request。活跃租约、已完成记录、证据矛盾、多条失败版本或多条候选失败事件均保持阻断。
- 此恢复不改变终检判定：无效容器、真实长黑屏、缺失音轨、异常静音和显式 REQUIRED 字幕缺失仍阻断；`NEEDS_ATTENTION` 仍允许保留成片供人工复核。不得为追求出片而绕过真实重大质量故障。

## 7. 2026-10-04 原生音轨 + 项目级 BGM 误拒绝修复

- 根因：Runtime 曾将所有含 source audio 且有独立 MUSIC payload 的成片统一拒绝；这与《项目级MusicPlan与原生音频所有权收敛开发文档》及固定 OpenMontage `_full_mix` 能力冲突，误把合法的 `LEGACY_PRESERVE` + 单条全片 MUSIC 判成重大 QC 故障。
- 允许路径仅限显式 `LEGACY_PRESERVE`、存在完整 AudioPlan、每条实际含音轨的源片段均有匹配 owner；已拼接原声以一条 `SFX` 输入 OpenMontage `full_mix`，唯一 MUSIC 轨同时输入，最终 remux 只映射 full_mix 音轨。不得把原声改标为 speech/MUSIC、拆分或静默丢弃。
- 独立旁白与无法证明 owner 的 source audio 仍 fail-closed；非 `LEGACY_PRESERVE`、owner 缺失/不符、音频素材无效和不支持的音乐窗口仍拒绝。MUSIC 必须严格从 `0ms` 覆盖至目标时长，非零起点即拒绝，避免片头缺 BGM 却被宣称为全片音乐。
- 回归：Runtime 正向测试验证 `SFX@0 + MUSIC@0`，负向测试验证未授权 owner、独立旁白和非零 MUSIC 起点；这些仅验证路径与门禁，不能替代本项目最终文件的技术检查及人工听感确认。

## 8. 2026-10-05 用户授权的 BGM 容差与 QC 覆盖语义修订

- 用户以本轮认可的 BGM 成片为验收参考，明确要求不要因轻微 BGM 峰值误差使整条 QC 失败，并授权放宽 BGM 标准。该修订只改变最终 AAC 产物的检测容差和 QC 状态解释，不修改来源混音器、响度归一化目标或 Provider 生成逻辑。
- Production Worker 将是否实际应用项目 BGM 的事实传给终检。最终 AAC 解码后 `true_peak_db <= -1.0` 时，BGM 成片不因 `-1.5` 来源混音目标的编码后轻微偏差产生音频告警；无 BGM 成片仍按 `-1.5`。运行时把实际测量值和适用阈值都写入内部 QC 详情。
- `PASS` 仅表示已执行且适用的可测检查未发现缺陷。语义/文字检查缺失仍保留 `UNAVAILABLE`、`review_completeness=PARTIAL` 和 `PRESENT_WITH_REVIEW`，并在安全摘要提醒“部分检查未运行”；不得声称完整语义验收。
- 已观测的容器损坏、黑帧、缺失音轨、异常静音、REQUIRED 字幕缺失及超过适用峰值上限的测量告警不得被覆盖；已有 `BLOCK` / `NEEDS_ATTENTION` 路径保持有效。
- 修订仅适用于当前 C12.2 终检语义；不改变 C12.2 章节整体审计状态，也不改变 C12.4/C12.5、G02、C13、Provider、Git 或部署门禁。

## 9. 2026-10-05 已认可成片基线的 BGM 音轨覆盖保护

- 用户明确指定当前实际成功成片作为产品验收基线，并确认其视频时长 `30.125s`、AAC 音轨时长 `30.052s`（差 `73ms`）可接受。不得把这项已接受的小差异单独判为视频失败，也不得据此声称所有其他路径均已验收。
- 对显式 `MUSIC_REPLACE_PROVIDER_AUDIO` 成片，最终 Runtime QC 必须读取实际 AAC stream duration；要求恰有一条音频流，且音轨相对现有 `VideoInspection.duration_ms`（已验证视频流/容器采用当前 `max` 时长语义）的尾部缺口不超过 `100ms`。容差以被用户接受的成片事实（视频 `30.125s`、AAC `30.052s`、差 `73ms`）为基线，并留出有限的 AAC packet 对齐余量；它是产品验收容差，不冒称为 OpenMontage 来源阈值。冻结 composition target 仍约束 MUSIC 输入和 `_full_mix`，但最终 AAC 编码仅允许本节所列短缺。
- 缺失/无法解析的音轨时长、多于一条音轨，或尾部缺口超过 `100ms` 时，以 `QC_FAILED` fail-closed，不产生可成功交付的 CompositionArtifact。此检查仅保护最终覆盖，不改变 `_full_mix`、BGM 选择、音量/响度、Provider 请求或 mux 策略。
- 来源差异已登记：固定 OpenMontage `tools/video/video_compose.py::_mux_external_audio` 使用 `-af apad -shortest`；当前平台的显式 BGM replacement 路径使用冻结 target 的 `-t` 和 AAC 48kHz，不声称逐命令等价。完整 MUSIC 输入及 `_full_mix` 的 target 覆盖仍按来源语义检查，最终 AAC 的 100ms 短缺仅是以用户接受成片为依据的有限产品容差；具体 flags、理由和变更边界见 BGM TaskSpec §7.7 的来源行为差异登记及 `services/media-runtime/UPSTREAM.md`。
- 验证须包含：实际 FFmpeg 正例（一个 AAC、选定 BGM 存在、Provider 原音不存在、时长符合容差）、精确 `73ms` 正例、`100ms` 边界正例、`101ms` 反例、缺失/多音轨/无效时长反例。不得调用真实 Provider。
- 该门仅属于 Runtime 行为保护；不会自动把既有持久 QC 报告改写为 `PASS`，也不升级章节、GitHub 或部署状态。实现前先登记确切代码/测试写集，完成同一快照独立审计后才可用于发布候选。
