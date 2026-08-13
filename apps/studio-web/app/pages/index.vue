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
              <button class="asset-preview" type="button" :title="mediaLabel(asset)" :disabled="asset.status !== 'READY'" @click="previewAsset(asset.id)">
                <img v-if="previewUrls[asset.id]" :src="previewUrls[asset.id]" :alt="mediaLabel(asset)" />
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
              <label v-for="asset in readyAssets" :key="asset.id" class="reference-option">
                <input v-model="selectedReferenceIds" type="checkbox" :value="asset.id" />
                <span>{{ String(asset.metadata.filename ?? asset.id) }}</span>
              </label>
              <p v-if="!readyAssets.length" class="status-detail">Upload and confirm an image before adding it as a reference.</p>
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
            </li>
          </ul>
          <p v-else class="status-detail">Create a shot from the current project references.</p>
        </section>
      </section>
    </template>

    <p v-if="workspaceError" class="status-detail error-detail">{{ workspaceError }}</p>
  </section>
</template>

<script setup lang="ts">
import { Clapperboard, CircleDot, Eye, FolderKanban, Image, ImagePlus, Pencil, Plus, RefreshCw, Upload } from "lucide-vue-next";

import type { Asset, ProjectDetailResponse, ReferenceBindingInput } from "../composables/useControlApi";
import { mediaLabel, thumbFallback } from "../composables/useAssetMedia";

const { health, currentIdentity, projects: fetchProjects, project, createProject, createUploadRequest, confirmAssetUpload, assetDownloadUrl, createShot, updateShot } = useControlApi();
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

const readyAssets = computed(() => detail.value?.assets.filter((asset) => asset.status === "READY") ?? []);
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
</script>
