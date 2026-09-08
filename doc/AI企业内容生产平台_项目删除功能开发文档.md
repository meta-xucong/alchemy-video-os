# 项目删除功能开发文档

## 1. 范围与原则

本功能只处理平台项目实体，不删除对象存储文件、任务快照或历史产物。项目删除采用服务端软删除，沿用现有 workspace 查询、命令幂等和状态封装；浏览器不能通过本地状态伪造删除成功。实现前提是 `DELETE /api/v1/projects/{project_id}`、错误码、状态枚举和测试一起落地。

## 2. 公开契约

- `DELETE /api/v1/projects/{project_id}` 必须携带 `Idempotency-Key`，无请求体，成功返回 `200` + `Project`。
- `Project.status` 新增 `DELETED`；创建和更新命令仍只允许 `ACTIVE`/`ARCHIVED`。
- `PROJECT_IN_USE` 为 `409` 非可重试错误。项目存在进行中的 TaskRun 或 ProductionRun 时拒绝删除。
- 不存在的项目、跨 workspace 项目统一返回 `404 NOT_FOUND`；同 scope、同 key、同请求重放第一次结果，不同请求体返回 `409 IDEMPOTENCY_CONFLICT`。
- 删除成功后，公开项目列表、详情和后续项目命令将项目视为不可见；历史任务、资产、产物和审计事实保留，不能原地替换或物理清理。

## 3. 实现边界

1. ControlPlaneStore 与 Drizzle/InMemory 实现共享同一软删除和幂等语义；数据库实现额外在事务内检查活动任务/制作批次，路由在所有实现上做同口径预检。
2. 公开查询必须过滤 `DELETED`；更新、上传、生成等依赖项目详情的命令因项目不可见而返回 `404`。
3. 前端只展示服务端删除能力：点击后展开简短说明，要求输入“删除”二次确认；请求进行中显示“正在删除”，失败保留项目和确认上下文。
4. 不新增自动级联删除、对象存储清理、前端本地移除、静默重试或绕过 API 的数据库操作。

## 4. 验证

- 契约测试：38/38；状态/错误码/OpenAPI 含 DELETE。
- Control API/InMemory：20/20；覆盖创建→删除→列表/详情不可见、幂等重放、不同 key 的重复删除 404、活动任务 409 和 workspace 隔离。
- Persistence：本地 PostgreSQL 控制面集成 1/1，证明事务内软删除、幂等快照和查询过滤；Drizzle 代码同时检查活动 TaskRun/ProductionRun，但尚未伪装成独立数据库活动任务夹具证据。无数据库时该集成测试应保持 skip。
- Studio：40/40；覆盖删除按钮、二次确认、失败文案和 API 调用存在；不在测试中删除真实用户项目。`c06-studio-ui-e2e.py` 已更新为只验证未输入确认词时确认按钮禁用。
- contracts/persistence/control-api/studio typecheck 均通过。全量 persistence 套件仍有一条既有生产 QC 集成失败，与本功能无关，不能归因于项目删除。

## 5. 与旧设计的关系

旧《项目隔离极简 AI 视频创作前端开发设计》4.3 的“删除契约缺口/不得落地控件”是历史状态。本文件定义的契约与实现优先；旧文档必须保留历史上下文并标注已被本文件 superseded，不能继续作为“删除未开放”的当前事实。
