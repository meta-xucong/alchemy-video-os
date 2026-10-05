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
import { parseG02ApprovedBeatMarkers } from "@alchemy-video/contracts";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sourceText = "雨夜的旧车站。林岚说：“你终于回来了。”两人隔着站台灯光相望。";
const dialogueText = "你终于回来了。";
const dialogueStart = sourceText.indexOf(dialogueText);
const visualQuote = "两人隔着站台灯光相望。";
const visualStart = sourceText.indexOf(visualQuote);

test("G02 Brief source marker authority is one strict shared parser", () => {
  const source = [
    "先有😀正文。",
    "G02_APPROVED_BEAT_1:第一节拍。",
    "G02_APPROVED_BEAT_2:第二节拍。",
    "G02_APPROVED_BEAT_3:第三节拍。",
  ].join("\r\n");
  const markers = parseG02ApprovedBeatMarkers(source);
  assert.deepEqual(markers?.map((marker) => marker.sequence), [1, 2, 3]);
  assert.equal(source.slice(markers![0]!.span.start, markers![0]!.span.end), markers![0]!.span.quote);
  assert.equal(markers![0]!.span.start, source.indexOf("G02_APPROVED_BEAT_1:"));
  assert.equal(parseG02ApprovedBeatMarkers("Ordinary source without G02 authority."), undefined);

  const invalid = [
    "prefix G02_APPROVED_BEAT_1:伪marker。",
    "G02_APPROVED_BEAT_1:第一节拍。\nG02_APPROVED_BEAT_2:第二节拍。",
    "G02_APPROVED_BEAT_1:第一节拍。\nG02_APPROVED_BEAT_1:重复。\nG02_APPROVED_BEAT_3:第三节拍。",
    "G02_APPROVED_BEAT_2:第二节拍。\nG02_APPROVED_BEAT_1:第一节拍。\nG02_APPROVED_BEAT_3:第三节拍。",
    "G02_APPROVED_BEAT_1:第一节拍。\nG02_APPROVED_BEAT_2:第二节拍。\nG02_APPROVED_BEAT_3:第三节拍。\nG02_APPROVED_BEAT_4:越界。",
    "G02_APPROVED_BEAT_1:第一节拍。\nG02_APPROVED_BEAT_2:   \nG02_APPROVED_BEAT_3:第三节拍。",
  ];
  for (const value of invalid) assert.throws(() => parseG02ApprovedBeatMarkers(value), value);
});

