# 实施与审计记录

基线：`3fd8410baf904e879ae353e796b98b10e7ea3495`。本文件只记录本轮剩余问题闭环，不改写旧验收记录。

## 阶段状态

- 方案编制：三份专项方案及总览已形成。
- 方案独立复审：2026-10-10 通过限定范围审查；要求验证自关联 FK 对合法批量清理的影响、晚到状态写入守卫、真实缺包 CLI 回归和测试资源退出/清理顺序。
- 产品代码实现：R01 私有替代关系、R02 精确版本未使用依赖边移除、R04 现有 Mock 浏览器 harness 已完成本地实现及限定范围复审。不实现新的 QC/路由凭证解析协议。
- 最终代码复审：恢复范围及 Mock harness 限定范围通过。2026-10-10 21:58 UTC 用户已批准向官方 npm registry 发送依赖名称、版本和关系，并选择本地隔离部署测试。修订已推送为 `9419b30c83da2e48348e3ad36a3e207d3d8a64d1`；其 CI 已结束并暴露下述两项阻断，不能称为全绿。
- 本地协作与同步：隔离目录 `D:\AI\alchemy_video_OS\review-9419b30c83da` 已确认 HEAD 为 `9419b30c83da2e48348e3ad36a3e207d3d8a64d1`、tree 为 `fae9717a81c7d12f74ddb964d58612fe89b40862`，工作树干净。原开发目录及 `review-3fd8410baf90` 保留；原指定 Codex 会话的受支持接口失败，不视为已完成双方通信。后续补丁仍须再次同步。
- 合并、部署、真实 Provider、生产迁移：未执行。

## 基线回执（历史，不覆盖本轮修改）

基线 CI run `38066159177` 七项成功；Validate 18 套件 983 通过、零失败零跳过，Windows 2 通过，媒体 159 通过。范围与边界见 PR #4 基线回执及《旧 Worker 混跑提交栅栏开发文档》§§10–12。

## 证据记录规则

每次记录包含具体文件或固定 SHA、命令、数据/服务隔离方式、通过/失败/跳过数量、失败原因与修复后的重跑结果。测试组有重叠时分别报告，不相加。来源字节校验与功能审计分别记录；不能以一种替代另一种。记录清单完整性不等于现场真实性或运行时路由凭证。

生产或敏感证据只按获授权的接收方和路径处理；先前未获准上传的审计 JSON/镜像清单不得改走其它渠道。仓库只保存开发方案、代码、合成测试和脱敏结论。

## 实施历史检查点（推送前记录）

- 本地现有开发目录报告 HEAD 为 `071f46e`，有 8 项修改和 3 项未跟踪；原目录保留。指定原 Codex 会话的受支持接口报错，尚不能认定已联系；新建的本地核验任务负责隔离工作树复核，最终拉取与版本一致性仍待确认。
- 依赖精确边移除后，独立干净目录及主云端工作树均完成离线 frozen install：675 包复用、零下载，安装使用 `--ignore-scripts`。独立目录另行完成 Nuxt prepare 及真实 Drizzle CLI 回归；最终合并工作树的构建与回归仍在运行。
- 交叉审计发现现有 C06 Linux 端口探测会同时绑定 IPv4、IPv6 和双栈地址，互相造成占用；已改为顺序探测并以真实 socket 回归验证。进一步发现取消信号与 Windows 已退出父进程的清理证明不足，仍在补修，不将初版 harness 视为已通过。
- 完整/生产依赖在线重审曾因向官方 npm registry 发送依赖名称、版本及关系而被审批阻断。等待期间未重试，也未通过自动触发同类 CI 绕过；2026-10-10 21:58 UTC 用户明确批准该数据与目的地后才恢复。历史审计数不能作为本轮重审结果。完整 audit JSON/镜像清单的上传仍未获授权，此次批准不覆盖该上传。

## 云端集成验证与恢复范围复审

