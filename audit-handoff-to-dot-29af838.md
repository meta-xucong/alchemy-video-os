# 29af838 本地独立审计交接（2026-10-13）

## 基线和保护边界

- 固定基线：`29af838cd436ba6a944d6d14e33e270d9ba2cf73`
- 父提交：`2c614c508de4b597fa9f69b21ace2499ee38f231`
- 独立审计目录：`D:\AI\alchemy_video_OS\audit-29af838`
- PR #4 仍为 Draft；本轮没有 commit、push、merge、deploy 或切换服务。
- `D:\AI\alchemy_video_OS\开发版_20261009` 原有 15 项修改未触碰；审计使用 detached worktree。
- 未调用真实 Provider、Veyra/计费上游或生产/VPS；本地服务全是一次性 PostgreSQL、Redis、MinIO 和 Mock Provider。

## 发现和修复

### P2：启动恢复会覆盖迁移来的未知提交 Attempt 历史

在 `execute({ recovery: true })` 处理 `ABANDONED`、已预留但没有 Provider request ID 的旧 Attempt 时，代码把 `providerAttemptId` 传给通用 `failTaskRun`。该方法会把 Attempt 从 `ABANDONED` 写成 `FAILED`，并替换其 response payload，违背文档承诺的历史记录保持不动。

最小修复：`apps/task-worker/src/execution-service.ts` 两处 `PROVIDER_SUBMISSION_UNKNOWN` fail-close 调用不再传 `providerAttemptId`。TaskRun 仍然终止并保留未知提交提示，Attempt 行原样保留；未决 reservation 仍阻止新 POST。

已新增真实 PostgreSQL 回归 `PostgreSQL startup recovery preserves a migrated abandoned no-ID reservation row`。在未修复代码上先复现：历史 Attempt 被改写；修复后断言 Attempt 行完整相同、无 request ID、Provider submit 次数为零。

### 组合并发证据缺口

新增 PostgreSQL session lock 被强制断开、Mock Provider POST 仍在途的回归：第二次 recovery fail-closed；旧 POST 返回后记录晚到 request ID；旧执行被 defer；显式重试查询该 ID 并成功，Provider submit 总数仍为一次。

独立审计提醒：该回归只证明上述具体顺序，不是通用写 fencing 证明。当前 advisory lock 由协作式 `assertActive()` 保护；已知 request ID 的状态/下载写仍存在 guard 检查到数据库写之间的竞态窗口。不要声称任意网络分区下 exactly-once，不允许新旧 Worker 混跑，也不要以此作为横向扩容许可。若要关闭这项架构限制，需单独设计 transaction-bound fencing token/epoch 写入门禁并补并发负例。

### 测试断言确定性

全仓首轮运行暴露 C11 持久化集成测试的非确定断言：同一 event 有 `c11-pg-consumer` 和 `c11-pg-consumer-terminal` 两条记录，测试只按 event ID 查询并断言 `completedAt`，PostgreSQL 可合法返回另一 consumer 的未完成行。已将查询增加 `consumerName = c11-pg-consumer`；仅测试变更，不改业务逻辑。修复后 persistence 套件通过。

另将 held-POST 测试的 `first` Promise 提到 `try` 外声明，并在 `finally` 释放 POST 后 `Promise.allSettled` 等待执行结束，避免早退清理竞态。独立审计复核了作用域修正。

## 本地复核结果

- Independent read-only audit：本次 attempt 保留修复 **代码级 PASS**；新增两个 PostgreSQL 回归逻辑 **PASS**；全 stale-writer/fencing 闭环为 **INSUFFICIENT_EVIDENCE**，原因如上。
- `pnpm typecheck`：PASS。
- `pnpm build`：PASS（含 Nuxt production build 和各 Worker/包 build）。
- `pnpm test`：PASS，进程退出码 0。使用 PostgreSQL 16、Redis、按 CI 指定 `RELEASE.2025-10-15T17-29-55Z` 从源码构建的 MinIO、Mock Provider。
- 专项：execution-closure integration **11/11**；persistence **139 pass / 0 fail / 5 条件 skip**；task-worker **115 pass / 0 fail / 2 条件 skip**；control-api **154 pass / 0 fail / 4 条件 skip**；storage-client **31/31**，包含真实 MinIO browser CORS PUT。
- `git diff --check`：PASS。
- 测试摘要按各包报告；不同测试集合有重叠，不能和云端 CI 总量相加。

