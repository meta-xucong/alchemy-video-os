# AI 企业内容生产平台：章节审计记录

本文件是章节状态的唯一审计记录。状态变更必须附测试命令、证据路径和结论。没有证据不得标记 `ACCEPTED`。

> 当前状态只看下方“当前唯一状态账本”和第 2 节总表。其后的章节段落是按时间追加的历史审计快照；历史段落中的 `IN_PROGRESS`、`READY_FOR_AUDIT` 或 `ACCEPTED` 不会覆盖当前状态，也不构成本轮重新开启章节的授权。

## 1. 状态字典

`PENDING`：尚未开始；`IN_PROGRESS`：正在实现；`IMPLEMENTED_PENDING_AUDIT`：当前实现切片已暂停，审计/硬门尚未收口；`READY_FOR_AUDIT`：代码和测试完成，等待审计；`ACCEPTED`：Exit Gate 已满足；`BLOCKED`：存在未解决阻塞。

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
| C09 | 共享积分本地边界 | `ACCEPTED` | C08 | 2026-08-14 | 2026-08-16 | ADR-0039 后的本地 CreditPort、离线契约与 C09-C 本地运行时已独立复核；真实 Veyra/VPS 联动后移 C13-A |
| C10 | MarkItDown 企业资料链路 | `ACCEPTED` | C06 | 2026-08-16 | 2026-08-16 | 独立审计已复核事务、公开边界、流式 Runtime、隔离浏览器验收和根级回归 |
| C11 | Prompt、Script、Storyboard | `ACCEPTED` | C10 | 2026-08-16 | 2026-08-16 | 独立审计已复核本地创作版本、规划、审批、生产计划确认和零视频执行边界 |
| C11.2 | 资料理解与按段事实包 | `ACCEPTED` | C11.1 | 2026-08-30 | 2026-08-30 | 本地范围的资料知识链路、恢复/隔离/公开边界和独立审计已完成；不代表真实外部系统完成 |
| C12 | OpenMontage、QC、成片 | `ACCEPTED` | C11/C06 | 2026-08-16 | 2026-08-17 | 本地依赖调度、交接帧、QC、合成、成片版本及交接帧/用户参考素材一致性修订均已通过完整回归；外部边界继续关闭 |
| C12.1 | 语义衔接质检与自动转场修复 | `ACCEPTED` | C12 | 2026-08-17 | 2026-08-17 | 独立复核契约、迁移、Worker/Runtime、活动租约恢复、三段混合转场夹具、隔离 E2E、根回归和公开投影；不触碰 C13-A 外部边界 |
| C12.2 | OpenMontage 终检与真实成片质量门禁 | `NOT_ACTIVE_IN_THIS_SCOPE` | C12.1 | 2026-08-23 |  | 历史 `READY_FOR_AUDIT` 技术终检证据保留于下方快照；本轮不活动，语义 evaluator/transcriber 仍明确不可用 |
| C12.4/C12.5 | 连续旁白、音频编排与口播时长 | `IMPLEMENTED_PENDING_AUDIT` | C12.1/C12.7B | 2026-08-30 |  | S01/E02、E03/HB-STORYBOARD-TIMING 8–15 秒、E04/Piper pace、E05 `_full_mix`/ALCHMED8、E06 approved full narration 窗口与 cue-only、E07 uniform transition/xfade、E08 segmented/HyperFrames、E09 source-expressed transcript/subtitle/FFmpeg fallback、E10 approval/formal asset/TimelinePlan identity-window、E11/S08 measured-duration feedback 均为已独立审计的窄切片 `ACCEPTED`；混合/连续非 cut、完整 section windows、Studio/REQUIRED 字幕、中文口音、自动重规划和其它硬门仍 `BLOCKED/DEFERRED`；E12 实测仍阻断总体硬门未收口 |
| C13 | 发布前审计和部署准备 | `PENDING` | C09/C12/C12.1 |  |  |  |

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

状态：`ACCEPTED`

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

### C09-C：图生与多参考素材设计审计

状态：`IN_PROGRESS`（代码实现与本地验证进行中）

实施日期：2026-08-15

实现提交或工作区快照：未提交。本记录的原始设计审计完成后，已开始实现 contracts、Control API relay、Worker、Provider mapper、Studio 和本地回归；不读取或修改真实密钥值，不改 VPS、部署或本地验收配置。

修改文件：`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md`、`AI企业内容生产平台_C09-C真实Provider运行时接入.md`、`AI企业内容生产平台_开发决策记录.md`、`AI企业内容生产平台_正式开发总控文档.md`。

契约结论：目标设计使用现有 `ReferenceBinding` 的 `FIRST_FRAME`、`SUBJECT`、`STYLE` 角色区分一张首帧与一至七张独立参考图，禁止两种模式混合；任务快照只保存资产 ID、SHA-256、MIME、顺序和模式，不保存对象 key 或临时 URL。新增的 `ReferenceDeliveryPort` 仅为 Worker 内部端口，未来以短时 `provider-input` HTTPS relay 提供 Provider 读取，浏览器、公开 DTO、事件和数据库普通审计字段不接触 relay URL/token。平台对 R2V 不设置 4096 UTF-8 字节本地硬拒绝，上游拒绝归一为既有错误语义且不重复提交。协议允许七张参考图，当前完成端到端视觉验证的样本为两张，两项证据明确分开。

测试命令及结果：项目文档 `git diff --check` 通过；敏感文档扫描、设计必备控制项检查和 ADR/总控交叉策略检查通过。MCP 自检后独立执行 `python -m unittest -v test_server.py`，30/30 通过；`python -m py_compile server.py test_server.py` 通过；MCP `git diff --check` 通过。覆盖 R2V 取消本地字节门槛、1 至 7 张 HTTPS 引用预检、8 张拒绝、模式互斥和非 R2V 的显式限制保留。

验收证据路径：本设计文档、ADR-0034、正式开发总控 C09-C 扩展说明，以及本地 MCP 的 `README.md`、`profiles.example.json`、`server.py`、`test_server.py` 工作区差异。未记录 API key、含凭据 URL、Cookie、真实 request ID、用户素材或视频文件。

未完成项：产品实现与完整门禁正在复核；当前 3031 入口保持 Mock。未来 Video VPS relay 的 TLS、日志、secret、对象存储和网络规则仍未部署，真实 I2V/R2V 验收也尚未执行。

风险：MCP 的七图数目是协议允许值，当前仅验证两图样本，不保证七图的视觉质量；上游仍可能拒绝超长 prompt，平台只负责安全映射且不重复 submit。真实 I2V/R2V 仍须在可被 Provider 访问的 HTTPS relay 上按独立受控调用范围验收。

审计人：Codex（文档与本地 MCP 独立复核）

Exit Gate 结论：设计审计通过，可以进入离线实现；C09 仍是唯一 `IN_PROGRESS` 章节，真实 Provider、Veyra、VPS、DNS、TLS、部署与 Git 写入保持关闭。

### C09-C：图生与多参考素材实现复核

状态：`READY_FOR_AUDIT`（本地实现与审计完成；真实部署与付费验收未授权）

实施日期：2026-08-15

实现提交或工作区快照：未提交，C09 仍为唯一 `IN_PROGRESS` 章节。

修改文件：Contracts、Provider Video、Storage Client、Reference Delivery、Control API、Task Worker、Studio、C06 测试、认证工具和 ADR/契约/专项文档；未修改 `.env.local`、VPS、Compose、MinIO CORS、Sub2API、Alchemy 或 Git。

契约变化：浏览器创建生成任务只提交 `{}`。Control API 从已保存 `Shot` 和 `reference_bindings` 冻结 `TEXT`、单张 `FIRST_FRAME` 或一至七张 `REFERENCE_SET` 快照；公开 DTO/SSE 不暴露快照、Provider、对象 key、relay token 或 URL。真实图片任务需 Control API 和 Worker 共享 `REFERENCE_DELIVERY_SIGNING_KEY`，且 Worker 另需 HTTPS `REFERENCE_DELIVERY_ORIGIN`；缺任何一端均在 Provider submit 前失败。

测试命令及结果：`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build` 均通过，构建仅有既有 Nuxt `DEP0155` warning。Control API 18 通过/1 个既有 service-gated skip，新增真实 relay key 缺失时 `400 VALIDATION_FAILED` 且零 TaskRun 的回归；Task Worker 25 通过/5 个既有 service-gated skip；Studio 20/20；Provider 27/27；Reference Delivery 3/3；认证工具 15/15。`pnpm --filter @alchemy-video/control-api test:c06-e2e` 通过，覆盖双图上传确认、失败提示、显式重试、同一 ProviderAttempt 恢复、刷新、160x90/1s 播放和 390x844 布局，并完整清理测试资源。

验收证据路径：ADR-0034、`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md`、`AI企业内容生产平台_C09-C真实Provider运行时接入.md`、相关单元/契约/E2E 测试及 `.codex-longrun` 验证记录。`git diff --check` 通过；静态扫描确认 Studio/Control API/relay 源码不读取视频 key，公开日志路径将 `/provider-input` token 脱敏，产品代码无 4096 字节 prompt gate。

未完成项：Video VPS 的 HTTPS relay、对象存储访问、日志策略、密钥注入、TLS、部署和实际 I2V/R2V 认证均未执行。

风险：协议允许七张参考图而当前独立视觉证据只有两张；真实上游仍可拒绝内容或参数。历史 C08 一次 USD 1 文生授权已消耗，不能复用。

审计人：Codex（本地实现与审计）

Exit Gate 结论：本地实现 `READY_FOR_AUDIT`。C09 整章仍为 `IN_PROGRESS`，不得 Git 写入或执行真实 Provider/VPS/部署；下一阶段是独立 relay 部署审计和新的 profile、次数、费用上限、素材范围授权。

### C09-C：Video VPS 私有验证部署准备复核

状态：`READY_FOR_AUDIT`（部署包已验证；未执行外部部署）

实施日期：2026-08-15

实现提交或工作区快照：未提交，C09 仍是唯一 `IN_PROGRESS` 章节。

修改文件：`.dockerignore`、`.gitignore`、`.env.example`、`packages/storage-client`、`apps/control-api/src/index.ts`、`infrastructure/deploy/`、ADR-0035、C09-C 运行时/设计文档和本记录。

契约变化：内部对象读写继续使用 `S3_ENDPOINT`，只有浏览器预签名上传/下载 URL 可使用独立 `S3_PUBLIC_ENDPOINT`；`S3_BROWSER_ORIGINS` 受控传入对象存储 CORS。没有公开 API、事件、数据库或 TaskRun 状态变化。部署包中的 Provider base URL/key 只出现于 Worker 环境注入，Control API/Studio 均无该值。当前固定开发身份以 Nginx Basic Auth 保护浏览器面；`/provider-input/<opaque-token>` 仅为 Provider 的 GET/HEAD 临时读取入口，关闭 access log 且不继承该认证。

测试命令及结果：根 `pnpm typecheck`、根 `pnpm test` 均通过（仅既有 service-gated skips）；storage-client 4 通过、1 个既有 MinIO service-gated skip；storage-client 和 Control API 类型检查通过；`docker compose --env-file infrastructure/deploy/.env.video.example -f infrastructure/deploy/docker-compose.video.yml --profile edge config --quiet` 通过；`docker build --file infrastructure/deploy/Dockerfile --tag alchemy-video-deploy-verify:local .` 成功，镜像内 Control API、Worker 和 Studio runtime entry 均存在；Nginx `video.bootstrap.conf` 在 `nginx:1.27-alpine` 中通过 `nginx -t`；`git diff --check` 通过。部署样例扫描只命中显式 `REPLACE_...` 占位符，没有真实 Key、URL、token 或密码。

验收证据路径：`infrastructure/deploy/README.md`、`docker-compose.video.yml`、Nginx bootstrap/production 配置、ADR-0035、storage-client 单测和 Docker 本地镜像检查。

未完成项：尚无标识为 Video OS 的新 VPS，`video.aiself.vip` 与 `assets.video.aiself.vip` 均没有 DNS A/AAAA 记录；因此没有执行 SSH、DNS、ACME、Compose、Provider 或实际图生调用。Nginx 生产语法必须在该 VPS 的 ACME 证书和私有 htpasswd 文件存在后复核。

风险：现有应用尚未实现 C09-B Veyra identity/session；部署包只适用于临时的单人 Basic Auth 验证，不能作为公开多用户上线。历史 C08 一次调用授权已消耗；将 `VIDEO_PROVIDER` 改为 `sub2api` 前仍需新的精确 profile、调用次数、费用上限和素材范围记录。

审计人：Codex（部署准备与本地静态/镜像复核）

Exit Gate 结论：部署准备 `READY_FOR_AUDIT`。外部部署与真实 Provider 均保持未执行，等待明确的新 Video VPS 与有界真实调用范围。

### C09-C：默认参考素材与创作编译修正复核

状态：`READY_FOR_AUDIT`（本地修正、完整回归和浏览器验收完成；不改变 C09 整章状态）

实施日期：2026-08-16

实现提交或工作区快照：未提交。C09 仍为唯一 `IN_PROGRESS` 章节；本轮未执行 Git 写入。

修改文件：`packages/provider-video/src/prompt-compiler.ts`、`runtime-profile.ts`、Control API generation route、Studio 项目页与参考素材组件、Studio/API/Provider 回归测试、ADR-0036、C09-C 设计与运行时文档和本记录。未修改 `.env.local`、VPS、Compose、MinIO CORS、Sub2API、Alchemy 或真实 Provider 配置。

契约变化：没有新增公开 HTTP DTO、事件、数据库表或 TaskRun 状态。确认上传图片后，Studio 在当前 Shot 存在时立即持久化 `REFERENCE_SET` bindings；旧项目中的未绑定 READY 图片只在页面中默认选中，下一次保存或生成才落为绑定事实。Control API 在创建真实 TaskRun 前将已有创作描述和偏好确定性编译为不可变输入快照，解析 1 至 15 秒及 480p/720p；默认使用 5 秒、720p、16:9，且不设 4096 字节本地拒绝。Mock profile 继续固定使用本地测试参数。

测试命令及结果：Provider Video 31/31、Control API 20 通过/1 个既有 service-gated skip、Studio 22/22 均通过；根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build` 均通过，构建仅有既有 Nuxt `DEP0155` warning。`pnpm --filter @alchemy-video/control-api test:c06-e2e` 在隔离端口与真实 `localhost:3031` 浏览器来源通过，覆盖两张图片上传确认后默认勾选、持久化、失败状态、显式重试、同一 ProviderAttempt 恢复、160x90/1s 视频预览、项目隔离、390x844 布局，并清理 2 项目、3 对象、隔离队列、夹具和子服务。验收时短暂停止本工作区的 Studio 和启动检查 Worker，避免既有精确 CORS 白名单及全局 Outbox Relay 干扰；完成后已恢复。

验收证据路径：ADR-0036、`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md` 第 11 节、`AI企业内容生产平台_C09-C真实Provider运行时接入.md`、Provider/API/Studio tests 及 `.codex-longrun` 隔离验收日志。浏览器复核 `http://localhost:3031/projects/prj_01M022N889M46M37YD8HSP9HBZ` 显示“都市情感小说”的两张已上传图片均勾选“作为参考素材”，并显示“本次会使用 2 张参考图”。同源 `/api/v1/health` 为 HTTP 200。

未完成项：本轮没有替用户对真实 Provider 发起新 POST。现有失败 TaskRun 保持不可变；用户应在第三步点击“调整后生成新版本”后才会以更新后的图片绑定、15 秒/480p 解析和编译快照提交新运行。

风险：真实上游仍可能因内容或自身参数策略返回 `PROVIDER_REJECTED`；页面只展示归一化建议，不泄露 Provider 细节。七图是已允许的契约上限，本轮真实浏览器链路验证仍为两图；VPS relay、Veyra、计费、DNS、TLS 和部署不在本轮范围。

审计人：Codex（本地修正与独立复核）

Exit Gate 结论：本轮修正 `READY_FOR_AUDIT`。可以交由用户验收本地界面；C09 整章仍为 `IN_PROGRESS`，不得提交、推送或扩大到 Veyra/VPS/部署。

### C09-C：可调视频规格与真实快照复核

状态：`READY_FOR_AUDIT`（本地实现、回归、浏览器验收和文档审计完成；不改变 C09 整章状态）

实施日期：2026-08-16

实现提交或工作区快照：未提交。C09 仍为唯一 `IN_PROGRESS` 章节；本轮未执行 Git 写入、VPS 操作或真实 Provider POST。

修改文件：`packages/contracts/src/resources.ts`、`packages/provider-video/src/prompt-compiler.ts`、`runtime-profile.ts`、Control API 生成路径、Studio 第三步规格控件及样式、Provider/Contracts/Control API/Studio 回归测试，以及 ADR-0037、C09-C/Studio/项目制前端设计与本记录。未修改 `.env.local`、Provider 密钥、VPS、Compose、MinIO CORS、Sub2API 或 Alchemy。

契约变化：Shot 的既有 `generation_settings` 在含 `video_settings` 时受公开命令契约校验：`duration_seconds` 必须为 `1..15` 的整数，`resolution` 只能是 `480p|720p`，`ratio` 固定为 `16:9`。Studio 第三步以时长下拉菜单、清晰度单选和只读画幅保存这些值；创作描述中的数字不再隐式改变模型参数。真实 profile 只从该受控设置冻结 TaskRun 快照，Mock 保持固定 `1 秒 / 160x90` 测试夹具。没有新增生成命令字段、事件、状态、数据库表或浏览器可见 Provider 数据。

测试命令及结果：`pnpm contracts:generate`、根 `pnpm typecheck`、根 `pnpm test`、根 `pnpm build` 均通过；构建只有既有 Nuxt `DEP0155` warning，根测试仅保留既有 service-gated skips。Contracts 22/22、Provider 31/31、Studio 22/22 通过。`pnpm --filter @alchemy-video/control-api test:c06-e2e` 通过：真实浏览器选择 `8 秒 / 480p` 后，数据库断言该 Shot 保存 `8 / 480p / 16:9`，失败 Mock 任务仍确定性冻结 `1 秒`；失败提示、显式重试、同一 ProviderAttempt 恢复、双参考图、视频播放、项目隔离、390x844 布局和测试资源清理均通过。Control API 的真实 profile 路由单测另外断言同一受控设置冻结到 TaskRun 为 `15 / 480p / 16:9`，而非从描述解析。

验收证据路径：ADR-0037、`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md` 第 11-12 节、`AI企业内容生产平台_C09-C真实Provider运行时接入.md`、`c06-local-e2e.mjs`、`c06-studio-ui-e2e.py` 和对应 Contracts/Provider/API/Studio 单测。浏览器只读复核 `http://localhost:3031/projects/prj_01M022N889M46M37YD8HSP9HBZ`：页面显示中文“视频规格”，时长为 `SELECT` 且包含 1 至 15，项目已有默认值为 `5 秒 / 720p / 16:9`；同源 `/api/v1/health` 为 HTTP 200。

未完成项：没有替用户重试既有失败 TaskRun，也没有提交新的真实视频。下一次用户在第三步选择规格并点击“调整后生成新版本”时，才会使用新保存的规格发起新的真实运行。

风险：历史真实任务的上游终态仍仅返回泛化失败，不能归因于参考图、内容或某一规格组合；其不可变快照不会被本修正改写。`1..15` 与 `480p|720p` 是当前受控协议范围，不表示每个组合均已完成同等真实质量验收。Veyra、计费、VPS、DNS、TLS 和部署仍不在本轮范围。

审计人：Codex（本地实现与独立复核）

Exit Gate 结论：本项修正 `READY_FOR_AUDIT`，可交由用户在本地 Studio 验收。C09 整章仍为 `IN_PROGRESS`，不得 Git 提交、推送或扩大到外部部署。

### C09-C：当前项目真实运行与版本一致性复核

状态：`READY_FOR_AUDIT`（有界真实运行完成；不改变 C09 整章状态）

实施日期：2026-08-16

实现提交或工作区快照：未提交。本轮仅重启本机受控运行器中已过期的 Control API 进程；未改 `.env.local`、VPS、Provider、Veyra、Compose、MinIO CORS 或 Git。

诊断与结果：用户项目的两张图片均已以 `REFERENCE_SET` 绑定，页面显示 `5 秒 / 480p / 16:9`。第一次受用户授权的真实新版本请求获得 Provider request ID 后异步失败；只读审计发现其不可变快照为 `15 秒 / 480p / 16:9`，而不是页面值。根因是本机 `3133` Control API 在参数修正前启动，Node/tsx 不热更新，旧进程仍从创作描述提取数字。重启该进程并通过 health 后，以同一页面保存输入创建一次有效验证：TaskRun 快照为 `5 秒 / 480p / 16:9`，Provider request ID 已持久化，随后成功归档生成视频。公开结果资产为 `VIDEO / GENERATED / READY`，约 1.39 MB；受控预览 GET 返回 `200`、`video/mp4` 和非空内容。

验证范围：浏览器确认两张参考图勾选、规格可见且已保存；Control API 公共详情确认成功 TaskRun 和结果资产；受控的 workspace 范围只读审计确认前一条失败任务与后一条成功任务的快照、ProviderAttempt 状态和 request-ID 持久化语义。未输出密钥、relay URL、Provider request ID、签名下载地址、原始上游响应、用户素材或视频二进制；没有为诊断自动重试任何已有任务。

未完成项：本次成功证明当前项目的两图、`5 秒 / 480p / 16:9` 本机闭环，不替代其他规格、内容、七图质量、Veyra、计费、VPS、DNS、TLS 或部署验收。常驻 API/Worker/Studio 源码变更后仍须按受控运行器规则重启并复核 health。

审计人：Codex（受用户授权的单项目真实运行与脱敏复核）

Exit Gate 结论：当前项目的真实生成链路可交付本地验收；C09 整章仍为 `IN_PROGRESS`，不执行提交、推送或外部部署。

### 阶段性收尾：C09-C 单镜头真实运行与长叙事范围确认

状态：`READY_FOR_AUDIT`（阶段记录；不改变 C09 整章 `IN_PROGRESS`）

实施日期：2026-08-16

实现提交或工作区快照：未提交。保留当前用户工作区的未提交代码与文档差异；本记录未执行 Git、VPS、DNS、TLS、Veyra 或共享积分操作。

当前完成范围：C01 至 C08 在本记录中已 `ACCEPTED`。C09 是唯一 `IN_PROGRESS` 章节；C09-C 已完成单项目中文 Studio、项目隔离、上传确认、默认参考素材绑定、一至七张参考素材契约路径、可调规格、单 Shot 真实 Provider 本机闭环、失败/重试、Worker 恢复和项目内成片版本播放的本地验收/审计证据。最近一次用户授权的“都市情感小说”双参考图真实运行已生成归档视频，但它只证明这一条本地有界链路可用。

未完成范围：自动读懂长小说、剧本、自动分镜、多段依赖调度、交接帧、连续性 QC、字幕/音频、镜头拼接和最终完整成片尚未实现。当前页面的一条描述仍只会创建一个 Shot/TaskRun；不能称为自动长片制作。

设计记录：长叙事设计已拆为三个独立文档：`AI企业内容生产平台_长叙事自动编排与连续成片设计.md` 仅记录范围、依赖和统一决策；`AI企业内容生产平台_长叙事后端领域与编排开发设计.md` 记录 revision、ProductionRun、TaskRun、交接帧、事件、Worker、迁移和后端验收；`AI企业内容生产平台_长叙事前端项目工作台交互设计.md` 记录项目页面、用户流程、中文状态、成果区和浏览器验收。ADR-0038 作为三份设计的决策锚点。方案要求先生成用户可审阅的故事计划，再在明确确认后按依赖图逐段生成，并以 C12 合成不可覆盖成片；不允许按字数直接切段后自动付费提交。当前 profile 的首帧和一至七张参考素材互斥且没有已认证尾帧，故视觉连续性只能作为受控交接/转场策略，不能承诺帧级无缝。

后续动作：按固定依赖先完成 C10 的受控资料 Artifact，再在 C11 实现 revision、PlanningModelPort、Workflow Worker 和 Storyboard，随后由 C12 实现交接帧、QC、合成和 VideoVersion。任何真实多段调用仍需单独记录 profile、次数、额度和素材范围。

审计人：Codex（阶段性范围复核）

Exit Gate 结论：当前单 Shot 本地真实链路可以继续由用户验收；C09 整章不变更为 `ACCEPTED`，C10/C11/C12 不能被视为已开发或已通过。

### C09 范围重基线：真实 Veyra/VPS 联动后移至 C13-A

状态：`READY_FOR_AUDIT`（C09 仅保留本地边界；C13-A 仍为 `PENDING`）

实施日期：2026-08-16

决定与范围：用户明确要求在所有本地开发完成前，不执行真实 Veyra、VPS 部署或同 Sub2API/Alchemy 的运行时联动。ADR-0039 因此将 C09 的真实账户、ticket、debit、feature flag、三 VPS 网络/会话/发布回滚验证全部移入 C13-A。C09 现在只包括已经完成并有证据的本地 CreditPort/Noop adapter/注入式 transport/精确金额/receipt 幂等、C09-B 架构设计归档和 C09-C 单 Shot 本地运行时边界。

不变项：Sub2API 仍是未来余额和扣费唯一权威；视频成功后的扣费时序、`402/409` 语义、同 key 回放与禁止重复 submit 均未删除，只是不能在本地阶段启用或以假实现替代。C10/C11/C12 的真实多段视频调用仍独立受有界授权约束，不因本次范围重排而自动获得权限。

审计要求：C09 章节接受前，审计员仍须复核既有本地测试、公开边界、C09-C 本地实际运行证据以及无真实 Veyra/VPS 操作的事实。只有 C09 变为 `ACCEPTED` 后，C10 才能成为唯一 `IN_PROGRESS` 章节。

审计人：Codex（范围重基线记录）

Exit Gate 结论：等待缩小范围的独立审计；未执行真实 Veyra、扣费、VPS、SSH、DNS、TLS、部署或 Git。

### C09：共享积分本地边界最终审计

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交。按章节治理，C09 接受后才允许后续形成受限 Git 提交；本次未执行 Git 写入。

范围与结论：依据 ADR-0039，C09 的 Exit Gate 只包含本地 `CreditPort`、`NoopCreditAdapter`、注入式 transport/mapper、十进制金额与 usage receipt 幂等准备，以及 C09-C 的受控本地视频运行时。真实 Veyra 登录票据、账户查询、debit、feature flag、三台 VPS、SSH、DNS、TLS、部署和跨系统会话已明确后移至 C13-A，不再阻塞本地内容生产链。

审计修正：C06 浏览器验收曾因 `3031` 上已有 IPv6 常驻 Studio 而错误命中真实本机入口，造成 8 秒真实 profile 快照被误判为 Mock 结果。已在 `c06-local-e2e.mjs` 增加双栈/通配端口占用拒绝、独立 build version 代理校验和直连 Mock API 快照探针。受控停止并恢复本机 Studio 后，隔离 E2E 确认独立 API/Studio、双图上传、失败/显式重试、项目隔离、移动端、视频解码和资源清理；Mock 快照及结果固定为 `1 秒 / 160x90`，可见 Shot 设置仍保持 `8 秒 / 480p / 16:9`。

测试命令及结果：`pnpm contracts:generate` 通过；`pnpm --filter @alchemy-video/credit-veyra test` 为 6/6；根 `pnpm test` 通过（既有 service-gated skip 保留）；`pnpm --filter @alchemy-video/control-api test` 为 20 通过、1 个既有 skip；根 `pnpm typecheck` 通过；根 `pnpm build` 通过，仅有既有 Nuxt `DEP0155` warning；`pnpm --filter @alchemy-video/control-api test:c06-e2e` 通过，输出为失败/重试 UI、`160x90`、`1s`，并清理 2 个项目、3 个对象、两个隔离队列、夹具与子服务。恢复后 `http://localhost:3031/api/v1/health` 返回 200。

验收证据路径：ADR-0039、`AI企业内容生产平台_C09-B三VPS联动设计.md`、`AI企业内容生产平台_C09-C图生与多参考素材适配设计.md`、`AI企业内容生产平台_C09-C真实Provider运行时接入.md`、CreditPort 回归、C06 浏览器 E2E 及本审计记录。

未完成项：C13-A 尚未开始，且必须等 C10/C11/C12 接受并取得新的、明确有界授权后才可接触真实 Veyra 或 VPS。当前用户可继续通过本机 `3031` Studio 验收已存在的受控真实视频链路；这不构成 Veyra 或部署验收。

风险：七张参考图为协议上限，质量覆盖仍不能由两图 E2E 代替；真实 Provider 的内容/参数拒绝仍由统一错误语义处理。C09 不保留本地余额账本，也不以 `NoopCreditAdapter` 伪造扣费成功。

审计人：Codex

Exit Gate 结论：C09 本地范围的架构、测试、公开边界和审计证据完整，标记为 `ACCEPTED`。C10 成为唯一 `IN_PROGRESS` 章节；C13-A 保持 `PENDING`。

### C10：MarkItDown 企业资料链路启动记录

状态：`ACCEPTED`

实施日期：2026-08-16

范围：只实现已授权资料 Asset 的受控转换、来源追溯、错误恢复和本地 fixture 验收。C10 不建立知识库、Embedding、品牌画像、自由 Agent 或任意 URL 转换，也不触及真实 Veyra、VPS、部署或视频 Provider。

设计准入：ADR-0040 与 `AI企业内容生产平台_C10企业资料转换与Artifact设计.md` 已审计通过。固定 MarkItDown 来源为 `fd239d5d2be43d9b68329730206b9312c7d5a388`（`0.1.7`）；在受忽略的 `.codex-longrun/c10-document-runtime-venv` 中，PDF/DOCX/PPTX/XLSX fixture 的 `convert_stream` 均输出非空 Markdown。该环境只作为本地测试依赖，不包含生产密钥、VPS、Veyra 或视频配置。

审计人：Codex

### C10：DocumentConversion 持久化更正独立复核

状态：`IN_PROGRESS`（仅持久化门禁通过，章节尚未完成）

实施日期：2026-08-16

范围与审计：在实现 C10 运行时、Worker、Control API 或 Studio 前，审计发现转换状态和 outbox 事务性、并发领取以及陈旧/重复完成的风险，故停止受控任务完成更正。随后独立执行 `pnpm --filter @alchemy-video/persistence typecheck` 和连接本地 PostgreSQL 的 `document-conversion-repository.integration.test.ts`；二者均通过。回归覆盖并发 `QUEUED -> RUNNING`、失败后重试、陈旧完成不产生产物、重复完成不覆盖结果，以及故意 outbox 主键冲突后事务回滚并保持 `RUNNING`。

边界：本复核不构成 C10 Exit Gate，也不授权 C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。C10 后续只能继续本地资料转换、来源追溯、Worker/Control API/Studio 的受控集成与相应测试。

审计人：Codex

### C10：Document Runtime 目标边界审计暂停

状态：`IN_PROGRESS`（安全更正待实现，章节尚未完成）

实施日期：2026-08-16

审计发现：新建的 Document Worker 将 `DOCUMENT_RUNTIME_URL` 原样传入 HTTP Client。虽然示例默认值是 `127.0.0.1`，代码尚未拒绝远程主机、URL 凭据、query 或 fragment，因而不能证明资料字节与 Runtime Token 不会离开本机。该问题在启动 Worker、执行任何转换或调用外部服务之前发现。

最小纠正：在 Client 构造和 Worker 启动路径解析 URL，只接受本地 loopback `http` endpoint，并拒绝凭据、query、fragment 及非 loopback host；补充允许和拒绝目标的单测。更正经独立审计后才可恢复 C10 集成。

边界：本暂停不改变 C10 仍为唯一 `IN_PROGRESS` 章节，也不授权 C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

审计人：Codex

### C10：Document Runtime 目标边界独立复核

状态：`IN_PROGRESS`（安全门禁通过，章节尚未完成）

实施日期：2026-08-16

复核结果：Runtime Client 现仅接受根路径的 `http://127.0.0.1:<port>` 或 IPv6 loopback endpoint；远程 host、`localhost`、私网 host、HTTPS、URL 凭据、query、fragment 和非根路径均在构造 Client 前拒绝。Root 独立执行 `pnpm --filter @alchemy-video/document-worker typecheck` 与 `pnpm --filter @alchemy-video/document-worker test`，二者通过；三项测试确认不安全目标在 `fetch` 前失败且内部路径固定。该复核没有启动 Worker、没有转换任何资料，也没有发出网络请求。

边界：此结论只解除 C10 Runtime URL 的本地安全暂停。C10 仍是唯一 `IN_PROGRESS` 章节；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入仍未授权。

审计人：Codex

### C10：Control API 类型收窄独立复核

状态：`IN_PROGRESS`（局部类型门禁通过，章节尚未完成）

实施日期：2026-08-16

审计发现与纠正：受控 C10 任务在 Control API 类型检查失败后已停止。原因是两个资料转换命令路由在分支处理后，TypeScript 无法证明结果保留成功联合的 `value` 和 `status`。修正只把这两个路由改为先显式缩窄至 `NEW|REPLAY`，再序列化成功结果；错误码和运行时流程不变。

独立验证：Root 执行 `pnpm --filter @alchemy-video/control-api typecheck`，通过。此验证没有启动 Document Worker、没有转换资料、没有调用真实 Provider/Veyra/VPS/部署，也没有 Git 写入。

边界：本结论只解除该局部类型检查暂停。C10 仍是唯一 `IN_PROGRESS` 章节；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入仍未授权。

审计人：Codex

### C10：Document Runtime 测试入口独立复核

状态：`IN_PROGRESS`（测试入口门禁通过，章节尚未完成）

实施日期：2026-08-16

审计发现与纠正：受控 C10 任务首次从仓库根目录执行 Runtime unittest，因 Python 无法导入同目录的 `runtime.py` 而在断言执行前失败。任务已暂停；该问题限于测试工作目录，没有执行资料转换或变更产品代码。按服务目录运行同一套测试即可使用受控的相邻模块导入路径。

独立验证：Root 从 `services/document-runtime` 运行 `..\\..\\.codex-longrun\\c10-document-runtime-venv\\Scripts\\python.exe -m unittest discover -s tests`，3/3 通过。

边界：此结论只解除 Runtime 测试入口暂停。C10 仍是唯一 `IN_PROGRESS` 章节；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入仍未授权。

审计人：Codex

### C10：PostgreSQL 测试串行化独立复核

状态：`IN_PROGRESS`（验证执行门禁通过，章节尚未完成）

实施日期：2026-08-16

审计发现与纠正：受控测试阶段同时运行多个 PostgreSQL 持久化套件，因共享测试工作区清理出现 `40P01` deadlock；另有 Windows 不支持的 `rg` glob 路径返回非零。任务已停止。二者均为测试执行问题，不能作为 C10 通过证据，也没有显示 DocumentConversion 领域逻辑错误。

