import { Client } from "pg";

// Test-only mutex for the shared local database. C06 production recovery scans all
// workspaces by design, so its E2E must not overlap another suite's transient tasks.
export const C06_E2E_DATABASE_TEST_LOCK = 60_600_606;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const acquireC06E2EIsolation = async (databaseUrl, {
  timeoutMs = 90_000,
  pollIntervalMs = 100,
  verifyIdle = true,
} = {}) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const deadline = Date.now() + timeoutMs;
    let locked = false;
    while (!locked) {
      const result = await database.query(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [C06_E2E_DATABASE_TEST_LOCK],
      );
      locked = result.rows[0]?.locked === true;
      if (locked) break;
      if (Date.now() >= deadline) {
        throw new Error(`C06 E2E test isolation lock timed out after ${timeoutMs}ms.`);
      }
      await sleep(pollIntervalMs);
    }

    if (verifyIdle) {
      const state = await database.query(
        `SELECT
           (SELECT count(*)::integer FROM outbox_events WHERE published_at IS NULL AND dead_lettered_at IS NULL) AS unpublished_outbox_events,
           (SELECT count(*)::integer FROM task_runs WHERE status NOT IN ('SUCCEEDED', 'FAILED', 'ABANDONED')) AS nonterminal_task_runs`,
      );
      const { unpublished_outbox_events: unpublishedOutboxEvents, nonterminal_task_runs: nonterminalTaskRuns } = state.rows[0];
      if (unpublishedOutboxEvents !== 0) {
        throw new Error("C06 E2E refuses to start its Worker while existing unpublished outbox events are present.");
      }
      if (nonterminalTaskRuns !== 0) {
        throw new Error("C06 E2E refuses to start its Worker while any nonterminal TaskRun exists in the shared local database. Run it serially after Worker integration cleanup.");
      }
    }

    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          await database.query("SELECT pg_advisory_unlock($1::bigint)", [C06_E2E_DATABASE_TEST_LOCK]);
        } finally {
          await database.end();
        }
      },
    };
  } catch (error) {
    await database.end();
    throw error;
  }
};