## 未验证/不应过度宣称

- 云端七项 CI 全绿来自 Dot 提供的交接信息；本轮未登录 GitHub 拉取 CI artifact 复核。
- 未跑 C06/C12 完整浏览器 E2E；未验证真实 Grok/其他 Provider、Veyra 实际扣费、生产数据库迁移、VPS、真实音视频质量或部署。
- 没有本地正式 `MAD_ROUTE_RECEIPT`，不要宣称路由运行时来源凭证已验证。
- 当前审计是针对固定 SHA 加隔离工作树中的未提交最小修复；该本地补丁尚未回传 GitHub，因此 PR 仍是原始 SHA。

## 请 Dot 交叉核验

1. 对照固定 `29af838...` 复核 `execution-service.ts` 两处省略 attempt ID 是否在 PostgreSQL 与内存 repository 语义下均只终结 TaskRun、不覆盖 Attempt。
2. 阅读两条新增回归，特别确认 forced backend termination、POST 晚到 request ID、显式 retry 复用 ID 的时序断言没有通过 Mock 伪造锁状态。
3. 复核 C11 测试新增 consumer 过滤是否准确修复本地不确定性。
4. 判断 advisory lock 的 check-to-write stale-writer 风险是否已被现有 no-mix/单 Worker 运维门禁充分约束，还是应另开 transaction-bound fencing 开发任务。不要把本次局部回归当成该问题已关闭。
5. 若确认这些本地改动应回传，请由 Dot 自行挑选/应用并重新跑云端 CI；本轮没有推送任何修改。

## 本地后续推进：transaction-bound fencing（2026-10-13）

本轮根据上节已知 stale-writer 缺口，已在本隔离 worktree 落地一版 TaskRun token fencing，并完成独立审计前的本地验证。新增正式实现契约和证据见：

- `doc/task-run-execution-fencing-20261013.md`
- `doc/worker-execution-closure-20261012.md` 的 2026-10-13 implementation evidence section

关键改动：新增 nullable `task_runs.execution_fence_token` 与 migration `0030_cooing_starfox.sql`；每个 TaskRun execution state mutation 要求 owner token，并在同一个 PostgreSQL transaction 内通过 advisory xact lock + `SELECT ... FOR UPDATE` 精确校验 token，之后才写 Attempt/Asset/Shot/TaskRun/Outbox。显式重试、终态和 segment supersession 会撤销旧 token。保留两类严格受限的 append-only evidence recovery：迟到 Provider request ID（只给同一 reserved Attempt 补空 ID）与已接受扣款的幂等 receipt（不能改 TaskRun 状态）。它们不是 stale owner 对业务状态的写授权。

本地 disposable PostgreSQL 16 / Redis / Mock Provider 实测：

- execution closure focused integration：**13/13**；包括缺失/错误 workspace token fail-closed、所有 stale mutation 被拒、row-lock handoff 次序、transaction trigger 中途故障整笔回滚、late ID evidence-only、held POST 在 owner 变更后收 ID 且不重复 submit。
- persistence：**139 passed / 0 failed / 5 skipped**；task-worker：**113 / 0 / 6 skipped**；control-api：**154 / 0 / 4 skipped**；workflow-worker：**116 / 0 / 0**。这些 suite 有重叠，不能相加。跳过项是现有专用 migration/recovery DB、legacy DB 或 MinIO 条件用例，不是 fencing focused suite。
- 全仓 `pnpm typecheck`、`pnpm build`、`git diff --check` 均退出 0；diff check 仅有 `_journal.json` 换行提示。
- C12 production-repository focused test：**7 passed / 0 failed / 1 skipped**；新断言确认 segment 成功 supersede 会清除前任 token，且旧 token 不能继续 fail TaskRun。

