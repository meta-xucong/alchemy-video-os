<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink class="brand" to="/">
        <Clapperboard :size="20" :stroke-width="1.8" />
        <span>AI Enterprise Content Platform</span>
      </NuxtLink>
      <span class="environment">Local MVP</span>
    </header>
    <main class="app-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { Clapperboard } from "lucide-vue-next";
</script>
