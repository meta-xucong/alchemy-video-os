import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  createMockMp4Fixture,
  type Sub2ApiTransport,
  type Sub2ApiTransportRequest,
  type Sub2ApiTransportResponse,
} from "@alchemy-video/provider-video";

import {
  createTestDependencies,
  runCertification,
  type CertifierDependencies,
} from "../src/certifier.js";
import {
  CERTIFIER_BUDGET_USD,
  CERTIFIER_MAX_SUBMISSIONS,
  CERTIFIER_PROFILE,
  parseCertifierArguments,
} from "../src/config.js";
import { createCertifierHttpsTransport, type LiveEnvironment } from "../src/live-transport.js";
import {
  claimRecoveryState,
  createCertifierPaths,
  hasRecoveryState,
  reserveSubmission,
  writeRecoveryState,
  type CertifierPaths,
} from "../src/recovery-state.js";
import {
  createLocalCapabilitySnapshot,
  writeLocalCapabilitySnapshot,
} from "../src/capability-snapshot.js";
import { hashProviderRequestId } from "../src/report.js";

const fixture = await createMockMp4Fixture();
const rawProviderRequestId = "synthetic_provider_request_001";
const syntheticEnvironment: LiveEnvironment = {
  baseUrl: "https://video.example.invalid",
  apiKey: "synthetic-test-key",
};

const exactArguments = (mode: "--stop-after-submit" | "--resume") => parseCertifierArguments([
  "--live",
  "--profile", CERTIFIER_PROFILE,
  "--max-submissions", CERTIFIER_MAX_SUBMISSIONS,
  "--budget-usd", CERTIFIER_BUDGET_USD,
  mode,
]);

const streamFrom = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(bytes);
    controller.close();
  },
});

class FakeTransport implements Sub2ApiTransport {
  readonly requests: Sub2ApiTransportRequest[] = [];

  constructor(private readonly input: Readonly<{
    statusPayloads?: unknown[];
    statusResponses?: Array<Readonly<{ status: number; json?: unknown }>>;
    downloadStatus?: number;
    failDownloadStream?: boolean;
    downloadMimeType?: string;
    downloadLength?: number;
    downloadBytes?: Uint8Array;
  }> = {}) {}

  async request(request: Sub2ApiTransportRequest): Promise<Sub2ApiTransportResponse> {
    this.requests.push(structuredClone(request));
    if (request.method === "POST") {
      return {
        status: 202,
        json: {
          id: rawProviderRequestId,
          status: "queued",
          content_url: "https://example.invalid/content?signature=synthetic",
          authorization: "synthetic",
        },
      };
    }
    if (request.path.endsWith("/content")) {
      const bytes = this.input.downloadBytes ?? fixture;
      return {
        status: this.input.downloadStatus ?? 200,
        headers: {
          "content-type": this.input.downloadMimeType ?? "video/mp4",
          "content-length": String(this.input.downloadLength ?? bytes.byteLength),
        },
        stream: this.input.failDownloadStream
          ? new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error(`Bearer synthetic-test-key ${rawProviderRequestId}`)); } })
          : streamFrom(bytes),
      };
    }
    return this.input.statusResponses?.shift() ?? {
      status: 200,
      json: this.input.statusPayloads?.shift() ?? { status: "completed" },
    };
  }
}

