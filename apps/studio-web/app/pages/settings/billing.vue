<template>
  <section class="workspace-page billing-settings-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">ACCOUNT · BILLING</p>
        <h1>计费配置</h1>
        <p class="page-lede">这里展示当前服务端实际生效的 Video OS 计费规则。</p>
      </div>
      <NuxtLink class="secondary-button" to="/">返回工作台</NuxtLink>
    </div>

    <div v-if="loading" class="empty-state">正在读取计费配置…</div>
    <div v-else-if="error" class="notice notice-error">计费配置暂时不可用，请确认已登录且服务端已启用计费。</div>
    <div v-else-if="policy" class="settings-grid">
      <article class="settings-card">
        <div class="settings-card-heading">
          <h2>当前规则</h2>
          <span class="status-pill" :class="policy.enabled ? 'status-pill-success' : 'status-pill-muted'">
            {{ policy.enabled ? "已启用" : "未启用" }}
          </span>
        </div>
        <dl class="settings-list">
          <div><dt>计费模式</dt><dd>{{ modeLabel(policy.mode) }}</dd></div>
          <div><dt>Video OS 附加倍率</dt><dd>{{ policy.surcharge_multiplier ?? "—" }}</dd></div>
          <div><dt>固定附加费用</dt><dd>{{ policy.fixed_fee ?? "—" }}</dd></div>
          <div v-if="policy.charge_amount"><dt>固定总价（兼容规则）</dt><dd>{{ policy.charge_amount }}</dd></div>
          <div><dt>配置来源</dt><dd>{{ sourceLabel(policy.source) }}</dd></div>
        </dl>
      </article>

      <article class="settings-card">
        <div class="settings-card-heading">
          <h2>模型倍率</h2>
        </div>
        <p v-if="policy.mode === 'FIXED_TIERS'" class="muted-copy">固定档位按模型、分辨率和时长精确匹配。</p>
        <p v-else-if="Object.keys(policy.model_multipliers).length === 0" class="muted-copy">当前没有单独的模型倍率，使用全局倍率。</p>
        <dl v-else class="settings-list">
          <div v-for="(multiplier, model) in policy.model_multipliers" :key="model">
            <dt>{{ model }}</dt><dd>{{ multiplier }}</dd>
          </div>
        </dl>
      </article>
    </div>

    <article v-if="isAdmin || policy?.mode === 'FIXED_TIERS'" class="settings-card fixed-tier-card">
      <div class="settings-card-heading">
        <div>
          <h2>固定档位</h2>
          <p class="muted-copy">每个档位只对完全相同的模型、清晰度和时长生效。</p>
        </div>
        <span v-if="isAdmin" class="status-pill status-pill-success">管理员可编辑</span>
      </div>

      <div v-if="isAdmin" class="fixed-tier-toolbar">
        <label class="settings-switch"><input v-model="draft.enabled" type="checkbox"><span>启用固定档位计费</span></label>
        <button class="secondary-button" type="button" :disabled="saving" @click="addTier">新增档位</button>
      </div>

      <div v-if="isAdmin" class="fixed-tier-table-wrap">
        <table class="fixed-tier-table">
          <thead><tr><th>名称</th><th>模型</th><th>清晰度</th><th>秒数</th><th>积分</th><th>状态</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(tier, index) in draft.tiers" :key="`${tier.key}-${index}`">
              <td><input v-model="tier.label" class="settings-input" aria-label="档位名称"></td>
              <td><input v-model="tier.model" class="settings-input" aria-label="模型"></td>
              <td><input v-model="tier.resolution" class="settings-input" aria-label="清晰度"></td>
              <td><input v-model.number="tier.duration_seconds" class="settings-input settings-number" min="1" type="number" aria-label="时长"></td>
              <td><input v-model="tier.charge_amount" class="settings-input settings-number" min="0" step="0.00000001" type="number" aria-label="积分"></td>
              <td><label class="settings-switch"><input v-model="tier.enabled" type="checkbox"><span class="sr-only">启用</span></label></td>
              <td><button class="link-button" type="button" :disabled="saving" @click="removeTier(index)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <p v-if="draft.tiers.length === 0" class="muted-copy">还没有档位，请先新增一行并填入收费表。</p>
      </div>

      <dl v-else class="settings-list">
        <div v-for="tier in (policy?.fixed_tiers ?? [])" :key="tier.key"><dt>{{ tier.label }} · {{ tier.model }} · {{ tier.resolution }} · {{ tier.duration_seconds }} 秒</dt><dd>{{ tier.charge_amount }}</dd></div>
      </dl>

      <div v-if="isAdmin" class="fixed-tier-actions">
        <p v-if="saveError" class="notice notice-error">{{ saveError }}</p>
        <p v-if="saved" class="notice notice-success">已保存，之后创建的任务会使用新档位。</p>
        <button class="primary-button" type="button" :disabled="saving" @click="saveSettings">{{ saving ? "保存中…" : "保存固定档位" }}</button>
      </div>
    </article>

    <p v-if="policy?.enabled && policy.mode === 'USAGE_PLUS_SERVICE_FEE'" class="settings-formula">实际扣费 = Sub2API 已记录的真实用量 +（真实用量 × Video OS 附加倍率 + 固定附加费用）</p>
    <p v-else-if="policy?.enabled && policy.mode === 'FIXED_TIERS'" class="settings-formula">实际扣费 = 匹配到的固定档位积分。只有视频产物通过校验后才扣费。</p>
    <p class="settings-footnote">固定档位由管理员控制台保存；旧规则仍由服务端环境变量兼容读取。规则只对新任务生效，每个任务会冻结创建时的规则，成功产物通过校验后才扣费。</p>
  </section>
