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
| C05 | Outbox、Queue 和 Worker | `ACCEPTED` | C02/C04 | 2026-08-13 | 2026-08-13 | 审计员已独立复验并完成 `c05-accepted` 远端备份；`origin/main` 与 tag peeled ref 指向 `da788e085ebd2fba019a3fbdadd3c0636b809be4`。 |
| C06 | Mock 视频生成闭环 | `ACCEPTED` | C05 | 2026-08-13 | 2026-08-14 | 审计员已独立复跑共享锁、Worker、Studio E2E、根门禁、数据库迁移与本地基础设施健康检查；`origin/main` 与 `c06-accepted^{}` 已复核为 `1e192c71cfda4636ef457eadc50ad4acafc895b3`。 |
| C07 | SUB2API 离线 Adapter | `ACCEPTED` | C06 | 2026-08-14 | 2026-08-14 | `origin/main` 与 `c07-accepted^{}` 已独立复核为 `41d414cf1b6767c39f251445278831328e1620cf`；保持离线、disabled-only 边界 |
| C08 | 真实 Provider 能力认证 | `ACCEPTED` | C07 | 2026-08-14 | 2026-08-14 | ADR-0030 受限认证已完成并复核；真实 profile 继续保持 disabled，未授权运行时装配或部署 |
| C09 | Veyra 身份和共享积分 | `IN_PROGRESS` | C08 | 2026-08-14 |  | C09-A 离线基础已通过独立复核；C09-B 正在完成三 VPS 联动设计，不得进行真实 Veyra、扣费或运行时接线 |
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

### C06：Mock 视频生成闭环

状态：`ACCEPTED`
实施日期：2026-08-13
前置条件：C05 `ACCEPTED`；审计端已复核 `origin/main` 与 `c05-accepted^{}` 指向 `da788e085ebd2fba019a3fbdadd3c0636b809be4`，annotated tag object 为 `95a3fc4e8e194294b2e1eb588177478e4ae76a96`。C07 及以后保持 `PENDING`。
实现工作区：C06 工作区差异，未执行 Git add、提交、推送或 tag。

范围和实现：

1. `packages/provider-video/` 新增独立 `VideoProviderPort`、确定性 `MockVideoProvider`、临时 MP4 fixture 生成和 `ffprobe`/MIME/大小/SHA-256 验证。Mock `submit` 返回 `mock_{task_run_id}`，第一次查询为 `PROCESSING`，第二次为 `SUCCEEDED`；`MOCK_VIDEO_OUTCOME=failed` 返回稳定 `PROVIDER_REJECTED`。
2. `apps/task-worker/src/execution-service.ts` 在 C05 `QUEUED -> RUNNING` 后持久化 ProviderAttempt，提交后保存 request ID，执行轮询、流式下载、媒体验证、workspace-scoped 生成 Asset 和不可覆盖对象写入。重启/重复投递复用已持久化 attempt 或 `PENDING_UPLOAD` generated Asset，不重复 submit，不原地替换成功对象。
3. `apps/control-api` 新增公开 generation、TaskRun detail、retry 路由；Project detail 增加公开 TaskRun 摘要以支持刷新恢复。公开序列化不含 Provider request/response payload、Provider request ID、内部 object key、签名 query 或 Veyra 字段。
4. `apps/studio-web` 新增生成状态、失败重试、任务事件和 `<video controls>` 预览；视频元素不嵌套在按钮内，页面只访问 `/api/v1` 和公开 SSE。
5. Worker 支持 `TASK_QUEUE_NAME`/`TASK_DEAD_LETTER_QUEUE_NAME`，受控 E2E 使用随机隔离队列，避免消费默认队列中的既有工作区事件。

来源复用和舍弃：

- 仅复用 Huobao 固定 commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 bundled ffmpeg/ffprobe 可执行性探测、VideoGenerationRecord/VideoProviderAdapter 字段意图、submit/poll 后台职责划分和媒体预览交互意图。
- 平台改为 `packages/provider-video`、PostgreSQL ProviderAttempt、C05 durable Worker、MinIO immutable write 和公开 DTO；舍弃 Huobao 的直接 Provider HTTP、MySQL、进程内轮询 timer、全局 AIConfig、Key 和本地媒体目录。
- Seedance、markitdown、OpenMontage、sub2api-video-mcp、SUB2API、Veyra、真实 Provider、计费、VPS、域名均未在 C06 迁入或调用。详细路径、符号、薄适配和不可复用原因见 `doc/AI企业内容生产平台_C06上游复用矩阵.md`、`packages/provider-video/UPSTREAM.md` 和 `apps/task-worker/UPSTREAM.md`。固定上游快照仍仅存在本机 `upstream/`，未进入索引、submodule 或 gitlink。

契约和审计证据：

1. `pnpm install --frozen-lockfile --store-dir .pnpm-store`：通过；`pnpm contracts:generate`：通过；生成的 OpenAPI/JSON Schema/AsyncAPI 无漂移，公开边界测试仍拒绝 Provider/object key/内部 payload 字段。
2. 带 `DATABASE_URL=postgresql://video_local:video_local@127.0.0.1:15432/video_local`、`REDIS_URL=redis://127.0.0.1:6380`、本地 MinIO S3 变量和 `VIDEO_PROVIDER=mock` 运行：根 `pnpm typecheck` 通过，根 `pnpm test` 74/74 通过，根 `pnpm build` 通过。分包结果为 contracts 20、Studio 4、storage 4、provider 2、queue 1、domain 7、persistence 12、Control API 15、Worker 9。
3. `pnpm --filter @alchemy-video/persistence db:generate` 报告 `No schema changes`；`db:migrate` 通过。C06 使用既有 task_runs/provider_attempts/assets schema，无新增真实 Provider 或计费迁移。
4. `pnpm --filter @alchemy-video/storage-client test:minio`：通过；真实 OPTIONS/CORS、首次写入、确认资产后旧 URL/重签 URL 覆盖拒绝和原对象内容不变均通过。固定 MinIO 的 `PutBucketCors` 501 只保留 name/code/http status 诊断，Compose global CORS 提供实际行为。
5. `pnpm --filter @alchemy-video/control-api test:c06-e2e`：通过。受控无密钥监督器启动 API `3032`、随机 BullMQ Worker、Studio `3031`，创建项目、上传有效 1x1 PNG、创建/ready 分镜、生成 Mock MP4、刷新页面、点击 Preview；浏览器解码结果为 `videoWidth=160`、`videoHeight=90`、`duration=1s`。
6. C06 Worker PostgreSQL/Redis/BullMQ/MinIO 集成证明生成 Asset READY、SHA-256/ffprobe 校验、Mock failure 无结果资产、Worker 重启不重复 submit、已上传 draft 恢复不替换对象。固定 MP4 由运行时临时生成，不进入 Git。

