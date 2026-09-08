import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DeleteObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { clearCreativePlanningQueues, clearDocumentConversionQueues } from "@alchemy-video/task-queue";
import { Client } from "pg";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const controlApiRoot = resolve(repoRoot, "apps", "control-api");
const documentWorkerRoot = resolve(repoRoot, "apps", "document-worker");
const workflowWorkerRoot = resolve(repoRoot, "apps", "workflow-worker");
const studioWebRoot = resolve(repoRoot, "apps", "studio-web");
const runtimeDirectory = resolve(repoRoot, "services", "document-runtime");
const runtimePython = resolve(repoRoot, ".codex-longrun", "c10-document-runtime-venv", "Scripts", "python.exe");
const uiScriptPath = resolve(controlApiRoot, "tests", "c10-studio-ui-e2e.py");
const studioServerScriptPath = resolve(studioWebRoot, "scripts", "serve-local.mjs");
const fixturePath = resolve(repoRoot, ".codex-longrun", "c10-studio-material.md");
const controlApiPort = 3232;
const studioPort = 3231;
const studioBindHost = "127.0.0.1";
const runtimePort = 3040;
const apiOrigin = `http://127.0.0.1:${controlApiPort}`;
const studioOrigin = `http://127.0.0.1:${studioPort}`;
const studioProbeOrigin = studioOrigin;
const runtimeOrigin = `http://127.0.0.1:${runtimePort}`;
const databaseAdminUrl = "postgresql://video_local:video_local@127.0.0.1:15432/postgres";
let databaseUrl = "";
const redisUrl = "redis://127.0.0.1:6380";
const storageConfig = {
  endpoint: "http://127.0.0.1:9002",
  region: "us-east-1",
  bucket: "video-local",
  accessKeyId: "video_local",
  secretAccessKey: "video_local_secret",
};
const resultPrefix = "C10_STUDIO_UI_E2E_RESULT=";

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const createIsolatedDatabase = async (databaseName) => {
  if (!/^c10_e2e_[a-z0-9]+$/.test(databaseName)) throw new Error("C10 E2E generated an unsafe database name.");
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
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().slice(-4_000);
    throw new Error(`${name} failed with exit status ${result.status ?? "unknown"}.${output ? ` ${output}` : ""}`);
  }
};

const startService = (command, args, cwd, env) => {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
  } else {
    processHandle.kill("SIGTERM");
  }
};

const waitFor = async (url, name, processes, acceptedStatus = 200) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const exited = processes.find((processHandle) => processHandle?.exitCode !== null);
    if (exited) throw new Error(`${name} exited before ready: ${String(exited.supervisorOutput ?? "").trim().slice(-2_000) || "<no output>"}`);
    try {
      const response = await fetch(url);
      if (response.status === acceptedStatus) return response;
    } catch {
      // The local child service is still starting.
    }
    await sleep(250);
  }
  throw new Error(`${name} did not return HTTP ${acceptedStatus} before timeout.`);
};

const waitForStopped = async (processHandle, name) => {
  stopService(processHandle);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    await sleep(100);
  }
  throw new Error(`${name} did not stop after the controlled test phase.`);
};

const waitForPortsReleased = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([assertPortAvailable(controlApiPort), assertPortAvailable(studioPort, studioBindHost), assertPortAvailable(runtimePort)]);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("C10 E2E did not release its IPv4 API, Studio, and Runtime ports.");
};

const hasObject = async (storage, objectKey) => {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
};

const controlApiRequest = async (path, init) => {
  const response = await fetch(`${apiOrigin}${path}`, init);
  const payload = await response.json();
  assert.ok(response.ok, `C10 E2E public command ${init.method ?? "GET"} ${path} failed: ${JSON.stringify(payload)}`);
  return payload.data;
};

const waitForConversionStatus = async (projectId, expectedStatus) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const conversions = await controlApiRequest(`/api/v1/projects/${projectId}/documents`, {});
    if (conversions.length === 1 && conversions[0].status === expectedStatus) return conversions[0];
    await sleep(250);
  }
  throw new Error(`C10 E2E document conversion for ${projectId} did not reach ${expectedStatus}.`);
};

