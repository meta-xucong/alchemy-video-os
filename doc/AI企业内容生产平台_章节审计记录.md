# AI 企业内容生产平台：章节审计记录

本文件是章节状态的唯一审计记录。状态变更必须附测试命令、证据路径和结论。没有证据不得标记 `ACCEPTED`。

## 1. 状态字典

`PENDING`：尚未开始；`IN_PROGRESS`：正在实现；`READY_FOR_AUDIT`：代码和测试完成，等待审计；`ACCEPTED`：Exit Gate 已满足；`BLOCKED`：存在未解决阻塞。

## 2. 当前章节总表

| 章节 | 名称 | 状态 | 前置 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| C00 | 文档、决策和来源基线 | `ACCEPTED` | - | 2026-08-12 | 2026-08-12 | 本目录文档、工具链检查 |
| C01 | Monorepo 与本地基础设施 | `ACCEPTED` | C00 | 2026-08-12 | 2026-08-13 | ADR-0012/0013、workspace 验证、两次 `pnpm dev` HTTP 启停、Compose 完整重启及全部 healthcheck 证据已由审计员复核通过 |
| C02 | Contracts、Domain、Persistence | `ACCEPTED` | C01 | 2026-08-13 | 2026-08-13 | 审计员已独立复验 contracts/domain/persistence、公开事件边界、迁移、空库和本地库、Compose 健康与来源隔离；等待主线执行受限备份流程 |
| C03 | Control API 与 Dev Identity | `PENDING` | C02 |  |  |  |
| C04 | Asset、Project、Shot 工作台 | `PENDING` | C03 |  |  |  |
| C05 | Outbox、Queue 和 Worker | `PENDING` | C02/C04 |  |  |  |
| C06 | Mock 视频生成闭环 | `PENDING` | C05 |  |  |  |
| C07 | SUB2API 离线 Adapter | `PENDING` | C06 |  |  |  |
| C08 | 真实 Provider 能力认证 | `PENDING` | C07 |  |  |  |
| C09 | Veyra 身份和共享积分 | `PENDING` | C08 |  |  |  |
| C10 | MarkItDown 企业资料链路 | `PENDING` | C06 |  |  |  |
| C11 | Prompt、Script、Storyboard | `PENDING` | C10 |  |  |  |
| C12 | OpenMontage、QC、成片 | `PENDING` | C11/C06 |  |  |  |
| C13 | 发布前审计和部署准备 | `PENDING` | C09/C12 |  |  |  |

