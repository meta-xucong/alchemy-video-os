# 对白引用保真窄片开发与审计记录

版本：2026-09-16
状态：`ACCEPTED`（仅限本窄片，不代表章节或总体接受）

## 范围

本窄片只发布 `packages/creative-planning/src/index.ts` 的对白引用处理变更，以及 `packages/creative-planning/tests/semantic-planner.test.ts` 的对应回归测试：

- 带既有 spoken cue 的引号进入对白证据，并从视觉 source projection 移除；
- 未标注的视觉文字、音效和文件名引号保留为 source；
- 长引号不会吞掉后续视觉 source；
- `口播文案为“...”` 等无冒号标签只在引号紧随其后时移除。

本窄片不发布 `narrative-events.ts`、`deterministic-planner.test.ts` 或 `index.ts` 的全局上下文/分段规划变更；这些改动仍是未审计工作区内容。中文全局标签属于既有平台兼容语法，保持 `DEFERRED/UNREFERENCED`，不计作固定上游逐字迁移。

## 来源与适配

固定来源为 Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `backend/workspace/skills/storyboard-breaker/SKILL.md` 与 `backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`：对白与可见 description 分离、保持源顺序、不新增或遗漏对白。平台只复用既有 `spokenQuoteCue` 和内部 source projection 做薄适配；三个来源没有提供本地 TypeScript 解析器或通用压缩算法，本条不作该类声明。

## 验证

- clean cache-only replay in an isolated worktree: creative-planning `89/89 pass`, `0 fail`, `0 skip`；
- `pnpm --filter @alchemy-video/creative-planning typecheck`: 通过；
- `git diff --check`: 通过；
- 测试使用本地 fixture/mock，未调用真实 Provider、TTS、Veyra、网络、VPS 或 Git 远端。

本文件仅记录该两文件对白窄片的发布边界。正式 `E12/R01=BLOCKED`、总体 `C12.4/C12.5=IMPLEMENTED_PENDING_AUDIT` 不变；其它工作区变更不得随本窄片发布。
