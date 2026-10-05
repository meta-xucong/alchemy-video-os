# C10：企业资料转换与 Document Markdown Artifact 设计

## 1. 目标与边界

C10 让项目中的企业资料以非专业用户可理解的方式完成“添加资料 -> 自动整理 -> 可用于后续创作”的本地闭环。资料可为 PDF、DOCX、PPTX、XLSX、Markdown 或纯文本；平台将其转换为可追溯的 Markdown 资料产物。

本章只负责格式转换、来源、失败重试和受控查看。它不做知识库、向量化、网页抓取、事实抽取、品牌画像、脚本、分镜、视频调用、Veyra、VPS 或部署。后续 C11 才消费已经成功的资料产物。

## 2. 已确认的架构决定

1. 原始资料继续是 `Asset(kind=DOCUMENT, origin=USER_UPLOAD)`；转换后的 Markdown 是新的 `Asset(kind=DOCUMENT, origin=DERIVED)`，二者均在同一 workspace 和 project。
2. `DocumentConversion` 是独立实体，不复用 `TaskRun`。现有 `TaskRun` 必须绑定 `Shot` 且其状态机、ProviderAttempt 与计费语义只适用于视频/渲染/QC；把资料转换塞入其中会破坏领域边界。
3. `DocumentMarkdownArtifact` 是 C10 的结构化结果契约，由 `DocumentConversion` 和派生 Markdown Asset 共同持久化；不提前创建 C11 的通用 `artifacts` 表。C11 将引用，不覆盖，既有转换结果。
4. Python Document Runtime 只能执行 `MarkItDown.convert_stream(stream, stream_info=StreamInfo(...))`。禁止 `convert_uri()`、`convert_url()`、`convert_local()`、用户 URL、对象 key、数据库连接、工作区目录和浏览器直接调用。
5. Control API 和 Document Worker 是唯一能访问平台 StoragePort 的模块。Runtime 从请求 body 得到受限字节流，向 Worker 返回 Markdown、converter、版本和 warnings；它从不收到对象 key、预签名 URL、workspace 表或服务端凭据。

## 3. 数据模型与状态机

新增 `documents` 和 `document_conversions`：

| 实体 | 关键字段 | 约束 |
| --- | --- | --- |
| `documents` | `id`, `workspace_id`, `project_id`, `source_asset_id`, `status` | `(workspace_id, source_asset_id)` 唯一；一个 READY 的原始 DOCUMENT Asset 对应一个 Document；所有查询先带 workspace 条件。 |
| `document_conversions` | `id`, `workspace_id`, `project_id`, `document_id`, `status`, `markdown_asset_id`, `converter`, `converter_version`, `warnings`, `error`, `attempt_count` | 每个 Document 至多一个非终态转换；成功结果不可原地替换。 |

`DocumentConversionStatus`：

```text
CREATED -> QUEUED -> RUNNING -> SUCCEEDED
QUEUED | RUNNING -> FAILED
FAILED -> QUEUED (用户显式重试，复用同一 conversion)
```

创建时冻结 `source_asset_id`、SHA-256、MIME、文件名和字节数。Worker 崩溃后从持久化事实恢复：若 `markdown_asset_id` 已存在且状态为 `SUCCEEDED`，不再调用 Runtime；若状态为 `RUNNING` 且没有结果，则可重新读取同一源 Asset 进行一次可审计转换。每次转换使用 `(conversion_id, attempt_no)`，但派生产物只在事务中第一次成功写入。

## 4. 公共与内部契约

### 4.1 浏览器 API

扩展文档上传 MIME 白名单：`application/pdf`、DOCX、PPTX、XLSX、`text/markdown`、`text/plain`；仍沿用 25 MiB 上限和既有预签名上传/确认流程。

确认原始 DOCUMENT Asset 后，Studio 自动创建转换命令；也提供显式重试，不要求用户理解解析器或队列。

```text
POST /api/v1/projects/{project_id}/documents/{source_asset_id}/conversions {}
  Idempotency-Key -> 202 { conversion }

GET /api/v1/projects/{project_id}/documents
GET /api/v1/document-conversions/{conversion_id}
POST /api/v1/document-conversions/{conversion_id}/retry {}
```

公开 `DocumentConversion` 只包含 ID、源 Asset ID、状态、是否可重试、warnings 摘要、Markdown Asset ID、创建/更新时间。不得包含对象 key、预签名 URL、内部 Runtime 地址/token、原始异常、converter 的完整堆栈或任何内部请求头。Markdown 下载仍走既有、授权的单对象短时下载 URL。

