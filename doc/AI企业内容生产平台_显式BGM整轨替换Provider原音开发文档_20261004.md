# 显式 BGM 整轨替换 Provider 原音

版本：`1.0.0`  
状态：`APPROVED_FOR_IMPLEMENTATION_AFTER_INDEPENDENT_DOC_AUDIT`  
日期：`2026-10-04`

## 1. 目标与边界

解决当前真实 BGM-on 成片在组合阶段被 P6 fail-closed 阻断的问题。不得把未知 Provider MP4 音轨重标为 SFX，也不得借助 owner enum 推断该音轨可混。新增一个 Studio 可见、每次 ProductionRun 明确冻结的选择：`MUSIC_REPLACE_PROVIDER_AUDIO`。选中后，仅保留用户已有 MusicPlan 指定的完整 BGM，明确丢弃所有 Provider 视频分段内嵌音频；原有原生保留和 Doubao 旁白替换语义不变。

本任务不改变默认选择，不自动切换、不自动选曲、不增加音频算法、不修改 Provider 请求或画面生成。首版只支持现有 `MANUAL` MusicPlan 与用户已选的单个 READY MUSIC asset；`OFF`、`AUTO`、ID 缺失/错配、音乐 bytes/hash/duration 不匹配或时长不覆盖全片，均在创建 ProductionRun 前或合成前 fail-closed。该模式的输出不含 Grok 原生对白/环境声；UI 必须在选项旁明确告知。

本任务只处理 BGM-on full-run composition blocker。G02 的项目规划/profile/provider 门、`ROUTE_UNVERIFIED`、`HOOK_UNVERIFIED`、QC 语义复核、C12.4/C12.5、E12/R01 和发布门不因此关闭。

## 2. 固定来源与裁定

固定 OpenMontage commit：`4eab34c5cfcccaa4f1970554928feccce73ee930`。

- `tools/audio/audio_mixer.py::AudioMixer._full_mix` 接受一条 `music` track 和目标时长；本功能只把已解析的 MUSIC bytes 作为唯一 mixer track，不传 source MP4 音轨、speech 或 SFX。
- `tools/video/video_compose.py::_mux_external_audio` 按 `0:v:0 + 1:a:0` remux 外部音轨，替换视频原音。这就是本选择的替换语义。
- 当前生效的 P6 TaskSpec (`doc/AI企业内容生产平台_原仓库偏差收敛开发包_20261001/03-执行步骤与逐文件代码清单.md` §10.1/§10.2，验证矩阵 §3.6/§3.7) 明确禁止凭 ALCHMED8 owner enum 将完整 MP4 音轨作为 SFX；本任务遵循该限制，不恢复已被 supersede 的映射。
- `PRESERVE_PROVIDER_AUDIO + Music ON` 在 source audio 未获得来源角色分离证明时继续 fail-closed；不以此任务放开原声混 BGM。

## 3. 合同与持久化

`CreateProductionRunCommand.audio_selection` 的允许值变为：

```ts
"PRESERVE_PROVIDER_AUDIO" | "DOUBAO_TTS_REPLACE" | "MUSIC_REPLACE_PROVIDER_AUDIO"
```

省略值仍归一为 `PRESERVE_PROVIDER_AUDIO`。未知值拒绝。新值只在用户显式选择时接受；它必须和同一命令中的 `MusicPlan.mode=MANUAL` 及唯一 `asset_id` 同时出现。`AUTO`、`OFF` 均拒绝，不调用/复用自动选曲路径。ProductionRun 创建事务在既有 workspace/project scope 下核实 asset 为 READY、`AUDIO/MUSIC`、登记 duration 覆盖 target，并把精确 asset ID、SHA-256、workspace/project、登记 duration 写入私有 `budget_guard.music_replacement_source`；无须新表或列。Worker/Runtime 在读取 bytes 后用既有 ffprobe 检查实际 MIME/hash/size/duration，实际时长须覆盖 target；若 asset identity/hash/duration 与冻结事实不一致即 fail-closed。不得按当前曲库重新选曲。

使用现有私有 `production_runs.budget_guard.audio_selection` 冻结选择，无新数据库列；幂等 request hash 包含新值，同键异值冲突。公开 response、event、SSE 和日志不暴露私有音轨事实。Worker 必须按 ProductionRun 冻结值执行，不以当前 UI、环境变量或队列事件覆盖。

