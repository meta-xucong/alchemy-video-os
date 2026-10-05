import { createHash } from "node:crypto";

import {
  type CanonicalSourceBundle,
  type RawSemanticPlan,
  RawSemanticPlanSchema,
  type SemanticDirectorDecision,
  SemanticDirectorDecisionSchema,
  parseG02ApprovedBeatMarkers,
  findExactEntityAnchor,
  hasExactEntityNameMention,
  isExactEntityAnchorAt,
} from "@alchemy-video/contracts";
import { extractDialogueLines, normalizeLocation, normalizeName, semanticValueHash } from "@alchemy-video/creative-planning/semantic-director";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const evidenceId = (kind: string, value: unknown) =>
  `evd_${sha256(`${kind}:${JSON.stringify(value)}`).slice(0, 24)}`;

const sourceEvidence = (
  bundle: CanonicalSourceBundle,
  quote: string,
  sourceOffset: number,
) => {
  if (sourceOffset < 0 || bundle.source_text.slice(sourceOffset, sourceOffset + quote.length) !== quote) {
    return undefined;
  }
  return {
    evidence_id: evidenceId("SOURCE_TEXT", { start: sourceOffset, quote }),
    kind: "SOURCE_TEXT" as const,
    source_hash: bundle.source_hash,
    span: {
      start: sourceOffset,
      end: sourceOffset + quote.length,
      quote,
    },
  };
};

const referenceEvidence = (bundle: CanonicalSourceBundle, assetId: string) => {
  const asset = bundle.references.find((item) => item.asset_id === assetId);
  if (!asset) return undefined;
  return {
    evidence_id: evidenceId("REFERENCE_ASSET", bundle.semantic_narrative_beat_lineage
      ? { brief_revision_id: bundle.brief_revision_id, asset_id: assetId }
      : assetId),
    kind: "REFERENCE_ASSET" as const,
    asset_id: asset.asset_id,
    asset_sha256: asset.asset_sha256,
    ...(asset.user_declared_usage
      ? { user_declared_usage: asset.user_declared_usage }
      : {}),
    ...(asset.objective_description
      ? { observation: asset.objective_description }
      : {}),
  };
};

const sourceLines = (text: string) => {
  const lines: Array<{ quote: string; start: number; end: number }> = [];
  let offset = 0;
  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)) {
    const rawLine = match[0];
    if (!rawLine) continue;
    const quote = rawLine.replace(/(?:\r\n|\n|\r)$/u, "");
    if (quote) lines.push({ quote, start: offset, end: offset + quote.length });
    offset += rawLine.length;
  }
  return lines;
};

const isG02Source = (bundle: CanonicalSourceBundle) => {
  try {
    return parseG02ApprovedBeatMarkers(bundle.source_text) !== undefined;
  } catch {
    return true;
  }
};

const resolveCandidateEvidence = (bundle: CanonicalSourceBundle, ref: string) => {
  const resolved = [
    ...sourceLines(bundle.source_text)
      .filter((line) => line.quote === ref)
      .map((line) => sourceEvidence(bundle, line.quote, line.start))
      .filter((item): item is NonNullable<typeof item> => item !== undefined),
    ...bundle.user_decisions
      .filter((decision) => typeof decision.value === "string" && decision.value === ref)
      .map((decision) => userDecisionEvidence(bundle).find((item) => item.decision_id === decision.decision_id)),
    ...bundle.references
      .filter((reference) => reference.user_declared_usage === ref)
      .map((reference) => referenceEvidence(bundle, reference.asset_id)),
  ].filter((item): item is NonNullable<typeof item> => item !== undefined);
  return resolved.length === 1 ? resolved[0] : undefined;
};

