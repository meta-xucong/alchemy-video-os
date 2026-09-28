import { createHash } from "node:crypto";

import {
  type CanonicalSourceBundle,
  type RawSemanticPlan,
  RawSemanticPlanSchema,
  type SemanticDirectorDecision,
  SemanticDirectorDecisionSchema,
} from "@alchemy-video/contracts";
import { extractDialogueLines } from "@alchemy-video/creative-planning/semantic-director";

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
    evidence_id: evidenceId("REFERENCE_ASSET", assetId),
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

export class SemanticDirectorCanonicalizationError extends Error {
  constructor(
    readonly code: SemanticDirectorCanonicalizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SemanticDirectorCanonicalizationError";
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

  const shortTarget = bundle.target_duration_seconds < 8;
  // Huobao's normal storyboard paragraph is 8–15 seconds.  The platform's
  // explicit compatibility rule keeps a target below eight seconds as one
  // exact Provider segment, but it cannot override the selected capability's
  // own declared request bounds.
  const capabilityMinimum = bundle.provider_capability.min_duration_seconds;
  const capabilityMaximum = bundle.provider_capability.max_duration_seconds;
  const minimum = shortTarget
    ? capabilityMinimum
    : Math.max(8, capabilityMinimum);
  const maximum = Math.min(15, capabilityMaximum);

  if (minimum > maximum
    || (shortTarget
      && (bundle.target_duration_seconds < capabilityMinimum
        || bundle.target_duration_seconds > capabilityMaximum))) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_DURATION_INVALID",
      "The requested duration is outside the selected Provider capability and source storyboard boundary.",
    );
  }

  if (shortTarget
    && (decision.segments.length !== 1
      || decision.segments[0]?.duration_seconds !== bundle.target_duration_seconds)) {
    throw new SemanticDirectorCanonicalizationError(
      "CANONICALIZATION_SEGMENT_COUNT_INVALID",
      "A target below eight seconds must remain one exact Provider segment.",
    );
  }

  const dialogueById = new Map(decision.dialogues.map((dialogue) => [dialogue.dialogue_id, dialogue]));
  for (const segment of decision.segments) {
    if (bundle.source_text.length > 0 && segment.visual_decision.includes(bundle.source_text)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
        "A segment visual prompt must not copy the complete frozen story source.",
      );
    }
    for (const dialogue of decision.dialogues) {
      if (!segment.dialogue_ids.includes(dialogue.dialogue_id)
        && dialogue.exact_text.length > 0
        && segment.visual_decision.includes(dialogue.exact_text)) {
        throw new SemanticDirectorCanonicalizationError(
          "CANONICALIZATION_SEGMENT_SOURCE_SCOPE_INVALID",
          "A segment visual prompt must not copy dialogue owned by another segment.",
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

    const shotMarkers = [...segment.visual_decision.matchAll(/【镜头\s*\d+】/gu)];
    if (shotMarkers.length > 0 && (shotMarkers.length < 2 || shotMarkers.length > 4)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
        "A storyboard paragraph may contain two to four in-segment sub-shots.",
      );
    }

    // The source prompt uses three-second timeline rows only as instructions
    // inside this segment. When present, their ranges must describe valid
    // 2–6 second sub-shots and cannot create additional Provider tasks.
    const ranges = [...segment.visual_decision.matchAll(/(\d+)\s*-\s*(\d+)\s*秒/gu)]
      .map((match) => Number(match[2]) - Number(match[1]));
    if (ranges.some((seconds) => seconds < 2 || seconds > 6)) {
      throw new SemanticDirectorCanonicalizationError(
        "CANONICALIZATION_SEGMENT_SUBSHOT_INVALID",
        "Each in-segment sub-shot must remain between two and six seconds.",
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
    target_duration_seconds: bundle.target_duration_seconds,
    execution_status: raw.execution_status,
    dialogues,
    reference_usages: bundle.references.map((asset) => ({
      asset_id: asset.asset_id,
      provider_role: canonicalReferenceRole(asset),
      usage: asset.user_declared_usage ?? "canonical reference asset",
      evidence_refs: [referenceEvidence(bundle, asset.asset_id)!],
    })),
    segments: raw.segments.map((segment, index) => ({
      segment_id: `seg_${sha256(segment.segment_id).slice(0, 24)}`,
      sequence: index + 1,
      duration_seconds: segment.duration_seconds,
      visual_decision: segment.visual_prompt,
      evidence_refs: [
        ...segment.reference_asset_ids
          .map((assetId) => referenceEvidence(bundle, assetId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined),
        ...decisionEvidenceRefs,
      ],
      dialogue_ids: segment.dialogue_line_ids
        .map((id) => dialogues.find((item) => item.dialogue_id === `dlg_${sha256(id).slice(0, 24)}`)?.dialogue_id)
        .filter((item): item is string => Boolean(item)),
      reference_asset_ids: segment.reference_asset_ids,
    })),
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
