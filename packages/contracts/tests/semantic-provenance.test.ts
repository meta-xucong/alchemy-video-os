import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CanonicalSourceBundleSchema,
  SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION,
  SemanticDirectorDecisionJsonSchema,
  SemanticDirectorDecisionSchema,
  SourceTextSpanSchema,
} from "../src/index.js";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sourceText = "雨夜的旧车站。林岚说：“你终于回来了。”两人隔着站台灯光相望。";
const sourceHash = sha(sourceText);

const sourceEvidence = (id: string, quote: string) => {
  const start = sourceText.indexOf(quote);
  return {
    evidence_id: id,
    kind: "SOURCE_TEXT" as const,
    source_hash: sourceHash,
    span: { start, end: start + quote.length, quote },
  };
};

const bundle = {
  version: 1 as const,
  source_text: sourceText,
  source_hash: sourceHash,
  style_preferences: "克制、写实",
  documents: [{
    document_id: "doc_source_001",
    conversion_id: "dcv_source_001",
    markdown_sha256: sha("# 品牌资料\n品牌名称为星港。\n完整资产后续内容。"),
    content_sha256: sha("# 品牌资料\n品牌名称为星港。"),
    content: "# 品牌资料\n品牌名称为星港。",
  }],
  references: [{
    asset_id: "ast_reference_001",
    asset_sha256: sha("image-1"),
    mime_type: "image/png" as const,
    position: 0,
    objective_description: "一座旧式铁路站台。",
  }],
  user_decisions: [
    {
      decision_id: "dec_caption_001",
      field: "caption_policy",
      value: "OFF",
      value_hash: sha(JSON.stringify("OFF")),
    },
    {
      decision_id: "dec_style_preferences_001",
      field: "style_preferences",
      value: "克制、写实",
      value_hash: sha(JSON.stringify("克制、写实")),
    },
  ],
  provider_capability: {
    profile_id: "sub2api-grok-video",
    min_duration_seconds: 1,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER" as const,
  },
  target_duration_seconds: 10,
};

const decision = {
  version: 1 as const,
  source_hash: sourceHash,
  target_duration_seconds: 10,
  execution_status: "READY" as const,
  dialogues: [{
    dialogue_id: "dlg_return_001",
    exact_text: "你终于回来了。",
    evidence: sourceEvidence("evd_dialogue_001", "你终于回来了。"),
  }],
  reference_usages: [{
    asset_id: "ast_reference_001",
    provider_role: "SCENE" as const,
    usage: "保持旧式站台的建筑结构与灯光关系。",
    evidence_refs: [{
      evidence_id: "evd_reference_001",
      kind: "REFERENCE_ASSET" as const,
      asset_id: "ast_reference_001",
      asset_sha256: sha("image-1"),
      observation: "旧式铁路站台。",
    }],
  }],
  segments: [{
    segment_id: "seg_station_001",
    sequence: 1,
    duration_seconds: 10,
    visual_decision: "两人隔着站台灯光相望，保持克制的写实表演。",
    evidence_refs: [sourceEvidence("evd_segment_001", "两人隔着站台灯光相望。")],
    dialogue_ids: ["dlg_return_001"],
    reference_asset_ids: ["ast_reference_001"],
  }],
  unresolved_items: [],
};

test("canonical source bundle preserves source, document, reference, decision, and provider facts without creative defaults", () => {
  const parsed = CanonicalSourceBundleSchema.parse(bundle);
  assert.equal(parsed.source_text, sourceText);
  assert.notEqual(parsed.documents[0]?.markdown_sha256, parsed.documents[0]?.content_sha256);
  assert.equal(parsed.references[0]?.position, 0);
  assert.equal(parsed.user_decisions[0]?.value, "OFF");
  assert.equal(parsed.user_decisions[1]?.value, "克制、写实");
  assert.throws(() => CanonicalSourceBundleSchema.parse({
    ...bundle,
    user_decisions: bundle.user_decisions.slice(0, 1),
  }));
  assert.equal(Object.hasOwn(parsed, "camera"), false);
  assert.equal(Object.hasOwn(parsed, "scene_category"), false);
});

test("semantic director decision carries evidence-referenced natural-language decisions", () => {
  const parsed = SemanticDirectorDecisionSchema.parse(decision);
  assert.equal(parsed.dialogues[0]?.exact_text, "你终于回来了。");
  assert.equal(parsed.segments[0]?.visual_decision.includes("站台"), true);
  assert.equal(Object.hasOwn(parsed.segments[0]!, "start_pose"), false);
  assert.equal(Object.hasOwn(parsed.segments[0]!, "camera_movement"), false);
});

test("source span requires a positive ordered range", () => {
  assert.throws(() => SourceTextSpanSchema.parse({ start: 5, end: 5, quote: "x" }));
});

test("canonical reference order is contiguous and cannot be silently reordered", () => {
  assert.throws(() => CanonicalSourceBundleSchema.parse({
    ...bundle,
    references: [{ ...bundle.references[0], position: 1 }],
  }));
});

test("semantic decisions reject duration drift, duplicate dialogue assignment, and blocking-ready states", () => {
  assert.throws(() => SemanticDirectorDecisionSchema.parse({
    ...decision,
    target_duration_seconds: 11,
  }));
  assert.throws(() => SemanticDirectorDecisionSchema.parse({
    ...decision,
    segments: [{ ...decision.segments[0], dialogue_ids: ["dlg_return_001", "dlg_return_001"] }],
  }));
  assert.throws(() => SemanticDirectorDecisionSchema.parse({
    ...decision,
    unresolved_items: [{
      unresolved_id: "unr_voice_001",
      question: "请选择声音所有权。",
      blocking: true,
      evidence_refs: [],
    }],
  }));
});

test("semantic segment schema rejects legacy fake creative fields", () => {
  assert.throws(() => SemanticDirectorDecisionSchema.parse({
    ...decision,
    segments: [{
      ...decision.segments[0],
      opening_state: "LEGACY_FAKE_OPENING_STATE",
    }],
  }));
});

test("blocked semantic decisions may omit segments but must explain a blocking uncertainty", () => {
  const blocked = SemanticDirectorDecisionSchema.parse({
    version: 1,
    source_hash: sourceHash,
    target_duration_seconds: 10,
    execution_status: "BLOCKED",
    dialogues: [],
    reference_usages: [],
    segments: [],
    unresolved_items: [{
      unresolved_id: "unr_reference_001",
      question: "参考图用途无法由现有证据确定。",
      blocking: true,
      evidence_refs: [],
    }],
  });
  assert.equal(blocked.segments.length, 0);
  assert.throws(() => SemanticDirectorDecisionSchema.parse({
    ...blocked,
    unresolved_items: [],
  }));
});
test("semantic director exports one machine-readable strict output contract", () => {
  assert.equal(SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION, "semantic-director-decision-v1");
  const serialized = JSON.stringify(SemanticDirectorDecisionJsonSchema);
  for (const requiredField of [
    "source_hash",
    "target_duration_seconds",
    "execution_status",
    "dialogues",
    "reference_usages",
    "segments",
    "unresolved_items",
  ]) {
    assert.match(serialized, new RegExp(`\\"${requiredField}\\"`));
  }
  assert.match(serialized, /additionalProperties/);
  assert.equal(serialized.includes("PLATFORM_OWNED_"), false);
  assert.equal(serialized.includes("default"), false);
});
