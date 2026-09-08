# AI 企业内容生产平台：Provider 异构分辨率与多段合成兼容最小修复开发文档

> 文档状态：已实施，独立技术审计通过，待正式验收（不表示章节已 ACCEPTED）
>
> 编制日期：2026-09-06
>
> 本文只处理“同一次制作中，不同 Provider/Profile 返回了不同实际媒体规格，导致多段成片合成失败”的问题。来源审计、代码实施和独立技术审计已完成；本文件本身不改变正式章节状态。

## 0. 本轮任务记录与审计结论

- 任务范围：只修复异构 Provider 产物进入多段合成时的媒体规格兼容；生成侧仅核对并复用现有下载校验/真实事实传递，合成侧移植 OpenMontage 的探测、目标解析、`scale + pad` 归一化顺序。
- 基线：工作区在本轮开始前已有用户未提交改动；这些改动作为基线保留，不回滚、不重写。本轮代码与测试改动仍限制在第 5 节列出的文件。
- 执行分工：主控负责范围和账本；执行员负责第 4 节代码/定向测试；独立纠察员只读复核来源映射、差异和行为证据。
- 来源审计结论（2026-09-06）：固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的符号和行为映射可复核，生成侧不得扩展为线路绑定/尺寸推断；代码已补齐 Runtime 合成前的异构媒体归一化。真实 canary 进一步暴露了参考图 relay 的 HEAD 路由把 HEAD 当 GET、触发完整对象读取的问题，已按平台薄壳边界补 metadata-only `HeadObject` 路径并 fail-closed；不改变 Provider 请求、公开契约或媒体语义。混合尺寸本地 MP4 的 cut/xfade、音频布局、缺失事实阻断和清理行为测试，以及 relay 定向测试均已通过，技术窄片可提交 `READY_FOR_AUDIT`；不得在本轮直接标记 `ACCEPTED`。

## 1. 问题事实与目标

最近一次“保险 AI 介绍”运行中，三个 Provider 任务均已成功、三个片段 QC 均已通过，但最终合成返回 `MEDIA_RENDER_FAILED`。已保存的三个 MP4 实际为 `848x480`、`848x480`、`752x416`。当前 Runtime 的多段图只设置 `fps`/`yuv420p` 后直接 `concat` 或 `xfade`，没有先统一画布，所以单段成功不等于多段可合成。

本次目标只有两个：

1. 生成侧保留并利用 Provider 下载后的真实媒体事实，确保请求参数、下载校验和后续合成看到的是同一份事实；减少因线路混用而产生的不可诊断结果。
2. 合成侧按固定 OpenMontage 的探测、目标解析、归一化、再拼接顺序处理异构片段，使保留内容的 `pad` 路径可以完成 `concat`/`xfade`，无法安全确定目标或无法归一化时明确失败并保留内部原因。

“480p”只代表请求/交付意图，不得被当作 Provider 返回尺寸的事实。实际宽高必须以下载后 `ffprobe` 结果为准。

## 2. 硬性边界

### 2.1 允许做的事

- 复用现有 `VideoProviderPort`、`resolution`、`ratio`、`duration` 请求字段。
- 复用现有 `validateMp4Bytes` 的 MIME、字节、SHA-256、`ffprobe` 校验和已有资产的 `width`、`height`、`durationMs` 持久化。
- 在合成前对每个已接受片段进行 OpenMontage 等价的真实媒体探测。
- 仅在规格不一致或当前拼接操作要求统一流时，按 OpenMontage 的 `scale + pad` 方式生成临时规范化片段，再进入现有音频归属和转场图。
- 复用现有 `MEDIA_RENDER_FAILED`/`QC_FAILED` 错误边界；内部日志或受控审计摘要可记录片段序号和已探测媒体事实，但不得记录密钥、签名 URL、完整 Provider 原始响应或对象存储凭据。
- 为上述行为增加本地 fixture、Mock 和已有产物的定向测试。

### 2.2 明确不做的事