const waitForReadyStoryboard = async (projectId) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = await controlApiRequest(`/api/v1/projects/${projectId}`, {});
    const brief = detail.creative_brief_revisions?.[0];
    const storyboard = detail.storyboard_revisions?.[0];
    if (brief?.status === "READY_FOR_REVIEW" && storyboard?.status === "READY_FOR_REVIEW") return detail;
    await sleep(250);
  }
  throw new Error(`C11.1 planning for ${projectId} did not become reviewable.`);
};

const createProjectMaterial = async ({ commandSeedPrefix, fixtureBytes, projectName, suffix }) => {
  const command = (name) => `c10-${commandSeedPrefix}-${suffix}-${name}`;
  const project = await controlApiRequest("/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("project") },
    body: JSON.stringify({ name: projectName }),
  });
  const upload = await controlApiRequest(`/api/v1/projects/${project.id}/assets/upload-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("upload") },
    body: JSON.stringify({ kind: "DOCUMENT", filename: "c10-material.md", mime_type: "text/markdown", byte_size: fixtureBytes.byteLength }),
  });
  assert.ok(upload.upload_url, "C10 E2E source upload request did not return a public presigned URL.");
  const uploadResponse = await fetch(upload.upload_url, { method: "PUT", headers: upload.headers, body: fixtureBytes });
  assert.ok(uploadResponse.ok, `C10 E2E source upload failed with HTTP ${uploadResponse.status}.`);
  await controlApiRequest(`/api/v1/assets/${upload.asset_id}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("confirm") },
    body: JSON.stringify({
      sha256: createHash("sha256").update(fixtureBytes).digest("hex"),
      mime_type: "text/markdown",
      byte_size: fixtureBytes.byteLength,
    }),
  });
  const conversion = await controlApiRequest(`/api/v1/projects/${project.id}/documents/${upload.asset_id}/conversions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("conversion") },
    body: "{}",
  });
  return { project, sourceAssetId: upload.asset_id, conversion };
};

const runStudioUiTest = (input) => {
  const uiTest = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [
    uiScriptPath,
    "--studio-origin", studioOrigin,
    "--fixture", fixturePath,
    "--project-name", input.projectName,
    "--secondary-project-name", input.secondaryProjectName,
    "--project-id", input.projectId,
    "--secondary-project-id", input.secondaryProjectId,
    "--mode", input.mode,
    "--command-seed", input.commandSeed,
  ], { cwd: repoRoot, env: input.environment, encoding: "utf8", timeout: 120_000, windowsHide: true });
  const output = `${uiTest.stdout ?? ""}\n${uiTest.stderr ?? ""}`;
  const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));
  if (!resultLine) throw new Error(`C10 Studio ${input.mode} UI E2E did not emit a structured result: ${output.trim().slice(0, 2_000) || "<no output>"}`);
  const result = JSON.parse(resultLine.slice(resultPrefix.length));
  if (uiTest.error || uiTest.status !== 0 || !result.ok) throw new Error(`C10 Studio ${input.mode} UI E2E failed: ${result.error ?? uiTest.error?.message ?? `exit ${uiTest.status}`}.`);
  return result;
};

const assertPersistedConversions = async (projectNames, storage) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query(
      `SELECT projects.name, document_conversions.status, document_conversions.attempt_count, document_conversions.markdown_asset_id, assets.object_key
       FROM document_conversions
       INNER JOIN projects ON projects.workspace_id = document_conversions.workspace_id AND projects.id = document_conversions.project_id
       INNER JOIN assets ON assets.workspace_id = document_conversions.workspace_id AND assets.id = document_conversions.markdown_asset_id
       WHERE projects.workspace_id = $1 AND projects.name = ANY($2::text[])`,
      ["ws_dev_default", projectNames],
    );
    assert.equal(result.rowCount, 2, "C10 E2E expected one completed conversion per project.");
    for (const row of result.rows) {
      assert.equal(row.status, "SUCCEEDED");
      assert.ok(row.markdown_asset_id);
      assert.equal(await hasObject(storage, row.object_key), true, "C10 E2E Markdown asset is missing from local storage.");
      if (row.name === projectNames[0]) assert.equal(row.attempt_count, 2, "C10 failure/retry did not retain both attempts.");
    }
  } finally {
    await database.end();
  }
};

const assertPublicBoundary = async (projectName) => {
  const projects = await (await fetch(`${apiOrigin}/api/v1/projects`)).json();
  const project = projects.data.find((candidate) => candidate.name === projectName);
  assert.ok(project, "C10 E2E project is missing from the public project list.");
  const payload = await (await fetch(`${apiOrigin}/api/v1/projects/${project.id}/documents`)).json();
  const serialized = JSON.stringify(payload);
  for (const internal of ["object_key", "source_sha256", "runtime_url", "DOCUMENT_RUNTIME_TOKEN", "Authorization"]) {
    assert.equal(serialized.includes(internal), false, `C10 public conversion response leaked ${internal}.`);
  }
};

const assertConvertedMaterialFeedsPrivatePlanning = async ({ project, sourceAssetId, commandSeedPrefix, privateMarker }) => {
  const command = (name) => `c111-${commandSeedPrefix}-${name}`;
  const brief = await controlApiRequest(`/api/v1/projects/${project.id}/creative-brief-revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("brief") },
    body: JSON.stringify({
      source_text: "用项目资料约束交付主题与事实一致性，规划一段简短企业故事。",
      target_duration_seconds: 15,
      target_resolution: "720p",
      style_preferences: "克制、可信的企业纪录片风格",
      source_asset_ids: [sourceAssetId],
    }),
  });
  assert.equal(brief.document_contexts.length, 1);
  assert.equal(brief.document_contexts[0].source_asset_id, sourceAssetId);
  const briefSerialized = JSON.stringify(brief);
  for (const forbidden of ["markdown_sha256", "object_key", "document.md", privateMarker]) {
    assert.equal(briefSerialized.includes(forbidden), false, `C11.1 public brief leaked ${forbidden}.`);
  }
  await controlApiRequest(`/api/v1/creative-brief-revisions/${brief.id}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command("plan") },
    body: "{}",
  });
  const detail = await waitForReadyStoryboard(project.id);
  assert.equal(detail.task_runs.length, 0, "C11.1 planning unexpectedly submitted a video task.");
  assert.match(detail.storyboard_revisions[0].continuity_note, /私有创作约束/);
  const publicSerialized = JSON.stringify(detail);
  for (const forbidden of ["markdown_sha256", "object_key", "document.md", "prompt_packages", privateMarker]) {
    assert.equal(publicSerialized.includes(forbidden), false, `C11.1 public project projection leaked ${forbidden}.`);
  }

  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const contextRows = await database.query(
      `SELECT source_asset_id, markdown_asset_id, markdown_sha256
       FROM creative_brief_document_contexts
       WHERE workspace_id = $1 AND project_id = $2 AND creative_brief_revision_id = $3`,
      ["ws_dev_default", project.id, brief.id],
    );
    assert.equal(contextRows.rowCount, 1, "C11.1 did not persist one frozen document context.");
    assert.equal(contextRows.rows[0].source_asset_id, sourceAssetId);
    assert.match(contextRows.rows[0].markdown_sha256, /^[a-f0-9]{64}$/);
    const prompts = await database.query(
      `SELECT prompt FROM prompt_packages WHERE workspace_id = $1 AND project_id = $2 ORDER BY id`,
      ["ws_dev_default", project.id],
    );
    assert.ok(prompts.rowCount && prompts.rowCount > 0, "C11.1 did not persist private prompt packages.");
    assert.ok(prompts.rows.every((row) => row.prompt.includes(privateMarker)), "C11.1 private PromptPackage did not receive converted Markdown.");
    const factContexts = await database.query(
      `SELECT statement, locator, snapshot_hash FROM creative_brief_fact_contexts
       WHERE workspace_id = $1 AND project_id = $2 AND creative_brief_revision_id = $3 ORDER BY sequence`,
      ["ws_dev_default", project.id, brief.id],
    );
    assert.ok(factContexts.rowCount && factContexts.rowCount > 0, "C11.2 did not freeze any READY document facts into the CreativeBrief.");
    assert.ok(factContexts.rows.some((row) => row.statement.includes(privateMarker)), "C11.2 frozen fact context did not retain the source fact statement.");
    assert.ok(factContexts.rows.every((row) => /^第 \d+ 节：/u.test(row.locator) && /^[a-f0-9]{64}$/u.test(row.snapshot_hash)), "C11.2 fact context lost source locator or immutable snapshot hash.");
    assert.ok(prompts.rows.every((row) => !row.prompt.includes("[PROJECT_DOCUMENT_FACTS_")), "C11.2 Workflow fell back to the legacy raw Markdown prompt block after READY facts were available.");
    assert.ok(prompts.rows.every((row) => row.prompt.includes("FROZEN PROJECT FACT")), "C11.2 PromptPackage did not consume the frozen fact projection.");
  } finally {
    await database.end();
  }
};

const assertPersistedKnowledge = async ({ projectId, sourceAssetId, privateMarker }) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const revisionResult = await database.query(
      `SELECT dc.id AS conversion_id, dc.status AS conversion_status, dc.markdown_asset_id,
              source.sha256 AS source_sha256, dkr.id AS knowledge_revision_id,
              dkr.status, dkr.analysis_quality, dkr.section_count, dkr.fact_count,
              dkr.markdown_sha256
       FROM document_conversions dc
       INNER JOIN assets source
         ON source.workspace_id = dc.workspace_id AND source.project_id = dc.project_id
        AND source.id = dc.markdown_asset_id
       INNER JOIN document_knowledge_revisions dkr
         ON dkr.workspace_id = dc.workspace_id AND dkr.project_id = dc.project_id
        AND dkr.conversion_id = dc.id
       WHERE dc.workspace_id = $1 AND dc.project_id = $2 AND dc.source_asset_id = $3`,
      ["ws_dev_default", projectId, sourceAssetId],
    );
    assert.equal(revisionResult.rowCount, 1, "C11.2 did not persist one knowledge revision for the converted project document.");
    const revision = revisionResult.rows[0];
    assert.equal(revision.conversion_status, "SUCCEEDED");
    assert.equal(revision.status, "READY");
    assert.equal(revision.analysis_quality, "COMPLETE");
    assert.equal(revision.markdown_sha256, revision.source_sha256, "C11.2 knowledge revision did not retain the conversion Markdown SHA.");
    assert.ok(Number(revision.section_count) > 0, "C11.2 knowledge revision has no persisted sections.");
    assert.ok(Number(revision.fact_count) > 0, "C11.2 knowledge revision has no persisted facts.");

    const sections = await database.query(
      `SELECT sequence, locator FROM document_knowledge_sections
       WHERE workspace_id = $1 AND project_id = $2 AND knowledge_revision_id = $3 ORDER BY sequence`,
      ["ws_dev_default", projectId, revision.knowledge_revision_id],
    );
    assert.equal(sections.rowCount, Number(revision.section_count), "C11.2 section count does not match the persisted revision.");
    assert.ok(sections.rows.every((section) => /^第 \d+ 节：/u.test(section.locator)), "C11.2 sections lost their source locator.");
    const facts = await database.query(
      `SELECT statement, confidence, section_id FROM document_facts
       WHERE workspace_id = $1 AND project_id = $2 AND knowledge_revision_id = $3`,
      ["ws_dev_default", projectId, revision.knowledge_revision_id],
    );
    assert.equal(facts.rowCount, Number(revision.fact_count), "C11.2 fact count does not match the persisted revision.");
    assert.ok(facts.rows.some((fact) => fact.statement.includes(privateMarker)), "C11.2 did not persist the later source fact used by the planning fixture.");
    assert.ok(facts.rows.every((fact) => fact.section_id), "C11.2 fact is missing its source section binding.");

    const events = await database.query(
      `SELECT event_type, published_at FROM outbox_events
       WHERE workspace_id = $1 AND project_id = $2 AND aggregate_id = $3 ORDER BY occurred_at`,
      ["ws_dev_default", projectId, revision.knowledge_revision_id],
    );
    const queued = events.rows.filter((event) => event.event_type === "document_knowledge.queued");
    const succeeded = events.rows.filter((event) => event.event_type === "document_knowledge.succeeded");
    assert.equal(queued.length, 1, "C11.2 conversion success did not create exactly one knowledge queue event.");
    assert.ok(queued[0].published_at, "C11.2 knowledge queue event was not published to BullMQ.");
    assert.equal(succeeded.length, 1, "C11.2 Document Worker did not persist exactly one knowledge success event.");

    const documentsResponse = await fetch(`${apiOrigin}/api/v1/projects/${projectId}/documents`);
    assert.equal(documentsResponse.status, 200);
    const documentsPayload = await documentsResponse.json();
    const conversion = documentsPayload.data.find((item) => item.source_asset_id === sourceAssetId);
    assert.equal(conversion?.understanding?.status, "READY", "C11.2 public document list did not expose READY understanding.");
    assert.equal(conversion?.understanding?.knowledge_revision_id, revision.knowledge_revision_id);
    const detailResponse = await fetch(`${apiOrigin}/api/v1/document-knowledge-revisions/${revision.knowledge_revision_id}`);
    assert.equal(detailResponse.status, 200);
    const detailPayload = await detailResponse.json();
    assert.equal(detailPayload.data.facts.length, facts.rowCount);
    assert.equal(detailPayload.data.sections.length, sections.rowCount);
    const publicSerialized = JSON.stringify(detailPayload);
    for (const forbidden of ["markdown_sha256", "object_key", "analyzer_version", "prompt_packages", "provider_request_id", "X-Veyra-Internal-Token", "Authorization"]) {
      assert.equal(publicSerialized.includes(forbidden), false, `C11.2 public knowledge detail leaked ${forbidden}.`);
    }
    return { knowledgeRevisionId: revision.knowledge_revision_id, factCount: facts.rowCount, sectionCount: sections.rowCount };
  } finally {
    await database.end();
  }
};

const cleanupProjects = async (projectNames, storage, commandSeedPrefix) => {
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const projects = await database.query("SELECT id FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[])", ["ws_dev_default", projectNames]);
    const projectIds = projects.rows.map((row) => row.id);
    const objects = await database.query(
      "SELECT assets.object_key FROM assets INNER JOIN projects ON projects.id = assets.project_id WHERE projects.workspace_id = $1 AND projects.name = ANY($2::text[])",
      ["ws_dev_default", projectNames],
    );
    await Promise.all(objects.rows.map((row) => storage.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: row.object_key })).catch(() => undefined)));
    for (const projectId of projectIds) {
      await database.query("DELETE FROM outbox_events WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM creative_brief_document_contexts WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM creative_brief_fact_contexts WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM document_facts WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM document_knowledge_sections WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM document_knowledge_revisions WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM document_conversions WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
      await database.query("DELETE FROM documents WHERE workspace_id = $1 AND project_id = $2", ["ws_dev_default", projectId]);
    }
    await database.query("DELETE FROM command_deduplications WHERE idempotency_key LIKE $1", [`%${commandSeedPrefix}%`]);
    await database.query("DELETE FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[])", ["ws_dev_default", projectNames]);
    const remaining = await database.query("SELECT count(*)::integer AS count FROM projects WHERE workspace_id = $1 AND name = ANY($2::text[])", ["ws_dev_default", projectNames]);
    assert.equal(remaining.rows[0].count, 0, "C10 E2E project cleanup left a database record.");
    for (const row of objects.rows) assert.equal(await hasObject(storage, row.object_key), false, "C10 E2E object cleanup left a local object.");
    return { projects: projectIds.length, objects: objects.rowCount ?? 0 };
  } finally {
    await database.end();
  }
};

const run = async () => {
  const runtimeCheck = spawnSync(runtimePython, ["--version"], { windowsHide: true });
  if (!runtimePython.endsWith("python.exe") || runtimeCheck.status !== 0) {
    throw new Error("C10 E2E requires the dedicated local document-runtime virtualenv.");
  }
  const suffix = randomUUID();
  const commandSeedPrefix = suffix.replaceAll("-", "").slice(0, 8);
  const databaseName = `c10_e2e_${commandSeedPrefix}`;
  const projectName = `C10 Studio E2E ${suffix}`;
  const secondaryProjectName = `${projectName} B`;
  const projectNames = [projectName, secondaryProjectName];
  const queueName = `alchemy-video-c10-${suffix}`;
  const deadLetterQueueName = `${queueName}-dead-letter`;
  const planningQueueName = `alchemy-video-c111-${suffix}`;
  const planningDeadLetterQueueName = `${planningQueueName}-dead-letter`;
  let environment;
  const storage = new S3Client({
    endpoint: storageConfig.endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: { accessKeyId: storageConfig.accessKeyId, secretAccessKey: storageConfig.secretAccessKey },
  });
  let apiProcess;
  let documentWorkerProcess;
  let workflowWorkerProcess;
  let studioProcess;
  let runtimeProcess;
  let databaseCreated = false;
  let cleanupRequired = false;
  let executionError;
  const cleanupFailures = [];
  let cleanupResult;

  try {
    await Promise.all([
      assertTcpReachable("127.0.0.1", 15432, "PostgreSQL"),
      assertTcpReachable("127.0.0.1", 6380, "Redis"),
      assertTcpReachable("127.0.0.1", 9002, "MinIO"),
      assertPortAvailable(controlApiPort),
      assertPortAvailable(studioPort, studioBindHost),
      assertPortAvailable(runtimePort),
    ]);
    databaseUrl = await createIsolatedDatabase(databaseName);
    databaseCreated = true;
    environment = {
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
      LOCAL_AUTH_MODE: "dev",
      VIDEO_PROVIDER: "mock",
      VEYRA_AUTH_ENABLED: "false",
      DOCUMENT_RUNTIME_URL: runtimeOrigin,
      DOCUMENT_RUNTIME_TOKEN: "c10-local-e2e-token",
      DOCUMENT_CONVERSION_QUEUE_NAME: queueName,
      DOCUMENT_CONVERSION_DEAD_LETTER_QUEUE_NAME: deadLetterQueueName,
      CREATIVE_PLANNING_QUEUE_NAME: planningQueueName,
      CREATIVE_PLANNING_DEAD_LETTER_QUEUE_NAME: planningDeadLetterQueueName,
      WORKFLOW_WORKER_ID: `c111-e2e-${commandSeedPrefix}`,
      BUILD_VERSION: `c10-e2e-${suffix}`,
      PYTHONDONTWRITEBYTECODE: "1",
      HOST: studioBindHost,
      PORT: String(studioPort),
      NITRO_HOST: studioBindHost,
      NITRO_PORT: String(studioPort),
      NITRO_CONTROL_API_ORIGIN: apiOrigin,
      STUDIO_NUXT_BUILD_DIR: resolve(repoRoot, ".codex-longrun", "c10-studio-build", suffix),
      STUDIO_NITRO_OUTPUT_DIR: resolve(repoRoot, ".codex-longrun", "c10-studio-output", suffix),
    };
    const migrate = pnpmCommand(["--filter", "@alchemy-video/persistence", "db:migrate"]);
    requireSuccess(spawnSync(migrate.command, migrate.args, { cwd: repoRoot, env: environment, encoding: "utf8", windowsHide: true }), "C10 E2E database migration");
    await writeFile(fixturePath, "# C10 browser material fixture\n\n品牌资料标记：C10 browser material fixture；该内容仅用于验证私有事实引用。\n", "utf8");
    cleanupRequired = true;
    const fixtureBytes = Buffer.from("# C10 browser material fixture\n\n品牌资料标记：C10 browser material fixture；该内容仅用于验证私有事实引用。\n", "utf8");

    apiProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], controlApiRoot, environment);
    const apiHealth = await waitFor(`${apiOrigin}/api/v1/health`, "Control API", [apiProcess]);
    assert.equal((await apiHealth.json()).data.build_version, environment.BUILD_VERSION);
    documentWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], documentWorkerRoot, environment);
    await sleep(1_000);
    if (documentWorkerProcess.exitCode !== null) throw new Error(`C10 Document Worker exited before UI startup: ${documentWorkerProcess.supervisorOutput}`);
    workflowWorkerProcess = startService(process.execPath, ["--import", "tsx", "src/index.ts"], workflowWorkerRoot, environment);
    await sleep(1_000);
    if (workflowWorkerProcess.exitCode !== null) throw new Error(`C11.1 Workflow Worker exited before document conversion: ${workflowWorkerProcess.supervisorOutput}`);
    const firstProject = await createProjectMaterial({ commandSeedPrefix, fixtureBytes, projectName, suffix: "first" });
    await waitForConversionStatus(firstProject.project.id, "FAILED");
    studioProcess = startService(process.execPath, [studioServerScriptPath], studioWebRoot, environment);
    await waitFor(`${studioProbeOrigin}/`, "Studio", [apiProcess, documentWorkerProcess, studioProcess]);
    const proxyHealth = await waitFor(`${studioProbeOrigin}/api/v1/health`, "Studio Control API proxy", [apiProcess, documentWorkerProcess, studioProcess]);
    assert.equal((await proxyHealth.json()).data.build_version, environment.BUILD_VERSION);

    const failure = runStudioUiTest({
      mode: "failure",
      projectName,
      secondaryProjectName,
      projectId: firstProject.project.id,
      secondaryProjectId: "pending",
      commandSeed: suffix,
      environment,
    });
    assert.equal(failure.command_seed_prefix, commandSeedPrefix);
    runtimeProcess = startService(runtimePython, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(runtimePort), "--log-level", "warning"], runtimeDirectory, environment);
    await waitFor(`${runtimeOrigin}/internal/v1/document-conversions`, "Document Runtime", [runtimeProcess], 405);
    const secondProject = await createProjectMaterial({ commandSeedPrefix, fixtureBytes, projectName: secondaryProjectName, suffix: "second" });
    await waitForConversionStatus(secondProject.project.id, "SUCCEEDED");
    const retry = runStudioUiTest({
      mode: "retry",
      projectName,
      secondaryProjectName,
      projectId: firstProject.project.id,
      secondaryProjectId: secondProject.project.id,
      commandSeed: suffix,
      environment,
    });
    assert.equal(retry.command_seed_prefix, commandSeedPrefix);
    assert.equal(retry.mobile_viewport, "390x844");
    assert.ok(retry.markdown_bytes > 0);
    await assertPersistedConversions(projectNames, storage);
    await assertPublicBoundary(projectName);
    await assertPersistedKnowledge({ projectId: secondProject.project.id, sourceAssetId: secondProject.sourceAssetId, privateMarker: "C10 browser material fixture" });
    await assertConvertedMaterialFeedsPrivatePlanning({
      project: secondProject.project,
      sourceAssetId: secondProject.sourceAssetId,
      commandSeedPrefix,
      privateMarker: "C10 browser material fixture",
    });
  } catch (error) {
    const processOutput = (name, processHandle) => `${name}: ${String(processHandle?.supervisorOutput ?? "<not started>").trim().slice(-2_000)}`;
    executionError = new Error([
      error instanceof Error ? error.message : String(error),
      processOutput("Control API", apiProcess),
      processOutput("Document Worker", documentWorkerProcess),
      processOutput("Workflow Worker", workflowWorkerProcess),
      processOutput("Studio", studioProcess),
      processOutput("Document Runtime", runtimeProcess),
    ].join("\n"));
  }

  try {
    await waitForStopped(studioProcess, "C10 Studio");
    await waitForStopped(runtimeProcess, "C10 Document Runtime");
    await waitForStopped(workflowWorkerProcess, "C11.1 Workflow Worker");
    await waitForStopped(documentWorkerProcess, "C10 Document Worker");
    await waitForStopped(apiProcess, "C10 Control API");
    await waitForPortsReleased();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupRequired) {
    try {
      cleanupResult = await cleanupProjects(projectNames, storage, commandSeedPrefix);
      await clearDocumentConversionQueues({ redisUrl, queueName, deadLetterQueueName });
      await clearCreativePlanningQueues({ redisUrl, queueName: planningQueueName, deadLetterQueueName: planningDeadLetterQueueName });
      await Promise.all([
        rm(fixturePath, { force: true }),
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
  {
    storage.destroy();
  }
  if (cleanupFailures.length) throw new AggregateError(executionError ? [executionError, ...cleanupFailures] : cleanupFailures, "C10 E2E cleanup failed.");
  if (executionError) throw executionError;
  console.log(`C10/C11.1 local E2E passed: document failure/retry, Markdown download, private planning context, public-boundary scan, refresh, project isolation and mobile layout; removed ${cleanupResult.projects} projects and ${cleanupResult.objects} objects.`);
};

await run();
