# 剩余验收、证据和切换计划

日期：2026-10-10。核对基线：`3fd8410baf904e879ae353e796b98b10e7ea3495`（PR #4 候选代码）。

状态：`MOCK_HARNESS_IMPLEMENTED_CI_BLOCKED / NOT_ALL_CLOSED`。初始设计基于上述 SHA；文档评审后只实施了 C06/C12 Mock 测试工具的可移植/隔离/清理与现有 CI browser stage，见 §9。首次修订 `9419b30` 的 CI 已通过 C06 浏览器断言，但其 S3 资源清理因 SDK/XML 兼容问题失败，C12 未执行；具体回执见《实施与审计记录》。没有读取历史业务数据库、重新执行 QC、调用真实 Provider 或执行生产切换。用户已授权本地隔离调试。后续代码变化必须重新绑定快照和审计证据，不能继承此基线的测试结论。

## 1. 验收边界和当前缺口

本文件服从 `AGENTS.md`、领域/API 契约、本地 MVP 执行规格、《测试与验收策略》及《旧 Worker 混跑提交栅栏开发文档》。它不新增公共状态、Provider 协议、媒体算法、QC 阈值、模型路由凭证格式或自动修复流程。

| 剩余项 | 当前可证明的事实 | 尚缺内容 | 本轮可推进范围 |
| --- | --- | --- | --- |
| 历史 QC `qcr_01M43SVVW51YXJ3VH0N523SMGZ` | 历史审计文档记录 `NEEDS_ATTENTION / COMPOSITION` 及关联运行/资产身份 | 原始持久化 QC `details`、对应版本和产物的现时可读证据、当时 Runtime/build/config 身份 | 制定只读核对和离线校验规则；拿到实际证据后才能解释原因 |
| `MAD_ROUTE_RECEIPT` | 最新修复记录仍为 `ROUTE_UNVERIFIED` | 受信运行时实际路由记录；不能由请求配置推导 observed model/effort | 核对已存在记录及其绑定；缺失保持未验证 |
| 完整 C06 浏览器 E2E | 仓库有真实 Playwright UI 与 Mock Worker harness | 当前最终代码在受控云端完整执行的回执 | 可在任务专属 loopback PostgreSQL/Redis/MinIO 与云端 Chromium 上执行 |
| 完整 C12 浏览器 E2E | 仓库有分段、合成、播放/下载、移动端和脱敏断言 | Linux 可移植准备、完整执行和失败清理回执 | 可做最小测试工具适配后在同类隔离资源执行 |
| 真实 Provider/音频/媒体验收 | 本地 Mock、离线认证与历史产物均有明确适用边界 | 当前 profile/素材/调用范围授权及现场运行、下载、QC、人工听看证据 | 本轮只做离线测试与 preflight 清单，不调用收费服务 |
| 生产排空与 `0027/0028/0029` 切换 | 列栅栏文档明确旧在途窗口；本次 recovery 方案增加 supersession 事实与守卫 | 真实进程/镜像/自动重启清单、队列与上游对账、历史关系 HOLD、备份恢复及切换授权 | 可演练任务专属 Mock 环境；生产实际切换保持待办 |

必须分别报告以下事实：测试通过、ProductionRun 成功、VideoVersion 可播放、QC 状态、review coverage、continuity 状态、来源审计、实际 Agent 路由和生产发布。任何一项不能替代另一项。尤其 C12 当前期望的 `continuity_status=NEEDS_ATTENTION` 不等于历史成片 QC 的具体原因；Runtime 的 `PASS` 也可以伴随 `review_completeness=PARTIAL`、语义检查 `UNAVAILABLE`。

《测试与验收策略》中的命令列表是早期约定，实际入口以本次 `package.json` 为准。其“submit 前崩溃可重新提交”不能覆盖现行预留保护：只有可靠证明尚未预留/提交的执行才能进入正常提交分支；预留后结果未知仍须 fail-closed，不能把“无 request ID”当作未 POST。

## 2. 固定来源与代码锚点

下表行号用于基线定位，后续以符号和实际 diff 再核对。