独立验证：Root 单独设置本地 `DATABASE_URL` 后串行运行 `pnpm --filter @alchemy-video/persistence exec tsx --test tests/document-conversion-repository.integration.test.ts`，1/1 通过。后续 C10 数据库测试保持串行，搜索使用显式目录。

边界：本结论只解除上述测试执行暂停。C10 仍是唯一 `IN_PROGRESS` 章节；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入仍未授权。

审计人：Codex

### C10：资料转换公开命令独立复核

状态：`IN_PROGRESS`（公开路由门禁通过，章节尚未完成）

实施日期：2026-08-16

审计发现与纠正：新增资料转换路由回归先暴露了错误读取路径参数及失败转换公开 `retryable` 投影过宽的问题；初次命令因此返回 `400`。修正后创建命令仅使用 `source_asset_id`，重试命令只在 `FAILED` 且可重试时入队，公开 DTO 不泄漏对象 key、来源 SHA、Runtime 地址或 token。

独立验证：Root 运行 `pnpm --filter @alchemy-video/control-api exec tsx --test tests/c10-document-routes.test.ts`，2/2 通过；随后运行 `pnpm --filter @alchemy-video/control-api test`，22 通过、1 个既有服务门控跳过。Control API typecheck 通过。

边界：此结论只解除 C10 公开命令回归暂停。C10 仍是唯一 `IN_PROGRESS` 章节，且仍缺真实资料夹具与端到端验收；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入仍未授权。

审计人：Codex

### C10：Document Runtime 解释器碰撞独立复核

状态：`IN_PROGRESS`（测试入口已纠正，章节尚未完成）

实施日期：2026-08-16

审计发现与纠正：受控 C10 运行器以未受约束的测试入口调用 Runtime，Python 因此加载了另一工作目录下同名的 `runtime` 包，而不是 C10 的 `services/document-runtime/runtime.py`。运行器已停止；这不是资料转换实现或外部链路的失败。后续 Runtime 测试固定从服务目录使用 C10 专用虚拟环境的 `unittest`，禁止裸 `pytest` 与默认解释器。

独立验证：Root 从 `services/document-runtime` 运行 `..\\..\\.codex-longrun\\c10-document-runtime-venv\\Scripts\\python.exe -m unittest discover -s tests`，3/3 通过。

边界：此结论仅解除 Runtime 测试入口暂停。C10 仍为唯一 `IN_PROGRESS`，尚缺真实资料夹具和本地端到端验收；C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入继续禁止。

审计人：Codex

### C10：MarkItDown 企业资料链路完成待独立审计

状态：`READY_FOR_AUDIT`

实施日期：2026-08-16

实现提交或工作区快照：未提交工作区；本章及既有 C09 用户改动均保持原状，未执行 Git 写入。

修改文件：C10 的 Contracts/Domain/Persistence DocumentConversion 模块、`apps/document-worker/`、Document Runtime、Control API 文档命令与安全序列化、Studio 项目资料面板、受控浏览器测试和本地验证记录。

契约变化：新增独立 `DocumentConversion`、公开资料转换命令和安全 DTO/SSE 投影；转换仅使用受控对象流与 loopback Runtime，派生 Markdown Asset 追溯到冻结的源 Asset。

测试命令及结果：Contracts 23/23、Domain 9/9、Document Worker 8/8、Runtime 5/5（PDF/DOCX/PPTX/XLSX stream fixtures）、Control API 22/22 加 1 个既有服务门控跳过、Studio 24/24；串行 PostgreSQL 转换回归 1/1；`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过；`pnpm --filter @alchemy-video/control-api test:c10-e2e` 在本地隔离栈通过。

验收证据路径：`.codex-longrun/progress.md`、`.codex-longrun/test-log.md`、`.codex-longrun/blockers.md` 及 C10 测试文件；浏览器 E2E 使用一次性数据库、队列、端口、对象和 fixture，并在结束时清理。

未完成项：仅独立章节审计结论；C11/C12 功能尚未开始。

风险：根级 `pnpm test` 中已有依赖本地服务的测试保持跳过；C10 的 PostgreSQL 和浏览器验证已在显式本地依赖下通过。Nuxt 构建保留既有 Node DEP0155 警告。

审计人：Codex

Exit Gate 结论：C10 实现与测试证据齐备，进入 `READY_FOR_AUDIT`；不得据此启动 C11、C12、C13-A、真实 Provider、Veyra、VPS、部署、付费调用或 Git 写入。

### C10：独立审计暂停，Runtime 请求体边界

状态：`IN_PROGRESS`

实施日期：2026-08-16

审计发现：`services/document-runtime/main.py` 在应用 25 MiB 限制前调用 `await request.body()`，会先聚合任意大小的请求体。此行为不满足 C10 的受控输入流和有界内存契约，故先前 `READY_FOR_AUDIT` 不能作为 Exit Gate 证据。

最小纠正：改为逐块读取 `Request.stream()`，超过上限立即拒绝；保留成功路径的 SHA-256 与 MIME/文件名校验，并新增直接验证超限 HTTP 请求的回归。修正后重新执行 Runtime、Worker、浏览器 E2E 和根级门禁。

边界：受控 supervisor 当前未运行并保持停止。本暂停不授权 C11、C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

审计人：Codex

### C10：Runtime 请求体边界更正复核

状态：`READY_FOR_AUDIT`

实施日期：2026-08-16

更正与证据：Runtime 已改为逐块消费 `Request.stream()`；超出 25 MiB 后立刻返回 `413 DOCUMENT_UNSUPPORTED`，不再调用 `request.body()`。Runtime 6/6 的直接处理器回归验证超限第二块触发后不读取后续块；SHA-256、MIME、文件名和 stream-only MarkItDown 校验仍保留。

重新验证：Document Worker 8/8、串行 PostgreSQL 持久化 1/1、Studio 24/24 与 typecheck、隔离 C10 浏览器 E2E、根级 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。

边界：此更正只恢复 C10 的独立审计资格。C11/C12 仍为 `PENDING`；C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入继续禁止。

审计人：Codex

### C10：MarkItDown 企业资料链路最终独立审计

状态：`ACCEPTED`

实施日期：2026-08-16

独立审计：逐项复核 C10 的 DocumentConversion 状态转移与 outbox 事务、workspace/project 约束、冻结源 Asset 与不可替换 Markdown Asset、Runtime 的 loopback-only Worker 目标和 `Request.stream()` 上限、公开 DTO/SSE 脱敏、浏览器下载附件响应及隔离资源清理。审计期间发现并纠正了 Runtime 先聚合请求体的缺口；修正后完成独立 Runtime 6/6、Worker 8/8、PostgreSQL 1/1、Studio 24/24、隔离浏览器 E2E 及根级 typecheck/test/build 重跑。

未完成项：C10 无。C11 现为唯一 `IN_PROGRESS` 章节；C12、C13-A 和所有外部边界仍未开始。

风险：根级套件的既有本地基础设施门控测试仍按设计跳过；C10 的数据库和浏览器闭环已通过显式本地依赖验证。Nuxt 的 DEP0155 为既有构建警告。

审计人：Codex

Exit Gate 结论：C10 满足总控文档第 15 章的格式 fixture、stream-only、来源追溯、可重试且不污染源资产要求，正式标记 `ACCEPTED`。仅授权进入 C11 本地开发；不授权 C12、C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

### C11：Prompt、Script、Storyboard 启动与 Exit Gate 记录

状态：`ACCEPTED`

实施日期：2026-08-16

范围：只实现 C11 已批准的本地长叙事创作版本、确定性拆分规划、用户审批和生产计划确认。不得提交视频 Provider、扣费、部署或修改 C12 媒体处理行为。

实现工作区快照：未提交；章节验收期间未执行 `git add`、提交或推送。

修改范围：`packages/contracts` 的 C11 DTO、错误和事件；`packages/domain` 的 revision/ProductionRun 状态机；`packages/persistence` 的 C11 schema、迁移、workspace-scoped repository 和集成测试；`packages/creative-planning` 的确定性 planner/compiler；`apps/workflow-worker` 的 durable planning relay/consumer；Control API 公开 C11 命令与安全投影；Studio 中文故事计划/审阅/确认界面与 C11 浏览器验收脚本。

契约结论：`Project -> CreativeBriefRevision -> ScriptRevision -> StoryboardRevision -> ProductionRun` 已形成 C11 的持久化、可审阅链路。ProductionRun `CONFIRMED` 明确只保存计划，不创建 `Shot`、`TaskRun`、Provider attempt、扣费或媒体处理工作；这些执行能力只属于后续 C12。

测试及证据：contracts 26/26；domain 12/12；creative-planning 3/3；Workflow Worker 4/4；Control API 24 passed、1 个既有服务条件 skip；Studio 27/27、typecheck/build；C11 disposable PostgreSQL integration 1/1；隔离 `test:c11-e2e` 覆盖新建项目、45 秒中文故事、三段计划、审批、制作计划确认、刷新、390x844 及零 TaskRun；根 `pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。证据在 `.codex-longrun/test-log.md`、`.codex-longrun/progress.md` 和 C11 专项测试文件中；临时数据库、队列、端口、进程和构建目录均已清理。

审计纠正：C11 Worker 曾多余加载 `.env.local`/`.env`；它改为只接收显式 `DATABASE_URL` 与 `REDIS_URL` 后，重新通过 Worker、E2E 与根回归。此更正没有读取或使用真实 Provider/Veyra 凭据。

风险：既有基础设施条件测试按设计跳过；C11 的 PostgreSQL 集成和完整浏览器链路已通过显式本地依赖。Nuxt `DEP0155` 是既有构建警告。C12 尚未实现媒体执行、交接帧、QC、合成或成片版本。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。C11 的本地规划、审阅与生产计划确认符合契约和边界，且没有提前触发视频执行。仅授权进入 C12 本地开发；C13-A、真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用和 Git 写入继续禁止。

### C12：本地受控媒体制作、QC 与成片启动记录

状态：`IN_PROGRESS`

实施日期：2026-08-16

范围：在 C11 已确认的 `ProductionRun` 上实现本地 Mock 的依赖调度、交接帧、基础 QC、受控合成、不可替换的 `VideoVersion` 与公开播放/下载投影。每段仍使用既有 `Shot -> TaskRun -> Asset` 状态机；整体制作状态不得替代单段任务状态。

启动审计：已核对 C11 为 `ACCEPTED`，当前不存在 C12 Worker、测试端口 `3331/3332` 或受控 longrun supervisor。现有 C09 本地验收服务保持不触碰。C12 开始前已确认 C11 的事件 relay 需要按消费者严格过滤，避免一个 relay 提前确认其他消费者的 outbox 事件；该兼容性修正和对应回归归入 C12。

边界：仅使用显式本地 `VIDEO_PROVIDER=mock`、`LOCAL_AUTH_MODE=dev`、`VEYRA_AUTH_ENABLED=false` 的一次性测试环境。严禁真实 Provider、Veyra、VPS/SSH、DNS、部署、外部付费调用、Git 暂存/提交/推送；不得读取 `.env.local`。

前置契约工作：先将 C12 的 ProductionSegment、HandoffAsset、QcReport、VideoVersion、公开路由、事件投影和重试语义写入领域/API 事件契约，再开始 schema、Worker 或 Studio 改动。

审计人：Codex

Exit Gate 结论：C12 为唯一 `IN_PROGRESS` 正式章节；尚无实现或验收结论。

### C12：本地受控媒体制作、QC、成片与结果审阅最终独立审计

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交工作区；本章全程未执行 `git add`、提交或推送，既有用户改动保持原状。

修改文件：C12 的 Contracts/Domain/Persistence 生产段、交接帧、QC、不可替换 VideoVersion 与公开投影；`apps/production-worker/` 与 `services/media-runtime/`；Control API 的生产进度/成片读取；Studio 的制作进度和成片审阅面板；C12 API/浏览器/持久化回归及本地长任务记录。

契约变化：确认后的 `ProductionRun` 通过依赖图生成本地 Mock `Shot -> TaskRun`；通过 QC 的前序镜头产生受控交接帧，后续镜头才可运行；全部接受后生成不可替换 `VideoVersion`。公开读模型只暴露安全的制作进度与成功成片的短时播放/下载投影，Provider、对象 key、内部 Runtime、提示词和凭据均不公开。

测试命令及结果：`pnpm --filter @alchemy-video/control-api test:c12-e2e` 通过；Control API 26 通过、1 个既有服务门控跳过；Studio 28/28；Production Worker 12/12；Media Runtime 4/4；Studio/Control API/Production Worker typecheck 通过；一次性 PostgreSQL 数据库迁移后 `production-repository.integration.test.ts` 1/1 通过；根 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部退出码 0。根级服务条件跳过符合既有设计，Nuxt `DEP0155` 为既有警告。

验收证据路径：`.codex-longrun/progress.md`、`.codex-longrun/test-log.md`、`.codex-longrun/state.json`、`apps/control-api/tests/c12-local-e2e.mjs`、`apps/control-api/tests/c12-studio-ui-e2e.py`、`apps/control-api/tests/c12-production-read-routes.test.ts`、`packages/persistence/tests/production-repository.integration.test.ts` 与 `services/media-runtime/tests/`。

审计发现与纠正：独立复核中发现终帧提取窗口对确定性 1 秒 MP4 可产生零帧，已改为可解析的末段窗口；Studio 未订阅 C12 安全事件，已补齐公开进度刷新；无持久化生产库的公开读回退曾返回错误 DTO，已更正并加回归；移动端 E2E 曾把折叠详情内不可见控件当作可用控件，已仅审计用户可见控件。四项均在最终回归中通过。

未完成项：C12 无。C10-C12 本地范围完成。

风险：真实 Provider、Veyra、VPS、DNS、部署、付费调用及 Git 发布不属于本章，仍处于 C13-A 后置边界；不得以本地 Mock 通过推断真实联动已可用。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。C12 满足总控文档第 17 章的完整来源链、受控媒体工具、QC 关联、版本化成片、播放和下载要求。本地 C10-C12 阶段正式结束；后续只能在单独授权的 C13-A 任务中处理真实 Provider、Veyra、VPS 和部署。

### C13-A：真实 Veyra、Provider 与三 VPS 联动启动前置审计

状态：`BLOCKED`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：新增 `doc/AI企业内容生产平台_C13-A真实联动启动前置审计与授权清单.md`，并在总控文档中登记其为 C13-A 启动前置参考。

契约变化：无公共 API、事件、数据库、Worker、Provider、Veyra、部署或前端行为变化。本次只形成真实联动启动门禁。

测试命令及结果：文档阶段仅需状态和差异校验；结果记录在 `.codex-longrun/test-log.md`。未运行真实 Provider、Veyra、VPS、DNS、TLS、扣费或部署测试。

验收证据路径：`doc/AI企业内容生产平台_C13-A真实联动启动前置审计与授权清单.md`、`.codex-longrun/state.json`、`.codex-longrun/blockers.md`。

未完成项：C13-A 真实执行尚未开始。缺少用户一次性明确的测试用户、ticket/debit 上限、额度、Provider profile、素材、VPS/SSH、DNS/TLS、维护窗口、回滚和 Git 发布策略授权。

风险：若未补齐授权就进入真实执行，可能误触真实用户、余额、扣费、VPS 服务、DNS/TLS 或生产数据。因此当前必须 fail-closed。

审计人：Codex

Exit Gate 结论：`BLOCKED`。C13-A 的安全启动包已完成；真实 Provider、Veyra、VPS、DNS、TLS、扣费、部署和 Git 发布仍等待明确授权参数。

### C13-A：最小 canary 授权后的 Phase 0/Phase 1 进展

状态：`IN_PROGRESS`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`doc/AI企业内容生产平台_C13-A真实联动启动前置审计与授权清单.md`、`.codex-longrun/*`、`packages/contracts/src/credit.ts`、`packages/contracts/tests/credit.test.ts`、`packages/credit-veyra/src/errors.ts`、`packages/credit-veyra/src/identity-adapter.ts`、`packages/credit-veyra/src/identity-port.ts`、`packages/credit-veyra/src/index.ts`、`packages/credit-veyra/tests/identity-adapter.test.ts`。

契约变化：新增内部 Veyra ticket exchange 输入和外部身份 DTO，只允许 `intent=video`；未新增公开 OpenAPI 路由、事件、数据库迁移或前端行为。

测试命令及结果：Phase 0 已通过 Provider Video 31/31、Task Worker 25 通过/5 个既有服务门控 skip、Credit Veyra 6/6 及对应 typecheck，并完成只读 GitHub/SSH inventory。Phase 1 身份入口通过 `pnpm --filter @alchemy-video/contracts test` 30/30、`pnpm --filter @alchemy-video/contracts typecheck`、`pnpm --filter @alchemy-video/credit-veyra test` 10/10、`pnpm --filter @alchemy-video/credit-veyra typecheck`、`pnpm --filter @alchemy-video/contracts generate` 和本次差异 `git diff --check`。

验收证据路径：`doc/AI企业内容生产平台_C13-A真实联动启动前置审计与授权清单.md` 第 9-10 节、`.codex-longrun/progress.md`、`.codex-longrun/test-log.md`、`packages/credit-veyra/tests/identity-adapter.test.ts`。

未完成项：尚未识别安全的新 Video VPS；尚未实现本地 session/workspace mapping、billing attempts/recovery、Sub2API Portal `video` target allowlist；尚未执行真实 ticket、Provider、debit、DNS/TLS、部署或 Git 发布。

风险：当前身份 adapter 已具备离线消费端校验，但 Sub2API 服务端若未新增 `video` intent 和受控 target，真实登录桥仍不能开启。因 Phase 0 未找到安全 Video VPS，远程部署继续禁止。

审计人：Codex

Exit Gate 结论：C13-A 从 `BLOCKED` 进入授权后本地 `IN_PROGRESS`，但只允许继续 Phase 1 离线实现和测试。Phase 2 远程部署仍被 Video VPS 目标缺失阻塞；真实 Provider、真实 Veyra ticket、扣费、DNS/TLS、部署和 Git 写入仍未开放。

### C13-A：Phase 1 本地身份映射与计费恢复审计

状态：`READY_FOR_AUDIT`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`apps/control-api/src/identity.ts`、`apps/control-api/src/app.ts`、`apps/control-api/src/repository.ts`、`apps/control-api/tests/c13a-identity.test.ts`、`packages/persistence/src/control-plane-repository.ts`、`apps/task-worker/package.json`、`apps/task-worker/src/billing-executor.ts`、`apps/task-worker/tests/billing-executor.test.ts`，以及 C13-A 文档和 longrun 记录。

契约变化：无公开 API/事件变更。内部 ControlPlaneStore 增加 `ensureIdentity()` 用于 Veyra bootstrap 映射；Task Worker 增加未装配到真实执行路径的 `VideoBillingExecutor`。

测试命令及结果：`pnpm install --offline` 通过且零下载；`pnpm --filter @alchemy-video/control-api test` 29 通过、1 个既有服务门控 skip；Control API typecheck 通过；Persistence typecheck 通过；`pnpm --filter @alchemy-video/task-worker test` 29 通过、5 个既有服务门控 skip；Task Worker typecheck 通过。

验收证据路径：`apps/control-api/tests/c13a-identity.test.ts`、`apps/task-worker/tests/billing-executor.test.ts`、`.codex-longrun/test-log.md`、`.codex-longrun/progress.md`。

未完成项：Phase 1 的本仓库离线身份/计费边界已完成；Sub2API Portal `video/video-mobile` target allowlist 尚未改；真实 session cookie、真实 ticket exchange route、真实 account preflight、真实 debit、Provider canary、VPS/DNS/TLS/deploy 均未执行。Phase 2 仍因缺少安全新 Video VPS 阻塞。

风险：`VideoBillingExecutor` 尚未接入真实 Worker 状态机，属于先行边界组件；接入时仍需数据库级 billing attempt/recovery 集成测试。Sub2API 服务端未具备 `video` intent 前，不得打开真实登录桥。

审计人：Codex

Exit Gate 结论：Phase 1 本仓库离线实现达到 `READY_FOR_AUDIT`。不授权进入远程部署；Phase 2 仍等待安全 Video VPS 目标。

### C10-C12：持久本地验收入口修复与复核

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`infrastructure/local/start-full-local-stack.ps1`、`infrastructure/local/README.md`、`apps/studio-web/app/pages/projects/[project_id].vue`、`apps/studio-web/tests/project-flow.test.mjs`、`apps/control-api/tests/c12-local-e2e.mjs`、`.codex-longrun/progress.md`、`.codex-longrun/test-log.md`、本文件。

契约变化：无公开 API、事件、Provider、Veyra、部署或数据库契约语义变化。C12 E2E harness 增加本地端口覆盖变量；Studio 结果区在无 C12 `VideoVersion` 时显示同项目既有成功生成视频为 `历史成片`，不改变后端 DTO。

测试命令及结果：`infrastructure/local/start-full-local-stack.ps1` 成功启动最新本地全栈；`http://127.0.0.1:3133/api/v1/health`、`http://localhost:3031/api/v1/health`、`http://localhost:3031/projects` 均可用；`都市情感小说` 项目的 `/production-runs` 与 `/video-versions` 均返回 200。浏览器 DOM 看到 `项目资料`、`故事计划`、`生成故事计划`、`视频规格`、`成片版本`、`历史成片` 和 `查看镜头片段`。`pnpm --filter @alchemy-video/studio-web test` 28/28 通过；Studio typecheck 通过；Studio build 通过（仅既有 Nuxt DEP0155 警告）；`C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e` 通过。

验收证据路径：`.codex-longrun/local-acceptance/full-stack-pids.json`、`.codex-longrun/local-acceptance/backups/video_local_before_full_stack_20260816-215947.dump`、`.codex-longrun/test-log.md`、`.codex-longrun/progress.md`。

未完成项：C13-A 真实 Provider/Veyra/VPS/部署仍按后续章节边界处理；本次只修复本地最新 C10-C12 验收入口。

风险：持久入口当前是本机受控进程而非生产部署；重启电脑后需重新运行 `infrastructure/local/start-full-local-stack.ps1`。真实 Provider、共享积分、VPS 和域名仍未纳入本次验收。

审计人：Codex

Exit Gate 结论：本地 C10-C12 最新工作台入口恢复并验收通过。`http://localhost:3031/projects` 当前可用于用户继续本地验收；外部边界继续关闭。

### C11-C12：工作台清晰度与布局修订

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`packages/contracts/src/creative-planning.ts`、`contracts/*`、`packages/persistence/src/schema.ts`、`packages/persistence/src/creative-planning-repository.ts`、`packages/persistence/src/production-repository.ts`、`packages/persistence/drizzle/0011_daily_lord_tyger.sql`、`apps/control-api/src/app.ts`、`apps/control-api/src/serializers.ts`、`apps/studio-web/app/components/studio/StoryPlanningPanel.vue`、`apps/studio-web/app/pages/projects/[project_id].vue`、`apps/studio-web/app/assets/studio.css`、对应测试及三份设计/契约文档。

契约变化：`CreativeBriefRevision` 和创建命令新增公开、安全的 `target_resolution: 480p | 720p`；命令默认 `720p`，历史数据库迁移以 `720p` 回填。清晰度随 immutable brief 固化；C12 调度器以该值创建每段 `TaskRun.input_snapshot`，不再硬编码 `720p`。未暴露 Provider、模型、队列、对象存储或凭据。

测试命令及结果：Contracts 30/30；Persistence 15 通过、8 个既有服务门控跳过；Control API 29 通过、1 个既有服务门控跳过；Studio 29/29、typecheck、build 均通过（仅 Nuxt 既有 DEP0155 warning）；C11 浏览器 E2E 验证选中 `480p` 后刷新仍保留且零 TaskRun；C12 浏览器 E2E 验证三段 TaskRun 快照均为 `480p`，并完成 Mock 生成、QC、合成、播放、下载和 `390x844` 布局。最新本地全栈迁移并启动后，Control API、Studio 与同源代理均为 HTTP 200。

验收证据路径：`packages/persistence/drizzle/0011_daily_lord_tyger.sql`、`apps/control-api/tests/c11-local-e2e.mjs`、`apps/control-api/tests/c12-local-e2e.mjs`、`.codex-longrun/local-acceptance/full-stack-pids.json`。

未完成项：无本地功能缺口。真实 Provider、Veyra、VPS、DNS、部署和 Git 发布仍不属于本次修订。

风险：本地 Mock 的固定测试视频尺寸不代表真实上游编码分辨率；真实 profile 的实际能力与费用仍须按 C13-A 独立认证与授权。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。界面保留一条用户能理解的内容输入和三个有限的成片偏好；清晰度从页面到不可变任务快照可追溯，素材选择不再重复占据故事卡，桌面与移动端布局均已回归。

### C11-C12：成果区稳定性修订

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`apps/studio-web/app/composables/useProjectEvents.ts`、`apps/studio-web/app/pages/projects/[project_id].vue`、`apps/studio-web/app/components/studio/ProjectResultsPanel.vue`、`apps/studio-web/app/components/studio/GenerationPanel.vue`、`apps/studio-web/app/assets/studio.css`、`apps/studio-web/nuxt.config.ts`、`infrastructure/local/start-full-local-stack.ps1`、对应浏览器/静态测试与 Studio 设计文档。

契约变化：无公开 API、事件、状态机或数据库变化。SSE 仍只刷新当前项目的公开投影；刷新改为合并数据而非触发整页加载。固定本机演示入口仅注入一个前端运行时标识，明确测试片段不能代表正式成片。

测试命令及结果：Studio 30/30、typecheck、build 通过（仅既有 Nuxt `DEP0155` warning）；C12 本地 E2E 通过，新增断言确认成片播放器没有 `autoplay`，展开镜头片段后不与播放器重叠，并保持成片下载、移动布局和隔离清理通过。重启本机全栈后，Studio、Control API、数据库及全部受控服务健康。

验收证据路径：`apps/studio-web/tests/project-flow.test.mjs`、`apps/control-api/tests/c12-studio-ui-e2e.py`、`.codex-longrun/local-acceptance/full-stack-pids.json`。

未完成项：正式内容生成仍依赖后续独立的真实 Provider 认证与启动；本机固定 `VIDEO_PROVIDER=mock` 的蓝色测试视频不是有效商业成片。

风险：Mock 只验证编排、播放和合成流程，不能验证真实内容质量、上游画面或费用。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。连续事件不会再卸载/重载项目播放器，播放只在用户选择后发生，镜头片段不会被右侧成果卡遮挡，演示片与正式成片的边界对用户可见。

### C13-A：本机真实 Provider 成片链路修复与 canary

状态：`ACCEPTED`

实施日期：2026-08-16（本机时区）

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`packages/persistence/src/production-repository.ts`、`apps/production-worker/src/video-input-snapshot.ts`、`apps/production-worker/src/index.ts`、`apps/production-worker/package.json`、`apps/production-worker/tests/video-input-snapshot.test.ts`、`apps/studio-web/tests/project-flow.test.mjs`、`infrastructure/local/start-full-local-stack.ps1`、`infrastructure/local/run-real-provider-canary.mjs`、`infrastructure/local/README.md`、本真实 Provider 运行文档与 longrun 记录。

契约变化：无公开 API、事件、数据库迁移或 Studio 表单变化。C12 生产调度新增内部可注入 TaskRun 快照工厂：默认 Mock 行为不变；显式 `VIDEO_PROVIDER=sub2api` 时由 Production Worker 按真实 Provider profile 生成 `grok-imagine-video-1.5` 的不可变 TaskRun 快照。启动脚本新增显式真实模式参数，但默认仍为 `VIDEO_PROVIDER=mock`。

测试命令及结果：`pnpm install --offline` 零下载；Production Worker 14/14；Production Worker typecheck；Persistence typecheck；Task Worker 29 通过、5 个既有服务门控 skip；Provider Video 31/31；Control API 29 通过、1 个既有服务门控 skip；Control API typecheck；Studio 30/30；Studio typecheck；`C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e` 通过。默认 Mock 持久入口启动通过；随后 `start-full-local-stack.ps1 -VideoProvider sub2api -SkipBuild -SkipBackup` 成功启动真实本地入口。

真实 canary 结果：`infrastructure/local/run-real-provider-canary.mjs --real-call` 使用合成参考图和新建项目创建 1 个真实 Provider 任务，并完成 C12 最终成片。数据库核对：TaskRun `SUCCEEDED`，模型 `grok-imagine-video-1.5`，`duration=15`，`resolution=720p`，`visual_input=REFERENCE_SET`，参考图 1 张，ProviderAttempt 1 条且已提交 1 条。VideoVersion `SUCCEEDED`，结果资产 `video/mp4`，1,541,708 bytes，15,084 ms。公开项目页与同源健康检查均 HTTP 200。

验收证据路径：`.codex-longrun/local-acceptance/full-stack-pids.json`、`.codex-longrun/local-acceptance/logs/`、`infrastructure/local/run-real-provider-canary.mjs`、`.codex-longrun/test-log.md`、`.codex-longrun/progress.md`。

未完成项：Veyra/shared credit、Video VPS、DNS/TLS、部署和 Git 发布仍不属于本次本机 canary；C13-A 远程 Phase 2 仍等待安全的新 Video VPS 目标。

风险：真实模式会让后续新建视频任务消耗外部 Provider 额度；长故事按分镜数量触发多次真实调用。一次合成 canary 只证明本机链路和当前参数可用，不保证所有小说内容、复杂提示词或 7 图视觉质量。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。本机真实 Provider 到 C12 最终成片链路已修复并通过一次真实合成 canary；远程部署和共享积分继续后置。

### C11-C12：通用叙事点与生成片段本地实现

状态：`ACCEPTED`

实施日期：2026-08-16

实现提交或工作区快照：未提交；未执行 `git add`、提交或推送。

修改文件：`packages/contracts/src/creative-planning.ts`、`packages/contracts/src/resources.ts`、`contracts/*`、`packages/creative-planning/src/index.ts`、`packages/creative-planning/tests/deterministic-planner.test.ts`、`apps/workflow-worker/src/execution-service.ts`、`apps/workflow-worker/tests/execution-service.test.ts`、`packages/persistence/src/schema.ts`、`packages/persistence/src/creative-planning-repository.ts`、`packages/persistence/src/production-repository.ts`、`packages/persistence/drizzle/0012_previous_sleeper.sql`、`packages/persistence/drizzle/meta/*`、`packages/persistence/tests/creative-planning-repository.test.ts`、`apps/control-api/src/serializers.ts`、`apps/control-api/tests/c11-creative-planning-routes.test.ts`、`apps/control-api/tests/c12-studio-ui-e2e.py`、`apps/production-worker/src/video-input-snapshot.ts`、`apps/production-worker/tests/video-input-snapshot.test.ts`、`packages/provider-video/src/runtime-profile.ts`、`apps/studio-web/app/composables/useControlApi.ts`、`apps/studio-web/app/components/studio/ProductionProgressPanel.vue`、`apps/studio-web/app/pages/projects/[project_id].vue`、`apps/studio-web/tests/project-flow.test.mjs`、longrun 记录。

契约变化：公开 Storyboard DTO 新增 `narrative_beat_sequences`、`narrative_beat_count`、`generation_segment_count`；ProductionRun DTO 新增兼容型 `total_segment_count`、`accepted_segment_count`；TaskRun 输入快照新增可选 `generation_segment_sequence` 与 `narrative_beat_sequences`。数据库新增 `storyboard_shot_specs.narrative_beat_sequences`，迁移先回填历史行再增加非空数组检查。旧 `shot` 命名字段保留兼容，不再作为当前 Provider 调用数量的产品语义。

测试命令及结果：Creative Planning 4/4；Workflow Worker 6/6；Persistence 15 通过、8 个既有数据库门控 skip；Production Worker 14/14；Provider Video 31/31；Contracts 30/30；Control API 29 通过、1 个既有服务门控 skip；Studio 30/30；所有触达包 typecheck 通过；Studio build 通过（仅既有 Nuxt DEP0155 警告）；`C12_E2E_RUNTIME_PORT=3435 pnpm --filter @alchemy-video/control-api test:c12-e2e` 通过；根级 `pnpm typecheck`、`pnpm test`、`pnpm build` 全部退出 0；`git diff --check` 退出 0（仅既有 CRLF warning）。

验收证据路径：`packages/creative-planning/tests/deterministic-planner.test.ts`、`apps/workflow-worker/tests/execution-service.test.ts`、`packages/persistence/tests/creative-planning-repository.test.ts`、`apps/control-api/tests/c11-creative-planning-routes.test.ts`、`apps/control-api/tests/c12-studio-ui-e2e.py`、`.codex-longrun/test-log.md`、`.codex-longrun/progress.md`。

未完成项：持久本地 `video_local` 如需用于浏览器验收，需要重新运行本地启动脚本以应用新增迁移 0012；真实 Provider 大规模长故事质量、Veyra/shared credit、Video VPS、DNS/TLS、部署和 Git 发布仍属后续边界。

风险：当前分组器是确定性本地规划模型，能保证叙事点和生成片段数量边界，但不是最终商业级智能编剧质量；后续接入更强 PlanningModelPort 时必须继续满足本次锁定的同一契约和 E2E。真实 Provider 每个生成片段仍会产生一次付费调用，因此长故事真实运行前仍需要预算和账号边界。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。18 个叙事点/30 秒不再被误解成 18 次视频生成；后台会生成 3 个可执行片段并合成一个不可变成片。C11/C12 本地链路、公开投影、快照和浏览器 E2E 已通过；外部边界继续关闭。

### C12：真实多段成片质量修正

状态：`ACCEPTED`

实施日期：2026-08-17

范围：仅修正本机 C12 成片合成、创作素材资格和内部 PromptPackage 连续性约束，并在用户已授权的本机 `sub2api` 真实模式下为既有项目创建一版新的受控成片。不得触碰 Veyra、共享积分、VPS、SSH、DNS、TLS、部署、Git 或公开 API。

已确认根因：最新真实源片段带 AAC 音轨，旧 Media Runtime 合成命令使用 `-an`，因此最终 `VideoVersion` 被错误静音；旧 creative brief 还含有一张 `DERIVED` 的蓝色交接帧，可在新版本第一段再次作为多参考输入；确定性编译器没有将用户已保存的风格偏好和角色/服装/场景/人体结构连续性写入实际 Provider prompt。

已完成修正与验证：契约与 ADR-0042 已先行更新。Media Runtime 改为保留/交叉淡变音频，并对未通过语义衔接验收的段边界加入固定时长、保持总时长的淡变转场；CreativeBriefRevision 和 Studio 只允许 READY `USER_UPLOAD` 图片/文档作为新来源；PromptPackage v2 载入风格偏好、参考策略、身份/服装/场景、角色位置和自然人体结构约束。Creative Planning 4/4、Workflow Worker 6/6、Persistence 15 通过/8 既有服务门控跳过、Media Runtime 5/5、Studio 31/31 与 typecheck、Production Worker 14/14 与 typecheck、C12 隔离 Mock E2E、状态校验与 diff check 均通过。

