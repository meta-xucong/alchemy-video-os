# AI 企业内容生产平台：短时长单段 Provider 规划最小优化开发文档

> 状态：`READY_FOR_AUDIT`（本地实现完成，待独立审计；未标记 `ACCEPTED`）
>
> 本文只覆盖短时长目标在已知 Provider 能力范围内的单段规划，以及超过 Provider 上限时的最小合法分段。不会启用真实 Provider、Veyra、共享积分、VPS、网络调用或 Git 写入。

## 1. 任务与冻结决策

当前规划器把 Huobao 的 8 秒段下限当成所有 Provider 的通用下限，导致短目标被机械拆成非法的 `8+7`，或被迫补长。此次只做 profile-derived duration policy 的内部薄适配：

- 目标时长 `<= maxDurationSeconds` 时只创建一个 Provider segment，段时长精确等于结构化 `targetDurationSeconds`；不补长、不四舍五入、不从自然语言重新解析时长。
- 目标时长 `> maxDurationSeconds` 时才按既有来源分段；每段必须处于当前 policy 的 `[minDurationSeconds, maxDurationSeconds]`，显式场景边界或口播容量无法满足时沿用既有 `STORYBOARD_SPEC_INVALID`/容量错误并 fail-closed。
- 默认 Huobao/source policy 仍为 `8..15`。只有 Worker 从既有 `resolveVideoProviderRuntimeProfile` 得到已识别的 `sub2api`/Grok profile 时，才传递 `1..15`；Mock 或缺少能力事实不得假称 Grok。
- `maxDurationSeconds=15` 来自固定来源事实，不引入第二套 provider heuristic；`minDurationSeconds=1` 只对应 OpenMontage Grok duration 整数 `1..15` 能力。
- 普通多动作继续放在同一个 segment 的 motion beats 内；短目标不因动作数量增加 Provider 调用数。
- 口播仍使用现有 dialogue capacity 逻辑；不慢放、不补静音、不改写、不发明词速或舍入算法。Grok `1..15` policy 只替换分段合法范围和现有容量检查所用的段下限。

## 2. 固定来源与冲突审计

