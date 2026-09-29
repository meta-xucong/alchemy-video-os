# AI 企业内容生产平台：Semantic Director 真实模型能力门与规划阻断收口开发文档

版本：`1.2.0`

日期：`2026-09-28`

状态：`IMPLEMENTED / READY_FOR_PROVIDER_TEST / VIDEO_PROVIDER_PENDING`

当前业务结论：`BLOCKED / NOT_READY_FOR_PROVIDER_TEST`

## 1. 事件结论

“护肤品商业宣传片”本轮没有进入 Grok/KIE 视频生成阶段。失败发生在：

```text
Brief
  -> CanonicalSourceBundle
  -> Semantic Director 请求/输出
  -> SemanticDirectorDecision 严格校验
  X 阻断
```

本轮没有形成新的 Provider submit、视频下载、ffprobe、合成或 Provider 费用。旧版本成功成片只作为旧链路基线，不证明新的 Semantic Director 链路可用。

已排除：

- Grok/Sub2API 未收到本轮新任务；
- reference relay 可达性不是本轮首要失败点；
- 原始参考资产存在且视觉分析可为 `READY`；
- Control API、Studio、Media Runtime 和 Worker 可启动；
- 本轮 BGM 已关闭，BGM 不是根因；
- 没有语义决策时，生产链不会创建视频任务或扣费事实。

## 2. 已观察到的真实失败

真实模型曾分别出现：

```text
Semantic director response schema validation failed
Semantic director service rejected the request
Semantic director request timed out
Semantic director returned no JSON content

2026-09-28 使用 `aiself-deepseek-v4-pro-observed-v1` 的新一轮三次认证中，前两次未形成通过报告，历史认证最终以 `CERTIFICATION_DECISION_STABILITY_FAILED`（第 3 次）结束；该历史错误门已被标记为 superseded：合法的编辑分段差异（例如 2×15 与 3×10）不再因跨调用结构哈希不同而失败。当前认证逐次校验 source/target/对白/引用等固定硬门，并记录 invariant hash 供审计；不设置跨调用 hash equality。该历史报告未生成，profile 仍保持 `UNAVAILABLE`，不得据此进入 Provider 测试。

同日使用用户授权的 Aiself OpenAI-compatible 网关目录做一次受控横评（四个候选各 3 次，合计 12 次；仅调用 Semantic Director，未调用视频 Provider）结果如下。下表是该轮历史结果，不覆盖后续的 Sonnet v3 认证：

| 模型 | 认证结果 | 总耗时 | 判断 |
| --- | --- | ---: | --- |
| `deepseek-v4.1-flash` | `CANONICALIZATION_SEGMENT_SUBSHOT_INVALID` | 82.0s（第 3 次） | 第 3 次违反既有子镜头边界，未形成候选 |
| `glm-5.3-flash` | `CERTIFICATION_DECISION_STABILITY_FAILED`（历史，已 superseded） | 218.4s | 当时被过严的跨调用结构哈希门阻断；仍未形成新的 `CANDIDATE_PASS` |
| `kimi-k2.6` | `DIRECTOR_HTTP_REJECTED` | 2.8s（第 1 次） | 网关拒绝请求，未进入语义评估 |
| `claude-haiku-4-5-20251001` | `DIRECTOR_CONTENT_FORMAT_INVALID` | 7.2s（第 1 次） | 首次响应不是可接受的严格 JSON |

本轮新网关 token 只在进程内用于认证命令，未写入仓库、环境文件、报告或日志；建议在聊天暴露后轮换该 token。该历史轮次没有候选取得 `CANDIDATE_PASS`，因此当时没有替换 profile，也没有放宽协议或启用自动切换。

随后对 `claude-sonnet-5` 使用当前 v3 认证器重新执行了 3 次真实 Semantic Director 调用（不含视频 Provider）。脱敏报告已由当前 `workflow-worker/dist` 解析器通过：`CANDIDATE_PASS`、`report_version=3`、`segment_counts=[2,2,2]`、`dialogue_counts=[2,2,2]`、`reference_usage_counts=[2,2,2]`，三次 `decision_hashes` 一致，认证面哈希为 `1489b5c8af684f9be32514799aa352d4420f21f6685ebdf41d7c4215915c64b5`。A1 独立复核结论为 PASS，因此仅将该精确 Semantic Director profile 登记为 `CERTIFIED`；AISelf 路由/账户归属仍为 `ROUTE_UNVERIFIED`，不等同于视频 Provider 或成片验收。
```

