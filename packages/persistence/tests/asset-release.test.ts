import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core/dialect";

import { isAssetReleased, releasedAssetScope } from "../src/asset-release.js";
import type { ControlAsset } from "../src/asset-workspace-repository.js";
import type { ControlTaskRun } from "../src/task-run-repository.js";

const asset: ControlAsset = {
  id: "ast_release", workspaceId: "ws_release", projectId: "prj_release",
  kind: "VIDEO", origin: "GENERATED", status: "READY", objectKey: "private/generated.mp4",
  sha256: "a".repeat(64), mimeType: "video/mp4", byteSize: 10, width: 16, height: 9,
  durationMs: 1000, metadata: { task_run_id: "tsk_release" }, createdAt: "", updatedAt: "",
};
const task: ControlTaskRun = {
  id: "tsk_release", workspaceId: asset.workspaceId, projectId: asset.projectId, shotId: "sht_release",
  kind: "VIDEO_GENERATION", status: "SUCCEEDED", resultAssetId: asset.id,
  inputSnapshot: {}, error: null, retryAt: null, createdAt: "", updatedAt: "",
};

test("generated video release requires its exact successful owner, including legacy READY assets", () => {
  assert.equal(isAssetReleased(asset, task), true);
  for (const status of ["CREATED", "QUEUED", "RUNNING", "PROVIDER_PROCESSING", "DOWNLOADING", "BILLING_PENDING", "BILLING_FAILED", "RETRY_SCHEDULED", "FAILED", "ABANDONED"] as const) {
    assert.equal(isAssetReleased(asset, { ...task, status }), false, status);
  }
  assert.equal(isAssetReleased(asset), false);
  for (const patch of [
    { id: "tsk_other" }, { workspaceId: "ws_other" }, { projectId: "prj_other" },
    { resultAssetId: null }, { resultAssetId: "ast_other" }, { kind: "RENDER" as const },
  ]) assert.equal(isAssetReleased(asset, { ...task, ...patch }), false);
  assert.equal(isAssetReleased({ ...asset, metadata: {} }, task), false);
  for (const status of ["PENDING_UPLOAD", "FAILED", "DELETED"] as const) {
    assert.equal(isAssetReleased({ ...asset, status }, task), false);
  }
});

test("release policy preserves user uploads, generated audio and derived composition assets", () => {
  assert.equal(isAssetReleased({ ...asset, origin: "USER_UPLOAD" }), true);
  assert.equal(isAssetReleased({ ...asset, origin: "DERIVED", metadata: {} }), true);
  assert.equal(isAssetReleased({ ...asset, kind: "AUDIO", metadata: {} }), true);
});

test("SQL release predicate scopes the task owner, success and exact result asset", () => {
  const query = new PgDialect().sqlToQuery(releasedAssetScope());
  assert.match(query.sql, /"task_runs"\."workspace_id" = "assets"\."workspace_id"/u);
  assert.match(query.sql, /"task_runs"\."project_id" = "assets"\."project_id"/u);
  assert.match(query.sql, /"task_runs"\."status" = 'SUCCEEDED'/u);
  assert.match(query.sql, /"task_runs"\."result_asset_id" = "assets"\."id"/u);
  assert.match(query.sql, /"task_runs"\."id" = "assets"\."metadata"->>'task_run_id'/u);
});