ALCHMED9 音频选择字节定义：`0=PRESERVE_PROVIDER_AUDIO`、`1=DOUBAO_TTS_REPLACE`、`2=MUSIC_REPLACE_PROVIDER_AUDIO`。ALCHMED1–8 保持原读路径并隐含 Preserve。ALCHMED9 未知值仍拒绝；版本和选择需由同一 Worker/Runtime 部署快照协同，不得对旧 Runtime 静默降级。

## 4. 精确执行规则

1. **Preserve**：行为不变。Music OFF 保留源 MP4 原音；Music ON 且来源角色不明时沿 P6 阻断。
2. **Doubao**：行为不变。必须有同一 run 的 approved formal Doubao narration/READY TimelinePlan；替换 Provider 音轨，并按既有 MusicPlan 混合明确音乐。
3. **Music replacement**：
   - 只接受唯一一条 MUSIC track，其 frozen window 为完整目标 `[0, target_duration_ms]` 且实际音频 bytes 经既有 ffprobe 检查时长不短于目标；不得让 OpenMontage 的 target-duration padding 静默填充缺失 BGM，不得新增窗口、循环、裁切或转码策略。
   - 拼接分段画面时明确不映射分段输入音轨；不做 source MP4 音频探测后分类。
   - `_full_mix` 的输入仅有这一条 `music` track，目标时长沿用既有 composition target；其输出音轨通过现有外部音轨 remux 替换 stitched video 音轨。
   - 最终视频恰有一个音频流，音频全长覆盖目标成片；不得把原 Provider 音轨送入 mixer 的任意角色。
   - Music payload 缺失、重复、身份/hash不符、非完整时间窗或解码失败时失败，不产生成功 VideoVersion，不回退 Preserve。

## 5. 文件级写集与验证

写集按实际已有路径复用，禁止重命名或整文件格式化：

- `packages/contracts/src/creative-planning.ts`、`media-runtime.ts`、契约测试和 `contracts/openapi.{json,yaml}`：命令枚举、默认、Music ON 约束、内部 composition selection。
- `apps/studio-web/app/pages/projects/[project_id].vue`、`useControlApi.ts` 与 Studio 测试：第三个 radio/选择文案，警示会移除 Provider 原声；选择随现有 ProductionRun 命令传递。
- `apps/control-api/src/app.ts` 及现有 route tests：只透传；公开投影不回显内部选择。
- `packages/persistence/src/creative-planning-repository.ts`、`production-repository.ts` 及 tests：沿用 JSONB 冻结/幂等，不加 migration；替换模式冻结 MANUAL MusicPlan 的具体 asset ID/SHA/scope/duration，不保存推断字段。
- `apps/production-worker/src/media-service.ts`、`media-runtime-client.ts` 及 tests：读取同一 frozen selection，验证 MUSIC plan 和选择一致，再用 ALCHMED9 的 `2` 编码；失败禁止降级。
- `services/media-runtime/runtime.py` 和 tests：`2` 只去除 source segment audio，`_full_mix` 只收到 MUSIC，最终 remux 仅映射视频和 full-mix 音轨；保留其他两种选择回归。
- 追加本 TaskSpec 至 `领域模型与API事件契约.md`、`自动生成音频与视频匹配正式使用开发文档.md`、`开发决策记录.md` 与 `正式开发总控文档.md`。历史规定保留并以 append-only 当前裁定覆盖。

必须测试：

- contract：第三个值接受、未知值拒绝、默认仍 Preserve；Music OFF 与 replacement 组合在 ProductionRun 前阻断。
- persistence：JSONB 冻结、相同幂等重放、同键异选择冲突；新值不泄漏公开 DTO/event；失败无 run/outbox/attempt。
- 冻结音乐来源：只有 MANUAL 且匹配 READY AUDIO/MUSIC asset 时可创建；AUTO/OFF、缺失/错 project/workspace、错误 audio_role、短于 target 或 hash 缺失/变化均阻断；重试不会因曲库新增素材改变 music asset ID/hash。
- worker/runtime client：run 冻结值和 composition 值不一致阻断；ALCHMED1–8 和 ALCHMED9 0/1/2 编码；未支持 Runtime 不静默重试为旧 wire。
- Runtime 真 FFmpeg：生成带 110Hz source tone 的视频和带 440Hz music tone 的一轨素材；走实际 OpenMontage adapter `_full_mix` 与 Runtime composition；输出保留 440Hz、丢弃 110Hz，音频/视频目标时长相同、唯一 AAC 音轨；Music track `[0,target]`，实际源音频不足目标时长则混音前拒绝。另测 Preserve 音频回归和缺/双轨/短窗口/短媒体负例。
- workspace 相关 tests、typecheck/build、diff check；真实视频对照在本地 Gate 通过与独立 source/audit PASS 后执行，沿用已授权项目/profile/prompt/图片/30s/480p，不改 `.env.local`、Veyra、额度或 provider profile。一次成功完整视频后停止。

