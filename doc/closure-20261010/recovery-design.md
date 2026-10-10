# 跨命令恢复唯一权威边界设计

日期：2026-10-10。状态：**已按评审决策实施，隔离定向验证通过；最终提交/CI 回执待主交付记录，未部署**。

固定核对来源：`3fd8410baf904e879ae353e796b98b10e7ea3495`。本说明设计并记录平台已有 Control API、持久化、队列及工作区边界的最小收紧；不新增媒体算法、终态分类、Provider 协议、扣费策略、公开状态或自动恢复策略。实施与测试证据见 §11，不能把基线 SHA 当作已包含修复的发布版本。

## 1. 问题、决策与保证范围

固定基线的两个显式命令使用不同幂等作用域：普通 `retryTaskRun(A)` 复用 A；`retryProductionSegment` 会为同一段创建新 Shot 和 TaskRun B，并把段的当前引用从 A 改为 B。基线 TaskRun advisory lock 可以阻止“普通重试先把 A 置为活动状态，段重试随后进入”的竞争；但段重试提交后没有 A -> B 的持久化事实，A 仍为 FAILED，新的普通重试命令可以再次激活 A。已证明远端终态只解决“能否重新生成”，不能决定“哪一个 TaskRun 仍有恢复权”。

**决策：成功的段重试永久把旧 TaskRun 标记为由新 TaskRun 取代。** 在创建 B、重绑段和写出队列事实的同一事务中写入 A 的私有 `superseded_by_task_run_id = B.id`。此后针对 A 的新普通重试命令返回已有 `STATE_INVALID`，不得追踪指针自动改成重试 B，也不得再创建 A 的 Attempt 或提交预留。B 是该次恢复的当前权威；B 以后被 C 取代时追加 B -> C，绝不清除 A -> B 或重新激活祖先。

“永久”指正常命令不能清除或改写该关系；受授权的数据修复属于单独审计操作。该决策不把 A 改成 ABANDONED，也不重写其成功/失败、结果资产或 Provider 历史。

保证限于这两个已知恢复命令及其 Worker 入口。在全部相关写入者兼容、历史不明项已隔离且事务事实完整的条件下，同一恢复链只有未被取代的末端可接受新的恢复。它不是所有项目/相似内容的全局生成去重，不把 `/shots/:shotId/generations` 的独立新生成命令解释成恢复，不撤销已被外部接受的 POST，也不提供多 Worker 外部副作用 exactly-once 或零停机混版本升级保证。

## 2. 固定来源与具体适配点

下表路径、符号均在固定 `3fd8410` 核对；行号仅作该版本定位，后续以符号为准。