| 编号 | 来源 | 本计划沿用的事实 |
| --- | --- | --- |
| S01 | `AGENTS.md` §2.2、§3.1、§10–14；`doc/AI企业内容生产平台_测试与验收策略.md` §2–6 | source-first、Mock/dev 默认、四层测试、真实调用/部署授权、诚实披露 skip |
| S02 | `doc/旧Worker混跑提交栅栏_开发文档_20261010.md` §1–8 | 旧列查询栅栏、在途 POST/扣费边界、T1–T9、协调切换和回滚条件 |
| S03 | `packages/persistence/src/schema.ts:1403`，`qcReports`；`production-repository.ts:771`，`serializeQcReport`；`:1968`，版本与 QC workspace/project 联合读取 | 数据库存 `details`，公开 DTO 只含安全摘要/有限音频字段；不能从公开摘要重建全部 QC 细项 |
| S04 | `packages/contracts/src/production.ts:56`，`QcReportSchema`；`:80`，`VideoVersionSchema` | 直接复用既有 ID、状态、版本和公开投影 schema，避免另造验收业务字段 |
| S05 | `services/media-runtime/runtime.py:1401`，`final_review_video_bytes`；`tests/test_runtime.py` 的 `test_final_review_*` | 状态与 `review_completeness` 分开；缺失 evaluator 不伪造语义通过；缺音轨/非预期静音/必需字幕缺失等按既有规则处理 |
| S06 | `doc/AI企业内容生产平台_章节审计记录.md` 的“2026-10-05 G02 已运行项目的持久状态事实更正（非 Exit Gate）”；`doc/修复开发记录_20261009.md` 末段 | 历史对象身份以及 QC、route 未闭合事实；该历史记载不是当前数据库或产物实测 |
| S07 | `doc/AI企业内容生产平台_G02路由凭证风险接受与验收门禁补充_20261004.md` §1–4；偏差收敛开发包 `06-审计放行和交付清单.md` §1–5 及 G02 supersession | G02 窄豁免只处理 route/Hook 元数据缺失的内容审计阻断力，不豁免身份、终态、同快照收据或其他任务 |
| S08 | `apps/control-api/package.json`；`tests/c06-local-e2e.mjs`，`run`/`runStudioUiTest`/`assertFreshRetriedAttempt`/`cleanupProject`；`tests/c06-studio-ui-e2e.py` | 已有真实 UI 上传、失败、显式重试、数据库事实、播放、布局、清理入口 |
| S09 | `packages/persistence/tests/support/c06-e2e-isolation.mjs`，`acquireC06E2EIsolation` | shared-local DB advisory lock 和 idle 检查；不能证明任务拥有数据库，也不能排除非协作业务消费者 |
| S10 | `apps/control-api/tests/c12-local-e2e.mjs:46–56`、`createIsolatedDatabase`、`assertFinalProduction`、`assertPublicPlaybackProjection`、`run`；`c12-studio-ui-e2e.py` | Windows 路径缺口；随机 DB/队列；两段和一版成片；无伪修复；MUSIC fixture；浏览器播放/下载 |
| S11 | `packages/provider-video/src/media-validator.ts:55–67`，`getFfmpegBinaryPath`/`getFfprobeBinaryPath`/`verifyBundledMediaTools`；`services/media-runtime/tests/test_runtime.py:58–79` | 已有跨平台包解析和测试用工具探测；优先复用，不硬编码 pnpm 内部目录/版本 |
| S12 | `.github/workflows/ci.yml`，`validate`/`media-runtime`/`docker-runtime` | 已有锁定依赖、PG16、Redis、固定 MinIO 构建、真实 FFmpeg 和镜像 smoke 来源；普通 CI 未调用完整 C06/C12 浏览器入口 |
| S13 | `tools/sub2api-video-certifier/src/report.ts`，`CertificationReport`/`hashProviderRequestId`；`recovery-state.ts`，`reserveSubmission`；`certifier.ts` | 既有脱敏认证报告、预留与未知结果恢复边界；报告里的 profile/model 是 Provider 测试字段，不是 Codex Agent actual route |

## 3. 历史 QC：先建立证据身份，再判断缺陷

### 3.1 已知历史绑定

S06 记录下列事实，均保持“历史记录、待实际证据复核”标签：

- 项目：`prj_01M2YK2DXF6NMDNFJ0PM87VSXJ`
- ProductionRun：`prd_01M43R309JXXS973H9SXQZ74GN`，`SUCCEEDED`，3/3 segments
- DeliveryPlan：`dpr_01M43R2M634C6JGTT87AF2CB8N`，rev21，`CONSUMED`
- VideoVersion：`vvr_01M43SVVW6FCF7QQWYG07FPYGG`，`SUCCEEDED`，30,125ms
- Asset：`ast_01M43SVBPPZM7HD7VVE31VK2EZ`，4,147,528 bytes
- SHA-256：`f2d7e8d255096994078da1a3d57cb88ee1a81feb6189ed5aa2f8c1f08de68fa7`
- QC：`qcr_01M43SVVW51YXJ3VH0N523SMGZ`，`NEEDS_ATTENTION / COMPOSITION`

本工作区未提供该数据库导出、QC `details`、当时 Runtime 回执或对应 MP4。不能宣称这些输入已找到，不能用新合成 fixture 填补它们，也不能由上述 hash 反推出媒体内容。

### 3.2 最小输入与只读过程

1. 由有权限的操作者提供目标环境和可读来源，或提供最小脱敏导出：指定 QC 行的 workspace/project/subject/kind/status/safe_summary/created_at/details，关联版本、资产 ID/hash/bytes/MIME/duration、ProductionRun/DeliveryPlan/Storyboard revision 关系。不需要整库 dump、凭据、签名 URL 或完整 prompt。
2. 如果是现场读取，先确认目标环境与权限；在只读事务内按明确 workspace/project/QC ID 联合查询，最后 ROLLBACK。未知 workspace 应从受权项目身份核实，不在多个租户中无条件扫描。已有公开 API 可核验公开字段，但缺少 `details` 时如实保留缺口，不新增公开调试接口。
3. 将导出与 S03/S04 的现有字段、联合身份关系对账；缺行、交叉项目、错误 subject、资产/版本不匹配均停止归因。记录读取时间、原始来源、脱敏范围和文件 hash。
4. 拿到确切媒体后才检查字节数、SHA、MIME、ffprobe 与可播放性。错误 hash 的文件不能当该历史 QC 的证据。只有实际细项可用时，才能区分测得的缺陷、未执行检查与缺失 provenance。
5. 若用户批准重验，在任务专属环境用已知当前 Runtime 检查同一媒体，另存“当前代码重验”结果和代码/config 身份。新结果不覆盖旧 QC 行、不追溯宣称旧代码当时通过，不自动创建 replacement TaskRun 或 VideoVersion。
6. 修复只针对已证明问题且有固定来源语义；需要人工听看、语义 evaluator 或来源缺口时保持明确待办。`NEEDS_ATTENTION` 不自动改成 `PASS`，人工认可也不伪造未执行的机器检查。

### 3.3 离线验证用例

