<template>
  <section class="project-home" aria-labelledby="project-home-title">
    <header class="project-home-header">
      <div>
        <p class="eyebrow">视频创作</p>
        <h1 id="project-home-title">我的项目</h1>
        <p class="page-subtitle">{{ workspaceName }}</p>
      </div>
      <div class="project-home-actions">
        <button v-if="!loginRequired" class="command-button" type="button" :disabled="showCreate" @click="showCreate = true">
          <Plus :size="17" />
          <span>新建项目</span>
        </button>
        <button v-if="!loginRequired && identityLoaded" class="text-button" type="button" @click="signOut">退出 AISelf</button>
      </div>
    </header>

    <p v-if="pageError" class="workspace-alert" role="alert">{{ pageError }}</p>

    <section v-if="loginRequired" class="project-empty surface-panel" aria-labelledby="video-login-title">
      <h2 id="video-login-title">使用 AISelf 账户登录</h2>
      <p>视频工作台不再使用独立的用户名和密码。登录后会回到当前 Video OS。</p>
      <button class="command-button" type="button" @click="loginWithAiself">前往 AISelf 登录</button>
    </section>

    <template v-else>
    <form v-if="showCreate" class="project-create-form surface-panel" @submit.prevent="submitProject">
      <div>
        <p class="eyebrow">新项目</p>
        <label for="new-project-name">给这项创作起个名字</label>
      </div>
      <div class="project-create-actions">
        <input id="new-project-name" v-model="projectName" maxlength="255" placeholder="例如：春季新品短片" :disabled="creatingProject" autofocus />
        <button class="command-button" type="submit" :disabled="creatingProject || !projectName.trim()">
          <span>{{ creatingProject ? "正在创建" : "创建并进入" }}</span>
        </button>
        <button class="text-button" type="button" :disabled="creatingProject" @click="cancelCreate">取消</button>
      </div>
    </form>

    <section v-else-if="loading" class="project-home-loading surface-panel" aria-live="polite">
      正在读取项目...
    </section>

    <section v-else-if="projects.length" class="project-grid" aria-label="项目列表">
      <NuxtLink v-for="item in projects" :key="item.id" class="project-card" :to="`/projects/${item.id}`" :aria-label="`进入项目：${item.name}`">
        <div>
          <p class="project-card-status" :class="item.status.toLowerCase()">{{ projectStatusLabel(item.status) }}</p>
          <h2 :title="item.name">{{ item.name }}</h2>
        </div>
        <span>最近更新 {{ formatTime(item.updated_at) }}</span>
      </NuxtLink>
    </section>

    <section v-else class="project-empty surface-panel">
      <FolderPlus :size="28" aria-hidden="true" />
      <h2>从一个视频想法开始</h2>
      <p>先新建一个项目，想法、参考图和生成结果都会保留在这里。</p>
      <button class="command-button" type="button" @click="showCreate = true">
        <Plus :size="17" />
        <span>新建项目</span>
      </button>
    </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { FolderPlus, Plus } from "lucide-vue-next";

const { currentIdentity, projects: fetchProjects, createProject, loginWithAiself, logout } = useControlApi();
const projects = ref<Awaited<ReturnType<typeof fetchProjects>>["data"]>([]);
const workspaceName = ref("我的创作空间");
const projectName = ref("");
const pageError = ref("");
const loading = ref(true);
const identityLoaded = ref(false);
const loginRequired = ref(false);
const showCreate = ref(false);
const creatingProject = ref(false);

const commandKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const projectStatusLabel = (status: "ACTIVE" | "ARCHIVED" | "DELETED") => status === "ARCHIVED" ? "已归档" : status === "DELETED" ? "已删除" : "进行中";
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function loadProjects() {
  loading.value = true;
  pageError.value = "";
  loginRequired.value = false;
  identityLoaded.value = false;
  try {
    const [identity, list] = await Promise.all([currentIdentity(), fetchProjects()]);
    identityLoaded.value = true;
    workspaceName.value = identity.data.workspaces[0]?.name === "Default Workspace" ? "我的创作空间" : identity.data.workspaces[0]?.name ?? "我的创作空间";
    projects.value = list.data;
  } catch (error: any) {
    const body = error?.data ?? error?.response?._data;
    const code = body?.error?.code ?? body?.code;
    const status = Number(error?.statusCode ?? error?.response?.status ?? 0);
    if (code === "AUTH_FORBIDDEN" || status === 401 || status === 403) {
      loginRequired.value = true;
    } else {
      pageError.value = "项目暂时无法读取，请确认本地服务已启动后刷新页面。";
    }
  } finally {
    loading.value = false;
  }
}

async function signOut() {
  await logout().catch(() => undefined);
  await navigateTo("/projects", { replace: true });
}

function cancelCreate() {
  projectName.value = "";
  showCreate.value = false;
}

async function submitProject() {
  const name = projectName.value.trim();
  if (!name) return;
  creatingProject.value = true;
  pageError.value = "";
  try {
    const created = await createProject(name, commandKey("studio-project"));
    await navigateTo(`/projects/${created.data.id}`);
  } catch {
    pageError.value = "项目创建失败，请保留名称后重新提交。";
  } finally {
    creatingProject.value = false;
  }
}

onMounted(() => void loadProjects());
</script>
