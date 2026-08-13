<template>
  <section class="workspace">
    <div class="workspace-heading">
      <div>
        <p class="eyebrow">Local workspace</p>
        <h1>Content workbench</h1>
      </div>
      <button class="icon-button" type="button" title="Refresh workbench" aria-label="Refresh workbench" :disabled="loading" @click="refresh">
        <RefreshCw :size="18" :class="{ spinning: loading }" />
      </button>
    </div>

    <div class="status-row">
      <CircleDot :size="20" :class="healthState === 'ok' ? 'status-ok' : 'status-idle'" />
      <div>
        <p class="status-title">{{ statusTitle }}</p>
        <p class="status-detail">{{ statusDetail }}</p>
      </div>
    </div>

    <section class="project-panel" aria-labelledby="projects-title">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Workspace</p>
          <h2 id="projects-title">{{ workspaceName }}</h2>
          <p class="status-detail">{{ identityLabel }}</p>
        </div>
      </div>

      <form class="project-form" @submit.prevent="submitProject">
        <label for="project-name">New project</label>
        <div class="project-form-row">
          <input id="project-name" v-model="projectName" type="text" maxlength="255" placeholder="Project name" />
          <button class="command-button" type="submit" :disabled="loading || !projectName.trim()">
            <Plus :size="16" />
            <span>Create project</span>
          </button>
        </div>
      </form>

      <div v-if="projects.length" class="project-picker" role="tablist" aria-label="Projects">
        <button
          v-for="item in projects"
          :key="item.id"
          class="project-tab"
          :class="{ selected: item.id === selectedProjectId }"
          type="button"
          role="tab"
          :aria-selected="item.id === selectedProjectId"
          @click="selectProject(item.id)"
        >
          <FolderKanban :size="15" />
          <span>{{ item.name }}</span>
        </button>
      </div>
      <p v-else class="status-detail">Create a project to begin an asset and shot workspace.</p>
    </section>

    <template v-if="detail">
      <section class="workbench-grid" aria-label="Asset and shot workspace">
        <section class="project-panel asset-panel" aria-labelledby="assets-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Project assets</p>
              <h2 id="assets-title">Reference media</h2>
            </div>
            <span class="counter">{{ detail.assets.length }}</span>
          </div>

          <form class="upload-form" @submit.prevent="uploadAsset">
            <label class="file-input" for="asset-file">
              <ImagePlus :size="17" />
              <span>{{ uploadFile ? uploadFile.name : "Choose reference image" }}</span>
            </label>
            <input id="asset-file" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="onFileChange" />
            <button class="command-button" type="submit" :disabled="uploading || !uploadFile">
              <Upload :size="16" />
              <span>{{ uploading ? "Uploading" : "Upload" }}</span>
            </button>
          </form>
          <p v-if="assetError" class="status-detail error-detail">{{ assetError }}</p>

          <ul v-if="detail.assets.length" class="asset-list">
            <li v-for="asset in detail.assets" :key="asset.id" class="asset-item">
              <video v-if="previewUrls[asset.id] && asset.kind === 'VIDEO'" class="asset-preview" :src="previewUrls[asset.id]" controls preload="metadata"></video>
              <button v-else class="asset-preview" type="button" :title="mediaLabel(asset)" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                <img v-if="previewUrls[asset.id]" :src="previewUrls[asset.id]" :alt="mediaLabel(asset)" />
                <Video v-else-if="asset.kind === 'VIDEO'" :size="22" />
                <Image v-else :size="22" />
              </button>
              <div class="asset-copy">
                <strong>{{ String(asset.metadata.filename ?? thumbFallback(asset)) }}</strong>
                <span>{{ asset.status }}{{ asset.byte_size ? " - " + formatBytes(asset.byte_size) : "" }}</span>
              </div>
              <button class="icon-button" type="button" title="Preview asset" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                <Eye :size="16" />
              </button>
            </li>
          </ul>
          <p v-else class="status-detail">Uploaded files will appear here after the Control API confirms their metadata.</p>
        </section>

        <section class="project-panel shot-panel" aria-labelledby="shots-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Storyboard</p>
              <h2 id="shots-title">Shots</h2>
            </div>
            <span class="counter">{{ detail.shots.length }}</span>
          </div>

          <form class="shot-form" @submit.prevent="submitShot">
            <label for="shot-prompt">Shot brief</label>
            <textarea id="shot-prompt" v-model="shotPrompt" rows="4" maxlength="5000" placeholder="Describe the intended frame and motion."></textarea>
            <div class="reference-picker">
              <span>Reference assets</span>
              <label v-for="asset in readyReferenceAssets" :key="asset.id" class="reference-option">
                <input v-model="selectedReferenceIds" type="checkbox" :value="asset.id" />
                <span>{{ String(asset.metadata.filename ?? asset.id) }}</span>
              </label>
              <p v-if="!readyReferenceAssets.length" class="status-detail">Upload and confirm an image before adding it as a reference.</p>
            </div>
            <button class="command-button" type="submit" :disabled="savingShot || !shotPrompt.trim()">
              <Clapperboard :size="16" />
              <span>{{ editingShotId ? "Save shot" : "Create shot" }}</span>
            </button>
          </form>
          <p v-if="shotError" class="status-detail error-detail">{{ shotError }}</p>

          <ul v-if="detail.shots.length" class="shot-list">
            <li v-for="shot in detail.shots" :key="shot.id" class="shot-item">
              <button class="shot-edit" type="button" @click="editShot(shot.id)">
                <span class="shot-position">{{ shot.position + 1 }}</span>
                <span class="shot-copy">
                  <strong>{{ shot.prompt || "Untitled shot" }}</strong>
                  <span>{{ shot.status }} - revision {{ shot.revision }}</span>
                </span>
                <Pencil :size="16" />
              </button>
              <div class="shot-actions">
                <button v-if="shot.status === 'DRAFT'" class="icon-button" type="button" title="Mark shot ready" :disabled="runningShotId === shot.id" @click="markShotReady(shot.id)">
                  <Check :size="16" />
                </button>
                <button v-if="canGenerate(shot)" class="icon-button" type="button" title="Generate mock video" :disabled="runningShotId === shot.id" @click="generateShot(shot.id)">
                  <Clapperboard :size="16" />
                </button>
                <button v-if="taskForShot(shot.id)?.status === 'FAILED'" class="icon-button" type="button" title="Retry failed task" :disabled="runningShotId === shot.id" @click="retryTask(taskForShot(shot.id)!.id)">
                  <RotateCcw :size="16" />
                </button>
              </div>
              <div v-if="taskForShot(shot.id)" class="task-status" :class="taskForShot(shot.id)?.status.toLowerCase()">
                <span>{{ taskForShot(shot.id)?.status }}</span>
                <span v-if="taskForShot(shot.id)?.error">{{ taskForShot(shot.id)?.error?.message }}</span>
                <button v-if="taskForShot(shot.id)?.result_asset_id" class="icon-button" type="button" title="Preview generated video" @click="previewAsset(taskForShot(shot.id)!.result_asset_id!)">
                  <Play :size="16" />
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="status-detail">Create a shot from the current project references.</p>
        </section>
      </section>

      <section v-if="taskEvents.length" class="project-panel event-panel" aria-labelledby="events-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Task activity</p>
            <h2 id="events-title">Generation events</h2>
          </div>
          <span class="counter">{{ taskEvents.length }}</span>
        </div>
        <ul class="event-list">
          <li v-for="event in taskEvents" :key="event.id">
            <strong>{{ event.type }}</strong>
            <span>{{ event.occurredAt }}</span>
          </li>
        </ul>
      </section>
    </template>

    <p v-if="workspaceError" class="status-detail error-detail">{{ workspaceError }}</p>
  </section>