### 4.2 Runtime API

```text
POST /internal/v1/document-conversions
Authorization: Bearer <DOCUMENT_RUNTIME_TOKEN>
Content-Type: <source MIME>
X-Document-Conversion-Id: dcv_...
X-Source-Filename-Base64: <UTF-8 basename encoded as Base64URL without padding>
X-Source-Sha256: <hex>

binary source body
  -> 200 { markdown, converter, converter_version, warnings }
```

Runtime 仅监听 loopback/private network，Token 只在 Document Worker 环境读取。文件名仅以严格校验的 Base64URL UTF-8 值跨越 HTTP 边界，避免非 ASCII 请求头导致转换请求在到达 Runtime 前失败；Runtime 解码后仍执行安全文件名和扩展名校验。请求不得含 URL、object key、workspace ID、project ID、用户身份、Provider 字段或任意 converter options。Runtime 限制输入 25 MiB、输出 10 MiB、允许 MIME 和安全文件名；未知或不一致输入失败关闭。

## 5. 事件、队列与错误

Control API 在创建 Document/Conversion 的同一事务写 Outbox。Document Worker 从独立 `document-conversion` 队列消费以下内部事件：

```text
document_conversion.queued
document_conversion.started
document_conversion.succeeded
document_conversion.failed
```

公共 SSE 仅投影 `conversion_id`、`source_asset_id`、规范化 status、`markdown_asset_id`（仅成功）与 `retryable`。不会投影 source path、MIME 探测细节、Runtime、MarkItDown、堆栈、对象 key 或内部错误。

错误统一归一化为 `DOCUMENT_UNSUPPORTED`、`DOCUMENT_CONVERSION_FAILED`、`DOCUMENT_CONVERSION_ACTIVE_CONFLICT`、`DOCUMENT_RUNTIME_UNAVAILABLE`、`DOCUMENT_OUTPUT_INVALID`、`STORAGE_UNAVAILABLE`、`IDEMPOTENCY_CONFLICT`、`WORKSPACE_FORBIDDEN`。Runtime `4xx` 的格式拒绝为非重试；连接失败、超时、`5xx` 为可重试；写入/哈希不一致为受控失败且不发布结果 Asset。

## 6. 实现顺序

1. 在 contracts/domain 中定义 `DocumentId`、`DocumentConversionId`、DTO、状态机、错误码和 internal/public event schema；更新 OpenAPI/AsyncAPI/JSON Schema。
2. 在 persistence schema 与迁移中创建 `documents`、`document_conversions`、工作区复合外键、一个 Document 一个 active conversion 的唯一索引和转换结果约束；实现 Repository 和事务幂等。
3. 新建 `services/document-runtime`：FastAPI、MarkItDown stream-only adapter、request limits、Token 校验、允许格式、错误归一化、无网络回归与 `UPSTREAM.md` 来源记录。
4. 新建 `apps/document-worker`：消费独立队列，读取 StoragePort、调用 Runtime、校验 Markdown UTF-8/大小/SHA-256、写派生 Asset、推进 Conversion 和 Outbox；重启不会重复发布或覆盖成功产物。
5. 扩展 Control API 的资料路由与安全 serializer；Studio 项目页增加简明“项目资料”区域，上传后自动显示“正在整理 / 已可使用 / 需要重试”。
6. 使用本地 PDF/DOCX/PPTX/XLSX fixtures 运行 Runtime、持久化、Worker 恢复、HTTP、SSE 和浏览器 E2E；真实视频/Veyra/VPS 始终不启动。

## 7. Studio 交互

项目页面在“想法”之前显示一个简短的“项目资料”区域：用户点击添加资料，选择文件后看到文件名和简单状态。上传确认后自动整理；成功显示“已准备好用于这次创作”，失败显示“这份资料暂时无法使用”与唯一的“重新整理”动作。页面不显示 MarkItDown、MIME、队列、对象存储、Artifact、模型或工程参数。

资料不自动改写当前创作描述，也不自动发起视频。C11 产生故事计划时才明确引用已成功资料，并向用户说明资料如何参与创作。

## 8. 测试与 Exit Gate

