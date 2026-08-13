import type { ControlAsset, ControlProject, ControlProviderAttempt, ControlReferenceBinding, ControlShot, ControlTaskRun, ControlUser, ControlWorkspace } from "@alchemy-video/persistence";

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
  input_snapshot: taskRun.inputSnapshot,
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

export const serializeProjectDetail = (detail: {
  project: ControlProject;
  assets: ControlAsset[];
  shots: ControlShot[];
  referenceBindings: ControlReferenceBinding[];
}, taskRuns: ControlTaskRun[] = []) => ({
  project: serializeProject(detail.project),
  assets: detail.assets.map(serializeAsset),
  shots: detail.shots.map(serializeShot),
  reference_bindings: detail.referenceBindings.map(serializeReferenceBinding),
  task_runs: taskRuns.map(serializeTaskRun),
});
