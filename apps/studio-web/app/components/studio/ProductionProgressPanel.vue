<template>
  <section v-if="progress" class="production-progress-panel" aria-labelledby="production-progress-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">制作进度</p>
        <h2 id="production-progress-title">{{ statusLabel }}</h2>
      </div>
      <span class="planning-status" :class="statusTone">{{ completedCount }} / {{ totalSegments }} 段</span>
    </div>

    <progress class="production-progress-meter" :value="completedCount" :max="totalSegments">{{ completedCount }} / {{ totalSegments }}</progress>
    <p class="section-copy">{{ progressSummary }}</p>

    <details v-if="progress.segments.length" class="production-segment-details">
      <summary>查看制作细节（{{ progress.segments.length }}）</summary>
      <ol class="production-segment-list" aria-label="制作细节">
        <li v-for="segment in progress.segments" :key="segment.id" :class="segment.status.toLowerCase()">
          <span class="production-segment-number">{{ segment.sequence }}</span>
          <div>
            <strong>{{ segment.title }}</strong>
            <p>{{ segmentSummary(segment) }}</p>
          </div>
          <span class="production-segment-status">{{ segmentLabel(segment.status) }}</span>
          <button
            v-if="segment.status === 'FAILED' && segment.retryable"
            class="text-button"
            type="button"
            :disabled="busy"
            @click="emit('retry', segment.sequence)"
          >{{ busy ? "正在重新制作" : "重新制作这一段" }}</button>
        </li>
      </ol>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { ProductionRunProgress, ProductionSegment } from "../../composables/useControlApi";

const props = defineProps<{ progress?: ProductionRunProgress; busy?: boolean }>();
const emit = defineEmits<{ retry: [sequence: number] }>();

const completedCount = computed(() => props.progress?.segments.filter((segment) => segment.status === "ACCEPTED").length ?? 0);
const totalSegments = computed(() => props.progress?.production_run.total_segment_count ?? props.progress?.production_run.total_shot_count ?? props.progress?.segments.length ?? 0);
const progressSummary = computed(() => {
  const run = props.progress?.production_run;
  if (!run) return "";
  if (run.status === "SUCCEEDED") return "完整成片已经整理好，右侧可以直接查看。";
  if (run.status === "FAILED" || run.status === "BLOCKED") return "这次没有完整完成，可以查看制作细节并按提示处理。";
  return `AI 正在后台制作完整视频，预计成片约 ${run.total_duration_seconds} 秒。`;
});
const statusLabel = computed(() => {
  const status = props.progress?.production_run.status;
  if (status === "SUCCEEDED") return "完整成片已准备好";
  if (status === "REVIEWING" || status === "RENDERING") return "正在整理完整成片";
  if (status === "BLOCKED") return "有一段需要处理";
  if (status === "FAILED") return "这次完整制作未完成";
  return "正在制作视频";
});
const statusTone = computed(() => {
  const status = props.progress?.production_run.status;
  if (status === "SUCCEEDED") return "success";
  if (status === "BLOCKED" || status === "FAILED") return "error";
  return "active";
});

function segmentLabel(status: ProductionSegment["status"]) {
  return {
    PENDING: "等待开始",
    WAITING: "等待上一段确认",
    GENERATING: "正在制作",
    CHECKING: "正在检查画面",
    ACCEPTED: "已完成",
    FAILED: "需要处理",
  }[status];
}

function segmentSummary(segment: ProductionSegment) {
  if (segment.status === "FAILED") return segment.retryable ? "这一段需要处理，稍后可以重试。" : "这一段未完成，请调整故事后重新规划。";
  return segment.safe_summary;
}
</script>
