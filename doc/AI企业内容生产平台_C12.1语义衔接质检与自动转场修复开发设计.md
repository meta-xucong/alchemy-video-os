# AI 企业内容生产平台：C12.1 语义衔接质检与自动转场修复开发设计

状态：`ACCEPTED`（2026-08-23 本地修订与独立审计完成）

关联章节：C12.1（依附 C12，本地优先，C13-A 之前完成）。

> **2026-09-01 当前音频口径**：自动旁白不要求用户上传音频/样音；本章只复用来源已有的衔接、转场和 QC 语义，不新增 TTS、Provider 或上传音频路径。真实 Grok/Doubao 对照仅按最新自动音频执行文档限定运行。

本文解决 C12 已经明确但尚未完整实现的一项能力：系统不能只知道两个视频“能播放”，还要判断相邻片段在人物、服装、场景、构图和动作方向上是否自然衔接；发现明显断裂时，后台先用本地媒体运行时写入一个可验证的短转场计划，并保持用户要求的总时长。

## 1. 目标与非目标

### 1.1 目标

1. 在片段 N 和片段 N+1 都完成技术 QC 后，自动提取 N 的尾部交接帧和 N+1 的首帧。
2. 以持久化、可重试、可审计的 `HandoffReview` 记录语义衔接结果，而不是把判断藏在日志或进程内。
3. 将相邻边界分为 `PASS`、`BLEND`、`BRIDGE_REQUIRED`、`UNAVAILABLE` 四类：
   - `PASS`：直接进入成片合成，音频仍按合成策略处理。
   - `BLEND`：使用既有受限画面/音频淡变，不新增 Provider 调用。
   - `BRIDGE_REQUIRED`：编排一个 1 至 3 秒的本地桥接转场；C12.1 不生成新的视频片段或重新提交 Provider。
   - `UNAVAILABLE`：没有可用语义评估器时，只记录 `NEEDS_ATTENTION` 并采用直切；不得凭空创建淡变或伪造语义通过。
4. 自动转场属于“自动修复”，不属于用户故事的主生成片段；主计划数量、主片段时长和用户目标总时长仍保持可追溯。
5. 每个边界最多一次自动修复，整次 `ProductionRun` 有冻结的 `max_auto_repair_count`，避免无限重试、无界时长或未来无界费用。

### 1.2 非目标

- 不承诺模型逐像素首尾相等；当前 SUB2API profile 没有已认证的 literal tail/start 双关键帧字段。
- 不把语义评估器改造成自由 Agent；评估器只能通过显式 `HandoffEvaluatorPort` 返回结构化结果。
- 不修改 C09-C 的公开单 Shot `FIRST_FRAME` / `REFERENCE_SET` 互斥契约。
- 不在本章接入 Veyra、共享积分、VPS、DNS、TLS、生产部署、新的真实 Provider profile 或付费桥接视频调用。
- 不让浏览器看到 PromptPackage、模型、Provider、内部 Asset ID、评分原文或视觉比较图片。

## 2. 用户体验

前端继续保持一个主按钮和一个项目内成片区，不增加“首帧、尾帧、桥接镜头、评估模型”等工程控件。

生成前只增加一条自然语言说明：

> 系统会自动检查片段之间的人物、场景和动作衔接；必要时补一个短过渡画面，不改变目标成片时长。

制作过程中只显示：

- `正在检查第 1/2 处衔接`
- `正在自动修复一处衔接`
- `已完成 2 处衔接检查，自动修复 1 处`
- `有一处衔接需要重新生成，但已完成的片段和旧成片不会被覆盖`

公开进度不得显示 `HandoffReview`、阈值、模型、队列或额外 TaskRun。自动转场完成后，在项目成果区以同一 `VideoVersion` 展示，不额外制造“第 4 个主镜头”的误解。

## 3. 统一领域模型

### 3.1 HandoffReview

`HandoffReview` 是两个已通过基础技术 QC 的相邻主片段之间的一次不可变评估：

| 字段 | 说明 |
| --- | --- |
| `id` | `hrv_` 前缀 ID |
| `workspace_id`, `project_id`, `production_run_id` | 固定工作区和项目范围 |
| `from_sequence`, `to_sequence` | 相邻主片段序号 |
| 来源主片段 | 通过同一 `ProductionRun` 的相邻 `ProductionSegment.task_run_id` 解析，不在 Review 行重复保存 |
| `evaluator_version` | 评估器版本或 `unavailable` |
| `result` | `PASS | BLEND | BRIDGE_REQUIRED | UNAVAILABLE | FAILED` |
| `reason_codes` | `IDENTITY_DRIFT`、`WARDROBE_DRIFT`、`SCENE_DRIFT`、`COMPOSITION_JUMP`、`ACTION_DIRECTION_BREAK` 等安全枚举 |
| `summary` | 脱敏安全摘要 |
| `retryable` | 是否可以重试评估 |
| `created_at` | UTC 时间 |

评估器的原始图像、模型回答、向量、命令行和临时路径不进入数据库、事件、日志或公开 DTO。

### 3.2 TransitionRepair

