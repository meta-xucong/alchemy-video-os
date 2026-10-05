# PX-VIDEO-STATUS-01 认证器回归兼容补充（2026-10-04）

## 状态与目的

状态：`DOC_AUDIT_PENDING`。本补充只处理 `pnpm test` 在 `tools/sub2api-video-certifier/tests/certifier.test.ts` 暴露的旧 fixture 与已冻结 Provider 来源语义不一致；不重开 PX-VIDEO-STATUS-01 adapter 实现，不改变 C07/G02/C12.4/C12.5/E12/R01 的验收状态。

## 冻结事实

- 固定来源及规则见《SUB2API 视频状态响应来源对齐开发文档 v2（2026-10-04）》§2.2–2.3：通过平台 HTTP gate 的 JSON object 若递归找不到 `status/state`，来源值为 `unknown`，平台用既有 `PROCESSING` 有界等待；非 JSON/非 object 仍为协议错误。
- `tools/sub2api-video-certifier/tests/certifier.test.ts` 的 C08-OFF-07 当前以含 `message/detail/object_key` 但无状态字段的**有效 JSON object**作为 protocol-drift fixture，并断言立即 `FAILED`。Adapter 对该 object 按来源返回 `PROCESSING`；fake transport 下一次默认返回 `completed`，所以观察到 `SUCCEEDED` 是符合来源语义的结果，而非 adapter 缺陷。

## D/I/A 与精确写集

- 分类：`D0 / I0 / A1`。语义已冻结；只修复一个测试输入，使协议漂移负例确实处于协议错误边界。
- 唯一实现写集：
  - `tools/sub2api-video-certifier/tests/certifier.test.ts`
- 在原 C08-OFF-07 测试中，把 protocol-drift 场景的状态响应 fixture 改为非 object JSON 字符串，并在该字符串中保留现有测试用的合成哨兵：raw request ID、`synthetic-test-key`、`https://example.invalid/...`、`object_key`、`message/detail` 等。rejected 场景保持独立、不改。
- 明确增加调用计数断言：首次 `--stop-after-submit` 恰好一次 POST；`--resume` 后累计 POST 仍恰好一次，且只发一次状态 GET。不得因 protocol-drift 重提任务。
- 保留并逐项检查报告脱敏断言：protocol-drift 报告必须不包含上述每个合成哨兵；断言不能因 fixture 不含哨兵而空通过。仍须断言结果为 `FAILED`、分类为 `PROTOCOL_DRIFT`、错误为 `PROVIDER_PROTOCOL_INVALID`、stage/retryable 与现有规则一致。
- 禁止改动 Provider adapter、来源映射、业务契约、状态机、Worker、其他测试/文档、`.env*`、凭据、真实 Provider 配置或用户项目数据；不执行网络/Provider/TTS/Veyra/VPS/Git 操作。

## 审计与验收

1. 本补充先经独立只读文档审计 PASS，之后才允许修改唯一测试文件。
2. 冻结代码 diff 后，由不同审计者只读检查：fixture 确实是非 object；测试验证来源允许的 `PROCESSING`/有界后续行为没有被错误重新标为 drift；protocol-drift 仍由非 object 结构负例覆盖；上述每个合成哨兵均有非泄漏断言；初次恰好一次 POST 且恢复阶段零 POST、仅一次状态 GET；无额外改动。
3. 运行 `pnpm --filter @alchemy-video/sub2api-video-certifier test`，再运行根 `pnpm test`；记录全部 skip，skip 不计为 pass；最后运行 `git diff --check`。
4. 任何非 object 没有触发 `PROTOCOL_DRIFT`、缺状态 object 被误改成硬失败、出现第二次 POST、越出写集或测试仍失败，均 `HOLD`。即使全部通过，本补充只收敛回归测试，不升级 PX、C07 或商业发布状态。

## 剩余限制

全仓当前仍有既有未提交修改；必须保留并仅审计本补充冻结的 diff。测试通过不代表真实 Hook、路由凭证、生产外部依赖、法律合规、VPS/灾备或商用发布门通过。
