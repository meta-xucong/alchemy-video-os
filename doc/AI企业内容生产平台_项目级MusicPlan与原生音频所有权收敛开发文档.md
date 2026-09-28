# 项目级 Music Plan 与原生音频所有权收敛开发文档

版本：`0.1.0`

状态：`IMPLEMENTED_PENDING_AUDIT`

日期：2026-09-28

## 1. 目标

把项目级音乐决策与成片混音收敛到固定来源的语义：一个明确的 Music Plan 决定是否使用一条覆盖全片的 MUSIC 轨；不得为每个视频片段另选或另加 BGM。Provider 原生音频继续按既有 owner 保留，由 OpenMontage `full_mix` 作为 source/SFX 与项目级 MUSIC 轨共同混合；平台不猜测原生轨内容、不做音频分离或静默覆盖。

## 2. 固定来源

- OpenMontage `4eab34c5cfcccaa4f1970554928feccce73ee930` 的 `AGENT_GUIDE.md` Music Plan：在提案阶段明确列出本地曲库、免版税搜索、音乐生成或无音乐选项，并记录用户决定。
- OpenMontage `README.md` 的 Audio Mixer：使用项目级音轨，执行全片覆盖、淡入淡出和旁白期间 ducking。
- Seedance-2.5 `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7` 的 `references/prompting.md` 与 `references/references.md`：声音维度必须明确，音频控制权只能归一个 owner；不应把参考音频自动视为最终音乐或语音事实。
- Huobao `f04d705603bd0257bcec6b8f44fd04ea3ea9b795` 的 `backend/src/services/generation.ts::generateVideo`：`generateAudio`、`referenceAudioUrls` 是 Provider 输入选项，不是成片级音乐混音方案。

## 3. 当前程序的最小适配

1. 复用既有 `MusicPlan { AUTO | MANUAL | OFF }`，不新增字段、事件或数据库表。
2. `AUTO/MANUAL` 成功选择后，只生成一个 `ownership=MUSIC` 的全片 AudioPlan track，时间窗为 `0..target_duration_ms`；继续复用已有 OpenMontage full_mix 的 fade、ducking、loudness 和对象校验。
3. `OFF` 不生成平台 MUSIC 轨，并保留既有 Provider 原生音频语义。
4. `AUTO` 的多候选本地曲库选择沿用历史、已获用户授权的 `PLATFORM_OWNED` `selectAutoMusicAsset`：仅消费已有 brief/style、项目名、`bgm_prompt` 原文和音乐资产既有描述性 metadata/tags/genre/style/mood/title 字段，选择一条满足角色与时长的全片 MUSIC 轨。`pixabay_query`/搜索 query 仅是来源 provenance，不作为返回曲目内容命中证据。它不是 OpenMontage/Pixabay 原生推荐算法，不新增 LLM、随机或多轨编排。没有内容命中的合格本地来源时，才沿用已认证的单次 Pixabay 导入路径，并保留来源适配器的 `30..120` 秒查询边界；已导入且时长合格的 Pixabay 资产可在相同幂等重试中按明确资产身份复用。
5. 当 accepted segment 的 owner 为 `NATIVE_PROVIDER` 或 `LEGACY_PRESERVE` 时，继续按原 owner 保留片段音轨，不改名、不拆分；OpenMontage `full_mix` 将其作为 source/SFX 与单条项目级 MUSIC 轨混合。平台不自行做人声/音乐分离，也不建立第二套音乐图。
6. MUSIC 仍只能是一条覆盖 `0..target_duration_ms` 的全片轨；其 fade、ducking、normalize 和对象校验继续由既有 OpenMontage 适配器完成。

## 4. 不在本轮实现

- 不做音频分离、BPM/情绪识别、跨片段拼接算法、变速、循环、补静音或新的 BGM 推荐算法。
- 不做 per-segment BGM，不恢复第二个 Pixabay scraper；Pixabay 只经现有受控 Runtime 路径，真实网络可用性由运行时决定，不新增平台侧网络路径。
- 不修改公共 API、数据库 schema、事件、Provider 协议或 UI 字段形状。

## 5. 验收证据

- AUTO/MANUAL 与非原生音频 owner：composition plan 只有一个全片 MUSIC window，`music_mix.enabled=true`，并保留既有 fade/ducking。
- OFF：无 MUSIC track，原生音频路径不变。
- AUTO/MANUAL + NATIVE_PROVIDER/LEGACY_PRESERVE：保留原生音轨并通过 OpenMontage `full_mix` 叠加唯一全片 MUSIC 轨；不改 owner、不做音频分离。
- MANUAL：只消费调用方明确给出的 `asset_id`，并在有 DeliveryPlan 时验证同一 MUSIC 资产形成唯一的 `0..target_duration_ms` 全片轨；不会从其它本地候选中猜测替换。
- 现有 MUSIC 角色、workspace、MIME、SHA、byteSize、目标时长和幂等测试继续通过。

## 6. 本轮实现证据（2026-09-28）

- `packages/persistence`：全包 `94 pass / 12 skip / 0 fail`；覆盖多候选 AUTO、同一 run 稳定选择、无匹配/短曲 fail-closed、MANUAL/OFF 隔离、native ownership 保留、native+MUSIC 的 full_mix 路径、AudioPlan 时间窗顺序和单一全片轨。
- `apps/control-api/tests/pixabay-auto-fallback.test.ts`：当前 `10/10`；覆盖单次 Pixabay 导入、同一幂等重试复用、同一查询的既有 Pixabay 资产复用、多候选 AUTO 交由既有 selector、持久化 `bgm_prompt` 预检、短曲阻断和 OFF/MANUAL 隔离。
- `@alchemy-video/persistence typecheck`、`@alchemy-video/control-api typecheck`、`git diff --check` 通过。
- 代码测试使用本地 fixture/mock；另有一次真实 30 秒/480P Grok + AUTO BGM 整链路：3/3 segment `ACCEPTED`、合成 `200`、run `SUCCEEDED`，成片 H.264/AAC 848x480、30.125s、无字幕，`music_applied=true`。Pixabay 资产来自既有导入结果；新导入在 Cloudflare 403 时保持 `PROVIDER_UNAVAILABLE`，不绕过来源适配器。本节不等同于人工听感验收。

本文件只记录本轮最小薄壳适配，不能把平台自身的候选评分或 Pixabay fallback 宣称为 OpenMontage 原生算法；总体章节状态需由独立审计决定。
