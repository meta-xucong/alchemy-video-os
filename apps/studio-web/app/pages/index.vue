<template>
  <section class="studio-workbench" aria-label="企业视频内容工作台">
    <header class="workbench-header">
      <div class="workbench-title">
        <p class="eyebrow">视频工作台</p>
        <h1>企业内容工作台</h1>
        <p class="workbench-subtitle">{{ workspaceName }}<span v-if="identityLabel"> / {{ identityLabel }}</span></p>
      </div>
      <div class="workbench-status" aria-live="polite">
        <span class="connection-chip" :class="healthState">
          <CircleDot :size="15" />
          <span>{{ statusTitle }}</span>
        </span>
        <span class="sse-chip" :class="sseState">公开动态 {{ sseLabel }}</span>
        <button class="icon-button" type="button" title="刷新工作台" aria-label="刷新工作台" :disabled="refreshing" @click="refresh">
          <RefreshCw :size="17" :class="{ spinning: refreshing }" />
        </button>
      </div>
    </header>

    <p v-if="workspaceError" class="workspace-alert" role="alert">{{ workspaceError }}</p>

    <div class="workbench-columns">
      <aside class="project-navigator surface-panel" aria-labelledby="projects-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">工作区</p>
            <h2 id="projects-title">项目</h2>
          </div>
          <FolderKanban :size="18" aria-hidden="true" />
        </div>

        <form class="project-form" @submit.prevent="submitProject">
          <label for="project-name">新建项目</label>
          <div class="project-form-row">
            <input id="project-name" v-model="projectName" type="text" maxlength="255" placeholder="输入项目或内容计划名称" :disabled="creatingProject" />
            <button class="command-button" type="submit" :disabled="creatingProject || !projectName.trim()">
              <Plus :size="16" />
              <span>{{ creatingProject ? "创建中" : "创建项目" }}</span>
            </button>
          </div>
        </form>

        <div v-if="projects.length" class="project-list" role="tablist" aria-label="项目列表">
          <button
            v-for="item in projects"
            :key="item.id"
            class="project-tab"
            :class="{ selected: item.id === selectedProjectId }"
            type="button"
            role="tab"
            :aria-label="item.name"
            :aria-selected="item.id === selectedProjectId"
            :disabled="loadingProjectId === item.id"
            @click="selectProject(item.id)"
          >
            <span class="project-tab-copy">
              <strong>{{ item.name }}</strong>
              <small>{{ statusLabel(item.status) }}</small>
            </span>
            <span v-if="item.id === selectedProjectId" class="project-current">当前</span>
          </button>
        </div>
        <div v-else class="empty-state compact-empty">
          <FolderKanban :size="22" aria-hidden="true" />
          <p>还没有项目</p>
          <span>创建一个项目，开始本地 Mock 内容流程。</span>
        </div>
      </aside>

      <main class="storyboard-workbench surface-panel" aria-labelledby="storyboard-title">
        <template v-if="detail">
          <div class="project-summary">
            <div>
              <p class="eyebrow">当前项目</p>
              <h2 id="storyboard-title">{{ detail.project.name }}</h2>
              <p class="status-detail">{{ detail.shots.length }} 个分镜 / {{ detail.assets.length }} 个资产 / 仅本地 Mock</p>
            </div>
            <span class="project-status">{{ statusLabel(detail.project.status) }}</span>
          </div>

          <section class="composer-panel" aria-labelledby="composer-title">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">分镜</p>
                <h3 id="composer-title">{{ editingShotId ? "编辑分镜" : "新建分镜" }}</h3>
              </div>
              <span class="mock-chip">本地 Mock / 1 秒 / 160×90</span>
            </div>

            <form class="shot-form" @submit.prevent="submitShot">
              <label for="shot-prompt">分镜描述</label>
              <textarea id="shot-prompt" v-model="shotPrompt" rows="5" maxlength="5000" placeholder="描述画面内容与镜头运动。" :disabled="savingShot"></textarea>

              <fieldset class="reference-picker" :disabled="savingShot">
                <legend>参考资产</legend>
                <label v-for="asset in readyReferenceAssets" :key="asset.id" class="reference-option">
                  <input v-model="selectedReferenceIds" type="checkbox" :value="asset.id" />
                  <span>{{ assetName(asset) }}</span>
                </label>
                <p v-if="!readyReferenceAssets.length" class="field-hint">先上传并确认参考图，再绑定到分镜。</p>
              </fieldset>

              <p v-if="shotError" class="field-error" role="alert">{{ shotError }}</p>
              <div class="composer-actions">
                <button v-if="editingShotId" class="secondary-button" type="button" :disabled="savingShot" @click="cancelShotEdit">
                  <X :size="16" />
                  <span>取消编辑</span>
                </button>
                <button class="command-button" type="submit" :disabled="savingShot || !shotPrompt.trim()">
                  <Clapperboard :size="16" />
                  <span>{{ savingShot ? "保存中" : editingShotId ? "保存分镜" : "创建分镜" }}</span>
                </button>
              </div>
            </form>
          </section>

          <section class="shot-board" aria-labelledby="shot-board-title">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">分镜序列</p>
                <h3 id="shot-board-title">分镜</h3>
              </div>
              <span class="counter">{{ detail.shots.length }}</span>
            </div>

            <ul v-if="detail.shots.length" class="shot-list">
              <li v-for="shot in detail.shots" :key="shot.id" class="shot-item">
                <button class="shot-edit" type="button" :aria-label="`编辑第 ${shot.position + 1} 个分镜`" @click="editShot(shot.id)">
                  <span class="shot-position">{{ shot.position + 1 }}</span>
                  <span class="shot-copy">
                    <strong>{{ shot.prompt || "Untitled shot" }}</strong>
                    <span>第 {{ shot.revision }} 版 / {{ statusLabel(shot.status) }}</span>
                  </span>
                  <Pencil :size="16" aria-hidden="true" />
                </button>

                <div class="shot-command-row">
                  <span class="shot-state" :class="shot.status.toLowerCase()">{{ statusLabel(shot.status) }}</span>
                  <div class="shot-actions">
                    <button v-if="shot.status === 'DRAFT'" class="icon-button" type="button" title="标记为可生成" aria-label="标记为可生成" :disabled="runningShotId === shot.id" @click="markShotReady(shot.id)">
                      <Check :size="16" />
                    </button>
                    <button v-if="canGenerate(shot)" class="command-button compact-command" type="button" title="生成本地 Mock 视频" :disabled="runningShotId === shot.id" @click="generateShot(shot.id)">
                      <Clapperboard :size="15" />
                      <span>生成本地 Mock 视频</span>
                    </button>
                    <button v-if="taskForShot(shot.id)?.status === 'FAILED'" class="secondary-button compact-command" type="button" title="重试失败任务" :disabled="runningShotId === shot.id" @click="retryTask(taskForShot(shot.id)!.id)">
                      <RotateCcw :size="15" />
                      <span>重试失败任务</span>
                    </button>
                  </div>
                </div>

                <div v-if="taskForShot(shot.id)" class="task-status" :class="[taskForShot(shot.id)?.status.toLowerCase(), taskTone(taskForShot(shot.id)!)]">
                  <CircleDot :size="15" />
                  <div class="task-copy">
                    <strong>{{ statusLabel(taskForShot(shot.id)!.status) }}</strong>
                    <span>{{ taskMessage(taskForShot(shot.id)!) }}</span>
                  </div>
                  <button v-if="taskForShot(shot.id)?.result_asset_id" class="icon-button" type="button" title="预览生成视频" aria-label="预览生成视频" @click="previewAsset(taskForShot(shot.id)!.result_asset_id!)">
                    <Play :size="16" />
                  </button>
                </div>
              </li>
            </ul>
            <div v-else class="empty-state">
              <Clapperboard :size="24" aria-hidden="true" />
              <p>这个项目还没有分镜</p>
              <span>填写上方描述，保存第一个分镜。</span>
            </div>
          </section>
        </template>

        <section v-else class="empty-workbench" aria-labelledby="empty-workbench-title">
          <Clapperboard :size="30" aria-hidden="true" />
          <p class="eyebrow">本地流程</p>
          <h2 id="empty-workbench-title">创建项目后开始使用视频工作台。</h2>
          <p>选择项目后，可在这里管理参考资产、分镜、本地 Mock 任务状态、重试和播放预览。</p>
        </section>
      </main>

      <aside class="context-sidebar">
        <section class="asset-library surface-panel" aria-labelledby="assets-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">项目资产</p>
              <h2 id="assets-title">参考资产</h2>
            </div>
            <span class="counter">{{ detail?.assets.length ?? 0 }}</span>
          </div>

          <template v-if="detail">
            <form class="upload-form" @submit.prevent="uploadAsset">
              <label class="file-input" for="asset-file">
                <ImagePlus :size="17" />
                <span>{{ uploadFile ? uploadFile.name : "选择参考图片" }}</span>
              </label>
              <input :key="uploadInputVersion" id="asset-file" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="onFileChange" />
              <p class="field-hint">支持 PNG、JPEG、WebP 或 GIF，由 API 确认最终资产信息。</p>
              <button class="command-button" data-action="上传参考图" type="submit" :disabled="uploading || !uploadFile">
                <Upload :size="16" />
                <span>{{ uploadPhase === 'confirming' ? "确认中" : uploading ? "上传中" : "上传" }}</span>
              </button>
            </form>
            <p v-if="assetError" class="field-error" role="alert">{{ assetError }}</p>

            <ul v-if="detail.assets.length" class="asset-list">
              <li v-for="asset in detail.assets" :key="asset.id" class="asset-item" :class="asset.status.toLowerCase()">
                <button class="asset-thumb" type="button" :title="mediaLabel(asset)" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                  <img v-if="previewAssetId === asset.id && previewUrl && asset.kind === 'IMAGE'" :src="previewUrl" :alt="mediaLabel(asset)" />
                  <video v-else-if="previewAssetId === asset.id && previewUrl && asset.kind === 'VIDEO'" :src="previewUrl" controls preload="metadata"></video>
                  <Video v-else-if="asset.kind === 'VIDEO'" :size="21" />
                  <Image v-else :size="21" />
                </button>
                <div class="asset-copy">
                  <strong>{{ assetName(asset) }}</strong>
                  <span>{{ statusLabel(asset.status) }}{{ asset.byte_size ? " / " + formatBytes(asset.byte_size) : "" }}</span>
                </div>
                <button class="icon-button" type="button" title="预览资产" aria-label="预览资产" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                  <Eye :size="16" />
                </button>
              </li>
            </ul>
            <div v-else class="empty-state compact-empty">
              <Image :size="22" aria-hidden="true" />
              <p>还没有参考资产</p>
              <span>上传并确认参考图后，可将其绑定到分镜。</span>
            </div>
          </template>
          <div v-else class="empty-state compact-empty">
            <Image :size="22" aria-hidden="true" />
            <p>请先选择项目</p>
            <span>参考资产归属于当前项目。</span>
          </div>
        </section>

        <section class="run-activity surface-panel" aria-labelledby="events-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">公开动态</p>
              <h2 id="events-title">运行动态</h2>
            </div>
            <span class="counter">{{ taskEvents.length }}</span>
          </div>
          <ul v-if="taskEvents.length" class="event-list">
            <li v-for="event in taskEvents" :key="event.id">
              <strong>{{ eventLabel(event.type) }}</strong>
              <span>{{ formatEventTime(event.occurredAt) }}</span>
            </li>
          </ul>
          <div v-else class="empty-state compact-empty">
            <CircleDot :size="22" aria-hidden="true" />
            <p>还没有公开动态</p>
            <span>任务入队或更新后，会在这里显示公开 SSE 动态。</span>
          </div>
        </section>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="previewAssetRecord && previewUrl" class="media-dialog-backdrop" @click.self="closePreview">
        <section class="media-dialog" role="dialog" aria-modal="true" :aria-label="`预览 ${assetName(previewAssetRecord)}`">
          <div class="media-dialog-header">
            <div>
              <p class="eyebrow">资产预览</p>
              <h2>{{ assetName(previewAssetRecord) }}</h2>
            </div>
            <button class="icon-button" type="button" title="关闭预览" aria-label="关闭预览" @click="closePreview">
              <X :size="18" />
            </button>
          </div>
          <div class="media-dialog-body">
            <video v-if="previewAssetRecord.kind === 'VIDEO'" :src="previewUrl" controls autoplay preload="metadata"></video>
            <img v-else :src="previewUrl" :alt="mediaLabel(previewAssetRecord)" />
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { Check, Clapperboard, CircleDot, Eye, FolderKanban, Image, ImagePlus, Pencil, Play, Plus, RefreshCw, RotateCcw, Upload, Video, X } from "lucide-vue-next";