| 来源 | 已有事实 | 最小适配与保留 |
| --- | --- | --- |
| `packages/persistence/src/task-run-repository.ts:568`，`DrizzleTaskRunRepository.retryTaskRun` | 命令去重、TaskRun 锁、FAILED -> QUEUED；BILLING_FAILED 有独立恢复分支 | 持久行读取后、任一恢复分支前拒绝已被取代行；保留其余状态与 Attempt 规则 |
| 同文件 `lockTaskRun:323` | 锁键为 `workspaceId + ':' + taskRunId`，事务级 advisory lock | 两种命令和 Worker 激活/提交门继续复用同一锁，不建立第二套锁协议 |
| `packages/persistence/src/production-repository.ts:1801`，`retryProductionSegment` | 锁 ProductionRun，再锁旧 TaskRun，再锁 Project；检查未知提交、可信终态或成功资产；创建新 Shot/TaskRun 并重绑段 | 在既有事务里检查旧行未被取代，原子写入唯一后继；不改变快照、引用、QC 或 Provider 规则 |
| 同文件 `replayProductionSegmentRetry:4109`、`storeProductionSegmentRetrySnapshot:4137` | 成功去重记录只保存 ProductionRun ID，重放读取当时最新进度 | 保持此现有投影语义；重放不创建后继，也不被拿来推断历史关系 |
| `packages/persistence/src/task-run-repository.ts`，`ensureProviderAttempt`、`reserveProviderSubmission`、`processEvent`、`listRecoverableVideoTaskRuns` | Attempt 与预留已使用 TaskRun 锁；processEvent 当前没有取得该锁；扫描按状态找恢复任务 | 增加私有关系检查；processEvent 在重新读取/激活 TaskRun 前使用现有锁；扫描排除已被取代行 |
| `apps/control-api/src/task-run-repository.ts:138`，`InMemoryTaskRunStore` | 内存任务重试、Attempt、提交预留、事件消费实现 | 内存保存相同私有事实，执行相同拒绝条件；不把它当成 PostgreSQL 并发证据 |
| `packages/persistence/src/schema.ts:1301`，`taskRuns` | 已有 `(workspace_id, project_id, id)` 唯一键、同项目外键、单 Shot 活动任务约束与成功结果约束 | 复用复合键增加私有自关联，保留全部既有约束 |
| `packages/persistence/src/provider-attempt-recovery.ts` | JS 严格布尔 true 与 SQL JSON boolean true 的终态判断 | 不修改、不凭 supersession 伪造终态、不清除未知预留 |
| `apps/task-worker/src/execution-service.ts`，`MockVideoTaskExecutor.execute` | 读持久任务，ensure Attempt，原子 reserve，之后唯一视频 POST；终态执行返回 | 保留提交顺序；使用新仓储门阻断陈旧恢复，不引入第二套 Provider 调用路线 |
| `apps/control-api/src/app.ts:2109,2556`、`serializers.ts:45` | 两个独立命令路由，既有状态非法错误，白名单 TaskRun/Production 序列化 | 返回既有错误；公开响应不包含后继 ID |
| `packages/persistence/tests/production-repository.integration.test.ts:1262` | 已有普通重试先取得锁的 PG 竞争回归 | 保留并增加反向提交次序和持久化重启回归 |

上位约束：`AGENTS.md` §§2.2、4、5、9–12；《领域模型与 API 事件契约》中 ProductionSegment、TaskRun 不可变快照、已知 ID/未知预留、HTTP 命令及 outbox 事务；《旧 Worker 混跑提交栅栏开发文档》§§10–12。编码前将本决策同步到领域契约的恢复规则，并将栅栏文档 §11 原“跨命令边界未定义”说明改为指向本设计及实际验证状态。不能仅改代码后声称契约未受影响。

## 3. 数据模型：一个私有列，不借用去重账本

在 `task_runs` 增加可空 text 列 `superseded_by_task_run_id`，TypeScript 逻辑名 `supersededByTaskRunId`；NULL 表示当前数据库没有已记录的取代关系，不表示已证明历史上从未有替代任务。

新增增量迁移，序号接在 `0028` 后，并生成对应 Drizzle journal/snapshot。不得编辑 `0027`/`0028` 或固定旧 Worker 夹具。约束：

1. 自关联复合外键 `(workspace_id, project_id, superseded_by_task_run_id)` -> `task_runs(workspace_id, project_id, id)`，`ON DELETE NO ACTION`。单独删除仍被祖先引用的后继会失败；在同一完整项目/工作区级联删除语句结束时检查，避免破坏已有清理路径。不得使用 SET NULL 让历史任务重新变得可重试。
2. CHECK：`superseded_by_task_run_id IS NULL OR (kind = 'VIDEO_GENERATION' AND status IN ('FAILED', 'SUCCEEDED'))`。A 只有在现有段重试允许的两个终态才能被取代；以后旧写入者直接将 A 置为 QUEUED/RUNNING 等活动状态时，PostgreSQL 必须拒绝整个更新。
3. CHECK：后继 ID 不等于本行 ID。
4. 非 NULL 后继上的 `(workspace_id, project_id, superseded_by_task_run_id)` 唯一索引，禁止两个旧任务汇入同一个后继。每一旧行只有一个后继列；正常写入必须 CAS NULL -> 新 ID，不允许改写。

