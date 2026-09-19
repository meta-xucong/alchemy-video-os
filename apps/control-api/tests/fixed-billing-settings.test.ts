import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createFixedVideoBillingSettingsStore, FixedBillingSettingsError, resolveFixedVideoBillingTier } from "../src/fixed-billing-settings.js";

const row = (overrides: Record<string, unknown> = {}) => ({
  key: "video:grok:480p:5",
  label: "Grok 480p 5 秒",
  model: "grok-imagine-video-1.5",
  resolution: "480p",
  duration_seconds: 5,
  charge_amount: "1.2",
  enabled: true,
  ...overrides,
});

test("fixed billing settings persist and resolve only an exact enabled tier", () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-billing-"));
  const path = join(directory, "settings.json");
  try {
    const first = createFixedVideoBillingSettingsStore(path);
    assert.deepEqual(first.get(), { enabled: false, tiers: [] });
    first.update({ enabled: true, tiers: [row()] });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).tiers[0].key, row().key);
    const second = createFixedVideoBillingSettingsStore(path);
    const settings = second.get();
    assert.equal(settings.enabled, true);
    assert.equal(resolveFixedVideoBillingTier(settings, { model: row().model as string, resolution: "480p", duration: 5 })?.charge_amount, "1.2");
    assert.equal(resolveFixedVideoBillingTier(settings, { model: row().model as string, resolution: "720p", duration: 5 }), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed billing settings reject duplicate keys and ambiguous enabled dimensions", () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-billing-"));
  try {
    const store = createFixedVideoBillingSettingsStore(join(directory, "settings.json"));
    assert.throws(() => store.update({ enabled: true, tiers: [row(), row()] }), FixedBillingSettingsError);
    assert.throws(() => store.update({ enabled: true, tiers: [row(), row({ key: "video:grok:480p:5-copy" })] }), FixedBillingSettingsError);
    assert.doesNotThrow(() => store.update({ enabled: true, tiers: [row(), row({ key: "video:grok:480p:5-copy", enabled: false })] }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Grok fixed rows do not become a global default for a future Seedance-like profile model", () => {
  const settings = {
    enabled: true,
    tiers: [row()],
  };

  // This is deliberately only a provider/profile model-key lookup: no
  // unprovided Seedance price is introduced into the fixture.
  assert.equal(resolveFixedVideoBillingTier(settings, {
    model: "seedance-video-v1",
    resolution: "480p",
    duration: 5,
  }), undefined);
});

test("fixed billing command receipts and settings survive separate store instances", () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-billing-"));
  const path = join(directory, "settings.json");
  try {
    const first = createFixedVideoBillingSettingsStore(path);
    const second = createFixedVideoBillingSettingsStore(path);
    const scope = "admin-user:PUT:/api/v1/admin/billing-settings";
    const initial = { enabled: true, tiers: [row()] };

    assert.deepEqual(first.updateIdempotent({
      scope,
      idempotencyKey: "settings-cross-instance",
      requestHash: "request-hash-a",
      settings: initial,
    }), { kind: "NEW", settings: initial });
    assert.deepEqual(second.updateIdempotent({
      scope,
      idempotencyKey: "settings-cross-instance",
      requestHash: "request-hash-a",
      settings: { enabled: false, tiers: [] },
    }), { kind: "REPLAY", settings: initial });
    assert.deepEqual(second.updateIdempotent({
      scope,
      idempotencyKey: "settings-cross-instance",
      requestHash: "request-hash-b",
      settings: { enabled: false, tiers: [] },
    }), { kind: "CONFLICT" });

    // Warm the first instance, then update via the second.  A later read must
    // observe the durable settings instead of a process-local cached copy.
    assert.equal(first.get().tiers[0]?.charge_amount, "1.2");
    const changed = { enabled: true, tiers: [row({ charge_amount: "1.3" })] };
    assert.deepEqual(second.updateIdempotent({
      scope,
      idempotencyKey: "settings-cross-instance-2",
      requestHash: "request-hash-c",
      settings: changed,
    }), { kind: "NEW", settings: changed });
    assert.equal(first.get().tiers[0]?.charge_amount, "1.3");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed billing command serialization permits one concurrent NEW and preserves replay/conflict across processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-billing-concurrent-"));
  const path = join(directory, "settings.json");
  const startPath = join(directory, "start");
  const releasePath = join(directory, "release");
  const moduleUrl = new URL("../src/fixed-billing-settings.ts", import.meta.url).href;
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
  const settings = { enabled: true, tiers: [row()] };
  const conflictingSettings = { enabled: true, tiers: [row({ charge_amount: "1.3" })] };
  const scope = "admin-user:PUT:/api/v1/admin/billing-settings";
  const childScript = `
    import { existsSync, writeFileSync } from "node:fs";
    const sleep = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
    writeFileSync(process.env.FIXED_BILLING_READY, String(process.pid), { flag: "wx" });
    while (!existsSync(process.env.FIXED_BILLING_START)) sleep(5);
    writeFileSync(process.env.FIXED_BILLING_ENTERED, String(process.pid), { flag: "wx" });
    while (!existsSync(process.env.FIXED_BILLING_RELEASE)) sleep(5);
    const billingModule = await import(process.env.FIXED_BILLING_MODULE);
    const result = billingModule.createFixedVideoBillingSettingsStore(process.env.FIXED_BILLING_SETTINGS).updateIdempotent({
      scope: process.env.FIXED_BILLING_SCOPE,
      idempotencyKey: process.env.FIXED_BILLING_KEY,
      requestHash: process.env.FIXED_BILLING_HASH,
      settings: JSON.parse(process.env.FIXED_BILLING_BODY),
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const children: ReturnType<typeof spawn>[] = [];
  const childPromises: Promise<unknown>[] = [];
  const childCount = 4;
  const lockPath = `${path}.lock`;
  const waitForFiles = async (paths: string[]) => {
    const deadline = Date.now() + 10_000;
    while (paths.some((filePath) => !existsSync(filePath))) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for concurrent billing fixture processes.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    // Force every contender through the dead-owner recovery branch before it
    // attempts the same-key read/check/write transaction.
    writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, token: "dead-owner" }), "utf8");
    for (let index = 0; index < childCount; index += 1) {
      const readyPath = join(directory, `ready-${index}`);
      const enteredPath = join(directory, `entered-${index}`);
      const child = spawn(process.execPath, ["--import", tsxLoader, "--eval", childScript], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FIXED_BILLING_READY: readyPath,
          FIXED_BILLING_START: startPath,
          FIXED_BILLING_ENTERED: enteredPath,
          FIXED_BILLING_RELEASE: releasePath,
          FIXED_BILLING_MODULE: moduleUrl,
          FIXED_BILLING_SETTINGS: path,
          FIXED_BILLING_SCOPE: scope,
          FIXED_BILLING_KEY: "fixed-concurrent-key",
          FIXED_BILLING_HASH: index < childCount / 2 ? "fixed-concurrent-hash-a" : "fixed-concurrent-hash-b",
          FIXED_BILLING_BODY: JSON.stringify(index < childCount / 2 ? settings : conflictingSettings),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(child);
      childPromises.push(new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.stderr?.on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code !== 0) {
            reject(new Error(`Concurrent billing fixture exited with ${code ?? signal}: ${stderr || stdout}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (error) {
            reject(error);
          }
        });
      }));
    }

    await waitForFiles(Array.from({ length: childCount }, (_, index) => join(directory, `ready-${index}`)));
    writeFileSync(startPath, "start", "utf8");
    await waitForFiles(Array.from({ length: childCount }, (_, index) => join(directory, `entered-${index}`)));
    writeFileSync(releasePath, "release", "utf8");
    const results = await Promise.all(childPromises);
    assert.equal(results.filter((result) => (result as { kind?: string }).kind === "NEW").length, 1);
    assert.equal(results.filter((result) => (result as { kind?: string }).kind === "REPLAY").length, 1);
    assert.equal(results.filter((result) => (result as { kind?: string }).kind === "CONFLICT").length, 2);
    const winner = results.find((result) => (result as { kind?: string }).kind === "NEW") as { settings: unknown };
    assert.deepEqual(createFixedVideoBillingSettingsStore(path).get(), winner.settings);
    assert.equal(existsSync(lockPath), false);
  } finally {
    for (const child of children) {
      if (!child.killed) child.kill();
    }
    await Promise.allSettled(childPromises);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed billing lock with invalid metadata fails closed without reclaiming it", () => {
  const markers = ["not-json", JSON.stringify({ token: "missing-pid" })];
  for (const marker of markers) {
    const directory = mkdtempSync(join(tmpdir(), "video-fixed-billing-invalid-lock-"));
    const path = join(directory, "settings.json");
    const lockPath = `${path}.lock`;
    try {
      writeFileSync(lockPath, marker, "utf8");
      const store = createFixedVideoBillingSettingsStore(path);
      assert.throws(() => store.updateIdempotent({
        scope: "admin-user:PUT:/api/v1/admin/billing-settings",
        idempotencyKey: "invalid-lock-key",
        requestHash: "invalid-lock-hash",
        settings: { enabled: true, tiers: [row()] },
      }), (error: unknown) => error instanceof FixedBillingSettingsError
        && /invalid|busy/.test(error.message));
      assert.equal(readFileSync(lockPath, "utf8"), marker);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
