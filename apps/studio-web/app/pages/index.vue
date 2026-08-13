<template>
  <section class="workspace">
    <div class="workspace-heading">
      <div>
        <p class="eyebrow">System status</p>
        <h1>Local control plane</h1>
      </div>
      <button
        class="icon-button"
        type="button"
        title="Refresh control API status"
        aria-label="Refresh control API status"
        :disabled="loading"
        @click="loadHealth"
      >
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
        <button
          class="icon-button"
          type="button"
          title="Refresh projects"
          aria-label="Refresh projects"
          :disabled="projectsLoading"
          @click="loadWorkspace"
        >
          <RefreshCw :size="18" :class="{ spinning: projectsLoading }" />
        </button>
      </div>

      <form class="project-form" @submit.prevent="submitProject">
        <label for="project-name">New project</label>
        <div class="project-form-row">
          <input id="project-name" v-model="projectName" type="text" maxlength="255" placeholder="Project name" />
          <button class="command-button" type="submit" :disabled="projectsLoading || !projectName.trim()">
            <Plus :size="16" />
            <span>Create project</span>
          </button>
        </div>
      </form>

      <p v-if="projectsError" class="status-detail error-detail">{{ projectsError }}</p>
      <ul v-else-if="projects.length" class="project-list">
        <li v-for="project in projects" :key="project.id" class="project-item">
          <span>{{ project.name }}</span>
          <span class="project-status">{{ project.status }}</span>
        </li>
      </ul>
      <p v-else class="status-detail">No projects in this workspace.</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { CircleDot, Plus, RefreshCw } from "lucide-vue-next";

const { health, currentIdentity, projects: fetchProjects, createProject } = useControlApi();
const healthState = ref<"idle" | "ok" | "error">("idle");
const loading = ref(false);
const statusDetail = ref("Waiting for the local control API.");
const projectsLoading = ref(false);
const projectsError = ref("");
const projects = ref<Awaited<ReturnType<typeof fetchProjects>>["data"]>([]);
const workspaceName = ref("Workspace unavailable");
const identityLabel = ref("Identity unavailable");
const projectName = ref("");

const statusTitle = computed(() => {
  if (healthState.value === "ok") return "Control API is available";
  if (healthState.value === "error") return "Control API is unavailable";
  return "Control API has not been checked";
});

async function loadHealth() {
  loading.value = true;
  try {
    const result = await health();
    healthState.value = result.data.status === "ok" ? "ok" : "error";
    statusDetail.value =
      result.data.service + " responded with request " + result.request_id + ".";
  } catch {
    healthState.value = "error";
    statusDetail.value = "Start the local control API and retry.";
  } finally {
    loading.value = false;
  }
}

async function loadWorkspace() {
  projectsLoading.value = true;
  projectsError.value = "";
  try {
    const [identity, projectList] = await Promise.all([currentIdentity(), fetchProjects()]);
    workspaceName.value = identity.data.workspaces[0]?.name ?? "Workspace unavailable";
    identityLabel.value = identity.data.user.display_name + " · " + identity.data.user.id;
    projects.value = projectList.data;
  } catch {
    projectsError.value = "Workspace data is unavailable. Start the local Control API and retry.";
  } finally {
    projectsLoading.value = false;
  }
}

async function submitProject() {
  const name = projectName.value.trim();
  if (!name) return;

  projectsLoading.value = true;
  projectsError.value = "";
  try {
    const created = await createProject(name, "studio-project-" + crypto.randomUUID());
    projects.value = [...projects.value, created.data];
    projectName.value = "";
  } catch {
    projectsError.value = "Project could not be created. Retry with a new command.";
  } finally {
    projectsLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadHealth(), loadWorkspace()]);
});
</script>
