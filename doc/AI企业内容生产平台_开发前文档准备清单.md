# AI企业内容生产平台：开发前文档准备清单

## 1. 当前判断

本项目已经具备开始本地编码的最低文档条件。此前的三份总体/整合/部署补充方案负责回答“要做什么”和“如何吸收源仓库”；本轮新增的规格负责回答“第一版做到哪里”“模块如何通信”“共享积分怎样接”“真实视频能力怎样认证”；正式开发顺序和章节门禁统一由《正式开发总控文档》管理。

现行语音输入口径（2026-09-01）：自动视频由 Grok 原生音频或服务端显式 Doubao 生成音频，不要求用户上传旁白/样音；通用图片、资料、Logo、MUSIC 上传仍是独立资产能力。`NARRATION_SAMPLE`/`USER_SOURCE_AUDIO` 只做兼容与隔离测试。用户已授权本机实际模式，但仓库/CI 默认仍为 Mock，具体执行以 1.3.0《自动生成音频与视频匹配正式使用开发文档》为准。

剩余工作不再是继续堆叠宏观方案，而是按《正式开发总控文档》的 C00/C01 门禁建立代码仓库。部署域名、VPS、生产密钥和真实积分开关不属于本阶段的开工前置条件。

## 2. 已准备完成

| 文档/决策 | 状态 | 说明 |
| --- | --- | --- |
| 产品目标与完整开发方案 | 已完成 | 定义企业内容生产平台的长期能力 |
| 源仓库吸收/舍弃/融合方案 | 已完成 | 定义 Seedance、MarkItDown、OpenMontage、huobao-drama 的复用边界 |
| VPS 与 SUB2API 视频接入补充 | 已完成 | 描述未来部署与 API 接入，不阻塞本地 |
| 本地 MVP 执行规格 | 已完成 | 固定 Mock 闭环、端口、目录和验收 |
| 领域模型/API/事件契约 | 已完成 | 固定对象、状态、HTTP、SSE、outbox 和端口 |
| Sub2API/Alchemy 共享积分适配 | 已完成 | 对齐现有 Veyra 路由、扣费和幂等语义 |
| SUB2API 视频认证与夹具规范 | 已完成 | 规定离线测试、真人工实测和 feature gate |
| 正式开发总控文档 | 已完成 | 固定章节顺序、目录、命名、测试、验收和审计门禁 |
| C12.4/C12.5 最小化源仓库适配修改方案 | 已建立，现已冻结 | 仅保留历史错误路径修正和既有证据，不再作为当前能力清单或新增实现授权 |
| 多源仓库逐项迁移矩阵与冲突审计开发方案 | 当前基线 | 以四个固定源仓库的文件/符号为主键，先做来源映射和跨仓库冲突对账，再按 S01-S09 批次逐项薄适配、测试和审计 |
| 原仓库语音路线与旁白质量迁移修复开发文档 | 当前语音专项基线 | 只裁定 native Provider/TTS owner、来源 selector、样音 gate、实际时长/混音/QC 的冲突；不改变总控状态、公共契约或外部调用门禁；旧 C12.4/C12.5 语音路线文字按该文档标记为历史/已覆盖 |
| 开发决策记录 | 已完成 | 固定技术、数据、复用和部署延期决策 |
| 安全与密钥规则 | 已完成 | 固定本地无真实密钥和真实调用门禁 |
| 测试与验收策略 | 已完成 | 固定四层测试与章节证据要求 |
| 第三方来源与复用登记 | 已完成 | 固定上游 commit、复用范围和登记模板 |
| 章节开发执行模板/审计记录 | 已完成 | 固定逐章实施和审计格式 |

## 3. 开工前只需冻结的决策

这些决策已经落在《正式开发总控文档》和《开发决策记录》中，后续改动必须追加 ADR：

| 决策 | 当前建议 | 原因 |
| --- | --- | --- |
| 控制面语言 | TypeScript | 前后端契约共享，早期开发速度高 |
| 前端 | Nuxt 3 | 复用 huobao-drama 的技术路线和页面组织 |
| API | Hono | 轻量，适合内部 API 和 SSE |
| 数据库访问 | Drizzle + PostgreSQL | schema 与 TypeScript 类型靠近，事务明确 |
| 队列 | BullMQ + Redis | 适合视频长任务、重试和延迟轮询 |
| 对象存储 | S3 协议，开发用 MinIO | 本地与未来 VPS 的存储接口一致 |
| ID | ULID 字符串加实体前缀 | 日志可读、可排序、跨模块不冲突 |
| 本地身份 | `DevIdentityAdapter` | 不引入外部登录依赖即可跑通闭环 |
| 本地提供方 | `MockVideoProvider` | 没有 Key 也能稳定开发和 CI |
| 外部积分 | `NoopCreditAdapter` | 不在本地误扣真实余额 |
| 跨模块通信 | HTTP 命令/查询 + outbox 事件 | 禁止直接读其他模块数据库 |

