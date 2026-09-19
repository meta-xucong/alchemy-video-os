# AI 企业内容生产平台：参考图职责分流与对象锁最小适配开发文档

状态：`IMPLEMENTED_PENDING_AUDIT`（代码已落地，等待本轮定向审计）  
日期：2026-09-03  
适用范围：C11.4/C11.5 的参考图输入边界；不新增正式章节，不改变现行状态账本。

## 1. 目标

修正当前“所有视觉分析对象都进入 `KeyVisualObjectLock`”的过宽行为：

- UI、屏幕、背景、场景、风格和版式参考图继续作为 Provider 参考素材；
- 只有明确的人物、实体产品、道具、持有或换手事实才进入对象锁；
- 参考图顺序、既有 `SUBJECT/SCENE/STYLE/HANDOFF` 角色和公开契约保持不变；
- 保险 AI 项目的四张 UI 图不再占用对象锁容量。

本文件记录本次最小实现方案与证据边界；不授权真实 Provider、视觉服务或状态升级。

## 2. 当前问题与最小改动边界

当前链路为：选中资产 → 按用户用途/既有角色分流 → 仅对 `LOCK_OBJECTS` 资产读取 `visual_analysis.objects` → `resolveVisualObjectLocks()` → 与文本抽取结果合并 → 写入每个 MotionBeat。直生成 Control API 也使用同一分流结果；参考图传递本身不受过滤影响。对象锁 schema 的 `key_visual_objects` 上限为 12，而参考素材协议上限为 7；历史上四张保险 UI 图的分析对象合计超过 12，曾导致规划失败。

现有对象锁对前景连续性仍有价值，但不应把参考图角色等同于对象锁资格。C11.4/C11.5 中“明确前景对象/持有/换手”的规则保留；本文件仅覆盖输入分流，并覆盖旧文档中“视觉分析对象默认合并”的解释。

## 3. 来源映射与不可宣称内容

| 固定来源 | 可复用语义 | 平台落点 | 边界 |
| --- | --- | --- | --- |
| `upstream/seedance-2.5` `ebc68d3c19a62fba0f9ba9d2805af1f711a82aa7`；`skill/seedance-25/references/references.md`、`references/prompting.md` | 参考图按输入顺序声明职责；每个维度一个 owner；只加入必要的 continuity/critical locks | 现有 `ReferenceBinding`、`referenceMap`、私有对象锁输入 | 来源没有 `KeyVisualObjectLock` 或 UI 自动分类 |
| `upstream/openmontage` `4eab34c5cfcccaa4f1970554928feccce73ee930`；`skills/creative/video-gen-prompting.md`、`skills/creative/prompting/grok-prompting.md`、`lib/shot_prompt_builder.py` | 按已填字段组织短提示；为图片分配明确角色；跨镜头重复必要身份锚点 | Provider 参考图传递和 Prompt 编译 | 来源没有对象锁 schema、数量 12 上限或图像区域识别 |
| `upstream/huobao-drama` `f04d705603bd0257bcec6b8f44fd04ea3ea9b795`；`prompt-generator/video-prompt/SKILL.md`、`storyboard-breaker/SKILL.md` | 用户描述和镜头顺序是事实来源；不按上传位置猜测内容 | 现有创作说明和分镜输入 | 来源没有参考图到对象锁的映射 |
| 本地 C11.4/C11.5 | 明确人物/道具连续性、单实例和显式换手 | `visual-object-locks.ts`、MotionPlan | 属于平台薄壳适配，不得称为上游原码 |

UI/背景与对象锁的分流不是三份上游的现成算法，而是必要的平台边界适配；没有证据时必须 `UNAVAILABLE/BLOCKED`，不能猜测。

## 4. 最小设计

### 4.1 内部职责判定

在现有参考角色解析之后增加一个仅在内存中存在的判定，不增加公开字段、数据库列、事件或 Provider 参数：