## 3. C00 开发前基线审计

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| `AGENTS.md` 存在且包含基本规则 | 通过 | `D:\AI\alchemy_video_OS\AGENTS.md` |
| 主方案、MVP、领域契约和专项文档存在 | 通过 | `D:\AI\alchemy_video_OS\doc\` |
| 目录、JSON、数据库、Provider 命名规则已统一 | 通过 | 正式开发总控文档 3.1-3.2 |
| Asset 来源与 Shot/TaskRun 状态机已拆分并统一 | 通过 | 领域模型、API 与事件契约 3.1-3.2 |
| 真实 Provider、Veyra、VPS、域名均延期 | 通过 | 正式开发总控文档 3.4、18 |
| 决策、安全、测试、来源记录已建立 | 通过 | `doc/` 下对应记录文件 |
| Node、pnpm、Docker 可用 | 通过 | Node `v24.14.1`、pnpm `10.33.0`、Docker `29.3.1` |

### C00 结论

```text
当前状态：ACCEPTED
测试/检查：Node `v24.14.1`、pnpm `10.33.0`、Docker `29.3.1` 可用；AGENTS.md 与全部 doc Markdown 代码块闭合；旧任务状态/事件术语扫描无匹配；旧目录别名仅存在于迁移说明。
审计结论：开发前基线通过；下一步进入 C01 Monorepo 与本地基础设施
```

## 4. 后续章节记录格式

### C01.0：上游复用审计（ACCEPTED 子关卡）

状态：ACCEPTED（C01 子关卡，不代表 C01 Exit Gate）
实施日期：2026-08-12 至 2026-08-13
范围：C01.0 已完成四个固定上游的来源审计；当前继续按矩阵实现 pnpm monorepo、Nuxt Studio、Hono Control API 和 PostgreSQL/Redis/MinIO 本地基础设施。
C01.0 审计期间的禁止事项：创建 C01 应用源码、pnpm workspace、Compose、服务骨架；读取任何凭据；调用真实 Provider、Veyra、VPS 或域名。该限制在 C01.0 通过后解除，但 C01 实现仍必须遵守复用矩阵、最小基座范围和本地 Mock 约束。
Git 备份治理：`upstream/` 仅为本机溯源/摘取工作目录，已由 `.gitignore` 忽略；不得加入 Git 索引、不得创建 submodule/gitlink。只有审计员确认该章节 Exit Gate 为 `ACCEPTED` 后，才可执行受限 `git add`、`feat(Cxx): ...` 提交、推送 `origin/main` 和创建 `cxx-accepted` tag；`IN_PROGRESS` 与 `READY_FOR_AUDIT` 时禁止 `git add`、提交、tag、推送。任何提交均不得包含真实 Key、ticket、签名 URL、媒体二进制、测试输出或上游完整快照。
来源范围：`allenGKC/Seedance-2.5`、`microsoft/markitdown`、`calesthio/OpenMontage`、`chatfire-AI/huobao-drama`。`sub2api-video-mcp` 不在本次四仓库拉取范围内。
前置依据：第三方来源与复用登记、代码实现与仓库整合详细方案、开发决策记录。
固定来源和 detached HEAD 校验：

| 仓库 | URL | 固定 commit | 本机目录 | 校验结果 | 许可证提示 |
| --- | --- | --- | --- | --- | --- |
| Seedance-2.5 | `https://github.com/allenGKC/Seedance-2.5.git` | `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `upstream/seedance-2.5` | detached、clean、HEAD 一致 | MIT |
| markitdown | `https://github.com/microsoft/markitdown.git` | `fd239d5d2be43d9b68329730206b9312c7d5a388` | `upstream/markitdown` | detached、clean、HEAD 一致 | MIT |
| OpenMontage | `https://github.com/calesthio/OpenMontage.git` | `4eab34c5cfcccaa4f1970554928feccce73ee930` | `upstream/openmontage` | detached、clean、HEAD 一致 | GNU AGPL v3 |
| huobao-drama | `https://github.com/chatfire-AI/huobao-drama.git` | `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `upstream/huobao-drama` | detached、clean、HEAD 一致 | 无根 LICENSE；backend 声明 ISC |

Git 隔离与私有备份事实：

1. `git check-ignore -v upstream/seedance-2.5/README.md` 命中 `.gitignore:36:upstream/`。
2. `git ls-files --stage -- upstream` 输出 `upstream index entries: NONE`；四个上游目录均未进入平台 Git，且未创建 submodule 或 gitlink。
3. 当前 `origin` 为 `https://github.com/meta-xucong/alchemy-video-os.git`；当前本地 HEAD 是 `6e4ef40fd10671fc9828c212d98087bb14637f26`（`chore: keep upstream snapshots out of platform backup`）。这是对 C00 私有备份基线的当前事实记录，不改写历史、不推送、不打 tag。

复用矩阵与差异清单：`doc/AI企业内容生产平台_C01上游复用矩阵.md`。该矩阵逐项记录目标模块、上游文件/符号/测试、薄适配位置、最小修改理由及不可迁入部分。

测试命令及结果：

1. `git -C upstream/<repo> rev-parse HEAD`、`git -C upstream/<repo> branch --show-current`、`git -C upstream/<repo> status --porcelain`、`git -C upstream/<repo> remote get-url origin`：四仓库均为固定 URL、detached、clean，HEAD 与表中 commit 相同。
2. `python upstream/seedance-2.5/scripts/validate.py`：Python `3.12.10`，输出 `Validation passed: seedance-25 contains 11 files.`
3. 未运行 Huobao、MarkItDown、OpenMontage 的完整测试套件，避免安装依赖或触发可能访问外部服务的上游测试；其精确测试候选已登记在复用矩阵。

修改文件：`doc/AI企业内容生产平台_第三方来源与复用登记.md`、`doc/AI企业内容生产平台_C01上游复用矩阵.md`、本审计记录。
契约变化：无。未迁入任何上游源码、夹具、媒体二进制或 Provider 配置。
未完成项：C01 正式目标仍未完成，必须继续验证 pnpm monorepo、PostgreSQL、Redis、MinIO 和最小 API/Web 基座。C01.0 通过仅授权开始这些 C01 实现；只有审计员确认 C01 Exit Gate 为 `ACCEPTED` 后，才可执行受限 Git 提交、推送和 tag 流程。
风险：OpenMontage 是 AGPL v3，huobao-drama 未发现根 LICENSE；按当前学习用途不阻塞，但未来公开发布或商用前需要单独审查。上游完整测试未运行，实际迁入时必须运行所选文件对应的回归测试。
审计人：Codex
Exit Gate 结论：C01.0 上游复用审计证据完整，子关卡为 `ACCEPTED`。C01 正式章节保持 `IN_PROGRESS`，尚未满足其 Monorepo 与本地基础设施 Exit Gate；C02 保持 `PENDING`，未触及。