独立只读审计正在进行；在其返回前此实现仍不标记为审计通过。未提交或推送，未调用真实 Provider/扣费，未连生产/VPS，未部署或合并。原开发目录及此前 audit edits 继续保留。

重要边界：这是对已升级 binaries 的数据库状态写入 fencing；无法原子取消正在进行的 Provider HTTP、扣费或对象存储外部副作用。旧 Worker 完全不识别 token，不能新旧混跑；生产还需全量盘点、停旧、排空、迁移、整体升级和灰度验证。本地测试不能替代云端 CI、迁移恢复专用数据库、真实 Provider/计费和生产验收。Dot 请交叉审计这个 fence 设计与所有 mutation inventory，并确认 migration/rollback 兼容性；无需重跑本文已通过的全套本地测试，发现问题只指出最小复现和位置。

## Implementation review follow-up for Dot (2026-10-13)

已处理独立只读审计发现的两个 P2：

1. `apps/control-api/src/task-run-repository.ts` 的内存 TaskRun store 现在也会签发、替换、撤销并校验 execution fence token；finalizer 把 lease token 传入 fenced mutation。新增测试验证 owner token 替换后旧 token 被拒。
2. PostgreSQL 与内存 `withTaskRunExecution` 对缺失、superseded、SUCCEEDED/FAILED/ABANDONED 任务不再领取新 token。新增数据库回归确认 superseded callback 不会写入 token。上述修正已追加进 `doc/task-run-execution-fencing-20261013.md`。

修复后验证：control-api **153 passed / 0 failed / 6 skipped**；focused execution closure **13/13**（隔离 PostgreSQL 16 + Redis + Mock Provider）；production repository integration **7 passed / 0 failed / 1 skipped**；workspace `pnpm typecheck`、`pnpm build` 均通过；`git diff --check` 通过（仅 `_journal.json` 的 LF/CRLF 提示）。独立审计者 `/root/fencing_design` 对这两个 P2 做定向 follow-up，结论为 **两项均闭合，限定范围内未发现残留问题**；审计者未自行重跑测试。当前仅为隔离工作树的本地修复与验证，不是 GitHub CI、合并或部署凭证。

请 Dot 对这两个 P2 的修复做只读复核，并检查文档新增证据与代码是否一致。无需重复此前通过的大套件；若发现问题，给出可复现情形与最小定位。未推送/合并/部署，未调用真实 Provider、扣费或生产/VPS。

## 2026-10-13 追加：未决 Provider POST 的终态安全

继续审计后又发现一个边界：`submissionReservedAt` 已落库、但 Provider request ID 尚未落库时，原 POST 可能仍在途。Recovery 或队列耗尽回调不能据此把 TaskRun 写成 FAILED，否则原 POST 后续即使返回了 request ID，TaskRun 也已经进入错误终态，无法可靠接续轮询。本轮在当前隔离工作树补上：

- Worker recovery 对所有 unresolved reservation 统一 retryable defer，不调用 `failTaskRun`；引用预检异常也不再把这种 reservation 误判为提交前故障。
- PostgreSQL 与 InMemory 的 `finalizeTaskRunExecutionFailure` 对未决 reservation 保持现状（RUNNING、error null），不改 Attempt 历史。
- 新增/调整测试：内存 queue-exhaustion finalizer 断言，以及 PostgreSQL held-POST → 队列终结回调 defer → 晚到 ID 记录 → 下次 recovery 只轮询且一次 POST 的组合路径。

本轮复验结果：task-worker submission/execution/service 定向单测 **60/60**；task-worker/control-api/persistence 三个 TypeScript noEmit 检查通过；`git diff --check` 通过（仅既存 journal 换行提示）。但本会话没有 `DATABASE_URL`，Docker engine 访问也被拒；重新调用 execution-closure 集成测试实际结果为 **13 skipped**。因此不能声称新增 PostgreSQL finalizer + held-POST 集成序列已验证；先前 fencing 集成 13/13 只对应此前快照，不能覆盖此轮追加断言。