```text
LOCK_OBJECTS   明确前景人物/实体产品/道具/持有/换手
REFERENCE_ONLY UI/屏幕/背景/场景/风格/配色/版式等参考素材
```

判定顺序：

1. 用户明确用途优先。诸如“UI/界面/屏幕/面板/背景/场景/风格/配色/版式参考”“仅作参考”只产生 `REFERENCE_ONLY`，不导入该图片的 `visual_analysis.objects`。
2. 用户明确写出人物、实体产品、道具、手持、佩戴、换手或连续性要求时，才允许 `LOCK_OBJECTS`，继续使用现有 C11.4/C11.5 字段和解析器。
3. 已有视觉分析只能支持与用户用途一致的决定；仅有 UI、布局、文字、颜色等事实不得升级为对象锁。视觉分析不能单独创造人物/道具锁。
4. 仅有 `SUBJECT` 角色不等于对象锁；“产品界面主体参考”仍按 UI 语义处理。
5. 用途或事实冲突、无法证明时不进入对象锁；参考角色本身仍由既有门禁决定是否等待/阻断，不依据上传顺序、未被用户明确提及的文件名或图片位置猜测。

### 4.2 数据流

```text
有序 source_asset_ids
  → 现有 inferVisualReferenceRoles / 参考角色事实
  → 内部 LOCK_OBJECTS / REFERENCE_ONLY 判定
  ├─ 所有图片继续进入有序 REFERENCE_SET/HANDOFF 输入
  └─ 只有 LOCK_OBJECTS 资产的对象事实进入 resolveVisualObjectLocks
       → 现有文本对象锁合并、MotionPlan、C11.4/C11.5 校验
```

原始创作说明、参考图角色和图片顺序不得被改写。`REFERENCE_ONLY` 只影响对象锁输入，不影响图片传递。

### 4.3 具体代码落点（本轮已落地）

1. `packages/domain/src/reference-roles.ts`：复用现有用户说明优先、视觉分析其次的解析；增加内部职责判定所需的最小结果，不新增公开角色枚举。
2. `packages/persistence/src/creative-planning-repository.ts`：在读取 `visual_analysis.objects` 前按职责判定过滤 `REFERENCE_ONLY` 资产；工作区、项目、READY、IMAGE 校验保持不变。
3. `packages/domain/src/visual-object-locks.ts` / `packages/creative-planning/src/index.ts`：保留明确前景文字的对象锁；仅将参考用途说明从“对象锁来源”中排除，不改变原始 Prompt/叙事事实。
4. `apps/control-api/src/app.ts`：直生成路径复用同一职责判定，只把 `LOCK_OBJECTS` 分析对象交给既有 Prompt Compiler；参考图角色、顺序和传递不变。
5. 对象锁数量超过现有 12 上限时直接沿用既有 schema 失败路径；不得恢复或新增静默 `.slice(0,12)` 丢弃事实。参考图超过既有 7 张上限时继续沿用参考素材门禁。
6. `initialVisualInput` 的参考图角色、位置和 Provider 传递顺序不改；不添加第二套 reference transport。

## 5. 保险 AI 与茅山案例预期

- 保险 AI 四张图均明确为 UI/界面、场景或风格参考：四张图全部保留并按原顺序传递，图片视觉分析产生的 `visualObjectLocks` 为空；原始故事若明确写出前景对象（例如“母亲拿起手机”），该文本对象锁仍保留，规划不因 26 个 UI 分析对象触发 12 上限。
- 茅山项目的背景/场景参考继续保持参考素材语义，不生成对象锁。
- 明确“人物手持手机/道具”的图片仍进入现有对象锁和换手路径；不能因为本适配而削弱 C11.4/C11.5。
- UI 与人物/道具混合时，只锁有明确前景事实的对象，所有参考图仍保留。

## 6. 明确不做

