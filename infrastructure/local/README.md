# 本地完整工作台启动

使用 `start-full-local-stack.ps1` 可以把本机 `http://localhost:3031/projects` 切到当前源码的完整本地工作台。

默认入口固定使用：

```text
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

它只启动本机 PostgreSQL、Redis、MinIO 之上的本地服务：Control API、Studio、Document Runtime/Worker、Workflow Worker、Task Worker、Media Runtime 和 Production Worker。脚本会停止 `.codex-longrun/local-acceptance` 下由 Codex 管理的旧本地进程，并把新进程 PID 与日志写入同一目录；不会触碰真实 Provider、Veyra、VPS、DNS、部署或 Git。

真实视频联调只在显式传入参数时启用：

```powershell
infrastructure\local\start-full-local-stack.ps1 -VideoProvider sub2api
```

该模式仍保持 `LOCAL_AUTH_MODE=dev`、`VEYRA_AUTH_ENABLED=false`，不会启用共享积分或部署。脚本会从当前进程环境或 `.env.local` 读取 `SUB2API_VIDEO_BASE_URL` / `SUB2API_VIDEO_API_KEY`，只注入给 Task Worker；Control API 与 Task Worker共享一次性 `REFERENCE_DELIVERY_SIGNING_KEY`，用于把已确认参考图通过短时 `/provider-input/<token>` HTTPS 链接交给上游。没有提供 `-ReferenceDeliveryOrigin` 时，脚本会启动本机 `cloudflared` Quick Tunnel 指向当前 Control API，用于本地真实参考图测试。

注意：真实模式会让后续新建的生成任务调用外部视频服务。已有 Mock 版本不会自动变成真实成片，需要在页面上生成新版本或新项目进行测试。
