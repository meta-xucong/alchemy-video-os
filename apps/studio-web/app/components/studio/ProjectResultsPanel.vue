<template>
  <section class="project-results-panel" aria-labelledby="project-results-title">
    <div class="project-results-heading">
      <div>
        <p class="eyebrow">项目成果</p>
        <h2 id="project-results-title">成片版本</h2>
        <p class="section-copy">{{ demoMode ? "演示结果仅用于检查制作流程，不会替代正式成片。" : "完成的成片会一直保留在这个项目里。" }}</p>
      </div>
      <span class="quiet-tag">{{ items.length ? `${items.length} 个版本` : "等待成片" }}</span>
    </div>

    <div class="project-result-player" :class="{ loading: previewLoading, empty: !selectedItem }" aria-live="polite">
      <p v-if="previewLoading" class="project-result-placeholder">正在载入这版成片...</p>
      <video
        v-else-if="previewUrl"
        :key="selectedAssetId"
        :src="previewUrl"
        controls
        playsinline
        preload="metadata"
        :aria-label="`${selectedItem?.label ?? '当前'}预览`"
      />
      <p v-else-if="selectedItem" class="project-result-placeholder">点击播放后会在这里预览，不会自动播放。</p>
      <p v-else class="project-result-placeholder">从下方选择一个版本后，在这里播放。</p>
    </div>

    <div v-if="selectedItem" class="project-result-player-actions">
      <button class="icon-button" type="button" title="下载成片" aria-label="下载成片" :disabled="previewLoading" @click="emit('download', selectedItem.assetId)">
        <Download :size="17" />
      </button>
    </div>

    <p v-if="previewError" class="field-error" role="alert">{{ previewError }}</p>

    <div v-if="items.length" class="project-result-list" aria-label="项目成片版本">
      <button
        v-for="item in items"
        :key="item.assetId"
        class="project-result-item"
        :class="{ selected: item.assetId === selectedAssetId }"
        type="button"
        :aria-pressed="item.assetId === selectedAssetId"
        :aria-label="`查看${item.label}`"
        @click="emit('select', item.assetId)"
      >
        <span class="project-result-icon" aria-hidden="true"><Film :size="17" /></span>
        <span class="project-result-copy">
          <strong>{{ item.label }}</strong>
          <small>{{ item.createdLabel }} · {{ item.sizeLabel }}</small>
          <small v-if="item.qcSummary">{{ item.qcSummary }}</small>
        </span>
        <span class="project-result-action">
          <Play :size="14" aria-hidden="true" />
          <span>{{ item.assetId === selectedAssetId ? "正在查看" : "查看成片" }}</span>
        </span>
      </button>
    </div>
    <p v-else class="project-results-empty">完成生成后，成片会在这里按版本保存，方便随时查看。</p>
  </section>
</template>

<script setup lang="ts">
import { Download, Film, Play } from "lucide-vue-next";

export type ProjectResultItem = {
  assetId: string;
  label: string;
  createdLabel: string;
  sizeLabel: string;
  qcSummary?: string;
};

const props = defineProps<{
  items: ProjectResultItem[];
  selectedAssetId: string;
  previewUrl: string;
  previewLoading: boolean;
  previewError: string;
  demoMode: boolean;
}>();

const emit = defineEmits<{ select: [assetId: string]; download: [assetId: string] }>();
const selectedItem = computed(() => props.items.find((item) => item.assetId === props.selectedAssetId));
</script>
