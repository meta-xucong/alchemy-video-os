import type { ControlAsset, ControlCreativeBriefRevision, ControlDocumentConversion, ControlProductionRun, ControlProductionRunProgress, ControlProject, ControlProviderAttempt, ControlReferenceBinding, ControlShot, ControlStoryboardRevision, ControlTaskRun, ControlUser, ControlVideoVersion, ControlWorkspace } from "@alchemy-video/persistence";

const toUtcTimestamp = (value: string) => new Date(value).toISOString();

export const serializeUser = (user: ControlUser) => ({
  id: user.id,
  display_name: user.displayName,
  status: user.status,
  created_at: toUtcTimestamp(user.createdAt),
  updated_at: toUtcTimestamp(user.updatedAt),
});

export const serializeWorkspace = (workspace: ControlWorkspace) => ({
  id: workspace.id,
  name: workspace.name,
  created_by: workspace.createdBy,
  created_at: toUtcTimestamp(workspace.createdAt),
  updated_at: toUtcTimestamp(workspace.updatedAt),
});

export const serializeProject = (project: ControlProject) => ({
  id: project.id,
  workspace_id: project.workspaceId,
  name: project.name,
  status: project.status,
  created_at: toUtcTimestamp(project.createdAt),
  updated_at: toUtcTimestamp(project.updatedAt),
});

const serializeAssetMetadata = (metadata: Record<string, unknown>) => {
  const { task_run_id: _taskRunId, generated_by: _generatedBy, ...publicMetadata } = metadata;
  return publicMetadata;
};

