import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { clearInternalEventQueues } from "@alchemy-video/task-queue";
import { Client } from "pg";

import { acquireC06E2EIsolation } from "../../../packages/persistence/tests/support/c06-e2e-isolation.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controlApiRoot = resolve(repoRoot, "apps", "control-api");
const taskWorkerRoot = resolve(repoRoot, "apps", "task-worker");
const studioWebRoot = resolve(repoRoot, "apps", "studio-web");
const controlApiPort = Number(process.env.C06_E2E_CONTROL_API_PORT ?? "3032");
const studioPort = Number(process.env.C06_E2E_STUDIO_PORT ?? "3031");
if (!Number.isInteger(controlApiPort) || controlApiPort < 1 || controlApiPort > 65_535) throw new Error("C06_E2E_CONTROL_API_PORT must be a valid port.");
if (!Number.isInteger(studioPort) || studioPort < 1 || studioPort > 65_535) throw new Error("C06_E2E_STUDIO_PORT must be a valid port.");
const studioBindHost = process.env.C06_E2E_STUDIO_HOST ?? "127.0.0.1";
const studioOriginHost = process.env.C06_E2E_STUDIO_ORIGIN_HOST ?? studioBindHost;
if (!new Set(["127.0.0.1", "::1"]).has(studioBindHost)) throw new Error("C06_E2E_STUDIO_HOST must be a loopback address.");
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(studioOriginHost)) throw new Error("C06_E2E_STUDIO_ORIGIN_HOST must be a local browser origin.");
const urlHost = (host) => host.includes(":") ? `[${host}]` : host;
const apiOrigin = `http://127.0.0.1:${controlApiPort}`;
const studioOrigin = `http://${urlHost(studioOriginHost)}:${studioPort}`;
const studioProbeOrigin = `http://${urlHost(studioBindHost)}:${studioPort}`;
const databaseUrl = process.env.C06_E2E_DATABASE_URL ?? "postgresql://video_local:video_local@127.0.0.1:15432/video_local";
const redisUrl = "redis://127.0.0.1:6380";
const storageConfig = {
  endpoint: "http://127.0.0.1:9002",
  region: "us-east-1",
  bucket: "video-local",
  accessKeyId: "video_local",
  secretAccessKey: "video_local_secret",
};
const onePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0f7kAAAAASUVORK5CYII=",
  "base64",
));
const secondOnePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));
const fixturePath = resolve(repoRoot, ".codex-longrun", "c06-studio-generation-1x1.png");
const secondFixturePath = resolve(repoRoot, ".codex-longrun", "c06-studio-generation-second-1x1.png");
const uiScriptPath = resolve(controlApiRoot, "tests", "c06-studio-ui-e2e.py");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const resultPrefix = "C06_STUDIO_UI_E2E_RESULT=";

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const assertTcpReachable = (host, port, name) => new Promise((resolveReachable, rejectReachable) => {
  const socket = createConnection({ host, port });
  const finish = (error) => {
    socket.destroy();
    if (error) rejectReachable(error);
    else resolveReachable();
  };
  socket.setTimeout(5_000, () => finish(new Error(`${name} did not accept a local TCP connection within 5 seconds.`)));
  socket.once("connect", () => finish());
  socket.once("error", () => finish(new Error(`${name} is unavailable at ${host}:${port}.`)));
});

const assertLocalRuntimeReady = async () => {
  await Promise.all([
    assertTcpReachable("127.0.0.1", 15432, "PostgreSQL"),
    assertTcpReachable("127.0.0.1", 6380, "Redis"),
    assertTcpReachable("127.0.0.1", 9002, "MinIO"),
  ]);
};

const assertPortAvailableOnHost = (port, host) => new Promise((resolveAvailable, rejectAvailable) => {
  const probe = createServer();
  probe.once("error", () => rejectAvailable(new Error(`Port ${host}:${port} is already in use; refusing to stop an existing service.`)));
  probe.listen(port, host, () => probe.close(resolveAvailable));
});

