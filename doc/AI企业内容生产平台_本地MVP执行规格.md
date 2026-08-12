# AI企业内容生产平台：本地 MVP 执行规格

## 1. 文档目的与边界

本文件把已有的《完整开发方案》《代码实现与仓库整合详细方案》《VPS与SUB2API视频接入补充方案》收敛为第一阶段可落地、可验证的本地开发目标。它不是部署手册：不配置 `video.aiself.vip`、不改 VPS、不写入 SUB2API 密钥、不接入生产共享积分。

当前工作区只有设计文档；本规格中的目录、命令和端口是**建仓后的目标约定**，不是宣称现已可运行。

第一阶段要证明的完整闭环是：在网页创建项目，上传一张参考图，建立一个分镜，提交视频生成任务，观察状态变化，并得到可播放的本地视频产物。默认使用 Mock 视频提供方，因此这个闭环不消耗任何外部额度。

## 2. 冻结的 MVP 范围

### 2.1 必做能力

| 能力 | 第一版行为 | 完成判定 |
| --- | --- | --- |
| 本地身份 | 固定开发身份 `usr_dev_owner`，默认工作区 `ws_dev_default` | 所有数据均按 `workspace_id` 隔离 |
| 项目 | 新建、重命名、列表、进入项目 | 创建项目后可看到空分镜时间线 |
| 资产 | 图片直传对象存储、确认上传、预览 | 页面刷新后资产仍可读取 |
| 分镜 | 创建、编辑 `prompt`、选择 `model`、绑定参考资产 | 分镜保存不触发生成 |
| 任务 | 创建任务、排队、运行、成功或失败、重试 | 刷新后状态与事件不丢失 |
| 视频产物 | Mock 产出固定 MP4，保存为 `Asset(kind=VIDEO, origin=GENERATED)` | 浏览器内可播放，下载链接有效 |
| 可观测性 | 任务详情、事件流、关联的提供方尝试记录 | 能定位一次任务为何失败 |

### 2.2 明确不做

- 不接真实 Seedance、Grok、SUB2API，也不请求用户的 API Key。
- 不做 SSO、登录票据、共享积分、充值、扣费设置或管理员界面。
- 不接 MarkItDown、OpenMontage、知识库、角色 Agent、批量剧本工作流；只为它们预留事件与资产接口。
- 不进行成片编排、FFmpeg 导出、字幕、配音、协作审阅。
- 不做 Codex CLI 入口。后期 CLI 只调用同一组 HTTP 内部 API，不能绕过控制面。

## 3. 建仓结构与责任

采用 pnpm monorepo；控制面和第一个 worker 使用 TypeScript。MarkItDown、媒体编排等 Python 依赖到对应功能开始时再加入 `services/runtime-python`，避免 MVP 同时维护两套运行时。

```text
apps/
  web/                    Nuxt 3 前端，复用 huobao-drama 的页面组织和交互习惯
  api/                    Hono 控制面，只做鉴权、命令、查询、签名 URL
  worker/                 BullMQ 消费者、状态机、提供方适配器调度
packages/
  contracts/              Zod schema、OpenAPI 生成、事件类型、错误码
  domain/                 实体、状态转换、领域服务；不得依赖 HTTP 或队列
  persistence/            Drizzle schema、事务仓储、迁移
  provider-video/         VideoProviderPort、mock、sub2api（后续）实现
  storage/                S3/MinIO 资产读写、临时下载与哈希
  observability/          trace、结构化日志、outbox 发布器
  test-fixtures/          API/事件/提供方响应夹具，不包含密钥
infra/
  compose/                PostgreSQL、Redis、MinIO 的本地 Compose 文件
contracts/                人类可读的 OpenAPI、AsyncAPI、JSON Schema 输出
```

依赖方向固定为 `web -> api -> domain/persistence/contracts` 与 `worker -> domain/persistence/provider/storage/contracts`。`web` 从不直连数据库、Redis、MinIO 管理 API 或视频提供方；`worker` 不导入 Nuxt 页面组件；`provider-video` 不导入业务数据库代码。

### 3.1 源仓库复用边界

