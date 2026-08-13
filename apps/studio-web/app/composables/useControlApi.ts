export type HealthStatus = {
  data: {
    service: string;
    status: string;
    build_version: string;
    dependencies: {
      database: "ok" | "unavailable" | "not_configured";
    };
  };
  request_id: string;
};

export type Workspace = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CurrentIdentity = {
  data: {
    user: {
      id: string;
      display_name: string;
      status: "ACTIVE" | "DISABLED";
      created_at: string;
      updated_at: string;
    };
    workspaces: Workspace[];
  };
  request_id: string;
};

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  created_at: string;
  updated_at: string;
};

export type ProjectList = {
  data: Project[];
  request_id: string;
};

export type ProjectResponse = {
  data: Project;
  request_id: string;
};

export function useControlApi() {
  async function health(): Promise<HealthStatus> {
    return $fetch<HealthStatus>("/api/v1/health");
  }

  async function currentIdentity(): Promise<CurrentIdentity> {
    return $fetch<CurrentIdentity>("/api/v1/me");
  }

  async function projects(): Promise<ProjectList> {
    return $fetch<ProjectList>("/api/v1/projects");
  }

  async function createProject(name: string, idempotencyKey: string): Promise<ProjectResponse> {
    return $fetch<ProjectResponse>("/api/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: { name },
    });
  }

  return { health, currentIdentity, projects, createProject };
}