后继必须是同事务中新建的 VIDEO_GENERATION TaskRun，且与旧行同工作区/项目。自关联 FK 负责持久归属，仓储负责“本次新建”“同 kind”“没有重用历史 ID”和只写一次；上述约束不单独证明任意手写 SQL 无环。正常命令仅指向新行，因而不产生环。没有跨行触发器、图遍历调度器或新的生命周期枚举。

不额外添加 `superseded_at`：新任务 createdAt、同事务 queued outbox 与旧行 updatedAt 提供本次操作的既有时间事实。需要更多审计字段必须另有具体需求，不能顺手扩大模型。

取舍：

- 只使用 advisory lock：不能覆盖事务已经结束后的命令，拒绝。
- 查 `production_segments.task_run_id`：只保存当前引用，旧引用已丢失；普通任务也可能从来不属于生产段，不能据此推断历史，拒绝。
- 复用 input_snapshot、error 或 Attempt.responsePayload：快照不可变，错误/Attempt 事实另有语义且后续可被重写，拒绝。
- 复用 `command_deduplications` 作为跨命令唯一后继表：其 scope、回放与保留策略是命令语义，且现有成功快照不保存 A -> B，拒绝。它仍只按原用途保存每个命令结果。
- 新建 lineage 表：能表达关系，但本次一对一后继不需要额外表；同时很难用本行 CHECK 约束旧应用重新激活 A。选一个列及既有复合外键是较小适配。

## 4. 事务与两种到达次序

### 4.1 普通重试

1. 保持原命令去重占位/回放及 requestHash 冲突判断。
2. 取得 `lockTaskRun(workspaceId, taskRunId)`，从持久行按工作区重新读取。
3. 不存在或工作区错误仍为 NOT_FOUND；有后继则保存/返回 STATE_INVALID，且不返回后继 ID。检查必须位于 BILLING_FAILED 与 FAILED 分支之前。
4. 未被取代时执行现有未知预留、Attempt 终态及普通/扣费重试规则，仍在同一事务内更新任务、Shot、outbox 和命令结果。

### 4.2 制作段重试

1. 保留原去重处理和 `ProductionRun -> old TaskRun -> Project` 锁顺序。普通重试或 Worker 不得在持有 TaskRun 锁后反向取得 ProductionRun 锁。
2. 在已有段状态、归属核验及 TaskRun 锁下重新读取 A；除既有证据门外，要求 `A.supersededByTaskRunId IS NULL`。段如果仍错误指向已被取代的 A，返回 STATE_INVALID，不沿指针寻找其它段。
3. 继续逐 Attempt 检查：任何无 ID 预留仍阻断；未证明终态的已知 ID 阻断；QC 重试仍要求持久化成功任务、对应成功 Attempt 与同归属 READY VIDEO 资产。supersession 不能替代任何一项证据。
4. 新建 Shot B 和 TaskRun B，原样复用旧的、已校验 input_snapshot 及既有引用复制规则。
5. 按 workspace/project/id、允许终态及 `superseded IS NULL` 条件将 A 后继设为 B，并更新 A.updatedAt。要求恰好一行；不修改 A.status、inputSnapshot、error、resultAssetId、Attempt、资产、历史 QC 或 Handoff。
6. 原条件更新把段重绑 B，ProductionRun 进入 GENERATING，写 B 的唯一 queued 事件、进度事件和命令成功事实。所有相关写入一起提交。
7. 在首次写入新实体后，任何本应成功的 CAS/关联更新/进度读取失败都必须抛出并回滚整个事务。不能像普通校验失败那样 return 一个错误结果而让已经创建的 B/关系/outbox 提交。事务中断后同 key 重试可以重新执行；不得留下半个成功命令。

### 4.3 必须成立的顺序表

