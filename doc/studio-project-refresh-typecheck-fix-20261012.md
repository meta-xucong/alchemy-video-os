# Studio 刷新与重试回执边界修复（2026-10-12）

## 范围与来源

固定基线：`2c614c508de4b597fa9f69b21ace2499ee38f231`。仅调整 Studio 的既有平台 UI 外壳；不改变公共 DTO、规划、Provider、计费、数据库或 Worker 行为。

- `apps/studio-web/app/pages/projects/[project_id].vue::refreshCurrentProject` 在 async IIFE 的初始化路径中引用尚未赋值的 `refresh`，导致 CI TS2454；同步抛错还会触发运行时 TDZ。
- 同文件三个生成/片段/合成 retry catch 及 `ProductionProgressPanel.vue` 把所有异常表述为“未提交”，但网络丢失或 5xx 不能证明服务端未接受；旧错误还会遮挡后来权威更新。
- 来源边界复用同基线既有 project/epoch fence、Promise 身份 single-flight、`useCreationProgress.ts` 的服务端 `updated_at` 单调比较，以及 `useControlApi.ts` 已有公开状态/目标 ID。错误分类以 `apps/control-api/src/app.ts` 的 retry 路由与固定应用错误为准，不解析错误文案。
- 独立审计另确认 `waitForAutoStoryboard/startAutomatedProduction` 在项目导航后可继续发后继命令，且读取新项目的可变音乐/字幕设置。本轮只给该既有流程补操作边界和输入快照，不修改规划算法、轮询时间或审批顺序。

## 最小修复设计

1. 将 flight 清理放到 Promise 完成赋值后的外层 try/finally；仍只清理自身 flight。
2. 有明确应用 4xx 拒绝才展示“本次重试未提交”；网络、5xx、非契约异常展示“重试结果待确认”，不把未知回执当确定失败。
3. 在命令前记录项目与精确目标（TaskRun；或 ProductionRun + segment ID/sequence；或合成 ProductionRun）及提交前服务端更新时间。只有匹配目标且进入活动/成功状态时才清除当前错误；其他历史成功、别的段不能清除。缓存中的旧状态必须严格更新时间；同时间戳只允许在命令回执之后发起、仍处于当前 project/epoch/request 的权威读取中核对。
4. 未知状态下禁止用新幂等键再提交生成/重试。默认只做既有只读刷新。提供用户显式点击的“按原请求继续”，固定保存原 project、目标、sequence、幂等 key，使用原有固定 `{}` body；不从当前响应式选项重新组成请求，不自动 POST。界面明确说明：原 key 避免重复，但如果原请求未到服务端，继续可能首次提交执行。复用三个 retry 端点既有 scope/key/hash 去重，不新增协议。
5. Production GET 增加请求序号；只有最新请求可以更新视图或错误。重试回执成功/失败都使前一 epoch 的 GET 失效。`project`/`productionRuns` 以 `cache: no-store` 读取；当前权威 GET 允许同 timestamp 接受新值。命令回执仅在提交后没有权威 GET 已应用时允许同 timestamp 替换；迟到 POST 不覆盖已观察到的同 timestamp SUCCEEDED。不设置状态排名，不阻止合法 FAILED→GENERATING 重试。命令后再次 fresh GET 收敛；显式同 key 继续只恢复受理事实，不把历史 QUEUED 回执当当前状态，必须从 fresh GET 展示当前 FAILED/SUCCEEDED。默认无调用上下文的 merge 仍保守保留同时间戳旧值，且任何读取不接受更旧时间戳。
6. 自动规划复用既有 `createAsyncOperationFence`。项目导航/卸载使操作失效；每次 await 后核对项目与操作 token，失效则不发后继命令、不回写页面、不清理新操作 busy/error。首个 await 前拷贝 brief、delivery、music、audio 设置，后续命令只使用该快照。
7. 成功回执与最新投影分别建模：回执确认后显示“原请求已受理，正在核对最新状态”，仍保存原请求、禁用新 key，直到当前 epoch 中精确目标的 fresh GET 确实成功。读取失败/迟到/其他目标不会解除此阶段；确认过原回执后，精确目标 fresh GET 的 FAILED/BLOCKED 可以作为当前终态显示，不能把它误标为原命令拒绝。不会把吞掉读取错误的 refresh Promise 完成当成功。
8. 显式同 key 继续仍在等待回执时，SSE/GET 可以更新当前投影，但不销毁此次 request/target 身份。回执成功或再次丢失后，以新 epoch 的 GET 再核对；避免“GET 先清身份、晚回执/晚错误又设 pending/unknown”的无目标永久阻塞。三种入口覆盖晚 resolve 和晚 reject。

## 验收边界

公开 DTO 没有 attempt/revision 或 command correlation。只读核对只能证明精确目标在当前权威读取中进入活动/成功状态，不能证明它必然来自该 HTTP 命令。失败到失败时只读核对继续保留未知；用户可显式按原请求继续，通过既有幂等记录恢复原受理结果，再读取当前终态。无法取得回执/当前权威读取时不声称命令被拒绝，也不自动重提。未知回执及其原 key 只在当前页面内保留，不构成跨页面重载的持久化防重保证，最终防重仍由服务端控制面与幂等约束负责。导航取消只能停止尚未发出的后继请求，不能撤销已被服务端接受的命令。

本轮仅离线/Mock 测试；不访问 VPS、真实 Provider 或用户本机。完整浏览器 E2E 与生产验收另行进行。

## 本轮验证

在 dot 云端隔离 checkout，Node `v24.19.0`，使用既有锁文件安装的本地二进制：

- 固定基线 `refreshCurrentProject` 的同步抛错路径实际执行，得到 `ReferenceError: Cannot access 'refresh' before initialization`；同一夹具执行修复函数可正常处理错误并释放 flight。
- 在 `apps/studio-web` 执行 `node --test tests/*.test.mjs`：123/123 通过，0 失败、0 跳过。
- 新增 `project-refresh.test.mjs`：10 条实际页面 handler 控制流回归，覆盖 single-flight、同步/异步失败、旧 project/epoch 响应、旧 flight 不清新 flight。
- 新增 `project-planning-fence.test.mjs`：13 条实际规划 handler 回归，覆盖十个 await/等待阶段导航、A→B→A、输入快照冻结、路由/卸载失效。
- 新增 `project-retry-reconciliation.test.mjs`：29 条，覆盖错误分类、精确目标、新旧 GET/POST 同 timestamp 竞态、三入口原 key 显式继续、失败到失败、历史 QUEUED 回执不覆盖当前 SUCCEEDED、回执成功但 GET 失败时继续阻止新 key、继续期间 GET 先成功而回执晚 resolve/reject。
- `./node_modules/.bin/nuxt typecheck`：通过，TS2454 已消除。
- `./node_modules/.bin/nuxt build`：production build 通过。
- `git diff --check`：通过。

测试使用实际页面函数的 TypeScript 转译和延迟 Promise 替身，不复制生产控制流；包含源码契约断言，但不将其等同于浏览器/真实后端集成验收。未执行提交、推送、部署、真实 Provider 调用或 VPS 操作。
