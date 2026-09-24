# AI 企业内容生产平台：反自造语义逻辑台账

版本：`1.5.0`

日期：`2026-09-24`

状态：`READY_FOR_AUDIT`

实现口径：`IMPLEMENTED / LOCAL_TECHNICAL_AND_INFRA_GATES_PASS / EXTERNAL_VALIDATION_PENDING`

## 1. 基线

- 工作区：`D:\AI\alchemy_video_OS`
- 分支：`codex/g01-audit-handoff-20260924`
- 净化后主线基线：`origin/main@1a4d95ba9e79e04540c1f7af61b917053735d1e5`；验收分支：`codex/g01-audit-handoff-20260924`；验收 PR：`https://github.com/meta-xucong/alchemy-video-os/pull/2`。
- 开工时工作区为非干净状态；既有差异已通过安全快照和提交历史保留。当前验收分支以净化后主线为基线，交付前必须保持 clean。
- 开工前定向基线：`378 passed / 17 skipped / 0 failed`。实现方历史隔离基础设施根级回归：`783 passed / 0 skipped / 0 failed`；独立复核人在 `5a9d354` 上当前复跑：`763 passed / 20 skipped / 0 failed`，20 个 skip 主要是 PostgreSQL、Redis/BullMQ、MinIO 环境门。
- Git 边界：已完成审计提交、验收分支推送和 PR 交付；独立验收前禁止 merge、tag 和部署。生产数据库迁移、真实 Provider/TTS/Veyra、VPS 与未授权网络调用继续关闭。

本台账用于定位真实调用入口和处置结果，不把源码命中当作行为证据。每项只有在代码、调用链、负向测试和最终 snapshot 同时通过后才能关闭。

## 2. 分类规则

- `SOURCE_FACT`：原文、精确台词、明确用户设置、已确认资产事实和 Provider 能力事实。
- `LLM_DECISION`：看到完整上下文的 LLM 决定，必须带 evidence refs。
- `PLATFORM_SHELL`：权限、API、队列、持久化、对象存储、校验、幂等、恢复和协议映射。
- `PLATFORM_OWNED`：用户明确授权的能力，目前主要为 BGM 智能匹配。
- `MOCK_ONLY`：测试夹具专用，不得被真实 Worker 依赖。
- `BLOCKED`：无来源、无授权、非必要薄壳的语义逻辑。

## 3. P0 原始基线与处置台账

下表“原始入口/问题”保留开工时审计证据，不表示当前生产调用链仍在使用这些实现。当前生产根导出面与真实 Worker 已完成切换，但整体状态仍为 `READY_FOR_AUDIT`，须由独立审计与真实集成证据决定是否关闭。

| ID | 原始真实入口 | 原始问题 | 已实施处置 | 工作包 |
| --- | --- | --- | --- | --- |
| P0-01 | `DocumentKnowledgeExecutor` 默认 `DeterministicDocumentUnderstandingAdapter` | 关键词类别、数字规则、冲突规则冒充文档理解 | 真实 Worker 只接 LLM analyzer；无配置阻断 | WP-04 |
| P0-02 | Control API/Workflow 默认 `DeterministicFactSelector` | bigram、手工类别权重和固定数量决定相关性 | LLM 返回 evidence refs；平台仅校验预算和引用 | WP-04 |
| P0-03 | `reference-roles.ts`、reference vision analyzer | 关键词、文件名窗口、单图内容推断用户用途 | 用户显式角色优先；其余由全上下文 LLM 决定 | WP-05 |
| P0-04 | `visual-object-locks.ts`、Provider compiler | 固定道具、左右手和 transfer 正则制造事实 | 只消费带 source evidence 的对象决定 | WP-05 |
| P0-05 | Planning/Provider/Persistence/Vue 四套 parser | 同一 source 被反复解释、截断和去重 | 建立 exact dialogue map；下游只按 ID 传递 | WP-06 |
| P0-06 | `provider-video/prompt-compiler.ts` | Provider mapper 承担第二导演 | 改为 provenance allowlist pure projector | WP-08 |
| P0-07 | `runtime-profile.ts` | 超限时删除 source 子句 | 只删可证明 generated parts；否则重规划或阻断 | WP-01/WP-08 |
| P0-08 | Creative Planning 必填 motion schema | 强迫填写不存在的 pose/camera/state/sentinel | 字段可选且带 evidence；旧 schema 只读 | WP-02/WP-08 |
| P0-09 | continuity domain/persistence | 固定修复时长、无产物却 succeeded/ACCEPTED | 无真实 task/asset/QC 不得成功 | WP-01/WP-10 |
| P0-10 | Studio `startAutomatedProduction` | 自动 approve 并代用户选择交付策略 | 显式用户命令；缺决定保持待审批 | WP-01/WP-09 |
| P0-11 | Media Runtime final review | 未检查项写 false/CHECKED | `UNKNOWN/UNAVAILABLE/NOT_CHECKED` | WP-01/WP-10 |
| P0-12 | Media Runtime CLIP 固定类别 | 固定类别冒充 source-relative 语义 QC | 移出验收；语义 QC 使用多模态 LLM | WP-10 |