| 用例 | 输入/动作 | 预期 |
| --- | --- | --- |
| Q01 | 未提供历史 `details` 或媒体 | `INSUFFICIENT_EVIDENCE`，列缺失输入；原 QC 状态不变 |
| Q02 | 仅 S04 合法公开 DTO | 可确认公开投影；不能确认完整细项或解释历史原因 |
| Q03 | 合法字段但错 project/workspace/subject/version/asset | 拒绝把不同对象的证据合并 |
| Q04 | 文件存在但 hash/bytes 与绑定不符 | 拒绝媒体身份核验；不调用 Provider 补片 |
| Q05 | QC 为 `PASS`，coverage 为 `PARTIAL` | 原样展示二者；不提升为完整语义验收 |
| Q06 | 旧无 DeliveryPlan 的 Mock continuity 为 `NEEDS_ATTENTION`；当前 DeliveryPlan-backed 流程为 `NOT_CHECKED` | 分别保留 legacy evaluator 与当前来源 hard-cut 语义；均不解释历史 composition QC |
| Q07 | 导出或日志含凭据、原始 URL query、原始 Provider payload | 不写入公开报告/仓库；要求最小脱敏输入；不自动上传 |
| Q08 | 在当前代码重验同一媒体 | 保留旧结果及时间；新结果有独立代码/hash/config 绑定 |

Q01–Q08 只是将来拿到真实证据后的候选验收用例，检查器实现明确为 `DEFERRED`；没有实际输入和可沿用的正式 schema 前，不属于本轮必需实施范围，不能登记为已通过。将来如创建测试 fixture，必须显式 synthetic，不能伪装为上述真实 QC 的导出。

## 4. 路由与运行回执：只核对已有事实

`ROUTE_UNVERIFIED` 的技术闭合需要受支持运行时给出真实可核验记录，至少能把 source/audit 子任务身份、派发关联、终态、观察到的 model/effort 与所审目标联系起来。只记录请求值、模型自述、普通完成文本、环境变量、重命名后的本地 JSON 或 provider certifier 的 `model` 字段，都不构成实际路由证明。不得读取被禁止的会话目录来补证据。

G02 的历史窄豁免按 S07 原样保留：只适用于 TaskSpec `G02-VISUAL-ENTITY-TIMELINE-20261002` 的对应内容审计，route 与 Hook 仍未验证；对 PR #4 新任务不能自动继承。原 source/audit 的独立身份、派发、终态与同一冻结 revision/manifest 的正式收据仍是硬门。已观察到路由不匹配、身份冲突、非终态或收据缺失都不能由豁免消去。

以下“本地证据一致性检查器”只保留为未来建议，已明确 `DEFERRED`，本轮不实现、不新增 receipt/QC parser 或协议：

- 只读消费操作者提供的已有测试日志、官方运行记录、现有 SourceFidelityReceipt/AuditReceipt 和 source/target/diff manifest；不访问网络、不获取密钥、不改状态。
- 复用既有 TaskSpec/收据字段和 hash 绑定，核对代码 SHA、revision、child identity、terminal 及实际已有 observed 字段。未提供的字段记录为缺失；不要创建模拟 `MAD_ROUTE_RECEIPT`，不要把“本地检查通过”命名为路由通过。
- 测试回执沿用 S01/S12 的命令、开始/结束 UTC、退出码、pass/fail/skip、依赖版本、环境变量名称、输出文件 hash 和未覆盖范围；仅保存便于审阅的运行清单，不新增业务/API schema。
- 全部报告注明证据范围（静态/单测/PG/队列/浏览器/真实 Provider/生产），禁止从一个 job 的 success 扩大到未执行的层级。
- 收据不匹配、文件缺失/变更、未终态、两个审计身份相同、只有 requested route、只有历史不同 SHA 的 CI、任一 required test skip 都要输出未闭合项。合法 G02 豁免只改变指定内容门的判读，不改变 route 状态。
- 若仓库没有可重用的正式 receipt parser，先做字段存在性和逐条对账报告，不定义臆造协议、签名或新的收据真实性判定。哈希只能证明文件一致性，不能证明内容由受信运行时产生。

## 5. C06/C12 云端 Mock 浏览器验收

### 5.1 可运行入口和现有覆盖

实际命令：

```text
pnpm --filter "@alchemy-video/control-api" run test:c06-e2e-isolation
pnpm --filter "@alchemy-video/control-api" run test:c06-e2e
pnpm --filter "@alchemy-video/control-api" run test:c12-e2e
```

S08 的 C06 入口驱动 Python Playwright，而非替换 API 的纯前端 mock。它创建两个项目、上传两张不同 PNG、展示失败、显式重试同一 TaskRun、保留原失败 Attempt 并建立一个新 Attempt、验证实际落库/公开脱敏/播放/移动与桌面布局，再清理自己的资源。这条“上游已明确终态失败”的重试与“提交结果未知”的禁止重提是不同用例，不能混为一谈。

S10 的 C12 入口创建随机数据库和四组随机队列，走 Studio → API → Workflow/Task/Production Worker → Media Runtime → MinIO，断言两段、一个 immutable VideoVersion、一个 handoff review、零无依据 BLEND repair、`continuity_status=NEEDS_ATTENTION`、480p 快照、播放/下载、脱敏和移动布局。上传的 MUSIC 是代码生成的本地 WAV fixture，不是用户旁白，不调用 Pixabay/TTS。当前 `final_review_video_bytes` 不执行真实语义/逐字 evaluator；harness 关于旧 transcriber/Piper 的注释不能用来要求新增模型下载或把这些能力算入通过。

### 5.2 开跑前必须处理的工具缺口

