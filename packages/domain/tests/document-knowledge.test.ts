import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDocumentKnowledgeTransition,
  isActiveDocumentKnowledgeStatus,
  transitionDocumentKnowledge,
  type DocumentKnowledgeState,
} from "../src/index.js";

const created: DocumentKnowledgeState = {
  id: "dkr_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  documentId: "doc_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  conversionId: "dcv_01J4N8QZ8PCW2N2G6D2XJXJXJX",
  status: "CREATED",
  analysisQuality: null,
  sectionCount: 0,
  factCount: 0,
};

test("document knowledge state machine only publishes immutable results after analysis", () => {
  const queued = transitionDocumentKnowledge(created, {
    status: "QUEUED",
    analysisQuality: null,
    sectionCount: 0,
    factCount: 0,
  });
  const running = transitionDocumentKnowledge(queued, {
    status: "RUNNING",
    analysisQuality: null,
    sectionCount: 0,
    factCount: 0,
  });
  const ready = transitionDocumentKnowledge(running, {
    status: "READY",
    analysisQuality: "PARTIAL",
    sectionCount: 4,
    factCount: 7,
  });

  assert.equal(ready.documentId, created.documentId);
  assert.equal(ready.conversionId, created.conversionId);
  assert.equal(isActiveDocumentKnowledgeStatus("RUNNING"), true);
  assert.equal(isActiveDocumentKnowledgeStatus("READY"), false);
  assert.throws(() => transitionDocumentKnowledge(ready, {
    status: "READY",
    analysisQuality: "COMPLETE",
    sectionCount: 5,
    factCount: 8,
  }), /Cannot transition/);
});

test("document knowledge rejects incomplete result publication and illegal retries", () => {
  assert.throws(() => transitionDocumentKnowledge(created, {
    status: "QUEUED",
    analysisQuality: "COMPLETE",
    sectionCount: 1,
    factCount: 1,
  }), /may only be published/);
  assert.throws(() => transitionDocumentKnowledge({ ...created, status: "RUNNING" }, {
    status: "READY",
    analysisQuality: null,
    sectionCount: 1,
    factCount: 1,
  }), /requires an analysis quality/);
  assert.throws(() => assertDocumentKnowledgeTransition("FAILED", "READY"), /Cannot transition/);
});
