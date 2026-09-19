# 本地完整工作台启动

使用 `start-full-local-stack.ps1` 可以把本机 `http://localhost:3031/projects` 切到当前源码的完整本地工作台。

默认入口固定使用：

```text
LOCAL_AUTH_MODE=dev
VIDEO_PROVIDER=mock
VEYRA_AUTH_ENABLED=false
```

它只启动本机 PostgreSQL、Redis、MinIO 之上的本地服务：Control API、Studio、Document Runtime/Worker、Workflow Worker、Task Worker、Media Runtime 和 Production Worker。脚本会停止 `.codex-longrun/local-acceptance` 下由 Codex 管理的旧本地进程，并把新进程 PID 与日志写入同一目录；不会触碰真实 Provider、Veyra、VPS、DNS、部署或 Git。

如需在本地显式测试 OpenMontage DoubaoTTS 路径，凭据仍只放在进程/用户环境中的来源变量 `DOUBAO_SPEECH_API_KEY`、`DOUBAO_SPEECH_VOICE_TYPE`。启动脚本会按来源 `DoubaoTTS.execute` 的读取方式，仅在 Media Runtime 子进程启动时临时继承这两个变量，随后清理父进程环境；它不会开启默认云路由、注入 Worker 或把凭据写入仓库。未显式提交 `preferred_provider=doubao` 时，本地默认仍是 Mock/无自动 TTS。

真实视频联调只在显式传入参数时启用：

```powershell
infrastructure\local\start-full-local-stack.ps1 -VideoProvider sub2api
```

该模式仍保持 `LOCAL_AUTH_MODE=dev`、`VEYRA_AUTH_ENABLED=false`，不会启用共享积分或部署。脚本会从当前进程环境或 `.env.local` 读取 `SUB2API_VIDEO_BASE_URL` / `SUB2API_VIDEO_API_KEY`，只注入给 Task Worker；Control API 与 Task Worker共享一次性 `REFERENCE_DELIVERY_SIGNING_KEY`，用于把已确认参考图通过短时 `/provider-input/<token>` HTTPS 链接交给上游。真实模式还必须提供固定的 `REFERENCE_DELIVERY_ORIGIN`（可通过 `-ReferenceDeliveryOrigin` 或 `.env.local` 设置）。随机 Cloudflare Quick Tunnel 只有显式传入 `-AllowEphemeralReferenceTunnel` 才会启用，因为 Aiself/Wokey 可能拒绝随机主机名；它只适合临时诊断，不是可靠的图生链路。
如果要启用参考图视觉分析，额外配置 `REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_API_KEY`、`REFERENCE_VISION_MODEL` 三项；脚本只把它们注入 Control API，服务端在上传确认或规划重试时按资产 ID 分析图片，绝不传给 Task Worker 或浏览器。三项缺失时不按位置猜测，参考图任务会等待用户说明或视觉分析配置。

### 固定域名本地调试

如果 `video.aiself.vip` 已指向一台公网 VPS，但产品尚未部署，可让 VPS 只承担固定 HTTPS relay：

1. VPS 的 Nginx/Caddy 只代理 `/provider-input/` 到 VPS 本机端口 `18080`，其他路径全部拒绝；该入口配置有效 TLS 证书。Nginx 的 relay-only 核心配置如下（证书路径按 VPS 实际位置调整）：

```nginx
server {
    listen 443 ssl;
    server_name video.aiself.vip;
    ssl_certificate /etc/letsencrypt/live/video.aiself.vip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/video.aiself.vip/privkey.pem;
    location ^~ /provider-input/ {
        if ($request_method !~ ^(GET|HEAD)$) { return 405; }
        proxy_pass http://127.0.0.1:18080;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
    location / { return 404; }
}
```
2. 本机建立 SSH 反向隧道，把 VPS 的 `127.0.0.1:18080` 转到本机 Control API：

```powershell
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -R 127.0.0.1:18080:127.0.0.1:3133 <video-vps-user>@43.251.227.106
```

3. 保持隧道运行，在本机启动真实模式并指定固定 origin：

```powershell
.\infrastructure\local\start-full-local-stack.ps1 `
  -VideoProvider sub2api `
  -ReferenceDeliveryOrigin https://video.aiself.vip `
  -SkipBackup
```

此时浏览器仍访问 `http://localhost:3031`，Provider 读取的图片地址是 `https://video.aiself.vip/provider-input/<token>`；图片内容通过加密 SSH 隧道回到本机 Control API。不要把 `3133` 直接暴露到公网，也不要把 MinIO、Redis 或数据库端口转发出去。VPS relay 配好并从外部验证 `GET/HEAD /provider-input/<token>` 后，才进行真实参考图生成。

注意：真实模式会让后续新建的生成任务调用外部视频服务。已有 Mock 版本不会自动变成真实成片，需要在页面上生成新版本或新项目进行测试。
### 本地视频 relay 状态

Studio 会通过同源 `/api/relay/status` 检查 `REFERENCE_DELIVERY_ORIGIN` 的 HTTPS
`/provider-input/` 入口。无效 token 返回 404 即表示边缘路由和 SSH 反向转发可达；这
不会暴露对象或签名 token。仅在 `LOCAL_AUTH_MODE=dev` 且本地进程显式提供
`POLYMARKET_SSH_PASSPHRASE` 时开放重连按钮；浏览器永远不接收 SSH 私钥或口令。
