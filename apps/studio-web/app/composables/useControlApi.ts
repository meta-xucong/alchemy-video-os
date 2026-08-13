export type HealthStatus = {
  data: {
    service: string;
    status: string;
    build_version: string;
    dependencies: { database: "ok" | "unavailable" | "not_configured" };
  };
  request_id: string;
};

export type Workspace = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type Asset = {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "POSTER" | "THUMBNAIL";
  origin: "USER_UPLOAD" | "GENERATED" | "DERIVED";
  status: "PENDING_UPLOAD" | "READY" | "FAILED" | "DELETED";
  sha256: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Shot = {
  id: string;
  workspace_id: string;
  project_id: string;
  position: number;
  prompt: string;
  model: string | null;
  generation_settings: Record<string, unknown>;
  status: "DRAFT" | "READY" | "GENERATING" | "GENERATED" | "FAILED" | "ARCHIVED";
  selected_asset_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type ReferenceBindingInput = {
  asset_id: string;
  role: "STYLE" | "SUBJECT" | "FIRST_FRAME" | "LAST_FRAME";
  position: number;
};

export type ReferenceBinding = ReferenceBindingInput & { shot_id: string; created_at: string };

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  created_at: string;
  updated_at: string;
};

export type CurrentIdentity = {
  data: {
    user: { id: string; display_name: string; status: "ACTIVE" | "DISABLED"; created_at: string; updated_at: string };
    workspaces: Workspace[];
  };
  request_id: string;
};

export type ProjectList = { data: Project[]; request_id: string };
export type ProjectResponse = { data: Project; request_id: string };
export type ProjectDetailResponse = {
  data: { project: Project; assets: Asset[]; shots: Shot[]; reference_bindings: ReferenceBinding[] };
  request_id: string;
};
export type AssetResponse = { data: Asset; request_id: string };
export type ShotResponse = { data: Shot; request_id: string };
export type UploadRequestResponse = {
  data: { asset_id: string; upload_url: string | null; headers: Record<string, string>; expires_at: string | null };
  request_id: string;
};
export type DownloadUrlResponse = { data: { download_url: string; expires_at: string }; request_id: string };

const commandHeaders = (idempotencyKey: string) => ({
  "Content-Type": "application/json",
  "Idempotency-Key": idempotencyKey,
});

export function useControlApi() {
  const health = () => $fetch<HealthStatus>("/api/v1/health");
  const currentIdentity = () => $fetch<CurrentIdentity>("/api/v1/me");
  const projects = () => $fetch<ProjectList>("/api/v1/projects");
  const project = (projectId: string) => $fetch<ProjectDetailResponse>(`/api/v1/projects/${projectId}`);

  const createProject = (name: string, idempotencyKey: string) =>
    $fetch<ProjectResponse>("/api/v1/projects", { method: "POST", headers: commandHeaders(idempotencyKey), body: { name } });

  const createUploadRequest = (projectId: string, input: { kind: "IMAGE" | "AUDIO" | "DOCUMENT"; filename: string; mime_type: string; byte_size: number }, idempotencyKey: string) =>
    $fetch<UploadRequestResponse>(`/api/v1/projects/${projectId}/assets/upload-requests`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const confirmAssetUpload = (assetId: string, input: { sha256: string; mime_type: string; byte_size: number }, idempotencyKey: string) =>
    $fetch<AssetResponse>(`/api/v1/assets/${assetId}/confirm-upload`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const assetDownloadUrl = (assetId: string) => $fetch<DownloadUrlResponse>(`/api/v1/assets/${assetId}/download-url`);

  const createShot = (projectId: string, input: { position: number; prompt: string; reference_bindings: ReferenceBindingInput[] }, idempotencyKey: string) =>
    $fetch<ShotResponse>(`/api/v1/projects/${projectId}/shots`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const updateShot = (shotId: string, input: { prompt?: string; position?: number; status?: "DRAFT" | "READY" | "ARCHIVED"; reference_bindings?: ReferenceBindingInput[] }, idempotencyKey: string) =>
    $fetch<ShotResponse>(`/api/v1/shots/${shotId}`, {
      method: "PATCH",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  return {
    health,
    currentIdentity,
    projects,
    project,
    createProject,
    createUploadRequest,
    confirmAssetUpload,
    assetDownloadUrl,
    createShot,
    updateShot,
  };
}