- 不新增 Provider 协议、Provider 账号绑定字段、Smart Router 规则、自动换线路、自动重提交或隐藏的 Provider fallback。
- 不把某个线路的尺寸硬编码成“480p”目标，不根据猜测添加新的宽高、裁切比例或智能画布算法。
- 不改变分镜、时长、旁白、字幕、BGM、口型、转场判定、AudioPlan 或 TimelinePlan 语义。
- 不通过静默裁切、拉伸、丢帧或覆盖原视频来“修复”差异。默认使用等比例缩放加 `pad` 保留全部画面；`cover` 只有在已有调用方明确提供现有 `cover` 语义时才能继续使用，本文不新增该选项。
- 不修改公开 HTTP/API、事件、数据库状态机或前端语义。若确需新增跨模块字段，必须先停下并更新领域/API 契约；本方案的首选是不新增字段。
- 普通 fixture/CI 测试不调用真实 Provider/TTS、网络、VPS、SSH、部署或 Git；本次用户明确授权的单次真实 canary 例外及其证据单列在 §6.3.1，不改变普通测试门禁。

## 3. 固定来源与可复用语义

### 3.1 OpenMontage 固定基线

固定来源：`upstream/openmontage`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。

| 来源符号 | 原始行为 | 本平台薄壳用法 |
| --- | --- | --- |
| `tools/video/video_stitch.py::_probe_clip` | 通过 `ffprobe -show_streams -show_format` 读取宽高、视频/音频 codec、像素格式、fps、采样率、声道、时长、文件大小 | 合成前读取相同的真实事实；不依赖请求中的 `480p` 字符串 |
| `tools/video/video_stitch.py::_needs_normalization` | 比较多个片段的宽高、fps、视频/音频 codec、采样率，判断是否需要规范化 | 保留差异判断；不可比较或探测失败则 fail-closed |
| `tools/video/video_stitch.py::_resolve_normalization_target` | 目标优先使用已有 media profile；其次是已有显式 `target_resolution`/`target_fps`；否则以第一个片段作为参考 | 只消费当前已有 profile/目标输入；没有目标时沿用第一个已接受片段的实际宽高，不能自造固定宽高 |
| `tools/video/video_stitch.py::_normalize_clip` | `scale=W:H:force_original_aspect_ratio=decrease` 后 `pad=W:H:(ow-iw)/2:(oh-ih)/2`，统一 fps、codec、AAC、像素格式 | 迁移同一画面保留策略；参数由当前已有合成 profile/来源默认决定 |
| `tools/video/video_stitch.py::_stitch` | 先探测/判断差异，必要时规范化，再执行 cut/crossfade/fade 拼接，最后重新探测产物 | 现有 Runtime 保留自己的音频所有权图，只吸收“先 probe、再 normalize、后拼接”的顺序 |
| `tools/video/video_compose.py::_compose` | 组合时每个视频 cut 重新编码；使用 `scale + pad`（pad 模式）、`setsar=1`、统一 fps、H.264/AAC、48kHz 双声道；无音轨时补有限静音轨以保证 concat 流布局 | 只在当前 Runtime 已有音频布局需要统一时复用其音频流归一化事实；不把静音轨当作旁白或 BGM，不改变现有 AudioPlan owner |

### 3.2 平台现有事实

- `packages/provider-video/src/media-validator.ts::validateMp4Bytes` 已通过 bundled `ffprobe`读取真实视频宽高和时长，返回 `ValidatedVideo`，并由 Task Worker 传入 `completeGeneratedTaskRun`。
- `apps/task-worker/src/execution-service.ts::finishDownload` 已校验 MIME、Content-Length、SHA/对象幂等并持久化 `width`、`height`、`durationMs`。
- `services/media-runtime/runtime.py::_inspect_path` 已在 Runtime 对输入/输出做尺寸、时长和音频探测；`compose_video_bundle` 已有现有 transition、音频 ownership、字幕和最终 QC 逻辑。
- 当前 `apps/production-worker` 只把已接受片段字节交给 Runtime；合成前再次以字节探测是必要的边界校验，不用相信数据库中的请求分辨率或可能过时的摘要。

### 3.3 来源冲突的处理

