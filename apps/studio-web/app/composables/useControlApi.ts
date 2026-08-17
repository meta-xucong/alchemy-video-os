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
  data: {
    project: Project;
    assets: Asset[];
    shots: Shot[];
    reference_bindings: ReferenceBinding[];
    task_runs: TaskRun[];
    creative_brief_revisions: CreativeBriefRevision[];
    storyboard_revisions: StoryboardRevision[];
    production_runs: ProductionRun[];
  };
  request_id: string;
};
export type AssetResponse = { data: Asset; request_id: string };
export type ShotResponse = { data: Shot; request_id: string };
export type UploadRequestResponse = {
  data: { asset_id: string; upload_url: string | null; headers: Record<string, string>; expires_at: string | null };
  request_id: string;
};
export type DownloadUrlResponse = { data: { download_url: string; expires_at: string }; request_id: string };
export type DocumentConversion = {
  id: string;
  document_id: string;
  workspace_id: string;
  project_id: string;
  source_asset_id: string;
  status: "CREATED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  retryable: boolean;
  markdown_asset_id: string | null;
  warnings: string[];
  attempt_count: number;
  created_at: string;
  updated_at: string;
};
export type DocumentConversionResponse = { data: DocumentConversion; request_id: string };
export type DocumentListResponse = { data: DocumentConversion[]; request_id: string };
export type TaskRun = {
  id: string;
  workspace_id: string;
  project_id: string;
  shot_id: string;
  kind: "VIDEO_GENERATION" | "DOCUMENT_CONVERSION" | "RENDER" | "QC";
  status: "CREATED" | "QUEUED" | "RUNNING" | "PROCESSING" | "DOWNLOADING" | "BILLING_PENDING" | "SUCCEEDED" | "BILLING_FAILED" | "FAILED" | "RETRY_SCHEDULED" | "ABANDONED";
  result_asset_id: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  retry_at: string | null;
  created_at: string;
  updated_at: string;
};
export type TaskRunAttempt = {
  id: string;
  task_run_id: string;
  status: "CREATED" | "SUBMITTED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "DOWNLOAD_FAILED" | "ABANDONED";
  created_at: string;
  updated_at: string;
};
export type TaskRunDetailResponse = { data: { task_run: TaskRun; attempts: TaskRunAttempt[]; result_asset: Asset | null }; request_id: string };
export type TaskRunResponse = { data: TaskRun; request_id: string };
export type CreativeBriefRevision = {
  id: string;
  workspace_id: string;
  project_id: string;
  revision: number;
  source_text: string;
  target_duration_seconds: number;
  target_resolution: "480p" | "720p";
  style_preferences: string;
  source_asset_ids: string[];
  status: "DRAFT" | "PLANNING" | "READY_FOR_REVIEW" | "APPROVED" | "FAILED" | "SUPERSEDED";
  created_at: string;
  updated_at: string;
};
export type StoryboardShotSpec = {
  id: string;
  sequence: number;
  title: string;
  duration_seconds: number;
  narrative_goal: string;
  start_state: string;
  end_state: string;
  transition_summary: string;
  reference_policy: "REFERENCE_SET" | "HANDOFF_FIRST_FRAME" | "TEXT_TRANSITION";
  depends_on_sequences: number[];
  continuity_note: string;
  narrative_beat_sequences: number[];
};
export type StoryboardRevision = {
  id: string;
  workspace_id: string;
  project_id: string;
  script_revision_id: string;
  revision: number;
  title: string;
  summary: string;
  total_duration_seconds: number;
  continuity_level: "STANDARD" | "REVIEW_REQUIRED";
  continuity_note: string;
  status: "DRAFT" | "PLANNING" | "READY_FOR_REVIEW" | "APPROVED" | "FAILED" | "SUPERSEDED";
  shot_specs: StoryboardShotSpec[];
  narrative_beat_count: number;
  generation_segment_count: number;
  created_at: string;
  updated_at: string;
};
export type ProductionRun = {
  id: string;
  workspace_id: string;
  project_id: string;
  storyboard_revision_id: string;
  status: "DRAFT" | "PLAN_READY" | "CONFIRMED" | "GENERATING" | "REVIEWING" | "RENDERING" | "SUCCEEDED" | "BLOCKED" | "FAILED";
  total_shot_count: number;
  accepted_shot_count: number;
  total_segment_count: number;
  accepted_segment_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
};
export type ProductionSegment = {
  id: string;
  production_run_id: string;
  sequence: number;
  title: string;
  status: "PENDING" | "WAITING" | "GENERATING" | "CHECKING" | "ACCEPTED" | "FAILED";
  retryable: boolean;
  safe_summary: string;
  created_at: string;
  updated_at: string;
};
export type ProductionRunProgress = {
  production_run: ProductionRun;
  segments: ProductionSegment[];
};
export type QcReport = {
  id: string;
  workspace_id: string;
  project_id: string;
  subject_type: "PRODUCTION_SEGMENT" | "VIDEO_VERSION";
  subject_id: string;
  kind: "TECHNICAL" | "COMPOSITION";
  status: "PASS" | "NEEDS_ATTENTION" | "FAILED";
  safe_summary: string;
  created_at: string;
};
export type VideoVersion = {
  id: string;
  workspace_id: string;
  project_id: string;
  production_run_id: string;
  storyboard_revision_id: string;
  asset_id: string;
  status: "SUCCEEDED";
  duration_ms: number;
  qc_report: QcReport;
  created_at: string;
};
export type CreativeBriefRevisionResponse = { data: CreativeBriefRevision; request_id: string };
export type StoryboardRevisionResponse = { data: StoryboardRevision; request_id: string };
export type StoryboardRevisionListResponse = { data: StoryboardRevision[]; request_id: string };
export type ProductionRunResponse = { data: ProductionRun; request_id: string };
export type ProductionRunListResponse = { data: ProductionRun[]; request_id: string };
export type ProductionRunProgressListResponse = { data: ProductionRunProgress[]; request_id: string };
export type ProductionRunProgressResponse = { data: ProductionRunProgress; request_id: string };
export type VideoVersionListResponse = { data: VideoVersion[]; request_id: string };