import type { Asset, ProjectDetailResponse, ReferenceBindingInput, Shot, TaskRun } from "../composables/useControlApi";
import { mediaLabel } from "../composables/useAssetMedia";

const { health, currentIdentity, projects: fetchProjects, project, createProject, createUploadRequest, confirmAssetUpload, assetDownloadUrl, createShot, updateShot, createGeneration, retryTaskRun } = useControlApi();

const healthState = ref<"idle" | "ok" | "error">("idle");
const refreshing = ref(false);
const creatingProject = ref(false);
const loadingProjectId = ref("");
const workspaceError = ref("");
const assetError = ref("");
const shotError = ref("");
const projects = ref<Awaited<ReturnType<typeof fetchProjects>>["data"]>([]);
const detail = ref<ProjectDetailResponse["data"]>();
const workspaceName = ref("本地工作区");
const identityLabel = ref("");
const projectName = ref("");
const selectedProjectId = ref("");
const uploadFile = ref<File>();
const uploadPhase = ref<"idle" | "requesting" | "uploading" | "confirming">("idle");
const uploadInputVersion = ref(0);
const shotPrompt = ref("");
const selectedReferenceIds = ref<string[]>([]);
const editingShotId = ref<string>();
const savingShot = ref(false);
const runningShotId = ref<string>();
const taskEvents = ref<Array<{ id: string; type: string; occurredAt: string }>>([]);
const previewAssetId = ref<string>();
const previewUrl = ref("");
const sseState = ref<"idle" | "connecting" | "connected" | "reconnecting">("idle");
let eventSource: EventSource | undefined;
let eventWorkspaceId = "";

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const activeTaskStatuses = new Set<TaskRun["status"]>(["CREATED", "QUEUED", "RUNNING", "PROCESSING", "DOWNLOADING", "BILLING_PENDING", "RETRY_SCHEDULED"]);
const statusLabels: Record<string, string> = {
  ACTIVE: "进行中",
  ARCHIVED: "已归档",
  PENDING_UPLOAD: "等待上传",
  READY: "已就绪",
  FAILED: "失败",
  DELETED: "已删除",
  DRAFT: "草稿",
  GENERATING: "生成中",
  GENERATED: "已生成",
  CREATED: "已创建",
  QUEUED: "已入队",
  RUNNING: "执行中",
  PROCESSING: "生成中",
  DOWNLOADING: "下载校验中",
  BILLING_PENDING: "等待计费",
  SUCCEEDED: "已完成",
  BILLING_FAILED: "计费失败",
  RETRY_SCHEDULED: "等待重试",
  ABANDONED: "已放弃",
  IMAGE: "图片",
  VIDEO: "视频",
  AUDIO: "音频",
  DOCUMENT: "文档",
  POSTER: "海报",
  THUMBNAIL: "缩略图",
};
const eventLabels: Record<string, string> = {
  "task_run.queued": "任务已入队",
  "task_run.started": "任务已开始",
  "task_run.progressed": "任务状态已更新",
  "task_run.succeeded": "任务已完成",
  "task_run.failed": "任务失败",
};
const errorCodeLabels: Record<string, string> = {
  AUTH_UNAVAILABLE: "本地身份服务暂时不可用，请刷新后重试。",
  AUTH_FORBIDDEN: "当前工作区没有此操作权限。",
  CREDIT_INSUFFICIENT: "可用积分不足，无法继续操作。",
  CREDIT_CONFLICT: "积分操作发生冲突，请刷新后重试。",
  CREDIT_UNAVAILABLE: "积分服务暂时不可用，请稍后重试。",
  PROVIDER_UNAVAILABLE: "视频服务暂时不可用，请稍后重试。",
  PROVIDER_REJECTED: "视频生成请求未被接受，请检查分镜后重试。",
  PROVIDER_PROTOCOL_INVALID: "视频服务返回异常，请稍后重试。",
  DOWNLOAD_INVALID: "视频结果校验失败，请重试任务。",
  IDEMPOTENCY_CONFLICT: "该操作已使用相同请求键执行，请刷新后重试。",
  WORKSPACE_FORBIDDEN: "当前工作区没有此操作权限。",
  VALIDATION_FAILED: "输入内容不符合要求，请检查后重试。",
  NOT_FOUND: "请求的项目、资产或任务不存在。",
};
const uploading = computed(() => uploadPhase.value !== "idle");
const readyReferenceAssets = computed(() => detail.value?.assets.filter((asset) => asset.status === "READY" && asset.kind === "IMAGE") ?? []);
const statusTitle = computed(() => healthState.value === "ok" ? "控制 API 正常" : healthState.value === "error" ? "控制 API 不可用" : "正在检查控制 API");
const sseLabel = computed(() => sseState.value === "connected" ? "已连接" : sseState.value === "reconnecting" ? "正在重连" : sseState.value === "connecting" ? "连接中" : "等待连接");
const previewAssetRecord = computed(() => detail.value?.assets.find((asset) => asset.id === previewAssetId.value));

const commandKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const formatBytes = (value: number) => value < 1024 ? `${value} 字节` : `${Math.ceil(value / 1024)} KB`;
const assetName = (asset: Asset) => String(asset.metadata.filename ?? `${statusLabel(asset.kind)}资产`);
const formatEventTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function statusLabel(value: string) {
  return statusLabels[value] ?? "未知状态";
}

function eventLabel(value: string) {
  return eventLabels[value] ?? "任务状态已更新";
}

function localWorkspaceLabel(value: string | undefined) {
  return value === "Default Workspace" ? "本地工作区" : value || "本地工作区";
}

function localIdentityLabel(value: string | undefined) {
  return value === "Local Developer" ? "本地开发者" : value || "";
}

function localizedPublicError(code: string | undefined, message: string | undefined, fallback: string) {
  if (code && errorCodeLabels[code]) return errorCodeLabels[code];
  if (message === "Mock video generation was configured to fail.") return "本地 Mock 视频生成按测试配置失败。";
  return fallback;
}

function safeErrorMessage(error: unknown, fallback: string) {
  const data = typeof error === "object" && error !== null && "data" in error ? (error as { data?: unknown }).data : undefined;
  const apiError = typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
  const code = typeof apiError === "object" && apiError !== null && "code" in apiError ? (apiError as { code?: unknown }).code : undefined;
  const message = typeof apiError === "object" && apiError !== null && "message" in apiError ? (apiError as { message?: unknown }).message : undefined;
  return localizedPublicError(typeof code === "string" ? code : undefined, typeof message === "string" ? message.trim() : undefined, fallback);
}