| 缺口 | 最小处理 | 行为不变约束 |
| --- | --- | --- |
| C12 FFmpeg/ffprobe 写死 Windows `.exe` 和 pnpm 包目录 | 优先复用 S11 已有包路径解析；显式工具路径应校验可执行/版本，不静默寻找另一个版本 | 只改测试配置/解析，不改媒体算法或 QC 阈值 |
| Python 浏览器入口只用默认 Playwright Chromium | 先探测已安装匹配 browser；若只提供系统 Chromium，允许显式测试 executable path 并记录版本 | 不改 UI 断言；不通过缺失浏览器而跳过后报通过 |
| C06 默认 shared `video_local` DB，且先检查 idle 再迁移 | 改为显式 `MOCK_E2E_DATABASE_ADMIN_URL`；内部生成/迁移专属 DB，再沿用 isolation 检查 | 不再采用旧 `C06_E2E_DATABASE_URL` 或通用 DATABASE_URL；advisory lock 不是排空证明 |
| Redis/MinIO/PG 管理端口固定 | 可使用任务专属进程占用空闲现有端口；如必须参数化，只引入测试专用 loopback 配置，连接前拒绝远程/覆盖 host 参数 | 不从通用业务 `.env` 隐式继承 endpoint；不碰现有服务 |
| C12 `objectKeys` 仅成功结束才读取 | 失败清理前从本次随机 DB/项目读取所属资产；核对删除后不存在，再删 DB | 不清整个共享 bucket；测试成功不得掩盖 cleanup 失败 |
| C06 PNG 固定写入 `.codex-longrun`，该目录当前 checkout 不存在 | harness 明确创建测试父目录，或者使用本次隔离目录并相应传路径 | 不覆盖已有用户文件；不把 fixture 写进仓库提交 |
| harness 继承父进程环境 | 调用侧使用最小测试环境，只有本地 fixture/服务配置；检查实际 Mock 选择及进程 readiness | 不读取真实 Key；不放开 Provider/TTS/Veyra fallback |

本次只读探测：工作区有 Node 依赖、Python Playwright/uvicorn/pydantic、`/usr/bin/ffmpeg` 与 `/usr/bin/ffprobe`；未在本进程 PATH 发现 Docker。父执行者另确认 `/usr/bin/chromium` 与可用 PG16，但 `/usr/bin/go` 不是可执行 Go 编译器，Redis/MinIO 未找到且临时盘仅约 2.3GB 空闲。浏览器实际 launch、包内媒体二进制可执行、Python 锁定环境均仍需核验。模块可 import 不等于版本合格或完整 E2E 可用。

因此把受控 Mock 浏览器 stage 接入 S12 的现有 CI `validate` 资源：该 job 已有 PG16/Redis/MinIO 和受控 Python Runtime，以测试专用端口/DSN 配置创建新鲜任务 DB/随机队列/专属 bucket。不能因为 CI 服务是临时的就移除输入护栏；C06/C12 清理仍只针对各自拥有的资源。Playwright 固定为 `1.62.0`，通过官方 Chromium install 入口准备浏览器，复用锁定 media/doc Python 环境，不新增收费调用或 artifact 上传。若运行时间不能容纳，应拆分拥有同等隔离条件的 job，而非缩短 UI 检查或把超时当通过。该配置已在 `9419b30` 的 CI 执行；C06 UI 通过但清理失败，C12 未执行，新修订须重跑。

优先复用 S12 的固定 MinIO 版本和已批准工具来源；安装/启动前核对本任务授权和现有服务。禁止为方便测试停止、删除未知容器/进程，禁止把 generic storage/queue cleanup 指向已有共享服务。

### 5.3 隔离执行步骤

1. 冻结目标 SHA/工作树 diff，记录 Node/pnpm/Python/Chromium/PG/Redis/MinIO/FFmpeg 版本。确认没有其他 writer 改动待测代码。
2. 只启动本任务拥有的 loopback 基础设施，记录 PID、目录、端口、随机数据库/队列/bucket 归属。端口已占用就停止本次启动，不停止已有服务。只使用生成的测试凭据，禁止从生产配置取值。
3. 创建专属 bucket，按实际 Studio origin 配 CORS；预迁移 C06 专属 DB。准备受控 Python 环境和浏览器，无网络模型/音频下载。外网限制保持有效，浏览器依赖全为 loopback；发现非本地业务请求即停止并调查。
4. 构建必要包，核验 API `build_version` 和 Worker readiness。按 C06 isolation → C06 failure/retry → C12 顺序执行，不与其他会扫描同一 DB 的 Worker 并跑。
5. 留存本地回执与关键截图/MP4 hash/ffprobe；完整 E2E 成功必须同时有 UI、持久化、对象与 cleanup 断言。截图应覆盖失败提示/可用重试、成片播放、移动页面；截图或 HTTP 200 不能单独证明播放。
6. 清理仅本任务的进程、DB、队列、对象及构建临时目录，核验端口释放。失败也要记录残留；清理失败将本轮记为失败/未完整完成。
7. 本地生成回执不自动上传。此前被拒绝的完整 audit/inventory artifact 不重试、不换外部通道；媒体、截图和日志亦需遵守已有分享授权。

### 5.4 具体测试矩阵

