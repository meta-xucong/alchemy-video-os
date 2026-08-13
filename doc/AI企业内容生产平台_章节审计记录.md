# AI 企业内容生产平台：章节审计记录

本文件是章节状态的唯一审计记录。状态变更必须附测试命令、证据路径和结论。没有证据不得标记 `ACCEPTED`。

## 1. 状态字典

`PENDING`：尚未开始；`IN_PROGRESS`：正在实现；`READY_FOR_AUDIT`：代码和测试完成，等待审计；`ACCEPTED`：Exit Gate 已满足；`BLOCKED`：存在未解决阻塞。

## 2. 当前章节总表

| 章节 | 名称 | 状态 | 前置 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| C00 | 文档、决策和来源基线 | `ACCEPTED` | - | 2026-08-12 | 2026-08-12 | 本目录文档、工具链检查 |
| C01 | Monorepo 与本地基础设施 | `ACCEPTED` | C00 | 2026-08-12 | 2026-08-13 | ADR-0012/0013、workspace 验证、两次 `pnpm dev` HTTP 启停、Compose 完整重启及全部 healthcheck 证据已由审计员复核通过 |
| C02 | Contracts、Domain、Persistence | `ACCEPTED` | C01 | 2026-08-13 | 2026-08-13 | 审计员已独立复验 contracts/domain/persistence、公开事件边界、迁移、空库和本地库、Compose 健康与来源隔离；已备份至 `origin/main` 和 `c02-accepted` |
| C03 | Control API 与 Dev Identity | `ACCEPTED` | C02 | 2026-08-13 | 2026-08-13 | 审计员独立复验 Dev Identity、workspace 授权、幂等、PostgreSQL 集成、原子契约导出和 Studio 运行时代理；已备份至 `origin/main` 与 `c03-accepted` |
| C04 | Asset、Project、Shot 工作台 | `ACCEPTED` | C03 | 2026-08-13 | 2026-08-13 | 审计员已独立复验并完成远端备份：`origin/main`、`c04-accepted^{}` 与本地 HEAD 均为 `20965c3c4577bf479f9fd143c6e0b5793f6c7795` |
| C05 | Outbox、Queue 和 Worker | `READY_FOR_AUDIT` | C02/C04 | 2026-08-13 | 2026-08-13 | 已补齐版本化 `InternalTaskRunQueueMessage`、outbox/job/payload workspace 权威校验、消费账本 `(workspace_id,event_id,consumer_name)` 复合完整性与 PostgreSQL/BullMQ 回归；等待独立审计，不得 Git 或进入 C06。 |
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

备份复核（2026-08-13）：`feat(C02): establish contracts domain persistence` 已作为提交 `3ddf3b92eb9c115c1cd714632f545e8fa0928149` 推送到 `origin/main`；带注释标签 `c02-accepted` 的 tag object 为 `a1d371aeeeb5cfc7fa1a29ba26397d4f4f84808b`，解引用后同样指向该提交，远端 refs 已独立核对。提交包含 53 个 C02 范围内的源码、迁移、生成契约、来源记录和文档文件；不含 `upstream/`、真实 `.env`、媒体、测试输出或本地卷。提交后工作区干净，`git diff --check` 通过。

Exit Gate 结论：C02 为 `ACCEPTED` 且备份复核通过。C03 现在可以由主线作为唯一 `IN_PROGRESS` 章节开始；C04/C05 及之后章节继续保持 `PENDING`。

### C03：Control API 与 Dev Identity

状态：ACCEPTED
实施日期：2026-08-13
前置条件：C02 `ACCEPTED`；`HEAD`、`origin/main` 和带注释标签 `c02-accepted` 解引用均为 `3ddf3b92eb9c115c1cd714632f545e8fa0928149`。
范围：`DevIdentityAdapter`、公开 `/api/v1` 的身份/工作区/项目控制面、workspace 授权、命令幂等、统一响应与错误映射，以及 Studio 的最小公开 API client。
禁止事项：不实现 C04 资产/分镜接口，不实现 C05 outbox/队列/Worker/SSE relay，不接 Provider、Storage、Veyra、VPS、部署或真实凭据。
当前实施依据：正式开发总控文档 8.1-8.5、领域模型与 API 事件契约 2.2/4/6、ADR-0002/0004/0015 与本地 MVP 执行规格的固定开发身份和工作区隔离规则。

实现快照：工作区未暂存改动，尚未执行 `git add`、提交、推送或 tag。新增 `DevIdentityAdapter` 固定本地 `usr_dev_owner` / `ws_dev_default`；Control API 仅公开 `GET /api/v1/health`、`/me`、`/workspaces`、`/projects`、`POST /projects`、`GET/PATCH /projects/:project_id`。所有项目读取和命令先执行 `workspace_id` 条件和 membership 校验；未实现 C04 asset/shot 或 C05 queue/Worker/SSE。

契约与实现：`RequestIdSchema` 已收紧为 `req_` 加 Crockford ULID，运行时生成同形 ID。公开 OpenAPI 增加受授权的 `GET /api/v1/projects` 和 `ProjectListSuccess`，ADR-0016 记录其必要性。`DrizzleControlPlaneRepository` 与内存测试实现均将 PATCH 不存在项目的 `404 NOT_FOUND` 作为带 HTTP status 的 `command_deduplications` 终态快照；相同 scope/key/body 即使资源后来创建仍重放 `404`，同 key 不同 body 返回 `409 IDEMPOTENCY_CONFLICT`。公开 DTO、日志和错误 envelope 不包含 Provider、存储、Veyra、对象 key 或签名 URL 字段。

