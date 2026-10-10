import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { providerAttempts } from "../src/schema.js";

const migrationsFolder = resolve(import.meta.dirname, "..", "drizzle");
const databaseUrl = process.env.LEGACY_FENCE_TEST_DATABASE_URL;

const assertLoopbackTestDatabaseUrl = (connectionString: string) => {
  // pg-connection-string rewrites URLs containing literal spaces before parsing;
  // reject them so this guard and the driver's effective host cannot diverge.
  if (/\s/.test(connectionString)) {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must not contain literal whitespace.");
  }
  let connection: URL;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must be a PostgreSQL URL for a loopback test server.");
  }
  if (connection.protocol !== "postgres:" && connection.protocol !== "postgresql:") {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must use the PostgreSQL URL scheme.");
  }
  // Accept one exact IPv4 loopback literal. Do not normalize host strings:
  // the PostgreSQL driver must receive the exact value that this guard checked.
  const loopbackHosts = new Set(["127.0.0.1"]);
  const hosts = [
    connection.hostname,
    ...connection.searchParams.getAll("host"),
    ...connection.searchParams.getAll("hostaddr"),
  ];
  if (hosts.some((host) => !loopbackHosts.has(host))) {
    throw new Error("LEGACY_FENCE_TEST_DATABASE_URL must use the exact loopback host 127.0.0.1 without aliases or formatting.");
  }
  return connectionString;
};

test("disposable migration database URL rejects non-loopback targets before connecting", () => {
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@postgres.example:5432/test_db"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@localhost:5432/test_db"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@[::1]:5432/test_db"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?host=postgres.example"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?host=127.0.0.1%20"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?host=127.0.0.1 "),
    /whitespace/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?host=%5B%3A%3A1%5D"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?hostaddr=127.0.0.1,192.0.2.1"),
    /loopback/,
  );
  assert.throws(
    () => assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db?host=127.0.0.1,127.0.0.1"),
    /loopback/,
  );
  assert.equal(
    assertLoopbackTestDatabaseUrl("postgres://test:test@127.0.0.1:5432/test_db"),
    "postgres://test:test@127.0.0.1:5432/test_db",
  );
});

