# AI 企业内容生产平台：测试与验收策略

> **2026-09-01 当前执行口径**：自动旁白不要求用户上传音频或样音；Native Grok 与显式 Doubao 的真实对照仅在用户已授权的本机运行中执行，不能进入普通 CI。仓库默认/CI 仍为 Mock，真实产物必须单独记录 MIME、SHA、时长、调用次数和人工听看结果；Veyra、共享积分、VPS、部署仍不在本轮范围。

## 1. 测试目标

测试不是章节完成后的附属步骤，而是每章 Exit Gate 的审计证据。优先验证状态、幂等、权限、恢复、资产完整性和密钥边界，再验证 UI 外观。

## 2. 测试层级

| 层级 | 目录 | 目标 | 是否访问真实 Provider |
| --- | --- | --- | --- |
| 领域单测 | `tests/unit/domain` | 状态机、规则、金额、引用和错误 | 否 |
| 契约测试 | `tests/contract` | HTTP、事件、ProviderPort、CreditPort、脱敏 | 否，使用 fake/fixture |
| 持久化集成 | `tests/integration/persistence` | PostgreSQL 迁移、事务、workspace 隔离 | 否 |
| 队列集成 | `tests/integration/queue` | Redis/BullMQ、outbox、重试和死信 | 否 |
| 存储集成 | `tests/integration/storage` | MinIO 上传、签名 URL、hash 和权限 | 否 |
| E2E | `tests/e2e` | Web 从项目到视频播放的闭环 | Mock Provider |
| 真实能力认证 | `tools/sub2api-video-certifier` | Grok/Seedance 实际字段与媒体能力 | 仅显式 live |

## 3. 每章最低测试要求

| 章节 | 最低测试 | 必须保存的证据 |
| --- | --- | --- |
| C0 | 文档链接、命名、配置扫描 | 检查输出、决策记录 |
| C1 | Compose config、healthcheck、workspace install | 启动日志、版本输出 |
| C2 | schema、状态机、幂等、契约导出 | 单测报告、schema snapshot |
| C3 | API response、Dev Identity、workspace auth | HTTP contract report |
| C4 | upload/confirm/download、跨 workspace | Playwright 视频/截图、对象 metadata |
| C5 | duplicate delivery、worker restart、dead letter | 任务时间线、队列记录 |
| C6 | Mock submit/poll/download、E2E playback | MP4 hash、ffprobe、E2E report |
| C7 | SUB2API 8 个离线契约用例 | fixture、mapper report |
| C8 | 显式 live 的最小认证用例 | 脱敏 capability report |
| C9 | fake Veyra、扣费幂等、402/409、恢复 | billing audit report |
| C10 | PDF/DOCX/PPTX/XLSX stream conversion | conversion artifact、网络阻断证据 |
| C11 | artifact revision、引用、PromptPackage | schema、revision trace |
| C12 | tool contract、ffprobe、合成、QC | runtime report、成片 hash |
| C13 | secret scan、备份恢复、发布检查 | release audit |

## 4. 必须覆盖的行为

### 4.1 幂等和重复

- 相同 `Idempotency-Key` 与相同请求体返回第一次结果。
- 相同 key 与不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。
- Queue 至少一次投递不产生重复业务状态变化。
- Veyra 同一扣费 key 重放返回 `replayed=true`，本地只生成一条 receipt。

### 4.2 崩溃和恢复

- submit 前崩溃：可以安全重新提交。
- 已持久化 `provider_request_id` 后崩溃：只能查询/下载，不重复 submit。
- Provider 成功、下载未完成时崩溃：恢复下载和验证。
- `BILLING_FAILED` 重试：只扣费，不重复生成。
- SSE 断线：用 `Last-Event-ID` 补发事件。

### 4.3 安全和数据隔离

- 未授权 workspace 不能查询、下载或修改资源。
- 事件、日志、错误、fixture 不含 Key、Token、ticket、cookie 和 presigned query。
- 文档 Runtime 不允许访问任意网络 URI。
- Web 不可访问 `/internal/*`、Provider 原生 response 和 Veyra endpoint。

## 5. 测试命令约定

建仓后根 `package.json` 应提供以下命令；实现前不要求现在执行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:all
```

真实认证单独执行，不被 `test:all` 调用：

```text
pnpm certify:sub2api -- --offline
pnpm certify:sub2api -- --live --profile <explicit-profile> --max-submissions 1
```

## 6. 通过标准

- 新增业务代码必须有相应层级测试。
- 共享契约变更必须同时更新 schema、实现、fixture 和测试。
- 失败测试不能通过跳过、放宽断言或改为只测 mock 来掩盖。
- 测试命令、结果、环境、fixture 版本和未覆盖风险写入章节审计记录。
- 没有证据路径的章节不得 `ACCEPTED`。
