import { VeyraExternalIdentitySchema, type VeyraExternalIdentity } from "@alchemy-video/contracts";
import type { ControlIdentitySeed } from "@alchemy-video/persistence";

export type CurrentIdentity = {
  userId: string;
  workspaceId: string;
  externalUserId?: number;
  bootstrap?: ControlIdentitySeed;
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
      bootstrap: DEV_IDENTITY_SEED,
    };
  }
}

export const createVeyraIdentitySeed = (identity: VeyraExternalIdentity): ControlIdentitySeed => {
  const parsed = VeyraExternalIdentitySchema.parse(identity);
  const externalId = String(parsed.externalUserId);
  const displayName = parsed.email ?? `Veyra user ${externalId}`;
  return {
    user: {
      id: `usr_veyra_${externalId}`,
      displayName,
    },
    workspace: {
      id: `ws_veyra_${externalId}`,
      name: parsed.email ? `Video workspace ${parsed.email}` : `Video workspace ${externalId}`,
    },
    membership: { role: "OWNER" },
  };
};

export const createVeyraCurrentIdentity = (identity: VeyraExternalIdentity): CurrentIdentity => {
  const bootstrap = createVeyraIdentitySeed(identity);
  return {
    userId: bootstrap.user.id,
    workspaceId: bootstrap.workspace.id,
    externalUserId: identity.externalUserId,
    bootstrap,
  };
};
