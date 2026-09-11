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
          <div><dt>配置来源</dt><dd>{{ policy.source === "SERVER_ENVIRONMENT" ? "服务端环境变量" : "未配置" }}</dd></div>
        </dl>
      </article>

      <article class="settings-card">
        <div class="settings-card-heading">
          <h2>模型倍率</h2>
        </div>
        <p v-if="Object.keys(policy.model_multipliers).length === 0" class="muted-copy">当前没有单独的模型倍率，使用全局倍率。</p>
        <dl v-else class="settings-list">
          <div v-for="(multiplier, model) in policy.model_multipliers" :key="model">
            <dt>{{ model }}</dt><dd>{{ multiplier }}</dd>
          </div>
        </dl>
      </article>
    </div>

    <p v-if="policy?.enabled" class="settings-formula">实际扣费 = Sub2API 已记录的真实用量 +（真实用量 × Video OS 附加倍率 + 固定附加费用）</p>
    <p class="settings-footnote">配置由服务端环境变量管理，页面只读；修改后需要重启 Control API 和 Worker 才会对新任务生效。每个任务会冻结创建时的规则，成功产物通过校验后才扣费。</p>
  </section>
</template>

<script setup lang="ts">
const { billingPolicy: fetchBillingPolicy } = useControlApi();
const loading = ref(true);
const error = ref(false);
const policy = ref<Awaited<ReturnType<typeof fetchBillingPolicy>>["data"] | null>(null);

const modeLabel = (mode: string) => ({
  DISABLED: "未启用",
  FIXED_AMOUNT: "固定金额",
  USAGE_PLUS_SERVICE_FEE: "实际用量 + Video OS 附加费",
}[mode] ?? mode);

onMounted(async () => {
  try {
    policy.value = (await fetchBillingPolicy()).data;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