来源与边界：Hono 路由注册、middleware 结构、Nuxt app/proxy 和单一 API composable 从固定的 `huobao-drama` commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 做薄适配；详细路径、未迁入 MySQL/短剧状态/Provider 调用和回归命令见 `apps/control-api/UPSTREAM.md`、`apps/studio-web/UPSTREAM.md`、`packages/persistence/UPSTREAM.md`。`upstream/` 仍被 `.gitignore` 忽略，未进入 Git 索引。

测试命令及实际结果：

1. `$env:PNPM_HOME = (Resolve-Path '.pnpm-store').Path; pnpm install --frozen-lockfile`：通过，7 个 workspace，lockfile 未变化。
2. `pnpm contracts:generate`：通过，OpenAPI/AsyncAPI/JSON Schema 生成物无漂移；`RequestIdSchema` 和公开路径的契约测试随根测试通过。
3. `$env:DATABASE_URL = 'postgresql://video_local:video_local@127.0.0.1:15432/video_local'; pnpm typecheck`：通过，Control API、Studio、contracts、domain、persistence 全部通过。
4. 同一 `DATABASE_URL` 下的 `pnpm test`：通过 39 项、0 跳过、0 失败。其中 contracts 15、domain 7、persistence 7、Control API 7、Studio 3；persistence 的 PostgreSQL 集成测试覆盖同键创建回放、同键异 body `409`、重新构造 repository 后回放、workspace-scoped 读取，以及不存在 PATCH 的可回放 `404`。
5. `pnpm build`、`pnpm --filter @alchemy-video/persistence db:generate`、`pnpm --filter @alchemy-video/persistence db:migrate`：均通过；Drizzle 输出 `No schema changes, nothing to migrate`，本地迁移可重放。
6. `docker compose -f infrastructure/compose/docker-compose.local.yml config --quiet`、`docker compose ... ps`、`pg_isready`、`redis-cli ping`、`curl.exe --noproxy "*" --fail --silent http://127.0.0.1:9002/minio/health/live`：均通过；PostgreSQL `15432`、Redis `6380`、MinIO API/Console `9002/9003` 均 healthy。
7. 历史运行时冒烟记录：此前曾记录 Studio `/api/v1/health` 为 `200`，但复审发现该验证没有证明 Studio Nitro 与 API 在同一受控生命周期中运行，且当 Nitro 独立运行时，构建期代理会返回 `502` 或 SPA HTML。因此该条中的 Studio proxy 成功表述不作为 C03 验收证据；其余 API 项目幂等验证不受影响。有效的受控双进程证据见下方“Studio 运行时代理纠偏”。

审计纠偏（2026-08-13）：审计在 `pnpm contracts:generate` 后并行运行根 `pnpm test` 时观察到 `Unexpected end of JSON input`。根因是生成器直接截断并写入五个 tracked artifact，读者可能在写入完成前读取 JSON。`packages/contracts/src/write-contract-documents.ts` 现将每份 artifact 先写入同目录唯一临时文件，再以 rename 原子替换目标；同目录 `.contract-generation.lock` 通过独占创建串行化并发生成者，避免 Windows 上多个 rename 争抢。无论读者或写者异常，临时文件和锁均在 finally/错误路径清理。

纠偏回归与重新验证（2026-08-13）：contracts 新增并发测试，先生成初始 artifact，再并发执行 12 次生成与 120 次 JSON 读取，断言 `openapi.json`、`asyncapi.json`、`platform-contracts.schema.json` 始终可解析，最终目录仅含五个 artifact。该测试和生成后的第二次 contracts test 均为 16/16 通过。随后按审计顺序运行 `pnpm contracts:generate`，设置本地 `DATABASE_URL` 后运行根 `pnpm typecheck`、`pnpm test`（40 项通过、0 跳过、0 失败，其中 contracts 16）、`pnpm build`、Drizzle `db:generate`（无 schema 漂移）和 `db:migrate`（可重放），全部通过。

无 `.env.local` 启动证据（2026-08-13）：确认 `.env.local` 不存在。此前此段将 Studio proxy 记为通过，但复审确认旧 Nitro `routeRules` 在构建时固化 `CONTROL_API_ORIGIN`，且先前 handler 位于未被 `srcDir: "app/"` 扫描的仓库根 `server/`，所以不能作为有效证据。该历史表述由下方“Studio 运行时代理纠偏”取代。本轮启动的 API/Nitro 子进程已精确停止，之后端口 `3031/3032` 无 listener；contracts 输出目录无 `.tmp` 或 lock 文件。

