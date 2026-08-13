import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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
const apiOrigin = "http://127.0.0.1:3032";
const studioOrigin = "http://127.0.0.1:3031";
const databaseUrl = "postgresql://video_local:video_local@127.0.0.1:15432/video_local";
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
const fixturePath = resolve(repoRoot, ".codex-longrun", "c06-studio-generation-1x1.png");
const uiScriptPath = resolve(controlApiRoot, "tests", "c06-studio-ui-e2e.py");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const resultPrefix = "C06_STUDIO_UI_E2E_RESULT=";

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const assertPortAvailable = (port) => new Promise((resolveAvailable, rejectAvailable) => {
  const probe = createServer();
  probe.once("error", () => rejectAvailable(new Error(`Port ${port} is already in use; refusing to stop an existing service.`)));
  probe.listen(port, "127.0.0.1", () => probe.close(resolveAvailable));
});

const waitForPortsReleased = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([assertPortAvailable(3031), assertPortAvailable(3032)]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("C06 E2E did not release 3031/3032 during cleanup.");
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
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-4_000); };
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

const cleanupProject = async (projectName, storage, commandSeedPrefix) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const projects = await database.query(
      "SELECT id FROM projects WHERE workspace_id = $1 AND name = $2",
      ["ws_dev_default", projectName],
    );
    const projectIds = projects.rows.map(({ id }) => id);
    const assets = await database.query(
      "SELECT assets.object_key FROM assets INNER JOIN projects ON projects.id = assets.project_id WHERE projects.workspace_id = $1 AND projects.name = $2",
      ["ws_dev_default", projectName],
    );
    const objectKeys = assets.rows.map(({ object_key: objectKey }) => objectKey);
    await Promise.all(objectKeys.map((objectKey) => storage.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey })).catch(() => undefined)));
    for (const projectId of projectIds) {
      await database.query("DELETE FROM outbox_events WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
    }
    await database.query("DELETE FROM command_deduplications WHERE idempotency_key LIKE $1", [`%${commandSeedPrefix}%`]);
    await database.query(
      "DELETE FROM task_runs USING projects WHERE task_runs.project_id = projects.id AND projects.workspace_id = $1 AND projects.name = $2",
      ["ws_dev_default", projectName],
    );
    const deleted = await database.query(
      "DELETE FROM projects WHERE workspace_id = $1 AND name = $2 RETURNING id",
      ["ws_dev_default", projectName],
    );
    const remaining = await database.query(
      "SELECT count(*)::integer AS count FROM projects WHERE workspace_id = $1 AND name = $2",
      ["ws_dev_default", projectName],
    );
    assert.equal(remaining.rows[0].count, 0, "C06 E2E project cleanup left a database record.");
    assert.ok(deleted.rowCount === 0 || deleted.rowCount === 1, "C06 E2E cleanup removed an unexpected project count.");
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
              count(provider_attempts.id)::integer AS attempt_count,
              count(provider_attempts.provider_request_id)::integer AS submitted_attempt_count,
              min(provider_attempts.provider_request_id) AS provider_request_id
       FROM task_runs
       INNER JOIN projects ON projects.id = task_runs.project_id
       LEFT JOIN provider_attempts ON provider_attempts.workspace_id = task_runs.workspace_id AND provider_attempts.task_run_id = task_runs.id
       WHERE projects.workspace_id = $1 AND projects.name = $2
       GROUP BY task_runs.id, task_runs.status, task_runs.result_asset_id`,
      ["ws_dev_default", projectName],
    );
    assert.equal(result.rowCount, 1, "C06 retry E2E expected exactly one TaskRun.");
    return result.rows[0];
  } finally {
    await database.end();
  }
};

const assertSingleRetriedAttempt = async (projectName, failedRecord) => {
  const recovered = await taskRunProviderRecord(projectName);
  assert.equal(recovered.id, failedRecord.id, "C06 retry E2E did not recover the failed TaskRun.");
  assert.equal(recovered.status, "SUCCEEDED", "C06 retry E2E did not persist a completed retry.");
  assert.ok(recovered.result_asset_id, "C06 retry E2E did not persist a result asset.");
  assert.equal(recovered.attempt_count, 1, "C06 retry E2E created a second ProviderAttempt instead of reusing the request.");
  assert.equal(recovered.submitted_attempt_count, 1, "C06 retry E2E did not retain exactly one provider request ID.");
  assert.equal(recovered.provider_request_id, failedRecord.provider_request_id, "C06 retry E2E replaced the persisted provider request ID.");
};

const runStudioUiTest = (input) => {
  const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--fixture", fixturePath,
    "--project-name", input.projectName,
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

const run = async () => {
  const suffix = randomUUID();
  const commandSeedPrefix = suffix.replaceAll("-", "").slice(0, 8);
  const projectName = `C06 Studio E2E ${suffix}`;
  const failedQueueName = `alchemy-video-c06-failure-${suffix}`;
  const failedDeadLetterQueueName = `${failedQueueName}-dead-letter`;
  const successfulQueueName = `alchemy-video-c06-retry-${suffix}`;
  const successfulDeadLetterQueueName = `${successfulQueueName}-dead-letter`;
  const environment = {
    ...process.env,
    CONTROL_API_PORT: "3032",
    CONTROL_API_ORIGIN: apiOrigin,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    S3_ENDPOINT: storageConfig.endpoint,
    S3_REGION: storageConfig.region,
    S3_BUCKET: storageConfig.bucket,
    S3_ACCESS_KEY: storageConfig.accessKeyId,
    S3_SECRET_KEY: storageConfig.secretAccessKey,
    LOCAL_AUTH_MODE: "dev",
    VIDEO_PROVIDER: "mock",
    VEYRA_AUTH_ENABLED: "false",
    PYTHONDONTWRITEBYTECODE: "1",
    HOST: "127.0.0.1",
    PORT: "3031",
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

  try {
    await Promise.all([assertPortAvailable(3031), assertPortAvailable(3032)]);
    isolation = await acquireC06E2EIsolation(databaseUrl);
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrate.command, migrate.args, { cwd: repoRoot, env: environment, stdio: "ignore", windowsHide: true }), "C06 E2E database migration");
    await writeFile(fixturePath, onePixelPng, { flag: "w" });
    assert.equal(createHash("sha256").update(onePixelPng).digest("hex").length, 64);

    apiProcess = startService(controlApiRoot, ["--import", "tsx", "src/index.ts"], environment);
    await waitFor(`${apiOrigin}/api/v1/health`, "Control API", [apiProcess]);
    failedWorkerProcess = startService(
      taskWorkerRoot,
      ["--import", "tsx", "src/index.ts"],
      workerEnvironment(failedQueueName, failedDeadLetterQueueName, "failed"),
    );
    await sleep(1_000);
    if (typeof failedWorkerProcess.exitCode === "number") throw new Error("C06 failed Mock Worker exited before the UI generation flow began.");
    studioProcess = startService(studioWebRoot, [studioServerScriptPath], environment);
    await waitFor(`${studioOrigin}/`, "Studio", [apiProcess, failedWorkerProcess, studioProcess]);
    await waitFor(`${studioOrigin}/api/v1/health`, "Studio Control API proxy", [apiProcess, failedWorkerProcess, studioProcess]);

    const failedResult = runStudioUiTest({ mode: "failure", projectName, commandSeed: suffix, environment });
    assert.equal(failedResult.retry_control_visible, true, "C06 failure E2E did not expose the Studio retry command.");
    assert.match(failedResult.failure_text, /Mock video generation was configured to fail\./, "C06 failure E2E did not expose the public failure message.");
    assert.equal(failedResult.command_seed_prefix, commandSeedPrefix, "C06 failure E2E did not install its isolated command seed.");
    const failedTaskRun = await taskRunProviderRecord(projectName);
    assert.equal(failedTaskRun.status, "FAILED", "C06 failure E2E did not persist a public failure state.");
    assert.equal(failedTaskRun.attempt_count, 1, "C06 failure E2E did not persist one ProviderAttempt.");
    assert.equal(failedTaskRun.submitted_attempt_count, 1, "C06 failure E2E did not persist its provider request ID.");
    assert.ok(failedTaskRun.provider_request_id, "C06 failure E2E did not retain a provider request ID for UI retry.");
    await stopWorker(failedWorkerProcess, "C06 failed Mock Worker");
    failedWorkerProcess = undefined;

    successfulWorkerProcess = startService(
      taskWorkerRoot,
      ["--import", "tsx", "src/index.ts"],
      workerEnvironment(successfulQueueName, successfulDeadLetterQueueName, "succeeded"),
    );
    await sleep(1_000);
    if (typeof successfulWorkerProcess.exitCode === "number") throw new Error("C06 successful Mock Worker exited before the UI retry flow began.");
    const retryResult = runStudioUiTest({ mode: "retry", projectName, commandSeed: suffix, environment });
    assert.ok(retryResult.video_width > 0 && retryResult.video_height > 0, "C06 Studio retry preview did not decode a video frame.");
    assert.ok(retryResult.duration > 0, "C06 Studio retry preview did not report a playable duration.");
    assert.equal(retryResult.command_seed_prefix, commandSeedPrefix, "C06 retry E2E did not reuse its isolated command seed.");
    await assertSingleRetriedAttempt(projectName, failedTaskRun);
    await publicResponseHasNoInternalFields(projectName);
    console.log(`C06 Studio failure/retry UI E2E passed: visible provider failure, retry control, ${retryResult.video_width}x${retryResult.video_height}, ${retryResult.duration}s.`);
  } catch (error) {
    executionError = error;
  }

  try {
    stopService(studioProcess);
    stopService(successfulWorkerProcess);
    stopService(failedWorkerProcess);
    stopService(apiProcess);
    await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    cleanupResult = await cleanupProject(projectName, storage, commandSeedPrefix);
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await clearInternalEventQueues({ redisUrl, queueName: failedQueueName, deadLetterQueueName: failedDeadLetterQueueName });
    await clearInternalEventQueues({ redisUrl, queueName: successfulQueueName, deadLetterQueueName: successfulDeadLetterQueueName });
    await rm(fixturePath, { force: true });
  } catch (error) {
    cleanupFailures.push(error);
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
  console.log(`C06 E2E cleanup passed: removed ${cleanupResult.projects} project, ${cleanupResult.objects} objects, two isolated queues, fixture, and child services.`);
};

await run();
