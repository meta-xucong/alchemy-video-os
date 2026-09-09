import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createVeyraCurrentIdentity, type CurrentIdentity, type IdentityPort } from "../src/identity.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";
import { InMemoryStoragePort } from "@alchemy-video/storage-client";
import { VideoSessionCodec } from "../src/veyra-session.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const canaryIdentity = createVeyraCurrentIdentity({
  externalUserId: 20260816,
  intent: "video",
  email: "video_canary_20260816@example.test",
  role: "owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
});

class StaticIdentityAdapter implements IdentityPort {
  constructor(private readonly identity: CurrentIdentity) {}

  async resolve(): Promise<CurrentIdentity> {
    return this.identity;
  }
}

test("C13-A Veyra bootstrap creates an isolated local video workspace only when identity carries the mapping", async () => {
  const store = createInMemoryControlPlaneStore();
  const app = createApp({ store, identity: new StaticIdentityAdapter(canaryIdentity) });

  const me = await app.request("http://localhost/api/v1/me");
  const meBody = await readJson(me);

  assert.equal(me.status, 200);
  assert.equal(meBody.data.user.id, "usr_veyra_20260816");
  assert.equal(meBody.data.user.display_name, "video_canary_20260816@example.test");
  assert.deepEqual(meBody.data.workspaces.map((workspace: { id: string }) => workspace.id), ["ws_veyra_20260816"]);

  const project = await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-veyra-project-1" },
    body: JSON.stringify({ name: "C13-A canary project" }),
  });
  const projectBody = await readJson(project);
  assert.equal(project.status, 201);
  assert.equal(projectBody.data.workspace_id, "ws_veyra_20260816");

  const devWorkspaceProjects = await store.listProjects("ws_dev_default");
  assert.deepEqual(devWorkspaceProjects, []);
});

test("C13-A Veyra identity is not silently created without an explicit bootstrap seed", async () => {
  const identityWithoutBootstrap = {
    userId: "usr_veyra_20260816",
    workspaceId: "ws_veyra_20260816",
  };
  const app = createApp({ identity: new StaticIdentityAdapter(identityWithoutBootstrap) });

  const response = await app.request("http://localhost/api/v1/me");
  const body = await readJson(response);

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AUTH_UNAVAILABLE");
});

test("C13-A rejects a tampered bootstrap that does not match the resolved identity", async () => {
  const app = createApp({
    identity: new StaticIdentityAdapter({
      ...canaryIdentity,
      userId: "usr_veyra_99999999",
    }),
  });

  const response = await app.request("http://localhost/api/v1/me");
  const body = await readJson(response);

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "AUTH_UNAVAILABLE");
  assert.equal(JSON.stringify(body).includes("video_canary_20260816"), false);
});

test("C13-A exposes the Sub2API account through a public, provider-neutral credit DTO", async () => {
  const app = createApp({
    identity: new StaticIdentityAdapter(canaryIdentity),
    videoVeyraBridge: {
      getAccount: async () => ({ externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 }),
    } as never,
  });
  const response = await app.request("http://localhost/api/v1/me/credits");
  const body = await readJson(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body.data, { external_user_id: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 });
});

test("C13-A freezes the global Video OS service fee without copying the Sub2API base price", async () => {
  const store = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(store);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({
    store,
    assetStore: assets,
    taskStore: tasks,
    storage: new InMemoryStoragePort(),
    identity: new StaticIdentityAdapter(canaryIdentity),
    videoProviderMode: "mock",
    videoBillingSurchargeMultiplier: "0.20",
    videoBillingFixedFee: "1",
    videoVeyraBridge: {
      getAccount: async () => ({ externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 }),
    } as never,
  });

  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-service-fee-project" },
    body: JSON.stringify({ name: "C13-A service fee project" }),
  }));
  const projectId = project.data.id as string;
  const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${projectId}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-service-fee-shot" },
    body: JSON.stringify({ position: 0, prompt: "A service-fee fixture shot.", reference_bindings: [] }),
  }));
  const shotId = shot.data.id as string;
  const ready = await app.request(`http://localhost/api/v1/shots/${shotId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-service-fee-ready" },
    body: JSON.stringify({ status: "READY" }),
  });
  assert.equal(ready.status, 200);
  const generation = await app.request(`http://localhost/api/v1/shots/${shotId}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-service-fee-generation" },
    body: JSON.stringify({}),
  });
  assert.equal(generation.status, 202);
  const created = await readJson(generation);
  const task = await tasks.findTaskRun("ws_veyra_20260816", created.data.id);
  assert.deepEqual(task?.inputSnapshot.billing?.billing_rule.usagePricing, {
    model: "mock-video-v1",
    multiplier: "0.20",
    fixedFee: "1",
  });
  assert.equal(task?.inputSnapshot.billing?.billing_rule.chargeAmount, undefined);
});