const candidateEvidenceSupportsName = (bundle: CanonicalSourceBundle, ref: string, exactName: string) => {
  const evidence = resolveCandidateEvidence(bundle, ref);
  if (evidence?.kind === "SOURCE_TEXT") return hasExactEntityNameMention(evidence.span.quote, exactName);
  if (evidence?.kind === "REFERENCE_ASSET") return hasExactEntityNameMention(evidence.user_declared_usage ?? "", exactName);
  if (evidence?.kind === "USER_DECISION") {
    const decision = bundle.user_decisions.find((item) => item.decision_id === evidence.decision_id);
    return typeof decision?.value === "string" && hasExactEntityNameMention(decision.value, exactName);
  }
  return false;
};

const boundCandidateKeysForSegment = (segment: RawSemanticPlan["segments"][number]) => [
  ...(segment.scene_candidate_key ? [segment.scene_candidate_key] : []),
  ...(segment.character_candidate_keys ?? []),
  ...(segment.prop_candidate_keys ?? []),
];

const isCanonicalReferenceSubsequence = (
  assetIds: string[],
  references: CanonicalSourceBundle["references"],
) => {
  let previousPosition = -1;
  for (const assetId of assetIds) {
    const position = references.findIndex((reference) => reference.asset_id === assetId);
    if (position <= previousPosition) return false;
    previousPosition = position;
  }
  return true;
};

const validateG02Timeline = (visualPrompt: string, durationSeconds: number, required: boolean) => {
  const lines = visualPrompt.split(/\r\n|\n|\r/u);
  const marker = /^【镜头([1-9]\d*)】(.*)$/u;
  const timelineRow = /^(\d+)-(\d+)秒：(.+)$/u;
  if (/【镜头[^】]*】/u.test(visualPrompt) && !visualPrompt.match(/【镜头[1-9]\d*】/gu)) return undefined;
  const groups: Array<{ marker: number; rows: Array<{ start: number; end: number }> }> = [];
  let activeGroup: (typeof groups)[number] | undefined;
  let previousEnd = 0;
  let sawTimeline = false;

  for (const line of lines) {
    const markerMatch = marker.exec(line);
    const rowText = markerMatch?.[2] ?? line;
    if (markerMatch) {
      if (activeGroup && activeGroup.rows.length === 0) return undefined;
      activeGroup = { marker: Number(markerMatch[1]), rows: [] };
      groups.push(activeGroup);
    }
    const rowMatch = timelineRow.exec(rowText);
    if (!rowMatch) {
      if (markerMatch || required || groups.length > 0) return undefined;
      continue;
    }
    if (!activeGroup) {
      if (required || groups.length > 0) return undefined;
      continue;
    }
    const start = Number(rowMatch[1]);
    const end = Number(rowMatch[2]);
    if (start !== previousEnd || end <= start || end > durationSeconds) return undefined;
    const rowDuration = end - start;
    if (end !== durationSeconds && rowDuration !== 3) return undefined;
    if (end === durationSeconds && (rowDuration < 1 || rowDuration > 3)) return undefined;
    activeGroup.rows.push({ start, end });
    previousEnd = end;
    sawTimeline = true;
  }

  if (!required && groups.length === 0 && !sawTimeline) return { providerPrompt: visualPrompt };
  if (!sawTimeline || groups.length < 2 || groups.length > 4 || previousEnd !== durationSeconds) return undefined;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (group.marker !== index + 1 || group.rows.length < 1 || group.rows.length > 2) return undefined;
    const groupDuration = group.rows[group.rows.length - 1]!.end - group.rows[0]!.start;
    if (groupDuration < 2 || groupDuration > 6) return undefined;
  }
  return { providerPrompt: visualPrompt.replace(/^【镜头[1-9]\d*】/gmu, "") };
};

