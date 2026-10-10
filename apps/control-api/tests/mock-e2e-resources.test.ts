import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";

// Test-only MJS supervisors share this helper; there is no public runtime API.
// @ts-expect-error JavaScript test harness intentionally has no generated declaration.
import { assertLoopbackEndpoint, assertMockPortAvailable, createOwnedResources, mockChildEnvironment, readMockE2EConfig, runOwnedCommand, startOwnedService, stopOwnedService } from "./support/mock-e2e-resources.mjs";

const environment = {
  MOCK_E2E_DATABASE_ADMIN_URL: "postgres://test:test@127.0.0.1:5432/postgres",
  MOCK_E2E_REDIS_URL: "redis://127.0.0.1:6379/15",
  MOCK_E2E_S3_ENDPOINT: "http://127.0.0.1:9000",
  MOCK_E2E_S3_REGION: "us-east-1", MOCK_E2E_S3_ACCESS_KEY: "test", MOCK_E2E_S3_SECRET_KEY: "test-only",
};

test("Mock E2E endpoints reject remote, aliases, overrides, whitespace and implicit business configuration", () => {
  for (const host of ["localhost", "127.1", "0x7f000001", "[::1]", "192.0.2.1", "%31%32%37.0.0.1"]) {
    for (const [kind, protocol, path, port] of [["database", "postgres", "/postgres", 5432], ["redis", "redis", "/15", 6379], ["storage", "http", "", 9000]]) {
      assert.throws(() => assertLoopbackEndpoint(`${protocol}://${host}:${port}${path}`, kind));
    }
  }
  for (const suffix of ["?host=192.0.2.1", "?host=127.0.0.1&hostaddr=192.0.2.1", "?hostaddr=%20127.0.0.1", "?sslcert=/tmp/secret", "#ignored", " "]) {
    assert.throws(() => assertLoopbackEndpoint(`${environment.MOCK_E2E_DATABASE_ADMIN_URL}${suffix}`, "database"));
  }
  assert.throws(() => readMockE2EConfig({ DATABASE_URL: environment.MOCK_E2E_DATABASE_ADMIN_URL }, "c06"));
  assert.throws(() => readMockE2EConfig({ ...environment, MOCK_E2E_S3_ENDPOINT: "https://127.0.0.1:9000" }, "c06"));
  assert.throws(() => readMockE2EConfig({ ...environment, MOCK_E2E_DATABASE_ADMIN_URL: "postgres://test:test@127.0.0.1:5432/existing_db" }, "c06"));
});

test("Mock E2E owns unique DB and bucket; child environment excludes real keys, URLs and fallbacks", () => {
  const first = readMockE2EConfig(environment, "c06");
  const second = readMockE2EConfig(environment, "c06");
  assert.notEqual(first.databaseName, second.databaseName);
  assert.notEqual(first.storageConfig.bucket, second.storageConfig.bucket);
  const result = mockChildEnvironment({ PATH: "/bin", VIDEO_PROVIDER: "sub2api", VIDEO_API_KEY: "secret", DOUBAO_API_KEY: "secret", PIXABAY_API_KEY: "secret", NODE_OPTIONS: "--require=bad", DATABASE_URL: "remote", S3_ENDPOINT: "remote", MEDIA_RUNTIME_URL: "remote", HTTP_PROXY: "remote", VEYRA_CREDIT_ENABLED: "true", PIPER_PYTHON_PATH: "bad", PYTHONPATH: "bad" });
  assert.equal(result.VIDEO_PROVIDER, "mock");
  assert.equal(result.LOCAL_AUTH_MODE, "dev");
  assert.equal(result.VEYRA_CREDIT_ENABLED, "false");
  assert.equal(result.PATH, "/bin");
  for (const key of ["VIDEO_API_KEY", "DOUBAO_API_KEY", "PIXABAY_API_KEY", "NODE_OPTIONS", "DATABASE_URL", "S3_ENDPOINT", "MEDIA_RUNTIME_URL", "HTTP_PROXY", "PIPER_PYTHON_PATH", "PYTHONPATH"]) assert.equal(key in result, false);
});

test("Linux C06 port probes do not collide with themselves and reject an occupied port", { skip: process.platform !== "linux" }, async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const { port } = address;
  try { await assert.rejects(assertMockPortAvailable(port, ["127.0.0.1", "::1", "::"]), /refusing to stop/); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  for (let attempt = 0; attempt < 3; attempt++) await assertMockPortAvailable(port, ["127.0.0.1", "::1", "::"]);
});

