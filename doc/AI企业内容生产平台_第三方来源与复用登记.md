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
