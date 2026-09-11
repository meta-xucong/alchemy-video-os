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
    <button
      v-if="canRetryComposition"
      class="secondary-button"
      type="button"
      :disabled="busy"
      @click="emit('retry-composition')"
    >{{ busy ? "正在重新合成" : "重新合成成片" }}</button>

    <details v-if="progress.segments.length" class="production-segment-details">
      <summary>查看制作细节（{{ progress.segments.length }}）</summary>
      <ol class="production-segment-list" aria-label="制作细节">
        <li v-for="segment in progress.segments" :key="segment.id" :class="segment.status.toLowerCase()">
          <span class="production-segment-number">{{ segment.sequence }}</span>
          <div class="production-segment-copy">
            <strong>{{ segment.title }}</strong>
            <p class="production-segment-reason">{{ segmentSummary(segment) }}</p>
          </div>
          <span class="production-segment-status">{{ segmentLabel(segment.status) }}</span>
          <div v-if="segment.status === 'FAILED' && segment.retryable" class="production-segment-actions">
            <button
              class="text-button"
              type="button"
              :disabled="busy"
              @click="emit('retry', segment.sequence)"
            >{{ busy ? "正在重新制作" : "重新制作这一段" }}</button>
          </div>
        </li>
      </ol>
    </details>
  </section>
</template>

<script setup lang="ts">
import type { ProductionRunProgress, ProductionSegment } from "../../composables/useControlApi";

const props = defineProps<{ progress?: ProductionRunProgress; busy?: boolean }>();
const emit = defineEmits<{ retry: [sequence: number]; 'retry-composition': [] }>();

const completedCount = computed(() => props.progress?.segments.filter((segment) => segment.status === "ACCEPTED").length ?? 0);
const totalSegments = computed(() => props.progress?.production_run.total_segment_count ?? props.progress?.production_run.total_shot_count ?? props.progress?.segments.length ?? 0);
const canRetryComposition = computed(() => Boolean(
  props.progress?.production_run.status === "FAILED"
  && totalSegments.value > 0
  && completedCount.value === totalSegments.value,
));
const progressSummary = computed(() => {
  const run = props.progress?.production_run;
  if (!run) return "";
  if (run.status === "SUCCEEDED") return "完整成片已经整理好，右侧可以直接查看。";
  if (run.status === "FAILED" || run.status === "BLOCKED") {
    const blockedSegment = props.progress?.segments.find((segment) => segment.status === "FAILED" || segment.status === "WAITING");
    if (run.status === "FAILED" && completedCount.value === totalSegments.value && totalSegments.value > 0) {
      return "所有片段已完成，但成片整理未完成，可以直接重新合成。";
    }
    return blockedSegment?.safe_summary ?? "这次没有完整完成，可以查看制作细节并按提示处理。";
  }
  const continuity = run.continuity_status === "AUTO_REPAIRING"
    ? "正在自动优化片段衔接。"
    : run.continuity_status === "CHECKING"
      ? "正在检查片段衔接。"
      : run.continuity_status === "NEEDS_ATTENTION"
        ? "有一处衔接需要留意，系统已使用安全转场。"
        : "";
  return `AI 正在后台制作完整视频，预计成片约 ${run.total_duration_seconds} 秒。${continuity}`;
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
  return segment.safe_summary || (segment.status === "FAILED"
    ? (segment.retryable ? "这一段需要处理，稍后可以重试。" : "这一段未完成，请调整故事后重新规划。")
    : "制作状态正在更新。");
}
</script>
