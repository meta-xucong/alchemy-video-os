# VPS 媒体 Runtime 永久稳定与 AISelf 联调开发文档

状态：`ACCEPTED`（仅本轮 VPS Media Runtime route-guard 窄范围；独立审计已通过；只覆盖部署边界、内部 readiness 和客户端校验；不是整体平台生产验收或部署验收；不授权据此开启生产部署/Git 发布；QC-only replay 保持 `DESIGN_QUESTION/DEFERRED`，不等同 C13 状态）
日期：2026-09-10
契约基线：`v1.3.1-route-guard`，HEAD `a725adf`

此前的 pending/候选表述属于本窄范围收口前的历史快照；现以本首部 `ACCEPTED` 状态和第 7.3 节收口材料为准。该状态仅覆盖本窄范围，不改变总体章节状态，也不覆盖非目标、未实测边界及 QC-only replay 延期。

## 1. 目标与非目标

### 1.1 本轮目标

1. 解除 `production-worker`/`media-runtime` 与 `control-api`/`control-media-runtime` 的 `network_mode: service:...` 耦合，使任一 Runtime 可以独立重建而不改变调用方的网络命名空间。
2. 通过 Compose 内部 DNS 使用固定服务名：生产 Worker 使用 `media-runtime:3433`，Control API 使用 `control-media-runtime:3433`。Runtime 不发布公网端口。
3. 为 Media Runtime 增加无副作用的内部 liveness/readiness 语义，并以 readiness 作为调用方启动依赖；readiness 只检查 token 配置和本地 `ffmpeg`/`ffprobe`，不调用 Provider。
4. 将 Runtime URL 校验收敛为 loopback 或固定内部服务名与端口，拒绝任意公网主机、别名、子域名、凭据、路径和查询参数。
5. 为上述 transport/readiness 行为提供 fixture/mock/local 定向测试，为后续 AISelf 身份联调保留稳定的内部边界。

### 1.2 非目标

- 不修改 AISelf、Sub2API、Veyra 登录票据、视频 Provider 或共享积分协议。
- 不开启真实 Provider、真实 TTS、真实网络、VPS/SSH、DNS、TLS 或生产部署。
- 不把付费 Provider 健康检查加入 Runtime readiness；不通过健康检查消耗 Provider 配额或积分。
- 不修改媒体工具语义、提示词、参考图、音频来源/时长规则、计费比例、任务提交和 Provider adapter。
- 不新增 ProductionSegment 状态、公开 API、事件或持久化事实。
- 不在没有契约授权的情况下发明 QC-only replay；永久 QC-only replay 本轮明确延期。

## 2. 故障根因与边界

现有 Compose 让 Runtime 通过 `network_mode: service:production-worker` 或
`network_mode: service:control-api` 共用调用方的网络命名空间。这样虽然可以
让旧客户端访问 `127.0.0.1:3433`，但 Runtime 的独立重建、健康判断和调用方
生命周期被绑定在一起：调用方重建或命名空间尚未就绪时，已有 Worker 任务访问
loopback 会得到 `ECONNREFUSED`。Provider task 已成功并不等于本地 QC 可用；
因此原链路会进入“Provider 已有结果、QC 失败、整段 BLOCKED”的可见故障。

本轮把调用关系改为 Compose 私网服务发现：

```text
production-worker  -- http://media-runtime:3433/         --> media-runtime
control-api        -- http://control-media-runtime:3433/ --> control-media-runtime
```

两个 Runtime 只在 Compose 网络内 `expose: 3433`，没有 `ports` 映射。客户端
保留本地 loopback 兼容，但部署值只能是上面两个固定服务名及 `3433` 端口；
任意公网 URL、`localhost`、内部 IP、服务名子域名、非根路径和 URL 凭据均拒绝。

## 3. 来源与现行契约

本实现遵循以下仓库文档和既有代码，不改变它们的领域含义：

- `AGENTS.md`：本地 MVP 默认 `VIDEO_PROVIDER=mock`；Runtime 通过内部 API；
  不得将 Provider/密钥/数据库事实带入 Runtime；部署边界与密钥规则。
- `doc/AI企业内容生产平台_领域模型与API事件契约.md`：C12 Media Runtime
  本地默认仍为 loopback；VPS Compose 可使用固定内部 DNS 服务名加 `3433`，
  且不发布 host/public port，客户端只允许固定 allowlist。Runtime 工具语义、
  状态、事件、工作区边界和安全语义不变。
- `doc/AI企业内容生产平台_VPS常驻化与去SSH隧道开发文档.md`：VPS 只做
  Compose 运维，服务使用内部网络和 healthcheck，不改变业务状态机。
- `doc/AI企业内容生产平台_VPS与SUB2API视频接入补充方案.md`：AISelf/
  Sub2API 真实接入必须后置、显式授权；本轮不执行。
- `services/media-runtime/runtime.py`：`configured_binary` 是本地工具配置
  和 `MEDIA_RUNTIME_UNAVAILABLE` 的既有判定，不新增媒体算法。
