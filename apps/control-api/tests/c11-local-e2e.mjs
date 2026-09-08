import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { clearCreativePlanningQueues } from "@alchemy-video/task-queue";
import { Client } from "pg";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controlApiRoot = resolve(repoRoot, "apps", "control-api");
const workflowWorkerRoot = resolve(repoRoot, "apps", "workflow-worker");
const studioWebRoot = resolve(repoRoot, "apps", "studio-web");
const uiScriptPath = resolve(controlApiRoot, "tests", "c11-studio-ui-e2e.py");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const controlApiPort = 3332;
const studioPort = 3331;
const studioBindHost = "127.0.0.1";
const apiOrigin = `http://127.0.0.1:${controlApiPort}`;
const studioOrigin = `http://${studioBindHost}:${studioPort}`;
const databaseAdminUrl = "postgresql://video_local:video_local@127.0.0.1:15432/postgres";
const redisUrl = "redis://127.0.0.1:6380";
const resultPrefix = "C11_STUDIO_UI_E2E_RESULT=";

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const createIsolatedDatabase = async (databaseName) => {
  if (!/^c11_e2e_[a-z0-9]+$/.test(databaseName)) throw new Error("C11 E2E generated an unsafe database name.");
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

const assertTcpReachable = (host, port, name) => new Promise((resolveReachable, rejectReachable) => {
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

const assertPortAvailable = (port, host = "127.0.0.1") => new Promise((resolveAvailable, rejectAvailable) => {
  const probe = createServer();
  probe.once("error", () => rejectAvailable(new Error(`Port ${host}:${port} is already in use; refusing to stop an existing service.`)));
  probe.listen(port, host, () => probe.close(resolveAvailable));
});

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
      // The foreground test child service is still starting.
    }
    await sleep(250);
  }
  throw new Error(`${name} did not return HTTP 200 before timeout.`);
};

const waitForStopped = async (processHandle, name) => {
  stopService(processHandle);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    await sleep(100);
  }
  throw new Error(`${name} did not stop after the controlled C11 test phase.`);
};

const waitForPortsReleased = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([assertPortAvailable(controlApiPort), assertPortAvailable(studioPort, studioBindHost)]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("C11 E2E did not release its isolated API and Studio ports.");
};

const runStudioUiTest = (input) => {
  const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--project-name", input.projectName,
  ], { cwd: repoRoot, env: input.environment, encoding: "utf8", timeout: 120_000, windowsHide: true });
  const output = `${uiTest.stdout ?? ""}\n${uiTest.stderr ?? ""}`;
  const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
  if (!resultLine) throw new Error(`C11 Studio UI E2E did not emit a structured result: ${output.trim().slice(0, 2_000) || "<no output>"}`);
  const result = JSON.parse(resultLine.slice(resultPrefix.length));
  if (uiTest.error || uiTest.status !== 0 || !result.ok) throw new Error(`C11 Studio UI E2E failed: ${result.error ?? uiTest.error?.message ?? `exit ${uiTest.status}`}.`);
  return result;
};

