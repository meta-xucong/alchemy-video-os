# AI 企业内容生产平台：LLM 跨层侧车行为与发布验收开发文档

> 文档状态：`READY_FOR_AUDIT`（本窄片 PostgreSQL 跨层行为证据已补齐；未标记 `ACCEPTED`，正式总账仍保持 E12/R01 `BLOCKED` 与 C12.4/C12.5 `IMPLEMENTED_PENDING_AUDIT`）
>
> 关联方案：`AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md`。
> 本文只补齐该方案尚缺的跨层可观察证据和发布门槛，不重新设计 LLM 输出、分段、时长、压缩、Provider、计费或部署逻辑。

## 1. 用户目标与本轮边界

用户要求按既定思路继续完善：LLM 负责自然语言视觉创作，原提示词中明确的口播由现有 source parser/compiler 一字不差保留；完成开发文档、独立审计、代码/测试，并在满足正式门槛后再评估 GitHub/VPS。

本轮只处理三项：

1. 证明现有 `source_prompt/generated_prompt_parts` sidecar 从 Workflow 经过 PromptPackage 持久化、ProductionRun scheduler、production-worker snapshot 到 runtime 的真实传递；
2. 补齐该链路的错误/重启/幂等行为证据，不能用静态源码命中替代；
3. 固化一次真实 LLM 规划 smoke 和人工验收的证据格式，但不把真实调用塞进普通 CI，也不凭一次成功升级全平台状态。

明确不做：

- 不改变公开 API、contracts、数据库表结构、事件、任务状态、权限、计费或 Provider 协议；
- 不让 LLM 决定 segment 数、duration、reference 顺序或口播文本；
- 不新增评分、相似度阈值、重试、自动修复、静默 fallback、截断、时长补偿或第二条规划路径；
- 不调用真实 Provider/TTS/VPS，不修改 `.codex-longrun/state.json`，不执行 Git 操作；
- 不借本轮证据关闭 E12/R01 或宣称整体 C12.4/C12.5 已接受。

## 2. 基线、状态与来源规则