同一 OpenMontage 上游的两个工具在最终工作流中有不同上下文：`video_stitch` 使用其 media profile/fallback 目标并提供通用拼接，`video_compose` 的视频 compose 已规定 `setsar=1`、30fps、AAC 48kHz 双声道和无音轨时的有限静音布局。当前平台 Runtime 还承担 AudioPlan/Provider 音频所有权和 24fps transition filter graph，因此不得整段复制一个工具而改写另一层语义。

本次采用最小映射：

1. 对“目标解析、宽高保留、等比例缩放、居中留边、再拼接”优先复用 `video_stitch` 的符号顺序和 `video_compose` 的 `pad` 过滤器事实。
2. 对音频流只复用当前 Runtime 已经采用的 `AAC/48000/双声道` 和无音轨有限静音布局；保留现有 AudioPlan owner、native 音频、旁白、BGM、ducking 和 transition 规则。
3. 如果某个来源参数与当前已冻结的 Runtime 合同冲突，不凭经验合并；记录具体冲突并保留当前合同，或 fail-closed。

特别说明：OpenMontage 工具在缺少可用首片事实时存在 `1920x1080` 等 profile 默认值；本平台没有该目标的来源事实，本方案不复制该默认值。首片宽高无法探测或不合法时直接 fail-closed。

## 4. 实施方案

### 4.1 生成侧：请求与真实结果事实闭环

1. 保持现有 `VideoGenerationInputSnapshot` 和 Provider payload 的 `model/prompt/duration/resolution/ratio/image` 字段及映射顺序，不添加账号锁定、尺寸猜测或自动重提交。
2. 保持 `validateMp4Bytes` 对下载 MIME、非空、`ffprobe` 视频流、正整数宽高、有限时长的门禁；确保真实 Provider 和 Mock 都走同一条结果校验路径。
3. 保持 `ValidatedVideo.width/height/durationMs` 进入现有 `completeGeneratedTaskRun`/Asset 元数据。若代码复核发现某个生产路径绕过该校验，只修复为复用该既有函数，不另写一套 probe。
4. 在生产合成前使用已下载字节的再次 probe 作为最终事实。请求写入的 `resolution` 只能用于审计对照，不能作为实际尺寸。
5. 不因单段返回尺寸与请求值不同而自动换线路或重新生成；若合成侧可按本文件归一化就归一化，否则返回可诊断的不可合成失败。

生成侧的完成标准是“每个片段均有可复核的实际宽高/时长，且这些事实一路传到合成前检查”，不是强行让每个 Provider 返回同一尺寸。

### 4.1.1 真实参考图 relay 的最小边界修正

真实 canary 证明，Hono 会把 `HEAD` 请求按 GET 路由分发；如果 handler 无法区分实际方法，relay 预检会读取完整对象。平台因此只在已有 `S3StoragePort`/内存实现中增加内部 metadata-only `inspectObjectMetadata`（单次 `HeadObject`），由 provider-input handler 在保留 token、workspace/project、READY、IMAGE、claim SHA/MIME/size 校验后调用。缺少该能力的自定义 StoragePort 直接返回 404，不回退到需要 `GetObject`+SHA 的 `inspectObject`。GET 和上传确认仍沿用原有完整字节/哈希路径；这只是平台 HTTP/存储外壳修正，不是 OpenMontage 新媒体算法。

### 4.2 合成侧：OpenMontage 顺序的最小迁移

