export type HealthStatus = {
  data: {
    service: string;
    status: string;
    build_version: string;
    dependencies: { database: "ok" | "unavailable" | "not_configured" };
  };
  request_id: string;
};
export type AudioCapabilities = {
  free_only: boolean;
  capabilities: Array<{ id: string; label: string; status: "AVAILABLE" | "BLOCKED" | "NOT_CONFIGURED"; free: boolean; key_required: boolean; reason: string }>;
  music_assets?: Asset[];
};
export type AudioCapabilitiesResponse = { data: AudioCapabilities; request_id: string };
export type PixabayMusicImportResponse = {
  data: {
    asset: Asset;
    track: {
      title: string;
      artist: string;
      duration_seconds: number | null;
      pixabay_id?: string | number | null;
      results_found: number;
      results_after_filter: number;
    };
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
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
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
  understanding?: DocumentUnderstandingSummary;
  created_at: string;
  updated_at: string;
};
export type DocumentUnderstandingSummary = {
  knowledge_revision_id: string | null;
  status: "CREATED" | "QUEUED" | "RUNNING" | "READY" | "FAILED" | null;
  retryable: boolean;
  analysis_quality: "COMPLETE" | "PARTIAL" | "NEEDS_CONFIRMATION" | null;
  fact_count: number;
  has_confirmation: boolean;
  has_visual_gaps: boolean;
};
export type DocumentKnowledgeDetail = {
  revision: {
    id: string;
    workspace_id: string;
    project_id: string;
    document_id: string;
    conversion_id: string;
    status: "CREATED" | "QUEUED" | "RUNNING" | "READY" | "FAILED";
    retryable: boolean;
    analysis_quality: "COMPLETE" | "PARTIAL" | "NEEDS_CONFIRMATION" | null;
    section_count: number;
    fact_count: number;
    created_at: string;
    updated_at: string;
  };
  sections: Array<{ id: string; knowledge_revision_id: string; sequence: number; heading: string; locator: string; evidence_kind: "TEXT" | "TABLE" | "VISUAL_UNAVAILABLE" }>;
  facts: Array<{ id: string; section_sequence: number; category: string; statement: string; confidence: "EXPLICIT" | "INFERRED" | "NEEDS_CONFIRMATION"; source: { document_id: string; conversion_id: string; locator: string } }>;
};
export type DocumentConversionResponse = { data: DocumentConversion; request_id: string };
export type DocumentListResponse = { data: DocumentConversion[]; request_id: string };
export type DocumentKnowledgeDetailResponse = { data: DocumentKnowledgeDetail; request_id: string };
export type DocumentKnowledgeRevisionResponse = { data: DocumentKnowledgeDetail["revision"]; request_id: string };
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
  document_contexts: Array<{ document_id: string; conversion_id: string; source_asset_id: string; markdown_asset_id: string; max_content_characters: number }>;
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
  delivery_plan_revision_id?: string;
  status: "DRAFT" | "PLAN_READY" | "CONFIRMED" | "GENERATING" | "REVIEWING" | "RENDERING" | "SUCCEEDED" | "BLOCKED" | "FAILED";
  total_shot_count: number;
  accepted_shot_count: number;
  total_segment_count: number;
  accepted_segment_count: number;
  total_duration_seconds: number;
  continuity_status: "NOT_CHECKED" | "CHECKING" | "GOOD" | "AUTO_REPAIRING" | "NEEDS_ATTENTION";
  planned_segment_count: number;
  max_auto_repair_count: number;
  auto_repair_count: number;
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
  audio_summary?: {
    has_audio: boolean;
    music_applied: boolean;
    music_title?: string;
    music_artist?: string;
    music_tags?: string[];
    sample_rate?: number;
    integrated_lufs?: number;
    true_peak_db?: number;
    loudness_range_lu?: number;
    unexpected_silence?: boolean;
  };
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
export type DeliveryPlanRevision = {
  id: string;
  workspace_id: string;
  project_id: string;
  creative_brief_revision_id: string;
  storyboard_revision_id: string;
  revision: number;
  status: "DRAFT" | "PREFLIGHT_BLOCKED" | "AWAITING_APPROVAL" | "APPROVED" | "CONSUMED" | "SUPERSEDED";
  duration_policy: "FLEXIBLE" | "EXACT";
  flexible_duration_percent: number;
  target_duration_seconds: number;
  requires_sample_approval: boolean;
  caption_policy: "REQUIRED" | "OPTIONAL" | "OFF";
  lip_sync_requirement: "OFF" | "PREFERRED" | "REQUIRED";
  voice_mode: "PLATFORM_GENERIC" | "AUTHORIZED_CLONE" | "USER_SOURCE";
  safe_summary: string;
  block_reasons: string[];
  approved_at: string | null;
  consumed_by_production_run_id: string | null;
  created_at: string;
  updated_at: string;
};
export type DeliveryPlanRevisionResponse = { data: DeliveryPlanRevision; request_id: string };
export type NarrationScriptRevision = {
  id: string;
  workspace_id: string;
  project_id: string;
  delivery_plan_revision_id: string;
  status: "DRAFT" | "NORMALIZED" | "NEEDS_DECISION" | "APPROVED" | "REJECTED";
  source_script_hash: string;
  display_sections: Array<{ id: string; text: string }>;
  spoken_sections: Array<{ id: string; provider_text: string }>;
  decision_reasons: string[];
};
export type NarrationScriptRevisionResponse = { data: NarrationScriptRevision; request_id: string };
export type NarrationScriptRevisionListResponse = { data: NarrationScriptRevision[]; request_id: string };
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
  const loginWithAiself = () => { window.location.assign("/auth/login"); };
  const logout = () => $fetch<{ data: { logged_out: boolean }; request_id: string }>("/auth/logout", { method: "POST" });
  const projects = () => $fetch<ProjectList>("/api/v1/projects");
  const project = (projectId: string, signal?: AbortSignal) => $fetch<ProjectDetailResponse>(`/api/v1/projects/${projectId}`, { signal });
  const audioCapabilities = (projectId: string) => $fetch<AudioCapabilitiesResponse>(`/api/v1/projects/${projectId}/audio-capabilities`);
  const importPixabayMusic = (projectId: string, input: { query: string; min_duration?: number; max_duration?: number }, idempotencyKey: string) =>
    $fetch<PixabayMusicImportResponse>(`/api/v1/projects/${projectId}/audio/pixabay/import`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const createProject = (name: string, idempotencyKey: string) =>
    $fetch<ProjectResponse>("/api/v1/projects", { method: "POST", headers: commandHeaders(idempotencyKey), body: { name } });

  const updateProject = (projectId: string, input: { name?: string; status?: "ACTIVE" | "ARCHIVED" }, idempotencyKey: string) =>
    $fetch<ProjectResponse>(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const createUploadRequest = (projectId: string, input: { kind: "IMAGE" | "AUDIO" | "DOCUMENT"; filename: string; mime_type: string; byte_size: number; purpose?: "MUSIC" | "NARRATION_SAMPLE" | "USER_SOURCE_AUDIO" }, idempotencyKey: string) =>
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
  const deleteAsset = (assetId: string, idempotencyKey: string) =>
    $fetch<AssetResponse>(`/api/v1/assets/${assetId}`, {
      method: "DELETE",
      headers: commandHeaders(idempotencyKey),
    });
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
  const documentKnowledgeDetail = (knowledgeRevisionId: string) =>
    $fetch<DocumentKnowledgeDetailResponse>(`/api/v1/document-knowledge-revisions/${knowledgeRevisionId}`);
  const retryDocumentKnowledgeRevision = (knowledgeRevisionId: string, idempotencyKey: string) =>
    $fetch<DocumentKnowledgeRevisionResponse>(`/api/v1/document-knowledge-revisions/${knowledgeRevisionId}/retry`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });
  const createDeliveryPlanRevision = (projectId: string, input: {
    creative_brief_revision_id: string;
    storyboard_revision_id: string;
    duration_policy?: "FLEXIBLE" | "EXACT";
    flexible_duration_percent?: number;
    caption_policy?: "REQUIRED" | "OPTIONAL" | "OFF";
    lip_sync_requirement?: "OFF" | "PREFERRED" | "REQUIRED";
    voice_mode?: "PLATFORM_GENERIC" | "AUTHORIZED_CLONE" | "USER_SOURCE";
    budget_limit?: string;
  }, idempotencyKey: string) =>
    $fetch<DeliveryPlanRevisionResponse>(`/api/v1/projects/${projectId}/delivery-plan-revisions`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  const deleteProject = (projectId: string, idempotencyKey: string) =>
    $fetch<ProjectResponse>(`/api/v1/projects/${projectId}`, {
      method: "DELETE",
      headers: commandHeaders(idempotencyKey),
    });
  const approveDeliveryPlanRevision = (deliveryPlanRevisionId: string, idempotencyKey: string) =>
    $fetch<DeliveryPlanRevisionResponse>(`/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/approve`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });
  const narrationScriptRevisions = (deliveryPlanRevisionId: string) =>
    $fetch<NarrationScriptRevisionListResponse>(`/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/narration-scripts`);
  const createNarrationScriptRevision = (deliveryPlanRevisionId: string, input: { display_sections: Array<{ id: string; text: string }>; pronunciation_glossary?: Array<{ source: string; spoken: string }>; normalization_version?: string }, idempotencyKey: string) =>
    $fetch<NarrationScriptRevisionResponse>(`/api/v1/delivery-plan-revisions/${deliveryPlanRevisionId}/narration-scripts`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });
  const retryProductionComposition = (productionRunId: string, idempotencyKey: string) =>
    $fetch<ProductionRunProgressResponse>(`/api/v1/production-runs/${productionRunId}/composition/retry`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: {},
    });

  const createProductionRun = (projectId: string, input: { storyboard_revision_id: string; delivery_plan_revision_id: string; music_plan?: { mode: "AUTO" | "MANUAL" | "OFF"; asset_id?: string; style_hint?: string } }, idempotencyKey: string) =>
    $fetch<ProductionRunResponse>(`/api/v1/projects/${projectId}/production-runs`, {
      method: "POST",
      headers: commandHeaders(idempotencyKey),
      body: input,
    });

  return {
    health,
    currentIdentity,
    loginWithAiself,
    logout,
    projects,
    project,
    audioCapabilities,
    importPixabayMusic,
    createProject,
    updateProject,
    deleteProject,
    createUploadRequest,
    confirmAssetUpload,
    assetDownloadUrl,
    deleteAsset,
    documents,
    createDocumentConversion,
    retryDocumentConversion,
    documentKnowledgeDetail,
    retryDocumentKnowledgeRevision,
    taskRun,
    createShot,
    updateShot,
    createGeneration,
    retryTaskRun,
    createCreativeBriefRevision,
    requestCreativePlan,
    storyboardRevisions,
    approveStoryboardRevision,
    createDeliveryPlanRevision,
    approveDeliveryPlanRevision,
    narrationScriptRevisions,
    createNarrationScriptRevision,
    productionRuns,
    videoVersions,
    retryProductionSegment,
    retryProductionComposition,
    createProductionRun,
  };
}
