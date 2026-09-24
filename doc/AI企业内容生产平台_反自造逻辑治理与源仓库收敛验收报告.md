# AI 企业内容生产平台：反自造逻辑治理与源仓库收敛本地技术验证及待审计报告

版本：`1.4.0`

日期：`2026-09-24`

状态：`ACCEPTED_WITH_EXTERNAL_GATES`

实现口径：`IMPLEMENTED / LOCAL_TECHNICAL_AND_INFRA_GATES_PASS / EXTERNAL_VALIDATION_PENDING / NOT_DEPLOYED`

主执行方案：`AI企业内容生产平台_反自造逻辑治理与源仓库收敛完整优化方案.md`

## 1. 当前结论

WP-00 至 WP-12 已完成代码实现、本地技术门禁和隔离基础设施集成回归。独立审计已将 G01 按范围限定收口为 **`ACCEPTED`**；该结论只覆盖本地反自造语义治理与单一语义所有权边界，不等于平台生产可用或部署授权。

当前可以确认：

- 真实 Worker 使用 LLM Semantic Director；平台 deterministic checker 只校验 provenance、结构、顺序、范围与协议硬边界；
- deterministic planner/compiler 与 reference/object/narrative heuristics 位于显式 Mock 子入口，生产根导出面不可见；
- 文档关键词分类、二元词评分和固定事实 selector 已退出生产实现；
- 用户授权的 BGM 智能匹配已明确标记为 `PLATFORM_OWNED`；
- 实现方历史上已在隔离本地 PostgreSQL、Redis/BullMQ、MinIO 环境中完成 SSE、Worker 重启恢复等行为回归；当前独立复跑未配置这些服务，因此对应 20 项保持 skip；
- 实现方历史全基础设施回归、独立复核当前环境回归、Media Runtime、typecheck、build、secret scan 和 diff check 均有通过证据；历史 `783/0/0` 与当前独立复跑 `763/20/0` 必须分列，不能互相覆盖。

当前不能确认：

- LLM 的 `visual_decision` 是否语义正确，或是否完整覆盖原始 source；
- 真实 Semantic Director、真实视频 Provider、真实 Pixabay、VPS 与线上运行是否可靠；
- 实际媒体产物是否满足 source-aligned 多模态语义 QC、对白听感和人工质量；
- ALCHMED1–7 线上历史数据已完成数量盘点、迁移或安全删除；
- PR #2 是否已获得最终独立验收决定、是否适合合并或部署；当前仅完成复核意见回填，正式状态仍为 `READY_FOR_AUDIT`。

本轮没有调用真实 LLM/视频 Provider/Pixabay/Veyra，没有修改生产数据库，没有操作 VPS，也没有合并、tag、发布或部署。Git 仅用于净化主线、提交审计修正、推送验收分支和维护 Draft PR #2。

## 2. 独立复审八项问题处置

| # | 复审问题 | 当前处置 | 审计口径 |
| --- | --- | --- | --- |
| 1 | `PLATFORM_OWNED_*` sentinel 仍写入正式规划对象 | 生产代码与真实 Worker 路径已清除该 sentinel；Mock 专用规划使用显式 `__MOCK_UNSPECIFIED_*` 占位，仅用于测试闭环 | 生产路径闭合；不宣称所有测试夹具都没有 Mock 占位 |
| 2 | deterministic planner 未物理移除 | planner/compiler 已迁至 `@alchemy-video/creative-planning/mock`；Workflow 的 deterministic 装配集中于 `src/mock/bootstrap.ts`，仅在 runtime profile 明确为 `mock` 后动态加载 | 可以说“真实入口物理隔离”，不能说“全仓删除” |
| 3 | “source byte-for-byte 保留”表述过强 | 原始 source 在 `CanonicalSourceBundle` 中冻结并 hash；exact dialogue 与 source span 逐字一致；Provider visual prompt 使用 LLM `visual_decision` | 统一表述为“source 可追踪、台词逐字、视觉 prompt 为语义投影” |
| 4 | verifier 不能证明视觉语义正确 | 名称和文档改为 `ProvenanceCheckedSemanticDirector` / `verifySemanticDirectorProvenance`；checker 只校验 schema、identity、hash、span、顺序、时长和 Provider 硬限制 | 只称 `evidence-referenced/provenance-checked`，不称语义已证明 |
| 5 | 旧关键词/对象推断代码仍存在 | 旧 reference/object/narrative heuristics 位于 `@alchemy-video/domain/mock-heuristics`，生产根不导出，真实调用扫描和负向测试均为零 | 明确为 Mock/历史兼容，不宣称全仓删除 |
| 6 | 状态账本冲突和 `非正式离线接受` 非正式状态 | 主方案、台账、验收报告、正式总控、ADR-0071/0073/0074 和章节审计统一为 G01=`ACCEPTED`（仅范围限定）；WP 仅为 `IMPLEMENTED / LOCAL_TECHNICAL_GATE_PASS` | E12/R01 与 C12.4/C12.5 既有阻断/待审计状态保持不变 |
| 7 | 缺 PostgreSQL/Redis/MinIO 跨层证据 | 实现方历史上使用独立临时 PostgreSQL DB、Redis DB 15 和本地 MinIO 完成根级集成回归，结果 `783/0/0`；独立复核人在 `5a9d354` 当前环境复跑为 `763/20/0`，20 skip 为未配置环境门 | 历史全基础设施证据与当前复跑证据分列；skip 不计通过，真实外部系统和生产质量仍未闭合 |
| 8 | Media Runtime 测试命令工作目录不完整 | 正式命令固定先进入 `services/media-runtime`，再运行 compile 与 pytest | 正确目录下 `152 passed / 0 failed`，另 `7 subtests passed` |

