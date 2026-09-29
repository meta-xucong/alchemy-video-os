# AI企业内容生产平台：三仓库创作与音频合成纠偏开发文档 v2

> 文档状态：`DESIGN_FROZEN / READY_FOR_AUDIT`（仅文档设计；尚未表示代码已修复）。
>
> 本版覆盖并取代与“分段、Prompt 二次包装、段间音频、自动连续性、全片合成”相冲突的旧方案。旧文档保留历史证据，不得据此授权新的自建逻辑；正式总控、领域/API 契约和 AGENTS.md 优先级更高。

## 1. 目标、非目标和风险分级

### 目标

在不发明新的创作算法的前提下，最大可能直接移植：

- Huobao 的分镜节拍、单场景段落和段内子镜头语义；
- Huobao 的 description→video prompt 保序、硬切和台词保真；
- Seedance 的引用 owner、紧凑 prompt 结构与单一 sound policy；
- OpenMontage 的五层 shot prompt 与 `_full_mix` 全片音频时间轴。

平台仅保留必要薄壳，以及已明确授权的自动 BGM 选曲。自动 BGM 选曲不归因于任何上游，也不扩展为 LLM 选曲或音频算法。

### 非目标

- 不设计新一套通用分段算法、场景评分、对象锁、连续性 evaluator、转场选择器或音频修复器。
- 不改变公开 API、数据库契约、状态机、Provider 协议和部署方式。
- 不把本次成功产物、静态测试或旧文档中的计划内容写成迁移完成。
- 不在本轮调用真实 Provider、VPS 或 Git；需要真实产物时另行授权。

### 风险轴

`D1 / I2 / A1`：来源语义已定位，但跨 planner、持久化、Runtime 和 OpenMontage 的传递具有交叉影响；现有产物已暴露跨场景和音频断层风险，必须以行为及产物证据放行。

## 2. 固定来源和直接移植边界

### 2.1 Huobao Drama

固定文件：

- `upstream/huobao-drama/backend/workspace/skills/storyboard-breaker/SKILL.md`
- `upstream/huobao-drama/backend/workspace/skills/prompt-generator/video-prompt/SKILL.md`

必须保留的语义：一个段落就是一个 Provider 生成任务；通常 8–15 秒、2–4 个子镜头；子镜头允许硬切但不得跨场景；按节拍边界切段；台词容量满足“段内字数 ÷ 4.5 + 2 秒”；`description` 是 video_prompt 唯一来源，按 `【镜头N】` 顺序映射，不遗漏、不合并、不新增。

平台适配仅包括字段名称转换、引用绑定、任务 ID、Provider 字段和状态错误映射。用户明确的“总时长少于 8 秒只生成一段”是平台边界规则，不能被伪装成 Huobao 的 8–15 秒来源规则；长时长段数由源节拍/场景事实决定，不设固定三段或固定 10 秒。

### 2.2 Seedance 2.5

固定文件：

- `upstream/seedance-2.5/skill/seedance-25/references/prompting.md`
- `upstream/seedance-2.5/skill/seedance-25/references/references.md`

每段 Prompt 采用来源的紧凑形状：引用声明 + 一句话概览 + 故事/时间推进 + 全局锁。简单片段只保留 subject/scene、visible action/endpoint、one camera move、physical light、sound policy、critical locks/exclusions。每个受控维度只能有一个 owner；`@` 引用必须按输入字节保真，不翻译、不重编号、不静默替换。声音必须明确是环境声、音效、对白、音乐或静音之一，禁止 Provider 与外部 MUSIC 双重 owner。

### 2.3 OpenMontage

固定文件：

- `upstream/openmontage/lib/shot_prompt_builder.py:build_shot_prompt`
- `upstream/openmontage/tools/audio/audio_mixer.py:AudioMixer._full_mix`
- 必要时参考 `upstream/openmontage/skills/creative/video-gen-prompting.md` 与 `_full_mix` 对应测试。