真实重试结果：受控本机栈已从新源码重启。“都市情感小说”新建 revision 4，源文本被规划为 11 个叙事点和 3 个各 10 秒的执行片段；尾部“把以上剧情设计成剧本”未进入任何 PromptPackage。新 brief 仅使用两张 `USER_UPLOAD:IMAGE`，没有派生交接帧。3 个 TaskRun 与 3 个已提交 ProviderAttempt 全部 `SUCCEEDED`。最终 VideoVersion 为 30.167 秒、848×480、H.264 + AAC、2,752,769 bytes；音量检测均值 `-26.6 dB`、峰值 `-5.8 dB`，不是静音。首/中/尾抽帧中女主衣着、男主外观与暖色室内场景保持一致，未见上一版明显的颈部/身体错位。

交接帧与参考素材一致性修订：Studio 在加载项目时不再从最新生成镜头的 `reference_bindings` 恢复勾选状态，而是从当前 immutable `CreativeBriefRevision.source_asset_ids` 中恢复仍为 `READY USER_UPLOAD IMAGE` 的素材；没有历史 brief 的项目仍默认勾选全部可用用户图片。这样，交接帧、海报等 `DERIVED` 资产不会让页面显示为未选择，也不会伪装成用户主动选择的素材。

后续 `HANDOFF_FIRST_FRAME` 片段现在先等待前一段 QC 产出的 `DERIVED` 交接帧，再按固定顺序形成内部视觉输入：第 1 张是交接帧，随后最多 6 张为当前 brief 的用户参考图，总数不超过 7 张。仅有交接帧时保持真实 `FIRST_FRAME` 输入；有用户参考图时使用有序 `REFERENCE_SET`，私有 PromptPackage 明确要求模型把第 1 张作为开场交接帧、其余图片用于人物、服装、场景和色彩锚定。直接公开 Shot 生成接口仍保持“首帧或参考集二选一”的既有契约，未被本次内部 C12 调度绕开或扩大。

补充验证（2026-08-17）：Creative Planning 5/5、Provider Video 31/31、Studio 32/32、Contracts 30/30、Control API 29 通过/1 个既有服务门控跳过、Document Worker 8/8、Production Worker 14/14、Task Worker 29 通过/5 个既有服务门控跳过、Workflow Worker 6/6；根 `pnpm typecheck` 和串行根 `pnpm -r --workspace-concurrency=1 --if-present test` 均退出 0；Studio build 通过（仅既有 Nuxt `DEP0155` warning）；隔离 C12 Mock E2E 通过。显式本地 PostgreSQL `production-repository.integration.test.ts` 1/1 通过，实证第二段不可变快照为 `[handoff, user_reference]`、`REFERENCE_SET`，并验证 QC、依赖调度、合成和失败路径。此修订没有执行新的真实 Provider 调用、Veyra、VPS、部署或 DNS 操作。

风险：上游图像/视频模型没有提供平台可验证的逐像素“上一段尾帧必然等于下一段首帧”保证；本实现是受控的交接帧优先输入与提示约束，不应被表述为帧级无缝承诺。语义视觉 QC 和真正生成式桥接镜头仍是后续质量能力。此次抽帧是人工抽样而非逐帧语义验收。真实生成会消耗 Provider 额度，但不触发 Veyra 计费。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。修正代码、定向/隔离回归、真实 3 段新版本、媒体音轨/时长核对、素材资格与 PromptPackage 审计、抽帧检查及本地入口健康检查均通过。C12 重新关闭；C13-A 的 Veyra、VPS、部署与 Git 边界不因本次本机重试而开放。

### C12.1：语义衔接质检与自动转场修复

状态：`ACCEPTED`

实施日期：2026-08-17

前置条件：C12 `ACCEPTED`。当前唯一正式实施章节为 C12.1；C13/C13-A、Veyra、共享积分、VPS、SSH、DNS、TLS、部署和新的真实 Provider 调用保持后置。

范围：把 C12 已有的“交接帧优先输入 + 技术 QC + 有限淡变”升级为可追溯的语义边界质检和有界自动修复。新增私有 `HandoffReview`、`TransitionRepair`、受控 `HandoffEvaluatorPort`、边界帧提取、计划化合成和安全的 ProductionRun 进度投影。桥接片段只属于后台修复，不改变用户看到的主片段数或一键创作流程。

本轮文档依据：`AI企业内容生产平台_C12.1语义衔接质检与自动转场修复开发设计.md`、ADR-0044、领域/API 契约、通用叙事点与生成片段编排规范、Studio 与长叙事工作台交互设计。

当前证据：C12 历史验收已证明交接帧、用户参考图、音轨与有界淡变可用。C12.1 已完成契约、前向迁移、持久化 Review/Repair 事实、Worker/Runtime 编排、公开投影及隔离本地验收：18 个叙事点被编排为 3 个 Mock 主片段，全部技术 QC 后产生 2 个相邻 `HandoffReview`，默认 fail-closed 评估器明确记录 `UNAVAILABLE`，写入 2 个保守 BLEND 修复计划并合成 1 个不可变成片。三段真实 MP4 夹具覆盖 `PASS`、`BLEND`、`BRIDGE` 混合计划并验证音轨/时长；disposable PostgreSQL 集成验证活动租约 `BUSY`、过期租约恢复和完成后重复回放 `DUPLICATE`。Contracts 30/30、Domain 18/18、Production Worker 20/20、Persistence 集成 1/1（普通套件 16 通过、8 个既有数据库门控跳过）、Studio 32/32、Runtime 9/9、控制面 typecheck、根 typecheck/串行 test/build 与隔离 E2E 均通过；临时数据库、队列、对象和端口 3531/3532/3533 已清理。

禁止事项：不得修改既有 C12 历史 TaskRun、Asset、HandoffAsset、ProviderAttempt 或 VideoVersion；不得将评估器/桥接的原始图像、模型、Prompt、Provider、对象 key、临时路径或命令行公开；不得启动 Veyra、VPS、DNS、TLS、部署或付费外部调用；章节处于 `IN_PROGRESS` 前不得 Git add、提交、tag 或推送。

Exit Gate 结论：`PASS`、`BLEND`、`BRIDGE_REQUIRED`、`UNAVAILABLE`、失败和恢复路径均经 Mock/离线夹具及临时 PostgreSQL 通过；每个边界最多一次自动修复，活动租约内重复投递为 `BUSY`、过期租约可由新 Worker 恢复、完成后回放为 `DUPLICATE`；三段混合转场保留音轨且时长守卫通过；Studio 只显示自然语言进度与安全摘要；无真实 Provider、Veyra、VPS、部署或 Git 写入。独立审计接受 C12.1。

独立审计记录（2026-08-17）：

- 只读复核 `packages/contracts`、`packages/domain`、`packages/persistence`、`apps/production-worker`、`services/media-runtime`、Control API serializer 和 Studio progress projection：内部评估结果、边界帧、修复计划、对象 key、临时路径、Provider/模型字段未进入公开 DTO/SSE。
- 复核 `0013_perpetual_jimmy_woo.sql` 与 schema：Review/Repair 具备 workspace/project/run 复合约束、相邻边界约束、唯一边界索引、转场时长上限和本地修复 `task_run_id = null` 事实。
- 复核 Worker：缺失源片段或边界帧能力时抛出可重试错误，不再确认事件；重复 durable delivery 在 `DUPLICATE` 时不调用 Runtime/Store；终态死信沿既有安全 FAILED Review 路径。
- 复核 Runtime：ALCHMED2 composition plan 限制过渡枚举、桥接数量与 1-3 秒时长；仅 loopback、字节流、服务自有临时目录；三段 `PASS/BRIDGE` 混合夹具验证音轨与时长。
- 复核证据：Production Worker 20/20、Domain 18/18、Runtime 9/9、Persistence disposable PostgreSQL 1/1、Studio 32/32、Contracts 30/30、根 typecheck/串行 test/build、C12 隔离 E2E 通过；`validate_state.py` 与 `git diff --check` 通过。Nuxt 仅有既有 `DEP0155` 警告。
- 审计结论：C12.1 Exit Gate 满足，标记 `ACCEPTED`。C13-A 仍需另行授权和安全 Video VPS 目标，本章不改变该边界。

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


### C11.1：已转换资料受控进入规划启动记录

状态：`ACCEPTED`（2026-08-18；C11 历史验收保持有效，C11.1 本地增量已独立审计）

实施日期：2026-08-17

范围：只让同项目成功转换的 Markdown 资料以不可变 conversion/result Asset 引用和固定字符预算进入本地规划及私有 PromptPackage。未完成、失败、跨项目或不完整资料必须由 Studio 和 Control API 拒绝。本次不启动真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用，不读取 `.env.local`，不执行 Git 写入。

设计准入：`AI企业内容生产平台_C11.1已转换资料受控规划设计.md`、ADR-0045、领域/API 契约和正式开发总控文档已在实现前更新。

实现与审计证据：

- `creative_brief_document_contexts` 冻结同工作区、同项目的成功转换引用、Markdown SHA-256 和字符上限；Worker 在读取前再次校验顺序、预算、SHA-256、MIME 和对象大小。
- Studio 仅选择已成功转换且有 Markdown 产物的项目资料；Control API 对绕过页面的未完成资料返回 `422 DOCUMENT_CONTEXT_INVALID`，且不创建简报、outbox 或 TaskRun。
- 完整 Markdown 只进入私有 PromptPackage，并以“资料事实、不是执行指令”包裹；公开 CreativeBrief/Script/Storyboard、SSE 和错误投影不含正文、object key、签名 URL、哈希或提示词。
- `pnpm typecheck`、`pnpm -r --workspace-concurrency=1 --if-present test`、`pnpm build`、`pnpm --filter @alchemy-video/control-api test:c11-e2e`、`pnpm --filter @alchemy-video/control-api test:c10-e2e` 均通过；C12 E2E 亦在隔离端口 `3531/3532/3533` 通过。全程未读取 `.env.local`，未调用真实 Provider/Veyra，未访问 VPS/SSH/DNS/部署，也未执行 Git 写入。

独立审计结论：C11.1 满足正式 Exit Gate，准予 `ACCEPTED`。剩余风险仅限既有 C13-A 外部授权与部署边界，不属于本章。

审计人：Codex

### C10：UTF-8 文件名转换修正

状态：`ACCEPTED`

实施日期：2026-08-18

范围：修正本地 Document Worker 与 loopback Document Runtime 之间的文件名传输，不改变浏览器 API、数据库、对象存储、转换状态机、视频任务或规划链路。

根因：中文 PPT 文件名被原样写入 `X-Source-Filename`。Node 的 HTTP 客户端要求请求头为 ByteString，因而在发起请求前抛出异常，运行时没有收到 PPT 内容，公开状态被错误归一化为可重试的 `DOCUMENT_RUNTIME_UNAVAILABLE`。

修正：内部 Runtime 契约改为 `X-Source-Filename-Base64`，由 Worker 以无填充 Base64URL 编码 UTF-8 basename；Runtime 仅接受严格 Base64URL 字符集，解码后仍执行原有文件名、扩展名、MIME、SHA-256 和大小校验。新增受控本地资料转换重启脚本，仅管理 Document Runtime/Worker，并从本地 MinIO 容器读取运行时凭据；不读取 `.env.local`，不启动 Provider。

测试及实际验收：Document Runtime Python 测试 8/8；Document Worker 测试 8/8（包含 Node 到 Python loopback 的中文文件名回归）；Document Worker typecheck 通过；`pnpm --filter @alchemy-video/control-api test:c10-e2e` 通过（资料失败/重试、下载、隔离、浏览器和私有规划上下文）；`git diff --check` 通过，仅有既有 Windows 换行警告。通过公开 Control API 对用户项目的既有中文 PPT 执行一次受控重试，转换在第 3 次尝试变为 `SUCCEEDED` 并产生 Markdown Asset；Studio 页面刷新后显示该文件及“已可用于这次创作”。

边界：没有创建视频任务或真实 Provider 调用；未使用 Veyra、VPS、SSH、DNS、部署或 Git 写入。用户原始 PPT 内容、对象 key、签名 URL、凭据和 Markdown 正文均未进入公开记录。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。C10 现在支持 UTF-8 文件名的 PPTX、PDF、DOCX、XLSX、Markdown 和纯文本资料，且现有项目资料已完成转换。

### C12/C11：新版本制作锁与来源素材保护修正

状态：`ACCEPTED`（验收后的可靠性修正，不重开 C12/C11 章节）

实施日期：2026-08-18

根因：用户调整故事后，新的简报、规划和审批均已成功，但 `POST /production-runs` 将历史 `BLOCKED` 批次误判为活动批次，返回 `409 PRODUCTION_RUN_ACTIVE_CONFLICT`；因此没有创建新的 TaskRun，也没有到达 Provider。此前删除仍在运行任务引用的参考素材还可能使旧 TaskRun 快照失效。

修正：统一内存 Repository、Drizzle Repository、Schema 与 `0015_vengeful_gargoyle.sql` 的活动批次集合，`BLOCKED` 只保留历史/重试语义，不再占用新版本锁。删除 USER_UPLOAD 素材前检查活动 TaskRun、活动 ProductionRun、活动文档转换和可重试失败段；命令结果以 `ASSET_IN_USE` 写入去重快照并返回 HTTP 409。Studio 为 `PROVIDER_PROTOCOL_INVALID` 与 `ASSET_IN_USE` 提供明确中文提示。

测试及证据：Contracts 30/30；隔离 PostgreSQL 串行 Persistence 全套 27/27（含 BLOCKED 新版本回归、迁移索引断言和活动素材保护）；Control API 定向生成/素材测试及完整套件通过（32 通过、1 个既有服务门控跳过）；Studio 33/33、根 typecheck、Studio build 和 `git diff --check` 通过；迁移 0015 已应用到受控本地数据库并完成真实 sub2api 栈健康检查。未自动发起新的真实 Provider 请求，未访问 Veyra/VPS/DNS/TLS，未执行 Git 写入。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。用户刷新当前 Studio 后可再次点击“调整后生成新版本”；旧失败/阻塞记录保持不可变历史。

### C09-C/C12：真实 profile 出站 Prompt 上限修正

状态：`ACCEPTED`（真实失败诊断后的运行时可靠性修正）

实施日期：2026-08-18

根因：旧 BLOCKED 锁修正后，新版本已经成功创建 ProductionRun、TaskRun 和两张参考图的 `REFERENCE_SET` 快照，但真实 `aiself-grok / grok-imagine-video-1.5` 在提交阶段拒绝 13,457 字节 Prompt，返回“Grok 视频最多支持 4096 字节的 UTF-8 文本”。这不是参考图丢失，也不是 xAI 官方文档公布的通用上限；官方文档没有公布 Prompt 字节限制，4096 是当前 SUB2API/profile 的实测能力事实。

修正：保留平台 20,000 字节资料/执行预算和原始 Shot 描述，不恢复前端 4096 硬拒绝；在内部 `VideoProviderRuntimeProfile` 为当前真实 profile 声明 4,096 字节出站压缩上限。TaskRun 快照生成时使用配置预算与 profile 上限的较小值进行确定性 UTF-8 安全压缩，确保 Worker 实际提交内容与持久化快照一致。Mock profile 不受该限制。

测试及证据：Provider Video 35/35；Production Worker 22/22；Provider/Worker typecheck 通过；Studio/Control API 现有回归保持通过；真实失败 TaskRun、ProviderAttempt、ProductionSegment 和参考素材快照已只读核验；未自动重试真实任务，未访问 Veyra/VPS/DNS/TLS，未执行 Git 写入。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。下一次点击将以不超过当前 profile 实测上限的冻结 Prompt 发起新的真实 TaskRun；旧失败记录保持不可变历史。

### C09-C：参考图角色视觉分析与用户说明优先修正

状态：`ACCEPTED`（本地可靠性修正，不重开 C09/C11/C12）

实施日期：2026-08-19

范围：彻底弃用按上传位置推断人物/场景/风格。用户在故事/想法中的明确图片职责说明优先；无明确说明时，由可选的服务端多模态视觉分析单元识别 `SUBJECT`、`SCENE`、`STYLE`；没有分析结果或置信度不足时，C09/C11/C12 统一进入安全等待，不静默生成。

实现与边界：新增 `@alchemy-video/reference-analysis` OpenAI-compatible 适配器，确认图片时由 Control API 服务端读取已确认对象并保存最小化视觉分析元数据；浏览器、公开 DTO、SSE、Worker 和日志不接触密钥、原始模型响应或视觉摘要。`HANDOFF` 首帧仍为最高优先级，显式主体绑定仅在用户未提出冲突说明时生效。既有用户上传素材不被按位置回填角色。

测试及证据：Domain 24/24；Reference Analysis 2/2；Creative Planning 6/6；Provider Video 36/36；Studio 33/33；Control API 参考素材确认/角色快照回归、Persistence typecheck、Control API typecheck 通过；C12 PostgreSQL 持久化集成 1/1（临时 workspace 自动清理）；根 `pnpm typecheck` 与 `pnpm build` 通过；`git diff --check` 仅有 Windows 换行提示。未执行真实视觉模型调用、真实视频调用、Veyra、VPS、SSH、DNS、部署或 Git 写入。

未完成项：当前本地 `.env.local` 未配置 `REFERENCE_VISION_*`，因此未配置视觉服务时系统会按设计等待；配置受控视觉端点后需另行做一次有界的图片分析能力认证。

审计结论：位置规则已从运行时代码删除，用户说明优先和视觉分析兜底逻辑已覆盖 Control API、C11/C12 快照、Studio 提示与离线回归；本项 `ACCEPTED`。

### C11.4：关键对象连续性与视觉道具锁

状态：`ACCEPTED`

实施日期：2026-08-21

范围：把参考图中的关键对象从泛化 `主要道具` 锁升级为通用对象级连续性约束，覆盖用户文字优先、视觉分析兜底、MotionBeat 绑定和 Provider 出站 Prompt。旧 C11/C12/C12.1 事实保持不变；真实 Provider、Veyra、VPS、部署和 Git 写入保持后置。

设计依据：`AI企业内容平台_C11.4关键对象连续性与视觉道具锁开发设计.md`。

实现与审计证据：

- `KeyVisualObjectLockSchema`、可选 `key_visual_objects` 和每节拍对象锁字段已加入内部契约；旧快照缺少字段时按空数组解析，无数据库迁移。
- 用户故事中的对象说明由确定性解析器提取；参考视觉分析器返回最多 12 个受限对象摘要；两者只保留服务端私有字段，不进入公开 OpenAPI、AsyncAPI、SSE 或浏览器 DTO。
- Workflow Worker 通过 workspace/project 范围的素材查询读取视觉对象摘要，将对象锁冻结到每个 PromptPackage、GenerationSegmentMotionPlan 和 MotionBeat；直接 Control API 生成路径同样把已确认素材对象锁编译进出站 Prompt。
- Prompt 顺序将对象锁置于参考语义、风格和背景之前，并明确禁止替换、消失、合并或变形；对象锁没有拂尘特例，适用于产品、道具、服装配件和车辆等对象。
- 定向与串行全仓回归通过：Contracts 30/30、Domain 29/29、Creative Planning 12/12、Provider Video 37/37、Reference Analysis 2/2、Workflow Worker 12/12、Control API 33/34（1 个既有服务门控跳过）、Persistence 19/27（8 个既有数据库门控跳过）、Studio 33/33、Document Worker 8/8、Production Worker 22/22、Task Worker 30/35（5 个既有 BullMQ 门控跳过）；根 typecheck/build 通过。
- 独立审计复核了旧快照兼容、对象字段预算、workspace/project 查询边界、PromptPackage 私有性和公开契约脱敏；未发现真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

Exit Gate 结论：`ACCEPTED`。逐帧对象语义 QC 仍作为后续 C12 媒体质量增量，不伪装为本轮已完成能力。

### C11.5：单实例持有与换手约束

状态：`ACCEPTED`

实施日期：2026-08-21

范围：在已验收的 C11.4 对象连续性锁上补充通用单实例数量、持有者和明确换手阶段约束。前端不增加设置；不重开 C11/C11.1/C12/C12.1/C11.4，不触碰真实 Provider、Veyra、VPS、部署或 Git。

设计依据：`AI企业内容平台_C11.5单实例持有与换手约束开发设计.md`。

实现与审计证据：

- `KeyVisualObjectLockSchema` 增加可选 `instance_count`、`holder`、`transfer`；`MotionBeat` 增加可选 `object_states`。旧 C11.3 MotionPlan 夹具无新增字段仍可解析，无数据库迁移。
- 确定性解析器仅在用户明确表达左右手转移、交给或接过时生成 transfer；默认单实例和持有关系在同句多物体场景下保持局部；跨句代词换手有回归，视觉分析不能自行臆测换手。
- 规划器在明确换手时至少生成释放、双手接触、目标手接收三个阶段，并把数量固定为 1、禁止复制/双持/残影写入每个 MotionBeat；无换手时只生成稳定状态。
- Prompt 编译器将单实例与原子换手约束置于参考语义之前；Workflow Worker 私有 PromptPackage、MotionPlan 和 object_states 均有回归。用户文字字段覆盖同名视觉分析字段，公开 OpenAPI/AsyncAPI/JSON Schema 不含这些内部字段。
- 定向测试：Contracts 31/31、Domain 32/32、Creative Planning 13/13、Provider Video 38/38、Workflow Worker 12/12；串行全仓测试通过：Studio 33/33、Control API 33 通过/1 个既有服务门控跳过、Persistence 19 通过/8 个既有数据库门控跳过、Document Worker 8/8、Production Worker 22/22、Task Worker 30 通过/5 个既有 BullMQ 门控跳过；根 `pnpm typecheck`、`pnpm build` 通过（仅既有 Nuxt `DEP0155` 警告），`git diff --check` 仅有 Windows 换行提示。
- 独立审计复核了旧快照兼容、单实例数量守卫、换手顺序守卫、同句多物体隔离、用户优先级、Workflow Worker 私有边界和公开契约脱敏。未执行真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。

未完成项：逐帧对象数量/持有者语义 QC 仍属于后续 C12 媒体质量增量，不在本章伪装为完成。

审计人：Codex

Exit Gate 结论：`ACCEPTED`。用户不需要新增设置；明确换手自动使用同一物体的释放—接触—接收约束，未明确换手则保持原持有关系。

### C11.3：动作节拍与时间轴提示词开发增量

状态：`READY_FOR_AUDIT`（根据真实项目“茅山地产内容运营”的规划审计重新打开后完成修正；不改变 C11/C11.1/C12/C12.1 的历史 `ACCEPTED`，也不改变 C11.2 的待实现状态）

实施日期：2026-08-19

范围：补充 `NarrativeBeat -> MotionBeat -> GenerationSegment` 的私有动作执行层，解决现有规划只形成句子/等分片段、缺少动作顺序、时间位置、起止姿态和连续性锁的问题。前端不增加工程化步骤；旧 Storyboard、TaskRun、VideoVersion 和公开投影保持兼容。

实现与证据：`packages/contracts/src/creative-planning.ts` 新增 `MotionBeat` 与 `GenerationSegmentMotionPlan` 的完整时间轴 schema 和连续性校验；`packages/contracts/src/resources.ts` 为执行快照增加成对的版本/哈希/时间轴私有字段，并验证时间轴覆盖完整任务时长。`packages/creative-planning/src/index.ts` 以确定性规则生成 1 个短片段或 2-4 个长片段动作节拍、编译时间轴提示词并生成且核对 SHA-256 哈希；`apps/workflow-worker/src/execution-service.ts` 持久化动作计划；`packages/persistence/src/creative-planning-repository.ts` 将其放入既有私有 capability snapshot，避免破坏旧数据库结构；`packages/persistence/src/production-repository.ts` 与 `apps/production-worker/src/video-input-snapshot.ts` 在创建 TaskRun 时冻结动作计划版本、哈希和时间轴；旧 PromptPackage 没有动作计划时继续走兼容路径。

测试及证据：根 `pnpm test` 通过；Contracts 30/30、Creative Planning 8/8、Domain 24/24、Persistence 19 通过/8 个既有数据库门控跳过、Provider Video 36/36、Production Worker 22/22、Workflow Worker 11/11、Control API 33 通过/1 个既有服务门控跳过；根 `pnpm typecheck`、根 `pnpm build`、`git diff --check` 通过。公开 OpenAPI、AsyncAPI 和平台 schema 扫描未发现 `MotionBeat`、`motion_plan` 或 `motion_timeline`；没有真实 Provider、Veyra、VPS、SSH、DNS、TLS、部署、付费调用或 Git 写入。

2026-08-19 追加修正：审计发现真实项目的 15 秒输入将七个句子等同处理，包含“第一张图为人物原型、第二张图为场景、生成视频”的控制说明也进入了最后一个 MotionBeat。现已修正：参考图说明仅服务于角色解析；状态和文学解释成为有限视觉锁；混合句保留可执行动作，同时拆出状态与禁止项；明确禁止项在锁预算内优先；动作数量按真实可见动作而非原文句数限定。针对性回归已通过，恢复 `READY_FOR_AUDIT`。

2026-08-19 修正验收证据：

- `packages/domain`：28/28；覆盖控制说明剥离、用户图片职责、混合动作句保留、状态/禁止项视觉约束和状态迁移回归。
- `packages/creative-planning`：10/10；覆盖茅山类素材说明不进入剧情、动作节拍、视觉锁、Prompt 顺序/哈希，以及混合句不丢动作。
- `apps/workflow-worker`：11/11；规划快照、资料事实包和规划失败路径通过。
- `apps/production-worker`：22/22；动作计划快照、Provider 输入边界和失败恢复通过。
- `packages/provider-video`：36/36；Prompt 编译、参考图 1-7 张、profile 上限和协议错误归一化通过。
- 串行根回归 `pnpm -r --workspace-concurrency=1 --if-present test`：全量通过；仅既有服务条件测试按环境跳过。根 `pnpm typecheck` 与 `pnpm build` 通过，构建仅保留既有 Nuxt `DEP0155` 警告。

本轮未发起真实 Provider、视觉模型、Veyra、VPS、SSH、DNS、部署、付费调用或 Git 写入。独立审计仍待完成，当前不得标记 `ACCEPTED`。

独立审计待核：需要复核旧快照兼容、TaskRun 快照不可变、Worker 重启不重复提交、跨工作区隔离，以及公开契约脱敏证据后才能标记 `ACCEPTED`。外部边界仍不授权真实 Provider、Veyra、共享积分、VPS、SSH、DNS、TLS、部署、付费调用或 Git 写入。

### C11.6：真实镜头分段与运镜稳定性

2026-08-22 C11.6 semantic camera-boundary revision：自动编排不再只识别显式“转场”词，也不把动作数量直接当成生成片段数量。对话/情绪落点、特殊视觉变化、地点/时间变化和叙事连接词进行保守评分，15 秒以内达到阈值时最多拆成两个有依赖的片段；普通连续动作继续保留为一个片段并由 MotionBeat 承担时间轴。茅山模式实测规划为 8 秒 + 7 秒、多机位；普通“进入-观察-取资料-交给同伴”实测保持单段。Creative Planning 16/16、Workflow Worker 13/13、Production Worker 22/22、Control API 33 passed/1 existing skip、typecheck 与 build 通过；未执行新的真实 Provider、Veyra、VPS、部署或 Git 写入。C11.6 仍为 `READY_FOR_AUDIT`，等待独立审计。

状态：`ACCEPTED`

实施日期：2026-08-21

设计依据：`doc/AI企业内容平台_C11.6真实镜头分段与运镜稳定性开发设计.md`。

范围：将复杂叙事中的多个运镜节拍提升为真正的 `GenerationSegment`，复用 huobao-drama、Seedance-2.5、OpenMontage 和现有 Sub2API ProviderPort 的成熟语义。前端不增加工程参数；本地默认 Mock；不触碰真实 Provider、Veyra、VPS、SSH、DNS、部署、付费调用或 Git。

当前门禁：文档、代码和本地测试已完成。规划分段、Prompt 4096 字节保护、TaskRun 快照一致性、Mock 三片段 E2E 均已通过；现进入独立审计，审计通过后才能标记 `ACCEPTED`。

2026-08-21 实现证据：复杂 15 秒输入已由规划器拆为 3 个 5 秒 `GenerationSegment`；每段保存独立 PromptPackage、依赖序列、唯一主运镜和起止状态。Workflow Worker、Provider runtime 和生产快照保持私有边界，旧 MotionPlan 仍可解析。Creative Planning 13/13、Provider Video 39/39、Workflow Worker 13/13、Production Worker 22/22、串行全仓测试、根 typecheck/build 通过；构建仅有既有 Nuxt `DEP0155` 警告。隔离 C12 Mock E2E（3631/3632/3633）通过，覆盖三片段生成、QC/交接、合成、播放、下载、脱敏和清理。当前进入独立审计，未执行真实 Provider、Veyra、VPS、部署或 Git 写入。

2026-08-21 C11.6/C12.1 corrective audit revision：上述“复杂 15 秒固定拆为 3 个 5 秒片段”实现已标记为 `SUPERSEDED`，不再作为当前规则或验收依据。根因是把 MotionBeat/运镜节拍误当成 Provider 生成单元，造成相邻片段重复建立场景；同时，`UNAVAILABLE` 评估默认创建 BLEND 修复没有语义依据。当前规则恢复为：15 秒以内默认一个 Provider 片段，动作和运镜保留在同一段的时间轴；超过 15 秒按能力上限最少拆分，只有明确编辑性场景切换才额外拆分。交接 Prompt 使用已验收尾部状态作为连续性参考，禁止重演前段动作，不承诺逐像素首尾一致。`UNAVAILABLE` / `FAILED` 只写 `NEEDS_ATTENTION` 并直切，不创建 `TransitionRepair`；明确 `BLEND` / `BRIDGE_REQUIRED` 才允许修复。Creative Planning 14/14、Domain 32/32、Workflow Worker 13/13、Production Worker 22/22、Persistence 19 通过/8 个既有数据库门控跳过、Studio 33/33、Studio typecheck、隔离 `C12_E2E_RUNTIME_PORT=3533` 浏览器与数据库 E2E 均通过；E2E 断言 18 叙事点/30 秒为 2 个 15 秒片段、1 个边界 Review、0 个不可用评估修复，并完成播放、下载、脱敏和清理。未执行新的真实 Provider、Veyra、VPS、部署或 Git 写入。C11.6 保持 `READY_FOR_AUDIT`，待独立审计复核后再决定 Exit Gate。
### C11.6/C12.1：参考仓库能力吸收独立审计

状态：`ACCEPTED`

实施/审计日期：2026-08-23

逐文件复核 Huobao `storyboard-breaker`、Seedance `long-video`/`editing`/`prompting`、OpenMontage `source_media_review`/`variation_checker`/`final_review`/`video_stitch`，并核对本地 sub2api-video-mcp 协议登记与离线 certifier 夹具。高价值规则已通过薄适配吸收：对白时长与段内子镜头进入私有 MotionPlan；时间轴、起止状态、连续性锁、参考归属和物理转场进入 Prompt/交接编排；ffprobe、音频探测、首尾帧、重复镜头审计、音频保留及时长校验进入 Media Runtime/QC；三段式视频协议由现有 adapter/fixtures 保持。

兼容性复核通过：新增字段可选，旧 MotionPlan/TaskRun/运行时 JSON 仍可解析；镜头审计只输出安全连续性提示，不改变用户输入、Provider 调用数或公开 DTO；未认证 Provider 能力、transcript 和视觉语义 evaluator 显式降级为 unavailable/needs attention，不伪造实现。

证据：Creative Planning 19/19、Contracts 31/31、Production Worker 22/22、Production Worker typecheck、Media Runtime 10/10、根 typecheck/build、diff check 通过（仅既有 Nuxt DEP0155 与 Windows 换行提示）。未执行真实 Provider、Veyra、VPS、DNS、部署、付费调用或 Git 写入。

Exit Gate：`ACCEPTED`。后续仅在有新的来源证据或用户明确需求时新增适配。

### C11.6/C12.1：真实成片背景漂移修正复核

日期：2026-08-23

根因：当前真实 profile 的 4,096 字节出站压缩只保护了对白、机位和起止状态，长 Prompt 中的 `Scene lock` 与禁止背景变化约束可能被丢弃，导致上游模型在个别帧重新解释场景；参考素材上传、relay、ProviderAttempt 和下载链路均正常。

修正：压缩器将场景锁和禁止变化契约提升为与对白、机位、起止状态相同的受保护指令。新增 42/42 Provider Video 回归；没有新增公开字段或项目专用背景规则。

真实复核：固定 `video.aiself.vip` relay 下重新生成茅山项目最新两段规划；两次 ProviderAttempt、两条 TaskRun、两段 ProductionSegment 均成功，最终成片合成 QC `PASS`，总时长约 15 秒。连续性仍按现有语义评估规则记录 `NEEDS_ATTENTION`，未伪造视觉语义通过。

结论：修正具有跨项目通用性，保持旧快照兼容和真实 Provider 边界；本项复核通过。

### C11.6/C12.1：MotionBeat 片段内时间轴与直切降级独立审计

状态：ACCEPTED

实施/审计日期：2026-08-23

本轮复核确认：15 秒以内普通连续动作保持一个 Provider 片段，MotionBeat 在该片段内覆盖从 0 到目标时长的连续时间轴；超过 15 秒按 ceil(duration / 15) 做最少分段；显式编辑性场景切换或保守语义切点评分达到阈值时最多增加一个短内容片段。动作数量、换手、运镜和多镜头描述本身不增加 Provider 调用。交接 Prompt 只引用前段验收尾部状态并禁止重演已完成动作。

C12.1 评估结果为 PASS 时直切，明确 BLEND/BRIDGE_REQUIRED 才创建受控本地修复；UNAVAILABLE/FAILED 只持久化 NEEDS_ATTENTION 告警并直切，未创建 TransitionRepair。

兼容与边界复核：GenerationSegmentMotionPlanSchema 的新字段（包括对白时长）均为可选，旧 MotionPlan JSON 可解析；Workflow/Production 快照使用冻结的 MotionPlan 与 hash，不在 Worker 重启时重新编排；公开 OpenAPI/SSE 不含 Prompt、MotionBeat、camera contract、Provider 或对象存储字段，内部 AsyncAPI 保留诊断字段仅供服务间使用；workspace/project 查询仍在 Repository 条件内完成。未修改历史 TaskRun、VideoVersion、公开 API 或外部系统。

