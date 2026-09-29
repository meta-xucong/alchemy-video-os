import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanonicalSourceBundle,
} from "@alchemy-video/creative-planning/semantic-director";

import {
  canonicalizeSemanticPlan,
  SemanticDirectorCanonicalizationError,
} from "../src/semantic-director-canonicalizer.js";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const sourceText = [
  "实验记录开始。",
  "Mara说：“hello.”",
  "Nia回答：“done”。",
].join("\n");

const bundle = createCanonicalSourceBundle({
  sourceText,
  stylePreferences: "restrained realism",
  targetDurationSeconds: 30,
  references: [
    {
      asset_id: "ast_subject_001",
      asset_sha256: sha("subject"),
      mime_type: "image/png",
      position: 0,
      provider_role: "SUBJECT",
    },
    {
      asset_id: "ast_scene_001",      asset_sha256: sha("scene"),
      mime_type: "image/png",
      position: 1,
      provider_role: "SCENE",
    },
  ],
  userDecisions: [
    {
      decisionId: "dec_canon_style_001",
      field: "style_preferences",
      value: "restrained realism",
    },
  ],
  providerCapability: {
    profile_id: "test-video-profile",
    min_duration_seconds: 8,
    max_duration_seconds: 15,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 7,
    audio_owner: "NATIVE_PROVIDER",
  },
});

const rawPlan = {
  execution_status: "READY" as const,
  segments: [
    {
      segment_id: "segment-1",
      duration_seconds: 15,
      visual_prompt: "人物在实验记录中确认结果。",
      dialogue_line_ids: ["line-2"],
      reference_asset_ids: ["ast_subject_001", "ast_scene_001"],
    },    {
      segment_id: "segment-2",
      duration_seconds: 15,
      visual_prompt: "镜头展示完成后的可见状态。",
      dialogue_line_ids: ["line-3"],
      reference_asset_ids: ["ast_subject_001", "ast_scene_001"],
    },
  ],
  unresolved_items: [],
};

test("canonicalizer preserves frozen roles and emits platform evidence", () => {
  const decision = canonicalizeSemanticPlan(rawPlan, bundle);

  assert.deepEqual(
    decision.reference_usages.map((usage) => usage.provider_role),
    ["SUBJECT", "SCENE"],
  );
  assert.deepEqual(
    decision.dialogues.map((dialogue) => dialogue.exact_text),
    ["hello.", "done"],
  );
  assert.equal(
    decision.segments[0]?.evidence_refs.filter((evidence) => evidence.kind === "USER_DECISION").length,
    1,
  );
  assert.equal(
    decision.segments[0]?.evidence_refs.filter((evidence) => evidence.kind === "REFERENCE_ASSET").length,
    2,
  );
});