### C01 实施记录（ACCEPTED）

状态：ACCEPTED
实施日期：2026-08-13
前置子关卡：C01.0 上游复用审计（ACCEPTED）

已迁入并登记：

| 目标路径 | 来源登记 | 当前内容 |
| --- | --- | --- |
| `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json` | 根工作区规则；Huobao 的 Nuxt/Hono package scripts 作为版本和命令参考 | `apps/*`、`packages/*` workspace；统一 dev/build/typecheck/test/infra 命令 |
| `apps/studio-web/` | `apps/studio-web/UPSTREAM.md`；Huobao `frontend/package.json`、`nuxt.config.ts`、`app.vue`、layout、`useApi` 和测试结构 | 最小 Nuxt SPA；端口 3031；只通过 `/api/v1/health` 访问 Control API；无短剧业务、Provider、Key 页面 |
| `apps/control-api/` | `apps/control-api/UPSTREAM.md`；Huobao `backend/package.json`、`src/index.ts`、logger、health route | 最小 Hono 服务；端口 3032；只提供 health；错误 envelope 含 `details: {}`；无数据库和外部调用 |
| `packages/contracts`、`domain`、`persistence`、`storage-client` | C01 正式目录要求 | 仅创建空 package 边界，领域和 Persistence 留待 C02 |
| `infrastructure/compose/` | `infrastructure/compose/UPSTREAM.md`；Huobao `docker-compose.yml` 的 services、healthcheck、restart、volumes | PostgreSQL 16、Redis 7、固定 MinIO 镜像；宿主端口 15432、6380、9002、9003，容器内端口 5432、6379、9000、9001；命名卷 |
| `.env.example`、`README.md` | C01 本地规范 | 无真实 Key；明确 C01 进行中、C02 尚未开始和实际启动/停止命令 |

已通过的检查：

1. `node --test apps/studio-web/tests/base.test.mjs`：2/2 通过。
2. `docker compose -f infrastructure/compose/docker-compose.local.yml config`：通过，三项服务和端口展开正确。
3. `python upstream/seedance-2.5/scripts/validate.py`：通过，固定上游 Skill 包含 11 个文件。
4. `git diff --check`：通过；`git ls-files --stage -- upstream`：无索引条目。
5. `pnpm install --frozen-lockfile`：通过；`.npmrc` 将 pnpm store 固定到已忽略的本仓库 `.pnpm-store/`，不修改损坏的全局 store。
6. `pnpm --filter @alchemy-video/control-api test`、`typecheck`、`build`：均通过。测试覆盖 `/api/v1/health` 和 Hono `app.onError` 的失败 envelope（含 `details: {}`）。
7. `pnpm --filter @alchemy-video/studio-web test`、`typecheck`、`build`：均通过。Studio 使用端口 3031、公开 `/api/v1` proxy 和无 Provider 的健康状态页面。
8. `pnpm typecheck`、`pnpm test`：均通过。
9. 本地启动验证：Control API 在 `http://127.0.0.1:3032/api/v1/health` 返回 `{\"data\":{\"service\":\"control-api\",\"status\":\"ok\"},\"request_id\":\"local\"}`；Studio 在 `http://localhost:3031/` 返回 HTTP 200 和 `AI Enterprise Content Platform` 标题。由于本机 `http_proxy/https_proxy` 会代理 loopback，请求使用 `curl --noproxy "*"` 验证。验证后已停止本轮启动的 3031/3032 进程。

未通过或未完成的检查：

1. 默认共享 pnpm store 的 `pnpm store status` 报缺失索引文件 `D:\.pnpm-store\v10\index\...json`。为避免修改该全局 store，改用本仓库已忽略的 `.pnpm-store/`；`.npmrc` 已固定 `store-dir=.pnpm-store`。长时限重建成功，生成 `pnpm-lock.yaml`（227,756 bytes）并完成 586 个包的 workspace 链接。
2. `pnpm --filter @alchemy-video/control-api test`、`typecheck`、`build` 均通过。Hono error middleware 初始不能捕获框架级异常，已改为 `app.onError`，其统一失败 envelope 测试通过。Studio 首次 `nuxt typecheck` 要求 `vue-tsc`，已作为 devDependency 加入并更新锁文件；`pnpm --filter @alchemy-video/studio-web test`、`typecheck`、`build` 均通过。根 `pnpm typecheck`、`pnpm test` 与 Compose config 检查均通过。
3. 原固定端口的启动尝试被本机环境阻断：Windows 保留端口范围包含 `54239-54338`，因此 `54329` 无法绑定；现有用户服务占用 `6379`、`9000`、`9001`。该历史尝试没有停止或修改其他服务。

