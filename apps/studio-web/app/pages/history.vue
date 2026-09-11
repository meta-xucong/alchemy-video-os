<template>
  <section class="project-home" aria-labelledby="history-title">
    <header class="project-home-header">
      <div>
        <p class="eyebrow">生成记录</p>
        <h1 id="history-title">项目历史</h1>
        <p class="page-subtitle">
          {{ scopeLabel }}
          <span v-if="isAdmin" class="history-admin-badge">管理员视图</span>
        </p>
      </div>
      <NuxtLink class="back-link" to="/projects">返回我的项目</NuxtLink>
    </header>

    <p v-if="pageError" class="workspace-alert" role="alert">{{ pageError }}</p>

    <section v-if="loginRequired" class="project-empty surface-panel" aria-labelledby="history-login-title">
      <h2 id="history-login-title">使用 AISelf 账户登录</h2>
      <p>登录后才能读取项目历史。</p>
      <button class="command-button" type="button" @click="loginWithAiself">前往 AISelf 登录</button>
    </section>

    <section v-else-if="loading" class="project-home-loading surface-panel" aria-live="polite">
      正在读取项目历史...
    </section>

    <section v-else-if="projects.length" class="project-grid" aria-label="项目历史列表">
      <NuxtLink v-for="item in projects" :key="item.id" class="project-card" :to="`/projects/${item.id}`" :aria-label="`查看项目：${item.name}`">
        <div>
          <p class="project-card-status" :class="item.status.toLowerCase()">{{ projectStatusLabel(item.status) }}</p>
          <h2 :title="item.name">{{ item.name }}</h2>
        </div>
        <span>最近更新 {{ formatTime(item.updated_at) }}</span>
      </NuxtLink>
    </section>

    <section v-else class="project-empty surface-panel">
      <History :size="28" aria-hidden="true" />
      <h2>还没有项目历史</h2>
      <p>创建项目后，项目和生成记录会出现在这里。</p>
      <NuxtLink class="command-button" to="/projects">进入我的项目</NuxtLink>
    </section>
  </section>
</template>

<script setup lang="ts">
import { History } from "lucide-vue-next";

const { history: fetchHistory, loginWithAiself } = useControlApi();
const projects = ref<Awaited<ReturnType<typeof fetchHistory>>["data"]["projects"]>([]);
const scope = ref<"WORKSPACE" | "ALL_WORKSPACES">("WORKSPACE");
const isAdmin = ref(false);
const loading = ref(true);
const loginRequired = ref(false);
const pageError = ref("");

const scopeLabel = computed(() => scope.value === "ALL_WORKSPACES" ? "全部工作区项目" : "当前工作区项目");
const projectStatusLabel = (status: "ACTIVE" | "ARCHIVED" | "DELETED") => status === "ARCHIVED" ? "已归档" : status === "DELETED" ? "已删除" : "进行中";
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function loadHistory() {
  loading.value = true;
  loginRequired.value = false;
  pageError.value = "";
  try {
    const result = await fetchHistory();
    scope.value = result.data.scope;
    isAdmin.value = result.data.is_admin && result.data.scope === "ALL_WORKSPACES";
    projects.value = result.data.projects;
  } catch (error: any) {
    const body = error?.data ?? error?.response?._data;
    const code = body?.error?.code ?? body?.code;
    const status = Number(error?.statusCode ?? error?.response?.status ?? 0);
    if (code === "AUTH_FORBIDDEN" || status === 401 || status === 403) {
      loginRequired.value = true;
    } else {
      pageError.value = "项目历史暂时无法读取，请稍后刷新。";
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadHistory());
</script>
