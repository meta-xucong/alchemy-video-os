export type CurrentIdentity = {
  userId: string;
  workspaceId: string;
};

export interface IdentityPort {
  resolve(request: Request): Promise<CurrentIdentity>;
}

export const DEV_IDENTITY_SEED = {
  user: {
    id: "usr_dev_owner",
    displayName: "Local Developer",
  },
  workspace: {
    id: "ws_dev_default",
    name: "Default Workspace",
  },
} as const;

export class DevIdentityAdapter implements IdentityPort {
  async resolve(_request: Request): Promise<CurrentIdentity> {
    return {
      userId: DEV_IDENTITY_SEED.user.id,
      workspaceId: DEV_IDENTITY_SEED.workspace.id,
    };
  }
}
