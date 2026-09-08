# 参考仓库能力吸收与冲突矩阵

状态：`SOURCE_OVERVIEW`（非章节状态；正式章节状态以 formal/state 为准；真实 Provider/Veyra/VPS 仍按阶段后置）

> **2026-09-01 当前执行覆盖**：自动旁白不要求用户上传 spoken audio；优先保留已认证 Provider 原生音轨，替换时才由服务端显式 Doubao 生成。用户本轮只授权本机 Aiself Grok/Doubao 对照，默认/CI 仍为 Mock，Veyra、共享积分、VPS、部署和 Git 仍后置。旧的“真实 Provider 一律后置”仅表示默认章节边界，不覆盖该限定的本机对照。

本文件是四个开源来源与当前平台代码的最终对照表。只记录能在固定快照或本地协议夹具中复核的能力；没有证据的能力不被假设为已支持。

底层判定规则：来源已有代码、字段、参数、校验或流程时，优先直接移植；平台仅允许做边界薄壳适配。修改和删减必须引用具体来源并有行为回归；来源没有安全对应实现时保持 `UNAVAILABLE`/`DEFERRED`/`BLOCKED`，不得以自造逻辑替代。当前多源文件/符号映射、跨仓库冲突和逐项验收以《AI企业内容生产平台_多源仓库逐项迁移矩阵与冲突审计开发方案.md》为准；本文件只作来源能力总览，不能替代逐项矩阵或授权新增实现。

> **2026-09-01 语音路线专项覆盖（SUPERSEDED）**：本总览中若将平台旁白、Piper 或 `PLATFORM_NARRATION` 写成所有新任务的固定声音 owner，仅保留为历史概览，已由《AI企业内容生产平台_原仓库语音路线与旁白质量迁移修复开发文档.md》覆盖。当前必须先按固定来源能力选择 native Provider 或来源 `TTSSelector` 的唯一 owner；没有 profile/契约/行为证据仍为 `BLOCKED`。其它来源映射和状态账本不因该专项文档改变。

## 来源到实现

| 来源与证据 | 已吸收的高价值规则 | 平台落点 | 冲突与兼容处理 | 状态 |
| --- | --- | --- | --- | --- |
| `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md` | 8-15 秒段；每段 2-4 个子镜头；同场景保持在段内；编辑性节拍强制分界；对白时长下限 `chars/4.5+2s`；每个子镜头包含动作/相机/对白 | `packages/creative-planning` 的 `MotionBeat`、`dialogue_duration_seconds` 与时间轴 Prompt | 初学者界面不展示子镜头工程字段；普通连续动作不凭动词数量拆 Provider 段；旧 MotionPlan 缺字段按可选兼容 | `ADAPTED` |
| `upstream/seedance-2.5/skill/seedance-25/references/long-video.md`、`editing.md`、`prompting.md` | 时间戳脚本；全局连续性锁；起止状态；明确物理转场；参考图归属；简单动作不强行时间轴 | `MotionBeat`、`CameraShotSpec`、Prompt Compiler、C12 handoff/transition plan | Provider 原生扩展和多图字段仅在能力快照认证后启用；未认证能力降级为文本约束；公开 DTO 不含 PromptPackage | `ADAPTED` |
| `upstream/openmontage/lib/source_media_review.py`、`variation_checker.py`、`slideshow_risk.py`、`tools/analysis/transcriber.py`、`tools/video/video_compose.py`、`schemas/artifacts/final_review.schema.json`、`tools/video/video_stitch.py` | ffprobe 技术探测；音频探测；首尾帧抽样；faster-whisper/VAD/word timestamps；原始 0.9 词准确率与标点泄漏检查；重复景别/静态过度审计；镜头意图/纹理/灯光/峰值和 slideshow 风险检查；终检分层；合成时保留音频并校验时长 | `services/media-runtime/runtime.py`、`main.py`、`MediaRuntimeVideoInspection`、`packages/creative-planning/src/openmontage-variation-audit.ts`、`apps/production-worker/src/media-runtime-client.ts` | 可选依赖缺失时显式 `UNAVAILABLE`，不伪造语义通过；上游字段只通过私有 mapper 投影，新增 DTO 字段 optional | `ADAPTED/PARTIAL` |
| `sub2api-video-mcp` 固定协议登记与 `tools/sub2api-video-certifier`、`fixtures/providers/sub2api` | `POST /videos/generations`、状态查询、内容下载；`model/prompt/duration/resolution/ratio/image`；请求 ID、状态归一化、下载 MIME/长度 | `packages/provider-video/src/sub2api` adapter、runtime profile、offline fixtures | 本地 `upstream/` 没有该仓库源码快照，因此不声称迁入代码；MCP 进程状态、Key 和轮询不进入平台事实，仍由持久化 Worker 承担 | `ADAPTED (protocol-only)` |