Studio 运行时代理纠偏（2026-08-13）：移除 Nitro 构建期 `routeRules` proxy，保留 Vite 开发代理；在 Nuxt 实际扫描目录 `apps/studio-web/app/server/routes/api/v1/[...path].ts` 增加仅服务端的 `/api/v1/**` handler。handler 每个请求读取 Studio 进程的 `CONTROL_API_ORIGIN`，未设置时才回退到私有 `runtimeConfig.controlApiOrigin` 和本地默认值；浏览器继续只调用相对 `/api/v1/**`，不会收到 upstream 地址。`h3` 作为 Studio 直接依赖声明，防止 Node 回归测试依赖 Nuxt 的间接安装。构建产物已确认注册 `/api/v1/**:path` 及对应 handler chunk。

Studio 运行时代理回归与受控验证（2026-08-13）：Studio 测试入口现执行所有 `tests/*.test.mjs`，新增测试启动临时 H3 upstream，设置 `CONTROL_API_ORIGIN` 后通过 proxy 转发 `/api/v1/health?probe=runtime`，断言上游实际收到完整 path/query 且返回 `200`；Studio 测试为 4/4 通过。随后在 `.env.local` 不存在、未提供真实 Key 的同一 Node 监督进程环境中并行启动 Control API `3032` 和 Studio Nitro `3031`，统一注入 `DATABASE_URL`、`CONTROL_API_ORIGIN=http://127.0.0.1:3032`、`LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false`、`HOST/PORT`。实测 API `/api/v1/health`、Studio `/`、Studio `/api/v1/health` 全部为 `200`；Studio proxy 返回的 JSON 也明确为 `dependencies.database: "ok"`。监督器 finally 停止两个子进程，之后 `3031/3032` 无 listener。

风险与未完成项：C03 没有 SSO、外部身份、工作区切换、资产/分镜、outbox、Worker、Provider、Storage、Veyra 或部署能力；这些明确属于后续章节。Nuxt 构建只输出既有 Node 依赖的 deprecation warning，所有命令退出状态为零。当前执行环境拒绝用后台包装直接运行 `pnpm dev`，但其实际 Control API 与 Nitro 入口已在同一无密钥环境变量下并行验证；正常本机终端仍以 README 的 `pnpm dev` 作为标准命令。

审计员独立复核（2026-08-13）：在不采信实现方结论的前提下，审计端重新执行 `pnpm contracts:generate`、带本地 PostgreSQL `DATABASE_URL` 的根 `pnpm typecheck`、`pnpm test`（41 通过、0 跳过、0 失败）、`pnpm build`、`db:generate`、`db:migrate`、Compose config/health 和 contracts 并发导出回归（16/16）。审计端还在同一无密钥环境中启动 Control API `3032` 与 Studio Nitro `3031`：`/api/v1/health`、`/api/v1/me`、Studio `/`、Studio `/api/v1/health` 均为 `200`；固定开发身份为 `usr_dev_owner`/`ws_dev_default`；同一创建键重放同一 `prj_`，变更 body 为 `409 IDEMPOTENCY_CONFLICT`。审计生成的项目与 command deduplication 记录已精确删除，审计启动进程已停止。`upstream/` 仍被忽略，Git 索引和 submodule 均无上游快照，C01/C02 远端备份 refs 保持不变。

Exit Gate 结论：`ACCEPTED`。C03 的 Dev Identity、公开控制面、workspace 授权、命令幂等、数据库持久化、公开边界、契约生成安全和 Studio 最小 API client 均符合正式开发总控文档 8.1-8.5 与 AGENTS.md。现仅授权主线执行受限 `feat(C03)` 提交、推送 `origin/main` 和 `c03-accepted` 标签；完成远端复核前不得启动 C04/C05。

### C04：Asset、Project、Shot 工作台

状态：ACCEPTED
实施日期：2026-08-13
前置条件：C03 `ACCEPTED`，并已完成备份复核，`origin/main` 与带注释标签 `c03-accepted` 解引用均为 `1a59dcf81e568f6fae801cb962f8134067624161`。
范围：服务端生成 object key、短时预签名上传/确认/下载、workspace 授权的 Asset/Shot/ReferenceBinding、公开 `/api/v1` DTO 及 Studio 工作台。
禁止事项：未实现 C05 outbox、队列、Worker 或 SSE；未实现视频 Provider、Veyra、VPS、域名、部署或真实凭据。

来源与迁入边界：

1. `huobao-drama` 固定 `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`：复用 Nuxt 单一 API composable、媒体预览失败回退与上传中局部状态语义，以及 Hono 路由/仓储分层惯例。薄适配位于 `apps/studio-web/app/composables/useAssetMedia.ts`、`useControlApi.ts`、`app/pages/index.vue`、`apps/control-api/src/asset-repository.ts`。未迁入短剧数据、MySQL、静态路径、进程内任务、Provider 或凭据。
2. `OpenMontage` 固定 `4eab34c5cfcccaa4f1970554928feccce73ee930`：复用 Asset 明确技术元数据与 schema contract gate 思路。薄适配位于 `packages/contracts/src/resources.ts`、`packages/storage-client/` 和 `packages/persistence/`。未迁入 `project_dir`、`events.jsonl`、Backlot、Python runtime 或文件系统事实源。
3. `upstream/` 仍受 `.gitignore` 忽略，`git ls-files --stage -- upstream` 无条目；没有 submodule、gitlink、上游快照、真实 `.env`、媒体或测试输出进入索引。详细矩阵和目标模块记录见 `doc/AI企业内容生产平台_C04上游复用矩阵.md`、`apps/control-api/UPSTREAM.md`、`apps/studio-web/UPSTREAM.md`、`packages/persistence/UPSTREAM.md`、`packages/storage-client/UPSTREAM.md`。