const promptCandidateMentions = (prompt: string, candidates: RawSemanticPlan["entity_candidates"]) => {
  const mentions: string[] = [];
  const candidateNames = candidates ?? [];
  let cursor = 0;
  while (cursor < prompt.length) {
    const at = prompt.indexOf("@", cursor);
    if (at < 0) break;
    const matches = candidateNames
      .map((candidate) => candidate.exact_name)
      .filter((name) => isExactEntityAnchorAt(prompt, at, name));
    if (matches.length === 0) return undefined;
    const longest = Math.max(...matches.map((name) => name.length));
    const names = [...new Set(matches.filter((name) => name.length === longest))];
    if (names.length !== 1) return undefined;
    if (candidateNames.filter((candidate) => candidate.exact_name === names[0]).length !== 1) return undefined;
    mentions.push(names[0]!);
    cursor = at + 1 + longest;
  }
  return mentions;
};

const dialogueByLineId = (bundle: CanonicalSourceBundle, id: string) => {
  const match = /^line-(\d+)$/.exec(id);
  if (!match) return undefined;
  const sourceLine = Number(match[1]);
  const sourceDialogue = extractDialogueLines(bundle.source_text)
    .filter((dialogue) => dialogue.source_line === sourceLine);
  return sourceDialogue.length === 1 ? sourceDialogue[0] : undefined;
};

export type SemanticDirectorCanonicalizationErrorCode =
  | "CANONICALIZATION_REFERENCE_ROLE_MISSING"
  | "CANONICALIZATION_DIALOGUE_ID_INVALID"
  | "CANONICALIZATION_SEGMENT_DURATION_INVALID"
  | "CANONICALIZATION_SEGMENT_COUNT_INVALID"
  | "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID"
  | "CANONICALIZATION_DIALOGUE_CAPACITY_INVALID"
  | "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID";

type SemanticDirectorDiagnosticIssueCode =
  | "G02_SOURCE_MARKERS_INVALID"
  | "G02_SOURCE_LINEAGE_MISSING"
  | "G02_SEGMENT_BEAT_MAPPING_INVALID"
  | "G02_LINEAGE_BINDING_INVALID"
  | "G02_ENTITY_CANDIDATES_EMPTY"
  | "G02_CANDIDATE_KEYS_DUPLICATE"
  | "G02_CANDIDATE_IDENTITY_INVALID"
  | "G02_SCENE_NAME_LOCATION_MISMATCH"
  | "G02_CANDIDATE_EVIDENCE_UNSUPPORTED"
  | "G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS"
  | "G02_REFERENCE_USAGE_MISSING"
  | "G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH"
  | "G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE"
  | "G02_REFERENCE_USAGE_NOT_REFERENCE_ASSET"
  | "G02_SEGMENT_BINDING_DUPLICATE"
  | "G02_REFERENCE_ORDER_INVALID"
  | "G02_REFERENCE_ENTITY_MAPPING_INVALID"
  | "G02_SEGMENT_CANDIDATE_BINDING_INVALID"
  | "G02_PROMPT_ENTITY_MENTION_UNBOUND"
  | "G02_BEAT_ENTITY_BINDING_INCOMPLETE"
  | "G02_CANDIDATE_UNUSED"
  | "SEGMENT_VISUAL_PROMPT_COPIES_SOURCE"
  | "SEGMENT_VISUAL_PROMPT_COPIES_UNASSIGNED_DIALOGUE";

export class SemanticDirectorCanonicalizationError extends Error {
  readonly issues: ReadonlyArray<Readonly<{ code: SemanticDirectorDiagnosticIssueCode }>> | undefined;

  constructor(
    readonly code: SemanticDirectorCanonicalizationErrorCode,
    message: string,
    diagnosticCodes?: SemanticDirectorDiagnosticIssueCode | readonly SemanticDirectorDiagnosticIssueCode[],
  ) {
    super(message);
    this.name = "SemanticDirectorCanonicalizationError";
    const codes = typeof diagnosticCodes === "string" ? [diagnosticCodes] : diagnosticCodes;
    this.issues = codes?.map((code) => ({ code }));
  }
}

