import type { Ref } from "vue";

type PublicProjectEvent = {
  event_id: string;
  workspace_id: string;
  project_id?: string;
};

type ProjectEventOptions = {
  workspaceId: Readonly<Ref<string | undefined>>;
  selectedProjectId: Readonly<Ref<string>>;
  onCurrentProjectEvent: () => void;
};

const eventTypes = [
  "asset.upload.confirmed",
  "shot.updated",
  "task_run.queued",
  "task_run.started",
  "task_run.progressed",
  "task_run.succeeded",
  "task_run.failed",
  "document_conversion.queued",
  "document_conversion.started",
  "document_conversion.succeeded",
  "document_conversion.failed",
  "creative_brief.planning_requested",
  "creative_brief.planning_failed",
  "storyboard_revision.ready_for_review",
  "storyboard_revision.approved",
  "production_run.confirmed",
  "production_run.progressed",
  "production_run.blocked",
  "qc_report.completed",
  "video_version.succeeded",
  "video_version.failed",
];

export function useProjectEvents({ workspaceId, selectedProjectId, onCurrentProjectEvent }: ProjectEventOptions) {
  const connectionState = ref<"idle" | "connecting" | "ready" | "reconnecting">("idle");
  const lastEventId = ref("");
  let eventSource: EventSource | undefined;
  let activeWorkspaceId = "";
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleCurrentProjectRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      onCurrentProjectEvent();
    }, 180);
  }

  function stop() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    eventSource?.close();
    eventSource = undefined;
    activeWorkspaceId = "";
    connectionState.value = "idle";
  }

  function start() {
    const nextWorkspaceId = workspaceId.value;
    if (!import.meta.client || !nextWorkspaceId) {
      stop();
      return;
    }
    if (eventSource && activeWorkspaceId === nextWorkspaceId) return;

    stop();
    activeWorkspaceId = nextWorkspaceId;
    connectionState.value = "connecting";
    const source = new EventSource(`/api/v1/events?workspace_id=${encodeURIComponent(nextWorkspaceId)}`);
    source.onopen = () => { connectionState.value = "ready"; };
    source.onerror = () => { connectionState.value = "reconnecting"; };

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (message) => {
        try {
          const payload = JSON.parse((message as MessageEvent<string>).data) as PublicProjectEvent;
          if (payload.workspace_id !== workspaceId.value || payload.project_id !== selectedProjectId.value) return;
          lastEventId.value = payload.event_id;
          scheduleCurrentProjectRefresh();
        } catch {
          // EventSource reconnects malformed frames without allowing them to affect the current project projection.
        }
      });
    }
    eventSource = source;
  }

  watch(workspaceId, start, { immediate: true });
  onBeforeUnmount(stop);

  return { connectionState, lastEventId, start, stop };
}
