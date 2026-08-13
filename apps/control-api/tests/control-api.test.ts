import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintRequest } from "@alchemy-video/domain";

import { createApp } from "../src/app.js";
import type { IdentityPort } from "../src/identity.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

const createProject = (app: ReturnType<typeof createApp>, name: string, idempotencyKey: string) =>
  app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ name }),
  });

test("DevIdentityAdapter exposes only the fixed local identity and accessible workspace", async () => {
  const app = createApp();

  const [meResponse, workspacesResponse] = await Promise.all([
    app.request("http://localhost/api/v1/me"),
    app.request("http://localhost/api/v1/workspaces"),
  ]);
  const me = await readJson(meResponse);
  const workspaces = await readJson(workspacesResponse);

  assert.equal(meResponse.status, 200);
  assert.equal(me.data.user.id, "usr_dev_owner");
  assert.equal(me.data.workspaces[0].id, "ws_dev_default");
  assert.equal(workspacesResponse.status, 200);
  assert.deepEqual(workspaces.data.map((workspace: { id: string }) => workspace.id), ["ws_dev_default"]);
  assert.match(me.request_id, /^req_[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("project commands are idempotent and project reads stay in the current workspace", async () => {
  const app = createApp();
  const firstResponse = await createProject(app, "Launch film", "project-create-1");
  const first = await readJson(firstResponse);
  const replayResponse = await createProject(app, "Launch film", "project-create-1");
  const replay = await readJson(replayResponse);

  assert.equal(firstResponse.status, 201);
  assert.equal(replayResponse.status, 201);
  assert.equal(first.data.id, replay.data.id);
  assert.match(first.data.id, /^prj_[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(first.data.workspace_id, "ws_dev_default");

  const listResponse = await app.request("http://localhost/api/v1/projects");
  const list = await readJson(listResponse);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(list.data.map((project: { id: string }) => project.id), [first.data.id]);

  const detailResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`);
  const detail = await readJson(detailResponse);
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.project.id, first.data.id);
  assert.deepEqual(detail.data.shots, []);
  assert.deepEqual(detail.data.assets, []);

  const updateResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "project-update-1" },
    body: JSON.stringify({ name: "Launch film revised", status: "ARCHIVED" }),
  });
  const update = await readJson(updateResponse);
  assert.equal(updateResponse.status, 200);
  assert.equal(update.data.name, "Launch film revised");
  assert.equal(update.data.status, "ARCHIVED");

  const updateReplayResponse = await app.request(`http://localhost/api/v1/projects/${first.data.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "project-update-1" },
    body: JSON.stringify({ status: "ARCHIVED", name: "Launch film revised" }),
  });
  const updateReplay = await readJson(updateReplayResponse);
  assert.equal(updateReplayResponse.status, 200);
  assert.deepEqual(updateReplay.data, update.data);
});

test("the API rejects an idempotency key reused with a different command", async () => {
  const app = createApp();
  await createProject(app, "First command", "project-conflict-1");
  const response = await createProject(app, "Different command", "project-conflict-1");
  const body = await readJson(response);

  assert.equal(response.status, 409);
  assert.deepEqual(body.error, {
    code: "IDEMPOTENCY_CONFLICT",
    message: "The idempotency key was already used for a different command.",
    retryable: false,
    details: {},
  });
});

test("a missing project update is a replayable 404 command result", async () => {
  const store = createInMemoryControlPlaneStore();
  const app = createApp({ store });
  const projectId = "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX";
  const command = { name: "Reserved missing project" };
  const request = () =>
    app.request(`http://localhost/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "missing-update-1" },
      body: JSON.stringify(command),
    });

  const first = await request();
  assert.equal(first.status, 404);

  await store.createProject({
    scope: "seed-project",
    idempotencyKey: "seed-1",
    requestHash: fingerprintRequest({ name: "Seeded project" }),
    workspaceId: "ws_dev_default",
    projectId,
    name: "Seeded project",
  });

  const replay = await request();
  assert.equal(replay.status, 404);
  const unchanged = await app.request(`http://localhost/api/v1/projects/${projectId}`);
  assert.equal((await readJson(unchanged)).data.project.name, "Seeded project");

  const conflict = await app.request(`http://localhost/api/v1/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "missing-update-1" },
    body: JSON.stringify({ name: "Different command" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await readJson(conflict)).error.code, "IDEMPOTENCY_CONFLICT");
});

test("workspace authorization and command validation use public error envelopes", async () => {
  const forbiddenIdentity: IdentityPort = {
    async resolve() {
      return { userId: "usr_dev_owner", workspaceId: "ws_not_a_member" };
    },
  };
  const forbiddenApp = createApp({ identity: forbiddenIdentity, store: createInMemoryControlPlaneStore() });
  const forbiddenResponse = await createProject(forbiddenApp, "Blocked project", "project-forbidden-1");
  const forbidden = await readJson(forbiddenResponse);

  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbidden.error.code, "WORKSPACE_FORBIDDEN");
  assert.deepEqual(forbidden.error.details, {});

  const app = createApp();
  const missingKeyResponse = await app.request("http://localhost/api/v1/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Missing key" }),
  });
  const missingKey = await readJson(missingKeyResponse);
  assert.equal(missingKeyResponse.status, 400);
  assert.equal(missingKey.error.code, "VALIDATION_FAILED");

  const futureRoute = await app.request("http://localhost/api/v1/projects/prj_01J4N8QZ8PCW2N2G6D2XJXJXJX/shots", {
    method: "POST",
  });
  assert.equal(futureRoute.status, 404);
});