当前决策契约要求一次输出完整且严格的对象，包括：

- `source_hash`；
- `target_duration_seconds`；
- 连续分段和精确时长总和；
- exact dialogue 及源文本 UTF-16 span；
- reference usage 与不可变资产证据；
- segment evidence；
- unresolved items；
- 禁止额外字段、缺字段和伪造字段。

该契约保持不变。问题不能通过自动补字段、修 Markdown、修半截 JSON、重排引用或 deterministic fallback 解决。

## 3. 模型能力登记

真实模型必须绑定一个精确 `SEMANTIC_PLANNER_PROFILE_ID`。profile 固定：

- provider；
- model ID；
- 输出模式：`JSON_SCHEMA`、`JSON_OBJECT` 或 `PROMPT_ONLY`；
- `SemanticDirectorDecision v1` 契约；
- 超时；
- 最大输入 UTF-8 字节数；
- 最大输出 token；
- 认证 fixture ID；
- `CERTIFIED` 或 `UNAVAILABLE` 状态。

当前登记：

| Profile | Model | 状态 | 原因 |
| --- | --- | --- | --- |
| `aiself-claude-sonnet-5-candidate-v3` | `claude-sonnet-5` | `CERTIFIED` | v3 fixture 三次通过；A1 PASS；路由归属仍未认证 |
| `aiself-deepseek-v4-pro-observed-v1` | `deepseek-v4-pro` | `UNAVAILABLE` | 超时或空内容 |
| `aiself-doubao-seed-2.0-pro-observed-v1` | `doubao-seed-2.0-pro` | `UNAVAILABLE` | 完整 v1 fixture 未通过 |
| `aiself-doubao-seed-2-0-lite-260428-reference-vision-only` | `doubao-seed-2-0-lite-260428` | `UNAVAILABLE` | 只登记为参考图视觉模型，不能成为规划 fallback |

当前仅有一个真实 `CERTIFIED` Semantic Director profile。它只放行语义规划调用；视频 Provider、BGM、字幕、合成和成片质量仍须单独认证，不能继续轮换模型碰运气。

认证前还修复了一个与模型无关的事实边界缺口：`semantic-director-canonicalizer.ts` 不再把任意 `line-N` 源文本行当作对白；现在复用 `creative-planning` 既有 `extractDialogueLines` 结果，保留物理 `source_line/source_offset`，未识别或无法唯一归属的行直接以 `CANONICALIZATION_DIALOGUE_ID_INVALID` fail-closed。该修复不新增对白启发式，只把既有 source-first 提取逻辑移到 production-safe 共享模块，并让 evidence span 通过原文切片精确校验。

## 4. 请求与严格输出适配

`SemanticDirectorDecisionSchema` 现在同时导出机器可读 JSON Schema。请求携带：

```text
contract_version
required_output_json_schema
canonical_source_bundle
```

按精确 profile 选择请求方式：

- `JSON_SCHEMA`：仅供实测支持严格 `json_schema` 的模型；
- `JSON_OBJECT`：仅供实测支持 `json_object` 的模型；
- `PROMPT_ONLY`：模型不支持 `response_format` 时省略该字段，但仍严格要求纯 JSON 对象。

任何模式都不会接受：

- Markdown code fence；
- 数组根节点；
- 空内容；
- 半截或畸形 JSON；
- 非对象根节点；
- 缺失 choice/message；
- 非 JSON Content-Type；
- schema 或 provenance 不通过的对象。

## 5. 脱敏诊断

新增内部事件：

```text
semantic_director.diagnostic
```

允许记录：

