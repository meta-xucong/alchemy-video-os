# AI企业内容生产平台：源仓库收敛删除移植清单

> 文档状态：`DRAFT_FOR_AUDIT`。本清单只冻结来源、范围和证据要求，不授权本文件之外的实现。
>
> 适用基线：本地工作区 HEAD `33447fe4afbe3a66d6060150be48250b4e4519e0`。固定来源：
> - Huobao Drama `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`
> - Seedance 2.5 `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7`
> - OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930`

## 1. 冻结目标与硬边界

目标是把创作分段、视频提示词和最终音频合成收敛到上述来源已有语义；平台只保留身份、工作区、权限、Provider/对象存储/队列/错误映射等薄壳，以及用户明确授权的“自动 BGM 选曲”能力。自动 BGM 选曲不是三仓库原码，本清单将它登记为唯一 `PLATFORM_OWNED` 例外；本轮不扩展其算法，也不把“LLM 选 BGM”当作来源能力。

以下规则不可放宽：

1. 每项保留、删除、改写都必须指向固定 commit 的文件、符号或明确规则。
2. 不能证明来源的创作算法、阈值、静默回退、自动改写和 UI 语义保持 `BLOCKED`/`UNAVAILABLE`/fail-closed。
3. 不能用一次真实成片或静态命中冒充跨层来源迁移完成。
4. 本文不改变公开契约、数据库状态、Provider 参数或部署策略。

## 2. 来源映射与动作清单

| 能力 | 固定来源 | 当前平台动作 | 允许形态 | 证据门 |
|---|---|---|---|---|
| 分镜段落 | `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`：核心定义、拆分流程、质量要求 | 替换机械均分/固定三段/跨场景合并 | 直接移植语义；只做字段 mapper | 每段 8–15s、2–4 子镜头、同段单场景、节拍边界测试 |
| 段内视频 prompt | `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`：`description` 唯一来源、镜头映射、硬切与保序 | 删除平台二次导演、重复全片文案和无来源英文包装 | 保留输入/输出适配 | 单段顺序、无新增台词、无跨场景测试 |
| 提示词五层 | `upstream/openmontage/lib/shot_prompt_builder.py:build_shot_prompt` | 删除并行模板；按已有字段组装 Camera/Movement/Subject/Lighting/Style | 等价移植；薄适配结构化字段 | 空字段、省略字段、字段顺序和来源值测试 |
| Seedance 结构 | `upstream/seedance-2.5/skill/seedance-25/references/prompting.md` 第 7–18、44–58 行 | 保留 reference declaration、overview、progression、global locks；不重复包装 | 直接采用自然语言紧凑形状 | 引用标签字节保真、每维一个 owner、声音策略单一 |
| 参考图 owner | `upstream/seedance-2.5/skill/seedance-25/references/references.md` 第 7–21、35–53 行 | 移除对象/人物/用途猜测；只保留已声明角色与原顺序 | 薄 mapper | 输入顺序、owner 冲突 fail-closed |
| 全片音频 | `upstream/openmontage/tools/audio/audio_mixer.py:_full_mix`（源码可接收一个或多个 `music` track） | 平台选择单一全片 MUSIC 轨作为最小薄壳约束，避免分段重播/双重 BGM；不是上游强制语义 | 直接调用 + 临时路径 mapper | 音乐轨数量/owner、全片 duration、target_duration、ducking 和 loudness 行为 |
| 音频角色 | OpenMontage `_full_mix` 的 `speech/music/sfx` 角色，Seedance sound policy | 明确 Provider 原生音频与外部 MUSIC 的 owner，禁止双 owner | 薄适配 | 多段输入、无重叠/空洞、角色隔离测试 |
| 自动 BGM | 平台需求；三仓库没有等价“语义自动选曲”实现 | 保留本地曲库/Pixabay 选择作为单一自建例外 | `PLATFORM_OWNED`，不改变源混音 | 只产生一首候选，选择结果进入单一 MUSIC 轨；其余逻辑走 `_full_mix` |

## 3. 必须删除、禁止新增或降级的内容

### 3.1 分段与创作

- 固定“30 秒最多三段”、固定 10 秒、机械均分和按平台自造分段数上限。
- 把不同地点/场景塞入同一段，或用关键词猜测场景、人物、左右手、物体转移和参考图用途。
- 未经来源支持的对象锁、跨片段连续性判定、动作修复、自动重写和自动补写。
- 用平台固定英文包装、`Creative direction`、重复 `This segment contains ...` 等替代来源 description。
- 在没有来源事实时，自动把 `NEEDS_ATTENTION`、`UNAVAILABLE` 或失败改为通过。

### 3.2 音视频合成

- 每段独立选曲、独立起播、重复拼接同一曲目或把 Provider 原生 BGM 与平台 MUSIC 同时设为 owner。
- 新任务默认走 `segmented_music`、旧 `_mix_music_track` 或自造 transition/xfade。历史兼容路径只能在旧输入明确命中时保留，不能作为新任务静默回退。
- 没有 AudioPlan/单一 MUSIC 事实时，禁止猜测 start/end、音量、时长或 ducking 参数；应阻断并记录。
- 没有来源依据的“跨场景自然过渡”“自动修补空白”“自动变速/补静音”算法。

## 4. 允许保留的薄壳

身份、工作区权限、Control API、任务幂等、队列、Provider 字段映射、对象存储临时文件、MIME/SHA/ffprobe 校验、错误归一化、内部事件和审计属于平台边界，允许保留。它们不得改变来源媒体/内容语义。

自动 BGM 选曲是唯一平台自建能力。其输出必须只是一项已选择的音乐资产和来源登记信息；播放、时间轴、淡入淡出、ducking、目标时长和最终文件均交给 OpenMontage `_full_mix`。本清单不授权增加标签评分、情绪模型、切歌算法或 LLM 选曲协议。

## 5. 当前证据与未完成事实

以下均是待修复/待复核，不是完成声明：

- 当前成功产物实际为 `3×10s`，且段内跨越多个场景；不符合 Huobao “一段一场景”语义。
- 项目记录 `continuity_status=NEEDS_ATTENTION`，不能宣称跨段连续性已闭合。
- 实测约 18 秒处存在约 0.44 秒近似空洞，前后段响度约有 10–15 dB 跳变；需核对 MUSIC 轨、原生音频及最终 mixer 路由。
- 画面切点约在 10.0、16.0、18.1、20.7、22.2、25.0 秒；这只能证明硬切/独立片段现象，不能证明来源 transition 已正确迁移。
- 尚未证明新任务始终进入 `_full_mix`，也尚未证明平台选定的单一全片 MUSIC 约束、音乐资产 hash 和全片时间窗已传递。OpenMontage 源码本身允许一个或多个 music track；平台单轨选择只是为落实 Seedance one-owner 的最小适配。

### 5.1 成功产物观察 receipt（非迁移完成证据）

- 文件：`C:\Users\T14S\Downloads\composed (31).mp4`
- SHA-256：`8CA6AD70A0F25F0FE6838E7AC59A6E7CADD47C245E1033084F4B28A0004A673C`
- 复核命令：`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,sample_rate -of default=nw=1 "C:\Users\T14S\Downloads\composed (31).mp4"`
- 观察结果：`duration=30.125s`；video=`h264 544x544`；audio=`aac 48kHz`。

该 receipt 只证明文件存在、可读取和已观察到的媒体参数，不证明 Huobao/Seedance/OpenMontage 语义已完整迁移，也不关闭 3×10 跨场景、`NEEDS_ATTENTION` 或约 18 秒音频断层阻断。

## 6. 实施顺序与允许文件

实施只能按以下顺序，每次冻结一个版本：

1. 来源登记与旧文档标记：只改 `doc/` 与 `THIRD_PARTY_NOTES.md`。
2. 分段/Prompt 收敛：只改已存在的 storyboard、prompt compiler、planner mapper 和对应测试；不得改公开 API。
3. AudioPlan/MUSIC owner 收敛：只改现有内部 adapter、Runtime mapper、composition input 和定向测试；不得添加新协议。
4. OpenMontage 调用收敛：只改现有 `_full_mix` 薄适配和新任务路由；历史输入保持兼容或显式阻断。
5. 产物审计：只新增/修改针对性测试与审计文档，不调用真实 Provider/VPS，除非用户另行授权。

不允许改动：`upstream/` 快照、`.env*`、`.tmp-project.json`、公共合同、账本状态、部署脚本和与本清单无关的文件。

## 7. D/I/A、测试和 Exit Gate

- 设计：`D1`。原因是三仓库的段落、Prompt、音频边界需要融合，但来源和允许薄壳已固定；不得借设计不确定性新增能力。
- 实现：`I2`。原因是跨 planner → AudioPlan → Runtime → OpenMontage 的已有路径必须证明同一来源语义，任何缺口应阻断。
- 审计：`A1`。原因是跨模块来源等价性、音频 owner、时序和产物证据互相影响。

Exit Gate 必须全部满足：

1. 逐项映射表包含固定文件/符号/commit 和偏离理由。
2. 新任务的每一段符合 Huobao 的单场景、2–4 子镜头与时长/节拍语义；少于 8 秒遵循用户明确规则只生成一段，不把该规则泛化成来源规则。
3. Prompt 保留 description、引用顺序和台词，不新增平台包装或未授权约束。
4. 参考图每个维度只有一个 owner；未知用途不猜测，阻断或保留为显式输入。
5. 新任务只有一个 MUSIC owner，AudioPlan 传到 `_full_mix`，全片 target duration 一致，Provider 原生音频不重复充当 MUSIC。
6. 定向行为测试覆盖跨场景拒绝、引用保序、单一 MUSIC、全片 duration、ducking/fade、无音频空洞和历史兼容边界。
7. 产物级测试确认没有 18 秒类似的断层/响度跳变；若无法证明，状态保持 `INSUFFICIENT_EVIDENCE`。
8. 独立审计返回 `PASS`，否则只能 `BLOCKED`/`READY_FOR_AUDIT`，不可 ACCEPT。

## 8. 回退与登记

任何来源映射失败或证据不足时，回退到上一固定版本并保持失败可见；不得回退到旧的自造分段/分段音乐路径。旧 ALCHMED1–7 仅在输入签名明确识别时由既有兼容读取器处理。

每个移植条目必须登记：来源仓库、commit、文件/符号、保留行为、平台薄适配、删除内容、原因、定向测试和证据 hash。来源缺口登记为 `BLOCKED`，不得用“已兼容”替代。
