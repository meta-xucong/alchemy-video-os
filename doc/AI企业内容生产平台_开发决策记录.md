# AI 企业内容生产平台：开发决策记录

本文件记录影响多个模块、目录、数据契约或外部接入的不可随意反转决策。普通实现细节不在此记录；需要修改已接受决策时，新增 ADR 条目，不覆盖原记录。

## 决策状态

| 状态 | 含义 |
| --- | --- |
| `PROPOSED` | 提议，尚未作为实现依据 |
| `ACCEPTED` | 当前开发基线，后续代码必须遵守 |
| `SUPERSEDED` | 已被新决策替代，保留用于审计 |
| `REJECTED` | 明确不采用 |

## ADR-0001：采用 TypeScript monorepo 作为控制面

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 日期 | 2026-08-12 |
| 范围 | 前端、Control API、Worker、Contracts、Domain |
| 决策 | 使用 pnpm workspace；Nuxt 3、Hono、Drizzle、BullMQ、Zod；Python 仅用于后续 MarkItDown/OpenMontage Runtime |
| 原因 | 前后端共享契约，复用 Huobao 技术骨架，减少 MVP 双运行时复杂度 |
| 影响 | Python 服务通过内部 API 接入，不直接共享数据库内部实现 |

## ADR-0002：Control API 是唯一业务数据库写入口

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | Web 和 Worker 不直接互相调用进程函数；业务写入由 Control API 或受控内部 API 完成；Worker 通过持久化 TaskRun 和 outbox 工作 |
| 原因 | 支持审计、重启恢复、未来 CLI 复用和模块替换 |
| 拒绝方案 | 复用 Huobao 的 Web 进程内 `processTask`、内存轮询和本地文件作为生产事实 |

## ADR-0003：统一目录使用正式运行面命名

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 使用 `apps/studio-web`、`apps/control-api`、`workers/provider-worker`、`packages/*`、`services/*`；早期文档中的 `apps/web`、`apps/api`、`apps/worker` 只作简称 |
| 原因 | 与长期整合方案和独立部署责任一致 |
| 影响 | 新代码、新测试和新文档不再使用旧简称作为真实路径 |

## ADR-0004：领域契约和外部 Provider 字段分层

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | TypeScript 内部使用 camelCase，平台 HTTP/Event/数据库使用 snake_case，外部 Provider payload 保留其原字段；边界通过 mapper/serializer 转换 |
| 原因 | 最大化复用 Huobao/SUB2API 字段，同时避免外部命名污染数据库和 API |
| 例子 | 内部 `taskRunId` -> 平台 JSON `task_run_id`；Provider `request_id` -> 内部持久化 `provider_request_id` |

## ADR-0005：TaskRun 是长任务唯一事实来源

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 所有异步生成、解析、渲染和 QC 都由 TaskRun、ProviderAttempt、OutboxEvent 和事件记录驱动 |
| 原因 | 进程重启、浏览器关闭、重复投递和上游轮询不能丢任务或重复提交 |
| 影响 | 页面 store、Redis 临时状态、OpenMontage `events.jsonl` 不能作为任务真相 |

## ADR-0006：资产使用对象存储，数据库保存可审计元数据

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 本地使用 MinIO S3 API，媒体二进制不进入数据库；保存 object key、MIME、大小、SHA-256、版本和 workspace/project 关系 |
| 原因 | 使本地和未来 VPS 的存储边界一致，避免容器共享本地路径 |

## ADR-0007：本地默认 Mock，真实 Provider 显式开启

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | `VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false` 为本地默认；真实调用必须通过 capability 认证、显式开关和用户授权 |
| 原因 | 本地开发和 CI 不消耗外部额度、不暴露 Key、不依赖网络 |

## ADR-0008：Sub2API 是共享余额唯一权威

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 不复制 Sub2API 用户、余额或扣费账本；只通过 CreditPort 调账户和扣费接口，并保存 usage receipt |
| 原因 | 保持余额、原子扣减、并发和幂等裁决只有一个权威 |
| 扣费时序 | 余额预检 -> Provider 产物验证 -> `BILLING_PENDING` -> 幂等扣费 -> 成功发布结果 |

## ADR-0009：学习用途不阻塞源码复用

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 当前仅用于学习和本地研究，不因参考仓库许可证阻塞实现；仍登记源仓库、commit、迁入文件和本地改动 |
| 未来条件 | 如果转为商用或公开分发，必须重新进行许可证、依赖和分发审查 |

## ADR-0010：部署与域名延期

| 项目 | 内容 |
| --- | --- |
| 状态 | `ACCEPTED` |
| 决策 | 当前不操作 VPS、DNS、HTTPS、生产 Sub2API、`video.aiself.vip` 或共享积分真实开关 |
| 原因 | 先在本地完成可审计的 MVP 和 Provider 契约，减少部署状态污染开发验证 |

## 新决策模板

```text
## ADR-XXXX：标题

状态：PROPOSED / ACCEPTED / SUPERSEDED / REJECTED
日期：YYYY-MM-DD
影响章节：Cxx、Cyy

上下文：
决策：
考虑过的方案：
选择原因：
影响：
迁移/回滚：
审计证据：
```
