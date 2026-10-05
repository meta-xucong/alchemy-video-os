# Persistence 集成回归 `asc` 导入修复任务单（2026-10-04）

## 目标与范围

目标：修复 PostgreSQL 启用时 `production-repository.integration.test.ts` 因使用但未导入 Drizzle `asc` 而在运行期抛出 `ReferenceError` 的测试装配缺陷。

本任务只允许给该测试文件已有的 `drizzle-orm` import 增加 `asc` 标识符。不得改测试逻辑、生产代码、fixture、契约、数据库 schema、其他 import 或格式；必须保留该文件当前所有既有修改。

## 基线与写集

- 唯一代码写文件：`packages/persistence/tests/production-repository.integration.test.ts`
- 冻结基线 SHA-256：`4751C19DFB0F67A00B683176C737F872CAEB20FACD12BD296089942D765E4F2E`
- 唯一预期 diff：`import { and, eq } from "drizzle-orm"` 改为 `import { and, asc, eq } from "drizzle-orm"`。
- 本任务单：`doc/AI企业内容生产平台_PERSISTENCE集成回归asc导入修复任务单_20261004.md`
- 基线中的 `asc(...)` 调用定位：该文件约第 934 行；已有测试执行证据见 2026-10-04 工作区验收日志。

## 依据与诊断

在仓库本地 PostgreSQL 上运行：

```text
pnpm --filter @alchemy-video/persistence exec tsx --test tests/production-repository.integration.test.ts
```

结果为 5 pass / 1 fail。唯一失败为 `C12 Drizzle production persists QC, handoff, dependency scheduling, composition, and terminal media failure`，抛出 `ReferenceError: asc is not defined`，失败位置为对 `productionSegments.sequence` 的排序。源文件已导入同模块的 `and`、`eq`，仅缺 `asc`。此为测试文件导入缺失，不是产品逻辑结论。

## 验收门

1. 修改前独立文档审计必须对本任务单给出 PASS；
2. 修改后确认精确 diff 仅为上述一个 import 标识符，且保留冻结前其他改动；
3. 重新运行同一 PostgreSQL 集成测试文件，要求 6/6 通过、0 skip；
4. 运行 `pnpm --filter @alchemy-video/persistence typecheck` 与 `git diff --check -- packages/persistence/tests/production-repository.integration.test.ts`；
5. 修改后由不同审计者只读检查冻结文件 hash、唯一 diff、失败复现修复与测试结果。审计未 PASS 时不得宣称本缺陷验收通过。

## 边界

只使用项目本机 PostgreSQL 的随机化测试数据；不运行迁移、不清理数据库或容器、不调用 Provider/TTS/Veyra/网络/VPS、不改 `.env*`，不 stage、commit、push、merge 或部署。本修复只关闭测试装配缺陷，不升级任何正式章节、E12/R01、C12.4/C12.5 或发布状态。