验证证据：Creative Planning 18/18、Domain 11/11、Production Worker 13/13、Contracts 28/28、Provider Video 17/17、Workflow Worker 10/10、Persistence 18 通过/1 个既有 PostgreSQL 门控跳过；六个受影响包 typecheck 通过；旧 MotionPlan 直接兼容解析通过。隔离 C12 E2E 在本轮因默认用户服务占用 3433 且两次 3531/3532/3533 runner 超时未取得新输出，但历史同版本隔离 E2E 已通过并覆盖 18 叙事点/30 秒两段生成、边界 Review、0 个不可用评估修复、播放下载和清理；本轮确认隔离端口已释放，未触碰 3433 用户服务。

外部边界：未执行真实 Provider、视觉模型、Veyra、VPS、SSH、DNS、TLS、部署、付费调用或 Git 写入。

审计人：Codex

Exit Gate 结论：ACCEPTED。

### C12.2：OpenMontage 终检与真实成片质量门禁

状态：`READY_FOR_AUDIT`

实施日期：2026-08-23

设计依据：`doc/AI企业内容生产平台_C12.2_OpenMontage终检与真实成片质量门禁开发设计.md`、OpenMontage `final_review.schema.json`、`source_media_review.py`、`variation_checker.py` 与现有 C12 Media Runtime/Production Worker 契约。

实施范围：新增私有 `FINAL_REVIEW_VIDEO` 工具和内部 `/internal/v1/media/final-review` 边界；对最终 MP4 做技术探测、四点代表帧抽样、黑帧/音频检查，并把语义承诺、转写/字幕和视觉语义能力不可用明确记录为 `UNAVAILABLE`。规划阶段另以私有 mapper 接入 OpenMontage `variation_checker` 与 `slideshow_risk` 的原始检查阈值。Production Worker 在写入不可变成片前执行终检；技术失败或 `BLOCK` 不发布，`NEEDS_ATTENTION/PRESENT_WITH_REVIEW` 只发布安全摘要并保留内部详情。公开 DTO 不暴露 Prompt、Provider、对象 key、临时路径或原始响应。

测试证据：Media Runtime Python 12/12；Production Worker 23/23；Production Worker typecheck；Persistence typecheck/test/migration；Contracts build。组合回归证明 `NEEDS_ATTENTION` 不会被误写成 `PASS`。

真实验收证据：本地全栈使用 `VIDEO_PROVIDER=sub2api`，对无参考图的“奇幻漫剧”15秒版本执行一次真实生成。既有 ProductionRun `prd_01M0P1844Q33F97DQ3BMZAG7FP` 和本轮复验 `prd_01M0PFYX4R1QV8VBCD0QK6271T` 均 1/1 分段成功；复验成片资产 `ast_01M0PG0VHY7RN3T29JWXRRK5FE` 为 15.042 秒、848x480、24fps、H.264/AAC 双声道；四点抽样无黑帧，最终 QC 为 `NEEDS_ATTENTION`，原因仅为语义 evaluator 与转写器未配置，推荐 `PRESENT_WITH_REVIEW`。产物路径：`.codex-longrun/media-review/c12.2-real-final-rerun.mp4`，接触表：`.codex-longrun/media-review/c12.2-final-rerun-frames/contact.jpg`。

未完成项与风险：本轮已通过受控 SSH 反向隧道恢复固定 `video.aiself.vip/provider-input/` relay，并完成一次 2 段真实参考图生成；relay 不是平台代码的持久进程，正式部署仍需按 C13-A 运维方案持久化。OpenMontage 的视觉语义能力只认证到 CLIP 关键帧分类，不宣称逐像素连续性；没有绑定脚本文本时，转写虽可运行但脚本比对仍返回 `UNAVAILABLE`。技术 QC 已达标，完整语义质量仍不能宣称自动通过。

审计人：Codex

Exit Gate 结论：实现与真实技术验收证据齐全，进入独立审计；在 evaluator/transcriber 能力认证前保持 `READY_FOR_AUDIT`，不得标记 `ACCEPTED`。

### C12.3：来源转写与语义终检适配

状态：`READY_FOR_AUDIT`

实施日期：2026-08-23

设计依据：`doc/AI企业内容生产平台_C12.3来源转写与语义终检适配开发设计.md`、OpenMontage `tools/analysis/transcriber.py`、`tools/video/video_compose.py` 与 `tools/analysis/video_understand.py`。本轮只迁入来源已有的 faster-whisper CPU/int8、VAD、word timestamps、语言/时长输出、CLIP 关键帧分类，以及原始 token 清洗、标点泄漏和 0.9 词准确率比较逻辑。

实现证据：Media Runtime 新增内部 `/internal/v1/media/transcribe` 与 `TRANSCRIBE_VIDEO` DTO；Production Worker 客户端只发送受限 MP4 bytes 和 SHA-256，不发送路径、对象 key 或浏览器字段。依赖不存在、模型执行异常或没有脚本时明确返回 `UNAVAILABLE`，不伪造语义通过，不改变 C12.2 的 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW` 语义。

验证证据：Media Runtime Python 17/17、Production Worker 24/24、Contracts build、Production Worker typecheck、root typecheck/build 均通过。受控本地运行时安装 faster-whisper 1.2.1、CPU torch 2.13.0 与 `openai/clip-vit-base-patch32`，对真实 15 秒成片完成中文转写（语言 `zh`、词级时间戳）和四点 CLIP 关键帧分类，`FINAL_REVIEW_VIDEO` 返回 `semantic_evaluation=CHECKED` 且无语义问题。另以真实参考素材执行 `prd_01M0PXQD9S62GT01SXHGDJ44RH`，2/2 分段 `ACCEPTED`。

毕业复验：再次使用同一最新批准 storyboard 执行 `prd_01M0PZAVX04829F439K8WZAF6Q`，2/2 分段 `ACCEPTED`；最终资产 `ast_01M0PZEE4P91J6JE47NK1TP5MN` 为 15.125 秒、848x480 H.264/AAC 双声道。抽帧显示场景、服装和人物主体稳定，镜头由远至中至近有明确变化；音频平均音量 -26.7dB、峰值 -4.5dB。ProductionRun 仍按设计保留 `NEEDS_ATTENTION`，因为视觉承诺和逐像素连续性不是 CLIP 关键帧分类可以虚构的能力；对白比对现在由后台自动上下文驱动。

自动绑定修正：Production Repository 现在从已批准 Creative Brief 自动抽取明确标记的对白/旁白，Worker 以 UTF-8 Base64 私有头传给 Media Runtime；用户不需要选择或绑定脚本。纯画面描述、故事梗概和营销文案不再作为应说出的台词；没有明确声音意图时不执行台词匹配。旧事件没有上下文时仍显式降级，且不会把长文直接放入 HTTP 头。

对白判定复核：Huobao `storyboard-breaker` 只对分镜中显式对白/旁白计算台词时长，Seedance 规则要求声音意图明确声明；参考仓库没有把整段叙事自动视为对白的机制。平台已撤掉此前“无对白时回退整段原始想法”的错误兼容路径，并新增持久化回归覆盖引号对白、旁白提示和纯视觉叙述三类输入。纯视觉叙述的终检状态为 `NOT_EXPECTED`，不会再报虚假的 0% 台词匹配。

兼容与边界：Transcript 字段全部为内部/可选扩展，旧运行时响应和旧快照可解析；公开 API、SSE、Provider、Veyra、VPS、DNS、TLS、部署和 Git 均未改变。视觉语义 evaluator 仍是独立的 `UNAVAILABLE` 能力，不以转写适配替代视觉判断。

审计人：Codex

Exit Gate 结论：来源适配、运行时认证、真实参考图链路和回归测试完成；保持 `READY_FOR_AUDIT`，唯一未自动宣称通过的边界是明确对白与实际人声不匹配时的内容复核，以及 CLIP 不代表逐像素连续性。

### C12.3 最终复核补充（2026-08-24）

- 来源规则复核：huobao-drama 的 storyboard-breaker 与 Seedance-2.5 的 sound-intent 只把明确写出的对白、旁白或配音作为语音预期；纯视觉叙述不得被当作台词。
- 兼容修正：自动脚本上下文只从引号对白或明确语义提示提取；没有对白时 Media Runtime 返回 `NOT_EXPECTED`，不再制造“匹配度 0%”误报。公开 DTO、Provider、Worker 和 Media Runtime 边界保持不变。
- 独立验证：Contracts 31/31；Persistence 23 pass/8 existing skips；Media Runtime 19/19；Production Worker 25/25；typecheck、状态校验和 diff 检查通过。
- 真实复验：首轮片段生成及段 QC 成功，但合成因 `MEDIA_RUNTIME_UNAVAILABLE` 失败；重建契约依赖并重启正确 Worker 后，复用同一已批准分镜完成 `prd_01M0QPBH4BX85RGF6HWCF7HKN1`，1/1 段成功，15.042 秒 848x480 MP4 可播放且含 AAC 音频。对比旧样片，人物、服装、庭院和拂尘保持稳定，多机位推进仍在；本次实质提升是来源一致的终检语义，不宣称 Provider 视觉质量已因该修正普遍提升。

### C12.4：连续旁白轨道与分段视频音频编排实现审计

状态：`READY_FOR_AUDIT`

实施日期：2026-08-25

设计依据：`doc/AI企业内容生产平台_C12.4连续旁白轨道与分段视频音频编排开发设计.md`；OpenMontage `video-stitching.md`、explainer `compose-director.md`；huobao-drama 分镜/视频提示词技能；Seedance-2.5 `long-video.md`。

实现范围：

- `MediaRuntimeCompositionPlan` 增加可选 `audio_policy`，支持 `LEGACY_PRESERVE` 与 `CONTINUOUS_NARRATION`；旧 `ALCHMED1` 和 `ALCHMED2` 二进制 bundle 继续按旧行为解码。
- 新的带有效完整脚本的 ProductionRun（单段或多段）由 Persistence 生成 `CONTINUOUS_NARRATION` 计划；无脚本/历史任务继续 `LEGACY_PRESERVE`。
- 新增 `ALCHMED3` 内部 bundle 标记。连续旁白模式中，Media Runtime 对片段音频执行边界静音清理，采用顺序 concat，不在口播边界使用会截断音节的 acrossfade，最后按目标总时长 pad/trim。
- 该阶段没有伪造独立 TTS Provider；连续轨道由已生成片段口播音频重组成单条最终音轨，后续可在同一 AudioPlan 位置接入独立 narration Asset。
- 公开 DTO、SSE、Provider 请求、对象 key、密钥和历史资产均未扩大或改写。

测试证据：Contracts 31/31；Production Worker 26/26；Production Worker typecheck/build；Persistence 23 通过、9 个 PostgreSQL 条件跳过；Media Runtime Python 23/23（含连续策略不使用会截断段内停顿的 `stop_periods` 回归）；`pnpm contracts:generate` 后契约导出无漂移；`git diff --check` 通过。

兼容性审计：

- 旧无计划 bundle：保持来源音轨原样拼接。
- 旧历史 ProductionRun：没有 AudioPlan 时不重混、不覆盖、不重新提交 Provider。
- 新连续旁白路径：只接管被标记为 Provider dialogue 的片段音频；用户源音频、环境声、音乐和音效的所有权规则仍由后续 AudioPlan 扩展承载。
- TaskRun 状态矩阵、Provider request ID 恢复、交接帧、C12.1 画面 PASS/BLEND/BRIDGE_REQUIRED 语义均未改变。

缺陷修复证据：首轮连续策略真实合成曾因 HTTP bundle gate 未接纳 `ALCHMED3` 返回 `MEDIA_RUNTIME_UNAVAILABLE`，未重复提交 Provider；随后修复入口并完成真实端到端复验。修复前的离线输出在约 10.68 秒后出现 19.46 秒静音，根因是 `silenceremove stop_periods=1` 在每段第一次自然停顿处截断后续台词；改为首尾双向 `areverse + silenceremove` 后，3 段真实 Provider 任务重新合成成功，VideoVersion `vvr_01M0TQ6T7047Q7FZ99J6VFZHS7`，30.126 秒、848x480、AAC。

时长/对白诊断与修复：30 秒文案原先被机械规划为 3x10 秒；第三段 36 字对白仅有 10 秒预算，且第二段 Provider 实际无可识别口播，合成终检覆盖率降至 52%。规划器现按“最少 Provider 段数 + 每段对白字符时长下限 + 单段不超过 15 秒”选择 2x15 秒；编译器把 `AUDIO PRIORITY` 和逐字台词契约提升到提示词首部，并按 huobao storyboard-breaker 源规则保留对白缓冲 `字数 / 4.5 + 2s`。真实复验 `prd_01M0TSHB4KKDQM9GMRXNA5800K` / `vvr_01M0TSRB26BK3WE4XKXWTY6SCM` 完成 2/2 段，30.084 秒；两段及合成视频的脚本终检均为 `transcript_matches_script=true`、`word_accuracy=1.0`。

音画不同步复核：前一版连续音频使用双向 `silenceremove`，会改变 Provider 原始音频相对画面的时间轴，并可能削弱首尾音节。现已移除该裁剪；`CONTINUOUS_NARRATION` 只执行 `aresample + concat`，保留每段原始音频与对应画面的时间关系。使用同一批真实 Provider 原片重新合成 `c124-sync-preserved-compose.mp4`，30.084 秒，脚本终检仍为完整匹配、ASR 1.0，且未再发生合成器切音。该输出是媒体 Runtime 隔离复验结果，未重复提交 Provider。

BGM 混音实现与真实复验：新增 `ALCHMED4` 受控 composition bundle。Worker 只从当前工作区、当前项目中 `metadata.audio_role=MUSIC` 的 READY `AUDIO` Asset 读取音乐字节，Media Runtime 按 OpenMontage `full_mix` 思路执行音乐淡入/淡出、旁白 `asplit` sidechain ducking、目标时长裁剪和 `loudnorm`，不接受本地路径或 URL。离线证据为 Production Worker 27/27、Media Runtime 29/29；首次真实合成暴露了重复消费旁白滤镜标签的问题，已按 OpenMontage `asplit` 模式修复并重新构建整栈。第二次真实复验使用音乐资产 `ast_01M0WPSSXBCJ9QBS0VTK9GC43T`，生产任务 `prd_01M0WQHZYM3HK8MFB1FD0VRC8H`，VideoVersion `vvr_01M0WQSYQNHHJZ28J391FQKJPY`，30.084 秒、848x480、AAC，任务 `SUCCEEDED`。输出文件为 `.codex-longrun/media-review/local-30s-bgm-prd_01M0WQHZYM3HK8MFB1FD0VRC8H.mp4`；ffprobe 确认单条最终混音 AAC 音轨，响度检测 `mean_volume=-20.0 dB`、`max_volume=-9.4 dB`，未出现超过 0.45 秒的长静音。该样本证明 BGM 已进入最终成片，但音乐创作 Provider 和前端音乐选择 UI 仍是后续能力，不宣称已完成自动选曲产品化。

参考素材与跨段道具复核：一次本地诊断脚本仍硬编码旧项目/旧 asset ID，造成诊断样本错误使用旧参考图；该脚本现改为只在显式传入 `CANARY_PROJECT_ID`、`CANARY_SOURCE_ASSET_IDS` 和可选 `CANARY_SOURCE_TEXT` 时切换项目/素材，不再把旧 ID 当作当前项目事实。另一次后台生成 `prd_01M0VBBRQGMA9CRCKMK3JEPFAT` 已携带最新的“禁止插入词”口播约束，但道具契约仅存在于源码、未进入当时的已编译 Worker 产物，故该次不会验证该契约。重新构建 `@alchemy-video/creative-planning`、重启本地栈后，真实复验 `prd_01M0VCEXSATY21J4FMVP4ZMMDG` / `vvr_01M0VCNW5529AWRTAGFXWFQCD8` 使用项目 `prj_01M0STQRM7SHPDTV2WR0QCBW8C` 的 6 张当前参考图；两段请求均记录 `PROP CONTINUITY CONTRACT`，第二段同时携带首段交接帧及当前参考图。成片为 30.084 秒、848x480、音频存在，脚本终检 `transcript_matches_script=true`、`word_accuracy=1.0`。道具的视觉一致性仍需人工观看确认，当前自动语义评估不证明逐帧道具一致。

新旧成片对比：旧版 `vvr_01M0TK4A0HS8CV24G1TB9W1DYK` 为 30.125 秒；修复后的新版本为 30.126 秒。两者均通过容器、视频、音频和脚本一致性检查；旧版在段间/尾部可检测到 5 秒级静音，新版不再发生段内首次停顿导致的整段截断，但仍可能因 Provider 片段本身的口播长度不足而在目标时长末尾保留画面无声区。该剩余问题属于“独立 narration Asset/智能时长分配”范围，不能伪称已由本次重组完全解决。

未完成项与风险：当前本地 profile 没有独立 TTS/narration 资产生成器；本实现先把各段真实口播音频重组成单条最终音轨，需通过人工观看确认口型与画面动作时间是否仍匹配。若旁白资产或音频语义评估不可用，不能宣称完整连续口播质量已自动通过。

审计人：Codex

Exit Gate 结论：代码、契约、兼容路径、离线测试和受控真实样本已完成；连续策略已修复首轮真实样本发现的音频截断问题。由于独立 narration Asset、智能时长分配和人工画面审查仍未完成，保持 `READY_FOR_AUDIT`，不标记 `ACCEPTED`。

### C12.5：口播语速优先与弹性总时长编排复验

状态：`READY_FOR_AUDIT`

实施日期：2026-08-25

来源与复用：直接复用 huobao-drama `storyboard-breaker` 的 8–15 秒段界、台词容量估算和语义边界拆分；复用 Seedance-2.5 的连续声音/端点约束；复用 OpenMontage 的“实际旁白优先、剩余时间由视觉承载”规则。本轮只改现有 `DeterministicPlanningModel` 和 Prompt Compiler，没有新增 Provider、TaskRun 或公开 API。

代码证据：规划器在有明确口播时按台词容量选择最少 Provider 段数，禁止目标 30 秒机械触发 3 段；每段仍保持现有 8–15 秒能力边界。口播段提示词明确逐字、自然一致语速、禁止慢放/重复/填充词；剩余时间仅允许动作、环境声或干净视觉尾拍；纯视觉段不再携带跨段口播连续性指令。现有总时长契约保持不变，避免破坏 `assertStoryboardPlan` 的状态和持久化边界。

离线验证：Creative Planning 27/27、Provider Video 43/43、Production Worker 26/26、Media Runtime Python 24/24；相关包 build/typecheck 通过，`git diff --check` 无错误。

真实验证：本地全栈 `VIDEO_PROVIDER=sub2api` 使用项目 `prj_01M0STQRM7SHPDTV2WR0QCBW8C` 当前人物/场景参考素材和完整中文口播。首轮固定域名因不持有本地 MinIO 资产而按预期失败并归一化为 `PROVIDER_UNAVAILABLE`；随后使用仓库既有临时 HTTPS reference-delivery tunnel 重跑。生产任务 `prd_01M0VHSW8NFECH4FWBSBZ4PHY8` 状态 `SUCCEEDED`，2/2 段接受，30 秒总计划，每段 Provider 请求为 480p、16:9、15 秒；产物为两个 848x480、约 15.042 秒 MP4。该结果证明新版规划和真实 Provider 链路均已生效。

兼容与剩余风险：当前真实入口尚无独立 TTS narration Asset，因此“视觉尾拍”由同一 Provider 段承载，不能宣称已实现跨段独立旁白的完整自动对齐；ProductionRun 的连续旁白和最终人工观看仍保持 `READY_FOR_AUDIT`，不标记 `ACCEPTED`。本轮未改 VPS、Veyra、DNS、TLS 或部署。

审计人：Codex

Exit Gate 结论：来源规则已落代码，离线回归和真实参考图 Provider 复验通过；保持 `READY_FOR_AUDIT`，待独立审计员确认后再进入 `ACCEPTED`。

### C12.6：源仓库能力完整吸收与兼容优化复验

状态：`READY_FOR_AUDIT`

实施日期：2026-08-25

设计依据：`doc/AI企业内容生产平台_源仓库能力完整吸收与兼容优化方案.md`；Huobao storyboard-breaker/video-prompt、Seedance-2.5 prompting/long-video、OpenMontage script Artifact、verify_scene_pacing 与 explainer EP。

实现证据：

- `StoryboardShotSpec`、`MotionBeat` 和 `GenerationSegmentMotionPlan` 增加可选 source binding、reference anchor、narration cue 与 `voice_performance` 字段，旧 snapshot 仍可解析。
- Planner 移除按片段序号固定的“侧向跟拍/推近/环境反打”数组，改为从可观察源事件推导一个主运镜；同一源动作不再凭空增加第二运镜。
- Prompt Compiler 记录 source reference anchors 和 voice performance contract；Worker reference delivery 同时返回 URL 与语义 role 顺序，保持 Prompt image 编号和 Provider 临时输入一致。
- Media Runtime 新增 `check_narration_alignment`，复用 OpenMontage 的 gap/overlap/scene overflow 与 `±0.5s` 对齐原则；无 cue/landmark 时明确返回 `UNAVAILABLE`。

验证证据：Creative Planning 27/27；Provider Video 43/43；Production Worker 26/26；Task Worker 32 通过、5 个已有 BullMQ 条件跳过；Media Runtime Python 26/26；Contracts 31/31；相关包 typecheck/build 通过；`pnpm contracts:generate` 后契约导出无漂移。

二次审计：未发现旧固定运镜数组、公共 DTO 泄露 Provider URL/密钥、旧 snapshot 不兼容或新增字段穿透错误。参考图 role 仍是内部语义，不改变公开 `ReferenceBinding.role` 枚举。真实独立 TTS 时长反馈仍未实现，按设计保持后置，不把估算时长冒充实际时长。

真实 Provider 复验补充：首轮运行暴露固定 `video.aiself.vip` reference relay 当前不可达，任务在提交前按预期归一化为 `PROVIDER_UNAVAILABLE` 且没有 Provider request ID；随后发现 Control API 对已由 Workflow 编译的 PromptPackage 又追加了一次对白契约，已增加幂等保护和回归测试。使用临时 HTTPS relay 重启新构建后，复用同一生产批次显式重试，任务 `prd_01M0VNZQGE0QX4BPG1V5XA0NTJ` 最终 `2/2 ACCEPTED`、`SUCCEEDED`；VideoVersion `vvr_01M0VPWYNKZ856K1ET8C2PM59X`，Asset `ast_01M0VPW84SVGJ3V286YET29SP6`，30.084 秒、848x480、H.264/AAC、双声道 48kHz，下载 9,608,908 bytes。Media Runtime 技术终检通过，四点抽样无黑帧、无异常静音；语义 evaluator/transcriber 当前未配置，最终状态保持 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW`，不虚构人物/场景/逐字口播自动通过。

审计人：Codex

Exit Gate 结论：文档、代码、契约、测试和冲突处理已完成；保持 `READY_FOR_AUDIT`，真实 TTS feedback loop 是明确后置项，不阻塞本轮 Provider 质量取样。

### C12.6-E：台词结束后的视觉尾段声音边界复验

状态：`READY_FOR_AUDIT`

实施日期：2026-08-25

来源依据：Huobao `prompt-generator/video-prompt/SKILL.md` 的无对白段使用环境/动作声；Seedance-2.5 `references/prompting.md` 的显式声音意图；OpenMontage `talking-head/compose-director.md` 与 `tools/video/silence_cutter.py` 的长静音标记和超过 5 秒建议缩短规则。

实现证据：

- `packages/creative-planning` 的完整对白契约新增 `POST-DIALOGUE SOUND POLICY`，尾段明确为 `SILENCE/AMBIENT-ONLY`，禁止继续对白、旁白、发声、口型同步和说话动作。
- MotionPlan 的既有 `prop_locks` 和时间轴文本同步携带该声音边界，未新增公开字段、Provider 状态或视觉模型。
- `packages/provider-video` 的兼容 Dialogue contract 同步追加无对白视觉保持和稳定结束姿态约束。
- `services/media-runtime` 继续保留大段异常静音判定，并对单个超过 5 秒长静音添加源仓库式质量提醒，不把有意视觉 hold 伪造为技术失败。

验证证据：Provider Video 44/44；Creative Planning 27/27；Media Runtime Python 27/27；类型检查通过；`git diff --check` 无错误（仅既有换行符提示）。

真实样本复核：`c126-real-prd_01M0VNZQGE0QX4BPG1V5XA0NTJ.mp4` 的尾段从约 22.86 秒至片尾约 7.2 秒无语音而人物仍有口型/动作，确认原问题是“视觉尾拍已有但声音边界未编译”为机制缺口；本轮只补来源规则和回归，不重复消耗真实 Provider 调用。

冲突处理：不删除源仓库允许的视觉呼吸时间，不把所有静音一律判错；按 OpenMontage 的做法保留可审阅的视觉 hold，同时要求明确非说话画面，历史快照和 `LEGACY_PRESERVE` 行为不变。

审计人：Codex

Exit Gate 结论：源仓库应对机制已吸收，代码和测试通过；保持 `READY_FOR_AUDIT`，口型逐帧语义评估仍因本地缺少视觉模型而未宣称自动通过。

真实效果复验补充：重启新构建并使用正确的 Control API HTTPS reference relay 后，真实 Provider 生产任务 `prd_01M0WJH86AY5SYDFZWRCET5ET9` 成功，2/2 段 `ACCEPTED`，VideoVersion `vvr_01M0WJS3PNEPQF3QD0Z078GWJY`，30.084 秒、848x480、H.264/AAC，下载 9,058,796 bytes。新片尾 `28.3324s-30.1013s` 静音约 1.77 秒；27–29 秒抽帧为无人出镜的场景空镜，未复现旧版最后两秒人物继续张嘴和无意义动作。该结果说明新增的无对白尾段策略已在真实 Provider 上生效，但 Provider 仍属于随机模型，保留人工复核要求。
-
### C12.4/C12.5 恢复复验补充（2026-08-29）

- 从中断会话恢复后补齐音频导入 `selection_hint`，保存受限检索风格到项目音乐资产元数据；自动选曲评分读取该字段，公开搜索结果仍不暴露导入命令字段。
- Control API 45/45、Contracts 31/31、Studio 35/35、Production Worker 26/26、Media Runtime Python 32/32、根级 typecheck/build 和契约导出均通过；构建仅保留既有 Nuxt DEP0155 警告。
- 重启本地 Media Runtime 后，使用既有两段 MP4 与已授权 BGM 完成纯 loopback `ALCHMED6` 合成，输出 30.084 秒、848x480、H.264/AAC、48kHz 双声道，-14.0 LUFS、-1.5 dBFS；没有新 Provider 请求、TaskRun、计费或外部部署操作。
- C12.4/C12.5 仍保持 `READY_FOR_AUDIT`，独立 narration Asset、逐帧口型/语义质量和人工成片审查仍是明确的后置审计边界。
-
### 保险AI介绍完整制作失败修复复验（2026-08-29）

- 项目 `prj_01M14H87JKQV2PJHRQ70JFX7FQ` 的 `prd_01M14HKSNY3K0YHR6ZTST0E5FN` 诊断确认：3/3 分段 `ACCEPTED`、3/3 技术 QC `PASS`；失败只发生在最终合成后的终检，首个真实异常为 `QC_FAILED` 黑帧检测（第 3 段约 8.875–9.583 秒，合成后约 28.958–29.667 秒）。
- 按 OpenMontage 允许的 0.5–1.0 秒 fade-through-black 规则，Runtime 将不超过 1 秒的短淡黑记录为 `NEEDS_ATTENTION` 而不阻断；超过 1 秒仍 `BLOCK`。Media Runtime Consumer 异常时释放 durable lease，避免 BullMQ 的 `BUSY` 重试覆盖原始 `QC_FAILED`。
- 规划器修复无引号 `口播文案` 区块识别，并使用原始换行提取对白。保险文案新规划实测为 2x15 秒，完整台词分为约 14.278 秒和 10.722 秒自然语速预算；不再按旧 3x10 秒硬塞末段。
- 旧 `历史成片03` 的 Prompt 属于不可变历史快照，未含显式对白契约，不能原地修写；其末段语言混乱与旧规划把视觉意图和口播混排、且末段容量不足相符。新版本必须重新规划/生成，旧分段不会自动重渲染。
- 复用三个已成功分段进行纯本地合成+终检得到 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW`，短淡黑约 0.708 秒且 `black_frames_detected=false`，证明不再触发 `FAILED/BLOCK`。未执行新的 Provider、Veyra、VPS、部署或 Git 操作。

### 工作区共享配乐曲库修复（2026-08-29）

- 根因：Studio 的项目详情资产列表和 Production Repository 自动选曲都带有 `project_id` 限定，导致其他项目导入的 READY 音乐无法显示或参与成片。
- 修复：新增受项目访问校验保护的 `GET /api/v1/projects/{project_id}/audio-library`，查询条件为当前 `workspace_id`、`AUDIO`、`READY`、`metadata.audio_role=MUSIC`；Studio 合并共享列表并按 ID 去重，Worker 自动选曲同步改为工作区查询。
- 边界：音乐对象仍按来源项目保存 `project_id` 和对象 key，仅在同一工作区复用；API 序列化继续隐藏 `object_key`，不同工作区不会返回资产。
- 验证：Contracts 31/31、Control API 45/45 加 1 个既有 skip、Studio 35/35、Studio typecheck、Persistence typecheck、Production Worker 30/30、根级 typecheck/build 均通过；重启本地全栈后保险项目实际返回 19 首共享音乐。未执行 Provider、Veyra、VPS、部署或 Git 操作。

### 保险项目口播完整性修复（2026-08-29）

- 对最新运行 `prd_01M14SHYWRWRHKG9VVPT2HJR8V` 的原始分段做实际转写：第 1 段只覆盖前半台词，第 2 段 `segments=[]`；问题不是拼接丢音，而是 Provider 生成的分段原声本身不可靠。
- 按 OpenMontage explainer 的“完整 narration 先生成、再进入合成”规则，Media Runtime 新增受保护的 Piper 本地旁白接口。Production Worker 从持久化的完整 `口播文案` 派生脚本，在合成前生成并校验 WAV，通过 `ALCHMED5` 传入；Provider 音频只保留为生成时的口型/画面参考，不再作为成片主口播。
- `deriveTranscriptScript` 现在识别无引号的 `口播文案/旁白文案/配音文案/对白文案` 区块，终检会真实比较该脚本；Runtime 对片尾不超过 2 秒的终端淡黑降级为提醒，片中黑帧仍阻断。
- 离线与本地验证通过：Media Runtime 36/36、Production Worker 31/31、Persistence 24/9、根级 typecheck/build；既有两段视频重合成得到 30.084 秒成片，ASR 覆盖率 86.7%，最终 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW` 而非 `FAILED/BLOCK`。未执行新的 Provider、Veyra、VPS、部署或 Git 操作。

### 保险项目真实验收补充（2026-08-29）

- 使用修复后流水线实际创建 `prd_01M14WJY4AMT4ET4KP92E1WQJP`，2 个 15 秒分段均由当前 `sub2api / grok-imagine-video-1.5` 成功生成并通过分段 QC；最终 `VideoVersion vvr_01M14WTRSJCVJW9JXQZMP5SDEN` 已保存，ProductionRun 为 `SUCCEEDED`。
- 最终成片 `30.084s`，H.264/AAC、48 kHz，BGM 已混入。faster-whisper 实际转写 4 段/66 词，完整脚本比较 `transcript_matches_script=true`；四帧技术抽样无黑帧。终检仅将约 13.1 秒计划性无对白视觉尾段标为 `NEEDS_ATTENTION/PRESENT_WITH_REVIEW`，没有阻断完整制作。
- 本次真实调用没有启用 Veyra 共享积分扣费，未改 VPS、DNS、部署或 Git 历史。

### 保险项目口播节奏与无口型错配复验（2026-08-29）

- 问题根因：原实现把 Provider 自带音频当作主旁白，并从片头单轨覆盖，导致第二段没有可靠口播；FFmpeg 的音乐时间门控默认只初始化求值，旁白结束后把中后段配乐错误静音。由于独立 TTS 与 Provider 人脸没有共同驱动，要求模型同时口播也必然造成口型错配。
- 实现：旁白改为 Piper 分段绝对时间轨道，保险文案在两个 15 秒视觉段中按 44/46 字均衡拆分；Provider Prompt 为纯画面契约，禁止可听语音、说话动作和口型，画面优先手部/侧后方/UI；音乐 `volume` 使用 `eval=frame` 并以 `amix=duration=longest` 贯穿成片；跨段逗号由 TTS 收束为句号。源文案剥离在原始换行文本中完成，避免误删后续画面描述。
- 质量边界：当前 Provider/平台没有受控的音素级驱动接口，因此不再对独立 TTS 宣称逐帧口型同步；该版本以“画面非说话 + 权威旁白”消除错配。未来若要真人正脸说话，必须接入可接受同一音轨或音素时间轴的口型同步模型，并增加逐帧验收。
- 验收：真实运行 `prd_01M15XZ7M20TE2ZYBHWS5H0DH4` 2/2 分段 `ACCEPTED`，最终 `vvr_01M15Y5EAPV4E14ZP0RNJW41NT` 为 30.084 秒、848x480、H.264/AAC；持久化终检 `PASS`，脚本转写匹配 `true`、准确度 `0.973`，无异常静音，-15.1 LUFS/-1.5 dB true peak，工作区共享配乐已混入。Creative Planning 28/28、Provider 44/44、Production Worker 31/31、Media Runtime 39/39 通过。

审计人：Codex

Exit Gate 结论：本轮真实项目已通过完整制作和音频终检；保留“无可控 lip-sync 模型时不承诺逐帧口型同步”的产品边界，章节继续 `READY_FOR_AUDIT`。

### 保险项目成片合成失败与无重生恢复复验（2026-08-29）

- 诊断对象：`prd_01M164Z8T9J03YWXV9SZS89D8V`。两个 `TaskRun`、ProviderAttempt 和分段技术 QC 均成功；失败仅在 `video_version.composition_requested` 的 Media Runtime 终检。持久化消费错误为 `QC_FAILED: 黑帧检测发现连续黑帧。Low transcript-to-script match: 0%.`。
- 根因：第一段末尾约 1.17 秒为黑底但中央存在 `JUNHE` 可见文字的片尾卡，旧 `blackdetect` 仅凭暗像素误判为无内容黑屏；脚本内数字与 `AI` 被 ASR 写成中文口语/同音字，旧比较器把语义等价读法误报为 0% 匹配。另发现 Windows 上 Uvicorn 监听子进程可能继承基础 Python，启动脚本此前只终止父进程，存在端口被旧服务接管的风险。
- 修复：Runtime 对黑场候选抽取三个内部帧，只有均为近全黑才阻断；深色文字/品牌卡改为 `NEEDS_ATTENTION` 提示。脚本比较增加中文数字口语规范化及既有缩写同音边界。启动脚本递归终止受管进程树，并为 Piper 指定本地解释器。
- 恢复契约：新增幂等 `POST /api/v1/production-runs/{production_run_id}/composition/retry`，仅适用于 `FAILED` 且所有片段 `ACCEPTED` 的运行；它恢复为 `REVIEWING` 并写新的 composition outbox 事件，不创建 Shot、TaskRun 或 ProviderAttempt。Studio 对该状态显示“重新合成成片”。
- 验收：实际调用该恢复端点后，运行转为 `SUCCEEDED`，生成 `vvr_01M168NT316KRM0GN53P7FCYP8`，30.084 秒、848x480、H.264/AAC；终检确认完整转写、无异常静音、-15.3 LUFS/-1.5 dB true peak。ProviderAttempt 数仍为 2，证明没有重提视频。Media Runtime 41/41、Domain 35/35、Contracts 31/31、Control API 45/45（1 个既有 skip）、Studio 35/35 通过。

