// Test-only infrastructure shell. Source: existing C06/C12 supervisors and the
// legacy-fence loopback guard; no Provider or media semantics are changed here.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand,
  HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, S3Client,
} from "@aws-sdk/client-s3";
import { Client } from "pg";

const ownedServices = new Set();
const provenStoppedServices = new WeakSet();
let interruptedSignal;
export const currentOwnedServices = () => [...ownedServices];
export const ownedRunInterrupted = () => interruptedSignal !== undefined;

export const assertLoopbackEndpoint = (value, kind) => {
  if (typeof value !== "string" || !value || /\s/.test(value)) throw new Error(`${kind} requires an explicit loopback test URL without whitespace.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${kind} is not a valid test URL.`); }
  const protocols = kind === "database" ? ["postgres:", "postgresql:"] : kind === "redis" ? ["redis:"] : ["http:"];
  // Check literal authority too: WHATWG URL canonicalizes 127.1/hex IPv4.
  const authority = value.match(/^[a-z]+:\/\/([^/?#]+)/i)?.[1]?.split("@").at(-1);
  if (!protocols.includes(url.protocol) || !/^127\.0\.0\.1:\d+$/.test(authority ?? "") || url.hostname !== "127.0.0.1" || !url.port || url.search || url.hash) {
    throw new Error(`${kind} must use exact 127.0.0.1, an explicit port, and no query or fragment.`);
  }
  if (kind === "database" && url.pathname !== "/postgres") throw new Error("Test database admin URL must select postgres; each run creates its own database.");
  if (kind === "redis" && !/^\/(?:\d+)?$/.test(url.pathname)) throw new Error("Test Redis URL must select a numeric database.");
  if (kind === "storage" && (url.pathname !== "/" || url.username || url.password)) throw new Error("Test storage URL must be an HTTP origin without credentials.");
  return value;
};

export const readMockE2EConfig = (environment, suite) => {
  if (!new Set(["c06", "c12"]).has(suite)) throw new Error("Unsupported Mock E2E suite.");
  // Validate every endpoint before any client, diagnostics, or cleanup exists.
  const databaseAdminUrl = assertLoopbackEndpoint(environment.MOCK_E2E_DATABASE_ADMIN_URL, "database");
  const redisUrl = assertLoopbackEndpoint(environment.MOCK_E2E_REDIS_URL, "redis");
  const endpoint = assertLoopbackEndpoint(environment.MOCK_E2E_S3_ENDPOINT, "storage");
  for (const key of ["MOCK_E2E_S3_REGION", "MOCK_E2E_S3_ACCESS_KEY", "MOCK_E2E_S3_SECRET_KEY"]) {
    if (!environment[key]) throw new Error(`${key} is required; business environment credentials are never inherited.`);
  }
  const suffix = randomUUID().replaceAll("-", "");
  const databaseName = `${suite}_e2e_${suffix}`;
  const databaseUrl = new URL(databaseAdminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  return {
    databaseAdminUrl, databaseName, databaseUrl: databaseUrl.href, redisUrl,
    storageConfig: {
      endpoint, region: environment.MOCK_E2E_S3_REGION, bucket: `alchemy-${suite}-${suffix}`,
      accessKeyId: environment.MOCK_E2E_S3_ACCESS_KEY, secretAccessKey: environment.MOCK_E2E_S3_SECRET_KEY,
    },
  };
};

export const mockChildEnvironment = (source) => {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL", "CI", "PLAYWRIGHT_BROWSERS_PATH"];
  const environment = Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  return { ...environment, LOCAL_AUTH_MODE: "dev", VIDEO_PROVIDER: "mock", VEYRA_AUTH_ENABLED: "false", VEYRA_CREDIT_ENABLED: "false", PYTHONDONTWRITEBYTECODE: "1", NUXT_TELEMETRY_DISABLED: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" };
};

export const assertMockPortAvailable = async (port, hosts = ["127.0.0.1"]) => {
  // Sequential probes are intentional: a Linux dual-stack :: listener would
  // collide with our own concurrent 127.0.0.1/::1 probes on an otherwise free port.
  for (const host of hosts) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () => reject(new Error(`Port ${host}:${port} is already in use or unavailable; refusing to stop an existing service.`)));
      probe.listen(port, host, () => probe.close((error) => error ? reject(error) : resolve()));
    });
  }
};