</template>

<script setup lang="ts">
import { Check, Clapperboard, CircleDot, Eye, FolderKanban, Image, ImagePlus, Pencil, Play, Plus, RefreshCw, RotateCcw, Upload, Video } from "lucide-vue-next";

import type { Asset, ProjectDetailResponse, ReferenceBindingInput, Shot, TaskRun } from "../composables/useControlApi";
import { mediaLabel, thumbFallback } from "../composables/useAssetMedia";

const { health, currentIdentity, projects: fetchProjects, project, createProject, createUploadRequest, confirmAssetUpload, assetDownloadUrl, createShot, updateShot, createGeneration, retryTaskRun } = useControlApi();
const healthState = ref<"idle" | "ok" | "error">("idle");
const statusDetail = ref("Waiting for the local control API.");
const loading = ref(false);
const workspaceError = ref("");
const assetError = ref("");
const shotError = ref("");
const projects = ref<Awaited<ReturnType<typeof fetchProjects>>["data"]>([]);
const detail = ref<ProjectDetailResponse["data"]>();
const workspaceName = ref("Workspace unavailable");
const identityLabel = ref("Identity unavailable");
const projectName = ref("");
const selectedProjectId = ref("");
const uploadFile = ref<File>();
const uploading = ref(false);
const previewUrls = ref<Record<string, string>>({});
const shotPrompt = ref("");
const selectedReferenceIds = ref<string[]>([]);
const editingShotId = ref<string>();
const savingShot = ref(false);
const runningShotId = ref<string>();
const taskEvents = ref<Array<{ id: string; type: string; occurredAt: string }>>([]);
let eventSource: EventSource | undefined;