function clearComposer() {
  editingShotId.value = undefined;
  shotPrompt.value = "";
  selectedReferenceIds.value = [];
  shotError.value = "";
}

function closePreview() {
  previewAssetId.value = undefined;
  previewUrl.value = "";
}

async function loadHealth() {
  try {
    const result = await health();
    healthState.value = result.data.status === "ok" ? "ok" : "error";
  } catch {
    healthState.value = "error";
  }
}

async function loadProject(projectId: string, resetComposer = false) {
  loadingProjectId.value = projectId;
  try {
    detail.value = (await project(projectId)).data;
    selectedProjectId.value = projectId;
    if (resetComposer) clearComposer();
  } catch (error) {
    workspaceError.value = safeErrorMessage(error, "无法读取项目详情，请刷新工作台后重试。");
  } finally {
    loadingProjectId.value = "";
  }
}

async function loadWorkspace() {
  workspaceError.value = "";
  try {
    const [identity, projectList] = await Promise.all([currentIdentity(), fetchProjects()]);
    workspaceName.value = localWorkspaceLabel(identity.data.workspaces[0]?.name);
    identityLabel.value = localIdentityLabel(identity.data.user.display_name);
    projects.value = projectList.data;
    const projectId = projectList.data.some((item) => item.id === selectedProjectId.value)
      ? selectedProjectId.value
      : projectList.data[0]?.id ?? "";
    if (projectId) await loadProject(projectId);
    else {
      detail.value = undefined;
      selectedProjectId.value = "";
      clearComposer();
      closePreview();
    }
    startEventStream(identity.data.workspaces[0]?.id);
  } catch (error) {
    workspaceError.value = safeErrorMessage(error, "工作区数据暂时不可用，请确认本地控制服务已启动后刷新。");
  }
}