## 4. P1 优化台账

| ID | 范围 | 目标处置 | 工作包 |
| --- | --- | --- | --- |
| P1-01 | Deterministic planner 与真实模块混放 | 迁入 Mock/fixture 包，真实构建不依赖 | WP-07/WP-11 |
| P1-02 | LLM 结果仍受 scene-change regex 干预 | scene continuity 由 LLM evidence decision 决定 | WP-07 |
| P1-03 | Huobao 8–15 秒被当成 Provider 硬限制 | Provider 认证范围为硬门，Huobao 仅作指导 | WP-07 |
| P1-04 | LLM system prompt 含行业特例 | 删除护肤等样例词，保留跨行业抽象规则 | WP-03 |
| P1-05 | `isPlatformBoundaryShell` 字符串过滤 | 类型化 provenance 取代字符串猜来源 | WP-08 |
| P1-06 | narration 数字/缩写/默认 delivery 改写 | 原文不改；有 glossary/批准才产生 provider text | WP-06 |
| P1-07 | ASR 0.75/0.9/1.15 手工语义阈值 | 只保留原始证据；LLM/人工判断语义 | WP-10 |
| P1-08 | BGM token score 泛化不足 | 授权例外保留迁移期实现，升级 LLM 语义候选 | WP-09 |
| P1-09 | MusicPlan 缺失默认 AUTO | 新命令显式 AUTO/MANUAL/OFF；历史只读兼容 | WP-01/WP-09 |
| P1-10 | 音频参数多层默认漂移 | 单一 source profile，mapper 只传递 | WP-10/WP-11 |
| P1-11 | UI `ceil(duration/15)` 机械预估 | 仅显示能力范围或真实 LLM 计划 | WP-09 |
| P1-12 | preflight 固定预算 0 等伪事实 | 缺事实用 UNKNOWN/BLOCKED，禁止代填 | WP-01/WP-09 |
| P1-13 | reference URL 在 snapshot 后重排 | 建立一次 canonical order，全链复用 | WP-05/WP-08 |
| P1-14 | OpenMontage variation 评分覆盖创作 | 仅 advisory，不自动改写/阻断 | WP-07 |
| P1-15 | ALCHMED1–8 与平行 mixer | 新写单版本，旧 decoder 只读后退役 | WP-11 |
| P1-16 | InMemory/Drizzle 重复语义 | 共享 verifier；repository 只存取/事务 | WP-04/WP-11 |

## 5. 新增代码硬门

任何真实路径新增或修改出现下列内容，默认审计失败：

- 自然语言关键词表、同义词表、行业专用正则；
- semantic score、手工权重、confidence gate 或 unknown→默认类别；
- source prose 二次解析、摘要、截断、重排或静默改写；
- 未经用户选择的 AUTO、approve、voice、caption、budget 或 tolerance；
- 未执行即 succeeded/ACCEPTED，未检查即 PASS/CHECKED/false；
- 为满足非空 schema 新增 sentinel；
- Mock semantic fixture 被真实 Worker 导入；
- 缺少 source/upstream/Provider/用户授权映射的生成 prose。

允许的确定性代码仅限：ID、SHA、URL、MIME、数字、时间、顺序、范围、状态机、幂等、作用域、资源上限和已认证 Provider 协议。

## 6. 工作包状态

`IMPLEMENTED` 仅表示相应代码与本地技术门禁已完成，不是 `AGENTS.md` 中的正式章节 `ACCEPTED`。G01 当前正式状态统一为 `READY_FOR_AUDIT`；下表数字默认是各包实施时的历史证据。实现方曾在完整隔离基础设施环境中得到 `783/0/0`，独立复核人在当前未配置全部服务的环境中得到 `763/20/0`；二者必须分列，20 个环境门 skip 不计作通过。任何数字都不能替代真实 LLM/Provider、真实媒体语义、人工质量、生产历史盘点和独立审计。

