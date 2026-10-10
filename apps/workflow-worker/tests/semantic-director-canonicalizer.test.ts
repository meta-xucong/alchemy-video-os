import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCanonicalSourceBundle,
  normalizeName,
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

  assert.throws(
    () => canonicalizeSemanticPlan({
      ...rawPlan,
      segments: rawPlan.segments.map((segment) => ({ ...segment, visual_prompt: sourceText })),
    }, bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.[0]?.code === "SEGMENT_VISUAL_PROMPT_COPIES_SOURCE",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({
      ...rawPlan,
      segments: rawPlan.segments.map((segment, index) => index === 0
        ? { ...segment, visual_prompt: "镜头中出现文字：done。" }
        : segment),
    }, bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.[0]?.code === "SEGMENT_VISUAL_PROMPT_COPIES_UNASSIGNED_DIALOGUE",
  );
});

test("G02 beat lineage freezes exact source spans and maps each beat to one segment", () => {
  const g02Source = [
    "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
    "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。",
    "G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。",
  ].join("\n");
  const g02Bundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_001",
    sourceText: g02Source,
    stylePreferences: "珍珠白银色调",
    targetDurationSeconds: 30,
    references: [
      { asset_id: "ast_jar_001", asset_sha256: sha("jar"), mime_type: "image/png", position: 0, provider_role: "SUBJECT", user_declared_usage: "面霜罐在第一节拍的乳霜质地画面中展示。" },
      { asset_id: "ast_box_001", asset_sha256: sha("box"), mime_type: "image/png", position: 1, provider_role: "SUBJECT", user_declared_usage: "外包装盒在第三节拍结尾特写。" },
      { asset_id: "ast_woman_001", asset_sha256: sha("woman"), mime_type: "image/png", position: 2, provider_role: "SUBJECT", user_declared_usage: "女性在第三节拍自然将乳霜涂于面部。" },
      { asset_id: "ast_scene_001", asset_sha256: sha("scene"), mime_type: "image/png", position: 3, provider_role: "SCENE", user_declared_usage: "研发灌装环境与窗外新加坡天际线作为第二节拍单一场景。" },
    ],
    userDecisions: [{ decisionId: "dec_g02_style_001", field: "style_preferences", value: "珍珠白银色调" }],
    providerCapability: {
      profile_id: "test-g02-profile",
      min_duration_seconds: 8,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 7,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  const candidates = [
    { candidate_key: "entity-jar", kind: "PROP", exact_name: "面霜罐", source_evidence_refs: ["G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。", g02Bundle.references[0]!.user_declared_usage!], reference_asset_ids: ["ast_jar_001"], type: "护肤品容器", description: "面霜罐" },
    { candidate_key: "entity-box", kind: "PROP", exact_name: "外包装盒", source_evidence_refs: ["G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。", g02Bundle.references[1]!.user_declared_usage!], reference_asset_ids: ["ast_box_001"], type: "产品包装", description: "外包装盒" },
    { candidate_key: "entity-woman", kind: "CHARACTER", exact_name: "女性", source_evidence_refs: ["G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。", g02Bundle.references[2]!.user_declared_usage!], reference_asset_ids: ["ast_woman_001"], role: "用户已批准的使用者", description: "自然使用产品" },
    { candidate_key: "entity-scene", kind: "SCENE", exact_name: "研发灌装环境", source_evidence_refs: ["G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。", g02Bundle.references[3]!.user_declared_usage!], reference_asset_ids: ["ast_scene_001"], location: "研发灌装环境", prompt: "窗外可见新加坡天际线" },
  ];
  const plan = {
    execution_status: "READY" as const,
    entity_candidates: candidates,
    segments: [
      { segment_id: "segment-1", duration_seconds: 10, visual_prompt: "【镜头1】0-3秒：@面霜罐的乳霜质地。\n3-6秒：乳霜质地细节延续。\n【镜头2】6-9秒：肌肤舒缓。\n9-10秒：肌肤状态平稳。", dialogue_line_ids: [], reference_asset_ids: ["ast_jar_001"], source_narrative_beat_sequences: [1], prop_candidate_keys: ["entity-jar"] },
      { segment_id: "segment-2", duration_seconds: 10, visual_prompt: "【镜头1】0-3秒：@研发灌装环境内，窗外城市天际线。\n3-6秒：研发灌装环境中的设备运作。\n【镜头2】6-9秒：研发灌装环境保持单一空间。\n9-10秒：设施内光线稳定。", dialogue_line_ids: [], reference_asset_ids: ["ast_scene_001"], source_narrative_beat_sequences: [2], scene_candidate_key: "entity-scene" },
      { segment_id: "segment-3", duration_seconds: 10, visual_prompt: "【镜头1】0-3秒：@女性自然涂抹乳霜。\n3-6秒：女性完成涂抹动作。\n【镜头2】6-9秒：@外包装盒特写收尾。\n9-10秒：包装停留在画面中央。", dialogue_line_ids: [], reference_asset_ids: ["ast_box_001", "ast_woman_001"], source_narrative_beat_sequences: [3], character_candidate_keys: ["entity-woman"], prop_candidate_keys: ["entity-box"] },
    ],
    unresolved_items: [],
  };
  const assertDiagnostic = (
    expectedCodeOrCodes: string | readonly string[],
    raw: unknown,
    source: typeof g02Bundle = g02Bundle,
  ) => {
    const expectedCodes = typeof expectedCodeOrCodes === "string" ? [expectedCodeOrCodes] : [...expectedCodeOrCodes];
    let captured: unknown;
    assert.throws(
      () => canonicalizeSemanticPlan(raw, source),
      (error) => {
        captured = error;
        return error instanceof SemanticDirectorCanonicalizationError
          && error.issues?.length === expectedCodes.length
          && new Set(error.issues.map((issue) => issue.code)).size === error.issues.length
          && expectedCodes.every((code, index) => error.issues?.[index]?.code === code);
      },
      `Expected fixed diagnostic codes: ${expectedCodes.join(", ")}`,
    );
    return captured as SemanticDirectorCanonicalizationError;
  };

  const decision = canonicalizeSemanticPlan(plan, g02Bundle);
  assert.deepEqual(decision.segments.map((segment) => segment.source_narrative_beat_sequences), [[1], [2], [3]]);
  assert.equal(decision.semantic_narrative_beat_lineage?.beats[1]?.span.quote, "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。");
  assert.equal(decision.entity_candidates?.length, 4);
  assert.equal(decision.segments.every((segment) => !segment.visual_decision.includes("【镜头")), true);
  assert.equal(decision.segments[0]?.visual_decision, "0-3秒：@面霜罐的乳霜质地。\n3-6秒：乳霜质地细节延续。\n6-9秒：肌肤舒缓。\n9-10秒：肌肤状态平稳。");

  const jarBeat = "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。";
  const wrongEntityUsage = "CANARY_WRONG_ENTITY_USAGE";
  const withJarUsage = (usage: string | undefined, sourceEvidenceRefs: string[]) => ({
    raw: {
      ...plan,
      entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar"
        ? { ...candidate, source_evidence_refs: sourceEvidenceRefs }
        : candidate),
    },
    source: {
      ...g02Bundle,
      references: g02Bundle.references.map((reference) => {
        if (reference.asset_id !== "ast_jar_001") return reference;
        const updated = { ...reference };
        delete updated.user_declared_usage;
        return usage === undefined ? updated : { ...updated, user_declared_usage: usage };
      }),
    },
  });

  const missingJarUsage = withJarUsage(undefined, [jarBeat]);
  assertDiagnostic("G02_REFERENCE_USAGE_MISSING", missingJarUsage.raw, missingJarUsage.source);
  const emptyJarUsage = withJarUsage("", [jarBeat]);
  assertDiagnostic("G02_REFERENCE_USAGE_MISSING", emptyJarUsage.raw, emptyJarUsage.source);
  const nameMismatch = withJarUsage(wrongEntityUsage, [jarBeat, wrongEntityUsage]);
  assertDiagnostic("G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH", nameMismatch.raw, nameMismatch.source);
  const decisionUsage = "面霜罐仅按批准参考图展示。";
  const wrongEvidenceKind = withJarUsage(jarBeat, [decisionUsage]);
  wrongEvidenceKind.source.user_decisions = wrongEvidenceKind.source.user_decisions.map((decision) => ({
    ...decision,
    value: decisionUsage,
  }));
  assertDiagnostic([
    "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE",
    "G02_REFERENCE_USAGE_NOT_REFERENCE_ASSET",
  ], wrongEvidenceKind.raw, wrongEvidenceKind.source);
  const combinedMismatch = withJarUsage(wrongEntityUsage, [jarBeat]);
  assertDiagnostic([
    "G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH",
    "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE",
  ], combinedMismatch.raw, combinedMismatch.source);

  const failFastAcrossMappings = withJarUsage(undefined, [decisionUsage]);
  failFastAcrossMappings.source.user_decisions = failFastAcrossMappings.source.user_decisions.map((decision) => ({
    ...decision,
    value: decisionUsage,
  }));
  failFastAcrossMappings.raw.entity_candidates = candidates.map((candidate) => candidate.candidate_key === "entity-jar"
    ? { ...candidate, source_evidence_refs: [decisionUsage], reference_asset_ids: ["ast_jar_001", "ast_box_001"] }
    : candidate);
  assertDiagnostic(
    "G02_REFERENCE_USAGE_MISSING",
    failFastAcrossMappings.raw,
    failFastAcrossMappings.source,
  );

  const usageCanary = "CANARY_PRIVATE_USAGE_DO_NOT_LOG";
  const leakCase = withJarUsage(usageCanary, [jarBeat, usageCanary]);
  const leakError = assertDiagnostic("G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH", leakCase.raw, leakCase.source);
  const diagnosticText = `${leakError.message} ${JSON.stringify(leakError.issues)}`;
  for (const privateValue of [usageCanary, "entity-jar", "面霜罐", "ast_jar_001"]) {
    assert.equal(diagnosticText.includes(privateValue), false, `Diagnostic must not expose ${privateValue}`);
  }
  const sourceTextCanary = "CANARY_PRIVATE_SOURCE_TEXT_DO_NOT_LOG";
  const sourceTextLeakBundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_source_text_canary",
    sourceText: `${g02Source}\n${sourceTextCanary}\n${usageCanary}`,
    stylePreferences: "珍珠白银色调",
    targetDurationSeconds: 30,
    references: g02Bundle.references.map((reference) => reference.asset_id === "ast_jar_001"
      ? { ...reference, user_declared_usage: usageCanary }
      : reference),
    userDecisions: [
      { decisionId: "dec_g02_style_source_text_canary", field: "style_preferences", value: "珍珠白银色调" },
      { decisionId: "dec_g02_entity_source_text_canary", field: "entity_evidence", value: decisionUsage },
    ],
    providerCapability: {
      profile_id: "test-g02-profile",
      min_duration_seconds: 8,
      max_duration_seconds: 15,
      max_prompt_utf8_bytes: 4096,
      max_reference_images: 7,
      audio_owner: "NATIVE_PROVIDER",
    },
  });
  const sourceTextLeakRaw = {
    ...leakCase.raw,
    entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar"
      ? { ...candidate, source_evidence_refs: [decisionUsage] }
      : candidate),
  };
  const sourceTextLeakError = assertDiagnostic(
    [
      "G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH",
      "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE",
      "G02_REFERENCE_USAGE_NOT_REFERENCE_ASSET",
    ],
    sourceTextLeakRaw,
    sourceTextLeakBundle,
  );
  const sourceDiagnosticText = `${sourceTextLeakError.message} ${JSON.stringify(sourceTextLeakError.issues)}`;
  for (const privateValue of [sourceTextCanary, usageCanary, "entity-jar", "面霜罐", "ast_jar_001"]) {
    assert.equal(sourceDiagnosticText.includes(privateValue), false, `Diagnostic must not expose ${privateValue}`);
  }

  assertDiagnostic("G02_SOURCE_MARKERS_INVALID", plan, {
    ...g02Bundle,
    source_text: g02Source.replace("G02_APPROVED_BEAT_1:", "G02_APPROVED_BEAT_0:"),
  });
  assertDiagnostic("G02_SOURCE_LINEAGE_MISSING", plan, {
    ...g02Bundle,
    semantic_narrative_beat_lineage: undefined,
  });
  assertDiagnostic("G02_SEGMENT_BEAT_MAPPING_INVALID", {
    ...plan,
    segments: plan.segments.map((segment, index) => index === 0
      ? { ...segment, source_narrative_beat_sequences: [1, 2] }
      : segment),
  });
  assertDiagnostic("G02_LINEAGE_BINDING_INVALID", plan, {
    ...g02Bundle,
    source_hash: sha("wrong frozen source"),
  });

  let emptyCandidateError: unknown;
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: [] }, g02Bundle),
    (error) => {
      emptyCandidateError = error;
      return error instanceof SemanticDirectorCanonicalizationError
        && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
        && error.issues?.[0]?.code === "G02_ENTITY_CANDIDATES_EMPTY";
    },
    "G02 diagnostics must expose only a fixed reason code, never model candidate content",
  );
  assert.deepEqual(
    (emptyCandidateError as SemanticDirectorCanonicalizationError).issues,
    [{ code: "G02_ENTITY_CANDIDATES_EMPTY" }],
  );
  assertDiagnostic("G02_CANDIDATE_KEYS_DUPLICATE", {
    ...plan,
    entity_candidates: [...candidates, { ...candidates[0]!, candidate_key: candidates[0]!.candidate_key }],
  });
  assertDiagnostic("G02_CANDIDATE_IDENTITY_INVALID", {
    ...plan,
    entity_candidates: [...candidates, { ...candidates[0]!, candidate_key: "entity-jar-copy" }],
  });

  assert.throws(
    () => canonicalizeSemanticPlan({
      ...plan,
      segments: plan.segments.map((segment) => segment.segment_id === "segment-3"
        ? { ...segment, reference_asset_ids: ["ast_woman_001", "ast_box_001"] }
        : segment),
    }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.[0]?.code === "G02_REFERENCE_ORDER_INVALID",
    "membership-valid references in reversed Provider order must fail during canonicalization",
  );

  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.kind === "SCENE" ? { ...candidate, location: "新加坡" } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_SCENE_NAME_LOCATION_MISMATCH",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar" ? { ...candidate, source_evidence_refs: ["面霜罐与乳霜"] } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_CANDIDATE_EVIDENCE_UNSUPPORTED",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar" ? { ...candidate, source_evidence_refs: [...candidate.source_evidence_refs, candidate.source_evidence_refs[0]!] } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
    "duplicate candidate evidence references must fail closed",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar" ? { ...candidate, reference_asset_ids: ["ast_jar_001", "ast_jar_001"] } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
    "duplicate candidate reference assets must fail closed",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar" ? { ...candidate, source_evidence_refs: ["G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。", g02Bundle.references[0]!.user_declared_usage!] } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_BEAT_ENTITY_BINDING_INCOMPLETE",
  );
  assert.throws(
    () => canonicalizeSemanticPlan(plan, { ...g02Bundle, source_hash: sha("wrong frozen source") }),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_LINEAGE_BINDING_INVALID",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, entity_candidates: candidates.map((candidate) => candidate.kind === "SCENE" ? { ...candidate, source_evidence_refs: candidate.source_evidence_refs.filter((ref) => ref !== g02Bundle.references[3]!.user_declared_usage) } : candidate) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...plan, segments: plan.segments.map((segment) => segment.segment_id === "segment-3" ? { ...segment, character_candidate_keys: [] } : segment) }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID"
      && error.issues?.length === 1
      && error.issues[0]?.code === "G02_REFERENCE_ENTITY_MAPPING_INVALID",
  );

  const existingEntityBundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_existing_entity",
    sourceText: g02Source,
    stylePreferences: "珍珠白银色调",
    targetDurationSeconds: 30,
    references: g02Bundle.references,
    userDecisions: [{ decisionId: "dec_g02_existing_entity", field: "style_preferences", value: "珍珠白银色调" }],
    visualEntities: [{
      entity_id: "ent_g02_jar",
      entity_kind: "PROP",
      normalized_identity: normalizeName("面霜罐"),
      revision_id: "rev_g02_jar",
      revision_number: 1,
      content_hash: sha("existing canonical jar"),
      exact_name: "面霜罐（历史别名）",
    }],
    providerCapability: g02Bundle.provider_capability,
  });
  const propAliasPlan = {
    ...plan,
    entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar"
      ? {
        ...candidate,
        exact_name: "面霜罐（产品）",
        source_evidence_refs: [
          "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
          "面霜罐（历史别名）（面霜罐（产品））参考图，仅展示原样产品。",
        ],
      }
      : candidate),
    segments: plan.segments.map((segment) => segment.segment_id === "segment-1"
      ? { ...segment, visual_prompt: segment.visual_prompt.replaceAll("@面霜罐", "@面霜罐（产品）") }
      : segment),
  };
  const propAliasBundle = {
    ...existingEntityBundle,
    references: existingEntityBundle.references.map((reference) => reference.asset_id === "ast_jar_001"
      ? { ...reference, user_declared_usage: "面霜罐（历史别名）（面霜罐（产品））参考图，仅展示原样产品。" }
      : reference),
  };
  const propAliasDecision = canonicalizeSemanticPlan(propAliasPlan, propAliasBundle);
  assert.equal(propAliasDecision.entity_candidates?.[0]?.exact_name, "面霜罐（产品）", "source candidate text remains unchanged");
  assert.match(propAliasDecision.segments[0]!.visual_decision, /@面霜罐（历史别名）/u);
  assert.doesNotMatch(propAliasDecision.segments[0]!.visual_decision, /@面霜罐（产品）/u);
  assert.equal(
    propAliasDecision.segments[0]!.visual_decision,
    plan.segments[0]!.visual_prompt.replace(/^【镜头[1-9]\d*】/gmu, "").replace("@面霜罐", "@面霜罐（历史别名）"),
    "canonical entity resolution changes only the exact anchor bytes",
  );

  const sceneAliasUsage = "研发灌装环境（研发 灌装环境）参考图，用于第二节拍。";
  const sceneAliasPlan = {
    ...plan,
    entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-scene"
      ? {
        ...candidate,
        exact_name: "研发 灌装环境",
        location: "研发 灌装环境",
        source_evidence_refs: ["G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。", sceneAliasUsage],
      }
      : candidate),
    segments: plan.segments.map((segment) => segment.segment_id === "segment-2"
      ? { ...segment, visual_prompt: segment.visual_prompt.replaceAll("@研发灌装环境", "@研发 灌装环境") }
      : segment),
  };
  const sceneAliasBundle = {
    ...existingEntityBundle,
    visual_entities: [{
      entity_id: "ent_g02_scene",
      entity_kind: "SCENE" as const,
      normalized_identity: JSON.stringify(["研发灌装环境", ""]),
      revision_id: "rev_g02_scene",
      revision_number: 1,
      content_hash: sha("existing canonical scene"),
      exact_name: "研发灌装环境",
    }],
    references: existingEntityBundle.references.map((reference) => reference.asset_id === "ast_scene_001"
      ? { ...reference, user_declared_usage: sceneAliasUsage }
      : reference),
  };
  const sceneAliasDecision = canonicalizeSemanticPlan(sceneAliasPlan, sceneAliasBundle);
  assert.equal(sceneAliasDecision.entity_candidates?.find((candidate) => candidate.candidate_key === "entity-scene")?.exact_name, "研发 灌装环境");
  assert.match(sceneAliasDecision.segments[1]!.visual_decision, /@研发灌装环境/u);
  assert.doesNotMatch(sceneAliasDecision.segments[1]!.visual_decision, /@研发 灌装环境/u);
  assert.equal(
    sceneAliasDecision.segments[1]!.visual_decision,
    sceneAliasPlan.segments[1]!.visual_prompt.replace(/^【镜头[1-9]\d*】/gmu, "").replace("@研发 灌装环境", "@研发灌装环境"),
    "scene alias resolution preserves all non-anchor prompt bytes",
  );
  assert.match(decision.segments[1]!.visual_decision, /@研发灌装环境/u, "new entities keep the source candidate anchor unchanged");

  const differentSceneTimeBundle = {
    ...sceneAliasBundle,
    visual_entities: [{
      ...sceneAliasBundle.visual_entities[0]!,
      normalized_identity: JSON.stringify(["研发灌装环境", "夜间"]),
    }],
  };
  const differentSceneTimeDecision = canonicalizeSemanticPlan(sceneAliasPlan, differentSceneTimeBundle);
  assert.match(differentSceneTimeDecision.segments[1]!.visual_decision, /@研发 灌装环境/u, "a different exact scene time does not reuse or rewrite the existing scene name");

  const nearMatchUsage = "面霜罐盖在第一节拍作为独立物件参考。";
  const nearMatchRaw = {
    ...plan,
    entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar"
      ? { ...candidate, exact_name: "面霜罐盖", source_evidence_refs: ["G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。", nearMatchUsage] }
      : candidate),
    segments: plan.segments.map((segment) => segment.segment_id === "segment-1"
      ? { ...segment, visual_prompt: segment.visual_prompt.replaceAll("@面霜罐", "@面霜罐盖") }
      : segment),
  };
  const nearMatchBundle = {
    ...existingEntityBundle,
    references: existingEntityBundle.references.map((reference) => reference.asset_id === "ast_jar_001"
      ? { ...reference, user_declared_usage: nearMatchUsage }
      : reference),
  };
  const nearMatchDecision = canonicalizeSemanticPlan(nearMatchRaw, nearMatchBundle);
  assert.match(nearMatchDecision.segments[0]!.visual_decision, /@面霜罐盖/u, "a non-matching identity is neither fuzzy-matched nor rewritten");

  const ambiguousIdentityBundle = {
    ...propAliasBundle,
    visual_entities: [...propAliasBundle.visual_entities!, {
      ...propAliasBundle.visual_entities![0]!,
      entity_id: "ent_g02_jar_duplicate",
      revision_id: "rev_g02_jar_duplicate",
    }],
  };
  assertDiagnostic("G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS", propAliasPlan, ambiguousIdentityBundle);
  assertDiagnostic([
    "G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH",
    "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE",
  ], {
    ...plan,
    entity_candidates: candidates.map((candidate) => candidate.candidate_key === "entity-jar"
      ? { ...candidate, reference_asset_ids: ["ast_box_001"] }
      : candidate),
  });
  assertDiagnostic("G02_SEGMENT_BINDING_DUPLICATE", {
    ...plan,
    segments: plan.segments.map((segment, index) => index === 0
      ? { ...segment, prop_candidate_keys: ["entity-jar", "entity-jar"] }
      : segment),
  });
  assertDiagnostic("G02_REFERENCE_ENTITY_MAPPING_INVALID", {
    ...plan,
    segments: plan.segments.map((segment, index) => index === 0
      ? { ...segment, reference_asset_ids: [] }
      : segment),
  });
  assertDiagnostic("G02_SEGMENT_CANDIDATE_BINDING_INVALID", {
    ...plan,
    segments: plan.segments.map((segment) => segment.segment_id === "segment-2"
      ? { ...segment, scene_candidate_key: undefined, prop_candidate_keys: ["entity-scene"] }
      : segment),
  });
  assertDiagnostic("G02_PROMPT_ENTITY_MENTION_UNBOUND", {
    ...plan,
    segments: plan.segments.map((segment, index) => index === 0
      ? { ...segment, visual_prompt: `${segment.visual_prompt}\n附加主体@未登记实体。` }
      : segment),
  });
  assertDiagnostic("G02_BEAT_ENTITY_BINDING_INCOMPLETE", {
    ...plan,
    segments: plan.segments.map((segment, index) => index === 0
      ? {
        ...segment,
        visual_prompt: segment.visual_prompt.replace("@面霜罐", "面霜罐"),
        reference_asset_ids: [],
        prop_candidate_keys: [],
      }
      : segment),
  });
  const unusedUsage = "展台光影参考图。";
  const unusedReference = {
    asset_id: "ast_unused_001",
    asset_sha256: sha("unused visual reference"),
    mime_type: "image/png" as const,
    position: 4,
    provider_role: "SUBJECT" as const,
    user_declared_usage: unusedUsage,
  };
  assertDiagnostic("G02_CANDIDATE_UNUSED", {
    ...plan,
    entity_candidates: [...candidates, {
      candidate_key: "entity-unused",
      kind: "PROP",
      exact_name: "展台光影",
      source_evidence_refs: [unusedUsage],
      reference_asset_ids: [unusedReference.asset_id],
      type: "氛围参考",
      description: "展台光影",
    }],
  }, {
    ...g02Bundle,
    references: [...g02Bundle.references, unusedReference],
  });

  const duplicateNameUsage = "研发灌装环境作为第二节拍的环境参考。";
  const duplicateNameAsset = {
    asset_id: "ast_scene_prop_001",
    asset_sha256: sha("scene prop"),
    mime_type: "image/png" as const,
    position: 4,
    provider_role: "SUBJECT" as const,
    user_declared_usage: duplicateNameUsage,
  };
  const duplicateNameCandidate = {
    candidate_key: "entity-scene-name-prop",
    kind: "PROP" as const,
    exact_name: "研发灌装环境",
    source_evidence_refs: ["G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。", duplicateNameUsage],
    reference_asset_ids: [duplicateNameAsset.asset_id],
    type: "环境参考",
    description: "研发灌装环境",
  };
  const ambiguousPlan = {
    ...plan,
    entity_candidates: [...candidates, duplicateNameCandidate],
    segments: plan.segments.map((segment) => segment.segment_id === "segment-2"
      ? {
        ...segment,
        reference_asset_ids: ["ast_scene_001", duplicateNameAsset.asset_id],
        prop_candidate_keys: [duplicateNameCandidate.candidate_key],
      }
      : segment),
  };
  assert.throws(
    () => canonicalizeSemanticPlan(ambiguousPlan, {
      ...g02Bundle,
      references: [...g02Bundle.references, duplicateNameAsset],
    }),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
    "a used @exact_name shared by SCENE and PROP candidates must fail closed",
  );
});

