# AI 企业内容生产平台：Pixabay 自动补曲与 AUTO 音乐计划最小优化开发文档

版本：`0.2.1`

状态：`IMPLEMENTED / PENDING_AUDIT`

生效日期：2026-09-02

本版本性质：`MINIMAL IMPLEMENTATION / FIXTURES ONLY / NO REAL EXTERNAL CALL`

## 0. 本版裁定

本文件只解决一个目标：**用户点击生成时，`AUTO` 在现有音乐选择器找不到有效 MUSIC 资产，才自动通过现有 OpenMontage Pixabay 路径补一首；`MANUAL` 和 `OFF` 永不触发自动补曲。**

本版本取代本文件 `0.1.0` 的设计，但不是状态账本、开发授权或真实网络授权。正式总控、`AGENTS.md`、领域/API 契约和本地 MVP 仍优先；本版代码已按最小边界落地，当前只等待独立审计，不改变正式总控状态。

E02/S01 的显式导入切片仍保持原有语义；本版只增加 `AUTO + 无候选` 的一次性编排，不能把该增量写成 E02 已重新打开或整体章节已接受。

本方案不改变自动旁白、Provider 原生音频、NarrationAsset、TimelinePlan、字幕、转场或视频时长逻辑；不要求用户上传旁白、样音或 spoken audio。

## 1. 对 `0.1.0` 的审计与纠正

| 原设计 | 审计结论 | `0.2.0` 裁定 |
| --- | --- | --- |
| 新增公开 `MusicPlan.auto_pixabay_fallback` 字段 | 会扩大公共契约和 UI 语义；用户已有 `AUTO/MANUAL/OFF` 已能表达“自动/指定/关闭” | 删除该字段；复用现有 `AUTO` 作为明确的自动补曲许可 |
| 另加一个 AUTO 开关 | 与现有三态选择重复，增加持久化、契约和状态分支 | 不增加开关；UI 只需把 AUTO 文案说明为“本地优先，无候选时尝试 Pixabay” |
| 在 Worker/Runtime 追加一套自动选曲逻辑 | 会绕开当前 Control API 资产事务，容易形成第二个选择器或网络路径 | 生成命令进入现有队列前，在 Control API 复用现有选择器事实和导入 helper；Worker 不新增 Pixabay 网络调用 |
| “同一 workspace/project”候选范围 | 当前 `production-repository.ts` 和 `listWorkspaceMusicAssets()` 按 workspace 查询，代码注释明确音乐在 workspace 内共享 | 以现有代码为准：候选仍是当前 workspace 的 server-owned `READY AUDIO + audio_role=MUSIC`；本版不改为 project-only |
| 自动补曲必须自己做关键词、排序、数量阈值 | 原仓库没有这些平台算法；会违反源仓库优先和无自造逻辑规则 | 只把已有文字字段原样作为 query；不做同义词、评分、排序、曲库数量阈值或推荐 |
| 自动补曲自行设计时长修正 | 会混入新的循环、变速、裁剪或补静音策略 | 仅按 OpenMontage explainer 已有调用示例传递现有目标时长；混音仍走现有 Runtime/QC |

旧文档、`AGENTS.md`、`.env.example` 和 `UPSTREAM.md` 中“不会自动联网补曲”的文字，若指向本增量，均应按历史快照理解；当前配置与 Runtime 来源说明已同步为“仅 AUTO 无候选时一次调用”。

## 2. 固定来源与当前已实现基线

### 2.1 固定来源