export const startOwnedService = (command, args, cwd, environment) => {
  if (ownedRunInterrupted()) throw new Error("Interrupted Mock E2E must not start another process.");
  const child = spawn(command, args, { cwd, env: environment, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  let spawnError;
  const append = (chunk) => { output = `${output}${chunk.toString("utf8")}`.slice(-20_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", (error) => { spawnError = error; });
  Object.defineProperties(child, {
    supervisorOutput: { get: () => output }, supervisorSpawnError: { get: () => spawnError },
    ownedProcessGroup: { value: process.platform !== "win32" },
  });
  ownedServices.add(child);
  return child;
};

const processGroupAlive = (child) => {
  if (!child.ownedProcessGroup || !child.pid) return false;
  try { process.kill(-child.pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
};

export const stopOwnedService = async (child, name, timeoutMs = 15_000) => {
  if (!child || !child.pid || provenStoppedServices.has(child)) return;
  if (process.platform === "win32") {
    // An exited root may have descendants, and its PID may have been reused.
    // Never taskkill a known-exited PID or use root exit as cleanup permission.
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name} Windows root already exited; process-tree exit is unverified, so preserve owned resources.`);
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`${name} Windows process-tree exit is unverified; preserve owned resources.`);
  } else {
    try { process.kill(child.ownedProcessGroup ? -child.pid : child.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((child.exitCode !== null || child.signalCode !== null) && !processGroupAlive(child)) {
      provenStoppedServices.add(child);
      ownedServices.delete(child);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${name} did not fully stop; preserve owned DB, bucket, queues and files for diagnosis.`);
};

export const runOwnedCommand = async (command, args, { cwd, env, timeout = 120_000 }) => {
  const child = startOwnedService(command, args, cwd, env);
  return await new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void stopOwnedService(child, "Timed-out E2E command").then(
        () => reject(new Error("Owned E2E command timed out.")), reject,
      );
    }, timeout);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (status) => {
      clearTimeout(timer);
      if (timedOut) { reject(new Error("Owned E2E command timed out.")); return; }
      resolve({ status, stdout: child.supervisorOutput, stderr: "" });
    });
  });
};

export const installOwnedServiceSignalHandlers = (describeResources) => {
  let stopping = false;
  const interrupted = async (signal) => {
    if (stopping) return;
    stopping = true;
    interruptedSignal = signal;
    console.error(`${signal}: stopping owned processes; test resources are preserved: ${describeResources()}`);
    const results = await Promise.allSettled(currentOwnedServices().map((child) => stopOwnedService(child, `Owned process ${child.pid}`)));
    for (const result of results) if (result.status === "rejected") console.error(String(result.reason));
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => { void interrupted("SIGINT"); });
  process.on("SIGTERM", () => { void interrupted("SIGTERM"); });
};

