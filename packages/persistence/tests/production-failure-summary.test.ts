import assert from "node:assert/strict";
import test from "node:test";

import { productionTaskFailureSummary } from "../src/production-failure-summary.js";

test("production failure summaries preserve the concrete provider stage without exposing internals", () => {
  assert.equal(
    productionTaskFailureSummary("PROVIDER_UNAVAILABLE", "DOWNLOAD_FAILED"),
    "视频已经生成，但结果下载或入库未完成；请重新提交本段。",
  );
  assert.equal(
    productionTaskFailureSummary("PROVIDER_REJECTED", "FAILED"),
    "视频服务拒绝了本段请求，请调整描述或参考素材后重新提交。",
  );
  assert.match(productionTaskFailureSummary("PROVIDER_SUBMISSION_UNKNOWN", "FAILED"), /为避免重复扣费/);
  assert.equal(
    productionTaskFailureSummary("STORAGE_UNAVAILABLE", "FAILED"),
    "参考素材暂时无法交付；本段尚未提交视频生成，请检查素材或存储服务后再试。",
  );
  assert.equal(productionTaskFailureSummary("UNKNOWN", "FAILED"), "本段制作未完成，可重新提交本段。");
});