## 6. 审计、阶段与禁止事项

本文件、ADR-0078 appendendum、领域/API契约和两个专项总控文档共五份文件，初始冻结版已由独立只读文档审计 PASS；本次状态补记后的同一五文件快照须再次通过只读 hash/status binding 复核，之后才实施。完成后对同一冻结代码 snapshot 单独执行 Source Fidelity 与普通代码 Audit，并完成定向/集成/全量相关测试。任一 FAIL/HOLD/INSUFFICIENT_EVIDENCE 不放行；不得自己给自己审计。

不得改写/删除 P6 历史、`PRESERVE_PROVIDER_AUDIO` 默认、Doubao gate、G02 其它 TaskSpec、Provider/Hook 全局配置；不得 stage/commit/push/merge、访问 VPS、启用 Veyra 或掩盖 QC `NEEDS_ATTENTION`。本 TaskSpec 通过只接受这项 BGM replacement 窄功能，不升级 G02/C12.4/C12.5/E12/R01 或发布状态。

## 7. 交付状态

当前：`APPROVED_FOR_IMPLEMENTATION_AFTER_INDEPENDENT_DOC_AUDIT`，但最新五文件状态文本 hash/status binding 复核待完成，代码尚未开始。代码独立审计与测试通过后，才能执行已授权的真实 BGM-on 视频测试，并记录 `LIMITED_FEATURE_ACCEPTED` 及真实视频证据；全局状态仍依据正式总控文档的章节 Exit Gate 单独判定。

### 7.1 2026-10-05 实施事实 supersession（不表示功能验收）

上方“代码尚未开始/等待实施后真实测试”是实施前状态快照，已由本节 supersede。当前工作树中已存在 §5 所列 BGM replacement 链路的实现；隔离重放也已用现有三段视频和冻结 BGM 复现用户认可的成片。对应 ProductionRun `prd_01M43R309JXXS973H9SXQZ74GN` 与 VideoVersion `vvr_01M43SVVW6FCF7QQWYG07FPYGG` 成功，资产 `ast_01M43SVBPPZM7HD7VVE31VK2EZ` 为 4,147,528 bytes，SHA-256 `f2d7e8d255096994078da1a3d57cb88ee1a81feb6189ed5aa2f8c1f08de68fa7`；用户接受成片表现。隔离重放的完整运行和证据范围见 `.codex-longrun/test-log.md` 2026-10-05 条目。该重放精确绑定的是文档更正前候选 `e1a3d1dfbcfe8a98cdaee3bfb05975b8ae96718f8f9835a440f1594424c1e7de`；当前全候选文档快照另有 hash，不能将旧 receipt 冒称绑定新 manifest。

因此本功能的事实状态更正为：**实现已存在、指定样例行为已复现；`LIMITED_FEATURE_ACCEPTED` 尚未授予。** 当前 627-path 工作树混有 G02/Persistence/Runtime 等非 BGM 修改，相关大文件内存在交错变更；尚无对当前精确 BGM patch 的同版本 Source Fidelity 与普通 Audit 收据。不得按 §5 整文件直接暂存，也不得把 ADR-0079 的 `LIMITED_QC_POLICY_ACCEPTED` 当作 BGM 功能验收。持久 QC 仍为 `NEEDS_ATTENTION / COMPOSITION`，其 finding 不被用户视觉/听感认可或本状态更正删除。

