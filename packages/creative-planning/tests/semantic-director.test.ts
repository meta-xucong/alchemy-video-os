import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  SemanticDecisionVerificationError,
  ProvenanceCheckedSemanticDirector,
  createCanonicalSourceBundle,
  requireExecutableSemanticDecision,
  semanticValueHash,
  verifySemanticDirectorProvenance,
  projectSemanticReferences,
  projectSemanticDialogues,
} from "../src/index.js";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sourceText = "雨夜的旧车站。林岚说：“你终于回来了。”两人隔着站台灯光相望。";
const dialogueText = "你终于回来了。";
const dialogueStart = sourceText.indexOf(dialogueText);
const visualQuote = "两人隔着站台灯光相望。";
const visualStart = sourceText.indexOf(visualQuote);

const bundle = createCanonicalSourceBundle({
  sourceText,
  stylePreferences: "克制、写实",
  targetDurationSeconds: 10,
  documents: [{
    documentId: "doc_brand_001",
    conversionId: "dcv_brand_001",
    content: "# 品牌资料\n品牌名称为星港。",
  }],
  references: [
    { asset_id: "ast_reference_001", asset_sha256: sha("image-1"), mime_type: "image/png", position: 0 },
    { asset_id: "ast_reference_002", asset_sha256: sha("image-2"), mime_type: "image/png", position: 1 },
  ],
  userDecisions: [{ decisionId: "dec_caption_001", field: "caption_policy", value: "OFF" }],
  providerCapability: {
    profile_id: "sub2api-grok-video",
    min_duration_seconds: 1,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER",
  },
});

const sourceEvidence = (id: string, start: number, quote: string) => ({
  evidence_id: id,
  kind: "SOURCE_TEXT" as const,
  source_hash: bundle.source_hash,
  span: { start, end: start + quote.length, quote },
});

const referenceEvidence = (id: string, assetId: string, digest: string) => ({
  evidence_id: id,
  kind: "REFERENCE_ASSET" as const,
  asset_id: assetId,
  asset_sha256: digest,
});

const readyDecision = () => ({
  version: 1 as const,
  source_hash: bundle.source_hash,
  target_duration_seconds: 10,
  execution_status: "READY" as const,
  dialogues: [{
    dialogue_id: "dlg_return_001",
    exact_text: dialogueText,
    evidence: sourceEvidence("evd_dialogue_001", dialogueStart, dialogueText),
  }],
  reference_usages: [{
    asset_id: "ast_reference_001",
    provider_role: "SCENE" as const,
    usage: "保持旧式站台结构。",
    evidence_refs: [referenceEvidence("evd_reference_001", "ast_reference_001", sha("image-1"))],
  }],
  segments: [{
    segment_id: "seg_station_001",
    sequence: 1,
    duration_seconds: 10,
    visual_decision: "两人隔着站台灯光相望。",
    evidence_refs: [sourceEvidence("evd_segment_001", visualStart, visualQuote)],
    dialogue_ids: ["dlg_return_001"],
    reference_asset_ids: ["ast_reference_001"],
  }],
  unresolved_items: [],
});

test("canonical bundle builder hashes source, documents, and user decisions without interpreting them", () => {
  assert.equal(bundle.source_hash, sha(sourceText));
  assert.equal(bundle.documents[0]?.markdown_sha256, sha(bundle.documents[0]!.content));
  assert.equal(bundle.user_decisions[0]?.value_hash, semanticValueHash("OFF"));
  assert.deepEqual(bundle.references.map((item) => item.position), [0, 1]);
});

test("provenance checker accepts a structurally valid evidence-referenced semantic decision", () => {
  const verified = verifySemanticDirectorProvenance(bundle, readyDecision());
  assert.equal(verified.execution_status, "READY");
  assert.equal(verified.dialogues[0]?.exact_text, dialogueText);
});

test("provenance checking does not claim visual entailment or complete source coverage", () => {
  const structurallyValidButUnproven = readyDecision();
  structurallyValidButUnproven.segments[0]!.visual_decision = "A rocket launches above a desert at noon.";
  const checked = verifySemanticDirectorProvenance(bundle, structurallyValidButUnproven);
  assert.equal(checked.segments[0]!.visual_decision, "A rocket launches above a desert at noon.");
  // This boundary is deliberate: semantic correctness belongs to the LLM,
  // source-relative multimodal QC, and human review—not a keyword verifier.
});

