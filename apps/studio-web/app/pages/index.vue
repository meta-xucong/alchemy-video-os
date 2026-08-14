<template>
  <section class="studio-workbench" aria-label="Video Studio workbench">
    <header class="workbench-header">
      <div class="workbench-title">
        <p class="eyebrow">Video studio</p>
        <h1>Production workbench</h1>
        <p class="workbench-subtitle">{{ workspaceName }}<span v-if="identityLabel"> / {{ identityLabel }}</span></p>
      </div>
      <div class="workbench-status" aria-live="polite">
        <span class="connection-chip" :class="healthState">
          <CircleDot :size="15" />
          <span>{{ statusTitle }}</span>
        </span>
        <span class="sse-chip" :class="sseState">SSE {{ sseLabel }}</span>
        <button class="icon-button" type="button" title="Refresh workbench" aria-label="Refresh workbench" :disabled="refreshing" @click="refresh">
          <RefreshCw :size="17" :class="{ spinning: refreshing }" />
        </button>
      </div>
    </header>

    <p v-if="workspaceError" class="workspace-alert" role="alert">{{ workspaceError }}</p>

    <div class="workbench-columns">
      <aside class="project-navigator surface-panel" aria-labelledby="projects-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Workspace</p>
            <h2 id="projects-title">Projects</h2>
          </div>
          <FolderKanban :size="18" aria-hidden="true" />
        </div>

        <form class="project-form" @submit.prevent="submitProject">
          <label for="project-name">New project</label>
          <div class="project-form-row">
            <input id="project-name" v-model="projectName" type="text" maxlength="255" placeholder="Campaign or content initiative" :disabled="creatingProject" />
            <button class="command-button" type="submit" :disabled="creatingProject || !projectName.trim()">
              <Plus :size="16" />
              <span>{{ creatingProject ? "Creating" : "Create project" }}</span>
            </button>
          </div>
        </form>

        <div v-if="projects.length" class="project-list" role="tablist" aria-label="Projects">
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
              <small>{{ item.status }}</small>
            </span>
            <span v-if="item.id === selectedProjectId" class="project-current">Current</span>
          </button>
        </div>
        <div v-else class="empty-state compact-empty">
          <FolderKanban :size="22" aria-hidden="true" />
          <p>No projects yet.</p>
          <span>Create a project to start the local Mock workflow.</span>
        </div>
      </aside>

      <main class="storyboard-workbench surface-panel" aria-labelledby="storyboard-title">
        <template v-if="detail">
          <div class="project-summary">
            <div>
              <p class="eyebrow">Current project</p>
              <h2 id="storyboard-title">{{ detail.project.name }}</h2>
              <p class="status-detail">{{ detail.shots.length }} shots / {{ detail.assets.length }} assets / local Mock only</p>
            </div>
            <span class="project-status">{{ detail.project.status }}</span>
          </div>

          <section class="composer-panel" aria-labelledby="composer-title">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Storyboard</p>
                <h3 id="composer-title">{{ editingShotId ? "Edit shot" : "New shot" }}</h3>
              </div>
              <span class="mock-chip">Mock / 1s / 160x90</span>
            </div>

            <form class="shot-form" @submit.prevent="submitShot">
              <label for="shot-prompt">Shot brief</label>
              <textarea id="shot-prompt" v-model="shotPrompt" rows="5" maxlength="5000" placeholder="Describe the intended frame and motion." :disabled="savingShot"></textarea>

              <fieldset class="reference-picker" :disabled="savingShot">
                <legend>Reference assets</legend>
                <label v-for="asset in readyReferenceAssets" :key="asset.id" class="reference-option">
                  <input v-model="selectedReferenceIds" type="checkbox" :value="asset.id" />
                  <span>{{ assetName(asset) }}</span>
                </label>
                <p v-if="!readyReferenceAssets.length" class="field-hint">Upload and confirm an image before binding it to a shot.</p>
              </fieldset>

              <p v-if="shotError" class="field-error" role="alert">{{ shotError }}</p>
              <div class="composer-actions">
                <button v-if="editingShotId" class="secondary-button" type="button" :disabled="savingShot" @click="cancelShotEdit">
                  <X :size="16" />
                  <span>Cancel shot edit</span>
                </button>
                <button class="command-button" type="submit" :disabled="savingShot || !shotPrompt.trim()">
                  <Clapperboard :size="16" />
                  <span>{{ savingShot ? "Saving" : editingShotId ? "Save shot" : "Create shot" }}</span>
                </button>
              </div>
            </form>
          </section>

          <section class="shot-board" aria-labelledby="shot-board-title">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Sequence</p>
                <h3 id="shot-board-title">Shots</h3>
              </div>
              <span class="counter">{{ detail.shots.length }}</span>
            </div>

            <ul v-if="detail.shots.length" class="shot-list">
              <li v-for="shot in detail.shots" :key="shot.id" class="shot-item">
                <button class="shot-edit" type="button" :aria-label="`Edit shot ${shot.position + 1}`" @click="editShot(shot.id)">
                  <span class="shot-position">{{ shot.position + 1 }}</span>
                  <span class="shot-copy">
                    <strong>{{ shot.prompt || "Untitled shot" }}</strong>
                    <span>Revision {{ shot.revision }} / {{ shot.status }}</span>
                  </span>
                  <Pencil :size="16" aria-hidden="true" />
                </button>

                <div class="shot-command-row">
                  <span class="shot-state" :class="shot.status.toLowerCase()">{{ shot.status }}</span>
                  <div class="shot-actions">
                    <button v-if="shot.status === 'DRAFT'" class="icon-button" type="button" title="Mark shot ready" :disabled="runningShotId === shot.id" @click="markShotReady(shot.id)">
                      <Check :size="16" />
                    </button>
                    <button v-if="canGenerate(shot)" class="command-button compact-command" type="button" title="Generate mock video" :disabled="runningShotId === shot.id" @click="generateShot(shot.id)">
                      <Clapperboard :size="15" />
                      <span>Generate mock video</span>
                    </button>
                    <button v-if="taskForShot(shot.id)?.status === 'FAILED'" class="secondary-button compact-command" type="button" title="Retry failed task" :disabled="runningShotId === shot.id" @click="retryTask(taskForShot(shot.id)!.id)">
                      <RotateCcw :size="15" />
                      <span>Retry failed task</span>
                    </button>
                  </div>
                </div>

                <div v-if="taskForShot(shot.id)" class="task-status" :class="[taskForShot(shot.id)?.status.toLowerCase(), taskTone(taskForShot(shot.id)!)]">
                  <CircleDot :size="15" />
                  <div class="task-copy">
                    <strong>{{ taskForShot(shot.id)?.status }}</strong>
                    <span>{{ taskMessage(taskForShot(shot.id)!) }}</span>
                  </div>
                  <button v-if="taskForShot(shot.id)?.result_asset_id" class="icon-button" type="button" title="Preview generated video" aria-label="Preview generated video" @click="previewAsset(taskForShot(shot.id)!.result_asset_id!)">
                    <Play :size="16" />
                  </button>
                </div>
              </li>
            </ul>
            <div v-else class="empty-state">
              <Clapperboard :size="24" aria-hidden="true" />
              <p>No shots in this project.</p>
              <span>Write a brief above, then save the first storyboard shot.</span>
            </div>
          </section>
        </template>

        <section v-else class="empty-workbench" aria-labelledby="empty-workbench-title">
          <Clapperboard :size="30" aria-hidden="true" />
          <p class="eyebrow">Local workflow</p>
          <h2 id="empty-workbench-title">Create a project to open the video workbench.</h2>
          <p>Reference assets, storyboard shots, Mock task status, retry and playback appear here after a project is selected.</p>
        </section>
      </main>

      <aside class="context-sidebar">
        <section class="asset-library surface-panel" aria-labelledby="assets-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Project assets</p>
              <h2 id="assets-title">Reference assets</h2>
            </div>
            <span class="counter">{{ detail?.assets.length ?? 0 }}</span>
          </div>

          <template v-if="detail">
            <form class="upload-form" @submit.prevent="uploadAsset">
              <label class="file-input" for="asset-file">
                <ImagePlus :size="17" />
                <span>{{ uploadFile ? uploadFile.name : "Choose reference image" }}</span>
              </label>
              <input :key="uploadInputVersion" id="asset-file" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="onFileChange" />
              <p class="field-hint">PNG, JPEG, WebP or GIF. The API confirms the final asset metadata.</p>
              <button class="command-button" data-action="Upload reference" type="submit" :disabled="uploading || !uploadFile">
                <Upload :size="16" />
                <span>{{ uploadPhase === 'confirming' ? "Confirming" : uploading ? "Uploading" : "Upload" }}</span>
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
                  <span>{{ asset.status }}{{ asset.byte_size ? " / " + formatBytes(asset.byte_size) : "" }}</span>
                </div>
                <button class="icon-button" type="button" title="Preview asset" aria-label="Preview asset" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                  <Eye :size="16" />
                </button>
              </li>
            </ul>
            <div v-else class="empty-state compact-empty">
              <Image :size="22" aria-hidden="true" />
              <p>No reference assets.</p>
              <span>Upload and confirm an image to make it available to a shot.</span>
            </div>
          </template>
          <div v-else class="empty-state compact-empty">
            <Image :size="22" aria-hidden="true" />
            <p>Select a project first.</p>
            <span>Reference uploads belong to the active project.</span>
          </div>
        </section>

        <section class="run-activity surface-panel" aria-labelledby="events-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Public events</p>
              <h2 id="events-title">Run activity</h2>
            </div>
            <span class="counter">{{ taskEvents.length }}</span>
          </div>
          <ul v-if="taskEvents.length" class="event-list">
            <li v-for="event in taskEvents" :key="event.id">
              <strong>{{ event.type }}</strong>
              <span>{{ formatEventTime(event.occurredAt) }}</span>
            </li>
          </ul>
          <div v-else class="empty-state compact-empty">
            <CircleDot :size="22" aria-hidden="true" />
            <p>No public activity yet.</p>
            <span>SSE events appear after a task is queued or updated.</span>
          </div>
        </section>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="previewAssetRecord && previewUrl" class="media-dialog-backdrop" @click.self="closePreview">
        <section class="media-dialog" role="dialog" aria-modal="true" :aria-label="`Preview ${assetName(previewAssetRecord)}`">
          <div class="media-dialog-header">
            <div>
              <p class="eyebrow">Asset preview</p>
              <h2>{{ assetName(previewAssetRecord) }}</h2>
            </div>
            <button class="icon-button" type="button" title="Close preview" aria-label="Close preview" @click="closePreview">
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
const workspaceName = ref("Local workspace");
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
const uploading = computed(() => uploadPhase.value !== "idle");
const readyReferenceAssets = computed(() => detail.value?.assets.filter((asset) => asset.status === "READY" && asset.kind === "IMAGE") ?? []);
const statusTitle = computed(() => healthState.value === "ok" ? "Control API is available" : healthState.value === "error" ? "Control API is unavailable" : "Checking local Control API");
const sseLabel = computed(() => sseState.value === "connected" ? "connected" : sseState.value === "reconnecting" ? "reconnecting" : sseState.value === "connecting" ? "connecting" : "waiting");
const previewAssetRecord = computed(() => detail.value?.assets.find((asset) => asset.id === previewAssetId.value));

const commandKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const formatBytes = (value: number) => value < 1024 ? `${value} B` : `${Math.ceil(value / 1024)} KB`;
const assetName = (asset: Asset) => String(asset.metadata.filename ?? `${asset.kind.toLowerCase()} asset`);
const formatEventTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function safeErrorMessage(error: unknown, fallback: string) {
  const data = typeof error === "object" && error !== null && "data" in error ? (error as { data?: unknown }).data : undefined;
  const apiError = typeof data === "object" && data !== null && "error" in data ? (data as { error?: unknown }).error : undefined;
  const message = typeof apiError === "object" && apiError !== null && "message" in apiError ? (apiError as { message?: unknown }).message : undefined;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
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
    workspaceError.value = safeErrorMessage(error, "Project details could not be loaded. Refresh the workbench and try again.");
  } finally {
    loadingProjectId.value = "";
  }
}

async function loadWorkspace() {
  workspaceError.value = "";
  try {
    const [identity, projectList] = await Promise.all([currentIdentity(), fetchProjects()]);
    workspaceName.value = identity.data.workspaces[0]?.name ?? "Local workspace";
    identityLabel.value = identity.data.user.display_name;
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
    workspaceError.value = safeErrorMessage(error, "Workspace data is unavailable. Start the local Control API and refresh.");
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
    workspaceError.value = safeErrorMessage(error, "Project could not be created. Keep the name and retry with a new command.");
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
    assetError.value = "Choose a PNG, JPEG, WebP, or GIF reference image.";
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
    assetError.value = safeErrorMessage(error, "The reference image could not be confirmed. Check the local object store and retry.");
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
    assetError.value = safeErrorMessage(error, "Preview is unavailable for this asset.");
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
  if (taskRun.error?.message) return taskRun.error.message;
  if (taskRun.status === "SUCCEEDED") return "Result asset is ready for preview.";
  if (taskRun.status === "QUEUED") return "Waiting for the local Mock worker.";
  return "The local task state updates through public SSE.";
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
    shotError.value = safeErrorMessage(error, "The shot could not be marked ready.");
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
    shotError.value = safeErrorMessage(error, "The video task could not be queued. Mark the shot ready and retry.");
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
    shotError.value = safeErrorMessage(error, "The failed task could not be retried.");
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
    shotError.value = safeErrorMessage(error, "The shot could not be saved. References must be ready assets from this project.");
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
