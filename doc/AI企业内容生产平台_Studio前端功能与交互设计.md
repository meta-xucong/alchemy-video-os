# AI 企业内容生产平台：Studio 前端功能与交互设计

状态：`IMPLEMENTED_LOCAL_VERIFIED`

适用范围：本文件约束本地 MVP 的 `apps/studio-web`。Studio 只经相对路径 `/api/v1/*` 调用 Control API，默认本地配置仍为 `LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。

> **2026-09-01 现行口径**：自动旁白不要求用户上传旁白、样音或其它 spoken audio；音频由已选定的 Provider 原生音轨或服务端显式 Doubao 生成。用户授权的真实调用仅限最新《自动生成音频与视频匹配正式使用开发文档》定义的本机 Aiself Grok/Doubao 对照，不改变本地 MVP/CI 的 Mock 默认，也不授权 Veyra、积分、部署、VPS、域名或 Git。文中旧的“禁止真实 Provider”表述按默认/本章节范围理解，不得覆盖该明确的本机对照授权。

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
| `ReferenceShelf` | 参考图可选 | 上传确认后默认选中；文件选择器支持一次选择多张，沿用逐张上传确认；已有项目从最新创作 brief 的 USER_UPLOAD 图片恢复勾选；最多 7 张；可通过图标删除误传图片；不暴露首帧/参考集模式 |
| `ProjectMaterials` | 项目资料可选 | 只显示用户能理解的整理状态和下载/重试；可通过图标删除误传资料 |
| `GenerationPanel` | 唯一生成入口 | 主按钮为“开始生成视频”或“调整后生成新版本”；不显示 Provider 规格 |
| `ProductionProgressPanel` | 可折叠制作细节 | 默认只给整体进度，细节由用户展开 |
| `ProjectResultsPanel` | 项目成片留存 | 成片版本长期保留，用户显式选择后才加载和播放，下载不打断页面 |

`StoryPlanningPanel` 不重复列出已上传素材：参考图在 `ReferenceShelf` 选择，项目资料在
`ProjectMaterials` 管理。确认的参考图默认作为参考素材；已整理的项目资料会自动随本次创作
提交。用户只在“成片设置”中选择总时长、`标准清晰（480p）` 或 `高清（720p，推荐）`，以及可选
风格。清晰度会写入不可变 `CreativeBriefRevision`，并由后台写入每段视频任务快照。

参考图勾选的页面事实来源是最新 `CreativeBriefRevision.source_asset_ids` 中仍然 READY 的
`USER_UPLOAD:IMAGE`。如果项目没有历史 brief，则新上传且已确认的参考图默认全选；如果用户在
一次创作前主动取消勾选，下一次提交会把该选择写入新的 brief。Studio 不得从最新生成片段的
`reference_bindings` 反推勾选状态，因为生成片段可能包含后台派生的交接帧，这类 `DERIVED`
素材只属于 C12 内部连续性，不应显示为用户参考图选择。

用户可删除误传的 `USER_UPLOAD` 图片或资料。Studio 调用 `DELETE /api/v1/assets/:asset_id` 并使用新的
`Idempotency-Key`；成功后立即把该素材从当前勾选和下一次创作草稿中移除，再刷新项目资料。删除为软删除：
后续规划和生成不再使用它，已有 Brief、TaskRun、成片和审计记录保持不变，派生成果和生成视频不能从页面删除。

## 4. 用户命令与 API

用户点击一次“开始生成视频”后，Studio 自动编排以下公开 API：

```text
POST /api/v1/projects/:id/creative-brief-revisions
POST /api/v1/creative-brief-revisions/:id/plan
GET  /api/v1/projects/:id/storyboard-revisions
POST /api/v1/storyboard-revisions/:id/approve
POST /api/v1/projects/:id/production-runs
DELETE /api/v1/assets/:asset_id
```

每个命令使用新的 `Idempotency-Key`。前端不得绕过 Control API，不得访问 `/internal/*`，不得直接调用 Worker、Provider、MinIO 管理 API、Veyra 或数据库。

历史 TaskRun 能力只用于兼容旧项目结果和旧失败任务重试；新的主生成入口不再从 UI 创建 Shot 并直接调用 `/shots/:id/generations`。

## 5. 状态与错误展示

生成进度固定投影为四段自然语言：

```text
理解创作需求 -> 准备视频内容 -> 生成视频 -> 整理成片
```

当后台执行 C12.1 衔接检查或自动修复时，第三、四段之间可显示“正在检查片段衔接”或“正在优化一处片段衔接”。这些是阶段说明，不新增按钮、设置项、主片段计数或工程概念；修复完成后仍收敛为“正在整理成片”。

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
- 背景音乐选择为 `MANUAL` 时，用户点击“试听”才通过既有 `GET /assets/:assetId/download-url` 获取短时地址，并用浏览器原生音频控件播放；地址不写入状态、数据库或日志，浏览器禁止自动播放时保留控件供用户手动播放。
- 背景音乐的“上传工作区音乐”和“从 Pixabay 导入”入口默认收在折叠面板中；自动、指定曲目、关闭三种选择保持直接可见。
- 段数预估只显示“以实际生成为准”；完整的规划说明通过问号提示悬停/聚焦查看，不占用创作区正文。
- 参考图文件选择器支持一次选择多张图片；前端按现有上传请求、确认和 7 张上限逐张完成，已成功的图片会保留为本次参考素材。

## 7. 测试要求

必须覆盖：

- 源码扫描：无旧双输入、无旧计划按钮、无内部字段、无 Provider/Veyra/队列暴露。
- Studio 测试：唯一输入、时长/清晰度/风格设置、参考图默认作为参考素材、四段中文进度、项目成果区、项目隔离和移动布局。
- C12.1 Studio 测试：衔接检查和自动修复只以安全中文阶段投影出现；页面不显示 `HandoffReview`、桥接 TaskRun、评估器、阈值、Provider、评分或内部资产。
- C11 浏览器 E2E：单按钮自动创建 CreativeBriefRevision、StoryboardRevision 和 ProductionRun，且不创建旧 TaskRun。
- C12 浏览器 E2E：Mock 分段生成、检查、合成、成片版本、播放、下载、公开字段脱敏和移动端通过。

## 8. 本轮验证证据

- 清晰度只出现为用户可理解的 `标准清晰（480p）` / `高清（720p，推荐）`，不暴露模型或 Provider；故事卡内不再存在重复的素材勾选区。
- `pnpm --filter @alchemy-video/contracts test`：30/30 通过，并验证命令默认 `720p`、拒绝 `1080p`。
- `pnpm --filter @alchemy-video/persistence test`：15 通过、8 个既有数据库服务门控跳过；迁移 `0011_daily_lord_tyger.sql` 验证通过。
- `pnpm --filter @alchemy-video/control-api test`：29 通过、1 个既有服务门控跳过。
- `pnpm --filter @alchemy-video/studio-web test`：40/40 通过；覆盖音乐入口默认折叠、段数说明悬停提示和一次选择多张参考图。
- `pnpm --filter @alchemy-video/studio-web typecheck`：通过。
- `pnpm --filter @alchemy-video/studio-web build`：通过，仅 Nuxt 既有 DEP0155 warning。
- `pnpm --filter @alchemy-video/control-api test:c11-e2e`：通过，浏览器选择 `480p` 后刷新仍保留，且不提前创建 TaskRun。
- `C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e`：通过，三个 TaskRun 快照均为 `480p`，成片播放、下载与移动布局通过。
- `infrastructure/local/start-full-local-stack.ps1`：本机全栈已迁移并重启；`http://localhost:3031/projects` 与同源 API 均返回 `200`。

## 9. 非本轮范围

本轮不做真实 Provider、Veyra 共享积分、VPS、域名、部署、Git 提交/推送或生产数据操作。C09/C13-A 相关外部联动仍应等本地功能完全验收后再进入。