## 3. 最终架构边界

### 3.1 真实语义链

真实创作链统一为：

```text
Source text + complete documents + canonical references + user decisions + provider capability
  -> CanonicalSourceBundle
  -> Semantic Director (LLM)
  -> evidence-referenced SemanticDirectorDecision
  -> deterministic provenance/structure checker
  -> pure persistence / provider projection / media execution
```

原始 source 在 CanonicalSourceBundle 中冻结并哈希；exact dialogue 与 source span 逐字一致。最终 Provider 视觉 prompt 使用 LLM 的 `visual_decision` 投影，而不是原始 source 的 byte-for-byte 副本。

provenance checker 可以证明：

- 引用身份、SHA 和作用域存在且一致；
- source span/quote 与 exact dialogue 一致；
- reference identity 与 canonical order 一致；
- segment 顺序、总时长和 Provider 硬边界合法；
- BLOCKED/READY 结构满足契约。

provenance checker不能证明：

- `visual_decision` 必然由所引证据语义推出；
- 每一条 source 事实都已被视觉 prompt 覆盖；
- LLM 没有遗漏隐含约束；
- 成片实际符合文本、参考图、动作终点或审美目标。

上述语义与成片质量仍属于真实 LLM、多模态 QC 和人工验收边界。

### 3.2 真实链禁止项

真实链不再允许：

- 文档关键词分类、固定营销类别或二元词评分；
- 手工 rank、固定权重和固定 24/12/8 条事实选择；
- 依据文件名、附近文字或画面主体自动决定参考图用途；
- Provider compiler 二次解析台词、对象、左右手、转移动作或镜头；
- source 超限时删句、摘要、截断或静默改写；
- 缺少证据时填 `PLATFORM_OWNED_*` sentinel；
- 无 LLM 时回退 deterministic planner；
- 未检查即 PASS/CHECKED/false，未执行修复即 succeeded/ACCEPTED。

### 3.3 平台薄壳

保留且通过回归的必要能力包括：

- 身份、权限、Control API、workspace/project scope；
- Queue/Worker、outbox、幂等、重试、恢复和 dead-letter；
- PostgreSQL persistence、事务、唯一约束和状态机；
- Redis/BullMQ 至少一次投递和重启恢复；
- MinIO、relay、MIME、SHA、大小、ffprobe 和技术 QC；
- Provider submit/poll/download、错误归一化和能力边界；
- canonical reference order、PromptPackage provenance sidecar；
- OpenMontage 可追溯的 cut/mix/duck/loudness/单曲路径；
- 用户明确选择后的字幕、声音、口型、时长和音乐策略。

### 3.4 用户授权的 BGM 例外

以下整套能力明确归属 `PLATFORM_OWNED / USER_AUTHORIZED`：

- `musicMetadataTokens`；
- 内容命中；
- duration-fit；
- 标签优先；
- `scoreMusicAsset`；
- `selectAutoMusicAsset`；
- 稳定 SHA tie-break。

它们不属于 OpenMontage、Pixabay、Huobao 或 Seedance 原生推荐算法。新任务只有在用户显式选择 `AUTO` 后运行；`MANUAL` 和 `OFF` 不触发自动匹配或 Pixabay fallback。

