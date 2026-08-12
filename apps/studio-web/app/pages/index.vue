<template>
  <section class="workspace">
    <div class="workspace-heading">
      <div>
        <p class="eyebrow">System status</p>
        <h1>Local control plane</h1>
      </div>
      <button
        class="icon-button"
        type="button"
        title="Refresh control API status"
        aria-label="Refresh control API status"
        :disabled="loading"
        @click="loadHealth"
      >
        <RefreshCw :size="18" :class="{ spinning: loading }" />
      </button>
    </div>

    <div class="status-row">
      <CircleDot :size="20" :class="healthState === 'ok' ? 'status-ok' : 'status-idle'" />
      <div>
        <p class="status-title">{{ statusTitle }}</p>
        <p class="status-detail">{{ statusDetail }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CircleDot, RefreshCw } from "lucide-vue-next";

const { health } = useControlApi();
const healthState = ref<"idle" | "ok" | "error">("idle");
const loading = ref(false);
const statusDetail = ref("Waiting for the local control API.");

const statusTitle = computed(() => {
  if (healthState.value === "ok") return "Control API is available";
  if (healthState.value === "error") return "Control API is unavailable";
  return "Control API has not been checked";
});

async function loadHealth() {
  loading.value = true;
  try {
    const result = await health();
    healthState.value = result.data.status === "ok" ? "ok" : "error";
    statusDetail.value =
      result.data.service + " responded with request " + result.request_id + ".";
  } catch {
    healthState.value = "error";
    statusDetail.value = "Start the local control API and retry.";
  } finally {
    loading.value = false;
  }
}

onMounted(loadHealth);
</script>