| 顺序 | 必须结果 |
| --- | --- |
| 普通重试先持锁并提交 A=QUEUED，段重试随后检查 | 段重试 STATE_INVALID；不新建 B、不写关系 |
| 段重试先持锁并提交 A -> B，普通重试随后检查 | 普通重试 STATE_INVALID；A 保持原终态，只有 B 的新 queued 事实 |
| 两个段重试、不同 key 并发 | ProductionRun/TaskRun 锁串行化；当前有效失败段最多产生一个后继 |
| 普通重试已完成一次执行，A 再次合法 FAILED，之后用户段重试 | 可按现有证据门创建 B；这是先后两次明确恢复，不是同时两个权威 |
| B 失败后段重试创建 C | A -> B 与 B -> C 都保留；A/B 的新普通重试均拒绝 |
| 段重试事务在任意中间点失败 | A 无关系、段仍指向 A、无 B/复制 Shot/新增 outbox 或成功 dedup 残留 |

## 5. Worker、陈旧消息与版本边界

新增守卫集中在已有持久边界，不以界面隐藏按钮代替：

- `processEvent` 先按既有方式验证 workspace/outbox/message/快照一致性，再在任务状态读取及激活前取得 TaskRun 锁。已被取代任务按既有终态重复消费路径结束；不置 RUNNING、不产生 started 事件。
- `ensureProviderAttempt` 在 TaskRun 锁下拒绝已被取代行；`reserveProviderSubmission` 在同锁下再次拒绝，避免只依赖执行器早先读取。
- `listRecoverableVideoTaskRuns` 显式排除已被取代行；执行器即使收到陈旧队列消息也因终态/私有守卫 no-op。
- 其余状态推进方法必须在现有锁下保留终态和关系。特别验证失败收敛、下载/扣费恢复及结果提交不会清空后继、改写成功历史或把祖先重新激活。数据库 CHECK 是最后防线，不应成为正常新应用控制流。
- `recordProviderSubmission` 若收到晚到的真实 request ID，仍须保留已有“不可丢失外部已接受事实”的记录语义；不能为了忽略旧任务丢弃 ID。正常协议中 A 的活动状态/未知预留会阻止 supersession，故合法已被取代 A 不应出现新的在途提交。若该组合来自历史损坏或违规旧进程，记录事实并保持停流/对账，不自动取消、清空或重提。

对已取得提交预留、却尚未 POST 的新 Worker，A 尚为活动状态或含无 ID 预留，段重试必须失败，因此不存在通过写关系来“取消”该次授权的设计。对已在事务外执行 GET、下载、参考图交付、扣费的旧执行，关系列不提供网络取消能力。现场排空和旧 Worker 栅栏文档中的在途限制继续成立。

`0028` 的 `provider_request_id_v2` 物理栅栏必须保持；但 `3fd8410` 等认识 v2 却不认识 supersession 的构建不受该旧列栅栏拦截。新 CHECK 只会阻止**已经有关系**的 A 被旧普通重试更新为活动状态；旧 API 可能把约束错误报为普通服务器错误，不能宣称其返回新的干净 409。旧段重试仍可创建 B 而不写 A -> B，故共享数据库上的新旧恢复写入者混跑不安全。没有零停机/滚动发布承诺。

## 6. 幂等、快照、工作区与公开隐私

### 6.1 幂等与快照

- 相同 scope/key/hash 继续返回已有命令事实；异 hash 继续 CONFLICT。重放发生在关系检查之前，不能把此前成功的命令回放改成新的失败。
- 历史普通重试的成功快照可能仍显示当时 QUEUED；回放是该命令的原结果，不是重新激活 A，也不应重新写 queued outbox。当前状态通过既有 GET 获取。
- 段重试成功回放继续读取 ProductionRun 当前进度，这是固定基线的已有行为；本轮不声称它是原始逐字节响应快照。无论返回当前什么进度，都不得再生成一个任务。
- 新 key 对已被取代 A 的 STATE_INVALID 也存入去重事实；以后相同 key 不因后继完成而改变结果。不得删除旧 command 记录来“修复”重试。
- `input_snapshot` 和历史 outbox 的 input_snapshot 必须逐值保持不变；关系只能存在私有持久字段。新 B 的输入按原规范复制，不加 root ID、后继 ID 或自造 Provider 幂等参数。
- 内部 `ControlTaskRun` 可以显式映射可空私有字段供仓储/测试使用；不得直接 spread 到公开 DTO。旧 command 快照可能没有该字段，回放解析要兼容，但不能用旧快照的缺失值授权当前执行。运行资格永远重新读持久行。

