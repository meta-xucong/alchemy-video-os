# AI企业内容生产平台：Studio 前端功能与交互设计

状态：`IMPLEMENTED_VERIFIED_PENDING_AUDIT`

适用范围：本文件只约束本地 MVP 的 `apps/studio-web`。Studio 只经相对路径 `/api/v1/*` 调用 Control API，默认固定为 `LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`。本文不新增公开 DTO、状态、事件、Provider、Veyra、积分、部署或域名行为。

## 1. 目标与非目标

Studio 首屏是可直接完成工作的企业视频工作台，而不是介绍页。用户应能从一个项目内完成：创建项目、上传并确认参考图、创建或编辑分镜、绑定参考图、标记为可生成、提交 Mock 视频、观察公开状态事件、在失败时显式重试，并预览确认后的图像和生成 MP4。

本轮不显示或推测真实模型、价格、余额、Provider、请求 ID、对象 key、签名 URL、Veyra 身份、内部队列、Worker、outbox 或 `/internal/*`。没有已存在 API 支持的控件不得出现在界面中，例如模型目录、比例选择、取消、计费、协作、批量生成和导出。

## 2. 设计来源与复用边界

视觉和交互只借鉴本机 `D:\AI\Alchemy Media Agent System\src_skeleton\app\static` 的以下成熟模式：

- `index.html` 的工作台直达、状态 pill、明确模块与操作层次。
- `styles.css` 的低圆角操作面、紧凑 panel、桌面主工作区加侧栏、`760px`/`1180px` 响应式收敛和可访问焦点样式。
- `app.js:publicSafeErrorText` 的公共错误信息降噪原则，及显式展开创建卡、刷新恢复和失败后下一步操作的模式。

Studio 保留既有 Huobao Nuxt 3 布局、`useControlApi.ts`、`useAssetMedia.ts`、相对 `/api/v1` proxy 与 Lucide 图标。不得复制 Alchemy 的身份、Cookie、`app.js` 全局状态、Provider 路由、生成参数、JSONL、资产路径、账本、运行时或静态视觉素材。

## 3. 信息架构

### 3.1 桌面布局

在宽度 `>= 1180px` 时，页面采用紧凑三列，不将整个页面包装成浮动营销卡：

```text
固定应用栏：品牌 / 当前本地工作区 / API 与 SSE 状态 / 刷新
----------------------------------------------------------------
项目栏              分镜工作台                         资产与结果栏
- 新建项目           - 当前项目标题与状态               - 参考资产库
- 项目切换           - 分镜编辑器                       - 预览图像/视频
- 项目空态           - 分镜列表与运行状态               - 最近公开事件
                     - 显式生成/重试动作
```

项目栏宽度稳定为 `220px`，右栏为 `minmax(280px, 340px)`，中间列承担文本编辑和分镜列表。项目、资产、分镜和活动是各自独立的工具面，不嵌套卡片。

### 3.2 窄屏与移动布局

- `760px` 至 `1179px`：保留 `220px` 项目栏与主工作台并列；资产库和活动区移入下一行的双列区域。
- `< 760px`：单列顺序为当前项目和创建、分镜编辑、分镜及任务、资产预览、活动；项目列表改为横向滚动。表单动作占满可用宽度，图标按钮保持固定 `36px`，不以视口比例缩放字体。
- 打开媒体预览时使用全屏 dialog；关闭按钮、标题和媒体保持可见，图像用 `object-fit: contain`，视频保留原始比例。预览不保存签名 URL，关闭或项目切换时释放临时 URL。

## 4. 使用者任务流

1. Studio 装载后并行请求 health、开发身份、项目列表；默认选中第一个项目，或显示项目空态。
2. 用户输入项目名称，创建成功后该项目立即成为当前项目并显示空资产、空分镜指引。
3. 用户选择 PNG/JPEG/WebP/GIF 参考图。Studio 申请上传、按服务端返回的 headers PUT、计算 SHA-256 并确认；只有 API 返回 `READY` 后该资产可被绑定。
4. 用户输入分镜 brief，选择零个或多个已确认图像作为绑定，创建或保存分镜。保存不会创建视频任务。
5. 用户将 `DRAFT` 分镜标为 `READY`。只有 `READY`、`GENERATED` 或 `FAILED` 分镜显示“生成 Mock 视频”。
6. 提交后页面显示公开 TaskRun 状态。SSE 到达后刷新当前项目的公开投影，不清空正在输入的分镜内容或待上传文件。
7. 成功时显示“预览视频”动作；失败时显示公开错误和“重试”。重试仅调用既有 TaskRun retry API；页面不会重新提交或推断 Provider 状态。
8. 刷新浏览器后重新读取项目 detail 与 `Last-Event-ID` 之后的公共 SSE，不依赖前端内存作为任务真相。