| 编号 | 覆盖路径 | 预期与证据 | 执行分类 |
| --- | --- | --- | --- |
| B01 | 配置/隔离 preflight | 远程 DB、额外 host/hostaddr、非 loopback endpoint、已占用端口、未知资源拒绝；无连接/清理副作用 | 云端，可新增测试工具负例 |
| B02 | C06 isolation | 未发布 outbox/非终态 TaskRun 拒绝启动；本任务 DB 正常取得/释放 lock | 云端，已有入口 |
| B03 | C06 failure/retry UI | 两张图解码、明确失败、同一 TaskRun 显式重试、两个明确终态 Attempt、可播放 MP4、布局与脱敏 | 云端，完整已有 harness |
| B04 | C06 queue recovery | 已知 request ID 重启只 poll/download；存储暂错、重试耗尽、startup no-job 回收；PG+Redis+MinIO 条件用例不 skip | 云端，既有 task-worker integration；不能只以 B03 代替 |
| B05 | C12 full Mock | 两段/一版视频、handoff unavailable 正确投影、无虚假 repair、真实 Runtime 合成、UI 播放/下载/移动及公开脱敏 | 云端，完整已有 harness |
| B06 | C12 final review | 技术/音频/字幕正反例；PASS+PARTIAL、UNAVAILABLE/null 正确保留；真实 FFmpeg 定向测试 | 云端，已有 Runtime 测试 |
| B07 | UI 中断/重复/刷新 | 核对现有测试覆盖；缺口单列：重复提交、SSE 重连/Last-Event-ID、刷新恢复、前进/后退、取消/关闭后无残留状态 | 云端，复用已有 UI/API 流程；不能假设当前两个 harness 已完整覆盖 |
| B08 | 失败清理 | 在 fixture 创建、服务启动、浏览器中途、Runtime 失败时仅清本任务数据；残留不隐藏 | 云端，测试工具故障注入 |
| B09 | 当前最终快照回归 | `pnpm typecheck`、`pnpm test`、相关 build、Python/Runtime 与 diff hygiene；精确 SHA CI | 云端；报告每套 pass/fail/skip，避免重叠相加 |
| B10 | 真实 Provider 与人工质量 | 原始请求身份、下载校验、实际音轨、来源/内容与听看结果 | 当前不可由 Mock 关闭，见 §7 |

初始设计时 B01–B10 均未在本轮执行；§9 保留推送前 B01/B08 定向回执。首次 `9419b30` CI 的 B03 UI 断言通过但清理失败，B05 未执行；其他套件的精确范围见《实施与审计记录》。B03/B05 尚未形成完整通过证据。S02/S06 中历史结果可引用为历史，不复制成当前最终快照通过数。

## 6. 生产停流、迁移、恢复与回滚

下面是获授权操作者的证据清单，不是执行授权或可直接复制的生产命令。准确迁移机制以既有工具为准；不得发明自动 reconcile、自动清 reservation、down migration 或新的 Provider 幂等协议。

| 顺序 | 必需证据 | 不满足时 |
| --- | --- | --- |
| C01 盘点 | 所有 API/Task/Production/Workflow Worker、relay、scheduler、恢复/手工脚本的部署位置、构建 SHA/image digest、DB/queue 目标、自动重启/扩容/回滚配置；全部恢复写入者必须认识 supersession | HOLD；不能只盘点当前 shell；认识 v2 列还不够 |
| C02 停流 | 创建/重试入口与所有派生/消费入口已受控暂停；保存 queued/active/delayed/failed/DLQ/outbox 基线 | HOLD；不删队列充当排空 |
| C03 在途对账 | 每个 TaskRun/Attempt 分类为可靠未提交、已知 request ID、预留/结果未知、已接受未落库、下载中、扣费中；关联进程和上游可核验请求/用量事实；历史任务的替代关系有单独依据 | 未知项隔离；无 ID 不等于未提交；历史 supersession NULL 不代表未被取代，无法核实的受影响任务/项目保持恢复入口 HOLD |
| C04 停止旧消费者 | 旧进程不能再越过已通过门禁继续 POST，不能自动重启；既已被上游接受的请求单独核对 | 不凭固定等待、lease 过期或 queue active=0 放行 |
| C05 备份恢复 | DB/schema/journal/ID/reservation 备份与隔离恢复验证；保存 queue/outbox/未知项清单；接受备份不撤销上游请求的边界 | HOLD；仅“备份文件存在”不够 |
| C06 应用迁移 | 已授权使用 `0027` → `0028` → 本次 `0029` supersession 迁移；原列不存在、v2 列存在、旧 ID/NULL/reservation 保持，后继 FK/CHECK/唯一性与 journal 有效；不推断或自动回填历史关系 | 保持停流，不加旧列别名修补；历史 NULL 继续按 C03 核验/HOLD |
| C07 对齐启动 | 所有 schema 消费者兼容 v2 列，全部普通/段重试及恢复写入者具备 supersession CAS/守卫；hash-bound readiness、已知 ID 恢复、未知预留与被取代任务阻断已验 | HOLD；旧 `071f46e` 不兼容，`3fd8410` 也不是安全恢复写入者，禁止混跑 |
| C08 受控恢复 | 入口按批准次序恢复；POST 数、重复、ID/预留、42703、RUNNING、重试/DLQ、outbox 与独立扣费事实一致 | 异常立即恢复停流，不重放未知任务 |

生产演练矩阵直接沿用 S02 T1–T9：云端可以用 PostgreSQL 与 loopback Mock 证明数据/索引、竞争预留、未知结果阻断、旧查询 `42703`、旧已越门禁后 POST 仍可能被接受。该结果不证明现场全部旧进程已停止，也不覆盖旧参考图 HEAD/GET、扣费或其他出口。

恢复观察的停止条件应以事实为准：本次切换清单中的消费者全部身份已核验；受控恢复的实际任务均有终态或明确受控等待结论；未知提交仍隔离；DB/queue/outbox/上游事实已对账。不能自行发明“等 N 分钟无异常即通过”。如果批准的 canary 要收费，另行取得 §7 的调用授权；不为完成切换报告擅自生成视频。