契约与实现：

1. Contracts 定义上传申请/确认、下载 URL、Shot/ReferenceBinding DTO，公开错误新增 `SHOT_POSITION_CONFLICT`。浏览器仅在当前授权响应中获得短时 presigned URL；object key、签名 query、Provider/Veyra 字段不进入公开持久 DTO、事件、日志、错误或幂等快照。
2. StoragePort 由服务器生成 `workspace/project/asset/original.ext` object key。S3/MinIO `PutObject` 预签名并要求 `If-None-Match: *`，Studio 原样发出该 header；已确认对象不能被旧 URL 或重新签发的 URL 覆盖。MinIO `PutBucketCors` 的确定性 `NotImplemented/501` 只记录安全诊断，并依赖 Compose 固定的全局 CORS 配置；任何其他初始化错误仍返回 `STORAGE_UNAVAILABLE`。
3. Asset/Shot 仓储所有 workspace 资源查询显式带 `workspace_id`。确认缺失 Asset、无效上传、无效引用、重复 Shot position 和资源不存在更新均为可回放命令终态；同 key/异 body 是 `409 IDEMPOTENCY_CONFLICT`。存储不可用为 `503 STORAGE_UNAVAILABLE`，事务回滚而不持久化命令。重复 position 统一为 `409 SHOT_POSITION_CONFLICT`，Drizzle 先串行检查并保留/捕获 `shots_project_position_key` 作为并发最终防线，避免泄漏为 500。
4. Studio 只经相对 `/api/v1` 访问 Control API；上传 URL 和预览 URL 只保存在组件内存，刷新后须重新申请。页面提供项目选择/创建、图片上传确认下载预览、Shot 创建编辑与 ReferenceBinding 控件；没有直接 MinIO、Provider、Veyra 或数据库调用。

测试命令及实际结果：

1. 无 `.env`、无 `.env.local`、无 `apps/control-api/.env` 条件下，`pnpm install --frozen-lockfile`：通过，7 个 workspace，lockfile 最新。
2. `pnpm contracts:generate`：通过；生成 OpenAPI/AsyncAPI/JSON Schema，contracts 并发原子写入回归随根测试通过。
3. `$env:DATABASE_URL = 'postgresql://video_local:video_local@127.0.0.1:15432/video_local'; pnpm typecheck`：通过，Studio、contracts、domain、persistence、storage-client、Control API 均通过。
4. 同一 `DATABASE_URL` 下 `pnpm test`：通过。Studio 4/4、contracts 17/17、domain 7/7、storage-client 单元 3/3（真实 MinIO 测试在无 S3 环境变量的根测试中按设计跳过）、persistence 8/8（包含 PostgreSQL C04 集成）、Control API 10/10；无失败。
5. 同一 `DATABASE_URL` 下 `pnpm build`：通过，Nuxt/Nitro、Control API 与所有 packages 构建成功；仅有既有 Nuxt/Node deprecation warning。
6. `pnpm --filter @alchemy-video/persistence db:generate`：`No schema changes, nothing to migrate`；带 `DATABASE_URL` 的 `db:migrate`：通过并可重放。
7. 真实 MinIO：设置仅本地假值 `S3_ENDPOINT=http://127.0.0.1:9002`、`S3_REGION=us-east-1`、`S3_BUCKET=video-local`、`S3_ACCESS_KEY=video_local`、`S3_SECRET_KEY=video_local_secret` 后执行 `pnpm --filter @alchemy-video/storage-client test:minio`：1/1 通过。预检允许 `http://127.0.0.1:3031`、`Content-Type`、`If-None-Match`；首次 PUT 200，旧 URL 和新签 URL 覆盖均为 412，SHA-256/内容不变。固定 MinIO 返回 `NotImplemented/501` 的 bucket CORS 命令仅输出 name/code/http status 安全诊断，Compose global CORS 已实际生效。
8. `pnpm --filter @alchemy-video/control-api test:e2e`：通过。监督脚本先拒绝占用的 `3031/3032`，再以进程环境注入本地 mock 配置，直接启动一次性的 API `tsx` 进程和 Studio Nitro 进程，验证 API/Studio/Studio proxy HTTP 200，并仅经公开 HTTP 依次执行 create project、upload request、带 `If-None-Match` PUT、confirm、download 字节校验、create/update Shot、ReferenceBinding 和 Studio proxy detail。`finally` 精确结束子进程树并删除本轮 project/MinIO object；结束后 `.env`、`.env.local`、`apps/control-api/.env` 全不存在，3031/3032 无 listener。
9. `pnpm --filter @alchemy-video/control-api test:studio-ui-e2e`：通过。现有本地 Python Playwright 测试工具只作为测试 harness，不是产品 Runtime 依赖；在同一受控环境中通过真实 Studio UI 创建项目、使用浏览器 file input 上传内嵌有效 1x1 PNG、等待 Asset `READY`、刷新页面、点击 Preview，并断言 `<img>` `complete=true`、`naturalWidth=1`、`naturalHeight=1`。`finally` 删除 1 个测试项目和 1 个 MinIO object、fixture、screenshot，并释放 API `3032` 和 Studio `3031`。独立复核确认没有 `C04 Studio UI E2E %` 或 `C04 public HTTP E2E` 的项目/Asset 记录、没有 C04 fixture/screenshot、没有临时 `.env`，且两个端口均可绑定。旧 `--serve-browser-audit` 的遗留 `tsx watch` 树经命令行与父链确认后已精确终止；新的监督器不再调用 `pnpm ... dev`。
10. `docker compose -f infrastructure/compose/docker-compose.local.yml config --quiet`：通过；`docker compose ... ps` 显示 postgres、redis、minio 均为 healthy。`pg_isready`、`redis-cli ping`、MinIO live health 及宿主端口 `15432/6380/9002/9003` 连接均通过。

