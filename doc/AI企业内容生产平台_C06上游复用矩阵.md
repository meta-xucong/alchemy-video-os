# C06 上游复用矩阵：Mock 视频生成闭环

状态：`IN_PROGRESS`
日期：2026-08-13
固定上游快照：仅本机 `upstream/`，受 `.gitignore` 忽略，不进入 Git 索引、submodule 或 gitlink。

## 结论

C06 复用 Huobao 对内置 `ffmpeg-static` / `ffprobe-static` 可用性探测的最小经验，以及“短任务 HTTP 创建后交给后台轮询”的职责划分。平台不会复制其进程内 Provider 调用、MySQL 任务记录、全局 AI 配置、轮询计时器或本地媒体目录。四个指定上游没有一个提供可迁入的平台级 Mock Provider、PostgreSQL 恢复状态机或 MinIO 不可覆盖写入，因此这些边界基于 C02-C05 契约以薄适配重新实现。

| 平台目标模块 | 上游文件 / 符号 / 测试 | 薄适配位置 | 最小修改理由 |
| --- | --- | --- | --- |
| 静态媒体工具可执行性探测 | `upstream/huobao-drama/backend/src/utils/ffmpeg.ts`：`probeBinary`、`checkFfmpegSuite`、`ffmpeg-static`、`ffprobe-static` | `packages/provider-video/src/media-validator.ts` | 保留“先验证 bundled binary 可执行，再使用它”的失败关闭思路；改为 Node `spawn` + 临时文件的纯验证器，不引入 `fluent-ffmpeg` 全局单例、环境变量回退或海报/拼接业务。 |
| Provider 输入字段和后台职责划分 | `upstream/huobao-drama/backend/src/services/adapters/types.ts`：`VideoGenerationRecord`、`VideoProviderAdapter`；`backend/src/services/generation.ts`：`processTask`、`pollTask` | `packages/provider-video/src/port.ts`、`apps/task-worker/src/execution-service.ts` | 保留 `model`、`prompt`、参考素材和 submit/poll/download 的阶段名称；改为平台冻结 `input_snapshot`、`ProviderAttempt`、outbox 和可恢复 Worker。禁止迁入直接 HTTP Provider 调用、`AIConfig`、进程内轮询和 MySQL `SysTaskRecord`。 |
| Studio 生成状态与媒体预览 | `upstream/huobao-drama/frontend/app/views/drama/episode.vue` 的任务状态呈现与视频预览模式 | `apps/studio-web/app/pages/index.vue` 及本地 composable | 仅复用交互意图：公开任务状态、失败后显式重试、使用浏览器 `<video>` 播放受控下载 URL；不迁入短剧/集数模型、前端轮询真相、静态 `/data` 媒体路径或直接 Provider 请求。 |
| Seedance-2.5 参数资料 | 上游 Skill、模型参数与参考约束文本 | 不在 C06 迁入；C07/C11 的 mapper / PromptPackage | C06 只消费已冻结的 `VideoGenerationInputSnapshot`，不解释真实 Seedance 参数，不调用真实模型。 |
| MarkItDown、OpenMontage | `markitdown` converter；`OpenMontage` 的 ToolRegistry、Artifact、媒体工具 | 不在 C06 迁入；分别属于 C10、C12 | 文档解析、抽帧、拼接、QC 和 Backlot 均不应进入 Mock 视频提交/下载闭环。 |

## 不可复用事实

- Huobao 的 `generation.ts` 在 API 进程内调用 Provider、以定时器轮询、写 MySQL，并使用本地下载目录；它不能作为平台 Worker、事实来源或恢复策略。
- 上游的任何 Provider Key、配置页、模型注册、媒体目录、静态视频或测试输出均不会读取或迁入。
- 本章不会实现 `sub2api-video-mcp`、Seedance、Grok、SUB2API、Veyra、扣费、VPS 或域名代码；这些均属于 C07 或更后章节。

## C06 来源登记要求

- 新建的 `packages/provider-video/UPSTREAM.md` 必须记录 Huobao commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`、借鉴符号、保留/舍弃内容和覆盖测试。
- 修改 `apps/task-worker/UPSTREAM.md` 与 `packages/persistence/UPSTREAM.md` 时，必须说明 C06 只是在 C05 消费后续接 ProviderPort，不改变 C05 queue/outbox 的事实边界。
- 禁止把 `upstream/`、固定 MP4、临时媒体、ffprobe 输出文件、签名 URL 或真实配置写入 Git。

> **2026-09-01 当前音频口径**：C06 的 ProviderPort/任务快照不把用户上传旁白或样音当成自动音频输入；Provider 原生音轨和显式 Doubao 资产由最新自动音频执行文档约束。本文旧的无真实调用表述仍适用于本章默认/CI，不改变本机授权范围或引入第二协议。
