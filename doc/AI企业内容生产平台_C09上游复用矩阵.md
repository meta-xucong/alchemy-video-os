# AI企业内容生产平台：C09 上游复用矩阵

状态：`IN_PROGRESS`。本矩阵只覆盖 C09-A 的离线 Veyra identity/shared-credit foundation；不授权真实账户、票据、Token、网络或扣费。

| 平台目标 | 事实来源与符号 | 薄适配位置 | 保留内容 | 舍弃内容和理由 | 回归验证 |
| --- | --- | --- | --- | --- | --- |
| CreditPort DTO 与 Veyra 字段 mapper | 本机 `D:\AI\SSH\sub2api\backend\internal\veyra\routes.go` 的 `debitRequest`、`debitResponse`、`accountSummaryResponse` | `packages/contracts/src/credit.ts`、`packages/credit-veyra/src/mapper.ts` | `user_id`、`amount`、`idempotency_key`、`source`、`reference_id`、`balance_after`、`replayed` 和 `data` envelope | Gin handler、Token guard、真实路由与所有用户数据。平台 adapter 只能接收 injected fake transport。 | path/method/header/body/data-envelope fake contract tests |
| 原子 debit 与同键重放/冲突语义 | 本机 `D:\AI\SSH\sub2api\backend\internal\veyra\billing.go` 的 `DebitBalance`、`MemoryDebitLedger.Execute`、`debitFingerprint` | `packages/domain/src/billing.ts`、`packages/persistence/src/billing-repository.ts` | `idempotency_key + user + amount + source + reference_id` 的不可变输入语义；同键回放、不同输入冲突 | Go ledger、余额变更、浮点金额、Sub2API 表和退款路径。平台只持久化 receipt，不计算/扣减余额。 | domain receipt invariant、PostgreSQL unique/replay/conflict tests |
| 账户/扣费请求职责划分 | 本机 Alchemy `app/services/veyra_auth.py:VeyraSub2APIClient` 与 `generation.py:create_image_job` | `packages/credit-veyra/src/adapter.ts`、C09 文档 | account/debit 分离、产物验证后 debit、成功后 usage receipt 的顺序 | `httpx`、settings/env、session、Cookie、JSONL、image fee、浮点比较和图像业务状态。C09-A 不装配任何运行时调用。 | injected transport calls; no `fetch`, `process.env` or runtime import scan |

## C09-A 约束

1. 只保留字段与错误语义，未复制任何本机上游源码。
2. `packages/credit-veyra` 不得导入 persistence、Worker、Control API、Studio、Provider 或页面模块。
3. `usage_records` 是接入侧 receipt；余额和原子扣减始终由 Sub2API 权威服务负责。
4. C09-A 的 fake transport 只能使用合成 fixture；fixture、错误消息和报告不含 Token、ticket、base URL、Cookie 或原始 payload。
5. `VeyraIdentityAdapter` 与票据交换仍是后续受控子阶段，当前仅保留文档化的身份映射边界。
