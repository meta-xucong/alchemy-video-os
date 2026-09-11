import { and, asc, eq, ne, notInArray, sql, inArray } from "drizzle-orm";

import { PRODUCTION_RUN_STATUSES, TASK_RUN_TERMINAL_STATUSES } from "@alchemy-video/contracts";

import type { PlatformDatabase } from "./db.js";
import { commandDeduplications, productionRuns, projects, taskRuns, users, workspaceMembers, workspaces } from "./schema.js";
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

export type ControlIdentitySeed = DevIdentitySeed & {
  membership?: {
    role?: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
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
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
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

export type DeleteProjectCommandInput = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  workspaceId: string;
  projectId: string;
  activeWork?: boolean;
};

export type CommandExecution<T> = {
  kind: "NEW" | "REPLAY";
  value: T;
  status: 200 | 201;
};

export type CommandConflict = { kind: "CONFLICT" };
export type CommandNotFound = { kind: "NOT_FOUND"; status: 404 };
export type CommandProjectInUse = { kind: "IN_USE"; status: 409 };

export interface ControlPlaneStore {
  ensureIdentity(seed: ControlIdentitySeed): Promise<void>;
  ensureDevIdentity(seed: DevIdentitySeed): Promise<void>;
  getDatabaseStatus(): Promise<"ok" | "unavailable" | "not_configured">;
  findUser(userId: string): Promise<ControlUser | undefined>;
  listWorkspaces(userId: string): Promise<ControlWorkspace[]>;
  /**
   * Returns the explicit workspace targets an already verified administrator
   * may inspect. Callers must still scope every project/resource query to one
   * returned workspace id.
   */
  listWorkspacesForAdmin(): Promise<ControlWorkspace[]>;
  hasWorkspaceMembership(workspaceId: string, userId: string): Promise<boolean>;
  listProjects(workspaceId: string): Promise<ControlProject[]>;
  findProject(workspaceId: string, projectId: string): Promise<ControlProject | undefined>;
  createProject(input: ProjectCommandInput): Promise<CommandExecution<ControlProject> | CommandConflict>;
  updateProject(
    input: UpdateProjectCommandInput,
  ): Promise<CommandExecution<ControlProject> | CommandConflict | CommandNotFound>;
  deleteProject(
    input: DeleteProjectCommandInput,
  ): Promise<CommandExecution<ControlProject> | CommandConflict | CommandNotFound | CommandProjectInUse>;
}

const commandScope = (scope: string, idempotencyKey: string) =>
  and(
    eq(commandDeduplications.scope, scope),
    eq(commandDeduplications.idempotencyKey, idempotencyKey),
  );

const isConflict = (requestHash: string, existingHash: string) => requestHash !== existingHash;
const isNotFoundSnapshot = (snapshot: Record<string, unknown>) => snapshot.kind === "NOT_FOUND" && snapshot.status === 404;
const isInUseSnapshot = (snapshot: Record<string, unknown>) => snapshot.kind === "IN_USE" && snapshot.status === 409;
const activeProductionRunStatuses = PRODUCTION_RUN_STATUSES.filter((status) => !["SUCCEEDED", "BLOCKED", "FAILED"].includes(status));

export class DrizzleControlPlaneRepository implements ControlPlaneStore {
  constructor(private readonly db: PlatformDatabase) {}

  async ensureIdentity(seed: ControlIdentitySeed) {
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
        .values({ workspaceId: seed.workspace.id, userId: seed.user.id, role: seed.membership?.role ?? "OWNER" })
        .onConflictDoNothing();
    });
  }

  async ensureDevIdentity(seed: DevIdentitySeed) {
    await this.ensureIdentity(seed);
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

  async listWorkspacesForAdmin() {
    return this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdBy: workspaces.createdBy,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
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
      .where(and(eq(projects.workspaceId, workspaceId), ne(projects.status, "DELETED")))
      .orderBy(asc(projects.createdAt));
  }

  async findProject(workspaceId: string, projectId: string) {
    return (await this.db.select().from(projects).where(and(projectScope(workspaceId, projectId), ne(projects.status, "DELETED"))).limit(1))[0];
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
        .where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED")))
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

  async deleteProject(input: DeleteProjectCommandInput) {
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

        if (!existing || isConflict(input.requestHash, existing.requestHash)) return { kind: "CONFLICT" } as const;
        if (isNotFoundSnapshot(existing.responseSnapshot)) return { kind: "NOT_FOUND", status: 404 } as const;
        if (isInUseSnapshot(existing.responseSnapshot)) return { kind: "IN_USE", status: 409 } as const;
        return { kind: "REPLAY", value: existing.responseSnapshot as unknown as ControlProject, status: 200 } as const;
      }

      const [project] = await transaction
        .select()
        .from(projects)
        .where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED")))
        .limit(1);
      if (!project) {
        await transaction
          .update(commandDeduplications)
          .set({ responseSnapshot: { kind: "NOT_FOUND", status: 404 } })
          .where(commandScope(input.scope, input.idempotencyKey));
        return { kind: "NOT_FOUND", status: 404 } as const;
      }

      const [activeTaskRun] = await transaction
        .select({ id: taskRuns.id })
        .from(taskRuns)
        .where(and(
          eq(taskRuns.workspaceId, input.workspaceId),
          eq(taskRuns.projectId, input.projectId),
          notInArray(taskRuns.status, [...TASK_RUN_TERMINAL_STATUSES]),
        ))
        .limit(1);
      const [activeProductionRun] = await transaction
        .select({ id: productionRuns.id })
        .from(productionRuns)
        .where(and(
          eq(productionRuns.workspaceId, input.workspaceId),
          eq(productionRuns.projectId, input.projectId),
          inArray(productionRuns.status, activeProductionRunStatuses),
        ))
        .limit(1);
      if (input.activeWork || activeTaskRun || activeProductionRun) {
        await transaction
          .update(commandDeduplications)
          .set({ responseSnapshot: { kind: "IN_USE", status: 409 } })
          .where(commandScope(input.scope, input.idempotencyKey));
        return { kind: "IN_USE", status: 409 } as const;
      }

      const [deleted] = await transaction
        .update(projects)
        .set({ status: "DELETED", updatedAt: new Date().toISOString() })
        .where(and(projectScope(input.workspaceId, input.projectId), ne(projects.status, "DELETED")))
        .returning();
      if (!deleted) {
        await transaction
          .update(commandDeduplications)
          .set({ responseSnapshot: { kind: "NOT_FOUND", status: 404 } })
          .where(commandScope(input.scope, input.idempotencyKey));
        return { kind: "NOT_FOUND", status: 404 } as const;
      }
      await transaction
        .update(commandDeduplications)
        .set({ responseSnapshot: deleted })
        .where(commandScope(input.scope, input.idempotencyKey));
      return { kind: "NEW", value: deleted, status: 200 } as const;
    });
  }
}
