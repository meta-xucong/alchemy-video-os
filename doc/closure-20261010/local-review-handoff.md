# 本地交叉复核与版本同步交接

日期：2026-10-10。关联 PR：`meta-xucong/alchemy-video-os#4`。此文随代码提交；当前阶段的精确远端 SHA/CI 以 PR 回执与 `review-record.md` 为准，不使用本文件猜测最新版本。

## 现状与安全边界

- 既有目录 `D:\AI\alchemy_video_OS\开发版_20261009` 的已观察基线为 `071f46e0321300656972c48697e2703fe2ba736c`，有 8 项修改与 3 项未跟踪。它不是本轮可直接覆盖的干净目录；不要 reset、clean、覆盖复制、删除或擅自 stash。
- 本地已建立 `D:\AI\alchemy_video_OS\review-3fd8410baf90`，detached HEAD 精确为云端本轮实施基线 `3fd8410baf904e879ae353e796b98b10e7ea3495`。当前新修订尚待推送及精确 SHA 同步，不能把基线同步称为新版本同步。
- 原指定 Codex 会话的受支持会话接口失败；新建本地任务能够检查工作区，但不代表已和原会话通信。
- 不合并、不部署、不迁移生产数据、不调用收费 Provider，不读取或输出凭据。保留未经授权上传的 audit JSON/运行镜像清单限制。

## 复核顺序

1. 读取根 `AGENTS.md`、本目录总览、恢复设计、依赖方案、验收/切换方案及领域/API 契约。只审本轮平台持久化、队列和测试隔离变动；不能添加新的创作、QC、媒体算法或上游协议。
2. 从 GitHub 核对 PR #4 最新 head、分支、Draft 状态及 CI 对应 SHA，再核对既有本地工作树状态。2026-10-10 21:58 UTC 用户已批准向官方 npm registry 发送依赖名称、版本与关系以执行漏洞审计，以及本地隔离部署测试；该授权不覆盖生产、收费 Provider 或完整 audit JSON/镜像清单上传。
3. 在干净的独立工作树获取并检出被确认的新 SHA。若当前 review 目录已产生修改，保留它并另建清楚标注 SHA 的 worktree。只对已核对的 clean 分支执行 fast-forward；不要合入 main。
4. 核对新 SHA 与云端树及测试来源，按 `review-record.md` 复算恢复代码 manifest 指纹。检查固定旧 Worker fixture 原始字节仍一致，不允许以 LF 正规化隐藏内容更改。
5. 核验 `0029` 自关联、约束、journal/snapshot 与原子 A→B 替代；覆盖两种真实 PG 锁次序、十处故障回滚、旧命令重放、A→B→C、旧 Worker 晚到 ID 保存和观察到替代后停止后续动作。
6. 运行组合回归：真实制作段重试生成 B，通过持久 queued 事件交给实际 Mock Worker，只提交一次；重复事件、新 executor 和旧 A 不增加提交。此 Mock 为明确失败终态，不能当作成片成功证据。
7. 使用固定 pnpm 10.33.0 和 frozen lock，核验 Drizzle 真实 CLI 在移除旧 loader 后仍可 generate/check。依赖安装缓存或媒体二进制缺失是环境故障，修复环境后重跑，不削弱产品校验或添加系统 fallback。
8. 按验收矩阵运行 Linux CI C06/C12。Windows 的进程树退出无法证明时会保守保留测试资源，不能把此状态计为完整 UI 验收通过；分支模拟测试不等于实际 Windows 全链路测试。

## 需要分别报告

- 本地路径、分支、HEAD、工作树状态；GitHub PR head 是否相同。
- 实际命令与 pass/fail/skip，旧基线测试和当前提交测试分开，重叠组不相加。
- 代码复审发现及是否有复現；功能正确性和来源一致性分别给结论。
- 精确 SHA 的 CI、Linux Mock UI、镜像、依赖审计状态；缺失即写未验证。
- 历史 QC、历史 NULL 替代关系、未知在途 POST、实际路由来源、生产备份/排空/回滚尚缺的真实证据。

只有代码通过、版本同步、现场前置门均有证据，才能另行评估部署。源码复审或 Mock 通过不能自行解除 Draft、批准混跑或重启服务。
