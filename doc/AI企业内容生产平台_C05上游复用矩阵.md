# C05 上游复用矩阵：Outbox、Queue 和 Worker

状态：`ACCEPTED`
日期：2026-08-13
固定上游快照：仅本机 `upstream/`，受 `.gitignore` 忽略，不进入 Git 索引、submodule 或 gitlink。

## 结论

四个指定上游中没有可安全迁入的持久化 outbox、BullMQ relay、消费去重、死信或 lease-recovery 实现。C05 不以新写代码替代可复用的队列模块，而是在逐文件核查后确认没有符合平台边界的队列实现；因此仅复用 Huobao 的“HTTP 创建任务后交给后台处理”的职责划分，并重新实现必要的事务和可靠传递层。

| 平台目标模块 | 上游文件/符号/测试 | 薄适配位置 | 最小修改理由 |
| --- | --- | --- | --- |
| TaskRun 从 HTTP 移交后台的职责划分 | `upstream/huobao-drama/backend/src/services/generation.ts`：`createTask` 后调用 `processTask(...)` 的流程 | `apps/control-api` 的 TaskRun 命令 + `apps/task-worker` relay/consumer | 保留“创建与长任务执行分离”的意图；不得复制进程内 `processTask`、轮询、全局 config、MySQL 记录或直接 Provider 调用。 |
| 提示词/模型任务数据 | `Seedance-2.5` 的参数和提示词资料 | 不在 C05 迁入；C06 后的 Provider mapper / PromptPackage | C05 只传递已冻结 `input_snapshot`，不解释模型、时长、比例或参考图。 |
| 文档转换 Runtime | `markitdown` 的 converter 选择和 `convert_stream` | 不在 C05 迁入；C10 Runtime | 文档转换不是 C05 队列消费的业务内容。 |
| 媒体工具任务 | `OpenMontage` 的 `ToolRegistry`、`BaseTool`、`ToolResult` | 不在 C05 迁入；C12 Media Runtime | 不让文件系统任务、`events.jsonl` 或 Backlot 充当平台队列事实来源。 |

## 不可复用事实

- `huobao-drama` 的 `processTask` 直接在 Web/API 进程启动，直接访问 Provider 并自行轮询；不具备 PostgreSQL outbox、消费幂等、Redis lease、死信和进程恢复边界。
- 其短剧业务状态、MySQL schema、媒体本地目录与全局运行时状态均不可迁入平台。
- 本章不读取或复制任何上游凭据、环境变量、媒体或完整快照。

## C05 新增模块来源标记

- `packages/task-queue/UPSTREAM.md`：记录 BullMQ 是 C05 的新传输依赖，非四个上游的完整代码迁入。
- `apps/task-worker/UPSTREAM.md`：记录 Huobao 仅贡献后台任务职责划分，Provider 代码明确拒绝迁入。
- `packages/persistence/UPSTREAM.md`：更新 outbox lease/consumer ledger 的平台迁移来源和边界，包括 versioned queue DTO、outbox workspace 权威校验，以及消费账本 `(workspace_id, event_id, consumer_name)` 的复合完整性。

## C05 纠偏复用登记

- `packages/contracts/src/events.ts`：新增并导出 `InternalTaskRunQueueMessageSchema` / `InternalTaskRunQueueMessage`，由现有事件 ID、workspace/task ID 和 JSON snapshot 原语组合；不是上游代码迁入。
- `packages/task-queue/src/index.ts`：BullMQ job data 只接受该 DTO，使用 `event_id` 作为稳定 job ID；非法消息不会把原始 payload 写入日志或死信。
- `apps/task-worker/src/service.ts`：Relay 只从 `task_run.queued` 的已验证 outbox envelope 构造完整 DTO，并把数据库行的 workspace 传给 mark/release；Worker 消费 DTO 后交给持久化端口。
- `packages/persistence/src/schema.ts` 与 `drizzle/0006_overjoyed_captain_cross.sql`：为消费账本增加 `workspace_id`，先从既有 outbox 回填，再将主键收紧为 `(workspace_id, event_id, consumer_name)`，用 `(event_id, workspace_id)` 复合外键证明同工作区完整性；不是上游代码迁入。
- `packages/persistence/src/task-run-repository.ts` 与 `apps/control-api/src/task-run-repository.ts`：先以 outbox/job `workspace_id` 查询，再校验 envelope workspace、TaskRun ID、correlation ID 和冻结 snapshot；消费 insert/read/reclaim/complete/dead-letter 均携带该 workspace，任何不一致在 consumption 完成前返回 `RETRY`。
- `apps/task-worker/tests/worker.integration.test.ts`、`packages/persistence/tests/task-run-repository.integration.test.ts`：真实 PostgreSQL/Redis 回归覆盖完整消息、篡改 workspace/payload、Worker 重启和重复投递的一次性推进。
