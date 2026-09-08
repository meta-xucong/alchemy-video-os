# 参考图无说明自动内容识别最小适配开发文档

状态：IMPLEMENTED_PENDING_AUDIT（不新增正式章节，不改变现行章节账本）  
日期：2026-09-02

## 1. 目标与边界

当用户只上传参考图、没有在创作说明中写出图片用途时，系统应尝试读取图片内容，再决定参考图是 `SUBJECT`、`SCENE` 还是 `STYLE`。不得依据上传顺序、选择顺序或文件名臆测角色；文件名只有在用户文字明确提及时才参与解析。用户明确写出的用途始终覆盖视觉分析结果。

本次只补齐现有视觉分析链路对“历史 READY 图片”的触发时机，不新增角色、分类模型、阈值、公开字段、API 或 Provider 调用。视觉服务不可用、返回非法结果或置信度不足时继续 `WAITING`，不静默当作 `STYLE`，也不猜测。

## 2. 来源与现有实现

实现只复用当前仓库已有能力：

- `packages/reference-analysis/src/index.ts` 的 `ReferenceVisionAnalyzerPort`、`OpenAiCompatibleReferenceVisionAnalyzer` 和 `createReferenceVisionAnalyzerFromEnv`；其提示词已经要求按图像内容判断且“不要按图片顺序猜测”。
- `packages/domain/src/reference-roles.ts` 的 `inferVisualReferenceRoles` 与 `parseVisualReferenceAnalysis`；解析优先级保持用户说明，再读取服务端视觉分析。
- `apps/control-api/src/app.ts` 的确认上传分析、对象校验和 `maxReferenceImageBytes`；不复制第二套读取或分析器。
- `packages/persistence/src/production-repository.ts` 的既有 `REFERENCE_SET` 门禁；未解析角色继续阻断。
- 上游参考：OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/analysis/video_understand.py` 只提供内容描述/分类能力，不直接定义本平台的三种角色，因此不把上游通用分类硬映射成新算法。Seedance/huobao 的资料只作为显式参考绑定和内容语义优先的来源，不作为位置回退。

## 3. 最小流程

1. 创建或确认创作简报时不改现有契约和状态。
2. `POST /api/v1/creative-brief-revisions/:id/plan` 在调用既有 `requestCreativePlan` 前读取同工作区简报及其显式 `source_asset_ids`。
3. 仅对该简报中现有的 READY、USER_UPLOAD、IMAGE 资产读取对象；按资产 ID 关联，不按位置赋予角色。已有通过 `parseVisualReferenceAnalysis` 的分析不重复调用。
4. 先用 `inferVisualReferenceRoles` 解析用户说明、明确文件名说明和已有分析；只有仍未解析的图片才调用已经注入的 `ReferenceVisionAnalyzerPort`。
5. 分析成功后通过内部资产存储端口合并写回 `visual_analysis` 与 `visual_analysis_status=READY`，保留原有哈希、MIME、大小、对象 key 和其它元数据。分析失败只记录已有状态 `UNAVAILABLE`/`FAILED`，规划请求仍走原状态机；后续生产门禁继续给出既有等待提示。
6. 没有 `REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_API_KEY`、`REFERENCE_VISION_MODEL` 时不创建分析器，行为保持 fail-closed。配置视觉服务后，用户可以对同一份简报再次请求规划以重试历史 READY 图片。

## 4. 明确不做的事

- 不读取上传顺序推导主体/场景/风格。
- 不新增本地 OCR、CLIP、LLM、排序或相似度算法；不把 OpenMontage 的通用类别静默映射为角色。
- 不修改公开 `ReferenceBinding` 枚举、创作简报 DTO、TaskRun 快照、事件、Provider 请求或历史成片。
- 不在没有视觉分析服务时自动放宽门禁；不调用真实视频/TTS/Provider。

## 5. 验证与验收

离线夹具至少覆盖：

- 无用途说明、已 READY 的多张图片在视觉分析器注入时被逐张分析并持久化；规划请求可继续进入既有 `PLANNING` 状态。
- 用户明确说明覆盖分析结果；已解析图片不重复调用分析器。
- 分析器未注入、读取失败或返回非法结果时，角色仍未解析并保持既有等待/阻断。
- 工作区、项目和资产身份隔离；不读取其它项目对象。

验收只认可复核的定向测试和实际人工试听/看片结果；静态命中不替代行为证据。真实视觉服务由用户另行配置和触发，本开发文档不授权外部调用。

## 6. 本轮实现与证据

- `AssetWorkspaceStore.updateVisualReferenceAnalysis` 仅作为内部可选端口写回同工作区、同项目、READY/USER_UPLOAD/IMAGE 资产的既有元数据；未实现该端口的轻量测试存储保持不可用即阻断。
- Control API 规划入口复用上述端口和既有对象校验，在分析器已注入且角色仍未解析时按选中的资产 ID 逐张读取；没有任何按上传顺序赋予角色的分支。
- 视觉适配器的结构化输出预算采用 OpenMontage 固定来源配置中的 `4096`；这是为避免兼容视觉端点在合法 JSON 尚未结束时截断的边界适配，角色枚举、解析规则和错误边界没有变化。定向单测同时锁定该请求参数。
- `apps/control-api/tests/c11-creative-planning-routes.test.ts`：历史 READY 图片补分析并持久化 `2/2 PASS`；明确图片用途优先且视觉分析调用数为 `0`，`1/1 PASS`。
- `pnpm --filter @alchemy-video/control-api test`：`60 PASS / 1 SKIP / 0 FAIL`（SKIP 为既有 PostgreSQL 依赖测试）。
- `pnpm --filter @alchemy-video/reference-analysis test`：`2 PASS / 0 SKIP / 0 FAIL`。
- `pnpm --filter @alchemy-video/domain test`：`48 PASS / 0 SKIP / 0 FAIL`。
- `pnpm typecheck`：全工作区通过。

当前代码和离线行为证据达到 `READY_FOR_AUDIT`；本轮已在用户明确授权下用本地诊断图片完成一次真实视觉服务 smoke，仍需用“保险AI介绍”项目的无用途说明历史提示词做一次真实规划回归并由用户人工确认。未配置时保持既有 `WAITING`，不得把测试夹具结果当作真实识别完成。

## 7. 本轮真实配置与 smoke 证据（2026-09-02）

- 从用户提供的本地凭据文件读取令牌，仅写入被 `.gitignore` 忽略的工作区 `.env.local`；没有写入代码、文档、日志或测试夹具。
- 配置映射为 `REFERENCE_VISION_BASE_URL=https://aiself.vip/v1`、用户文件中的默认模型 `doubao-seed-2-0-lite-260428` 与 `REFERENCE_VISION_API_KEY`。
- 通过 `OpenAiCompatibleReferenceVisionAnalyzer` 对 `.codex-longrun/diagnostic-maoshan-latest-contact.jpg` 发起一次真实多模态请求：HTTP 200，结构化 JSON 完整解析，返回 `SCENE`、有限置信度、摘要和 5 个对象；没有保存原始响应或凭据。
- 兼容端点在较小响应预算下会截断合法 JSON；适配器的 `max_tokens=4096` 与 OpenMontage `config.yaml` 的来源配置一致，定向单测锁定该参数。未改变角色枚举、解析规则、业务状态或公开契约。
- 真实服务 smoke 不等同于项目验收；Control API 已启动实例需重启后才会读取新的 `.env.local`，然后再对目标项目执行规划请求和人工确认。