审计人：Codex

Exit Gate 结论：成片失败现可在不浪费 Provider 调用的前提下恢复；真实黑屏仍阻断，深色文字卡保留人工复核提示。保持 `READY_FOR_AUDIT`。

### 源仓库全量迁入实施启动前决策阻塞（2026-08-29）

状态：`BLOCKED`

前置条件：已完成《源仓库全量能力迁入与冲突治理总实施设计》的编写和二次审计；本轮按长任务 supervisor worker 模式执行，没有启动新的 supervisor。

阻塞原因：P0 `C11.7/C12.7A` 将新增 DeliveryPlan/NarrationPlan、CapabilityProfile、VoiceAuthorization、PronunciationGlossary、BrandPolicy、BudgetReservation、CreativeDecisionLog、QualityGateDecision 等公共契约和状态机。设计文档第 11 节明确要求默认时长策略、样音审批、术语读法、云 TTS/Avatar、字幕、真实人声/头像/Logo 授权、预算上限和输出变体在写代码前由用户确认。按 AGENTS.md 第 13 节，这些属于不能自行假设的公开 API、状态和模块边界决策。

本轮验证：已读取 AGENTS.md、`.codex-longrun/state.json`、roadmap/progress/test-log/blockers、正式开发总控文档、章节审计记录和源仓库全量迁入设计；`git status --short` 显示大量既有未提交差异，未回滚、未暂存、未提交。

未执行事项：未修改产品代码、契约导出物、数据库迁移、Provider、Veyra、VPS、DNS、TLS、部署或 Git 索引；未运行产品测试，因为没有产品行为改动。

Exit Gate 结论：当前不能进入 P0 代码实现。用户确认第 11 节 8 个实施决策后，下一轮应先在正式总控文档注册唯一 `IN_PROGRESS` 章节，再补 ADR/契约/schema/事件并开始最小 P0 实现。

### C11.7/C12.7A：交付与语音预检基础

状态：`READY_FOR_AUDIT`

实施日期：2026-08-29

设计依据：`doc/AI企业内容生产平台_源仓库全量能力迁入与冲突治理总实施设计.md` P0、P1/P3 前置依赖、冲突裁决和第 11 节保守默认授权；新增 ADR-0053 至 ADR-0058。

当前范围：先实现 Provider 提交前的 Delivery/Narration preflight、授权、能力、预算、输出 profile 与质量 action 的最小契约、状态机和持久化事实。当前不启用真实 Provider、云 TTS、Avatar、Veyra、VPS、DNS、TLS、部署或 Git 写入。