const readyReferenceAssets = computed(() => detail.value?.assets.filter((asset) => asset.status === "READY" && asset.kind === "IMAGE") ?? []);
const statusTitle = computed(() => healthState.value === "ok" ? "Control API is available" : healthState.value === "error" ? "Control API is unavailable" : "Control API has not been checked");

const commandKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const formatBytes = (value: number) => `${Math.ceil(value / 1024)} KB`;

async function loadHealth() {
  try {
    const result = await health();
    healthState.value = result.data.status === "ok" ? "ok" : "error";
    statusDetail.value = `${result.data.service} responded with request ${result.request_id}.`;
  } catch {
    healthState.value = "error";
    statusDetail.value = "Start the local Control API and retry.";
  }
}

async function loadWorkspace() {
  workspaceError.value = "";
  try {
    const [identity, projectList] = await Promise.all([currentIdentity(), fetchProjects()]);
    workspaceName.value = identity.data.workspaces[0]?.name ?? "Workspace unavailable";
    identityLabel.value = `${identity.data.user.display_name} - ${identity.data.user.id}`;
    projects.value = projectList.data;
    if (!selectedProjectId.value && projects.value[0]) selectedProjectId.value = projects.value[0].id;
    if (selectedProjectId.value) detail.value = (await project(selectedProjectId.value)).data;
    startEventStream(identity.data.workspaces[0]?.id);
  } catch {
    workspaceError.value = "Workspace data is unavailable. Start the local Control API and retry.";
  }
}

async function refresh() {
  loading.value = true;
  await Promise.all([loadHealth(), loadWorkspace()]);
  loading.value = false;
}

async function selectProject(projectId: string) {
  selectedProjectId.value = projectId;
  assetError.value = "";
  shotError.value = "";
  editingShotId.value = undefined;
  shotPrompt.value = "";
  selectedReferenceIds.value = [];
  try {
    detail.value = (await project(projectId)).data;
  } catch {
    workspaceError.value = "Project details could not be loaded.";
  }
}

function startEventStream(workspaceId: string | undefined) {
  eventSource?.close();
  eventSource = undefined;
  if (!workspaceId || !import.meta.client) return;
  const source = new EventSource(`/api/v1/events?workspace_id=${encodeURIComponent(workspaceId)}`);
  for (const eventType of ["task_run.queued", "task_run.started", "task_run.progressed", "task_run.succeeded", "task_run.failed"]) {
    source.addEventListener(eventType, (message) => {
      const payload = JSON.parse((message as MessageEvent<string>).data) as { event_id: string; event_type: string; occurred_at: string };
      taskEvents.value = [{ id: payload.event_id, type: payload.event_type, occurredAt: payload.occurred_at }, ...taskEvents.value.filter((item) => item.id !== payload.event_id)].slice(0, 12);
      if (selectedProjectId.value) void selectProject(selectedProjectId.value);
    });
  }
  eventSource = source;
}