- 不新增 OCR、CLIP、区域分割、相似度、置信度评分或排序算法。
- 不依据上传顺序、未被用户明确提及的文件名、图片数量或“主体”单词猜测对象锁。
- 不新增公开 API、数据库迁移、事件字段、Provider 参数、UI 开关或新的参考角色。
- 不删除参考图，不把 `REFERENCE_ONLY` 图片降级成文生，不修改已有 `ReferenceBinding` 语义。
- 不自动把模糊/混合图片判为对象锁；不以一次真实生成替代来源和行为证据。

## 7. 定向测试与 Exit Gate

本轮已补充/复核以下行为证据：

1. 四张保险 UI fixture：全部参考图保留、顺序不变、对象锁为空、规划成功。
2. 茅山多背景 fixture：仍为参考素材且对象锁为空。
3. 明确人物/道具/持有 fixture：对象锁字段、MotionBeat 绑定和 C11.5 换手回归不变。
4. UI + 前景实体混合 fixture：只产生前景锁，图片不丢失。
5. 用途不明确或分析冲突：等待/阻断，不按位置猜测。
6. 13 个以上明确前景对象：既有 schema 拒绝，不静默截断；7 张以上参考图：既有参考素材门禁拒绝。
7. 角色→图片映射严格保持输入顺序。

建议命令：

```text
pnpm --filter @alchemy-video/domain test
pnpm --filter @alchemy-video/creative-planning test
pnpm --filter @alchemy-video/persistence test
pnpm --filter @alchemy-video/workflow-worker test
pnpm typecheck
```

测试只使用本地 fixture/mock；不得以静态命中代替规划行为证据。通过上述测试仅可提交该适配切片 `READY_FOR_AUDIT`，不能升级 C11.4/C11.5 或总体状态为 `ACCEPTED`。

## 8. 兼容、回滚与审计记录

旧 PromptPackage、MotionPlan、TaskRun 和公开 DTO 无需迁移；没有职责判定事实时继续旧的等待/阻断行为。回滚只移除参考图到对象锁的过滤，不改写历史产物。

实施时必须在来源登记和章节审计中记录：固定 commit/path、目标文件/符号、过滤前后对象数量、保留的输入顺序、测试命令与计数。文档不得写成“完整移植对象锁”或“自动识别已完成”；对象锁仍是平台 C11.4/C11.5 薄壳，UI/背景分流是本地边界适配。

### 8.1 本轮实现与保险 AI 只读复核（2026-09-03）

- 已落地目标：`packages/domain/src/reference-roles.ts`、`packages/domain/src/visual-object-locks.ts`、`packages/persistence/src/creative-planning-repository.ts`、`apps/workflow-worker/src/execution-service.ts`，以及直生成路径 `apps/control-api/src/app.ts`；仅增加内部职责分流，未增加公开字段、数据库列、事件或 Provider 参数。
- 领域行为测试：52/52 通过；持久化单测：68/68 通过、12 项因缺少 `DATABASE_URL` 按既有规则跳过；工作流测试：17/17 通过；创作规划测试：49/49 通过；Control API 直生成窄测：12/12 通过。测试均为本地 fixture/mock。
- 保险 AI 数据库只读结果：revision 32 的四个输入文件按 source 顺序为 `02.png`、`16.png`、`04.png`、`26.png`；解析角色为 `SUBJECT`、`SCENE`、`STYLE`、`STYLE`（文件名用途覆盖冲突的分析角色），职责均为 `REFERENCE_ONLY`；视觉分析对象数为 `6/7/5/8`，解析出的图片对象锁为 `[]`。这表示四张图仍作为参考素材传递，未占用对象锁容量；原始故事中明确写出的文本对象锁（如“手机”）不在该图片过滤结果内，仍按既有文本路径处理。
- 未完成的验证边界：未执行真实 Provider、视觉服务或端到端人工成片；生产数据库集成测试仍受 `DATABASE_URL` 缺失而跳过。上述结果仅支持本适配切片提交 `READY_FOR_AUDIT`，不代表 C11.4/C11.5 或总体平台 `ACCEPTED`。