const createTemporaryPaths = async (t: test.TestContext): Promise<CertifierPaths> => {
  const root = await mkdtemp(join(tmpdir(), "alchemy-video-c08-certifier-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return createCertifierPaths(root);
};

const createDependencies = (paths: CertifierPaths, transport: Sub2ApiTransport, counters: { environmentReads: number; transportCreates: number }): CertifierDependencies =>
  createTestDependencies({
    paths,
    now: () => new Date("2026-08-14T08:00:00.000Z"),
    readLiveEnvironment: () => {
      counters.environmentReads += 1;
      return syntheticEnvironment;
    },
    createTransport: () => {
      counters.transportCreates += 1;
      return transport;
    },
  });

const readReports = async (paths: CertifierPaths) => {
  const entries = await readdir(paths.reportsDirectory);
  return Promise.all(entries.filter((entry) => entry.endsWith(".json"))
    .map(async (entry) => readFile(join(paths.reportsDirectory, entry), "utf8")));
};

test("C08-OFF-09 rejects every non-exact live invocation before it reads the environment or creates transport", async (t) => {
  const paths = await createTemporaryPaths(t);
  const counters = { environmentReads: 0, transportCreates: 0 };
  const result = await runCertification(parseCertifierArguments([
    "--live",
    "--profile", "seedance-unapproved",
    "--max-submissions", "2",
    "--budget-usd", "1.01",
    "--stop-after-submit",
  ]), createDependencies(paths, new FakeTransport(), counters));

  assert.deepEqual(result, { outcome: "LIVE_CALLS_SKIPPED", reason: "LIVE_GUARD" });
  assert.deepEqual(counters, { environmentReads: 0, transportCreates: 0 });
});

test("C08-OFF-09 treats unavailable or non-HTTPS live configuration as a no-network guard failure", async (t) => {
  const paths = await createTemporaryPaths(t);
  let environmentReads = 0;
  let fetchCalls = 0;
  const dependencies = createTestDependencies({
    paths,
    now: () => new Date("2026-08-14T08:00:00.000Z"),
    readLiveEnvironment: () => {
      environmentReads += 1;
      return { baseUrl: "http://video.example.invalid", apiKey: "synthetic-test-key" };
    },
    createTransport: (environment) => createCertifierHttpsTransport({
      environment,
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("fetch must not be reached");
      },
    }),
  });

  const result = await runCertification(exactArguments("--stop-after-submit"), dependencies);

  assert.deepEqual(result, { outcome: "LIVE_CALLS_SKIPPED", reason: "LIVE_GUARD" });
  assert.equal(environmentReads, 1);
  assert.equal(fetchCalls, 0);
});

test("C08-OFF-09 and C08-OFF-10 permit one POST, retain only recovery state, then resume with GET only", async (t) => {
  const paths = await createTemporaryPaths(t);
  const transport = new FakeTransport({ statusPayloads: [{ status: "processing" }, { state: "completed" }] });
  const counters = { environmentReads: 0, transportCreates: 0 };
  const dependencies = createDependencies(paths, transport, counters);

  const stopped = await runCertification(exactArguments("--stop-after-submit"), dependencies);
  assert.equal(stopped.outcome, "SUBMITTED_STOPPED");
  assert.equal(stopped.providerRequestIdHash, hashProviderRequestId(rawProviderRequestId));
  assert.deepEqual(transport.requests.map((request) => request.method), ["POST"]);
  assert.equal(await hasRecoveryState(paths), true);

  const reportsAfterSubmit = await readReports(paths);
  assert.equal(reportsAfterSubmit.length, 1);
  assert.match(reportsAfterSubmit[0], new RegExp(hashProviderRequestId(rawProviderRequestId)));
  assert.doesNotMatch(reportsAfterSubmit[0], new RegExp(rawProviderRequestId));
  assert.doesNotMatch(reportsAfterSubmit[0], /paper kite|synthetic-test-key|example\.invalid\/content/i);
  assert.doesNotMatch(reportsAfterSubmit[0], /content_url|authorization|signature/i);

  const resumed = await runCertification(exactArguments("--resume"), dependencies);
  assert.equal(resumed.outcome, "SUCCEEDED");
  assert.equal(await hasRecoveryState(paths), false);
  assert.deepEqual(transport.requests.map((request) => request.method), ["POST", "GET", "GET", "GET"]);
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);

  const reportsAfterResume = await readReports(paths);
  assert.equal(reportsAfterResume.length, 2);
  const successReport = reportsAfterResume.find((report) => report.includes('"outcome": "SUCCEEDED"'));
  assert.ok(successReport);
  assert.match(successReport, /"mimeType": "video\/mp4"/);
  assert.match(successReport, /"contentLength": \d+/);
  assert.match(successReport, /"sha256": "[a-f0-9]{64}"/);
  assert.match(successReport, /"ffprobeOk": true/);
  assert.match(successReport, /"providerState": "SUCCEEDED"/);
  assert.doesNotMatch(successReport, /providerFailure/);
  assert.doesNotMatch(successReport, new RegExp(rawProviderRequestId));

  const secondResumeCounters = { environmentReads: 0, transportCreates: 0 };
  const secondResume = await runCertification(exactArguments("--resume"), createDependencies(paths, transport, secondResumeCounters));
  assert.deepEqual(secondResume, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_MISSING" });
  assert.deepEqual(secondResumeCounters, { environmentReads: 0, transportCreates: 0 });
});

test("C08-OFF-10 preserves a recovery state when local live configuration is unavailable and deletes it after expiry without network", async (t) => {
  const paths = await createTemporaryPaths(t);
  const createdAt = new Date("2026-08-14T08:00:00.000Z");
  await writeRecoveryState(paths, rawProviderRequestId, createdAt);
  let environmentReads = 0;
  const unavailableDependencies = createTestDependencies({
    paths,
    now: () => createdAt,
    readLiveEnvironment: () => {
      environmentReads += 1;
      throw new Error("environment is intentionally unavailable");
    },
    createTransport: () => { throw new Error("transport must not be created"); },
  });

  const skippedForEnvironment = await runCertification(exactArguments("--resume"), unavailableDependencies);
  assert.deepEqual(skippedForEnvironment, { outcome: "LIVE_CALLS_SKIPPED", reason: "LIVE_GUARD" });
  assert.equal(environmentReads, 1);
  assert.equal(await hasRecoveryState(paths), true);

  const expiryCounters = { environmentReads: 0, transportCreates: 0 };
  const expiredDependencies = createDependencies(paths, new FakeTransport(), expiryCounters);
  const expired = await runCertification(exactArguments("--resume"), {
    ...expiredDependencies,
    now: () => new Date(createdAt.getTime() + (16 * 60 * 1000)),
  });
  assert.deepEqual(expired, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_EXPIRED" });
  assert.deepEqual(expiryCounters, { environmentReads: 0, transportCreates: 0 });
  assert.equal(await hasRecoveryState(paths), false);
});

test("C08-OFF-10 makes an active recovery claim block both a second resume and a new POST", async (t) => {
  const paths = await createTemporaryPaths(t);
  const now = new Date("2026-08-14T08:00:00.000Z");
  await writeRecoveryState(paths, rawProviderRequestId, now);
  const claimed = await claimRecoveryState(paths, now);
  assert.equal(claimed.kind, "claimed");

  const counters = { environmentReads: 0, transportCreates: 0 };
  const result = await runCertification(exactArguments("--resume"), createDependencies(paths, new FakeTransport(), counters));
  assert.deepEqual(result, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_BUSY" });
  assert.deepEqual(counters, { environmentReads: 0, transportCreates: 0 });
  assert.equal(await hasRecoveryState(paths), true);

  const postCounters = { environmentReads: 0, transportCreates: 0 };
  const postResult = await runCertification(exactArguments("--stop-after-submit"), createDependencies(paths, new FakeTransport(), postCounters));
  assert.deepEqual(postResult, { outcome: "LIVE_CALLS_SKIPPED", reason: "SUBMISSION_LIMIT" });
  assert.deepEqual(postCounters, { environmentReads: 0, transportCreates: 0 });
});

test("C08-OFF-10 renews a long-poll claim and prevents a stale owner from replacing a reclaimed lease", async (t) => {
  const paths = await createTemporaryPaths(t);
  const now = new Date("2026-08-14T08:00:00.000Z");
  await writeRecoveryState(paths, rawProviderRequestId, now);
  const first = await claimRecoveryState(paths, now);
  assert.equal(first.kind, "claimed");
  assert.equal(await first.claim.renew(new Date(now.getTime() + 59_000)), true);

  const second = await claimRecoveryState(paths, new Date(now.getTime() + 120_000));
  assert.equal(second.kind, "claimed");
  assert.equal(await first.claim.renew(new Date(now.getTime() + 121_000)), false);
  await second.claim.release();
});

test("C08-OFF-04 renews the active claim during a processing poll that outlives its initial lease", async (t) => {
  const paths = await createTemporaryPaths(t);
  let now = new Date("2026-08-14T08:00:00.000Z");
  await writeRecoveryState(paths, rawProviderRequestId, now);
  const transport = new FakeTransport({ statusPayloads: [{ status: "processing" }, { status: "completed" }] });
  const dependencies = createTestDependencies({
    paths,
    now: () => now,
    sleep: async () => { now = new Date(now.getTime() + 61_000); },
    readLiveEnvironment: () => syntheticEnvironment,
    createTransport: () => transport,
  });

  const result = await runCertification(exactArguments("--resume"), dependencies);
  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(transport.requests.filter((request) => request.method === "GET").length, 3);
  assert.equal(await hasRecoveryState(paths), false);
});

test("C08-OFF-09 reservation fails closed across a pre-POST interruption and a report write failure", async (t) => {
  const reservedPaths = await createTemporaryPaths(t);
  assert.equal(await reserveSubmission(reservedPaths, new Date("2026-08-14T08:00:00.000Z")), "reserved");
  const reservationCounters = { environmentReads: 0, transportCreates: 0 };
  const afterReservation = await runCertification(
    exactArguments("--stop-after-submit"),
    createDependencies(reservedPaths, new FakeTransport(), reservationCounters),
  );
  assert.deepEqual(afterReservation, { outcome: "LIVE_CALLS_SKIPPED", reason: "SUBMISSION_LIMIT" });
  assert.deepEqual(reservationCounters, { environmentReads: 0, transportCreates: 0 });

  const reportFailurePaths = await createTemporaryPaths(t);
  await mkdir(dirname(reportFailurePaths.reportsDirectory), { recursive: true });
  await writeFile(reportFailurePaths.reportsDirectory, "not-a-directory", "utf8");
  const transport = new FakeTransport();
  const reportCounters = { environmentReads: 0, transportCreates: 0 };
  const first = await runCertification(
    exactArguments("--stop-after-submit"),
    createDependencies(reportFailurePaths, transport, reportCounters),
  );
  assert.equal(first.outcome, "FAILED");
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);

  const secondCounters = { environmentReads: 0, transportCreates: 0 };
  const second = await runCertification(
    exactArguments("--stop-after-submit"),
    createDependencies(reportFailurePaths, transport, secondCounters),
  );
  assert.deepEqual(second, { outcome: "LIVE_CALLS_SKIPPED", reason: "SUBMISSION_LIMIT" });
  assert.deepEqual(secondCounters, { environmentReads: 0, transportCreates: 0 });
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);
});

test("C08-OFF-04 and C08-OFF-05 preserve recovery for retryable poll or download failures and resume with GET only", async (t) => {
  const paths = await createTemporaryPaths(t);
  const submitTransport = new FakeTransport();
  const submitCounters = { environmentReads: 0, transportCreates: 0 };
  assert.equal(
    (await runCertification(exactArguments("--stop-after-submit"), createDependencies(paths, submitTransport, submitCounters))).outcome,
    "SUBMITTED_STOPPED",
  );

  const pollFailureTransport = new FakeTransport({
    statusResponses: [
      { status: 503, json: { message: `Bearer synthetic-test-key ${rawProviderRequestId}`, content_url: "https://example.invalid/content?signature=synthetic", object_key: "private/object" } },
      { status: 503, json: { message: `Bearer synthetic-test-key ${rawProviderRequestId}`, content_url: "https://example.invalid/content?signature=synthetic", object_key: "private/object" } },
      { status: 503, json: { message: `Bearer synthetic-test-key ${rawProviderRequestId}`, content_url: "https://example.invalid/content?signature=synthetic", object_key: "private/object" } },
    ],
  });
  const pollFailure = await runCertification(
    exactArguments("--resume"),
    createDependencies(paths, pollFailureTransport, { environmentReads: 0, transportCreates: 0 }),
  );
  assert.deepEqual(pollFailure, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_RETRY_PENDING" });
  assert.equal(await hasRecoveryState(paths), true);
  assert.equal(pollFailureTransport.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(pollFailureTransport.requests.filter((request) => request.method === "GET").length, 3);
  const pendingReports = await readReports(paths);
  const unavailableReport = pendingReports.find((report) => report.includes('"providerFailure"'));
  assert.ok(unavailableReport);
  assert.match(unavailableReport, /"providerState": "FAILED"/);
  assert.match(unavailableReport, /"classification": "UNAVAILABLE"/);
  assert.match(unavailableReport, /"code": "PROVIDER_UNAVAILABLE"/);
  assert.match(unavailableReport, /"stage": "PROVIDER"/);
  assert.match(unavailableReport, /"retryable": true/);
  assert.doesNotMatch(unavailableReport, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(unavailableReport, /synthetic-test-key|example\.invalid|content_url|object_key|paper kite/i);

  const downloadFailureTransport = new FakeTransport({ downloadStatus: 503 });
  const downloadFailure = await runCertification(
    exactArguments("--resume"),
    createDependencies(paths, downloadFailureTransport, { environmentReads: 0, transportCreates: 0 }),
  );
  assert.deepEqual(downloadFailure, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_RETRY_PENDING" });
  assert.equal(await hasRecoveryState(paths), true);
  assert.equal(downloadFailureTransport.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(downloadFailureTransport.requests.filter((request) => request.method === "GET").length, 4);

  const recoveredTransport = new FakeTransport();
  const recovered = await runCertification(
    exactArguments("--resume"),
    createDependencies(paths, recoveredTransport, { environmentReads: 0, transportCreates: 0 }),
  );
  assert.equal(recovered.outcome, "SUCCEEDED");
  assert.equal(await hasRecoveryState(paths), false);
  assert.equal(recoveredTransport.requests.filter((request) => request.method === "POST").length, 0);
});

test("C08-OFF-09 preserves a configured HTTPS base path and rejects path escape before fetch", async () => {
  const targets: string[] = [];
  const transport = createCertifierHttpsTransport({
    environment: { baseUrl: "https://video.example.invalid/v1", apiKey: "synthetic-test-key" },
    fetcher: async (target) => {
      targets.push(target);
      return {
        status: 200,
        headers: { forEach: () => undefined },
        body: null,
        json: async () => ({ status: "completed" }),
      };
    },
  });

  await transport.request({ method: "GET", path: "/videos/synthetic" });
  assert.deepEqual(targets, ["https://video.example.invalid/v1/videos/synthetic"]);
  await assert.rejects(
    () => transport.request({ method: "GET", path: "/../internal" }),
    /invalid SUB2API path/,
  );
  assert.equal(targets.length, 1);
});

test("C08-OFF-05 and C08-OFF-06 record protocol or download failure without a second submission", async (t) => {
  const paths = await createTemporaryPaths(t);
  const transport = new FakeTransport({ downloadMimeType: "text/plain" });
  const counters = { environmentReads: 0, transportCreates: 0 };
  const dependencies = createDependencies(paths, transport, counters);

  assert.equal((await runCertification(exactArguments("--stop-after-submit"), dependencies)).outcome, "SUBMITTED_STOPPED");
  const failed = await runCertification(exactArguments("--resume"), dependencies);
  assert.equal(failed.outcome, "FAILED");
  assert.equal(await hasRecoveryState(paths), false);
  assert.equal(transport.requests.filter((request) => request.method === "POST").length, 1);

  const reports = await readReports(paths);
  const failureReport = reports.find((report) => report.includes('"outcome": "FAILED"'));
  assert.ok(failureReport);
  assert.match(failureReport, /"classification": "DOWNLOAD_INVALID"/);
  assert.match(failureReport, /"code": "DOWNLOAD_INVALID"/);
  assert.match(failureReport, /"stage": "DOWNLOAD"/);
  assert.match(failureReport, /"retryable": false/);
  assert.doesNotMatch(failureReport, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(failureReport, /synthetic-test-key|example\.invalid|content_url|authorization|signature/i);
});

test("C08-OFF-05 retries an interrupted download stream as GET-only and retains safe recovery evidence", async (t) => {
  const paths = await createTemporaryPaths(t);
  const submitTransport = new FakeTransport();
  assert.equal(
    (await runCertification(exactArguments("--stop-after-submit"), createDependencies(paths, submitTransport, { environmentReads: 0, transportCreates: 0 }))).outcome,
    "SUBMITTED_STOPPED",
  );

  const streamFailureTransport = new FakeTransport({ failDownloadStream: true });
  const resumed = await runCertification(
    exactArguments("--resume"),
    createDependencies(paths, streamFailureTransport, { environmentReads: 0, transportCreates: 0 }),
  );
  assert.deepEqual(resumed, { outcome: "LIVE_CALLS_SKIPPED", reason: "RECOVERY_RETRY_PENDING" });
  assert.equal(streamFailureTransport.requests.filter((request) => request.method === "POST").length, 0);
  assert.equal(streamFailureTransport.requests.filter((request) => request.path.endsWith("/content")).length, 3);
  assert.equal(streamFailureTransport.requests.filter((request) => request.method === "GET" && !request.path.endsWith("/content")).length, 1);
  assert.equal(await hasRecoveryState(paths), true);

  const report = (await readReports(paths)).find((value) => value.includes('"stage": "DOWNLOAD"'));
  assert.ok(report);
  assert.match(report, /"classification": "UNAVAILABLE"/);
  assert.match(report, /"code": "PROVIDER_UNAVAILABLE"/);
  assert.match(report, /"stage": "DOWNLOAD"/);
  assert.match(report, /"retryable": true/);
  assert.doesNotMatch(report, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(report, /synthetic-test-key|example\.invalid|content_url|object_key|paper kite|"message"|"detail"/i);
});

test("C08-OFF-07 records only normalized rejection and protocol-drift evidence", async (t) => {
  const rejectedPaths = await createTemporaryPaths(t);
  const rejectedTransport = new FakeTransport({
    statusPayloads: [{
      status: "rejected",
      message: `Bearer synthetic-test-key ${rawProviderRequestId} paper kite`,
      content_url: "https://example.invalid/content?signature=synthetic",
      object_key: "private/object",
    }],
  });
  const rejectedDependencies = createDependencies(rejectedPaths, rejectedTransport, { environmentReads: 0, transportCreates: 0 });
  assert.equal((await runCertification(exactArguments("--stop-after-submit"), rejectedDependencies)).outcome, "SUBMITTED_STOPPED");
  assert.equal((await runCertification(exactArguments("--resume"), rejectedDependencies)).outcome, "FAILED");

  const rejectedReport = (await readReports(rejectedPaths)).find((report) => report.includes('"classification": "REJECTED"'));
  assert.ok(rejectedReport);
  assert.match(rejectedReport, /"providerState": "FAILED"/);
  assert.match(rejectedReport, /"code": "PROVIDER_REJECTED"/);
  assert.match(rejectedReport, /"stage": "PROVIDER"/);
  assert.match(rejectedReport, /"retryable": false/);
  assert.match(rejectedReport, /"responseFieldNames": \[\n\s+"status"\n\s+\]/);
  assert.doesNotMatch(rejectedReport, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(rejectedReport, /synthetic-test-key|example\.invalid|content_url|object_key|paper kite|"message"|"detail"/i);

  const driftPaths = await createTemporaryPaths(t);
  const driftTransport = new FakeTransport({
    statusPayloads: [{
      message: `Bearer synthetic-test-key ${rawProviderRequestId} paper kite`,
      detail: "https://example.invalid/content?signature=synthetic",
      object_key: "private/object",
    }],
  });
  const driftDependencies = createDependencies(driftPaths, driftTransport, { environmentReads: 0, transportCreates: 0 });
  assert.equal((await runCertification(exactArguments("--stop-after-submit"), driftDependencies)).outcome, "SUBMITTED_STOPPED");
  assert.equal((await runCertification(exactArguments("--resume"), driftDependencies)).outcome, "FAILED");

  const driftReport = (await readReports(driftPaths)).find((report) => report.includes('"classification": "PROTOCOL_DRIFT"'));
  assert.ok(driftReport);
  assert.match(driftReport, /"code": "PROVIDER_PROTOCOL_INVALID"/);
  assert.match(driftReport, /"stage": "PROVIDER"/);
  assert.match(driftReport, /"retryable": false/);
  assert.doesNotMatch(driftReport, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(driftReport, /synthetic-test-key|example\.invalid|content_url|object_key|paper kite|"message"|"detail"/i);
});

test("C08-OFF-07 keeps fixed recovery and report paths ignored and forbids source default transport wiring", async () => {
  const projectRoot = resolve(import.meta.dirname, "..", "..", "..");
  const [ignore, certifier, transport] = await Promise.all([
    readFile(join(projectRoot, ".gitignore"), "utf8"),
    readFile(join(projectRoot, "tools", "sub2api-video-certifier", "src", "certifier.ts"), "utf8"),
    readFile(join(projectRoot, "tools", "sub2api-video-certifier", "src", "live-transport.ts"), "utf8"),
  ]);
  assert.match(ignore, /tools\/sub2api-video-certifier\/recovery\/\*/);
  assert.match(ignore, /tools\/\*\*\/reports\/\*/);
  assert.doesNotMatch(certifier, /process\.env|\bfetch\s*\(/);
  assert.doesNotMatch(transport, /globalThis\.fetch|\bfetch\(/);
});

test("C08-OFF-08 derives a disabled local capability snapshot from a complete hash-only report", async (t) => {
  const paths = await createTemporaryPaths(t);
  const snapshot = createLocalCapabilitySnapshot({
    version: 1,
    evidenceId: "cert_20260814105424895",
    caseId: "LIVE-GROK-001",
    profile: CERTIFIER_PROFILE,
    model: CERTIFIER_PROFILE,
    recordedAt: "2026-08-14T10:54:24.895Z",
    outcome: "SUCCEEDED",
    submitted: true,
    providerRequestIdHash: hashProviderRequestId(rawProviderRequestId),
    requestFieldNames: ["model", "duration", "resolution", "ratio"],
    responseFieldNames: ["id", "status"],
    providerState: "SUCCEEDED",
    terminalStatus: "SUCCEEDED",
    downloadValidation: {
      mimeType: "video/mp4",
      contentLength: fixture.byteLength,
      sha256: "0".repeat(64),
      ffprobeOk: true,
    },
    redactions: ["credentials"],
    cleanup: "RECOVERY_CLEARED",
  });

  assert.equal(snapshot.certificationStatus, "CERTIFIED");
  assert.equal(snapshot.enabled, false);
  assert.deepEqual(snapshot.inputModes, ["text_to_video"]);
  assert.deepEqual(snapshot.durations, [1]);
  const path = await writeLocalCapabilitySnapshot(paths, snapshot);
  const serialized = await readFile(path, "utf8");
  assert.doesNotMatch(serialized, new RegExp(rawProviderRequestId));
  assert.doesNotMatch(serialized, /synthetic-test-key|paper kite|example\.invalid/i);
});
