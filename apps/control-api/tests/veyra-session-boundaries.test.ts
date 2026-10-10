import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { InternalEventEnvelope } from "@alchemy-video/contracts";
import { createApp } from "../src/app.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createInMemoryTaskRunStore } from "../src/task-run-repository.js";
import { VideoSessionCodec, VideoSessionIdentityAdapter } from "../src/veyra-session.js";

const secret = "01234567890123456789012345678901";
const portalOrigin = "https://portal.example";
const videoOrigin = "https://video.example";
const externalIdentity = {
  externalUserId: 42, intent: "video" as const, email: "fixture@example.test",
  role: "user", expiresAt: "2099-01-01T00:00:00.000Z",
};
const account = {
  externalUserId: 42, email: "fixture@example.test", role: "user",
  balance: "10", status: "active", concurrency: 1,
};

test("callback accepts only the configured Portal Origin before consuming a ticket", async () => {
  for (const commercialMode of [false, true]) {
    let exchanges = 0;
    const codec = new VideoSessionCodec(secret);
    const app = createApp({
      commercialMode, corsOrigins: [videoOrigin, "https://cors-only.example"],
      videoVeyraPortalBaseUrl: `${portalOrigin}/`, videoSessionCodec: codec,
      videoVeyraBridge: {
        exchangeVideoTicketAndGetAccount: async () => {
          exchanges += 1;
          return { identity: externalIdentity, account };
        },
      } as never,
    });
    for (const origin of [undefined, "null", "https://attacker.example", videoOrigin,
      "https://cors-only.example", `${portalOrigin}.attacker.example`,
      `${portalOrigin}/`, `${portalOrigin}:8443`, "http://portal.example"]) {
      const response = await app.request(`${videoOrigin}/auth/veyra/callback`, {
        method: "POST", headers: origin === undefined ? {} : { Origin: origin },
        body: new URLSearchParams({ ticket: "a-valid-video-ticket-123456" }),
      });
      assert.equal(response.status, 403, String(origin));
      assert.equal((await response.json()).error.code, "CSRF_ORIGIN_INVALID");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(exchanges, 0);
    }
    const response = await app.request(`${videoOrigin}/auth/veyra/callback`, {
      method: "POST", headers: { Origin: portalOrigin },
      body: new URLSearchParams({ ticket: "a-valid-video-ticket-123456" }),
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/projects");
    assert.equal(exchanges, 1);
    const cookie = response.headers.get("set-cookie") ?? "";
    for (const attribute of [/__Host-video_session=/, /HttpOnly/, /Secure/, /SameSite=Lax/, /Path=\//]) {
      assert.match(cookie, attribute);
    }
    assert.doesNotMatch(cookie, /Domain=/i);
  }
});

test("invalid Portal configuration fails closed for login and callback", async () => {
  for (const baseUrl of ["http://portal.example", "https://user:pass@portal.example",
    "https://portal.example?target=other", "https://portal.example#fragment", "not-a-url"]) {
    let exchanges = 0;
    const app = createApp({
      videoVeyraPortalBaseUrl: baseUrl, videoSessionCodec: new VideoSessionCodec(secret),
      videoVeyraBridge: { exchangeVideoTicketAndGetAccount: async () => { exchanges += 1; } } as never,
    });
    const login = await app.request(`${videoOrigin}/auth/login`);
    assert.equal(login.status, 503);
    const callback = await app.request(`${videoOrigin}/auth/veyra/callback`, {
      method: "POST", headers: { Origin: portalOrigin },
      body: new URLSearchParams({ ticket: "a-valid-video-ticket-123456" }),
    });
    assert.equal(callback.status, 503);
    assert.equal((await callback.json()).error.code, "AUTH_UNAVAILABLE");
    assert.equal(callback.headers.get("set-cookie"), null);
    assert.equal(exchanges, 0);
  }
});

const flush = () => setImmediate();
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
};
const workspaceId = "ws_veyra_42";
const lateEvent: InternalEventEnvelope = {
  contract_version: "1.0", message_id: "msg_session_fixture", event_id: "evt_session_fixture",
  occurred_at: "2026-10-10T00:00:00.000Z", trace_id: "trc_session_fixture",
  correlation_id: "cor_session_fixture", idempotency_key: "session-fixture",
  producer: "test", workspace_id: workspaceId,
  aggregate: { type: "shot", id: "sht_session_fixture" }, version: 1,
  event_type: "shot.updated", data: { shot_id: "sht_session_fixture", status: "READY", revision: 1 },
};

const createStreamFixture = (t: TestContext, maxAgeSeconds = 60) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-10-10T00:00:00.000Z") });
  const codec = new VideoSessionCodec(secret);
  const store = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(store);
  const tasks = createInMemoryTaskRunStore(assets);
  const state = {
    active: true, authFailure: false, accountChecks: 0, eventReads: 0,
    pendingAccount: undefined as Promise<boolean> | undefined,
  };
  const identity = new VideoSessionIdentityAdapter(codec, async () => {
    state.accountChecks += 1;
    if (state.authFailure) throw new Error("private upstream failure");
    if (state.pendingAccount) return state.pendingAccount;
    return state.active;
  });
  tasks.listWorkspaceEvents = async () => { state.eventReads += 1; return []; };
  const app = createApp({ identity, store, assetStore: assets, taskStore: tasks, videoSessionCodec: codec });
  const headers = { cookie: `${codec.cookieName()}=${codec.issue(externalIdentity, maxAgeSeconds)}` };
  const open = async (signal?: AbortSignal) => {
    const response = await app.request(new Request(`${videoOrigin}/api/v1/events?workspace_id=${workspaceId}`, { headers, signal }));
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    t.after(() => reader.cancel());
    await flush();
    return reader;
  };
  return { state, tasks, store, open };
};

test("SSE revalidates at the heartbeat cadence, not on every event poll, and stops on cancel", async (t) => {
  const { state, open } = createStreamFixture(t);
  const reader = await open();
  assert.match(new TextDecoder().decode((await reader.read()).value), /keep-alive/);
  assert.equal(state.accountChecks, 1);
  for (let index = 0; index < 4; index += 1) { t.mock.timers.tick(250); await flush(); }
  assert.equal(state.eventReads, 5);
  assert.equal(state.accountChecks, 1);
  t.mock.timers.tick(14_000);
  await flush();
  assert.equal(state.accountChecks, 2);
  assert.match(new TextDecoder().decode((await reader.read()).value), /keep-alive/);
  await reader.cancel();
  const reads = state.eventReads;
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(state.accountChecks, 2);
  assert.equal(state.eventReads, reads);
});

test("SSE closes at the signed session deadline before the next auth refresh", async (t) => {
  const { state, open } = createStreamFixture(t, 1);
  const reader = await open();
  await reader.read();
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal((await reader.read()).done, true);
  assert.equal(state.accountChecks, 1);
  assert.equal(state.eventReads, 1);
});

for (const failure of ["revoked", "unavailable"] as const) {
  test(`SSE closes when account authorization is ${failure}`, async (t) => {
    const { state, open } = createStreamFixture(t);
    const reader = await open();
    await reader.read();
    if (failure === "revoked") state.active = false;
    else state.authFailure = true;
    t.mock.timers.tick(15_000);
    await flush();
    assert.equal((await reader.read()).done, true);
    assert.equal(state.accountChecks, 2);
    assert.equal(state.eventReads, 1);
  });
}

test("SSE revalidates local workspace membership as well as the shared account", async (t) => {
  const { state, store, open } = createStreamFixture(t);
  const reader = await open();
  await reader.read();
  const bootstrap = t.mock.method(store, "ensureIdentity");
  store.hasWorkspaceMembership = async () => false;
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal((await reader.read()).done, true);
  assert.equal(state.accountChecks, 2);
  assert.equal(state.eventReads, 1);
  assert.equal(bootstrap.mock.callCount(), 0, "stream refresh must not recreate owner membership");
});

test("a slow SSE event read is reauthorized before any returned event is emitted", async (t) => {
  const { state, tasks, open } = createStreamFixture(t);
  const pending = deferred<InternalEventEnvelope[]>();
  tasks.listWorkspaceEvents = async () => { state.eventReads += 1; return pending.promise; };
  const reader = await open();
  state.active = false;
  t.mock.timers.tick(15_000);
  pending.resolve([lateEvent]);
  await flush();
  assert.equal((await reader.read()).done, true);
  assert.equal(state.accountChecks, 2);
  assert.equal(state.eventReads, 1);
});

test("a still-authorized slow SSE read emits its public event after revalidation", async (t) => {
  const { state, tasks, open } = createStreamFixture(t);
  const pending = deferred<InternalEventEnvelope[]>();
  tasks.listWorkspaceEvents = async () => { state.eventReads += 1; return pending.promise; };
  const reader = await open();
  t.mock.timers.tick(15_000);
  pending.resolve([lateEvent]);
  await flush();
  const result = await reader.read();
  assert.equal(result.done, false);
  const publicEvent = new TextDecoder().decode(result.value);
  assert.match(publicEvent, /event: shot.updated/);
  assert.match(publicEvent, /id: evt_session_fixture/);
  assert.doesNotMatch(publicEvent, /trace_id|correlation_id|idempotency_key|sessionExpiresAt/);
  assert.equal(state.accountChecks, 2);
});

test("an already-aborted SSE request never starts an event query", async (t) => {
  const { state, open } = createStreamFixture(t);
  const abort = new AbortController();
  abort.abort();
  const reader = await open(abort.signal);
  assert.equal((await reader.read()).done, true);
  assert.equal(state.eventReads, 0);
});

for (const ending of ["cancel", "abort", "expiry"] as const) {
  test(`SSE ignores a pending event query that finishes after ${ending}`, async (t) => {
    const { state, tasks, open } = createStreamFixture(t, 1);
    const pending = deferred<InternalEventEnvelope[]>();
    tasks.listWorkspaceEvents = async () => { state.eventReads += 1; return pending.promise; };
    const abort = new AbortController();
    const reader = await open(abort.signal);
    if (ending === "cancel") await reader.cancel();
    else if (ending === "abort") abort.abort();
    else t.mock.timers.tick(1_000);
    assert.equal((await reader.read()).done, true);
    pending.resolve([lateEvent]);
    await flush();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal((await reader.read()).done, true);
    assert.equal(state.accountChecks, 1);
    assert.equal(state.eventReads, 1);
  });

  test(`SSE ignores account revalidation that finishes after ${ending}`, async (t) => {
    const { state, open } = createStreamFixture(t, 16);
    const abort = new AbortController();
    const reader = await open(abort.signal);
    await reader.read();
    const pending = deferred<boolean>();
    state.pendingAccount = pending.promise;
    t.mock.timers.tick(15_000);
    await flush();
    assert.equal(state.accountChecks, 2);
    if (ending === "cancel") await reader.cancel();
    else if (ending === "abort") abort.abort();
    else t.mock.timers.tick(1_000);
    assert.equal((await reader.read()).done, true);
    pending.resolve(true);
    await flush();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal((await reader.read()).done, true);
    assert.equal(state.accountChecks, 2);
    assert.equal(state.eventReads, 1);
  });
}
