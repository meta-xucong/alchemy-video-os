# AI 企业内容生产平台：Studio 前端功能与交互设计

状态：`IMPLEMENTED_LOCAL_VERIFIED`

适用范围：本文件约束本地 MVP 的 `apps/studio-web`。Studio 只经相对路径 `/api/v1/*` 调用 Control API，默认本地配置仍为 `LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。本文不授权真实 Provider、Veyra、积分、部署、VPS、域名或 Git 操作。

## 1. 本轮结论

Studio 项目页已从旧的“保存想法 + 第三步生成 + 手动故事计划”混合形态，收敛为一个给非专业用户使用的极简项目工作台：

```text
新建项目 -> 写内容 -> 选参考素材/资料 -> 开始生成视频 -> 看成片
```

页面只保留一个主要文本输入框。复杂的意图理解、结构拆分、制作编排和成片整理全由后台自动运行；用户不再看到或点击“生成故事计划 / 确认故事计划 / 确认完整制作计划”。

## 2. 页面结构

项目详情页采用 Alchemy V3 的紧凑工具台风格：

```text
项目标题与管理
----------------------------------------------------------------
左侧创作区                              右侧成果区
- 告诉 AI 你想生成什么                  - 成片播放器
- 时长、清晰度与风格                    - 成片版本列表
- 参考图与项目资料                      - 无成片时的空态
- 一键生成并查看成片                    - 历史镜头片段（折叠）
- 制作细节（折叠）
```

移动端 `< 760px` 按“项目标题 -> 输入 -> 素材 -> 生成 -> 成果 -> 项目管理”单列展示，按钮不挤压文字，不出现横向滚动。

## 3. 核心组件

| 组件 | 用户语义 | 约束 |
| --- | --- | --- |
| `StoryPlanningPanel` | 唯一创作输入区 | 文案为“把想法、故事或小说情节写在这里”；只保留时长、成片清晰度和风格三项直观偏好；不显示分镜、模型或计划按钮 |
| `ReferenceShelf` | 参考图可选 | 上传确认后默认选中；最多 7 张；不暴露首帧/参考集模式 |
| `ProjectMaterials` | 项目资料可选 | 只显示用户能理解的整理状态和下载/重试 |
| `GenerationPanel` | 唯一生成入口 | 主按钮为“开始生成视频”或“调整后生成新版本”；不显示 Provider 规格 |
| `ProductionProgressPanel` | 可折叠制作细节 | 默认只给整体进度，细节由用户展开 |
| `ProjectResultsPanel` | 项目成片留存 | 成片版本长期保留，用户显式选择后才加载和播放，下载不打断页面 |

`StoryPlanningPanel` 不重复列出已上传素材：参考图在 `ReferenceShelf` 选择，项目资料在
`ProjectMaterials` 管理。确认的参考图默认作为参考素材；已整理的项目资料会自动随本次创作
提交。用户只在“成片设置”中选择总时长、`标准清晰（480p）` 或 `高清（720p，推荐）`，以及可选
风格。清晰度会写入不可变 `CreativeBriefRevision`，并由后台写入每段视频任务快照。

## 4. 用户命令与 API

用户点击一次“开始生成视频”后，Studio 自动编排以下公开 API：

```text
POST /api/v1/projects/:id/creative-brief-revisions
POST /api/v1/creative-brief-revisions/:id/plan
GET  /api/v1/projects/:id/storyboard-revisions
POST /api/v1/storyboard-revisions/:id/approve
POST /api/v1/projects/:id/production-runs
```

每个命令使用新的 `Idempotency-Key`。前端不得绕过 Control API，不得访问 `/internal/*`，不得直接调用 Worker、Provider、MinIO 管理 API、Veyra 或数据库。

历史 TaskRun 能力只用于兼容旧项目结果和旧失败任务重试；新的主生成入口不再从 UI 创建 Shot 并直接调用 `/shots/:id/generations`。

## 5. 状态与错误展示

生成进度固定投影为四段自然语言：

```text
理解创作需求 -> 准备视频内容 -> 生成视频 -> 整理成片
```

终态只显示：

- `完整成片已生成`
- `本次制作未完成`
- 旧 TaskRun 兼容路径的 `视频已生成 / 本次创作未完成`

错误只使用公开错误码和安全中文 fallback；不得展示 Provider 原文、模型名、任务队列、对象 key、签名 URL、Veyra、token 或 raw payload。

## 6. 成果区规则

- `VideoVersion.status === SUCCEEDED` 的结果显示为完整成片版本。
- 旧 TaskRun 的成功视频只作为项目历史视频 fallback 或折叠镜头片段展示。
- 成片预览绝不自动播放；SSE 更新只合并当前项目的数据，不触发整页加载或重置已选播放器。
- 成果卡不使用会遮挡下方内容的 sticky 定位；“查看镜头片段”在桌面与移动端均可完整展开。
- 本机固定演示运行时，页面明确说明其测试片段仅用于验证流程，不能被当作正式成片。
- 播放地址只存于 Vue 内存；切换项目、关闭预览或离开页面时清理。
- 调整后生成新版本不覆盖已有成片。

## 7. 测试要求

必须覆盖：

- 源码扫描：无旧双输入、无旧计划按钮、无内部字段、无 Provider/Veyra/队列暴露。
- Studio 测试：唯一输入、时长/清晰度/风格设置、参考图默认作为参考素材、四段中文进度、项目成果区、项目隔离和移动布局。
- C11 浏览器 E2E：单按钮自动创建 CreativeBriefRevision、StoryboardRevision 和 ProductionRun，且不创建旧 TaskRun。
- C12 浏览器 E2E：Mock 分段生成、检查、合成、成片版本、播放、下载、公开字段脱敏和移动端通过。

## 8. 本轮验证证据

- 清晰度只出现为用户可理解的 `标准清晰（480p）` / `高清（720p，推荐）`，不暴露模型或 Provider；故事卡内不再存在重复的素材勾选区。
- `pnpm --filter @alchemy-video/contracts test`：30/30 通过，并验证命令默认 `720p`、拒绝 `1080p`。
- `pnpm --filter @alchemy-video/persistence test`：15 通过、8 个既有数据库服务门控跳过；迁移 `0011_daily_lord_tyger.sql` 验证通过。
- `pnpm --filter @alchemy-video/control-api test`：29 通过、1 个既有服务门控跳过。
- `pnpm --filter @alchemy-video/studio-web test`：29/29 通过。
- `pnpm --filter @alchemy-video/studio-web typecheck`：通过。
- `pnpm --filter @alchemy-video/studio-web build`：通过，仅 Nuxt 既有 DEP0155 warning。
- `pnpm --filter @alchemy-video/control-api test:c11-e2e`：通过，浏览器选择 `480p` 后刷新仍保留，且不提前创建 TaskRun。
- `C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e`：通过，三个 TaskRun 快照均为 `480p`，成片播放、下载与移动布局通过。
- `infrastructure/local/start-full-local-stack.ps1`：本机全栈已迁移并重启；`http://localhost:3031/projects` 与同源 API 均返回 `200`。

## 9. 非本轮范围

本轮不做真实 Provider、Veyra 共享积分、VPS、域名、部署、Git 提交/推送或生产数据操作。C09/C13-A 相关外部联动仍应等本地功能完全验收后再进入。