const assertPortAvailable = (port, host) => host
  ? assertPortAvailableOnHost(port, host)
  : Promise.all([
      assertPortAvailableOnHost(port, "127.0.0.1"),
      assertPortAvailableOnHost(port, "::1"),
      assertPortAvailableOnHost(port, "::"),
    ]);

const waitForPortsReleased = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([assertPortAvailable(studioPort), assertPortAvailable(controlApiPort)]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`C06 E2E did not release ${studioPort}/${controlApiPort} during cleanup.`);
};

const pnpmCommand = (args) => process.platform === "win32"
  ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`] }
  : { command: "pnpm", args };

const requireSuccess = (result, name) => {
  if (result.error) throw new Error(`${name} could not start: ${result.error.name}: ${result.error.message}.`);
  if (result.status !== 0) throw new Error(`${name} failed with exit status ${result.status ?? "unknown"}.`);
};

const startService = (cwd, args, environment) => {
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let spawnError;
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-20_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", (error) => { spawnError = error; });
  Object.defineProperties(child, {
    supervisorOutput: { get: () => output },
    supervisorSpawnError: { get: () => spawnError },
  });
  return child;
};

const stopService = (processHandle) => {
  if (!processHandle || processHandle.exitCode !== null || !processHandle.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  processHandle.kill("SIGTERM");
};

const waitFor = async (url, name, processes) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const exited = processes.find((processHandle) => typeof processHandle.exitCode === "number");
    if (exited) {
      const output = String(exited.supervisorOutput ?? "").trim().slice(-2_000) || "<no process output>";
      const spawnError = exited.supervisorSpawnError instanceof Error
        ? `${exited.supervisorSpawnError.name}: ${exited.supervisorSpawnError.message}`
        : "none";
      throw new Error(`${name} exited before its HTTP endpoint became available (exit=${exited.exitCode}, signal=${exited.signalCode ?? "none"}, spawn_error=${spawnError}): ${output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The service is still starting.
    }
    await sleep(500);
  }
  throw new Error(`${name} did not return HTTP 200 before the timeout.`);
};

const hasObject = async (client, objectKey) => {
  try {
    await client.send(new HeadObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
};

const publicResponseHasNoInternalFields = async (projectName) => {
  const projects = await (await fetch(`${apiOrigin}/api/v1/projects`)).json();
  const project = projects.data.find((candidate) => candidate.name === projectName);
  assert.ok(project, "C06 E2E project is missing from the public project list.");
  const detail = await (await fetch(`${apiOrigin}/api/v1/projects/${project.id}`)).json();
  const serialized = JSON.stringify(detail);
  for (const sensitive of ["provider_request_id", "request_payload", "response_payload", "object_key", "X-Veyra", "Authorization"]) {
    assert.equal(serialized.includes(sensitive), false, `Public C06 project detail exposed ${sensitive}.`);
  }
};

const cleanupProject = async (projectNames, storage, commandSeedPrefix) => {
  assert.ok(Array.isArray(projectNames) && projectNames.length > 0, "C06 E2E cleanup requires its generated project names.");
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const projects = await database.query(
      "SELECT id FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[])",
      ["ws_dev_default", projectNames],
    );
    const projectIds = projects.rows.map(({ id }) => id);
    const assets = await database.query(
      "SELECT assets.object_key FROM assets INNER JOIN projects ON projects.id = assets.project_id WHERE projects.workspace_id = $1 AND projects.name = ANY($2::text[])",
      ["ws_dev_default", projectNames],
    );
    const objectKeys = assets.rows.map(({ object_key: objectKey }) => objectKey);
    await Promise.all(objectKeys.map((objectKey) => storage.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey })).catch(() => undefined)));
    for (const projectId of projectIds) {
      await database.query("DELETE FROM outbox_events WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
    }
    await database.query("DELETE FROM command_deduplications WHERE idempotency_key LIKE $1", [`%${commandSeedPrefix}%`]);
    await database.query(
      "DELETE FROM task_runs USING projects WHERE task_runs.project_id = projects.id AND projects.workspace_id = $1 AND projects.name = ANY($2::text[])",
      ["ws_dev_default", projectNames],
    );
    const deleted = await database.query(
      "DELETE FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[]) RETURNING id",
      ["ws_dev_default", projectNames],
    );
    const remaining = await database.query(
      "SELECT count(*)::integer AS count FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[])",
      ["ws_dev_default", projectNames],
    );
    assert.equal(remaining.rows[0].count, 0, "C06 E2E project cleanup left a database record.");
    assert.ok(deleted.rowCount >= 0 && deleted.rowCount <= projectNames.length, "C06 E2E cleanup removed an unexpected project count.");
    for (const objectKey of objectKeys) {
      assert.equal(await hasObject(storage, objectKey), false, `C06 E2E object cleanup left ${objectKey}.`);
    }
    for (const projectId of projectIds) {
      const [outbox] = await Promise.all([
        database.query("SELECT count(*)::integer AS count FROM outbox_events WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]),
      ]);
      assert.equal(outbox.rows[0].count, 0, "C06 E2E cleanup left project outbox rows.");
    }
    const deduplications = await database.query("SELECT count(*)::integer AS count FROM command_deduplications WHERE idempotency_key LIKE $1", [`%${commandSeedPrefix}%`]);
    assert.equal(deduplications.rows[0].count, 0, "C06 E2E cleanup left test command deduplications.");
    return { projects: deleted.rowCount, objects: objectKeys.length };
  } finally {
    await database.end();
  }
};