export const createOwnedResources = (config, { databaseClient = (url) => new Client({ connectionString: url }), storageClient } = {}) => {
  assertLoopbackEndpoint(config.databaseAdminUrl, "database");
  assertLoopbackEndpoint(config.redisUrl, "redis");
  assertLoopbackEndpoint(config.storageConfig.endpoint, "storage");
  if (!/^c(?:06|12)_e2e_[a-f0-9]{32}$/.test(config.databaseName) || !/^alchemy-c(?:06|12)-[a-f0-9]{32}$/.test(config.storageConfig.bucket)) throw new Error("Mock E2E resources require generated private names.");
  const expectedDatabaseUrl = new URL(config.databaseAdminUrl);
  expectedDatabaseUrl.pathname = `/${config.databaseName}`;
  if (config.databaseUrl !== expectedDatabaseUrl.href) throw new Error("Mock E2E database URL does not match its private database.");
  const storage = storageClient ?? new S3Client({ endpoint: config.storageConfig.endpoint, region: config.storageConfig.region, forcePathStyle: true, credentials: { accessKeyId: config.storageConfig.accessKeyId, secretAccessKey: config.storageConfig.secretAccessKey } });
  let databaseCreated = false;
  let bucketCreated = false;
  let migrated = false;
  const withDatabase = async (url, action) => {
    const database = databaseClient(url);
    try { await database.connect(); return await action(database); } finally { await database.end(); }
  };
  const listKeys = async () => {
    const keys = [];
    let token;
    do {
      const page = await storage.send(new ListObjectsV2Command({ Bucket: config.storageConfig.bucket, ContinuationToken: token }));
      keys.push(...(page.Contents ?? []).map((item) => item.Key).filter(Boolean));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
      if (page.IsTruncated && !token) throw new Error("Owned bucket listing was incomplete; preserve database.");
    } while (token);
    return keys;
  };
  return {
    storage,
    get databaseCreated() { return databaseCreated; },
    get migrated() { return migrated; },
    markMigrated() { migrated = true; },
    residualDescription() { return `database=${config.databaseName}; bucket=${config.storageConfig.bucket}; database_created=${databaseCreated}; bucket_created=${bucketCreated}`; },
    async create() {
      try {
        await withDatabase(config.databaseAdminUrl, (database) => database.query(`CREATE DATABASE ${config.databaseName}`));
        databaseCreated = true;
        // Never adopt an existing bucket, even if credentials grant access to it.
        try {
          await storage.send(new HeadBucketCommand({ Bucket: config.storageConfig.bucket }));
          throw new Error("Generated test bucket already exists; refusing to adopt it.");
        } catch (error) {
          if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchBucket") throw error;
        }
        await storage.send(new CreateBucketCommand({ Bucket: config.storageConfig.bucket }));
        bucketCreated = true;
      } catch (error) {
        throw new Error(`Owned resource creation failed; inspect requested database=${config.databaseName}, bucket=${config.storageConfig.bucket}. Unacknowledged creation may have left a resource; it will not be adopted or deleted.`, { cause: error });
      }
    },
    async cleanupAfterStopped() {
      if (ownedRunInterrupted()) throw new Error("Interrupted Mock E2E preserves its owned resources.");
      // Caller must first confirm every owned mutator has stopped. Query late
      // assets now, not only on the success path; private bucket listing also
      // catches interrupted uploads not yet recorded in the database.
      const rows = databaseCreated && migrated
        ? await withDatabase(config.databaseUrl, async (database) => (await database.query("SELECT object_key FROM assets")).rows)
        : [];
      if (bucketCreated) {
        const keys = [...new Set([...rows.map((row) => row.object_key), ...await listKeys()])];
        for (const key of keys) {
          await storage.send(new DeleteObjectCommand({ Bucket: config.storageConfig.bucket, Key: key }));
          try {
            await storage.send(new HeadObjectCommand({ Bucket: config.storageConfig.bucket, Key: key }));
            throw new Error("Owned object remains after deletion; preserve database.");
          } catch (error) {
            if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") throw error;
          }
        }
        if ((await listKeys()).length) throw new Error("Owned bucket is not empty; preserve database.");
        await storage.send(new DeleteBucketCommand({ Bucket: config.storageConfig.bucket }));
        bucketCreated = false;
      }
      if (databaseCreated) {
        await withDatabase(config.databaseAdminUrl, (database) => database.query(`DROP DATABASE ${config.databaseName}`));
        databaseCreated = false;
      }
    },
  };
};
