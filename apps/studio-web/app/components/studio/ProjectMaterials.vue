<template>
  <section class="project-materials surface-panel" aria-labelledby="project-materials-title">
    <div class="project-materials-heading">
      <div>
        <p class="eyebrow">项目资料</p>
        <h2 id="project-materials-title">添加本次创作的资料</h2>
      </div>
      <span class="panel-count">{{ items.length }}</span>
    </div>

    <div class="project-materials-upload">
      <label class="secondary-button material-file-button">
        <span>添加资料</span>
        <input :key="inputVersion" class="visually-hidden" type="file" :accept="accept" :disabled="busy" @change="onFileChange" />
      </label>
      <span v-if="file" class="material-file-name">{{ file.name }}</span>
      <button v-if="file" class="command-button" type="button" :disabled="busy" @click="$emit('upload')">{{ busy ? "正在添加" : "开始整理" }}</button>
    </div>

    <p v-if="error" class="workspace-alert" role="alert">{{ error }}</p>

    <ul v-if="items.length" class="material-list">
      <li v-for="item in items" :key="item.sourceAssetId" class="material-item" :class="{ 'is-not-adopted': !item.adopted }">
        <div class="material-item-main">
          <strong>{{ item.filename }}</strong>
          <span class="material-state" :class="materialStateClass(item)">{{ statusLabel(item) }}</span>
          <p v-if="item.warningCount" class="muted-copy">整理完成，包含 {{ item.warningCount }} 条提示</p>
          <p v-if="item.understanding?.fact_count" class="muted-copy">已读取 {{ item.understanding.fact_count }} 条项目要点</p>
          <p v-if="item.understanding?.has_confirmation" class="material-attention">有内容需要补充确认，未确认的结论不会用于本次创作</p>
          <p v-if="item.understanding?.has_visual_gaps" class="muted-copy">部分图表内容还不能自动读取</p>
          <p v-if="!item.adopted" class="muted-copy">本次不会采用这份资料</p>
        </div>
        <div class="material-actions">
          <button v-if="item.understanding?.knowledge_revision_id && item.understanding.status === 'READY'" class="secondary-button" type="button" :disabled="busy" @click="toggleDetails(item)">{{ expandedId === item.sourceAssetId ? "收起要点" : "查看要点" }}</button>
          <button v-if="item.understanding" class="secondary-button" type="button" :disabled="busy" @click="$emit('toggle-adoption', item.sourceAssetId)">{{ item.adopted ? "本次不采用" : "本次采用" }}</button>
          <button v-if="item.understanding?.status === 'FAILED' && item.understandingRetryable" class="secondary-button" type="button" :disabled="busy" @click="retryKnowledge(item)">重新理解</button>
          <button v-if="item.retryable" class="secondary-button" type="button" :disabled="busy" @click="$emit('retry', item.conversionId)">重新整理</button>
          <button class="icon-button danger" type="button" title="删除这份资料" :aria-label="`删除资料：${item.filename}`" :disabled="busy" @click="$emit('remove', item.sourceAssetId)">
            <Trash2 :size="16" />
          </button>
        </div>
        <div v-if="expandedId === item.sourceAssetId" class="material-details" aria-live="polite">
          <p v-if="item.detailLoading" class="muted-copy">正在读取项目要点...</p>
          <p v-else-if="!item.knowledgeDetail" class="muted-copy">项目要点暂时无法读取，请稍后重试。</p>
          <template v-else>
            <p class="material-details-lead">这份资料会帮助 AI 保持以下内容一致</p>
            <ul v-if="item.knowledgeDetail.facts.length" class="material-fact-list">
              <li v-for="fact in item.knowledgeDetail.facts" :key="fact.id">
                <span>{{ categoryLabel(fact.category) }}：{{ fact.statement }}</span>
                <small>来自：{{ fact.source.locator }}</small>
              </li>
            </ul>
            <p v-else class="muted-copy">暂时没有可直接采用的项目要点。</p>
            <p v-if="item.understanding?.has_confirmation" class="material-attention">有内容需要补充确认；未确认前，该结论不会进入视频脚本。</p>
            <p v-if="item.understanding?.has_visual_gaps" class="muted-copy">无法自动读取的图表，请上传对应图片或在主输入框补充关键信息。</p>
          </template>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { Trash2 } from "lucide-vue-next";
import type { DocumentKnowledgeDetail, DocumentUnderstandingSummary } from "../../composables/useControlApi";

export type ProjectMaterialItem = {
  conversionId: string;
  sourceAssetId: string;
  filename: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  retryable: boolean;
  markdownAssetId: string | null;
  warningCount: number;
  understanding?: DocumentUnderstandingSummary;
  understandingRetryable: boolean;
  adopted: boolean;
  knowledgeDetail?: DocumentKnowledgeDetail;
  detailLoading: boolean;
};

const emit = defineEmits<{
  "update:file": [file: File | undefined];
  upload: [];
  retry: [conversionId: string];
  "retry-knowledge": [knowledgeRevisionId: string];
  "toggle-adoption": [sourceAssetId: string];
  details: [knowledgeRevisionId: string];
  remove: [assetId: string];
}>();

defineProps<{
  items: ProjectMaterialItem[];
  file?: File;
  inputVersion: number;
  busy: boolean;
  error: string;
}>();

const expandedId = ref("");

const accept = ".pdf,.docx,.pptx,.xlsx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/markdown,text/plain";

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  emit("update:file", file);
}

function statusLabel(item: ProjectMaterialItem) {
  if (item.status === "FAILED" || item.understanding?.status === "FAILED") return "这份资料暂时无法使用";
  if (item.status !== "SUCCEEDED") return "正在整理";
  if (item.understanding?.status !== "READY") return "正在理解项目内容";
  if (item.understanding.analysis_quality === "PARTIAL" || item.understanding.has_visual_gaps) return "已准备好，部分图表需要补充";
  return "已准备好用于这次创作";
}

function materialStateClass(item: ProjectMaterialItem) {
  const label = statusLabel(item);
  if (label === "这份资料暂时无法使用") return "failed";
  if (label === "已准备好用于这次创作" || label === "已准备好，部分图表需要补充") return "succeeded";
  return "pending";
}

function toggleDetails(item: ProjectMaterialItem) {
  if (!item.understanding?.knowledge_revision_id) return;
  if (expandedId.value === item.sourceAssetId) {
    expandedId.value = "";
    return;
  }
  expandedId.value = item.sourceAssetId;
  emit("details", item.understanding.knowledge_revision_id);
}

function retryKnowledge(item: ProjectMaterialItem) {
  const knowledgeRevisionId = item.understanding?.knowledge_revision_id;
  if (knowledgeRevisionId) emit("retry-knowledge", knowledgeRevisionId);
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    BRAND: "项目定位",
    PRODUCT: "产品",
    LOCATION: "场景",
    AUDIENCE: "目标人群",
    SELLING_POINT: "主要卖点",
    AMENITY: "配套",
    STYLE: "品牌风格",
    CTA: "行动提示",
    COMPLIANCE: "合规要求",
    NUMERIC_CLAIM: "数字信息",
    RISK: "注意事项",
  };
  return labels[category] ?? "项目要点";
}
</script>