本节不升级 G02、C12.2、C12.4/C12.5、E12/R01，不开放新 Provider 调用、Git stage/commit/push、VPS 或部署。用户“首个完整成功即停止”的真实视频目标已达到，不重复生成。若要形成可发布的功能切片，须另行冻结干净基线上的逐符号写集，完成同一快照来源审计、普通审计及相关端到端验证；这之前状态保持 `IMPLEMENTED / LIMITED_FEATURE_ACCEPTANCE_PENDING`。

### 7.2 2026-10-05 审计发现后的最小实现范围修订（须独立文档复审）

上一轮代码候选的 Source Fidelity/普通 Audit 均未通过，不得复用其收据。为使 §3 ALCHMED9 selector 真正可经现有 Runtime HTTP handler 到达，允许将 `services/media-runtime/main.py` 纳入精确写集，但仅可将既有 composition magic allowlist 增加 `COMPOSITION_AUDIO_SELECTION_MAGIC`，并为该路由增加 selector framing 的正/负 HTTP-handler 回归测试；不得改变 handler 身份验证、body 上限、Content-Type、错误映射或其他路由行为。

继续严格执行 §3 三值 selector：`0=PRESERVE_PROVIDER_AUDIO`、`1=DOUBAO_TTS_REPLACE`、`2=MUSIC_REPLACE_PROVIDER_AUDIO`。selector `1` 必须映射到既有 Doubao 语义，不可拒绝、改写或另造 audio path；默认 Preserve 与 ALCHMED1–8 旧 wire 行为保持不变。

对 selector `2`，必须在分段 stitch 阶段完全不映射/处理任何 Provider segment audio；不能只保证最终 remux 不输出 source audio。`_full_mix` 的唯一输入仍是已验证的全时长 MUSIC，source MP4 audio 不得作为任何 mixer role。Preserve + Music ON 在来源角色分离未证实时 fail-closed；Preserve + Music OFF、Doubao 既有路径行为不变。

Persistence 验收除 §5 已列的创建冻结回读外，还须在临时隔离 PostgreSQL 覆盖至少一条同键幂等重放/异选择冲突，以及一条创建后、`REVIEWING` composition reload 前冻结资产身份或 hash 被变更时 fail-closed 的生命周期负例；不得连接或复用项目数据库。确切测试不得制造成功 output/outbox/attempt 副作用。若现有 schema/harness 无法安全构造该生命周期负例，必须保持 `HOLD`，不以 InMemory 或静态断言替代。

本补记仅修订 `main.py` 的上述窄写集，并细化原有 ALCHMED9/Persistence 验收证据，不放宽功能、Provider、Git、章节或部署门禁。实施前须由独立文档审计对本节与原 TaskSpec 的一致性、最小性和文件清单重新 PASS；之后对新代码 manifest 重新运行全部独立来源和普通审计，不得复用上一轮 22-path 候选的 PASS/HOLD/FAIL 收据。

### 7.3 2026-10-05 干净基线兼容前置条件（须独立文档复审）

只读检查确认 `origin/main` 基线没有 `DOUBAO_TTS_REPLACE` 命令/Runtime 路径，但领域/API契约和本 TaskSpec §1–§3要求新增 BGM 时原 Doubao 替换语义保持不变。不得以“当前远端没有该代码”为理由删除其合同值或把它标成兼容通过。

因此，本次从 `origin/main` 重建的候选必须同时包含：①符合《显式 Doubao 整轨替换与 ProductionRun 来源绑定》§1–§7 的既有功能所需最小写集；②本 TaskSpec §1–§6 的 BGM replacement 写集。两者只组成满足现有用户合同的交付基线，不增加 Doubao 生成/审批能力，不调用 TTS。Doubao 路径必须只消费同一 run 已批准的 formal TimelinePlan/NarrationAssetVersion，并保持 fail-closed、幂等和隐私门。

由于历史 Doubao `LIMITED_FEATURE_ACCEPTED` 记录没有当前可复用的精确代码 manifest/同字节 receipts，《显式 Doubao 整轨替换同运行来源绑定开发文档》§8.1 已明确该证据边界；故合并后的新候选必须对 Doubao 与 BGM 的全部实际写集、测试和同一冻结 manifest 一起重新完成 Source Fidelity 与普通代码审计。BGM与Doubao源规则不能被重写或互相回退；任一前置行为不能按各自 TaskSpec 最小实现并证明时，候选保持 `HOLD`。