唯一来源为 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`：

| 来源文件/符号 | 可直接复用的事实 | 本地落点 |
| --- | --- | --- |
| `upstream/openmontage/tools/audio/pixabay_music.py::PixabayMusic` | 搜索页 → `__BOOTSTRAP_URL__` → HTML MP3 fallback → 30–120 默认时长筛选 → 无匹配回退全部 → 首条 → MP3 下载；音乐路径不需要 API Key，稳定性为实验性 | `services/media-runtime/adapters/openmontage_audio/pixabay_music.py` |
| `upstream/openmontage/skills/pipelines/explainer/compose-director.md` | 先取得视频时长；用目标时长作为 Pixabay 筛选输入；音乐覆盖视频并在旁白期间 ducking；最后检查音频事实 | 继续复用现有 Runtime/OpenMontage 混音和 QC |
| `upstream/openmontage/tools/audio/music_library.py`、`AGENT_GUIDE.md` Music Plan | 先看本地音乐，再给用户外部搜索/其它来源选择；不要求平台复制其宿主目录或进程状态 | 继续使用平台 `Asset` 和现有 `AUTO/MANUAL/OFF` |

来源审计结论：OpenMontage 的“自动找 Pixabay 音乐”是 `compose-director.md` 在用户确认音乐方案后执行一次 `PixabayMusic().execute(...)` 的工作流文字；`PixabayMusic` 本身没有“本地候选为空时触发”的平台事件、资产事务或 AUTO 选择器。因此，本版唯一新增的原创部分是平台在既有 `createProductionRun` 前置阶段判断“现有选择器无候选”并调用现有导入 helper；不把这段编排冒充为原仓库已有代码。

### 2.2 当前代码基线

- `services/media-runtime/adapters/openmontage_audio/pixabay_music.py` 是唯一真正执行 Pixabay 网络逻辑的模块；保留来源搜索、筛选和下载顺序。
- `services/media-runtime/main.py` 只通过受保护 loopback `/internal/v1/media/pixabay-music` 暴露该来源。
- `apps/control-api/src/pixabay-music.ts` 只是 loopback transport/metadata decoder；`app.ts` 的 `/api/v1/projects/:project_id/audio/pixabay/import` 已有 workspace、对象、MIME、字节数、SHA、幂等和 `MUSIC` 角色边界。
- `apps/studio-web/app/pages/projects/[project_id].vue` 已支持显式 query 导入；导入成功后形成受控 MUSIC 资产。代码和测试没有 Node 第二抓取器。工作区共享 MUSIC 列表通过既有 `audio-capabilities` 响应提供给 Studio，供“指定曲目”选择。
- `packages/persistence/src/production-repository.ts` 已有 AUTO 候选查询、角色/对象范围校验、已有元数据筛选和确定性选择；没有有效候选时当前 fail-closed。
- `packages/contracts/src/media-runtime.ts::MusicPlanSchema` 目前只有 `mode`、`asset_id`、`style_hint`，没有 `auto_pixabay_fallback`；本版保持形状不变。

因此缺口只有一个：**在现有 AUTO 候选明确为空时，把已有 Pixabay 导入 helper 接入生成命令前置阶段。**

## 3. 最小产品语义

### 3.1 三种模式

| `MusicPlan.mode` | 现有候选 | 行为 | 是否调用 Pixabay |
| --- | --- | --- | --- |
| `AUTO` | 有 | 继续现有 AUTO 选择和混音 | 否 |
| `AUTO` | 无 | 取得已有 query，首次执行现有导入链路，导入为 MUSIC 后重新执行现有 AUTO 选择 | 是，成功路径每次生成命令一次 |
| `MANUAL` | 有效 `asset_id` | 只用指定资产 | 否 |
| `MANUAL` | 无效 `asset_id` | 现有不可用错误 | 否 |
| `OFF` | 任意 | 不加入 BGM | 否 |

自动补曲失败、能力不可用、无结果或产物校验失败时，返回现有可解释错误；不得静默改成 `OFF`，不得偷偷改成手动曲目。

### 3.2 自动 query 的最小来源

不新增关键词生成器。按以下顺序取**已有字段的原文**，不切词、不改写、不排序：

1. `music_plan.style_hint`；
2. 当前已批准 creative brief 的 `style_preferences`；
3. 当前项目已有 `name`。

只接受能通过现有 Pixabay import command 的 `query` 校验的值；没有可用值时 fail-closed，用户可在现有 Studio Pixabay 搜索框中手动输入。不得硬编码 `ambient`、同义词或其它默认推荐词。

### 3.3 自动时长参数

沿用 OpenMontage `compose-director.md` 的已有调用形态：

```text
min_duration = 现有 creative brief 的 target_duration_seconds
max_duration = 300
```

这只是把已存在的目标时长字段传给现有 `PixabayMusic` 输入，不新增时长算法。若来源筛选无匹配，继续使用来源已有的“回退全部结果再取首条”行为；不添加循环、变速、裁剪、补静音或自动改稿。

## 4. 唯一执行链路

```text
Studio 选择 AUTO 并点击生成
  -> 现有 Control API createProductionRun
  -> 复用现有 AUTO 候选查询/谓词
  -> 有候选：原有 createProductionRun/队列/Worker 路径
  -> 无候选：检查既有 Pixabay capability 和 query
  -> 用生成命令的幂等键派生内部 fallback key
  -> 调用现有 loopback Pixabay client（首次成功路径一次）
  -> 复用现有 Storage/Asset import helper 写入 MUSIC 资产
  -> 重新执行同一 AUTO 候选选择器
  -> 有候选：创建原有 production run 并继续原有混音/QC
  -> 仍无候选或失败：返回现有阻断错误，不创建可运行任务