test("verifier rejects source, document, reference, and user-decision evidence mismatches", () => {
  const sourceMismatch = readyDecision();
  sourceMismatch.segments[0]!.evidence_refs[0]!.span.start += 1;
  assert.throws(() => verifySemanticDirectorProvenance(bundle, sourceMismatch),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const documentMismatch = readyDecision();
  documentMismatch.segments[0]!.evidence_refs = [{
    evidence_id: "evd_document_001",
    kind: "DOCUMENT",
    document_id: bundle.documents[0]!.document_id,
    conversion_id: bundle.documents[0]!.conversion_id,
    markdown_sha256: bundle.documents[0]!.markdown_sha256,
    locator: "不存在的段落",
    quote: "资料中没有这句话",
  }];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, documentMismatch),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "DOCUMENT_EVIDENCE_INVALID");

  const referenceMismatch = readyDecision();
  referenceMismatch.reference_usages[0]!.evidence_refs[0]!.asset_sha256 = sha("wrong");
  assert.throws(() => verifySemanticDirectorProvenance(bundle, referenceMismatch),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const userMismatch = readyDecision();
  userMismatch.segments[0]!.evidence_refs = [{
    evidence_id: "evd_user_001",
    kind: "USER_DECISION",
    decision_id: "dec_caption_001",
    field: "caption_policy",
    value_hash: sha("wrong"),
  }];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, userMismatch),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "USER_DECISION_EVIDENCE_INVALID");
});

test("verifier preserves canonical reference order and provider duration bounds", () => {
  const reordered = readyDecision();
  reordered.segments[0]!.reference_asset_ids = ["ast_reference_002", "ast_reference_001"];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, reordered),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_ORDER_INVALID");

  const overlong = readyDecision();
  overlong.target_duration_seconds = 20;
  overlong.segments[0]!.duration_seconds = 20;
  const twentySecondBundle = createCanonicalSourceBundle({
    sourceText,
    stylePreferences: "",
    targetDurationSeconds: 20,
    references: bundle.references,
    providerCapability: bundle.provider_capability,
  });
  overlong.source_hash = twentySecondBundle.source_hash;
  overlong.dialogues = [];
  overlong.segments[0]!.dialogue_ids = [];
  overlong.segments[0]!.evidence_refs = [sourceEvidence("evd_segment_002", visualStart, visualQuote)];
  assert.throws(() => verifySemanticDirectorProvenance(twentySecondBundle, overlong),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "PROVIDER_CAPABILITY_INVALID");
});

test("blocked decisions remain inspectable but cannot enter execution", () => {
  const blocked = verifySemanticDirectorProvenance(bundle, {
    version: 1,
    source_hash: bundle.source_hash,
    target_duration_seconds: 10,
    execution_status: "BLOCKED",
    dialogues: [],
    reference_usages: [],
    segments: [],
    unresolved_items: [{ unresolved_id: "unr_reference_001", question: "用途证据不足。", blocking: true, evidence_refs: [] }],
  });
  assert.equal(blocked.execution_status, "BLOCKED");
  assert.throws(() => requireExecutableSemanticDecision(blocked),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SEMANTIC_DECISION_BLOCKED");
});

test("provenance-checked director never falls back when the client fails or returns malformed facts", async () => {
  const unavailable = new ProvenanceCheckedSemanticDirector({
    async decide() { throw new Error("offline"); },
  });
  await assert.rejects(() => unavailable.decide(bundle), /offline/);

  const malformed = new ProvenanceCheckedSemanticDirector({
    async decide() { return { execution_status: "READY" }; },
  });
  await assert.rejects(() => malformed.decide(bundle),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SEMANTIC_DECISION_MALFORMED");
});


test("projects exact dialogue with immutable source span and no prose reparse", () => {
  const verified = verifySemanticDirectorProvenance(bundle, readyDecision());
  const projection = projectSemanticDialogues(verified, "seg_station_001");
  assert.equal(projection.source_hash, bundle.source_hash);
  assert.equal(projection.dialogues[0]?.dialogue_id, "dlg_return_001");
  assert.equal(projection.dialogues[0]?.exact_text, dialogueText);
  assert.equal(sourceText.slice(projection.dialogues[0]!.span.start, projection.dialogues[0]!.span.end), dialogueText);
});

test("projects only the provenance-checked segment reference order and Provider roles", () => {
  const verified = verifySemanticDirectorProvenance(bundle, readyDecision());
  const projection = projectSemanticReferences(verified, "seg_station_001");
  assert.equal(projection.source_hash, bundle.source_hash);
  assert.equal(projection.references[0]?.asset_id, "ast_reference_001");
  assert.equal(projection.references[0]?.provider_role, "SCENE");
  assert.deepEqual(projection.references[0]?.evidence_ids, ["evd_reference_001"]);
});