端口变更历史：用户于 2026-08-13 明确授权非破坏性端口重映射。ADR-0011 曾将 PostgreSQL 宿主端口设为 `54350`，但 Windows 动态保留范围随后扩展至 `54339-54438`，使 Docker 无法绑定。ADR-0011 已标记为 `SUPERSEDED`；ADR-0012 将 PostgreSQL 宿主端口最终定为 `15432`，保留 Redis `6380`、MinIO API `9002`、Console `9003`。不停止、不重配 billing-core、veyraagent 或其他用户服务。

执行 ADR-0011 的证据：

1. 三个旧 `compose-*` 容器均通过 Docker 标签确认 `project=compose`、配置文件为 `D:\AI\alchemy_video_OS\infrastructure\compose\docker-compose.local.yml`、服务分别为 postgres/redis/minio、状态均为 `created`。使用 `docker compose -p compose -f infrastructure/compose/docker-compose.local.yml down` 后，仅移除了这三个已确认的 C01 容器和 `compose_default` 网络；没有删除卷，也未操作其他 Compose 项目。
2. `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`docker compose -f infrastructure/compose/docker-compose.local.yml config` 均通过。最初的新 Compose 名为 `alchemy-video-local`，静态配置曾映射 `54350:5432`、`6380:6379`、`9002:9000`、`9003:9001`，且 MinIO 容器内 healthcheck 仍访问 `localhost:9000`。
3. 初次 `docker compose -f infrastructure/compose/docker-compose.local.yml up -d --wait` 创建了新项目容器，但 PostgreSQL 的 `0.0.0.0:54350` 绑定被 Windows 拒绝。启动后 `netsh interface ipv4 show excludedportrange protocol=tcp` 显示范围已包含 `54339-54438`；`Get-NetTCPConnection` 没有 `54350` listener，因此阻塞是系统端口保留而非用户进程占用。该映射已由 ADR-0012 替代。
4. 新项目的 Redis 与 MinIO 均为 `healthy`：Redis 容器内 `redis-cli ping` 返回 `PONG`；MinIO 容器内和宿主机 `curl.exe --noproxy "*" --fail --silent --show-error http://127.0.0.1:9002/minio/health/live` 均成功。PostgreSQL 容器仍为 `Created`，无法执行 `pg_isready`；因此三项真实健康验证未完成。

执行 ADR-0012 与最终验收证据：

1. 变更前以 `docker inspect alchemy-video-local-postgres-1` 确认旧 PostgreSQL 容器的 `project=alchemy-video-local`、`service=postgres`、配置文件为 `D:\AI\alchemy_video_OS\infrastructure\compose\docker-compose.local.yml`、状态为 `created`。执行 `docker compose -f infrastructure/compose/docker-compose.local.yml up -d --no-deps --force-recreate postgres` 后，只重建了该 PostgreSQL 容器；Redis 和 MinIO 持续运行，没有操作 billing-core、veyraagent 或其他项目容器。
2. `pnpm install --frozen-lockfile`：通过，7 个 workspace，锁文件保持最新。`pnpm typecheck`：通过，Control API 与 Studio 均完成。`pnpm test`：通过，Studio 2/2、Control API 2/2。`pnpm build`：通过，Control API TypeScript 构建和 Nuxt/Nitro 生产构建均成功。
3. `docker compose -f infrastructure/compose/docker-compose.local.yml config`：通过，项目名 `alchemy-video-local`，映射为 PostgreSQL `15432:5432`、Redis `6380:6379`、MinIO `9002:9000`、`9003:9001`。`docker compose ... ps`：PostgreSQL、Redis、MinIO 均为 `healthy`。
4. 容器内验证通过：`docker exec alchemy-video-local-postgres-1 pg_isready -U video_local -d video_local` 返回 `accepting connections`；`docker exec alchemy-video-local-redis-1 redis-cli ping` 返回 `PONG`；MinIO 容器内 `curl -fsS http://localhost:9000/minio/health/live` 成功。宿主机 `curl.exe --noproxy "*" --fail --silent --show-error http://127.0.0.1:9002/minio/health/live` 成功。
5. 宿主端口验证通过：`Test-NetConnection 127.0.0.1 -Port 15432/6380/9002/9003 -InformationLevel Quiet` 均返回 `True`；`Get-NetTCPConnection` 显示这些端口由 Docker Desktop/WSL relay 监听，符合 Compose 发布端口行为。
6. API 与 Web loopback 验证通过：临时启动 Control API 后，`curl.exe --noproxy "*" --fail --silent --show-error http://127.0.0.1:3032/api/v1/health` 返回 `{"data":{"service":"control-api","status":"ok"},"request_id":"local"}`。临时启动 Nuxt 生产产物 `node .output/server/index.mjs`（`HOST=127.0.0.1`、`PORT=3031`）后，`curl.exe --noproxy "*" http://127.0.0.1:3031/` 返回包含 `AI Enterprise Content Platform` 的 HTML。验证后已按本轮启动器 PID 终止 API/Web 进程树；Compose 基础设施保持运行。