### 6.2 工作区和隐私

- 所有读写、锁、FK 及后继关系均受 workspace 限制；关系额外要求 project 相同。外工作区普通重试仍返回 NOT_FOUND，不提供“该 ID 已被取代”存在性线索。
- 公开 TaskRun、项目详情、任务详情、制作进度和 SSE 均不得增加 `superseded_by_task_run_id`、后继 Shot/TaskRun ID、Provider/request ID、对象 key、私有快照或内部错误详情。
- 保留 `serializeTaskRun`/`serializeProductionRunProgress` 的显式字段白名单，增加 JSON 负面断言。TaskRun 原有自身 ID 等已公开字段不因本设计重新定义。
- 内部 command 快照可继续含现有内部 ControlTaskRun 事实，但去重表不能成为关系权威。日志不得输出整行/完整 input_snapshot 以调试关系；只保留当前访问范围内必要内部标识及安全错误码。

## 7. 内存与 PostgreSQL 语义一致性

基线仅有 `InMemoryTaskRunStore`，**没有**内存 ProductionStore；未注入 ProductionStore 时段重试路由返回 NOT_FOUND。本轮不为测试方便新增一套内存制作调度器，也不宣称其有 PostgreSQL 的事务/持久性。

内存任务记录初始化私有后继字段为 NULL，已有任务更新必须保留字段；普通重试、可恢复列表、事件激活、ensure Attempt、reserve 及终态写入使用与 PG 相同的“有后继即不能恢复”判断。对历史结构缺字段只允许读兼容，不允许客户端通过命令参数设置/清除关系。测试可通过受控的内部种子夹具构造同工作区已取代状态，不新增公开或生产运行时的单独 supersede API。跨命令原子性和两种锁顺序必须在真实 PG 下证明。

内存事件处理含 await，在任务激活前必须读取最新任务状态；不能让 await 前取得的旧对象覆盖刚写入的关系。内存修改采用替换记录，并避免共享对象引用修改已有 dedup 结果/历史快照。若实现发现既有 await 分界无法保证同一 guard 与状态更新的原子性，应复用一个内部任务级串行边界，而非用成功用例掩盖该竞态；这不替代 PG 锁竞争测试。

## 8. 开发与隔离测试验收

