import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createVeyraCurrentIdentity, type CurrentIdentity, type IdentityPort } from "../src/identity.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";
import { createFixedVideoBillingSettingsStore } from "../src/fixed-billing-settings.js";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const adminIdentity = createVeyraCurrentIdentity({
  externalUserId: 20260916,
  intent: "video",
  email: "fixed-admin@example.test",
  role: "admin",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const userIdentity = createVeyraCurrentIdentity({
  externalUserId: 20260917,
  intent: "video",
  email: "fixed-user@example.test",
  role: "owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

class StaticIdentityAdapter implements IdentityPort {
  constructor(private readonly identity: CurrentIdentity) {}
  async resolve(): Promise<CurrentIdentity> { return this.identity; }
}

const accountBridge = {
  getAccount: async ({ externalUserId }: { externalUserId: number }) => ({
    externalUserId,
    email: externalUserId === 20260916 ? "fixed-admin@example.test" : "fixed-user@example.test",
    role: externalUserId === 20260916 ? "admin" : "owner",
    balance: "99",
    status: "active",
    concurrency: 2,
  }),
};

const tier = {
  key: "video:grok:480p:5",
  label: "Grok 480p 5 秒",
  model: "grok-imagine-video-1.5",
  resolution: "480p",
  duration_seconds: 5,
  charge_amount: "1.2",
  enabled: true,
};

test("fixed billing admin settings are admin-only and idempotent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-api-"));
  try {
    const settings = createFixedVideoBillingSettingsStore(join(directory, "settings.json"));
    const adminApp = createApp({ identity: new StaticIdentityAdapter(adminIdentity), videoVeyraBridge: accountBridge as never, fixedVideoBillingSettings: settings, videoBillingMode: "fixed_tiers" });
    const userApp = createApp({ identity: new StaticIdentityAdapter(userIdentity), videoVeyraBridge: accountBridge as never, fixedVideoBillingSettings: settings, videoBillingMode: "fixed_tiers" });

    const forbidden = await userApp.request("http://localhost/api/v1/admin/billing-settings");
    assert.equal(forbidden.status, 403);
    assert.equal((await readJson(forbidden)).error.code, "AUTH_FORBIDDEN");

    const body = { enabled: true, tiers: [tier] };
    const update = await adminApp.request("http://localhost/api/v1/admin/billing-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-settings-1" },
      body: JSON.stringify(body),
    });
    assert.equal(update.status, 200);
    assert.deepEqual((await readJson(update)).data, body);

    const replay = await adminApp.request("http://localhost/api/v1/admin/billing-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-settings-1" },
      body: JSON.stringify(body),
    });
    assert.equal(replay.status, 200);
    const conflict = await adminApp.request("http://localhost/api/v1/admin/billing-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-settings-1" },
      body: JSON.stringify({ enabled: false, tiers: [tier] }),
    });
    assert.equal(conflict.status, 409);

    const policy = await adminApp.request("http://localhost/api/v1/me/billing-policy");
    assert.equal(policy.status, 200);
    assert.deepEqual((await readJson(policy)).data.fixed_tiers, [tier]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed billing admin idempotency survives separate API/store instances and reloads settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-api-"));
  try {
    const firstSettings = createFixedVideoBillingSettingsStore(join(directory, "settings.json"));
    const secondSettings = createFixedVideoBillingSettingsStore(join(directory, "settings.json"));
    const firstApp = createApp({
      identity: new StaticIdentityAdapter(adminIdentity),
      videoVeyraBridge: accountBridge as never,
      fixedVideoBillingSettings: firstSettings,
      videoBillingMode: "fixed_tiers",
    });
    const secondApp = createApp({
      identity: new StaticIdentityAdapter(adminIdentity),
      videoVeyraBridge: accountBridge as never,
      fixedVideoBillingSettings: secondSettings,
      videoBillingMode: "fixed_tiers",
    });
    const url = "http://localhost/api/v1/admin/billing-settings";
    const put = (app: ReturnType<typeof createApp>, key: string, body: unknown) => app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    const initial = { enabled: true, tiers: [tier] };
    const changed = { enabled: true, tiers: [{ ...tier, charge_amount: "1.3" }] };

    // Warm the first instance before the other instance writes the shared file.
    assert.deepEqual((await readJson(await firstApp.request(url))).data, { enabled: false, tiers: [] });
    assert.equal((await put(firstApp, "cross-app-settings-1", initial)).status, 200);

    const replay = await put(secondApp, "cross-app-settings-1", initial);
    assert.equal(replay.status, 200);
    assert.deepEqual((await readJson(replay)).data, initial);
    const conflict = await put(secondApp, "cross-app-settings-1", changed);
    assert.equal(conflict.status, 409);
    assert.equal((await readJson(conflict)).error.code, "IDEMPOTENCY_CONFLICT");

    assert.equal((await put(secondApp, "cross-app-settings-2", changed)).status, 200);
    assert.deepEqual((await readJson(await firstApp.request(url))).data, changed);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed-tier direct generation freezes the exact charge and blocks unmatched settings", async () => {
  const directory = mkdtempSync(join(tmpdir(), "video-fixed-api-"));
  try {
    const store = createInMemoryControlPlaneStore();
    const assets = createInMemoryAssetWorkspaceStore(store);
    const tasks = createInMemoryTaskRunStore(assets);
    const settings = createFixedVideoBillingSettingsStore(join(directory, "settings.json"));
    settings.update({ enabled: true, tiers: [tier] });
    const app = createApp({
      store,
      assetStore: assets,
      taskStore: tasks,
      storage: new InMemoryStoragePort(),
      identity: new StaticIdentityAdapter(adminIdentity),
      videoProviderMode: "sub2api",
      videoBillingMode: "fixed_tiers",
      fixedVideoBillingSettings: settings,
      videoVeyraBridge: accountBridge as never,
    });
    const project = await readJson(await app.request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-project" },
      body: JSON.stringify({ name: "Fixed billing fixture" }),
    }));
    const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${project.data.id}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-shot" },
      body: JSON.stringify({
        position: 0,
        prompt: "A fixed tier fixture shot.",
        generation_settings: { video_settings: { duration_seconds: 5, resolution: "480p", ratio: "16:9" } },
        reference_bindings: [],
      }),
    }));
    const ready = await app.request(`http://localhost/api/v1/shots/${shot.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-ready" },
      body: JSON.stringify({ status: "READY" }),
    });
    assert.equal(ready.status, 200);
    const generated = await app.request(`http://localhost/api/v1/shots/${shot.data.id}/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-generation" },
      body: JSON.stringify({}),
    });
    assert.equal(generated.status, 202);
    const task = await tasks.findTaskRun("ws_veyra_20260916", (await readJson(generated)).data.id);
    assert.equal(task?.inputSnapshot.billing?.billing_rule.chargeAmount, "1.2");
    assert.equal(task?.inputSnapshot.billing?.billing_rule.usagePricing, undefined);

    const unmatchedShot = await readJson(await app.request(`http://localhost/api/v1/projects/${project.data.id}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-shot-unmatched" },
      body: JSON.stringify({
        position: 1,
        prompt: "An unmatched fixed tier fixture shot.",
        generation_settings: { video_settings: { duration_seconds: 6, resolution: "480p", ratio: "16:9" } },
        reference_bindings: [],
      }),
    }));
    const unmatchedReady = await app.request(`http://localhost/api/v1/shots/${unmatchedShot.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-ready-unmatched" },
      body: JSON.stringify({ status: "READY" }),
    });
    assert.equal(unmatchedReady.status, 200);
    const rejected = await app.request(`http://localhost/api/v1/shots/${unmatchedShot.data.id}/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "fixed-generation-unmatched" },
      body: JSON.stringify({}),
    });
    assert.equal(rejected.status, 503);
    assert.equal((await readJson(rejected)).error.code, "CREDIT_UNAVAILABLE");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
