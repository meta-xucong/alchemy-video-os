import type { ControlAsset, ControlProject, ControlReferenceBinding, ControlShot, ControlUser, ControlWorkspace } from "@alchemy-video/persistence";

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

export const serializeAsset = (asset: ControlAsset) => ({ id: asset.id, workspace_id: asset.workspaceId, project_id: asset.projectId, kind: asset.kind, origin: asset.origin, status: asset.status, sha256: asset.sha256, mime_type: asset.mimeType, byte_size: asset.byteSize, width: asset.width, height: asset.height, duration_ms: asset.durationMs, metadata: asset.metadata, created_at: toUtcTimestamp(asset.createdAt), updated_at: toUtcTimestamp(asset.updatedAt) });
export const serializeShot = (shot: ControlShot) => ({ id: shot.id, workspace_id: shot.workspaceId, project_id: shot.projectId, position: shot.position, prompt: shot.prompt, model: shot.model, generation_settings: shot.generationSettings, status: shot.status, selected_asset_id: shot.selectedAssetId, revision: shot.revision, created_at: toUtcTimestamp(shot.createdAt), updated_at: toUtcTimestamp(shot.updatedAt) });
export const serializeReferenceBinding = (binding: ControlReferenceBinding) => ({ shot_id: binding.shotId, asset_id: binding.assetId, role: binding.role, position: binding.position, created_at: toUtcTimestamp(binding.createdAt) });

export const serializeProjectDetail = (detail: {
  project: ControlProject;
  assets: ControlAsset[];
  shots: ControlShot[];
  referenceBindings: ControlReferenceBinding[];
}) => ({
  project: serializeProject(detail.project),
  assets: detail.assets.map(serializeAsset),
  shots: detail.shots.map(serializeShot),
  reference_bindings: detail.referenceBindings.map(serializeReferenceBinding),
});