`build_shot_prompt` 按已有字段依次拼接五层：Camera、Movement、Subject、Lighting、Style；空字段省略，不补平台自造 prose。`_full_mix` 源码可接收一个或多个 `music` track，同时接收 speech/music/sfx 轨并支持 start_seconds、track fade、ducking、normalize 和 target_duration。平台为落实 Seedance 的 one-owner、避免分段重播/双重 BGM，选择单一全片 MUSIC 轨作为最小薄壳约束；这不是 OpenMontage 的强制语义。平台只将对象存储资产映射为临时文件，并把 OpenMontage 结果收回平台资产；不重写 mixer 语义。

## 3. 现有问题的纠偏判定

以下现象必须作为缺陷或证据阻断登记：

1. 实际成片 `3×10s`，一个段落跨越新加坡、实验室等多个场景；这是 Huobao 单场景规则的偏离，不是“转场效果不好”这么简单。
2. 成片 `continuity_status=NEEDS_ATTENTION`；不得以顺序相邻、参考图或 handoff frame 的存在宣称连续性通过。
3. 音频约 18 秒出现约 0.44 秒近似空洞，前后响度约跳变 10–15 dB；不得声称单一 MUSIC 全片混音已经生效。
4. 目前未知最终任务是否走 `_full_mix`、是否携带平台单轨约束下的 MUSIC hash/全片 start-end、Provider 原生音频是否重复成为 MUSIC；缺少这些事实时保持 `BLOCKED`。OpenMontage `_full_mix` 允许多个 music track，单一全片轨是本平台的最小适配选择，不应冒充上游硬规则。

这四项是当前验收入口的待修复证据，不是本文的完成声明。

## 4. 代码落地方案（冻结边界）

### 步骤 A：删除/阻断无来源创作逻辑

只定位现有 planner/prompt compiler/segment mapper，删除或 fail-closed：

- 固定段数、均分时长、跨场景合并、关键词对象/人物/图像用途推断；
- 重复的英文模板、固定 BGM/字幕/子镜头包装；
- 未有来源字段的对象锁、自动动作修复、连续性判定和隐式转场。

不得以新函数、新阈值或新协议替代这些逻辑。无法删除而仍被历史输入依赖的分支，标为兼容历史并禁止新任务命中。

### 步骤 B：恢复来源段落与 Prompt

将已有分镜事实按 Huobao 规则映射：先读节拍和场景，按场景边界形成段落，再将每个段落内 2–4 个子镜头保留在原顺序。Prompt 只从该段 `description` 生成，采用 Seedance 紧凑结构和 OpenMontage 五层字段；任何生成前的二次“导演包装”必须删除或登记 BLOCKED。

### 步骤 C：收敛 reference/sound owner

保留输入引用顺序和标签，建立仅用于 mapper 的 owner 映射：identity/environment/motion/camera/timing/audio/style 每项一个来源。未知用途或冲突不猜测。每段的声音 policy 只描述来源事实；外部 MUSIC 由自动 BGM 选择结果拥有，Provider 原生音频不再重复声明为 MUSIC。

### 步骤 D：统一全片 `_full_mix`

新任务只允许进入现有 OpenMontage `_full_mix` 适配。源码允许多个 `music` track；本平台在本任务范围选择单一全片 MUSIC 轨，以落实 one-owner 并避免分段重播/双重 BGM：

```text
speech/sfx: 按已有 AudioPlan 的 start_seconds 与 role
music: 仅一条选定曲目，start_seconds=0，覆盖 target_duration
ducking/normalize/target_duration: 只透传已有来源字段
```

平台不得自动分段起播、截取后重排、静默补洞或创建第二音乐轨。若 AudioPlan 不能表达一条全片 MUSIC 轨或原生音频 owner 冲突，直接 `BLOCKED`，不走旧分段混音回退。历史 ALCHMED1–7 只在已有兼容读取路径明确识别时保留。

### 步骤 E：产物证据

不修改来源算法的前提下，补齐定向证据：AudioPlan 的轨道 role/hash/start/end、实际调用的 OpenMontage operation、ffprobe 时长/音轨数、波形边界和响度变化。没有真实产物时只能报告 `INSUFFICIENT_EVIDENCE`。