</template>

<script setup lang="ts">
import type { FixedVideoBillingSettings, FixedVideoBillingTier } from "~/composables/useControlApi";

const { billingPolicy: fetchBillingPolicy, history: fetchHistory, adminBillingSettings: fetchAdminBillingSettings, updateAdminBillingSettings } = useControlApi();
const loading = ref(true);
const error = ref(false);
const policy = ref<Awaited<ReturnType<typeof fetchBillingPolicy>>["data"] | null>(null);
const isAdmin = ref(false);
const saving = ref(false);
const saved = ref(false);
const saveError = ref("");
const draft = reactive<{ enabled: boolean; tiers: FixedVideoBillingTier[] }>({ enabled: false, tiers: [] });

const modeLabel = (mode: string) => ({
  DISABLED: "未启用",
  FIXED_AMOUNT: "固定金额",
  USAGE_PLUS_SERVICE_FEE: "实际用量 + Video OS 附加费",
  FIXED_TIERS: "固定档位",
}[mode] ?? mode);

const sourceLabel = (source: string) => ({ SERVER_ENVIRONMENT: "服务端环境变量", SERVER_SETTINGS: "管理员设置", DISABLED: "未配置" }[source] ?? source);

const copySettings = (settings: FixedVideoBillingSettings) => {
  draft.enabled = settings.enabled;
  draft.tiers.splice(0, draft.tiers.length, ...settings.tiers.map((tier) => ({ ...tier })));
};

const addTier = () => {
  // Do not invent a price or Provider dimension before the administrator
  // enters the supplied pricing table.  The server schema intentionally
  // rejects an incomplete row if it is saved as-is.
  draft.tiers.push({ key: `video:tier:${crypto.randomUUID()}`, label: "新档位（待填写）", model: "", resolution: "", duration_seconds: 1, charge_amount: "", enabled: false });
};

const removeTier = (index: number) => { draft.tiers.splice(index, 1); };

const saveSettings = async () => {
  saving.value = true;
  saved.value = false;
  saveError.value = "";
  try {
    await updateAdminBillingSettings({ enabled: draft.enabled, tiers: draft.tiers }, `billing-settings-${crypto.randomUUID()}`);
    saved.value = true;
  } catch (caught) {
    saveError.value = caught instanceof Error ? caught.message : "固定档位保存失败，请稍后重试。";
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  try {
    policy.value = (await fetchBillingPolicy()).data;
    const history = await fetchHistory();
    isAdmin.value = history.data.is_admin;
    if (isAdmin.value) copySettings((await fetchAdminBillingSettings()).data);
  } catch {
    if (!policy.value) error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
