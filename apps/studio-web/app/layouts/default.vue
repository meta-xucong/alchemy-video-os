<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink class="brand" to="/" aria-label="AI 企业内容生产平台首页">
        <Clapperboard :size="20" :stroke-width="1.8" />
        <span>AI 企业内容生产平台</span>
      </NuxtLink>
      <span class="environment">本地工作台</span>
    </header>
    <main class="app-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { Clapperboard } from "lucide-vue-next";
</script>