- provider；
- model；
- profile ID；
- contract version；
- response mode；
- HTTP status；
- request UTF-8 byte size；
- response Content-Type；
- response byte size；
- elapsed milliseconds；
- empty response；
- retryable；
- failure stage；
- error class；
- schema/provenance verification code。

禁止记录：

- API key；
- endpoint；
- 完整 prompt；
- CanonicalSourceBundle 正文；
- 原始响应正文；
- 用户台词、文档或图片 URL；
- Provider request ID。

失败阶段被区分为：`CONFIGURATION`、`REQUEST`、`HTTP`、`RESPONSE_ENVELOPE`、`CONTENT`、`SCHEMA`、`PROVENANCE`、`BLOCKED`。诊断 sink 自身失败不能改变规划结果。

认证器在模型返回合法 RawSemanticPlan、但平台规范化后的决策 schema 不通过时，额外输出去重后的校验类别和字段路径（不输出字段值、台词、原始响应或提示词），并以 `CERTIFICATION_DECISION_SCHEMA_FAILED` 保持阻断。该诊断只用于定位候选模型能力，不会放宽 schema、自动修补或晋级 profile。

## 6. 启动与环境边界

真实视频模式要求以下五项独立配置：

```dotenv
SEMANTIC_PLANNER_ENABLED=true
SEMANTIC_PLANNER_BASE_URL=<credential-free HTTPS base path>
SEMANTIC_PLANNER_API_KEY=<private>
SEMANTIC_PLANNER_MODEL=<exact model ID>
SEMANTIC_PLANNER_PROFILE_ID=<exact certified profile ID>
```

`SEMANTIC_PLANNER_TIMEOUT_MS`、`SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES` 和 `SEMANTIC_PLANNER_MAX_TOKENS` 只是可选断言；提供时必须与认证 profile 完全一致，不能临时放大参数绕过 fixture。请求体超过 profile 的输入字节上限时必须在网络调用前以 `DIRECTOR_REQUEST_TOO_LARGE` 阻断。

参考图视觉配置：

```text
REFERENCE_VISION_*
```

与规划器配置完全分离，不再回退复用。

本地启动器：

- Mock 模式忽略 Semantic Director 配置并使用隔离 mock fixture；
- `sub2api` 模式缺少认证 profile 时直接停止；
- 配置只注入 Workflow Worker；
- ready 日志只输出安全 profile/model/模式/契约信息；
- 启动器读取 ready 日志确认子进程实际配置；
- 启动前拒绝残留 `--alchemy-local-stack` Worker，防止旧 Worker 抢任务；
- key、endpoint 和 prompt 不进入状态文件或日志。

## 7. 旧项目参考图语义投影

旧 storyboard/prompt package 只有 `reference_policy` 而没有：

```text
semantic_reference_projection
```

旧数据不允许手工补字段。正确路径是：

1. 保留旧 storyboard 只读；
2. 以原始 brief、当前真实参考资产和用户决定重新构建 CanonicalSourceBundle；
3. 使用已经认证的 Semantic Director profile 重新规划；
4. 通过 schema 与 provenance 校验；
5. 创建新的 storyboard 和 PromptPackage；
6. 确认 projection 的 asset ID、SHA、position、role 和 segment 引用一致；
7. 再由用户审批 DeliveryPlan。

生产入口继续在缺少投影时返回：

```text
等待已验证的参考图用途计划后继续制作。
```

不得直接改数据库，也不得让旧项目绕过语义门调用 Provider。

## 8. 分阶段验证顺序

### 8.1 模型认证

候选模型必须用同一固定、无敏感信息的完整 fixture 验证：

- 长上下文可承载；
- 纯 JSON；
- exact `source_hash`；
- UTF-16 span 与 quote；
- exact dialogue 原顺序；
- 两张以上参考图 canonical order；
- 30 秒目标的合法连续分段；
- segment 时长总和；
- unresolved 语义；
- 零额外字段；
- 每次运行分别通过 source/target、精确对白顺序与引用顺序、时长总和、BGM 禁止和 unresolved 硬门；不同调用可以保留来源允许的合法编辑分段差异（例如 2×15 与 3×10），不再要求 segment count 或完整决定哈希完全相同。