1. 在 `compose_video_bundle` 多段分支进入 FFmpeg filter graph 前，对每个输入调用现有 Runtime 的受控 `ffprobe` 边界，读取至少宽、高、fps、视频 codec、像素格式、音频 codec、采样率、声道和时长。
2. 按 `_needs_normalization` 的比较语义判断是否兼容。任何必需字段缺失、无效或探测失败都返回 `MEDIA_RENDER_FAILED`/`QC_FAILED`，不得猜测。
3. 解析目标时遵循 `_resolve_normalization_target` 的优先级：已有 profile/显式目标（若当前调用已经有）优先；否则第一个已接受片段的实际宽高作为目标。本文不新增公开 `target_resolution` 字段。
4. 对需要归一化的片段创建受控临时文件，使用 `_normalize_clip` 的等比例缩小/居中 `pad` 语义，统一到当前 Runtime 合同所需的视频帧率、H.264、`yuv420p`、`setsar=1`。不得裁切内容或把画面强行拉伸。
5. 对没有音轨的片段，沿用 `video_compose::_compose` 的有限 `anullsrc` 思路，只为保证拼接流布局；该静音不是 narration、MUSIC 或 provider audio，不得改变 owner 或自动填充人声。
6. 使用规范化后的临时片段进入现有 `concat`/`xfade`/bridge 图，继续沿用当前 transition plan、AudioPlan 和音频所有权过滤。不得借归一化之机更换 transition 或重排片段。
7. 合成成功后重新执行现有 `_inspect_path`/最终 QC，确认输出宽高统一、音频/时长仍满足原有门禁；临时文件在成功和异常路径均清理。
8. 内部诊断至少能够回答：哪个片段的哪个事实与参考目标不同、是否执行了 normalization、归一化目标是什么、最终 FFmpeg/Runtime 阶段是什么。对外仍使用现有脱敏错误码和前端错误语义。

### 4.3 失败与重试边界

- `ffprobe` 失败、媒体事实缺失、目标无法解析、规范化命令失败：保持现有不可成功的 Runtime 错误；不得让 FFmpeg 的模糊 stderr 成为唯一诊断。
- 规范化失败不触发新的 Provider submit；已有 `provider_request_id` 不变，用户显式重试沿用现有任务状态/幂等规则。
- 成功的单段 Asset 不被原地修改。规范化文件只作为本次 composition 的临时中间产物，最终成片仍通过现有 Storage/Asset 写入和 QC 流程。

## 5. 允许改动文件与禁止触碰范围

### 5.1 预计允许的最小范围

| 文件 | 允许内容 |
| --- | --- |
| `services/media-runtime/runtime.py` | 增加/复用私有 media facts probe、OpenMontage 等价目标解析和 `scale+pad` 规范化；接入现有多段 compose 前后；保留错误码、音频、字幕、转场语义 |
| `services/media-runtime/tests/test_runtime.py` | 异构宽高/fps/音频流的本地 fixture、规范化命令/最终探测、清理和 fail-closed 行为测试 |
| `apps/task-worker/src/execution-service.ts`（仅必要时） | 证明真实 Provider 下载结果仍走现有 `validateMp4Bytes` 并保存实际 width/height；不得改 submit/轮询/重试协议 |
| `apps/task-worker/tests/execution-service.test.ts`（仅必要时） | 两个不同实际尺寸的 MP4 下载 fixture 仍可被同一校验路径接受并保存事实；不得真实网络 |
| `apps/production-worker/src/media-service.ts`（仅必要时） | 仅传递已有 composition 输入或改善内部可诊断错误，不改任务状态/AudioPlan/字幕语义 |
| `apps/production-worker/tests/media-service.test.ts`（仅必要时） | 证明 composition 调用仍传原片段顺序、不会重复 Provider submit，且 Runtime 失败仍按现有错误边界处理 |
| `services/media-runtime/UPSTREAM.md` | 登记固定来源、薄壳差异、测试证据和未闭合边界；不将本方案写成上游已有完整平台逻辑 |
| `packages/storage-client/src/index.ts` | 仅增加内部 metadata-only `HeadObject` 读取；保留完整 `inspectObject` SHA 语义，不改变公开 HTTP/Provider 契约 |
| `packages/storage-client/tests/storage-client.test.ts` | 证明 metadata-only 查询不发 `GetObject`，完整 inspection 仍计算 SHA；保留既有 MinIO 环境 skip |
| `apps/control-api/src/app.ts` | 按实际 `HEAD` 方法选择 metadata 分支；无 metadata 能力时 fail-closed，不回退完整下载 |
| `apps/control-api/tests/c06-task-routes.test.ts` | 证明 GET/HEAD、claim 校验和缺少 metadata 能力时的 404/不调用完整 inspection |

### 5.2 默认禁止触碰

