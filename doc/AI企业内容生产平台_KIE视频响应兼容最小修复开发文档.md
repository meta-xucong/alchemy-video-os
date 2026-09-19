# KIE 视频响应兼容最小修复

状态：`LOCAL_VERIFIED_PENDING_SUB2API_AUDIT`

## 1. 结论

最新失败任务已经通过参考图 relay：Control API 在提交窗口收到 12 次 `GET=200`，并且存在一条 `provider_attempt`。因此本次不能再归因于 Quick Tunnel 或参考图不可读；失败点位于 Aiself/Sub2API 到 KIE 的提交阶段，KIE 尚未返回可持久化的任务 ID。

KIE 原生接口的成功包使用 `data.taskId`，状态和错误也可能位于 `data.status`、`msg` 或 `data.msg`。Alchemy 原有兼容层只读取顶层 `id/request_id/status/state`，会把这类合法兼容包误判为协议错误。

另外，Sub2API 主仓库已有同类兼容性问题记录：兼容上游返回 `task_id`（或 `data.task_id`、`video.task_id`）时，如果网关只提取 `request_id/id`，会导致任务提交后无法绑定到所选账户，后续轮询表现为找不到任务。VPS 上的 Sub2API 必须单独核对这一提取逻辑；这不是 Alchemy 全局请求体可以修复的问题。

## 2. 最小改动

仅扩展 Sub2API 响应解析，不改变现有请求格式和路由：

- `packages/provider-video/src/sub2api/adapter.ts`
  - 接受顶层、`data` 或 `video` 内的 `id`、`request_id`、`task_id`、`taskId`。
  - 接受顶层或 `data` 内的 `status/state`。
  - 将 KIE 风格 `code >= 400` 映射为不可重试的 Provider rejection。
  - 保留字段冲突检查，未知结构仍 fail-closed。
- `packages/provider-video/src/sub2api/errors.ts`
  - 解析 `msg`、`data.msg` 等脱敏错误字段；不记录原始授权信息或签名 URL。
- `packages/provider-video/tests/sub2api-adapter.contract.test.ts`
  - 增加嵌套 `data.taskId`、嵌套终态、KIE rejection 回归测试。

本补丁不把 Alchemy 的 flat `/videos/generations` 请求改成 KIE 原生 `/api/v1/jobs/createTask`；Wokey、KIE、Subrouter 等账户的路由投影必须由 Sub2API 的 account/transport profile 完成。否则全局改请求体会破坏现有 Wokey 线路。

## 3. 验收

- `pnpm --filter @alchemy-video/provider-video test`：63/63 通过。
- `pnpm --filter @alchemy-video/provider-video typecheck`：通过。
- `pnpm --filter @alchemy-video/task-worker test`：37 通过、5 个既有基础设施条件跳过、0 失败。
- 未执行真实视频提交、未改变 Sub2API 配置、未部署生产。

上述验证只证明 Alchemy 兼容层可正确解析 KIE 风格响应；它不能把提交阶段的 HTTP 502 变成成功。若 Sub2API 在提交阶段没有返回任务 ID，根因仍需在其 KIE 账户 transport、模型映射、账户权限/额度或上游响应中取证。

## 4. 后续联调门禁

只有在 Sub2API 端确认 KIE transport 将：

```text
model -> grok-imagine-video-1-5-preview
prompt/image_urls/aspect_ratio/resolution/duration -> input
POST /api/v1/jobs/createTask -> 统一的 /videos/generations 兼容响应
```

并保留 Wokey 的现有投影后，才进行一次有界真实验证。拿不到 `provider_request_id` 时不得自动重复 POST；应先保存上游 HTTP 状态和脱敏错误摘要，再由 Smart Router 临时冷却该账户并尝试同组备选线路。