风险与未完成项：

- C04 没有图片内容解码、尺寸/方向提取或视频 `ffprobe`；当前上传确认只验证对象 MIME、大小和 SHA-256，媒体深度检查留给后续媒体 Runtime 章节。
- ADR-0020 明确 C04 采用可信 MIME 限制：确认路径不解码用户声明为图片的内容，因此恶意或错误 MIME 仍可能导致预览失败。C04 E2E 使用有效 1x1 PNG，校验下载 MIME、PNG 签名、IHDR 尺寸和字节；真实 Studio UI 复验已断言 Preview 的 `naturalWidth=1`、`naturalHeight=1`。C12 负责引入深度内容探测与媒体质量错误。
- 预签名 URL 是短时响应字段，用户刷新或过期后需重新请求；非 `PENDING_UPLOAD` Asset 不会重签上传 URL。没有真实 Provider、外部 Key、信用扣费、Worker 或事件投递。

Git 备份治理：工作区包含 C04 代码、生成契约和文档的未暂存差异；`git diff --check` 通过。审计员已在 `ACCEPTED` 后仅授权主线执行受限 `git add`、`feat(C04): ...` 提交、推送 `origin/main` 和带注释标签 `c04-accepted`。提交前仍必须排除 `upstream/`、真实 `.env`、媒体二进制、fixture、screenshot、测试输出和本地卷；完成远端 ref 复核前，C05 保持 `PENDING`。

审计纠偏完成（2026-08-13）：旧 E2E 曾把普通文本伪装为 `image/png`，Studio 预览的 `naturalWidth=0`。现已替换为内嵌有效 1x1 PNG，移除 `C04_E2E_AUDIT_HOLD_MS`，并加入下载 MIME、PNG 签名、IHDR 尺寸、字节不变和真实浏览器 Preview 解码断言。旧 `--serve-browser-audit` 进程树在最终扫描中被识别为历史 C04 子树后精确终止；新的 E2E 直接监督一次性 API/Studio 服务，并在正常 UI/HTTP 两条路径中均证明端口、数据库、MinIO object、fixture、screenshot 和临时配置被清理。

审计员独立复核（2026-08-13）：审计端重新执行冻结依赖安装、`pnpm contracts:generate`、带本地 PostgreSQL `DATABASE_URL` 的 `pnpm typecheck`、`pnpm test`（Studio 4、contracts 17、domain 7、storage-client 3、persistence 8、Control API 10 均通过；真实 MinIO 用例在根测试中按设计跳过）、`pnpm build`、Drizzle generate/migrate、真实 MinIO `test:minio`（1/1）、公开 HTTP E2E 与 Python Playwright Studio UI E2E。Compose 配置、PostgreSQL `pg_isready`、Redis `PING`、MinIO live health 和宿主端口均通过。最终扫描确认无 `3031/3032` listener、无 C04 测试 project/object/fixture/screenshot 或临时 `.env` 残留；`git diff --check` 通过，索引未包含 `upstream/`、上游快照、submodule/gitlink、真实凭据、媒体或测试输出。C04 的对象键仅由服务端生成并未进入公开 Asset DTO；所有 Asset/Shot/ReferenceBinding 查询先按 `workspace_id` 范围约束，命令幂等和 ReferenceBinding READY/同项目约束由持久化事务实现；Shot 编辑不创建 TaskRun。结论：C04 Exit Gate 为 `ACCEPTED`。

C04 备份复核（2026-08-13）：`feat(C04): asset project and shot workbench` 已推送为 `20965c3c4577bf479f9fd143c6e0b5793f6c7795`。`origin/main`、本地 HEAD 与带注释标签 `c04-accepted` 的 peeled ref 均指向该提交；tag object 为 `644b793f99f8e6bba99d428dc515ec80a3b84cea`，C03 tag 是其祖先。索引无 `upstream/`、gitlink、媒体、fixture、screenshot、真实 `.env` 或真实凭据；仅保留用户未暂存的 `.env.example` CORS 样例改动。C05 现为唯一 `IN_PROGRESS` 章节。

### C05：Outbox、Queue 和 Worker