const bundle = createCanonicalSourceBundle({
  sourceText,
  stylePreferences: "克制、写实",
  targetDurationSeconds: 10,
  documents: [{
    documentId: "doc_brand_001",
    conversionId: "dcv_brand_001",
    markdownSha256: sha("# 品牌资料\n品牌名称为星港。\n完整资产后续内容。"),
    content: "# 品牌资料\n品牌名称为星港。",
  }],
  references: [
    { asset_id: "ast_reference_001", asset_sha256: sha("image-1"), mime_type: "image/png", position: 0, objective_description: "旧式站台结构与冷色顶灯。" },
    { asset_id: "ast_reference_002", asset_sha256: sha("image-2"), mime_type: "image/png", position: 1 },
  ],
  userDecisions: [
    { decisionId: "dec_caption_001", field: "caption_policy", value: "OFF" },
    { decisionId: "dec_style_preferences_001", field: "style_preferences", value: "克制、写实" },
  ],
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

const referenceEvidence = (id: string, assetId: string, digest: string, observation?: string) => ({
  evidence_id: id,
  kind: "REFERENCE_ASSET" as const,
  asset_id: assetId,
  asset_sha256: digest,
  ...(observation ? { observation } : {}),
});

const userDecisionEvidence = () => ({
  evidence_id: "evd_caption_policy_001",
  kind: "USER_DECISION" as const,
  decision_id: "dec_caption_001",
  field: "caption_policy",
  value_hash: semanticValueHash("OFF"),
});

const styleDecisionEvidence = () => ({
  evidence_id: "evd_style_preferences_001",
  kind: "USER_DECISION" as const,
  decision_id: "dec_style_preferences_001",
  field: "style_preferences",
  value_hash: semanticValueHash("克制、写实"),
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
  reference_usages: [
    {
      asset_id: "ast_reference_001",
      provider_role: "SCENE" as const,
      usage: "保持旧式站台结构。",
      evidence_refs: [referenceEvidence("evd_reference_001", "ast_reference_001", sha("image-1"))],
    },
    {
      asset_id: "ast_reference_002",
      provider_role: "STYLE" as const,
      usage: "保持第二张参考图的照明风格。",
      evidence_refs: [referenceEvidence("evd_reference_002", "ast_reference_002", sha("image-2"))],
    },
  ],
  segments: [{
    segment_id: "seg_station_001",
    sequence: 1,
    duration_seconds: 10,
    visual_decision: "两人隔着站台灯光相望。",
    evidence_refs: [
      sourceEvidence("evd_segment_001", visualStart, visualQuote),
      userDecisionEvidence(),
      styleDecisionEvidence(),
    ],
    dialogue_ids: ["dlg_return_001"],
    reference_asset_ids: ["ast_reference_001", "ast_reference_002"],
  }],
  unresolved_items: [],
});

const g02SourceText = [
  "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
  "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。",
  "G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。",
].join("\n");
const g02JarUsage = "面霜罐主体产品图，用于乳霜质地的产品特写。";
const g02BoxUsage = "外包装盒产品图，用于片尾包装特写。";
const g02DecisionValue = "面霜罐采用克制产品画面。";
const g02Bundle = createCanonicalSourceBundle({
  briefRevisionId: "brief_g02_entity_evidence_001",
  sourceText: g02SourceText,
  stylePreferences: "",
  targetDurationSeconds: 24,
  references: [
    {
      asset_id: "ast_g02_jar",
      asset_sha256: sha("g02-jar"),
      mime_type: "image/png",
      position: 0,
      provider_role: "SUBJECT",
      user_declared_usage: g02JarUsage,
      objective_description: "面霜罐产品图。",
    },
    {
      asset_id: "ast_g02_box",
      asset_sha256: sha("g02-box"),
      mime_type: "image/png",
      position: 1,
      provider_role: "SUBJECT",
      user_declared_usage: g02BoxUsage,
      objective_description: "外包装盒产品图。",
    },
  ],
  userDecisions: [{
    decisionId: "dec_g02_product_presentation",
    field: "product_presentation",
    value: g02DecisionValue,
  }],
  providerCapability: {
    profile_id: "test-g02-video",
    min_duration_seconds: 8,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4_096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER",
  },
});

const g02ReadyDecision = (sourceBundle = g02Bundle) => ({
  version: 1 as const,
  source_hash: sourceBundle.source_hash,
  semantic_narrative_beat_lineage: sourceBundle.semantic_narrative_beat_lineage,
  target_duration_seconds: 24,
  execution_status: "READY" as const,
  dialogues: [],
  reference_usages: sourceBundle.references.map((reference, index) => ({
    asset_id: reference.asset_id,
    provider_role: reference.provider_role!,
    usage: reference.user_declared_usage!,
    evidence_refs: [{
      evidence_id: `evd_g02_reference_${index + 1}`,
      kind: "REFERENCE_ASSET" as const,
      asset_id: reference.asset_id,
      asset_sha256: reference.asset_sha256,
      user_declared_usage: reference.user_declared_usage,
    }],
  })),
  segments: sourceBundle.semantic_narrative_beat_lineage!.beats.map((beat, index) => ({
    segment_id: `seg_g02_entity_${index + 1}`,
    sequence: index + 1,
    duration_seconds: 8,
    visual_decision: beat.span.quote,
    evidence_refs: [
      {
        evidence_id: `evd_g02_source_${index + 1}`,
        kind: "SOURCE_TEXT" as const,
        source_hash: sourceBundle.source_hash,
        span: beat.span,
      },
      ...(index === 0 ? [{
        evidence_id: "evd_g02_product_presentation",
        kind: "USER_DECISION" as const,
        decision_id: "dec_g02_product_presentation",
        field: "product_presentation",
        value_hash: semanticValueHash(g02DecisionValue),
      }] : []),
    ],
    dialogue_ids: [],
    reference_asset_ids: sourceBundle.references.map((reference) => reference.asset_id),
    source_narrative_beat_sequences: [index + 1],
  })),
  entity_candidates: [{
    candidate_key: "entity-g02-jar",
    kind: "PROP" as const,
    exact_name: "面霜罐",
    source_evidence_refs: [g02Bundle.semantic_narrative_beat_lineage!.beats[0]!.span.quote, g02DecisionValue, g02JarUsage],
    reference_asset_ids: ["ast_g02_jar"],
    type: "护肤品容器",
    description: "面霜罐",
  }],
  unresolved_items: [],
});

test("G02 entity candidate provenance uses exact frozen evidence and each referenced asset's exact usage", () => {
  const valid = verifySemanticDirectorProvenance(g02Bundle, g02ReadyDecision());
  assert.equal(valid.execution_status, "READY");

  const missingCandidateUsage = g02ReadyDecision();
  missingCandidateUsage.entity_candidates[0]!.source_evidence_refs = [
    g02Bundle.semantic_narrative_beat_lineage!.beats[0]!.span.quote,
    g02DecisionValue,
  ];
  assert.equal(missingCandidateUsage.reference_usages[0]?.usage, g02JarUsage);
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, missingCandidateUsage),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const tamperedUsage = g02ReadyDecision();
  tamperedUsage.entity_candidates[0]!.source_evidence_refs[2] = `${g02JarUsage}（已篡改）`;
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, tamperedUsage),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const partialSourceQuote = g02ReadyDecision();
  partialSourceQuote.entity_candidates[0]!.source_evidence_refs[0] = "面霜罐";
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, partialSourceQuote),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const partialUsage = g02ReadyDecision();
  partialUsage.entity_candidates[0]!.source_evidence_refs[2] = "面霜罐主体产品图";
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, partialUsage),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const usageFromUnreferencedAsset = g02ReadyDecision();
  usageFromUnreferencedAsset.entity_candidates[0]!.source_evidence_refs[2] = g02BoxUsage;
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, usageFromUnreferencedAsset),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const duplicateUsageBundle = {
    ...g02Bundle,
    references: g02Bundle.references.map((reference) => reference.asset_id === "ast_g02_box"
      ? { ...reference, user_declared_usage: g02JarUsage }
      : reference),
  };
  assert.throws(() => verifySemanticDirectorProvenance(duplicateUsageBundle, g02ReadyDecision(duplicateUsageBundle)),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const emptyEntityCandidates = g02ReadyDecision();
  emptyEntityCandidates.entity_candidates = [];
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, emptyEntityCandidates),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const emptyCandidateAssets = g02ReadyDecision();
  emptyCandidateAssets.entity_candidates[0]!.reference_asset_ids = [];
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, emptyCandidateAssets),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const duplicateCandidateAssets = g02ReadyDecision();
  duplicateCandidateAssets.entity_candidates[0]!.reference_asset_ids = ["ast_g02_jar", "ast_g02_jar"];
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, duplicateCandidateAssets),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const duplicateCandidateEvidence = g02ReadyDecision();
  duplicateCandidateEvidence.entity_candidates[0]!.source_evidence_refs.push(
    duplicateCandidateEvidence.entity_candidates[0]!.source_evidence_refs[0]!,
  );
  assert.throws(() => verifySemanticDirectorProvenance(g02Bundle, duplicateCandidateEvidence),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "SOURCE_EVIDENCE_INVALID");

  const substringUsage = "Carefully photographed moisturizer reference.";
  const substringBundle = {
    ...g02Bundle,
    references: g02Bundle.references.map((reference) => reference.asset_id === "ast_g02_jar"
      ? { ...reference, user_declared_usage: substringUsage }
      : reference),
  };
  const substringDecision = g02ReadyDecision(substringBundle);
  substringDecision.entity_candidates[0]!.exact_name = "Care";
  substringDecision.entity_candidates[0]!.source_evidence_refs = [
    g02Bundle.semantic_narrative_beat_lineage!.beats[0]!.span.quote,
    substringUsage,
  ];
  assert.throws(() => verifySemanticDirectorProvenance(substringBundle, substringDecision),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");
});