## 5. 控件、条件和状态

| 控件 | 触发与 API | 禁用或空态 | 忙碌与成功 | 失败与安全要求 |
| --- | --- | --- | --- | --- |
| 刷新图标按钮 | `GET /health`、`GET /me`、`GET /projects`、当前 `GET /projects/:id` | API 未连接仍可点击 | 显示加载状态并重连 SSE | 只显示公共可行动文案，不显示上游错误 body |
| 项目名称输入 + 新建项目 | `POST /projects`，随机 `Idempotency-Key` | trim 后为空或创建中禁用 | 成功选中项目并清空输入 | 失败保留输入，让用户用新命令重试 |
| 项目切换 | `GET /projects/:id` | 没有项目时显示项目空态 | 高亮当前项目，清理只属于前一项目的预览 URL | detail 读取失败不清除当前已加载内容 |
| 参考图选择 | 原生 file input，不请求 API | 只接受本地 image MIME；未选文件禁用上传 | 显示文件名、大小和上传阶段 | 客户端不接受不支持文件；最终 MIME/完整性仍以 API/MinIO 为准 |
| 上传并确认 | `POST upload-requests`，presigned PUT，`POST confirm-upload` | 无当前项目、无文件或上传中禁用 | 依次显示申请、上传、确认；API `READY` 后进入资产库 | 失败保留文件选择，提示可重试；不显示 URL、object key 或 headers |
| 资产预览 | `GET /assets/:id/download-url` | 仅 `READY` 可用 | URL 仅存于 Vue 内存并打开 dialog | 获取失败显示公共预览错误；关闭/切换项目释放 URL |
| 分镜 brief 输入 | 本地编辑状态 | 空文本时保存禁用 | 编辑现有分镜时显示 revision 与保存状态 | 不在浏览器持久化输入；API 拒绝时保留文本 |
| 参考资产 checkbox | 只影响下一次 create/update shot body 的 `reference_bindings` | 仅当前项目、`READY`、`IMAGE` 资产可选 | 选择状态与编辑中的分镜绑定同步 | 切换项目或取消编辑时清空本地选择 |
| 创建/保存分镜 | `POST /projects/:id/shots` 或 `PATCH /shots/:id`，随机 `Idempotency-Key` | 无项目、brief 为空或保存中禁用 | 成功刷新当前项目并结束编辑 | 公开说明“引用必须属于当前项目且已确认” |
| 取消编辑 | 仅清理本地表单，不发 API | 编辑时可用 | 回到新分镜状态 | 不丢失已保存内容 |
| 标为可生成 | `PATCH /shots/:id { status: READY }` | 仅 `DRAFT` 显示；运行中禁用 | 成功刷新后显示生成动作 | 显示公共 shot 错误 |
| 生成 Mock 视频 | `POST /shots/:id/generations`，固定已认证的本地 Mock 输入 | 仅 `READY`/`GENERATED`/`FAILED` 且无活动 TaskRun 时显示 | 显示 `QUEUED`/`RUNNING`/`PROCESSING`/`DOWNLOADING` 公开状态 | 禁止前端轮询 Provider；只显示 API 错误 envelope |
| 重试失败任务 | `POST /task-runs/:id/retry`，随机 `Idempotency-Key` | 仅 `FAILED` 或允许重试的公开终态显示 | 返回 `QUEUED` 后等待 SSE/detail 刷新 | 绝不创建新 task 或重发生成参数 |
| 视频预览 | 同资产预览流程 | 只有 `result_asset_id` 可用 | `<video controls>` 可播放，显示公开状态 | 不存储下载 URL；不显示任务内部字段 |
| 活动列表 | `GET /events` SSE 公开投影 | 空时显示“尚无公开活动” | 最新 12 条，使用 `event_id` 去重 | 断线显示“正在重新连接”，EventSource 自带重连；不渲染内部 payload |

## 6. API、SSE 与状态投影

Studio 只使用以下现有 public 表面：

| 页面数据 | API 或事件 | Studio 使用方式 |
| --- | --- | --- |
| 当前身份与工作区 | `GET /api/v1/me` | 显示本地公开身份和工作区名称，不暴露外部 ID |
| API 可用性 | `GET /api/v1/health` | 顶部服务状态；不可用时不伪造离线数据 |
| 项目与 detail | `GET/POST /api/v1/projects`、`GET /api/v1/projects/:id` | 项目导航、资产、分镜、TaskRun 的单一页面数据来源 |
| 资产 | `POST /projects/:id/assets/upload-requests`、presigned PUT、`POST /assets/:id/confirm-upload`、`GET /assets/:id/download-url` | 上传、确认、短时预览；签名 URL 只在内存 |
| 分镜 | `POST /projects/:id/shots`、`PATCH /shots/:id` | 创建、编辑、绑定与 ready 状态 |
| 任务 | `POST /shots/:id/generations`、`POST /task-runs/:id/retry`、`GET /task-runs/:id` | 创建、重试、状态展示；不调用内部 worker 入口 |
| 实时变化 | `GET /api/v1/events?workspace_id=...` | 仅消费 `PublicWorkspaceEventEnvelope`；用 `event_id` 做 SSE id/去重，并重新读取当前 detail |

