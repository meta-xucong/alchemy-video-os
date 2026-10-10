# 剩余依赖风险：来源核验、最小修复方案与验收门

日期：2026-10-10 UTC。研究基线：`3fd8410baf904e879ae353e796b98b10e7ea3495`。

本文件先记录实施前方案，再记录经独立设计评审后的限定实施。已做源码检查、官方公告/registry 查询、兼容实验和独立干净安装回归；**只修改限定 manifest/lockfile 与新增工具链回归，没有修改审计门禁**。本轮没有真实 Provider、生产数据库、部署、合并或外部 artifact 上传。

## 1. 结论与状态

1. **限定实施完成，最终集成验收待主任务**：移除 `drizzle-kit@0.31.10` 声明但其发布代码已不调用的 `@esbuild-kit/esm-loader` 依赖边，消除由该边独占引入的 `esbuild@0.18.20`。独立干净安装的真实 CLI 回归已通过；最终树的集成/CI 和远端再审计没有据此自动通过。
2. **仍为 OPEN / BLOCKED_UPSTREAM**：`node-forge@1.4.0` 和 `braces@3.0.3`。核验时官方 registry 的 latest 仍分别为这两个版本，GitHub Reviewed 公告均未列 patched version。不得伪造更高版本号、静默空实现、忽略 advisory 或把 dev 依赖风险写成“全部修复”。
3. **生产图和完整图必须分开陈述**：现有生产审计为 219 个依赖、0 告警；完整审计为 848 个依赖、2 high / 1 moderate。生产图无告警不是完整开发/构建供应链清零，也不是本轮重新验证过最终镜像。

## 2. 基线证据与范围

已读取 `AGENTS.md`、`doc/修复开发记录_20261009.md` 的依赖及生产隔离记录、相关安全边界文档、根和两个 workspace manifest、`pnpm-lock.yaml`、CI 工作流和生产镜像 verifier。

本轮使用 Node `v24.19.0`，所有 pnpm 命令均从项目锁定的工具入口执行：

```sh
node /workspace/shared/video-tools/node_modules/pnpm/bin/pnpm.cjs <arguments>
```

已有审计报告仅本地读取，没有重传或改用其他上传渠道：

| 报告 | SHA-256 | 结论 |
| --- | --- | --- |
| `/tmp/video-final-all-audit.json` | `68a76f697fc045a9bdcd0ae5628a566039677259d428b79970e399e3682a9cf3` | 848 dependencies；2 high、1 moderate；muted 为空 |
| `/tmp/video-final-prod-audit.json` | `10cb110048a70097db612e8880c1688d4a6451a06c6fb0c8be3a9239317704c4` | 219 dependencies；所有 severity 为 0；muted 为空 |

`pnpm -r why node-forge braces esbuild` 和锁文件交叉验证的路径如下。审计报告只列一个路径时，不能据此忽略同包的其他父路径。

| 依赖 | 实际锁定路径 | 作用域 |
| --- | --- | --- |
| `node-forge@1.4.0` | Studio → `nuxt@3.21.11` → `@nuxt/cli@3.37.0` → `listhen@1.10.1`；另外 Nuxt → `@nuxt/nitro-server@3.21.11` → `nitropack@2.13.4` → 同一 listhen | Nuxt 是 Studio devDependency；两条路径均应纳入处理 |
| `braces@3.0.3` | Studio → Nuxt → `@nuxt/nitro-server` → Nitro → `globby@16.2.3` → `fast-glob@3.3.3` → `micromatch@4.0.8` | 构建/开发图 |
| `esbuild@0.18.20` | persistence → `drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader@2.6.5` → `@esbuild-kit/core-utils@3.3.2` | Drizzle Kit 是 persistence devDependency；旧 esbuild 只有这条引入路径 |

另有已修复版本 `esbuild@0.25.12`（Drizzle Kit 直接依赖）和 `0.28.2`（tsx/Nitro/Vite 等）。不能用它们的存在代替对 `0.18.20` 的处理。

## 3. 当前上游事实和可达性

### 3.1 node-forge：没有可直接升级的已发布修复