const fixture = ({ failDelete = false, failBucketCreate = false, keepObject = false, existingBucket = false } = {}) => {
  const config = readMockE2EConfig(environment, "c12");
  const events: string[] = [];
  const objects = new Set(["registered-late", "upload-not-yet-registered"]);
  const databaseClient = () => ({
    connect: async () => { events.push("connect"); }, end: async () => { events.push("end"); },
    query: async (sql: string) => {
      events.push(sql);
      return { rows: sql === "SELECT object_key FROM assets" ? [{ object_key: "registered-late" }] : [] };
    },
  });
  const storageClient = { send: async (command: { constructor: { name: string }; input: { Key?: string } }) => {
    const name = command.constructor.name;
    events.push(name);
    if (name === "HeadBucketCommand" && !existingBucket) throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
    if (name === "CreateBucketCommand" && failBucketCreate) throw new Error("BucketAlreadyExists");
    if (name === "ListObjectsV2Command") return { Contents: [...objects].map((Key) => ({ Key })) };
    if (name === "DeleteObjectCommand") {
      if (failDelete) throw new Error("delete unavailable");
      if (!keepObject) objects.delete(command.input.Key!);
    }
    if (name === "HeadObjectCommand" && !objects.has(command.input.Key!)) throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
    return {};
  } };
  const resources = createOwnedResources(config, { databaseClient, storageClient });
  return { config, events, resources };
};

test("Mock E2E revalidates all targets before clients, including cleanup handles", () => {
  const config = readMockE2EConfig(environment, "c06");
  let clients = 0;
  assert.throws(() => createOwnedResources({ ...config, redisUrl: "redis://192.0.2.1:6379/15" }, { databaseClient: () => { clients++; } }));
  assert.throws(() => createOwnedResources({ ...config, databaseUrl: "postgres://test:test@192.0.2.1:5432/shared" }, { databaseClient: () => { clients++; } }));
  assert.equal(clients, 0);
});

test("both supervisors reject invalid endpoints before diagnostic and cleanup paths", () => {
  for (const script of ["c06-local-e2e.mjs", "c12-local-e2e.mjs"]) {
    for (const overrides of [
      { MOCK_E2E_DATABASE_ADMIN_URL: `${environment.MOCK_E2E_DATABASE_ADMIN_URL}?hostaddr=192.0.2.1` },
      { MOCK_E2E_REDIS_URL: "redis://192.0.2.1:6379/15" },
      { MOCK_E2E_S3_ENDPOINT: "http://192.0.2.1:9000" },
    ]) {
      const result = spawnSync(process.execPath, [`tests/${script}`], { cwd: process.cwd(), env: { ...mockChildEnvironment(process.env), ...environment, ...overrides }, encoding: "utf8", timeout: 5_000 });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /exact 127\.0\.0\.1/);
      assert.doesNotMatch(result.stderr, /Database diagnostics:|C12 state:|cleanup failed|Owned resource creation failed/);
    }
  }
});

test("Mock E2E cleanup collects late and unregistered objects, verifies deletion before dropping owned database", async () => {
  const { resources, events } = fixture();
  await resources.create();
  resources.markMigrated();
  events.push("all-mutators-stopped");
  await resources.cleanupAfterStopped();
  assert.ok(events.indexOf("SELECT object_key FROM assets") > events.indexOf("all-mutators-stopped"));
  assert.equal(events.filter((entry) => entry === "DeleteObjectCommand").length, 2);
  assert.equal(events.filter((entry) => entry === "HeadObjectCommand").length, 2);
  assert.ok(events.findIndex((entry) => entry.startsWith("DROP DATABASE")) > events.indexOf("DeleteBucketCommand"));
  assert.equal(resources.databaseCreated, false);
});

test("Mock E2E deletion errors or visible residual objects preserve DB and bucket", async () => {
  for (const options of [{ failDelete: true }, { keepObject: true }]) {
    const { resources, events } = fixture(options);
    await resources.create();
    resources.markMigrated();
    await assert.rejects(resources.cleanupAfterStopped());
    assert.equal(events.some((entry) => entry.startsWith("DROP DATABASE")), false);
    assert.equal(events.includes("DeleteBucketCommand"), false);
    assert.match(resources.residualDescription(), /database_created=true; bucket_created=true/);
  }
});