`TransitionRepair` 记录一次自动修复边界。C12.1 的默认实现是本地媒体运行时转场修复：它固定合成计划中的重叠、画面/音频淡变与有限裁切；它不落出独立桥接视频资产，也不创建真实 Provider `TaskRun`。未来若单独认证“视觉模型桥接镜头”，可在不改变公开主片段数的前提下扩展私有 Provider 修复任务。

| 字段 | 说明 |
| --- | --- |
| `id` | `trp_` 前缀 ID |
| `production_run_id`, `boundary_sequence` | 每个批次和边界唯一 |
| `strategy` | `BLEND | BRIDGE`；C12.1 中 `BRIDGE` 表示本地媒体运行时桥接转场 |
| `status` | `PENDING | GENERATING | CHECKING | ACCEPTED | FAILED` |
| `task_run_id` | 预留字段；C12.1 本地修复必须为空，未来认证 Provider 桥接后才可写入 |
| `asset_id` | 可选字段；若运行时落出独立桥接视频资产则记录，否则由 `composition_plan` 固定 |
| `duration_ms` | 本地转场时长，受 1-3 秒上限约束 |
| `attempt_count` | 最多 1 次自动修复，人工新版本才可再次规划 |

主片段数量仍满足：

```text
主 Provider TaskRun 数量 = GenerationSegment 数量
本地 C12.1 Provider TaskRun 数量 = 主片段数量
未来认证 Provider 桥接后，私有修复任务数量必须单独审计，且不改变主片段数量
```

自动转场不能被 Studio 显示为主故事段，也不能让用户误解为故事被拆成更多叙事点。

### 3.3 ProductionRun 安全投影

在不破坏旧客户端的前提下，`ProductionRun` 公开投影新增可选字段：

- `continuity_status`: `NOT_CHECKED | CHECKING | GOOD | AUTO_REPAIRING | NEEDS_ATTENTION`
- `planned_segment_count`: 主生成片段数
- `max_auto_repair_count`: 本批次最多自动修复数
- `auto_repair_count`: 已使用自动修复数

不公开评估器版本、评分、边界序号对应的内部 ID、修复任务、对象 key 或 Provider 信息。

## 4. 评估与修复策略

### 4.1 评估输入

`HandoffEvaluatorPort` 只接受服务端读取的有界 PNG/JPEG 帧和结构化上下文：

```ts
interface HandoffEvaluatorPort {
  evaluate(input: {
    fromTailFrame: Uint8Array;
    toHeadFrame: Uint8Array;
    continuityHints: {
      characterCount: number;
      sceneSummary: string;
      wardrobeSummary?: string;
      actionDirection?: string;
    };
  }): Promise<{
    result: "PASS" | "BLEND" | "BRIDGE_REQUIRED" | "UNAVAILABLE" | "FAILED";
    reasonCodes: string[];
    safeSummary: string;
    evaluatorVersion: string;
    retryable: boolean;
  }>;
}
```

第一阶段只实现注入式本地夹具评估器和严格的输入/输出契约；真实视觉模型评估器另行认证。任何评估器都不能直接写数据库或调用视频 Provider。

### 4.2 修复决策

```text
主片段 N + 主片段 N+1
        │
        ├─ PASS              -> 直接合成
        ├─ BLEND             -> 受限画面/音频淡变
        ├─ BRIDGE_REQUIRED   -> 编排 1-3 秒本地桥接淡变 -> 固定计划并记录修复
        └─ UNAVAILABLE       -> 直切 + NEEDS_ATTENTION 标记，不创建修复
```

本地桥接计划只携带前段尾帧、后段首帧、人物/服装/场景锁定和动作方向摘要，不把整篇原文重新提交，也不调用视频 Provider。自动修复最多一次；仍无法形成安全合成计划时，批次进入 `NEEDS_ATTENTION`，保留已完成片段和历史成片，不自动循环。

### 4.3 时长守卫

本地转场不是无界追加时长。合成计划必须记录：

- 经 `ffprobe` 验证的来源段合计时长（本地合成的真实时长守卫）；用户目标总时长仍由上游主片段生成参数负责兑现。
- 每个主片段的保留区间。
- 每个自动转场的时长。
- 每个边界的重叠/裁切区间。

默认桥接时长为 2 秒，允许范围 1-3 秒；通过边界重叠和有限裁切保持最终成片在已验证来源总时长容差内。若来源媒体本身与用户目标时长不符，系统不得靠伪造或拉伸成功掩盖问题；无法满足本地时长守卫时，不得伪造 `SUCCEEDED`。

## 5. 状态、事件与幂等

新增内部事件：

- `handoff_review.requested`
- `handoff_review.completed`
- `transition_repair.requested`
- `transition_repair.succeeded`
- `transition_repair.failed`

事件沿用现有 versioned outbox envelope。每个事件都带工作区、项目、ProductionRun 和边界范围；浏览器只接收安全的 `ProductionRunProgress` 投影。

不变量：