export const serializeAsset = (asset: ControlAsset) => ({ id: asset.id, workspace_id: asset.workspaceId, project_id: asset.projectId, kind: asset.kind, origin: asset.origin, status: asset.status, sha256: asset.sha256, mime_type: asset.mimeType, byte_size: asset.byteSize, width: asset.width, height: asset.height, duration_ms: asset.durationMs, metadata: serializeAssetMetadata(asset.metadata), created_at: toUtcTimestamp(asset.createdAt), updated_at: toUtcTimestamp(asset.updatedAt) });
export const serializeShot = (shot: ControlShot) => ({ id: shot.id, workspace_id: shot.workspaceId, project_id: shot.projectId, position: shot.position, prompt: shot.prompt, model: shot.model, generation_settings: shot.generationSettings, status: shot.status, selected_asset_id: shot.selectedAssetId, revision: shot.revision, created_at: toUtcTimestamp(shot.createdAt), updated_at: toUtcTimestamp(shot.updatedAt) });
export const serializeReferenceBinding = (binding: ControlReferenceBinding) => ({ shot_id: binding.shotId, asset_id: binding.assetId, role: binding.role, position: binding.position, created_at: toUtcTimestamp(binding.createdAt) });
export const serializeTaskRun = (taskRun: ControlTaskRun) => ({
  id: taskRun.id,
  workspace_id: taskRun.workspaceId,
  project_id: taskRun.projectId,
  shot_id: taskRun.shotId,
  kind: taskRun.kind,
  status: taskRun.status === "PROVIDER_PROCESSING" ? "PROCESSING" as const : taskRun.status,
  result_asset_id: taskRun.resultAssetId,
  error: taskRun.error,
  retry_at: taskRun.retryAt ? toUtcTimestamp(taskRun.retryAt) : null,
  created_at: toUtcTimestamp(taskRun.createdAt),
  updated_at: toUtcTimestamp(taskRun.updatedAt),
});
export const serializeTaskRunAttempt = (attempt: ControlProviderAttempt) => ({
  id: attempt.id,
  task_run_id: attempt.taskRunId,
  status: attempt.status,
  created_at: toUtcTimestamp(attempt.createdAt),
  updated_at: toUtcTimestamp(attempt.updatedAt),
});
export const serializeDocumentConversion = (conversion: ControlDocumentConversion) => ({
  id: conversion.id,
  document_id: conversion.documentId,
  workspace_id: conversion.workspaceId,
  project_id: conversion.projectId,
  source_asset_id: conversion.sourceAssetId,
  status: conversion.status,
  retryable: conversion.retryable,
  markdown_asset_id: conversion.markdownAssetId,
  warnings: conversion.warnings,
  attempt_count: conversion.attemptCount,
  created_at: toUtcTimestamp(conversion.createdAt),
  updated_at: toUtcTimestamp(conversion.updatedAt),
});
export const serializeCreativeBriefRevision = (brief: ControlCreativeBriefRevision) => ({
  id: brief.id,
  workspace_id: brief.workspaceId,
  project_id: brief.projectId,
  revision: brief.revision,
  source_text: brief.sourceText,
  target_duration_seconds: brief.targetDurationSeconds,
  target_resolution: brief.targetResolution,
  style_preferences: brief.stylePreferences,
  source_asset_ids: brief.sourceAssetIds,
  status: brief.status,
  created_at: toUtcTimestamp(brief.createdAt),
  updated_at: toUtcTimestamp(brief.updatedAt),
});
export const serializeStoryboardRevision = (storyboard: ControlStoryboardRevision) => ({
  id: storyboard.id,
  workspace_id: storyboard.workspaceId,
  project_id: storyboard.projectId,
  script_revision_id: storyboard.scriptRevisionId,
  revision: storyboard.revision,
  title: storyboard.title,
  summary: storyboard.summary,
  total_duration_seconds: storyboard.totalDurationSeconds,
  continuity_level: storyboard.continuityLevel,
  continuity_note: storyboard.continuityNote,
  status: storyboard.status,
  shot_specs: storyboard.shotSpecs.map((shotSpec) => ({
    id: shotSpec.id,
    sequence: shotSpec.sequence,
    title: shotSpec.title,
    duration_seconds: shotSpec.durationSeconds,
    narrative_goal: shotSpec.narrativeGoal,
    start_state: shotSpec.startState,
    end_state: shotSpec.endState,
    transition_summary: shotSpec.transitionSummary,
    reference_policy: shotSpec.referencePolicy,
    depends_on_sequences: shotSpec.dependsOnSequences,
    continuity_note: shotSpec.continuityNote,
    narrative_beat_sequences: shotSpec.narrativeBeatSequences ?? [shotSpec.sequence],
  })),
  narrative_beat_count: storyboard.narrativeBeatCount,
  generation_segment_count: storyboard.generationSegmentCount,
  created_at: toUtcTimestamp(storyboard.createdAt),
  updated_at: toUtcTimestamp(storyboard.updatedAt),
});
export const serializeProductionRun = (productionRun: ControlProductionRun) => ({
  id: productionRun.id,
  workspace_id: productionRun.workspaceId,
  project_id: productionRun.projectId,
  storyboard_revision_id: productionRun.storyboardRevisionId,
  status: productionRun.status,
  total_shot_count: productionRun.totalShotCount,
  accepted_shot_count: productionRun.acceptedShotCount,
  total_segment_count: productionRun.totalSegmentCount,
  accepted_segment_count: productionRun.acceptedSegmentCount,
  total_duration_seconds: productionRun.totalDurationSeconds,
  created_at: toUtcTimestamp(productionRun.createdAt),
  updated_at: toUtcTimestamp(productionRun.updatedAt),
});
export const serializeProductionRunProgress = (progress: ControlProductionRunProgress) => ({
  production_run: serializeProductionRun(progress.productionRun),
  segments: progress.segments.map((segment) => ({
    id: segment.id,
    production_run_id: segment.productionRunId,
    sequence: segment.sequence,
    title: segment.title,
    status: segment.status,
    retryable: segment.retryable,
    safe_summary: segment.safeSummary,
    created_at: toUtcTimestamp(segment.createdAt),
    updated_at: toUtcTimestamp(segment.updatedAt),
  })),
});
export const serializeVideoVersion = (version: ControlVideoVersion) => ({
  id: version.id,
  workspace_id: version.workspaceId,
  project_id: version.projectId,
  production_run_id: version.productionRunId,
  storyboard_revision_id: version.storyboardRevisionId,
  asset_id: version.assetId,
  status: version.status,
  duration_ms: version.durationMs,
  qc_report: {
    id: version.qcReport.id,
    workspace_id: version.qcReport.workspaceId,
    project_id: version.qcReport.projectId,
    subject_type: version.qcReport.subjectType,
    subject_id: version.qcReport.subjectId,
    kind: version.qcReport.kind,
    status: version.qcReport.status,
    safe_summary: version.qcReport.safeSummary,
    created_at: toUtcTimestamp(version.qcReport.createdAt),
  },
  created_at: toUtcTimestamp(version.createdAt),
});

export const serializeProjectDetail = (detail: {
  project: ControlProject;
  assets: ControlAsset[];
  shots: ControlShot[];
  referenceBindings: ControlReferenceBinding[];
}, taskRuns: ControlTaskRun[] = [], planning: {
  creativeBriefRevisions: ControlCreativeBriefRevision[];
  storyboardRevisions: ControlStoryboardRevision[];
  productionRuns: ControlProductionRun[];
} = { creativeBriefRevisions: [], storyboardRevisions: [], productionRuns: [] }) => ({
  project: serializeProject(detail.project),
  assets: detail.assets.map(serializeAsset),
  shots: detail.shots.map(serializeShot),
  reference_bindings: detail.referenceBindings.map(serializeReferenceBinding),
  task_runs: taskRuns.map(serializeTaskRun),
  creative_brief_revisions: planning.creativeBriefRevisions.map(serializeCreativeBriefRevision),
  storyboard_revisions: planning.storyboardRevisions.map(serializeStoryboardRevision),
  production_runs: planning.productionRuns.map(serializeProductionRun),
});