## 4. 主要处置结果

### 4.1 文档理解

- 删除生产路径中的 deterministic document analyzer、category rules、bigram/token scoring、rank 和固定条数 selector；
- Production 包只保留 bounded read、标题、表格、视觉不可读提示、locator 和 SHA；
- 完整资料与当前任务一起交给 Semantic Director；
- 资料中的 prompt injection 只作为原始数据，不执行。

### 4.2 参考图与对象

- 图片客观观察与“用户想让图片控制什么”完全解耦；
- 用途由看到全部图片、用户说明和完整任务的 Semantic Director 决定；
- Prompt 编号、asset ID、role、relay URL 与 Provider URL 使用同一 canonical order；
- snapshot 后不再按 SUBJECT/SCENE/STYLE 二次排序；
- 旧 role/object/narrative heuristics 仅在显式 Mock/历史兼容入口存在，生产根导出面不可见。

### 4.3 台词、分段与 Prompt

- exact dialogue 由 Semantic Director 单一拥有，带 source span，并由平台逐字校验；
- 下游按 ID 和 exact text 传递，不重新解析 prose；
- 分段、时长、可见动作、镜头和引用关系来自 LLM decision；
- Provider compiler 为 pure projector；
- prompt 超限时只可删除 provenance 明确的平台生成部分；不可安全容纳时返回 `PROMPT_BUDGET`。

### 4.4 用户决定

- Studio 自动规划只到 storyboard review；
- 用户显式确认分镜后才创建交付计划；
- 用户显式确认交付策略与音乐模式后才创建 production run；
- 缺失 `music_plan.mode`、交付策略或审批均 fail-closed；
- 不再自动 approve、默认 AUTO 或使用伪 `budget=0`。

### 4.5 连续性、媒体和 QC

- 未配置真实 handoff evaluator 时记录 `UNAVAILABLE`，不读取边界帧、不创建 repair；
- BLEND/BRIDGE 只是 review recommendation，不等于执行成功；
- fixed CLIP category 和手调 transcript overlap 不再参与语义验收；
- 未执行 overlay/asset/text 检查保持 `null`；
- promise preservation、runtime swap、silent downgrade 无证据时为 `UNAVAILABLE/null`；
- 容器、时长、分辨率、音轨、静音、响度、SHA 等客观技术 QC 继续执行。

### 4.6 Mock 与历史兼容

- Mock executor/client 位于 `apps/workflow-worker/src/mock`；
- deterministic planner/compiler 位于 `@alchemy-video/creative-planning/mock`；
- 关键词/对象/换手启发式位于 `@alchemy-video/domain/mock-heuristics`；
- 只有明确 mock runtime 分支才动态加载 `src/mock/bootstrap.ts`；
- 新 DeliveryPlan-backed 合成只写完整 AudioPlan/ALCHMED8；
- ALCHMED1–7 只读保留，删除等待生产数据盘点和迁移证据。

## 5. 通用性与负向回归

新增离线用例覆盖：

| 类型 | 验证重点 |
| --- | --- |
| 商品广告 | 不补写功效、人物或结果 |
| 人物剧情 | 保留动作与因果，不机械均分 |
| 工业流程 | 保留操作顺序与可见终点 |
| 教育说明 | 英文源文本和科学事实可表达 |
| 金融/法律 | 不添加预测、收益或承诺 |
| 抽象艺术 | 中英混合、无人物/产品约束 |
| 反直觉参考图 | 人物照片可只作 STYLE，不按画面主体重分类 |
| 混合语言台词 | exact text 和顺序逐字保留 |
| 文档提示注入 | 注入文本保持 inert data，只引用可验证事实 |
| 生产根导出面 | 不暴露 Mock planner/compiler 或旧 heuristics |
| Workflow 组合根 | 不出现 deterministic 类名，只在 mock 后动态加载 bootstrap |

这些用例证明当前 deterministic checker、包导出和装配边界不依赖新的行业关键词；它们不证明真实 LLM 在对应行业中的语义正确性，也不替代成片 QC 与人工审阅。

## 6. 本地基础设施集成证据

### 6.1 隔离方法

- PostgreSQL：创建独立临时数据库，不使用现有项目数据库；
- Redis：使用独立 DB 15；
- MinIO：使用本地测试 bucket 和随机对象 key；
- 测试结束后删除临时数据库并终止其残留连接；
- 测试结束后清空 Redis DB 15，并确认 `DBSIZE=0`；
- 未触碰生产数据库、VPS 或线上对象存储。