const userDecisionEvidence = (bundle: CanonicalSourceBundle) => bundle.user_decisions.map((decision) => ({
  evidence_id: evidenceId("USER_DECISION", {
    decision_id: decision.decision_id,
    field: decision.field,
    value_hash: decision.value_hash,
  }),
  kind: "USER_DECISION" as const,
  decision_id: decision.decision_id,
  field: decision.field,
  value_hash: decision.value_hash,
}));

const canonicalReferenceRole = (asset: CanonicalSourceBundle["references"][number]) => {
  if (!asset.provider_role) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_REFERENCE_ROLE_MISSING",
      `Reference asset ${asset.asset_id} has no frozen provider role.`,
    );
  }
  return asset.provider_role;
};

const validateG02NarrativePlan = (raw: RawSemanticPlan, bundle: CanonicalSourceBundle) => {
  const lineage = bundle.semantic_narrative_beat_lineage;
  let markers: ReturnType<typeof parseG02ApprovedBeatMarkers>;
  try {
    markers = parseG02ApprovedBeatMarkers(bundle.source_text);
  } catch {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 Brief source markers must be exact, complete, and ordered before a plan can be accepted.",
      "G02_SOURCE_MARKERS_INVALID",
    );
  }
  const markerSource = markers !== undefined;
  if (!markerSource && !lineage) return new Map();
  if (!markerSource || !lineage) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 source markers and server-derived beat lineage must be present together.",
      "G02_SOURCE_LINEAGE_MISSING",
    );
  }
  const candidates = raw.entity_candidates ?? [];
  if (raw.segments.length !== 3
    || raw.segments.some((segment, index) => JSON.stringify(segment.source_narrative_beat_sequences) !== JSON.stringify([index + 1]))) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_COUNT_INVALID",
      "G02 requires the three frozen source beats to map one-to-one to three ordered Provider segments.",
      "G02_SEGMENT_BEAT_MAPPING_INVALID",
    );
  }
  if (bundle.brief_revision_id !== lineage.brief_revision_id
    || lineage.source_hash !== bundle.source_hash
    || bundle.source_hash !== sha256(bundle.source_text)
    || lineage.beats.length !== 3
    || markers?.length !== 3
    || lineage.beats.some((beat, index) => {
      const sourceMarker = markers?.[index];
      return !sourceMarker
        || beat.sequence !== sourceMarker.sequence
        || beat.span.start !== sourceMarker.span.start
        || beat.span.end !== sourceMarker.span.end
        || beat.span.quote !== sourceMarker.span.quote
        || beat.exact_quote_sha256 !== sha256(sourceMarker.span.quote)
        || beat.identity_sha256 !== semanticValueHash({
          brief_revision_id: bundle.brief_revision_id,
          sequence: sourceMarker.sequence,
          exact_quote_sha256: sha256(sourceMarker.span.quote),
        });
    })
    || bundle.target_duration_seconds !== 30) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 beat lineage is not bound to the frozen Brief revision and source hash.",
      "G02_LINEAGE_BINDING_INVALID",
    );
  }
  if (candidates.length === 0) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 requires source-backed visual entity candidates before planning can proceed.",
      "G02_ENTITY_CANDIDATES_EMPTY",
    );
  }
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.candidate_key, candidate]));
  const identityKeys = candidates.map((candidate) => candidate.kind === "SCENE"
    ? JSON.stringify([normalizeLocation(candidate.location ?? ""), candidate.time || ""])
    : normalizeName(candidate.exact_name));
  if (candidateByKey.size !== candidates.length) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 entity candidate keys must be unique.",
      "G02_CANDIDATE_KEYS_DUPLICATE",
    );
  }
  if (identityKeys.some((identity) => !identity)
    || new Set(candidates.map((candidate, index) => `${candidate.kind}\u0000${identityKeys[index]}`)).size !== candidates.length) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 candidate identities must use the fixed source exact-normalization keys without aliases or duplicate claims.",
      "G02_CANDIDATE_IDENTITY_INVALID",
    );
  }
  const canonicalNamesByCandidateKey = new Map<string, string>();
  const usedCandidateKeys = new Set<string>();
  for (const [candidateIndex, candidate] of candidates.entries()) {
    if (candidate.kind === "SCENE" && candidate.exact_name !== candidate.location) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 scene exact_name must exactly equal its frozen location field.",
        "G02_SCENE_NAME_LOCATION_MISMATCH",
      );
    }
    if (candidate.reference_asset_ids.length === 0
      || new Set(candidate.reference_asset_ids).size !== candidate.reference_asset_ids.length
      || candidate.reference_asset_ids.some((assetId) => !bundle.references.some((reference) => reference.asset_id === assetId))
      || new Set(candidate.source_evidence_refs).size !== candidate.source_evidence_refs.length
      || candidate.source_evidence_refs.some((ref) => !resolveCandidateEvidence(bundle, ref))
      || !candidate.source_evidence_refs.some((ref) => candidateEvidenceSupportsName(bundle, ref, candidate.exact_name))) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        `G02 candidate evidence must exactly resolve to frozen source, user-decision, or approved reference evidence and support its exact name (${candidate.candidate_key}).`,
        "G02_CANDIDATE_EVIDENCE_UNSUPPORTED",
      );
    }
    const matchingEntities = (bundle.visual_entities ?? []).filter((entity) => entity.entity_kind === candidate.kind
      && entity.normalized_identity === identityKeys[candidateIndex]);
    if (matchingEntities.length > 1
      || (matchingEntities.length === 1
        && (bundle.visual_entities ?? []).filter((entity) => entity.exact_name === matchingEntities[0]!.exact_name).length > 1)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 candidate identity or canonical anchor resolves to multiple frozen project entities.",
        "G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS",
      );
    }
    const existing = matchingEntities[0];
    canonicalNamesByCandidateKey.set(candidate.candidate_key, existing?.exact_name ?? candidate.exact_name);
    for (const assetId of candidate.reference_asset_ids) {
      const reference = bundle.references.find((item) => item.asset_id === assetId)!;
      const diagnosticCodes: SemanticDirectorDiagnosticIssueCode[] = [];
      const usage = reference.user_declared_usage;
      if (!usage) {
        diagnosticCodes.push("G02_REFERENCE_USAGE_MISSING");
      } else {
        if (!hasExactEntityNameMention(usage, candidate.exact_name)) {
          diagnosticCodes.push("G02_REFERENCE_USAGE_ENTITY_NAME_MISMATCH");
        }
        if (!candidate.source_evidence_refs.includes(usage)) {
          diagnosticCodes.push("G02_REFERENCE_USAGE_NOT_IN_CANDIDATE_EVIDENCE");
        }
        if (resolveCandidateEvidence(bundle, usage)?.kind !== "REFERENCE_ASSET") {
          diagnosticCodes.push("G02_REFERENCE_USAGE_NOT_REFERENCE_ASSET");
        }
      }
      if (diagnosticCodes.length > 0) {
        throw new SemanticDirectorCanonicalizationError(
          "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
          "G02 entity-to-image mapping requires the frozen Brief's exact entity-specific usage evidence.",
          [...new Set(diagnosticCodes)],
        );
      }
    }
  }
  for (const segment of raw.segments) {
    const keys = boundCandidateKeysForSegment(segment);
    if (new Set(keys).size !== keys.length) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 segment entity bindings must not contain duplicate candidate keys.",
        "G02_SEGMENT_BINDING_DUPLICATE",
      );
    }
    if (!isCanonicalReferenceSubsequence(segment.reference_asset_ids, bundle.references)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 Provider reference images must remain an ordered subsequence of the frozen Brief reference order.",
        "G02_REFERENCE_ORDER_INVALID",
      );
    }
    const mappedAssets = keys.flatMap((key) => candidateByKey.get(key)?.reference_asset_ids ?? []);
    if (mappedAssets.length !== segment.reference_asset_ids.length
      || new Set(mappedAssets).size !== mappedAssets.length
      || segment.reference_asset_ids.some((assetId) => !mappedAssets.includes(assetId))) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "Every G02 Provider image position must map to exactly one bound logical entity, with no unmapped or duplicate asset.",
        "G02_REFERENCE_ENTITY_MAPPING_INVALID",
      );
    }
    for (const key of keys) {
      const candidate = candidateByKey.get(key);
      if (!candidate
        || (key === segment.scene_candidate_key && candidate.kind !== "SCENE")
        || ((segment.character_candidate_keys ?? []).includes(key) && candidate.kind !== "CHARACTER")
        || ((segment.prop_candidate_keys ?? []).includes(key) && candidate.kind !== "PROP")
        || findExactEntityAnchor(segment.visual_prompt, candidate.exact_name) < 0
        || candidate.reference_asset_ids.some((assetId) => !segment.reference_asset_ids.includes(assetId))) {
        throw new SemanticDirectorCanonicalizationError(
          "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
          "G02 segment bindings must resolve to a candidate of the matching entity kind.",
          "G02_SEGMENT_CANDIDATE_BINDING_INVALID",
        );
      }
      usedCandidateKeys.add(key);
    }
    const mentions = promptCandidateMentions(segment.visual_prompt, candidates);
    if (!mentions || mentions.some((name) => {
      const matchingCandidates = candidates.filter((item) => item.exact_name === name);
      return matchingCandidates.length !== 1 || !keys.includes(matchingCandidates[0]!.candidate_key);
    })) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "Every exact @entity mention in a G02 prompt must resolve to a bound candidate with an approved image mapping.",
      "G02_PROMPT_ENTITY_MENTION_UNBOUND",
      );
    }
    const beatSequence = segment.source_narrative_beat_sequences?.[0];
    const sourceBeat = lineage.beats.find((beat) => beat.sequence === beatSequence);
    const beatScopedCandidateKeys = candidates.filter((candidate) =>
      candidate.source_evidence_refs.includes(sourceBeat?.span.quote ?? ""))
      .map((candidate) => candidate.candidate_key);
    if (beatScopedCandidateKeys.some((key) => !keys.includes(key))) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "Every candidate with exact evidence in a source beat must be explicitly bound in that beat's segment.",
        "G02_BEAT_ENTITY_BINDING_INCOMPLETE",
      );
    }
  }
  if (usedCandidateKeys.size !== candidates.length) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
      "G02 entity candidates must be used by a frozen source beat segment.",
      "G02_CANDIDATE_UNUSED",
    );
  }
  return canonicalNamesByCandidateKey;
};

