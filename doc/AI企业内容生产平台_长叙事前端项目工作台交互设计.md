# AI 企业内容生产平台：长叙事前端项目工作台交互设计

状态：`DESIGN_BASELINE`

关联章节：C11、C12。本文只约束 Studio 中用户可见的长叙事创作体验；后端领域、API、Worker 与媒体 Runtime 以 `AI企业内容生产平台_长叙事后端领域与编排开发设计.md`、`AI企业内容生产平台_长叙事自动编排与连续成片设计.md` 为准。所有当前和未来项目均遵循 `AI企业内容生产平台_通用叙事点与生成片段编排规范.md`。

## 1. 产品目标

目标用户不懂分镜、镜头参数、模型能力或任务队列，只希望把一个想法、小说情节、产品描述和少量素材变成可观看的视频。Studio 的用户体验必须是：

```text
新建项目 -> 写下内容 -> 选择素材 -> 开始生成视频 -> 查看成片
```

复杂的内容理解、结构拆分、制作编排、片段处理、检查与合成都在后台自动完成。前端不要求用户手动生成计划、确认计划、写分镜或理解 Provider 参数。

## 2. 当前信息架构

项目详情页采用 Alchemy V3 风格的紧凑中文工作台，并固定保留项目成果区：

```text
固定应用栏：品牌 / 本地工作区 / 服务状态 / 刷新
----------------------------------------------------------------
当前项目创作区                         项目成果区
- 告诉 AI 你想生成什么                  - 成片播放器
- 时长、清晰度与风格                    - 成片版本列表
- 参考图与项目资料                      - 无成片时的稳定空态
- 自动拆分提示与公开进度                - 当前版本生成片段（折叠）
- 一键生成与成片播放器                  - 历史版本片段（折叠）
- 制作细节（折叠）
```

页面只保留一个主要输入框：`把想法、故事或小说情节写在这里`。不得再出现“从故事开始”“描述你的想法”这类并列输入入口。

## 3. 用户可见流程

1. 用户进入项目，看到一个文本框，以及“成片设置”中的可选总时长、清晰度和风格。
2. 上传参考图后，该图片默认勾选为本次参考素材；用户可取消，但无需理解“首帧/参考集”等模型模式。
3. 用户点击唯一主按钮“开始生成视频”。
4. Studio 显示自然语言进度，并提示“预计生成若干段，最后合成为完整成片”；实际数量由后台根据总时长和内容复杂度自动决定。
5. 完成后，成片显示在右侧“成片版本”，并长期保留在该项目内；用户可调整描述后生成新版本，不覆盖旧成片。

制作细节可以折叠查看，但默认不把后台编排当作用户必须理解的工作步骤。

## 4. 后台自动编排边界

前端的一次“开始生成视频”在后台顺序调用公开 Control API：

```text
POST /projects/:id/creative-brief-revisions
POST /creative-brief-revisions/:id/plan
GET  /projects/:id/storyboard-revisions
POST /storyboard-revisions/:id/approve
POST /projects/:id/production-runs
```

这些调用属于自动化编排，不在界面上暴露成多个按钮。浏览器不得调用 `/internal/*`，不得显示 Provider、模型、队列、request ID、object key、签名 URL、Veyra 或原始 payload。

规划完成后，后台先形成 NarrativeBeat，再按 Provider 能力、目标总时长、预算和叙事边界合并为 GenerationSegment。每个 GenerationSegment 才创建一个 Provider TaskRun；前端只能看到“第 N/M 段”，不能看到历史 TaskRun 总数。

历史单 Shot TaskRun 的成功视频仍可作为历史兼容数据展示，但新的用户入口不再从前端创建 Shot 后直接调用 `/shots/:id/generations`。

## 5. 控件与状态