async function refresh() {
  refreshing.value = true;
  await Promise.all([loadHealth(), loadWorkspace()]);
  refreshing.value = false;
}

async function selectProject(projectId: string) {
  if (projectId === selectedProjectId.value && detail.value) return;
  assetError.value = "";
  closePreview();
  await loadProject(projectId, true);
}

function startEventStream(workspaceId: string | undefined) {
  if (!workspaceId || !import.meta.client) return;
  if (eventWorkspaceId === workspaceId && eventSource) return;
  eventSource?.close();
  eventWorkspaceId = workspaceId;
  sseState.value = "connecting";
  const source = new EventSource(`/api/v1/events?workspace_id=${encodeURIComponent(workspaceId)}`);
  source.onopen = () => { sseState.value = "connected"; };
  source.onerror = () => { sseState.value = "reconnecting"; };
  for (const eventType of ["task_run.queued", "task_run.started", "task_run.progressed", "task_run.succeeded", "task_run.failed"]) {
    source.addEventListener(eventType, (message) => {
      try {
        const payload = JSON.parse((message as MessageEvent<string>).data) as { event_id: string; event_type: string; occurred_at: string };
        taskEvents.value = [{ id: payload.event_id, type: payload.event_type, occurredAt: payload.occurred_at }, ...taskEvents.value.filter((item) => item.id !== payload.event_id)].slice(0, 12);
        if (selectedProjectId.value) void loadProject(selectedProjectId.value);
      } catch {
        // Invalid public SSE frames are ignored; reconnecting remains EventSource's responsibility.
      }
    });
  }
  eventSource = source;
}