如果这些建议不改变，本地项目可以直接按《本地 MVP 执行规格》的目录开始创建文件；不需要等待域名或 VPS。

## 4. 编码阶段必须产出的文件

以下文件是“写代码时生成”的契约产物，不是现在继续补充的设计文档：

- `packages/contracts/src/http.ts`、`domain.ts`、`events.ts`：Zod schema 和错误码。
- `contracts/openapi.yaml`、`contracts/asyncapi.yaml`：由源码 schema 导出，并进入 CI diff 检查。
- `infra/compose/docker-compose.local.yml`、`.env.example`：只含本地假凭据。
- `packages/persistence/drizzle/0001_*.sql`：按工作区、项目、资产、分镜、任务、outbox 顺序迁移。
- `packages/provider-video/src/mock/*`：确定性提交、轮询、成功/失败和 MP4 夹具。
- `apps/control-api/src/routes/*`：只编排端口和用例，不直接调用上游。
- `workers/provider-worker/src/jobs/*`：领取任务、提交/恢复、下载验证、结果事务。
- `apps/studio-web/pages/*` 与 `components/*`：项目页、资产上传、分镜编辑、任务状态和视频播放。
- `tests/contract/*`、`tests/integration/*`、`tests/e2e/*`：契约、恢复和网页闭环测试。

## 5. 仍建议补一页的非代码记录

这三项足够短，建议随第一次代码提交一起放进仓库：

### 5.1 `AI企业内容生产平台_开发决策记录.md`

记录技术选型、状态机是唯一真相、所有金额使用十进制字符串，以及“Sub2API 是余额权威、平台不复制账本”等不可逆决策。

### 5.2 `AI企业内容生产平台_安全与密钥规则.md`

至少写明：密钥只在服务端环境读取；浏览器只拿短时预签名 URL；日志脱敏；外部用户 ID 不作为本地授权依据；工作区检查必须在 repository 查询条件中完成；生产启用真实 provider 和 Veyra 必须显式开关。

### 5.3 `AI企业内容生产平台_测试与验收策略.md`

固定四层测试：纯领域单测、provider/credit 契约测试、PostgreSQL/Redis/MinIO 集成测试、Playwright 网页测试。真实视频认证不进入普通 CI，只运行离线 fixture。

## 6. 当前不应提前做的事项

- 不为 `video.aiself.vip` 写 DNS、反向代理、HTTPS 或生产 Compose。
- 不把 VPS 上的目录结构、生产端口或域名写死进本地代码。
- 不把真实 `SUB2API_VIDEO_API_KEY`、`X-Veyra-Internal-Token` 或会话密钥写进仓库。
- 不在本地为了“模拟真实”调用真实视频接口；Mock 和 fake server 足够覆盖逻辑。
- 不先做 MarkItDown、OpenMontage 和 Agent 全量移植。先让它们作为未来 worker 通过 `TaskRun`/`Asset`/事件接入。

## 7. 真实视频接入前置条件

当前专项补充（2026-09-01）：自动旁白不要求用户上传音频/样音；如用户明确授权本机对照，按最新《AI企业内容生产平台_自动生成音频与视频匹配正式使用开发文档.md》使用 Aiself Grok native 与显式 Doubao。默认 MVP/CI 仍为 Mock；通用参考图片、资料、Logo、MUSIC 上传不受影响。

本地 MVP 完成后，按以下顺序扩展：

1. 通过离线契约测试，确认 `Sub2ApiVideoProvider` 不依赖网络。
2. 在用户明确允许的 profile、调用次数和额度上限下，运行一次人工认证。
3. 用认证结果生成 capability snapshot，固定实际字段和状态映射。
4. 再把视频 API Key 放入 worker 的本地私有环境，验证提交、恢复和下载。
5. 若要使用共享积分，先完成 Veyra fake server，再单独验证真实账户查询和幂等扣费。
6. 只有视频提供方、下载校验和共享积分三条链路都通过，才允许开启对应 feature flag。

## 8. 部署前置条件（暂不执行）

部署阶段另行准备：VPS 资源与备份策略、对象存储持久卷、域名 DNS、反向代理、TLS、日志/监控、密钥注入、数据库迁移回滚、Sub2API `video` intent 与 token 权限、限流和费用告警。这些事项现在全部标记为 `DEFERRED_DEPLOYMENT`，不会阻塞本地开发。

## 9. 开工结论

现在可以开始创建 monorepo 和本地 Compose。正式第一章是 C01“Monorepo 与本地基础设施”；第一条业务闭环是 `POST /api/v1/shots/:shotId/generations` 经过 Mock Worker 生成可播放 MP4。编码过程中优先兑现契约和测试；任何新需求先进入 ADR 或变更记录，再修改模型和 API，避免参考仓库的变量反向侵入核心领域。
