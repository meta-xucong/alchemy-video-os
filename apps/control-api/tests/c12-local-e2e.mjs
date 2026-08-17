import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { clearCreativePlanningQueues, clearInternalEventQueues, clearMediaRuntimeQueues, clearProductionQueues } from "@alchemy-video/task-queue";
import { Client } from "pg";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controlApiRoot = resolve(repoRoot, "apps", "control-api");
const workflowWorkerRoot = resolve(repoRoot, "apps", "workflow-worker");
const taskWorkerRoot = resolve(repoRoot, "apps", "task-worker");
const productionWorkerRoot = resolve(repoRoot, "apps", "production-worker");
const studioWebRoot = resolve(repoRoot, "apps", "studio-web");
const mediaRuntimeRoot = resolve(repoRoot, "services", "media-runtime");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const uiScriptPath = resolve(controlApiRoot, "tests", "c12-studio-ui-e2e.py");
const localPort = (name, fallback) => {
  const value = process.env[name];
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error(`${name} must be a TCP port.`);
  return port;
};
const controlApiPort = localPort("C12_E2E_CONTROL_API_PORT", 3332);
const studioPort = localPort("C12_E2E_STUDIO_PORT", 3331);
const runtimePort = localPort("C12_E2E_RUNTIME_PORT", 3433);
const host = "127.0.0.1";
const apiOrigin = `http://${host}:${controlApiPort}`;
const studioOrigin = `http://${host}:${studioPort}`;
const runtimeOrigin = `http://${host}:${runtimePort}/`;
const databaseAdminUrl = "postgresql://video_local:video_local@127.0.0.1:15432/postgres";
const redisUrl = "redis://127.0.0.1:6380";
const storageConfig = {
  endpoint: "http://127.0.0.1:9002",
  region: "us-east-1",
  bucket: "video-local",
  accessKeyId: "video_local",
  secretAccessKey: "video_local_secret",
};
const ffmpegPath = resolve(repoRoot, "node_modules", ".pnpm", "ffmpeg-static@5.3.0", "node_modules", "ffmpeg-static", "ffmpeg.exe");
const ffprobePath = resolve(repoRoot, "node_modules", ".pnpm", "ffprobe-static@3.1.0", "node_modules", "ffprobe-static", "bin", "win32", "x64", "ffprobe.exe");
const resultPrefix = "C12_STUDIO_UI_E2E_RESULT=";

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const assertTcpReachable = (port, name) => new Promise((resolveReachable, rejectReachable) => {
  const socket = createConnection({ host, port });
  const finish = (error) => {
    socket.destroy();
    if (error) rejectReachable(error);
    else resolveReachable();
  };
  socket.setTimeout(5_000, () => finish(new Error(`${name} did not accept a local TCP connection.`)));
  socket.once("connect", () => finish());
  socket.once("error", () => finish(new Error(`${name} is unavailable at ${host}:${port}.`)));
});

const assertPortAvailable = (port) => new Promise((resolveAvailable, rejectAvailable) => {
  const probe = createServer();
  probe.once("error", () => rejectAvailable(new Error(`Port ${port} is already in use; refusing to stop an existing service.`)));
  probe.listen(port, host, () => probe.close(resolveAvailable));
});

const createIsolatedDatabase = async (databaseName) => {
  if (!/^c12_e2e_[a-z0-9]+$/.test(databaseName)) throw new Error("C12 E2E generated an unsafe database name.");
  const administrator = new Client({ connectionString: databaseAdminUrl });
  await administrator.connect();
  try {
    await administrator.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await administrator.end();
  }
  return `postgresql://video_local:video_local@127.0.0.1:15432/${databaseName}`;
};

const dropIsolatedDatabase = async (databaseName) => {
  const administrator = new Client({ connectionString: databaseAdminUrl });
  await administrator.connect();
  try {
    await administrator.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]);
    await administrator.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await administrator.end();
  }
};