test("G02 rejects cross-beat merges and mappings unsupported by frozen usage", () => {
  const g02Source = [
    "G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。",
    "G02_APPROVED_BEAT_2:新加坡天际线与研发灌装环境。",
    "G02_APPROVED_BEAT_3:女性使用产品并以包装特写收尾。",
  ].join("\n");
  const g02Bundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_002",
    sourceText: g02Source,
    stylePreferences: "",
    targetDurationSeconds: 30,
    references: [{ asset_id: "ast_jar_002", asset_sha256: sha("jar"), mime_type: "image/png", position: 0, provider_role: "SUBJECT", user_declared_usage: "仅为面霜罐产品图。" }],
    userDecisions: [],
    providerCapability: { profile_id: "test-g02-profile", min_duration_seconds: 8, max_duration_seconds: 15, max_prompt_utf8_bytes: 4096, max_reference_images: 7, audio_owner: "NATIVE_PROVIDER" },
  });
  const base = {
    execution_status: "READY" as const,
    entity_candidates: [{ candidate_key: "entity-jar", kind: "PROP", exact_name: "面霜罐", source_evidence_refs: ["G02_APPROVED_BEAT_1:面霜罐与乳霜质地，肌肤舒缓。", "仅为面霜罐产品图。"], reference_asset_ids: ["ast_jar_002"], type: "护肤品容器", description: "面霜罐" }],
    segments: [1, 2, 3].map((sequence) => ({ segment_id: `segment-${sequence}`, duration_seconds: 10, visual_prompt: `【镜头1】0-3秒：@面霜罐镜头${sequence}。\n3-6秒：细节延续。\n【镜头2】6-9秒：画面变化。\n9-10秒：结果停留。`, dialogue_line_ids: [], reference_asset_ids: ["ast_jar_002"], source_narrative_beat_sequences: [sequence], prop_candidate_keys: ["entity-jar"] })),
    unresolved_items: [],
  };
  assert.throws(
    () => canonicalizeSemanticPlan({ ...base, segments: [{ ...base.segments[0]!, source_narrative_beat_sequences: [1, 2] }, base.segments[1]!, base.segments[2]!] }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError && error.code === "CANONICALIZATION_SEGMENT_COUNT_INVALID",
  );
  assert.throws(
    () => canonicalizeSemanticPlan({ ...base, entity_candidates: [{ ...base.entity_candidates[0]!, exact_name: "外包装盒" }] }, g02Bundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
  );
});

