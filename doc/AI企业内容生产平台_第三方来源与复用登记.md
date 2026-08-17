# AI 企业内容生产平台：第三方来源与复用登记

## 1. 使用规则

当前项目是学习和本地研究用途。按照用户要求，开发阶段不因许可证问题阻塞源码复用；但所有复用必须保留来源、固定版本、迁入路径、改动原因和回归测试。未来如果公开发布或商用，必须单独进行许可证和分发审查。

`upstream/` 是仅供本机溯源和摘取的固定 commit 克隆目录，必须保持在平台 Git 之外。迁入时只能将经过审计的文件或符号复制到明确的 adapter、runtime、skill 或 fixture 目标模块；禁止复制后丢失来源，也禁止把 `upstream/` 作为 subtree、submodule、gitlink 或完整快照纳入平台仓库。

## 2. 参考仓库基线

| 来源 | 固定基线 | 复用范围 | 不复用范围 | 目标模块 |
| --- | --- | --- | --- | --- |
| [Seedance-2.5](https://github.com/allenGKC/Seedance-2.5) | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | Skill、capabilities、prompting、references、校验思路 | 个人助手安装脚本、个人 UI 假设、未验证 API 参数 | `packages/seedance-skill` |
| [markitdown](https://github.com/microsoft/markitdown) | `fd239d5d2be43d9b68329730206b9312c7d5a388` | converter、`MarkItDown`、`convert_stream`、`StreamInfo` | 用户 URL 直连、无边界插件、直接充当知识库 | `services/document-runtime` |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `BaseTool`、`ToolResult`、`ToolRegistry`、Artifact schema、媒体/QC 工具 | 自由 Agent 全局编排、Backlot 事实源、全部 Provider | `services/media-runtime` |
| [huobao-drama](https://github.com/chatfire-AI/huobao-drama) | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | Nuxt、Hono、Drizzle、页面组件、媒体预览、Provider adapter、生成字段 | 短剧业务模型、进程内无限轮询、纯本地磁盘、Key 页面 | `apps/studio-web`、`apps/control-api`、`workers/provider-worker` |
| [sub2api-video-mcp](https://github.com/meta-xucong/sub2api-video-mcp) | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | 视频三段式协议、字段、轮询、下载、MCP 工具命名 | MCP 进程内状态作为平台任务事实 | `packages/provider-adapters/sub2api` |

## 3. C01 本机快照审计

本表只覆盖用户指定的四个 GitHub 仓库。C01 未拉取或读取 `sub2api-video-mcp`，它仍是后续 C07 的独立协议参考。

| 来源 | URL | 固定 commit / HEAD | 本机目录 | 状态 | 许可证提示 |
| --- | --- | --- | --- | --- | --- |
| Seedance-2.5 | `https://github.com/allenGKC/Seedance-2.5.git` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：MIT |
| markitdown | `https://github.com/microsoft/markitdown.git` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：MIT |
| OpenMontage | `https://github.com/calesthio/OpenMontage.git` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` | detached HEAD、clean、与固定 commit 一致 | 根 `LICENSE`：GNU AGPL v3 |
| huobao-drama | `https://github.com/chatfire-AI/huobao-drama.git` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` | detached HEAD、clean、与固定 commit 一致 | 未发现根 `LICENSE`；`backend/package.json` 声明 ISC |

审计命令确认 `.gitignore` 的 `upstream/` 规则命中，且 `git ls-files --stage -- upstream` 输出为空。上游快照永远不进入平台 Git 索引；复用矩阵、文件级符号、测试位置和不可复用原因见《AI企业内容生产平台_C01上游复用矩阵.md》。

## 4. 本地代码事实参考

| 来源位置 | 参考内容 | 复用限制 |
| --- | --- | --- |
| `D:\AI\SSH\sub2api` | Veyra routes、ticket、account、atomic debit、idempotency fingerprint | 不复制用户/余额表和账本；只实现 HTTP adapter |
| `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0` | `VeyraSub2APIClient`、billing rules、generation 成功后扣费、usage receipt | 不复制自签 session、JSONL 账本、图片固定费率和单体状态 |

## 5. 迁入登记模板

每次从上游迁入代码或重要变量时，新增记录：

```text
来源仓库：
来源 commit/tag：
本地目标路径：
迁入文件/符号：
保留的变量/类型：
平台改动：
舍弃原因：
适配器边界：
回归测试命令：
审计日期：
```

## 6. 来源完整性检查

- [ ] 目标模块存在 `UPSTREAM.md` 或等效登记。
- [ ] 来源 commit/tag 可复现。
- [ ] 迁入代码没有把外部全局状态带进 Domain。
- [ ] 复用的变量字段有 mapper 或 serializer 边界。
- [ ] 上游升级必须重新跑回归测试并更新登记，不允许无记录覆盖。

## 7. C06 复用登记

| 来源仓库 | 固定 commit | 本地目标路径 | 迁入/借鉴符号 | 平台改动与舍弃原因 | 回归测试 |
| --- | --- | --- | --- | --- |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/media-validator.ts` | `backend/src/utils/ffmpeg.ts` 的 `probeBinary` / `checkFfmpegSuite` 思路 | 采用静态工具先探测、失败关闭；改为独立验证端口，舍弃 `fluent-ffmpeg`、全局路径配置、静态媒体处理与本地业务状态。 | provider/media 单测、C06 MinIO/Worker E2E |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/port.ts`、`apps/task-worker/src/execution-service.ts` | `backend/src/services/adapters/types.ts` 的 `VideoGenerationRecord` / `VideoProviderAdapter` 字段意图，`generation.ts` 的 submit/poll 职责切分 | 保留 `model`、`prompt`、提交/查询/下载阶段；改为平台 `VideoProviderPort`、持久化 ProviderAttempt 与 workspace-scoped TaskRun。舍弃直接 Provider HTTP、MySQL、进程内轮询、配置/密钥读取。 | Mock 无网络、重启恢复、公开脱敏测试 |

`AI企业内容生产平台_C06上游复用矩阵.md` 是本章逐文件和测试位置的完整记录。任何 C06 实际迁入的代码会在目标模块 `UPSTREAM.md` 追加修改点。

## 8. C07 复用登记

| 来源仓库 | 固定 commit | 本地目标路径 | 迁入/借鉴符号 | 平台改动与舍弃原因 | 回归测试 |
| --- | --- | --- | --- | --- | --- |
| sub2api-video-mcp | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | `packages/provider-video/src/sub2api/{adapter,capabilities,errors,mapper,transport}.ts` | 视频协议路径 `POST /videos/generations`、`GET /videos/{id}`、`GET /videos/{id}/content`；`model`、`prompt`、`duration`、`resolution`、`ratio`、`image.image_url`、`id`/`request_id`、`status`/`state` 字段语义、下载 Content-Type/Content-Length 传播，以及 disabled profile/snapshot 边界 | 仅按文档化协议做 injected transport 的离线薄适配和内部 disabled registry/snapshot；未迁入 MCP server、工具注册、进程内轮询、HTTP 客户端、环境 Key、公开模型列表、认证或任何任务事实。真实 transport 与 profile 认证留给 C08。 | CONTRACT-001 至 008、metadata/invalid MIME/404 断言、registry disabled/no-public-list assertions、global-fetch guard、无网络 fake transport |
| huobao-drama | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `packages/provider-video/src/sub2api/` | `backend/src/services/adapters/types.ts` 的 `VideoGenerationRecord` / `VideoProviderAdapter` 适配职责；`backend/src/services/generation.ts` 的 submit/poll 阶段划分 | 只借鉴 adapter 边界，复用平台既有 `VideoProviderPort`；下载 metadata 与 typed failure 是平台内部薄适配；舍弃 `AIConfig`、MySQL、全局 registry、直接 Provider HTTP、定时器、短剧业务与密钥配置。 | `sub2api-*.test.ts` 22/22、task-worker C07 cross-package 5 cases、typecheck |

`AI企业内容生产平台_C07上游复用矩阵.md` 是 C07 的逐文件实施与审计记录。C07 未从 `upstream/` 复制源码；该目录仍只供本机溯源且不得进入 Git 索引。

## 9. C08 认证准备来源登记

| 来源 | 固定 commit | C08 使用方式 | 不可直接当作事实的内容 | 认证前回归 |
| --- | --- | --- | --- | --- |
| sub2api-video-mcp | `3f2d885b79630f50b9cf4ae62251596cc37bbd18` | 三段式路径、`model`/`prompt`/`duration`/`resolution`/`ratio`/`image.image_url` 字段和轮询节奏的待认证协议假设 | 实际 model ID、账号可用范围、状态字段、下载响应 headers、计费与线路可用性；它们只能由 C08 受控 live evidence 确认 | C07 `CONTRACT-001` 至 `CONTRACT-008`、metadata 与 typed failure 跨包回归 |
| 平台 C07 adapter 与合成 fixtures | `c07-accepted^{}` = `41d414cf1b6767c39f251445278831328e1620cf` | 作为无网络 mapper、脱敏和恢复不重提的基线 | 任何 fixture response、disabled capability snapshot 或候选 Grok 名称都不是已认证 profile | Provider `23/23`、本机服务 Worker `23/23`（C07 审计证据） |
| [xAI 官方模型与定价文档](https://docs.x.ai/docs/models)（审计复核） | 审计员于 2026-08-14 访问并复核；A 段禁止联网重抓 | `grok-imagine-video-1.5` 文生、duration `1..15`、480p `USD 0.08/秒`，仅用于选择固定 `1s/480p/16:9` 与十进制 `USD 1.00` budget guard | 不是 SUB2API 协议/能力证据，不能推断其请求字段、模型路由、status/state、ratio、下载 headers 或账号资格 | certifier budget/guard tests；真实认证只在 C08 A 段独立复审后执行 |

C08 当前没有迁入任何上游源码，也没有采集真实响应、请求 ID、下载 URL 或媒体二进制。受控认证计划和离线测试矩阵见 `AI企业内容生产平台_C08认证准备与测试矩阵.md`；`upstream/` 继续被 `.gitignore` 忽略，不得加入平台 Git。

## 10. C09 离线共享积分来源登记

| 来源 | 本地目标路径 | 保留的语义/字段 | 平台改动与不可复用边界 | 回归测试 |
| --- | --- | --- | --- | --- |
| `D:\AI\SSH\sub2api` 的 `backend/internal/veyra/routes.go`、`billing.go` | `packages/credit-veyra/`、`packages/contracts/`、`packages/persistence/` | `data` 包装、`user_id`、`amount`、`idempotency_key`、`source`、`reference_id`、`balance_after`、`replayed`，以及 `402/409` 与 request fingerprint 语义 | 不复制 Go handler、用户/余额/ledger 表、原子余额服务、Token guard 或浮点业务计算；以注入 fake transport、十进制字符串和平台 receipt 适配。 | fake transport contract、decimal、receipt replay/conflict、workspace persistence |
| `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0` 的 `VeyraSub2APIClient`、generation billing 调用顺序 | `packages/credit-veyra/` 与 C09 文档 | account/debit 路径映射及“产物验证后 debit，成功后 usage receipt”职责顺序 | 不复制 Python HTTP client、环境读取、自签 session、Cookie、JSONL 账本、图片固定费率或 `float` 比较；C09-A 不装配真实 client/Worker。 | transport path/header/body assertions、无 env/fetch/static scans |

C09-A 不从 `upstream/` 迁入源码；本机事实参考只用于薄适配语义。`upstream/` 继续受 `.gitignore` 保护，绝不进入索引、submodule 或 gitlink。
