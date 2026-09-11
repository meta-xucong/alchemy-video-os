import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("account bar and project history use public, provider-neutral state", () => {
  const layout = read("app/layouts/default.vue");
  const history = read("app/pages/history.vue");
  const api = read("app/composables/useControlApi.ts");
  const source = `${layout}\n${history}\n${api}`;

  assert.match(layout, /项目历史/);
  assert.match(layout, /account\.isAdmin/);
  assert.match(layout, /账户暂不可用/);
  assert.match(layout, /account-menu/);
  assert.match(layout, /积分余额/);
  assert.match(layout, /并发额度/);
  assert.match(layout, /退出 AISelf/);
  assert.match(layout, /loginWithAiself/);
  assert.match(layout, /if \(typeof window !== "undefined"\) loginWithAiself\(\)/);
  assert.match(api, /const logout = .*\/auth\/logout/);
  assert.match(history, /scopeLabel/);
  assert.match(history, /result\.data\.is_admin/);
  assert.match(history, /`\/projects\/\$\{item\.id\}`/);
  assert.match(api, /const history = \(\) => \$fetch<ProjectHistoryResponse>\("\/api\/v1\/me\/history"\)/);
  assert.match(api, /const credits = \(\) => \$fetch<CreditAccountSummaryResponse>\("\/api\/v1\/me\/credits"\)/);
  assert.doesNotMatch(source, /\/internal\//);
  assert.doesNotMatch(source, /provider_request_id|object_key|localStorage|Veyra/i);
});

test("billing settings is a read-only public policy view", () => {
  const page = read("app/pages/settings/billing.vue");
  const api = read("app/composables/useControlApi.ts");
  assert.match(page, /计费配置/);
  assert.match(page, /服务端环境变量/);
  assert.match(page, /需要重启 Control API 和 Worker/);
  assert.match(page, /fetchBillingPolicy/);
  assert.match(api, /billingPolicy[\s\S]*\/api\/v1\/me\/billing-policy/);
  assert.doesNotMatch(page, /method:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
  assert.doesNotMatch(page, /localStorage|Veyra|token|internal/i);
});