### 7.4 2026-10-05 文档准入复审结果及实施事实补充

本 TaskSpec 顶部 `APPROVED_FOR_IMPLEMENTATION_AFTER_INDEPENDENT_DOC_AUDIT` 仅代表原始 §1–§6 范围的历史文档门，不覆盖本次新增 §7.2/§7.3 范围。2026-10-05 对 §7.2/§7.3 和 Doubao TaskSpec §1–§7 的独立复审结论为 `HOLD`：来源媒体行为和设计边界一致，但《领域模型与API事件契约》与《第三方来源与复用登记》的实现/来源状态文字陈旧，须完成 append-only 事实及来源 supersession 后重新冻结文档 hash，并对当前准入集合再次独立复审。该 HOLD 不撤销旧历史文档审计，也不授权在新准入 PASS 前实施或重构代码。

另追加本地复现证据（不等于功能接受）：候选 manifest `f57d91cd538e6d8c90f3879c003947b498b828ec908dc085a45187168881e6bf`（627 eligible paths）的五个运行包已从该源码快照重建；独立构建绑定 PASS。对隔离 PostgreSQL 克隆仅执行一次 `retryProductionComposition` 和该次返回的唯一 event direct-consumer，Run→Event→Consumer→VideoVersion→Asset 关联经独立只读 SQL 审计 PASS，输出与用户接受 MP4 字节一致（4,147,528 bytes，SHA-256 `f2d7e8d255096994078da1a3d57cb88ee1a81feb6189f9835a440f1594424c1e7de`）。该路径未经过 queue/relay、未调用 Provider；不证明历史加载代码，也不升级 `LIMITED_FEATURE_ACCEPTED`、G02、章节、Git 或部署状态。

### 7.5 2026-10-05 文档准入复审收据（仅授权最小候选重建）

对本 TaskSpec §7.2–§7.4、领域/API 契约补记及第三方来源登记补记进行独立只读复审，结论 `PASS`。复审确认来源登记将旧 A2 收据限定绑定于 manifest `241cf89ceaf60765d87c999d2b67801d1159dc408b88126bfe13fb963e0d9299`，明确 `f57d91cd538e6d8c90f3879c003947b498b828ec908dc085a45187168881e6bf` 只有构建绑定和隔离 direct-consumer replay 证据、没有可留档的正式 Source Fidelity/普通 Audit 收据；证据类型和功能/章节/发布状态边界现已一致。

本次 PASS 只解除新增文档条款的准入阻断，允许基于干净基线重建最小候选；不代表 BGM 功能验收、Source Fidelity/普通代码审计通过、章节 Exit Gate 接受或 Git/VPS 放行。重建候选必须包含本 TaskSpec §1–§6 与 Doubao TaskSpec §1–§7 各自必需的最小写集，在一个新的冻结 manifest 上重新运行测试及两项独立审计。旧 HOLD 保留为历史记录，不可当作当前状态。

### 7.6 2026-10-05 生命周期门测试完成（功能验收仍待干净候选）

在候选代码/测试快照 manifest `dbc68afba18e25b74a311a6d799f89b7a21997caf89b37e73f2814d5604b04ea`（627 paths）上，本 TaskSpec §7.2 PostgreSQL 生命周期门已通过：`production-repository.integration.test.ts` 在专用 loopback/tmpfs PostgreSQL 用正式 DeliveryPlan API 创建并审批全片计划，完成正式 ProductionRun、accepted segments 并进入 `REVIEWING`；冻结 MUSIC SHA 被篡改时，正式 composition reload fail-closed，Run/segments/outbox/VideoVersion/资产/ProviderAttempt 无新增副作用；恢复后同一运行合法 reload 与原正向流通过。另一个全新 disposable PostgreSQL 的普通 `DATABASE_URL`/OFF 路径 6/6 通过。该测试只改 integration test 文件，不改生产代码、协议或媒体算法。

