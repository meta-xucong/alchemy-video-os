<template>
  <div class="app-shell">
    <header class="app-header">
      <NuxtLink class="brand" to="/" aria-label="AI 企业内容生产平台首页">
        <Clapperboard :size="20" :stroke-width="1.8" />
        <span>AI 企业内容生产平台</span>
      </NuxtLink>
      <div class="app-header-actions">
        <span class="environment">本地工作台</span>
        <template v-if="account.loading">
          <span class="account-status" aria-live="polite">正在读取账户</span>
        </template>
        <template v-else-if="account.loginRequired">
          <button class="text-button account-login" type="button" @click="loginWithAiself">登录 AISelf</button>
        </template>
        <template v-else>
          <details class="account-menu">
            <summary class="account-menu-trigger" aria-label="打开账户信息">
              <span class="account-avatar" aria-hidden="true">{{ account.avatarLabel }}</span>
              <span class="account-menu-copy">
                <span class="account-user">{{ account.email || account.displayName }}</span>
                <span class="account-credit">
                  {{ account.credits ? `积分 ${account.credits.balance}` : (account.error ? "账户暂不可用" : "积分暂不可用") }}
                </span>
              </span>
              <span class="account-menu-caret" aria-hidden="true">⌄</span>
            </summary>
            <div class="account-popover">
              <div class="account-popover-heading">
                <div>
                  <p class="eyebrow">AISelf ACCOUNT</p>
                  <strong>{{ account.email || account.displayName }}</strong>
                </div>
                <span v-if="account.isAdmin" class="account-role">管理员</span>
              </div>
              <dl class="account-details">
                <div><dt>账户状态</dt><dd>{{ account.credits?.status ?? (account.error ? "暂不可用" : "已登录") }}</dd></div>
                <div><dt>角色</dt><dd>{{ account.credits?.role ?? (account.isAdmin ? "admin" : "user") }}</dd></div>
                <div><dt>积分余额</dt><dd>{{ account.credits?.balance ?? "—" }}</dd></div>
                <div><dt>并发额度</dt><dd>{{ account.credits?.concurrency ?? "—" }}</dd></div>
              </dl>
              <div class="account-popover-actions">
                <NuxtLink class="account-history-link" to="/history">
                  <History :size="15" />
                  <span>项目历史</span>
                </NuxtLink>
                <NuxtLink class="account-history-link" to="/settings/billing">
                  <Settings :size="15" />
                  <span>计费配置</span>
                </NuxtLink>
                <button class="text-button account-logout" type="button" @click="signOut">退出 AISelf</button>
              </div>
            </div>
          </details>
        </template>
      </div>
    </header>
    <main class="app-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { Clapperboard, History, Settings } from "lucide-vue-next";

const { currentIdentity, history: fetchHistory, credits: fetchCredits, loginWithAiself, logout } = useControlApi();
const account = reactive<{
  loading: boolean;
  loginRequired: boolean;
  displayName: string;
  email: string;
  avatarLabel: string;
  isAdmin: boolean;
  credits: Awaited<ReturnType<typeof fetchCredits>>["data"] | null;
  error: boolean;
}>({
  loading: true,
  loginRequired: false,
  displayName: "",
  email: "",
  avatarLabel: "A",
  isAdmin: false,
  credits: null,
  error: false,
});

const isAuthRequired = (error: any) => {
  const body = error?.data ?? error?.response?._data;
  const code = body?.error?.code ?? body?.code;
  const status = Number(error?.statusCode ?? error?.response?.status ?? 0);
  return code === "AUTH_FORBIDDEN" || status === 401 || status === 403;
};

async function loadAccount() {
  account.loading = true;
  account.loginRequired = false;
  account.error = false;
  try {
    const identity = await currentIdentity();
    account.displayName = identity.data.user.display_name;
    account.email = identity.data.user.display_name;
    account.avatarLabel = (account.email.trim().slice(0, 1) || "A").toUpperCase();
    try {
      const historyResponse = await fetchHistory();
      account.isAdmin = historyResponse.data.is_admin && historyResponse.data.scope === "ALL_WORKSPACES";
    } catch {
      account.isAdmin = false;
      account.error = true;
    }
    try {
      account.credits = (await fetchCredits()).data;
      account.email = account.credits.email || account.email;
      account.avatarLabel = (account.email.trim().slice(0, 1) || "A").toUpperCase();
    } catch {
      account.credits = null;
      account.error = true;
    }
  } catch (error) {
    if (isAuthRequired(error)) {
      account.loginRequired = true;
      // Match Alchemy's Portal handoff: an existing AISelf session is
      // converted into a one-time Video ticket without asking for a second
      // password. The visible button remains the fallback if navigation is
      // blocked by the browser or the Portal is unavailable.
      if (typeof window !== "undefined") loginWithAiself();
    } else {
      account.error = true;
    }
  } finally {
    account.loading = false;
  }
}

async function signOut() {
  await logout().catch(() => undefined);
  await navigateTo("/projects", { replace: true });
}

onMounted(() => void loadAccount());
</script>
