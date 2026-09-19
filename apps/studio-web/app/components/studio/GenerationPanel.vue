<template>
  <section class="creation-section generation-panel" aria-labelledby="generation-panel-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">第三步</p>
        <h2 id="generation-panel-title">一键生成并查看成片</h2>
      </div>
      <span class="generation-status" :class="progress.tone">{{ progress.statusLabel }}</span>
    </div>

    <ol class="creation-progress" aria-label="创作进度">
      <li v-for="(stage, index) in progress.stages" :key="stage.id" :class="stage.state">
        <span class="creation-progress-marker" aria-hidden="true">{{ index + 1 }}</span>
        <span>{{ stage.label }}</span>
      </li>
    </ol>

    <p class="generation-message" aria-live="polite">{{ progress.message }}</p>
    <p v-if="feedback" class="generation-feedback" :class="feedback.tone" role="status" aria-live="polite">
      {{ feedback.message }}
    </p>
    <p class="generation-autopilot-copy">生成时会自动完成理解、准备、制作和成片整理。</p>
    <p v-if="demoMode" class="generation-demo-note">当前为本地演示运行，测试片段只用于检查流程，不代表正式成片。</p>
    <div class="generation-actions">
      <button class="command-button" type="button" :disabled="busy || !canStart" @click="emit('generate')">
        <Clapperboard :size="17" />
        <span>{{ busy ? "AI 正在准备本次创作" : createsNewVersion ? "调整后生成新版本" : "开始生成视频" }}</span>
      </button>
      <button v-if="canRetry" class="secondary-button" type="button" :disabled="busy" @click="emit('retry')">
        <RotateCcw :size="16" />
        <span>重试生成</span>
      </button>
      <button v-if="hasResult" class="secondary-button" type="button" :disabled="busy" @click="emit('preview')">
        <Play :size="16" />
        <span>预览视频</span>
      </button>
    </div>
    <p v-if="canRetry" class="retry-hint">本次创作未完成，可重试。</p>
    <p v-if="hasResult" class="retry-hint">调整后生成新版本，不会覆盖当前结果。</p>
  </section>
</template>

<script setup lang="ts">
import { Clapperboard, Play, RotateCcw } from "lucide-vue-next";

import type { CreationProgress } from "../../composables/useCreationProgress";

export type GenerationFeedback = {
  tone: "active" | "success" | "error";
  message: string;
};

const props = defineProps<{
  progress: CreationProgress;
  feedback?: GenerationFeedback;
  busy: boolean;
  canStart: boolean;
  canRetry: boolean;
  createsNewVersion: boolean;
  hasResult: boolean;
  demoMode: boolean;
}>();

const emit = defineEmits<{ generate: []; retry: []; preview: [] }>();
</script>