残余风险：本机执行 `nuxt dev --port 3031` 或显式 IPv4 dev 监听时，端口会监听但 HTTP 请求在 30 秒内无响应；同一代码的 `pnpm build` 和 Nuxt/Nitro 生产服务器均通过实际请求。这不改变 C01 基础设施、Web 构建或公开 API 边界，但需要在后续本机开发体验专项中排查 Node 24/Nuxt dev runtime 组合。未将该 dev runtime 行为静默当作成功。

审计预警处理：正式总控 6.6 要求所有本地服务可重复启动/停止，README 的标准路径是 `pnpm dev`。原 `nuxt dev --port 3031` 在当前 Windows/Node `24.14.1`、Nuxt `3.21.11` 组合下会监听但 30 秒内不返回 HTTP，因此此前 `READY_FOR_AUDIT` 被退回。ADR-0013 已以 `apps/studio-web/scripts/serve-local.mjs` 替换该启动契约：每次 `pnpm dev` 都构建现有 Nuxt 项目，再在 `127.0.0.1:3031` 启动 Nitro 产物；脚本使用 `pathToFileURL` 导入 Windows 绝对路径，避免 Node ESM `ERR_UNSUPPORTED_ESM_URL_SCHEME`。

标准启动、停止与重复验证：

1. 从 `3031`、`3032` 均空闲的状态启动根 `pnpm dev`。`curl.exe --noproxy "*" --fail --silent --show-error http://127.0.0.1:3032/api/v1/health` 返回 `{"data":{"service":"control-api","status":"ok"},"request_id":"local"}`；`curl.exe --noproxy "*" --fail --silent --show-error http://127.0.0.1:3031/` 返回包含 `AI Enterprise Content Platform` 的 HTML。监听为 Studio `127.0.0.1:3031`、Control API `3032`。
2. 按根启动器 PID 定向终止第一轮 `pnpm dev` 子进程树后，`3031` 与 `3032` 均无监听。再次启动根 `pnpm dev`，同一 API JSON 和 Studio HTML 检查再次通过。终止第二轮启动器树后，两个端口再次释放；未留下 API 或 Studio 开发进程。
3. 执行 `pnpm infra:down` 后，`docker compose ... ps -a` 没有 C01 容器；执行 `pnpm infra:up` 与 `docker compose ... up -d --wait` 后，PostgreSQL、Redis、MinIO 全部为 `healthy`。容器内 `pg_isready`、`redis-cli ping`、MinIO live health 和宿主端口 `15432/6380/9002/9003` 连接均再次通过。该操作只匹配 `alchemy-video-local` 项目，未操作其他 Compose 项目。

审计员最终复核：独立执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 均通过；Compose 配置解析通过，PostgreSQL、Redis、MinIO 均为 `healthy`，容器内健康命令与宿主端口 `15432`、`6380`、`9002`、`9003` 连接均通过。审计端从空闲的 `3031`、`3032` 启动标准 `pnpm dev`，确认 API health JSON 与 Studio HTML 均成功返回；按该审计启动器 PID 递归停止后两个端口均已释放。`upstream/` 命中 `.gitignore`，索引和 submodule 均无上游快照。

当前结论：本段 C01 证据所述的来源登记、静态配置、安装、类型检查、测试、构建、标准 `pnpm dev` 双端点 HTTP、停止/重启、Compose config、基础设施完整重启、healthcheck 与端口监听均已由审计员复核，Exit Gate 为 `ACCEPTED`。随后 C01 已完成受限 Git 提交、推送和 `c01-accepted` 标签；C02 的当前状态见以下记录。