const canonicalizeCandidateAnchors = (
  prompt: string,
  candidates: RawSemanticPlan["entity_candidates"],
  canonicalNamesByCandidateKey: ReadonlyMap<string, string>,
) => {
  if (!candidates?.length) return prompt;
  let result = "";
  let cursor = 0;
  const emittedAnchorOwners = new Map<string, string>();
  for (let at = prompt.indexOf("@"); at >= 0; at = prompt.indexOf("@", cursor)) {
    const matches = candidates
      .filter((candidate) => isExactEntityAnchorAt(prompt, at, candidate.exact_name))
      .sort((left, right) => right.exact_name.length - left.exact_name.length);
    if (matches.length === 0) {
      cursor = at + 1;
      continue;
    }
    const candidate = matches[0]!;
    const canonicalName = canonicalNamesByCandidateKey.get(candidate.candidate_key);
    if (!canonicalName) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 candidate anchor has no unique frozen canonical identity.",
        "G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS",
      );
    }
    if (matches.filter((item) => item.exact_name.length === candidate.exact_name.length).length !== 1) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 candidate anchor resolves to multiple frozen candidate identities.",
        "G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS",
      );
    }
    const previousOwner = emittedAnchorOwners.get(canonicalName);
    if (previousOwner && previousOwner !== candidate.candidate_key) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "G02 canonicalized prompt anchor resolves to multiple candidate identities.",
        "G02_CANONICAL_ENTITY_IDENTITY_AMBIGUOUS",
      );
    }
    emittedAnchorOwners.set(canonicalName, candidate.candidate_key);
    const candidateIndexEnd = at + 1 + candidate.exact_name.length;
    if (candidate.exact_name !== canonicalName) {
      result += prompt.slice(cursor, at + 1) + canonicalName;
    } else {
      result += prompt.slice(cursor, candidateIndexEnd);
    }
    cursor = candidateIndexEnd;
  }
  return result + prompt.slice(cursor);
};

