# AI 企业内容生产平台：C01 上游复用矩阵

## 1. 审计范围与结论

本文件记录 C01 的上游拉取、固定版本、薄适配计划和实际迁入结果。C01 已创建 pnpm workspace、Nuxt Studio、Hono Control API、最小 package 边界和 PostgreSQL/Redis/MinIO Compose 基座；没有创建 Provider、领域持久化、真实凭据或业务任务实现。

四个用户指定的仓库均已克隆到本机 upstream 目录、检出为 detached HEAD，并与来源登记中的固定 commit 完全一致。sub2api-video-mcp 是后续 C07 的协议参考，不属于本次四仓库拉取范围。

上游目录只用于溯源和摘取，不是平台模块：它被 .gitignore 忽略，Git 索引中没有 upstream 条目，且不得作为 submodule、gitlink、Git subtree 或完整快照提交。后续只能按本矩阵选择文件或符号迁入目标模块，并在目标模块补充 UPSTREAM.md。

## 2. 固定来源快照

| 仓库 | 上游 URL | 固定 commit | 本机目录 | HEAD 校验 | 许可证提示 |
| --- | --- | --- | --- | --- | --- |
| Seedance-2.5 | https://github.com/allenGKC/Seedance-2.5.git | ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7 | upstream/seedance-2.5 | detached，HEAD 等于固定 commit，工作树 clean | 根目录 LICENSE 为 MIT |
| markitdown | https://github.com/microsoft/markitdown.git | fd239d5d2be43d9b68329730206b9312c7d5a388 | upstream/markitdown | detached，HEAD 等于固定 commit，工作树 clean | 根目录 LICENSE 为 MIT |
| OpenMontage | https://github.com/calesthio/OpenMontage.git | 4eab34c5cfcccaa4f1970554928feccce73ee930 | upstream/openmontage | detached，HEAD 等于固定 commit，工作树 clean | 根目录 LICENSE 为 GNU AGPL v3 |
| huobao-drama | https://github.com/chatfire-AI/huobao-drama.git | f04d705603bd0257bcec6b8f44fd04ea3ea9b795 | upstream/huobao-drama | detached，HEAD 等于固定 commit，工作树 clean | 未发现项目根 LICENSE；backend/package.json 声明 ISC |

许可证信息只作来源和未来分发审查提示。当前是本地学习审计，按用户要求不据此阻塞复用。

## 3. C01 上游复用矩阵