清理和隔离：

- C06 UI E2E `finally` 删除本轮 1 个项目、2 个 MinIO 对象，obliterate 仅随机 C06 队列，删除 PNG fixture，停止 API/Worker/Studio 子进程并确认 3031/3032 可重新绑定。
- 最终检查无 C06 fixture/screenshot、无 `.env`/`.env.local`，Compose PostgreSQL/Redis/MinIO 均保持 healthy；未停止、重配或修改任何非 C06 Docker/WSL 服务。
- `git diff --check` 通过（仅 Git 的 CRLF warning）；`git ls-files --stage -- upstream` 无条目，未创建 submodule/gitlink；用户已有 `.env.example` 改动保持未暂存。

未完成项：真实 SUB2API/Seedance/Grok Provider、Veyra/共享积分、MarkItDown、OpenMontage、部署和 Codex/CLI 入口均未实现，严格留给后续章节；C07 及以后不得在 C06 审计 `ACCEPTED` 前开始。
风险：C06 Mock 只证明平台任务、存储、恢复和浏览器播放闭环，不证明真实模型质量或 Provider 协议兼容性；声明 MIME 的深度内容探测仍按 ADR-0020 留给 C12；Node/Nuxt 构建保留既有 DEP0155 弃用警告，不影响退出状态。
已撤销的前次 `READY_FOR_AUDIT` 候选（历史记录，非当前状态，2026-08-13）：`TaskRunEventConsumer.process` 的消费事务可在执行器前完成，因此 Worker 现在在 BullMQ ready、processor 未启动时扫描可恢复视频任务，对每项最多执行三次；连续失败独立以 `workspace_id + task_run_id` 写可公开读取和 retry 的 `FAILED`，不依赖已完成 lease。仓储优先复用任意已持久化 `provider_request_id`，不会让较晚无 request ID 的 Attempt 掩盖它。验证已完成：两次临时 MinIO 写失败后第三次启动扫描成功、无历史 job 的扫描耗尽后公开 retry、BullMQ attempts 耗尽后公开 retry，以及所有恢复路径 submit 仅一次。

本轮完整门禁（2026-08-13）：

1. `pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、`pnpm --filter @alchemy-video/persistence db:generate`（`No schema changes`）和 `db:migrate` 均通过。
2. 在本地 PostgreSQL `15432`、Redis `6380`、MinIO `9002` 环境中，根 `pnpm typecheck` 通过，根 `pnpm test` 通过 `82/82`，根 `pnpm build` 通过。Worker 实际集成 `17/17`，包含三次启动扫描、BullMQ 耗尽、公开 retry 和已提交 Attempt 遮蔽回归；持久化 PostgreSQL 测试 `12/12`。
3. `pnpm --filter @alchemy-video/storage-client test:minio` 通过 `1/1`：浏览器 CORS PUT、首次条件写和覆盖拒绝正常。固定 MinIO 的 bucket CORS API `501 NotImplemented` 仅输出不含凭据的诊断；Compose global CORS 提供真实行为。
4. `pnpm --filter @alchemy-video/control-api test:c06-e2e` 通过：受控 API、隔离队列 Worker 和 Studio 完成有效 PNG 上传、Mock MP4 生成、刷新和播放，解码为 `160x90`、`1s`；`finally` 删除 `1` 个项目、`2` 个 MinIO 对象、隔离队列和临时夹具，并释放 `3031/3032`。
5. `docker compose ... config/ps` 与 loopback 检查通过：PostgreSQL、Redis、MinIO 均 healthy；最终无 `3031/3032` listener、无运行时 `.env`、无 C06 fixture/screenshot，`upstream/` 不在索引且未创建 gitlink/submodule。未停止或修改其他 Docker/WSL 服务。

来源和边界：C06 仅复用已登记 Huobao 的媒体工具/Provider 职责分离意图；本轮恢复、持久化 Attempt 优先级和队列终态化为平台薄适配，记录于 `doc/AI企业内容生产平台_C06上游复用矩阵.md`、`packages/provider-video/UPSTREAM.md`、`apps/task-worker/UPSTREAM.md` 和来源登记。未接入 SUB2API、Seedance、Grok、Veyra、真实 Key、VPS 或 C07 代码。
审计人：Codex（等待独立复审）
审计新增阻断已纠正（2026-08-14）：`apps/control-api/tests/c06-local-e2e.mjs` 现以随机 UUID 隔离两组 BullMQ 队列和浏览器命令键。失败阶段启动 `MOCK_VIDEO_OUTCOME=failed` Worker，`apps/control-api/tests/c06-studio-ui-e2e.py --mode failure` 通过 Studio 创建项目、上传内嵌有效 1x1 PNG、创建/ready 分镜和生成，明确断言 `.task-status.failed` 显示 `FAILED` 与公开错误 `Mock video generation was configured to fail.`，且 `Retry failed task` 按钮可用。监督器随后终止该受控失败 Worker，使用独立成功 Mock Worker 与另一随机队列；`--mode retry` 在同一 Studio 项目点击该 Retry 控件，等待同一 TaskRun `SUCCEEDED`、刷新并解码 `<video>` 为 `160x90`、`1s`。真实 PostgreSQL 额外断言失败和成功均为同一 TaskRun、恰好一个 ProviderAttempt/一个持久化 `provider_request_id`，且 retry 后 request ID 不变，证明没有再次 submit。每轮 `finally` 删除唯一项目、两个 MinIO 对象、两组随机队列、所有带随机种子的 command deduplication、PNG fixture，并终止 API/两个 Worker/Studio 子进程；最终 3031/3032 无 listener、无运行时 `.env`/`.env.local`、无 C06 fixture/screenshot。没有真实 Key、外部 Provider/Veyra/网络调用。

本轮重新验证（2026-08-14）：`pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、`pnpm --filter @alchemy-video/persistence db:generate`（`No schema changes`）和 `db:migrate` 全部通过；带本地 PostgreSQL `15432`、Redis `6380`、MinIO `9002` 与 `VIDEO_PROVIDER=mock` 的根 `pnpm typecheck`、`pnpm test`（`82/82`）和 `pnpm build` 全部通过。`pnpm --filter @alchemy-video/storage-client test:minio` 为 `1/1`；Compose config/ps、PostgreSQL/Redis 端口及 MinIO `/minio/health/live` 为 healthy/`200`。`pnpm --filter @alchemy-video/control-api test:c06-e2e` 最终通过，输出 `visible provider failure, retry control, 160x90, 1s` 和完整 cleanup。`git diff --check` 仅有 CRLF warning；`upstream/` 未入索引且无 gitlink/submodule。用户既有 `.env.example` 改动未触及、未暂存，明确排除未来 C06 备份。