const pnpmCommand = (args) => process.platform === "win32"
  ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`] }
  : { command: "pnpm", args };

const requireSuccess = (result, name) => {
  if (result.error) throw new Error(`${name} could not start: ${result.error.message}.`);
  if (result.status !== 0) throw new Error(`${name} failed with exit status ${result.status ?? "unknown"}.`);
};

const startService = (command, args, cwd, environment) => {
  const child = spawn(command, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-4_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  Object.defineProperty(child, "supervisorOutput", { get: () => output });
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
    const exited = processes.find((processHandle) => processHandle?.exitCode !== null);
    if (exited) throw new Error(`${name} exited before ready: ${String(exited.supervisorOutput ?? "").trim().slice(-2_000) || "<no output>"}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The controlled local process is still starting.
    }
    await sleep(250);
  }
  throw new Error(`${name} did not return HTTP 200 before timeout.`);
};

const waitForTcp = async (port, name, processes) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const exited = processes.find((processHandle) => processHandle?.exitCode !== null);
    if (exited) throw new Error(`${name} exited before ready: ${String(exited.supervisorOutput ?? "").trim().slice(-2_000) || "<no output>"}`);
    try {
      await assertTcpReachable(port, name);
      return;
    } catch {
      // The controlled loopback service is still starting.
    }
    await sleep(250);
  }
  throw new Error(`${name} did not accept a local TCP connection before timeout.`);
};

const waitForStopped = async (processHandle, name) => {
  stopService(processHandle);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    await sleep(100);
  }
  throw new Error(`${name} did not stop after the controlled C12 test.`);
};

const waitForPortsReleased = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([assertPortAvailable(controlApiPort), assertPortAvailable(studioPort), assertPortAvailable(runtimePort)]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("C12 E2E did not release its isolated API, Studio, and Runtime ports.");
};

const runStudioUiTest = (input) => {
  const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--project-name", input.projectName,
  ], { cwd: repoRoot, env: input.environment, encoding: "utf8", timeout: 180_000, windowsHide: true });
  const output = `${uiTest.stdout ?? ""}\n${uiTest.stderr ?? ""}`;
  const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
  if (!resultLine) throw new Error(`C12 Studio UI E2E did not emit a structured result: ${output.trim().slice(0, 2_000) || "<no output>"}`);
  const result = JSON.parse(resultLine.slice(resultPrefix.length));
  if (uiTest.error || uiTest.status !== 0 || !result.ok) throw new Error(`C12 Studio UI E2E failed: ${result.error ?? uiTest.error?.message ?? `exit ${uiTest.status}`}.`);
  return result;
};

const assertFinalProduction = async (projectId, databaseUrl) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query(
      `SELECT
        (SELECT count(*)::integer FROM production_runs WHERE workspace_id = $1 AND project_id = $2 AND status = 'SUCCEEDED') AS completed_runs,
        (SELECT count(*)::integer FROM production_segments WHERE workspace_id = $1 AND project_id = $2 AND status = 'ACCEPTED') AS accepted_segments,
        (SELECT count(*)::integer FROM task_runs WHERE workspace_id = $1 AND project_id = $2 AND status = 'SUCCEEDED') AS completed_tasks,
        (SELECT count(*)::integer FROM video_versions WHERE workspace_id = $1 AND project_id = $2 AND status = 'SUCCEEDED') AS completed_versions,
        (SELECT target_resolution FROM creative_brief_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY revision DESC LIMIT 1) AS target_resolution,
        (SELECT array_agg(DISTINCT input_snapshot ->> 'resolution') FROM task_runs WHERE workspace_id = $1 AND project_id = $2) AS task_resolutions,
        (SELECT array_agg(object_key) FROM assets WHERE workspace_id = $1 AND project_id = $2) AS object_keys`,
      ["ws_dev_default", projectId],
    );
    const row = result.rows[0];
    assert.equal(row.completed_runs, 1, "C12 E2E did not complete the production run.");
    assert.equal(row.accepted_segments, 3, "C12 E2E did not accept all planned segments.");
    assert.equal(row.completed_tasks, 3, "C12 E2E did not complete exactly one TaskRun per planned segment.");
    assert.equal(row.completed_versions, 1, "C12 E2E did not create one immutable final video version.");
    assert.equal(row.target_resolution, "480p", "C12 E2E did not persist the selected target resolution.");
    assert.deepEqual(row.task_resolutions, ["480p"], "C12 E2E did not propagate the selected resolution to every TaskRun snapshot.");
    return row.object_keys ?? [];
  } finally {
    await database.end();
  }
};

