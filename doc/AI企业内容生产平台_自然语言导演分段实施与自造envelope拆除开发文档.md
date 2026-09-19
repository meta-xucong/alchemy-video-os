# AI 企业内容生产平台：自然语言导演分段实施与自造 envelope 拆除开发文档

> 文档版本：v1.0（2026-09-18）
> 文档状态：`HISTORICAL_SUPERSEDED`（仅保留实施过程记录）
> 当前权威文档：《AI企业内容生产平台_原仓库自然语言导演分段与口播保真开发文档.md》；本文不得作为新增实现授权或当前状态账本。
> 原上位文档当时的 DESIGN_ONLY/实施口径已被当前权威文档的 `IMPLEMENTED_PENDING_AUDIT` 对账取代。
> 依据链：复审计报告《AI企业内容生产平台_自造逻辑核查与拆除报告.md》（含 §7 复审计记录）→ 上位文档 §3/§6/§7/§8。

## 1. 目的与范围

把真实 Provider 模式的 LLM 输出契约从「平台自造的 `source_ownership/source_spans` envelope + UTF-16 覆盖校验」切换为上位文档 §3.2 规定的「与既有片段一一对应的顶层自然语言提示词数组」，并拆除全部相关自造机制。同时按审计结论处理 C 类登记缺口。

**本.Slice 只做拆除与契约切换，不新增任何能力。**

## 2. 改动清单（精确到符号）

### 2.1 `apps/workflow-worker/src/semantic-planning-client.ts`

| 动作 | 对象 | 说明 |
| --- | --- | --- |
| 删除 | `plannerSystemPrompt`（:55-71） | 旧 `{draft,sourceCoverage}` shape 的系统提示 |
| 删除 | `freeformPlannerSystemPrompt`（:73-81） | ownership/span envelope 的系统提示 |
| 删除 | `LegacyOpenAiCompatibleSemanticPlanningClient`（:158-167） | 仅为旧 shape 兼容测试保留；随测试一并删除 |
| 新增 | 自然语言数组系统提示 | 内容仅含上位文档 §5 可追溯的上游规则：huobao `description` 有序可见动作/不新增台词、Seedance 自然语言四层形状/`@` 引用原样/global locks、openmontage 五层紧凑层次。要求：只返回顶层 JSON 字符串数组，长度等于既有片段数，每项非空；不可表达时返回空数组/空串由调用方 fail-closed |
| 修改 | `OpenAiCompatibleSemanticPlanningClient.plan` | 请求 context 按 §3 改造；保留 HTTP/超时/`response_format`/模型配置/错误映射（平台边界） |
| 保留 | `parseJsonContent`、`OpenAiCompatibleSemanticPlanningHttpTransport`、`createSemanticPlanningClientFromEnv`、`createPlanningModelFromEnv` | 平台外壳，不动 |

### 2.2 `packages/creative-planning/src/index.ts`

| 动作 | 对象 | 说明 |
| --- | --- | --- |
| 删除 | `LlmFreeformPromptResult` 的 `sourceOwnership`/`sourceSpans` 类型（:215-220）与解析器 `readLlmFreeformPromptResult`（:434-495） | A1 |
| 删除 | `readRawSemanticPlanningResult`（:498-604）、`canonicalizeSemanticPlanningResult` 及其专属辅助（`assignSemanticDirectorSources`、`assertSourceSpansCover*`、`semanticDirectorSourceSpanKey` 等仅被旧链引用者） | A3/A4/A5；删除前必须 `rg` 确认无其它引用 |
| 删除 | `buildSemanticDirectorDraft`（:1269 起）中的 ownership/span 合并逻辑 | A1/A4/A5 |
| 删除 | UTF-16 覆盖错误路径（:1176、:1193-1226、:1341） | A4/A5 |
| 删除 | 旧调用点对 `sourceEvidence`/`sourceManifest` 的构造与传递 | B1 的 LLM 侧 |
| 修改 | `LlmFreeformPlanningContext`（:194-208） | 收敛为：`sourceText`（完整原文）、`segmentCount`、`segments[{sequence,targetDurationSeconds,referencePolicy,referenceAnchors}]`、`stylePreferences`、`dialogueLines`（受保护口播，仅提示不可改写，不要求回写）。删除 `sourceManifest`/`sourceEvidence` |
| 修改 | `buildLlmFreeformPlanningContext`（:1644） | 按上表构造；dialogueLines 用既有 `extractDialogueLines` |
| 修改 | `LlmFreeformPromptPlanningModel.plan`（:1424-1441） | 确定性骨架 → context → client → **解析顶层字符串数组** → 校验（数组、长度=片段数、每项非空字符串）→ 把第 i 项写入 `shotSpecs[i].visualPrompt` → 返回既有 `StoryboardPlanDraft`。任一不满足抛既有 `LLM_PLANNER_MALFORMED`/`LLM_PLANNER_UNAVAILABLE` |
| 保留 | `DeterministicPlanningModel`、`DeterministicStoryboardCompiler`、`extractDialogueLines`、预算 sidecar（`sourcePrompt/generatedPromptParts`）、`LlmSemanticPlanningError`、reference 顺序 | 平台骨架与口播硬门（上位文档 §4） |