test("usage-based Video OS billing fails closed when the fixed service fee is missing", async () => {
  const store = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(store);
  const tasks = createInMemoryTaskRunStore(assets);
  const app = createApp({
    store,
    assetStore: assets,
    taskStore: tasks,
    storage: new InMemoryStoragePort(),
    identity: new StaticIdentityAdapter(canaryIdentity),
    videoProviderMode: "mock",
    videoBillingSurchargeMultiplier: "0.20",
    videoVeyraBridge: {
      getAccount: async () => ({ externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 }),
    } as never,
  });
  const project = await readJson(await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-missing-fixed-project" },
    body: JSON.stringify({ name: "C13-A missing fixed project" }),
  }));
  const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${project.data.id}/shots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-missing-fixed-shot" },
    body: JSON.stringify({ position: 0, prompt: "A missing fixed-fee fixture shot.", reference_bindings: [] }),
  }));
  const ready = await app.request(`http://localhost/api/v1/shots/${shot.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-missing-fixed-ready" },
    body: JSON.stringify({ status: "READY" }),
  });
  assert.equal(ready.status, 200);
  const generation = await app.request(`http://localhost/api/v1/shots/${shot.data.id}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-missing-fixed-generation" },
    body: JSON.stringify({}),
  });
  const body = await readJson(generation);
  assert.equal(generation.status, 503);
  assert.equal(body.error.code, "CREDIT_UNAVAILABLE");
});

test("identity-only mode ignores billing environment values and does not freeze a debit", async () => {
  const names = [
    "VEYRA_CREDIT_ENABLED",
    "VIDEO_BILLING_CHARGE_AMOUNT",
    "VIDEO_BILLING_SURCHARGE_MULTIPLIER",
    "VIDEO_BILLING_FIXED_FEE",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<string, string | undefined>;
  process.env.VEYRA_CREDIT_ENABLED = "false";
  process.env.VIDEO_BILLING_CHARGE_AMOUNT = "2";
  process.env.VIDEO_BILLING_SURCHARGE_MULTIPLIER = "0.20";
  process.env.VIDEO_BILLING_FIXED_FEE = "1";
  try {
    const store = createInMemoryControlPlaneStore();
    const assets = createInMemoryAssetWorkspaceStore(store);
    const tasks = createInMemoryTaskRunStore(assets);
    const app = createApp({
      store,
      assetStore: assets,
      taskStore: tasks,
      storage: new InMemoryStoragePort(),
      identity: new StaticIdentityAdapter(canaryIdentity),
      videoProviderMode: "mock",
      videoVeyraBridge: {
        getAccount: async () => ({ externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 }),
      } as never,
    });
    const project = await readJson(await app.request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-identity-only-project" },
      body: JSON.stringify({ name: "C13-A identity-only project" }),
    }));
    const shot = await readJson(await app.request(`http://localhost/api/v1/projects/${project.data.id}/shots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-identity-only-shot" },
      body: JSON.stringify({ position: 0, prompt: "An identity-only fixture shot.", reference_bindings: [] }),
    }));
    const ready = await app.request(`http://localhost/api/v1/shots/${shot.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-identity-only-ready" },
      body: JSON.stringify({ status: "READY" }),
    });
    assert.equal(ready.status, 200);
    const generation = await app.request(`http://localhost/api/v1/shots/${shot.data.id}/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "c13a-identity-only-generation" },
      body: JSON.stringify({}),
    });
    assert.equal(generation.status, 202);
    const created = await readJson(generation);
    const task = await tasks.findTaskRun("ws_veyra_20260816", created.data.id);
    assert.equal(task?.inputSnapshot.billing, undefined);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("C13-A callback exchanges a video ticket with POST and establishes an HttpOnly session cookie", async () => {
  const codec = new VideoSessionCodec("01234567890123456789012345678901");
  const app = createApp({
    videoSessionCodec: codec,
    videoVeyraBridge: {
      exchangeVideoTicketAndGetAccount: async ({ ticket }) => ({
        identity: { ...canaryIdentity, externalUserId: 20260816 },
        account: { externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 },
      }),
    } as never,
  });
  const form = new URLSearchParams({ ticket: "a-valid-video-ticket-123456" });
  const response = await app.request("http://localhost/auth/veyra/callback", { method: "POST", body: form });
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie") ?? "", /__Host-video_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.equal((await app.request("http://localhost/auth/veyra/callback?ticket=a-valid-video-ticket-123456")).status, 404);
});

test("C13-A exposes the AISelf Portal Video handoff without putting a ticket in the URL", async () => {
  const app = createApp({
    videoSessionCodec: new VideoSessionCodec("01234567890123456789012345678901"),
    videoVeyraBridge: {
      exchangeVideoTicketAndGetAccount: async () => ({
        identity: canaryIdentity,
        account: { externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "active", concurrency: 2 },
      }),
    } as never,
    videoVeyraPortalBaseUrl: "https://aiself.example",
  });
  for (const path of ["/auth/login", "/auth/veyra/login"]) {
    const response = await app.request(`http://localhost${path}`, { redirect: "manual" } as RequestInit);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://aiself.example/_veyra/return?target=video");
    assert.equal(response.headers.get("location")?.includes("ticket"), false);
  }
});

test("C13-A refuses to issue a session for an inactive shared account", async () => {
  const codec = new VideoSessionCodec("01234567890123456789012345678901");
  const app = createApp({
    videoSessionCodec: codec,
    videoVeyraBridge: {
      exchangeVideoTicketAndGetAccount: async () => ({
        identity: canaryIdentity,
        account: { externalUserId: 20260816, email: "video_canary_20260816@example.test", role: "owner", balance: "12.5", status: "disabled", concurrency: 2 },
      }),
    } as never,
  });
  const response = await app.request("http://localhost/auth/veyra/callback", {
    method: "POST",
    body: new URLSearchParams({ ticket: "a-valid-video-ticket-123456" }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "AUTH_FORBIDDEN");
});
