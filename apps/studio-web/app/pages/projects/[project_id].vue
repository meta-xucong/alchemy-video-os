<template>
  <section class="project-workspace" aria-labelledby="project-workspace-title">
    <header class="project-workspace-header">
      <NuxtLink class="back-link" to="/projects">
        <ArrowLeft :size="16" />
        <span>返回项目列表</span>
      </NuxtLink>

      <div class="project-workspace-title">
        <p class="eyebrow">当前创作</p>
        <h1 id="project-workspace-title">{{ detail?.project.name ?? "正在打开项目" }}</h1>
        <span v-if="detail" class="project-status" :class="detail.project.status.toLowerCase()">{{ projectStatusLabel(detail.project.status) }}</span>
      </div>

      <div class="project-workspace-actions">
        <button class="icon-button" type="button" title="刷新项目" aria-label="刷新项目" :disabled="loading" @click="refreshCurrentProject">
          <RefreshCw :size="17" :class="{ spinning: loading }" />
        </button>
        <button class="icon-button" type="button" title="编辑名称" aria-label="编辑名称" :disabled="!detail || savingName" @click="startEditingName">
          <Pencil :size="17" />
        </button>
      </div>
    </header>

    <p v-if="projectError || creationError || productionError" class="workspace-alert" role="alert">{{ productionError || creationError || projectError }}</p>

    <form v-if="editingName" class="project-rename-form surface-panel" @submit.prevent="saveProjectName">
      <label for="project-rename">项目名称</label>
      <div class="project-create-actions">
        <input id="project-rename" v-model="nameDraft" maxlength="255" :disabled="savingName" />
        <button class="command-button" type="submit" :disabled="savingName || !nameDraft.trim()">
          <span>{{ savingName ? "正在保存" : "保存名称" }}</span>
        </button>
        <button class="text-button" type="button" :disabled="savingName" @click="cancelEditingName">取消</button>
      </div>
    </form>

    <section v-if="loading" class="project-home-loading surface-panel" aria-live="polite">正在读取项目...</section>

    <template v-else-if="detail">
      <div class="project-studio-layout">
        <div class="creation-layout">
          <StoryPlanningPanel
            :source-text="planningDraft.sourceText"
            :target-duration-seconds="planningDraft.targetDurationSeconds"
            :target-resolution="planningDraft.targetResolution"
            :style-preferences="planningDraft.stylePreferences"
            :busy="creationBusy || planningBusy || productionBusy"
            :message="planningMessage"
            :error="planningError"
            @update:source-text="updateStorySourceText"
            @update:target-duration="planningDraft.targetDurationSeconds = $event"
            @update:target-resolution="planningDraft.targetResolution = $event"
            @update:style-preferences="planningDraft.stylePreferences = $event"
          />

          <ReferenceShelf
            :assets="readyReferenceImages"
            :selected-ids="selectedReferenceIds"
            :file="uploadFile"
            :input-version="uploadInputVersion"
            :busy="creationBusy"
            :error="referenceError"
            @update:file="selectReferenceFile"
            @update:selected-ids="updateSelectedReferenceIds"
            @selection-limit="referenceError = '最多选择 7 张参考图。'"
            @upload="uploadReference"
            @preview="previewAsset"
          />

          <ProjectMaterials
            :items="projectMaterials"
            :file="documentFile"
            :input-version="documentInputVersion"
            :busy="documentBusy"
            :error="documentError"
            @update:file="selectDocumentFile"
            @upload="uploadDocument"
            @retry="retryDocument"
            @download="downloadDocument"
          />

          <GenerationPanel
            :progress="creationProgress"
            :feedback="generationFeedback"
            :busy="creationBusy || planningBusy || productionBusy"
            :can-start="canStartGeneration"
            :can-retry="canRetry"
            :creates-new-version="createsNewVersion"
            :has-result="hasProjectResult"
            :demo-mode="isLocalDemoMode"
            @generate="generateVideo"
            @retry="retryGeneration"
            @preview="previewResult"
          />

          <ProductionProgressPanel :progress="currentProductionProgress" :busy="productionBusy" @retry="retryProductionSegment" />
        </div>

        <aside class="project-results-column" aria-label="项目成果">
          <ProjectResultsPanel
            :items="displayedProjectResults"
            :selected-asset-id="selectedResultAssetId"
            :preview-url="resultPreviewUrl"
            :preview-loading="resultPreviewLoading"
            :preview-error="resultPreviewError"
            :demo-mode="isLocalDemoMode"
            @select="selectProjectResult"
            @download="downloadProjectResult"
          />

          <details v-if="projectClipResults.length" class="clip-history surface-panel">
            <summary>查看历史生成片段（{{ projectClipResults.length }}）</summary>
            <ul>
              <li v-for="item in projectClipResults" :key="item.assetId">
                <span>{{ item.label }} · {{ item.createdLabel }}</span>
                <button class="text-button" type="button" @click="previewAsset(item.assetId)">预览片段</button>
              </li>
            </ul>
          </details>
        </aside>
      </div>

      <section class="project-management surface-panel" aria-labelledby="project-management-title">
        <div>
          <p class="eyebrow">项目管理</p>
          <h2 id="project-management-title">整理这个项目</h2>
        </div>
        <div class="project-management-actions">
          <button class="secondary-button" type="button" :disabled="savingStatus || creationBusy" @click="toggleArchive">
            <Archive :size="16" />
            <span>{{ detail.project.status === "ARCHIVED" ? "恢复项目" : "归档项目" }}</span>
          </button>
          <div class="blocked-delete" aria-describedby="delete-capability-note">
            <button class="secondary-button" type="button" disabled aria-disabled="true">
              <Trash2 :size="16" />
              <span>删除项目</span>
            </button>
            <p id="delete-capability-note">删除功能等待服务端开放</p>
          </div>
        </div>
      </section>
    </template>

    <MediaPreviewDialog :open="Boolean(previewUrl)" :url="previewUrl" :kind="previewKind" :title="previewTitle" @close="releasePreview" />
  </section>
