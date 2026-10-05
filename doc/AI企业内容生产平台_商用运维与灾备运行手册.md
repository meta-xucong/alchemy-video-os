# 商用运维与灾备运行手册

## 使用边界

本手册只描述上线前必须演练的操作，不自动连接生产环境。每次演练必须使用隔离数据库、隔离对象存储和临时凭据，记录命令、退出码、时间、备份 hash、恢复 hash 和 RPO/RTO。备份中含用户数据，目录必须是受控私有目录，禁止提交 Git。

## 日常发布门

1. `COMMERCIAL_MODE=true`、`NODE_ENV=production`、Veyra auth/credit、真实已认证 Provider、reviewed Veyra Nginx、HTTPS CORS 和全部 secret-manager 值由 preflight 明确提供。
2. 运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、生产依赖审计、镜像扫描、SBOM 和签名检查；任何集成 `SKIP` 都是阻断。
3. 迁移前执行 `backup-postgres.sh`；确认迁移兼容窗口和回滚点，再执行迁移。应用健康必须同时通过 live/readiness。
4. 仅使用已签名镜像 digest 发布；失败时停止流量、恢复数据库/对象备份、回滚镜像并重新执行就绪与关键 E2E。

## 备份与恢复

- PostgreSQL：每日 custom dump，生产另行启用 WAL/PITR；恢复用 `restore-postgres.sh` 且必须显式 `CONFIRM_RESTORE=I_UNDERSTAND_DATA_REPLACEMENT`。
- MinIO：启用版本/生命周期策略，使用最小权限 `mc` 凭据执行 `backup-minio.sh`；恢复后逐文件校验 SHA-256。
- Redis：只保存可重建的队列事实；业务事实必须在 PostgreSQL/outbox，Redis 恢复不能代替数据库恢复。
- 目标值（未经演练不得宣称）：RPO ≤ 24 小时、RTO ≤ 4 小时。演练测量值写入章节审计记录。

## 监控与告警最低集合

数据库/Redis/MinIO 可用性、Control API readiness、队列积压与 DLQ、Provider 失败/延迟、BILLING_PENDING、存储校验失败、磁盘/内存、TLS 到期、备份新鲜度和成本异常必须有指标、阈值、通知接收人和一次告警演练。只有 stdout 日志不构成商用可观测性。

## 数据治理与事故

上线前必须批准保留期限、对象清理/彻底删除、导出、备份擦除、审计留存、隐私请求 SLA、滥用处理和事故响应。当前代码未证明这些外部门禁，状态保持 `BLOCKED`。