## 兼容规则

1. 领域事实仍由平台自己的版本化 DTO、TaskRun 快照、ProviderAttempt、Outbox 和媒体运行时结果承载；来源仓库的字段只通过 mapper/编译器进入内部契约。
2. 新增的 `dialogue_duration_seconds`、音频通道/采样率等字段均为可选，旧数据库快照、旧事件和旧运行时响应无需迁移即可读取。
3. 参考图用途由用户说明优先、视觉分析其次；上传顺序不再承担角色语义。`REFERENCE_SET` 与 `HANDOFF_FIRST_FRAME` 的互斥和优先级保持现有契约。
4. 规划器的镜头覆盖审计复用 OpenMontage 的原始阈值和八类 variation 检查，并附带 slideshow-risk 六维结果；它只产生安全的私有计划提示，不增加 Provider 调用、不改写用户故事、不替代 C12 语义评估。
5. OpenMontage 的 transcript/视觉语义能力若未安装或未通过认证，结果必须是 `UNAVAILABLE`，随后直切并保留 `NEEDS_ATTENTION`，不能用“平滑”文案伪造修复。
6. 真实 Provider 的时长、参考图数量、模型和下载响应以已认证 profile 为准；来源文档中的参数不能覆盖 profile capability snapshot。

## 尚未吸收且明确后置

- Huobao 的进程内 Agent/短剧业务状态、OpenMontage Backlot/自由 Agent、Seedance 的未认证 API 调用、MCP 的本地工具进程状态均不属于平台事实源。
- OpenMontage 可选 transcript 比对和真正视觉语义 evaluator 需要独立运行时与夹具；当前仅保留结构化 `UNAVAILABLE` 路径，没有伪造实现。
- `sub2api-video-mcp` 的本地源码快照未在 `upstream/` 找到，当前只吸收用户登记的协议与 certifier 证据。
## C12.3 新增来源适配

`upstream/openmontage/tools/analysis/video_understand.py` 的 CLIP 关键帧分类路径现由 `services/media-runtime/runtime.py` 的私有 `visual_semantic_review` 复用。它只输出内部 `CHECKED/UNAVAILABLE` 和安全摘要，不宣称逐像素连续性；CPU PyTorch、Transformers 或模型缓存缺失时保持 `UNAVAILABLE`。
### C12.3 对白判定边界修正

- 来源事实：Huobao `storyboard-breaker` 只把分镜描述中明确写出的对白/旁白计入台词时长；Seedance 规则要求显式声明 dialogue、voiceover、ambience、music 或 silence 的声音意图。
- 兼容适配：Production Repository 只传递带引号或“旁白/说道/问道/回答”等明确提示的文本给转写比对；纯故事梗概、画面描述和营销文案不再作为应说出的台词，并以 `NOT_EXPECTED` 表示没有对白预期。
- 旧数据：没有该上下文的历史 composition event 仍返回 `UNAVAILABLE`，不改变历史结果或公开 DTO。
