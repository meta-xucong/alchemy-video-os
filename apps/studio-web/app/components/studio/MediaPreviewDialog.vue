<template>
  <div v-if="open" class="media-dialog-backdrop" role="presentation" @click.self="emit('close')">
    <section class="media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-preview-title">
      <header class="media-dialog-header">
        <h2 id="media-preview-title">{{ title }}</h2>
        <button class="icon-button" type="button" title="关闭预览" aria-label="关闭预览" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>
      <div class="media-dialog-body">
        <img v-if="kind === 'IMAGE'" :src="url" alt="参考图预览" />
        <video v-else :src="url" controls autoplay preload="metadata" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";

defineProps<{ open: boolean; url: string; kind: "IMAGE" | "VIDEO"; title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>
