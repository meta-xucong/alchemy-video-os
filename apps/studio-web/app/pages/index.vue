<template>
  <main class="route-handoff" aria-live="polite">
    <p>正在打开项目列表...</p>
  </main>
</template>

<script setup lang="ts">
onMounted(() => void navigateTo("/projects", { replace: true }));
</script>