### 6.2 分包行为证据

| 范围 | 结果 |
| --- | ---: |
| Persistence + PostgreSQL migration/repository | `104/104` |
| Redis/BullMQ queue | `1/1` |
| MinIO storage | `1/1` |
| Task Worker（含 restart/recovery） | `54/54` |
| Control API（含 PostgreSQL SSE） | `95/95` |

上述分包均为 `0 skipped / 0 failed`。

### 6.3 根级带基础设施回归

在临时 PostgreSQL 数据库、Redis DB 15 和本地 MinIO 均可用的条件下执行：

```powershell
pnpm test
```

结果：

```text
783 passed
0 skipped
0 failed
exit code 0
```

该结果闭合了本地 PostgreSQL、Redis/BullMQ、MinIO、SSE 和 Worker 重启恢复证据；它不替代真实 LLM/Provider、VPS、真实成片和人工质量验收。

### 6.4 PR #2 独立复跑证据（`5a9d354`）

独立复核人在当前环境实际得到：

- 根级测试：`763 passed / 20 skipped / 0 failed`；
- 20 个 skip 主要是 PostgreSQL、Redis/BullMQ、MinIO 环境门，未按行为通过计；
- `pnpm typecheck`：通过；
- `pnpm build`：通过，仅有既有 Nuxt `DEP0155` 警告；
- Media Runtime：`152 passed / 0 failed`，另 `7 subtests passed`；
- secret pattern 扫描与 `git diff --check`：通过。

本节是当前独立复跑事实。第 6.1–6.3 节的 `783/0/0` 是实现方此前在完整隔离基础设施可用时取得的历史证据，不能写成独立复核本轮复跑结果，也不应被当前未配置服务产生的 20 个 skip 抹掉。

独立复核执行 `contracts:generate` 后，`contracts/openapi.json`、`contracts/openapi.yaml`、`contracts/platform-contracts.schema.json` 一度显示为工作区修改；逐文件 `git hash-object` 与 `HEAD:<path>` 完全一致且 `git diff` 为空，属于生成器触发的文件状态/换行元数据变化，不是合同内容变更。交接修正时已恢复为 clean。

## 7. 最终测试证据

### 7.1 实现方历史全基础设施运行（存档证据）

| 项目 | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| Studio Web | 43 | 0 | 0 |
| Contracts | 49 | 0 | 0 |
| Reference Delivery | 3 | 0 | 0 |
| Storage Client | 8 | 0 | 0 |
| Credit Veyra | 21 | 0 | 0 |
| Document Intelligence | 2 | 0 | 0 |
| Domain | 72 | 0 | 0 |
| Provider Video | 72 | 0 | 0 |
| Reference Analysis | 2 | 0 | 0 |
| Task Queue | 1 | 0 | 0 |
| Creative Planning | 109 | 0 | 0 |
| Persistence | 104 | 0 | 0 |
| Sub2API Certifier | 15 | 0 | 0 |
| Control API | 95 | 0 | 0 |
| Document Worker | 12 | 0 | 0 |
| Production Worker | 74 | 0 | 0 |
| Task Worker | 54 | 0 | 0 |
| Workflow Worker | 47 | 0 | 0 |
| **合计** | **783** | **0** | **0** |

该表属于实现方历史完整基础设施运行，不是独立复核人在 `5a9d354` 当前环境的复跑明细；当前独立复跑总数以第 6.4 节 `763/20/0` 为准。

### 7.2 Python Media Runtime

必须从 `services/media-runtime` 目录执行：

```powershell
Set-Location D:\AI\alchemy_video_OS\services\media-runtime
uv run python -m py_compile runtime.py main.py
uv run --with pytest python -m pytest -q tests/test_runtime.py adapters/openmontage_audio/test_adapters.py
```

结果：

- Python compile：通过；
- `152 passed / 0 failed`；
- 另 `7 subtests passed`。

直接在仓库根目录运行上述 pytest 文件会因本地 `main`/`runtime` 模块路径导致 collection error；该错误不是有效测试结果。

### 7.3 其它门禁