async function submitProject() {
  const name = projectName.value.trim();
  if (!name) return;
  creatingProject.value = true;
  workspaceError.value = "";
  try {
    const created = await createProject(name, commandKey("studio-project"));
    projects.value = [...projects.value, created.data];
    projectName.value = "";
    await selectProject(created.data.id);
  } catch (error) {
    workspaceError.value = safeErrorMessage(error, "项目创建失败，请保留名称后重新提交。");
  } finally {
    creatingProject.value = false;
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  assetError.value = "";
  if (!file) {
    uploadFile.value = undefined;
    return;
  }
  if (!supportedImageTypes.has(file.type)) {
    uploadFile.value = undefined;
    input.value = "";
    assetError.value = "请选择 PNG、JPEG、WebP 或 GIF 格式的参考图片。";
    return;
  }
  uploadFile.value = file;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadAsset() {
  if (!uploadFile.value || !selectedProjectId.value) return;
  assetError.value = "";
  const file = uploadFile.value;
  try {
    uploadPhase.value = "requesting";
    const request = await createUploadRequest(selectedProjectId.value, {
      kind: "IMAGE",
      filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
    }, commandKey("studio-upload"));
    if (!request.data.upload_url) throw new Error();
    uploadPhase.value = "uploading";
    const uploaded = await fetch(request.data.upload_url, { method: "PUT", headers: request.data.headers, body: file });
    if (!uploaded.ok) throw new Error();
    uploadPhase.value = "confirming";
    await confirmAssetUpload(request.data.asset_id, {
      sha256: await sha256(file),
      mime_type: file.type,
      byte_size: file.size,
    }, commandKey("studio-confirm"));
    uploadFile.value = undefined;
    uploadInputVersion.value += 1;
    await loadProject(selectedProjectId.value);
  } catch (error) {
    assetError.value = safeErrorMessage(error, "参考图片确认失败，请检查本地存储服务后重试。");
  } finally {
    uploadPhase.value = "idle";
  }
}

async function previewAsset(assetId: string) {
  assetError.value = "";
  try {
    const signed = await assetDownloadUrl(assetId);
    previewAssetId.value = assetId;
    previewUrl.value = signed.data.download_url;
  } catch (error) {
    assetError.value = safeErrorMessage(error, "当前资产暂时无法预览。");
  }
}

function bindingsFor(ids: string[]): ReferenceBindingInput[] {
  return ids.map((asset_id, position) => ({ asset_id, role: position === 0 ? "STYLE" : "SUBJECT", position }));
}

function taskForShot(shotId: string): TaskRun | undefined {
  return detail.value?.task_runs
    .filter((taskRun) => taskRun.shot_id === shotId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
}

function taskTone(taskRun: TaskRun) {
  if (["FAILED", "BILLING_FAILED"].includes(taskRun.status)) return "is-error";
  if (taskRun.status === "SUCCEEDED") return "is-success";
  return "is-active";
}

function taskMessage(taskRun: TaskRun) {
  if (taskRun.error) return localizedPublicError(taskRun.error.code, taskRun.error.message, "任务处理失败，可点击重试。");
  if (taskRun.status === "SUCCEEDED") return "结果视频已就绪，可打开预览。";
  if (taskRun.status === "QUEUED") return "任务已进入队列，等待本地 Mock Worker。";
  if (taskRun.status === "RUNNING") return "本地 Mock Worker 正在执行任务。";
  if (taskRun.status === "PROCESSING") return "视频正在生成。";
  if (taskRun.status === "DOWNLOADING") return "正在下载并校验视频结果。";
  return "任务状态将通过公开动态自动更新。";
}

function canGenerate(shot: Shot) {
  const latest = taskForShot(shot.id);
  const shotCanGenerate = ["READY", "GENERATED", "FAILED"].includes(shot.status);
  return shotCanGenerate && (!latest || !activeTaskStatuses.has(latest.status));
}

async function markShotReady(shotId: string) {
  runningShotId.value = shotId;
  shotError.value = "";
  try {
    await updateShot(shotId, { status: "READY" }, commandKey("studio-shot-ready"));
    if (selectedProjectId.value) await loadProject(selectedProjectId.value);
  } catch (error) {
    shotError.value = safeErrorMessage(error, "分镜无法标记为可生成，请稍后重试。");
  } finally {
    runningShotId.value = undefined;
  }
}

async function generateShot(shotId: string) {
  const shot = detail.value?.shots.find((item) => item.id === shotId);
  if (!shot) return;
  runningShotId.value = shotId;
  shotError.value = "";
  try {
    const references = detail.value?.reference_bindings.filter((binding) => binding.shot_id === shotId).map((binding) => binding.asset_id) ?? [];
    await createGeneration(shotId, { model: "mock-video-v1", prompt: shot.prompt || "Offline mock video.", duration: 1, resolution: "160x90", ratio: "16:9", reference_asset_ids: references }, commandKey("studio-generation"));
    if (selectedProjectId.value) await loadProject(selectedProjectId.value);
  } catch (error) {
    shotError.value = safeErrorMessage(error, "视频任务无法入队，请确认分镜已标记为可生成后重试。");
  } finally {
    runningShotId.value = undefined;
  }
}

async function retryTask(taskRunId: string) {
  runningShotId.value = detail.value?.task_runs.find((item) => item.id === taskRunId)?.shot_id;
  shotError.value = "";
  try {
    await retryTaskRun(taskRunId, commandKey("studio-task-retry"));
    if (selectedProjectId.value) await loadProject(selectedProjectId.value);
  } catch (error) {
    shotError.value = safeErrorMessage(error, "失败任务暂时无法重试，请稍后再试。");
  } finally {
    runningShotId.value = undefined;
  }
}

function editShot(shotId: string) {
  const shot = detail.value?.shots.find((item) => item.id === shotId);
  if (!shot) return;
  editingShotId.value = shotId;
  shotPrompt.value = shot.prompt;
  selectedReferenceIds.value = detail.value?.reference_bindings.filter((binding) => binding.shot_id === shotId).map((binding) => binding.asset_id) ?? [];
  shotError.value = "";
}

function cancelShotEdit() {
  clearComposer();
}

async function submitShot() {
  if (!selectedProjectId.value || !shotPrompt.value.trim() || !detail.value) return;
  savingShot.value = true;
  shotError.value = "";
  const input = { prompt: shotPrompt.value.trim(), reference_bindings: bindingsFor(selectedReferenceIds.value) };
  try {
    if (editingShotId.value) await updateShot(editingShotId.value, input, commandKey("studio-shot-update"));
    else await createShot(selectedProjectId.value, { ...input, position: detail.value.shots.length }, commandKey("studio-shot-create"));
    clearComposer();
    await loadProject(selectedProjectId.value);
  } catch (error) {
    shotError.value = safeErrorMessage(error, "分镜无法保存；参考资产必须已确认且属于当前项目。");
  } finally {
    savingShot.value = false;
  }
}

onMounted(refresh);
onBeforeUnmount(() => {
  eventSource?.close();
  eventSource = undefined;
  eventWorkspaceId = "";
  closePreview();
});
</script>