- 代码基线：`e3c078e7fef6c7a2050b946b854f36569ea7d4af` 加工作区已有 dirty baseline；已有改动不回滚、不覆盖、不冒充本轮成果。
- 正式状态保持 `.codex-longrun/state.json`：`E12/R01=BLOCKED`，总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT`。
- 复用来源和创意/口播边界以《AI企业内容生产平台_LLM自由创作与口播保真最小适配开发文档.md》及其固定 Huobao、Seedance、OpenMontage 映射为准；本轮不声称上游提供通用 LLM planner 或跨层 sidecar。
- 协作契约：`CONTRACT_REV=v1.3.1-route-guard`，`COMPLEXITY_GATE=ESCALATE_REQUIRED`，唯一写入者为 executor，独立审计者不得修改送审对象。

## 3. 现状缺口与目标证据

现有代码已经有以下路径：

`creative-planning` 生成 capability snapshot → `workflow-worker` 携带 PromptPackage → `persistence` 写入 JSONB → `scheduleEligibleSegments` 读取 → `production-worker/video-input-snapshot` 传给 runtime-profile。

当前缺口不是静态代码，而是缺少一条可复核的数据库/调度行为测试，证明以下不变量在同一运行中成立：

- `source_prompt` 与 `generated_prompt_parts` 经过 JSONB 持久化后仍是原文本和原数组顺序；
- scheduler 创建的 `taskRuns.inputSnapshot` 将 sidecar 原样传给生产 snapshot factory；
- factory/runtime 对超限、sidecar 不匹配和非法输入按既有错误码 fail-closed；
- Worker 重启/恢复或同一事件重放不重复提交 Provider；
- 旁白/参考图/计费/公开契约语义不因 sidecar 适配发生变化。

## 4. 最小实施方案

### 4.1 持久化/调度行为 fixture

在现有 `packages/persistence/tests/production-repository.integration.test.ts` 的 PostgreSQL integration 范围内增加最小 fixture，复用现有 `DrizzleControlPlaneRepository`、`DrizzleCreativePlanningRepository`、`DrizzleProductionRepository`、`createDatabase` 和已有事件构造器：

1. 创建一个包含多行中文口播、`@anchor`、ASCII 引号和两段 `generated_prompt_parts` 的 PromptPackage；
2. 通过现有 planning repository 写入，而不是直接绕过 repository 写表；
3. 确认 production run，拦截既有 `createTaskRunInputSnapshot` 注入点，记录传入的 `sourcePrompt/generatedPromptParts`；
4. 触发 `initializeProductionRun`/`resumeProductionRun`，断言数据库读取后的 snapshot 输入与原 sidecar 完全一致；
5. 模拟恢复/事件重放，断言同一 `provider_request_id` 语义不产生第二次 submit；
6. 使用既有 `PROMPT_BUDGET` 和 `UnsupportedVideoGenerationInputError` 边界，断言段状态为非 retryable FAILED、ProductionRun 收口 BLOCKED；其它 `UnsupportedVideoGenerationInputError` 仍不得被伪装成预算错误。

测试必须在 `DATABASE_URL` 存在时实际运行；缺少本地数据库只能保留 `skip` 并记录为 `EVIDENCE_INSUFFICIENT`，不能把 skip 当通过。

### 4.2 真实 LLM smoke（普通 CI 之外）

只复用已经存在的 `SEMANTIC_PLANNER_*` OpenAI-compatible client 和用户已配置的 LLM，不新增 key、endpoint 或协议。固定样本至少包含：多行中文口播、两张以上参考图绑定、一个含 ASCII 引号的视觉事实。记录脱敏后的：

- 请求 profile、调用时间和响应状态；
- `segments` 数量/顺序、每段 `visual_prompt` 是否非空；
- 口播原文 hash/文本比对结果、reference 顺序和最终 prompt byte 数；
- 非法/超时响应是否按 `LLM_PLANNER_MALFORMED` 或 `LLM_PLANNER_UNAVAILABLE` fail-closed。

真实 smoke 不进入普通 CI，不作为 Provider 成功或中文听感验收；没有用户明确授权或 LLM 配置不可用时保持 `BLOCKED`。

### 4.3 人工验收记录

真实视频生成必须在跨层 fixture 通过后另行授权。固定“保险AI介绍”样本，人工只验收：口播字词、段落归属、参考图顺序、画面/台词匹配和字幕开关。人工记录不能反向修改 schema、补写自动阈值或替代数据库行为证据。

## 5. 允许修改的文件与唯一写入边界

- 允许：本文件；`packages/persistence/tests/production-repository.integration.test.ts`；必要的现有 workflow/production 测试夹具；章节/任务记录中的本轮证据文字。
- 仅在测试暴露真实实现缺口且能指向现有契约时，才允许修改对应内部实现；不得新增公开字段或数据库列。
- 禁止：`packages/contracts` 公共结构、Provider adapter/runtime-profile、前端、VPS/deploy、计费、真实 Provider/TTS、状态账本和 Git。

## 6. 审计 Exit Gate

审计者必须针对冻结版本给出“符合 / 不符合 / 证据不足”，逐项检查：

1. DB→scheduler→factory→runtime sidecar 有真实行为证据，而非静态命中；
2. 多行口播、引号、anchor、参考图顺序和 sidecar 原序未改变；
3. 预算错误使用既有 `PROMPT_BUDGET`，不扩大 `UnsupportedVideoGenerationInputError` 语义；
4. 重启/重放/幂等没有重复 Provider submit；
5. 无新算法、阈值、协议、fallback、自动改写或公开契约变化；
6. 本地测试、typecheck、diff 检查绑定最终版本，skip 和外部未测边界如实保留。

本轮窄片在数据库行为证据补齐并经独立审计后可保持 `READY_FOR_AUDIT`；只有正式账本允许且独立审计确认 `ACCEPTED` 后，才可讨论 GitHub/VPS。真实 LLM smoke 或人工验收缺失时，整体 LLM 生产验收仍必须保持 `EVIDENCE_INSUFFICIENT/BLOCKED`，不影响本窄片的跨层 READY 结论。

## 7. 交付记录模板

```text
任务 ID：LLM-CROSS-20260914
CONTRACT_REV：v1.3.1-route-guard
COMPLEXITY_GATE：ESCALATE_REQUIRED
唯一写入者：executor（persistence integration + 指定测试夹具）
AUDIT_OWNER：independent-auditor
状态：DESIGN_DRAFT → IMPLEMENTED_PENDING_AUDIT → READY_FOR_AUDIT（不得直接 ACCEPTED）
GitHub/VPS：只有正式 ACCEPTED 且工作区可安全分离本轮差异后才允许；否则 BLOCKED
```

## 9. 本轮实现与测试记录（2026-09-14）

- `packages/persistence/tests/production-repository.integration.test.ts` 在既有 C12 PostgreSQL fixture 上补充了 PromptPackage JSONB 的 `source_prompt`/`generated_prompt_parts` 原文与顺序断言，覆盖多行中文、`@anchor` 和 ASCII 引号；同一 fixture 观测 scheduler 传入的 sidecar、写入的 `taskRuns.inputSnapshot.prompt`、初始化重放不重复创建 TaskRun，以及 recovery 后再次保留 sidecar。测试内使用最小可序列化 snapshot capture factory，避免 persistence 反向依赖 `apps/production-worker`；production-worker 真实 snapshot factory 的 compaction 行为仍由其既有 `apps/production-worker/tests/video-input-snapshot.test.ts` 覆盖。
- 既有 `PROMPT_BUDGET` PostgreSQL fixture 继续验证预算失败时段状态为不可重试 `FAILED`、ProductionRun 收口 `BLOCKED` 且不创建 TaskRun；本轮未扩大错误码或重试语义。Provider 已提交后的恢复不重复 submit 证据仍由既有 task-worker C06 recovery 测试覆盖，本轮未新增 Provider 调用。
- 首轮本地环境未运行数据库时，persistence 测试为 `71 pass / 12 skip / 0 fail`；随后复用原本地 PostgreSQL（`127.0.0.1:15432/video_local`）并执行既有迁移，重跑 persistence 全套为 `83 pass / 0 skip / 0 fail`，其中包含本轮 DB→scheduler→snapshot sidecar 真实行为 fixture。
- 数据库恢复后另行复核（当时历史快照）：`pnpm --filter @alchemy-video/creative-planning test` `81/81`、`pnpm --filter @alchemy-video/workflow-worker test` `38/38`、`pnpm --filter @alchemy-video/production-worker exec tsx --test tests/video-input-snapshot.test.ts` `8/8`，全量 `pnpm test` 退出码为 `0`，`pnpm typecheck` 通过，`git diff --check` 通过。上述均为本地 fixture/mock；未调用真实 LLM、Provider、TTS、网络或部署。T06 纠偏后的当前 creative-planning 最终复跑为 `83/83`，见最新 T06 记录。
- 独立审计在真实 PostgreSQL 证据补齐后结论为：本窄片跨层行为 `符合`，可提交 `READY_FOR_AUDIT` 评审；不得标记 `ACCEPTED`，也不得以此关闭 E12/R01 或发布 GitHub/VPS。真实 LLM smoke、Provider/TTS、人工口播验收仍保持未验收边界。
- 继续执行一次受控真实 LLM smoke：临时启用既有 `SEMANTIC_PLANNER_ENABLED=true`，复用仓库外 `.env.local` 中的 `REFERENCE_VISION_*` endpoint/key/model，固定多行中文口播、视觉描述和两个参考 anchor，调用 3 次均返回可解析的 1 段规划（`3/3`）；visual prompt 非空，reference anchor 顺序保持，台词经既有规范化后与两行原文逐字一致。未调用视频 Provider/TTS/Veyra、未产生计费或部署副作用；该结果只证明此固定样本的当前 endpoint smoke，不关闭通用 LLM 稳定性、人工听感或真实视频验收。