const assertPersistedPlanning = async (projectId, databaseUrl, expectedSegmentCount) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query(
      `SELECT
        (SELECT count(*)::integer FROM creative_brief_revisions WHERE workspace_id = $1 AND project_id = $2 AND status = 'APPROVED') AS approved_brief_count,
        (SELECT count(*)::integer FROM storyboard_revisions WHERE workspace_id = $1 AND project_id = $2 AND status = 'APPROVED') AS approved_storyboard_count,
        (SELECT count(*)::integer FROM storyboard_shot_specs WHERE workspace_id = $1 AND project_id = $2) AS shot_spec_count,
        (SELECT count(*)::integer FROM production_runs WHERE workspace_id = $1 AND project_id = $2 AND status = 'CONFIRMED') AS confirmed_run_count,
        (SELECT count(*)::integer FROM task_runs WHERE workspace_id = $1 AND project_id = $2) AS task_run_count,
        (SELECT target_resolution FROM creative_brief_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY revision DESC LIMIT 1) AS target_resolution`,
      ["ws_dev_default", projectId],
    );
    const row = result.rows[0];
    assert.equal(row.approved_brief_count, 1, "C11 E2E did not persist one approved creative brief.");
    assert.equal(row.approved_storyboard_count, 1, "C11 E2E did not persist one approved storyboard.");
    assert.equal(row.shot_spec_count, expectedSegmentCount, "C11 E2E did not persist every bounded storyboard segment specification.");
    assert.equal(row.confirmed_run_count, 1, "C11 E2E did not persist one confirmed production plan.");
    assert.equal(row.task_run_count, 0, "C11 planning unexpectedly created a video TaskRun.");
    assert.equal(row.target_resolution, "480p", "C11 E2E did not persist the Studio-selected target resolution.");
  } finally {
    await database.end();
  }
};

const assertPublicProjection = async (projectId) => {
  const response = await fetch(`${studioOrigin}/api/v1/projects/${projectId}`);
  const payload = await response.json();
  assert.equal(response.status, 200, "C11 Studio proxy did not return the persisted project plan.");
  assert.equal(payload.data.creative_brief_revisions.length, 1);
  assert.equal(payload.data.storyboard_revisions.length, 1);
  assert.equal(payload.data.storyboard_revisions[0].status, "APPROVED");
  assert.equal(payload.data.production_runs.length, 1);
  assert.equal(payload.data.production_runs[0].status, "CONFIRMED");
  assert.equal(payload.data.task_runs.length, 0);
  assert.equal(payload.data.creative_brief_revisions[0].target_resolution, "480p");
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["provider_request_id", "object_key", "X-Veyra-Internal-Token", "Authorization"]) {
    assert.equal(serialized.includes(forbidden), false, `C11 public planning projection leaked ${forbidden}.`);
  }
};