const taskRunProviderRecord = async (projectName) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query(
      `SELECT task_runs.id, task_runs.status, task_runs.result_asset_id,
              task_runs.input_snapshot ->> 'duration' AS task_duration,
              shots.generation_settings -> 'video_settings' ->> 'duration_seconds' AS saved_duration,
              shots.generation_settings -> 'video_settings' ->> 'resolution' AS saved_resolution,
              shots.generation_settings -> 'video_settings' ->> 'ratio' AS saved_ratio,
              count(provider_attempts.id)::integer AS attempt_count,
              count(provider_attempts.provider_request_id)::integer AS submitted_attempt_count,
              min(provider_attempts.provider_request_id) AS provider_request_id,
              array_agg(provider_attempts.provider_request_id ORDER BY provider_attempts.created_at)
                FILTER (WHERE provider_attempts.provider_request_id IS NOT NULL) AS provider_request_ids
       FROM task_runs
       INNER JOIN projects ON projects.id = task_runs.project_id
       INNER JOIN shots ON shots.workspace_id = task_runs.workspace_id AND shots.id = task_runs.shot_id
       LEFT JOIN provider_attempts ON provider_attempts.workspace_id = task_runs.workspace_id AND provider_attempts.task_run_id = task_runs.id
       WHERE projects.workspace_id = $1 AND projects.name = $2
       GROUP BY task_runs.id, task_runs.status, task_runs.result_asset_id, task_runs.input_snapshot, shots.generation_settings`,
      ["ws_dev_default", projectName],
    );
    assert.equal(result.rowCount, 1, "C06 retry E2E expected exactly one TaskRun.");
    return result.rows[0];
  } finally {
    await database.end();
  }
};