test("G02 evidence and @ anchors reject an English entity name that is only a substring", () => {
  const firstBeat = "G02_APPROVED_BEAT_1:Carefully apply the product.";
  const usage = "Carefully photographed product reference.";
  const substringBundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_substring",
    sourceText: [firstBeat, "G02_APPROVED_BEAT_2:Show the clean room.", "G02_APPROVED_BEAT_3:Finish on the package."].join("\n"),
    stylePreferences: "",
    targetDurationSeconds: 30,
    references: [{ asset_id: "ast_g02_substring", asset_sha256: sha("substring"), mime_type: "image/png", position: 0, provider_role: "SUBJECT", user_declared_usage: usage }],
    userDecisions: [],
    providerCapability: { profile_id: "test-g02-profile", min_duration_seconds: 8, max_duration_seconds: 15, max_prompt_utf8_bytes: 4096, max_reference_images: 7, audio_owner: "NATIVE_PROVIDER" },
  });
  const plan = {
    execution_status: "READY" as const,
    entity_candidates: [{ candidate_key: "entity-care", kind: "PROP", exact_name: "Care", source_evidence_refs: [firstBeat, usage], reference_asset_ids: ["ast_g02_substring"], type: "product", description: "Care" }],
    segments: [1, 2, 3].map((sequence) => ({
      segment_id: `segment-${sequence}`,
      duration_seconds: 10,
      visual_prompt: `【镜头1】0-3秒：@Care，自然展示。\n3-6秒：细节。\n【镜头2】6-9秒：画面延续。\n9-10秒：收尾。`,
      dialogue_line_ids: [],
      reference_asset_ids: ["ast_g02_substring"],
      source_narrative_beat_sequences: [sequence],
      prop_candidate_keys: ["entity-care"],
    })),
    unresolved_items: [],
  };
  assert.throws(
    () => canonicalizeSemanticPlan(plan, substringBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
  );

  const supportedBeat = "G02_APPROVED_BEAT_1:Care applies the product.";
  const supportedUsage = "Care product reference image.";
  const supportedBundle = createCanonicalSourceBundle({
    briefRevisionId: "cbr_g02_exact_anchor",
    sourceText: [supportedBeat, "G02_APPROVED_BEAT_2:Show the clean room.", "G02_APPROVED_BEAT_3:Finish on the package."].join("\n"),
    stylePreferences: "",
    targetDurationSeconds: 30,
    references: [{ asset_id: "ast_g02_substring", asset_sha256: sha("substring"), mime_type: "image/png", position: 0, provider_role: "SUBJECT", user_declared_usage: supportedUsage }],
    userDecisions: [],
    providerCapability: { profile_id: "test-g02-profile", min_duration_seconds: 8, max_duration_seconds: 15, max_prompt_utf8_bytes: 4096, max_reference_images: 7, audio_owner: "NATIVE_PROVIDER" },
  });
  const exactAnchorPlan = {
    ...plan,
    entity_candidates: [{ ...plan.entity_candidates[0]!, source_evidence_refs: [supportedBeat, supportedUsage] }],
  };
  assert.doesNotThrow(() => canonicalizeSemanticPlan(exactAnchorPlan, supportedBundle));
  const supportedPlan = {
    ...exactAnchorPlan,
    segments: exactAnchorPlan.segments.map((segment) => ({ ...segment, visual_prompt: segment.visual_prompt.replace("@Care", "@Careful") })),
  };
  assert.throws(
    () => canonicalizeSemanticPlan(supportedPlan, supportedBundle),
    (error) => error instanceof SemanticDirectorCanonicalizationError
      && error.code === "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
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

test("canonicalizer keeps the Huobao 8-second minimum even when a Provider advertises shorter requests", () => {
  for (const [profileId, minimum, maximum] of [
    ["mock:mock-video-v1", 1, 15],
    ["future:video-profile", 1, 15],
    ["sub2api:grok-imagine-video-1.5", 1, 15],
    ["sub2api:grok-imagine-video-1.5", 8, 15],
  ] as const) {
    assert.throws(
      () => canonicalizeSemanticPlan(
        boundaryPlan([6]),
        boundaryBundle(6, profileId, minimum, maximum),
      ),
      (error) => error instanceof SemanticDirectorCanonicalizationError
        && error.code === "CANONICALIZATION_SEGMENT_DURATION_INVALID",
    );
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
  const valid = "【镜头1】0-3秒：建立空间。\n【镜头2】3-6秒：人物抬头。\n6-8秒：结果停留。";
  const decision = canonicalizeSemanticPlan(
    boundaryPlan([8], valid),
    bundle,
  );
  assert.equal(decision.segments.length, 1);
  assert.equal(decision.segments[0]?.visual_decision, "0-3秒：建立空间。\n3-6秒：人物抬头。\n6-8秒：结果停留。");

  const invalid = [
    "【镜头1】0-3秒：缺少第二个 marker。", // zero mapping for the remainder and incomplete coverage
    "【镜头1】\n【镜头2】0-3秒： marker1 映射 0 行。\n3-6秒：延续。\n【镜头3】6-8秒：结尾。",
    "【镜头1】0-3秒：A。\n【镜头1】3-6秒：重复。\n6-8秒：尾行。",
    "【镜头2】0-3秒：乱序。\n【镜头1】3-6秒：乱序。\n6-8秒：尾行。",
    "【镜头1】0-3秒：A。\n3-5秒：间断。\n【镜头2】6-8秒：B。",
    "【镜头1】0-3秒：A。\n2-5秒：重叠。\n【镜头2】5-8秒：B。",
    "【镜头1】0-3秒：A。\n【镜头2】3-6秒：B。",
    "【镜头1】0-3秒：A。\n3-6秒：B。\n6-8秒：C。\n8-9秒：越界。",
    "【镜头1】0-3秒：A。\n3-6秒：B。\n6-7秒：C。\n7-8秒：D。\n【镜头2】8-8秒：零时长。",
    "【镜头0】0-3秒：非法编号。\n【镜头2】3-6秒：B。\n6-8秒：尾行。",
    "【镜头1】0-3秒：A。\n【镜头2】3-6秒：B。\n6-8秒：C。\n【镜头3】8-9秒：越界。\n【镜头4】9-10秒：越界。",
  ];
  for (const visualPrompt of invalid) {
    assert.throws(
      () => canonicalizeSemanticPlan(boundaryPlan([8], visualPrompt), bundle),
      (error) => error instanceof SemanticDirectorCanonicalizationError
        && error.code === "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
      visualPrompt,
    );
  }
});