/**
 * Huobao's storyboard paragraph is the Provider task boundary.  This is kept
 * beside canonicalization so certification and production cannot drift into
 * separate duration or sub-shot gates.
 */
export const validateSemanticSegmentBoundaries = (
  decision: SemanticDirectorDecision,
  bundle: CanonicalSourceBundle,
) => {
  if (decision.execution_status !== "READY") return decision;

  const capabilityMinimum = bundle.provider_capability.min_duration_seconds;
  const capabilityMaximum = bundle.provider_capability.max_duration_seconds;
  const minimum = Math.max(8, capabilityMinimum);
  const maximum = Math.min(15, capabilityMaximum);

  if (minimum > maximum || bundle.target_duration_seconds < minimum) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_DURATION_INVALID",
      "The requested duration is outside the selected Provider capability and source storyboard boundary.",
    );
  }

  const dialogueById = new Map(decision.dialogues.map((dialogue) => [dialogue.dialogue_id, dialogue]));
  for (const segment of decision.segments) {
    if (bundle.source_text.length > 0 && segment.visual_decision.includes(bundle.source_text)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "A segment visual prompt must not copy the complete frozen story source.",
        "SEGMENT_VISUAL_PROMPT_COPIES_SOURCE",
      );
    }
    for (const dialogue of decision.dialogues) {
      if (!segment.dialogue_ids.includes(dialogue.dialogue_id)
        && dialogue.exact_text.length > 0
        && segment.visual_decision.includes(dialogue.exact_text)) {
        throw new SemanticDirectorCanonicalizationError(
          "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
          "A segment visual prompt must not copy dialogue owned by another segment.",
          "SEGMENT_VISUAL_PROMPT_COPIES_UNASSIGNED_DIALOGUE",
        );
      }
    }
    if (segment.duration_seconds < minimum || segment.duration_seconds > maximum) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_DURATION_INVALID",
        "A Provider segment must stay within the source storyboard duration boundary.",
      );
    }

    const dialogueCharacters = segment.dialogue_ids.reduce((total, id) =>
      total + (dialogueById.get(id)?.exact_text.length ?? 0), 0);
    if (dialogueCharacters > 0 && segment.duration_seconds < dialogueCharacters / 4.5 + 2) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_DIALOGUE_CAPACITY_INVALID",
        "The segment duration cannot carry its source dialogue within the storyboard capacity rule.",
      );
    }

    if (segment.visual_decision.includes("【镜头")) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
        "Internal shot markers must be removed before a Provider-facing prompt is accepted.",
      );
    }
  }
  return decision;
};