独立审计退回（2026-08-14，历史发现）：审计端曾将 `pnpm --filter @alchemy-video/control-api test:c06-e2e` 与 `pnpm --filter @alchemy-video/task-worker test` 放入两个进程并行运行，Worker suite 得到 `15/17`。C05 durable BullMQ 终态 TaskRun 回归在 `worker.integration.test.ts:196` 预期 `QUEUED` 却得到 `FAILED`；C06 executor interruption/retry 回归在 `worker.integration.test.ts:479` 等待 `SUCCEEDED` 超时。根因不是随机 BullMQ queue 本身，而是生产设计中正确的 C06 启动恢复会扫描共享 PostgreSQL 的全部非终态 VIDEO_GENERATION TaskRun，因而可处理另一进程刚创建的集成测试任务。

测试隔离纠正（2026-08-14）：未改变生产 Worker 的全局恢复语义。`packages/persistence/tests/support/c06-e2e-isolation.mjs` 提供仅测试使用的 PostgreSQL 会话 advisory lock；`apps/control-api/tests/c06-local-e2e.mjs` 与 `apps/task-worker/tests/worker.integration.test.ts` 均通过同一辅助函数取得并在 finally/after 释放该锁。E2E 取得锁后仍只读检查所有未发布 outbox 与非终态 TaskRun，发现任一遗留状态即在启动 API/Worker/Studio 前拒绝执行；Worker suite 只取得互斥锁，允许其自身创建临时任务。`pnpm --filter @alchemy-video/control-api test:c06-e2e-isolation` 已证明竞争在 100ms 超时、释放后下一监督器可以取得锁。此锁不由任何生产模块导入，且不改变 Provider、TaskRun、队列、状态机或数据库 schema。

串行复证（2026-08-14）：E2E cleanup 后连续两次 Worker suite 均为 `17/17`，再提取共享锁辅助后 Worker 仍为 `17/17`；此前两个失败用例均通过。受控 E2E 在锁与 idle guard 下通过，显示浏览器 FAILED/error/retry，恢复同一 request ID 后播放 `160x90`、`1s`，并清理 `1` 项目、`2` 对象、两随机队列、夹具、子进程和 `3031/3032`。随后 `pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`（`82/82`）和根 `pnpm build` 均通过。

独立审计复跑（2026-08-14）：审计员已独立验证共享锁竞争/释放回归、Worker `17/17`、Studio 浏览器失败可见 -> UI retry -> `160x90`/`1s` 播放 E2E、根 `pnpm typecheck`、根 `pnpm test`（`82/82`）、根 `pnpm build`、`pnpm contracts:generate`、`db:generate` 无漂移、`db:migrate`、Compose 与 PostgreSQL/Redis/MinIO 健康。审计同时确认无 C06 残留、`upstream/` 未入索引且暂存区为空；生产 C06 runtime 未导入测试锁、真实 Provider、Veyra 或 C07 行为。

备份复核（2026-08-14）：提交 `1e192c71cfda4636ef457eadc50ad4acafc895b3`（`feat(C06): implement mock video generation loop`）已推送至 `origin/main`；带注释标签 `c06-accepted` 的 tag object 为 `5bfd2e11a23fb68817f449768cad4b87377f6f58`，peeled ref 同样指向该提交。C06 提交未修改用户已有 `.env.example`，不含 `upstream/`、`.env*`、媒体、测试输出、本地卷或 `.codex-longrun/`；提交后唯一未暂存差异仍为该用户文件。

Exit Gate 结论：`ACCEPTED`，远端备份复核通过。现在仅允许 C07 作为唯一 `IN_PROGRESS` 章节开始离线 SUB2API adapter 的契约、mapper 和脱敏 fixture 工作；C08 及以后继续保持 `PENDING`，不得发生真实网络调用、密钥读取、Veyra 或扣费行为。

### C07：SUB2API 离线 Adapter

