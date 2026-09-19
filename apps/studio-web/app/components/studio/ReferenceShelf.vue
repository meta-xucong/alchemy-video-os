<template>
  <section class="creation-section reference-shelf" aria-labelledby="reference-shelf-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">第二步</p>
        <h2 id="reference-shelf-title">添加参考图</h2>
      </div>
      <span class="quiet-tag">参考图可选</span>
    </div>

    <p class="section-copy">可选择 1 至 7 张，系统会看图识别人物、场景和风格。你也可以在想法里说明每张图的用途，文字说明优先。</p>
    <label class="file-input" for="reference-file">
      <ImagePlus :size="17" />
      <span>{{ files.length ? `已选 ${files.length} 张图片` : "选择图片" }}</span>
    </label>
    <input :key="inputVersion" id="reference-file" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple @change="onFileChange" />
    <button class="secondary-button full-width" type="button" :disabled="busy || !files.length" @click="emit('upload')">
      <Upload :size="16" />
      <span>{{ busy ? "正在添加" : files.length > 1 ? `添加 ${files.length} 张参考图` : "添加参考图" }}</span>
    </button>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>

    <div v-if="assets.length" class="reference-list" aria-label="可选参考图">
      <div v-for="asset in assets" :key="asset.id" class="reference-option">
        <label>
          <input type="checkbox" :checked="selectedIds.includes(asset.id)" :disabled="busy" @change="toggleReference(asset.id, ($event.target as HTMLInputElement).checked)" />
          <span>
            {{ assetName(asset) }}
            <small v-if="selectedIds.includes(asset.id)" class="reference-order">已选第 {{ selectedIds.indexOf(asset.id) + 1 }} 张 · 将按描述匹配职责</small>
          </span>
        </label>
        <div class="reference-option-actions">
          <button class="icon-button" type="button" title="预览图片" :aria-label="`预览图片：${assetName(asset)}`" :disabled="busy" @click.prevent="emit('preview', asset.id)">
            <Eye :size="16" />
          </button>
          <button class="icon-button danger" type="button" title="删除这张图片" :aria-label="`删除图片：${assetName(asset)}`" :disabled="busy" @click.prevent="emit('remove', asset.id)">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
    <p v-if="selectedIds.length" class="selection-copy">本次会使用 {{ selectedIds.length }} 张参考图。</p>
    <p v-if="selectedIds.length" class="selection-copy">描述中明确写出的图片职责会优先使用；未说明的图片会先做内容识别，识别完成后再继续制作。</p>
    <p v-else class="empty-copy">尚未选择用于本次视频的参考图；也可以直接生成文字创作。</p>
  </section>
</template>

<script setup lang="ts">
import { Eye, ImagePlus, Trash2, Upload } from "lucide-vue-next";

import type { Asset } from "../../composables/useControlApi";

const props = defineProps<{
  assets: Asset[];
  selectedIds: string[];
  files: File[];
  inputVersion: number;
  busy: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "update:files": [files: File[]];
  "update:selected-ids": [ids: string[]];
  upload: [];
  preview: [assetId: string];
  remove: [assetId: string];
  "selection-limit": [limit: number];
}>();

const assetName = (asset: Asset) => String(asset.metadata.filename ?? "参考图片");

function onFileChange(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files ?? []);
  emit("update:files", files);
}

function toggleReference(assetId: string, checked: boolean) {
  const next = checked ? [...props.selectedIds, assetId] : props.selectedIds.filter((id) => id !== assetId);
  const limit = 7;
  if (next.length > limit) {
    emit("selection-limit", limit);
    return;
  }
  emit("update:selected-ids", next);
}
</script>
