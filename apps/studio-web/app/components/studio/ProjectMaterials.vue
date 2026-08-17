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
      <li v-for="item in items" :key="item.sourceAssetId" class="material-item">
        <div class="material-item-main">
          <strong>{{ item.filename }}</strong>
          <span class="material-state" :class="item.status.toLowerCase()">{{ statusLabel(item.status) }}</span>
          <p v-if="item.warningCount" class="muted-copy">整理完成，包含 {{ item.warningCount }} 条提示</p>
        </div>
        <div class="material-actions">
          <button v-if="item.markdownAssetId" class="secondary-button" type="button" :disabled="busy" @click="$emit('download', item.markdownAssetId)">查看资料</button>
          <button v-if="item.retryable" class="secondary-button" type="button" :disabled="busy" @click="$emit('retry', item.conversionId)">重新整理</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
export type ProjectMaterialItem = {
  conversionId: string;
  sourceAssetId: string;
  filename: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  retryable: boolean;
  markdownAssetId: string | null;
  warningCount: number;
};

defineProps<{
  items: ProjectMaterialItem[];
  file?: File;
  inputVersion: number;
  busy: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:file": [file: File | undefined];
  upload: [];
  retry: [conversionId: string];
  download: [assetId: string];
}>();

const accept = ".pdf,.docx,.pptx,.xlsx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/markdown,text/plain";

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  emit("update:file", file);
}

function statusLabel(status: ProjectMaterialItem["status"]) {
  if (status === "SUCCEEDED") return "已可用于这次创作";
  if (status === "FAILED") return "这份资料暂时无法整理";
  return "正在整理";
}
</script>
