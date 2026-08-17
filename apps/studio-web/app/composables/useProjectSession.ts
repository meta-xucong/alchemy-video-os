import type { ProjectDetailResponse } from "./useControlApi";

type ProjectDetail = ProjectDetailResponse["data"];
type ProjectLoader = (projectId: string, signal: AbortSignal) => Promise<ProjectDetail>;

export function useProjectSession() {
  const detail = ref<ProjectDetail>();
  const selectedProjectId = ref("");
  const loading = ref(false);
  const projectError = ref("");
  const previewAssetId = ref<string>();
  const previewUrl = ref("");
  const uploadFile = shallowRef<File>();
  const selectedReferenceIds = ref<string[]>([]);
  const requestSequence = ref(0);
  let activeRequest: AbortController | undefined;

  function releasePreview() {
    if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
    previewAssetId.value = undefined;
    previewUrl.value = "";
  }

  function clearProjectState() {
    activeRequest?.abort();
    activeRequest = undefined;
    requestSequence.value += 1;
    releasePreview();
    detail.value = undefined;
    uploadFile.value = undefined;
    selectedReferenceIds.value = [];
    projectError.value = "";
  }

  async function loadProject(projectId: string, loader: ProjectLoader) {
    if (projectId !== selectedProjectId.value) {
      clearProjectState();
    } else {
      activeRequest?.abort();
      activeRequest = undefined;
      requestSequence.value += 1;
      projectError.value = "";
    }
    selectedProjectId.value = projectId;
    loading.value = true;
    const controller = new AbortController();
    activeRequest = controller;
    const sequence = ++requestSequence.value;

    try {
      const loaded = await loader(projectId, controller.signal);
      if (sequence !== requestSequence.value || selectedProjectId.value !== projectId) return;
      detail.value = loaded;
    } catch {
      if (controller.signal.aborted || sequence !== requestSequence.value) return;
      projectError.value = "项目暂时无法打开，请返回项目列表后重试。";
    } finally {
      if (sequence === requestSequence.value) loading.value = false;
    }
  }

  function replaceProjectDetail(nextDetail: ProjectDetail) {
    if (nextDetail.project.id !== selectedProjectId.value) return;
    detail.value = nextDetail;
  }

  function clearForNavigation() {
    clearProjectState();
    selectedProjectId.value = "";
  }

  return {
    detail,
    selectedProjectId,
    loading,
    projectError,
    previewAssetId,
    previewUrl,
    uploadFile,
    selectedReferenceIds,
    requestSequence,
    clearProjectState,
    clearForNavigation,
    loadProject,
    releasePreview,
    replaceProjectDetail,
  };
}
