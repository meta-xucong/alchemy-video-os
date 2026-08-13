import type {
  CommandConflict,
  CommandExecution,
  ControlPlaneStore,
  ControlProject,
  ControlUser,
  ControlWorkspace,
  DevIdentitySeed,
  ProjectCommandInput,
  UpdateProjectCommandInput,
} from "@alchemy-video/persistence";

type StoredCommand = {
  requestHash: string;
  result:
    | { kind: "PROJECT"; value: ControlProject; status: 200 | 201 }
    | { kind: "NOT_FOUND"; status: 404 };
};

const commandKey = (scope: string, idempotencyKey: string) => `${scope}:${idempotencyKey}`;

export class InMemoryControlPlaneStore implements ControlPlaneStore {
  private readonly users = new Map<string, ControlUser>();
  private readonly workspaces = new Map<string, ControlWorkspace>();
  private readonly memberships = new Set<string>();
  private readonly projects = new Map<string, ControlProject>();
  private readonly commands = new Map<string, StoredCommand>();

  async ensureDevIdentity(seed: DevIdentitySeed) {
    const now = new Date().toISOString();
    if (!this.users.has(seed.user.id)) {
      this.users.set(seed.user.id, {
        id: seed.user.id,
        displayName: seed.user.displayName,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!this.workspaces.has(seed.workspace.id)) {
      this.workspaces.set(seed.workspace.id, {
        id: seed.workspace.id,
        name: seed.workspace.name,
        createdBy: seed.user.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.memberships.add(this.membershipKey(seed.workspace.id, seed.user.id));
  }

  async getDatabaseStatus() {
    return "not_configured" as const;
  }

  async findUser(userId: string) {
    return this.users.get(userId);
  }

  async listWorkspaces(userId: string) {
    return [...this.workspaces.values()]
      .filter((workspace) => this.memberships.has(this.membershipKey(workspace.id, userId)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async hasWorkspaceMembership(workspaceId: string, userId: string) {
    return this.memberships.has(this.membershipKey(workspaceId, userId));
  }

  async listProjects(workspaceId: string) {
    return [...this.projects.values()]
      .filter((project) => project.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async findProject(workspaceId: string, projectId: string) {
    const project = this.projects.get(projectId);
    return project?.workspaceId === workspaceId ? project : undefined;
  }

  async createProject(input: ProjectCommandInput): Promise<CommandExecution<ControlProject> | CommandConflict> {
    const existing = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (existing) {
      const replay = this.resolveExisting(existing, input.requestHash);
      return replay.kind === "NOT_FOUND" ? { kind: "CONFLICT" } : replay;
    }

    const now = new Date().toISOString();
    const project: ControlProject = {
      id: input.projectId,
      workspaceId: input.workspaceId,
      name: input.name,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), {
      requestHash: input.requestHash,
      result: { kind: "PROJECT", value: project, status: 201 },
    });
    return { kind: "NEW", value: project, status: 201 } as const;
  }

  async updateProject(
    input: UpdateProjectCommandInput,
  ): Promise<CommandExecution<ControlProject> | CommandConflict | { kind: "NOT_FOUND"; status: 404 }> {
    const existing = this.commands.get(commandKey(input.scope, input.idempotencyKey));
    if (existing) {
      return this.resolveExisting(existing, input.requestHash);
    }

    const current = await this.findProject(input.workspaceId, input.projectId);
    if (!current) {
      this.commands.set(commandKey(input.scope, input.idempotencyKey), {
        requestHash: input.requestHash,
        result: { kind: "NOT_FOUND", status: 404 },
      });
      return { kind: "NOT_FOUND", status: 404 } as const;
    }

    const project: ControlProject = {
      ...current,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.commands.set(commandKey(input.scope, input.idempotencyKey), {
      requestHash: input.requestHash,
      result: { kind: "PROJECT", value: project, status: 200 },
    });
    return { kind: "NEW", value: project, status: 200 } as const;
  }

  private membershipKey(workspaceId: string, userId: string) {
    return `${workspaceId}:${userId}`;
  }

  private resolveExisting(
    existing: StoredCommand,
    requestHash: string,
  ): CommandExecution<ControlProject> | CommandConflict | { kind: "NOT_FOUND"; status: 404 } {
    if (existing.requestHash !== requestHash) {
      return { kind: "CONFLICT" };
    }
    if (existing.result.kind === "NOT_FOUND") {
      return existing.result;
    }
    return { kind: "REPLAY", value: existing.result.value, status: existing.result.status };
  }
}

export const createInMemoryControlPlaneStore = () => new InMemoryControlPlaneStore();