- `pnpm contracts:generate`：通过；
- Contract drift：通过；
- `pnpm typecheck`：18 个 workspace 项目全部通过；
- `pnpm build`：全部通过；
- Nuxt 仅出现依赖自身既有 `DEP0155` warning；
- `git diff HEAD --check`：退出码 0；
- production root export/import 负向测试：通过；
- Workflow real composition root 负向测试：通过；
- 生产代码无 `PLATFORM_OWNED_*`、旧 director 命名或隐式 deterministic fallback。

## 8. 尚未闭合的外部与质量证据

以下内容明确没有执行，不能补写成已完成：

1. 真实 Semantic Director / LLM 调用与语义正确性评估；
2. 真实视频 Provider 生成与费用/恢复验证；
3. 真实 Pixabay 网络查询或下载；
4. VPS 部署、线上配置和健康检查；
5. 真实媒体产物的 source-aligned 多模态 QC；
6. 台词听感、节奏、审美和人工质量验收；
7. ALCHMED1–7 生产历史数量、最后访问时间和迁移可行性只读盘点；
8. 已暴露外部凭据的吊销/轮换、用量日志复核及轮换证明；
9. 独立代码审查和正式验收签字。

历史 ALCHMED decoder 继续保留不是实现失败，而是数据安全门：没有生产盘点和迁移证据时不得删除。生产盘点的字段、执行步骤、决策矩阵、迁移规则和回滚流程已经落入 `AI企业内容生产平台_ALCHMED历史兼容盘点与退役清单.md`；本轮不越权访问生产数据。

## 9. 非测试工作收口与交付状态

截至 2026-09-24，除必须由真实环境、外部账号或独立人员完成的验证外，非测试工作已全部收口：

- 真实链、Mock 链和历史兼容链的代码边界已物理隔离；
- 公共契约、内部事件、状态账本、ADR、来源登记和验收报告已同步；
- ALCHMED1–7 的只读盘点、迁移、保留和回滚 runbook 已完成；
- 凭据暴露处置记录、外部轮换清单和验收影响已完成；
- 旧验收 PR #1 已关闭，不再作为审计入口；
- 含凭据的本地启动脚本已从净化后的主线历史和验收分支中移除，并加入精确忽略规则；
- `origin/main` 安全基线已重建为 `1a4d95ba9e79e04540c1f7af61b917053735d1e5`，业务改动保留；
- 验收分支固定为 `codex/g01-audit-handoff-20260924`，Draft PR 为 `https://github.com/meta-xucong/alchemy-video-os/pull/2`；只允许独立审计，不允许直接合并或部署；
- `origin/codex/backup-20260919-snapshot@12446154` 是无共同祖先的孤立 WIP 文件快照，包含 19 个当前 PR 不存在的路径和 92 个不同文件；为避免误删独立工作，明确保留为非验收归档。它不是净化基线、不是 PR #2 的 head、不得直接合并，删除需仓库所有者确认；
- 当前主线树、验收分支树及两者差异均不包含已识别的原始凭据值。

仓库历史净化不能替代上游凭据吊销。SUB2API 视频密钥、参考图视觉服务密钥和参考图交付签名密钥仍须由对应账号/生产环境所有者轮换，并提供后台时间戳或审计记录；这属于外部账号处置，不是本地代码缺口。

## 10. 工作区与版本控制保护声明

本轮先对既有非干净工作区建立本地安全快照，再在净化后的 `main` 上重放审计分支。仅对包含凭据文件的主线末次提交实施受控、带租约的历史净化，业务差异全部保留；旧 PR 立即关闭，未使用无条件 force push，未清理或覆盖用户数据。被删除的旧远端审计分支仅指 `codex/audit-snapshot-20260924`。独立的 `codex/backup-20260919-snapshot` 因包含尚未逐项确认可删除的 WIP 内容而明确保留，但不构成验收入口；最终验收仍只看 PR #2。

## 11. 当前审计决定

综合文档、代码、静态审计、本地回归和隔离基础设施集成：

> **WP-00 至 WP-12 已实现；实现方历史完整基础设施证据为 `783/0/0`，独立复核当前环境证据为 `763/20/0`。G01 已按范围限定收口为 `ACCEPTED`，但当前不构成平台级生产验收或部署授权。**

非测试实现、文档、配置、安全和版本交付已经完成。独立验收决定为 `ACCEPTED_WITH_EXTERNAL_GATES`；真实 LLM、视频 Provider、Pixabay、VPS、真实媒体语义 QC、生产历史盘点和外部凭据轮换证明仍需单独授权，未补齐前不得宣称生产可用或部署。该决定允许合并 G01 审计 PR，不改变其它章节状态。