async function submitProject() {
  const name = projectName.value.trim();
  if (!name) return;
  loading.value = true;
  try {
    const created = await createProject(name, commandKey("studio-project"));
    projects.value = [...projects.value, created.data];
    projectName.value = "";
    await selectProject(created.data.id);
  } catch {
    workspaceError.value = "Project could not be created. Retry with a new command.";
  } finally {
    loading.value = false;
  }
}

function onFileChange(event: Event) {
  uploadFile.value = (event.target as HTMLInputElement).files?.[0];
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadAsset() {
  if (!uploadFile.value || !selectedProjectId.value) return;
  uploading.value = true;
  assetError.value = "";
  const file = uploadFile.value;
  try {
    const request = await createUploadRequest(selectedProjectId.value, {
      kind: "IMAGE",
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
    }, commandKey("studio-upload"));
    if (!request.data.upload_url) throw new Error("The asset is already confirmed.");
    const uploaded = await fetch(request.data.upload_url, { method: "PUT", headers: request.data.headers, body: file });
    if (!uploaded.ok) throw new Error("Upload failed.");
    await confirmAssetUpload(request.data.asset_id, {
      sha256: await sha256(file),
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
    }, commandKey("studio-confirm"));
    uploadFile.value = undefined;
    await selectProject(selectedProjectId.value);
  } catch {
    assetError.value = "The reference image could not be confirmed. Check the local object store and retry.";
  } finally {
    uploading.value = false;
  }
}

async function previewAsset(assetId: string) {
  try {
    const signed = await assetDownloadUrl(assetId);
    previewUrls.value = { ...previewUrls.value, [assetId]: signed.data.download_url };
  } catch {
    assetError.value = "Preview is unavailable for this asset.";
  }
}

function bindingsFor(ids: string[]): ReferenceBindingInput[] {
  return ids.map((asset_id, position) => ({ asset_id, role: position === 0 ? "STYLE" : "SUBJECT", position }));
}

function taskForShot(shotId: string): TaskRun | undefined {
  return detail.value?.task_runs.filter((taskRun) => taskRun.shot_id === shotId).at(-1);
}

function canGenerate(shot: Shot) {
  return ["READY", "GENERATED", "FAILED"].includes(shot.status);
}

async function markShotReady(shotId: string) {
  runningShotId.value = shotId;
  shotError.value = "";
  try {
    await updateShot(shotId, { status: "READY" }, commandKey("studio-shot-ready"));
    if (selectedProjectId.value) await selectProject(selectedProjectId.value);
  } catch {
    shotError.value = "The shot could not be marked ready.";
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
    if (selectedProjectId.value) await selectProject(selectedProjectId.value);
  } catch {
    shotError.value = "The video task could not be queued. Mark the shot ready and retry.";
  } finally {
    runningShotId.value = undefined;
  }
}

async function retryTask(taskRunId: string) {
  runningShotId.value = detail.value?.task_runs.find((item) => item.id === taskRunId)?.shot_id;
  shotError.value = "";
  try {
    await retryTaskRun(taskRunId, commandKey("studio-task-retry"));
    if (selectedProjectId.value) await selectProject(selectedProjectId.value);
  } catch {
    shotError.value = "The failed task could not be retried.";
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
}

async function submitShot() {
  if (!selectedProjectId.value || !shotPrompt.value.trim() || !detail.value) return;
  savingShot.value = true;
  shotError.value = "";
  const input = { prompt: shotPrompt.value.trim(), reference_bindings: bindingsFor(selectedReferenceIds.value) };
  try {
    if (editingShotId.value) {
      await updateShot(editingShotId.value, input, commandKey("studio-shot-update"));
    } else {
      await createShot(selectedProjectId.value, { ...input, position: detail.value.shots.length }, commandKey("studio-shot-create"));
    }
    editingShotId.value = undefined;
    shotPrompt.value = "";
    selectedReferenceIds.value = [];
    await selectProject(selectedProjectId.value);
  } catch {
    shotError.value = "The shot could not be saved. References must be ready assets from this project.";
  } finally {
    savingShot.value = false;
  }
}

onMounted(refresh);
onBeforeUnmount(() => eventSource?.close());
</script>