认证失败即保持 `UNAVAILABLE`；不自动换模型，不将一次偶然成功写成稳定能力。

受控认证入口只调用 Semantic Director，不调用视频 Provider：

```powershell
$env:SEMANTIC_PLANNER_CERTIFY_LIVE = "true"
$env:SEMANTIC_PLANNER_CERTIFY_ATTEMPTS = "3"
$env:SEMANTIC_PLANNER_PROVIDER = "<exact-provider-name>"
$env:SEMANTIC_PLANNER_RESPONSE_MODE = "JSON_SCHEMA" # 或 JSON_OBJECT / PROMPT_ONLY
$env:SEMANTIC_PLANNER_BASE_URL = "<credential-free-https-base-path>"
$env:SEMANTIC_PLANNER_API_KEY = "<private>"
$env:SEMANTIC_PLANNER_MODEL = "<exact-model-id>"
$env:SEMANTIC_PLANNER_PROFILE_ID = "<candidate-profile-id>"
$env:SEMANTIC_PLANNER_TIMEOUT_MS = "<exact-timeout>"
$env:SEMANTIC_PLANNER_MAX_INPUT_UTF8_BYTES = "<exact-input-byte-limit>"
$env:SEMANTIC_PLANNER_MAX_TOKENS = "<exact-output-limit>"
pnpm --filter @alchemy-video/workflow-worker certify:semantic-director -- --live
```

输出只允许 `CANDIDATE_PASS` 的 hash/count 报告或脱敏失败分类，不包含 key、endpoint、fixture 正文或原始响应。`CANDIDATE_PASS` 仍须人工代码审计后才能把精确 profile 写成 `CERTIFIED`，工具不会自动修改 registry。

### 8.2 旧项目重新规划

认证 profile 可用后，重新生成新的规划 revision，并逐项确认：

```text
SemanticDirectorDecision executable
source_hash exact
exact dialogues complete and ordered
segments contiguous
segment durations sum to 30 seconds
semantic_reference_projection present
reference asset IDs and positions exact
PromptPackage persisted
DeliveryPlan user-approved
```

### 8.3 视频 Provider

只有前两阶段通过后，才允许：

1. BGM `OFF`；
2. 30 秒、480P；
3. 最少合法分段，不使用机械均分；
4. 每段各一次 Provider submit；
5. 下载、MIME、SHA、ffprobe；
6. 合成并播放；
7. 最后单独验证 AUTO BGM/Pixabay。

语义规划、视频 Provider、BGM 和合成不得混在同一次故障排查中。

## 9. 明确禁止

- 不放宽 `SemanticDirectorDecisionSchema`；
- 不自动补 `source_hash`、offset、reference usage 或 segment；
- 不修 Markdown、数组或半截 JSON；
- 不恢复固定 15 秒、机械均分、关键词分段；
- 不回退 deterministic planner；
- 不给旧 PromptPackage 手工注入 projection；
- 不绕过语义规划直接提交 Grok；
- 不把规划失败显示成视频 Provider 失败；
- 不在规划失败时创建扣费事实；
- 不把参考图视觉模型当作 Semantic Director。

## 10. 代码落点

```text
apps/workflow-worker/src/semantic-director-model-profiles.ts
apps/workflow-worker/src/semantic-director-client.ts
apps/workflow-worker/src/semantic-director-certifier.ts
apps/workflow-worker/src/index.ts
apps/workflow-worker/src/semantic-director-canonicalizer.ts
apps/workflow-worker/src/semantic-director-certification.ts
packages/creative-planning/src/source-dialogue.ts
packages/contracts/src/semantic-provenance.ts
packages/creative-planning/src/semantic-director.ts
infrastructure/local/start-full-local-stack.ps1
infrastructure/deploy/.env.video.example
infrastructure/deploy/docker-compose.video.yml
```

行为回归位于：

```text
apps/workflow-worker/tests/semantic-director-client.test.ts
apps/workflow-worker/tests/semantic-director-certifier.test.ts
packages/contracts/tests/semantic-provenance.test.ts
apps/studio-web/tests/project-flow.test.mjs
```

