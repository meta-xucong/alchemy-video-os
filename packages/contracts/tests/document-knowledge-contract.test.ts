import assert from "node:assert/strict";
import test from "node:test";

import {
  CreativeBriefFactContextSchema,
  DocumentKnowledgeRevisionSchema,
  DocumentKnowledgeSucceededEventSchema,
  FrozenDocumentFactSchema,
  PublicDocumentKnowledgeEventSchema,
  SegmentFactPackSchema,
} from "../src/index.js";

const source = { document_id: "doc_source", conversion_id: "dcv_source", section_sequence: 9, locator: "第 9 节：后半段卖点" };
const fact = { fact_id: "dft_tail", category: "SELLING_POINT", statement: "距高铁站 18 公里。", confidence: "EXPLICIT", source } as const;

test("C11.2 contracts keep facts traceable while public revision/event projections stay bounded", () => {
  assert.doesNotThrow(() => FrozenDocumentFactSchema.parse(fact));
  assert.doesNotThrow(() => CreativeBriefFactContextSchema.parse({ creative_brief_revision_id: "cbr_abc", fact_id: fact.fact_id, sequence: 1, fact, selection_reason: "确定性选择", snapshot_hash: "a".repeat(64) }));
  assert.doesNotThrow(() => SegmentFactPackSchema.parse({ segment_sequence: 2, global_brand_locks: [], segment_facts: [fact], fact_refs: [fact.fact_id], selection_reason: "按段选择" }));
  const revision = DocumentKnowledgeRevisionSchema.parse({ id: "dkr_abc", workspace_id: "ws_abc", project_id: "prj_abc", document_id: source.document_id, conversion_id: source.conversion_id, status: "READY", retryable: false, analysis_quality: "COMPLETE", section_count: 1, fact_count: 1, created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z" });
  assert.equal("markdown_sha256" in revision, false);
  assert.equal("analyzer_version" in revision, false);
  assert.doesNotThrow(() => DocumentKnowledgeSucceededEventSchema.parse({ contract_version: "1.0", message_id: "msg_abc", event_id: "evt_abc", event_type: "document_knowledge.succeeded", occurred_at: "2026-08-30T00:00:00.000Z", trace_id: "trc_abc", correlation_id: "cor_abc", idempotency_key: "idem_abc", producer: "test", workspace_id: "ws_abc", project_id: "prj_abc", aggregate: { type: "document_knowledge_revision", id: "dkr_abc" }, data: { knowledge_revision_id: "dkr_abc", conversion_id: "dcv_abc", analysis_quality: "COMPLETE" }, version: 1 }));
  assert.equal(PublicDocumentKnowledgeEventSchema.parse({ event_id: "evt_abc", event_type: "document_knowledge.succeeded", occurred_at: "2026-08-30T00:00:00.000Z", workspace_id: "ws_abc", project_id: "prj_abc", aggregate: { type: "document_knowledge_revision", id: "dkr_abc" }, data: { knowledge_revision_id: "dkr_abc", conversion_id: "dcv_abc", status: "READY", retryable: false, analysis_quality: "COMPLETE" }, version: 1 }).data.analysis_quality, "COMPLETE");
});
