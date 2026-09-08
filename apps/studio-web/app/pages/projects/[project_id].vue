<template>
  <section class="project-workspace" aria-labelledby="project-workspace-title">
    <header class="project-workspace-header">
      <NuxtLink class="back-link" to="/projects">
        <ArrowLeft :size="16" />
        <span>返回项目列表</span>
      </NuxtLink>

      <div class="project-workspace-title">
        <p class="eyebrow">当前创作</p>
        <h1 id="project-workspace-title" :title="detail?.project.name ?? undefined">{{ detail?.project.name ?? "正在打开项目" }}</h1>
        <span v-if="detail" class="project-status" :class="detail.project.status.toLowerCase()">{{ projectStatusLabel(detail.project.status) }}</span>
      </div>

      <div class="project-workspace-actions">
        <button
          class="relay-status-button"
          :class="`relay-${relayState}`"
          type="button"
          :disabled="relayBusy || relayState === 'checking' || !relayReconnectAvailable"
          :title="relayStatusLabel"
          @click="relayReconnect"
        >
          <Link2 :size="15" />
          <span>{{ relayStatusLabel }}</span>
        </button>
        <button class="icon-button" type="button" title="刷新项目" aria-label="刷新项目" :disabled="loading" @click="refreshProjectAndRelay">
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
            :files="uploadFiles"
            :input-version="uploadInputVersion"
            :busy="creationBusy"
            :error="referenceError"
            @update:files="selectReferenceFiles"
            @update:selected-ids="updateSelectedReferenceIds"
            @selection-limit="referenceError = '最多选择 7 张参考图。'"
            @upload="uploadReference"
            @preview="previewAsset"
            @remove="removeProjectAsset"
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
            @retry-knowledge="retryDocumentKnowledge"
            @details="openDocumentDetails"
            @toggle-adoption="toggleDocumentAdoption"
            @remove="removeProjectAsset"
          />

          <section class="music-plan-panel surface-panel" aria-labelledby="music-plan-title">
            <div class="music-plan-heading">
              <div>
                <p class="eyebrow">音频</p>
                <h2 id="music-plan-title">背景音乐</h2>
              </div>
              <Music :size="16" aria-hidden="true" />
            </div>
            <p class="music-plan-note">
              {{ musicAssets.length ? "自动模式优先使用当前工作区已确认的 MUSIC 音频资产；没有合适曲目且 Pixabay 可用时，点击生成会自动补一首。" : "当前工作区没有 MUSIC 资产；自动模式会在 Pixabay 可用时尝试补曲，也可以关闭，或先上传一首 MP3、WAV 或 OGG。" }}
            </p>
            <div class="music-plan-options">
              <label class="music-plan-option" :class="{ selected: musicPlan.mode === 'AUTO' }">
                <input v-model="musicPlan.mode" type="radio" value="AUTO" />
                <span class="music-plan-option-copy"><strong>自动</strong><small>先选工作区 MUSIC，无候选时尝试 Pixabay</small></span>
              </label>
              <label class="music-plan-option" :class="{ selected: musicPlan.mode === 'MANUAL' }">
                <input v-model="musicPlan.mode" type="radio" value="MANUAL" :disabled="!musicAssets.length" />
                <span class="music-plan-option-copy"><strong>指定曲目</strong><small>只使用工作区已确认的 MUSIC</small></span>
              </label>
              <label class="music-plan-option" :class="{ selected: musicPlan.mode === 'OFF' }">
                <input v-model="musicPlan.mode" type="radio" value="OFF" />
                <span class="music-plan-option-copy"><strong>关闭</strong><small>明确不混入背景音乐</small></span>
              </label>
            </div>
            <select v-if="musicPlan.mode === 'MANUAL'" v-model="musicPlan.assetId" class="music-plan-select" aria-label="选择工作区音乐">
              <option value="" disabled>选择一首工作区 MUSIC</option>
              <option v-for="asset in musicAssets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
            </select>
            <div v-if="musicPlan.mode === 'MANUAL' && selectedMusicAsset" class="music-plan-preview">
              <div class="music-plan-preview-heading">
                <span class="music-plan-preview-label">试听：{{ selectedMusicAsset.label }}</span>
                <button class="music-plan-preview-button" type="button" :disabled="musicPreviewLoading" @click="auditionSelectedMusic">
                  {{ musicPreviewLoading ? "正在准备" : "试听" }}
                </button>
              </div>
              <audio v-if="musicPreviewUrl && musicPreviewAssetId === selectedMusicAsset.id" ref="musicPreviewElement" class="music-plan-preview-player" controls preload="none" aria-label="试听背景音乐" :src="musicPreviewUrl" />
              <p v-if="musicPreviewError" class="music-plan-preview-error" role="alert">{{ musicPreviewError }}</p>
            </div>
            <details class="music-plan-disclosure">
              <summary>上传工作区音乐</summary>
              <div class="music-plan-disclosure-body">
                <label class="music-plan-upload">
                  <span>选择音乐文件</span>
                  <input type="file" accept="audio/mpeg,audio/wav,audio/ogg" :disabled="productionBusy" @change="selectMusicUpload" />
                </label>
              </div>
            </details>
            <details v-if="pixabayMusicCapability?.status === 'AVAILABLE'" class="music-plan-disclosure">
              <summary>从 Pixabay 导入</summary>
              <div class="music-plan-disclosure-body">
                <div class="music-plan-catalog">
                  <div class="music-plan-catalog-heading">
                    <strong>按关键词导入</strong>
                    <span>原仓库逻辑：筛选后取首条</span>
                  </div>
                  <form class="music-plan-catalog-search" @submit.prevent="importPixabayMusicAsset">
                    <input v-model="pixabayQuery" class="music-plan-hint" maxlength="200" placeholder="例如 ambient 或 upbeat" aria-label="Pixabay 音乐搜索词" :disabled="pixabayImportBusy || productionBusy" />
                    <button class="music-plan-catalog-search-button" type="submit" :disabled="pixabayImportBusy || productionBusy || !pixabayQuery.trim()">
                      {{ pixabayImportBusy ? "导入中" : "导入" }}
                    </button>
                  </form>
                  <p v-if="pixabayImportError" class="music-plan-catalog-error" role="alert">{{ pixabayImportError }}</p>
                </div>
              </div>
            </details>
            <p v-else-if="pixabayMusicCapability?.status === 'BLOCKED'" class="music-plan-note">Pixabay 音乐当前不可用：{{ pixabayMusicCapability.reason }}</p>
          </section>

          <section class="music-plan-panel surface-panel caption-policy-panel" aria-labelledby="caption-policy-title">
            <div class="music-plan-heading">
              <div>
                <p class="eyebrow">交付</p>
                <h2 id="caption-policy-title">字幕</h2>
              </div>
            </div>
            <p class="music-plan-note">字幕来自已检查的音频转写，文字需人工复核；默认不添加字幕。</p>
            <div class="music-plan-options">
              <label class="music-plan-option" :class="{ selected: captionPolicy === 'OFF' }">
                <input v-model="captionPolicy" type="radio" value="OFF" />
                <span class="music-plan-option-copy"><strong>不添加字幕</strong><small>关闭字幕交付要求</small></span>
              </label>
              <label class="music-plan-option" :class="{ selected: captionPolicy === 'REQUIRED' }">
                <input v-model="captionPolicy" type="radio" value="REQUIRED" />
                <span class="music-plan-option-copy"><strong>添加字幕</strong><small>必须有已检查的转写事实并烧录到成片</small></span>
              </label>
            </div>
          </section>

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
          <p v-if="documentGenerationGateMessage" class="generation-material-gate" role="status">{{ documentGenerationGateMessage }}</p>
          <ProductionProgressPanel :progress="currentProductionProgress" :busy="productionBusy" @retry="retryProductionSegment" @retry-composition="retryProductionComposition" />
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
          <div class="project-delete-control" aria-describedby="delete-capability-note">
            <button class="secondary-button danger-button" type="button" :disabled="deletingProject" @click="beginDeleteProject">
              <Trash2 :size="16" />
              <span>删除项目</span>
            </button>
            <div v-if="deleteConfirmationOpen" class="delete-confirmation" role="group" aria-labelledby="delete-confirmation-title">
              <p id="delete-confirmation-title">项目会从列表隐藏，历史任务和资产保留；进行中的制作会被服务端阻止。</p>
              <label>
                <span>输入“删除”确认</span>
                <input v-model="deleteNameConfirmation" type="text" inputmode="text" autocomplete="off" maxlength="2" placeholder="删除" :disabled="deletingProject" />
              </label>
              <div class="delete-confirmation-actions">
                <button class="danger-button" type="button" :disabled="deleteNameConfirmation.trim() !== '删除' || deletingProject" @click="deleteCurrentProject">
                  {{ deletingProject ? "正在删除" : "确认删除项目" }}
                </button>
                <button class="text-button" type="button" :disabled="deletingProject" @click="cancelDeleteProject">取消</button>
              </div>
            </div>
            <p id="delete-capability-note">软删除 · 活动制作中不可删除</p>
          </div>
        </div>
      </section>
    </template>

    <MediaPreviewDialog :open="Boolean(previewUrl)" :url="previewUrl" :kind="previewKind" :title="previewTitle" @close="releasePreview" />
  </section>
