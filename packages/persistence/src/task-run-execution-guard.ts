import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { Client, type ClientConfig } from "pg";

export type TaskRunExecutionScope = { workspaceId: string; taskRunId: string };
export type AssertTaskRunExecutionActive = () => void;

export class TaskRunExecutionBusyError extends Error {
  constructor() {
    super("Another execution owns this video task; delivery must remain pending.");
    this.name = "TaskRunExecutionBusyError";
  }
}

export class TaskRunExecutionOwnershipLostError extends Error {
  constructor() {
    super("Video execution ownership was lost; durable recovery is required.");
    this.name = "TaskRunExecutionOwnershipLostError";
  }
}

export class TaskRunExecutionGenerationAmbiguousError extends Error {
  constructor() {
    super("Historical queued generations are ambiguous; controlled startup recovery is required.");
    this.name = "TaskRunExecutionGenerationAmbiguousError";
  }
}

export interface TaskRunExecutionGuard {
  withTaskRunExecution<T>(scope: TaskRunExecutionScope, execute: (assertActive: AssertTaskRunExecutionActive) => Promise<T>): Promise<T>;
}

export class InMemoryTaskRunExecutionGuard implements TaskRunExecutionGuard {
  private readonly active = new Set<string>();

  async withTaskRunExecution<T>(scope: TaskRunExecutionScope, execute: (assertActive: AssertTaskRunExecutionActive) => Promise<T>): Promise<T> {
    const key = JSON.stringify([scope.workspaceId, scope.taskRunId]);
    if (this.active.has(key)) throw new TaskRunExecutionBusyError();
    this.active.add(key);
    try {
      return await execute(() => {
        if (!this.active.has(key)) throw new TaskRunExecutionOwnershipLostError();
      });
    } finally {
      this.active.delete(key);
    }
  }
}

// A two-int PostgreSQL advisory key occupies a different key space from the
// repository's one-bigint transaction locks. Each invocation owns a new Client,
// so lock sessions cannot reenter each other or exhaust the query pool.
export class PostgresTaskRunExecutionGuard implements TaskRunExecutionGuard {
  constructor(private readonly config: ClientConfig) {}

  async withTaskRunExecution<T>(scope: TaskRunExecutionScope, execute: (assertActive: AssertTaskRunExecutionActive) => Promise<T>): Promise<T> {
    const hash = createHash("sha256").update(JSON.stringify(["video-execution-v1", scope.workspaceId, scope.taskRunId])).digest();
    const key = [hash.readInt32BE(0), hash.readInt32BE(4)];
    const socket = new Socket();
    const client = new Client({ ...this.config, stream: () => socket, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
    let lost = false;
    let acquired = false;
    const invalidate = () => { lost = true; };
    client.on("error", invalidate);
    client.on("end", invalidate);
    const assertActive = () => {
      if (lost) throw new TaskRunExecutionOwnershipLostError();
    };
    try {
      await client.connect();
      const result = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock($1::integer, $2::integer) as acquired", key);
      acquired = result.rows[0]?.acquired === true;
      assertActive();
      if (!acquired) throw new TaskRunExecutionBusyError();
      const value = await execute(assertActive);
      assertActive();
      return value;
    } finally {
      if (acquired && !lost) {
        // Closing the dedicated connection also releases an uncertain unlock.
        // Cleanup must never replace the original callback exception.
        await client.query("select pg_advisory_unlock($1::integer, $2::integer)", key).catch(() => undefined);
      }
      const closeDeadline = setTimeout(() => socket.destroy(), 1_000);
      try { await client.end().catch(() => undefined); }
      finally { clearTimeout(closeDeadline); socket.destroy(); }
    }
  }
}