test("canonicalizer rejects an unresolved dialogue line instead of dropping it", () => {
  const invalidRawPlan = {
    ...rawPlan,
    segments: rawPlan.segments.map((segment, index) => index === 0
      ? { ...segment, dialogue_line_ids: ["line-99"] }
      : segment),
  };

  assert.throws(
    () => canonicalizeSemanticPlan(invalidRawPlan, bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_DIALOGUE_ID_INVALID",
  );
});

test("canonicalizer rejects a narrative source line selected as dialogue", () => {
  const narrativeBundle = createCanonicalSourceBundle({
    sourceText: "镜头展示实验台。\n人物走到窗边。",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_narrative", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  assert.throws(
    () => canonicalizeSemanticPlan({
      ...boundaryPlan([8]),
      segments: [{
        ...boundaryPlan([8]).segments[0]!,
        dialogue_line_ids: ["line-1"],
      }],
    }, narrativeBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_DIALOGUE_ID_INVALID",
  );
});

test("canonicalizer does not bind an earlier visual quote to a later spoken duplicate", () => {
  const duplicateBundle = createCanonicalSourceBundle({
    sourceText: "画面文字：“hello”\nMara说：“hello”",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_visual_duplicate", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  assert.throws(
    () => canonicalizeSemanticPlan({
      ...boundaryPlan([8]),
      segments: [{
        ...boundaryPlan([8]).segments[0]!,
        dialogue_line_ids: ["line-1"],
      }],
    }, duplicateBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_DIALOGUE_ID_INVALID",
  );
});

test("canonicalizer rejects an ambiguous physical line with multiple spoken quotes", () => {
  const ambiguousBundle = createCanonicalSourceBundle({
    sourceText: "Mara说：“hello”；Nia回答：“hello”",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_ambiguous_line", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  assert.throws(
    () => canonicalizeSemanticPlan({
      ...boundaryPlan([8]),
      segments: [{
        ...boundaryPlan([8]).segments[0]!,
        dialogue_line_ids: ["line-1"],
      }],
    }, ambiguousBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_DIALOGUE_ID_INVALID",
  );
});

test("canonicalizer evidence span follows the selected duplicate dialogue line", () => {
  const duplicateLinesBundle = createCanonicalSourceBundle({
    sourceText: "Mara说：“hello”\nNia回答：“hello”",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_duplicate_lines", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  const decision = canonicalizeSemanticPlan({
    ...boundaryPlan([8]),
    segments: [{
      ...boundaryPlan([8]).segments[0]!,
      dialogue_line_ids: ["line-2"],
    }],
  }, duplicateLinesBundle);
  const evidence = decision.dialogues[0]!.evidence.span;
  const secondStart = duplicateLinesBundle.source_text.lastIndexOf("hello");
  assert.equal(evidence.start, secondStart);
  assert.equal(evidence.end, secondStart + "hello".length);
  assert.equal(evidence.quote, "hello");
});

test("canonicalizer preserves a multiline authored dialogue span", () => {
  const multilineBundle = createCanonicalSourceBundle({
    sourceText: "Mara说：“第一句\n第二句”",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_multiline_dialogue", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  const decision = canonicalizeSemanticPlan({
    ...boundaryPlan([8]),
    segments: [{
      ...boundaryPlan([8]).segments[0]!,
      dialogue_line_ids: ["line-2"],
    }],
  }, multilineBundle);
  const dialogue = decision.dialogues[0]!;
  assert.equal(dialogue.exact_text, "\n第二句");
  assert.equal(dialogue.evidence.span.quote, "\n第二句");
  assert.equal(
    multilineBundle.source_text.slice(dialogue.evidence.span.start, dialogue.evidence.span.end),
    dialogue.evidence.span.quote,
  );
});

test("canonicalizer preserves labelled multi-paragraph dialogue provenance", () => {
  const labelledBundle = createCanonicalSourceBundle({
    sourceText: "口播文案：\n第一句\n\n第二句",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style_labelled_multiline", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "sub2api:grok-imagine-video-1.5",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  const decision = canonicalizeSemanticPlan({
    ...boundaryPlan([8]),
    segments: [{
      ...boundaryPlan([8]).segments[0]!,
      dialogue_line_ids: ["line-4"],
    }],
  }, labelledBundle);
  const dialogue = decision.dialogues[0]!;
  assert.equal(dialogue.exact_text, "\n\n第二句");
  assert.equal(
    labelledBundle.source_text.slice(dialogue.evidence.span.start, dialogue.evidence.span.end),
    dialogue.evidence.span.quote,
  );
});
test("canonicalizer rejects a reference without a frozen provider role", () => {
  const missingRoleBundle = {
    ...bundle,
    references: bundle.references.map(({ provider_role: _providerRole, ...reference }) => reference),
  };

  assert.throws(
    () => canonicalizeSemanticPlan(rawPlan, missingRoleBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_REFERENCE_ROLE_MISSING",
  );
});

const boundaryBundle = (
  targetDurationSeconds: number,
  profileId: string,
  minDurationSeconds = 1,
  maxDurationSeconds = 15,
) => createCanonicalSourceBundle({
  sourceText: "环境建立。",
  stylePreferences: "克制",
  targetDurationSeconds,
  references: [],
  userDecisions: [{ decisionId: "dec_style", field: "style_preferences", value: "克制" }],
  providerCapability: {
    profile_id: profileId,
    min_duration_seconds: minDurationSeconds,
    max_duration_seconds: maxDurationSeconds,
    max_prompt_utf8_bytes: 4096,
    max_reference_images: 0,
    audio_owner: "NATIVE_PROVIDER",
  },
});

const boundaryPlan = (durations: number[], visualPrompt = "一个连续的可见动作。") => ({
  execution_status: "READY" as const,
  segments: durations.map((duration, index) => ({
    segment_id: `segment-${index + 1}`,
    duration_seconds: duration,
    visual_prompt: visualPrompt,
    dialogue_line_ids: [],
    reference_asset_ids: [],
  })),
  unresolved_items: [],
});

test("canonicalizer keeps every short target as one exact segment when capability allows it", () => {
  for (const profileId of ["sub2api:grok-imagine-video-1.5", "mock:mock-video-v1", "future:video-profile"]) {
    for (const duration of [1, 6, 7]) {
      const bundle = boundaryBundle(duration, profileId, 1, 15);
      const decision = canonicalizeSemanticPlan(boundaryPlan([duration]), bundle);
      assert.deepEqual(decision.segments.map((segment) => segment.duration_seconds), [duration]);
    }
  }
});

test("canonicalizer does not override a Provider capability that rejects a short target", () => {
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([6]),
      boundaryBundle(6, "capability:min-eight", 8, 15),
    ),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_DURATION_INVALID",
  );
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([6]),
      boundaryBundle(6, "capability:max-one", 1, 1),
    ),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_DURATION_INVALID",
  );
});

test("canonicalizer keeps 16/17/30 second plans within Huobao segment bounds", () => {
  for (const [target, durations] of [[16, [8, 8]], [17, [8, 9]], [30, [15, 15]]] as const) {
    const decision = canonicalizeSemanticPlan(
      boundaryPlan(durations),
      boundaryBundle(target, "mock:mock-video-v1"),
    );
    assert.equal(decision.segments.length, durations.length);
  }
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([8, 8, 7, 7]),
      boundaryBundle(30, "mock:mock-video-v1"),
    ),
  );
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([8, 8, 8, 6]),
      boundaryBundle(30, "mock:mock-video-v1"),
    ),
  );
});

