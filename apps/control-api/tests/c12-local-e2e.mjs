import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { clearCreativePlanningQueues, clearInternalEventQueues, clearMediaRuntimeQueues, clearProductionQueues } from "@alchemy-video/task-queue";
import { verifyBundledMediaTools } from "@alchemy-video/provider-video";
import { Client } from "pg";
import { createOwnedResources, currentOwnedServices, installOwnedServiceSignalHandlers, mockChildEnvironment, ownedRunInterrupted, readMockE2EConfig, runOwnedCommand, startOwnedService, stopOwnedService } from "./support/mock-e2e-resources.mjs";

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
const config = readMockE2EConfig(process.env, "c12");
const { databaseUrl, redisUrl, storageConfig } = config;
const resources = createOwnedResources(config);
const mediaRuntimePython = process.env.MOCK_E2E_PYTHON || (process.platform === "win32" ? "python.exe" : "python3");
const browserArgs = process.env.MOCK_E2E_BROWSER_EXECUTABLE ? ["--browser-executable", process.env.MOCK_E2E_BROWSER_EXECUTABLE] : [];
const resultPrefix = "C12_STUDIO_UI_E2E_RESULT=";
const artifactDirectory = process.env.C12_E2E_ARTIFACT_DIR?.trim() || "";

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

