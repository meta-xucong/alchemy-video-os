import type { ControlProject, ControlUser, ControlWorkspace } from "@alchemy-video/persistence";

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