### C02：Contracts、Domain、Persistence

状态：ACCEPTED
实施日期：2026-08-13
前置条件：C01 `ACCEPTED`；`HEAD`、`origin/main`、轻量标签 `c01-accepted` 均为 `394815b307a2e3f803923b0e99ad1461da867e53`。
范围：仅实现 Zod DTO、错误码、公开/内部事件、TaskRun 状态机和领域不变量、Drizzle PostgreSQL schema、workspace 范围仓库、前向迁移、OpenAPI/AsyncAPI/JSON Schema 导出及纯领域/契约测试。
禁止事项：不实现 C03 Control API 身份或路由、不改页面、不创建 Worker/队列/Provider、不读取真实 Key、不接 Veyra 或 VPS。
来源边界：Huobao 的 `backend/src/db/schema.ts` 仅作为 Drizzle 表声明和 `createdAt`/`updatedAt` 命名模式参考；OpenMontage 的 `tests/contracts/test_phase0_contracts.py` 仅作为 schema contract test 闸门参考。详细迁入/舍弃表位于 `doc/AI企业内容生产平台_C02上游复用矩阵.md`，每个目标 package 另有 `UPSTREAM.md`。
实现文件：

- `packages/contracts/src/`、`packages/contracts/tests/`、`packages/contracts/UPSTREAM.md`、`contracts/openapi.json`、`contracts/openapi.yaml`、`contracts/asyncapi.json`、`contracts/asyncapi.yaml`、`contracts/platform-contracts.schema.json`
- `packages/domain/src/`、`packages/domain/tests/`、`packages/domain/UPSTREAM.md`
- `packages/persistence/src/`、`packages/persistence/tests/`、`packages/persistence/drizzle/`、`packages/persistence/drizzle.config.ts`、`packages/persistence/UPSTREAM.md`
- `doc/AI企业内容生产平台_C02上游复用矩阵.md`、`README.md`、根 `package.json`、三个 package 的 `package.json`、`pnpm-lock.yaml`

实现结论：

1. Contracts 以 Zod 为唯一源码，覆盖 12 个核心实体、统一成功/失败 envelope、应用错误码、内部/公开事件 envelope、C02 HTTP/SSE DTO，并导出 OpenAPI、AsyncAPI 和 JSON Schema。`TASK_RUN_STATUSES` 与 `TASK_RUN_TERMINAL_STATUSES` 是内部 TaskRun 状态集合的单一代码来源。公开 Asset/TaskRun DTO 不含内部 `object_key` 或 Provider 原始 request/response payload；`PublicWorkspaceEventEnvelope` 是 `/api/v1/events` 唯一公开 SSE DTO，`InternalEventEnvelope` 只由 AsyncAPI、outbox 和队列使用。
2. Domain 实现完整 TaskRun 状态机和不变量：非法迁移拒绝、input_snapshot 不可变、结果资产不可提前发布或替换、持久化 provider_request_id 后禁止重复 submit、每个 Shot 最多一个非终态运行、同键相同请求回放/不同请求冲突。ADR-0014 已覆盖本地 Mock `DOWNLOADING -> SUCCEEDED`、显式 `FAILED -> QUEUED`、提交前 `QUEUED -> ABANDONED` 和 `BILLING_FAILED -> BILLING_PENDING`；`BILLING_FAILED` 保持可恢复状态。
3. Persistence 定义 `users`、`workspaces`、`workspace_members`、`projects`、`assets`、`shots`、`reference_bindings`、`task_runs`、`provider_attempts`、`usage_records`、`outbox_events`、`command_deduplications` 共 12 表；金额是 PostgreSQL `numeric(18,8)`；所有 workspace 资源仓库 query 显式带 `workspace_id`。数据库以部分唯一索引拒绝同 Shot 的第二个非终态 TaskRun：仅 `SUCCEEDED`、`FAILED`、`ABANDONED` 允许历史运行与后续运行并存，`BILLING_FAILED` 保持活动以保护只扣费重试。复合外键阻止跨 workspace/project 的资产、Shot、TaskRun、ProviderAttempt、UsageRecord 和 outbox 关联。
4. 来源复用符合 `doc/AI企业内容生产平台_C02上游复用矩阵.md`：Huobao 仅复用 Drizzle 表声明/时间字段的组织方式；OpenMontage 仅复用 schema contract test 质量门思路。没有迁入短剧模型、MySQL、Provider 调用、任务全局状态、文件系统事实源或任何真实凭据；每个目标 package 都有 `UPSTREAM.md`。