</template>

<script setup lang="ts">
import { Archive, ArrowLeft, Link2, Music, Pencil, RefreshCw, Trash2 } from "lucide-vue-next";

import GenerationPanel, { type GenerationFeedback } from "../../components/studio/GenerationPanel.vue";
import MediaPreviewDialog from "../../components/studio/MediaPreviewDialog.vue";
import ProjectMaterials, { type ProjectMaterialItem } from "../../components/studio/ProjectMaterials.vue";
import ProjectResultsPanel, { type ProjectResultItem } from "../../components/studio/ProjectResultsPanel.vue";
import ProductionProgressPanel from "../../components/studio/ProductionProgressPanel.vue";
import ReferenceShelf from "../../components/studio/ReferenceShelf.vue";
import StoryPlanningPanel from "../../components/studio/StoryPlanningPanel.vue";
import { creationProgressFor, productionProgressFor } from "../../composables/useCreationProgress";
import type { Asset, CreativeBriefRevision, DocumentConversion, DocumentKnowledgeDetail, ProductionRun, ProductionRunProgress, Shot, StoryboardRevision, TaskRun, VideoVersion } from "../../composables/useControlApi";
import { useRelayConnection } from "../../composables/useRelayConnection";

const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const {
  project,
  updateProject,
  deleteProject,
  retryTaskRun,
  createUploadRequest,
  confirmAssetUpload,
  deleteAsset,
  assetDownloadUrl,
  documents,
  createDocumentConversion,
  retryDocumentConversion,
  documentKnowledgeDetail,
  retryDocumentKnowledgeRevision,
  createCreativeBriefRevision,
  requestCreativePlan,
  storyboardRevisions,
  approveStoryboardRevision,
  createDeliveryPlanRevision,
  approveDeliveryPlanRevision,
  narrationScriptRevisions,
  createNarrationScriptRevision,
  createProductionRun,
  productionRuns,
  videoVersions,
  audioCapabilities,
  importPixabayMusic,
  retryProductionSegment: retryProductionSegmentCommand,
  retryProductionComposition: retryProductionCompositionCommand,
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
  uploadFiles,
  previewAssetId,
  previewUrl,
  releasePreview,
} = useProjectSession();

