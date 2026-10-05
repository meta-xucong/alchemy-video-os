# AI 企业内容生产平台：商用发布准备与验收总控文档

## 1. 文档状态

- 版本：`1.0.0-commercial-readiness`
- 状态：`IN_PROGRESS / NOT_READY_FOR_COMMERCIAL`
- 适用阶段：从本地 MVP 转入生产前准备；不授权真实 Provider、Veyra、VPS、DNS、TLS 或生产部署。
- 最高原则：本文件把“代码准备完成”和“可以对外收费运营”分开。所有未取得运行证据的项目必须保持 `BLOCKED`，不能用单测、配置文件或 Agent 自述替代。

## 2. 商用准入结论

商用准入必须同时满足 P0 门禁，并由独立只读审计员在《章节审计记录》中写入证据。任一项未满足，结论为 `NOT_READY_FOR_COMMERCIAL`：

1. 生产配置 fail-closed：禁止 Dev Identity、Mock Provider、bootstrap Nginx、关闭认证或关闭计费路径在商业模式启动。
2. 身份与授权：Veyra/本地身份真实运行，工作区越权负例通过，cookie 会话可过期/撤销，CSRF/Origin 门禁通过。
3. 数据与资产：PostgreSQL、Redis、MinIO 使用持久化和最小权限凭据；备份、恢复、迁移回滚和灾备演练有可复现记录。
4. 可靠性：健康/就绪探针、队列恢复、幂等、限流、资源上限、下载/解析边界和失败告警通过。
5. 供应链：锁文件、SCA、镜像扫描、SBOM、密钥扫描、镜像签名/来源证明和依赖许可证审查通过。
6. 运维：部署前置检查、迁移、回滚、密钥轮换、日志/指标/告警、数据保留/删除/导出和事故响应 runbook 齐全。
7. 真实能力：已启用的 Provider、音频、Veyra 共享积分和 profile 完成认证；本地 Mock/离线 fixture 只能证明代码行为。
8. 合规与商业运营：许可证/NOTICE、隐私政策、服务条款、DPA/分包商、支持与 SLA、费用和滥用策略经负责人/法律审核。

## 3. 本轮实现范围

### P0（本轮必须落地）

- Control API 商业启动配置检查、生产 fail-closed。
- live/readiness 健康端点与可配置 CORS。
- 请求体、生成设置、Provider 下载的资源上限。
- Cookie 会话安全约束和生产 Origin 门禁基础设施。
- Nginx 限流、安全响应头、内部路径隔离。
- CI：冻结安装、类型检查、测试、生产依赖审计、密钥扫描占位门。
- 备份/恢复/灾备演练脚本和操作 runbook（仅显式确认后执行）。
- 商用清单、许可证/来源登记、隐私/保留/删除/导出和事故响应模板。

### P1（上线前必须取得外部证据；代码未证明即阻断）

- PostgreSQL/Redis/MinIO/BullMQ 隔离集成与 E2E，不允许静默 skip。
- 真实 Provider、Veyra 身份/扣费、音频 profile 的认证及费用上限。
- 生产密钥注入、轮换、撤销、最小权限账户、TLS/WAF、监控指标和告警演练。
- 镜像非 root、资源限制、SBOM、漏洞修复、签名和可回滚发布。

### P2（规模化运营）

- HA/滚动发布/自动扩缩容、多地域灾备、完整审计链、客户支持和 SLA 自动化。

## 4. 验收证据格式

每项证据至少记录：命令或操作、commit/镜像 digest、配置摘要（禁止密钥）、开始/结束时间、退出码、结果文件 hash、失败复现和未覆盖范围。`SKIP` 只能标记为 `BLOCKED`，不能计入通过数。真实外部证据须在隔离环境完成并附额度、调用次数和人工复核记录。

## 5. 发布状态机

```text
IMPLEMENTED -> READY_FOR_AUDIT -> AUDITED
AUDITED + P0/P1 evidence -> READY_FOR_COMMERCIAL
READY_FOR_COMMERCIAL + owner/legal approval -> RELEASED
```

任何安全门失败、证据缺失、范围漂移、真实配置未验证或审计员无法访问目标环境，均回到 `BLOCKED`；不得自动修补后宣称通过。

## 6. 明确不在本轮自动执行

不会提交真实密钥、调用收费 Provider、修改 Veyra/生产数据库、SSH/VPS、DNS/TLS、发布镜像或接受法律条款。上述动作必须由负责人在具备隔离环境、预算和回滚方案后单独授权，并按本文件补证据。

## 7. 本轮实施与验证记录（2026-10-01）

已落地的本地准备项包括：商业启动 fail-closed、会话与 Origin 门禁、请求/提示词/Provider 下载上限、就绪探针、Nginx 安全与限流样例、非 root Node 镜像、CI/SCA/密钥扫描入口、PostgreSQL/MinIO 备份恢复脚本、运维灾备手册和许可证/来源清单。既有 V1 用户修改未清理；工作区仍保留未提交文件，未执行提交、推送或部署。

本轮可复现验证：

- `pnpm test`：退出码 `0`；各工作区通过，环境依赖的 PostgreSQL/Redis/MinIO/BullMQ 集成仍按现有测试门禁跳过，不能视为商用证据。
- `pnpm typecheck`：退出码 `0`（18 个工作区）。
- `python -B -m compileall -q services tools`：退出码 `0`。
- `pnpm audit --prod --audit-level=high --json`：退出码 `0`，`high=0`、`critical=0`。
- `docker compose --env-file infrastructure/deploy/.env.video.example -f infrastructure/deploy/docker-compose.video.yml config --quiet`：退出码 `0`。
- `git diff --check`：退出码 `0`；仅有 Git 的换行转换提示。

仍阻断商用验收：真实 Provider/Veyra/音频 profile 和计费证据、PostgreSQL/Redis/MinIO/BullMQ 集成与 E2E、备份恢复/PITR/异地演练、RBAC/配额/速率限制的生产验证、Redis/MinIO 最小权限与 TLS、指标告警/事故演练、SBOM/镜像扫描/签名、对象删除/保留/导出实测、许可证/隐私/条款法律批准，以及独立审计员对生产环境的可访问证据。当前结论保持 `NOT_READY_FOR_COMMERCIAL / BLOCKED`。