const assertPublicPlaybackProjection = async (projectId) => {
  const [progressResponse, versionsResponse] = await Promise.all([
    fetch(`${studioOrigin}/api/v1/projects/${projectId}/production-runs`),
    fetch(`${studioOrigin}/api/v1/projects/${projectId}/video-versions`),
  ]);
  assert.equal(progressResponse.status, 200);
  assert.equal(versionsResponse.status, 200);
  const [progress, versions] = await Promise.all([progressResponse.json(), versionsResponse.json()]);
  assert.equal(progress.data[0].production_run.status, "SUCCEEDED");
  assert.equal(progress.data[0].segments.filter((segment) => segment.status === "ACCEPTED").length, 3);
  assert.equal(versions.data.length, 1);
  assert.equal(versions.data[0].status, "SUCCEEDED");
  const serialized = JSON.stringify({ progress, versions });
  for (const forbidden of ["object_key", "download_url", "provider_request_id", "task_run_id", "prompt", "Authorization"]) {
    assert.equal(serialized.includes(forbidden), false, `C12 public projection leaked ${forbidden}.`);
  }
};

const captureProductionDiagnostic = async (databaseUrl) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query(`
      SELECT json_build_object(
        'runs', (SELECT coalesce(json_agg(json_build_object('status', status, 'accepted', accepted_shot_count, 'total', total_shot_count) ORDER BY created_at), '[]'::json) FROM production_runs),
        'segments', (SELECT coalesce(json_agg(json_build_object('sequence', sequence, 'status', status, 'retryable', retryable) ORDER BY sequence), '[]'::json) FROM production_segments),
        'tasks', (SELECT coalesce(json_agg(json_build_object('status', task.status, 'submitted', EXISTS (SELECT 1 FROM provider_attempts attempt WHERE attempt.workspace_id = task.workspace_id AND attempt.task_run_id = task.id AND attempt.provider_request_id IS NOT NULL)) ORDER BY task.created_at), '[]'::json) FROM task_runs task),
        'outbox', (SELECT coalesce(json_agg(json_build_object('type', event_type, 'published', published_at IS NOT NULL, 'dead_lettered', dead_lettered_at IS NOT NULL, 'attempts', publish_attempts) ORDER BY available_at), '[]'::json) FROM outbox_events)
      ) AS diagnostic
    `);
    return JSON.stringify(result.rows[0]?.diagnostic ?? {});
  } finally {
    await database.end();
  }
};

const removeObjects = async (storage, objectKeys) => {
  for (const objectKey of objectKeys) {
    await storage.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey })).catch(() => undefined);
  }
};