</template>

<script setup lang="ts">
import { Archive, ArrowLeft, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";

import GenerationPanel, { type GenerationFeedback } from "../../components/studio/GenerationPanel.vue";
import MediaPreviewDialog from "../../components/studio/MediaPreviewDialog.vue";
import ProjectMaterials, { type ProjectMaterialItem } from "../../components/studio/ProjectMaterials.vue";
import ProjectResultsPanel, { type ProjectResultItem } from "../../components/studio/ProjectResultsPanel.vue";
import ProductionProgressPanel from "../../components/studio/ProductionProgressPanel.vue";
import ReferenceShelf from "../../components/studio/ReferenceShelf.vue";
import StoryPlanningPanel from "../../components/studio/StoryPlanningPanel.vue";
import { productionProgressFor } from "../../composables/useCreationProgress";
import type { Asset, CreativeBriefRevision, DocumentConversion, ProductionRun, ProductionRunProgress, Shot, StoryboardRevision, TaskRun, VideoVersion } from "../../composables/useControlApi";

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const {
  project,
  updateProject,
  retryTaskRun,
  createUploadRequest,
  confirmAssetUpload,
  assetDownloadUrl,
  documents,
  createDocumentConversion,
  retryDocumentConversion,
  createCreativeBriefRevision,
  requestCreativePlan,
  storyboardRevisions,
  approveStoryboardRevision,
  createProductionRun,
  productionRuns,
  videoVersions,
  retryProductionSegment: retryProductionSegmentCommand,
} = useControlApi();
const {
  detail,
  selectedProjectId,
  loading,
  projectError,
  loadProject,
  replaceProjectDetail,
  clearForNavigation,
  selectedReferenceIds,
  uploadFile,
  previewAssetId,
  previewUrl,
  releasePreview,
} = useProjectSession();

const editingName = ref(false);
const nameDraft = ref("");
const savingName = ref(false);
const savingStatus = ref(false);
const creationBusy = ref(false);
const creationError = ref("");
const referenceError = ref("");
const documentFile = ref<File>();
const documentBusy = ref(false);
const documentError = ref("");
const documentInputVersion = ref(0);
const documentConversions = ref<DocumentConversion[]>([]);
const planningBusy = ref(false);
const planningError = ref("");
const planningMessage = ref("");
const productionBusy = ref(false);
const productionError = ref("");
const planningDraft = reactive({
  sourceText: "",
  targetDurationSeconds: 60,
  targetResolution: "720p" as "480p" | "720p",
  stylePreferences: "",
  sourceAssetIds: [] as string[],
});
const productionProgress = ref<ProductionRunProgress[]>([]);
const projectVideoVersions = ref<VideoVersion[]>([]);
const lastSubmittedTaskRunId = ref("");
const uploadInputVersion = ref(0);
const previewKind = ref<"IMAGE" | "VIDEO">("VIDEO");
const previewTitle = ref("预览视频");
const selectedResultAssetId = ref("");
const resultPreviewUrl = ref("");
const resultPreviewLoading = ref(false);
const resultPreviewError = ref("");
let hydratedProjectId = "";
let resultPreviewRequest = 0;
let projectRefreshInFlight: Promise<void> | undefined;

const projectId = computed(() => typeof route.params.project_id === "string" ? route.params.project_id : "");
const workspaceId = computed(() => detail.value?.project.workspace_id);
const isLocalDemoMode = computed(() => runtimeConfig.public.localDemoMode === true);
const commandKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const documentMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
]);
const documentMimeByExtension: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
};