**不移除的说明**：确定性规划器内部的句子抽取（`extractNarrativeSentences` 等）属于已登记的 huobao 适配段落骨架机制，且被 segment count/duration policy 消费；本次只拆除它作为「LLM 覆盖身份锚点」的用途，不拆除规划器本身。

### 2.3 `apps/workflow-worker/src/execution-service.ts`

**预期零改动。** 它只消费 `planned.shotSpecs[i].visualPrompt` 并传入 compiler（:144），与 envelope 无关。实施时验证即可。

### 2.4 测试

- `packages/creative-planning/tests/*`：删除 ownership/span/coverage 定向测试；按上位文档 §8.1 新增：数组长度一致、口播原文不受影响（`extractDialogueLines` 输出与源一致）、`@`/显式边界顺序不重排、对象/缺项/空项/错误 JSON/超时全部 fail-closed、送入 LLM 的 sourceText 未被截断、`visualPrompt` 不复制完整 source 或口播（存在即 fail-closed）。
- `apps/workflow-worker/tests/*`：删除 legacy shape 测试；新增 client 级数组解析与 fail-closed 测试（本地 fixture，不触网）。

### 2.5 登记与文档

- `doc/AI企业内容生产平台_第三方来源与复用登记.md`：追加本条实施登记（固定 commit、薄壳适配、**不声称来源定义**的部分显式划线）；同时**补登** `auditCameraCoverage`/`openmontage-variation-audit.ts`（复审计确认有来源、此前登记缺失）。
- 本文与《自造逻辑核查与拆除报告.md》互引。

## 3. C 类启发式处理决定（记录在案）

| 项 | 决定 | 理由 |
| --- | --- | --- |
| C3 `auditCameraCoverage` | 本次仅补登记，不改代码 | 复审计确认有可验证来源（OpenMontage `variation_checker.py`），只是登记缺失 |
| C1 `hasCinematicEditorialBoundary` | 不动，维持冻结状态，留待单独裁定 | 影响 segment count 行为；上位文档 §7 范围是 LLM 输出契约，混入会扩大行为变更面 |
| C2 `inferPhysicalSceneConstraints` | 不动，登记为待裁定 | 同上；删除会改变提示词内容 |
| C4 `deriveCamera` | 不动，登记为待裁定 | 产出 CameraShotSpec，删除改变 draft/prompt |
| C5 `complexity_score` | 不动 | 它是 `packages/contracts` schema 必填字段，删除=改公共契约，被上位文档 §7 明确禁止 |

## 4. 边界

**允许改**：§2.1、§2.2 所列文件及其测试；登记文档；本文。
**禁止改**：`packages/contracts`、数据库 schema、任务状态/事件、Provider adapter、`runtime-profile.ts`、前端、计费、VPS、真实外部调用（上位文档 §7 一致）。
**禁止引入**：任何新的切分算法、评分、阈值、fallback、压缩、marker 去重、静默改写。fail-closed 是唯一兜底。

## 5. 验收（对齐上位文档 §8）

1. `rg` 证明：代码中不再存在 `source_ownership`、`source_spans`、UTF-16 coverage 校验、`{draft,sourceCoverage}` 响应要求。
2. creative-planning 与 workflow-worker 测试全绿（本地 fixture，0 真实调用）；typecheck 通过。
3. 保险 AI 多行中文对白 fixture：数组长度=片段数；最终 Provider prompt 中口播与原文逐字一致。
4. 「商品测试1」无旁白三段 fixture：完整原文进 context；不再触发任何 span 覆盖错误。
5. diff 只落在 §2 允许范围。

## 6. 回滚

改动集中在两文件+测试；`git checkout -- <files>` 即可回到实施前状态。