export const canonicalizeSemanticPlan = (
  rawInput: unknown,
  bundle: CanonicalSourceBundle,
): SemanticDirectorDecision => {
  const raw = RawSemanticPlanSchema.parse(rawInput) as RawSemanticPlan;
  const isG02 = isG02Source(bundle);
  const canonicalNamesByCandidateKey = validateG02NarrativePlan(raw, bundle);
  const providerPrompts = raw.segments.map((segment) => {
    const timeline = validateG02Timeline(segment.visual_prompt, segment.duration_seconds, isG02);
    if (!timeline) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
        "Timeline rows and internal shot markers must exactly cover the segment and satisfy source ordering, granularity, and marker mapping rules.",
      );
    }
    return isG02
      ? canonicalizeCandidateAnchors(timeline.providerPrompt, raw.entity_candidates, canonicalNamesByCandidateKey)
      : timeline.providerPrompt;
  });
  const decisionEvidenceRefs = userDecisionEvidence(bundle);

  const dialogues = raw.segments.flatMap((segment) =>
    segment.dialogue_line_ids.flatMap((lineId) => {
      const dialogue = dialogueByLineId(bundle, lineId);
      const evidence = dialogue
        ? sourceEvidence(bundle, dialogue.text, dialogue.source_offset)
        : undefined;
      if (!dialogue || !evidence) {
        throw new SemanticDirectorCanonicalizationError(
          "CANONICALIZATION_DIALOGUE_ID_INVALID",
          `Raw semantic plan references an unresolved dialogue line: ${lineId}.`,
        );
      }
      return [{
        dialogue_id: `dlg_${sha256(lineId).slice(0, 24)}`,
        exact_text: dialogue.text,
        evidence,
      }];
    }));

  const decision: SemanticDirectorDecision = {
    version: 1,
    source_hash: bundle.source_hash,
    ...(bundle.semantic_narrative_beat_lineage
      ? { semantic_narrative_beat_lineage: bundle.semantic_narrative_beat_lineage }
      : {}),
    target_duration_seconds: bundle.target_duration_seconds,
    execution_status: raw.execution_status,
    ...(raw.entity_candidates ? { entity_candidates: raw.entity_candidates } : {}),
    dialogues,
    reference_usages: bundle.references.map((asset) => ({
      asset_id: asset.asset_id,
      provider_role: canonicalReferenceRole(asset),
      usage: asset.user_declared_usage ?? "canonical reference asset",
      evidence_refs: [referenceEvidence(bundle, asset.asset_id)!],
    })),
    segments: raw.segments.map((segment, index) => {
      const beatSequence = segment.source_narrative_beat_sequences?.[0];
      const sourceBeat = beatSequence === undefined
        ? undefined
        : bundle.semantic_narrative_beat_lineage?.beats.find((item) => item.sequence === beatSequence);
      const beatEvidence = sourceBeat
        ? sourceEvidence(bundle, sourceBeat.span.quote, sourceBeat.span.start)
        : undefined;
      return {
        segment_id: `seg_${sha256(segment.segment_id).slice(0, 24)}`,
        sequence: index + 1,
        duration_seconds: segment.duration_seconds,
        visual_decision: providerPrompts[index]!,
        evidence_refs: [
          ...(beatEvidence ? [beatEvidence] : []),
          ...segment.reference_asset_ids
            .map((assetId) => referenceEvidence(bundle, assetId))
            .filter((item): item is NonNullable<typeof item> => item !== undefined),
          ...decisionEvidenceRefs,
        ],
        dialogue_ids: segment.dialogue_line_ids
          .map((id) => dialogues.find((item) => item.dialogue_id === `dlg_${sha256(id).slice(0, 24)}`)?.dialogue_id)
          .filter((item): item is string => Boolean(item)),
        reference_asset_ids: segment.reference_asset_ids,
        ...(segment.source_narrative_beat_sequences
          ? { source_narrative_beat_sequences: segment.source_narrative_beat_sequences }
          : {}),
        ...(segment.scene_candidate_key ? { scene_candidate_key: segment.scene_candidate_key } : {}),
        ...(segment.character_candidate_keys ? { character_candidate_keys: segment.character_candidate_keys } : {}),
        ...(segment.prop_candidate_keys ? { prop_candidate_keys: segment.prop_candidate_keys } : {}),
      };
    }),
    unresolved_items: raw.unresolved_items.map((item) => ({
      unresolved_id: `unr_${sha256(item).slice(0, 24)}`,
      question: item,
      blocking: raw.execution_status === "BLOCKED",
      evidence_refs: [],
    })),
  };

  const parsedDecision = SemanticDirectorDecisionSchema.parse(decision);
  return validateSemanticSegmentBoundaries(parsedDecision, bundle);
};