1. 一个 ProductionRun/边界最多一个活动 `HandoffReview`。
2. 一个 ProductionRun/边界最多一个自动 `TransitionRepair`。
3. 相同幂等键只能回放原评估/修复结果。
4. C12.1 本地修复不提交 Provider；重复事件、重启或重复命令只能回放同一 `TransitionRepair` 与合成计划。
5. 主片段失败只阻塞其依赖；转场修复失败不删除已接受的主片段或历史 VideoVersion。
6. 合成失败不重新提交主片段，也不重复创建修复事实，除非用户明确创建新版本。

## 6. Media Runtime 扩展

在现有 `INSPECT_VIDEO`、`EXTRACT_HANDOFF_FRAME`、`COMPOSE_VIDEO` 之外新增受控工具：

- `EXTRACT_BOUNDARY_FRAMES`：从单个 MP4 提取首帧和尾帧，返回有界图片字节与安全元数据。
- `COMPOSE_VIDEO` 增加受 schema 校验的 `composition_plan`，明确主片段、自动转场、裁切和转场，不接受路径或任意 ffmpeg 参数。

Runtime 仍只绑定 loopback，只接受字节流，不接收 Provider、Prompt、URL、对象 key、数据库或浏览器字段。所有临时文件在响应前删除。

## 7. 前后端实现顺序

1. 先更新 contracts、迁移、ADR-0044 和本 C12.1 文档。
2. 实现 `HandoffReview` / `TransitionRepair` 的持久化、状态机、事件和幂等。
3. 扩展 Media Runtime 边界帧提取与计划化合成。
4. 实现 Production Worker 的评估、本地自动修复、恢复和预算守卫。
5. 更新公开 ProductionRun 进度投影与 Studio 中文状态，不增加工程化按钮。
6. 用 Mock/夹具覆盖 PASS、BLEND、BRIDGE_REQUIRED、UNAVAILABLE、失败重试和时长守卫。
7. 只有本地门禁通过后，才可为特定真实 profile 单独申请有限次数验证；本章不触碰 Veyra/VPS/部署。

## 7.1 当前实现边界

当前代码已经落地：

- `HandoffReview` / `TransitionRepair` 的 ID、结果、策略、状态与安全公开字段契约；
- `production_runs.continuity_status`、自动修复上限与已用次数的持久化字段；
- `handoff_reviews`、`transition_repairs` 前向迁移和工作区/项目/ProductionRun 复合约束；
- Media Runtime 的 `EXTRACT_BOUNDARY_FRAMES`，只返回有界首帧/尾帧 PNG 元数据与受控 Base64 字节；
- `COMPOSE_VIDEO` 的版本化 `composition_plan` envelope，可表达 `PASS`、`BLEND`、`BRIDGE`；
- 默认 fail-closed 的本地夹具评估器，以及 ProductionRun/Studio 的安全中文连续性投影；
- 全部主片段技术 QC 完成后，为每一对相邻片段写入 durable `handoff_review.requested` outbox 事实；
- Media Worker 读取两个已验证 MP4 的尾/首边界帧，调用注入式评估器，事务性写入 `HandoffReview`、有界 `TransitionRepair`、完成事件和一次 `composition_requested`；
- 合成输入只在所有边界 Review 已完成后生成，并把 `PASS`、明确的 `BLEND`、`BRIDGE_REQUIRED` 和评估不可用的直切降级编译为 Runtime composition plan。
- 活动 Media Runtime 租约期间的重复投递返回 `BUSY`，只有过期租约才允许恢复；交接源片段或边界帧能力缺失时不确认事件，交给队列重试/死信路径；
- 多个 `BRIDGE` 边界的转场时长按合成计划中的边界顺序编排，不依赖数据库返回顺序。

本轮修订要求：夹具继续覆盖明确的 `PASS`、`BLEND`、`BRIDGE` 计划和音轨/时长守卫；`UNAVAILABLE` / `FAILED` 只产生 `NEEDS_ATTENTION` 与直切，不产生 `TransitionRepair`。disposable PostgreSQL 继续验证活动租约 `BUSY`、过期租约恢复、完成后重复回放 `DUPLICATE`，且边界 Review/Repair/合成事实不重复。C13-A 仍不得启动。

## 8. 验收门禁

- 两个边界帧均来自同项目、同工作区、已通过技术 QC 的主片段。
- 评估结果、原因枚举、修复策略和重试次数可在数据库追溯。
- 同一边界不会重复创建自动修复事实或重复生成本地转场。
- 多片段 fixture 在明确的 `PASS`、`BLEND`、`BRIDGE_REQUIRED` 下最终时长均在容差内；`UNAVAILABLE` / `FAILED` 不创建修复并以直切完成可追溯合成。
- `BRIDGE_REQUIRED` 只增加自动修复事实和合成计划，不改变用户看到的主片段数量，也不增加本地 Provider 调用次数。
- 转场修复失败不会删除已成功片段或旧 VideoVersion。
- 前端只看到安全中文进度，不出现模型、Provider、评分、TaskRun 或内部 ID。
- Worker/Runtime 重启、重复 outbox、重复命令均不增加 Provider 提交次数或重复修复次数。
- 默认 Mock 模式无网络、无真实 Key、无 Veyra 也能全量通过。