| 控件 | 用户理解 | 前端行为 |
| --- | --- | --- |
| 内容输入 | 写想法、故事、小说情节或产品描述 | 本地编辑，提交时写入 CreativeBriefRevision |
| 希望成片大约多长 | 成片意图，不是单个模型调用时长 | 受控为 15-600 秒 |
| 成片清晰度 | 选择标准清晰或高清 | 受控为 `480p` 或 `720p`，默认高清；随 CreativeBriefRevision 冻结，并用于后续每段任务快照 |
| 预计生成片段 | 用户只需知道工作量和进度 | 输入总时长后实时显示预计段数和每段约多少秒，例如“30 秒预计 3 段，每段约 10 秒”；最终仍以后台计算为准，不允许手工绕过能力校验 |
| 想要的感觉 | 可选风格偏好 | 作为后台创作参考 |
| 参考图 | 可选视觉素材 | 上传确认后默认勾选，最多 7 张 |
| 项目资料 | 可选企业资料/文档 | 上传后触发资料整理；已整理的资料自动作为 source asset，不在故事卡重复勾选 |
| 开始生成视频 | 唯一主动作 | 自动完成 brief、plan、approve、production run |
| 重试生成 | 只用于旧 TaskRun 失败恢复 | 不创建新版本，不重复提交已持久化 Provider 请求 |
| 调整后生成新版本 | 用当前输入创建新 ProductionRun | 不覆盖旧成片 |
| 查看成片 | 在当前项目内播放版本 | 播放 URL 只存在内存 |

## 6. 中文投影

公开状态只投影为用户能理解的中文：

| 阶段 | 展示文案 |
| --- | --- |
| 未开始 | 先写下想法、故事或情节，再一键生成视频 |
| 本地提交中 | AI 正在理解内容 |
| ProductionRun confirmed | 正在准备视频内容 |
| ProductionRun generating | 正在生成视频 |
| Segment N/M | 正在生成第 N/M 段 |
| Reviewing / rendering | 正在整理成片 |
| Succeeded | 完整成片已生成 |
| Failed / blocked | 本次制作未完成 |

禁止在用户可见文案中重新引入“生成故事计划”“确认故事计划”“确认完整制作计划”“分镜拆解”“制作计划”等需要工程背景才能理解的步骤。

## 7. 成果与版本

右侧成果区固定存在：

- `VideoVersion` 成功后显示为“完整成片 01/02/03...”。
- 项目历史生成片段按 ProductionRun 分组折叠展示，不能冒充当前计划的生成片段数量，也不能冒充新的完整成片。
- 成片播放和下载都通过短时公开下载 URL；URL 不写入路由、localStorage、日志、错误或事件。

## 8. 验收矩阵

- Studio 静态测试必须拒绝旧双输入、旧手动计划按钮、内部字段和模型模式。
- 18 个叙事点、30 秒目标的计划必须显示为后台自动计算的 3 个或 6 个生成片段，而不是 18 个 Provider 任务。
- C11 浏览器 E2E：用户只点一次“开始生成视频”，前端仍通过公开 API 自动创建 brief、计划、批准 storyboard 并创建 production run；无旧 TaskRun。
- C12 浏览器 E2E：同一单按钮流程完成 Mock 分段生成、检查、合成、VideoVersion 成片、播放、下载、公开字段脱敏与 `390x844` 移动布局。
- C12 浏览器 E2E 必须断言真实可执行 TaskRun 数量等于 GenerationSegment 数量，并且历史片段数量不会改变当前 ProductionRun 进度。
- 项目切换、刷新和成片选择不得泄漏上一个项目的输入、参考图或播放地址。

## 9. 本轮验证证据

- `pnpm --filter @alchemy-video/contracts test`：30/30 通过，清晰度契约限定为 `480p | 720p`。
- `pnpm --filter @alchemy-video/persistence test`：15 通过、8 个既有数据库服务门控跳过；`0011_daily_lord_tyger.sql` 为历史 brief 安全回填默认 `720p`。
- `pnpm --filter @alchemy-video/control-api test`：29 通过、1 个既有服务门控跳过。
- `pnpm --filter @alchemy-video/studio-web test`：29/29 通过。
- `pnpm --filter @alchemy-video/studio-web typecheck`：通过。
- `pnpm --filter @alchemy-video/studio-web build`：通过，仅 Nuxt 既有 DEP0155 warning。
- `pnpm --filter @alchemy-video/control-api test:c11-e2e`：通过，单按钮自动编排、选择的 `480p` 刷新后仍保留，且不提前创建 TaskRun。
- `C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e`：通过，所选 `480p` 进入全部三段 Mock TaskRun 快照，最终成片播放/下载和移动布局通过。