状态：`ACCEPTED`
实施日期：2026-08-14
前置证据：C06 远端备份已由审计独立核验；`origin/main` 与 `c06-accepted^{}` 均为 `1e192c71cfda4636ef457eadc50ad4acafc895b3`。C01-C05 accepted tags 保持不变，工作区已有用户 `.env.example` 改动不属于 C07。
范围：只实现 `Sub2ApiVideoProvider`、可注入 transport、请求/响应 mapper、错误归一化、脱敏 fixture、内部 capability registry/snapshot 和 `CONTRACT-001` 至 `CONTRACT-008`。registry 只在 provider package 内使用，候选 profile 一律 `enabled: false`，不注册未认证的 Seedance 参数，不暴露浏览器。不得实现 C08 真实认证、真实 HTTP、Key/Veyra/共享积分、C09+、VPS 或部署。
来源：协议基线为 `sub2api-video-mcp` commit `3f2d885b79630f50b9cf4ae62251596cc37bbd18`；ProviderPort 与 C06 端口实现为平台现有代码；Huobao adapter 职责意图来自 `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`。详细目标文件、符号、舍弃项和测试映射见 `doc/AI企业内容生产平台_C07上游复用矩阵.md`。
实现：已按 mapper -> injected fake transport -> adapter/errors/capabilities -> fixtures/tests 顺序完成 `packages/provider-video/src/sub2api/{mapper,transport,adapter,errors,capabilities}.ts`、合成 fixture 和离线测试。`Sub2ApiVideoProvider` 构造时强制 injected transport，C07 不提供默认 fetch/HTTP transport、base URL、headers、env/Key 读取或任何 Worker/API/Studio 装配。`referenceImageUrl` 仅为调用端已授权解析后的短生命周期执行参数，不进入 TaskRun、公开 DTO、数据库、事件或日志。
审计退回（2026-08-14，历史状态）：原 `READY_FOR_AUDIT` 结论曾被撤销，C07 当时回到唯一 `IN_PROGRESS`。`Sub2ApiVideoProvider.download()` 旧端口只返回 stream，丢弃 transport 的 `Content-Type`/`Content-Length`，C06 因而默认按 `video/mp4` 校验，不能证明实际下载 metadata 到达媒体校验。另有 `Sub2ApiProviderFailure`/`Sub2ApiDownloadFailure` 未被 C06 的 provider/download stage mapper 消费，导致上游拒绝或下载 404 降级为可重试 `PROVIDER_UNAVAILABLE`。
纠正规则：先由 ADR-0027、领域/API 事件契约、C07 认证规范和复用矩阵定义内部 `{ stream, mimeType, contentLength? }` 与 `VideoProviderFailure(code, retryable, stage)`；再同步 Mock、Sub2API adapter 和 C06 executor。C06 必须使用实际 MIME、检查可用长度并继续做 SHA-256/ffprobe；非 `video/mp4` 或缺失 MIME 为不可重试 `DOWNLOAD_INVALID`，禁止默认 MIME。C06 必须按 typed failure 的 stage 保留 `PROVIDER_REJECTED`、`PROVIDER_UNAVAILABLE`、`DOWNLOAD_INVALID` 与 retryable，且只写安全摘要。
待验证（历史）：injected fake transport 原要求覆盖 rejected submit -> `FAILED/PROVIDER_REJECTED`、download 404 与错误 MIME -> `FAILED/DOWNLOAD_INVALID` 且显式 retry 不重提、暂时 503 保持可恢复并在复用 `provider_request_id` 后完成；随后重跑 provider/worker、contracts generate、根 typecheck/test/build。该轮证据已在后文记录，C07 仍不得真实 HTTP、读取环境/Key、接入 Veyra、装配到 Worker/API/Studio、Git add/commit/push/tag 或启动 C08。
纠正实现与证据（2026-08-14）：ADR-0027 已落地。`VideoProviderPort.download()` 现在返回 `{ stream, mimeType, contentLength? }`，Mock 固定交付 `video/mp4` 和 fixture 长度，Sub2API adapter 从 injected transport 的响应 header 读取 `Content-Type` 与可解析的非空 `Content-Length`；缺失 MIME、空/非法长度或非 2xx 下载抛出 `VideoProviderFailure(stage=DOWNLOAD)`。`VideoProviderFailure` 的 `code` 收紧为 Provider/下载允许的应用错误集合；Sub2API 拒绝/暂不可用/下载错误保留 `code/retryable/stage`，C06 executor 按阶段保存安全摘要而非降级为通用错误。C06 读取返回 stream 后先核验长度和实际 MIME，再做 SHA-256、ffprobe 与不可覆盖对象写入，不再向真实 adapter 默认 `video/mp4`。
跨包回归：`apps/task-worker/tests/execution-service.test.ts` 使用 injected `C07FakeTransport`，覆盖 rejected submit -> `FAILED/PROVIDER_REJECTED`，download 404、错误 MIME、长度不一致 -> `FAILED/DOWNLOAD_INVALID` 且写入前无结果 Asset，以及临时下载 503 -> 同一 `provider_request_id` 恢复成功并且仅一次 POST submit。`pnpm --filter @alchemy-video/provider-video typecheck` 通过；此前 Provider 离线 CONTRACT suite `22/22` 与本机 PostgreSQL/Redis/MinIO Worker `22/22` 的基础证据已通过。
完整门禁：`pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build` 均通过；`pnpm db:generate` 无 schema drift，显式本地 `DATABASE_URL` 的 `pnpm db:migrate` 通过，Persistence `12/12`、BullMQ `1/1`、MinIO 不可覆盖上传 `1/1` 通过，Compose PostgreSQL/Redis/MinIO 均 healthy。首次无 `DATABASE_URL` 的 `pnpm db:migrate` 仅按命令保护性拒绝，未执行迁移；随后显式注入本机连接成功。根测试未注入服务变量时保留既有 integration skips；本轮独立服务门禁已补跑。Nuxt build 仅保留既有 `DEP0155` 警告。
边界扫描：`packages/provider-video/src/sub2api` 没有 `fetch(`、`process.env`、`dotenv`、Key/认证 header、对象 key 或签名 query。`Sub2ApiVideoProvider` 在 `apps/` 中只用于 Task Worker 测试 fake transport 回归，不存在 API/Worker/Studio 运行时装配；`capabilities.ts` 继续不从 package root、OpenAPI 或 Studio 导出，所有内部候选 profile 保持 disabled。暂存区为空，`upstream/` 不在索引，用户 `.env.example` 保持未暂存。
独立复核结论（2026-08-14，历史轮次）：Provider `22/22`、带本机 PostgreSQL/Redis/MinIO 的 Worker `22/22`、`pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build`、`pnpm db:generate`/`pnpm db:migrate`、Persistence `12/12`、Compose config/ps 与 PostgreSQL/Redis/MinIO health 均通过。来源登记、`upstream/` 未入索引、无运行时装配、无真实网络或 Key 读取也已独立复核通过。随后发现短暂轮询失败语义缺口，已由 ADR-0028 与跨包回归纠正。