| 目标模块和阶段 | 上游文件、符号和测试位置 | 平台薄适配位置与状态 | 最小修改理由与禁止事项 |
| --- | --- | --- | --- |
| Studio Web 基线，C01 | huobao-drama/frontend/package.json；frontend/nuxt.config.ts 的 defineNuxtConfig；frontend/app/app.vue；frontend/app/layouts/studio.vue；frontend/tests/professional-redesign-surface.test.mjs | `apps/studio-web/`，已迁入 Nuxt 3、Vue、lucide-vue-next、`srcDir: app/`、默认 layout 和 C01 health 页面；`scripts/serve-local.mjs` 是 ADR-0013 的平台本地 Nitro 启动薄适配，来源和差异见 `apps/studio-web/UPSTREAM.md` | 沿用 Nuxt 3、Vue、lucide-vue-next、`srcDir: app/` 和紧凑工作台组织。仅改应用名、端口、代理和平台路由；为当前 Windows/Node 24 运行时以 Nitro 启动器替换无响应的 `nuxt dev` 契约；不复制短剧页面实体、AI Key 设置页、远端 Provider 配置。 |
| 浏览器 API 边界，C03-C06 | huobao-drama/frontend/app/composables/useApi.ts 的 req、api；frontend/tests/model-selection-structure.test.mjs | apps/studio-web/app/composables/useApi.ts | 保留统一 fetch 封装、请求计时和导出命名。改为平台 data/error/request_id envelope、Idempotency-Key 和公开 DTO；删除 dramaAPI、episodeAPI 等短剧全局 API，浏览器不得调用 Provider 或内部 API。 |
| 媒体展示工具，C04-C06 | huobao-drama/frontend/app/composables/useMedia.ts 的 thumbOf、thumbFallback、posterOf；frontend/tests/asset-library-structure.test.mjs | apps/studio-web/app/composables/useMedia.ts | 原样复用 URL 推导和回退行为的局部实现。适配为 Asset 公开 URL，禁止依赖 /static 本地文件路径、对象 key 或持久签名 URL。 |
| 模型选择控件，C04-C08 | huobao-drama/frontend/app/components/ModelSelect.vue 的 props、emit、toggle、close；frontend/tests/model-selection-structure.test.mjs；frontend/tests/video-direct-generation-config.test.mjs | apps/studio-web/app/components/ModelSelect.vue | 优先复制组件和交互变量，替换选项来源为 Control API 的已认证能力列表；不让前端看到 API Key、baseUrl 或未经 C08 认证的模型。 |
| Control API 启动和健康检查，C01-C03 | huobao-drama/backend/package.json；backend/tsconfig.json；backend/src/index.ts 的 app、app.get(/api/v1/health)、requestLogger、errorHandler；backend/src/middleware/logger.ts；backend/src/utils/response.ts；docker-compose.yml 的 healthcheck | `apps/control-api/`，已迁入 Hono 启动、health、日志和 error envelope 骨架；`infrastructure/compose/`，已迁入 Compose healthcheck 形状；来源和差异见各自 `UPSTREAM.md` | 保留 Hono、路由挂载、health endpoint、日志和错误处理中间件的结构。替换 CORS、响应 envelope、端口、数据库和静态文件服务；不复制 MySQL、data 卷、前端静态托管、请求体日志中的敏感数据或短剧 routes。 |
| Provider 类型和注册表，C05-C08 | huobao-drama/backend/src/services/adapters/types.ts 的 ImageProviderAdapter、VideoProviderAdapter、ProviderRequest、AIConfig、VideoGenerationRecord、VideoGenResponse、VideoPollResponse；adapters/registry.ts 的 imageAdapters、videoAdapters、getImageAdapter、getVideoAdapter；backend/tests/official-provider-adapters.test.mjs；backend/src/services/generation.ts 的 generateVideo、processTask、pollTask | packages/provider-adapters/；workers/provider-worker/ | 最大化保留接口、请求字段和 adapter registry 命名。将 processTask/pollTask 移入可恢复 Worker，以 TaskRun 和 ProviderAttempt 为事实；禁止把上游直接 Provider 调用、AIConfig 明文、进程内轮询、MySQL sys_task 或本地下载路径带入平台。C01 不创建此实现。 |
| 本地 Compose 形状，C01 | huobao-drama/docker-compose.yml 的 service、depends_on、healthcheck、restart 写法；backend/src/index.ts 的 /api/v1/health | `infrastructure/compose/docker-compose.local.yml`，已迁入 PostgreSQL 16、Redis 7、固定 MinIO、named volumes、healthcheck 和 `alchemy-video-local` 项目名；来源和差异见 `infrastructure/compose/UPSTREAM.md` | 只复用 Docker Compose 的健康检查和服务依赖表达方式。平台 Compose 改为 PostgreSQL、Redis、MinIO 和应用服务，使用无真实 Key 的 `.env.example`；不复制 MySQL 凭据、data/workspace bind mount 或上游应用镜像。 |
| Seedance 知识包和完整性校验，C07-C11 | Seedance-2.5/skill/seedance-25/SKILL.md；references/capabilities.md、prompting.md、references.md、editing.md、long-video.md、troubleshooting.md；scripts/validate.py 的 main | packages/seedance-skill/；workers/prompt-worker/；packages/seedance-skill/tests/upstream-integrity.test.py | 按固定版本复制 Skill 文本、YAML 元数据和 validate.py 所检查的文件集合；提示词 Worker 只读取经过版本登记的知识包。不得复制 install.ps1、install.sh 或把 Skill 中的个人助手/UI/API 假设直接暴露为平台请求参数。 |
| 文档解析 Runtime，C10 | markitdown/packages/markitdown/pyproject.toml；src/markitdown/_markitdown.py 的 MarkItDown、convert_local、convert_stream、register_converter；tests/_test_vectors.py 的 FileTestVector；tests/test_module_vectors.py 的 test_convert_local、test_convert_stream_with_hints、test_convert_stream_without_hints；tests/test_files/ | services/document-runtime/；services/document-runtime/tests/ | 保留 Python 包、converter 注册和流式转换的变量语义，优先把上游固定版本作为受控依赖并复用测试向量。仅接受 Control API 已授权的对象流和 MIME/扩展名 hint；禁用 plugins，禁止 convert_url、convert_uri、任意本地路径和上游网络访问能力。 |
| 媒体 Runtime 核心和 Artifact Schema，C12 | OpenMontage/tools/base_tool.py 的 ToolResult、BaseTool、execute、run_command；tools/tool_registry.py 的 ToolRegistry、register、register_module；schemas/artifacts/asset_manifest.schema.json；schemas/artifacts/render_report.schema.json；pipeline_defs/cinematic.yaml；tests/contracts/test_phase0_contracts.py；tests/contracts/test_runtime_presentation_contract.py | services/media-runtime/；packages/artifact-schemas/；workers/qc-worker/；workers/render-worker/ | 复制 ToolResult/BaseTool/ToolRegistry、选定 schema 与 schema contract 测试，再用内部 API 的 RuntimeExecutionResult 封装。把 path 改为 asset_id 和受控对象引用，并添加 workspace_id、project_id、artifact_id、revision、contract_version；不复制 Backlot、项目目录作为事实源、自由 Agent 编排、全量 Provider registry 或直接读取环境变量。 |
| 环境变量示例防回填测试，C01-C13 | OpenMontage/tests/contracts/test_env_example.py 的 test_env_example_does_not_turn_comments_into_credentials；OpenMontage/.env.example 的空值示例格式 | tests/contracts/test_env_example.py；.env.example | 复用“示例文件中注释不能变成值”的测试思想和 pytest 实现。平台仅列出本地 mock 所需的空配置；不得复制任何 Provider Key 变量、真实值或生产端点。 |