const pnpmCommand = (args) => process.platform === "win32"
  ? { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`] }
  : { command: "pnpm", args };

const requireSuccess = (result, name) => {
  if (result.error) throw new Error(`${name} could not start: ${result.error.message}.`);
  if (result.status !== 0) throw new Error(`${name} failed with exit status ${result.status ?? "unknown"}.`);
};

const startService = startOwnedService;

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

const waitForStopped = stopOwnedService;

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

const runStudioUiTest = async (input) => {
  const uiTest = await runOwnedCommand(mediaRuntimePython, [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--project-name", input.projectName,
    ...browserArgs,
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
        (SELECT asset.object_key FROM video_versions version JOIN assets asset ON asset.workspace_id = version.workspace_id AND asset.project_id = version.project_id AND asset.id = version.asset_id WHERE version.workspace_id = $1 AND version.project_id = $2 AND version.status = 'SUCCEEDED' ORDER BY version.created_at DESC LIMIT 1) AS final_object_key,
        (SELECT count(*)::integer FROM handoff_reviews WHERE workspace_id = $1 AND project_id = $2) AS handoff_reviews,
        (SELECT count(*)::integer FROM transition_repairs WHERE workspace_id = $1 AND project_id = $2 AND strategy = 'BLEND' AND status = 'ACCEPTED') AS safe_blend_repairs,
        (SELECT continuity_status FROM production_runs WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1) AS continuity_status,
        (SELECT target_resolution FROM creative_brief_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY revision DESC LIMIT 1) AS target_resolution,
        (SELECT array_agg(DISTINCT input_snapshot ->> 'resolution') FROM task_runs WHERE workspace_id = $1 AND project_id = $2) AS task_resolutions,
        (SELECT array_agg(object_key) FROM assets WHERE workspace_id = $1 AND project_id = $2) AS object_keys`,
      ["ws_dev_default", projectId],
    );
    const row = result.rows[0];
    assert.equal(row.completed_runs, 1, "C12 E2E did not complete the production run.");
    assert.equal(row.accepted_segments, 2, "C12 E2E did not accept all planned segments.");
    assert.equal(row.completed_tasks, 2, "C12 E2E did not complete exactly one TaskRun per planned segment.");
    assert.equal(row.completed_versions, 1, "C12 E2E did not create one immutable final video version.");
    assert.equal(row.handoff_reviews, 1, "C12.1 E2E did not persist every adjacent handoff review.");
    assert.equal(row.safe_blend_repairs, 0, "C12.1 E2E created a transition repair without an available semantic evaluation.");
    assert.equal(row.continuity_status, "NEEDS_ATTENTION", "C12.1 E2E did not safely project the unavailable evaluator.");
    assert.equal(row.target_resolution, "480p", "C12 E2E did not persist the selected target resolution.");
    assert.deepEqual(row.task_resolutions, ["480p"], "C12 E2E did not propagate the selected resolution to every TaskRun snapshot.");
    return { objectKeys: row.object_keys ?? [], finalObjectKey: row.final_object_key ?? "" };
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
  assert.equal(progress.data[0].production_run.continuity_status, "NEEDS_ATTENTION");
  assert.equal(progress.data[0].segments.filter((segment) => segment.status === "ACCEPTED").length, 2);
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
        'tasks', (SELECT coalesce(json_agg(json_build_object('status', task.status, 'submitted', EXISTS (SELECT 1 FROM provider_attempts attempt WHERE attempt.workspace_id = task.workspace_id AND attempt.task_run_id = task.id AND attempt.provider_request_id_v2 IS NOT NULL)) ORDER BY task.created_at), '[]'::json) FROM task_runs task),
        'outbox', (SELECT coalesce(json_agg(json_build_object('type', event_type, 'published', published_at IS NOT NULL, 'dead_lettered', dead_lettered_at IS NOT NULL, 'attempts', publish_attempts) ORDER BY available_at), '[]'::json) FROM outbox_events)
      ) AS diagnostic
    `);
    return JSON.stringify(result.rows[0]?.diagnostic ?? {});
  } finally {
    await database.end();
  }
};

const preserveFinalArtifact = async (storage, objectKey, projectId) => {
  if (!artifactDirectory || !objectKey) return;
  const object = await storage.send(new GetObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }));
  if (!object.Body?.transformToByteArray) throw new Error("C12 artifact response did not expose a readable body.");
  const bytes = await object.Body.transformToByteArray();
  await mkdir(artifactDirectory, { recursive: true });
  const outputPath = resolve(artifactDirectory, `c12-local-${projectId}.mp4`);
  await writeFile(outputPath, bytes);
  console.log(`C12_LOCAL_ARTIFACT=${outputPath}`);
};

const run = async () => {
  const suffix = randomUUID();
  const compactSuffix = suffix.replaceAll("-", "").slice(0, 8);
  const projectName = `C12 Local Final Video ${suffix}`;
  const queuePrefix = `alchemy-video-c12-${suffix}`;
  installOwnedServiceSignalHandlers(() => `${resources.residualDescription()}; queues=${queuePrefix}; build=${suffix}`);
  const environment = {
    ...mockChildEnvironment(process.env),
    CONTROL_API_PORT: String(controlApiPort),
    CONTROL_API_ORIGIN: apiOrigin,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: storageConfig.endpoint,
    S3_REGION: storageConfig.region,
    S3_BUCKET: storageConfig.bucket,
    S3_ACCESS_KEY: storageConfig.accessKeyId,
    S3_SECRET_KEY: storageConfig.secretAccessKey,
    S3_BROWSER_ORIGINS: studioOrigin,
    ...(process.env.DOCUMENT_RUNTIME_PYTHON ? { DOCUMENT_RUNTIME_PYTHON: process.env.DOCUMENT_RUNTIME_PYTHON } : {}),
    DATABASE_URL: databaseUrl,
    LOCAL_AUTH_MODE: "dev",
    VIDEO_PROVIDER: "mock",
    VEYRA_AUTH_ENABLED: "false",
    MEDIA_RUNTIME_URL: runtimeOrigin,
    MEDIA_RUNTIME_TOKEN: `c12-runtime-${compactSuffix}`,
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
  const storage = resources.storage;
  let apiProcess;
  let workflowWorkerProcess;
  let taskWorkerProcess;
  let productionWorkerProcess;
  let runtimeProcess;
  let studioProcess;
  let portsClaimed = false;
  let executionError;
  const cleanupFailures = [];

  try {
    await Promise.all([
      assertTcpReachable(Number(new URL(config.databaseAdminUrl).port), "PostgreSQL"),
      assertTcpReachable(Number(new URL(redisUrl).port), "Redis"),
      assertTcpReachable(Number(new URL(storageConfig.endpoint).port), "MinIO"),
      assertPortAvailable(controlApiPort),
      assertPortAvailable(studioPort),
      assertPortAvailable(runtimePort),
    ]);
    portsClaimed = true;
    const mediaTools = await verifyBundledMediaTools();
    environment.MEDIA_RUNTIME_FFMPEG_PATH = mediaTools.ffmpegPath;
    environment.MEDIA_RUNTIME_FFPROBE_PATH = mediaTools.ffprobePath;
    await resources.create();
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(await runOwnedCommand(migrate.command, migrate.args, { cwd: repoRoot, env: environment }), "C12 E2E database migration");
    resources.markMigrated();

    apiProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], controlApiRoot, environment);
    const apiHealth = await waitFor(`${apiOrigin}/api/v1/health`, "C12 Control API", [apiProcess]);
    assert.equal((await apiHealth.json()).data.build_version, environment.BUILD_VERSION, "C12 API is not the owned instance.");
    workflowWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], workflowWorkerRoot, environment);
    taskWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], taskWorkerRoot, environment);
    runtimeProcess = startService(mediaRuntimePython, ["-m", "uvicorn", "main:app", "--host", host, "--port", String(runtimePort)], mediaRuntimeRoot, environment);
    await waitForTcp(runtimePort, "Media Runtime", [runtimeProcess]);
    productionWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], productionWorkerRoot, environment);
    await sleep(1_000);
    for (const [name, processHandle] of [["Workflow Worker", workflowWorkerProcess], ["Task Worker", taskWorkerProcess], ["Production Worker", productionWorkerProcess], ["Media Runtime", runtimeProcess]]) {
      if (processHandle.exitCode !== null) throw new Error(`${name} exited before Studio startup: ${processHandle.supervisorOutput}`);
    }
    studioProcess = startService(process.execPath, [studioServerScriptPath], studioWebRoot, environment);
    await waitFor(`${studioOrigin}/projects`, "C12 Studio", [apiProcess, workflowWorkerProcess, taskWorkerProcess, productionWorkerProcess, runtimeProcess, studioProcess]);
    const proxyHealth = await waitFor(`${studioOrigin}/api/v1/health`, "C12 Studio API proxy", [apiProcess, workflowWorkerProcess, taskWorkerProcess, productionWorkerProcess, runtimeProcess, studioProcess]);
    assert.equal((await proxyHealth.json()).data.build_version, environment.BUILD_VERSION, "C12 Studio proxy is not bound to the owned API.");

    const browserResult = await runStudioUiTest({ projectName, environment });
    assert.equal(browserResult.segment_count, 2);
    assert.equal(browserResult.mobile_viewport, "390x844");
    const production = await assertFinalProduction(browserResult.project_id, databaseUrl);
    await preserveFinalArtifact(storage, production.finalObjectKey, browserResult.project_id);
    await assertPublicPlaybackProjection(browserResult.project_id);
  } catch (error) {
    const diagnostic = resources.migrated
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

  let allStopped = !ownedRunInterrupted();
  for (const [processHandle, name] of [[studioProcess, "C12 Studio"], [productionWorkerProcess, "C12 Production Worker"], [taskWorkerProcess, "C12 Task Worker"], [workflowWorkerProcess, "C12 Workflow Worker"], [runtimeProcess, "C12 Media Runtime"], [apiProcess, "C12 Control API"]]) {
    try {
      await waitForStopped(processHandle, name);
    } catch (error) {
      allStopped = false;
      cleanupFailures.push(error);
    }
  }
  for (const child of currentOwnedServices()) {
    try { await stopOwnedService(child, `C12 command ${child.pid}`); } catch (error) { allStopped = false; cleanupFailures.push(error); }
  }
  if (portsClaimed) try {
    await waitForPortsReleased();
  } catch (error) {
    allStopped = false;
    cleanupFailures.push(error);
  }
  if (allStopped && (workflowWorkerProcess || taskWorkerProcess || productionWorkerProcess)) try {
    await Promise.all([
      clearInternalEventQueues({ redisUrl, queueName: environment.TASK_QUEUE_NAME, deadLetterQueueName: environment.TASK_DEAD_LETTER_QUEUE_NAME }),
      clearCreativePlanningQueues({ redisUrl, queueName: environment.CREATIVE_PLANNING_QUEUE_NAME, deadLetterQueueName: environment.CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME }),
      clearProductionQueues({ redisUrl, queueName: environment.PRODUCTION_QUEUE_NAME, deadLetterQueueName: environment.PRODUCTION_DEAD_LETTER_QUEUE_NAME }),
      clearMediaRuntimeQueues({ redisUrl, queueName: environment.MEDIA_RUNTIME_QUEUE_NAME, deadLetterQueueName: environment.MEDIA_RUNTIME_DEAD_LETTER_QUEUE_NAME }),
      rm(environment.STUDIO_NUXT_BUILD_DIR, { recursive: true, force: true }),
      rm(environment.STUDIO_NITRO_OUTPUT_DIR, { recursive: true, force: true }),
    ]);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (allStopped && cleanupFailures.length === 0) {
    try {
      await resources.cleanupAfterStopped();
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  storage.destroy();
  if (ownedRunInterrupted()) cleanupFailures.push(new Error("C12 E2E was interrupted; owned resources are preserved and acceptance did not complete."));
  if (cleanupFailures.length) throw new AggregateError(executionError ? [executionError, ...cleanupFailures] : cleanupFailures, `C12 E2E cleanup failed; retained/inspect ${resources.residualDescription()}; queues=${queuePrefix}; files=${environment.STUDIO_NUXT_BUILD_DIR},${environment.STUDIO_NITRO_OUTPUT_DIR}.`);
  if (executionError) throw executionError;
  console.log("C12 local E2E passed: Studio project planning, Mock segment generation, QC/handoff, versioned composition, final-video playback/download, public redaction, mobile layout, and isolated cleanup.");
};

await run();