- [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) / CVE-2026-85393：RSA PKCS#1 v1.5 验签对嵌套 DigestAlgorithm 额外元素的校验不足；影响 `<=1.4.0`，公告未列修复版。
- [官方 registry](https://registry.npmjs.org/node-forge/latest) 通过 `pnpm view node-forge version --json` 返回 `1.4.0`。`pnpm view listhen version dependencies --json` 返回 latest `1.10.1`，仍声明 `node-forge: ^1.4.0`。
- [Forge #1152](https://github.com/digitalbazaar/forge/pull/1152) 仍为 open；其针对性测试报告不是完整上游套件已通过的证明。2026-10-09 的审查指出该分支存在 `describe.only` 导致完整测试覆盖不足；[另一个候选 #1158](https://github.com/digitalbazaar/forge/pull/1158) 也仍为 open。不能把 open PR 当作已发布、维护者接受的安全版本。
- 锁定 listhen 的 `dist/shared/listhen.tqe5I1Rl.mjs` 使用 Forge 做本地 TLS 证书、密钥和 PKCS12 处理；其公开入口也静态导入 Forge。没有找到该调用方直接调用 RSA `verify` 的路径。此结论只说明已检查调用面的风险条件，不能声称 Forge 包不被加载或所有内部路径不可达。
- 当前 `apps/studio-web/scripts/serve-local.mjs` 先 `nuxt build`，再启动 standalone Nitro，默认 loopback；`nuxt.config.ts` 没有启用 HTTPS 证书配置。应用源码没有直接导入 Forge。没有证据表明当前业务请求把攻击者签名交给 Forge 验证，但构建工具包仍包含漏洞代码。

**处理**：等待可核验的正式 patched release，或在独立方案中验证上游维护者接受的补丁/父依赖迁移。禁止只删 CLI 路径，因为 Nitro 也引入 listhen；也禁止把 listhen 的实际静态依赖直接删除或替换成空包。

### 3.2 braces：构建调用真实存在，没有官方修复版

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687：递归 AST 遍历可因深层嵌套模式耗尽栈；影响 `<=3.0.3`，公告未列修复版。
- [官方 registry](https://registry.npmjs.org/braces/latest) 的 version 查询返回 `3.0.3`；[上游 issue #70](https://github.com/micromatch/braces/issues/70) 仍为 open。
- 锁定 Nitro 的 `dist/core/index.mjs`、`dist/rollup/index.mjs` 真实调用 globby，包含固定扫描模式、配置生成的 includePatterns 和 `asset.pattern`。当前仓库没有业务源码把终端用户请求作为 glob 模式传入这条链；仍应把构建配置和构建输入视为受信边界，不能把“只在开发依赖”解释为完全不执行。
- 当前路径不能用一个 `braces: '-'` 删除：micromatch 的匹配行为依赖它。用其他库冒充同名包、私自加递归深度阈值或强制父包跨主版本，会引入未经来源/兼容性证明的新行为。

**处理**：正式 patched release 优先；若父依赖正式迁移 away from braces，另立兼容变更验证匹配语义、静态资产、Nitro 构建、Studio 类型和 HTTP smoke。未验证的 Nuxt/Nitro 主版本升级不纳入这次最小修复。

### 3.3 esbuild：漏洞范围和真实 loader 使用需要区分

- [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) 影响 `<=0.24.2` 的开发服务器跨域读取；修复从 `0.25.0` 开始。[官方 0.25.0 release](https://github.com/evanw/esbuild/releases/tag/v0.25.0) 明确存在向后不兼容变更，包括 serve API；所以不能默认 `~0.18.20` 与 `0.25.x` 兼容。
- 锁定 `@esbuild-kit/core-utils@3.3.2` 的 package.json 声明 `esbuild: ~0.18.20`；其发布代码对 esbuild 的调用是 `transform`、`transformSync` 和 `version`，未发现 serve/context 调用。旧 loader 和 core-utils 都已弃用并[合并到 tsx](https://github.com/esbuild-kit/esm-loader)。
- 更关键的是：对锁定 Drizzle Kit 整个发布包进行字符串检索，`@esbuild-kit/esm-loader` 和 `@esbuild-kit/core-utils` 只命中 package.json 的旧 loader 依赖声明。真实 CLI 中 `ensureTsxRegistered` 调用 tsx，`safeRegister` 用它加载配置和 schema；[固定 tag 源码](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/utils.ts) 与发布代码相符。
- [固定 tag manifest](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/package.json) 同时保留旧 loader 和新的 tsx。`bin.cjs` SHA-256：`44f5420e63c88e13e750f5233878b054e262c3223bd94eabf6ac05b2ae77abd7`。
- 当前 [Drizzle Kit registry](https://registry.npmjs.org/drizzle-kit/latest) 返回 `0.31.11`，仍声明 `@esbuild-kit/esm-loader: ^2.5.5`。[0.31.11 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit%400.31.11) 描述的是 migration check 告警，不是移除此依赖。单纯升级到 latest 不能关闭旧 esbuild 路径。

## 4. 最小实施建议：删除一条经证明未使用的依赖边

独立设计评审批准后，已在根 `pnpm.overrides` 加入准确父版本限定：

```json
"drizzle-kit@0.31.10>@esbuild-kit/esm-loader": "-"
```

不调整 Drizzle Kit/ORM、tsx、esbuild 的任何版本；不替换任何第三方源码；不改数据库契约。这个 override 的目的是真正不安装废弃依赖链，不是过滤安全工具结果。现有 Nuxt DevTools 删除使用相同类别的父作用域机制，但该先例本身不能代替这里的可达性证据和回归。

**维护支持风险**：这仍是本项目对上游声明依赖图的本地裁剪，尚未取得 Drizzle 维护者对该裁剪的正式支持。源码和 smoke 能限定当前使用面的兼容性，不能代表维护者的支持承诺。以准确父版本、干净安装实际缺包测试和项目现用 CLI 路径约束风险；若将来引入新的 Kit 命令/运行环境或 Kit 升级，必须重审。现阶段不采用 RC、不强制跨不兼容版本范围替换，也不把剩余风险登记当作用户已接受风险。

实施限制：

1. selector 只覆盖经过检查的 `0.31.10`；不写 `drizzle-kit>@esbuild-kit/esm-loader` 的无限父版本规则。后续 Kit 升级必须重新检查，不能自动扩大例外。
2. 正式安装后确认 loader、core-utils、`esbuild@0.18.20` 和其独占平台二进制都退出实际解析图/锁文件。仅在当前机器删除目录不能算修复。
3. 保留直接 `esbuild@0.25.12` 和 `tsx@4.23.12` 及其正常依赖；不得顺手统一所有 esbuild、升级 Nuxt 主版本或改业务运行代码。
4. 若测试发现运行时实际需要旧 loader，停止此路线。备选的精确 `@esbuild-kit/core-utils@3.3.2>esbuild: 0.25.12` 超过原声明范围，必须另行完成 transform/source-map/ESM-CJS 兼容审计后评审；本方案不批准这种替换。

### 4.1 本轮已完成的预实施实验

- 通过项目 pnpm 入口，在 persistence 工作区运行 `drizzle-kit generate --dialect postgresql --schema ./src/schema.ts --out /tmp/video-dependency-baseline-generate --name dependency_probe`：48 表生成成功。
- 在独立 Node 进程中给 CommonJS `_resolveFilename` 加测试拒绝规则：拒绝所有 `@esbuild-kit/*` specifier、对应解析路径和 `esbuild@0.18.20` 路径；运行相同真实 CLI/schema，输出到另一个临时目录。生成成功，拒绝命中次数 0，实际观测到的 esbuild 版本只有 `0.25.12`。
- 同样的拒绝规则下运行 `drizzle-kit check --config ./drizzle.config.ts`：真实 TypeScript 配置读取成功，migration metadata 检查成功；拒绝命中次数 0，观测到 esbuild `0.25.12`。
- 两次生成的 SQL 经 `cmp` 完全一致，SHA-256 都为 `44b66d2707edc372a9535b6cbf52ca88074460c0a6bd98bdf7143a910e8aa18e`。

这是源码证据加真实命令的模拟缺失实验。它没有真的重建依赖树，也不覆盖 Drizzle Studio、push、pull、Bun/Deno 或全部第三方 API。项目使用的是 `db:generate` 和现有 `tsx src/migrate.ts`；不得把这些有限实验证据扩大为其他接口的兼容承诺。

### 4.2 实施后必须补齐的验收

| 验收项 | 成功条件 | 当前状态 |
| --- | --- | --- |
| 限定 manifest/lock 变更 | 只有经评审的删除边与独占子树发生变化；没有 unrelated upgrades | 通过：25 个包记录及 25 个 snapshot 移除，其他版本/完整性/importer 不变 |
| 干净 frozen install | 从最终 manifest/lock 安装成功；不是复用旧 node_modules 假通过 | 通过：独立目录 offline / frozen / ignore-scripts 安装 675 包，0 下载；另行 Nuxt prepare 通过；未声称所有安装 hook 通过 |
| 正式兼容回归 | 配置加载、现有 48 表生成、SQL 等价、`check`、重复 generate 无额外差异；禁止输出到仓库既有 migration 目录 | 冻结基线与恢复方案最终 schema 均通过 |
| loader 不可达性守卫 | 断言锁定 Kit 版本/移除边、实际不可解析旧链，并调用真实 CLI；不是只匹配文本或 mock 掉 CLI | 新增永久测试，独立干净树通过 1/1、0 skip；旧依赖树按预期失败 |
| 存量 migration | 只在任务专属隔离 PostgreSQL 执行当前迁移及相关 persistence 集成测试，不接触生产 | 未执行 |
| 全仓回归 | 最终树的 typecheck、Node 单元/契约/集成、Studio build/tests、必要媒体测试、diff hygiene 和既有 CI 全部核验 | 本研究未重跑 |
| 完整依赖审计 | esbuild advisory 不再出现；预期仍有两项无补丁 high，新增告警必须重新评估 | 远端再审计被授权审核拒绝，未验证；本地实际图已移除受影响 esbuild |
| 生产依赖审计 | 保留原 `pnpm audit --prod --audit-level=high --json`，确认仍为 0 | 基线 0；远端再审计授权阻断，不能沿用为修复后结果 |
| runtime 隔离 | 最终 Docker prune/import/media binary/Studio HTTP smoke；Forge/braces 不进入 runtime，保留 verifier | 本研究未重跑 |

正式回归应保存机器可复查的退出码、断言结果和最终 SHA。SQL 比较应固定 schema 内容；如果同时发生 schema 变更，重新生成对照，不能机械沿用上面的 SQL hash。网络 audit endpoint 失败必须标记未验证，不能按零告警处理。

## 5. 无补丁项的退出条件与防止假闭合

- node-forge 退出条件：正式版本/维护者接受的准确来源修复覆盖该 CVE；固定版本后验证 listhen 两条父路径、Nuxt prepare/typecheck/build、开发/standalone 启动和生产隔离，完整审计复核该 advisory 已清除。
- braces 退出条件：正式修复版本或正式父依赖替代路径；验证正常 brace/glob 行为与上游深层嵌套回归、构建资产集合等价、Studio/Nitro 测试和生产隔离；完整审计复核。
- 补丁尚未发布时，保持明确 OPEN，重新评估触发点是上游合并/发布、父依赖升级、引入新的 untrusted glob/验签输入、构建工具进入 runtime 或下一次依赖安全评审。这里没有创建新的定时监控。
- 不改现有 production audit 的门槛，不添加 advisory ignore、`continue-on-error`、吞掉非零 audit 退出码或虚假版本来制造绿色。当前 CI 的生产 audit 成功不能被重新表述为“全依赖 audit 成功”。如果要求全依赖 high gate 也全绿，当前这两项应继续阻断该目标。
- 完整 audit JSON 和 runtime package inventory 的 artifact 上传此前已被拒绝。本轮不添加 upload 步骤，也不通过日志粘贴、其他存储或其他通道绕过同一交付限制。需要交付时由主任务另行确认允许的操作；已有本地报告可继续用于授权的分析。

## 6. 查询方法与研究限制

registry 查询示例（只更改本次命令的可写 cache 位置，不改 registry）：

```sh
npm_config_cache=/tmp/video-dependency-npm-cache \
  node /workspace/shared/video-tools/node_modules/pnpm/bin/pnpm.cjs \
  view drizzle-kit version dependencies engines --json
```

相同方式已成功查询 node-forge、braces、`@esbuild-kit/core-utils`、listhen。初次默认 cache 不可写导致 ENOENT，换到 `/tmp` 后这些查询成功；没有用失败的结果推断版本。附带的 Nitro/globby latest 查询返回尚未取得，工具的等待操作被取消，因此本文件不声称已核验它们的最新发行状态，也不据此推荐父包升级。这里的 Nitro/globby 结论依据实际锁定代码。

## 7. 限定实施记录

- 变更文件：根 `package.json`、`pnpm-lock.yaml`、`packages/persistence/tests/drizzle-toolchain.test.ts` 和本文件。未编辑 CI、共享 schema、数据库 migration 或其他代理的契约改动。
- 初次 `install --lockfile-only --offline` 因本地缺少 registry metadata 失败。为避免重新解析导致隐式升级，准确裁剪旧 loader → core-utils → esbuild 0.18.20 及其 22 个平台包；随后 `install --lockfile-only --frozen-lockfile --offline --ignore-scripts` 成功。
- 结构化比较前后 lock：importers、settings、保留包的版本/完整性及 snapshots 不变；唯一保留 snapshot 改动是 Drizzle Kit 的旧 loader 依赖边删除。共删除 25 个包记录及其 25 个 snapshot。当前 lock SHA-256 为 `bf2812f5f58603ead4b247dcad60c2042cb002b8b21f432bfa8a0e17a2d84bf4`。
- 在独立 `video-dependency-clean` 目录使用已有 `/workspace/shared/video-pnpm-store` 执行 `install --frozen-lockfile --offline --ignore-scripts --store-dir /workspace/shared/video-pnpm-store`：675 包、0 下载、退出 0。没有改主工作树正在被其他测试使用的 node_modules。随后 contracts build 和 Nuxt prepare 分别通过。跳过的安装 hooks 和媒体二进制验收仍由主任务的最终安装/镜像检查负责。
- 永久测试不依赖 mock CLI：检查 Kit 和直接 esbuild 版本，验证旧模块从调用方及 Kit 均不可解析，检查实际 `.pnpm` 目录不含旧链；复制当前真实 schema 到临时目录，导入真实 Drizzle 配置，执行两份 generate/check 和各自重复 generate，比较 SQL 与 journal 稳定性，最后清理临时目录。schema 内容在单次测试内冻结，不受其他源码编辑打断比较。
- 干净树执行 `pnpm --filter @alchemy-video/persistence exec node --import tsx --test tests/drizzle-toolchain.test.ts`：1 passed、0 failed、0 skipped。原 tsx CLI 在此 sandbox 因 IPC pipe `EPERM` 未能启动，改用同一 tsx 官方 import 入口运行 Node test；没有修改产品 test script 或降低断言。首次新测试还发现 Drizzle `check` 对绝对 out 路径拼接不兼容，测试改为 workspace-relative 临时 out，与现有配置用法一致。
- 旧主工作树尚未重装依赖，执行相同新测试在“旧 loader 应不可解析”的断言上按预期失败；这是回归的负向控制，不是修复后干净树失败。主任务最终重装后必须再次通过。
- 使用同一冻结 schema 字节（SHA-256 `a633ed6cb1d6993064416c889947bdc6e0d34ec1a8e33baffc574ebd70145707`），分别由原安装树和新干净树的真实 CLI 生成 SQL：两者仍为 `44b66d2707edc372a9535b6cbf52ca88074460c0a6bd98bdf7143a910e8aa18e`。干净树 `pnpm -r why` 只剩 esbuild 0.25.12 / 0.28.2，没有旧 loader/core-utils。
- 恢复方案负责人确认最终 schema 冻结后，核对并复制其准确字节到独立干净树（SHA-256 `546f12f1cd4744e6c986118d7457b2d1a848a849f5c0104da0199d383ecfb86b`，没有新增 contracts 导入），再次运行永久工具链测试：1 passed、0 failed、0 skipped。没有覆盖恢复方案文件或重新生成其已提交的 migration。
- 新的完整/生产远端 audit 请求被审核拒绝：其请求会向公开 `registry.npmjs.org` 发送 workspace 依赖图/metadata，当前证据未明确覆盖该数据与目的地。已停止且通知主任务，未重试、改换 endpoint 或间接上传。需要对应的用户授权证据或明确批准才能重试；本地旧公告映射不能当作新 audit 结果。
- 此授权等待也覆盖新触发的 GitHub Actions production audit；`--prod` 只是缩小传输范围，不能通过 CI 间接执行同一被拒绝的数据传输。在授权确认前暂缓会触发该 job 的发布操作，保持现有 gate 不变；不能删除或跳过 audit step 以便宣称 CI 通过。
- 较早的联网安装在获取结果时被取消，实际没有完成 workspace 链接；没有把它记为成功，也没有重试该取消的调用。后续成功的是不联网的独立安装。`git diff --check` 通过。

上面的前后 SQL 对照与恢复方案最终 schema 测试各自有明确冻结输入。最终主工作树重装后的整体测试、完整集成/CI 与任何获准的重新 audit 仍待主任务汇总，不能用本记录替代。

### 2026-10-10 21:58 UTC 授权状态更新

用户明确批准将依赖名称、版本和关系发送到官方 `registry.npmjs.org` 以重新审计，并选择本地隔离部署测试。以上“等待授权”条目保留为历史执行记录；获准后恢复完整/生产 audit 及对应 CI。此批准不包括完整 audit JSON 或运行镜像清单的上传，也不代表接受剩余漏洞或批准生产部署。最新实际审计结果另行记录，不继承旧次数。

### 获准后的实际审计结果

使用官方 registry 和固定 pnpm 10.33.0 重跑：生产依赖 219 项、零漏洞，退出 0；完整依赖 821 项、2 high、0 moderate、0 critical，退出 1。剩余为 `node-forge` 的 `GHSA-86w9-cpqp-85rv` 与 `braces` 的 `GHSA-vfj7-8cjw-p6xm`，响应均未提供修复版本。旧 esbuild 告警已不再出现，两份响应的 muted 列表为空；没有降低门槛或静默忽略告警。完整 JSON 仅在本地保存，没有上传。两项 high 继续 OPEN，不能将生产审计通过说成全依赖零风险。