test("canonical bundle builder hashes source, documents, and user decisions without interpreting them", () => {
  assert.equal(bundle.source_hash, sha(sourceText));
  assert.equal(bundle.documents[0]?.markdown_sha256, sha("# 品牌资料\n品牌名称为星港。\n完整资产后续内容。"));
  assert.equal(bundle.documents[0]?.content_sha256, sha(bundle.documents[0]!.content));
  assert.notEqual(bundle.documents[0]?.markdown_sha256, bundle.documents[0]?.content_sha256);
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
    content_sha256: bundle.documents[0]!.content_sha256,
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

test("executable decisions cannot omit or orphan canonical references", () => {
  const missingUsage = readyDecision();
  missingUsage.reference_usages.pop();
  assert.throws(() => verifySemanticDirectorProvenance(bundle, missingUsage),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_COVERAGE_INVALID");

  const orphanedUsage = readyDecision();
  orphanedUsage.segments[0]!.reference_asset_ids = ["ast_reference_001"];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, orphanedUsage),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_COVERAGE_INVALID");

  const usageWithoutOwnAssetEvidence = readyDecision();
  usageWithoutOwnAssetEvidence.reference_usages[0]!.evidence_refs = [
    sourceEvidence("evd_reference_prose_only_001", visualStart, visualQuote),
  ];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, usageWithoutOwnAssetEvidence),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");
});

test("an executable decision must cite every frozen user decision", () => {
  const uncitedDecision = readyDecision();
  uncitedDecision.segments[0]!.evidence_refs = [
    sourceEvidence("evd_segment_001", visualStart, visualQuote),
  ];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, uncitedDecision),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "USER_DECISION_COVERAGE_INVALID");
});

