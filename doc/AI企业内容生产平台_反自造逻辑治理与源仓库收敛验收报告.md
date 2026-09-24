# AI 企业内容生产平台：反自造逻辑治理与源仓库收敛验收报告

版本：`1.0.0`

日期：`2026-09-24`

状态：`OFFLINE_ACCEPTED / NOT_DEPLOYED`

主执行方案：`AI企业内容生产平台_反自造逻辑治理与源仓库收敛完整优化方案.md`

## 1. 验收结论

本轮 WP-00 至 WP-12 已按顺序完成开发文档冻结、逐章实现、代码审计、定向测试、跨域通用性测试、全仓 typecheck/build/test 和最终静态审计。

本地代码验收结论：**通过**。

该结论表示：

- 当前工作区的真实生产路径已按“LLM 负责语义，平台负责证据校验和薄壳执行”完成收敛；
- 已知 P0/P1 自造语义逻辑已从真实路径删除、禁用或隔离；
- 用户授权的 BGM 智能匹配已被明确标记为 `PLATFORM_OWNED`；
- 所有本地门禁均通过，未发现阻断合并的测试或静态审计失败。

该结论不表示：

- 已完成真实 Provider 生成或真实像素验收；
- 已完成生产数据库、对象存储、队列或 VPS 验收；
- 已完成 ALCHMED1–7 线上历史数据盘点；
- 已提交、推送、合并或部署。

## 2. 最终架构边界

### 2.1 真实语义链

真实创作链统一为：

```text
Source text + complete documents + canonical references + user decisions + provider capability
  -> CanonicalSourceBundle
  -> Semantic Director (LLM)
  -> evidence-backed SemanticDirectorDecision
  -> deterministic evidence verifier
  -> pure persistence / provider projection / media execution
```

真实链不再允许：

- 文档关键词分类或固定事实类别；
- 二元词 overlap、手工 rank、固定权重、固定 24/12/8 条选择；
- 参考图依据文件名、附近文字或画面主体自动决定用途；
- Provider compiler 二次解析台词、对象、左右手、转移动作或镜头；
- source 超限时删句、摘要、截断或静默改写；
- 缺少证据时填 `PLATFORM_OWNED_*` sentinel；
- 无 LLM 时回退 deterministic planner；
- 未检查即 PASS/CHECKED/false，未执行修复即 succeeded/ACCEPTED。

### 2.2 平台薄壳

保留且通过回归的必要能力包括：

- 身份、权限、Control API、workspace/project scope；
- Queue/Worker、outbox、幂等、重试、恢复和 dead-letter；
- PostgreSQL persistence 和状态机；
- 对象存储、relay、MIME、SHA、大小、ffprobe 和技术 QC；
- Provider submit/poll/download、错误归一化和能力边界；
- canonical reference order、PromptPackage provenance sidecar；
- OpenMontage 可追溯的 cut/mix/duck/loudness/单曲路径；
- 用户明确选择后的字幕、声音、口型、时长和音乐策略。

### 2.3 用户授权的 BGM 例外

以下整套能力明确归属 `PLATFORM_OWNED / USER_AUTHORIZED`：

- `musicMetadataTokens`；
- 内容命中；
- duration-fit；
- 标签优先；
- `scoreMusicAsset`；
- `selectAutoMusicAsset`；
- 稳定 SHA tie-break。

它们不属于 OpenMontage、Pixabay、Huobao 或 Seedance 原生推荐算法。新任务只有在用户显式选择 `AUTO` 后运行；`MANUAL` 和 `OFF` 不触发自动匹配或 Pixabay fallback。

## 3. 主要处置结果

### 3.1 文档理解

- 删除 deterministic document analyzer、category rules、bigram/token scoring、rank 和固定条数 selector；
- Production 包只保留 Markdown bounded read、标题、表格、视觉不可读提示、locator 和 SHA；
- 完整资料与当前任务一起交给 Semantic Director；
- 资料中的 prompt injection 只作为原始数据，不执行。

### 3.2 参考图与对象

- 图片客观观察与“用户想让图片控制什么”完全解耦；
- 用途由看到全部图片、用户说明和完整任务的 Semantic Director 决定；
- Provider Prompt 编号、asset ID、role、relay URL 与最终 URL 使用同一 canonical order；
- snapshot 后不再按 SUBJECT/SCENE/STYLE 二次排序；
- 旧 role/object heuristic 在真实生产扫描中没有调用。

### 3.3 台词、分段与 Prompt

- exact dialogue 由 Semantic Director 单一拥有，带 source span；
- 下游按 ID 和 exact text 传递，不重新解析 prose；
- 分段、时长、可见动作、镜头和引用关系均来自 verified decision；
- Provider compiler 退化为 pure projector；
- source byte-for-byte 保留；超限只可删除 provenance 明确的平台生成部分，否则 `PROMPT_BUDGET`。

### 3.4 用户决定