test("Mock E2E never adopts a bucket whose creation failed", async () => {
  const { resources, events } = fixture({ failBucketCreate: true });
  await assert.rejects(resources.create());
  await resources.cleanupAfterStopped();
  assert.equal(events.includes("ListObjectsV2Command"), false);
  assert.equal(events.includes("DeleteBucketCommand"), false);
  assert.equal(resources.databaseCreated, false);
});

test("Mock E2E refuses a pre-existing bucket without listing, writing or deleting its content", async () => {
  const { resources, events } = fixture({ existingBucket: true });
  await assert.rejects(resources.create());
  await resources.cleanupAfterStopped();
  for (const command of ["CreateBucketCommand", "ListObjectsV2Command", "DeleteObjectCommand", "DeleteBucketCommand"]) assert.equal(events.includes(command), false);
});

test("owned service stop waits for actual delayed termination before returning", async () => {
  const child = startOwnedService(process.execPath, ["-e", "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150)); console.log('ready'); setInterval(()=>{},1000);"], process.cwd(), mockChildEnvironment(process.env));
  await once(child.stdout, "data");
  const started = Date.now();
  await stopOwnedService(child, "test child");
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  if (process.platform !== "win32") assert.ok(Date.now() - started >= 100);
});

test("owned service stop failure does not claim completion", { skip: process.platform === "win32" }, async () => {
  const child = startOwnedService(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);"], process.cwd(), mockChildEnvironment(process.env));
  await once(child.stdout, "data");
  try { await assert.rejects(stopOwnedService(child, "unresponsive child", 100), /preserve owned DB/); }
  finally { const exit = once(child, "exit"); process.kill(-child.pid, "SIGKILL"); await exit; }
});

test("Windows stop branches (platform-mocked subprocess) never kill an exited PID or accept failed taskkill", () => {
  const helper = new URL("./support/mock-e2e-resources.mjs", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { stopOwnedService } from ${JSON.stringify(helper)};
    let calls = 0;
    childProcess.spawnSync = () => { calls++; return { status: 1 }; };
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    await assert.rejects(stopOwnedService({ pid: 12345, exitCode: 0, signalCode: null }, 'exited root'), /Windows root already exited/);
    assert.equal(calls, 0, 'An exited PID must not be passed to taskkill.');
    await assert.rejects(stopOwnedService({ pid: 12345, exitCode: null, signalCode: null }, 'active root'), /process-tree exit is unverified/);
    assert.equal(calls, 1, 'Failed taskkill must reject cleanup immediately.');
    console.log('WINDOWS_BRANCH_CHECK_PASS');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), env: mockChildEnvironment(process.env), encoding: "utf8", timeout: 5_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WINDOWS_BRANCH_CHECK_PASS/);
});

test("owned command timeout cannot become success when SIGTERM exits with code zero", { skip: process.platform === "win32" }, async () => {
  await assert.rejects(runOwnedCommand(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);"], { cwd: process.cwd(), env: mockChildEnvironment(process.env), timeout: 200 }), /timed out/);
});

test("POSIX supervisor SIGTERM stops the detached command and explicitly preserves test data", { skip: process.platform === "win32", timeout: 8_000 }, async () => {
  const helper = new URL("./support/mock-e2e-resources.mjs", import.meta.url).href;
  const script = `
    import { once } from 'node:events';
    import { currentOwnedServices, installOwnedServiceSignalHandlers, runOwnedCommand, mockChildEnvironment } from ${JSON.stringify(helper)};
    installOwnedServiceSignalHandlers(() => 'database=test-owned; bucket=test-owned');
    const command = runOwnedCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),100));console.log('ready');setInterval(()=>{},1000);"], { cwd: process.cwd(), env: mockChildEnvironment(process.env) });
    const child = currentOwnedServices()[0];
    await once(child.stdout, 'data');
    console.log('child=' + child.pid);
    await command;
    setInterval(()=>{},1000);
  `;
  const supervisor = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), env: mockChildEnvironment(process.env), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  supervisor.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  let childPid: number | undefined;
  try {
    const [output] = await once(supervisor.stdout, "data");
    childPid = Number(String(output).match(/child=(\d+)/)?.[1]);
    assert.ok(Number.isSafeInteger(childPid) && childPid! > 0);
    const closed = once(supervisor, "close");
    supervisor.kill("SIGTERM");
    const [code] = await closed;
    assert.equal(code, 143);
    assert.match(stderr, /test resources are preserved: database=test-owned; bucket=test-owned/);
    assert.throws(() => process.kill(childPid!, 0), { code: "ESRCH" });
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGKILL");
    if (childPid) try { process.kill(-childPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
});