```

### 4.1 代码落点（仅允许这些）

1. **复用现有候选事实**：从 `production-repository.ts` 提取或暴露一个内部只读候选检查，使 Control API 前置检查与最终 composition 使用同一谓词；不得复制第二套 `likelyMusic`、角色、workspace 或时长选择逻辑。
2. **复用现有导入**：将 `app.ts` 当前显式 Pixabay 导入中的下载、Storage 写入、MIME/bytes/SHA、Asset confirmation 抽成内部 helper；显式导入和 AUTO fallback 调用同一个 helper。不得新增 Runtime scraper、公开导入路由或第二个 `PixabayMusicPort`。本来源只提供轨道时长 metadata，本版不新增 ffprobe 探测。
3. **生成命令前置编排**：仅在现有 `createProductionRun` 路由的 `AUTO + 无候选` 分支调用 helper；`MANUAL/OFF` 分支完全不触碰 Pixabay。
4. **保持公共形状**：不新增 `auto_pixabay_fallback`、事件、表、队列消息、Storage key 规则或 Provider 协议。`MusicPlanSchema` 只需同步 AUTO 的文字语义/注释；字段形状保持不变。
5. **Studio 只做现有能力接线**：说明 AUTO 会先用本地 MUSIC，无候选且 Pixabay capability 可用时自动联网补一首；保留现有 MANUAL/OFF 和显式 Pixabay 搜索，并从既有 `audio-capabilities` 响应读取工作区共享 MUSIC 列表供 MANUAL 选择。不增加第二个开关、自动目录轮询或隐藏请求。
6. **配置只复用现有 gate**：继续使用 `PIXABAY_MUSIC_ENABLED`、`MEDIA_RUNTIME_URL`、`MEDIA_RUNTIME_TOKEN` 和现有 capability。未注入/禁用时保持 `BLOCKED/PROVIDER_UNAVAILABLE`；不读取或要求 Pixabay API Key。

### 4.2 幂等与失败边界

- fallback 的内部 key 由当前生成命令的调用方、路径、原始幂等键和 query/时长输入派生；同一生成命令成功重放时复用同一 Asset，不产生第二个 READY MUSIC 资产，也不再次调用已完成的导入。失败重试沿用现有导入命令的重试行为，本版不新增重试协议。
- fallback 在 production run 建立之前完成，因此 Worker 重启、Provider 重试和 composition retry 不会重新触发 Pixabay；它们继续消费已持久化的 Asset。
- 下载失败、非 `audio/mpeg`、超限、坏 bytes、SHA/对象事实不匹配或 Runtime 不可用时，不创建成功的 production run；不静默无 BGM。
- 现有 `If-None-Match: *`、对象事实比对、workspace/project 范围和 server-owned `audio_role=MUSIC` 原样保留。
- 不增加跨不同用户命令的曲目去重、缓存、并发合并或曲库数据库；这不是本次最小目标。

## 5. 不得做的事

- 不增加 `auto_pixabay_fallback` 字段或第二个 UI 开关。
- 不恢复 Node `PixabayMusicAdapter`、浏览器直连、Freesound、Suno 或其它曲库。
- 不新增排名、推荐、相似度、同义词、曲目数量阈值、语义时长推断或自动改稿。
- 不改变 TTS、Provider 原生音频、NarrationAsset、TimelinePlan、字幕、转场、AudioPlan 或音量/ducking 逻辑。
- 不通过 atempo、循环、裁剪、补静音或额外 FFmpeg 图解决音乐/旁白时长问题。
- 不把 Pixabay URL 写入 `MusicPlan`、公开 DTO、数据库事实或日志；只保存现有导入 metadata 和内部 `asset_id`。
- 不因本文件自动开启真实 Provider/TTS/Veyra、共享积分、VPS、部署或 Git。

## 6. 定向验证（全部离线 fixture/mock）

实现后只增加以下最小证据：

1. `AUTO + 已有有效 MUSIC`：Pixabay client 调用次数为 `0`，生成路径保持原结果。
2. `AUTO + 无候选 + 可用 Pixabay fixture`：首次成功路径 client 调用一次，导入一个 `AUDIO + READY + MUSIC`，随后原有 AUTO 选择成功。
3. 同一生成命令以相同幂等键重放：返回同一结果/资产，不产生第二个 READY 资产，也不再次调用已完成的导入。
4. `MANUAL`、`OFF`：Pixabay client 调用次数均为 `0`。
5. capability 未注入/禁用、空 query、无结果、非 2xx、unsafe URL、非法 MIME、超限和坏 metadata：保持现有阻断/错误归一化。
6. 样音、`USER_SOURCE_AUDIO`、未声明角色不能成为 AUTO 候选；现有跨角色回归继续通过。
7. 全仓代码仍只有 `services/media-runtime/adapters/openmontage_audio/pixabay_music.py` 执行 Pixabay 网络逻辑；不出现第二 scraper、自动 catalog polling 或新协议。

真实 Pixabay smoke 只能作为单独的外部可达性检查，不能替代上述离线证据，也不能作为本切片的 CI 前提。

## 6.1 实施证据（2026-09-02）

本版最小实现已经落在既有模块，当前标记为 `IMPLEMENTED / PENDING_AUDIT`，不是 `READY_FOR_AUDIT` 或 `ACCEPTED`：

- `packages/persistence/src/production-repository.ts` 导出并复用同一个 `isUsableMusicAsset`，组合选择与 Control API AUTO 前置检查不再各自维护候选规则。
- `apps/control-api/src/app.ts` 将既有显式 Pixabay 导入的 Asset 预留、Runtime 调用、对象 `If-None-Match`、MIME/字节/SHA 校验和确认流程抽为内部 helper；`AUTO + 无候选` 只调用该 helper 一次，`MANUAL/OFF` 不进入该分支。
- `apps/control-api/tests/pixabay-auto-fallback.test.ts`：`4/4`；覆盖 AUTO 有/无候选、幂等重放、MANUAL/OFF 和未注入能力阻断。
- Control API 定向组合测试：`35/35`；新增 AUTO fallback 夹具：`4/4`；Control API 全量：`64` pass、`1` 个既有服务门控 skip、`0` fail；Studio 全量：`40/40`；Persistence 全量：`66` pass、`11` 个既有数据库门控 skip、`0` fail；Media Runtime adapters：`38/38`，Runtime：`136/136`。根 `pnpm test` 退出码为 `0`；workspace typecheck、build、`validate_state.py` 和 `git diff --check` 均通过。所有新增证据均为 fixture/mock 或本地 bundled media，未调用真实网络或 Provider。
- `apps/studio-web` 只更新 AUTO 说明文案；没有增加公开字段、路由、第二开关或后台轮询。

正式总控、`.codex-longrun/state.json` 和总体 `C12.4/C12.5` 状态本轮不升级；E02/S01 的历史账本也不被重开。本节是当前增量的实现证据，仍需独立审计后才能申请切片 `READY_FOR_AUDIT`。

## 7. 文档与状态同步顺序

本版已经按以下顺序完成最小实施；后续只允许审计对账，不得借本文件扩大开发范围：

1. 代码和 fixture 已按第 4、6 节落地，且复用唯一 Runtime Pixabay 路径。
2. `.env.example` 和 `services/media-runtime/UPSTREAM.md` 已将旧“仅显式导入”语句标为历史，并同步当前 AUTO 无候选时的一次调用语义。
3. 本文件和现有正式账本明确区分实现证据与验收状态；本增量只对既有音频能力响应增加工作区 MUSIC 只读列表，不改生成命令、事件、状态或 Provider 协议。
4. 独立审计复核来源、依赖方向、错误/幂等和全量定向证据后，才可将本增量申请为 `READY_FOR_AUDIT`；独立审计通过才可 `ACCEPTED`。

## 8. 验收标准与保留限制

只有同时满足以下条件，才算本功能完成：

- AUTO 无候选时确实走现有 Pixabay Runtime→Control API→Asset import 链路；有候选时绝不联网。
- MANUAL/OFF 永不自动补曲；失败不静默降级。
- 只有一个来源网络路径，资产角色、对象、MIME、字节、SHA、workspace 和幂等事实与手动导入一致；轨道时长沿用来源 metadata。
- 定向 fixture 全部通过，文档和四账本一致；未用真实网络替代行为测试。

本方案仍接受 OpenMontage Pixabay scraper 的实验性限制：网站结构变化可能导致无结果或不可用。自动 query 只使用已有业务字段；字段为空、过长或来源无结果时，用户必须回到现有手动导入或选择 `OFF`。本方案不承诺音乐审美匹配、跨命令去重或完整音频时长重规划。

**本版结论：不新增设计对象，只把现有 `AUTO` 的“无候选即阻断”替换为“无候选时一次性复用既有 Pixabay 导入，再回到同一 AUTO 选择器”。**

## 9. 2026-09-06 指定曲目不可选择修复（最小适配）

### 9.1 根因

Studio 原先只在项目详情 `assets` 中筛选 `AUDIO + READY + metadata.audio_role=MUSIC`。但现有候选事实和 `listWorkspaceMusicAssets()` 明确按 workspace 共享；因此曲目属于同一工作区的其它项目时，Studio 列表为空，`MANUAL` 单选被错误禁用。后端最终组合选择并未丢失该曲目，问题只在选择器展示/接线。

### 9.2 最小修复

- 复用 `AssetWorkspaceStore.listWorkspaceMusicAssets(workspaceId)`，在既有 `GET /api/v1/projects/:project_id/audio-capabilities` 响应增加只读 `music_assets` 列表；每项使用现有安全 `Asset` DTO，不暴露 `object_key`。
- Studio 的 `refreshAudioCapabilities()` 保存该列表；`musicAssets` 仅把它与项目详情资产按 `id` 去重后继续使用原有 READY/role 过滤和显示逻辑。
- 生成请求仍只提交原有 `MusicPlan { mode, asset_id, style_hint }`；MANUAL/OFF 不触发 Pixabay，后端仍以同一 workspace MUSIC 谓词和资产范围校验为准。

### 9.3 证据

- Control API `control-api.test.ts`：无曲目时 `music_assets=[]`；曲目在同 workspace 另一项目时，目标项目的 capability 响应仍返回该 READY MUSIC 资产；非 MUSIC 角色不返回。
- Studio `project-shell.test.mjs`：验证消费 `music_assets`、合并工作区列表且保留原有 MANUAL/AUTO/OFF/Pixabay 语义。
- `pnpm --filter @alchemy-video/contracts test`：38/38；`pnpm --filter @alchemy-video/control-api exec tsx --test tests/control-api.test.ts`：19/19；`node --test tests/project-shell.test.mjs`（`apps/studio-web`）：6/6；Contracts、Control API、Studio typecheck 均通过。

本节只修复“指定曲目”可见性和选择接线，不改变来源筛选、评分、时长、混音或自动补曲规则。

### 9.4 指定曲目试听（2026-09-06）

在 `MANUAL` 选择已有 MUSIC 资产后，Studio 复用既有单资产 `download-url` 路由获取短时地址，显示“试听”按钮和浏览器原生 `<audio controls>`。试听地址只保存在页面内存；切换曲目、切换项目或离开页面时清理。不会新增音频下载接口、对象存储路径、Provider 调用或自动播放约束；若浏览器拒绝脚本播放，用户仍可使用原生播放控件。