实现文件：`packages/contracts/src/delivery-preflight.ts`、`packages/contracts/src/events.ts`、`packages/contracts/src/primitives.ts`、`packages/contracts/src/errors.ts`、`packages/contracts/src/specifications.ts`、`packages/domain/src/delivery-preflight.ts`、`packages/persistence/src/schema.ts`、`packages/persistence/src/delivery-preflight-repository.ts`、`packages/persistence/drizzle/0017_absurd_reptil.sql`、`apps/control-api/src/app.ts`、`apps/control-api/src/serializers.ts`，以及对应的契约、领域、schema 和 Control API 回归测试。新增内容包含预检实体契约、状态转换、workspace/project 作用域、幂等命令快照、内部安全事件和公开投影；默认路径不创建 TaskRun，不调用 Provider/Veyra。`

验证证据：

- `pnpm --filter @alchemy-video/contracts test`：32/32 通过；`contracts generate` 与 tracked export drift 通过。
- `pnpm --filter @alchemy-video/domain test`：41/41 通过。
- `pnpm --filter @alchemy-video/persistence test`：25 通过，9 个既有数据库服务门控跳过；schema contract 含 C11.7/C12.7A 新表和复合外键检查。
- `pnpm --filter @alchemy-video/control-api test`：46 通过，1 个既有服务门控跳过；新增路由覆盖创建、审批、阻断、重复请求、幂等冲突、事件数量和无 TaskRun 副作用。
- `pnpm typecheck`、`pnpm build`、`git diff --check`：通过；构建仅保留既有 Nuxt `DEP0155` deprecation warning，diff check 仅有既有 LF/CRLF 提示。

验收路径：已批准的 CreativeBrief/Storyboard 可创建 `AWAITING_APPROVAL` DeliveryPlan；批准后转为 `APPROVED` 并追加安全内部事件；非通用声音或 REQUIRED lip-sync 在本地未认证条件下转为 `PREFLIGHT_BLOCKED`；同一幂等键重放不重复创建计划或事件；整个路径不提交视频任务。

剩余边界：历史兼容的 ProductionRun 命令仍允许无 preflight 的旧调用；将 `delivery_plan_revision_id` 强制接入新的 ProductionRun/Provider submit 是后续 P1，完成前不宣称完整生产提交门禁。独立审计员确认前不得标记 `ACCEPTED`。

### C11.7/C12.7A P1：ProductionRun 与 Provider 快照接线

状态：`ACCEPTED`

实施日期：2026-08-29

实现提交或工作区快照：当前工作区快照；章节处于开发和审计阶段，未执行 Git staging、提交或推送。

修改文件：

- `packages/contracts/src/creative-planning.ts`、`packages/contracts/src/events.ts`、`packages/contracts/src/resources.ts` 及生成的 `contracts/` 导出物。
- `packages/persistence/src/schema.ts`、`packages/persistence/src/creative-planning-repository.ts`、`packages/persistence/src/delivery-preflight-repository.ts`、`packages/persistence/src/production-repository.ts`。
- `packages/persistence/drizzle/0018_shiny_scrambler.sql` 及对应 Drizzle snapshot/journal。
- `apps/control-api/src/app.ts`、`apps/control-api/src/index.ts`、`apps/control-api/src/serializers.ts`。
- `apps/production-worker/src/video-input-snapshot.ts`、`packages/provider-video/src/runtime-profile.ts`、`apps/studio-web/app/composables/useControlApi.ts`、`apps/studio-web/app/pages/projects/[project_id].vue`。
- 对应 Contracts、Persistence、Control API、Worker 和 Studio 回归测试；ADR-0059。

新增 API / 事件 / 数据库变更：

- `CreateProductionRunCommand` 要求 `delivery_plan_revision_id`。
- `ProductionRun`、`production_run.confirmed` 和私有视频输入快照保存可选的计划引用，以兼容历史事实。
- 新增 nullable `production_runs.delivery_plan_revision_id`；当前不声明反向数据库复合外键，生产创建事务以 workspace/project/storyboard 作用域查询、计划行锁和领域状态门禁保证一致性。
- `APPROVED` DeliveryPlan 在同一生产创建事务内转为 `CONSUMED`；幂等重放只返回原 ProductionRun，已消费计划不能被第二个运行复用。

测试命令与结果：

- `pnpm --filter @alchemy-video/contracts test`：32/32 通过；新增计划引用和公开确认事件投影回归通过。
- `pnpm --filter @alchemy-video/persistence test`：26 通过，9 个既有数据库服务门控跳过。
- `pnpm --filter @alchemy-video/control-api test`：46 通过，1 个既有服务门控跳过；C11.7 覆盖批准、消费、重放和重复消费阻断。
- `pnpm --filter @alchemy-video/production-worker test`：31/31 通过；Worker 快照保留计划引用。
- `pnpm --filter @alchemy-video/provider-video test`：44/44 通过。
- `pnpm --filter @alchemy-video/studio-web test`：35/35 通过；Studio typecheck 通过。
- 受影响包 typecheck/build、根级 `pnpm typecheck`/`pnpm build` 和 `git diff --check` 通过；构建只保留既有 Nuxt `DEP0155` 警告，diff check 只保留既有换行提示。

验收证据路径：

- `apps/control-api/tests/c11-creative-planning-routes.test.ts`
- `packages/contracts/tests/contract-export.test.ts`
- `packages/persistence/tests/schema-contract.test.ts`、`packages/persistence/tests/creative-planning-repository.test.ts`
- `apps/production-worker/tests/video-input-snapshot.test.ts`
- `.codex-longrun/test-log.md`

未完成项：

- 历史无计划 ProductionRun 行和旧确认事件保持只读兼容，未回填。
- C06 旧的直接 Shot 生成端点仍是历史兼容路径；新的 Studio 自动 ProductionRun 流程不经过该路径。
- 无 `DATABASE_URL`，Drizzle 事务集成测试按既有规则跳过；本轮未启动外部数据库。
- 旁白质量闭环、字幕、Avatar/lip-sync、共享扣费、多输出导出仍未完成。

风险与后续动作：当前计划引用的一致性由应用事务和行锁保证，数据库层没有反向复合外键；如需升级为数据库约束，必须另立 schema/迁移 ADR 并先解决循环表初始化与历史校验。下一章进入 C12.7B 本地 narration quality loop，继续保持真实 Provider、Veyra、VPS、DNS、TLS、部署和 Git 写入关闭。

审计人：Codex（独立源代码、契约和安全边界复核）

Exit Gate 结论：新公开 ProductionRun 命令已强制携带并消费批准 DeliveryPlan；确认事件、Worker 快照和 Studio 类型保留安全计划身份；workspace/project/status/幂等/历史兼容测试通过；章节 `ACCEPTED`。

### C12.7B：本地旁白质量闭环（历史审计快照，2026-08-29）

历史状态：`READY_FOR_AUDIT`

实施范围：在 C11.7/C12.7A P0/P1 事实之上，新增本地旁白脚本规范化、显示文案/播音稿分离、数字与时间规范化、术语表歧义门禁、样音批准、Piper provider facts、实测时长、TimelinePlan 绝对时间轴和 canonical transcript 私有质量事实。保持本地 Mock/loopback 边界，不启用云 TTS、Avatar、真实视频 Provider、Veyra、VPS、DNS、部署或 Git 写入。

实现文件：

- `packages/contracts/src/narration-quality.ts`、`packages/contracts/src/events.ts`、`packages/contracts/src/specifications.ts` 及生成的 `contracts/` 导出物。
- `packages/domain/src/narration-quality.ts`、`packages/creative-planning/src/narration-quality.ts`。
- `packages/persistence/src/schema.ts`、`packages/persistence/src/narration-quality-repository.ts`、`packages/persistence/drizzle/0019_luxuriant_celestials.sql`、`packages/persistence/drizzle/0020_perpetual_donald_blake.sql`。
- `apps/control-api/src/app.ts`、`apps/control-api/src/index.ts`、`apps/control-api/src/task-run-repository.ts`。
- `apps/control-api/tests/c12.7b-narration-quality.test.ts`、`packages/creative-planning/tests/narration-quality.test.ts`、`packages/persistence/tests/narration-quality-repository.test.ts`、`packages/persistence/tests/schema-contract.test.ts`、`packages/contracts/tests/contract-export.test.ts`。

行为证据：

- 创建脚本保存不可变 `source_script_hash`，显示文案保持原样，spoken/provider 文案按确定性规则生成；未映射 `AI` 等缩写进入 `NEEDS_DECISION`，审批被拒绝。
- 样音审批检查 workspace/project、AUDIO、READY，并记录固定本地 Piper `length_scale=1`、样音 Asset 和实测毫秒时长；公开响应不包含 `piper-local` 或 Provider transport 字段。
- TimelinePlan 只允许批准脚本和批准样音，按实测 section 时长编译 15 秒 Provider 上限的绝对视觉段；样音声明时长和 section duration 总和必须匹配已持久化音频实测时长，重复命令重放原结果，不重复资产或事件。
- canonical transcript 只保存私有质量事实：无文本为 `UNAVAILABLE`，足够匹配为 `CHECKED`，低匹配为 `NEEDS_REVIEW`；公共 `NarrationAssetVersion` 仅可暴露状态，不暴露内部准确率。

验证证据：

- `pnpm --filter @alchemy-video/contracts test`：34/34 通过；`pnpm --filter @alchemy-video/contracts generate` 和 tracked export drift 通过。
- `pnpm --filter @alchemy-video/domain test`：41/41 通过。
- `pnpm --filter @alchemy-video/creative-planning test`：34/34 通过。
- `pnpm --filter @alchemy-video/persistence test`：30 通过，9 个既有数据库服务门控跳过；包含 C12.7B repository、migration/schema、private transcript facts、时长防伪和内存事件 sink 回归。
- `pnpm --filter @alchemy-video/control-api test`：48 通过，1 个既有服务门控跳过。
- `pnpm typecheck`：通过；`pnpm build`：通过，仅保留既有 Nuxt `DEP0155` warning；`git diff --check`：通过，仅有既有 LF/CRLF 提示。

未完成项与风险：

- 本轮没有 `DATABASE_URL`，Drizzle 事务集成测试未启动真实数据库，依既有规则保留 9 个 skip；需要独立审计或集成环境复验迁移与事务。
- Control API 消费已生成并校验的本地 Piper 资产事实；样音生成仍由受控 Media Runtime 负责，不在浏览器或公开 Control API 内直接执行 TTS。
- AudioPlan 的完整 track ownership、字幕、Avatar/lip-sync、共享扣费和多输出导出仍是后续章节。

审计人：Codex（实现与本地验证）

独立审计补充（2026-08-29）：复核 C12.7B contracts/domain/persistence/Control API/public SSE 投影和测试后，发现两个实现缺口并已修复：内存版 `timeline_plan.created` 事件没有走统一 `eventSink`，会影响本地 SSE/事件替身；TimelinePlan 创建接受客户端 section durations 但未校验其与已批准样音版本的实测总时长一致。修复后样音审批在真实 asset duration 缺失或不匹配时 fail closed，TimelinePlan 拒绝伪造 section duration，内存和 Drizzle 路径均保持 workspace/project 约束和安全 outbox/事件投影。

独立审计复测：`pnpm --filter @alchemy-video/creative-planning test` 34/34 通过；`pnpm --filter @alchemy-video/persistence test` 30 通过、9 个既有数据库门控跳过；`pnpm --filter @alchemy-video/control-api test` 48 通过、1 个既有服务门控跳过；`pnpm --filter @alchemy-video/contracts test` 34/34 通过；`pnpm typecheck` 通过；`pnpm build` 通过，仅既有 Nuxt `DEP0155` warning；`git diff --check` 通过，仅既有 LF/CRLF 提示。未执行真实 Provider、云 TTS、Avatar、Veyra、VPS、DNS、部署或 Git staging/commit。

Exit Gate 结论：C12.7B 本地旁白质量闭环经独立源代码、契约、安全边界和回归审计后通过，章节 `ACCEPTED`。后续进入 P2/C11.2 资料知识与事实包或 P3 Delivery Proposal/成本门禁时，必须另立唯一 `IN_PROGRESS` 章节并先更新契约/ADR。

### C11.2：资料理解、事实包与按段检索（历史启动快照）

历史状态：`IN_PROGRESS`

实施日期：2026-08-29

范围：按既有 C11.2 后端/前端设计启动本地确定性资料理解链路。首个切片只允许新增契约、领域状态机和无网络 `document-intelligence` 规则分析器基础；暂不接真实文本模型、OCR、视觉资料理解、Provider、Veyra、VPS、DNS、部署或 Git 写入。

前置审计：C11.1 已实现受控 Markdown 冻结但仍会在 Workflow Worker 内读取有界原文；C11.2 的目标是逐步替换为 `DocumentKnowledgeRevision -> DocumentFact -> CreativeBriefFactContext -> SegmentFactPack`。C12.7B 已 `ACCEPTED`，不会与 C11.2 的资料事实链路共享状态机。

Exit Gate 目标：公开 DTO/SSE 不暴露 Markdown、object key、Prompt、模型、检索分数或内部 hash；所有事实有 workspace/project、conversion、section locator；冲突、视觉缺失和未完成理解 fail closed；后续 Worker/API/Studio 接线必须在本章后续切片单独验证。

P1 实施审计（2026-08-30）：

- 新增 `document_knowledge_revisions`、`document_knowledge_sections`、`document_facts` 和 `creative_brief_fact_contexts` schema/前向迁移；Drizzle 与内存 Repository 均按 workspace/project/conversion 约束，成功结果不可覆盖，失败仅可显式重试。
- `DocumentKnowledgeExecutor` 通过受限 Markdown 流调用无网络确定性理解器，按标题/幻灯片/表格保留章节定位；视觉缺失、注入文本和冲突数字不进入营销事实。
- `DeterministicFactSelector` 将最多 24 条候选冻结为 Brief 快照，每个片段最多 8 条相关事实与 12 条品牌/合规锁；无关键词匹配时不跨段复制无关事实。
- Control API 新增安全理解详情与重试路由；公开响应不含 Markdown、对象 key、analyzer、Prompt、Provider 原文或内部 hash。OpenAPI/JSON Schema 已同步生成。
- `pnpm --filter @alchemy-video/contracts test`：35/35；`pnpm --filter @alchemy-video/persistence test`：34 通过、9 个既有数据库门控跳过；`pnpm --filter @alchemy-video/document-intelligence test`：3/3；`pnpm --filter @alchemy-video/document-worker test`：9/9；`pnpm --filter @alchemy-video/control-api test`：49 通过、1 个既有服务门控跳过；根 `pnpm typecheck` 与 `git diff --check` 通过。

P1 Exit Gate：`READY_FOR_AUDIT` 前置切片完成，C11.2 仍保持 `IN_PROGRESS`。剩余 P2 为真实 conversion-success 到 knowledge queue 的 relay/恢复接线、CreativeBrief READY-only 门禁和 Studio/Workflow E2E；本轮未执行真实 Provider、Veyra、付费调用、VPS、部署或 Git 写入。

P2 实施审计（2026-08-30）：

- Conversion 成功事务现在同步创建 `DocumentKnowledgeRevision=QUEUED` 与 `document_knowledge.queued` Outbox；独立 `BullMqDocumentKnowledgeQueue`、死信处理和 `DocumentKnowledgeOutboxRelay` 已接入 Document Worker 前台启动路径，队列消息只携带持久化身份。
- Worker 读取 Markdown 仅通过 workspace-scoped 知识仓储解析对象 key，再调用 StoragePort；服务端校验 `text/markdown` MIME 与冻结 SHA-256，成功后才写入 Section/Fact/READY 事件，Control API 不暴露对象 key。
- Drizzle CreativePlanning 在选中文档资料时强制检查同项目、同 Conversion、同 Markdown SHA 的 READY KnowledgeRevision；通过确定性 selector 冻结最多 24 条 Brief 事实快照。Workflow/Prompt Compiler 优先使用冻结事实，不再把原始 Markdown 块写入新 PromptPackage；缺少 READY 或快照不一致分别返回 `DOCUMENT_KNOWLEDGE_NOT_READY` / `DOCUMENT_FACT_CONTEXT_INVALID`。
- 新增 Relay scope/发布失败回退测试及事实编译安全测试；`pnpm --filter @alchemy-video/contracts test` 35/35、`pnpm --filter @alchemy-video/document-worker test` 11/11、`pnpm --filter @alchemy-video/creative-planning test` 35/35、`pnpm --filter @alchemy-video/persistence test` 34 通过/9 个既有数据库门控跳过、`pnpm --filter @alchemy-video/control-api test` 49 通过/1 个既有服务门控跳过、根 `pnpm build` 通过，`git diff --check` 通过。Workflow Worker 全量回归仍有 3 个此前已有的时长/镜头/口播断言失败，未由本 P2 事实路径引入。

P2 Exit Gate：后端队列、Relay、READY-only 门禁、新 Prompt 事实边界和前台重启时 QUEUED/RUNNING 知识任务恢复已实现，但 C11.2 暂不进入 `READY_FOR_AUDIT`。尚缺真实 PostgreSQL/Redis/MinIO 联调、Studio“整理 -> 理解 -> 可用于创作”E2E，以及上述 Workflow 旧回归断言的独立归因与修复；本轮未执行真实 Provider、Veyra、付费调用、VPS、部署或 Git 写入。

收口审计基线（2026-08-30 04:16）：

- 按最新用户约束，唯一活动章节明确保持 C11.2；正式总控页首已从 C12.2 纠正为 C11.2，历史章节条目仅作为审计轨迹，不得据此开启新章节。
- 工作区复核发现根目录未忽略的 0 字节临时文件 `({duration` 与 `inspect-production-run.json`；未删除用户文件，已列入清理建议。`upstream/` 未被 Git 跟踪；`.env.local` 仍由 `.gitignore` 忽略。
- 本轮只允许验证 C11.2 剩余 Exit Gate；真实 Provider、Veyra、VPS、部署、付费调用和 Git 发布保持关闭。状态仍为 `IN_PROGRESS`，在剩余证据完成前不得标记 `READY_FOR_AUDIT` 或 `ACCEPTED`。

### C11.2：真实联调、总回归与独立收口复核（2026-08-30）

复核范围：仅 C11.2 剩余 Exit Gate；不启动 C11.3/C12.2-C12.7B、免费音频、真实 Provider、Veyra/共享积分、VPS/DNS/部署或 Git 写入。

真实本地证据：

- PostgreSQL `video_root_final_20260830`、Redis `127.0.0.1:6380`、MinIO `127.0.0.1:9002` 均健康并完成迁移。
- `pnpm --filter @alchemy-video/control-api test:c10-e2e` 通过；Studio 浏览器闭环实际覆盖资料“整理 -> 理解 -> 可用于创作”、刷新/项目隔离/移动布局，并断言 conversion-success -> knowledge Outbox -> BullMQ -> Document Worker -> READY、Section/Fact/SHA、READY Brief fact snapshot、Prompt 不回退 Markdown 和公开详情脱敏。
- `packages/persistence/tests/document-knowledge-repository.integration.test.ts` 在真实数据库通过 1/1，覆盖幂等重放/冲突、跨 workspace 隔离、conversion SHA 错配、RUNNING 恢复、FAILED retry、READY 结果不可覆盖和 Outbox 事件类型。
- Document Worker 12/12 通过，包含 QUEUED/RUNNING 重启恢复；Workflow Worker 15/15 通过，事实选择、段作用域和历史兼容回归均独立归因，无当前失败。

串行回归证据：

- 根 `pnpm typecheck`、`pnpm build`、`git diff --check` 通过；构建仅有既有 Nuxt `DEP0155` 警告。
- 根 `pnpm test` 在显式本地服务环境完成 18 个工作区项目：426 passed、5 个明确环境门控 skipped、0 failed。skipped 原样保留（1 个 MinIO CORS 场景、4 个需专用 BullMQ/C06 恢复 fixture 的场景），没有将 skip 改写为通过。
- 受影响包复核：Contracts 35/35、Domain 43/43、Persistence 47/47、Document Intelligence 4/4、Document Worker 12/12、Workflow Worker 15/15、Creative Planning 35/35、Control API 51/51、Provider Video 44/44、Production Worker 31/31、Studio Web 36/36、Task Queue Redis 1/1；无真实 Provider/Veyra/网络调用。

独立边界复核：

- 事实均带 workspace/project/conversion/section locator；SHA、历史 revision 和 READY 结果不可原地覆盖。
- 冲突数字、视觉缺失和注入指令 fail closed；Brief/Workflow/Prompt 只消费 READY 冻结事实，公开 DTO/SSE/OpenAPI 不暴露 Markdown、object key、Prompt、analyzer、模型、Provider 或内部 hash。
- `production_runs.delivery_plan_revision_id` 仍是已知 schema 风险（应用事务/行锁保证当前不变量，未伪称数据库反向复合外键）；默认 shell 未配置 `DATABASE_URL` 的门控事实已记录。根目录 `({duration` 与 `inspect-production-run.json` 两个 0 字节临时文件未删除，待用户确认清理。

Exit Gate 结论（独立审计确认，2026-08-30）：C11.2 本地实现、真实服务联调、恢复/隔离/公开边界和串行总回归证据齐全；根 typecheck/build、显式本地服务根 test（426 pass / 5 explicit skip / 0 fail）、本地黑盒 smoke 和 README 状态纠偏均已复核。章节标记为 `ACCEPTED`，仅表示 C11.2 本地范围完成，不代表平台长期目标或真实 Provider/Veyra/VPS/Git 边界完成。`production_runs.delivery_plan_revision_id` 反向复合外键缺口、5 个明确 skip、真实外部系统未测试等风险继续保留；不得据此开启后续章节或外部系统工作。
# C12.4/C12.5 旁白编排复核（历史快照，已由文末 2026-08-30 14:22 对账 supersede）

本标题以下至最新对账前的计数和路径描述保留为审计轨迹，不作为当前证据；当前可复核测试计数、状态和来源口径只以文末 14:22 记录为准。

- 完整 `scriptText` 优先于历史 `narrationSegments`；没有已批准 TimelinePlan 时，Worker 只接受已有绝对起点 cues，不再从 0 秒整轨合成后用 padding 遮盖缺口。
- Piper 参数与 OpenMontage 对齐（length_scale=1.0、sentence_silence=0.3）；多行中文引号解析、长尾静音阻断和无音频 BLOCK 均有测试证据。
- `pnpm --filter @alchemy-video/creative-planning test`：36/36；`pnpm --filter @alchemy-video/production-worker test`：34/34；media-runtime：44/44；`pnpm --filter @alchemy-video/persistence test`：41 通过、10 个既有 DATABASE_URL 门控 skip。
- Python 测试必须从 `services/media-runtime` 工作目录执行（模块依赖 `main`/`runtime` 的本地导入）；从仓库根目录直接指定文件会产生入口路径错误，不视为产品失败。
- 本轮实现与定向复核完成，C12.4/C12.5 当前保持 `IMPLEMENTED_PENDING_AUDIT`，尚未标记 ACCEPTED。
- 口音边界（历史快照，已 superseded）：当时仅使用 OpenMontage Piper 离线 fallback；`sentence-silence`/`length-scale` 只改善节奏，不保证中文口音。现行自动流程不要求用户上传音频，已按用户授权保留 Grok native 优先并支持显式 Doubao profile；本条不替代当前真实产物与人工听感审计。
- OpenMontage TTS selector/provider 代码已完成只读审计；由于本平台尚无对应安全 Port 且无授权凭据，本轮不移植外部网络调用，避免越过本地 MVP 边界。
- 已补独立 production-worker 行为夹具：approved narration asset 通过 StoragePort 读取并直接进入 compose、Piper synthesis 不调用；缺 approved timeline/cues 与 target+1001ms 超长旁白均在 compose/finalReview/落库前拒绝；不使用静态源码检查。
- 超长判定已对齐 OpenMontage explainer 规则：仅当旁白超出视频超过 1 秒才阻断；轻微超出保留 warning/复核路径，不再使用无出处的 500ms 阈值。
- `narrationTextForSynthesis` 不再无来源地把尾逗号改成句号；仅做 trim，保留源文案标点与段落停顿。
- 设计边界纠偏：C12.7B 的 READY TimelinePlan、APPROVED script、精确 asset-version、样音批准和 AUDIO/READY asset 已由 persistence helper 按 workspace/project 校验；approved AUDIO bytes 由 Worker 通过 StoragePort 读取后作为 authoritative track 进入 ALCHMED5，并以 asset `durationMs` 与 Runtime 的实际 ffprobe 时长共同做超长门禁。
- 无独立 approved asset 的 READY plan 走已有 delivery-cue `narrationSegments` 绝对起点合成；连续模式先将 Provider 段音频替换为静音，再叠加权威旁白，避免双播。ALCHMED5 对 approved full track 仍从 t=0 播放，尚未把 section-level TimelinePlan windows 编码进 full-track bundle，因此本章保持 `IMPLEMENTED_PENDING_AUDIT`，不宣称绝对时间轴设计全部完成。

## C12.4/C12.5 当前复核更正（2026-08-30）

- 当前状态仍为 `IMPLEMENTED_PENDING_AUDIT`，不得据此标记 `ACCEPTED`。本轮没有真实 Provider/TTS/Veyra、外部网络、VPS 或 Git 操作。
- 规划器与持久化层统一使用同一行标题解析语义：`视频生成意图描述：...` 等同一行 heading 不会被吞入口播；新增 creative-planning 回归后为 38/38。
- `provider_duration_seconds` 按 Provider 请求上限解释，接受实测编码时长在该上限外的既有 250ms 共享容差；15.042s 片段回归通过，超过容差仍 fail-closed。Persistence 当前显式本地 PostgreSQL 回归为 57/57（无数据库时仍有 10 个门控 skip）。
- 当前根级显式本地服务串行回归 `pnpm test` 退出码 0；根 `pnpm typecheck` 与 `pnpm build` 均通过（仅既有 Nuxt DEP0155 警告）。Workflow Worker 15/15、Production Worker 40/40、Contracts 35/35、Provider Video 44/44、Media Runtime 64/64 通过。
- 仍未完成的硬门：ALCHMED7 尚未传输完整 AudioPlan（version/asset_id/gain_db/fade）；approved full narration 的 section-level 绝对窗口仍以 t=0 整轨消费；cue-only 路径仍逐 cue 调用 Piper，不能宣称 full-narration-first 声学连续性；transition/xfade bridge 尚未与最终 effective duration 完整对账；Studio 尚无“自动生成样音→审批→正式资产→TimelinePlan”操作闭环（历史记录中的“样音上传”不是当前前提）。以上保持 pending，不能用绿色离线测试替代真实音频质量或 UI 审批事实。

## C12.4/C12.5 当前复核更正（2026-08-30 10:13）

- Worker 终检不再允许仅有 `narrationSegments` 的旁白绕过脚本/ASR 比对：当顶层 canonical script 缺失时，使用持久化 cue 的 `provider_text` 拼接作为私有终检 transcript；cue 文本为空则在 QC 阶段 fail-closed。
- 连续旁白下若任一 accepted source segment 仅有 `LEGACY_PRESERVE`、却没有持久化 delivery/ownership 事实，Worker 在 Piper/compose/落库前返回 `QC_FAILED`，避免把未知 Provider 对白与平台旁白双播；这同时意味着当前仓储事实不足以可靠区分 ambience/user audio，不能宣称 ownership 已完整迁移。
- 本轮定向 `pnpm --filter @alchemy-video/production-worker test`：41/41；`pnpm --filter @alchemy-video/production-worker typecheck`：通过。根 `pnpm typecheck`、`pnpm build` 均通过；显式本地 PostgreSQL/Redis/MinIO 的根 `pnpm test` 退出码 0，为 450 pass / 5 explicit skip / 0 fail（历史 426/5/0 记录保留为历史证据，不与当前计数混用）。
- 5 个 skip 仍是既有环境/fixture 门控（storage-client MinIO CORS 1 项、task-worker C06 BullMQ recovery 4 项），未改写为通过；未调用真实 Provider/TTS/Veyra、外部网络、VPS/DNS 或 Git。
- C12.4/C12.5 继续保持 `IMPLEMENTED_PENDING_AUDIT`。未完成硬门仍包括：ALCHMED7 完整 AudioPlan identity/gain/fade/version 传输、approved full-track 的 section-level 绝对窗口、transition/xfade coverage、cue-only full-narration-first 声学连续性、Studio 样音/审批/TimelinePlan UI 闭环，以及中文口音的真实 TTS profile 认证。

### C12.4/C12.5 语速与外部音频范围复核（2026-08-30；历史快照，已由 E04 对账 supersede）

- （历史快照，已 superseded）`services/media-runtime/adapters/openmontage_audio/piper.py` 曾依据 OpenMontage Piper 数值接口登记 `NATURAL=1.0`、`SLOW=1.15`、`FAST=0.85`；上游没有该 symbolic pace 映射，当前 E04 仅保留 `NATURAL=1.0`，SLOW/FAST/BRISK 在 Piper 前 fail-closed。`pause_before_ms` 必须已编码在绝对 `start_ms`，`pause_after_ms` 进入 Piper `sentence_silence`；Piper 不支持的 `energy` 仍阻断并要求批准样音/其他 provider。
- 证据：media-runtime `test_runtime.py` 75/75，`adapters` 4/4；未调用真实 TTS、Provider 或网络。C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`。
- REQUIRED 字幕当前由 Runtime 明确 `UNAVAILABLE/BLOCK`，尚未接入 OpenMontage SubtitleGen/FFmpeg burn；Studio 审批闭环、approved full-track section-level offset、transition coverage 和 cue-only full-narration-first 连续韵律仍是阻断项，不能因定向测试通过而宣称完整完成。
- Freesound 不是本轮指定上游；相关 catalog/deploy 代码已从本地 MVP 路径移除（历史记录保留），local stack/deploy 不注入或要求外部曲库密钥，本轮不以其作为 BGM 证据。

### C12.4/C12.5 源音轨滤镜与 SSML 边界复核（2026-08-30）

- 按 OpenMontage `audio_mixer.py::_track_filters` 的顺序，Runtime 在 `CONTINUOUS_NARRATION` 且已有明确来源 ownership 时，对 `PROVIDER_AMBIENCE`/`USER_SOURCE_AUDIO`/`LEGACY_PRESERVE` 段音频实际应用数值 gain 与非零 fade，再进入已审计的段落拼接；`LEGACY_PRESERVE` 策略不受新滤镜影响，`PROVIDER_DIALOGUE` 仍只按声明被替换。Runtime graph 行为测试覆盖 2 段 source track 的 gain/fade。
- Piper 不支持 SSML；`provider_text` 中带明确时长的 `<break>` 只有在与批准 `pause_after_ms` 一致时才转为文本边界，缺失/冲突时显式 `MEDIA_RUNTIME_UNAVAILABLE`，不静默吞掉停顿时长。
- ALCHMED8 解析新增 track-count 截断边界，统一返回 `MEDIA_RENDER_FAILED` 而非 `IndexError`。Runtime 定向回归为 78/78，OpenMontage adapter 为 4/4；Contracts 36/36、Production Worker 42/42、Worker typecheck 通过。
- 本轮仍不宣称 C12.4/C12.5 完整验收：REQUIRED 字幕生成、Studio 样音/审批/TimelinePlan UI 闭环、approved full-track section-level 实际消费、transition coverage 与真实中文口音仍为阻断项。

### C12.4/C12.5 字幕烧录与受控 Runtime 复核（2026-08-30）

- 已按 OpenMontage `tools/subtitle/subtitle_gen.py` 与 `tools/video/remotion_caption_burn.py` 的边界接入最小 loopback 字幕烧录：仅消费已检查的 word timestamps，生成临时 SRT 并用 FFmpeg `subtitles` 滤镜输出；产物写入 `alchemy_captions=burned_srt` 标记，未从脚本文本臆造时间。
- `DeliveryPlan.caption_policy=REQUIRED` 现在由 Production Worker 触发 captions endpoint，并由 final review 验证烧录标记；缺少已批准 timing 或 transcriber 能力仍返回可重试 `MEDIA_RUNTIME_UNAVAILABLE/BLOCK`，不是静默 `NOT_EXPECTED`。Studio 样音/TimelinePlan UI 闭环仍未完成，因此不能据此宣称完整验收。
- C12 本地 E2E 使用 `.codex-longrun/c10-document-runtime-venv`（存在时）启动 Media Runtime，并注入同一 `MEDIA_TRANSCRIBER_PYTHON_PATH`、`PIPER_PYTHON_PATH` 与本地 `HF_HOME`。Runtime capability 先用该解释器探测 `faster_whisper`；配置解释器与服务解释器不一致或缺模块时 fail-closed。系统 Python fallback 仅可执行视频 smoke，不代表字幕/TTS 能力。
- 本轮证据：在 `services/media-runtime` 工作目录执行 `python -m unittest discover -s tests -p 'test_runtime.py' -v` — 87/87；`python -m unittest discover -s adapters -p 'test_*.py' -v` — 4/4；`pnpm --filter @alchemy-video/production-worker test` — 43/43；`pnpm --filter @alchemy-video/contracts test` — 36/36；persistence 增益 mapper 单测通过（无 `DATABASE_URL` 时仍保留 10 个显式门控 skip）。
- 未完成硬门保持不变：approved full narration 的 section-level 绝对窗口尚未在整轨实际消费；cue-only 多段仍不是 full-narration-first 的完整声学路径；AudioPlan 完整字段/轨道滤镜、transition/xfade coverage、Studio 样音审批/TimelinePlan UI 与中文口音认证仍需后续审计。C12.4/C12.5 继续为 `IMPLEMENTED_PENDING_AUDIT`，未调用真实 Provider/TTS/Veyra/网络/VPS/Git。

### C12.4/C12.5 当前清理与回归更正（2026-08-30 12:38）

- 本轮移除非指定上游的 Freesound/free-music catalog：Control API 路由/类型/测试、Studio 目录组件与调用、contracts audio-library 导出、local/deploy 环境注入和同步脚本均不再进入当前代码路径；历史审计文字保留为历史事实但不作为迁移证据。当前 BGM 仅来自服务端确认的当前项目 `READY AUDIO` 且 `metadata.audio_role=MUSIC` 资产，或显式 `OFF`。
- `apps/studio-web/app/pages/projects/[project_id].vue` 已移除已删除的 `MusicPlanPanel` 依赖，补充最小项目级 AUTO/MANUAL/OFF 选择与上传入口，并对 `audio_role=MUSIC` 做前端过滤；无曲目时显示不混入音乐的可操作提示。音乐入口使用受限 `purpose=MUSIC`，通用 AUDIO 未声明 purpose 时不再自动标成音乐；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 角色不会进入 AUTO 曲库。服务端 metadata 的 role 覆盖保护和跨角色排除由 Control API 回归覆盖。
- 字幕 loopback 已切换为严格 JSON body + `BURN_CAPTIONS` 内部工具名；Runtime 对 checked word timestamps 做视频时长/窗口/大小校验并用 SRT+FFmpeg 烧录。该路径仍不等于普通 Studio REQUIRED 字幕审批事实链已完成。
- 证据：Contracts 36/36；Control API 45 pass/1 service-gated skip；Studio Web 36/36、typecheck/build PASS；Production Worker 43/43；Persistence 49 pass/10 explicit DB-gated skip；Media Runtime 90/90；OpenMontage adapters 4/4；根 typecheck/build/test EXIT 0（根保留 5 个明确环境/fixture skip）；`git diff --check` 无错误（仅 CRLF 提示）。
- 当前章节仍为 `IMPLEMENTED_PENDING_AUDIT`，不标记 `ACCEPTED`。approved full-track section windows 实际消费、无独立资产多 cue full-narration-first、AudioPlan 全字段语义、transition/xfade coverage、Studio 样音/旁白审批/TimelinePlan 完整闭环、普通 REQUIRED 字幕事实链、中文口音认证仍是未完成硬门；未调用真实 Provider/TTS/Veyra/网络/VPS，未提交 Git。
- 当前状态对账（2026-08-30 12:55，已由下方 14:22 复核 supersede）：C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`，唯一当前实施切片；C11.2 仅保留已审计的本地 `ACCEPTED` 历史范围。通用 AUDIO 角色改为受控 purpose 映射（仅 `MUSIC` 进入 AUTO 曲库）；本轮没有真实 Provider/TTS/Veyra/网络/VPS/Git 操作。下方最新复核已将多 cue 路径统一为 OpenMontage `_full_mix` 接线前 fail-closed；approved full-track section offset、完整 AudioPlan 语义、transition/xfade、Studio 样音/审批/TimelinePlan、普通 REQUIRED 字幕、中文口音与 overlong consumer 行为门仍阻断。

### C12.4/C12.5 最新源仓库对账与定向回归（2026-08-30 14:22）

- 来源复核：本轮每个改动均回指固定 OpenMontage commit `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `skills/pipelines/explainer/compose-director.md`、`executive-producer.md`、`tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::_full_mix` 与 `voice-performance-director.md`；平台仅保留事件/对象/权限/工作区/错误/队列边界的薄壳适配。没有新增并行 TTS 算法、时长拉伸、静音填充、网络曲库或 Provider 协议。
- 样音边界已纠偏：`approveNarrationScriptRevision` 只写现有 `narration_script.approved` 样音事实，不插入 `narration_asset_version` 或伪造 `narration_asset_version.ready`；TimelinePlan/ready loader 只接受显式、独立、实测的 `sample_approved=false` 正式版本，并拒绝复用已批准样音对象。
- 旁白边界已纠偏：Worker 对完整 canonical 文案只调用一次现有 Piper 适配；多 cue 的绝对起点只有 `_full_mix` speech-track 接入后才有来源依据，当前在 Piper/compose 前 fail-closed。Runtime direct bundle 同样拒绝未消费的多 section full-track windows；不使用 atempo、裁剪或空白补齐掩盖不足时长。
- 音乐边界已纠偏：AUTO 只接受服务端确认的当前工作区/项目 `AUDIO + READY + metadata.audio_role=MUSIC` 资产；`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 与未分类 AUDIO 不会成为音乐。无 MUSIC 时 AUTO fail-closed，显式 OFF 才允许无音乐床；未调用网络曲库。
- 当前可复核定向行为证据（仅保留本轮最新计数）：Persistence `52 pass / 10 explicit DATABASE_URL-gated skip / 0 fail`；Production Worker `43/43`；Media Runtime `92/92`（`python -m pytest -q`，工作目录 `services/media-runtime`）；Control API `47 pass / 1 explicit service-gated skip / 0 fail`。这些是行为测试，不以静态源码扫描代替；未运行/未宣称真实 Provider、TTS、Veyra、网络、VPS、部署或 Git。
- 未完成硬门保持明确：approved full narration 的 section-level 时间窗尚未由 Runtime 实际消费；完整 AudioPlan 语义、transition/xfade coverage、cue-only full-narration-first、Studio 样音/审批/TimelinePlan 闭环、REQUIRED 字幕事实链、中文口音认证，以及超长旁白 consumer 行为测试仍未收口。因此 C12.4/C12.5 继续为 `IMPLEMENTED_PENDING_AUDIT`，不得标记 `ACCEPTED`。

### C12.4/C12.5 明确授权恢复 Pixabay 源能力（2026-08-30 15:22）

- 用户明确授权外部网络后，本轮只恢复固定来源 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/pixabay_music.py`。Runtime 保留搜索页/bootstrap/HTML fallback、30–120 秒默认筛选、无匹配回退全部、首条选择和 MP3 下载顺序。
- 平台改动是薄壳：Media Runtime loopback 认证和临时文件、Control API workspace/幂等/对象存储/实际 MIME/SHA/字节校验、Studio 显式 query 导入；未新增排序、推荐、自动补曲、Freesound/Suno、TTS 或 Provider 逻辑。导入资产由服务端固定 `audio_role=MUSIC`，样音/用户音频不进入 AUTO。
- 安全边界：下载 URL 只允许 HTTPS `cdn.pixabay.com`；未配置 Media Runtime 时能力阻断，不从 Control API 进程绕过内部边界直连。
- 证据：原仓库 Python 适配器对 `ambient`、`upbeat` 各完成真实搜索和下载；`ambient` 20 条结果、默认筛选后 4 条、首条 106 秒、3,402,187 bytes；Runtime loopback endpoint 返回 `audio/mpeg` 并通过同一字节校验。Contracts 36/36、Control API 52 pass/1 explicit service-gated skip、Studio 36/36 + typecheck、Media Runtime 94/94 均通过。
- 状态不变：C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`。approved full narration section-level 时间窗、完整 AudioPlan、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、REQUIRED 字幕事实链、中文口音及超长旁白 consumer 行为等硬门仍未收口；未执行真实视频 Provider/TTS/Veyra/计费/VPS/Git。

### C12.4/C12.5 Pixabay 恢复后根级回归对账（2026-08-30 15:30）

- 最新根 `pnpm test` 退出码为 0：18 个工作区项目 444 passed、18 个明确环境门控 skipped、0 failed；skipped 保留为数据库/MinIO/BullMQ 服务边界，不冒充行为通过。
- 本条只更新回归证据，不改变章节结论：C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`，Pixabay 仍是显式导入的 OpenMontage 源能力恢复，所有旁白/AudioPlan/字幕/中文口音等未完成硬门继续有效。

## 状态账本历史快照（2026-08-30 20:32；现行状态以正式总控/state 为准）

| 范围 | 当前状态 | 说明 |
| --- | --- | --- |
| C11.2 | `ACCEPTED` | 仅覆盖已独立审计的本地资料理解/事实包范围 |
| C12.4/C12.5 | `IMPLEMENTED_PENDING_AUDIT` | 当前唯一活动实施切片；本轮只做源仓库薄适配、边界协调、行为测试和审计对账 |
| C12.4-S01 | `IN_PROGRESS` | E02 当前活动切片；OpenMontage Pixabay/MUSIC 显式导入和跨角色隔离待独立验收 |
| C12.4-S02 | `READY_FOR_AUDIT` | OpenMontage Piper 单次完整脚本和正式资产边界已具备证据；切片未单独 ACCEPT |
| C12.4-S03 | `ACCEPTED` | OpenMontage `_full_mix` 独立 speech tracks/绝对起点 Exit Gate 已独立复核通过；仅代表 S03 切片 |
| C12.4-S04 | `IN_PROGRESS` | 仅消费现有 ALCHMED8 完整 AudioPlan 与固定 OpenMontage 语义；S04 尚未达到 READY_FOR_AUDIT |
| C11.3/C12.2/C12.3/C12.6/C12.7B | `NOT_ACTIVE_IN_THIS_SCOPE` | 旧章节段落是历史证据，不是本轮授权或当前实施状态 |
| 真实 Provider/TTS/Veyra/共享积分/VPS/DNS/TLS/部署/Git | `DISABLED` | 未调用、未部署、未提交 |

本账本与第 2 节总表共同构成本轮唯一状态依据；后续若需改变任一状态，必须新增带证据的审计记录，不能改写历史段落。

### C12.4/C12.5 最终深审计对账（2026-08-30 17:05）

- 本轮只继续核对和修正已有 OpenMontage 来源的薄适配：Runtime 请求体改为有界分块读取；音频混音保持 `_full_mix` 的 `ratio=9`、`level_sc=1`、`mix=0.9` 和正衰减到线性音量的来源换算；Control API 的 FFmpeg/Piper 能力在缺少受控 Runtime 证据时 fail-closed 为 `NOT_CONFIGURED`。
- 当前行为证据：Media Runtime `97 passed / 0 failed`；OpenMontage audio adapters `7/7`；Control API `53 pass / 1 explicit service-gated skip / 0 fail`；Production Worker `43/43`；根 `pnpm test` `447 passed / 18 explicit environment-gated skips / 0 failed`；根 `pnpm typecheck`、`pnpm build`、`git diff --check` 均通过（build 仅有既有 Nuxt/Nitro `DEP0155` 警告）。这些是可复核行为/构建证据，不以静态源码扫描代替。
- 状态没有升级：C11.2 仍为本地范围 `ACCEPTED`；C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`；C11.3/C12.2/C12.3/C12.6/C12.7B 为 `NOT_ACTIVE_IN_THIS_SCOPE`；真实 Provider/TTS/Veyra/共享积分/VPS/DNS/TLS/部署/Git 仍 `DISABLED`。
- 未完成硬门继续保留：approved full narration 的 section-level 时间窗实际消费、完整 AudioPlan 语义、transition/xfade coverage、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、普通 `REQUIRED` 字幕事实链、中文口音认证和超长旁白 consumer 行为。结构性门控的绿色测试不表示这些问题已解决。
- Pixabay 仅按用户明确授权恢复 OpenMontage 源能力；真实搜索/下载证据保留，但不改变上述章节状态或其他外部系统禁令。

### C12.4-S01 Pixabay / MUSIC 角色逐项审计（2026-08-30 17:45；历史，已 superseded）

历史状态：`READY_FOR_AUDIT`（17:45 历史快照，已 superseded；不代表当前 S01 状态，也不等同于 C12.4/C12.5 `ACCEPTED`）。

- 固定来源：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`，文件 `upstream/openmontage/tools/audio/pixabay_music.py`。平台 Python 适配保留来源的搜索页、`__BOOTSTRAP_URL__`、HTML MP3 回退、30–120 秒筛选、无匹配回退、首条选择和 MP3 下载顺序。
- 薄壳范围：`services/media-runtime` 只提供受保护 loopback 入口和来源主机/HTTPS 边界；`apps/control-api` 负责 workspace/project 权限、幂等、对象写入、实际 MIME/字节/SHA 校验和公开脱敏；资产角色由服务端固定为 `MUSIC`，调用者 metadata 不能覆盖。
- 输入/安全边界：下载响应必须声明 `audio/mpeg`，非音频响应在落盘前拒绝；非 `cdn.pixabay.com` 或非 HTTPS URL 拒绝。此处是既有平台媒体安全边界的薄适配，不是新增选曲算法。
- 跨角色证据：`MUSIC`、`NARRATION_SAMPLE`、`USER_SOURCE_AUDIO` 和未分类 `AUDIO` 的 READY 资产回归确认仅 server-owned `MUSIC` 进入 AUTO 候选；样音不会被当作 BGM。显式 Pixabay 导入只创建 `AUDIO + READY + metadata.audio_role=MUSIC`。
- 行为证据：Control API `55 pass / 1 explicit service-gated skip / 0 fail`；Media Runtime adapters `8/8`；Media Runtime `97 passed / 0 failed`；根 `pnpm test` `449 passed / 18 explicit environment-gated skips / 0 failed`。根 typecheck/build 和 `git diff --check` 通过，state validator 通过。此前授权的 ambient/upbeat 真实源 smoke 仍保留为外部可达性证据。
- 负面证据：没有恢复 Freesound 或第二套曲库，没有自动搜索/推荐/排序/补曲，没有把通用 AUDIO 或旁白样音强制标记为 MUSIC；本轮未调用真实视频 Provider/TTS/Veyra/计费/VPS/DNS/TLS/Git。
- 章节口径：本切片仅达到 `READY_FOR_AUDIT`；C12.4/C12.5 仍为 `IMPLEMENTED_PENDING_AUDIT`。approved full narration section-level 时间窗、完整 AudioPlan、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音和超长旁白 consumer 行为等硬门不受本切片绿色结果影响，继续原样阻断。

### C12.4-S02 Piper 单次完整脚本与资产边界对账（2026-08-30）

状态：`READY_FOR_AUDIT`（`.codex-longrun/state.json`：`verifying`）；不升级 C12.4/C12.5 总体状态。

- 固定来源：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `upstream/openmontage/tools/audio/piper_tts.py::PiperTTS._generate`。平台保留 `--model`、`--speaker`、`--length-scale`、`--sentence-silence`、`--output_file` 及 stdin 的单次 canonical script 语义；Runtime Piper subprocess timeout=`300` 与来源一致。
- 迁入/适配文件：`services/media-runtime/adapters/openmontage_audio/piper.py`、`services/media-runtime/runtime.py`；仅增加 loopback/字节流边界、受控解释器和 WAV/时长验证，样音审批事实与正式独立旁白资产保持隔离。
- 窄测证据：`services/media-runtime` 工作目录执行 5 项定向 unittest（受控 Piper 参数与 canonical stdin/实测 WAV 时长、非零退出、缺失输出、非法 WAV）`5/5 PASS`；未调用真实 TTS、Provider、网络或外部服务。
- 既有 Production Worker 行为证据已复核：approved 非样音正式资产走 StoragePort/authoritative narration，且不会重复合成；no-repeat 与样音/正式资产隔离回归保持通过（本轮未重跑）。
- 未完成集成/人工门：approved full narration section-level 时间窗、完整 AudioPlan、cue-only 多段 full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音认证及其它 C12.4/C12.5 硬门仍未完成。

### C12.4-S03 OpenMontage `_full_mix` 独立 speech tracks 开始记录（2026-08-30；实现前历史阻断快照）

状态：`BLOCKED`（`.codex-longrun/state.json`：`blocked`）；S02 保持 `READY_FOR_AUDIT`，C12.4/C12.5 总体保持 `IMPLEMENTED_PENDING_AUDIT`。

- 固定来源：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930`，`upstream/openmontage/tools/audio/audio_mixer.py::_full_mix` 及 `_track_filters`。仅适配独立 measured speech tracks 的 `path`、`role: "speech"`、`start_seconds`、来源滤镜图、角色混合、fade/sidechain/normalize/target-duration 语义。
- 平台边界：只允许 workspace/object-storage 受控临时路径、错误映射和产物校验；没有可消费的独立测量音频事实时必须 fail-closed。禁止逐 cue Piper、平台自写 adelay/amix 替代图、新 magic/公共 API/UI、真实 Provider/TTS/Veyra/网络/VPS/Git。
- 只读阻断证据：现有 ALCHMED/Composition 契约仅携带单条 `narration_bytes`，Worker 未向 Runtime 提供独立 measured speech-track bytes/paths；Runtime `synthesize_narration_segments_bytes` 对多 cue 仍 fail-closed，`compose_video_bundle` 未调用来源 `_full_mix`。在不新增 magic/公共协议的前提下无法安全承载 `{path, role: "speech", start_seconds}`，故本切片 BLOCKED，不以旧逻辑或静态检查宣称完成。
- 下一步：仅在已有内部对象/工作区边界能提供受控独立音频事实后，薄接 OpenMontage `_full_mix`；此前保持 fail-closed。未运行测试、未调用真实 Provider/TTS/网络/VPS/Git。

### C12.4-S03 OpenMontage `_full_mix` 独立 speech tracks 收口复核（2026-08-30 18:35）

状态：`READY_FOR_AUDIT`（切片状态；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。上方“开始记录”是本轮实现前的历史阻断快照，不覆盖本条当前证据。

- 固定来源：`calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_full_mix` 与 `_track_filters`，以及 explainer `asset-director.md`/`edit-director.md` 对 section asset、实测 duration 和 `asset_id + start_seconds` 的规则。新增的 `services/media-runtime/adapters/openmontage_audio/full_mix.py` 只镜像来源滤镜图和角色混音，平台仅提供受控临时路径、命令 runner 和错误边界。
- 迁移事实：现有 ALCHMED8 私有载荷支持全有或全无的正式非样音 section AUDIO track bytes；Worker 通过既有 workspace/project Asset + StoragePort 校验 MIME、SHA、字节数和 ffprobe duration 后按 track identity 发送。Runtime 仅映射来源 `{path, role: "speech", start_seconds}`，保留 fade-before-adelay、speech/music/sfx 顺序、`ratio=9`、`level_sc=1`、`mix=0.9`、target `apad/atrim` 和 `loudnorm`，再复用来源 full-mix 结果 remux 视频。
- 正向/负向证据：`python -m pytest -q tests/test_runtime.py`（`services/media-runtime`）`101 passed`；`python -m pytest -q adapters/openmontage_audio/test_adapters.py` `11 passed`，包含两段绝对起点、来源滤镜图、缺失轨道/非法 target fail-closed 和受控 ffmpeg/ffprobe 实际 WAV 产物（目标 3 秒、单音频轨）；独立 speech duration/window 不一致、payload identity 不一致均拒绝，未走 Piper/full_mix。
- 集成证据：Production Worker `45/45`（独立 formal assets 读取和传输、样音不复用）；Persistence `53 pass / 10 explicit DATABASE_URL-gated skip`；Contracts `36/36`；Domain `43/43`；根 `pnpm test` `452 passed / 18 explicit environment-gated skips / 0 failed`；`pnpm typecheck`、`pnpm build`（仅既有 Nuxt/Nitro `DEP0155` warning）和 `git diff --check` 通过。旧 skip 保留为环境/服务边界，不折算为通过。
- 来源与范围审计：没有新增 ALCHMED9、第二套 AudioPlan、逐 cue Piper、SLOW/FAST 映射、`atempo`/裁剪/补静音、网络曲库、真实 Provider/TTS/Veyra、部署或 Git 操作；单条 legacy full narration 仍从 `t=0`，cue-only 多段和未消费 full-track section windows 仍 fail-closed。
- 未完成硬门原样保留：approved full narration 的 full-track section-level 时间窗、完整 AudioPlan 语义/identity、transition/xfade coverage、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音认证和超长旁白 consumer 行为。故本条只允许进入独立审计，不得标记 `ACCEPTED` 或进入 S04。

### C12.4-S03 OpenMontage `_full_mix` 独立 speech tracks Exit Gate 验收（2026-08-30 20:32）

状态：`ACCEPTED`（仅 C12.4-S03 切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 纠察员独立复核确认固定来源 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `audio_mixer.py::_full_mix/_track_filters` 语义未漂移；两段独立正式 speech 已测量并以绝对起点进入来源 mixer，缺轨、非法 target、payload identity、重叠/间隙/目标边界和 duration/window 不一致均 fail-closed。
- 新鲜定向证据：`services/media-runtime/tests/test_runtime.py` 101 passed；`services/media-runtime/adapters/openmontage_audio/test_adapters.py` 11 passed（含受控 ffmpeg/ffprobe 实际 3 秒单音频轨产物）；Production Worker 45/45；Persistence 53 pass / 10 个明确 `DATABASE_URL` skip；Contracts 36/36。state validator 与 `git diff --check` 通过；根 452/18 skip 证据保持为此前最新整仓基线，未在本次文字验收中重跑。
- 平台仅增加既有 workspace/project、StoragePort、临时路径、MIME/SHA/ffprobe、错误归一化和 ALCHMED8 私有载体边界；未新增 ALCHMED9、第二套 AudioPlan、逐 cue Piper、SLOW/FAST、变速、裁剪、补静音、Provider/TTS、网络、Veyra、部署或 Git 操作。
- S03 验收不覆盖 approved full-track section-level windows、完整 AudioPlan 语义、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音和超长旁白 consumer 等章节硬门；因此总体状态不升级。按用户授权，下一活动切片切换为 S04，但 S04 尚未完成验收。

### C12.4-S04 OpenMontage 完整 AudioPlan 消费启动记录（2026-08-30 20:32；历史快照，已移出活动态）

状态：`IN_PROGRESS`（当前唯一活动切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 本切片只消费现有 ALCHMED8 已定义的 AudioPlan identity、ownership、asset、start/end、gain/fade、transcript 和 music window，并继续复用固定 OpenMontage 音频输入语义；旧 ALCHMED1–7 仅兼容读取。
- 平台边界仅限既有 workspace/project、StoragePort、MIME/SHA/ffprobe、受控临时路径、错误归一化和脱敏；来源未定义或无法验证的字段保持已有错误和 fail-closed，不新增 magic、第二套 AudioPlan、公共 UI/API、Provider/TTS 或网络逻辑。
- S04 尚无完成证据，未标记 `READY_FOR_AUDIT`；实现、定向行为/负向测试、集成和脱敏审计完成前不得升级状态。

### C12.4-S04 首项来源字段对账（2026-08-30 20:52；历史快照，已移出活动态）

- 对照固定来源 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_track_filters/_full_mix`，Runtime 仅补齐既有 ALCHMED8 `MUSIC.gain_db` 到来源线性 `volume` 的映射：`composition_plan.music_volume * _openmontage_track_volume(gain_db)`；未增加协议、算法、阈值、变速、静默回退或第二套 AudioPlan。
- 定向证据：`python -m pytest -q tests/test_runtime.py -k "compose_maps_audio_plan_music_gain_into_source_full_mix_volume"` 为 `1 passed / 101 deselected`；完整 `tests/test_runtime.py` 为 `102 passed`；`adapters/openmontage_audio/test_adapters.py` 为 `11 passed`；state validator 与 `git diff --check` 通过。未调用真实 Provider/TTS/Veyra/网络/VPS/DNS/TLS/部署/Git。
- 纠察员只读复核确认该映射属于 ALCHMED8/source-faithful 薄适配，未发现越界；同时确认 S04 仍缺 transcript 字段的实际下游消费、music window 逐窗口语义、完整 restart/repeat、跨工作区和公开脱敏行为证据。上述缺口保持 `IN_PROGRESS`，不得升级 `READY_FOR_AUDIT`。
- 状态对账不变：S03=`ACCEPTED`（仅切片），S04=`IN_PROGRESS`，C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`；S03 的硬门边界及章节总体未完成项继续原样保留。

### C12.4-S04 MUSIC 窗口/ducking 与 Worker 边界复核（2026-08-30 21:15；历史快照，已移出活动态）

- 固定来源仍为 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_track_filters/_full_mix`。来源只接受每轨 `volume`、`start_seconds`、fade 和一个全局 ducking 开关；没有 `end_seconds` 或多段 MUSIC window 的输入语义。
- Runtime 薄适配仅把既有 ALCHMED8 `MUSIC.gain_db` 复合为来源线性 `volume`，把既有 `duck_under_narration` 映射为来源全局 ducking；当 MUSIC payload 无对应 ownership track，或窗口不是单一 `(track.start_ms, target_duration_ms)` 时，在来源 mixer 前以既有 `QC_FAILED` 失败，避免静默丢弃/延长音乐。未新增协议、magic、滤镜图、阈值、变速、补静音或第二套 AudioPlan。
- 行为证据：`python -m pytest -q tests/test_runtime.py -k "independent_speech_tracks_with_source_full_mix or music_gain or music_track_duck_flag or music_windows_not_expressible"` 为 `4 passed / 100 deselected`；完整 Runtime `104 passed`；OpenMontage adapter `11 passed`。新增负向测试确认 multiple window 不调用来源 mixer。
- Worker 行为证据：`pnpm --filter @alchemy-video/production-worker test` 为 `47/47`；新增 duplicate claim 不重复读取/确认，跨 workspace MUSIC 在 compose 前拒绝，现有最终审阅持久化摘要不含 `object_key`、`provider_request_id`、`transcript_script`。Persistence `53 pass / 10 explicit DATABASE_URL-gated skip`、Contracts `36/36`、Domain `43/43`、根 typecheck 通过。
- 未闭合项原样保留：transcript 的真实字幕/转写下游（S06）、完整 restart/repeat 产物级集成、approved full-track section windows、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音及超长旁白 consumer。结构性门控证据不等于这些问题已解决。
- 状态不升级：S03=`ACCEPTED`（仅切片），S04=`IN_PROGRESS`，C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`；未调用真实 Provider/TTS/Veyra/网络/VPS/DNS/TLS/部署/Git。

### C12.4-S04 完整 ALCHMED8 full-track 来源消费复核（2026-08-30 22:05；历史快照，已移出活动态）

- 来源固定为 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_full_mix/_track_filters`。完整 ALCHMED8 的单条 narration bytes 现在只在唯一、覆盖全目标的 `PLATFORM_NARRATION` 轨和单一 `PRIMARY` section 窗口下映射为来源 `speech` 轨；独立 section bytes 仍按既有 track identity/绝对起点映射，源视频剩余音频作为来源 `sfx`。
- 编码器与 Runtime 解码器均对多平台旁白轨、未消费的 full-track section 窗口和不完整 payload 直接 `QC_FAILED`，不静默选轨、不猜 section offset；完整/独立 ALCHMED8 均调用同一来源适配器，ALCHMED1–7 兼容路径保持不变。未新增 ALCHMED magic、字段、第二套 AudioPlan、滤镜图、变速、补静音或外部调用。
- 行为证据：`python -m pytest -q tests/test_runtime.py -k "complete_audio_plan"`（cwd `services/media-runtime`）`12 passed / 97 deselected`；`python -m pytest -q tests/test_runtime.py adapters/openmontage_audio/test_adapters.py` `119 passed / 0 failed`，含受控 FFmpeg/ffprobe 全轨音视频产物（video+audio、目标时长 2s）；`pnpm --filter @alchemy-video/production-worker test` `51/51`；Production Worker typecheck、state validator、`git diff --check` 均 PASS。
- 状态不升级：S04 仍 `IN_PROGRESS` / `verifying`，C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。完整 restart/repeat 产物集成、transcript 的实际字幕/转写下游、不可由来源表达的 approved full-track section offsets、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音和超长旁白 consumer 硬门继续原样保留；无真实 Provider/TTS/Veyra/网络/VPS/DNS/TLS/部署/Git。

### C12.4-S04 restart/repeat 产物幂等复核（2026-08-30 22:22；历史快照，已移出活动态）

- 依据现有 Worker/StoragePort 事务边界，在 `apps/production-worker/tests/media-service.test.ts` 的 approved narration 测试中，先写入与 compose 结果一致的确定性 `composed.mp4`，再处理 composition，模拟 Worker 在对象写入后、`completeProductionComposition` 提交前重启。
- 复用既有 `storeArtifact` 的 `If-None-Match: *`、MIME、byteSize 和 SHA-256 比对；同一不可变对象安全复用，approved narration 仍不触发 Piper，最终 persistence 只执行一次。没有增加协议、状态、算法、阈值或平行写入逻辑。
- 新鲜证据：`pnpm --filter @alchemy-video/production-worker test` `51/51`；`pnpm --filter @alchemy-video/production-worker typecheck` PASS；`python -m pytest -q tests/test_runtime.py adapters/openmontage_audio/test_adapters.py`（cwd `services/media-runtime`）`121 passed / 0 failed`。
- 纠察员确认该项属于 S04 允许的可靠性证据；S04 保持 `IN_PROGRESS/verifying`，C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`。approved full-track section windows、transcript 实际字幕/转写下游、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕、中文口音和超长旁白 consumer 等硬门仍未闭合；未调用真实 Provider/TTS/Veyra/网络/VPS/DNS/TLS/部署/Git。
### C12.4-S04 artifact conflict fail-closed 复核（2026-08-30 22:49；历史快照，已移出活动态）

- 在已有“对象写入后重启、相同 MIME/byteSize/SHA 可安全复用”的正向证据之外，新增同一派生 `composed.mp4` 对象键但内容不一致的负向 Worker 行为测试。既有 `storeArtifact` 在 `If-None-Match: *` 失败后通过 `inspectObject` 比对 MIME、byteSize、SHA-256，拒绝覆盖冲突对象；`completeProductionComposition` 不执行，租约释放且保留根错误。
- 该项只复用现有 StoragePort 与不可变产物边界，没有新协议、状态、算法、阈值、平行写入路径或 OpenMontage 逻辑。新鲜证据：Production Worker `52/52`，typecheck PASS。
- 状态不升级：S04=`IN_PROGRESS/verifying`，C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`；approved full-track section windows、transcript 实际字幕/转写下游、transition/xfade、cue-only full-narration-first、Studio 审批/TimelinePlan、`REQUIRED` 字幕、中文口音和超长旁白 consumer 等硬门继续保留。

### C12.4-S04 music-only AudioPlan 来源消费复核（2026-08-30 23:06；历史快照，已移出活动态）

状态：`IN_PROGRESS` / `verifying`（不升级切片或章节状态）。

- 来源证据：固定 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_full_mix` 在无 speech、仅 music（可选 sfx）时仍走来源 `amix`、target-duration 和 normalize。平台仅调整 `services/media-runtime/runtime.py::compose_video_bundle` 的既有分支，让 ALCHMED8 `audio_plan + music_bytes` 走该来源路径；旧 `_mix_music_track` 仍只服务兼容载荷。
- 既有 ownership、asset identity、absolute start/end、gain/fade、music window 校验和冲突/跨工作区边界未改变；没有新增 wire、算法、阈值、滤镜图、策略或 fallback。
- 行为证据：Media Runtime music-only focused `1 passed / 110 deselected`；Runtime+OpenMontage adapters `122 passed / 0 failed`；Production Worker `53/53`；Production Worker typecheck、state validator、`git diff --check` PASS。
- 未完成硬门继续原样保留：来源无法表达的 approved full-track section offsets/多窗口、transcript 实际字幕/转写下游、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音认证、超长旁白 consumer。未调用真实 Provider/TTS/Veyra/网络/VPS/DNS/TLS/部署/Git。
- Exit Gate 结论：本增量已完成来源支持的 MUSIC-only handoff，但 S04 的整体合同/产物/重启/重复/跨工作区/脱敏及上述硬门尚未形成完整可验收证据，继续 `IN_PROGRESS/verifying`；C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。

### C12.4-S01 / E02 活动切片状态对账（2026-08-31）

- （历史状态快照）S03 保持 `ACCEPTED`（仅切片）；S02 保持 `READY_FOR_AUDIT`。C12.4-S01/E02 已通过独立审计并为 `ACCEPTED`（仅切片）；S04 历史记录与未闭合硬门保留，但已移出活动态；本行“E03 尚未启动”仅为早期快照，现行 E03/E04 状态见文末最新对账。
- E02 仅使用 `index.ts` 注入的 `HttpPixabayMusicClient`/Media Runtime 路径；`createApp` 未显式注入时为 `null`，不构造第二个 Node 直连抓取器。该句“未重跑”属于早期状态对账，已由下方最新 focused 运行证据 supersede。
- C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`；S01/E02 的 `ACCEPTED` 仅覆盖本切片，不能升级总体状态。未调用真实 Provider/TTS/Veyra/网络/VPS/Git。

### E02 最新 focused 证据补充（2026-08-31）

- client `6/6`、Runtime source `4/4`、handler `3/3`、Control API 角色/幂等 `5/5`、loopback 集成 `1/1`；0 skip，全部 fixture/mock，无外网。
- S01/E02 已通过独立审计并为 `ACCEPTED`（仅切片）；S04 不活动；本行“E03 尚未启动”仅为早期快照；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`，未升级总体验收。

审计结论：基于上述 focused/Studio fixture 证据，纠察员确认来源路径、角色隔离、边界校验和无网络 fixture 证据充分，S01/E02 通过独立审计并标记 `ACCEPTED`（仅切片）；本记录不代表 C12.4/C12.5 总体完成。

### C12.4-S01 / E02 技术 Exit Gate 状态同步（2026-08-31）

- 依据下列本轮实际运行且可复核的 focused/Studio fixture 证据（基础 `last_verified_at=2026-08-31T01:52:23+08:00`）：合并 Control API 命令 `23/23`（Pixabay client `6/6` + Control API `17/17`）；独立窄切片为 client `6/6`、Runtime source adapter `4/4`、handler `3/3`、Control API 角色/导入/幂等 `5/5`、capability BLOCKED `1/1`、loopback `1/1`、Studio explicit Pixabay/no-auto-catalog `1/1`；全部 fixture/mock、0 skip、无真实网络。另有 `last_verified_at=2026-08-31T08:25:25+08:00` 的 Runtime finite supplemental fixture `1/1`，拒绝 `NaN`、`Infinity`、`-Infinity` duration。独立窄切片与合并命令有覆盖重叠，不另行相加。
- E02/S01 技术 Exit Gate 已通过独立审计，现行状态为 `ACCEPTED`（仅切片）；Node 直连 scraper 条目与旧 17:45 状态均为历史快照/superseded。该段“E03 为下一候选但尚未启动”是早期快照；S04 已移出活动态。
- C12.4/C12.5 总体继续 `IMPLEMENTED_PENDING_AUDIT`；本次只做状态/审计文字对账，未新增测试、代码、契约或外部调用。

### E03/HB-STORYBOARD-TIMING 当前实施对账（2026-08-31）

- 固定来源为 `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `backend/workspace/skills/storyboard-breaker/SKILL.md`；来源正式分镜段为 8–15 秒，台词容量规则为 `字符数 / 4.5 + 2 秒表演余量`，装不下时沿来源边界移到后续段落。
- 最小实现仅收口 `packages/domain/src/creative-planning.ts::assertStoryboardPlan`、`packages/contracts/src/creative-planning.ts::StoryboardShotSpecSchema` 的 8–15 秒边界，并由 `packages/creative-planning/src/index.ts` 复用既有 `STORYBOARD_SPEC_INVALID` 路径阻断无法形成合法正式段的结果；没有新增余数、慢放、填充、裁剪或 Provider 调用逻辑。
- 定向证据：`pnpm --filter @alchemy-video/creative-planning test` `38/38`、`pnpm --filter @alchemy-video/domain test` `43/43`、`pnpm --filter @alchemy-video/contracts test` `36/36`，并运行 `pnpm contracts:generate`；均 0 skip/fail。未调用真实 Provider/TTS/Veyra/网络/VPS，未执行 Git 写操作。
- `GenerationSegmentMotionPlan` 的 1–15 秒兼容范围、MotionBeat 与 Huobao 2–4 子镜头语义、editorial 评分、对话分组和 remainder 分配仍未完成来源等价映射，按 `UNREFERENCED`/冲突项冻结；不得把结构性边界测试宣称为完整子镜头迁移。
- 当时状态快照：E03 8–15 秒窄切片=`ACCEPTED`（仅切片）；独立纠察已完成 READY→ACCEPTED 状态流程；E04/Piper pace 当时 `READY_FOR_AUDIT/verifying`；该句已由后续 E04 验收及 E06 当前账本 supersede。C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`。

### E03/HB-STORYBOARD-TIMING 独立审计记录（2026-08-31）

- 纠察员以固定 Huobao commit `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `storyboard-breaker/SKILL.md` 对照复核：本切片的 8–15 秒正式段边界已在 Domain、StoryboardShotSpec 契约和规划器生成后既有断言路径中一致落地；未发现本轮新增算法、协议、UI/API、Provider 或外部调用。
- 复核证据：creative-planning `38/38`、domain `43/43`、contracts `36/36`，`pnpm contracts:generate` 已通过；0 skip/fail，全部本地 fixture/单元测试。契约导出物的 `StoryboardShotSpec.duration_seconds.minimum=8` 可复核。
- 范围结论：E03 仅包含 8–15 秒边界窄切片；Huobao 每段 2–4 子镜头、每子镜头 2–6 秒及 video-prompt 的 `[镜头N]`/3 秒映射没有固定平台等价实现，MotionPlan、editorial、dialogue grouping、remainder 仍为 `UNREFERENCED`/冲突并冻结，不纳入本次验收。
- 独立 Exit Gate：该窄切片已完成 `READY_FOR_AUDIT`→`ACCEPTED` 流程，但不能把它写成完整 Huobao 迁移；本条只覆盖 8–15 秒边界。E04/Piper pace 已进入下一独立执行切片；C12.4/C12.5 总体继续 `IMPLEMENTED_PENDING_AUDIT`。

### E04/S02 Piper pace 与原始参数边界（2026-08-31；历史快照，已由后续 E04 验收 supersede）

- 固定来源为 `calesthio/OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/piper_tts.py::PiperTTS._generate`、`tools/audio/tts_selector.py::TTSSelector` 与 `skills/meta/voice-performance-director.md`；来源只提供数值 `length_scale`/`sentence_silence`、stdin 文本和 `timeout=300`，没有平台 `SLOW`/`FAST`/`BRISK` 的数值映射。
- 当前 E04 只允许复核/适配原始命令参数、stdin、WAV 实测和 `timeout=300`，并对没有来源映射的 symbolic pace 保持既有 fail-closed；不接入云 TTS、不新增 `-i/-f` 协议、不做 atempo/变速或自造阈值。
- 历史状态：E04/S02=`ACCEPTED`（仅 Piper pace/原始参数窄切片）；真实 Provider/TTS/Veyra/网络/VPS/Git 仍关闭。该段后续已由 E05 验收及 E06 当前账本 supersede。

### E04/S02 Piper pace READY_FOR_AUDIT 记录（2026-08-31；历史快照，已由下方验收记录 supersede）

状态：`READY_FOR_AUDIT/verifying`（切片状态；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 来源核对：固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `piper_tts.py::_generate`、`tts_selector.py` 和 `voice-performance-director.md` 只提供原始数值参数、stdin、WAV 产物和 `timeout=300`，不提供平台 `SLOW`/`FAST`/`BRISK` 的数值映射。
- 实现边界：`services/media-runtime/adapters/openmontage_audio/piper.py` 仅保留 `NATURAL=1.0`；`runtime.py` 传递来源参数、stdin 并以 WAV 实测时长为事实，对未映射 symbolic pace 在 Piper 前 fail-closed；selector 的云 provider 仅保留 metadata，未形成可执行网络路径。没有 `-i/-f`、atempo、变速、padding、裁剪或新协议。
- 定向证据：adapter source-conformance `4/4`、Runtime Piper/WAV/error/unsupported pace `6/6`，补充 SLOW/FAST/BRISK fail-closed `1/1`、contracts export `32/32`；全部本地 fixture/mock，0 skip/fail，未调用真实 TTS/Provider/Veyra/网络/VPS/Git。
- 允许保留的未完成边界：中文口音、云 TTS、完整多 cue 声学连续性及 C12.4/C12.5 的 approved section windows、完整 AudioPlan、transition/xfade、Studio、REQUIRED 字幕和超长旁白 consumer 等硬门不受本切片证据影响。
- 下一步：由独立纠察员复核来源、代码差异、测试命令和账本一致性；未收到通过结论前不得标记 `ACCEPTED` 或进入 E05。

### E04/S02 Piper pace 独立审计与 Exit Gate（2026-08-31）

状态：`ACCEPTED`（仅 Piper pace/原始参数窄切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 纠察员按固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 复核 `piper_tts.py::_generate`、`tts_selector.py` 与本地 adapter/runtime：原始 `--model/--speaker/--length-scale/--sentence-silence/--output_file`、stdin、WAV 实测和 `timeout=300` 保持一致；仅 `NATURAL=1.0` 有来源映射，SLOW/FAST/BRISK 均在 Piper 前 fail-closed。
- 复核确认未出现第二协议、`-i/-f`、atempo、变速、padding、裁剪、云 TTS、真实 Provider、网络或 Git 操作；selector 云条目仅 metadata。`timeout=300` 由固定来源及 `services/media-runtime/runtime.py:296-304` 静态核对，未虚构未执行的行为断言。
- 最新证据：adapter source-conformance `4/4`、Runtime Piper/WAV/error/unsupported pace `6/6`、SLOW/FAST/BRISK 补充 `1/1`、contracts export `32/32`；全部本地 fixture/mock、0 skip/fail。主线与纠察员独立复核均通过。
- 结论范围严格限定为上述 Piper 原始参数/未映射 pace 边界；中文口音、云 TTS、完整多 cue 声学连续性，以及 approved section windows、完整 AudioPlan、transition/xfade、Studio、REQUIRED 字幕和超长旁白 consumer 等硬门继续未完成。完成 E04 不代表 C12.4/C12.5 总体完成。

### E05/OpenMontage `_full_mix` 与 ALCHMED8 来源消费启动（2026-08-31；实现快照，已由下方验收记录 supersede）

状态：`READY_FOR_AUDIT/verifying`（实现快照；现行已由下方 `ACCEPTED` 窄切片记录及 E06 当前账本 supersede；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::_track_filters/_full_mix`；本切片只核对已有 ALCHMED8 字段到来源 speech/music/sfx、absolute start、fade、ducking、target-duration 和 normalize 语义的映射。
- 允许的薄壳仅限 workspace/project-scoped Asset + StoragePort、MIME/SHA/byteSize/ffprobe、受控临时路径、错误归一化和脱敏；不得新增 ALCHMED9、第二 AudioPlan、逐 cue Piper、SLOW/FAST 映射、atempo、裁剪、补静音或外部调用。
- 已有 S03 speech-track 与 S04 music-only 局部证据均视为输入，不能直接宣称 E05 整体完成；本章需逐项检查角色冲突、跨工作区、缺资产、gain/fade/ducking、目标时长、对象冲突、Worker 重启/重复和受控 FFmpeg/ffprobe 产物。
- 本轮实现证据已实际运行：Runtime focused `18 passed / 94 deselected`；OpenMontage full-mix adapter `3/3`；Production Worker `53/53`，全部本地 fixture/mock、0 skip/fail。覆盖 independent speech、music-only、SFX/source preservation、角色/资产/跨工作区、gain/fade/ducking、目标时长、不可表达窗口 fail-closed、对象冲突、Worker 重启/重复和受控 FFmpeg/ffprobe 产物。主线来源审计确认实现仅对应固定 commit 的 `_track_filters/_full_mix`，未新增 ALCHMED9、第二 AudioPlan、算法阈值、静默回退或外部调用。
- Exit Gate 申请：以上仅支持已表达 ALCHMED8 字段，提交独立审计；approved section windows、transition/xfade、字幕/转写、Studio、中文口音和超长旁白 consumer 仍保留为未闭合硬门。
- 其余 approved section windows、transition/xfade、字幕/转写、Studio、中文口音和超长旁白 consumer 仍是独立硬门，不在本切片自动关闭。

### E05/OpenMontage `_full_mix` 与 ALCHMED8 独立审计与验收（2026-08-31）

状态：`ACCEPTED`（仅 E05/OpenMontage `_full_mix` + ALCHMED8 窄切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 纠察员按固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 独立复核 `audio_mixer.py::_track_filters/_full_mix` 的 volume→fade→ffprobe fade-out→absolute `adelay`、speech/music/sfx 分组、ducking (`ratio=9`、`level_sc=1`、`mix=0.9`)、target `apad/atrim`、normalize/loudnorm 与 music-only `amix` 语义；Runtime/Worker 只通过既有 ALCHMED8 字段和平台 Storage/workspace 薄壳连接。
- 证据：Runtime focused `18 passed / 94 deselected`；OpenMontage full-mix adapter `3/3`（含受控 FFmpeg/ffprobe 产物）；Production Worker `53/53`（含角色/资产/跨工作区、对象冲突、重启/重复及幂等）。全部本地 fixture/mock、0 skip/fail；未调用真实 Provider/TTS/Veyra/网络/VPS/Git。
- 未发现第二 AudioPlan、ALCHMED9、算法/阈值、静默回退、逐 cue Piper 或来源宿主状态穿透。来源无法表达的 partial/multiple window 保持 fail-closed。
- 验收范围严格限定为上述已表达字段；approved section windows、transition/xfade、字幕/转写、Studio 样音/审批/TimelinePlan、中文口音和超长旁白 consumer 等其它硬门继续 `BLOCKED/DEFERRED`，不得据此宣称 C12.4/C12.5 总体完成。

### E06 approved full narration 窗口与 cue-only 边界实施启动（2026-08-31；实现快照，已由下方证据提交 supersede）

状态：`IN_PROGRESS/implementing`（历史实现快照；当前唯一活动切片已提交 `READY_FOR_AUDIT/verifying`；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源为 OpenMontage explainer narration/asset 规则与 `audio_mixer.py::_full_mix` speech-track 输入；本切片只处理独立、非样音、已测量 PRIMARY section 资产的绝对起点消费，以及唯一从 0 覆盖全目标 `PLATFORM_NARRATION` 整轨兼容形态。
- partial/multiple section windows、缺失 asset version、样音冒充正式资产和 cue-only 多 cue 保持已有 fail-closed；不逐 cue 调 Piper，不裁剪、变速、补静音，不从脚本文本推断音频窗口。
- E06 尚未形成当时的实现/产物证据；该句已由下方新鲜定向证据提交 supersede。transition/xfade、字幕、Studio、中文口音和超长旁白 consumer 继续是独立硬门。

### E06 approved full narration 窗口与 cue-only 定向证据提交（2026-08-31；提交前快照，已由本条结论收口）

提交时状态：`READY_FOR_AUDIT/verifying`；本条结论已收口为 `ACCEPTED` 窄切片（C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源：OpenMontage explainer narration/asset 规则与 `tools/audio/audio_mixer.py::_full_mix` speech-track 输入，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。平台现有 Runtime/Persistence/Worker 仅接受独立、非样音、已测量 PRIMARY section 资产，或唯一从 0 覆盖全目标的 `PLATFORM_NARRATION` 整轨；来源无法表达的 partial/multiple windows、样音复用、缺失 asset version、cue-only 多 cue 保持 fail-closed。
- 新鲜定向行为证据（2026-08-31T10:10:04+08:00；全部本地 fixture/mock，0 fail/skip，无 TTS、网络或外部服务）：Runtime `17 passed / 95 deselected`；OpenMontage full-mix adapter `3 passed / 8 deselected`；Persistence approved narration timeline `13 passed / 0 skipped`；Production Worker E06 选择集 `6 passed / 0 skipped`。
- 覆盖 AudioPlan identity/absolute windows、完整整轨兼容、独立 section speech tracks、HOLD/cue-only 边界、样音/正式资产隔离、版本/工作区/MIME/SHA/时长校验、缺失资产和未批准时间线 fail-closed；未新增逐 cue Piper、时长修正、裁剪、变速、补静音、第二协议或外部调用。
- Exit Gate 结论：技术证据足以提交本窄切片 `READY_FOR_AUDIT`；纠察员已独立复核来源、代码边界和计数并通过，E06 窄切片标记 `ACCEPTED`。transition/xfade、字幕、Studio 样音审批/TimelinePlan、中文口音和超长旁白 consumer 等硬门仍未闭合。

### E07 transition/xfade 与有效时长实施启动（2026-08-31；历史快照，已由下方验收记录 supersede）

历史状态：`BLOCKED`（授权前快照；平台映射子项当时为 `UNREFERENCED`；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源范围：OpenMontage `tools/video/video_stitch.py` 与 explainer `edit-director.md`/`compose-director.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- 先定位具体 transition/xfade 符号、参数、滤镜顺序、有效时长和产物语义；平台已有常量若无固定来源支持，保持 `BLOCKED/DEFERRED`，不得新增转场算法、阈值、协议或静默 fallback。
- 仅在来源审计通过后用既有真实媒体夹具测量段首/段尾、重叠/间隙、A/V 总时长和字幕窗口；真实 Provider/TTS/Veyra/网络/VPS/Git 继续关闭。

### E07 transition/xfade 与有效时长来源审计阻断（2026-08-31；历史快照，已由下方验收记录 supersede）

- 固定 OpenMontage `tools/video/video_stitch.py` 与 explainer `edit-director.md`/`compose-director.md` 的来源审计已完成；`_stitch_cut`、`_stitch_crossfade`、`_stitch_fade_through_black`、`_get_xfade_offset`（`max(0, clip_duration-transition_duration)`）和 `_chain_xfade`（累积 offset、无 `tpad`）是已定位来源符号。
- 平台 `PASS/BLEND/BRIDGE` 到来源 `cut/crossfade/fade` 的语义映射未证明；Runtime 当前 `tpad+xfade` offset、音频 `concat/acrossfade` 分支及 target/effective-duration 行为也未证明与来源等价，故 E07 当前为 `BLOCKED`，上述映射子项为 `UNREFERENCED`。
- 在用户授权前不改代码、不补 E07 测试、不新增算法/阈值/协议/静默 fallback；该段为授权前历史阻断快照，已由下方当前证据 supersede。总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。

### E07 transition/xfade 与有效时长实施、审计与验收（2026-08-31）

状态：`ACCEPTED`（仅来源可表达 uniform transition 窄切片；C12.4/C12.5 总体仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源：OpenMontage `tools/video/video_stitch.py` 的 `_stitch_cut`、`_stitch_crossfade`、`_stitch_fade_through_black`、`_get_xfade_offset` 与 `_chain_xfade`，以及 explainer `edit-director.md`/`compose-director.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。用户授权最小映射 `PASS→cut`、`BLEND→crossfade`、`BRIDGE→fade-through-black`。
- 实现范围：`services/media-runtime/runtime.py` 仅复用来源 transition type、0.1–5.0 秒 source schema、`max(0, …)`/round offset、累积 offset 和 no-`tpad` 语义。cut 使用既有 filter concat 作时间轴等价薄壳，不宣称来源 concat-demuxer/`-c copy` 编码等价；未新增协议、平行算法或外部调用。
- 定向证据：`python -m pytest -q tests/test_runtime.py -k "maps_pass_to_source_cut or maps_bridge_to_source_fadeblack or cumulative_offset_rounding or rejects_mixed_source_transition_plan or rejects_different_bridge_durations or continuous_narration_crossfade"` → `6 passed / 113 deselected / 0 failed / 0 skipped`；包含 PASS cut、BLEND crossfade、BRIDGE fadeblack、N 段 cumulative offset、mixed/different bridge duration fail-closed、continuous narration non-cut fail-closed。全部本地 fixture/mock，纠察员独立复核通过，无真实 Provider/TTS/Veyra/网络/VPS/Git。
- 未闭合边界：mixed transition、不同 bridge duration、continuous narration 非 cut、target/effective-duration mismatch 等来源未表达形态继续 `BLOCKED/DEFERRED`；E08 segmented/HyperFrames 需要独立授权，字幕、Studio/TimelinePlan、中文口音及超长旁白硬门不因本切片关闭。
- Exit Gate：E07 仅来源可表达 uniform transition 窄切片完成 `READY_FOR_AUDIT→ACCEPTED`；“下一活动切片为 E09”是该历史记录的顺序快照，现行活动为 E10。

### E09/OM-TRANSCRIBE-SUBTITLE 实施、独立审计与验收（2026-08-31 11:14）

- 固定来源：OpenMontage `tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py::_build_cues/_hmsms`、`tools/video/remotion_caption_burn.py::_render_ffmpeg`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。
- 实施只覆盖 source-expressed 子集：受控 CPU/int8 faster-whisper 的 `word_timestamps=True`/`vad_filter=True`、词时间/概率三位舍入；8 词/42 字 cue 分组与毫秒进位；checked timing 生成 SRT 后走来源 FFmpeg `subtitles` fallback，保留音轨并写入 `alchemy_captions=burned_srt`。REQUIRED 缺失能力或 timing 在 FFmpeg 前 fail-closed。
- 本轮唯一代码修正为 `services/media-runtime/runtime.py::_subtitle_srt_from_transcript` 的 cue flush：按来源 `_build_cues` 清空旧文本并以当前词起新 cue；此前 9 词夹具会错误产生 8+9，修正后为 8+1。未改变公共契约、状态、时长策略或模块边界。
- 定向证据：`python -m pytest -q tests/test_runtime.py -k "transcriber_reports_unavailable or transcriber_capability_rejects_interpreter or transcriber_capability_probes_the_same_interpreter or transcriber_preserves_source_word_timestamp_flags_and_rounding or subtitle_srt_reuses_source_8_word_42_char_grouping_and_ms_rounding or caption_burn_uses_checked_word_timestamps_and_marks_artifact or caption_burn_requires_checked_source_timing_before_ffmpeg or caption_burn_handler_returns_marked_video_headers or caption_handler_rejects_raw_mp4_and_malformed_json or caption_handler_rejects_oversized_video_base64 or transcribe_handler_returns_source_aligned_unavailable_payload"` → `11 passed / 111 deselected / 0 failed / 0 skipped`；完整 Runtime `122 passed / 0 failed / 0 skipped`。均为本地 fixture/mock，无模型、TTS、Provider、网络、Veyra、VPS 或 Git。
- 纠察员独立复核通过：未发现第二协议、脚本推时序、新评分/阈值、第二 fallback 或真实调用。GPU/device/model/language metadata、diarization、Remotion 主路径、VTT/JSON/correction/highlight、中文口音和完整 Studio REQUIRED 事实链继续 `DEFERRED/BLOCKED`。
- Exit Gate：E09 source-expressed transcript/subtitle/FFmpeg fallback 窄切片完成 `READY_FOR_AUDIT→ACCEPTED`；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。下一活动切片为 E10 Studio 样音/正式资产/TimelinePlan；E08 segmented/HyperFrames 与 E12 真实 TTS/口音仍按独立授权/外部门禁处理。

### E10 Studio 样音、正式旁白资产与 TimelinePlan（2026-08-31 11:26:59；窄切片已验收）

提交状态：`READY_FOR_AUDIT/verifying`；纠察员独立审计通过后，本条收口为 `ACCEPTED`（仅窄切片；总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`）。

- 固定来源为 OpenMontage `skills/meta/voice-performance-director.md` 与 `skills/pipelines/explainer/asset-director.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。来源要求样音先于批量旁白、正式资产与样音对象分离、记录可测量时长并保持 provider/voice/settings 一致；平台只复用既有 approval event、asset-version 和 TimelinePlan 边界，不新增公共字段或协议。
- 现有实现的 source-expressed 窄边界：样音审批只写事实，不把样音提升为正式资产；正式旁白必须是独立、非样音、READY 资产，并通过 workspace/project、版本、AUDIO MIME、SHA、字节数、实测时长及绝对 section window 校验；缺失审批/资产/时间线、样音复用、版本漂移、重叠或跨工作区数据均 fail-closed。
- 新鲜本地 fixture/mock 定向证据（全部 `0` fail/skip、无 Provider/TTS/网络）：creative-planning `7/7`；persistence narration-quality + approved-timeline `16/16`；Control API C12.7B `2/2`；Production Worker approved narration/timeline/sample/version/continuous-narration 选择 `7/7`；Studio project-flow/project-shell `24/24`。
- 纠察员独立核对确认：上述证据支持该窄切片完成 `READY_FOR_AUDIT→ACCEPTED`，但不能证明完整 Studio 自动生成样音→审批→正式资产→TimelinePlan UI/API，也不能证明 source 顶层 `voice_performance`、完整 section `delivery_cues`、最敏感 section 自动选择/人工听感、approved sample path/provider settings manifest、provider-specific mapping 或真实 TTS/中文口音质量；这些保持 `DEFERRED/BLOCKED`。用户上传旁白/样音不是当前自动流程前提。`normalizeNarrationSections`/`buildNarrationTimeline` 是平台既有逻辑，不宣称固定来源等价。
- Exit Gate：E10 仅来源可表达的 approval fact、独立正式资产与 TimelinePlan identity/window 边界已完成 `READY_FOR_AUDIT→ACCEPTED`；四账本已同步，E11 现为唯一活动章节并进入来源盘点。

### E11 超长旁白 consumer 与弹性总时长（2026-08-31 13:19；S08 窄切片 ACCEPTED；完整 E11 未验收）

当前状态：S08 内部 measured-duration feedback、decision-log 幂等与 compose 前 consumer fail-closed 窄切片已独立审计并 `ACCEPTED`；完整 E11 仍未 `ACCEPTED`，不得把该切片当作完整 E11 或据此启动未授权章节。

- 当前开发授权仅为固定 OpenMontage `skills/pipelines/explainer/compose-director.md` 与 `executive-producer.md`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。`scene-director.md:146-169` 仅同源审计候选/`DEFERRED`，不构成当前开发授权；本窄切片已完成逐符号薄适配和行为验证。
- 仅允许迁移来源明确表达的 measured narration duration、超长改稿/重新生成或视觉尾段延长决策、禁止慢放/裁剪/补静音及 visual hold/ambient 关系；无来源的阈值、评分、时长修正、Provider 选择、第二协议和 UI 状态保持 `DEFERRED/BLOCKED`。
- 逐符号映射：`compose-director.md:80-107` 为 85–90% 时长预算、words/sec 预算、TTS 原始参数及 `audio_duration_seconds` 超长反馈、Pixabay 参数；`:140-143` 为旁白/音乐覆盖和 ducking 前置校验；`:190-210` 为 Remotion 音频路径与不可用时 FFmpeg `audio_mixer` 顺序。`executive-producer.md:233-242` 为实际时长探测、`EP_STATE.narration_durations`、`1.15` 超长 SEND_BACK、`25%` 内 scene-plan 调整和总时长更新；平台未实现自动重规划/弹性时长，`scene-director.md` 不复用。
- 既有 consumer `services/media-runtime/runtime.py:1983-2022,2504-2524`、`apps/production-worker/src/media-service.ts:464-485,513-595` 的最新薄适配仅记录实测 narration facts，并在 compose 前对来源 `SEND_BACK`、`ADJUST_SCENE_PLAN` 及 `SOURCE_DECISION_REQUIRED` fail-closed；不执行自动改稿、视觉延长、重规划、慢放/裁剪/补静音，也不改变 CompositionPlan/ALCHMED wire。来源 compose-director `>1s` 与 executive-producer `1.15/25%` 规则的重叠无固定优先级，平台保留 `source_actions=[SEND_BACK,ADJUST_SCENE_PLAN]`，不擅自决策。
- Fresh local fixture/mock 证据（2026-08-31 13:27，0 fail）：Contracts `37/37`、Domain `48/48`、Production Worker 全量 `56/56`，E11 选择集 `7/7`；Persistence 幂等集成在项目自带本地 PostgreSQL 容器上 `1/1`；相关 `tsc --noEmit` 均 exit `0`，`validate_state.py`=`OK`，无 Provider/TTS/网络/Veyra/VPS/Git 或其它外部调用。
- Persistence 重放负向边界于 13:30 再跑 `1/1`：同一 event-derived id 的相同 metadata/sourceRevision 可重放；相同 event id 但不同 `productionRunId` 被拒绝，确认不会静默替换来源事实。
- Exit Gate 结论：内部 measured-duration feedback contract/decision-log 幂等与 consumer fail-closed 窄切片证据齐全，纠察员已独立复核并将本窄切片从 `READY_FOR_AUDIT` 收口为 `ACCEPTED`；完整 E11 的自动 SEND_BACK 执行、视觉延长/重规划/弹性时长仍 `DEFERRED/BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。E08 segmented/HyperFrames 与 E12 真实 TTS/口音仍需分别授权和来源证据。

### E08 `_segmented_music` 与 HyperFrames timed audio 启动审计（2026-08-31 13:54:48；历史启动快照）

当前唯一活动切片为 E08，状态 `IN_PROGRESS/implementing`；E11/S08 measured-duration feedback/decision-log/consumer fail-closed 仅保留已独立审计的 `ACCEPTED` 窄切片，完整 E11 自动重规划/视觉延长仍 `DEFERRED/BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。本条是启动和来源对账历史快照，不是 E08 完成或验收；当前实现证据见下方 checkpoint。

- 固定来源：OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py::AudioMixer.execute/_segmented_music` 与 `tools/video/hyperframes_compose.py::_resolve_audio_refs`，以及 `skills/core/hyperframes.md:143-162` HTML audio contract。
- 逐符号映射：`AudioMixer.execute` 以 `operation="segmented_music"` 独立分派；`_segmented_music` 保留 `video_path`、`music_path`、`music_volume`、`segments[{start,end}]`、`fade_duration`、`output_path`，按 start 排序构造来源 volume/fade 表达，`amix normalize=0` 保持旁白 unity，并输出原视频流与 shaped music。该操作不并入 `_full_mix`。
- HyperFrames 映射：`_resolve_audio_refs` 将 `asset_manifest.assets[]` 的独立 narration/music 文件写入 HTML `<audio>`，由 `data-start`/`data-duration` 表达时间窗，并保留来源 track/volume 关系。平台不照搬来源对缺失 asset 的静默 `continue` 或 basename 路径 fallback；不能把整轨 bytes 猜切为多个独立文件。
- 现有平台差异：启动时尚无独立路径是历史快照；当前落点为 `services/media-runtime/adapters/openmontage_audio/{segmented_music.py,hyperframes_audio.py}` 与 `runtime.py` 内部 helper。适配器只接收受控路径/独立 asset，Runtime 复用既有 Storage/workspace/project/MIME/SHA/ffprobe/错误边界，不新增公开 UI/API/Provider/网络协议。
- 本回合“未改代码/未运行测试”是历史快照。当前证据与边界见下方 checkpoint；平台 invalid/non-finite/out-of-range window、missing/越权独立 asset、MIME/SHA/ffprobe 和未验证 `data-start`/`data-duration` fail-closed；来源允许的 overlap additive/输入顺序由适配器保留，既有 CompositionPlan/Runtime helper 在平台边界拒绝 overlap。

Exit Gate 尚未满足；保持 E08 `IN_PROGRESS/implementing`，不得标记 `READY_FOR_AUDIT`/`ACCEPTED`，等待下方实现证据完成同步后的独立复核。

### E08 `_segmented_music` 与 HyperFrames timed audio 实施审计 checkpoint（2026-08-31 14:40；ACCEPTED 窄切片）

- 固定来源与落点：OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `AudioMixer._segmented_music` → `segmented_music.py::OpenMontageSegmentedMusicMixer`；`HyperFramesCompose._resolve_audio_refs` 与 `skills/core/hyperframes.md:143-162` → `hyperframes_audio.py::OpenMontageHyperFramesAudio`。保留 source 参数、排序/fade、overlap `+` additive、`amix normalize=0`、独立文件 timing、track 2/3、optional/explicit-zero end fallback 和 source volume default；仅补既有 workspace/project、角色、MIME、byteSize、SHA、ffprobe、路径和错误事实门禁。
- Runtime `segment_music_video_bytes` 不并入 `_full_mix`，只在已有 `MediaRuntimeCompositionPlan.music_segments_ms` 边界按 start 排序并拒绝 overlap；`resolve_hyperframes_audio_refs` 要求显式 workspace/project scope。没有新增 AudioPlan、公开协议、UI、Provider、网络调用或自造时长/音频算法。
- 新鲜本地 fixture/mock 证据：adapter `14/14`；Runtime focused `3 passed / 122 deselected / 0 failed / 0 skipped`；Runtime full `125 passed / 0 failed / 0 skipped`；adapter combined `25 passed / 0 failed / 0 skipped`。受控 ffmpeg/ffprobe/WAV 产物夹具实际执行，无外部调用。
- 审计结论：纠察员已独立复核固定来源、代码范围和最新证据，独立验收通过，E08 来源可表达窄切片由 `READY_FOR_AUDIT/verifying` 收口为 `ACCEPTED`；总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。完整 HyperFrames renderer、重启/重复产物整合、完整 AudioPlan/section windows、Studio/字幕/中文口音/超长旁白硬门保持 `DEFERRED/BLOCKED`，须另行来源证据。

### E12 真实 TTS、中文口音与外部能力授权审计（2026-08-31；历史阻断快照，已 superseded）

- 审计范围固定为已登记 OpenMontage TTS adapters/selector（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`）。现有 Piper 原始参数/结构适配的本地证据不等同于真实 TTS 或中文口音质量证据。
- `E12` 在本段记录时为 `BLOCKED`：尚未提供可审计的具体 provider/profile、调用次数、源素材范围、额度上限、凭据注入方式和外部调用授权。该段为历史快照，不覆盖下方本轮用户授权的真实视频 Provider canary。
- `READY_FOR_AUDIT` 的前置条件是上述材料齐备后完成来源映射、离线 preflight、明确授权的真实调用与音频/口音/产物审计；未满足前不允许新增 mapper、语速/时长算法、协议、UI 或部署逻辑。总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，其余完整 AudioPlan/section windows、Studio、字幕、转场和长旁白硬门保持 `DEFERRED/BLOCKED`。

### E12 本轮真实 30 秒/480P Provider、Piper 与音乐实测审计（2026-08-31 16:05；BLOCKED，未验收）

- 用户明确授权使用当前程序已有能力并指定 `480p`；本轮按现有 Control API→Production Worker→`sub2api:grok-imagine-video-1.5` 路径，在“保险AI介绍”项目中以四张 READY 参考图和逐图明确的 SUBJECT/SCENE/STYLE 来源说明完成一轮真实 30 秒 canary。生产 `prd_01M1BD7G2CHTQPPPBA2QZSV0Q1` 两个 15 秒段各一次 Provider attempt 均成功，最终 `848x480`、`30.084s`、`video/mp4`、`6460435` bytes，Composition QC=`PASS`，`music_applied=true`、integrated `-14.2 LUFS`、true peak `-1.7 dBTP`、无意外静音。该结果是视觉/音频产物证据，不是中文口音验收。
- 同一项目第一次批量用途说明存在歧义时，生产 `prd_01M1BD21H6TGKJ94F4A8V2PYF2` 按现有角色解析门禁保持 `BLOCKED`，两个段 `WAITING`，没有创建 task/provider attempt；补齐不冲突的逐图说明后才进入上述成功实测。未修改角色解析代码。
- 现有 Media Runtime Piper 单次 endpoint 对保险文案输出 `audio/wav`、`716680` bytes、实测 `16250ms`、`22050Hz mono PCM`；silencedetect 未发现 `>=0.5s` 尾部静音。该证据只证明本地一次合成和产物边界，不能替代云 TTS、普通话口音或完整旁白组合听感。
- Pixabay 显式导入按既有唯一 Runtime source path 执行时返回 `503 PROVIDER_UNAVAILABLE`，外部页面为 `403`；没有启动第二 scraper、自动回退或伪造成功证据。
- 本轮没有创建正式 `NarrationAssetVersion` 或完整 `TimelinePlan`，没有把样音当正式旁白，也没有新增语速/时长修正/补静音/第二 AudioPlan/Provider 协议/UI。approved full narration section windows、完整 AudioPlan、transition/xfade、cue-only full-narration-first、Studio 样音/审批/TimelinePlan、`REQUIRED` 字幕事实链、中文口音和超长旁白 consumer 仍 `DEFERRED/BLOCKED`；E12 不升级 `READY_FOR_AUDIT` 或 `ACCEPTED`，总体保持 `IMPLEMENTED_PENDING_AUDIT`。
- 根级 `pnpm test`（2026-08-31 20:44）实际为 `470 passed / 19 explicit skips / 0 failed`，覆盖 18 个 workspace 项目；skip 保留为环境门控事实，不作为通过，且本次未新增真实 Provider/TTS/Veyra/网络/VPS/Git 调用。

## E12 本轮优化盘点与回归审计补记（2026-08-31 23:12；BLOCKED）

- 来源/范围复核没有发现可安全新增的固定仓库逻辑、协议、算法或 UI；E01–E11 接受状态不变，未重开任何已接受窄切片。
- C12 默认本地栈 UI E2E 通过：MUSIC 上传、两段 Mock、Runtime 合成/QC、成片播放/下载、390px 布局；该结果为 Mock 2 秒夹具，不能替代正式 narration/TimelinePlan/口音证据。
- 最新证据：根 `pnpm test`=`490 tests / 471 passed / 19 explicit skips / 0 failed`；Media Runtime+OpenMontage adapters=`150 passed / 0 failed / 0 skipped`；`py_compile`、`pnpm typecheck`、`pnpm build` 通过。全部本地 fixture/mock，未新增外部调用。
- 审计结论：E12 继续 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。正式 NarrationAssetVersion/TimelinePlan、approved section windows、完整 AudioPlan、Studio 样音/审批、REQUIRED 字幕、中文口音、混合/连续非 cut 和超长旁白自动消费等硬门原样保留；不得用本轮结构/本地 Mock 证据升级。

### R01 原仓库语音 owner 边界局部实现审计（2026-09-01 00:53；局部 IMPLEMENTED，完整 BLOCKED）

- 固定来源：OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/tts_selector.py`、`tools/audio/piper_tts.py`、`tools/video/grok_video.py`；本轮用户授权仅覆盖本地代码、fixture 和审计，不包含新的真实 Provider/TTS、网络、Veyra、VPS 或 Git 操作。
- 已实现且可复核：`services/media-runtime/adapters/openmontage_audio/selector.py` 去除手工 provider tuple；无来源 registry 时 `auto`/空值显式 `UNAVAILABLE`，仅明确 `piper`/`piper_tts` 可选。`apps/production-worker/src/media-service.ts:538-543` 在连续旁白有 canonical script/cue、但无 approved narration bytes/tracks 时沿用 `QC_FAILED`，阻止裸 script 进入 Piper；approved narration asset、Storage bytes、SHA/byte/duration、`inspectAudio` 和既有时长反馈路径保持。
- 行为证据：selector `2 passed / 9 deselected / 0 skipped`；Worker `26 passed / 0 failed / 0 skipped`；`git diff --check` 无错误，仅现有换行提示。所有证据为本地 mock/fixture。
- 完整 Exit Gate 仍 `BLOCKED`：当前 `VideoProviderPort`/profile 没有固定来源可核验的 `native_audio`/`generate_audio` owner，Runtime 没有 OpenMontage registry discovery/rank 正向映射；`packages/provider-video/src/prompt-compiler.ts:33` 仍保留旧 PLATFORM_NARRATION/禁止 Provider dialogue 语义。不得把局部 guard/selector 测试升级为 `READY_FOR_AUDIT`/`ACCEPTED`，不得进入 R02；总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。

### E12/R01 Doubao source mapper 与用户授权 smoke 审计补记（2026-09-01；历史快照，MAPPER_ONLY/PARTIAL，已 superseded）

- 固定来源为 OpenMontage `tools/audio/doubao_tts.py::DoubaoTTS`，commit `4eab34c5cfcccaa4f1970554928feccce73ee930`。新增落点 `services/media-runtime/adapters/openmontage_audio/doubao.py` 只保留 source submit/query URL、`X-Api-*` headers、`req_params`、`voice_id`/`resource_id` 覆盖、错误提示和 secret redaction；未执行 HTTP、未注册 provider、未改 Runtime/Worker/Contracts/API。
- `test_doubao.py` + selector focused `7 passed / 9 deselected / 0 skipped`，`py_compile`、`git diff --check` 通过；均为 fixture/mock。用户已授权 source `DoubaoTTS.execute` 一次 smoke，使用外部环境注入的 `DOUBAO_SPEECH_API_KEY`/`DOUBAO_SPEECH_VOICE_TYPE`，profile `seed-tts-2.0`/`zh_female_vv_uranus_bigtts`，产出 MP3 `57372` bytes 与 metadata `2506` bytes；主机无 `ffprobe`，不作时长断言。
- 仓库 bundled `ffprobe-static` 随后对同一 MP3 离线测量为 `2.856000s`、`mp3`、24 kHz mono；不含网络调用，仍仅为 source/artifact evidence。
- 这只是来源/API credential evidence，不是平台 TTS owner/profile、正式 NarrationAsset/TimelinePlan、section windows、中文口音听感或 E12 Exit Gate。`OM-DOUBAO=MAPPER_ONLY/PARTIAL`，E12/R01 保持 `BLOCKED`，总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`；原有 approved narration、AudioPlan、Studio、字幕、转场和长旁白硬门原样保留。

### E12/R01 Doubao 显式 Runtime 薄壳审计补记（2026-09-01；历史 VERIFYING，当前 BLOCKED/已回收；前述 MAPPER_ONLY 为历史快照）

- 来源复核：固定 OpenMontage `tools/audio/doubao_tts.py::DoubaoTTS`（commit `4eab34c5cfcccaa4f1970554928feccce73ee930`）的 submit/query/download 顺序、`X-Api-*` headers、`req_params`、预查询 sleep、`task_status=2/3`、timeout `(10,60)/(10,120)`、metadata 写入和 voice/resource override 均在 `services/media-runtime/adapters/openmontage_audio/doubao.py` 保持；平台只做受控临时文件、bytes/MIME/SHA/size/ffprobe 和 secret/signed-URL 脱敏边界。
- 来源 selector 复核：`selector.py` 不建立本地排名或自动 fallback；`auto`/unknown 在无 OpenMontage registry 时 fail-closed，显式 Doubao 需 `DOUBAO_SPEECH_API_KEY`，显式 Piper 维持既有离线兼容路径。Runtime `main.py` 仅对 `preferred_provider=doubao|doubao_tts` 进入 Doubao helper，未注入 provider 的历史 Piper handler 保持兼容。
- 契约/Worker 复核：内部 loopback narration schema/client 只转发 source voice/resource/format/sample-rate/speech-rate/timestamp/usage/poll/timeout 字段和实际音频 MIME；无公共 DTO、第二 AudioPlan、UI、计费或新时长算法。Worker 外层 abort 采用 source `timeout_seconds`，不截断大于默认 300 秒的显式源窗口。
- 最新本地行为证据（fixture/mock，0 skip）：Media Runtime `151/151`；Doubao/selector adapter `24/24`；Production Worker Runtime Client `23/23`；Worker typecheck、`py_compile`、`git diff --check` 均通过。新增 handler 夹具确认 source 字段/MIME 保留、auto provider 阻断；未进行额外网络调用。
- 用户授权真实 Runtime smoke：使用外部 profile `seed-tts-2.0` / `zh_female_vv_uranus_bigtts`，显式 Doubao route 完成 submit→poll→download，返回 `audio/mpeg`、`37212` bytes、bundled ffprobe `1850ms`。不记录 key/task/request/url；该证据不替代中文口音人工听感、正式 NarrationAsset/TimelinePlan、approved section windows、native owner 或完整 E12 验收。
- 历史审计结论（已回收）：显式 Doubao 代码/行为切片达到 `IMPLEMENTED`，提交本节 `READY_FOR_AUDIT` 评审前的技术证据已齐，但本轮不把它写成 `ACCEPTED`。E12/R01 总体曾为 `VERIFYING`，当前为 `BLOCKED`；C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`。source registry/rank 正向映射、native audio owner、正式旁白时间线、Studio 审批、REQUIRED 字幕、人工中文口音和超长 consumer 硬门继续 `BLOCKED/DEFERRED`。本节 route/smoke 仅为历史证据，不构成当前验收或新的外部调用授权；此前 MAPPER_ONLY/“route disabled”文字仅为授权前历史快照。

## 当前状态回收（2026-09-01；现行口径）

- E12/R01 当前统一为 `BLOCKED`：完整 source registry/rank、native/TTS owner、正式 narration asset/TimelinePlan、approved section windows 和人工中文口音硬门仍未闭合。上文 `VERIFYING`、显式 route 与真实 smoke 仅为历史证据，不构成当前验收或新的外部调用授权。
- C12.4/C12.5 当前维持 `IMPLEMENTED_PENDING_AUDIT`；不恢复或伪造 E02/S01 状态，不进入 R02。Doubao adapter 继续隔离保留，默认不启用。
- `apps/production-worker/src/index.ts` 已移除 `MEDIA_RUNTIME_NARRATION_PROVIDER` 全局启动注入；显式受控入口和测试保留，不能推导默认 provider。

## 2026-09-01 R01 native-first / explicit-Doubao 实测补记（当前 BLOCKED，未验收）

- 本条依据用户最新明确授权，仅执行一次 native Provider canary 与一次显式 Doubao Runtime canary；不改变默认 Mock、公共契约、章节顺序或 owner 状态，不引入自动 fallback、第二协议、语速/时长修正或计费逻辑。
- 固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/video/grok_video.py::GrokVideo.supports["native_audio"]`、`tools/audio/doubao_tts.py::DoubaoTTS`。native canary 产物 `D:\AI\alchemy_video_OS\.codex-longrun\media-review\prj_01M1DF7RZ2VCQPFVGZ7DRWB2DK-tsk_01M1DF7S1W2TRN0HA5A9N7FM8M-native.mp4`：`video/mp4`、`848x480`、`15.042s`、`5071855` bytes，含 AAC 44.1kHz stereo 音轨；ffprobe/静音覆盖通过，但离线 Whisper 未得到可靠中文台词，不能视为中文口音或语义验收。
- 显式 Doubao canary 通过现有 loopback `POST /internal/v1/media/narration`，profile `seed-tts-2.0`、voice `zh_female_meilinvyou_uranus_bigtts`，返回 `audio/mpeg`；产物 `D:\AI\alchemy_video_OS\.codex-longrun\media-review\maoshan-doubao-1788232895802.mp3`，`157212` bytes、Runtime `7850ms`、ffprobe `7.848s`、24kHz mono；无 `>=0.5s` 尾静音，内部停顿约 `0.585s`，响度约 `-24.3 LUFS`、true peak `-9.3 dBFS`。密钥/task/request/url 未写入审计记录。
- 本地 persistence native/TTS owner fixtures 已同步执行：`production-repository.test.ts` + `production-repository.native-audio.test.ts` 共 `7/7` pass、0 fail、0 skip；覆盖 native 保留源音轨、approved narration 冲突 fail-closed、TTS 正向 narration、`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 不成为最终输出。该行为证据不替代 source registry/rank 正向映射、profile capability 认证、正式 `NarrationAssetVersion`/TimelinePlan/section windows、Studio 样音审批或人工听感。
- Exit Gate 结论：R01/E12 继续 `BLOCKED`，C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，不进入 R02；未闭合硬门原样保留。上文“无真实 TTS/route”仅属授权前历史快照，由本条当前证据覆盖，但不改变验收状态。

### R01 selector provider-tuple 收敛审计补记（2026-09-01）

- 来源对照：固定 OpenMontage commit `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/tts_selector.py::TTSSelector` 通过 `ToolRegistry.get_by_capability("tts")` 工作，provider 元数据来自已注册 `BaseTool`；本地无该 registry，因此不保留自造 `TTSProviderMetadata` 或 Piper/Doubao 候选 tuple。
- 最小变更仅将 selector 返回值收敛为来源 provider 字符串，保留显式 Piper/Doubao 与 Doubao key guard；`auto`/unknown 继续 fail-closed，不实现 R02 registry discovery/rank/score/preference、默认云路由或 fallback。
- 定向 fixture：`2 passed / 9 deselected / 0 skipped`，全部本地 mock。R01 完整 Exit Gate 仍 `BLOCKED`，不得进入 R02；C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### R01 新鲜本地回归对账（2026-09-01）

- Doubao/selector fixture：`24 passed / 0 failed / 0 skipped`；Production Worker Runtime Client：`23/23`；Production Worker media-service：`26/26`；Worker typecheck exit `0`。
- `validate_state.py=OK`；`git diff --check` 无错误（仅既有换行警告）。全部为本地 fixture/mock，无真实 Provider/TTS/网络/Veyra/VPS/Git。
- 该证据不改变章节结论：E12/R01 仍 `BLOCKED`，不得标记 `READY_FOR_AUDIT`/`ACCEPTED` 或启动 R02；C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。

### E12/R01 本地启动配置边界复核（2026-09-01 10:05；不改变状态）

- `infrastructure/local/start-full-local-stack.ps1` 仅按固定 OpenMontage `DoubaoTTS.execute` 的来源环境名读取 process/user/.env.local 值，并在 Media Runtime 子进程启动期间临时继承 `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`；`finally` 恢复父进程环境，不注入 Worker、不落盘、不打印、不改变默认 `VIDEO_PROVIDER=mock`。
- 重启与本地边界证据：PowerShell parser、完整栈服务/端口、Control API `/api/v1/health`=`200`、Python Doubao/selector fixture `24/24`、Worker Runtime Client `23/23`、typecheck、`validate_state.py` 和 `git diff --check` 均通过；无真实 Provider/TTS/网络/Veyra/VPS/Git 调用。
- 本条只确认配置传递和启动恢复，不证明 source registry/rank、native/TTS owner、正式 NarrationAsset/TimelinePlan、approved section windows、人工中文口音或完整 E12/R01 Exit Gate；E12/R01 继续 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`，不得进入 R02。

### R01/E12 最终本地回归与当前阻断对账（2026-09-01；BLOCKED）

- 最新可复核本地证据：Provider-video `45/45`、Production Worker `59/59`、Media Runtime/OpenMontage `151/151`，均 `0 failed / 0 skipped`；Production Worker typecheck exit `0`。测试均为 fixture/mock，不含新的真实 Provider/TTS/网络/Veyra/VPS/Git 调用。
- 本地栈已恢复默认 `VIDEO_PROVIDER=mock`；Control API health 返回 `status=ok`、`database=ok`；`validate_state.py=OK`，`git diff --check` 无 whitespace error（仅既有换行警告）。
- 当前结论不升级状态：E12/R01=`BLOCKED`，C12.4/C12.5=`IMPLEMENTED_PENDING_AUDIT`。未闭合硬门仍为 source registry/rank 与 native profile capability 认证、正式 NarrationAsset/TimelinePlan/approved section windows、Studio 样音审批、完整 AudioPlan/REQUIRED 字幕、人工中文口音听感及长旁白 consumer 行为；不得以本地绿测或一次 canary 代替。其余历史 VERIFYING/MAPPER_ONLY/READY 记录均保留为历史证据。

### R01 分段旁白绝对时间窗修复审计补记（2026-09-01 13:38；局部 IMPLEMENTED，完整 BLOCKED）

- 固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/audio/audio_mixer.py::_full_mix` 的 speech track `start_seconds`、`target_duration`、`apad/atrim`，以及 Explainer Edit/Compose Director 的“旁白不超过对应视觉窗口、短时由已声明音乐/视觉尾段覆盖”规则。平台仅修复本地等长误门：`services/media-runtime/runtime.py:2617-2625` 以绝对 track 起点调用现有时长/尾窗校验；`apps/production-worker/src/media-service.ts:56-68,462-509` 复用声明尾窗覆盖；`packages/persistence/src/approved-narration-timeline.ts:80-85,311` 只拒绝正式 asset 超出 PRIMARY 窗口。
- 代码/行为证据：Runtime `131/131`、Worker `27/27`、Persistence 生产/本地 native-audio/approved timeline `20/20`，Worker typecheck、`py_compile`、`validate_state.py` 通过；均为本地 fixture/mock，0 skip/fail，无新增外部 Provider/TTS/网络/Veyra/VPS/Git 调用。纠察员复核确认没有新增变速、裁切、静音、自动重规划、协议或平行混音图。
- 已用用户项目 `茅山温泉・桃李春风 松弛的生活` 的两段原始镜头（各 15.042s）、已有两段 Doubao 音频（10.188s/6.635s）和现有本地 BGM fixture 通过 ALCHMED8/OpenMontage `_full_mix` 生成 `.codex-longrun/media-review/maoshan-project-doubao-segmented-bgm-composed.mp4`（848x480、30084ms、H.264/AAC mono 48kHz、4142899 bytes），未检测到 >=0.5s 尾静音。该产物仅证明 source consumer 的时间窗/尾段覆盖，不等同于人工语义验收。
- Exit Gate：本次只关闭“短分段旁白被错误等长门拒绝”这一局部缺口，R01/E12 仍 `BLOCKED`，总体 C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`；正式 NarrationAsset/TimelinePlan、完整 owner/registry/profile、Studio 审批、REQUIRED 字幕、完整 section-window 事实链和人工中文听感硬门原样保留，不进入 R02。

### R01 分段旁白修复最终本地复核（2026-09-01 13:44；不升级）

- 复核既有用户项目产物 `maoshan-project-doubao-segmented-bgm-composed.mp4` 的 ffprobe 与尾静音检测，以及本地 Control API health；产物为 `848x480/30.084s/H.264/AAC mono 48kHz`，未检出 `>=0.5s` 尾静音，health/database=`ok`。
- 本条仅补记可复核的本地产物/服务证据，不改变 source-backed 局部 IMPLEMENTED 结论；E12/R01 仍 `BLOCKED`，C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`。正式 NarrationAsset/TimelinePlan、owner/profile、完整 section-window、Studio、REQUIRED 字幕和人工听感硬门继续保留。

### R01 lip-sync source-first 复核（2026-09-01 14:12；用户决定延期，当前范围通过）

- 来源固定为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`tools/avatar/lip_sync.py::LipSync` 的既有 VIDEO + replacement AUDIO → Wav2Lip `inference.py` 调用，及 `skills/creative/lip-sync-usage.md` 的“先生成替换音频、再对原视频做 lip-sync、只对适合的可见人脸镜头使用”规则。`kling_lip_sync.py` 是需显式 face/session 的云端分支，当前本地阶段不接入。
- 平台复核确认：没有 lip-sync Runtime tool/Worker client/内部输入契约，也没有已认证 `avatar_lip_sync` capability；本机 `WAV2LIP_PATH` 未设置，`wav2lip` 与 `torch` 不可用。用户已接受当前范围并将该能力延期，故不作为当前交付阻断；native owner、TTS owner 隔离和 `lip_sync_requirement=REQUIRED` capability 预检保持原语义，未新增代码、协议或算法。
- 定向行为证据：Runtime native/audio-owner/narration `33/33`（98 deselected）、domain delivery-preflight `6/6`、provider-video runtime-profile `12/12`、persistence native-audio `4/4`；0 skip，全部 fixture/mock，无外部调用。证据仅证明 fail-closed 边界，不证明 lip-sync 产物或口型验收。
- Exit Gate：本 lip-sync 延期项按用户决定通过当前范围，但不宣称已实现口型同步；R01/E12 仍因 owner/profile、正式资产/时间线和其它硬门保持 `BLOCKED`，总体 C12.4/C12.5 继续 `IMPLEMENTED_PENDING_AUDIT`。未来启用时待 source capability/profile 与明确内部输入/产物契约，再按原仓库顺序实施；不得把 Maoshan B-roll 或音频混合结果宣称为 lip-sync 修复。

### P0/P1 源仓库未到位能力补齐辅助审计（2026-09-01 16:01；不改变正式状态）

- 本条只审计执行清单 N01–N04，不创建新正式章节，也不覆盖 `.codex-longrun/state.json`、正式总控或既有 E/R 状态账本。固定来源为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/audio/audio_mixer.py`、`tools/analysis/transcriber.py`、`tools/subtitle/subtitle_gen.py`、`tools/video/remotion_caption_burn.py` 及既有 voice-performance 规则。
- N01/P0 `IMPLEMENTED`（技术上可提交 `READY_FOR_AUDIT`）：Runtime 音频 MIME 由 ffprobe format facts 归一化；stream/format 时长各自 finite 且大于 0 后才沿用 source-aligned `max`；Worker 保留 approved asset 的 SHA/byteSize/正时长/绝对窗口。定向 Runtime inspect `3/3`（含 NaN/Infinity fail-closed），完整 restart/repeat 与全部 section-window 组合仍未形成独立审计证据。
- N02/P0 `IMPLEMENTED`（技术上可提交 `READY_FOR_AUDIT`）：适配器保持 source `_track_filters`/`_full_mix` 的 role、绝对 start、volume/fade、ducking、normalize 和 target-duration 顺序；本轮只补 SFX 夹具。`adapters/openmontage_audio/test_adapters.py`=`11/11`，完整组合和 Worker restart/repeat 仍未关闭。
- N03/P1 `BLOCKED/DEFERRED`：来源要求记录实际样音 provider/voice/model/settings、最敏感 section 人工 Sample Gate 和设置漂移回门；现有 `ApproveNarrationScriptRevisionCommandSchema` 无对应字段，Control API 的 `piper-local/platform-generic-zh` 硬编码不能作为来源事实。本轮未改公共契约/代码，需 ADR、实际样音和人工审批后再议。
- N04/P1 `IMPLEMENTED`（技术上可提交 `READY_FOR_AUDIT`）：checked word timestamps 按 source 8-word/42-char 生成 SRT，FFmpeg subtitles fallback 由 Worker 的 `REQUIRED` 策略触发；仅追加 `-movflags use_metadata_tags` 使既有 `alchemy_captions=burned_srt` marker 在 MP4 format tags 持久化。定向 Runtime `9/9`（含真实 bundled ffmpeg/ffprobe MP4：audio stream、duration、SHA/byteSize、marker，0 skip），Worker `27/27`；Worker 端仍为本地 fixture boundary，丰富模式/人工字幕质量继续 deferred。
- 纠察结论：未发现新算法、阈值、公共协议、平行 AudioPlan、静默 fallback 或真实外部调用；没有把 mock/静态检查冒充产物。E12/R01 仍 `BLOCKED`，C12.4/C12.5 仍 `IMPLEMENTED_PENDING_AUDIT`，本辅助条目不授予进入 N05 或 R02 的权限。

### P0/P1 辅助审计最终本地回归（2026-09-01 17:34；不改变正式状态）

- N01/N02/N04 的 source-first 复核无新增生产差异；N05 的 Huobao 子镜头/场景约束在当前平台没有等价契约承载，继续 `BLOCKED/DEFERRED`，N03/N06 亦未解除既有前置阻断。
- 最新可复核证据：media-runtime `134/134`、OpenMontage adapters `11/11`、persistence `20/20`、production-worker media-service `27/27`、creative-planning `39/39`、domain `48/48`、contracts `38/38`；root `pnpm typecheck` exit `0`；root `pnpm test` exit `0`，最新合计 `484 pass / 19 explicit environment skips / 0 fail`。全部为本地 fixture/mock 或 bundled media，未调用真实 Provider/TTS/Veyra/网络/VPS/Git。
- 结论：N01/N02/N04 仅具备技术 `READY_FOR_AUDIT` 候选证据，不得写成 `ACCEPTED`；E12/R01 保持 `BLOCKED`，总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`，未进入 N05/R02。

### 当前自动旁白执行口径（2026-09-01；仅对账，不升级）

- 最新执行依据为《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》。当前自动视频流程不要求用户上传旁白或样音；样音由已确定 owner 的 native Provider 或操作者显式选择的 Doubao 在服务端生成，人工试听/审批后才可建立独立正式 `NarrationAssetVersion`。通用图片、资料、Logo、MUSIC 上传及 `NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 兼容角色仍保留。
- 用户已授权本机 Aiself Grok native 与显式 Doubao 对照；这只是调用授权，不代表 R01/E12 已验收，也不改变默认 Mock、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 或 `E12/R01=BLOCKED`。已有 native/Doubao canary 仅作产物/连通性证据；人工中文口音、正式资产/TimelinePlan、approved section windows、完整 AudioPlan、REQUIRED 字幕和长旁白硬门仍待证据。

### 2026-09-01 R01.2 内部生成与实际模式文档对账（当前实现证据，不升级状态）

- 现行口径以《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》1.3.0 为准：自动视频不要求用户上传旁白、样音或其它 spoken audio；`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 只保留兼容与隔离测试角色，通用图片、资料、Logo、MUSIC 上传不受影响。旧段落中把上传音频写成前置条件的内容均为历史快照，不能覆盖本条。
- R01.2 已存在的内部 `narration_audio.generation_requested` DTO/event、`NarrationQualityStore` 生成资产操作、既有 Media Runtime queue/Worker/Storage 消费和 provider/voice/settings identity/幂等校验按 ADR-0068 对账；`narration-audio` 公开路由不存在，也未加入 OpenAPI。当前代码行为证据只支持 `IMPLEMENTED_PENDING_AUDIT`，不表示 Studio 已有完整生成→试听→批准→正式资产→TimelinePlan 操作闭环。
- `HttpMediaRuntimeClient` 对显式 Doubao/DoubaoTTS 采用 OpenMontage 300 秒默认 deadline；Piper 仍是显式离线兼容路径，未成为默认 owner。native Grok 结果保留 Provider 音轨，不自动切 Doubao；替换必须由操作者显式选择。
- 用户授权的本机实际模式为 Aiself `Sub2ApiVideoProvider` + Grok `grok-imagine-video-1.5` 原生音频优先，Doubao `seed-tts-2.0`/`zh_female_meilinvyou_uranus_bigtts` 仅显式替换。仓库/CI 默认 `VIDEO_PROVIDER=mock` 不变，真实 Key 只在未入库环境中使用。
- 本条不升级 E12/R01：source registry/rank、profile capability snapshot、正式 NarrationAsset/TimelinePlan、完整 section windows/AudioPlan、Studio/字幕、超长旁白 consumer 和普通话人工验收仍为 `BLOCKED/DEFERRED`。本轮所有结构性测试和真实产物必须分别登记，不能互相替代。

### R01/E12 真实本机对照与全量回归（2026-09-01 22:47；技术证据，不升级）

- 现行自动旁白不要求用户上传音频/样音；本机按用户授权以 Aiself Grok native 优先、操作者明确选择时使用 Doubao。仓库/CI 默认 Mock 不变；`DeliveryPlan.voice_mode="PLATFORM_GENERIC"` 只作兼容字段，owner 取 profile snapshot。无新增公开音频路由、第二协议或自动 fallback。
- 本地回归可复核：root `pnpm typecheck`/`build`/`test` 成功，最新 workspace 合计 `492 pass / 19 explicit environment skips / 0 fail`；Media Runtime `134/134`；定向 Control API `18/18`、Studio `39/39`、Provider `21/21`、Worker media-service `29/29`、Worker Runtime client `25/25`、Persistence `21/21`；`validate_state.py=OK`，无 whitespace error。全部 fixture/mock 或 bundled media。
- 茅山同脚本对照：Grok native 单镜头 `848x480/15042ms` AAC stereo 48kHz、`7541849` bytes；原生两段合成 `848x480/30084ms` AAC stereo 48kHz、`4051750` bytes；显式 Doubao `audio/mpeg`、`176317` bytes、Runtime `8800ms`/ffprobe `8803ms`；单整轨无声明尾窗时按来源规则预期 `QC_FAILED/BLOCKED`。复用两段已生成 Doubao 音频和现有 BGM，经 OpenMontage `_full_mix` 绝对起点得到 `maoshan-project-doubao-segmented-bgm-composed.mp4`=`848x480/30084ms`、H.264/AAC mono 48kHz、`4142899` bytes，无 `>=0.5s` 尾静音。当前事实 JSON：`.codex-longrun/media-review/maoshan-project-current-comparison.json`；旧 comparison JSON 已显式历史/superseded。
- 审计结论：以上只是 profile/连通性、媒体事实和 source consumer 证据，不是普通话质量或正式资产验收。E12/R01 保持 `BLOCKED`，总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`；source registry/profile、正式 NarrationAsset/TimelinePlan、approved section windows、完整 AudioPlan/transition、Studio 样音审批、REQUIRED 字幕、超长 consumer 及人工中文听感硬门原样保留。

### 原仓库语音表现与段落边界窄适配审计（2026-09-02；辅助记录，不升级正式状态）

- 来源固定为 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`：`skills/meta/voice-performance-director.md` 的 `voice_performance`/`delivery_cues`/`provider_text`，explainer `asset-director.md` 的样音与实测时长门，`compose-director.md` 的 narration/mix 关系，以及 `tools/audio/piper_tts.py`、`tools/audio/audio_mixer.py::AudioMixer._full_mix`。辅助实施文档逐项列出这些文件和当前平台载体；旧语音专项文档仅作历史基线，不覆盖本条。
- 代码窄适配：`apps/production-worker/src/media-service.ts:629-689` 对单 cue 保留来源 provider text 和既有 delivery carrier；显式 Piper 才消费结构化 cue，Doubao/其它 provider 的默认 cue 只传 canonical text，非默认 delivery 在 Runtime 前 `MEDIA_RUNTIME_UNAVAILABLE` fail-closed；multi-cue、正式 section asset/full-mix、样音审批和正式资产链继续 `UNAVAILABLE/BLOCKED`。未新增 DTO、事件、协议、算法、UI 或外部调用。
- 纠察复核曾发现缺失的 Doubao Worker 行为证据，已由主线最小补齐：默认单 cue + Doubao 只传 `scriptText`；非默认单 cue + Doubao 不调用 synthesize/compose/persist。最新证据为 Worker package `66/66`、creative-planning `44/44`、Runtime 旁白窄测 `9/9`，Worker typecheck 与 diff check 通过；全部 fixture/mock 或 bundled media、0 skip。
- 审计判定：本辅助切片代码/测试可复核，但不授予任何正式章节 `READY_FOR_AUDIT` 或 `ACCEPTED` 状态。`.codex-longrun/state.json`、正式总控、总体状态和既有 E/R 账本保持原值：`E12/R01=BLOCKED`、`C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`。完整 multi-cue/full-mix consumer、approved NarrationAsset/TimelinePlan/section windows、样音人工审批和中文口音人工验收仍为硬门。

### 2026-09-02 两段成片合成失败与原生音频窄门复核（局部修复，不升级正式状态）

- 复核固定 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/subtitle/subtitle_gen.py::SubtitleGen._build_cues`：源代码不丢弃经三位小数取整后 `start == end` 的词。原 Runtime 在 `REQUIRED` 字幕烧录阶段误以 `end <= start` 拒绝，造成两段输入 `/compose 200` 后 `/captions 400`，前端显示成片失败。
- `services/media-runtime/runtime.py::_subtitle_srt_from_transcript` 已按来源最小放宽为只拒绝 `end < start`；非 finite、负值、倒序、越界、乱序、空词、`CHECKED` 和现有 SRT 分组门仍保留。`test_runtime.py:1486` 的 source-rounded fixture 覆盖该边界。纠察员复核通过，未新增协议、算法、Worker 状态或 fallback。
- 本地全栈按新源码重启后，固定保险项目既有两段素材 composition retry `202`→`SUCCEEDED`；视频版本 `vvr_01M1GD4R5TF04BXC9AD9NW3XHJ` 为 `30.084s`、QC=`PASS`、含音轨/BGM。最终资产现有 Runtime 转录为 `CHECKED`、72 词、5 个语音区间，说明产物存在可检测人声；区间空档、音量/节奏和中文听感仍需人工验收，不能以 ASR 代替。
- 证据：Runtime focused `6/6`（130 deselected）、`py_compile`、state validation、diff check 通过；全部使用本地已存片段/MinIO/loopback Runtime，未重新调用 Provider/TTS/网络/Veyra/VPS/Git。`E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 保持不变；`<80%` 截断、完整旁白时间窗/AudioPlan、正式 NarrationAsset/TimelinePlan 和人工口音仍是未闭合硬门。

### 2026-09-02 原仓库结构化分段与旁白时间窗迁移审计（辅助记录，不升级正式状态）

- 执行文档：《AI企业内容平台_原仓库结构化分段与旁白时间窗完整迁移开发文档.md》。固定来源为 Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `storyboard-breaker/SKILL.md`、`video-prompt/SKILL.md`，以及 OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 explainer `script-director.md`、`scene-director.md`、`voice-performance-director.md`、`asset-director.md`、`compose-director.md`。旧《原仓库语音表现与段落边界迁移实施文档》已标记 `HISTORICAL/SUPERSEDED FOR STRUCTURED SEGMENT EXECUTION`。
- 本轮最小代码落点仅为 `packages/creative-planning/src/index.ts` 私有对白提取/规划：保留作者换行 source unit；按来源 8–15 秒和 `chars/4.5+2` 容量门顺序装入段；单行仅沿现有句读/分隔标点形成连续片段；无合法边界保持原句并 fail-closed；去除旧等字符均分、固定 12 秒 seed、从 visual group 重新抽取对白和任意字符切块。未改公共契约、事件、Provider、AudioPlan、TimelinePlan 或 UI。
- 行为证据：`pnpm --filter @alchemy-video/creative-planning test`=`45/45 pass / 0 fail / 0 skip`；`pnpm --filter @alchemy-video/creative-planning typecheck`=`PASS`；`pnpm --filter @alchemy-video/workflow-worker test`=`16/16 pass / 0 fail / 0 skip`。测试覆盖保险 AI 三个 source unit 各自归属连续段、单行句读顺序、native prompt 不含邻段文本、逐段容量门和无合法边界超长行 fail-closed。全部本地 fixture/mock，无真实 Provider/TTS/网络/Veyra/VPS/Git。
- 纠察结论：代码/测试只证明 source-unit ownership 与容量规划窄适配；视觉事件与正式 `script_section_id` 的一一 owner、实测 NarrationAsset/TimelinePlan/绝对 section window、完整 AudioPlan/transition、字幕/Studio/重启重复及中文人工听感仍无证据，继续 `DEFERRED/BLOCKED`。既有 `hasCinematicEditorialBoundary` 评分逻辑不视为 Huobao 原规则的等价实现。
- Exit Gate：本辅助片可提交独立 `READY_FOR_AUDIT` 评审，但本轮不升级正式状态；E12/R01 保持 `BLOCKED`，总体 C12.4/C12.5 保持 `IMPLEMENTED_PENDING_AUDIT`，不得据此进入后续章节。
