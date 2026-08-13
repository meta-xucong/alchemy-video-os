import { and, asc, eq, sql } from "drizzle-orm";

import type { PlatformDatabase } from "./db.js";
import { commandDeduplications, projects, users, workspaceMembers, workspaces } from "./schema.js";
import { projectScope, workspaceMemberScope } from "./workspace-repositories.js";

export type DevIdentitySeed = {
  user: {
    id: string;
    displayName: string;
  };
  workspace: {
    id: string;
    name: string;
  };
};

export type ControlUser = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
};

export type ControlWorkspace = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ControlProject = {
  id: string;
  workspaceId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
};

export type ProjectCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  name: string;
};

export type UpdateProjectCommandInput = Omit<ProjectCommandInput, "name"> & {
  name?: string;
  status?: "ACTIVE" | "ARCHIVED";
};

export type CommandExecution<T> = {
  kind: "NEW" | "REPLAY";
  value: T;
  status: 200 | 201;
};

export type CommandConflict = { kind: "CONFLICT" };
export type CommandNotFound = { kind: "NOT_FOUND"; status: 404 };

export interface ControlPlaneStore {
  ensureDevIdentity(seed: DevIdentitySeed): Promise<void>;
  getDatabaseStatus(): Promise<"ok" | "unavailable" | "not_configured">;
  findUser(userId: string): Promise<ControlUser | undefined>;
  listWorkspaces(userId: string): Promise<ControlWorkspace[]>;
  hasWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean>;
  listProjects(workspaceId: string): Promise<ControlProject[]>;
  findProject(workspaceId: string, projectId: string): Promise<ControlProject | undefined>;
  createProject(input: ProjectCommandInput): Promise<CommandExecution<ControlProject> | CommandConflict>;
  updateProject(
    input: UpdateProjectCommandInput,
  ): Promise<CommandExecution<ControlProject> | CommandConflict | CommandNotFound>;
}

const commandScope = (scope: string, idempotencyKey: string) =>
  and(
    eq(commandDeduplications.scope, scope),
    eq(commandDeduplications.idempotencyKey, idempotencyKey),
  );

const isConflict = (requestHash: string, existingHash: string) => requestHash !== existingHash;
const isNotFoundSnapshot = (snapshot: Record<string, unknown>) => snapshot.kind === "NOT_FOUND" && snapshot.status === 404;

export class DrizzleControlPlaneRepository implements ControlPlaneStore {
  constructor(private readonly db: PlatformDatabase) {}

  async ensureDevIdentity(seed: DevIdentitySeed) {
    await this.db.transaction(async (transaction) => {
      await transaction
        .insert(users)
        .values({ id: seed.user.id, displayName: seed.user.displayName, status: "ACTIVE" })
        .onConflictDoNothing();
      await transaction
        .insert(workspaces)
        .values({ id: seed.workspace.id, name: seed.workspace.name, createdBy: seed.user.id })
        .onConflictDoNothing();
      await transaction
        .insert(workspaceMembers)
        .values({ workspaceId: seed.workspace.id, userId: seed.user.id, role: "OWNER" })
        .onConflictDoNothing();
    });
  }

  async getDatabaseStatus() {
    try {
      await this.db.execute(sql`select 1`);
      return "ok" as const;
    } catch {
      return "unavailable" as const;
    }
  }

  async findUser(userId: string) {
    return (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  }

  async listWorkspaces(userId: string) {
    return this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdBy: workspaces.createdBy,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(asc(workspaces.createdAt));
  }

  async hasWorkspaceMembership(workspaceId: string, userId: string) {
    const membership = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(workspaceMemberScope(workspaceId, userId))
      .limit(1);
    return membership.length === 1;
  }

  async listProjects(workspaceId: string) {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.createdAt));
  }

  async findProject(workspaceId: string, projectId: string) {
    return (await this.db.select().from(projects).where(projectScope(workspaceId, projectId)).limit(1))[0];
  }

  async createProject(input: ProjectCommandInput) {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseSnapshot: {},
        })
        .onConflictDoNothing()
        .returning({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot });

      if (!reservation) {
        const [existing] = await transaction
          .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
          .from(commandDeduplications)
          .where(commandScope(input.scope, input.idempotencyKey))
          .limit(1);

        if (!existing || isConflict(input.requestHash, existing.requestHash)) {
          return { kind: "CONFLICT" } as const;
        }

        return {
          kind: "REPLAY",
          value: existing.responseSnapshot as unknown as ControlProject,
          status: 201,
        } as const;
      }

      const [project] = await transaction
        .insert(projects)
        .values({ id: input.projectId, workspaceId: input.workspaceId, name: input.name, status: "ACTIVE" })
        .returning();

      await transaction
        .update(commandDeduplications)
        .set({ responseSnapshot: project })
        .where(commandScope(input.scope, input.idempotencyKey));

      return { kind: "NEW", value: project, status: 201 } as const;
    });
  }

  async updateProject(input: UpdateProjectCommandInput) {
    return this.db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .insert(commandDeduplications)
        .values({
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          responseSnapshot: {},
        })
        .onConflictDoNothing()
        .returning({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot });

      if (!reservation) {
        const [existing] = await transaction
          .select({ requestHash: commandDeduplications.requestHash, responseSnapshot: commandDeduplications.responseSnapshot })
          .from(commandDeduplications)
          .where(commandScope(input.scope, input.idempotencyKey))
          .limit(1);

        if (!existing || isConflict(input.requestHash, existing.requestHash)) {
          return { kind: "CONFLICT" } as const;
        }

        if (isNotFoundSnapshot(existing.responseSnapshot)) {
          return { kind: "NOT_FOUND", status: 404 } as const;
        }

        return {
          kind: "REPLAY",
          value: existing.responseSnapshot as unknown as ControlProject,
          status: 200,
        } as const;
      }

      const [project] = await transaction
        .update(projects)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.status === undefined ? {} : { status: input.status }),
          updatedAt: new Date().toISOString(),
        })
        .where(projectScope(input.workspaceId, input.projectId))
        .returning();

      if (!project) {
        await transaction
          .update(commandDeduplications)
          .set({ responseSnapshot: { kind: "NOT_FOUND", status: 404 } })
          .where(commandScope(input.scope, input.idempotencyKey));
        return { kind: "NOT_FOUND", status: 404 } as const;
      }

      await transaction
        .update(commandDeduplications)
        .set({ responseSnapshot: project })
        .where(commandScope(input.scope, input.idempotencyKey));

      return { kind: "NEW", value: project, status: 200 } as const;
    });
  }
}