const editingName = ref(false);
const nameDraft = ref("");
const savingName = ref(false);
const savingStatus = ref(false);
const deleteConfirmationOpen = ref(false);
const deleteNameConfirmation = ref("");
const deletingProject = ref(false);
const creationBusy = ref(false);
const creationError = ref("");
const referenceError = ref("");
const documentFile = ref<File>();
const documentBusy = ref(false);
const documentError = ref("");
const documentInputVersion = ref(0);
const documentConversions = ref<DocumentConversion[]>([]);
const documentKnowledgeDetails = ref<Record<string, DocumentKnowledgeDetail>>({});
const documentKnowledgeDetailLoading = ref(new Set<string>());
const documentOptOuts = ref(new Set<string>());
let documentAdoptionHydratedProjectId = "";
const planningBusy = ref(false);
const planningError = ref("");
const planningMessage = ref("");
const productionBusy = ref(false);
const productionError = ref("");
const workspaceMusicAssets = ref<Asset[]>([]);
const pixabayQuery = ref("");
const pixabayImportBusy = ref(false);
const pixabayImportError = ref("");
const relayConnection = useRelayConnection();
const relayState = relayConnection.state;
const relayReconnectAvailable = relayConnection.reconnectAvailable;
const relayBusy = relayConnection.busy;
const relayReconnect = relayConnection.reconnect;
const refreshRelay = relayConnection.refresh;
let relayCheckTimer: number | undefined;
const relayStatusLabel = computed(() => {
  if (relayConnection.busy.value) return "正在重连"
  if (relayConnection.state.value === "connected") return "视频链路正常"
  if (relayConnection.state.value === "checking") return "检查视频链路"
  if (relayConnection.state.value === "unavailable") return "链路未配置"
  return relayConnection.reconnectAvailable.value ? "链路断开，点击重连" : "视频链路断开"
});
onMounted(() => {
  void refreshRelay();
  relayCheckTimer = window.setInterval(() => void relayConnection.check(), 30_000);
});
const planningDraft = reactive({
  sourceText: "",
  targetDurationSeconds: 60,
  targetResolution: "720p" as "480p" | "720p",
  stylePreferences: "",
  sourceAssetIds: [] as string[],
});
const musicPlan = reactive({ mode: "AUTO" as "AUTO" | "MANUAL" | "OFF", assetId: "", styleHint: "" });
const captionPolicy = ref<"OFF" | "REQUIRED">("OFF");
const productionProgress = ref<ProductionRunProgress[]>([]);
const projectVideoVersions = ref<VideoVersion[]>([]);
const projectAudioCapabilities = ref<Array<{ id: string; label: string; status: "AVAILABLE" | "BLOCKED" | "NOT_CONFIGURED"; free: boolean; reason: string }>>([]);
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
const musicAssets = computed(() => {
  const assetsById = new Map<string, Asset>();
  for (const asset of [...(detail.value?.assets ?? []), ...workspaceMusicAssets.value]) {
    if (asset.kind === "AUDIO" && asset.status === "READY" && asset.metadata?.audio_role === "MUSIC") assetsById.set(asset.id, asset);
  }
  return [...assetsById.values()].map((asset) => {
    const filename = asset.metadata?.filename ? String(asset.metadata.filename) : `音乐 ${asset.id.slice(-6)}`;
    const stem = filename.replace(/\.[^.]+$/, "").replace(/^pixabay_/i, "").replace(/_\d{6}$/u, "");
    const words = stem.split(/[_-]+/u).filter(Boolean);
    const fallbackArtist = words.length > 1 ? words.pop() : "";
    const fallbackTitle = words.join(" ") || stem;
    const title = typeof asset.metadata?.pixabay_title === "string" && asset.metadata.pixabay_title.trim()
      ? asset.metadata.pixabay_title.trim()
      : fallbackTitle;
    const artist = typeof asset.metadata?.pixabay_artist === "string" && asset.metadata.pixabay_artist.trim()
      ? asset.metadata.pixabay_artist.trim()
      : fallbackArtist;
    const duration = asset.duration_ms ? ` · ${Math.floor(asset.duration_ms / 60_000)}:${String(Math.floor(asset.duration_ms / 1_000) % 60).padStart(2, "0")}` : "";
    return { id: asset.id, label: `${title}${artist ? ` · ${artist}` : ""}${duration}` };
  });
});
const selectedMusicAsset = computed(() => musicAssets.value.find((asset) => asset.id === musicPlan.assetId));
const musicPreviewElement = ref<HTMLAudioElement | null>(null);
const musicPreviewUrl = ref("");
const musicPreviewAssetId = ref("");
const musicPreviewError = ref("");
const musicPreviewLoading = ref(false);
let musicPreviewRequest = 0;

function resetMusicPreview() {
  musicPreviewRequest += 1;
  musicPreviewElement.value?.pause();
  musicPreviewElement.value = null;
  musicPreviewUrl.value = "";
  musicPreviewAssetId.value = "";
  musicPreviewError.value = "";
  musicPreviewLoading.value = false;
}

async function auditionSelectedMusic() {
  const asset = selectedMusicAsset.value;
  const projectIdAtStart = selectedProjectId.value;
  if (!asset || !projectIdAtStart || musicPreviewLoading.value) return;
  const request = ++musicPreviewRequest;
  musicPreviewLoading.value = true;
  musicPreviewError.value = "";
  try {
    const response = await assetDownloadUrl(asset.id);
    if (request !== musicPreviewRequest || projectIdAtStart !== selectedProjectId.value || musicPlan.assetId !== asset.id) return;
    musicPreviewUrl.value = response.data.download_url;
    musicPreviewAssetId.value = asset.id;
    await nextTick();
    if (request !== musicPreviewRequest || musicPlan.assetId !== asset.id) return;
    const player = musicPreviewElement.value;
    if (!player) return;
    player.load();
    try {
      await player.play();
    } catch {
      // Browser autoplay policy may require the native play control; keep the
      // signed URL and controls available instead of turning a valid preview
      // URL into an error.
    }
  } catch (error) {
    if (request === musicPreviewRequest) musicPreviewError.value = safeErrorMessage(error, "音乐试听暂时不可用，请稍后重试。");
  } finally {
    if (request === musicPreviewRequest) musicPreviewLoading.value = false;
  }
}