- Studio 自动规划只到 storyboard review；
- 用户显式确认分镜后才创建交付计划；
- 用户显式确认交付策略与音乐模式后才创建 production run；
- 缺失 `music_plan.mode`、交付策略或审批均 fail-closed；
- 不再自动 approve、默认 AUTO 或使用伪 `budget=0`。

### 3.5 连续性、媒体和 QC

- 未配置真实 handoff evaluator 时记录 `UNAVAILABLE`，不读取边界帧、不创建 repair；
- BLEND/BRIDGE 只是 review recommendation，不等于执行成功；
- fixed CLIP category 和手调 transcript overlap 不再参与语义验收；
- 未执行 overlay/asset/text 检查保持 `null`；
- promise preservation、runtime swap、silent downgrade 无证据时为 `UNAVAILABLE/null`；
- 容器、时长、分辨率、音轨、静音、响度、SHA 等客观技术 QC 继续执行。

### 3.6 Mock 与历史兼容

- Mock executor/client 位于 `apps/workflow-worker/src/mock`；
- 只有明确 mock runtime 分支才动态加载 deterministic planner/compiler；
- 真实 Worker 使用 semantic-only package subpath；
- handoff fixture 位于 tests/helpers；
- 新 DeliveryPlan-backed 合成只写完整 AudioPlan/ALCHMED8；
- ALCHMED1–7 只读保留，删除等待生产数据盘点和迁移证据。

## 4. 通用性验收

新增离线通用性用例覆盖：

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

所有用例通过同一 schema 和 evidence verifier，没有行业专用分支。

## 5. 最终测试证据

### 5.1 全仓 JavaScript/TypeScript

| 项目 | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| Studio Web | 43 | 0 | 0 |
| Contracts | 49 | 0 | 0 |
| Reference Delivery | 3 | 0 | 0 |
| Storage Client | 7 | 1 | 0 |
| Credit Veyra | 21 | 0 | 0 |
| Document Intelligence | 2 | 0 | 0 |
| Domain | 70 | 0 | 0 |
| Provider Video | 72 | 0 | 0 |
| Reference Analysis | 2 | 0 | 0 |
| Task Queue | 0 | 1 | 0 |
| Creative Planning | 106 | 0 | 0 |
| Persistence | 92 | 12 | 0 |
| Sub2API Certifier | 15 | 0 | 0 |
| Control API | 94 | 1 | 0 |
| Document Worker | 12 | 0 | 0 |
| Production Worker | 74 | 0 | 0 |
| Task Worker | 49 | 5 | 0 |
| Workflow Worker | 45 | 0 | 0 |
| **合计** | **756** | **20** | **0** |

命令：`pnpm test`

结果：退出码 `0`。

20 个 skip 仅表示未配置 PostgreSQL、BullMQ、MinIO 等集成环境；它们没有被计入通过数。

### 5.2 Python Media Runtime

命令：

```text
uv run python -m py_compile runtime.py main.py
uv run --with pytest python -m pytest -q tests/test_runtime.py adapters/openmontage_audio/test_adapters.py
```

结果：

- Python compile：通过；
- `152 passed / 0 failed`；
- 另 `7 subtests passed`。

### 5.3 其它门禁

- `pnpm contracts:generate`：通过；
- Contract drift 测试：通过；
- `pnpm typecheck`：18 个 workspace 项目全部通过；
- `pnpm build`：全部通过；
- Nuxt 构建仅出现依赖自身既有 `DEP0155` warning；
- `git diff --check`：退出码 0；
- 生产源静态扫描：`DeterministicDocumentUnderstandingAdapter`、`DeterministicFactSelector`、`createFixtureHandoffEvaluator`、`sourceCompactionPatterns`、`categoryRules`、`rankFact` 均为 0 个命中。

## 6. 未执行项和残余边界

以下内容明确没有执行，不得被补写成已完成：

1. 真实 Provider 视频生成；
2. 真实 Pixabay 网络查询或下载；
3. 生产 PostgreSQL、BullMQ、MinIO 集成测试；
4. VPS 部署和线上健康检查；
5. 真实像素、多模态语义和人工听感验收；
6. ALCHMED1–7 线上历史数量、最后访问时间和迁移可行性盘点；
7. Git add、commit、push、PR 或合并。

历史 ALCHMED decoder 继续保留不是实现失败，而是数据安全门：没有生产盘点和迁移证据时不得删除。

## 7. 工作区保护声明

本轮在既有非干净工作区上实施。没有使用 reset、checkout、clean 或覆盖式回滚；没有把此前差异冒充为本轮新改动。最终仍需在提交前按文件逐项 review，并由版本控制保留来源可追踪性。

## 8. 验收决定

综合文档、代码、静态审计、跨域测试、全仓回归和构建结果：

> **WP-00 至 WP-12 本地验收通过，状态为 `OFFLINE_ACCEPTED / NOT_DEPLOYED`。**

允许进入下一道独立流程：提交前人工 diff review、按项目治理规则建分支/PR，或在用户单独授权后进行生产数据盘点与真实 Provider/VPS 验收。