const orderedCreations = computed(() => [...(detail.value?.shots ?? [])]
  .filter((item) => item.status !== "ARCHIVED")
  .sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
const currentCreation = computed<Shot | undefined>(() => orderedCreations.value[0]);
const readyReferenceImages = computed(() => (detail.value?.assets ?? []).filter((asset) => asset.kind === "IMAGE" && asset.origin === "USER_UPLOAD" && asset.status === "READY" && supportedImageTypes.has(asset.mime_type ?? "")));
const readyPlanningDocumentIds = computed(() => (detail.value?.assets ?? [])
  .filter((asset) => asset.status === "READY" && asset.origin === "USER_UPLOAD" && asset.kind === "DOCUMENT")
  .slice(0, 20)
  .map((asset) => asset.id));
const projectMaterials = computed<ProjectMaterialItem[]>(() => {
  const latestBySource = new Map<string, DocumentConversion>();
  for (const conversion of [...documentConversions.value].sort((left, right) => right.updated_at.localeCompare(left.updated_at))) {
    if (!latestBySource.has(conversion.source_asset_id)) latestBySource.set(conversion.source_asset_id, conversion);
  }
  return (detail.value?.assets ?? [])
    .filter((asset) => asset.kind === "DOCUMENT" && asset.origin === "USER_UPLOAD" && asset.status === "READY")
    .map((asset) => {
      const conversion = latestBySource.get(asset.id);
      if (!conversion) return undefined;
      return {
        conversionId: conversion.id,
        sourceAssetId: asset.id,
        filename: typeof asset.metadata.filename === "string" ? asset.metadata.filename : "项目资料",
        status: conversion.status === "CREATED" ? "QUEUED" : conversion.status,
        retryable: conversion.retryable,
        markdownAssetId: conversion.markdown_asset_id,
        warningCount: conversion.warnings.length,
      };
    })
    .filter((item): item is ProjectMaterialItem => Boolean(item));
});
const latestTask = computed<TaskRun | undefined>(() => {
  const shotId = currentCreation.value?.id;
  if (!shotId) return undefined;
  return detail.value?.task_runs
    .filter((item) => item.shot_id === shotId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
});
const currentPlanningBrief = computed<CreativeBriefRevision | undefined>(() => [...(detail.value?.creative_brief_revisions ?? [])]
  .sort((left, right) => right.revision - left.revision || right.updated_at.localeCompare(left.updated_at))[0]);
const currentStoryboard = computed<StoryboardRevision | undefined>(() => [...(detail.value?.storyboard_revisions ?? [])]
  .sort((left, right) => right.revision - left.revision || right.updated_at.localeCompare(left.updated_at))[0]);
const currentProductionRun = computed<ProductionRun | undefined>(() => {
  const storyboardId = currentStoryboard.value?.id;
  if (!storyboardId) return undefined;
  return [...(detail.value?.production_runs ?? [])]
    .filter((item) => item.storyboard_revision_id === storyboardId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
});
const currentProductionProgress = computed<ProductionRunProgress | undefined>(() => {
  const productionRunId = currentProductionRun.value?.id;
  const progress = [...productionProgress.value].sort((left, right) => right.production_run.created_at.localeCompare(left.production_run.created_at));
  return progress.find((item) => item.production_run.id === productionRunId) ?? progress[0];
});
const finalVideoResults = computed<ProjectResultItem[]>(() => [...projectVideoVersions.value]
  .filter((version) => version.status === "SUCCEEDED")
  .sort((left, right) => right.created_at.localeCompare(left.created_at))
  .map((version, index) => ({
    assetId: version.asset_id,
    label: `完整成片 ${String(index + 1).padStart(2, "0")}`,
    createdLabel: formatResultTime(version.created_at),
    sizeLabel: formatVideoDuration(version.duration_ms),
    qcSummary: version.qc_report.safe_summary,
  })));
const projectClipResults = computed<ProjectResultItem[]>(() => {
  const current = detail.value;
  if (!current) return [];
  const assetsById = new Map(current.assets.map((asset) => [asset.id, asset]));
  const seenAssetIds = new Set<string>();
  const resultPairs = current.task_runs
    .filter((task) => task.status === "SUCCEEDED" && Boolean(task.result_asset_id))
    .map((task) => ({ task, asset: assetsById.get(task.result_asset_id ?? "") }))
    .filter((pair): pair is { task: TaskRun; asset: Asset } => Boolean(
      pair.asset
      && pair.asset.project_id === current.project.id
      && pair.asset.kind === "VIDEO"
      && pair.asset.origin === "GENERATED"
      && pair.asset.status === "READY",
    ))
    .sort((left, right) => right.task.created_at.localeCompare(left.task.created_at));

  return resultPairs
    .filter(({ asset }) => !seenAssetIds.has(asset.id) && Boolean(seenAssetIds.add(asset.id)))
    .map(({ task, asset }, index) => ({
      assetId: asset.id,
      label: `成片 ${String(index + 1).padStart(2, "0")}`,
      createdLabel: formatResultTime(task.created_at),
      sizeLabel: formatAssetSize(asset.byte_size),
    }));
});
const displayedProjectResults = computed<ProjectResultItem[]>(() => (
  finalVideoResults.value.length
    ? finalVideoResults.value
    : projectClipResults.value.map((item, index) => ({
      ...item,
      label: `历史成片 ${String(index + 1).padStart(2, "0")}`,
      qcSummary: item.qcSummary ?? "来自这个项目此前完成的视频",
    }))
));
const hasProjectResult = computed(() => displayedProjectResults.value.length > 0);
const activeProductionStatuses = new Set<ProductionRun["status"]>(["CONFIRMED", "GENERATING", "REVIEWING", "RENDERING"]);
const newVersionTaskStatuses = new Set<TaskRun["status"]>(["SUCCEEDED", "FAILED"]);
const canStartGeneration = computed(() => Boolean(
  detail.value
  && detail.value.project.status === "ACTIVE"
  && planningDraft.sourceText.trim()
  && planningDraft.targetDurationSeconds >= 15
  && planningDraft.targetDurationSeconds <= 600
  && !creationBusy.value
  && !planningBusy.value
  && !productionBusy.value
  && (!currentProductionRun.value || !activeProductionStatuses.has(currentProductionRun.value.status)),
));
const canRetry = computed(() => latestTask.value?.status === "FAILED");
const createsNewVersion = computed(() => hasProjectResult.value || Boolean(latestTask.value && newVersionTaskStatuses.has(latestTask.value.status)));
const creationProgress = computed(() => productionProgressFor(currentProductionProgress.value, Boolean(planningDraft.sourceText.trim()), creationBusy.value || planningBusy.value || productionBusy.value));
const generationFeedback = computed<GenerationFeedback | undefined>(() => {
  const productionRun = currentProductionProgress.value?.production_run;
  if (productionRun?.status === "SUCCEEDED") {
    return { tone: "success", message: "完整成片已保存到当前项目，可以在右侧查看。" };
  }
  if (productionRun?.status === "FAILED" || productionRun?.status === "BLOCKED") {
    return { tone: "error", message: "本次完整制作没有完成。你可以查看制作细节，或调整描述后生成新版本。" };
  }
  if (productionRun && activeProductionStatuses.has(productionRun.status)) {
    return { tone: "active", message: "AI 已接管后续制作，你可以留在页面，也可以稍后回来查看成片。" };
  }
  const task = latestTask.value;
  if (!task) return undefined;
  if (["FAILED", "ABANDONED"].includes(task.status)) {
    return { tone: "error", message: taskFailureMessage(task) };
  }
  if (task.id !== lastSubmittedTaskRunId.value) return undefined;
  if (["CREATED", "QUEUED", "RUNNING", "PROCESSING", "RETRY_SCHEDULED", "DOWNLOADING", "BILLING_PENDING"].includes(task.status)) {
    return { tone: "active", message: "本次创作已提交，正在更新进度。" };
  }
  if (task.status === "SUCCEEDED") {
    return { tone: "success", message: "本次创作已完成，可以预览当前结果。" };
  }
});

const { stop: stopProjectEvents } = useProjectEvents({
  workspaceId,
  selectedProjectId,
  onCurrentProjectEvent: () => void refreshCurrentProject(),
});

function projectStatusLabel(status: "ACTIVE" | "ARCHIVED") {
  return status === "ARCHIVED" ? "已归档" : "进行中";
}

function formatResultTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚完成";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAssetSize(byteSize: number | null) {
  if (!byteSize || byteSize < 1) return "视频成片";
  if (byteSize < 1024 * 1024) return `${Math.max(1, Math.round(byteSize / 1024))} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVideoDuration(durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function releaseProjectResultPreview() {
  resultPreviewRequest += 1;
  selectedResultAssetId.value = "";
  resultPreviewUrl.value = "";
  resultPreviewLoading.value = false;
  resultPreviewError.value = "";
}

async function selectProjectResult(assetId: string) {
  const result = displayedProjectResults.value.find((item) => item.assetId === assetId);
  const projectIdAtStart = selectedProjectId.value;
  if (!result || !projectIdAtStart) return;

  const request = ++resultPreviewRequest;
  selectedResultAssetId.value = assetId;
  resultPreviewUrl.value = "";
  resultPreviewError.value = "";
  resultPreviewLoading.value = true;
  try {
    const response = await assetDownloadUrl(assetId);
    if (request !== resultPreviewRequest || projectIdAtStart !== selectedProjectId.value) return;
    resultPreviewUrl.value = response.data.download_url;
  } catch (error) {
    if (request !== resultPreviewRequest || projectIdAtStart !== selectedProjectId.value) return;
    resultPreviewError.value = safeErrorMessage(error, "这版成片暂时无法播放，请稍后再试。");
  } finally {
    if (request === resultPreviewRequest && projectIdAtStart === selectedProjectId.value) {
      resultPreviewLoading.value = false;
    }
  }
}

async function downloadProjectResult(assetId: string) {
  const result = displayedProjectResults.value.find((item) => item.assetId === assetId);
  if (!result) return;
  resultPreviewError.value = "";
  try {
    const response = await assetDownloadUrl(assetId);
    const link = document.createElement("a");
    link.href = response.data.download_url;
    link.download = "";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    resultPreviewError.value = safeErrorMessage(error, "这版成片暂时无法下载，请稍后再试。");
  }
}

function syncProjectResultPreview() {
  const hasSelectedResult = selectedResultAssetId.value
    && displayedProjectResults.value.some((item) => item.assetId === selectedResultAssetId.value);
  if (selectedResultAssetId.value && !hasSelectedResult) {
    releaseProjectResultPreview();
  }
}

function taskFailureMessage(task: TaskRun) {
  if (task.error?.code === "PROVIDER_REJECTED") {
    return "本次创作已进入生成阶段，但没有完成。请调整描述后生成新版本，或重试这次创作。";
  }
  if (task.error?.code === "PROVIDER_UNAVAILABLE") {
    return "视频服务暂时不可用。这次创作可以稍后重试。";
  }
  return "本次创作未完成。请调整想法后生成新版本，或重试这次创作。";
}

function safeErrorMessage(error: unknown, fallback: string) {
  const data = typeof error === "object" && error !== null && "data" in error ? (error as { data?: unknown }).data : undefined;
  const apiError = typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
  const code = typeof apiError === "object" && apiError !== null && "code" in apiError ? (apiError as { code?: unknown }).code : undefined;
  const labels: Record<string, string> = {
    IDEMPOTENCY_CONFLICT: "这次操作已经使用了不同内容提交，请刷新后重新操作。",
    WORKSPACE_FORBIDDEN: "当前项目不可访问。",
    NOT_FOUND: "当前项目或其中的内容已不存在。",
    INVALID_REFERENCE: "所选参考图不可用，请重新选择。",
    VALIDATION_FAILED: "输入内容不符合要求，请检查后再试。",
    SHOT_POSITION_CONFLICT: "保存内容时发生冲突，请刷新后重试。",
    TASK_RUN_ACTIVE_CONFLICT: "已有创作正在处理中，请稍后查看结果。",
    TASK_STATE_INVALID: "当前内容还不能开始创作，请刷新后再试。",
    PROVIDER_UNAVAILABLE: "视频服务暂时不可用，请稍后重试。",
    PROVIDER_REJECTED: "本次创作已进入生成阶段，但没有完成。请调整描述后生成新版本。",
    DOCUMENT_UNSUPPORTED: "这份资料暂时无法整理，请确认文件格式后重试。",
    DOCUMENT_CONVERSION_ACTIVE_CONFLICT: "这份资料正在整理，请稍后查看。",
    DOCUMENT_CONVERSION_FAILED: "这份资料暂时无法整理，请稍后重试。",
    DOCUMENT_RUNTIME_UNAVAILABLE: "资料整理服务暂时不可用，请稍后重试。",
    DOCUMENT_OUTPUT_INVALID: "这份资料暂时无法整理，请稍后重试。",
    CREATIVE_PLAN_ACTIVE_CONFLICT: "AI 正在整理这份故事，请稍后查看进度。",
    CREATIVE_PLAN_STATE_INVALID: "当前故事还不能整理，请刷新后再试。",
    PLANNING_FAILED: "AI 暂时无法整理这份故事，请调整描述后重试。",
    STORYBOARD_SPEC_INVALID: "AI 暂时无法拆解这份故事，请调整描述后重新生成。",
    PRODUCTION_RUN_ACTIVE_CONFLICT: "这个项目已有视频正在制作，请稍后查看。",
    PRODUCTION_RUN_STATE_INVALID: "当前内容还不能制作，请调整描述后重试。",
  };
  return typeof code === "string" && labels[code] ? labels[code] : fallback;
}

function uniqueReferenceIds(ids: string[]) {
  return [...new Set(ids)];
}

function eligiblePlanningSourceIds(ids: string[]) {
  const readyIds = new Set([
    ...readyReferenceImages.value.map((asset) => asset.id),
    ...readyPlanningDocumentIds.value,
  ]);
  return uniqueReferenceIds(ids).filter((id) => readyIds.has(id));
}

function syncPlanningReferenceSourceIds(ids: string[]) {
  planningDraft.sourceAssetIds = eligiblePlanningSourceIds([...readyPlanningDocumentIds.value, ...ids]);
}

async function updateSelectedReferenceIds(ids: string[]) {
  const next = uniqueReferenceIds(ids);
  if (selectedReferenceIds.value.length === next.length && selectedReferenceIds.value.every((id, index) => id === next[index])) return;
  selectedReferenceIds.value = next;
  syncPlanningReferenceSourceIds(next);
  referenceError.value = "";
}

function hydrateCreation() {
  const selected = currentCreation.value;
  if (!selected) return;
  const bindings = detail.value?.reference_bindings.filter((item) => item.shot_id === selected.id).sort((left, right) => left.position - right.position) ?? [];
  selectedReferenceIds.value = bindings.length
    ? bindings.map((item) => item.asset_id)
    : readyReferenceImages.value.map((asset) => asset.id);
  syncPlanningReferenceSourceIds(selectedReferenceIds.value);
}

function hydratePlanning() {
  const brief = currentPlanningBrief.value;
  planningError.value = "";
  planningMessage.value = "";
  if (brief) {
    planningDraft.sourceText = brief.source_text;
    planningDraft.targetDurationSeconds = brief.target_duration_seconds;
    planningDraft.targetResolution = brief.target_resolution;
    planningDraft.stylePreferences = brief.style_preferences;
    planningDraft.sourceAssetIds = eligiblePlanningSourceIds(brief.source_asset_ids);
    return;
  }
  planningDraft.sourceText = currentCreation.value?.prompt ?? "";
  planningDraft.targetDurationSeconds = 60;
  planningDraft.targetResolution = "720p";
  planningDraft.stylePreferences = "";
  planningDraft.sourceAssetIds = uniqueReferenceIds([...readyPlanningDocumentIds.value, ...selectedReferenceIds.value]);
}

function updateStorySourceText(value: string) {
  planningDraft.sourceText = value;
}

async function openProject() {
  const id = projectId.value;
  if (!id) {
    await navigateTo("/projects", { replace: true });
    return;
  }
  const projectChanged = id !== selectedProjectId.value;
  if (projectChanged) {
    productionProgress.value = [];
    projectVideoVersions.value = [];
    productionError.value = "";
  }
  await loadProject(id, async (nextProjectId, signal) => (await project(nextProjectId, signal)).data);
  if (detail.value?.project.id === id) {
    if (projectChanged) releaseProjectResultPreview();
    nameDraft.value = detail.value.project.name;
    if (projectChanged || hydratedProjectId !== id) {
      hydratedProjectId = id;
      lastSubmittedTaskRunId.value = "";
      hydrateCreation();
      hydratePlanning();
    }
    syncProjectResultPreview();
    await Promise.all([refreshDocuments(id), refreshProductionViews(id)]);
  }
}

async function refreshCurrentProject() {
  const expectedProjectId = selectedProjectId.value;
  if (!expectedProjectId) return;
  if (projectRefreshInFlight) return projectRefreshInFlight;

  projectRefreshInFlight = (async () => {
    try {
      const response = await project(expectedProjectId);
      if (expectedProjectId !== selectedProjectId.value) return;
      replaceProjectDetail(response.data);
      syncProjectResultPreview();
      await Promise.all([refreshDocuments(expectedProjectId), refreshProductionViews(expectedProjectId)]);
    } catch (error) {
      if (expectedProjectId === selectedProjectId.value) {
        projectError.value = safeErrorMessage(error, "项目暂时无法刷新，请稍后重试。");
      }
    } finally {
      projectRefreshInFlight = undefined;
    }
  })();

  return projectRefreshInFlight;
}

async function refreshDocuments(expectedProjectId = selectedProjectId.value) {
  if (!expectedProjectId) return;
  try {
    const response = await documents(expectedProjectId);
    if (expectedProjectId === selectedProjectId.value) documentConversions.value = response.data;
  } catch (error) {
    if (expectedProjectId === selectedProjectId.value) documentError.value = safeErrorMessage(error, "项目资料暂时无法读取，请稍后重试。");
  }
}

async function refreshProductionViews(expectedProjectId = selectedProjectId.value) {
  if (!expectedProjectId) return;
  try {
    const [progressResponse, versionsResponse] = await Promise.all([
      productionRuns(expectedProjectId),
      videoVersions(expectedProjectId),
    ]);
    if (expectedProjectId !== selectedProjectId.value) return;
    productionProgress.value = progressResponse.data;
    projectVideoVersions.value = versionsResponse.data;
    syncProjectResultPreview();
  } catch (error) {
    if (expectedProjectId === selectedProjectId.value) {
      resultPreviewError.value = safeErrorMessage(error, "项目制作进度暂时无法读取，请稍后重试。");
    }
  }
}

function applyTaskRun(taskRun: TaskRun) {
  const current = detail.value;
  if (!current || taskRun.project_id !== current.project.id) return;
  replaceProjectDetail({
    ...current,
    task_runs: [...current.task_runs.filter((item) => item.id !== taskRun.id), taskRun],
  });
}

function applyCreativeBriefRevision(brief: CreativeBriefRevision) {
  const current = detail.value;
  if (!current || brief.project_id !== current.project.id) return;
  replaceProjectDetail({
    ...current,
    creative_brief_revisions: [...current.creative_brief_revisions.filter((item) => item.id !== brief.id), brief],
  });
}

function applyStoryboardRevision(storyboard: StoryboardRevision) {
  const current = detail.value;
  if (!current || storyboard.project_id !== current.project.id) return;
  replaceProjectDetail({
    ...current,
    storyboard_revisions: [...current.storyboard_revisions.filter((item) => item.id !== storyboard.id), storyboard],
  });
}

function applyProductionRun(productionRun: ProductionRun) {
  const current = detail.value;
  if (!current || productionRun.project_id !== current.project.id) return;
  replaceProjectDetail({
    ...current,
    production_runs: [...current.production_runs.filter((item) => item.id !== productionRun.id), productionRun],
  });
}

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForAutoStoryboard(projectId: string, startedAt: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await storyboardRevisions(projectId);
    const candidate = response.data
      .filter((storyboard) => storyboard.status === "READY_FOR_REVIEW" && storyboard.created_at >= startedAt)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    if (candidate) return candidate;
    await refreshCurrentProject();
    const failedBrief = currentPlanningBrief.value;
    if (failedBrief?.status === "FAILED" && failedBrief.created_at >= startedAt) {
      throw new Error("PLANNING_FAILED");
    }
    await delay(500);
  }
  throw new Error("PLANNING_TIMEOUT");
}

async function startAutomatedProduction(projectId: string) {
  const startedAt = new Date(Date.now() - 1_000).toISOString();
  const sourceText = planningDraft.sourceText.trim();
  planningMessage.value = "AI 正在理解你的描述。";
  const briefResponse = await createCreativeBriefRevision(projectId, {
    source_text: sourceText,
    target_duration_seconds: planningDraft.targetDurationSeconds,
    target_resolution: planningDraft.targetResolution,
    style_preferences: planningDraft.stylePreferences.trim(),
    source_asset_ids: eligiblePlanningSourceIds(planningDraft.sourceAssetIds),
  }, commandKey("studio-auto-brief"));
  applyCreativeBriefRevision(briefResponse.data);

  planningMessage.value = "AI 正在准备视频内容。";
  const planResponse = await requestCreativePlan(briefResponse.data.id, commandKey("studio-auto-plan"));
  applyCreativeBriefRevision(planResponse.data);
  const storyboard = await waitForAutoStoryboard(projectId, startedAt);
  applyStoryboardRevision(storyboard);

  planningMessage.value = "AI 正在准备制作。";
  const approved = await approveStoryboardRevision(storyboard.id, commandKey("studio-auto-approve"));
  applyStoryboardRevision(approved.data);

  planningMessage.value = "AI 已开始制作视频。";
  const production = await createProductionRun(projectId, { storyboard_revision_id: approved.data.id }, commandKey("studio-auto-production"));
  applyProductionRun(production.data);
  await refreshCurrentProject();
}

async function retryProductionSegment(sequence: number) {
  const progress = currentProductionProgress.value;
  if (!progress || productionBusy.value) return;
  const segment = progress.segments.find((item) => item.sequence === sequence);
  if (!segment || segment.status !== "FAILED" || !segment.retryable) return;
  productionBusy.value = true;
  productionError.value = "";
  try {
    const response = await retryProductionSegmentCommand(progress.production_run.id, sequence, commandKey("studio-production-segment-retry"));
    if (selectedProjectId.value === progress.production_run.project_id) {
      productionProgress.value = productionProgress.value.map((item) =>
        item.production_run.id === response.data.production_run.id ? response.data : item,
      );
    }
  } catch (error) {
    productionError.value = safeErrorMessage(error, "这一段暂时无法重新制作，请稍后重试。");
  } finally {
    productionBusy.value = false;
  }
}

function startEditingName() {
  nameDraft.value = detail.value?.project.name ?? "";
  editingName.value = true;
}

function cancelEditingName() {
  nameDraft.value = detail.value?.project.name ?? "";
  editingName.value = false;
}

async function saveProjectName() {
  const current = detail.value;
  const name = nameDraft.value.trim();
  if (!current || !name) return;
  savingName.value = true;
  projectError.value = "";
  try {
    const response = await updateProject(current.project.id, { name }, commandKey("studio-project-name"));
    replaceProjectDetail({ ...current, project: response.data });
    editingName.value = false;
  } catch (error) {
    projectError.value = safeErrorMessage(error, "项目名称暂时无法保存，请稍后重试。");
  } finally {
    savingName.value = false;
  }
}

async function toggleArchive() {
  const current = detail.value;
  if (!current) return;
  savingStatus.value = true;
  projectError.value = "";
  try {
    const status = current.project.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    const response = await updateProject(current.project.id, { status }, commandKey("studio-project-status"));
    replaceProjectDetail({ ...current, project: response.data });
  } catch (error) {
    projectError.value = safeErrorMessage(error, "项目状态暂时无法更新，请稍后重试。");
  } finally {
    savingStatus.value = false;
  }
}

async function generateVideo() {
  const current = detail.value;
  if (!canStartGeneration.value || creationBusy.value || planningBusy.value || productionBusy.value || !current) return;
  creationBusy.value = true;
  planningBusy.value = true;
  creationError.value = "";
  planningError.value = "";
  productionError.value = "";
  try {
    await startAutomatedProduction(current.project.id);
  } catch (error) {
    const message = error instanceof Error && error.message === "PLANNING_TIMEOUT"
      ? "AI 正在整理这个故事，但暂时没有完成。请稍后刷新项目，或精简描述后生成新版本。"
      : safeErrorMessage(error, "视频暂时无法生成，请检查想法或稍后重试。");
    planningError.value = message;
    creationError.value = message;
  } finally {
    planningMessage.value = "";
    planningBusy.value = false;
    creationBusy.value = false;
  }
}

async function retryGeneration() {
  if (!latestTask.value || !canRetry.value || creationBusy.value) return;
  creationBusy.value = true;
  creationError.value = "";
  try {
    const response = await retryTaskRun(latestTask.value.id, commandKey("studio-task-retry"));
    lastSubmittedTaskRunId.value = response.data.id;
    applyTaskRun(response.data);
    await refreshCurrentProject();
  } catch (error) {
    creationError.value = safeErrorMessage(error, "这次生成暂时无法重试，请稍后再试。");
  } finally {
    creationBusy.value = false;
  }
}

function selectReferenceFile(file: File | undefined) {
  referenceError.value = "";
  if (!file) {
    uploadFile.value = undefined;
    return;
  }
  if (!supportedImageTypes.has(file.type)) {
    uploadFile.value = undefined;
    referenceError.value = "请选择 PNG、JPEG 或 WebP 格式的图片。";
    return;
  }
  uploadFile.value = file;
}

function documentMimeType(file: File) {
  if (documentMimeTypes.has(file.type)) return file.type;
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? documentMimeByExtension[extension] : undefined;
}

function selectDocumentFile(file: File | undefined) {
  documentError.value = "";
  if (!file) {
    documentFile.value = undefined;
    return;
  }
  if (!documentMimeType(file) || file.size > 25 * 1024 * 1024) {
    documentFile.value = undefined;
    documentError.value = "请选择不超过 25 MB 的 PDF、Word、演示文稿、表格、Markdown 或文本资料。";
    return;
  }
  documentFile.value = file;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadReference() {
  const file = uploadFile.value;
  const projectIdAtStart = selectedProjectId.value;
  if (!file || !projectIdAtStart || creationBusy.value) return;
  creationBusy.value = true;
  referenceError.value = "";
  try {
    const request = await createUploadRequest(projectIdAtStart, {
      kind: "IMAGE",
      filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
    }, commandKey("studio-upload"));
    if (!request.data.upload_url) throw new Error("Upload is unavailable.");
    if (projectIdAtStart !== selectedProjectId.value) return;
    const uploaded = await fetch(request.data.upload_url, { method: "PUT", headers: request.data.headers, body: file });
    if (!uploaded.ok) throw new Error("Upload failed.");
    await confirmAssetUpload(request.data.asset_id, {
      sha256: await sha256(file),
      mime_type: file.type,
      byte_size: file.size,
    }, commandKey("studio-confirm"));
    if (projectIdAtStart !== selectedProjectId.value) return;
    const selectedIds = uniqueReferenceIds([...selectedReferenceIds.value, request.data.asset_id]);
    selectedReferenceIds.value = selectedIds;
    planningDraft.sourceAssetIds = uniqueReferenceIds([...planningDraft.sourceAssetIds, request.data.asset_id]);
    uploadFile.value = undefined;
    uploadInputVersion.value += 1;
    await refreshCurrentProject();
  } catch (error) {
    referenceError.value = safeErrorMessage(error, "参考图暂时无法添加，请稍后重试。");
  } finally {
    creationBusy.value = false;
  }
}

async function uploadDocument() {
  const file = documentFile.value;
  const projectIdAtStart = selectedProjectId.value;
  const mimeType = file ? documentMimeType(file) : undefined;
  if (!file || !mimeType || !projectIdAtStart || documentBusy.value) return;
  documentBusy.value = true;
  documentError.value = "";
  try {
    const request = await createUploadRequest(projectIdAtStart, {
      kind: "DOCUMENT",
      filename: file.name,
      mime_type: mimeType,
      byte_size: file.size,
    }, commandKey("studio-document-upload"));
    if (!request.data.upload_url) throw new Error("Document upload is unavailable.");
    if (projectIdAtStart !== selectedProjectId.value) return;
    const uploaded = await fetch(request.data.upload_url, { method: "PUT", headers: request.data.headers, body: file });
    if (!uploaded.ok) throw new Error("Document upload failed.");
    await confirmAssetUpload(request.data.asset_id, {
      sha256: await sha256(file),
      mime_type: mimeType,
      byte_size: file.size,
    }, commandKey("studio-document-confirm"));
    if (projectIdAtStart !== selectedProjectId.value) return;
    planningDraft.sourceAssetIds = uniqueReferenceIds([...planningDraft.sourceAssetIds, request.data.asset_id]);
    await createDocumentConversion(projectIdAtStart, request.data.asset_id, commandKey("studio-document-convert"));
    documentFile.value = undefined;
    documentInputVersion.value += 1;
    await refreshCurrentProject();
  } catch (error) {
    documentError.value = safeErrorMessage(error, "资料暂时无法添加，请稍后重试。");
  } finally {
    documentBusy.value = false;
  }
}

async function retryDocument(conversionId: string) {
  if (documentBusy.value) return;
  documentBusy.value = true;
  documentError.value = "";
  try {
    await retryDocumentConversion(conversionId, commandKey("studio-document-retry"));
    await refreshCurrentProject();
  } catch (error) {
    documentError.value = safeErrorMessage(error, "这份资料暂时无法重新整理，请稍后重试。");
  } finally {
    documentBusy.value = false;
  }
}

async function downloadDocument(assetId: string) {
  if (documentBusy.value) return;
  documentError.value = "";
  try {
    const response = await assetDownloadUrl(assetId);
    const link = document.createElement("a");
    link.href = response.data.download_url;
    link.download = "project-material.md";
    link.rel = "noopener";
    link.click();
  } catch (error) {
    documentError.value = safeErrorMessage(error, "这份资料暂时无法查看，请稍后重试。");
  }
}

async function previewAsset(assetId: string) {
  const asset = detail.value?.assets.find((item) => item.id === assetId);
  const projectIdAtStart = selectedProjectId.value;
  if (!asset || asset.status !== "READY") return;
  referenceError.value = "";
  try {
    const response = await assetDownloadUrl(asset.id);
    if (projectIdAtStart !== selectedProjectId.value) return;
    previewAssetId.value = asset.id;
    previewUrl.value = response.data.download_url;
    previewKind.value = asset.kind === "IMAGE" ? "IMAGE" : "VIDEO";
    previewTitle.value = asset.kind === "IMAGE" ? "预览图片" : "预览视频";
  } catch (error) {
    referenceError.value = safeErrorMessage(error, "当前内容暂时无法预览。");
  }
}

async function previewResult() {
  const assetId = selectedResultAssetId.value || displayedProjectResults.value[0]?.assetId;
  if (!assetId) return;
  await selectProjectResult(assetId);
  document.getElementById("project-results-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

watch(projectId, () => void openProject(), { immediate: true });
onBeforeUnmount(() => {
  stopProjectEvents();
  releaseProjectResultPreview();
  clearForNavigation();
});
</script>