`packages/contracts` 公开 DTO、事件/状态机、`apps/studio-web` UI、Smart Router 账户配置、TTS/旁白/BGM、字幕策略、分镜/时长规划、Veyra/共享积分、真实 Provider 配置，以及与本问题无关的历史用户改动。

如果实施时发现必须改变上述边界，当前执行应立即停止，登记冲突并先走契约/ADR 审计，不能在本章内顺手扩大。

## 6. 测试与验收清单

### 6.1 生成侧离线证据

- Mock/fixture Provider 的提交字段仍是原有 `resolution`/`ratio`/`duration`，不出现第二套 mapper。
- 下载得到 `848x480` 与 `752x416` 的合法 MP4 时，两者均通过现有 MIME/Content-Length/SHA/ffprobe 门禁，且分别保存真实 `width`、`height`、`durationMs`。
- 无效容器、缺视频流、宽高/时长缺失仍 fail-closed；不因请求写了 `480p` 而伪造尺寸。
- Worker 重启/重复消息不产生第二次 Provider submit；本次修复不改变 request ID 和幂等行为。

### 6.2 合成侧行为证据

- 相同规格的多段输入继续走现有拼接语义，输出内容顺序、转场、音频 owner、BGM/旁白和时长门禁不变。
- `848x480 + 752x416` 的多段 `cut` fixture 能先规范化再成功拼接，输出统一目标为第一个片段实际尺寸（除非已有明确 profile/目标），画面使用等比例 `scale + pad`，无静默裁切/拉伸。
- 异构输入在 `BLEND`/`BRIDGE`/xfade 路径也先完成必要规范化；不能直接将异构流送入 xfade。
- 混合音频/无音频片段在规范化后仍使用现有 AAC/采样率/声道和有限静音布局；不得把静音解释为旁白或 BGM。
- `ffprobe` 失败、规范化失败、非法目标和临时文件异常均产生现有错误码，内部保留片段序号/事实；不生成伪成功成片。
- 输出再次通过现有视频探测、音频探测、时长和最终 QC；临时文件成功/失败均清理。

### 6.3 跨层与回归

- `production-worker` composition fixture 证明输入片段顺序和原始字节仍按已有调用路径传递，Runtime 负责真实 probe/normalize。
- 生成侧复用证据：`@alchemy-video/task-worker` 本地 fixture 全套 `38 passed / 5 skipped / 0 failed`；5 个 skip 均为既有 BullMQ/Redis 持久化环境门禁，未被本轮当作通过证据，且本轮没有新增生成逻辑。
- 固定项目的已有失败样本优先使用已保存的本地片段重放；没有单独授权时不得重新提交真实 Provider。本次授权 canary 的唯一真实提交见 §6.3.1。
- 运行与改动风险相称的 Runtime、Task Worker、Production Worker 测试、typecheck、Python compile 和 `git diff --check`。
- 参考图 relay 证据：storage-client `7 pass / 1 explicit MinIO-gated skip`、Control API C06 `12/12`；metadata-only HEAD、Hono HEAD 分发和无 capability fail-closed 均有行为断言。该 skip 不当作通过证据。
- 真实 Provider、真实 Aiself/Sub2API、Veyra、网络、VPS 不属于本章普通测试证据；若未来需要真实验证，必须另行授权并登记 profile/次数/额度。

### 6.3.1 本次用户授权真实 canary（2026-09-06）

- 使用已重启的本地 full stack（`VIDEO_PROVIDER=sub2api`）和固定“茅山温泉・桃李春风”30 秒样本，走真实多参考图 relay、Provider 提交、轮询、下载、两段合成和最终资产写入；未输出 Provider key、原始响应或签名 URL。
- 公网 relay 无效 token 的 `HEAD` 返回 `404`，随后真实任务 `prd_01M1TX7JNWKBFDD10SYBRCB5R8` 两段均 `ACCEPTED`，ProductionRun `SUCCEEDED`，没有重提交。
- 产物：`[local-30s-canary-prd_01M1TX7JNWKBFDD10SYBRCB5R8.mp4](../.codex-longrun/media-review/local-30s-canary-prd_01M1TX7JNWKBFDD10SYBRCB5R8.mp4)`。Bundled `ffprobe`：`30.084s`、`752x416`、H.264、`yuv420p`、24 fps；音频为 AAC、48 kHz、双声道；文件大小 `7,094,101` bytes。
- 该 canary 只证明这一次真实链路已经越过 relay、Provider 和合成收口；不替代其他账号/规格/内容的稳定性、人工听感或正式章节 `ACCEPTED`。本次没有修改公开契约、状态账本、Provider 配置或 Git。

