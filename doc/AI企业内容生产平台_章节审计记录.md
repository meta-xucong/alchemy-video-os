# AI 企业内容生产平台：章节审计记录

本文件是章节状态的唯一审计记录。状态变更必须附测试命令、证据路径和结论。没有证据不得标记 `ACCEPTED`。

## 1. 状态字典

`PENDING`：尚未开始；`IN_PROGRESS`：正在实现；`READY_FOR_AUDIT`：代码和测试完成，等待审计；`ACCEPTED`：Exit Gate 已满足；`BLOCKED`：存在未解决阻塞。

## 2. 当前章节总表

| 章节 | 名称 | 状态 | 前置 | 开始 | 完成 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| C00 | 文档、决策和来源基线 | `ACCEPTED` | - | 2026-08-12 | 2026-08-12 | 本目录文档、工具链检查 |
| C01 | Monorepo 与本地基础设施 | `ACCEPTED` | C00 | 2026-08-12 | 2026-08-13 | ADR-0012/0013、workspace 验证、两次 `pnpm dev` HTTP 启停、Compose 完整重启及全部 healthcheck 证据已由审计员复核通过 |
| C02 | Contracts、Domain、Persistence | `PENDING` | C01 |  |  |  |
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

当前结论：C01 的来源登记、静态配置、安装、类型检查、测试、构建、标准 `pnpm dev` 双端点 HTTP、停止/重启、Compose config、基础设施完整重启、healthcheck 与端口监听均已由审计员复核，Exit Gate 为 `ACCEPTED`。C02 保持 `PENDING`，直至主线完成受限 Git 提交、推送和 `c01-accepted` 标签；本次审计前未执行这些 Git 操作。

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