测试命令及实际结果：

1. `$env:PNPM_HOME = (Resolve-Path '.pnpm-store').Path; pnpm install --frozen-lockfile`：通过，7 个 workspace，lockfile 未变化；仅提示现有 Nuxt 相关 peer/build-script warning。
2. `pnpm contracts:generate`：通过，输出 `contracts/openapi.{json,yaml}`、`contracts/asyncapi.{json,yaml}`、`contracts/platform-contracts.schema.json`。
3. `pnpm typecheck`：通过，Control API、Studio、contracts、domain、persistence 全部通过。
4. `pnpm test`：通过，31 项测试通过、1 项 PostgreSQL 索引集成测试在未设置 `DATABASE_URL` 的纯测试路径中按设计跳过：Control API 2、Studio 2、contracts 15、domain 7、persistence 5 通过加 1 跳过。
5. `pnpm build`：通过，Control API、Studio/Nitro、contracts、domain、persistence 全部构建成功；仅有现有 Nuxt/Node deprecation warning。
6. `pnpm --filter @alchemy-video/persistence db:generate`：通过，输出 `No schema changes, nothing to migrate`，确认 Drizzle schema 无漂移；此前由 workspace CommonJS 解析发现的 `@alchemy-video/contracts` exports 缺口已通过 `require/default` 条件和构建前置脚本修复。
7. `$env:DATABASE_URL = 'postgresql://video_local:video_local@127.0.0.1:15432/video_local'; pnpm --filter @alchemy-video/persistence db:migrate`：通过且可重放；本地 `video_local` 的 `drizzle.__drizzle_migrations` 为 4，`task_runs_one_active_shot_key` 实际谓词仅排除 `SUCCEEDED`、`FAILED`、`ABANDONED`。
8. 在专用空数据库 `video_c02_state_machine_audit` 从零运行同一迁移：通过，结果为 4 份迁移、12 张契约表、`usage_records.amount` 精度 `18:8`、5 条关键 workspace 复合外键和 ADR-0014 索引谓词；审计库随后已删除。
9. 以 `DATABASE_URL` 显式运行 persistence 测试：6 项全部通过。事务回滚验证允许同一 Shot 保存 `SUCCEEDED`、`FAILED`、`ABANDONED` 三份历史运行，第二个活动 TaskRun 命中 `task_runs_one_active_shot_key` 被拒绝；跨 workspace `Asset -> Project` 仍命中 `assets_workspace_project_fk`。预期拒绝不提交测试数据。
10. `docker compose -f infrastructure/compose/docker-compose.local.yml config`：通过；`docker compose ... ps`：PostgreSQL、Redis、MinIO 均为 `healthy`。
11. `git diff --check`：通过；`git ls-files --stage -- upstream` 为空；工作区未暂存。跟踪文件过滤只返回允许纳入版本库的 `.env.example`，未发现 upstream、真实 `.env`、node_modules、构建输出或媒体二进制。

风险和未完成项：

- C02 只定义和验证 DTO、领域、持久化与迁移；C03 才能实现身份和 HTTP handlers，C04/C05/C06 才能接入页面、资产存储、outbox relay、Worker 和 Mock 视频闭环。
- 迁移已作用于本地 C01 PostgreSQL `video_local`，没有执行生产/VPS/Provider/Veyra 操作；真实 Key、共享积分和外部调用仍未配置。
- `pnpm install` 与 Nuxt build 保留现有 peer/deprecation warning，不影响本次命令退出状态；不在 C02 擅自升级依赖。

纠偏记录（2026-08-13）：上一次 SSE 中断前将 C02 误标为 `READY_FOR_AUDIT`，但 `AGENTS.md` 5.2 的简写与领域契约 3.2 的完整 TaskRun 图冲突。C02 已恢复为唯一 `IN_PROGRESS`；ADR-0014 已统一两个文档，Zod/领域/Drizzle 一致性、仅向前的第 4 份迁移、空库/本地库和实际索引验证均已完成。