- `apps/production-worker/src/media-runtime-client.ts` 与
  `apps/control-api/src/pixabay-music.ts`：既有内部 Runtime 客户端和 token
  边界；本轮仅补固定 Compose 服务名适配。
- `infrastructure/deploy/docker-compose.video.yml`：VPS canonical Compose；
  本文件是唯一部署拓扑来源。

### 3.1 冻结的状态约束

`ProductionSegment` 仍只有：

```text
PENDING | WAITING | GENERATING | CHECKING | ACCEPTED | FAILED
```

成功的 TaskRun 进入 `CHECKING`；只有真实 QC/媒体失败才允许按既有契约由
用户显式创建新的 TaskRun 重试。不能使用 SQL 标记、隐式 worker 状态或新事件
表达“同一个 TaskRun 只重放 QC”。

### 3.2 工作区基线对账

以下工作区改动在本轮开始前已存在，属于用户基线或既有兼容修正，不归因于本轮
Runtime 部署改造，也不回滚：`apps/studio-web/app/pages/projects/[project_id].vue`
的安全文案、`services/media-runtime/main.py` 的 Pixabay base64url 兼容修正及其
既有定向断言，以及未跟踪的 `.workbuddy/`。本轮只在这些基线上增加内部
readiness、固定 DNS URL 校验和文档对账。

## 4. 最小变更矩阵

| 范围 | 最小改动 | 保持不变 |
| --- | --- | --- |
| Compose 拓扑 | 移除两个 Media Runtime 的 `network_mode: service:...`；使用固定 DNS、`expose: 3433`、readiness healthcheck 和 `service_healthy` 依赖 | 无公网端口、无密钥新增、Document Runtime 和其他服务不改 |
| Runtime URL | Worker/Control API 客户端允许 loopback 或 `media-runtime`/`control-media-runtime:3433`；拒绝其他 URL 形态 | 不允许 Provider URL、浏览器传入 URL 或公网回退 |
| Runtime 健康 | 新增 `/internal/health/live`、`/internal/health/ready`；ready 只检查 token、ffmpeg、ffprobe | `/internal/v1/media/*` 路由、媒体校验、音频/视频工具行为不改 |
| 测试 | 增加固定服务名、拒绝公网 URL、readiness 正常/不可用测试 | 仅使用 mock/fixture/local，不执行 Provider、VPS 或真实网络 |
| QC 恢复 | 记录契约缺口并延期，不改状态/事件/API | 现有 TaskRun、result asset、事件和显式段重试语义不变 |
| AISelf 联调 | 仅保留部署边界和文档准备 | 不改 AISelf/Sub2API 协议，不开启 identity/credit/provider |

## 5. 契约与状态影响

本轮没有改动 `packages/contracts`、公开 DTO、ProductionSegment 状态、内部
事件 envelope、Control API 路由或数据库 schema。固定 DNS 主机名是部署传输
适配，不向浏览器公开，也不改变 C12 的媒体输入/输出语义。readiness 响应只
包含 `status` 与无敏感信息的错误 code；不返回 token、Provider 名称、模型、
对象 key、签名 URL 或原始响应。

### DESIGN_QUESTION：永久 QC-only replay（DEFERRED）

如果要求在 Runtime 暂时不可用时，服务端自动保留已有 `result_asset` 并在同一
`task_run` 上只重试 QC，则当前 C12 没有可表达该过程的公开状态、命令、事件
或幂等契约。直接写内部 SQL/worker 标记会绕过状态机，也无法证明恢复后与同一
`task_run/result_asset/event` 绑定且不重复 Provider submit。

因此本轮不实现该路径、不新增公共协议。待产品/契约审计明确是否需要新增版本化
的 QC replay 命令、事件和持久化字段后，再单独设计并测试。当前 Runtime 不可用
时只能按现有可恢复队列/任务处理；真实 QC/媒体失败仍走既有显式段重试（新
TaskRun）。

## 6. 安全与 AISelf 联调准备

- Compose 默认网络只承载内部服务名；Runtime 没有公网 `ports`。
- URL 校验是服务端固定 allowlist，不接受用户或 Provider 提供的主机名。
- healthcheck 不携带 Authorization，不读取外部 URL，只访问容器内 loopback。
- token 仍通过私有环境注入，readiness 不回显 token；本轮没有新增密钥。
- `VIDEO_PROVIDER=mock`、`VEYRA_AUTH_ENABLED=false` 等本地安全默认不变。
- AISelf 身份和 Sub2API 联调只能在后续显式授权阶段进行；本轮没有真实登录、
  余额查询、扣费、Provider submit 或健康探测。

## 7. 测试与联调验收

### 7.1 已加入的定向测试

- Worker Runtime client：loopback 和两个固定内部服务名可用；localhost、
  公网 IP/域名、错误端口、路径、凭据拒绝；原始 `?`、`#`、空 `@` 以及
  `/%2e`、`/./`、`/%2e%2e/` 等经 URL 规范化后可能伪装成根路径的输入也拒绝。