| 来源/固定版本 | 文件、符号或规则 | 本地最小适配 | 冲突裁定 |
| --- | --- | --- | --- |
| `huobao-drama@f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `storyboard-breaker/SKILL.md`、`prompt-generator/video-prompt/SKILL.md` 的默认段落/子镜头边界 `8..15s` | `DEFAULT_STORYBOARD_DURATION_POLICY` 和无显式 profile 的 planner/domain 默认值 | 保留为默认和 source/fail-closed 行为 |
| `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/grok_video.py` 的 Grok duration 整数范围 `1..15` | Worker 仅对解析出的 `sub2api` profile 传 `minDurationSeconds=1,maxDurationSeconds=15` | 已知 Grok profile 的 `1..15` 覆盖默认 Huobao 下限；不扩大 Mock 或未知 profile |
| 本地既有 `packages/provider-video/src/runtime-profile.ts` | `resolveVideoProviderRuntimeProfile` 的 mode/provider 事实 | `apps/workflow-worker` 从已解析 profile 生成内部 PlannerInput policy | 不修改 compactor、Provider API 或 profile 公共能力字段 |
| 本地既有 `packages/domain/src/creative-planning.ts` | `assertStoryboardPlan` 的序列、依赖和总时长不变量 | 增加可选 policy；缺省仍 `8..15` | 领域层拒绝不合法段，不在 UI 修补 |
| 本地既有 `packages/creative-planning/src/index.ts` | `chooseGenerationSegmentCount`、`planSegmentDurations`、`assertStoryboardPlan` 调用 | 目标不超过 max 时强制 count=1；超过 max 才使用既有分配与容量路径 | 不改来源分段算法含义，不新增静默回退 |

## 3. 契约、数据和 UI 影响

这是向后兼容的能力扩展，不新增公开字段或 Provider API 字段：

- `packages/contracts/src/creative-planning.ts`：Creative Brief/command 的 `target_duration_seconds` 下限 `15 -> 1`；`StoryboardShotSpec.duration_seconds` 下限 `8 -> 1`，上限仍 `15`。
- `packages/contracts/src/delivery-preflight.ts`：Delivery Plan 的 `target_duration_seconds` 下限 `15 -> 1`，上限仍 `600`。
- `packages/persistence/src/schema.ts`：只把 Creative Brief 和 Delivery Plan 的数据库 check `between 15 and 600` 降为 `between 1 and 600`；StoryboardShotSpec 数据列已无错误的 8 秒 check，不新增字段。
- `packages/persistence` 的最终 storyboard 校验必须接收 Workflow 已解析的内部 `durationPolicy`；未携带该内部值时继续使用默认 Huobao `8..15`，不新增公开 API 或数据库字段。
- 下一条 Drizzle migration 只执行上述两个 check 的替换；历史 migration/meta 不回写。
- `StoryPlanningPanel.vue` 与项目页输入、估算和提交前校验统一使用 `1..600`。现有估算仍只依据 15 秒 max；短目标显示一个精确时长的 segment，不增加新的 UI 语义或 Provider 信息。

## 4. 范围与非目标

### 允许改动

- 本文档及本章所需的审计证据。
- `packages/creative-planning/src/index.ts`、其定向测试。
- `packages/domain/src/creative-planning.ts`、domain 定向测试。
- `packages/contracts/src/creative-planning.ts`、`packages/contracts/src/delivery-preflight.ts` 及既有 contracts 定向测试。
- `packages/persistence/src/schema.ts`、下一条 Drizzle migration、schema 定向测试。
- `packages/persistence/src/creative-planning-repository.ts`、`packages/persistence/tests/creative-planning-repository.test.ts`：仅传递并验证内部 policy，不改变公开持久化契约。
- `apps/workflow-worker/src/index.ts`、`apps/workflow-worker/src/execution-service.ts` 及定向测试。
- `apps/studio-web/app/components/studio/StoryPlanningPanel.vue`、`apps/studio-web/app/pages/projects/[project_id].vue` 及必要的 focused UI 证据。

### 明确不做

- 不修改 `packages/provider-video/src/runtime-profile.ts` 的 prompt compactor，不新增 runtime profile 字段或 Provider 协议。
- 不修改 billing/auth/Veyra/Sub2API/VPS/deployment，不执行网络或真实 Provider。
- 不把 Mock 的固定 `duration=1` 解释为 Grok `1..15` 能力；默认 Mock/source policy 保持 Huobao `8..15` fail-closed。
- 不重写 Huobao/OpenMontage 的口播容量算法，不引入词速、慢放、补静音、自动裁剪、自然语言时长解析或平行 heuristic。
- 不修改 creative-planning 前一轮已有的 visual-only 15 秒单段修复语义；本轮只把其短时长判断接入显式 duration policy。

## 5. 实施和行为验证计划

1. 先保留工作区用户改动，新增本文档。
2. 在 domain 增加默认 Huobao policy 和可选 profile policy；在 planner 的内部 `PlanningInput` 传递并用于 segment count、duration/capacity 和最终 assertion。
3. Worker 从 `resolveVideoProviderRuntimeProfile` 解析结果传递 policy；Mock/未知保持默认 policy。
4. Workflow draft 在完成规划时把同一 policy 传入 persistence 最终校验；缺省仍 fail-closed 于 Huobao 默认边界。
5. 对齐 contracts、persistence migration 和 Studio 输入/估算边界。
6. 定向验证至少覆盖：
   - 显式允许 `1..15` policy 时，目标 `1/6/7/8/15` 各生成一个且精确时长相同；普通多动作不增加段数。
   - 默认 Huobao policy 下 `8/15` 单段，`16 -> 8+8`，`17 -> 9+8`（或同样合法分配），`30 -> 15+15`。
   - 默认 policy 下短显式场景边界若不能满足最小段长则 `STORYBOARD_SPEC_INVALID`；不改目标时长。
   - 口播容量沿用既有行为：无法装入精确短目标时抛既有规划/容量错误，不拉伸、不补长。
   - Mock/default policy 不被识别为 Grok；Worker 仍使用 source/fail-closed 路径。
   - contracts/domain/schema/UI 的 `1..600` 或 `1..15` 边界与旧的 `15..600`、`8..15` 兼容案例均通过。

## 6. Exit Gate 与审计证据

本章只能在以下证据齐全后标记 `READY_FOR_AUDIT`；不自行标记 `ACCEPTED`：

- 改动文件清单、每个改动的固定来源映射和本地-only/无外部调用声明。
- creative-planning、domain、contracts、persistence、workflow-worker 的 focused tests/typecheck 结果。
- migration/schema 只包含两个 target duration check 的范围扩展，没有无关漂移。
- planner 结果证明 `1/6/7/8/15` 单段精确时长、`16/17/30` 合法分段、显式边界 fail-closed、口播/Mock 回归。
- `git diff --check` 通过；不包含密钥、签名 URL、媒体、上游快照或 Git 提交。

实施前状态曾为 `IN_PROGRESS`；本地实现、测试证据和 `doc/AI企业内容生产平台_章节审计记录.md` 的本章局部记录已追加；历史审计条目未重写。

## 7. 变更清单（实施后更新）

计划变更文件：

- `packages/creative-planning/src/index.ts`
- `packages/creative-planning/tests/deterministic-planner.test.ts`
- `packages/domain/src/creative-planning.ts`
- `packages/domain/tests/task-run.test.ts`
- `packages/contracts/src/creative-planning.ts`
- `packages/contracts/src/delivery-preflight.ts`
- `packages/contracts/tests/contract-export.test.ts`
- `contracts/openapi.json`
- `contracts/openapi.yaml`
- `contracts/platform-contracts.schema.json`
- `packages/persistence/src/schema.ts`
- `packages/persistence/drizzle/0024_romantic_reaper.sql`（Drizzle 生成的下一序号迁移）
- `packages/persistence/drizzle/meta/0024_snapshot.json`
- `packages/persistence/drizzle/meta/_journal.json`
- `packages/persistence/tests/schema-contract.test.ts`
- `apps/workflow-worker/src/index.ts`
- `apps/workflow-worker/src/execution-service.ts`
- `apps/workflow-worker/tests/execution-service.test.ts`
- `packages/persistence/src/creative-planning-repository.ts`
- `packages/persistence/tests/creative-planning-repository.test.ts`
- `apps/studio-web/app/components/studio/StoryPlanningPanel.vue`
- `apps/studio-web/app/pages/projects/[project_id].vue`
- 本文档和本章审计记录条目

## 8. 实施证据与当前审计申请

本章实现状态为 `IMPLEMENTED_PENDING_AUDIT`，现提交 `READY_FOR_AUDIT` 申请；不宣称 `ACCEPTED`。所有操作均为本地文件、无网络/真实 Provider/Veyra/VPS/Git 调用，且保留工作区既有用户改动。

### 8.1 行为与来源映射

- `packages/creative-planning/src/index.ts`：内部 `PlanningInput.durationPolicy` 接入现有 planner；目标不超过 profile max 时普通内容单段精确；默认 Huobao `8..15` 的显式跨场景在 `target=15` 无法形成两个合法段时保留边界并经既有 domain invariant fail-closed；Grok `1..15` 普通短目标 `1/6/7/8/15` 各为一个精确段。口播仍沿用原 capacity gate，短目标无法容纳时拒绝，不拉伸/补长。
- `packages/domain/src/creative-planning.ts`：`assertStoryboardPlan` 保留默认 Huobao `8..15`，只在内部显式 policy 下允许 `1..15`。
- `apps/workflow-worker/src/execution-service.ts` 与 `src/index.ts`：`resolvePlanningDurationPolicy` 只读取既有 `resolveVideoProviderRuntimeProfile` 的 `mode`；`sub2api` 返回 `1..15`，`mock`/缺省返回默认策略（不假称 Grok）。
- contracts/persistence/UI：公共 target 下限按冻结决策由 `15` 对齐为 `1`，shot duration 由 `8` 对齐为 `1`，max 保持 `15/600`；迁移仅替换两个 target check；UI 输入、估算和提交前校验使用 `1` 下限。

### 8.2 定向验证

- `pnpm --filter @alchemy-video/creative-planning test`：`58 pass / 0 fail / 0 skip`；包含 Grok `1/6/7/8/15` 单段、默认 Huobao `16=8+8`、`17=9+8`、`30=15+15`、默认显式跨场景 `15` 与 `7` fail-closed、短口播容量拒绝。
- `pnpm --filter @alchemy-video/domain test`：`58 pass / 0 fail`。
- `pnpm --filter @alchemy-video/contracts test`：`40 pass / 0 fail`；并已运行 `pnpm contracts:generate` 对齐 JSON/YAML/schema 导出。
- `pnpm --filter @alchemy-video/persistence typecheck`：通过；`pnpm --filter @alchemy-video/persistence exec tsx --test tests/schema-contract.test.ts`：`21 pass / 1 existing skip / 0 fail`。
- `pnpm --filter @alchemy-video/workflow-worker test`：`19 pass / 0 fail / 0 skip`；包含 `resolveVideoProviderRuntimeProfile("sub2api") -> 1..15`、`"mock"`/缺省保持默认以及未知值由既有 resolver 拒绝。
- `pnpm --filter @alchemy-video/persistence exec tsx --test tests/creative-planning-repository.test.ts`：`7 pass / 0 fail / 0 skip`；包含 Workflow policy 到最终 storyboard 校验的 6 秒单段回归。
- `pnpm --filter @alchemy-video/persistence typecheck`：通过；`workflow-worker` 的 pretest build 验证了更新后的 persistence 类型。
- `pnpm --filter @alchemy-video/studio-web test`：`41 pass / 0 fail / 0 skip`。
- `git diff --check`：无新增 whitespace error（仅保留工作区既有换行提示）。

### 8.3 未闭合项

独立审计尚未完成，故不标记 `ACCEPTED`。真实 Provider/profile 能力认证、计费、部署、网络调用均不在本章范围；生成迁移与导出 artifacts 需由审计员复核只包含目标时长下限扩展，无关工作区改动不属于本章。