const assertMockApiRuntimeProfile = async (input) => {
  const projectName = `C06 Mock runtime probe ${input.suffix}`;
  const commandKey = (name) => `c06-${input.commandSeedPrefix}-mock-profile-${name}`;
  const request = async (path, options) => {
    const response = await fetch(`${apiOrigin}${path}`, options);
    assert.ok(response.ok, `C06 Mock runtime probe request ${path} failed with HTTP ${response.status}.`);
    return response.json();
  };

  const project = await request("/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey("project") },
    body: JSON.stringify({ name: projectName }),
  });
  const shot = await request(`/api/v1/projects/${project.data.id}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey("shot") },
    body: JSON.stringify({
      position: 0,
      prompt: "Verify the local Mock runtime profile.",
      generation_settings: { video_settings: { duration_seconds: 8, resolution: "480p", ratio: "16:9" } },
      reference_bindings: [],
    }),
  });
  await request(`/api/v1/shots/${shot.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey("ready") },
    body: JSON.stringify({ status: "READY" }),
  });
  await request(`/api/v1/shots/${shot.data.id}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey("generation") },
    body: "{}",
  });
  const taskRun = await taskRunProviderRecord(projectName);
  assert.equal(Number(taskRun.task_duration), 1, "The C06 Control API process did not use the fixed local Mock profile.");
  assert.equal(taskRun.saved_resolution, "480p", "The C06 Mock runtime probe did not retain the Shot setting separately.");
  await cleanupProject([projectName], input.storage, input.commandSeedPrefix);
};

const assertFreshRetriedAttempt = async (projectName, failedRecord) => {
  const recovered = await taskRunProviderRecord(projectName);
  assert.equal(recovered.id, failedRecord.id, "C06 retry E2E did not recover the failed TaskRun.");
  assert.equal(recovered.status, "SUCCEEDED", "C06 retry E2E did not persist a completed retry.");
  assert.ok(recovered.result_asset_id, "C06 retry E2E did not persist a result asset.");
  assert.equal(recovered.attempt_count, 2, "C06 retry E2E did not preserve the failed attempt and create one fresh ProviderAttempt.");
  assert.equal(recovered.submitted_attempt_count, 2, "C06 retry E2E did not retain both provider request IDs.");
  assert.deepEqual(recovered.provider_request_ids?.[0], failedRecord.provider_request_id, "C06 retry E2E changed the original provider request ID.");
  assert.equal(recovered.provider_request_ids?.[1] === failedRecord.provider_request_id, false, "C06 retry E2E reused a terminal provider request ID.");
};

const runStudioUiTest = (input) => {
  const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--fixture", fixturePath,
    "--fixture", secondFixturePath,
    "--project-name", input.projectName,
    "--secondary-project-name", input.secondaryProjectName,
    "--mode", input.mode,
    "--command-seed", input.commandSeed,
  ], { cwd: repoRoot, env: input.environment, encoding: "utf8", timeout: 120_000, windowsHide: true });
  if (uiTest.error) throw new Error(`C06 Studio ${input.mode} UI E2E Python subprocess failed: ${uiTest.error.name}: ${uiTest.error.message}.`);
  const output = `${uiTest.stdout ?? ""}\n${uiTest.stderr ?? ""}`;
  const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
  if (!resultLine) throw new Error(`C06 Studio ${input.mode} UI E2E did not emit its structured result (status=${uiTest.status ?? "null"}, output=${output.trim().slice(0, 2000) || "<no output>"}).`);
  const result = JSON.parse(resultLine.slice(resultPrefix.length));
  if (uiTest.status !== 0 || !result.ok) throw new Error(`C06 Studio ${input.mode} UI E2E failed: ${result.error ?? `exit ${uiTest.status ?? "unknown"}`}.`);
  return result;
};

const stopWorker = async (processHandle, name) => {
  stopService(processHandle);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    await sleep(100);
  }
  throw new Error(`${name} did not stop after its controlled test phase.`);
};

const taskRunDiagnostics = async (projectName) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const taskRuns = await database.query(
      `SELECT task_runs.id, task_runs.status, task_runs.error, task_runs.updated_at,
              provider_attempts.id AS provider_attempt_id, provider_attempts.status AS provider_attempt_status,
              provider_attempts.provider_request_id, provider_attempts.response_payload,
              outbox_events.id AS outbox_event_id, outbox_events.event_type AS outbox_event_type,
              outbox_events.published_at, outbox_events.available_at, outbox_events.publish_attempts,
              outbox_events.last_error, outbox_events.dead_lettered_at,
              event_consumptions.attempts AS consumption_attempts, event_consumptions.completed_at,
              event_consumptions.dead_lettered_at AS consumption_dead_lettered_at,
              event_consumptions.last_error AS consumption_last_error
       FROM task_runs
       INNER JOIN projects ON projects.id = task_runs.project_id
       LEFT JOIN provider_attempts ON provider_attempts.workspace_id = task_runs.workspace_id AND provider_attempts.task_run_id = task_runs.id
       LEFT JOIN outbox_events ON outbox_events.workspace_id = task_runs.workspace_id AND outbox_events.aggregate_type = 'task_run' AND outbox_events.aggregate_id = task_runs.id
       LEFT JOIN event_consumptions ON event_consumptions.workspace_id = task_runs.workspace_id AND event_consumptions.event_id = outbox_events.id AND event_consumptions.consumer_name = 'task-run-transition'
       WHERE projects.workspace_id = $1 AND projects.name = $2
       ORDER BY task_runs.created_at, outbox_events.occurred_at, provider_attempts.created_at`,
      ["ws_dev_default", projectName],
    );
    return taskRuns.rows;
  } finally {
    await database.end();
  }
};

const waitForWorkerReady = async (processHandle, name) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`${name} exited before ready: ${String(processHandle.supervisorOutput ?? "").trim().slice(-4_000) || "<no output>"}`);
    }
    if (String(processHandle.supervisorOutput ?? "").includes('"event":"task_worker.ready"')) return;
    await sleep(250);
  }
  throw new Error(`${name} did not report task_worker.ready before timeout: ${String(processHandle.supervisorOutput ?? "").trim().slice(-4_000) || "<no output>"}`);
};

const run = async () => {
  const suffix = randomUUID();
  const commandSeedPrefix = suffix.replaceAll("-", "").slice(0, 8);
  const projectName = `C06 Studio E2E ${suffix}`;
  const secondaryProjectName = `${projectName} B`;
  const projectNames = [projectName, secondaryProjectName];
  const failedQueueName = `alchemy-video-c06-failure-${suffix}`;
  const failedDeadLetterQueueName = `${failedQueueName}-dead-letter`;
  const successfulQueueName = `alchemy-video-c06-retry-${suffix}`;
  const successfulDeadLetterQueueName = `${successfulQueueName}-dead-letter`;
  const environment = {
    ...process.env,
    CONTROL_API_PORT: String(controlApiPort),
    CONTROL_API_ORIGIN: apiOrigin,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: storageConfig.endpoint,
    S3_REGION: storageConfig.region,
    S3_BUCKET: storageConfig.bucket,
    S3_ACCESS_KEY: storageConfig.accessKeyId,
    S3_SECRET_KEY: storageConfig.secretAccessKey,
    S3_BROWSER_ORIGINS: `${studioOrigin},http://localhost:${studioPort}`,
    LOCAL_AUTH_MODE: "dev",
    VIDEO_PROVIDER: "mock",
    VEYRA_AUTH_ENABLED: "false",
    BUILD_VERSION: `c06-e2e-${suffix}`,
    PYTHONDONTWRITEBYTECODE: "1",
    HOST: studioBindHost,
    PORT: String(studioPort),
    STUDIO_NUXT_BUILD_DIR: resolve(repoRoot, ".codex-longrun", "c06-studio-build", suffix),
    STUDIO_NITRO_OUTPUT_DIR: resolve(repoRoot, ".codex-longrun", "c06-studio-output", suffix),
  };
  const workerEnvironment = (queueName, deadLetterQueueName, outcome) => ({
    ...environment,
    TASK_QUEUE_NAME: queueName,
    TASK_DEAD_LETTER_QUEUE_NAME: deadLetterQueueName,
    MOCK_VIDEO_OUTCOME: outcome,
  });
  const storage = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: storageConfig.accessKeyId, secretAccessKey: storageConfig.secretAccessKey },
  });
  let apiProcess;
  let failedWorkerProcess;
  let successfulWorkerProcess;
  let studioProcess;
  let executionError;
  const cleanupFailures = [];
  let cleanupResult;
  let isolation;
  let portsClaimed = false;
  let cleanupRequired = false;

  try {
    await assertLocalRuntimeReady();
    await Promise.all([assertPortAvailable(studioPort), assertPortAvailable(controlApiPort)]);
    portsClaimed = true;
    isolation = await acquireC06E2EIsolation(databaseUrl);
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrate.command, migrate.args, { cwd: repoRoot, env: environment, stdio: "ignore", windowsHide: true }), "C06 E2E database migration");
    await Promise.all([
      writeFile(fixturePath, onePixelPng, { flag: "w" }),
      writeFile(secondFixturePath, secondOnePixelPng, { flag: "w" }),
    ]);
    cleanupRequired = true;
    assert.equal(createHash("sha256").update(onePixelPng).digest("hex").length, 64);
    assert.notEqual(
      createHash("sha256").update(onePixelPng).digest("hex"),
      createHash("sha256").update(secondOnePixelPng).digest("hex"),
      "C06 Studio E2E fixtures must be different images.",
    );

    apiProcess = startService(controlApiRoot, ["--import", "tsx", "src/index.ts"], environment);
    const apiHealth = await waitFor(`${apiOrigin}/api/v1/health`, "Control API", [apiProcess]);
    assert.equal((await apiHealth.json()).data.build_version, environment.BUILD_VERSION, "C06 did not start its isolated Control API instance.");
    await assertMockApiRuntimeProfile({ suffix, commandSeedPrefix, storage });
    failedWorkerProcess = startService(
      taskWorkerRoot,
      ["--import", "tsx", "src/index.ts"],
      workerEnvironment(failedQueueName, failedDeadLetterQueueName, "failed"),
    );
    await waitForWorkerReady(failedWorkerProcess, "C06 failed Mock Worker");
    studioProcess = startService(studioWebRoot, [studioServerScriptPath], environment);
    await waitFor(`${studioProbeOrigin}/`, "Studio", [apiProcess, failedWorkerProcess, studioProcess]);
    const studioProxyHealth = await waitFor(`${studioProbeOrigin}/api/v1/health`, "Studio Control API proxy", [apiProcess, failedWorkerProcess, studioProcess]);
    assert.equal((await studioProxyHealth.json()).data.build_version, environment.BUILD_VERSION, "Studio did not proxy to the isolated C06 Control API instance.");

    const failedResult = runStudioUiTest({ mode: "failure", projectName, secondaryProjectName, commandSeed: suffix, environment });
    assert.equal(failedResult.retry_control_visible, true, "C06 failure E2E did not expose the Studio retry command.");
    assert.match(failedResult.failure_text, /本次创作尚未完成/, "C06 failure E2E did not expose the public failure message.");
    assert.equal(failedResult.reference_images.length, 2, "C06 failure E2E did not confirm two reference images.");
    for (const image of failedResult.reference_images) {
      assert.ok(image.width > 0 && image.height > 0, "C06 failure E2E did not decode an uploaded PNG reference.");
    }
    assert.equal(failedResult.mobile_viewport, "390x844", "C06 failure E2E did not verify the required mobile viewport.");
    assert.equal(failedResult.command_seed_prefix, commandSeedPrefix, "C06 failure E2E did not install its isolated command seed.");
    const failedTaskRun = await taskRunProviderRecord(projectName);
    assert.equal(failedTaskRun.status, "FAILED", "C06 failure E2E did not persist a public failure state.");
    assert.equal(failedTaskRun.attempt_count, 1, "C06 failure E2E did not persist one ProviderAttempt.");
    assert.equal(failedTaskRun.submitted_attempt_count, 1, "C06 failure E2E did not persist its provider request ID.");
    assert.ok(failedTaskRun.provider_request_id, "C06 failure E2E did not retain a provider request ID for UI retry.");
    assert.equal(Number(failedTaskRun.saved_duration), 8, "C06 failure E2E did not save the selected 8-second duration.");
    assert.equal(failedTaskRun.saved_resolution, "480p", "C06 failure E2E did not save the selected 480p resolution.");
    assert.equal(failedTaskRun.saved_ratio, "16:9", "C06 failure E2E did not save the fixed 16:9 ratio.");
    assert.equal(Number(failedTaskRun.task_duration), 1, "C06 failure E2E changed the deterministic Mock task duration.");
    await stopWorker(failedWorkerProcess, "C06 failed Mock Worker");
    failedWorkerProcess = undefined;

    successfulWorkerProcess = startService(
      taskWorkerRoot,
      ["--import", "tsx", "src/index.ts"],
      workerEnvironment(successfulQueueName, successfulDeadLetterQueueName, "succeeded"),
    );
    await waitForWorkerReady(successfulWorkerProcess, "C06 successful Mock Worker");
    const retryResult = runStudioUiTest({ mode: "retry", projectName, secondaryProjectName, commandSeed: suffix, environment });
    assert.ok(retryResult.video_width > 0 && retryResult.video_height > 0, "C06 Studio retry preview did not decode a video frame.");
    assert.ok(retryResult.duration > 0, "C06 Studio retry preview did not report a playable duration.");
    assert.equal(retryResult.desktop_viewport, "1280x720", "C06 retry E2E did not verify the required desktop viewport.");
    assert.equal(retryResult.command_seed_prefix, commandSeedPrefix, "C06 retry E2E did not reuse its isolated command seed.");
    await assertFreshRetriedAttempt(projectName, failedTaskRun);
    await publicResponseHasNoInternalFields(projectName);
    console.log(`C06 Studio failure/retry UI E2E passed: visible provider failure, retry control, ${retryResult.video_width}x${retryResult.video_height}, ${retryResult.duration}s.`);
  } catch (error) {
    const processOutput = (name, processHandle) => `${name}: ${String(processHandle?.supervisorOutput ?? "<not started>").trim().slice(-20_000)}`;
    let diagnostics = "<unavailable>";
    try {
      diagnostics = JSON.stringify(await taskRunDiagnostics(projectName));
    } catch (diagnosticError) {
      diagnostics = `diagnostic query failed: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`;
    }
    executionError = new Error([
      error instanceof Error ? error.message : String(error),
      `Database diagnostics: ${diagnostics}`,
      processOutput("Control API", apiProcess),
      processOutput("Failed Worker", failedWorkerProcess),
      processOutput("Successful Worker", successfulWorkerProcess),
      processOutput("Studio", studioProcess),
    ].join("\n"));
  }

  try {
    stopService(studioProcess);
    stopService(successfulWorkerProcess);
    stopService(failedWorkerProcess);
    stopService(apiProcess);
    if (portsClaimed) await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupRequired) {
    try {
      cleanupResult = await cleanupProject(projectNames, storage, commandSeedPrefix);
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await clearInternalEventQueues({ redisUrl, queueName: failedQueueName, deadLetterQueueName: failedDeadLetterQueueName });
      await clearInternalEventQueues({ redisUrl, queueName: successfulQueueName, deadLetterQueueName: successfulDeadLetterQueueName });
      await Promise.all([
        rm(fixturePath, { force: true }),
        rm(secondFixturePath, { force: true }),
        rm(environment.STUDIO_NUXT_BUILD_DIR, { recursive: true, force: true }),
        rm(environment.STUDIO_NITRO_OUTPUT_DIR, { recursive: true, force: true }),
      ]);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await isolation?.release();
  } catch (error) {
    cleanupFailures.push(error);
  } finally {
    storage.destroy();
  }

  if (cleanupFailures.length) {
    const cleanupError = new AggregateError(cleanupFailures, "C06 E2E cleanup failed.");
    if (executionError) throw new AggregateError([executionError, cleanupError], "C06 E2E failed and cleanup was incomplete.");
    throw cleanupError;
  }
  if (executionError) throw executionError;
  if (cleanupRequired) console.log(`C06 E2E cleanup passed: removed ${cleanupResult.projects} projects, ${cleanupResult.objects} objects, two isolated queues, fixture, and child services.`);
};

await run();