状态：ACCEPTED
实施日期：2026-08-13
前置条件：C02/C04 `ACCEPTED`；C04 远端备份已独立复核为 `20965c3c4577bf479f9fd143c6e0b5793f6c7795`。
范围：事务 outbox、BullMQ relay、可恢复 Worker、至少一次投递去重、重试/backoff、dead-letter、stale lease 恢复、内部事件持久化与公开 SSE 受控投影。
禁止事项：不实现 C06 MockVideoProvider、公开 generation API、Provider submit/poll/download、MP4/ffprobe、Veyra/计费、VPS、域名、部署或真实凭据。
初始实现依据：正式开发总控文档 10.1-10.4、领域模型与 API 事件契约的内部/公开事件分层、ADR-0014 TaskRun 状态机和本地 MVP Redis/BullMQ 约束。

范围纠偏（2026-08-13）：曾在 C05 工作区临时注册并测试 `POST /api/v1/shots/:shot_id/generations`。正式总控 11.3 将该公开 endpoint 严格归入 C06，因此已从 Control API 运行时和 C05 HTTP 测试中移除；C05 只保留未公开的 TaskRun/CommandDeduplication/`task_run.queued` PostgreSQL 事务能力，由 persistence 与 Worker 集成测试直接验证。C02 已存在的未来 OpenAPI 定义继续作为 C06 契约，不表示 C05 运行时可调用。公开 SSE `/api/v1/events` 保留，且仅回放持久化的 `PublicWorkspaceEventEnvelope` 投影。

实现快照（2026-08-13）：工作区未暂存改动，未执行 Git add、提交、推送或 tag。新增 `packages/persistence/src/task-run-repository.ts`、`packages/task-queue/`、`apps/task-worker/` 和 Control API 的内部 TaskRun 注入/公开 SSE 读取；新增 `0004_outbox_delivery_leases.sql` 与生成器 snapshot baseline `0005_nervous_miek.sql`。队列消息现为版本化 `InternalTaskRunQueueMessage`，含 `event_id`、`workspace_id`、`task_run_id`、`attempt_no`、`correlation_id` 和冻结 `input_snapshot`；PostgreSQL 仍是 outbox、TaskRun 和消费去重事实来源。`apps/control-api/src/app.ts` 只注册 C05 `GET /api/v1/events`，未来 generation/TaskRun HTTP 路由未注册；静态边界测试锁定该约束。

审计退回（2026-08-13）：C05 原 READY_FOR_AUDIT 结论被撤回。正式总控 10.2(5) 要求队列消息携带完整字段 `event_id`、`workspace_id`、`task_run_id`、`attempt_no`、`correlation_id` 和冻结 `input_snapshot`，但原实现仅传递 `eventId`/`workspaceId`。同时消费仓储先创建 consumption 再完成消息校验，并从事件 payload 读取 TaskRun workspace，未证明 outbox/job workspace 是唯一数据库范围。当前必须先完成版本化 contracts DTO、Relay/BullMQ/Worker 解析、严格 workspace 一致性拒绝、PostgreSQL/BullMQ 篡改与重复投递回归，再重新执行全门禁；C06 继续 PENDING，禁止 Git 操作。

契约与来源：新增 `OutboxEvent` lease/dead-letter 字段和 `EventConsumption` schema；内部 `InternalEventEnvelope` 只进入 outbox/AsyncAPI，SSE 通过 `projectPublicWorkspaceEvent` 生成严格的 `PublicWorkspaceEventEnvelope`，不包含 input snapshot、Provider、request/response payload、object key、签名 query 或 Veyra 字段。四个指定上游没有可迁入的安全 outbox/BullMQ/lease 实现；仅登记 Huobao `backend/src/services/generation.ts` 的 HTTP 与后台职责分离思路，未迁入 Provider、MySQL、轮询、全局状态或凭据。详细矩阵见 `doc/AI企业内容生产平台_C05上游复用矩阵.md`，目标模块来源见各 `UPSTREAM.md`。

此前门禁（2026-08-13，已被本次审计退回取代）：

1. `pnpm install --frozen-lockfile`：通过，9 个 workspace，锁文件无漂移。
2. `pnpm contracts:generate`：通过；随后 contracts 18/18 通过，原子写入并发回归稳定；公开 OpenAPI/JSON Schema 脱敏扫描和 AsyncAPI 内部事件分层通过。
3. `$env:DATABASE_URL='postgresql://video_local:video_local@127.0.0.1:15432/video_local'; $env:REDIS_URL='redis://127.0.0.1:6380'; pnpm typecheck`：通过；全 workspace typecheck 通过。
4. 同环境 `pnpm test`：通过；Studio 4、Contracts 18、Domain 7、Storage 3（1 个真实 MinIO 用例因普通根测试无 MinIO 专用开关设计性跳过）、Persistence 11、Control API 13（含真实 PostgreSQL SSE）、Task Worker 3，0 失败。
5. 同环境 `pnpm build`：通过；Control API、Task Worker、contracts/domain/persistence/task-queue、Studio Nitro 均构建成功。
6. `pnpm db:migrate` 后 `pnpm db:generate`：均通过；C05 迁移应用成功，随后报告 `No schema changes, nothing to migrate`。
7. 真实 PostgreSQL persistence：11/11 通过，覆盖同键 TaskRun 回放、同键异 hash 冲突、重建 repository、outbox lease 过期恢复、relay retry/dead-letter、消费去重、消费 lease 恢复、跨 workspace 拒绝和无 ProviderAttempt。
8. 真实 Redis/BullMQ：`@alchemy-video/task-queue` 1/1、`@alchemy-video/task-worker` 3/3 通过；验证队列 retry/backoff、最终 dead-letter、Worker 不可用期间的持久任务恢复、`QUEUED -> RUNNING` 一次性推进和缺失 TaskRun 的终态死信。每个唯一测试队列在 finally 中 obliterate，Redis 临时 key 清零。
9. Control API SSE：真实 PostgreSQL 13/13 通过，覆盖首帧、`Last-Event-ID` 回放、跨 workspace 访问拒绝、空集 keep-alive、持久化重建读取和敏感字段拒绝；浏览器收到的 `id` 为 `event_id`。
10. Compose/服务健康：`docker compose ... config --quiet` 通过；现有 `alchemy-video-local` PostgreSQL `15432`、Redis `6380`、MinIO `9002/9003` 均 healthy，容器内 `pg_isready`、Redis `PONG`、MinIO `/minio/health/live` 通过；未停止或重配任何容器。
11. 清理：3031/3032 无监听；无 `.env`/`.env.local`、C04 fixture/screenshot 或 C05 临时数据库工作区/对象；`upstream/` 未入索引且无 submodule/gitlink；`git diff --check` 通过。唯一既有用户改动 `.env.example` 保持未暂存。

