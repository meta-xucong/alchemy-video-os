import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { createVeyraCurrentIdentity, type CurrentIdentity, type IdentityPort } from "../src/identity.js";
import { createInMemoryControlPlaneStore } from "../src/repository.js";
import { createInMemoryAssetWorkspaceStore } from "../src/asset-repository.js";
import { createPrefixedId } from "../src/ids.js";

const readJson = async (response: Response) => response.json() as Promise<Record<string, any>>;

class StaticIdentityAdapter implements IdentityPort {
  constructor(private readonly identity: CurrentIdentity) {}

  async resolve(): Promise<CurrentIdentity> {
    return this.identity;
  }
}

const identity = (externalUserId: number, role: string) => createVeyraCurrentIdentity({
  externalUserId,
  intent: "video",
  email: `history-${externalUserId}@example.test`,
  role,
  expiresAt: "2099-01-01T00:00:00.000Z",
});

const seedProject = async (store: ReturnType<typeof createInMemoryControlPlaneStore>, owner: CurrentIdentity, name: string) => {
  if (!owner.bootstrap) throw new Error("fixture identity is missing its bootstrap seed");
  await store.ensureIdentity(owner.bootstrap);
  const projectId = createPrefixedId("prj");
  const result = await store.createProject({
    scope: `fixture:${projectId}`,
    idempotencyKey: `create:${projectId}`,
    requestHash: name,
    workspaceId: owner.workspaceId,
    projectId,
    name,
  });
  if (result.kind === "CONFLICT") throw new Error("fixture project creation conflicted");
  return result.value;
};

const bridgeFor = (externalUserId: number, state: { status: string; role: string }) => ({
  getAccount: async () => ({
    externalUserId,
    email: `history-${externalUserId}@example.test`,
    role: state.role,
    balance: "12.5",
    status: state.status,
    concurrency: 2,
  }),
});

test("history keeps normal users in their workspace even when query parameters ask for all workspaces", async () => {
  const store = createInMemoryControlPlaneStore();
  const own = identity(4101, "user");
  const other = identity(4102, "user");
  const ownProject = await seedProject(store, own, "Own history project");
  await seedProject(store, other, "Other workspace project");
  const app = createApp({ store, identity: new StaticIdentityAdapter(own) });

  const response = await app.request("http://localhost/api/v1/me/history?scope=ALL_WORKSPACES&workspace_id=ws_veyra_4102");
  const body = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(body.data.scope, "WORKSPACE");
  assert.equal(body.data.is_admin, false);
  assert.deepEqual(body.data.projects.map((project: { id: string }) => project.id), [ownProject.id]);
});

test("live active Veyra admin access lists explicit workspace targets and excludes deleted projects", async () => {
  const store = createInMemoryControlPlaneStore();
  const admin = identity(4201, "admin");
  const member = identity(4202, "user");
  const adminProject = await seedProject(store, admin, "Administrator project");
  const memberProject = await seedProject(store, member, "Member project");
  const deletedProject = await seedProject(store, member, "Deleted history project");
  const deleted = await store.deleteProject({
    scope: `fixture:delete:${deletedProject.id}`,
    idempotencyKey: `delete:${deletedProject.id}`,
    requestHash: "delete",
    workspaceId: member.workspaceId,
    projectId: deletedProject.id,
    activeWork: false,
  });
  assert.equal(deleted.kind, "NEW");

  const state = { status: "active", role: "admin" };
  let calls = 0;
  const bridge = {
    getAccount: async (input: { externalUserId: number }) => {
      calls += 1;
      assert.equal(input.externalUserId, admin.externalUserId);
      return bridgeFor(admin.externalUserId!, state).getAccount();
    },
  };
  const app = createApp({
    store,
    identity: new StaticIdentityAdapter(admin),
    videoVeyraBridge: bridge as never,
  });

  const response = await app.request("http://localhost/api/v1/me/history");
  const body = await readJson(response);
  assert.equal(response.status, 200);
  assert.equal(body.data.scope, "ALL_WORKSPACES");
  assert.equal(body.data.is_admin, true);
  assert.deepEqual(body.data.projects.map((project: { id: string }) => project.id).sort(), [adminProject.id, memberProject.id].sort());
  assert.equal(calls, 1);

  state.role = "user";
  const downgraded = await readJson(await app.request("http://localhost/api/v1/me/history"));
  assert.equal(downgraded.data.scope, "WORKSPACE");
  assert.equal(downgraded.data.is_admin, false);
  assert.deepEqual(downgraded.data.projects.map((project: { id: string }) => project.id), [adminProject.id]);

  state.role = "admin";
  state.status = "disabled";
  const inactive = await readJson(await app.request("http://localhost/api/v1/me/history"));
  assert.equal(inactive.data.scope, "WORKSPACE");
  assert.equal(inactive.data.is_admin, false);

  const failingBridgeApp = createApp({
    store,
    identity: new StaticIdentityAdapter(admin),
    videoVeyraBridge: { getAccount: async () => { throw new Error("Veyra unavailable"); } } as never,
  });
  const bridgeFailure = await readJson(await failingBridgeApp.request("http://localhost/api/v1/me/history"));
  assert.equal(bridgeFailure.data.scope, "WORKSPACE");
  assert.equal(bridgeFailure.data.is_admin, false);
});

test("admin detail reads a target workspace but writes remain current-workspace scoped", async () => {
  const store = createInMemoryControlPlaneStore();
  const assets = createInMemoryAssetWorkspaceStore(store);
  const admin = identity(4301, "admin");
  const member = identity(4302, "user");
  const memberProject = await seedProject(store, member, "Cross workspace detail");
  const state = { status: "active", role: "admin" };
  const adminApp = createApp({
    store,
    assetStore: assets,
    identity: new StaticIdentityAdapter(admin),
    videoVeyraBridge: bridgeFor(admin.externalUserId!, state) as never,
  });

  const detail = await adminApp.request(`http://localhost/api/v1/projects/${memberProject.id}`);
  const detailBody = await readJson(detail);
  assert.equal(detail.status, 200);
  assert.equal(detailBody.data.project.workspace_id, member.workspaceId);

  const write = await adminApp.request(`http://localhost/api/v1/projects/${memberProject.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "admin-cross-workspace-write" },
    body: JSON.stringify({ name: "Must not be rewritten" }),
  });
  const writeBody = await readJson(write);
  assert.equal(write.status, 404);
  assert.equal(writeBody.error.code, "NOT_FOUND");

  const ordinaryApp = createApp({
    store,
    assetStore: assets,
    identity: new StaticIdentityAdapter(admin),
    videoVeyraBridge: { getAccount: async () => ({ externalUserId: admin.externalUserId!, email: "history@example.test", role: "user", balance: "1", status: "active", concurrency: 1 }) } as never,
  });
  const ordinaryDetail = await ordinaryApp.request(`http://localhost/api/v1/projects/${memberProject.id}`);
  assert.equal(ordinaryDetail.status, 404);
});