状态展示使用公开 `PROCESSING`，不把内部 `PROVIDER_PROCESSING` 显示给浏览器。TaskRun 成功之前不显示结果预览；失败仅使用公开 `error.code`、`message` 和 `retryable`。任何 SSE 或 HTTP payload 命中 `provider_request_id`、provider、model、object key、签名 query、Veyra、payload、queue、outbox 等内部字段时，视为边界回归并由测试拒绝。

## 7. 权限与安全边界

- 浏览器请求一律为相对 `/api/v1/*`，不能显示 Control API origin，也不能访问 `/internal/*`。
- 每个 API 操作由 Control API 的固定开发身份和 workspace authorization 决定；Studio 不自行判断跨工作区权限。
- `Idempotency-Key` 每次用户命令新建一次，重试或页面刷新不复用旧 key 作为业务事实。
- 文件、SHA-256 和 presigned URL 只用于这次上传或预览，不能写入 localStorage、URL query、日志、错误面板、SSE 列表或 DOM data 属性。
- 所有错误均做公共文本归一化；不把 fetch/MinIO/API 原始异常、response body 或签名 URL 透出。
- UI 没有真实 Provider、Veyra、余额、价格、模型目录或 profile 开关。Mock 标识只说明本地行为，不承诺外部模型能力。

## 8. 自动化与浏览器验收矩阵

| 层级 | 场景 | 通过条件 |
| --- | --- | --- |
| Studio source test | API 仅为 `/api/v1`、无内部字段、所有主操作有可访问名称 | 静态回归拒绝 `/internal`、Provider/Veyra/object key/签名字段；覆盖新增组件和状态 helper |
| Studio component/browser E2E | 空态、创建项目、项目切换、参考图上传确认、刷新与预览 | 真实 PNG decode `naturalWidth/naturalHeight > 0`；控件可用性与错误文本符合本文 |
| Mock E2E | 创建分镜、ready、生成、SSE 成功、MP4 预览 | 视频 metadata 宽高与 duration 有效；刷新后仍可预览 |
| Mock failed/retry E2E | `MOCK_VIDEO_OUTCOME=failed`，显示失败，再通过 UI retry 恢复 | 公开错误与 retry 控件可见；恢复后成功且不暴露内部数据 |
| 响应式浏览器测试 | 桌面默认视口（本轮 `1280x720`）与 `390x844` | 无横向溢出、文字不遮挡、所有关键输入和操作可见并可点击 |
| API boundary regression | Studio proxy 与 Control API | public `/api/v1/health` 通过；`/internal/*` 不可从 Studio 调用 |

## 9. 完成与保留风险

本前端工作只有在现有 Mock 闭环、失败重试、刷新恢复、图像/视频预览和桌面/移动浏览器验收全部通过后才可提交 `READY_FOR_AUDIT`。本轮不改变 C09 状态；真实 Veyra、身份和扣费仍由 C09 的独立授权和后续审核决定。

已知保留风险：C04 当前确认阶段信任声明 MIME，恶意伪装媒体的深度探测属于后续 C12；Studio 只显示 API 已支持的 Mock 固定输出，真实 capability/成本/计费 UI 不在本设计范围。

## 10. 本轮验证证据

- Studio 源码测试 `7/7`、`nuxt typecheck` 与生产 `nuxt build` 通过；新增回归固定项目 tab 仅以项目名称作为可访问名称，避免状态文本破坏项目选择。
- 受控 C06 Playwright E2E 使用真实本地 Mock 闭环，覆盖刷新、项目创建、有效 PNG 上传确认、分镜 ready、失败状态与公共 SSE `task_run.failed`、UI retry、刷新、视频 dialog 播放与关闭；成功视频为 `160x90`、`1s`。测试清理了其项目、两个对象、隔离队列、夹具和子进程。
- 根 `contracts:generate`、`typecheck`、`test`、`build` 在本地 PostgreSQL/Redis/MinIO 配置下通过。浏览器实测桌面 `1280x720` 网格为 `220px / 656px / 340px`；移动 `390x844` 为单列 `351.2px`，无水平滚动。
- 本文件的状态仅表示前端子任务已验证并等待审计。C09 仍是唯一 `IN_PROGRESS` 章节，真实 Veyra/扣费、Provider、VPS、部署和 Git 操作仍未获本任务授权。