审计纠偏完成（2026-08-13）：`InternalTaskRunQueueMessageSchema` 已在 contracts 中以 `contract_version: "1.0"` 导出，并仅由 AsyncAPI 内部消息引用；公开 OpenAPI/SSE 不引用该 schema 或 `input_snapshot`。Relay 只从 schema-validated `task_run.queued` outbox row 构造完整 DTO，BullMQ 以 `event_id` 为 job ID 且在 Worker 边界重新 parse。消费事务先以 job 的 `event_id + workspace_id` 查询 outbox；数据库 outbox `workspace_id` 是唯一后续 TaskRun/consumption 查询范围。它在写入/完成 `event_consumptions` 前严格比对 outbox 行、envelope 与 job 的 workspace、TaskRun ID、correlation ID 和 frozen snapshot；任何不一致返回 `RETRY`，不推进状态。

重新验证（2026-08-13）：

1. `pnpm install --frozen-lockfile`：通过，9 个 workspace，lockfile 无漂移。
2. `pnpm contracts:generate`：通过；生成 AsyncAPI 包含内部版本化 queue message，公开 OpenAPI/JSON Schema 仍拒绝内部 DTO。contracts 20/20 通过，包含完整/非法 DTO、AsyncAPI/internal 与公开文档分层、敏感字段拒绝和原子生成并发读取。
3. `$env:DATABASE_URL='postgresql://video_local:video_local@127.0.0.1:15432/video_local'; $env:REDIS_URL='redis://127.0.0.1:6380'; pnpm typecheck`：通过，8 个 workspace 全部通过。
4. 同环境根 `pnpm test`：通过 64 项、0 失败；storage-client 真实 MinIO 用例在根测试无 S3 变量时按设计跳过 1 项。Persistence 11/11 覆盖 PostgreSQL 的篡改 envelope workspace 在创建 consumption 前被拒绝；Task Worker 5/5 覆盖完整 DTO、Relay mismatch、BullMQ 重启、重复投递与单次 `QUEUED -> RUNNING`。
5. 同环境 `pnpm build`：通过；Studio Nitro、contracts、domain、storage、persistence、task-queue、Control API 和 Worker 均构建成功。
6. `pnpm --filter @alchemy-video/persistence db:generate` 与 `db:migrate`：通过；Drizzle 报告无 schema 漂移并成功重放本地迁移。
7. 真实 MinIO：以本地 S3 变量运行 `pnpm --filter @alchemy-video/storage-client test:minio`，1/1 通过；CORS OPTIONS、首次 presigned PUT、旧 URL 与重新签发 URL 覆盖 `412`、原对象 inspection 不变均通过。MinIO 的 `PutBucketCors` `501 NotImplemented` 仅记录安全诊断，Compose 的全局 CORS 已提供实际行为。
8. Compose：`docker compose -f infrastructure/compose/docker-compose.local.yml config --quiet` 通过；`pg_isready`、Redis `PONG` 和 MinIO `/minio/health/live` 均通过，PostgreSQL `15432`、Redis `6380`、MinIO `9002/9003` healthy。
9. 清理与隔离：3031/3032 无 listener；根目录仅有 `.env.example`，应用目录无 `.env*`；`.codex-longrun` 没有 fixture/screenshot；`git diff --check` 通过（仅 CRLF warning）；`git ls-files --stage -- upstream` 与 `git submodule status` 均为空。未执行 Git 写入，用户 `.env.example` 改动保持未暂存。

来源补记：四个指定上游仍没有可迁入的持久化 outbox/BullMQ/lease/recovery 代码。Huobao 仅贡献 HTTP 命令和后台工作分离的职责思路；本轮平台薄适配、字段来源和明确不迁入内容已登记在 `doc/AI企业内容生产平台_C05上游复用矩阵.md`、`packages/task-queue/UPSTREAM.md`、`apps/task-worker/UPSTREAM.md`、`packages/persistence/UPSTREAM.md`。`upstream/` 继续只留本机并受忽略规则保护。