审计驳回记录（2026-08-13）：独立复核发现 `packages/contracts/src/specifications.ts` 曾把 `InternalEventEnvelopeSchema` 注册给 OpenAPI，并让公开 `/api/v1/events` 的 `text/event-stream` 直接引用它。因此生成的 `contracts/openapi.*` 包含 `provider_request_id`，违反浏览器不得接收 Provider 原生或内部数据的边界，也使“仅按内部事件契约出现”的旧表述失实。C02 已立即从 `READY_FOR_AUDIT` 回退为唯一 `IN_PROGRESS`；必须新增安全的公开 SSE envelope、将 AsyncAPI/内部导出分离、全文扫描所有公开路径和重新运行完整门禁。

公开/内部事件纠偏证据（2026-08-13）：

1. ADR-0015 固定 `PublicWorkspaceEventEnvelope` 为浏览器唯一 SSE DTO。`/api/v1/events` 的 OpenAPI `text/event-stream` 仅引用该 schema；OpenAPI 和 `platform-contracts.schema.json` 只注册公开 components，AsyncAPI 单独注册 `InternalEventEnvelope`。
2. `TaskRunProgressedEventSchema` 使用内部 `TaskRunStatusSchema`，可表达 `PROVIDER_PROCESSING`；`PublicTaskRunProgressedEventSchema` 使用 `PublicTaskRunStatusSchema`，只表达归一化后的 `PROCESSING`。契约测试同时断言内部可解析前者、公开 SSE 拒绝前者。
3. `TaskRunDetailSchema.attempts` 只使用 `TaskRunAttemptSchema`，明确不含 `provider`、`model`、`provider_request_id`、`request_payload`、`response_payload`。该约束有直接 schema 测试，并由公开导出扫描覆盖。
4. `pnpm contracts:generate` 后，`@alchemy-video/contracts` 的 typecheck 和 15 项测试全部通过，含 Zod 与 tracked exports 无漂移、公开路径拒绝内部字段、AsyncAPI 保留 `provider_request_id` 的断言。
5. 对 `contracts/openapi.{json,yaml}` 和 `contracts/platform-contracts.schema.json` 按 JSON 字段名扫描 `provider_request_id`、`provider`、`request_payload`、`response_payload`、`object_key`、`veyra` 及签名 URL query，均为零命中；`InternalEventEnvelope` 也为零命中。对应的 `contracts/asyncapi.{json,yaml}` 则按设计含 `InternalEventEnvelope` 和 `provider_request_id`。
6. 本轮重新执行 `pnpm install --frozen-lockfile`、根 `pnpm typecheck`、`pnpm test`、`pnpm build`、`db:generate`、本地 PostgreSQL `db:migrate`、带 `DATABASE_URL` 的 persistence 6 项测试、Compose config/healthcheck、`pg_isready`、`redis-cli ping`、MinIO live health 和端口监听检查，全部通过。没有修改 C03、Provider、Veyra、VPS 或真实凭据。

独立审计证据（2026-08-13）：审计员在未采信实现方结果的前提下，重新执行 `pnpm install --frozen-lockfile`、`pnpm contracts:generate`、根 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm --filter @alchemy-video/persistence db:generate`，均通过；根测试为 31 通过、1 个未设置 `DATABASE_URL` 时设计性跳过，显式 `DATABASE_URL` persistence 测试为 6 通过。公开 OpenAPI 和独立 JSON Schema 扫描未发现 `provider_request_id`、`provider`、request/response payload、`object_key` 或 Veyra 字段；`/api/v1/events` 仅引用 `PublicWorkspaceEventEnvelope`，AsyncAPI 保留 `InternalEventEnvelope` 与 `provider_request_id`。本地库可重放 4 份迁移；临时空库从零迁移得到 12 张表、4 条迁移记录、`numeric(18,8)` 和只排除 `SUCCEEDED`、`FAILED`、`ABANDONED` 的活动 TaskRun 索引，审计库已删除。Compose config 通过，PostgreSQL、Redis、MinIO 均为 healthy；`upstream/` 已忽略且 Git 索引为空，`c01-accepted`、`origin/main` 仍指向 `394815b307a2e3f803923b0e99ad1461da867e53`。

Exit Gate 结论：C02 为 `ACCEPTED`。主线现在仅获授权执行受限的 C02 备份流程：审查暂存范围，创建 `feat(C02): ...` 提交，推送 `origin/main`，创建并推送 `c02-accepted`。在该备份由审计员复核前，C03 仍为 `PENDING`，不得开始 C03。

每章完成时追加：

```text
### Cxx：章节名称

状态：READY_FOR_AUDIT / ACCEPTED / BLOCKED
实施日期：
实现提交或工作区快照：
修改文件：
契约变化：
测试命令及结果：
验收证据路径：
未完成项：
风险：
审计人：
Exit Gate 结论：
```
