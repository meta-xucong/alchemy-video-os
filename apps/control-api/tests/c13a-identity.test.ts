import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createVeyraCurrentIdentity, type CurrentIdentity, type IdentityPort } from "../src/identity.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";

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