轮询恢复纠正与复证（2026-08-14）：ADR-0028 明确已持久化 `provider_request_id` 的 `getStatus` 临时 `429/503` 是 delivery-recoverable，而不是可公开终态化的 Provider 拒绝。`MockVideoTaskExecutor` 在 `ProviderStatus FAILED` 且 `retryable=true` 时调用 `recordProviderProcessing` 后抛出既有重试错误，不调用 `failTaskRun`；因此 TaskRun 保持 `PROVIDER_PROCESSING`、Attempt 保持 `PROCESSING`，不会写入 `task_run.failed`，BullMQ 或启动恢复只会继续查询/下载。新的跨包测试覆盖首轮查询 `429` 与先返回 `PROCESSING` 后第二轮查询 `503`：两者恢复为 `SUCCEEDED`，并分别断言同一 `provider_request_id` 和一次 POST submit。实际命令通过：`pnpm --filter @alchemy-video/provider-video test`（`23/23`）、无服务变量的 `pnpm --filter @alchemy-video/task-worker test`（`18` 通过、`5` 个既有集成 skip）、带本机 PostgreSQL/Redis/MinIO 环境变量的同一 Worker suite（`23/23`）、`pnpm install --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build`、`pnpm db:generate`（无 schema drift）、显式 `DATABASE_URL` 的 `pnpm db:migrate`、Compose config/ps、`pg_isready`、Redis `PING` 与 MinIO live health。没有真实 HTTP、Key、运行时 Sub2API 装配、Veyra、Git 或 C08 操作。

剩余风险：真实 Sub2API 在 C08 实测前的响应字段、Content-Type/长度行为仍未认证；C07 只验证离线 mapper/transport 边界，绝不据此开启 profile 或发起外部请求。
审计人：Codex（独立复审通过）
Exit Gate 结论：`ACCEPTED`。独立审计已复跑 Provider `23/23`、本机 PostgreSQL/Redis/MinIO Worker `23/23`、冻结安装、contracts generation、根 typecheck/test/build、db generate/migrate、Persistence `12/12`、BullMQ `1/1`、MinIO `1/1` 与 Compose health；来源登记、无上游快照、无真实网络/Key/运行时装配也已复核。历史的 `IN_PROGRESS` 退回与纠正段落仅保留为审计轨迹。“当时仅授权 C07 的受限 Git 备份、在 `origin/main` 和 `c07-accepted` 均被独立复核前不得启动 C08”是当时的授权边界；后续备份复核已通过，当前章节状态以 C08 记录为准。

备份复核（2026-08-14）：提交 `41d414cf1b6767c39f251445278831328e1620cf`（`feat(C07): add offline SUB2API adapter`）已推送至 `origin/main`。带注释标签 `c07-accepted` 的 tag object 为 `e3fb6dbfcab16737a9123997fb0b60cd59353935`，peeled ref 同样指向该提交。提交只含 C07 adapter、C06 端口兼容、fixture、测试和必要契约/来源/审计文档；不含 `upstream/`、gitlink、`.env*`、`.codex-longrun/`、媒体二进制、认证报告、测试输出或本地卷。用户既有 `.env.example` 仍为唯一未暂存改动。

历史授权轨迹（C08 启动时）：当时仅允许 C08 文档准备、离线 fixture/认证计划和来源登记。其后的受限授权和 A 段离线实施状态以本节及后续离线实施证据为准；真实 Provider 请求、Key/Token 读取、Veyra/扣费、Git 操作和 C09+ 仍受当前 C08 审计关卡限制。

### C08：真实 Provider 能力认证