// Historical migrations explicitly qualify public. An owned disposable database
// tests the unmodified chain without touching the caller's tables or journal.
const withIsolatedDatabase = async (run: (client: Client) => Promise<void>) => {
  assert.ok(databaseUrl);
  const safeDatabaseUrl = assertLoopbackTestDatabaseUrl(databaseUrl);
  const admin = new Client({ connectionString: safeDatabaseUrl });
  const databaseName = `legacy_worker_fence_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(safeDatabaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: isolatedUrl.toString() });
  let created = false;
  await admin.connect();
  try {
    const version = await admin.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10_000), 16, "Migration evidence requires PostgreSQL 16");
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    created = true;
    await client.connect();
    await run(client);
  } finally {
    try {
      try {
        await client.end();
      } finally {
        if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      }
    } finally {
      await admin.end();
    }
  }
};

const migrateThrough = async (client: Client, lastIndex: 26 | 27) => {
  const folder = await mkdtemp(resolve(tmpdir(), "legacy-worker-fence-migrations-"));
  try {
    const journal = JSON.parse(await readFile(resolve(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
    assert.equal(journal.entries.length, lastIndex + 1);
    await mkdir(resolve(folder, "meta"));
    await writeFile(resolve(folder, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      await copyFile(resolve(migrationsFolder, `${entry.tag}.sql`), resolve(folder, `${entry.tag}.sql`));
    }
    await migrate(drizzle({ client }), { migrationsFolder: folder });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};

const seedTask = async (client: Client) => {
  await client.query("INSERT INTO users (id, display_name) VALUES ('usr_fence', 'Offline fence fixture')");
  await client.query("INSERT INTO workspaces (id, name, created_by) VALUES ('ws_fence', 'Offline fence fixture', 'usr_fence')");
  await client.query("INSERT INTO projects (id, workspace_id, name) VALUES ('prj_fence', 'ws_fence', 'Offline fence fixture')");
  await client.query("INSERT INTO shots (id, workspace_id, project_id, position) VALUES ('sht_fence', 'ws_fence', 'prj_fence', 0)");
  await client.query(`INSERT INTO task_runs (id, workspace_id, project_id, shot_id, kind, status, input_snapshot)
    VALUES ('tsk_fence', 'ws_fence', 'prj_fence', 'sht_fence', 'VIDEO_GENERATION', 'RUNNING', '{}')`);
};

const requestIndex = async (client: Client) => (await client.query(`
  SELECT indexrelid::text AS oid, indisunique, indisvalid,
         pg_get_indexdef(indexrelid) AS definition, pg_get_expr(indpred, indrelid) AS predicate
  FROM pg_index
  WHERE indexrelid = 'public.provider_attempts_provider_request_key'::regclass
`)).rows[0];

const assertLegacyColumnFenced = async (client: Client) => {
  await assert.rejects(client.query("SELECT provider_request_id FROM provider_attempts"), { code: "42703" });
  await assert.rejects(client.query("UPDATE provider_attempts SET provider_request_id = 'offline-stale-id'"), { code: "42703" });
  await assert.rejects(client.query(`INSERT INTO provider_attempts (id, workspace_id, task_run_id, provider, model, provider_request_id)
    VALUES ('att_stale', 'ws_fence', 'tsk_fence', 'mock', 'mock-video-v1', 'offline-stale-id')`), { code: "42703" });
};

const assertCurrentMappingAndUniqueness = async (client: Client) => {
  const db = drizzle({ client });
  const attempt = (id: string, providerRequestId: string | null, provider = "mock") => ({
    id, workspaceId: "ws_fence", taskRunId: "tsk_fence", provider, model: "mock-video-v1", providerRequestId,
  });
  await db.insert(providerAttempts).values(attempt("att_current", "offline-current-request"));
  assert.equal((await db.select().from(providerAttempts).where(eq(providerAttempts.id, "att_current")))[0]?.providerRequestId, "offline-current-request");
  await assert.rejects(async () => {
    await db.insert(providerAttempts).values(attempt("att_duplicate", "offline-current-request"));
  }, (error: unknown) => {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return cause?.code === "23505" && cause.constraint === "provider_attempts_provider_request_key";
  });
  await db.insert(providerAttempts).values([
    attempt("att_other_provider", "offline-current-request", "mock-other"),
    attempt("att_null_one", null),
    attempt("att_null_two", null),
  ]);
  const index = await requestIndex(client);
  assert.equal(index.indisunique, true);
  assert.equal(index.indisvalid, true);
  assert.match(index.definition, /\(provider, provider_request_id_v2\)/);
  assert.equal(index.predicate, "(provider_request_id_v2 IS NOT NULL)");
};

test("PostgreSQL 16 upgrades 0027 in place, retaining all request IDs, reservations, and index identity", { skip: !databaseUrl }, async () => {
  await withIsolatedDatabase(async (client) => {
    await migrateThrough(client, 26);
    await seedTask(client);
    await client.query(`INSERT INTO provider_attempts
      (id, workspace_id, task_run_id, provider, model, provider_request_id, created_at, status)
      VALUES
      ('att_known', 'ws_fence', 'tsk_fence', 'mock', 'mock-video-v1', 'offline-known-request', '2026-10-09T01:02:03.456Z', 'SUBMITTED'),
      ('att_legacy_known', 'ws_fence', 'tsk_fence', 'mock', 'mock-video-v1', 'offline-legacy-request', '2026-10-09T01:02:03.456Z', 'PROCESSING'),
      ('att_uncertain', 'ws_fence', 'tsk_fence', 'mock', 'mock-video-v1', NULL, '2026-10-09T02:03:04.567Z', 'CREATED')`);
    await migrateThrough(client, 27);
    const backfilled = await client.query("SELECT submission_reserved_at, created_at FROM provider_attempts WHERE id = 'att_uncertain'");
    assert.equal(backfilled.rows[0].submission_reserved_at.toISOString(), "2026-10-09T02:03:04.567Z");
    assert.deepEqual(backfilled.rows[0].submission_reserved_at, backfilled.rows[0].created_at);
    assert.equal((await client.query("SELECT submission_reserved_at FROM provider_attempts WHERE id = 'att_legacy_known'")).rows[0].submission_reserved_at, null);
    await client.query("UPDATE provider_attempts SET submission_reserved_at = '2026-10-09T01:02:03.456Z' WHERE id = 'att_known'");
    await client.query(`INSERT INTO provider_attempts (id, workspace_id, task_run_id, provider, model)
      VALUES ('att_unreserved', 'ws_fence', 'tsk_fence', 'mock', 'mock-video-v1')`);
    const before = await client.query("SELECT to_jsonb(attempt) AS row FROM provider_attempts attempt ORDER BY id");
    const beforeIndex = await requestIndex(client);
    const expectedRows = before.rows.map(({ row }) => {
      const { provider_request_id: providerRequestId, ...otherColumns } = row;
      return { row: { ...otherColumns, provider_request_id_v2: providerRequestId } };
    });

    await migrate(drizzle({ client }), { migrationsFolder });
    assert.deepEqual((await client.query("SELECT to_jsonb(attempt) AS row FROM provider_attempts attempt ORDER BY id")).rows, expectedRows);
    assert.deepEqual(await requestIndex(client), {
      ...beforeIndex,
      definition: beforeIndex.definition.replaceAll("provider_request_id", "provider_request_id_v2"),
      predicate: beforeIndex.predicate.replaceAll("provider_request_id", "provider_request_id_v2"),
    });
    await assertLegacyColumnFenced(client);
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM provider_attempts")).rows[0].count, 4);
    const current = await drizzle({ client }).select().from(providerAttempts).where(eq(providerAttempts.id, "att_known"));
    assert.equal(current[0]?.providerRequestId, "offline-known-request");
    assert.equal(new Date(current[0]!.submissionReservedAt!).toISOString(), "2026-10-09T01:02:03.456Z");
    await assertCurrentMappingAndUniqueness(client);
    assert.equal((await client.query('SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations')).rows[0].count, 29);
  });
});

test("PostgreSQL 16 fresh migrations include the fence and rerun without changing data", { skip: !databaseUrl }, async () => {
  await withIsolatedDatabase(async (client) => {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder });
    await seedTask(client);
    await assertLegacyColumnFenced(client);
    await assertCurrentMappingAndUniqueness(client);
    const before = await client.query("SELECT to_jsonb(attempt) AS row FROM provider_attempts attempt ORDER BY id");
    await migrate(db, { migrationsFolder });
    assert.deepEqual((await client.query("SELECT to_jsonb(attempt) AS row FROM provider_attempts attempt ORDER BY id")).rows, before.rows);
    assert.equal((await client.query('SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations')).rows[0].count, 29);
  });
});