以下结果属于本轮未提交源码，不能称为 GitHub CI 或生产验收：

| 验证 | 实际结果与边界 |
| --- | --- |
| 全新 PostgreSQL 16.14、全量迁移、Persistence 全套 | 最终重跑 160 pass / 0 fail / 0 skip。独占 loopback 56432，随机 PGDATA；故障注入使用另建 `alchemy_recovery_test_parent`，所有服务与测试同一隔离命令内运行，结束后关闭 |
| Task Worker 全套 | 84 pass / 0 fail / 5 skip；五项 BullMQ/外部测试服务条件缺失，留待 CI，不计为通过 |
| Control API 全套 | 最后冻结重跑 154 pass / 0 fail / 0 skip，含全部 14 项 Mock supervisor 专项；组间有重叠，不相加 |
| Studio 测试与生产构建 | 正确的 `node --test tests/*.test.mjs` 为 47 pass / 0 fail / 0 skip；Nuxt production build 成功。一次误用 `*.test.ts` 返回 0 tests，该次不算验证 |
| 根完整 typecheck | 使用固定 pnpm 10.33.0，包含 workspace build/pretypecheck，退出 0 |
| 最终 schema 工具链回归 | 主云端重装后真实 Drizzle generate/check/repeat-generation，1 pass / 0 fail / 0 skip |
| 固定旧 Worker 原始字节回归 | 实际 Git autocrlf checkout 与故意内容/换行破坏两项通过；未修改旧夹具或原始哈希 |
| 获准后官方 npm 审计 | pnpm 10.33.0：生产 219 依赖、零漏洞、退出 0；完整 821 依赖、2 high、无 moderate/critical、退出 1。node-forge/braces 未有响应列出的修复版本，esbuild 告警已移除，muted 为空。完整 JSON 未上传 |

离线 `--ignore-scripts` 安装后，ffmpeg-static 缺少安装钩子生成的二进制，部分 Worker fixture 曾在断言前失败。恢复的是已有云端相同 `ffmpeg-static@5.3.0` 包的二进制缓存：包 manifest 比较一致，复制前后 SHA-256 均为 `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`，随后 `verifyBundledMediaTools` 成功；未加入系统 FFmpeg fallback、未修改产品路径，也未把环境失败计为通过。最终 CI 仍须验证正常安装和镜像。

恢复范围独立复审通过。审计者独立执行内存/已知请求/Worker 执行用例 51 pass、C06 路由及计费 18 pass；schema contract 26 pass / 1 个 DB 条件 skip，Worker 类型与 diff 检查通过。审计者没有运行 PostgreSQL，PG 结果来源是上述主验证及实施者独立专库测试，不能混同。

审计确认并由主验证复算的产品指纹：`6ee91ba2a27d4863dd60645185e5496de2a4d1eb72476b42c44cc13c3562d132`，算法为下列路径按 `LC_ALL=C` 排序，对每个文件生成 `sha256sum` 行，再对完整 manifest 字节计算 SHA-256：

- `apps/control-api/src/task-run-repository.ts`
- `apps/task-worker/src/execution-service.ts`
- `packages/persistence/src/production-repository.ts`
- `packages/persistence/src/schema.ts`
- `packages/persistence/src/task-run-repository.ts`
- `packages/persistence/drizzle/0029_task_run_recovery_supersession.sql`
- `packages/persistence/drizzle/meta/0029_snapshot.json`
- `packages/persistence/drizzle/meta/_journal.json`

真实 PG 段重试 → B 持久 queued 事件 → 实际 MockVideoTaskExecutor 提交的组合回归已补齐：一次提交后重复 delivery、重建 executor、执行旧 A 均不增加提交数。该 Mock 明确终态失败以避免媒体下载，所以证明提交/重放语义，不证明成片成功。对应测试文件 SHA-256：`c0181fb01b9a834d446aa6f140e7a71979226be4b1d7471393217f930627954e`。

