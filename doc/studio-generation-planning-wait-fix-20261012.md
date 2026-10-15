# Studio 自动生成规划等待修复（2026-10-12）

## 范围与根因

用户点击“重新生成视频”后，Studio 先创建 Creative Brief 并启动规划，再等待同项目的新 Storyboard。现场记录显示，2026-10-11 19:53 UTC 创建 Brief，约 44 秒后 Storyboard 才进入 `READY_FOR_REVIEW`；原前端最多等待 `40 × 500ms`，约 20 秒，因此流程在规划完成前超时。该次请求没有继续创建 Delivery Plan/Production Run，也没有提交视频 Provider 或产生扣费。

## 修复

- 只调整 Studio 的规划等待：最长 180 秒、每秒查询 Storyboard。
- Project/Brief 状态刷新限为每 5 秒一次，避免把高频 Storyboard 轮询变成重复刷新整个项目。
- 继续只接受开始时间之后新建、状态为 `READY_FOR_REVIEW` 的 Storyboard；Brief 明确失败时立即报 `PLANNING_FAILED`，超过等待上限报 `PLANNING_TIMEOUT`。
- 分镜审批、Delivery Plan 创建/审批、Production Run 创建及 Provider 调用顺序均未改变。
- 现有候选仍通过 project + `created_at >= startedAt` 关联；没有新增跨标签页/并行规划的服务端 correlation ID。并行生成可能相互看到新 Storyboard，是本次窄修复未处理的既有竞态边界。

## 验证与边界

- Studio 定向测试：`node --test tests/project-flow.test.mjs`，26/26 通过。
- 完整 Studio 测试：`node --test tests/*.test.mjs`，47/47 通过、0 失败、0 跳过。首次 sandbox 默认运行中的 loopback smoke 被 `EACCES` 拦截；经授权在允许 loopback 的环境重跑后通过。
- `pnpm run build`（Studio production build）通过；Node 报一个既有 trailing-slash exports deprecation warning，未阻断产物。
- 当前测试以源码契约断言覆盖等待上限、轮询间隔、旧分镜排除、失败和超时分支；没有以真实异步 Planner 或真实 Provider 验证完整视频生成。
- 本地工作副本基于 `071f46e0321300656972c48697e2703fe2ba736c`，而 GitHub PR #4 当前 head 为 `184cc7727d6a479b78cbb96ed795ad8bb524969f`。只对照了相关源文件控制流，确认补丁可应用；此文档不声称整个本地仓库已同步到 PR head。GitHub 最新提交及 VPS 部署状态应在完成远端提交、CI 和部署后另行记录。
- 本次不改 Provider 认证、商业模式/计费开关、数据库迁移或审计门禁；不把 UI 规划流程恢复/延长等同真实 Provider 可用性或完整成片验收。