验证收据（均不包含真实 Provider 调用）：专用 BGM PostgreSQL 集成 1/1 pass、5 skip；OFF PostgreSQL 集成 6/6；Persistence TypeScript 检查 pass；Media Runtime `.venv` unittest 156/156（包括实际 FFmpeg/FFprobe ALCHMED9 BGM source-tone replacement）；`git diff --check` exit 0，仅有换行提示。限范围 Source Fidelity 和普通代码审计绑定上述 `dbc68...` manifest，均对 G02/BGM/Doubao 的限定范围给出 PASS；普通审计另指出 G02 valid entity projection + active mapping 到 Provider preflight 的正向 PostgreSQL 集成覆盖仍缺，阻断 G02/全仓章节验收，不阻断独立的 BGM narrow gate。

**本节只将 §7.2 生命周期测试门记为 PASS，不将整个 BGM 标为 `LIMITED_FEATURE_ACCEPTED`。** §7.3 要求的 `origin/main` 干净基线最小候选重建及该新候选上的完整测试、Source Fidelity 和普通审计尚未完成；当前 627-path 工作树仍混有未接受修改。G02 章节、全仓、GitHub/main 和 VPS 状态均不改变。上列 `dbc68...` 是添加本条记录前的已审代码/测试快照；本条为 append-only 证据，不更改生产代码。

### 7.7 2026-10-05 用户指定成功成片为当前质量基线及音轨覆盖防线

用户明确指定本机当前实际成功成片为产品基线，不再要求证明更早历史生成进程加载过的确切源码字节。接受资产为 4,147,528 bytes，SHA-256 `f2d7e8d255096994078da1a3d57cb88ee1a81feb6189ed5aa2f8c1f08de68fa7`；ffprobe 时长为视频 `30.125s`、AAC 音轨 `30.052s`，单一 AAC 流。`73ms` 音画尾差由用户明确接受，不构成该样片的产品缺陷。

当前候选的最终组合检查只确认音轨存在及容器/视频时长，不能拒绝“视频正常但音乐意外严重截短”的产物。为补齐这一可证失效保护而不改变已接受输出策略，允许在 `services/media-runtime/runtime.py` 增加仅适用于 `MUSIC_REPLACE_PROVIDER_AUDIO` 的最终 AAC 覆盖校验：必须恰有一条 audio stream，ffprobe 可给出有效 stream duration，且相对 `VideoInspection.duration_ms`（当前已验证视频流/容器 `max` 时长语义）的短缺不得超过 `100ms`。旧 §4.4 的“最终音频全长覆盖目标”仍适用于冻结 MUSIC 输入及 `_full_mix`；本条仅允许最终编码 AAC 相对既有 VideoInspection 成片时长最多短缺 `100ms`，不改变前置完整音乐门。`100ms` 明确是对用户接受的 `73ms` 样片留有限 AAC 对齐余量的产品容差，不是来源仓库规则；不得扩展为旁白、native Preserve 或其他 QC 阈值。

窄写集仅包括上述 Runtime 路径、对应 `services/media-runtime/tests/test_runtime.py` 行为测试，以及 C12.2 §9 的验收记录。本次不得改变 `-t target` mux、`_full_mix`、音轨内容、音量或 VideoProvider。测试必须用实际 FFmpeg 正例确认单 AAC/BGM 有声/Provider tone 不存在，并覆盖 `73ms` 与 `100ms` 通过、`101ms` 失败、缺失/多音轨/无效 duration 失败。之后对新的源码 manifest 做独立 Source Fidelity 与普通代码审计；此记录不更改历史 QC finding，不自动授予 `LIMITED_FEATURE_ACCEPTED` 或发布许可。

来源行为差异登记：固定来源 `OpenMontage@4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `tools/video/video_compose.py::_mux_external_audio` 使用 `-map 0:v:0`、`-map 1:a:0`、视频 copy、AAC 192k、`-af apad`、`-shortest` 和 `+faststart`。当前平台对应替换路径保留同一视频/外部音频映射及视频 copy，但显式使用 `-t <frozen target>`、AAC 192k/48kHz 和 `+faststart`，未移植 `apad -shortest`。这是有意保留的输出时长差异，不声称逐命令等价：完整 MUSIC 输入与 `_full_mix` 仍须覆盖冻结 target，target 限制组合输出；最终 AAC 允许的至多 `100ms` packet 对齐短缺由 §7.7 的用户接受成片基线门保护。该差异只适用于当前显式 `MUSIC_REPLACE_PROVIDER_AUDIO` 路径；若未来改成来源 `apad -shortest` 或改变 AAC 参数，必须另立行为对照与回归，不得静默替换本策略。