审计中补修了“已经观察到 supersession 仍继续存储/扣费”和“忽略 transient polling 仓储返回值”的路径。守卫只阻止观察后的后续动作；不能撤销已开始的外部请求，也不保证外部 exactly-once。

## Mock 隔离复审与本地基线交叉核验

Mock harness 独立审计最后重跑 14 pass / 0 fail / 0 skip，三项已发现缺口均在限定范围关闭：Linux 顺序端口探测，POSIX 信号触发实际子进程退出并保留数据，Windows 已退出根进程/失败 taskkill 不误认为可清理。超时后子进程返回 0 仍失败。MJS 语法、Python AST、diff 检查通过。未执行完整 E2E、实际 Windows 进程树或真实服务资源清理，不能推广为完整跨平台验收。

审计绑定 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/control-api/tests/support/mock-e2e-resources.mjs` | `55128d0088fad2d4c7eec4b586b86628c6a53b517599c0c5f7efecc7308eea15` |
| `apps/control-api/tests/mock-e2e-resources.test.ts` | `158a664321fc43e346431ddcb05c9dee0e8a580399b19c68665332ce39bac321` |
| `apps/control-api/tests/c06-local-e2e.mjs` | `53b3d73ca9c74ef2cfd25df4b25f24df6d81d9a665d9b0ec0831e31e2c8e2d3d` |
| `apps/control-api/tests/c12-local-e2e.mjs` | `17803024ddeda80ca8df914ef972ce4ff52d0c35f7fec39a526acfd570e0a88c` |
| `.github/workflows/ci.yml` | `355e2d67f3fa4caf1cafd2ddcdc839cbf8b74fc9be119ef1abf865b53e560333` |

本地基线任务已完成 `3fd8410` 六项静态核验，未报阻断问题；实际 Windows 固定夹具测试 2/2。初次默认 TEMP 下 Git 写入失败，改用本 worktree 临时目录后通过并清理。其余包测试因隔离目录未装依赖、本机 pnpm 路径规范化 Access denied、没有专用测试库而未运行。这只属于基线的本地证据，不覆盖本轮新修改。

本地还查找了授权项目/归档内的旧 QC 证据，只找到历史状态记载；引用的 `.codex-longrun/test-log.md` 未找到，也未找到对应大小的 fixture 媒体。没有据此推断 QC 原因。旧 Codex 会话接口仍失败，本任务未绕过限制。

## 方案审查结论与实施限制

- R01 不新增 graph service 或 lineage API；先核验 scoped 自关联约束和正常整项目/工作区清理。已知晚到 request ID 仍按原事实保存规则处理，不得为阻断恢复而丢失外部已接受事实。
- R02 只允许 `drizzle-kit@0.31.10>@esbuild-kit/esm-loader: -`，必须从真实干净安装和 Kit 的解析上下文证明该旧链已不存在；真实 generate/check 对比不能由 grep/mock 替代。node-forge/braces 继续 OPEN。
- R04 所有连接包括异常诊断路径必须先验证目标；停止并确认所有 mutator 退出后才收集/删除本次对象和数据库。失败不能扩大清理范围，不得静默清理共享服务。
- Q01–Q08、历史 QC 与运行时 receipt 的读取/分析依赖实际受权输入，当前仅保留计划；不伪造正式凭证或生成一个新的验收协议来替代缺失证据。

## Windows 本地 9419 交叉复核回执

2026-10-10 22:27 UTC 本地核验任务返回：干净隔离工作树 `review-9419b30c83da` 的源码 SHA/tree 与云端已发布版本一致；当地直接访问 GitHub 被代理拒绝，其远端状态引用父任务已经成功完成的 GitHub 核验，不能称为独立远端读取。原目录仍有 8 项修改、3 项未跟踪，未覆盖。

- 根 typecheck 通过；固定旧夹具换行测试 2/2；Worker 已知 request ID 专项 10/10。
- API supersession/隔离工具组合 19 pass / 0 fail / 4 skip，四项 POSIX 专属分支在 Windows 跳过。
- 本任务 loopback PostgreSQL 16.15 的定向集成 58 pass / 0 fail，覆盖迁移、双向锁竞争、事务故障回滚、恢复及 QC 后显式再生成。首次因专用基础库未迁移的错误已在仅迁移本任务数据库后重跑关闭。
- Worker 执行组合 22 pass / 30 fail：固定 `ffmpeg-static` Mock 媒体二进制未随跳过安装脚本的依赖安装准备完整，未用系统工具替代。该组合不能算通过，待补齐环境后重跑。
- Python Playwright 缺失、CUA 启动器错误，完整本地 UI 未完成。任务 PG 容器最后核验健康、绑定 loopback 56432；随后 npipe 权限错误导致资源最终状态未确认。后续仅通过正常审批路径修复并核对本任务资源，不操作其他服务。

本地代码范围复审未报告新阻断，认为私有 A→B 替代关系及严格布尔终态证据是必要的最小适配；这不代替尚未通过的环境/浏览器验收。

## 首次新 SHA 的 CI 结果与收尾阻断

固定提交 `9419b30c83da2e48348e3ad36a3e207d3d8a64d1`，对应 [Actions run 38090315025](https://github.com/meta-xucong/alchemy-video-os/actions/runs/38090315025)。七个 job 中五个成功：Windows fixture fidelity、production dependency audit、Docker runtime、diff hygiene、media runtime；Validate 和 secret scan 失败。

- Validate 中构建、typecheck、普通及专用恢复测试库迁移成功；18 个 Node 套件合计 1036 pass / 0 fail / 0 skip。这不是整个 Validate job 成功。
- C06 Playwright 的失败展示、显式重试及 160×90 / 1 秒 Mock 视频 UI 断言通过。随后清理本次 bucket 的 `ListObjectsV2` 因 `@aws-sdk/core@3.750.0` 注册数字实体与强制 `fast-xml-parser@5.7.0` 不兼容而失败：`Invalid character '#' in entity name: "#xD"`。清理按既有 fail-closed 规则保留资源，没有放宽检查；C12 因前置失败未执行。
- Secret scan 失败是下一节核实的文档命令误报，不能把这次失败记成通过。
- 修复须保留真实 SDK XML 反序列化回归，并在下一固定 SHA 重跑完整 CI、C06 清理及 C12。此次 1036 项结果不能预先覆盖新的依赖锁文件。

### S3 XML 与误报修复的独立交叉复核

独立审计确认仅将官方 `fast-xml-parser` 补丁版从 `5.7.0` 固定到 `5.7.2`；结构化比较锁文件，其余包版本、SDK、清理代码与检查门槛未变。真实 SDK XML 专项独立运行 6 pass / 0 fail / 0 skip；storage 全目录为 22 pass / 0 fail / 1 skip，跳过的是该审计 shell 未配置 MinIO 的集成用例。实现者运行的 22 项非集成用例与这些测试有重叠，不相加，也不声称真实 S3 清理已经通过。

独立核对官方 registry 审计响应：生产 219 依赖、零漏洞；完整 821 依赖、2 high，muted 为空。Gitleaks 相同 23 提交范围的无 ignore / 精确 fingerprint / 另一提交正控制分别为 1 / 0 / 1 finding；官方归档 checksum 一致。当前文档已区分历史、`9419b30` 的部分成功/失败及最终 SHA 待跑范围，`git diff --check` 通过。此次静态和定向审查未发现新的阻断；全量构建、最终 CI、真实 MinIO 清理及本地部署回执另行记录。

修复冻结后，实施者使用 PATH 优先固定的 pnpm 10.33.0 完成根完整 build/typecheck（均退出 0），新增测试文件单独 strict typecheck 通过。主任务另行运行 14 项 Mock supervisor 回归全部通过、零跳过；其资源故障操作仍使用替身，真实资源清理仍由下一 SHA 的 CI 验证。主任务复算关键文件 SHA-256 与独立审计一致：manifest `7e33ef01a31394b331f954548b95c14311b330af7c18cb9850454683c4161f97`；lock `0310e5c8c37d9cb6ce4b6e6198a87093138a53cd19686125284fa49db913a570`；XML 测试 `8bc4bb96d2ffb44ac5f116d3788d51692f84a5aa2868f5a437bb3a03b34bcf01`；精确 ignore `6e98746baadb10296dbb01bebc50982446792578f68274e09f60fff0dbd4c469`。

## Secret scan 文档误报修复（2026-10-10）

- Gitleaks `8.24.3` 在提交 `9419b30c83da2e48348e3ad36a3e207d3d8a64d1` 的 `acceptance-and-cutover.md:106` 把 C06 isolation 测试命令识别为 `generic-api-key`。已与 `apps/control-api/package.json` 的既有脚本核对：内容只有包名与测试入口，没有凭据。
- 沿用 [Gitleaks v8.24.3 官方 fingerprint 机制](https://github.com/gitleaks/gitleaks/blob/v8.24.3/README.md#gitleaksignore)，根 `.gitleaksignore` 只加入该提交、完整文件路径、规则和行号组成的一条精确指纹。当前文档给包选择器加引号并显式使用 `run`，仍调用相同三项脚本。未豁免整个文件、规则或提交，未调整阈值/CI，未重写历史；仅改当前文档无法消除历史扫描中的原始误报。
- 验证使用官方 release 的 `8.24.3` Linux x64 二进制，归档 SHA-256 与官方 checksum 一致：`9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`。补齐只读远端历史后，在无工作树 ignore 文件的临时本地 clone 中以 `--no-merges --first-parent cd4c2cea5f44b13cbc1d7bf74c660d3bd9c25e3b^..9419b30c83da2e48348e3ad36a3e207d3d8a64d1` 扫描 23 个提交：不加载精确指纹为 1 finding、退出 1；加载后为 0 finding、退出 0。
- 正控制：另一个临时提交保留相同原始文档、相同路径与第 106 行，加载上述 ignore 后仍为 1 finding、退出 1，证明新提交未被该指纹放行。当前文档及本次改动文件的独立文件扫描、`git diff --check` 通过。扫描报告仅本地脱敏保存，未上传；没有运行真实 Provider、改产品代码或把本次扫描当作最终 SHA 全套 CI。升级 Gitleaks 后须重验其官方标为 experimental 的 fingerprint 行为。

## 12db 修订的正式 CI 与本地续验

提交 `12dbf0c8897436a019f60b69610e6e179671ca23`、tree `22190eba5eef426cebe793725bb6421ba3794d35` 已推送且九项文件 blob 与云端逐一匹配。[CI 38091761122](https://github.com/meta-xucong/alchemy-video-os/actions/runs/38091761122) 六个 job 成功，Validate 的 C12 阶段失败：

- 18 个 Node 套件 1042 pass / 0 fail / 0 skip；媒体独立 job 159/159。
- C06 浏览器失败/显式重试流程通过，随后实际清理 2 个项目、3 个对象、两个隔离队列、fixture 和子服务通过。原 S3 XML 阻断已在真实 MinIO 路径关闭；secret scan 也通过。
- C12 的两个视频任务均成功、两个段均 ACCEPTED，但最终合成转为 FAILED，浏览器未得到最终成片；捕获的 Runtime 日志仅显示 inspect/handoff-frame，未出现 compose 调用。该阻断须继续定位，不能解释为浏览器等待不够，也不能把 1042 项成功扩大成 Validate 成功。
- 本地 9419 在补齐锁定 `ffmpeg-static` 官方二进制后，原 Worker 失败组合重跑为 52 pass / 0 fail / 0 skip；不继承给其他 SHA。Python Playwright 1.62.0 与官方 Chromium 已在任务隔离环境准备。
- 本地代理 127.0.0.1:7890 在主机实际监听；默认 sandbox 的 EACCES 是隔离限制。相同 Git fetch 经正常审批路径成功，没有改代理或系统权限。新建干净 `D:\AI\alchemy_video_OS\review-12dbf0c88974`，HEAD/tree 与上述提交一致，新增 XML 回归 6/6、diff 检查通过。
- 完整本地 UI 仍待任务专属 Linux runner 的 PG/Redis/MinIO 和成片问题修复；Windows smoke 曾有任务 Python 残留，已核实归属后定点停止，不能把 smoke 成功当成进程树清理证明。原开发目录与旧 worktree 均保留。

## C12 音乐上传时长修复与限定复审

已通过真实 Control API 确认缺陷：Studio 旧上传 body 仅含 hash/MIME/size，READY MUSIC 的时长仍为 null，实际合成输入读取器拒绝该手选资产。补丁只在 Studio 浏览器元数据与已有 `duration_ms` DTO 之间补转发，校验既有整数存储范围并清理临时媒体资源；Runtime、服务端验证、Provider 和媒体算法不变。详细来源、方案及历史 null 资产边界见验收文档 §10。

独立复审核实：当前 consumed DeliveryPlan 路径不应产生旧 handoff review/transition repair；验收先核对同作用域双向 run/plan 绑定，再断言 `NOT_CHECKED` 和零 review/repair。旧无 DeliveryPlan 的行为与测试保留。QC 查询严格绑定该 VideoVersion 的 COMPOSITION 报告；嵌套字段与实际 Worker→Drizzle 写入一致。浏览器播放时钟和下载完成后的 hash/size 校验增加了实际行为证据，没有以改成预期成功状态替代产品修复。

- 实施者 Studio 全套 63 pass / 0 fail，新增 metadata/实际上传 handler 16 项包含于其中；实际 API/存储/合成资格专项 3/3。Control API 全套 155 pass / 0 fail / 2 数据库条件 skip，跳过不算通过。Studio typecheck 和生产 build 通过。
- 独立审计重跑 Studio 专项 16/16、API 专项 3/3，另执行 10 个实际 handler 的失败/跨项目交错场景；C12 JS/Python 语法与 diff 检查通过。没有运行完整浏览器，不冒称正式运行时路由凭证。
- 使用相同 C12 WAV 与两个真实固定 Mock MP4，按实际 ALCHMED8 bundle 执行下游 Runtime，产物 43,587 bytes、160×90、2,000 ms、H.264/AAC、48 kHz mono；终检 PASS / PARTIAL、semantic UNAVAILABLE、有音轨、unexpected_silence=false。这是定向实际 Runtime 验证，不是整条浏览器/PG/MinIO E2E，也不等于请求的 30 秒/480p 真实质量验收。
- 实施环境的媒体安装 hooks 缺失时，仅恢复同一 `ffmpeg-static@5.3.0` 已有缓存包，manifest 对比一致、二进制 SHA-256 与前述 `e7e7fb…a3eb99` 相同；没有使用系统 fallback。

完整新 SHA CI、C12 浏览器与本地 Linux runner 仍需执行。旧缺失时长的 READY 音乐不会自动回填或重写，需要显式重传，不能将本次新上传修复宣称为历史数据治理完成。

最终独立复审与主任务复算的七文件指纹为 `90f905421a45385aa087fc6173fcc0c3ae5959328a435d0a8534ee514f27a392`：上述两个 C12 脚本、新 API duration 测试、Studio metadata adapter、useControlApi、项目页及新 MUSIC 测试，路径按 `LC_ALL=C` 排序后生成每行 `sha256sum`，再对完整 manifest 字节取 SHA-256。无代码级阻断；所有通过数仍限定于实际执行范围。