请你在独立 PostgreSQL 16 + Redis 环境复跑 `apps/task-worker/tests/execution-closure.integration.test.ts`（需确保 13 项不是跳过），重点审阅新加的 queue-finalizer 与 held POST 组合断言，以及 recovery 两处无 failTaskRun 行为。此补丁仍未提交/推送/合并/部署；整体保持待审，不涉及真实 Provider、扣费或 VPS。

### 追加处理 Dot 指出的 P2 运维可见性

Dot 指出 unknown reservation 达到恢复尝试上限后曾被统计为 `failure`，尽管 finalizer 安全 no-op，日志会误报。现已增加专用 `ProviderSubmissionReconciliationPendingError` 类型；恢复扫描将其明确返回为 `deferred`，`recoverC06TaskRuns` 走单独 `onDeferred` 通知，不调用 `onFailure` 或 finalizer。延后结果区分 `PROVIDER_SUBMISSION_UNKNOWN` 与普通 `EXECUTION_BUSY`：仅前者打印 `operator_reconciliation_required`，普通锁竞争标记为 owner 释放后重试。其他 retryable 错误仍保留原有失败/重试处理语义。

新增 `service.test.ts` 回归证明 provider-unknown deferred 不调用 failure finalizer，普通 owner busy 不会被标成需人工 Provider 对账；submission/execution/service 定向套件现为 **60/60**。Task Worker、Control API、Persistence TypeScript noEmit 检查均通过。只读审计已请求复核这一 P2 修复；此前 PostgreSQL 集成测试仍因无 `DATABASE_URL` 而 13/13 skipped，不能据此验收数据库路径。若进程崩溃后上游确已接受请求但 ID 丢失，TaskRun 仍保守地保持 RUNNING；运维必须根据 Provider 侧可验证记录人工对账，不能直接清除 reservation 或盲目重提。未提交、推送、合并或部署。

最终独立复核：Dot 的只读审计确认 deferred kind 分类、普通 retryable 错误原语义，以及 held-POST 文档描述均已正确；没有新增 P1/P2。审计未自行执行测试。

### Docker 恢复后的最终核验更新（2026-10-13）

用户重新打开升级后的本地 Docker 后，已在隔离 PostgreSQL 16 + Redis + Mock Provider 环境完成此前缺失的 finalizer/recovery 集成验证；本节更新 supersede 上文“13 项 skipped、数据库门禁 pending”的旧状态：

- execution-closure 集成：**13/13 通过，0 跳过**，覆盖 held POST、未决 reservation finalizer、迟到 request ID、后续恢复轮询且只提交一次。
- task-worker：**115 通过、0 失败、6 条件跳过**；另在隔离 legacy fence DB 单独跑旧 Worker fence 用例 **3/3 通过**。六项是 MinIO/S3 环境相关测试，不能当通过。
- persistence：**139 通过、0 失败、5 跳过**；control-api：**155 通过、0 失败、4 跳过**。这些条件跳过不属于新增 execution-closure 门禁。
- submission/execution/service 定向测试 **60/60 通过**；task-worker、control-api、persistence 的 TypeScript noEmit 检查退出码均为 0。全仓 typecheck 到达最后一个包且无诊断，但该次进程退出码未捕获，因此不宣称本次全仓 typecheck 通过。
- 测后只读确认 disposable DB 中非终态任务、pending outbox、测试 workspace 均为 0；`video_local` 仅只读检查，未迁移/修改。当前树 `git diff --check` 通过，只有既存 journal 换行提示。
- 该会话未能把隔离 worktree 设为包管理器工作目录，故没有重跑最终 root build；早前 build 证据不应扩大到本轮快照。

最终结论：本地代码审计范围内的执行写入 fencing 与不确定 Provider 提交恢复/finalizer 缺陷已修复，并由上述本地集成证据覆盖；独立只读复审未发现新的 P1/P2。它不是全产品/生产验收：无真实 Provider、扣费、浏览器全链路、生产迁移、VPS、GitHub 更新/合并/部署验证。无 request ID 的真孤儿会 fail-closed 保持 RUNNING，需根据上游证据人工对账。未提交、推送、合并或部署。
