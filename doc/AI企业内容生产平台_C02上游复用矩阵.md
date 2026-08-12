# AI 企业内容生产平台：C02 上游复用矩阵

## 范围

C02 只建立平台自己的契约、领域和持久化边界。上游没有可直接复用的企业工作区、任务运行或审计领域模型，因此不能复制其业务表、全局状态或 Provider 调用。以下记录保留可审计的最薄复用。

| 目标模块 | 上游固定版本与文件/符号 | 迁入或保留内容 | 平台薄适配位置 | 舍弃原因与回归保护 |
| --- | --- | --- | --- | --- |
| `packages/persistence` | huobao-drama `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`；`backend/src/db/schema.ts`；`mysqlTable` 表声明、`id`、`createdAt`、`updatedAt` 命名模式 | 使用 Drizzle 表定义、显式主键和时间列的组织方式；保留中性 camelCase 变量命名 | `packages/persistence/src/schema.ts`、`packages/persistence/UPSTREAM.md` | 不迁入 MySQL、`dramas`/`episodes`/`sysTask`、AI 配置/Key 字段、本地路径、进程内任务真相。PostgreSQL 表和工作区约束按本平台契约重新建立；schema 和迁移测试验证。 |
| `packages/contracts` | OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`；`tests/contracts/test_phase0_contracts.py`；`schemas/artifacts/*.schema.json` | 每份对外 schema 都需由自动化契约测试检查的质量门思想 | `packages/contracts/tests/contract-export.test.ts`、`packages/contracts/UPSTREAM.md` | 不迁入 Artifact 定义、Python 工具输入、Backlot、项目目录或事件 JSONL。平台以 Zod 为唯一源码并导出 OpenAPI、AsyncAPI、JSON Schema；测试检查导出与 Zod 定义一致。 |
| `packages/domain` | 无可迁入代码；C02 使用平台 `TaskRun` 契约作为唯一事实 | 无 | `packages/domain/UPSTREAM.md` | 任何上游的短剧任务状态、Provider 轮询和文件系统状态均会破坏平台的可恢复状态机，全部舍弃。纯领域测试固定状态迁移和不变量。 |

本文件只记录目标模块中的薄适配。`upstream/` 的固定快照仍保持本机忽略，不会进入 Git 索引、submodule 或 gitlink。
