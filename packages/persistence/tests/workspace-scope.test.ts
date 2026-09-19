import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core/dialect";

import {
  assetScope,
  outboxEventScope,
  projectScope,
  providerAttemptScope,
  referenceBindingScope,
  shotScope,
  taskRunScope,
  usageRecordScope,
  usageReceiptScope,
  workspaceMemberScope,
} from "../src/workspace-repositories.js";

const dialect = new PgDialect();
const workspaceId = "ws_01J4N8QZ8PCW2N2G6D2XJXJXJX";

test("every workspace resource scope compiles workspace_id into SQL", () => {
  const scopes = [
    workspaceMemberScope(workspaceId, "usr_dev_owner"),
    projectScope(workspaceId, "prj_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    assetScope(workspaceId, "ast_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    shotScope(workspaceId, "sht_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    referenceBindingScope(workspaceId, "sht_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    taskRunScope(workspaceId, "tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    providerAttemptScope(workspaceId, "att_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    usageRecordScope(workspaceId, "use_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    usageReceiptScope(workspaceId, "veyra_sub2api", "video:mock:tsk_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
    outboxEventScope(workspaceId, "evt_01J4N8QZ8PCW2N2G6D2XJXJXJX"),
  ];

  for (const scope of scopes) {
    const compiled = dialect.sqlToQuery(scope!);
    assert.match(compiled.sql, /workspace_id/);
    assert.ok(compiled.params.includes(workspaceId));
  }
});