审计纠偏完成（2026-08-13，消费账本范围）：审计发现 `event_consumptions` 虽由 outbox/job `workspace_id` 驱动，但自身没有持久化的 workspace 范围。ADR-0023、契约文档和 forward migration `0006_overjoyed_captain_cross.sql` 已将账本身份收紧为 `(workspace_id, event_id, consumer_name)`：迁移先从 outbox 回填 `workspace_id`，再设置非空列、复合主键、workspace-first recoverable index，以及 `(event_id, workspace_id)` 指向 outbox 的复合外键。Drizzle 与内存 store 的 insert、select、stale-lease reclaim、complete 和 dead-letter 均以队列消息的 workspace 为条件。真实 PostgreSQL 回归证明错误 workspace 消息不创建账本行、错误 workspace release 不会释放正确租约、直接错误 workspace insert 被 `23503/event_consumptions_event_workspace_outbox_fk` 拒绝，而正确 workspace stale lease 仍能回收和死信。真实 BullMQ Worker 重启/重复投递回归继续只产生一次 `task_run.started`。

独立审计结论（2026-08-13）：审计员未执行任何 Git 写入，重新运行 `pnpm install --frozen-lockfile`、`pnpm contracts:generate`、带本地 PostgreSQL/Redis 的根 `pnpm typecheck`、根 `pnpm test`（65 项通过、0 失败）、根 `pnpm build`、`pnpm --filter @alchemy-video/persistence db:migrate` 与 `db:generate`。独立复核确认版本化内部队列 DTO、Relay/BullMQ/Worker 解析、outbox/job/envelope/task workspace 一致性、复合消费账本主键/外键、stale lease、死信、重复投递和 Worker 重启恢复；PostgreSQL、Redis、MinIO health、Compose config、公开 SSE `Last-Event-ID` 回放与脱敏、C05/C06 路由边界均通过。C05 运行时无 Provider/MockVideoProvider/MP4/ffprobe/Veyra 行为；来源矩阵和 `UPSTREAM.md` 已登记且 `upstream/` 不在 Git 索引，无 submodule/gitlink。唯一现有用户改动 `.env.example` 保持未暂存。结论：C05 Exit Gate 为 `ACCEPTED`，仅授权主线执行 C05-only 受限备份。

最终验证（2026-08-13）：

1. `pnpm install --frozen-lockfile`、`pnpm contracts:generate`、`docker compose -f infrastructure/compose/docker-compose.local.yml config --quiet`：均通过。
2. 以 `DATABASE_URL=postgresql://video_local:video_local@127.0.0.1:15432/video_local` 与 `REDIS_URL=redis://127.0.0.1:6380` 运行根 `pnpm typecheck`：8 个 workspace 通过。
3. 同环境根 `pnpm test`：65 项通过，0 失败；根测试未注入 S3 专用变量时，storage-client 的真实 MinIO 用例按设计跳过 1 项。Persistence 12/12、Task Worker 5/5、Control API 13/13 全部通过。
4. 同环境 `pnpm build`：8 个 workspace 通过；Nuxt 仅有现存 Node `DEP0155` 弃用警告，不影响构建结果。
5. `pnpm --filter @alchemy-video/persistence db:generate` 报告无 schema 漂移；`db:migrate` 成功应用现有迁移。PostgreSQL 直接查询确认 `event_consumptions_workspace_id_event_id_consumer_name_pk` 和 `event_consumptions_event_workspace_outbox_fk` 已生效。
6. 显式 MinIO 集成 `pnpm --filter @alchemy-video/storage-client test:minio`：1/1 通过；全局 CORS 生效，首次 PUT 成功、原 URL 和重签 URL 覆盖均为 412。`PutBucketCors` 的 `NotImplemented/501` 仍只记录稳定诊断，非失败。
7. Compose `ps` 显示 PostgreSQL、Redis、MinIO 均 healthy；`pg_isready`、Redis `PONG` 和 MinIO live health 均通过。未操作任何其他项目容器。
8. 清理与隔离：3031/3032 无监听，应用目录无 `.env`/`.env.local`，`upstream/` 未入 Git 索引且无 submodule/gitlink；`git diff --check` 通过（仅 CRLF 警告）。用户已有 `.env.example` 改动保持未暂存。未执行 Git add、提交、推送或 tag。

来源补记：四个指定上游仍没有可迁入的持久化 outbox/BullMQ/lease/recovery 代码。Huobao 仅贡献 HTTP 命令和后台工作分离的职责思路；本轮消费账本 schema、迁移、复合外键和范围测试均为平台薄适配，已登记在 `doc/AI企业内容生产平台_C05上游复用矩阵.md`、`packages/task-queue/UPSTREAM.md`、`apps/task-worker/UPSTREAM.md`、`packages/persistence/UPSTREAM.md`。`upstream/` 继续只留本机并受忽略规则保护。

剩余风险：C05 Worker 只推进到 `RUNNING`，不会创建 ProviderAttempt、提交/轮询 Provider、下载 MP4 或计费；这些以及公开 generation/TaskRun HTTP API 严格属于 C06。C05 已通过独立审计；完成 `c05-accepted` 远端备份复核前不得进入 C06。

Exit Gate 结论：`ACCEPTED`。

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