const run = async () => {
  const suffix = randomUUID();
  const compactSuffix = suffix.replaceAll("-", "").slice(0, 8);
  const databaseName = `c11_e2e_${compactSuffix}`;
  const projectName = `C11 Studio Story Plan ${suffix}`;
  const queueName = `alchemy-video-c11-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  let databaseUrl = "";
  let environment;
  let apiProcess;
  let workflowWorkerProcess;
  let studioProcess;
  let databaseCreated = false;
  let executionError;
  const cleanupFailures = [];

  try {
    await Promise.all([
      assertTcpReachable("127.0.0.1", 15432, "PostgreSQL"),
      assertTcpReachable("127.0.0.1", 6380, "Redis"),
      assertPortAvailable(controlApiPort),
      assertPortAvailable(studioPort, studioBindHost),
    ]);
    databaseUrl = await createIsolatedDatabase(databaseName);
    databaseCreated = true;
    environment = {
      ...process.env,
      CONTROL_API_PORT: String(controlApiPort),
      CONTROL_API_ORIGIN: apiOrigin,
      DATABASE_URL: databaseUrl,
      C11_E2E_DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      S3_ENDPOINT: "http://127.0.0.1:9",
      S3_REGION: "c11-local",
      S3_BUCKET: "c11-browser-e2e",
      S3_ACCESS_KEY: "c11-local-key",
      S3_SECRET_KEY: "c11-local-secret",
      S3_PUBLIC_ENDPOINT: "",
      LOCAL_AUTH_MODE: "dev",
      VIDEO_PROVIDER: "mock",
      VEYRA_AUTH_ENABLED: "false",
      CREATIVE_PLANNING_QUEUE_NAME: queueName,
      CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME: deadLetterQueueName,
      WORKFLOW_WORKER_ID: `c11-e2e-${compactSuffix}`,
      BUILD_VERSION: `c11-e2e-${suffix}`,
      HOST: studioBindHost,
      PORT: String(studioPort),
      NITRO_HOST: studioBindHost,
      NITRO_PORT: String(studioPort),
      NITRO_CONTROL_API_ORIGIN: apiOrigin,
      STUDIO_NUXT_BUILD_DIR: resolve(repoRoot, ".codex-longrun", "c11-studio-build", suffix),
      STUDIO_NITRO_OUTPUT_DIR: resolve(repoRoot, ".codex-longrun", "c11-studio-output", suffix),
    };
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrate.command, migrate.args, { cwd: repoRoot, env: environment, stdio: "ignore", windowsHide: true }), "C11 E2E database migration");

    apiProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], controlApiRoot, environment);
    const apiHealth = await waitFor(`${apiOrigin}/api/v1/health`, "C11 Control API", [apiProcess]);
    assert.equal((await apiHealth.json()).data.build_version, environment.BUILD_VERSION);
    workflowWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], workflowWorkerRoot, environment);
    await sleep(1_000);
    if (workflowWorkerProcess.exitCode !== null) throw new Error(`C11 Workflow Worker exited before Studio startup: ${workflowWorkerProcess.supervisorOutput}`);
    studioProcess = startService(process.execPath, [studioServerScriptPath], studioWebRoot, environment);
    await waitFor(`${studioOrigin}/projects`, "C11 Studio", [apiProcess, workflowWorkerProcess, studioProcess]);
    const proxyHealth = await waitFor(`${studioOrigin}/api/v1/health`, "C11 Studio Control API proxy", [apiProcess, workflowWorkerProcess, studioProcess]);
    assert.equal((await proxyHealth.json()).data.build_version, environment.BUILD_VERSION);

    const browserResult = runStudioUiTest({ projectName, environment });
    assert.equal(browserResult.segment_count, Math.ceil(browserResult.target_duration_seconds / browserResult.max_generation_segment_seconds));
    assert.equal(browserResult.segment_durations.reduce((total, duration) => total + duration, 0), browserResult.target_duration_seconds);
    assert.ok(browserResult.segment_durations.every((duration) => duration > 0 && duration <= browserResult.max_generation_segment_seconds));
    assert.equal(browserResult.mobile_viewport, "390x844");
    await assertPersistedPlanning(browserResult.project_id, databaseUrl, browserResult.segment_count);
    await assertPublicProjection(browserResult.project_id);
  } catch (error) {
    const processOutput = (name, processHandle) => `${name}: ${String(processHandle?.supervisorOutput ?? "<not started>").trim().slice(-2_000)}`;
    executionError = new Error([
      error instanceof Error ? error.message : String(error),
      processOutput("Control API", apiProcess),
      processOutput("Workflow Worker", workflowWorkerProcess),
      processOutput("Studio", studioProcess),
    ].join("\n"));
  }

  try {
    await waitForStopped(studioProcess, "C11 Studio");
    await waitForStopped(workflowWorkerProcess, "C11 Workflow Worker");
    await waitForStopped(apiProcess, "C11 Control API");
    await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (environment) {
    try {
      await clearCreativePlanningQueues({ redisUrl, queueName, deadLetterQueueName });
      await Promise.all([
        rm(environment.STUDIO_NUXT_BUILD_DIR, { recursive: true, force: true }),
        rm(environment.STUDIO_NITRO_OUTPUT_DIR, { recursive: true, force: true }),
      ]);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (databaseCreated) {
    try {
      await dropIsolatedDatabase(databaseName);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length) throw new AggregateError(executionError ? [executionError, ...cleanupFailures] : cleanupFailures, "C11 E2E cleanup failed.");
  if (executionError) throw executionError;
  console.log("C11 Studio planning E2E passed: story input, deterministic review plan, approval, production-plan confirmation, refresh, mobile layout, public projection, and zero TaskRuns; isolated services, queue, build output, and database were cleaned.");
};

await run();