const run = async () => {
  const suffix = randomUUID();
  const compactSuffix = suffix.replaceAll("-", "").slice(0, 8);
  const databaseName = `c12_e2e_${compactSuffix}`;
  const projectName = `C12 Local Final Video ${suffix}`;
  const queuePrefix = `alchemy-video-c12-${suffix}`;
  const environment = {
    ...process.env,
    CONTROL_API_PORT: String(controlApiPort),
    CONTROL_API_ORIGIN: apiOrigin,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: storageConfig.endpoint,
    S3_REGION: storageConfig.region,
    S3_BUCKET: storageConfig.bucket,
    S3_ACCESS_KEY: storageConfig.accessKeyId,
    S3_SECRET_KEY: storageConfig.secretAccessKey,
    LOCAL_AUTH_MODE: "dev",
    VIDEO_PROVIDER: "mock",
    VEYRA_AUTH_ENABLED: "false",
    MEDIA_RUNTIME_URL: runtimeOrigin,
    MEDIA_RUNTIME_TOKEN: `c12-runtime-${compactSuffix}`,
    MEDIA_RUNTIME_FFMPEG_PATH: ffmpegPath,
    MEDIA_RUNTIME_FFPROBE_PATH: ffprobePath,
    TASK_QUEUE_NAME: `${queuePrefix}-task`,
    TASK_DEAD_LETTER_QUEUE_NAME: `${queuePrefix}-task-dead-letter`,
    CREATIVE_PLANNING_QUEUE_NAME: `${queuePrefix}-planning`,
    CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME: `${queuePrefix}-planning-dead-letter`,
    PRODUCTION_QUEUE_NAME: `${queuePrefix}-production`,
    PRODUCTION_DEAD_LETTER_QUEUE_NAME: `${queuePrefix}-production-dead-letter`,
    MEDIA_RUNTIME_QUEUE_NAME: `${queuePrefix}-media`,
    MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME: `${queuePrefix}-media-dead-letter`,
    TASK_WORKER_ID: `c12-task-${compactSuffix}`,
    WORKFLOW_WORKER_ID: `c12-workflow-${compactSuffix}`,
    PRODUCTION_WORKER_ID: `c12-production-${compactSuffix}`,
    BUILD_VERSION: `c12-e2e-${suffix}`,
    HOST: host,
    PORT: String(studioPort),
    NITRO_HOST: host,
    NITRO_PORT: String(studioPort),
    NITRO_CONTROL_API_ORIGIN: apiOrigin,
    STUDIO_NUXT_BUILD_DIR: resolve(repoRoot, ".codex-longrun", "c12-studio-build", suffix),
    STUDIO_NITRO_OUTPUT_DIR: resolve(repoRoot, ".codex-longrun", "c12-studio-output", suffix),
  };
  const storage = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: storageConfig.accessKeyId, secretAccessKey: storageConfig.secretAccessKey },
  });
  let databaseUrl = "";
  let databaseCreated = false;
  let apiProcess;
  let workflowWorkerProcess;
  let taskWorkerProcess;
  let productionWorkerProcess;
  let runtimeProcess;
  let studioProcess;
  let objectKeys = [];
  let executionError;
  const cleanupFailures = [];

  try {
    await Promise.all([
      assertTcpReachable(15432, "PostgreSQL"),
      assertTcpReachable(6380, "Redis"),
      assertTcpReachable(9002, "MinIO"),
      assertPortAvailable(controlApiPort),
      assertPortAvailable(studioPort),
      assertPortAvailable(runtimePort),
    ]);
    databaseUrl = await createIsolatedDatabase(databaseName);
    databaseCreated = true;
    environment.DATABASE_URL = databaseUrl;
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrate.command, migrate.args, { cwd: repoRoot, env: environment, stdio: "ignore", windowsHide: true }), "C12 E2E database migration");

    apiProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], controlApiRoot, environment);
    await waitFor(`${apiOrigin}/api/v1/health`, "C12 Control API", [apiProcess]);
    workflowWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], workflowWorkerRoot, environment);
    taskWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], taskWorkerRoot, environment);
    runtimeProcess = startService(process.platform === "win32" ? "python.exe" : "python3", ["-m", "uvicorn", "main:app", "--host", host, "--port", String(runtimePort)], mediaRuntimeRoot, environment);
    await waitForTcp(runtimePort, "Media Runtime", [runtimeProcess]);
    productionWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], productionWorkerRoot, environment);
    await sleep(1_000);
    for (const [name, processHandle] of [["Workflow Worker", workflowWorkerProcess], ["Task Worker", taskWorkerProcess], ["Production Worker", productionWorkerProcess], ["Media Runtime", runtimeProcess]]) {
      if (processHandle.exitCode !== null) throw new Error(`${name} exited before Studio startup: ${processHandle.supervisorOutput}`);
    }
    studioProcess = startService(process.execPath, [studioServerScriptPath], studioWebRoot, environment);
    await waitFor(`${studioOrigin}/projects`, "C12 Studio", [apiProcess, workflowWorkerProcess, taskWorkerProcess, productionWorkerProcess, runtimeProcess, studioProcess]);
    await waitFor(`${studioOrigin}/api/v1/health`, "C12 Studio API proxy", [apiProcess, workflowWorkerProcess, taskWorkerProcess, productionWorkerProcess, runtimeProcess, studioProcess]);

    const browserResult = runStudioUiTest({ projectName, environment });
    assert.equal(browserResult.segment_count, 3);
    assert.equal(browserResult.mobile_viewport, "390x844");
    objectKeys = await assertFinalProduction(browserResult.project_id, databaseUrl);
    await assertPublicPlaybackProjection(browserResult.project_id);
  } catch (error) {
    const diagnostic = databaseCreated
      ? await captureProductionDiagnostic(databaseUrl).catch((diagnosticError) => `unavailable: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`)
      : "not available";
    const processOutput = (name, processHandle) => `${name}: ${String(processHandle?.supervisorOutput ?? "<not started>").trim().slice(-2_000)}`;
    executionError = new Error([
      error instanceof Error ? error.message : String(error),
      `C12 state: ${diagnostic}`,
      processOutput("Control API", apiProcess),
      processOutput("Workflow Worker", workflowWorkerProcess),
      processOutput("Task Worker", taskWorkerProcess),
      processOutput("Production Worker", productionWorkerProcess),
      processOutput("Media Runtime", runtimeProcess),
      processOutput("Studio", studioProcess),
    ].join("\n"));
  }

  for (const [processHandle, name] of [[studioProcess, "C12 Studio"], [productionWorkerProcess, "C12 Production Worker"], [taskWorkerProcess, "C12 Task Worker"], [workflowWorkerProcess, "C12 Workflow Worker"], [runtimeProcess, "C12 Media Runtime"], [apiProcess, "C12 Control API"]]) {
    try {
      await waitForStopped(processHandle, name);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await Promise.all([
      clearInternalEventQueues({ redisUrl, queueName: environment.TASK_QUEUE_NAME, deadLetterQueueName: environment.TASK_DEAD_LETTER_QUEUE_NAME }),
      clearCreativePlanningQueues({ redisUrl, queueName: environment.CREATIVE_PLANNING_QUEUE_NAME, deadLetterQueueName: environment.CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME }),
      clearProductionQueues({ redisUrl, queueName: environment.PRODUCTION_QUEUE_NAME, deadLetterQueueName: environment.PRODUCTION_DEAD_LETTER_QUEUE_NAME }),
      clearMediaRuntimeQueues({ redisUrl, queueName: environment.MEDIA_RUNTIME_QUEUE_NAME, deadLetterQueueName: environment.MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME }),
      removeObjects(storage, objectKeys),
      rm(environment.STUDIO_NUXT_BUILD_DIR, { recursive: true, force: true }),
      rm(environment.STUDIO_NITRO_OUTPUT_DIR, { recursive: true, force: true }),
    ]);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (databaseCreated) {
    try {
      await dropIsolatedDatabase(databaseName);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length) throw new AggregateError(executionError ? [executionError, ...cleanupFailures] : cleanupFailures, "C12 E2E cleanup failed.");
  if (executionError) throw executionError;
  console.log("C12 local E2E passed: Studio project planning, Mock segment generation, QC/handoff, versioned composition, final-video playback/download, public redaction, mobile layout, and isolated cleanup.");
};

await run();