| 工作包 | 实现状态 | 本地技术证据 |
| --- | --- | --- |
| WP-00 | `IMPLEMENTED` | P0=12、P1=16；总控/ADR/章节账本交叉引用；`git diff --check=0` |
| WP-01 | `IMPLEMENTED` | 止血项完成；672 passed / 13 skipped / 0 failed；`git diff --check=0` |
| WP-02 | `IMPLEMENTED` | Canonical Source Bundle、EvidenceRef、Semantic Director Decision 契约；48 passed / 0 failed；build 与 diff check 通过 |
| WP-03 | `IMPLEMENTED` | Canonical builder、provenance/结构 checker、ProvenanceCheckedSemanticDirector、OpenAI-compatible client；Contracts 49 + Planning 100 + Workflow 43 全通过 |
| WP-04 | `IMPLEMENTED` | Structural index only；真实入口无 deterministic 文档分类/事实排名；247 pass / 13 skip / 0 fail；5 包 typecheck 与 diff check 通过 |
| WP-05 | `IMPLEMENTED` | 参考图客观分析与用途解耦；直生成只信显式 binding；自动生产消费带不可变引用的 Semantic Reference Projection；canonical order 全链路冻结；527 pass / 18 skip / 0 fail |
| WP-06 | `IMPLEMENTED` | exact dialogue 由 Semantic Director 单一拥有；Provider/Control API/Composition 不再重解析真实 brief prose；Mock 与历史读取明确隔离；504 pass / 18 skip / 0 fail |
| WP-07 | `IMPLEMENTED` | 真实分段、时长、视觉表达与参考用途来自 LLM decision；平台仅校验 provenance/结构且不证明语义正确或完整覆盖；真实 Worker 不实例化 deterministic planner/compiler；504 pass / 18 skip / 0 fail |
| WP-08 | `IMPLEMENTED` | 生产创作字段可选、生产导出面无 sentinel；Mock 专用占位值位于显式 mock 子路径；Provider compiler 为 pure projector；原始 source 冻结/hash 可追踪，Provider visual prompt 是 LLM 投影，exact dialogue/reference/caption 超限直接 PROMPT_BUDGET；504 pass / 18 skip / 0 fail |
| WP-09 | `IMPLEMENTED` | 新命令显式要求分镜/交付/音乐决定；Studio 两次独立人工确认；无自动审批、无隐式 AUTO、无伪 budget=0；整套 BGM 匹配登记为用户授权 PLATFORM_OWNED；278 pass / 13 skip / 0 fail |
| WP-10 | `IMPLEMENTED` | 无真实 evaluator 时连续性保持 UNAVAILABLE 且零 repair/frame work；无伪 succeeded/ACCEPTED；Final Review 未检查项=null/UNAVAILABLE，固定 CLIP 与手调台词阈值不参与验收；393 pass / 12 skip / 0 fail，另 7 subtests pass |
| WP-11 | `IMPLEMENTED` | 真实 Worker 只加载 semantic-only 子入口；deterministic planner/compiler 与 reference/object/narrative heuristics 迁入显式 mock 子路径，仍为 Mock/历史兼容存在；文档关键词/二元词/评分器及 legacy fact store 从生产实现删除；固定 CLIP/台词阈值退役；新 DeliveryPlan 只写完整 AudioPlan/ALCHMED8，ALCHMED1-7 只读并等待授权盘点；定向门通过 |
| WP-12 | `IMPLEMENTED` | 实现方历史全基础设施证据：根级 `783 pass / 0 skip / 0 fail`；独立复核 `5a9d354` 当前证据：`763 pass / 20 skip / 0 fail`，20 skip 为 PostgreSQL、Redis/BullMQ、MinIO 环境门。Media Runtime `152 pass + 7 subtests`，typecheck/build/secret scan/diff check 通过；真实 LLM/Provider、VPS、成片语义 QC、人工质量和生产历史盘点仍缺证据，不构成平台验收 |

每个工作包完成后必须记录修改文件、定向命令、通过/失败/跳过数量、代码审计结论、残余风险和下一包准入，不允许批量回填虚假通过。

## 7. 安全与验收交付对账

- 旧主线提交 `36a7ceba08f2c62fbf9f78e77e56c6973ce5f07c` 曾错误跟踪本地启动脚本并包含外部凭据；原验收 PR #1 已关闭。
- 净化后主线 `1a4d95ba9e79e04540c1f7af61b917053735d1e5` 保留业务改动、移除该脚本并加入精确忽略规则；审计分支已重放到该基线。
- 当前树和验收差异不保存原始凭据；完整处置及外部轮换责任见 `AI企业内容生产平台_20260924凭据暴露处置记录.md`。
- `origin/codex/backup-20260919-snapshot@12446154` 是与 `main`/PR #2 无共同祖先的孤立 WIP 文件快照，包含尚未逐项确认可删除的独有内容，故明确保留为非验收归档；不得作为基线、不得直接合并，删除需仓库所有者确认。PR #2 仍是唯一验收入口。
- 仓库历史净化不等于凭据吊销。外部账号所有者必须完成密钥轮换与用量日志复核，验收同事应检查轮换证明。
- ALCHMED 生产历史只读盘点未越权执行；执行 runbook 已完整落盘，可在取得授权后由生产管理员运行。
- 非测试工作已经完成，剩余项只属于独立审计、真实环境、生产数据或人工质量证据。