以下为必须新增/复核的验收要求；实际通过项、证据层级与未执行边界见 §11，不按表格存在推断全部已验证。真实数据库只用任务专属 loopback PostgreSQL 和现有严格端点护栏；不得从误设的通用 DATABASE_URL 触发建库/删库。仅 Mock/loopback HTTP，不使用真实 Key、生产数据或收费 Provider。

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| R1 | 0028 历史库升级和全新完整迁移 | 新列可空；现有行/值/预留/ID/索引不变；旧列栅栏不回退；Drizzle metadata 一致 |
| R2 | 关系约束 | 自指、跨 workspace/project、无目标、非视频源、非终态源、重复后继失败；合法 FAILED/SUCCEEDED 关系成功；删除后继受限；正常项目/工作区清理行为有明确回归 |
| R3 | 段重试后普通 retry(A)，不同 key | A -> B 持久；普通 STATE_INVALID；旧任务/Attempt/资产不变；无 A 新 outbox/submit；B 只执行一次 Mock submit |
| R4 | 普通重试先持锁，段重试等待 | 用两个真实事务及可控屏障证明等待；提交 A=QUEUED 后段拒绝；没有 B/关系 |
| R5 | 段重试先持锁，普通重试等待 | 用真实事务/测试屏障覆盖创建 B、写 A -> B 期间等待；提交后普通拒绝；不能仅两个顺序调用代替竞争证据 |
| R6 | 段重试双击/不同 key 与同 key 并发 | 至多一个当前后继和 queued 事实；同 hash 回放；异 hash 冲突；多次失败的 A -> B -> C 链不解锁祖先 |
| R7 | 各写入点故障注入与事务回滚 | B/新 Shot/复制引用/关系/段绑定/run 状态/outbox/dedup 要么完整成功要么全不发生；相同 key 可安全重试 |
| R8 | 进程/仓储重建后重试 A | 新 repository/client 从数据库读到关系，仍拒绝；不得仅依赖进程 Map 或 UI |
| R9 | 历史成功命令重放与失败命令重放 | 原响应语义保留；不新增任务、Attempt、queued 事件或 POST；旧快照无新字段仍可读取 |
| R10 | Attempt 证据矩阵 | 终态 true 正例；字符串/数值/数组/NULL、HTTP 401/403/404、配置错误、历史 ABANDONED 反例；已知 ID + 另一未知预留仍禁止替代 |
| R11 | 成功视频后 QC 失败 | 保留成功 TaskRun/Attempt/READY 资产归属正反例；可生成 B，A 成功结果仍可读且不可再恢复 |
| R12 | 陈旧 queue、恢复扫描、ensure/reserve、失败回调 | 祖先不激活、不新增 Attempt/预留/POST，不覆盖关系或历史结果；新 B 正常执行；晚到 ID 不被静默丢弃 |
| R13 | 两个存储实现的任务守卫 | 内存与 PG 对同一有/无后继、状态、workspace 输入得到相同 task 层结果；不伪称内存具有生产段重试实现 |
| R14 | API/序列化/SSE | 两入口状态非法仍为既有错误；错误工作区 NOT_FOUND；私有字段及后继 ID 不泄漏；输入 schema 不接受关系字段 |
| R15 | 未升级普通 SQL 写入者 | 有关系 A 的旧式 UPDATE -> QUEUED 被 CHECK 拒绝且事务无新事件；明确这是数据库级证据，不冒称完整旧进程验证 |
| R16 | 未升级段写入者/混版本负面演练 | 展示旧写入者不写关系仍有洞，记录为“不支持的部署组合”；上线门必须禁止该组合，不能把它记为安全通过 |

推荐受影响套件：Persistence schema/迁移、task-run repository、production repository；Control API C06 task/C12 production/serializer；Task Worker submission-reservation/known-request-retry/worker integration；Provider 既有终态分类回归；冻结 44da842 来源与 Windows checkout 回归。最终执行锁定 `pnpm@10.33.0` 的相关 build、`pnpm typecheck`、适用全套 test、`git diff --check`。真实 PostgreSQL/Redis/MinIO 条件用例的通过、失败和 skip 分开记载；不同套件重叠不合计。以最终精确提交 SHA 重新核对 CI。

独立审计至少逐项检查 R3–R7、R9、R12、R14–R16 的证据和代码路径；审核不得仅根据新增列、SQL 文本或全部 mock 绿灯签字。

## 9. 切换、历史与回滚设计

本节只有计划，不授权也不执行现场操作。

