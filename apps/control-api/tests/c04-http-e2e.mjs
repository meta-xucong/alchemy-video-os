import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { access, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controlApiRoot = resolve(repoRoot, "apps", "control-api");
const studioWebRoot = resolve(repoRoot, "apps", "studio-web");
const apiOrigin = "http://127.0.0.1:3032";
const studioOrigin = "http://127.0.0.1:3031";
const databaseUrl = "postgresql://video_local:video_local@127.0.0.1:15432/video_local";
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
const pngSignature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const browserFixturePath = resolve(repoRoot, ".codex-longrun", "c04-browser-preview-1x1.png");
const studioUiScreenshotPath = resolve(repoRoot, ".codex-longrun", "c04-studio-ui-e2e.png");
const studioUiE2eScriptPath = resolve(repoRoot, "apps", "control-api", "tests", "c04-studio-ui-e2e.py");
const tsxCliPath = resolve(controlApiRoot, "node_modules", "tsx", "dist", "cli.mjs");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const studioUiResultPrefix = "C04_STUDIO_UI_E2E_RESULT=";
const serviceEnvironment = {
  ...process.env,
  CONTROL_API_PORT: "3032",
  CONTROL_API_ORIGIN: apiOrigin,
  DATABASE_URL: databaseUrl,
  S3_ENDPOINT: storageConfig.endpoint,
  S3_REGION: storageConfig.region,
  S3_BUCKET: storageConfig.bucket,
  S3_ACCESS_KEY: storageConfig.accessKeyId,
  S3_SECRET_KEY: storageConfig.secretAccessKey,
  LOCAL_AUTH_MODE: "dev",
  VIDEO_PROVIDER: "mock",
  VEYRA_AUTH_ENABLED: "false",
  HOST: "127.0.0.1",
  PORT: "3031",
};

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const assertPortAvailable = (port) => new Promise((resolveAvailable, rejectAvailable) => {
  const probe = createServer();
  probe.once("error", () => rejectAvailable(new Error(`Port ${port} is already in use; refusing to stop an existing service.`)));
  probe.listen(port, "127.0.0.1", () => probe.close(resolveAvailable));
});

const requireSuccess = (result, name) => {
  if (result.status !== 0) throw new Error(`${name} failed with exit status ${result.status ?? "unknown"}.`);
};

const pnpmCommand = (args) => {
  if (process.platform !== "win32") return { command: "pnpm", args };
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`],
  };
};

// These direct, one-shot processes remain children of this supervisor. The normal
// pnpm dev command runs tsx watch, whose watcher can outlive its pnpm wrapper.
const startControlApiService = () => spawn(process.execPath, [tsxCliPath, "src/index.ts"], {
  cwd: controlApiRoot,
  env: serviceEnvironment,
  stdio: "ignore",
  windowsHide: true,
});

const startStudioService = () => spawn(process.execPath, [studioServerScriptPath], {
  cwd: studioWebRoot,
  env: serviceEnvironment,
  stdio: "ignore",
  windowsHide: true,
});

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
    if (processes.some((processHandle) => processHandle.exitCode !== null)) {
      throw new Error(`${name} exited before its HTTP endpoint became available.`);
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

const readEnvelope = async (response, name, expectedStatus) => {
  assert.equal(response.status, expectedStatus, `${name} returned an unexpected status.`);
  const body = await response.json();
  assert.ok(body.request_id?.startsWith("req_"), `${name} omitted request_id.`);
  return body;
};

const command = (url, method, idempotencyKey, body) => fetch(url, {
  method,
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  },
  body: JSON.stringify(body),
});

const assertOnePixelPng = (bytes, name) => {
  assert.ok(bytes.byteLength >= 24, `${name} is too short to be a PNG.`);
  assert.deepEqual(bytes.slice(0, pngSignature.byteLength), pngSignature, `${name} has an invalid PNG signature.`);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(header.getUint32(16), 1, `${name} is not one pixel wide.`);
  assert.equal(header.getUint32(20), 1, `${name} is not one pixel high.`);
};

const prepareBrowserFixture = async () => {
  assertOnePixelPng(onePixelPng, "C04 browser fixture");
  await writeFile(browserFixturePath, onePixelPng, { flag: "w" });
};

const cleanupBrowserFixture = async () => {
  await rm(browserFixturePath, { force: true });
};

const cleanupStudioUiArtifacts = async () => {
  await Promise.all([
    cleanupBrowserFixture(),
    rm(studioUiScreenshotPath, { force: true }),
  ]);
};

const isObjectNotFound = (error) => error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;

const cleanupProjectByName = async (projectName, cleanupClient) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const assets = await database.query(
      "SELECT assets.object_key FROM assets INNER JOIN projects ON projects.id = assets.project_id WHERE projects.workspace_id = $1 AND projects.name = $2",
      ["ws_dev_default", projectName],
    );
    const objectKeys = assets.rows.map(({ object_key: objectKey }) => objectKey);
    await Promise.all(objectKeys.map((objectKey) =>
      cleanupClient.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey })).catch(() => undefined),
    ));
    const deleted = await database.query(
      "DELETE FROM projects WHERE workspace_id = $1 AND name = $2 RETURNING id",
      ["ws_dev_default", projectName],
    );
    const remaining = await database.query(
      "SELECT count(*)::integer AS count FROM projects WHERE workspace_id = $1 AND name = $2",
      ["ws_dev_default", projectName],
    );
    assert.equal(remaining.rows[0].count, 0, "C04 Studio UI E2E project cleanup left a database record.");
    await Promise.all(objectKeys.map(async (objectKey) => {
      try {
        await cleanupClient.send(new HeadObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }));
        throw new Error(`C04 Studio UI E2E object cleanup left ${objectKey}.`);
      } catch (error) {
        if (!isObjectNotFound(error)) throw error;
      }
    }));
    return { deletedProjects: deleted.rowCount, deletedObjects: objectKeys.length };
  } finally {
    await database.end();
  }
};

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
  throw new Error("C04 Studio UI E2E did not release 3031/3032 during cleanup.");
};

const run = async () => {
  const suffix = randomUUID();
  let apiProcess;
  let studioProcess;
  let projectId;
  let objectKey;
  const cleanupClient = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: storageConfig.accessKeyId, secretAccessKey: storageConfig.secretAccessKey },
  });

  try {
    await Promise.all([assertPortAvailable(3031), assertPortAvailable(3032)]);
    const migrationCommand = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrationCommand.command, migrationCommand.args, {
      cwd: repoRoot,
      env: serviceEnvironment,
      stdio: "ignore",
      windowsHide: true,
    }), "C04 E2E database migration");

    apiProcess = startControlApiService();
    await waitFor(`${apiOrigin}/api/v1/health`, "Control API", [apiProcess]);
    studioProcess = startStudioService();
    await waitFor(`${studioOrigin}/`, "Studio", [apiProcess, studioProcess]);
    const proxyHealth = await waitFor(`${studioOrigin}/api/v1/health`, "Studio Control API proxy", [apiProcess, studioProcess]);
    const proxyHealthBody = await readEnvelope(proxyHealth, "Studio Control API proxy", 200);
    assert.equal(proxyHealthBody.data.dependencies.database, "ok");

    const project = await readEnvelope(
      await command(`${apiOrigin}/api/v1/projects`, "POST", `c04-e2e-project-${suffix}`, { name: "C04 public HTTP E2E" }),
      "Create project",
      201,
    );
    projectId = project.data.id;
    assert.match(projectId, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);

    const bytes = onePixelPng;
    assertOnePixelPng(bytes, "C04 upload fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const uploadRequest = await readEnvelope(
      await command(`${apiOrigin}/api/v1/projects/${projectId}/assets/upload-requests`, "POST", `c04-e2e-upload-${suffix}`, {
        kind: "IMAGE",
        filename: "reference.png",
        mime_type: "image/png",
        byte_size: bytes.byteLength,
      }),
      "Create upload request",
      201,
    );
    const { asset_id: assetId, upload_url: uploadUrl, headers: uploadHeaders } = uploadRequest.data;
    assert.match(assetId, /^ast_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(uploadHeaders["If-None-Match"], "*");
    assert.equal(typeof uploadUrl, "string");
    objectKey = `ws_dev_default/${projectId}/${assetId}/original.png`;

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { ...uploadHeaders, Origin: studioOrigin },
      body: bytes,
    });
    assert.equal(uploadResponse.status, 200, "Initial presigned asset upload failed.");

    const confirmed = await readEnvelope(
      await command(`${apiOrigin}/api/v1/assets/${assetId}/confirm-upload`, "POST", `c04-e2e-confirm-${suffix}`, {
        sha256,
        mime_type: "image/png",
        byte_size: bytes.byteLength,
      }),
      "Confirm upload",
      200,
    );
    assert.equal(confirmed.data.status, "READY");
    assert.equal("object_key" in confirmed.data, false);

    const download = await readEnvelope(
      await fetch(`${apiOrigin}/api/v1/assets/${assetId}/download-url`),
      "Create download URL",
      200,
    );
    const downloadResponse = await fetch(download.data.download_url);
    assert.equal(downloadResponse.status, 200, "Confirmed asset download failed.");
    assert.match(downloadResponse.headers.get("content-type") ?? "", /^image\/png(?:;|$)/i, "Downloaded asset MIME type changed.");
    const downloaded = new Uint8Array(await downloadResponse.arrayBuffer());
    assertOnePixelPng(downloaded, "Downloaded C04 asset");
    assert.deepEqual(downloaded, bytes, "Downloaded asset bytes changed after confirmation.");

    const createdShot = await readEnvelope(
      await command(`${apiOrigin}/api/v1/projects/${projectId}/shots`, "POST", `c04-e2e-shot-${suffix}`, {
        position: 0,
        prompt: "A product reference opening frame",
        reference_bindings: [{ asset_id: assetId, role: "STYLE", position: 0 }],
      }),
      "Create shot",
      201,
    );
    const shotId = createdShot.data.id;
    const updatedShot = await readEnvelope(
      await command(`${apiOrigin}/api/v1/shots/${shotId}`, "PATCH", `c04-e2e-shot-update-${suffix}`, {
        prompt: "A refined product reference opening frame",
        status: "READY",
        reference_bindings: [{ asset_id: assetId, role: "STYLE", position: 0 }],
      }),
      "Update shot",
      200,
    );
    assert.equal(updatedShot.data.status, "READY");
    assert.equal(updatedShot.data.revision, 2);

    const projectDetail = await readEnvelope(
      await fetch(`${studioOrigin}/api/v1/projects/${projectId}`),
      "Studio proxied project detail",
      200,
    );
    assert.equal(projectDetail.data.assets[0].id, assetId);
    assert.equal(projectDetail.data.shots[0].id, shotId);
    assert.deepEqual(projectDetail.data.reference_bindings, [{
      shot_id: shotId,
      asset_id: assetId,
      role: "STYLE",
      position: 0,
      created_at: projectDetail.data.reference_bindings[0].created_at,
    }]);

  } finally {
    stopService(studioProcess);
    stopService(apiProcess);
    if (objectKey) {
      await cleanupClient.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey })).catch(() => undefined);
    }
    if (projectId) {
      const database = new Client({ connectionString: databaseUrl });
      await database.connect();
      try {
        await database.query("DELETE FROM projects WHERE id = $1", [projectId]);
      } finally {
        await database.end();
      }
    }
    cleanupClient.destroy();
  }
};

const runStudioUiE2E = async () => {
  const projectName = `C04 Studio UI E2E ${randomUUID()}`;
  let apiProcess;
  let studioProcess;
  let result;
  let executionError;
  let cleanupResult;
  const cleanupClient = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: storageConfig.accessKeyId, secretAccessKey: storageConfig.secretAccessKey },
  });
  try {
    await Promise.all([assertPortAvailable(3031), assertPortAvailable(3032)]);
    const migrationCommand = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrationCommand.command, migrationCommand.args, {
      cwd: repoRoot,
      env: serviceEnvironment,
      stdio: "ignore",
      windowsHide: true,
    }), "C04 Studio UI E2E database migration");

    apiProcess = startControlApiService();
    await waitFor(`${apiOrigin}/api/v1/health`, "Control API", [apiProcess]);
    studioProcess = startStudioService();
    await waitFor(`${studioOrigin}/`, "Studio", [apiProcess, studioProcess]);
    const proxyHealth = await waitFor(`${studioOrigin}/api/v1/health`, "Studio Control API proxy", [apiProcess, studioProcess]);
    const proxyHealthBody = await readEnvelope(proxyHealth, "Studio Control API proxy", 200);
    assert.equal(proxyHealthBody.data.dependencies.database, "ok");
    await prepareBrowserFixture();

    const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
      studioUiE2eScriptPath,
      "--studio-origin", studioOrigin,
      "--fixture", browserFixturePath,
      "--project-name", projectName,
      "--screenshot-path", studioUiScreenshotPath,
    ], {
      cwd: repoRoot,
      env: serviceEnvironment,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });
    const uiTestOutput = `${uiTest.stdout ?? ""}\n${uiTest.stderr ?? ""}`;
    if (uiTest.error) {
      throw new Error(`C04 Studio UI E2E Python subprocess failed to start or timed out: ${uiTest.error.name}: ${uiTest.error.message}.`);
    }
    if (uiTest.signal) throw new Error(`C04 Studio UI E2E Python subprocess ended by signal ${uiTest.signal}.`);
    const resultLine = uiTestOutput.split(/\r?\n/).find((line) => line.startsWith(studioUiResultPrefix));
    if (!resultLine) {
      const launchFailure = uiTest.error ? `${uiTest.error.name}: ${uiTest.error.message}` : "none";
      const outputSummary = uiTestOutput.trim().slice(0, 2_000) || "<no output>";
      throw new Error(`C04 Studio UI E2E did not emit its structured result (status=${uiTest.status ?? "null"}, signal=${uiTest.signal ?? "none"}, launch_error=${launchFailure}, output=${outputSummary}).`);
    }
    result = JSON.parse(resultLine.slice(studioUiResultPrefix.length));
    if (uiTest.status !== 0 || !result.ok) throw new Error(`C04 Studio UI E2E failed: ${result.error ?? `exit ${uiTest.status ?? "unknown"}`}.`);
    assert.equal(result.complete, true, "Studio preview image did not finish loading.");
    assert.ok(result.natural_width > 0, "Studio preview image has no natural width.");
    assert.ok(result.natural_height > 0, "Studio preview image has no natural height.");
    await access(result.screenshot_path);
  } catch (error) {
    executionError = error;
  }

  const cleanupFailures = [];
  try {
    stopService(studioProcess);
    stopService(apiProcess);
    await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    cleanupResult = await cleanupProjectByName(projectName, cleanupClient);
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await cleanupStudioUiArtifacts();
  } catch (error) {
    cleanupFailures.push(error);
  } finally {
    cleanupClient.destroy();
  }

  if (cleanupFailures.length) {
    const cleanupError = new AggregateError(cleanupFailures, "C04 Studio UI E2E cleanup failed.");
    if (executionError) throw new AggregateError([executionError, cleanupError], "C04 Studio UI E2E failed and cleanup was incomplete.");
    throw cleanupError;
  }
  if (executionError) throw executionError;
  console.log(`C04 Studio UI E2E passed after UI create/upload/refresh/preview: ${result.natural_width}x${result.natural_height}; removed ${cleanupResult.deletedProjects} project and ${cleanupResult.deletedObjects} object; fixture, screenshot, and services were cleaned.`);
};

if (process.argv.includes("--studio-ui-e2e")) {
  await runStudioUiE2E();
} else {
  await run();
  console.log("C04 public HTTP E2E passed; services and generated test data were cleaned up.");
}
