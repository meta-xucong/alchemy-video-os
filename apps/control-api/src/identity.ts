import { VeyraExternalIdentitySchema, type VeyraExternalIdentity } from "@alchemy-video/contracts";
import type { ControlIdentitySeed } from "@alchemy-video/persistence";

export type CurrentIdentity = {
  userId: string;
  workspaceId: string;
  externalUserId?: number;
  /**
   * The role is copied from the signed/verified Veyra identity for display
   * only.  Authorization must use the derived capability below.
   */
  readonly role?: string | null;
  /** Only a verified Veyra administrator may receive this capability. */
  readonly isAdmin?: boolean;
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
      isAdmin: false,
      bootstrap: DEV_IDENTITY_SEED,
    };
  }
}

export const normalizeVeyraRole = (role: string | null): string | null => {
  if (role === null) return null;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export const isVerifiedVeyraAdminRole = (role: string | null) =>
  role === "admin";

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
  const parsed = VeyraExternalIdentitySchema.parse(identity);
  const role = normalizeVeyraRole(parsed.role);
  const bootstrap = createVeyraIdentitySeed(parsed);
  return {
    userId: bootstrap.user.id,
    workspaceId: bootstrap.workspace.id,
    externalUserId: parsed.externalUserId,
    role,
    isAdmin: isVerifiedVeyraAdminRole(role),
    bootstrap,
  };
};