## 4. 明确舍弃的上游部分

| 来源 | 不迁入项 | 原因 |
| --- | --- | --- |
| huobao-drama | dramas、episodes、characters、scenes、props 的业务路由和 MySQL schema；aiConfigs Key 管理页；data 静态目录；processTask 在 Hono 进程内执行 | 平台必须以 workspace、project、shot、TaskRun、ProviderAttempt 为领域事实；任务必须由持久化 Worker 恢复，二进制必须进入对象存储。 |
| markitdown | convert_url、convert_uri、Bing/YouTube/Wikipedia/RSS converter、插件自动加载、任意 Path 输入 | 企业资料只能从已授权对象流解析，避免 SSRF、内网访问和不可审计的文件读取。 |
| OpenMontage | Backlot、projects 文件夹、events.jsonl、自由 Agent 总编排、全量 Provider 与直接 .env 读取 | 平台数据库、outbox 和 Control API 才是业务事实；Provider 和密钥只能由各自 Adapter/Worker 管理。 |
| Seedance-2.5 | install.ps1、install.sh、个人助手入口配置、未被 Provider 能力认证验证的 API 参数假设 | 平台由网页和后续 CLI 统一经 Control API 调用；C08 前仅允许 mock。 |

## 5. C01 证据与未执行项

已执行且通过：

1. 对每个本机仓库执行 git rev-parse HEAD、git branch --show-current、git status --porcelain 和 git remote get-url origin。四个 HEAD 均匹配第 2 节固定 commit，branch 为空即 detached，工作树 clean。
2. 执行 git check-ignore -v upstream/seedance-2.5/README.md，结果为 .gitignore 第 36 行的 upstream/ 规则。
3. 执行 git ls-files --stage -- upstream，结果为 upstream index entries: NONE。
4. 执行 python upstream/seedance-2.5/scripts/validate.py，Python 3.12.10 输出 Validation passed: seedance-25 contains 11 files.

未执行：

1. 未安装或运行 MarkItDown、OpenMontage、Huobao 的完整依赖和测试套件，避免安装依赖、读取 Provider 配置或触发上游可能访问外部服务的测试。
2. 未迁入任何上游完整快照、测试夹具或媒体二进制。实际 C01 薄适配仅位于已登记的 `apps/studio-web/`、`apps/control-api/` 和 `infrastructure/compose/`，并保留其 `UPSTREAM.md`。
3. Provider、领域持久化、队列、真实 Key、Veyra、VPS 和业务任务仍不属于 C01，未创建或运行。

## 6. 后续迁入规则

每次实际迁入必须先在目标模块写 UPSTREAM.md，记录上游 URL、固定 commit、文件和符号、原变量名、平台 mapper、删改原因和回归命令。迁入后只允许目标模块进入平台 Git；upstream 目录始终保持本机忽略状态。

> **2026-09-01 当前音频口径**：C01 基础设施文档不要求用户上传旁白/样音；自动音频路径由后续 Provider 原生或显式 Doubao 薄壳负责。本文早期默认无真实 Provider/TTS 的表述属于基础设施/CI 边界，当前本机对照不改变 C01 的部署与密钥规则。