1. 盘点所有创建/重试 TaskRun、段重试、队列激活及预留写入者的精确版本；包括 Control API、各 Worker、恢复进程、脚本和自动重启来源。标出会用 v2 物理列但不认识后继字段的版本。
2. 暂停两个恢复入口及会派生相关任务的调度/relay，阻止旧消费者领取新任务；按现有栅栏文档排空和核对所有在途/未知 POST、队列、outbox 及独立扣费事实。固定等待时间、队列空或 lease 到期不构成排空证据。
3. **历史关系不能自动补造。** 基线段只保存当前 TaskRun，段重试 dedup 只保存 run ID；相同输入 hash、时间相近、Shot 位置或 ID 排序都不足以证明 A -> B。迁移默认 NULL 不代表历史安全。只有独立可靠的历史操作/审计证据能支持逐项人工修复，且须另有授权。无法还原的受影响任务/项目保持恢复入口停用及 HOLD；不要通过清预留、改状态或制造新 TaskRun 绕过。
4. 保存并验证可恢复备份及任务/Attempt/队列清单。应用增量迁移，核对新约束、旧数据、旧 v2 栅栏和 Drizzle journal；迁移失败保持停流。
5. 只启动同时支持提交预留、可信终态和 supersession 的完整兼容构建。不能仅升级 Task Worker 而留旧段重试 API；也不能以 CHECK 能拦旧普通重试为理由放行旧段写入者。
6. 在获授权的测试范围核对普通重试、段重试、当前状态、历史资产、重复消息及有关系任务约束；所有历史不明项仍隔离。确认消费者版本与证据后才按批准范围恢复入口。收费 canary 需要单独授权。
7. 观察非预期约束错误、已取代任务的活动状态/新预留、重复 POST、未知结果、DLQ/outbox 差异。发现任一项暂停恢复并按事实对账，不能自动“修正”关系。

回滚优先选择已兼容该列及全部恢复守卫的上一应用构建。`3fd8410` 不属于安全恢复写入者：即使保留 CHECK，它仍能写入没有关系的新替代任务。没有兼容回滚构建时保持相关写入口关闭，先修复前进；不恢复旧列、删除/清空关系、删除后继或删除 CHECK 来换取旧代码可运行。

数据库回退/旧备份恢复必须独立规划：停流、禁止旧进程自动重启、核对备份之后的全部外部请求与扣费、保留/恢复后继关系和预留事实，完成消费者/schema 对齐后再重新放行。旧备份的 NULL 不能授权重新 POST；不提供自动 down migration。已生成内容或费用不会随数据库回滚撤销。

## 10. 评审与交付门

本设计经主执行者及独立评审确认政策与历史停流约束后实施。范围保持为：私有列与约束、同事务写关系、两个命令及现有 Worker 门检查、内存任务守卫、契约说明、隔离测试和切换证据模板。

开发完成只表示最终 SHA 的实现与隔离证据通过；历史关系对账、生产排空、迁移/回滚演练及现场版本核对仍独立 PENDING。Draft PR、代码审计或 CI 不能把本节变成部署许可。本设计不修改任何历史 QC、来源认证、全依赖风险或生产验收结论。

## 11. 本轮实施与隔离验证回执

证据对象：固定 `3fd8410` 加本轮工作区修复，2026-10-10 云端隔离验证。新增迁移 `0029_task_run_recovery_supersession.sql`、journal 与 `0029_snapshot.json`；schema 文件 SHA-256 为 `546f12f1cd4744e6c986118d7457b2d1a848a849f5c0104da0199d383ecfb86b`。最终 Git SHA 和该 SHA 的 CI 由主交付记录补充，以下不是生产/部署回执。

实现保留一个可空私有列，未新增公开 DTO、状态或事件字段。自关联最终选用 **NO ACTION**：在真实 PostgreSQL 16.14 下，单独删后继得到 `23503`，同一语句的完整项目/工作区级联清理均成功。当前检查涵盖同项目/工作区 FK、自指、重复后继、非视频源、非法活动状态以及历史迁移数据保持；没有通过 SET NULL、清预留或删除关系消除约束失败。