- Control API Pixabay client：固定内部服务名可用；localhost、公网域名、
  错误端口、凭据/query/fragment 拒绝，并覆盖同一组原始路径绕过样例。
- Media Runtime：live 为无副作用成功；ready 在本地工具配置有效时成功，
  缺 token 时返回可重试的 `MEDIA_RUNTIME_UNAVAILABLE`。

### 7.2 本轮验收边界

本轮只运行仓库内定向单测、Python 测试和静态 Compose 解析；不运行 Docker
部署、不连接 VPS、不访问真实 AISelf/Sub2API/Provider。生产验收还需要在
后续授权窗口证明：单独重建任一 Runtime 后 DNS、readiness、QC 队列恢复和
已有 result asset 的 C12 绑定；若要证明 QC-only replay，必须先解决上面的
`DESIGN_QUESTION`。

### 7.3 窄范围审计收口（2026-09-10；ACCEPTED，仅窄范围）

固定基线为 `HEAD=a725adf`、契约修订 `v1.3.1-route-guard`。静态 Compose
解析 `docker compose --env-file infrastructure/deploy/.env.video.example -f infrastructure/deploy/docker-compose.video.yml config --quiet`
通过；解析确认两个 Runtime 脱离 `network_mode: service:...`、只
`expose: 3433`、无 Runtime host/public `ports`，Worker/Control API 分别使用
`media-runtime:3433`/`control-media-runtime:3433`，对应依赖均为
`service_healthy` 且依赖图无环。定向证据为：

- Worker 完整测试（含 `validateMediaRuntimeUrl` raw URL allowlist）：`pnpm --filter @alchemy-video/production-worker test`=`72/72 pass / 0 fail / 0 skip`；
- Control API 完整测试（含 `HttpPixabayMusicClient` raw URL allowlist）：`pnpm --filter @alchemy-video/control-api test`=`73 pass / 1 skip / 0 fail`；
- Media Runtime health：`D:\AI\alchemy_video_OS\.codex-longrun\c10-document-runtime-venv\Scripts\python.exe -m unittest discover -s tests -p 'test_runtime.py' -k health_`（cwd `services/media-runtime`）=`3/3 pass / 0 fail / 0 skip`，仅覆盖 direct `health_live`/`health_ready` 行为（ready 正常、缺 token 可重试失败）；
- OpenMontage 适配：`D:\AI\alchemy_video_OS\.codex-longrun\c10-document-runtime-venv\Scripts\python.exe -m unittest discover -s adapters/openmontage_audio -p 'test_adapters.py'`（cwd `services/media-runtime`）=`11/11 pass / 0 fail / 0 skip`；
- 交叉门禁：root `pnpm typecheck`=`PASS`；`docker compose --env-file infrastructure/deploy/.env.video.example -f infrastructure/deploy/docker-compose.video.yml config --quiet`=`PASS`；`git diff --check`=`PASS`，无新增 whitespace error。

以上只证明 route-guard/readiness 窄范围；未执行 Docker 容器启动、镜像构建、VPS/SSH、真实 DNS/TLS/公网网络，也未执行 AISelf identity/credit、Sub2API video intent、共享积分、真实 Provider/TTS 或生产联调。`QC-only replay` 因 C12 没有可表达的状态/事件/幂等契约，继续 `DESIGN_QUESTION/DEFERRED`；本切片状态为 `ACCEPTED`（仅窄范围），不等同 Docker/VPS 实测、部署验收或整体平台生产验收；本条不改变 C12.4/C12.5 总体、E12/R01 或 C13 状态。

## 8. 回滚

1. 停止应用层新任务或切回 `VIDEO_PROVIDER=mock`，保留数据库、队列、MinIO、
   TaskRun、ProviderAttempt 和结果资产；不要 `down -v`。
2. 若部署验证发现 Runtime 镜像问题，可回滚 Runtime image/Compose 文件到上一
   个已审计版本，并同步恢复调用方 URL 与依赖，避免只回滚一侧形成半拓扑。
3. 不回滚用户已有的页面、Runtime 逻辑或测试改动；本轮文件回滚必须以审计后
   的精确 diff 为范围。
4. 回滚不触碰 AISelf/Sub2API 配置、Provider key、域名、TLS 或生产数据。

## 9. 未闭合证据与阻断

- 本轮未执行 Docker/VPS/SSH/真实网络，因此 Compose 容器间 DNS、独立重建和
  生产日志仍需后续授权窗口验收。
- QC-only replay 受 C12 公共契约限制，已标记 `DESIGN_QUESTION/DEFERRED`；
  不能宣称“Provider 成功后 QC 一定可恢复”。
- AISelf identity/credit、Sub2API video intent、真实 Provider profile 和费用
  仍未认证，也不属于本轮完成定义。
- 窄范围代码与定向测试材料已由独立审计收口，包含 Compose 依赖、无 Runtime 公网端口、URL allowlist
  与 direct readiness 行为；本切片状态为 `ACCEPTED`（仅窄范围）。该收口不覆盖 Docker/VPS
  实测、AISelf/真实 Provider 联调、完整 C13 或 QC-only replay。