回滚裁定：

- 出现旧构建/42703、ID/索引不一致、重复或未知 POST/扣费、未知任务被重放、DB/queue 不一致时停止恢复。
- 优先回到仍兼容 v2 物理列、保留预留保护及完整 supersession 字段/CAS/恢复守卫的应用构建；目标 SHA/digest 必须预先核验。原 `44da842`、`071f46e` 和 `3fd8410` 均不是安全恢复写入者回滚目标；无兼容版本时保持相关写入口关闭，先修复前进。
- 旧 Worker 仍可能运行/自动恢复时，不得恢复旧列、别名、双写或兼容 view。
- 反向更名/DB snapshot restore 属于独立有授权的数据恢复计划：全部相关进程停止、上游接受/扣费对账、ID/reservation/supersession 事实保留，再重做全部恢复写入者与 schema 对齐。旧快照无 ID 或历史关系 NULL 不能授权再次 submit；不得清关系、删后继或移除 CHECK 让旧代码恢复写入。
- 所有现场操作由操作者记录时间、环境、动作、结果、证据 hash 和剩余异常；本轮全部现场项仍 `PENDING`。

## 7. 真实 Provider 和运行时输入：需要明确提供的内容

本轮没有真实调用授权。历史文档里的 G02“首个完整有效视频后停止”等决定不是本轮续跑许可；S06 已有成片事实，更不能默认旧授权仍未用完。

如要新建实际调用验收，应先明确：

1. 指定 Provider/profile、账户/目标环境、素材与 prompt/计划 revision、次数与金额/积分上限、提交或仅恢复已知 ID 的操作范围，以及遇到成功/失败/未知结果时的停止条件。
2. 既有 capability/certification surface 与当前代码匹配；不能靠普通 capability 数值或 Mock 结果推出 native audio、短时长或 reference 能力。
3. API/Worker readiness、唯一消费者、无未知在途冲突、资产授权与来源/usage/hash、DeliveryPlan 与 audio owner 事实都已核验。显式 Doubao 与 native 是不同验收，不能自动 fallback。
4. 密钥通过既有安全配置路径提供，不写入聊天、文档、日志或 fixture；本计划不读取、申请或持久化真实 Key。
5. 使用 S13 现有认证/恢复机制；已知 request ID 仅按授权恢复 GET/download，结果未知保持预留。不得清 recovery 文件、改幂等键或新建任务绕过防重。
6. 留存现有脱敏报告、实际提交数、终态、下载 HTTP/MIME/bytes/SHA/ffprobe、音轨与 QC，以及人工听看结论。Provider profile 认证不能替代项目全链路质量；技术可播放不能替代内容忠实或完整旁白验收。

生产另需目标实例、操作者、维护窗口、上述 C01–C08 事实、兼容回滚目标与停流/迁移/恢复的明确授权。当前缺少这些输入，所以不执行部署。

## 8. 交付与审计 checklist

- [ ] 冻结最终代码、source mapping、target/diff manifests；每项测试对应同一候选版本
- [ ] 文档审查通过后实施批准的最小 harness；receipt/QC 检查器实现 DEFERRED，公共契约与业务语义不变
- [ ] 独立 source-fidelity 与普通 audit 对同快照分别给出结论；无真实 route 记录仍写 `ROUTE_UNVERIFIED`
- [ ] C06 完整浏览器 + queue/storage 恢复用例有本轮真实回执，无隐藏 skip
- [ ] C12 完整浏览器 + Runtime 正反例 + 失败清理有本轮真实回执
- [ ] 历史 QC 缺失细项明确列出；拿到真实输入前不归因、不改状态
- [ ] 当前代码新 QC 重验与历史 QC 分开，不把 `PASS/PARTIAL` 写成完整语义通过
- [ ] 当前最终 SHA 的 CI、生产镜像验证与依赖风险说明各自绑定，完整 audit 与 prod-only audit 不混称
- [ ] 日志/截图/媒体只在本地受控保存；此前拒绝上传的材料不重试或换通道
- [ ] 真实 Provider、生产切换、商用发布分别有实际证据和授权，否则保持未闭合

本文件完成只代表剩余工作已有可审查的方案。后续最多先关闭“当前代码的隔离 Mock/工具开发验收”这一范围；历史 QC、实际路由、真实能力和生产现场门未闭合前，不宣称全部完成、生产安全切换或整章 `ACCEPTED`。

## 9. 本轮 Mock harness 实施与定向回执

实施范围：现有 `c06-local-e2e.mjs` / `c12-local-e2e.mjs`、两份 UI Python 的 browser executable 配置、测试专用 `support/mock-e2e-resources.mjs` 与 `mock-e2e-resources.test.ts`、现有 `.github/workflows/ci.yml` browser steps。不实现 §3–4 的检查器。