### 6.4 Exit Gate

只有同时满足以下条件才可把本窄片提交审计：

1. 生成侧没有新协议/新路由/新重试，真实结果事实沿现有校验和资产路径可复核。
2. 合成侧确实先 probe、按来源优先级确定目标、按 `scale + pad` 归一化后再进入原有拼接和音频图；本轮 Runtime 143/143 为 0 skip，生成侧既有 Task Worker 的基础设施 skip 继续保留并单列。
3. Runtime 窄片的同规格回归、异构规格成功、无效输入阻断、音频/转场保真、临时文件清理测试全部通过且 0 skip；生成侧既有基础设施测试的 5 个 skip 必须保留并单列，不能伪装成通过；不以静态源码命中替代行为证据。
4. `UPSTREAM.md` 登记固定 commit、具体符号、薄壳差异和未覆盖边界；没有宣称上游未提供的账号路由、智能选择或质量保证。
5. 正式总控、状态账本和章节审计记录在审计员确认前不升级为 `ACCEPTED`；本文件的测试结果不能替代正式账本。

## 7. 实施顺序与协作分工

### 阶段 A：先审计，不改代码

- 主控核对本文件与 AGENTS.md、领域/API 契约、正式总控的范围关系。
- 纠察员逐项核对 OpenMontage 固定 commit 符号、当前 Runtime filter graph、Provider 下载事实和潜在的公开契约/状态越界。
- 审计不通过时只修本文文字；不进入代码阶段。

### 阶段 B：生成侧证据与最小修正

- 执行员复核并补齐现有下载校验事实传递/测试；若已有实现满足要求，只新增缺失行为测试，不复制第二套校验。
- 纠察员检查没有账户绑定、Provider fallback、分辨率硬编码或真实调用。

### 阶段 C：合成侧薄壳移植

- 执行员仅在 `runtime.py` 和必要的 Runtime/Worker 测试中移植 probe→target→normalize→concat 的顺序。
- 纠察员逐个 diff 检查 scale/pad、fps/codec/pix_fmt/SAR/audio 参数来源，检查 AudioPlan、native audio、BGM、transition 未被顺手修改。

### 阶段 D：定向回归与审计

- 执行员运行本文件第 6 节规定的 fixture 测试和类型/语法检查。
- 纠察员复核测试不是只验证命令字符串，而是验证异构输入最终产物、错误边界、音频和清理行为。
- 主控汇总证据，只有纠察员确认无越界、无未登记阻断后，才提交 READY_FOR_AUDIT；不自动 ACCEPT。

## 8. 已知证据边界

- OpenMontage 提供的是媒体探测、统一格式和拼接工具，并未提供“多 Provider 账号自动选择”或“480p 返回值强一致”保证；这些仍是平台外壳/Provider 事实，不能冒充来源能力。
- 本方案解决的是“媒体规格不兼容导致最终合成失败”，不保证 Provider 的画面内容、原生语音质量、口型、字幕文字或旁白时长质量。
- `scale + pad` 会改变画面周围的画布（可能出现黑边），但不裁切原内容；如未来需要 `cover`，必须以已有来源和明确产品选择单独审计，不在本方案隐式开启。
- 本文完成后最多说明代码/测试窄片可提交审计；真实多线路稳定性、费用、网络和人工观感仍需独立实测证据。
- 真实 canary 的 KIE/Aiself 外部抓取仍依赖可从公网访问的 relay origin；本次修复只消除本地 Control API HEAD 误触发完整 GET 的问题，不能证明外部 DNS/隧道或上游账户永远可用。一次真实 canary 成功或失败都不改变该边界。