## 11. 当前代码证据

截至本文件写入：

- Semantic Director canonicalizer/certifier/execution 定向回归：`29 passed / 0 skipped / 0 failed`；
- Creative Planning 构建通过；Workflow Worker typecheck 通过；

- Workflow Worker：`83 passed / 0 skipped / 0 failed`；
- Contracts：`50 passed / 0 skipped / 0 failed`；
- Creative Planning：`112 passed / 0 skipped / 0 failed`；
- Studio Web：`46 passed / 0 skipped / 0 failed`；
- `pnpm typecheck`：18 个 workspace 全部通过；
- `pnpm build`：全仓通过，仅有既有 Nuxt `DEP0155` warning；
- `pnpm contracts:generate`：通过，三个公开合同文件无内容漂移；
- Media Runtime：Python compile 通过，`152 passed / 0 failed`，另 `7 subtests passed`；
- PowerShell AST parse 通过；
- deploy Compose config 通过；
- 使用独立临时 PostgreSQL 数据库、Redis DB 15 和随机 MinIO bucket 的最终完整隔离复跑：`831 passed / 0 skipped / 0 failed`；
- 复跑后随机 bucket 已删除、Redis DB 15 `DBSIZE=0`、临时数据库数量为 0，现有项目数据未被使用；
- `git diff --check` 通过。

除上述 Sonnet v3 脱敏认证报告外，其余均为本地 fixture/静态行为证据；Sonnet 认证也只证明 Semantic Director 规划能力，不证明真实视频 Provider 或最终成片。

## 12. Exit Gate

### 12.1 当前已完成

- 严格 JSON/Schema/Provenance 保持 fail-closed；
- 模型按精确 profile 管理；
- 已观察失败模型明确 `UNAVAILABLE`；
- `aiself-claude-sonnet-5-candidate-v3` 已通过 v3 三次真实 Semantic Director fixture，并由 A1 复核后登记为 `CERTIFIED`；
- 请求方式按 profile 选择，不再一律发送 `response_format`；
- 输出 JSON Schema 与 bundle 一起提供；
- 错误诊断脱敏且细分；
- 启动环境不再丢失或复用错误配置；
- 旧 Worker 竞争有启动阻断；
- 旧 storyboard 不被伪造升级；
- 本地认证报告只在 Workflow Worker 的显式 `NODE_ENV=development` 子进程中启用，不扩大到其它服务或部署配置；
- Windows PowerShell 5.1 已完成整份启动脚本解析验证；
- Document Runtime 真实 loopback 测试使用 30 秒有界 readiness、单次请求超时、子进程退出诊断和完整进程回收，不再依赖 2.5 秒竞态窗口。

### 12.2 尚未完成

- 尚未重新规划护肤品旧项目；
- 尚未生成新的 `semantic_reference_projection`；
- 尚未创建新的 DeliveryPlan；
- 尚未提交 Grok；
- 尚未验证 30 秒、480P 两段生成与合成；
- 尚未验证 AUTO BGM/Pixabay。

因此 Semantic Director 子门可升级为：

```text
READY_FOR_PROVIDER_TEST
```

但整个平台仍不得据此视为已验收；必须先用该 profile 对旧项目生成新的规划并通过严格门禁，随后才能进入真实视频 Provider 测试。

真实 Provider 测试和最终成片验收必须另立证据，不得由本文件的本地绿测代替。

## 13. 开发侧最终审计结论

开发侧代码、配置、文档、静态安全和隔离基础设施模拟测试已经完成，状态为：

```text
READY_FOR_PROVIDER_TEST / VIDEO_PROVIDER_PENDING
```

业务链路仍保持：

```text
BLOCKED / NOT_READY_FOR_PROVIDER_TEST
```

这两个状态不矛盾：前者表示实现已具备交给实机测试同事复核的条件；后者表示在真实模型通过固定 fixture、旧项目重新规划并产生新 projection 之前，系统必须继续阻止 Grok/KIE submit 和费用事实。开发侧验收不得冒充真实模型、真实 Provider、真实成片或人工质量验收。
