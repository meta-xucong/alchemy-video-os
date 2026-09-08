<template>
  <section class="creation-section story-planning-panel" aria-labelledby="story-planning-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">第一步</p>
        <h2 id="story-planning-title">告诉 AI 你想生成什么</h2>
      </div>
      <span class="quiet-tag">一键创作</span>
    </div>

    <label for="story-source">把想法、故事或小说情节写在这里</label>
    <textarea
      id="story-source"
      :value="sourceText"
      rows="9"
      maxlength="50000"
      placeholder="例如：一段都市情感小说情节、一个产品宣传想法，或一句想拍的视频描述。你只需要写人能看懂的内容，AI 会在后台处理后续步骤。"
      :disabled="busy"
      @input="emit('update:source-text', ($event.target as HTMLTextAreaElement).value)"
    />
    <p class="character-count">{{ sourceText.length.toLocaleString("zh-CN") }} / 50,000</p>
    <p class="field-hint">上传多张参考图时，也可以直接写明“第一张是场景，第二张是人物”，AI 会优先按你的说明理解。</p>

    <section class="story-settings" aria-labelledby="story-settings-title">
      <p id="story-settings-title" class="story-settings-title">成片设置</p>
      <div class="story-planning-fields">
        <label class="story-duration-field" for="story-duration">
          <span>希望成片大约多长</span>
          <span class="duration-input">
            <input id="story-duration" type="number" min="15" max="600" step="1" :value="targetDurationSeconds" :disabled="busy" @input="updateDuration" />
            <span>秒</span>
          </span>
          <small>短想法可以填 15-30 秒，较长故事可以填 60 秒以上；AI 会自动安排内容。</small>
        </label>

        <fieldset class="story-quality-field" :disabled="busy">
          <legend>成片清晰度</legend>
          <div class="quality-options">
            <label class="quality-choice" :class="{ selected: targetResolution === '480p' }">
              <input id="story-resolution-480p" type="radio" name="story-resolution" value="480p" :checked="targetResolution === '480p'" @change="emit('update:target-resolution', '480p')" />
              <span>
                <strong>标准清晰</strong>
                <small>480p</small>
              </span>
            </label>
            <label class="quality-choice" :class="{ selected: targetResolution === '720p' }">
              <input id="story-resolution-720p" type="radio" name="story-resolution" value="720p" :checked="targetResolution === '720p'" @change="emit('update:target-resolution', '720p')" />
              <span>
                <strong>高清</strong>
                <small>720p，推荐</small>
              </span>
            </label>
          </div>
        </fieldset>

        <label class="story-style-field" for="story-style">
          <span>想要的感觉（可选）</span>
          <input id="story-style" :value="stylePreferences" maxlength="1000" placeholder="例如：温暖、克制、真实纪录感、商业广告感" :disabled="busy" @input="emit('update:style-preferences', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>

      <div class="segment-estimate" aria-live="polite">
        <div class="segment-estimate-heading">
          <div>
            <p class="segment-estimate-title">预计生成 {{ estimatedSegments.length }} 段视频</p>
            <p class="segment-estimate-note">以实际生成为准</p>
          </div>
          <span
            class="segment-estimate-help"
            tabindex="0"
            role="img"
            aria-label="查看预计段数说明"
            :title="segmentEstimateExplanation"
            :data-tooltip="segmentEstimateExplanation"
          >?</span>
        </div>
        <ol v-if="estimatedSegments.length <= 12" class="segment-estimate-list" aria-label="预计生成片段">
          <li v-for="segment in estimatedSegments" :key="segment.sequence">
            <span>第 {{ segment.sequence }} 段</span>
            <strong>约 {{ segment.durationSeconds }} 秒</strong>
          </li>
        </ol>
        <p v-else class="segment-estimate-compact">
          第 1-{{ estimatedSegments.length }} 段：每段约 {{ compactSegmentDurationLabel }}。
        </p>
      </div>
    </section>

    <p class="next-step-hint">参考图和项目资料会在下面各自管理；点击生成后，AI 会在后台完成所有准备和制作。</p>

    <p v-if="message" class="planning-message" aria-live="polite">{{ message }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
const props = defineProps<{
  sourceText: string;
  targetDurationSeconds: number;
  targetResolution: "480p" | "720p";
  stylePreferences: string;
  busy: boolean;
  message: string;
  error: string;
}>();

const emit = defineEmits<{
  "update:source-text": [value: string];
  "update:target-duration": [value: number];
  "update:target-resolution": [value: "480p" | "720p"];
  "update:style-preferences": [value: string];
}>();

type EstimatedGenerationSegment = {
  sequence: number;
  durationSeconds: number;
};

const estimatedSegments = computed<EstimatedGenerationSegment[]>(() => estimateGenerationSegments(props.targetDurationSeconds));
const estimatedTotalDurationSeconds = computed(() =>
  estimatedSegments.value.reduce((total, segment) => total + segment.durationSeconds, 0),
);
const segmentEstimateExplanation = computed(() =>
  `叙事点只是关键剧情内容，不会截断故事；15 秒以内会在一个视频中按时间轴完成多次动作，超过单段上限才会连续制作多个片段，最后合成为约 ${estimatedTotalDurationSeconds.value} 秒完整成片。这里显示的是按总时长计算的预估；正式生成时，后台还会结合内容、段落和口播容量重新规划，最终段数与每段时长可能不同，请以实际生成结果为准。`,
);
const compactSegmentDurationLabel = computed(() => {
  const durations = new Set(estimatedSegments.value.map((segment) => segment.durationSeconds));
  if (durations.size === 1) return `${estimatedSegments.value[0]?.durationSeconds ?? 0} 秒`;
  const sorted = [...durations].sort((left, right) => left - right);
  return `${sorted[0]}-${sorted.at(-1)} 秒`;
});

function estimateGenerationSegments(durationSeconds: number): EstimatedGenerationSegment[] {
  const safeDurationSeconds = Number.isInteger(durationSeconds) ? Math.min(600, Math.max(15, durationSeconds)) : 30;
  const segmentCount = safeDurationSeconds <= 15 ? 1 : Math.min(60, Math.max(1, Math.ceil(safeDurationSeconds / 15)));
  const baseDurationSeconds = Math.floor(safeDurationSeconds / segmentCount);
  const remainder = safeDurationSeconds % segmentCount;
  return Array.from({ length: segmentCount }, (_, index) => ({
    sequence: index + 1,
    durationSeconds: baseDurationSeconds + (index < remainder ? 1 : 0),
  }));
}

function updateDuration(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isInteger(value)) emit("update:target-duration", Math.min(600, Math.max(15, value)));
}
</script>
