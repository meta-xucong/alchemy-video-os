import assert from "node:assert/strict";
import test from "node:test";

import { parseSub2ApiVideoUsageUserId } from "../src/video-usage-config.js";

test("shared Sub2API usage owner is optional and parses a positive safe integer", () => {
  assert.equal(parseSub2ApiVideoUsageUserId(undefined), undefined);
  assert.equal(parseSub2ApiVideoUsageUserId(""), undefined);
  assert.equal(parseSub2ApiVideoUsageUserId(" 7 "), 7);
});

test("shared Sub2API usage owner rejects invalid deployment values", () => {
  for (const value of ["0", "-1", "1.5", "not-a-user"]) {
    assert.throws(() => parseSub2ApiVideoUsageUserId(value), /SUB2API_VIDEO_USAGE_USER_ID/);
  }
});