## 5. 允许文件、禁止文件和依赖顺序

允许修改：

- 相关 `doc/` 来源登记、迁移矩阵、审计记录；
- 现有 planner/storyboard/prompt compiler 的实现文件及其定向测试；
- 现有 AudioPlan/Runtime/OpenMontage adapter 的实现文件及其定向测试。

禁止修改：

- `upstream/`、`.env*`、`.tmp-project.json`、用户媒体和测试输出；
- 公共 contracts、状态账本、部署/VPS、Provider 凭据；
- 与本纠偏无关的 UI、计费、登录、Pixabay API 结构。

顺序必须是：来源登记 → 分段语义 → Prompt mapper → owner/AudioPlan → `_full_mix` 路由 → 定向测试 → 独立审计 →（另行授权后）真实 Provider 产物。

## 6. 测试与审计矩阵

### 模拟/离线

- Huobao：场景边界、节拍边界、2–4 子镜头、短时长单段、台词容量、无跨场景。
- Prompt：description 唯一来源、镜头顺序、无新增台词、引用标签字节保真、五层空字段省略。
- AudioPlan：单一 MUSIC owner、同一 asset hash、start=0、target_duration、speech/music/sfx 角色和 ducking 参数不重写。
- Runtime：只调用 `_full_mix`，旧输入兼容器不被新任务命中；缺失/冲突信息 fail-closed。

### 真实产物（需另行授权）

确认至少：视频总时长、分段边界、音轨数量、音乐资产 hash 唯一、18 秒处无空洞/响度突变、Provider 原生音频和外部 BGM 没有双重 owner。若仍有 `NEEDS_ATTENTION` 或证据不完整，不能 ACCEPT。

### 独立审计

审计员必须读取冻结 diff、来源 commit、测试 receipt 和实际产物证据，返回 `PASS`、`FAIL` 或 `INSUFFICIENT_EVIDENCE`。作者不得自审自批。任何无来源启发式、固定阈值或静默回退都必须单列阻断。

## 7. 回退策略、来源登记和未决阻断

若任一步不通过，回退到上一个固定版本并保留失败记录；不得恢复已删除的自造逻辑作为“临时兼容”。每一项来源迁移必须登记 commit、文件/符号、复用内容、薄适配点、删减原因和行为测试。

未决阻断：

1. 现有 3×10 跨场景分段尚未证明已替换为单场景分段。
2. `NEEDS_ATTENTION` 尚未由来源事实或人工确认关闭，不能自动清零。
3. 18 秒音频断层和响度跳变尚未定位到单一 AudioPlan/_full_mix 输入。
4. 尚无证据证明新任务不再命中旧 `segmented_music`/`_mix_music_track`；该阻断不是对 OpenMontage 能力的否定，而是平台新任务路由的最小约束尚未被证实。
5. 平台自动 BGM 选曲仍是唯一 `PLATFORM_OWNED` 例外，未授权新增 LLM 选曲或音乐评分协议。

## 8.1 成功产物观察 receipt（非迁移完成证据）

- 文件：`C:\Users\T14S\Downloads\composed (31).mp4`
- SHA-256：`8CA6AD70A0F25F0FE6838E7AC59A6E7CADD47C245E1033084F4B28A0004A673C`
- 复核命令：`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,sample_rate -of default=nw=1 "C:\Users\T14S\Downloads\composed (31).mp4"`
- 观察结果：`duration=30.125s`；video=`h264 544x544`；audio=`aac 48kHz`。

该 receipt 仅证明成功产物的文件可读取和观察到的媒体参数，不证明来源迁移完成，不关闭 3×10 跨场景、`NEEDS_ATTENTION` 或约 18 秒音频断层等阻断。

在上述阻断关闭并取得独立审计 `PASS` 前，状态保持 `BLOCKED` 或 `READY_FOR_AUDIT`，不得写 `ACCEPTED`。