- 显式测试配置只有 `MOCK_E2E_DATABASE_ADMIN_URL`（`/postgres`）、`MOCK_E2E_REDIS_URL`、`MOCK_E2E_S3_ENDPOINT/REGION/ACCESS_KEY/SECRET_KEY`、`MOCK_E2E_PYTHON` 和可选 `MOCK_E2E_BROWSER_EXECUTABLE`；无通用业务 DSN/Key fallback。所有 URL 必须是精确 `127.0.0.1`、显式端口，无 query/fragment/字面空白；查询式 host/hostaddr 覆盖一律拒绝。验证在 client、catch diagnostics、cleanup 之前。
- 每次生成私有 DB/bucket/queue，child env 只带系统执行所需白名单与显式 Mock/dev/Veyra=false/offline 模式。使用现有 `verifyBundledMediaTools`，不重写媒体逻辑。
- 两套监督器等待所拥有的服务/进程组退出，再清理；停止失败保留资源并输出明确残留定位。成功/失败都会在停写后重新查询专属 DB 资产及专属 bucket（包含尚未登记的上传），验证对象删除和空桶之后才删桶/DB。不执行 `pg_terminate_backend`，不接管既有 bucket。
- C06 的 IPv4/IPv6/dual-stack 空闲端口探测改为顺序执行，避免 Linux 上探针互相占用。已存在端口仍拒绝；生成 bucket 若 HEAD 已存在则拒绝采用，不读取或删除它的内容。
- SIGINT/SIGTERM 会停止已登记的本任务进程、阻止后续 spawn，并明确保留 DB/bucket/queue；UI/迁移调用使用异步 owned command，避免长时间同步等待阻塞 signal handler。超时触发后即使命令以 code 0 响应 SIGTERM 也不能通过。
- 完整清理验收以 Linux CI 为目标。Windows 只对当前仍活动的根进程调用 `taskkill /T`，且必须成功；根进程已自然退出时，因无法证明后代退出且 PID 可能被复用，不再尝试 taskkill，直接保留资源并失败。此保守限制可能使 Windows 运行在命令完成后仍不能通过 cleanup，本轮不宣称 Windows 完整 E2E 已验收，也不引入新进程管理框架。
- Python UI 原有断言保留。CI media venv 安装 `playwright==1.62.0`（[官方 PyPI 发布页](https://pypi.org/project/playwright/1.62.0/)），使用官方 `python -m playwright install --with-deps chromium`；C06/C12 分别 8/12 分钟 step timeout，总 job 仍 45 分钟。不添加 artifact upload。
- 与 recovery 方案对齐：CI 单独提供 `PRODUCTION_RECOVERY_TEST_DATABASE_URL` 指向 `alchemy_recovery_test_ci`，创建前验证 strict loopback 与专库前缀，再通过既有迁移入口准备。测试不能从通用 DATABASE_URL 回退；该库与主集成测试及两个随机 browser DB 分开。

2026-10-10 推送前本地历史回执（当时未提交工作树，不等于后续 SHA CI；新运行状态见本文开头及《实施与审计记录》）：

| 检查 | 命令/范围 | 结果 |
| --- | --- | --- |
| endpoint/隔离/清理/进程停止定向测试 | control-api 目录 `node --import tsx --test tests/mock-e2e-resources.test.ts` | 14 pass / 0 fail / 0 skip；含 Linux 真实 socket、实际子进程延迟/拒绝退出、supervisor SIGTERM、timeout/code0 竞争；资源操作使用测试替身。另在隔离子进程模拟 Windows platform/taskkill，验证已退出 PID 不调用 taskkill、活动根 taskkill 失败即拒绝清理；该分支测试不是 Windows 实际进程树验收 |
| MJS 语法 | `node --check` 两套 harness 与共享 helper | PASS |
| Control API 类型检查 | control-api 目录 `node node_modules/typescript/bin/tsc --noEmit` | PASS；该 tsconfig 覆盖产品 src，测试脚本由上述执行验证 |
| Python/CI 静态检查 | Python compile/CLI help、YAML parse/顺序、UI 函数 AST 与基线比较 | PASS；UI 断言未删减 |
| 差异空白 | `git diff --check` | PASS |
| 完整 C06/C12 UI、真实 PG/Redis/MinIO清理、最终 SHA CI | 该推送前检查点尚未执行 | 历史 PENDING；后续 `9419b30` C06 UI 通过但清理失败、C12 未执行，不能用 helper 替身或语法检查替代 |

一次最初的 `pnpm --filter ... exec` 调用因当前云端 PATH 的 pnpm 版本/用户目录检查失败，未形成测试结果；随后直接使用工作区现有 Node/tsx 成功运行上述定向测试。CI 继续锁定 pnpm 10.33.0，没有为此更改包管理器版本或依赖门槛。

## 10. C12 上传时长与当前合成路径修复方案

固定排查提交 `12dbf0c8897436a019f60b69610e6e179671ca23`，CI run `38091761122`。两个片段与 TaskRun 均成功，ProductionRun 在发起 Runtime compose HTTP 前失败。沿实际 Studio 上传 body 执行 Control API 回归，MUSIC 被确认成 READY，但 `duration_ms=null`；`findProductionCompositionInput` 的既有 MANUAL 时长校验因而拒绝该曲目。不是 UI 刷新超时，也不以延长等待或放宽 QC 修复。

实施边界（先方案后代码）：

1. 沿用固定提交的 `packages/contracts/src/resources.ts::ConfirmAssetUploadCommandSchema.duration_ms`、Control API `confirm-upload` 映射与资产持久化字段。Studio 仅补齐浏览器 `HTMLMediaElement.duration` 到毫秒字段的上传元数据薄适配；加载事件依据同一提交 `c06-studio-ui-e2e.py::video_dimensions` 已有的 `loadedmetadata` 模式。不是新的媒体时长算法，不是服务端实测事实，也不改变公开 DTO。
2. 读取用户已选择文件的临时 object URL；非有限、非正数、不能安全表示为正整数毫秒、超出既有 PostgreSQL integer 存储范围的结果、加载失败或 10 秒 UI 资源等待届满均拒绝，不生成估算值、不提交上传确认。10 秒复用 C06 metadata 等待，只限制 UI 资源生命周期，不是音频/QC 阈值。成功/失败均解除事件、停止加载并 revoke URL。异步结束核对当前项目，避免旧项目结果修改新项目的 MUSIC 选择。
3. 现有 hash/MIME/size 校验、MANUAL MUSIC 时长资格、Worker/Runtime bytes/ffprobe、source full_mix 与终检保持原义；客户端报告时长不提升为服务端权威测量。未知时长的历史 READY 上传仍保持原有 fail-closed，不能猜测回填或通过重新确认改写，需显式重新上传或另行批准的修复。
4. C12 DB 验收先核实 ProductionRun 双向绑定同工作区/项目/Storyboard 的 `CONSUMED` DeliveryPlan，再断言零 handoff review、零 transition repair、`NOT_CHECKED`。来源是固定提交 `production-repository.ts::findProductionCompositionInput/acceptProductionSegmentQc` 的 DeliveryPlan hard-cut 路径及现有 PG 集成回归；旧无 DeliveryPlan 的 `NEEDS_ATTENTION` 测试不改。继续要求恰好 2 个成功 TaskRun、2 个接受片段和 1 个不可变成片版本；绑定该版本的既有 COMPOSITION QC 必须记录音轨、MUSIC 应用、`PARTIAL` 与语义 `UNAVAILABLE`，不将未知覆盖写成完成。
5. 浏览器除 metadata 就绪外，实际调用播放并验证播放时钟推进；下载须成功并读到非空 MP4 字节，其 size/SHA-256 与该不可变成片资产一致。保持当前 480p 请求设置、公开脱敏、390px 布局和本次资源清理断言。实际 Mock 视频固定为每段 1 秒、160×90，不能把 30 秒/480p 请求设置当成产物质量。只声称 Mock 管线及文件播放/下载，不声称真实 Provider、完整语义质量或历史 QC 已验证。

验证计划：浏览器媒体替身覆盖有效/无效/超时/加载异常及 URL 清理；执行实际上传函数证明无效时长不发上传/确认、跨项目不应用旧结果；真实 Control API + 现有资产存储端口证明上传确认字段落库、缺失时长不具备合成资格；最终 C12 CI 用真实浏览器和 Runtime 证明完整路径。定向通过不能代替最终 SHA 的完整 CI。

### 10.1 本次定向验证回执（未提交工作树）

- Studio 目录 `node --test tests/music-upload.test.mjs`：16 pass / 0 fail / 0 skip；最后重跑执行真实页面的 `safeErrorMessage`，确认错误保持原有公开 fallback，不把测试替身原始 Error 文案当 UI 事实。`node --test tests/*.test.mjs`：63 pass / 0 fail / 0 skip，包含上述 16 项，不相加。
- Control API 目录 `node --import tsx --test tests/music-upload-duration.test.ts`：3 pass / 0 fail / 0 skip。真实 API/内存资产存储接收确认后，将该 MUSIC row 传入现有 `DrizzleProductionRepository.findProductionCompositionInput`；查询端使用与既有 repository 测试相同的只读 Drizzle-shaped fixture，不声称 PostgreSQL 已验证。缺失时长精确重现 `QC_FAILED: the explicitly selected music asset is not available or failed scope validation`；30000ms 报告值生成合法的 2000ms 两段 hard-cut composition input。
- Control API 目录 `node --import tsx --test tests/*.test.ts`：155 pass / 0 fail / 2 skip。两个跳过为缺少专用 PostgreSQL 的计费产物公开门和 SSE replay 集成，不计为通过。单独 `tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck tests/music-upload-duration.test.ts` 退出 0。
- Studio 目录 `node node_modules/nuxt/bin/nuxt.mjs typecheck` 和 `NUXT_TELEMETRY_DISABLED=1 node node_modules/nuxt/bin/nuxt.mjs build` 均退出 0；C12 MJS `node --check`、Python `ast.parse`、`git diff --check` 通过。
- 下游真实 Runtime 定向重放：Control API 目录通过 `node --import tsx --input-type=module` heredoc 调用现有 `verifyBundledMediaTools/createMockMp4Fixture`，Python AST 仅提取现有 `c12-studio-ui-e2e.py::create_music_fixture` 生成相同 30 秒 WAV；Node `encodeMediaCompositionBundle` 使用两段实际 Mock MP4 和 repository 所证明的 ALCHMED8 计划（2000ms、PASS、LEGACY_PRESERVE、两条原片音轨事实及唯一 MUSIC 0..2000ms）；将 bundle 经 stdin 传给 `python3 -c` 的现有 `runtime.compose_video_bundle`，再执行 `final_review_video_bytes(caption_policy='OFF', music_applied=True)`。全程离线、临时文件作用域内清理，没有新增 Runtime 实现或测试阈值。
- 上述实际输出为 H.264/AAC、160×90、2000ms、43587 bytes、mono 48000Hz；SHA-256 `9d3d3bbe364c1749718847081e62e7cafb4752ff3d8ece114aeb693c41ead8c1`。终检 `PASS / PARTIAL`、semantic `UNAVAILABLE`、音轨存在、unexpected_silence=false、-14 LUFS / -7.8 dBTP。运行媒体未上传；这是当前 Mock fixture 的技术回执，不是历史 QC 或真实视频质量证明。
- 当前环境的 `ffmpeg-static@5.3.0` 二进制曾缺失；沿用先前回执的缓存修复方式，先比较相同包 manifest，再从已有隔离工作树的同版安装缓存恢复。复制前后 SHA-256 均为 `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`，`verifyBundledMediaTools` 通过；未加入系统 FFmpeg fallback。

完整浏览器、真实 PG/Redis/MinIO 及最终提交 CI 仍须另行核验。当前 shell 未提供这些服务；上述真实 Runtime 重放和测试替身不能替代该层验收。
