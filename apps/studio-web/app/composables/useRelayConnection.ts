type RelayState = "checking" | "connected" | "disconnected" | "unavailable";

type RelayStatusResponse = {
  data?: { state?: RelayState; checked_at?: string; reconnect_available?: boolean };
};

export const useRelayConnection = () => {
  const state = useState<RelayState>("studio-relay-state", () => "checking");
  const checkedAt = useState<string | null>("studio-relay-checked-at", () => null);
  const reconnectAvailable = useState<boolean>("studio-relay-reconnect-available", () => false);
  const busy = useState<boolean>("studio-relay-busy", () => false);
  const error = useState<string | null>("studio-relay-error", () => null);

  const check = async () => {
    try {
      const response = await $fetch<RelayStatusResponse>("/api/relay/status", { cache: "no-store" });
      state.value = response.data?.state ?? "unavailable";
      checkedAt.value = response.data?.checked_at ?? new Date().toISOString();
      reconnectAvailable.value = response.data?.reconnect_available === true;
      error.value = null;
    } catch {
      state.value = "unavailable";
      checkedAt.value = new Date().toISOString();
      reconnectAvailable.value = false;
      error.value = "无法检查视频链路";
    }
  };

  const reconnect = async () => {
    if (busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      await $fetch("/api/relay/reconnect", { method: "POST" });
    } catch {
      state.value = "disconnected";
      error.value = reconnectAvailable.value ? "本地重连启动失败" : "请先启动带 SSH 凭据的本地 relay";
    } finally {
      busy.value = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await check();
  };

  const refresh = async () => {
    await check();
    if (state.value === "disconnected" && reconnectAvailable.value) {
      await reconnect();
    }
  };

  return { state, checkedAt, reconnectAvailable, busy, error, check, reconnect, refresh };
};