- 从 `chatfire-AI/huobao-drama` 吸取 Nuxt 3、页面路由、组件层和任务式交互模式；页面不复制其业务 API、用户模型或全局状态。
- 从 `allenGKC/Seedance-2.5` 吸取视频参数 UI、表单校验和任务展示的概念；不搬运其单体式请求路径。
- 从 `meta-xucong/sub2api-video-mcp` 保留提供方术语 `model`、`prompt`、`duration`、`resolution`、`ratio`、`request_id` 与轮询语义；将 MCP 工具层改写为 `VideoProviderPort` 适配器。
- 变量最大化复用只发生在外部边界。传入/传出的字段仍叫 `model`、`prompt`、`request_id`，内部主键仍是 `task_run_id`、`provider_attempt_id`，不把任一仓库的全局变量、环境变量或数据库表名扩散到其他模块。

## 4. 本地基础设施与配置

| 服务 | 建议默认端口 | 用途 | 允许替换 |
| --- | ---: | --- | --- |
| PostgreSQL 16 | 54329 | 事务数据、outbox、审计 | 否 |
| Redis 7 | 6379 | BullMQ 队列、SSE 通知扇出 | 否 |
| MinIO S3 API | 9000 | 本地资产对象存储 | 否 |
| MinIO Console | 9001 | 仅开发排障 | 是 |
| API | 3032 | Web 与后续 CLI 的唯一控制面 | 否 |
| Web | 3031 | Nuxt 开发服务器 | 否 |

首次初始化的环境变量模板如下。实际 `.env.local` 不提交；视频 Key、内部 Token、生产域名均不得放在样例或测试夹具中。

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://video_local:video_local@127.0.0.1:54329/video_local
REDIS_URL=redis://127.0.0.1:6379
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=video-local
S3_ACCESS_KEY=video_local
S3_SECRET_KEY=video_local_secret
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

`VEYRA_AUTH_ENABLED=false` 是硬性默认值。API 在这个值为 `false` 时不得读取 `VEYRA_INTERNAL_TOKEN`，也不得创建扣费记录。

## 5. 端到端运行路径

```mermaid
sequenceDiagram
  participant W as Nuxt Web
  participant A as API
  participant S as MinIO
  participant Q as Redis/BullMQ
  participant R as Worker
  participant M as Mock Video Provider
  W->>A: 创建项目、申请上传
  A-->>W: asset_id + 预签名 PUT URL
  W->>S: 上传参考图
  W->>A: 确认上传
  W->>A: POST generate（Idempotency-Key）
  A->>Q: 投递 task_run_id
  A-->>W: task_run_id + QUEUED
  R->>M: submit
  M-->>R: request_id / processing / succeeded
  R->>S: 保存 MP4 并校验
  R->>A: 事务写入结果与 outbox
  A-->>W: SSE task.succeeded
```

本地 Mock 的确定性规则：`submit` 返回 `mock_{task_run_id}`；第一次查询返回 `PROCESSING`，第二次返回 `SUCCEEDED`；成功后复制测试 MP4 夹具并计算 SHA-256。可通过 `MOCK_VIDEO_OUTCOME=failed` 让同一流程稳定验证失败路径。

## 6. 开发顺序

1. 初始化目录、pnpm workspace、Compose、数据库迁移和 `packages/contracts`。
2. 实现开发身份、工作区、项目、资产预签名上传与确认接口。
3. 实现 `Shot`、`TaskRun`、outbox、BullMQ 任务投递和 SSE 查询。
4. 实现 `VideoProviderPort` 与 Mock；完成上传到播放视频的闭环。
5. 为状态机、幂等、资产授权、worker 崩溃恢复写集成测试。
6. 接入 SUB2API adapter 的离线夹具；仅在认证文档达标且用户提供密钥后开启真实调用。
7. 最后才接共享积分、MarkItDown、OpenMontage 与智能体模块。

## 7. MVP 验收清单

- `pnpm test` 覆盖命令幂等、状态机非法迁移、worker 重试、SSE 重连。
- `pnpm test:integration` 可启动依赖服务，完成创建项目、上传、生成、播放的全链路。
- 重复提交相同 `Idempotency-Key` 只创建一个 `TaskRun`；相同键但不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。
- worker 在“提供方已成功、尚未持久化产物”时被中断，重启后只下载/持久化，不会重复提交。
- 每个对象读取都校验 `workspace_id`；对象键不得由浏览器任意传入。
- `VIDEO_PROVIDER=mock` 在无任何外部网络和密钥时可通过全部验收。

## 8. 进入下一阶段的门槛

满足以上验收后，才能新增真实 SUB2API adapter。接入前必须完成《SUB2API视频能力认证与测试夹具规范》中的离线契约测试；共享积分则另行遵守《Sub2API与Alchemy共享积分适配规范》。这两个适配都是可插拔端口，失败时不影响本地 Mock 与项目数据的可用性。