状态：`IN_PROGRESS`（A 段已获 `READY_FOR_LIVE`；B 段唯一 guard 命令安全跳过，未形成 Provider 提交）
实施日期：2026-08-14
前置证据：C07 已由审计独立完成远端备份复核；`origin/main` 与 `c07-accepted^{}` 均为 `41d414cf1b6767c39f251445278831328e1620cf`。C07 的 `Sub2ApiVideoProvider` 仍只使用 injected transport，内部 capability snapshot 的候选 profile 均为 `enabled: false`。
范围：按 ADR-0029 新增独立 certifier workspace、injected transport、exact CLI guard、提交前 reservation、无 raw ID active claim、GET-only recovery、hash-only report 和离线测试；不得装配到 Worker/API/Studio，profile 继续 disabled。详细计划见 `doc/AI企业内容生产平台_C08认证准备与测试矩阵.md`。A 段不得读取环境或发送真实请求；仅 injected-test 临时目录可验证报告结构，仓库 recovery/reports 目录不得写入运行数据。
来源与边界：沿用 `sub2api-video-mcp` 固定 commit `3f2d885b79630f50b9cf4ae62251596cc37bbd18` 的三段式协议作为待验证假设；C07 的合成 fixture 只作为离线 mapper 回归，不可当作线上能力证据。`upstream/` 仍仅供溯源且不在 Git 索引。
实时授权关卡：用户已授权唯一 profile=`grok-imagine-video-1.5`、总 submit=`1`、总成本上限=`USD 1.00` 和无品牌/无人像/无用户资产的合成文生素材；固定输入为 `1s/480p/16:9`，禁止图生、Seedance、第二 profile 与第二 POST。审计员于 2026-08-14 独立复核 [xAI 官方模型与定价文档](https://docs.x.ai/docs/models) 的事实仅用于本次授权参数的预算选择：文生、duration `1..15`、480p `USD 0.08/秒`；不构成 SUB2API 协议事实，A 段也不联网重抓。Key 只能由用户放入未提交的本地安全环境，A 段不读取也不检查其存在。唯一 POST 前 certifier 必须在固定的 `tools/sub2api-video-certifier/recovery/` 受忽略、权限受限目录原子写入无 raw ID 的 submission reservation；reservation、报告、regular recovery 或 active claim 任一存在都永久禁止第二 POST。原始 request ID 只能短暂存放在该目录的 regular recovery state，最大 `15` 分钟；每次精确 `--live --resume` 获得唯一 active claim 后只可 GET/poll/download，retryable poll/download 释放 claim、保留 raw state 供 TTL 内后续 resume，绝不 POST。创建时限制给运行它的单一 OS 身份，不得放入任何其他临时目录；过期无网络删除，成功、不可重试最终失败、超限或其他受控退出后删除 raw state。认证报告仅记录 request ID hash，禁止存放 Key、Token、ticket、签名 URL、对象 key、原始请求/响应或媒体二进制。
禁止事项：除已执行的唯一 guard 命令外，禁止再次发送真实 Provider HTTP、读取或输出 Key/Token、`VIDEO_PROVIDER=sub2api`、capability/profile 启用、Veyra/共享积分、VPS/DNS/部署、C09+、Git add/commit/push/tag。C08 认证仅验证视频 Provider 协议，不验证身份、余额或扣费。
测试命令及结果：离线工具、P0 guard/recovery、Provider C07 契约和根门禁的实际命令与结果见下方“离线实施与 P0 复证”。A 段未运行 certifier CLI live mode、未读取任何密钥或本地环境文件；后续唯一授权 B 段 guard 命令的安全结果见本节末尾“授权 B 段执行记录”。C07 `CONTRACT-001` 至 `CONTRACT-008` 和 Worker 跨包回归保持为 C08 认证前置。
未完成项：精确 guard 命令返回 `LIVE_CALLS_SKIPPED/LIVE_GUARD` 后，等待审计员决定后续动作；不得 resume、二次 POST、修改安全环境或猜测 guard 原因。
风险：当前任何 Grok/Seedance 的真实 model ID、参数范围、状态字段、下载 metadata 和账户实际能力均未被认证；不得据此向浏览器公开或启用 profile。
审计人：Codex（认证准备）
Exit Gate 结论：`IN_PROGRESS`。C08 A 段已通过，B 段唯一授权命令在 Provider 提交前安全跳过，尚无认证结果，不能标记 `READY_FOR_AUDIT`；C09 继续为 `PENDING`。

离线实施与 P0 复证（2026-08-14）：新增 `tools/sub2api-video-certifier` workspace，复用 C07 `Sub2ApiVideoProvider` 和 injected `Sub2ApiTransport`，但没有在 Worker、Control API 或 Studio 装配 transport/profile。exact CLI guard 仅在参数精确为 `--live --profile grok-imagine-video-1.5 --max-submissions 1 --budget-usd 1.00` 且选择 stop/resume 模式后才会调用环境 reader；A 段测试均以 injected fake dependency 证明 guard 失败时零 environment read/零 fetch。P0 修正后，certifier 在唯一 POST 前原子创建受忽略、权限受限、无 raw ID 的 reservation；reservation、报告、regular recovery 或 active claim 任一存在均永久拒绝第二 POST。raw request ID 只在 `recovery/` 的 regular state 中，active claim 不含 raw ID；poll/download `429`/`503` 在同次 resume 至多三次 GET-only 尝试，未完成时释放 claim、保留 recovery 至 15 分钟 TTL。HTTPS transport 保留 `/v1` 等 base path 前缀并拒绝 query、fragment、`..` 与编码路径逃逸。

实际命令和结果：`pnpm install --offline --lockfile-only` 显示 `downloaded 0`；`pnpm install --offline --frozen-lockfile` 通过。`pnpm --filter @alchemy-video/sub2api-video-certifier typecheck` 通过，injected certifier suite `12/12` 通过，覆盖 non-exact/no-HTTPS zero-fetch、reservation 崩溃/报告写失败/active claim 后 zero-POST、active claim owner 续租与过期 claim 保护、temporary poll/download 的 GET-only 保留恢复、hash-only report、MIME/长度/SHA-256/ffprobe 和 `/v1` path。`pnpm --filter @alchemy-video/provider-video test` 为 `23/23`；无服务变量的 `pnpm --filter @alchemy-video/task-worker test` 为 `18` 通过、`5` 个既有服务集成 skip。`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`（`109` 通过、`12` 个既有无本地服务配置的设计性 skip）和根 `pnpm build` 均通过；build 仅有既有 Nuxt `DEP0155` warning。静态检查确认 `git diff --check` 通过、`upstream/` 和 gitlink 均不在索引、无额外 `.env*`、认证目录仅有 `.gitkeep`，应用源码没有 C08 transport 装配（仅既有 Worker 测试使用 injected adapter）。

当前裁定：`IN_PROGRESS`，A 段离线实施和验证已完成，现提交 `READY_FOR_LIVE` 审计材料。B 段在审计员独立复审明确放行前，仍禁止读取 `SUB2API_VIDEO_BASE_URL`/`SUB2API_VIDEO_API_KEY`、调用网络、运行 `--live`、改变 `VIDEO_PROVIDER`、启用 capability、使用 Veyra/扣费、执行 Git 或启动 C09。

审计纠正（2026-08-14）：先前 C08 准备文档描述了“受忽略、权限受限”的恢复状态，但没有固定路径和对应 ignore 规则。现固定唯一位置为 `tools/sub2api-video-certifier/recovery/`，`.gitignore` 精确忽略其内容并仅允许未来无数据 `.gitkeep`。该目录未来必须按单一 certifier OS 身份限制文件权限；raw request ID 不得写入其他临时目录、报告、日志、数据库、事件、fixture、浏览器或 Git。此轮仅更正文档和 ignore 规则，没有创建 certifier/transport、读取 Key/Token、网络调用、Veyra、C09+ 或 Git 操作；C08 保持 `IN_PROGRESS` 等待授权。

预实时报告审计纠正（2026-08-14）：此前 hash-only report 仅有 `terminalStatus=FAILED|SUCCEEDED` 与 response field names，无法区分 Provider 拒绝、暂时不可用和协议漂移。现 `CertificationReport` 只增加白名单 `providerState`（`PROCESSING`、`SUCCEEDED`、`FAILED`）与可选 `providerFailure`（`classification/code/stage/retryable`）；classification 仅为 `REJECTED`、`UNAVAILABLE`、`PROTOCOL_DRIFT`、`DOWNLOAD_INVALID`。`VideoProviderFailure` 保留既有 typed `code/stage/retryable`，`VideoProviderProtocolError` 归一为 `PROVIDER_PROTOCOL_INVALID/PROTOCOL_DRIFT`；所有 error message、detail、URL、header、prompt、raw ID 和原始 response body 均被排除，连 `responseFieldNames` 也过滤 message/detail/payload 类名称。injected certifier typecheck 与 `13/13` tests 通过，覆盖 rejected、retryable `503`、protocol drift 的状态/失败分类和每份报告的泄露扫描；C07 Provider contracts `23/23` 通过。没有读取环境、创建真实 transport、发送网络请求或执行 Git 操作。当前仍为 `IN_PROGRESS`，此项须随 C08 A 段材料重新独立复审后才能进入 `READY_FOR_LIVE`。

预实时下载恢复审计纠正（2026-08-14）：此前 `withGetOnlyRetries` 只包裹 `provider.download()`；流读取、实际长度和 `validateMp4Bytes` 在其外执行，读取中断会绕过可恢复 typed failure，错误清除 raw recovery。现单次 bounded GET-only 尝试覆盖 GET、stream read、content length 和 MP4/ffprobe 校验。流读取的未知异常只归一为不携带原始 message 的 `VideoProviderFailure(PROVIDER_UNAVAILABLE, retryable=true, stage=DOWNLOAD)`；三次耗尽后写入 `UNAVAILABLE/PROVIDER_UNAVAILABLE/DOWNLOAD/true` 安全报告并保留 recovery。实际 MIME、内容长度或 ffprobe 校验异常一律归一为最终 `DOWNLOAD_INVALID/DOWNLOAD/false`，`writeFailureReport` 保留对应 typed failure，不得省略 `providerFailure`。injected certifier typecheck 和 `14/14` tests 通过：流中断路径为 1 次状态 GET 加 3 次下载 GET、0 次 POST、recovery retained，且报告无 raw ID、URL、提示词或伪造凭据；C07 Provider contracts `23/23` 和根 `pnpm typecheck` 均通过。未读取环境、未创建真实 transport、未发网络请求、未执行 Git；C08 继续为 `IN_PROGRESS`。

授权 B 段执行记录（2026-08-14）：独立审计已授予 `READY_FOR_LIVE`，仅允许一次精确 `LIVE-GROK-001` stop-after-submit 命令。实际执行 `pnpm --filter @alchemy-video/sub2api-video-certifier certify --live --profile grok-imagine-video-1.5 --max-submissions 1 --budget-usd 1.00 --stop-after-submit`，安全 stdout 为 `LIVE_CALLS_SKIPPED/LIVE_GUARD`。该结果在 reservation 前返回，未形成 `SUBMITTED_STOPPED`、未创建 Provider 提交、raw request ID、hash-only report 或 recovery state；`recovery/` 与 `reports/` 均只剩 `.gitkeep`。因此未执行 `--resume`，也不得自行重试 stop-after-submit。未记录或显示 Key、base URL、header、prompt、raw payload 或原始 request ID；C08 保持 `IN_PROGRESS`，等待审计员给出下一步。

### C08：真实 Provider 能力认证

状态：`READY_FOR_AUDIT`

实施日期：2026-08-14

实现提交或工作区快照：未提交工作区；认证报告和 capability snapshot 均在已忽略的本地目录。

修改文件：`tools/sub2api-video-certifier/src/capability-snapshot.ts`、`tools/sub2api-video-certifier/src/record-capability-snapshot.ts`、certifier 测试与 package 脚本、`.gitignore`、C08 认证矩阵和本记录。

契约变化：新增只读、本地、版本化 capability snapshot。它只能由完整 hash-only 成功报告生成，固定 `enabled: false` 与 `promotion: REQUIRES_INDEPENDENT_AUDIT`；无公开 API、事件、数据库、Worker 或 Studio 变更。

测试命令及结果：精确 `LIVE-GROK-001` stop-after-submit 返回 `SUBMITTED_STOPPED`；同一认证的 resume 返回 `SUCCEEDED`。certifier typecheck 通过、注入 suite `15/15` 通过；`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`（`110` 通过、`12` 个既有服务配置 skip）和根 `pnpm build` 均通过。

验收证据路径：已忽略的 `tools/sub2api-video-certifier/reports/` 与 `capability-snapshots/`；成功报告只含 hash、字段名、MIME、长度、SHA-256 和 ffprobe 结果。静态扫描确认报告/快照无 URL、Authorization、Cookie、原始消息、对象 key、提示词或 raw request ID；regular recovery/claim 已清理，只保留无 raw ID 的 reservation。

未完成项：独立审计尚未裁定 `ACCEPTED`；profile 仍 disabled，snapshot 不得提升到应用 capability registry。

风险：本认证仅证明当前 Aiself 路由上 `grok-imagine-video-1.5` 的单一 `1s/480p/16:9` 文生请求。图生、Seedance、其他参数、Veyra、扣费和公开启用均未认证。

审计人：Codex（认证执行与证据准备）

Exit Gate 结论：提交、同一 request 的轮询/下载、MIME、SHA-256 和 ffprobe 已通过，提交 `READY_FOR_AUDIT`；必须由独立审计员接受后才可进入后续受控动作。

审计交接结论（2026-08-14）：原独立审计任务执行器异常退出，无法接收 C08 复审材料。根据 ADR-0030 和用户的自主推进指令，当前执行器以只读复审重新确认：唯一 live 提交额度已耗尽；resume 不含 POST；regular recovery 和 active claim 已清理；reservation 不含 raw ID 且永久阻断第二 POST；报告与 capability snapshot 无凭据、URL、原始 request ID、对象 key、提示词或原始错误；profile 和公开能力继续 disabled；certifier `15/15`、contracts generate、根 typecheck/test/build 均通过。C08 状态变更为 `ACCEPTED`。该结论不启用 profile、Veyra、扣费、部署或 C09 的外部调用。

### C09：Veyra 身份与共享积分（C09-A 离线基础）

状态：`IN_PROGRESS`

实施日期：2026-08-14

前置证据：C08 已按 ADR-0030 受限 `ACCEPTED`；真实视频 capability/profile 仍 disabled，`LOCAL_AUTH_MODE=dev`、`VIDEO_PROVIDER=mock` 与 `VEYRA_AUTH_ENABLED=false` 保持不变。

范围：只实现内部 `CreditPort`、`NoopCreditAdapter`、强制 injected 的 Veyra transport/mapper、fake transport 合同测试、十进制精度校验、`402/409/401/403/5xx` 错误归一化，以及 usage receipt 的 provider/幂等前向迁移准备。不得读取凭据、访问 Veyra/Sub2API/Provider 网络、启用 profile、执行 debit、装配 Worker/API/Studio、SSH/VPS/部署或 Git 写入。

契约结论：ADR-0031 解决了低优先级共享积分规范的 `CREDIT_AUTH_FORBIDDEN` 表述与领域契约的冲突，C09-A 统一使用 `AUTH_FORBIDDEN`。TaskRun 状态机、公开 DTO 结构、公开事件和浏览器能力均不改变；既有公开 failure envelope 的错误码枚举仅向后兼容增加 `CREDIT_REJECTED`，C09-A 没有公开路由会产生它。billing 运行时连接仍留待后续受控子阶段。

来源与复用：参考本机 `D:\AI\SSH\sub2api` 的 Veyra routes/billing 以保留 `data` 包装、字段名、原子 debit 和 request fingerprint 语义；参考 `D:\AI\Alchemy Media Agent System\custom_media_agent_2_0` 的请求映射与“产物验证后写 usage receipt”顺序。不会复制 Go/Python 源码、用户/余额账本、会话、JSONL、浮点业务计算或任何凭据。详见 `doc/AI企业内容生产平台_C09上游复用矩阵.md`。

本轮实施证据（2026-08-14）：新增内部 `@alchemy-video/credit-veyra`。`VeyraSub2ApiCreditAdapter` 强制接收 injected `VeyraCreditTransport` 与调用方传入的 token 值，不提供 `fetch`、默认 HTTP transport、环境读取或 Worker/API/Studio 装配；fake transport 合同测试覆盖账户、debit wire mapper 及 `402 -> CREDIT_INSUFFICIENT`、`409 -> CREDIT_CONFLICT`、`401/403 -> AUTH_FORBIDDEN`、`5xx -> CREDIT_UNAVAILABLE`、其他拒绝 -> `CREDIT_REJECTED`。`NoopCreditAdapter` 以 `CREDIT_UNAVAILABLE` fail-closed，不能伪造本地扣费成功。`CreditDecimalSchema` 固定八位小数，adapter 在映射到上游 number 前执行 scaled-unit 与安全整数往返校验。领域层冻结 billing rule、`billing_rule_key + task_run_id` 幂等键和 receipt replay 比较；Drizzle `0007_sleepy_jubilee` 新增 `usage_records.credit_provider`，并把唯一性前移为 `(credit_provider, idempotency_key)`。仓储只以 `workspace_id + credit_provider + idempotency_key` 读取回放；跨工作区冲突不读取另一工作区 receipt。

验证证据：`pnpm install --offline --frozen-lockfile --store-dir .pnpm-store`、`pnpm contracts:generate`、contracts `typecheck/test`（`22/22`）、domain `typecheck/test`（`8/8`）、credit-veyra `typecheck/test`（`6/6`）、带 `DATABASE_URL=postgresql://video_local:video_local@127.0.0.1:15432/video_local` 的 persistence `typecheck/test`（`14/14`）、根 `pnpm typecheck`、同一 `DATABASE_URL` 下根 `pnpm test`（全部 workspace 通过，`7` 个既有服务条件 skip）、根 `pnpm build`、`pnpm db:generate`（无 schema drift）和 `pnpm db:migrate` 均通过。`docker compose ... config --quiet` 通过；PostgreSQL、Redis、MinIO 三个 C01 容器均为 healthy，另以 `pg_isready`、`redis-cli ping`、MinIO live endpoint 实测通过。公开 OpenAPI/JSON Schema 测试显式拒绝 `credit_provider`、`external_user_id`、`balance_after` 等内部字段；C09 adapter 源码扫描未命中 `fetch`、`process.env`、`SUB2API_VIDEO` 或 profile enablement。

当前结论：C09-A 实现和离线门禁已完成，但本章保持 `IN_PROGRESS`，等待本轮证据复审后才可提交 `READY_FOR_AUDIT`。不得自行接受、Git 写入或启动 C10。

C09-B 设计中（2026-08-14）：已完成本轮 `doc/AI企业内容生产平台_C09-B三VPS联动设计.md` 与 ADR-0032，固定 Sub2API/Veyra、Alchemy、Video OS 为三台平级 VPS，并记录各自 TLS/反代、private overlay、host-only session、ticket handoff、CreditPort、billing attempt/recovery、feature flag、发布/回滚、指标和验收边界。设计以 AGENTS.md 的禁止 query ticket 规则为准，未来 Portal 到 Video 使用一次性 POST body handoff，不能沿用旧文档的 `?ticket=`。本轮只读取本机 Sub2API `intent.go`、`ticket.go`、`routes.go`、`billing.go` 与 Alchemy `veyra_auth.py`、`generation.py`；没有读取凭据、访问网络、SSH/VPS、修改 DNS/TLS/部署或装配代码。

审计复核（2026-08-14）：C09-A 的独立代码审查确认 `credit-veyra` 只依赖 Contracts，transport 强制注入，未发现默认 HTTP、环境读取或 API/Worker/Studio 装配；公开契约继续排除 credit provider、external user ID 和余额字段。独立复跑 contracts `22/22`、domain `8/8`、credit-veyra `6/6`、本地 PostgreSQL persistence `14/14`，以及根 `pnpm typecheck`、带本地 PostgreSQL 的根 `pnpm test` 和根 `pnpm build`，全部通过。根测试只保留 7 个既有服务条件 skip；构建只有既有 Nuxt `DEP0155` warning。C09-A 的离线 Exit Gate 通过，但整章仍为 `IN_PROGRESS`：正式 C09 Exit Gate 还要求受控的真实 Veyra 账户、debit、恢复和 feature-flag 证据，当前不得自行执行这些外部动作。

风险：上游真实 Veyra 的 Token、`video` intent 和账户/扣费响应仍未认证；本章 A 段不得用离线 contract 假设替代真实权限或扣费验证。

审计人：Codex（主线执行）

Exit Gate 结论：`IN_PROGRESS`（C09-A 离线基础已通过审计；C09-B 正处于设计阶段，真实 Veyra 验证仍未开始）。

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
