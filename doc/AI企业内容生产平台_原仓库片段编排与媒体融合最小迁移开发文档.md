# AI 企业内容生产平台：原仓库片段编排与媒体融合最小迁移开发文档

## 1. 本轮目标

修正真实成片中“每个 LLM 决策都被单独提交为短视频、边界全部硬切、BGM 与各段原生音轨融合不自然”的实现偏差。实现必须回到固定原仓库的片段/子镜头/转场/音频语义，不新增平台自造的剧情评分、节拍算法、自动变速、自动补静音或第二套协议。

本轮交付顺序固定为：本文件冻结范围 → 独立审计来源与当前差异 → 唯一执行者实现 → 独立代码审计 → 本地模拟/回归测试 → 用户授权的真实 30 秒、480P Provider 测试。

## 2. 固定来源

| 来源 | 固定文件/符号 | 本轮复用语义 |
| --- | --- | --- |
| huobao-drama `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` | `backend/workspace/skills/storyboard-breaker/SKILL.md` | 一个 8–15 秒 storyboard segment 内承载 2–4 个 2–6 秒子镜头；按 narrative beat、场景转移和因果链分段；不能机械等分。 |
| 同上 | `backend/workspace/skills/prompt-generator/video-prompt/SKILL.md` | description 是唯一来源；镜头顺序、台词顺序和显式“切到/切回”语义保留；同一段内允许内部 hard cut。 |
| OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` | `tools/video/video_stitch.py` / `video_stitch._stitch` | 只复用已有 `cut`、`crossfade`、`fade` 及同一 transition duration 语义；没有明确转场事实时保持 cut/fail-closed。 |
| 同上 | `tools/audio/audio_mixer.py` / `_full_mix`, `_segmented_music` | 复用显式 speech/music/SFX track、绝对 start、music windows、fade 和 normalize 输入；不由混音器猜剧情或 BPM。 |
| Seedance-2.5 `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` | `skill/seedance-25/references/prompting.md`, `references/references.md` | 每个意图的 subject/action/camera/sound/critical locks；引用角色与输入顺序保持一致；显式场景转换必须由来源事实表达。 |

## 3. 必须修正的偏差

1. LLM 返回的视觉决策不得默认一条决策对应一次 Provider 任务。连续、同场景且属于同一 narrative beat 的决策必须先作为同一 storyboard segment 的内部子镜头承载；Huobao 明确的 beat 边界必须拆段，另外只有达到 Provider 8–15 秒边界、发生来源明确的 scene transfer 或无法保持因果链时才拆成下一个生成片段。
2. 片段时长按来源的 beat/scene/对白容量事实规划，不使用等时长均分作为主策略；无法在既有来源边界内表达时必须 fail-closed。
3. LLM 或源文本明确表达“切出/切到/新场景”时，不能继续强行使用上一段 HANDOFF 首帧作为唯一场景参考；应沿用现有 reference policy 适配路径，保持用户参考图顺序，不添加新协议。
4. 合成只调用 OpenMontage 已有的 `cut`、`crossfade`、`fade`。没有已确认的转场事实、有效窗口或完整 track 时，不得臆造 crossfade；安全降级必须在任务/QC 中可见。
5. BGM 保持单一已授权 MUSIC 资产和既有时间窗口。不得新增 BPM/节拍/情绪评分或多曲切换算法；当前元数据选择能力只能作为现有平台薄壳，不能包装成 OpenMontage 原生智能选曲。
6. 不恢复 source ownership/span envelope，不修改公开 API、数据库 schema、任务状态、计费或 Provider 协议；不处理本轮未授权的旁白、字幕、Veyra、VPS 和部署。

## 4. 允许修改范围

- `packages/creative-planning/src/index.ts` 及其定向测试：修正 LLM 决策到现有 storyboard segment/shotSpec 的映射，复用现有来源边界与 reference policy；删除本轮证明为纯平台占位的重复编排，不新增字段。
- `packages/creative-planning/tests/semantic-planner.test.ts`：补同场景多子镜头合并、显式场景转移拆分、引用策略和来源顺序行为测试。
- `apps/workflow-worker/src/execution-service.ts`、`apps/workflow-worker/src/semantic-planning-client.ts` 及其既有测试：恢复真实 Provider 规划使用 Huobao 的 8–15 秒段边界；三键 LLM 返回协议保持不变，段内多子镜头只作为自然语言提示内容表达，不新增 beat/scene 字段或平台 envelope。
- `packages/persistence/src/production-repository.ts` 及其既有测试：只在已有 handoff/transition 事实下选择 OpenMontage transition；保持未知/不可用状态 fail-closed 并可观察。
- `apps/production-worker/src/media-service.ts`、`services/media-runtime/runtime.py` 及既有测试：仅修正现有 OpenMontage stitch/audio 参数映射；不得创建新的混音算法或转场协议。
- 本文件和既有审计/测试记录的最小同步。

执行者不得修改公开 contracts、数据库 schema、事件、认证、计费、Provider 字段、VPS 或 Git。若必须扩大范围，先停止并提交 `DESIGN_QUESTION`。

## 5. 验收门

- 模拟规划：连续同场景视觉 beat 产生 1 个 8–15 秒生成片段，内部保留 2–4 个子镜头顺序；显式新场景产生新的 segment/reference policy。
- 不出现跨段台词重复、视觉源顺序改变、用户参考图重排或 HANDOFF 覆盖明确新场景。
- OpenMontage `cut/crossfade/fade` 参数与来源事实一致；评估器不可用时不伪造 BLEND/BRIDGE。
- 单一 MUSIC 资产、窗口、淡入淡出和既有 ducking 参数在合成请求中保持一致；不新增音乐切换或 BPM 逻辑。
- creative-planning、persistence、production-worker、media-runtime 受影响测试及 typecheck 通过，0 skip（既有外部环境 skip 必须单独登记）。
- 真实测试：新建项目，使用 `C:\Users\T14S\Desktop\case\图像\面霜\原图` 中参考图，原商业广告描述，30 秒、480P；记录分段数量/时长、转场、音频/BGM、Provider 结果和未闭合硬门。

## 6. 明确不宣称

本轮不宣称自动理解所有剧情、不宣称自动节拍选曲、不宣称完整 AudioPlan/NarrationAsset/TimelinePlan、不宣称人工听感或口型验收。OpenMontage 未提供的语义算法保持 `UNAVAILABLE`/`BLOCKED`，不能用一次真实成片成功替代来源与行为证据。

## 7. 本轮执行证据（2026-09-23）

- 代码审计与本地回归：`creative-planning 92/92`、`workflow-worker 38/38`、`production-worker 72/72`、`persistence 79 pass / 12 skip / 0 fail`；四包 typecheck 通过，`git diff --check` 通过。12 个 persistence skip 是既有 `DATABASE_URL` 集成边界，不是本轮静态源码替代行为测试。
- 真实测试项目：`prj_01M362R138VKPRNQGCHJCH8DK4`，使用本节指定目录的 3 张 PNG 参考图；规划得到 2 个 15 秒片段。第一次提交因本地 Cloudflare relay 失效而未到 Provider，修复中继后同一段幂等重试；随后第一次 Provider 产物在 Grok 自有内容审核中拒绝且未扣费，按 Provider 的可重试语义原样重试后成功。
- 成功运行：`prd_01M3638Y0FT2VET6ND5091ZHVK`，两段均 `ACCEPTED`，合成 `SUCCEEDED`；最终文件为 `30.084s / 848x480 / H.264 + AAC / 3,756,189 bytes`，下载副本位于 `.codex-longrun/media-review/cream-new-reference-prd_01M3638Y0FT2VET6ND5091ZHVK.mp4`。无字幕轨，保留音轨；本次交付计划按源文本“无旁白、无字幕、纯音乐 BGM”将 caption policy 设为 `OFF`。
- 本地 Python Runtime 单测因当前环境缺少可用 `fastapi`/Python 启动器未运行；本轮未把它伪报为通过。真实运行的媒体 Runtime HTTP 请求均返回成功，失败请求已在任务日志中可定位。