const commandHeaders = (idempotencyKey: string) => ({
  "Content-Type": "application/json",
  "Idempotency-Key": idempotencyKey,
});

export function useControlApi() {
  const health = () => $fetch<HealthStatus>("/api/v1/health");
  const currentIdentity = () => $fetch<CurrentIdentity>("/api/v1/me");
  const projects = () => $fetch<ProjectList>("/api/v1/projects");
  const project = (projectId: string, signal?: AbortSignal) => $fetch<ProjectDetailResponse>(`/api/v1/projects/${projectId}`, { signal });

  const createProject = (name: string, idempotencyKey: string) =>
    $fetch<ProjectResponse>("/api/v1/projects", { method: "POST", headers: commandHeaders(idempotencyKey), body: { name } });

  const updateProject = (projectId: string, input: { name?: string; status?: "ACTIVE" | "ARCHIVED" }, idempotencyKey: string) =>
    $fetch<ProjectResponse>(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

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
  const documents = (projectId: string) => $fetch<DocumentListResponse>(`/api/v1/projects/${projectId}/documents`);
  const createDocumentConversion = (projectId: string, sourceAssetId: string, idempotencyKey: string) =>
    $fetch<DocumentConversionResponse>(`/api/v1/projects/${projectId}/documents/${sourceAssetId}/conversions`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });
  const retryDocumentConversion = (conversionId: string, idempotencyKey: string) =>
    $fetch<DocumentConversionResponse>(`/api/v1/document-conversions/${conversionId}/retry`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });
  const taskRun = (taskRunId: string) => $fetch<TaskRunDetailResponse>(`/api/v1/task-runs/${taskRunId}`);

  const createShot = (projectId: string, input: { position: number; prompt: string; generation_settings?: Record<string, unknown>; reference_bindings: ReferenceBindingInput[] }, idempotencyKey: string) =>
    $fetch<ShotResponse>(`/api/v1/projects/${projectId}/shots`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const updateShot = (shotId: string, input: { prompt?: string; position?: number; generation_settings?: Record<string, unknown>; status?: "DRAFT" | "READY" | "ARCHIVED"; reference_bindings?: ReferenceBindingInput[] }, idempotencyKey: string) =>
    $fetch<ShotResponse>(`/api/v1/shots/${shotId}`, {
      method: "PATCH",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const createGeneration = (shotId: string, idempotencyKey: string) =>
    $fetch<TaskRunResponse>(`/api/v1/shots/${shotId}/generations`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const retryTaskRun = (taskRunId: string, idempotencyKey: string) =>
    $fetch<TaskRunResponse>(`/api/v1/task-runs/${taskRunId}/retry`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const createCreativeBriefRevision = (projectId: string, input: { source_text: string; target_duration_seconds: number; target_resolution: "480p" | "720p"; style_preferences: string; source_asset_ids: string[] }, idempotencyKey: string) =>
    $fetch<CreativeBriefRevisionResponse>(`/api/v1/projects/${projectId}/creative-brief-revisions`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const requestCreativePlan = (creativeBriefRevisionId: string, idempotencyKey: string) =>
    $fetch<CreativeBriefRevisionResponse>(`/api/v1/creative-brief-revisions/${creativeBriefRevisionId}/plan`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const storyboardRevisions = (projectId: string) =>
    $fetch<StoryboardRevisionListResponse>(`/api/v1/projects/${projectId}/storyboard-revisions`);

  const approveStoryboardRevision = (storyboardRevisionId: string, idempotencyKey: string) =>
    $fetch<StoryboardRevisionResponse>(`/api/v1/storyboard-revisions/${storyboardRevisionId}/approve`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const productionRuns = (projectId: string) =>
    $fetch<ProductionRunProgressListResponse>(`/api/v1/projects/${projectId}/production-runs`);
  const videoVersions = (projectId: string) =>
    $fetch<VideoVersionListResponse>(`/api/v1/projects/${projectId}/video-versions`);
  const retryProductionSegment = (productionRunId: string, sequence: number, idempotencyKey: string) =>
    $fetch<ProductionRunProgressResponse>(`/api/v1/production-runs/${productionRunId}/segments/${sequence}/retry`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const createProductionRun = (projectId: string, input: { storyboard_revision_id: string }, idempotencyKey: string) =>
    $fetch<ProductionRunResponse>(`/api/v1/projects/${projectId}/production-runs`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  return {
    health,
    currentIdentity,
    projects,
    project,
    createProject,
    updateProject,
    createUploadRequest,
    confirmAssetUpload,
    assetDownloadUrl,
    documents,
    createDocumentConversion,
    retryDocumentConversion,
    taskRun,
    createShot,
    updateShot,
    createGeneration,
    retryTaskRun,
    createCreativeBriefRevision,
    requestCreativePlan,
    storyboardRevisions,
    approveStoryboardRevision,
    productionRuns,
    videoVersions,
    retryProductionSegment,
    createProductionRun,
  };
}