- Domain：合法/非法转换迁移、终态不可覆盖、重试和活跃转换互斥。
- Contracts：公开 DTO/SSE 不泄露内部字段；MIME 白名单；幂等冲突。
- Runtime：PDF/DOCX/PPTX/XLSX、Markdown、纯文本 fixture；只调用 `convert_stream`；拒绝 URL/超限/未知 MIME；禁用网络和本地路径转换。
- Integration：Storage 流、Markdown SHA-256、派生 Asset、Outbox、Worker 崩溃恢复、重复事件、写入失败不发布成功。
- E2E：项目资料上传、自动整理、刷新恢复、Markdown 下载、失败重试、跨项目/工作区隔离和移动布局。

只有上述门禁通过、转换结果可追溯、没有网络/对象 key 泄露、默认 Mock 视频闭环不回归后，C10 才可标记 `ACCEPTED`。本章不包含 Veyra、SUB2API 视频 POST、SSH、VPS、DNS、TLS 或部署。

> **2026-09-01 当前音频口径**：C10 资料转换不要求用户上传旁白/样音；自动视频音频由 Provider 原生或显式 Doubao 服务器资产路径产生。本文关于 Mock、Veyra/VPS 和外部调用的范围仍有效；当前本机对照按最新自动音频执行文档单独进行，不扩大 C10。

## 2026-10-02 P5 离线依赖验证记录

- 固定 MarkItDown 来源 `fd239d5d2be43d9b68329730206b9312c7d5a388` 的 `packages/markitdown/pyproject.toml` 声明四个所需 extras：`pdf = ["pdfminer.six>=20251230", "pdfplumber>=0.11.9"]`、`docx = ["mammoth~=1.11.0", "lxml"]`、`pptx = ["python-pptx"]`、`xlsx = ["pandas", "openpyxl"]`。没有扩大既有六种 C10 格式 allowlist。
- 本机 uv 为 `0.12.5`；配置 cache 路径为 `C:\Users\T14S\AppData\Local\uv\cache`。本轮外部任务根目录为 `C:\Users\T14S\AppData\Local\Temp\alchemy-source-test-39b51b2edfe24950a8365da1c4fc6bdd`；未创建 document-runtime 环境，未使用项目 `.venv`、未修改或清理 cache。
- 显式设置 `UV_PROJECT_ENVIRONMENT` 指向该任务根目录下新的 `document-runtime-venv` 并设置 `UV_OFFLINE=1` 后，`uv lock --offline` 退出码 1。uv 报告离线索引仅有 `markitdown[pdf]<0.1.7` 或 `>=0.2`，无法满足现有范围 `>=0.1.7,<0.2`；同时 `uvicorn==0.53.0`、`pydantic==2.13.5` 需从 registry 下载。按冻结验证规则记 `BLOCKED_LOCAL_CACHE` 并停止，不联网、不安装、不改 lock。
- `services/document-runtime/pyproject.toml` 保持原值，`uv.lock` 未变化；四种 parser fixture 与完整 Runtime suite 未运行。因此 C10 当前章节状态仍受依赖闭包验证阻断，本记录不构成章节验收或 `ACCEPTED`。

## 2026-10-02 P5 隔离包安装复验（TaskSpec 1.2.1 supersession）

- 本节按《原仓库偏差收敛开发包_20261001》`03 §10.2–10.3` 窄范围覆盖上方历史离线缓存阻断记录：只为固定 MarkItDown `pdf/docx/pptx/xlsx` extras 下载 Python 包，并在仓库外全新隔离环境运行测试。此前 P5 cache miss 的失败事实保留为历史记录，不再代表当前 P5 状态。
- document-runtime 锁定依赖已在任务隔离环境中安装；既有纯文本、Markdown、PDF/DOCX/PPTX/XLSX fixture 与 URL/错误扩展名/未知 MIME/超限负例 `8/8` 通过。media-runtime core 锁依赖在另一隔离环境中安装，完整 unittest `145/145` 通过、0 skip。两包 `uv lock --check --locked` 与 `uv sync --locked --no-dev` 均通过。
- MarkItDown extras 名称及依赖均来自固定上游 commit `fd239d5d2be43d9b68329730206b9312c7d5a388`；C10 六种既有格式 allowlist、URL/路径安全边界和 Runtime 公开契约均未扩展。未改生产代码或 Dockerfile。真实业务外部服务均未调用。
- P5 的固定来源/依赖闭包 Source Fidelity 与独立普通 Audit 均已 PASS，普通 Audit 在隔离环境复跑 `8/8` 与 `145/145`。这只关闭 P5 packaging/runtime 依赖门，不代表 C10 全部 API、持久化、Worker 恢复、Studio/E2E 等 Exit Gate 已通过；C10 章节仍不得据此标记 `ACCEPTED`，完整章节审计仍需单独决定。