test("shared segment gate rejects an eight-segment plan because source segments stay at least eight seconds", () => {
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([4, 4, 4, 3, 4, 4, 3, 4]),
      boundaryBundle(30, "mock:mock-video-v1"),
    ),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_DURATION_INVALID",
  );
});

test("shared segment gate rejects a segment whose dialogue exceeds source capacity", () => {
  const dialogueBundle = createCanonicalSourceBundle({
    sourceText: "Mara说：\"1234567890123456789012345678901234567890\"",
    stylePreferences: "克制",
    targetDurationSeconds: 8,
    references: [],
    userDecisions: [{ decisionId: "dec_style", field: "style_preferences", value: "克制" }],
    providerCapability: {
      profile_id: "mock:mock-video-v1",
      min_duration_seconds: 1,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 0,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  assert.throws(
    () => canonicalizeSemanticPlan({
      ...boundaryPlan([8]),
      segments: [{
        ...boundaryPlan([8]).segments[0]!,
        dialogue_line_ids: ["line-1"],
      }],
    }, dialogueBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_DIALOGUE_CAPACITY_INVALID",
  );
});

test("canonicalizer validates explicit in-segment sub-shot rows without creating tasks", () => {
  const bundle = boundaryBundle(8, "mock:mock-video-v1");
  const decision = canonicalizeSemanticPlan(
    boundaryPlan([8], "【镜头1】建立空间，0-3秒。\n【镜头2】人物抬头，3-6秒。"),
    bundle,
  );
  assert.equal(decision.segments.length, 1);

  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([8], "【镜头1】单一镜头，0-3秒。"),
      bundle,
    ),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
  );
  assert.throws(
    () => canonicalizeSemanticPlan(
      boundaryPlan([8], "【镜头1】建立，0-1秒。\n【镜头2】结果，1-4秒。"),
      bundle,
    ),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
  );
});