test("reference observations must equal the frozen objective description", () => {
  const fabricatedObservation = readyDecision();
  fabricatedObservation.reference_usages[0]!.evidence_refs = [
    referenceEvidence("evd_reference_001", "ast_reference_001", sha("image-1"), "凭空添加的人脸与功效说明。"),
  ];
  assert.throws(() => verifySemanticDirectorProvenance(bundle, fabricatedObservation),
    (error) => error instanceof SemanticDecisionVerificationError && error.code === "REFERENCE_EVIDENCE_INVALID");

  const exactObservation = readyDecision();
  exactObservation.reference_usages[0]!.evidence_refs = [
    referenceEvidence("evd_reference_001", "ast_reference_001", sha("image-1"), "旧式站台结构与冷色顶灯。"),
  ];
  assert.equal(verifySemanticDirectorProvenance(bundle, exactObservation).execution_status, "READY");
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
  assert.equal(projection.segment_id, "seg_station_001");
  assert.deepEqual(projection.references, [
    {
      asset_id: "ast_reference_001",
      provider_role: "SCENE",
      usage: "保持旧式站台结构。",
      evidence_ids: ["evd_reference_001"],
    },
    {
      asset_id: "ast_reference_002",
      provider_role: "STYLE",
      usage: "保持第二张参考图的照明风格。",
      evidence_ids: ["evd_reference_002"],
    },
  ]);
});