| 检查 | 命令/定位 | 结果与证据边界 |
| --- | --- | --- |
| 真实两向命令竞争、链与 10 个事务回滚点 | Persistence 目录执行 `node --import tsx --test --test-concurrency=1 tests/production-repository.integration.test.ts`；同时设置专用 `PRODUCTION_RECOVERY_TEST_DATABASE_URL` 与普通套件的任务专属 DATABASE_URL | **24 通过、0 失败、0 跳过**。旧/新命令均为实际仓储调用；测试用 advisory 屏障验证等待，用专用测试库触发器注入写失败和 CAS 返回零行；关系、实体、事件和 dedup 完整回滚后同 key 可继续成功 |
| R3 同一场景跨层贯通 | 上述套件的 `R3 segment replacement executes its PostgreSQL-backed successor exactly once through the Mock Worker` | A -> B 提交后，实际 Task Worker 消费 B 的持久 queued 事件并调用既有 Mock Provider；明确终态失败得到一次 submit、一个含预留/已知 ID/可信终态的 Attempt。重复 delivery、重建执行器和执行祖先 A 均不增加 submit；随后继续 B -> C。此用例不下载媒体、不使用真实 Provider，也不是 BullMQ 网络运输测试 |
| 自关联、清理、升级与 TaskRun 私有守卫 | Persistence 目录执行 `node --import tsx --test --test-concurrency=1 tests/task-run-supersession.integration.test.ts tests/legacy-worker-fence-migration.integration.test.ts`；仅接受严格校验的 LEGACY_FENCE_TEST_DATABASE_URL | **6 通过、0 失败、0 跳过**。实际新建/删除专属随机数据库；旧请求 ID/预留/索引及旧 TaskRun 逐值保持，新增关系默认 NULL；旧普通状态写入被 CHECK 拒绝；陈旧队列、后继扫描、晚到资产/状态/扣费回调被阻止，晚到 request ID 保留 |
| Worker 防重与晚到续接 | Task Worker 目录执行 `node --import tsx --test --test-concurrency=1 tests/execution-service.test.ts tests/known-request-retry.test.ts tests/submission-reservation.test.ts` | **52 通过、0 失败、0 跳过**。包含 processing/completed/transient 查询返回后观察到取代关系立即结束；下载完成、捕获旧 draft、结果提交及 billing usage await 后再次观察到取代关系时，不继续 storage/debit 调用；已进入外部调用的操作不被声称可取消 |
| 内存任务层一致性和公开脱敏 | `apps/control-api/tests/task-run-supersession.test.ts` | **9 个新增用例通过**。无内存 ProductionStore/公开 supersede API；测试种子仅设置私有状态。旧成功/失败回放、空字符串非 NULL 防漏、工作区、不可变快照、历史结果及 late ID 均覆盖 |
| 静态映射与类型 | `packages/persistence/tests/schema-contract.test.ts` 中新迁移/schema 断言；Persistence build；Task Worker `tsc --noEmit`；Control API `tsc --noEmit`；`git diff --check` | 通过。旧 `0028` 契约改为定位 idx=28，完整链迁移数量更新为 30；未修改冻结旧版本夹具及其 pre-0028 子集 |

上述套件有重叠，数量不能相加作为不同场景总数。第一轮回归揭示的是测试夹具缺陷：资产 object_key 未满足既有 scope CHECK；复制引用故障点的旧 Shot 没有绑定，导致注入分支未执行；公开段投影本就没有 TaskRun ID，不能拿它断言内部链。均修正夹具/断言后重跑，未删除既有约束或扩展公开字段来“修绿”。

独立复审指出并关闭了 Worker 晚到续接缺口：已捕获 draft 或完成结果不能绕过后续已读到的取代关系去访问存储/扣费，内部 transient polling 同样尊重仓储返回的取代事实。复审者独立运行 memory/known-request/execution-service **51 通过、0 失败、0 跳过**及 Worker typecheck；真实 PG 竞争/迁移结果来自实施执行环境及主执行者的独立全套回归，不能写成复审者亲自跑过 PG。

未执行/不支持边界：R16 未运行完整旧 v2 段重试服务与新服务混跑部署镜像，已按固定旧源码和数据库约束边界确认该组合不受支持；R15 是真实 SQL/CHECK 证据，不冒称所有旧 API 能友好返回 409。生产历史逐项关系还原、未知外部请求对账、现场排空、停流/迁移/回滚演练、收费 canary、完整浏览器与 Redis/S3 运输验收仍由各自回执负责。本轮没有合并、部署、修改生产数据库或访问收费 Provider。