watch([() => musicPlan.mode, () => musicPlan.assetId], () => {
  resetMusicPreview();
});
const workspaceId = computed(() => detail.value?.project.workspace_id);
const pixabayMusicCapability = computed(() => projectAudioCapabilities.value.find((capability) => capability.id === "pixabay_music"));
const providerNativeAudioCapability = computed(() => projectAudioCapabilities.value.find((capability) => capability.id === "provider_native_audio"));
const providerNativeAudioAvailable = computed(() => providerNativeAudioCapability.value?.status === "AVAILABLE");
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
const readyPlanningDocumentIds = computed(() => {
  const completedSourceIds = new Set(documentConversions.value
    .filter((conversion) => conversion.status === "SUCCEEDED" && Boolean(conversion.markdown_asset_id) && conversion.understanding?.status === "READY" && !documentOptOuts.value.has(conversion.source_asset_id))
    .map((conversion) => conversion.source_asset_id));
  return (detail.value?.assets ?? [])
    .filter((asset) => asset.status === "READY" && asset.origin === "USER_UPLOAD" && asset.kind === "DOCUMENT" && completedSourceIds.has(asset.id))
    .slice(0, 4)
    .map((asset) => asset.id);
});
const projectMaterials = computed<ProjectMaterialItem[]>(() => {
  const latestBySource = new Map<string, DocumentConversion>();
  for (const conversion of [...documentConversions.value].sort((left, right) => right.updated_at.localeCompare(left.updated_at))) {
    if (!latestBySource.has(conversion.source_asset_id)) latestBySource.set(conversion.source_asset_id, conversion);
  }
  const items: ProjectMaterialItem[] = [];
  for (const asset of (detail.value?.assets ?? []).filter((candidate) => candidate.kind === "DOCUMENT" && candidate.origin === "USER_UPLOAD" && candidate.status === "READY")) {
    const conversion = latestBySource.get(asset.id);
    if (!conversion) continue;
    items.push({
        conversionId: conversion.id,
        sourceAssetId: asset.id,
        filename: typeof asset.metadata.filename === "string" ? asset.metadata.filename : "项目资料",
        status: conversion.status === "CREATED" ? "QUEUED" : conversion.status,
        retryable: conversion.retryable,
        markdownAssetId: conversion.markdown_asset_id,
        warningCount: conversion.warnings.length,
        understanding: conversion.understanding,
        understandingRetryable: conversion.understanding?.retryable === true,
        adopted: !documentOptOuts.value.has(asset.id),
        knowledgeDetail: conversion.understanding?.knowledge_revision_id ? documentKnowledgeDetails.value[conversion.understanding.knowledge_revision_id] : undefined,
        detailLoading: conversion.understanding?.knowledge_revision_id ? documentKnowledgeDetailLoading.value.has(conversion.understanding.knowledge_revision_id) : false,
    });
  }
  return items;
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
    qcSummary: version.qc_report.audio_summary?.music_applied
      ? `${version.qc_report.safe_summary} 已混入 ${version.qc_report.audio_summary.music_title ?? "背景音乐"}。`
      : version.qc_report.safe_summary,
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
const blockingDocumentMaterials = computed(() => projectMaterials.value.filter((item) => item.adopted && (
  item.status !== "SUCCEEDED"
  || item.understanding?.status !== "READY"
)));
const documentGenerationGateMessage = computed(() => {
  if (blockingDocumentMaterials.value.some((item) => item.status === "FAILED" || item.understanding?.status === "FAILED")) return "有资料暂时无法使用";
  if (blockingDocumentMaterials.value.length > 0) return "正在理解项目资料，完成后即可开始";
  return "";
});
const canStartGeneration = computed(() => Boolean(
  detail.value
  && detail.value.project.status === "ACTIVE"
  && planningDraft.sourceText.trim()
  && planningDraft.targetDurationSeconds >= 15
  && planningDraft.targetDurationSeconds <= 600
  && !creationBusy.value
  && !planningBusy.value
  && !productionBusy.value
  && blockingDocumentMaterials.value.length === 0
  && (!currentProductionRun.value || !activeProductionStatuses.has(currentProductionRun.value.status)),
));
const failedProductionSegment = computed(() => currentProductionProgress.value?.segments.find((segment) => segment.status === "FAILED" && segment.retryable));
const canRetry = computed(() => latestTask.value?.status === "FAILED" && Boolean(failedProductionSegment.value || !currentProductionProgress.value));
const createsNewVersion = computed(() => hasProjectResult.value || Boolean(latestTask.value && newVersionTaskStatuses.has(latestTask.value.status)));
const creationProgress = computed(() => currentProductionProgress.value
  ? productionProgressFor(currentProductionProgress.value, Boolean(planningDraft.sourceText.trim()), creationBusy.value || planningBusy.value || productionBusy.value)
  : creationProgressFor(latestTask.value?.status, Boolean(currentCreation.value)));
const generationFeedback = computed<GenerationFeedback | undefined>(() => {
  const productionRun = currentProductionProgress.value?.production_run;
  if (productionRun?.status === "SUCCEEDED") {
    return { tone: "success", message: "完整成片已保存到当前项目，可以在右侧查看。" };
  }
  if (productionRun?.status === "FAILED" || productionRun?.status === "BLOCKED") {
    const blockedSegment = currentProductionProgress.value?.segments.find((segment) => segment.status === "FAILED" || segment.status === "WAITING");
    return { tone: "error", message: blockedSegment?.safe_summary ?? "本次完整制作没有完成。你可以查看制作细节，或调整描述后生成新版本。" };
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

function projectStatusLabel(status: "ACTIVE" | "ARCHIVED" | "DELETED") {
  if (status === "ARCHIVED") return "已归档";
  if (status === "DELETED") return "已删除";
  return "进行中";
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
    // The signed object URL is cross-origin and is only available after the
    // API round-trip. A synthetic anchor click loses Chrome's user-activation
    // and is frequently blocked as a script-initiated download. Navigating to
    // the attachment URL lets the browser handle the download natively while
    // preserving the server's short-lived signature and Content-Disposition.
    window.location.assign(response.data.download_url);
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
    PROVIDER_PROTOCOL_INVALID: "参考素材已失效或与本次创作不一致，请保留有效素材后生成新版本。",
    ASSET_IN_USE: "这份素材正在被当前制作使用，完成或停止后才能删除。",
    DOCUMENT_UNSUPPORTED: "这份资料暂时无法整理，请确认文件格式后重试。",
    DOCUMENT_CONVERSION_ACTIVE_CONFLICT: "这份资料正在整理，请稍后查看。",
    DOCUMENT_CONVERSION_FAILED: "这份资料暂时无法整理，请稍后重试。",
    DOCUMENT_RUNTIME_UNAVAILABLE: "资料整理服务暂时不可用，请稍后重试。",
    DOCUMENT_OUTPUT_INVALID: "这份资料暂时无法整理，请稍后重试。",
    DOCUMENT_KNOWLEDGE_NOT_READY: "正在理解项目资料，完成后即可开始。",
    DOCUMENT_KNOWLEDGE_INVALID: "这份资料暂时无法使用，请重新理解。",
    DOCUMENT_KNOWLEDGE_ACTIVE_CONFLICT: "这份资料正在理解，请稍后查看。",
    DOCUMENT_FACT_CONFLICT: "资料中有内容需要补充确认，请查看要点后再试。",
    DOCUMENT_FACT_CONTEXT_INVALID: "项目资料版本已更新，请刷新后重试。",
    CREATIVE_PLAN_ACTIVE_CONFLICT: "AI 正在整理这份故事，请稍后查看进度。",
    CREATIVE_PLAN_STATE_INVALID: "当前故事还不能整理，请刷新后再试。",
    DELIVERY_PLAN_STATE_INVALID: "旁白脚本还未完成样音审批和时间轴确认，请完成审批后再开始制作。",
    PLANNING_FAILED: "AI 暂时无法整理这份故事，请调整描述后重试。",
    DOCUMENT_CONTEXT_INVALID: "项目资料整理完成后才能参与故事规划。",
    STORYBOARD_SPEC_INVALID: "AI 暂时无法拆解这份故事，请调整描述后重新生成。",
    PRODUCTION_RUN_ACTIVE_CONFLICT: "这个项目已有视频正在制作，请稍后查看。",
    PRODUCTION_RUN_STATE_INVALID: "当前内容还不能制作，请调整描述后重试。",
  };
  return typeof code === "string" && labels[code] ? labels[code] : fallback;
}

function uniqueReferenceIds(ids: string[]) {
  return [...new Set(ids)];
}

function eligibleReferenceImageIds(ids: string[]) {
  const readyImageIds = new Set(readyReferenceImages.value.map((asset) => asset.id));
  return uniqueReferenceIds(ids).filter((id) => readyImageIds.has(id));
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

function defaultSelectedReferenceIds() {
  const brief = currentPlanningBrief.value;
  return brief
    ? eligibleReferenceImageIds(brief.source_asset_ids)
    : readyReferenceImages.value.map((asset) => asset.id);
}

async function updateSelectedReferenceIds(ids: string[]) {
  const next = uniqueReferenceIds(ids);
  if (selectedReferenceIds.value.length === next.length && selectedReferenceIds.value.every((id, index) => id === next[index])) return;
  selectedReferenceIds.value = next;
  syncPlanningReferenceSourceIds(next);
  referenceError.value = "";
}

function hydrateCreation() {
  selectedReferenceIds.value = defaultSelectedReferenceIds();
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

function hydrateDocumentAdoption(expectedProjectId: string) {
  if (documentAdoptionHydratedProjectId === expectedProjectId) return;
  documentAdoptionHydratedProjectId = expectedProjectId;
  const brief = currentPlanningBrief.value;
  if (!brief) {
    documentOptOuts.value = new Set();
    return;
  }
  const selectedIds = new Set(brief.source_asset_ids);
  const briefTime = Date.parse(brief.updated_at);
  const omittedExisting = (detail.value?.assets ?? [])
    .filter((asset) => asset.kind === "DOCUMENT" && asset.origin === "USER_UPLOAD")
    .filter((asset) => {
      const createdAt = Date.parse(asset.created_at);
      return (!Number.isFinite(briefTime) || !Number.isFinite(createdAt) || createdAt <= briefTime) && !selectedIds.has(asset.id);
    })
    .map((asset) => asset.id);
  // The latest immutable brief is the only persisted record of an earlier
  // "本次不采用" decision. Documents uploaded after that brief remain
  // adopted by default, matching the upload-as-adopted product rule.
  documentOptOuts.value = new Set(omittedExisting);
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
    workspaceMusicAssets.value = [];
    documentKnowledgeDetails.value = {};
    documentKnowledgeDetailLoading.value = new Set();
    documentOptOuts.value = new Set();
    documentAdoptionHydratedProjectId = "";
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
    await Promise.all([refreshDocuments(id), refreshProductionViews(id), refreshAudioCapabilities(id)]);
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
      await Promise.all([refreshDocuments(expectedProjectId), refreshProductionViews(expectedProjectId), refreshAudioCapabilities(expectedProjectId)]);
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

async function refreshProjectAndRelay() {
  await Promise.all([refreshCurrentProject(), refreshRelay()]);
}

async function refreshAudioCapabilities(expectedProjectId = selectedProjectId.value) {
  if (!expectedProjectId) return;
  try {
    const response = await audioCapabilities(expectedProjectId);
    if (expectedProjectId === selectedProjectId.value) {
      projectAudioCapabilities.value = response.data.capabilities;
      workspaceMusicAssets.value = (response.data.music_assets ?? []).filter((asset) => asset.kind === "AUDIO" && asset.status === "READY" && asset.metadata?.audio_role === "MUSIC");
    }
  } catch {
    if (expectedProjectId === selectedProjectId.value) {
      projectAudioCapabilities.value = [];
      workspaceMusicAssets.value = [];
    }
  }
}

async function refreshDocuments(expectedProjectId = selectedProjectId.value) {
  if (!expectedProjectId) return;
  try {
    const response = await documents(expectedProjectId);
    if (expectedProjectId === selectedProjectId.value) {
      documentConversions.value = response.data;
      hydrateDocumentAdoption(expectedProjectId);
      const activeRevisionIds = new Set(response.data
        .map((conversion) => conversion.understanding?.knowledge_revision_id)
        .filter((id): id is string => Boolean(id)));
      documentKnowledgeDetails.value = Object.fromEntries(Object.entries(documentKnowledgeDetails.value).filter(([id]) => activeRevisionIds.has(id)));
      planningDraft.sourceAssetIds = eligiblePlanningSourceIds([...planningDraft.sourceAssetIds, ...readyPlanningDocumentIds.value]);
      documentError.value = "";
    }
  } catch (error) {
    if (expectedProjectId === selectedProjectId.value) documentError.value = safeErrorMessage(error, "项目资料暂时无法读取，请稍后重试。");
  }
}

async function openDocumentDetails(knowledgeRevisionId: string) {
  const expectedProjectId = selectedProjectId.value;
  const belongsToCurrentProject = projectMaterials.value.some((item) => item.understanding?.knowledge_revision_id === knowledgeRevisionId);
  if (!expectedProjectId || !belongsToCurrentProject || documentKnowledgeDetails.value[knowledgeRevisionId]) return;
  documentKnowledgeDetailLoading.value = new Set([...documentKnowledgeDetailLoading.value, knowledgeRevisionId]);
  try {
    const response = await documentKnowledgeDetail(knowledgeRevisionId);
    if (expectedProjectId !== selectedProjectId.value || response.data.revision.project_id !== expectedProjectId) return;
    documentKnowledgeDetails.value = { ...documentKnowledgeDetails.value, [knowledgeRevisionId]: response.data };
  } catch (error) {
    if (expectedProjectId === selectedProjectId.value) documentError.value = safeErrorMessage(error, "项目要点暂时无法读取，请稍后重试。");
  } finally {
    if (expectedProjectId === selectedProjectId.value) {
      const next = new Set(documentKnowledgeDetailLoading.value);
      next.delete(knowledgeRevisionId);
      documentKnowledgeDetailLoading.value = next;
    }
  }
}

function toggleDocumentAdoption(sourceAssetId: string) {
  const item = projectMaterials.value.find((candidate) => candidate.sourceAssetId === sourceAssetId);
  if (!item) return;
  const next = new Set(documentOptOuts.value);
  if (next.has(sourceAssetId)) {
    next.delete(sourceAssetId);
    planningDraft.sourceAssetIds = eligiblePlanningSourceIds([...planningDraft.sourceAssetIds, sourceAssetId]);
  } else {
    next.add(sourceAssetId);
    planningDraft.sourceAssetIds = planningDraft.sourceAssetIds.filter((id) => id !== sourceAssetId);
  }
  documentOptOuts.value = next;
}

async function retryDocumentKnowledge(knowledgeRevisionId: string) {
  if (documentBusy.value) return;
  const item = projectMaterials.value.find((candidate) => candidate.understanding?.knowledge_revision_id === knowledgeRevisionId);
  if (!item) return;
  documentBusy.value = true;
  documentError.value = "";
  const details = { ...documentKnowledgeDetails.value };
  delete details[knowledgeRevisionId];
  documentKnowledgeDetails.value = details;
  try {
    await retryDocumentKnowledgeRevision(knowledgeRevisionId, commandKey("studio-document-understanding-retry"));
    await refreshCurrentProject();
  } catch (error) {
    documentError.value = safeErrorMessage(error, "这份资料暂时无法重新理解，请稍后重试。");
  } finally {
    documentBusy.value = false;
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
  // Resolve the source-backed audio owner immediately before creating the
  // delivery plan. Project opening also refreshes this capability, but an
  // in-flight refresh must not make a native Provider run take the
  // non-native narration approval path by accident.
  await refreshAudioCapabilities(projectId);
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

  // Keep authored line/paragraph breaks in the canonical provider_text.  The
  // OpenMontage voice path uses punctuation and provider-specific pause
  // handling; flattening all whitespace here changes the spoken rhythm before
  // the TTS provider sees the script.  Match the planner's labelled-block
  // extraction as well: users often type a paired `”... ”` boundary instead
  // of a directional `“... ”` pair, and that text is still authoritative
  // narration rather than a visual-only description.
  const normalizeNarrationText = (value: string) => value
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .trim();
  const extractQuotedNarration = (value: string) => [...value.matchAll(/“([\s\S]*?)”|”([\s\S]*?)”|「([\s\S]*?)」|『([\s\S]*?)』|"([\s\S]*?)"/gu)]
    .map((match) => normalizeNarrationText(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ""))
    .filter(Boolean);
  const labelledNarration = sourceText.match(/(?:^|\n)\s*(?:口播文案|旁白文案|配音文案|对白文案)\s*(?:为)?\s*[:：]?\s*([\s\S]*?)(?=\n\s*(?:视频生成意图描述|视频生成意图|画面描述|镜头描述|视觉描述|备注|说明)(?:\s*[:：][^\n]*)?(?:\n|$)|$)/u)?.[1];
  const labelledText = labelledNarration
    ? normalizeNarrationText(labelledNarration).replace(/^[“”「」『』"']+|[“”「」『』"']+$/gu, "").trim()
    : undefined;
  const labelledQuotes = labelledNarration ? extractQuotedNarration(labelledNarration) : [];
  const narrationTexts = labelledText
    ? (labelledQuotes.length > 0 ? labelledQuotes : [labelledText])
    : extractQuotedNarration(sourceText);
  const quotedNarrationSections = narrationTexts
    .map((text, index) => ({ id: `section_${index + 1}`, text }))
    .filter((section) => section.text.length > 0);

  const deliveryPlan = await createDeliveryPlanRevision(projectId, {
    creative_brief_revision_id: briefResponse.data.id,
    storyboard_revision_id: approved.data.id,
    duration_policy: "FLEXIBLE",
    flexible_duration_percent: 20,
    caption_policy: captionPolicy.value,
    lip_sync_requirement: "OFF",
    voice_mode: "PLATFORM_GENERIC",
    budget_limit: "0",
  }, commandKey("studio-auto-delivery-plan"));
  const approvedDeliveryPlan = deliveryPlan.data.status === "APPROVED"
    ? deliveryPlan
    : await approveDeliveryPlanRevision(deliveryPlan.data.id, commandKey("studio-auto-delivery-approve"));

  // A speech-bearing delivery uses the source-owned native provider track
  // when the current runtime profile exposes that fact.  In that case do not
  // create a platform narration script or wait for a second TTS timeline.
  // Non-native profiles retain the existing approval-gated path.
  if (!providerNativeAudioAvailable.value) {
    // A speech-bearing delivery cannot safely enter an active ProductionRun
    // until the C12.7B script/sample/timeline facts exist.  Create only the
    // normalized script draft here; server-generated sample approval and
    // TimelinePlan creation remain explicit, auditable actions in the
    // narration flow. No user-uploaded narration/sample is required.
    const narrationScripts = await narrationScriptRevisions(approvedDeliveryPlan.data.id);
    const hasApprovedNarration = narrationScripts.data.some((revision) => revision.status === "APPROVED");
    if (!hasApprovedNarration) {
      // Visual-only descriptions have no source transcript and may use the
      // existing production path. Explicit quoted dialogue still requires the
      // source-backed sample approval and measured TimelinePlan gate below.
      if (quotedNarrationSections.length > 0) {
        const createdNarration = await createNarrationScriptRevision(approvedDeliveryPlan.data.id, {
          display_sections: quotedNarrationSections,
          pronunciation_glossary: [],
          normalization_version: "c12.7b-local-v1",
        }, commandKey("studio-auto-narration-script"));
        if (createdNarration.data.status !== "APPROVED") throw new Error("NARRATION_APPROVAL_REQUIRED");
      }
    }
  }

  planningMessage.value = "AI 已开始制作视频。";
  const production = await createProductionRun(projectId, {
    storyboard_revision_id: approved.data.id,
    delivery_plan_revision_id: approvedDeliveryPlan.data.id,
    music_plan: {
      mode: musicPlan.mode,
      ...(musicPlan.mode === "MANUAL" && musicPlan.assetId ? { asset_id: musicPlan.assetId } : {}),
      ...(musicPlan.styleHint.trim() ? { style_hint: musicPlan.styleHint.trim() } : {}),
    },
  }, commandKey("studio-auto-production"));
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
      : error instanceof Error && error.message === "NARRATION_APPROVAL_REQUIRED"
        ? "已生成旁白草稿。请先试听并批准服务端生成的样音，再确认旁白时间轴，完成后才能开始视频制作。"
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
    const production = currentProductionProgress.value;
    const failedSegment = failedProductionSegment.value;
    if (production && failedSegment) {
      const response = await retryProductionSegmentCommand(production.production_run.id, failedSegment.sequence, commandKey("studio-production-segment-retry"));
      productionProgress.value = productionProgress.value.map((item) => item.production_run.id === response.data.production_run.id ? response.data : item);
    } else {
      const response = await retryTaskRun(latestTask.value.id, commandKey("studio-task-retry"));
      lastSubmittedTaskRunId.value = response.data.id;
      applyTaskRun(response.data);
    }
    await refreshCurrentProject();
  } catch (error) {
    creationError.value = safeErrorMessage(error, "这次生成暂时无法重试，请稍后再试。");
  } finally {
    creationBusy.value = false;
  }
}

function selectReferenceFiles(files: File[]) {
  referenceError.value = "";
  if (!files.length) {
    uploadFiles.value = [];
    return;
  }
  if (files.some((file) => !supportedImageTypes.has(file.type))) {
    uploadFiles.value = [];
    referenceError.value = "请选择 PNG、JPEG 或 WebP 格式的图片。";
    return;
  }
  const remainingSlots = Math.max(0, 7 - selectedReferenceIds.value.length);
  if (files.length > remainingSlots) {
    uploadFiles.value = [];
    referenceError.value = remainingSlots
      ? `本次最多还能添加 ${remainingSlots} 张参考图。`
      : "本次已选择 7 张参考图，请先取消一张再添加。";
    return;
  }
  uploadFiles.value = files;
}

function beginDeleteProject() {
  if (!detail.value || deletingProject.value) return;
  deleteNameConfirmation.value = "";
  deleteConfirmationOpen.value = true;
}

function cancelDeleteProject() {
  if (deletingProject.value) return;
  deleteNameConfirmation.value = "";
  deleteConfirmationOpen.value = false;
}

async function deleteCurrentProject() {
  const current = detail.value;
  if (!current || deleteNameConfirmation.value.trim() !== "删除" || deletingProject.value) return;
  deletingProject.value = true;
  projectError.value = "";
  try {
    await deleteProject(current.project.id, commandKey("studio-project-delete"));
    await navigateTo("/projects");
  } catch (error) {
    projectError.value = safeErrorMessage(error, "项目删除失败，项目和数据仍保留，请稍后重试。");
  } finally {
    deletingProject.value = false;
  }
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
  const files = uploadFiles.value;
  const projectIdAtStart = selectedProjectId.value;
  if (!files.length || !projectIdAtStart || creationBusy.value) return;
  creationBusy.value = true;
  referenceError.value = "";
  try {
    for (const file of files) {
      if (projectIdAtStart !== selectedProjectId.value) return;
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
      uploadFiles.value = uploadFiles.value.filter((pending) => pending !== file);
    }
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

async function retryProductionComposition() {
  const progress = currentProductionProgress.value;
  if (!progress || productionBusy.value) return;
  const allSegmentsAccepted = progress.segments.length > 0
    && progress.segments.every((segment) => segment.status === "ACCEPTED");
  if (progress.production_run.status !== "FAILED" || !allSegmentsAccepted) return;
  productionBusy.value = true;
  productionError.value = "";
  try {
    const response = await retryProductionCompositionCommand(
      progress.production_run.id,
      commandKey("studio-production-composition-retry"),
    );
    if (selectedProjectId.value === progress.production_run.project_id) {
      productionProgress.value = productionProgress.value.map((item) =>
        item.production_run.id === response.data.production_run.id ? response.data : item,
      );
    }
  } catch (error) {
    productionError.value = safeErrorMessage(error, "成片暂时无法重新合成，请稍后重试。");
  } finally {
    productionBusy.value = false;
  }
}

async function uploadMusic(file: File | undefined) {
  const projectIdAtStart = selectedProjectId.value;
  if (!file || !projectIdAtStart || productionBusy.value) return;
  if (!/^audio\/(mpeg|wav|ogg)$/.test(file.type) || file.size > 50 * 1024 * 1024) {
    productionError.value = "请选择不超过 50 MB 的 MP3、WAV 或 OGG 音乐文件。";
    return;
  }
  productionBusy.value = true;
  productionError.value = "";
  try {
    const request = await createUploadRequest(projectIdAtStart, { kind: "AUDIO", purpose: "MUSIC", filename: file.name, mime_type: file.type, byte_size: file.size }, commandKey("studio-music-upload"));
    if (!request.data.upload_url) throw new Error("Music upload is unavailable.");
    const uploaded = await fetch(request.data.upload_url, { method: "PUT", headers: request.data.headers, body: file });
    if (!uploaded.ok) throw new Error("Music upload failed.");
    await confirmAssetUpload(request.data.asset_id, { sha256: await sha256(file), mime_type: file.type, byte_size: file.size }, commandKey("studio-music-confirm"));
    musicPlan.mode = "MANUAL";
    musicPlan.assetId = request.data.asset_id;
    await refreshCurrentProject();
  } catch (error) {
    productionError.value = safeErrorMessage(error, "音乐暂时无法添加，请稍后重试。");
  } finally {
    productionBusy.value = false;
  }
}

async function importPixabayMusicAsset() {
  const projectIdAtStart = selectedProjectId.value;
  const query = pixabayQuery.value.trim();
  if (!projectIdAtStart || !query || pixabayImportBusy.value || productionBusy.value) return;
  pixabayImportBusy.value = true;
  pixabayImportError.value = "";
  try {
    const response = await importPixabayMusic(projectIdAtStart, { query }, commandKey("studio-pixabay-music-import"));
    if (selectedProjectId.value !== projectIdAtStart) return;
    musicPlan.mode = "MANUAL";
    musicPlan.assetId = response.data.asset.id;
    await refreshCurrentProject();
  } catch (error) {
    const data = typeof error === "object" && error !== null && "data" in error ? (error as { data?: unknown }).data : undefined;
    const apiError = typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
    const code = typeof apiError === "object" && apiError !== null && "code" in apiError ? (apiError as { code?: unknown }).code : undefined;
    pixabayImportError.value = code === "PROVIDER_REJECTED"
      ? "Pixabay 没有找到可用曲目，请更换搜索词。"
      : code === "PROVIDER_UNAVAILABLE"
        ? "Pixabay 暂时不可用，请稍后重试。"
        : safeErrorMessage(error, "Pixabay 音乐暂时无法导入，请稍后重试。");
  } finally {
    pixabayImportBusy.value = false;
  }
}

function selectMusicUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  void uploadMusic(file);
}

async function removeProjectAsset(assetId: string) {
  const current = detail.value;
  const asset = current?.assets.find((item) => item.id === assetId);
  if (!current || !asset) return;
  const isDocument = asset.kind === "DOCUMENT";
  if (isDocument ? documentBusy.value : creationBusy.value) return;
  if (isDocument) {
    documentBusy.value = true;
    documentError.value = "";
  } else {
    creationBusy.value = true;
    referenceError.value = "";
  }
  try {
    await deleteAsset(assetId, commandKey("studio-asset-delete"));
    if (selectedProjectId.value !== current.project.id) return;
    selectedReferenceIds.value = selectedReferenceIds.value.filter((id) => id !== assetId);
    planningDraft.sourceAssetIds = planningDraft.sourceAssetIds.filter((id) => id !== assetId);
    if (previewAssetId.value === assetId) releasePreview();
    await refreshCurrentProject();
  } catch (error) {
    const message = safeErrorMessage(error, "这份素材暂时无法删除，请稍后重试。");
    if (isDocument) documentError.value = message;
    else referenceError.value = message;
  } finally {
    if (isDocument) documentBusy.value = false;
    else creationBusy.value = false;
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
  if (relayCheckTimer !== undefined) window.clearInterval(relayCheckTimer);
  stopProjectEvents();
  releaseProjectResultPreview();
  clearForNavigation();
});
</script>
