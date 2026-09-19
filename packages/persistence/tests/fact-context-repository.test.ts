import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCreativeBriefFactContextStore } from "../src/fact-context-repository.js";

const source = { document_id: "doc_source", conversion_id: "dcv_source", section_sequence: 8, locator: "第 8 节：卖点" };
const facts = [
  { fact_id: "dft_brand", category: "BRAND", statement: "云栖度假是项目品牌。", confidence: "EXPLICIT", source },
  { fact_id: "dft_tail", category: "SELLING_POINT", statement: "距高铁站 18 公里，提供全天候温泉服务。", confidence: "EXPLICIT", source },
] as const;

test("brief fact snapshots are immutable and workspace scoped", () => {
  const store = new InMemoryCreativeBriefFactContextStore();
  const first = store.freeze({ workspaceId: "ws_a", projectId: "prj_a", creativeBriefRevisionId: "cbr_abc", knowledgeRevisionId: "dkr_abc", facts });
  assert.equal(first.length, 2);
  const changed = { ...first[0]!, fact: { ...first[0]!.fact, statement: "被调用方篡改" } };
  (first as CreativeBriefFactContext[])[0] = changed;
  assert.equal(store.list("ws_a", "prj_a", "cbr_abc")[0]!.fact.statement, "云栖度假是项目品牌。");
  assert.equal(store.list("ws_b", "prj_a", "cbr_abc").length, 0);
  assert.equal(store.selectForSegment({ workspaceId: "ws_a", projectId: "prj_a", creativeBriefRevisionId: "cbr_abc", segmentSequence: 1, narrativeText: "展示温泉交通" })?.fact_refs.includes("dft_tail"), true);
});
