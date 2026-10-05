import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  AssetIdSchema,
  DocumentConversionIdSchema,
  DocumentIdSchema,
  Sha256Schema,
} from "./primitives.js";
import { VideoAudioOwnerSchema, type VideoAudioOwner } from "./resources.js";

const internalId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,95}$`));

export const SemanticEvidenceIdSchema = internalId("evd");
export const SemanticDialogueIdSchema = internalId("dlg");
export const SemanticSegmentIdSchema = internalId("seg");
export const SemanticDecisionIdSchema = internalId("dec");
export const SemanticUnresolvedItemIdSchema = internalId("unr");
export const SemanticVisualEntityCandidateKeySchema = z.string().regex(/^entity-[A-Za-z0-9_-]{1,95}$/);
export const SemanticVisualEntityKindSchema = z.enum(["CHARACTER", "SCENE", "PROP"]);

const SemanticNarrativeBeatIdentitySchema = z.object({
  sequence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  span: z.object({
    start: z.number().int().min(0).max(50_000),
    end: z.number().int().positive().max(50_000),
    quote: z.string().min(1).max(50_000),
  }).strict(),
  exact_quote_sha256: Sha256Schema,
  identity_sha256: Sha256Schema,
}).strict();

export const SemanticNarrativeBeatLineageSchema = z.object({
  version: z.literal(1),
  brief_revision_id: z.string().min(1).max(160),
  source_hash: Sha256Schema,
  beats: z.array(SemanticNarrativeBeatIdentitySchema).length(3),
}).strict().superRefine((value, context) => {
  value.beats.forEach((beat, index) => {
    if (beat.sequence !== index + 1 || beat.span.end <= beat.span.start) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["beats", index], message: "Narrative beats must be ordered, unique, and have a valid span." });
    }
  });
});

export const SemanticNarrativeBeatProjectionSchema = z.object({
  version: z.literal(1),
  brief_revision_id: z.string().min(1).max(160),
  source_hash: Sha256Schema,
  beat: SemanticNarrativeBeatIdentitySchema,
}).strict();

export const SemanticEntityReferenceProjectionSchema = z.object({
  version: z.literal(1),
  brief_revision_id: z.string().min(1).max(160),
  source_hash: Sha256Schema,
  decision_hash: Sha256Schema,
  segment_id: SemanticSegmentIdSchema,
  prompt_package_id: z.string().min(1).max(160),
  bindings: z.array(z.object({
    entity_kind: SemanticVisualEntityKindSchema,
    entity_id: z.string().min(1).max(160),
    entity_revision_id: z.string().min(1).max(160),
    exact_name: z.string().min(1).max(160),
    asset_id: AssetIdSchema,
    asset_sha256: Sha256Schema,
    provider_position: z.number().int().nonnegative().max(6),
    mapping_evidence_id: z.string().min(1).max(160),
  }).strict()).max(7),
}).strict().superRefine((value, context) => {
  const assets = value.bindings.map((binding) => binding.asset_id);
  const positions = value.bindings.map((binding) => binding.provider_position);
  if (new Set(assets).size !== assets.length || new Set(positions).size !== positions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["bindings"], message: "Each G02 asset and Provider image position must map to only one entity." });
  }
});

export const SemanticVisualEntityCandidateSchema = z.object({
  candidate_key: SemanticVisualEntityCandidateKeySchema,
  kind: SemanticVisualEntityKindSchema,
  exact_name: z.string().min(1).max(160),
  source_evidence_refs: z.array(z.string().min(1).max(5_000)).min(1).max(16),
  reference_asset_ids: z.array(AssetIdSchema).max(7),
  role: z.string().min(1).max(160).optional(),
  description: z.string().min(1).max(2_000).optional(),
  appearance: z.string().min(1).max(2_000).optional(),
  styling: z.string().min(1).max(2_000).optional(),
  location: z.string().min(1).max(500).optional(),
  time: z.string().min(1).max(160).optional(),
  prompt: z.string().min(1).max(2_000).optional(),
  lighting: z.string().min(1).max(500).optional(),
  type: z.string().min(1).max(160).optional(),
}).strict().superRefine((value, context) => {
  const allowedByKind = value.kind === "CHARACTER"
    ? ["role", "description", "appearance", "styling"]
    : value.kind === "SCENE"
      ? ["location", "time", "prompt", "description", "lighting"]
      : ["type", "description"];
  for (const key of ["role", "description", "appearance", "styling", "location", "time", "prompt", "lighting", "type"] as const) {
    if (Object.hasOwn(value, key) && !allowedByKind.includes(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Entity candidate field is not allowed for its kind." });
    }
  }
  if (value.kind === "SCENE" && !value.location) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "Scene candidates require a location." });
  }
});

export const SourceTextSpanSchema = z.object({
  start: z.number().int().min(0).max(50_000),
  end: z.number().int().positive().max(50_000),
  quote: z.string().min(1).max(50_000),
}).strict().superRefine((value, context) => {
  if (value.end <= value.start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Source span end must be greater than start." });
  }
});

export type G02ApprovedBeatMarker = Readonly<{
  sequence: 1 | 2 | 3;
  span: z.infer<typeof SourceTextSpanSchema>;
}>;

/**
 * Parse the sole accepted G02 authority from frozen Brief source text.
 * A marker-like token anywhere in a line claims G02 intent, so malformed,
 * duplicate, missing, or reordered marker rows fail closed instead of being
 * treated as an ordinary Brief. Offsets use JavaScript UTF-16 code units,
 * matching SourceTextSpan and the existing source-provenance contract.
 */
export const parseG02ApprovedBeatMarkers = (sourceText: string): readonly G02ApprovedBeatMarker[] | undefined => {
  if (!sourceText.includes("G02_APPROVED_BEAT_")) return undefined;

  const markers: G02ApprovedBeatMarker[] = [];
  let offset = 0;
  for (const match of sourceText.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/gu)) {
    const quote = match[1] ?? "";
    const lineEnding = match[2] ?? "";
    if (!quote && !lineEnding) break;
    if (quote.includes("G02_APPROVED_BEAT_")) {
      const marker = /^G02_APPROVED_BEAT_([1-3]):(.+)$/u.exec(quote);
      if (!marker || !marker[2]!.trim()) {
        throw new Error("G02 approved-beat markers must be exact, non-empty source lines.");
      }
      const sequence = Number(marker[1]);
      markers.push({
        sequence: sequence as 1 | 2 | 3,
        span: { start: offset, end: offset + quote.length, quote },
      });
    }
    offset += quote.length + lineEnding.length;
  }

  if (markers.length !== 3 || markers.some((marker, index) => marker.sequence !== index + 1)) {
    throw new Error("G02 Brief source must contain exactly three unique, ordered approved-beat marker lines.");
  }
  return markers;
};

const isAsciiEntityNameChar = (value: string | undefined) => value !== undefined && /^[A-Za-z0-9_]$/u.test(value);

export const hasExactEntityNameMention = (text: string, exactName: string) => {
  if (!exactName) return false;
  for (let index = text.indexOf(exactName); index >= 0; index = text.indexOf(exactName, index + 1)) {
    if (!(isAsciiEntityNameChar(exactName[0]) && isAsciiEntityNameChar(text[index - 1]))
      && !(isAsciiEntityNameChar(exactName.at(-1)) && isAsciiEntityNameChar(text[index + exactName.length]))) return true;
  }
  return false;
};

export const isExactEntityAnchorAt = (text: string, at: number, exactName: string) =>
  Boolean(exactName)
  && text[at] === "@"
  && text.startsWith(exactName, at + 1)
  && !(isAsciiEntityNameChar(exactName.at(-1)) && isAsciiEntityNameChar(text[at + 1 + exactName.length]));

export const findExactEntityAnchor = (text: string, exactName: string) => {
  if (!exactName) return -1;
  for (let at = text.indexOf("@"); at >= 0; at = text.indexOf("@", at + 1)) {
    if (isExactEntityAnchorAt(text, at, exactName)) return at;
  }
  return -1;
};

export const SourceTextEvidenceRefSchema = z.object({
  evidence_id: SemanticEvidenceIdSchema,
  kind: z.literal("SOURCE_TEXT"),
  source_hash: Sha256Schema,
  span: SourceTextSpanSchema,
}).strict();

export const DocumentEvidenceRefSchema = z.object({
  evidence_id: SemanticEvidenceIdSchema,
  kind: z.literal("DOCUMENT"),
  document_id: DocumentIdSchema,
  conversion_id: DocumentConversionIdSchema,
  markdown_sha256: Sha256Schema,
  content_sha256: Sha256Schema,
  locator: z.string().min(1).max(500),
  quote: z.string().min(1).max(5_000),
}).strict();

export const ReferenceAssetEvidenceRefSchema = z.object({
  evidence_id: SemanticEvidenceIdSchema,
  kind: z.literal("REFERENCE_ASSET"),
  asset_id: AssetIdSchema,
  asset_sha256: Sha256Schema,
  user_declared_usage: z.string().min(1).max(1_000).optional(),
  observation: z.string().min(1).max(2_000).optional(),
}).strict();

export const UserDecisionEvidenceRefSchema = z.object({
  evidence_id: SemanticEvidenceIdSchema,
  kind: z.literal("USER_DECISION"),
  decision_id: SemanticDecisionIdSchema,
  field: z.string().min(1).max(160),
  value_hash: Sha256Schema,
}).strict();

export const SemanticEvidenceRefSchema = z.discriminatedUnion("kind", [
  SourceTextEvidenceRefSchema,
  DocumentEvidenceRefSchema,
  ReferenceAssetEvidenceRefSchema,
  UserDecisionEvidenceRefSchema,
]);

export const CanonicalDocumentSourceSchema = z.object({
  document_id: DocumentIdSchema,
  conversion_id: DocumentConversionIdSchema,
  markdown_sha256: Sha256Schema,
  content_sha256: Sha256Schema,
  content: z.string().min(1).max(2_000_000),
}).strict();

export const CanonicalReferenceRoleSchema = z.enum(["SUBJECT", "SCENE", "STYLE"]);

export const CanonicalReferenceSourceSchema = z.object({
  asset_id: AssetIdSchema,
  asset_sha256: Sha256Schema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  position: z.number().int().min(0).max(6),
  provider_role: CanonicalReferenceRoleSchema.optional(),
  user_declared_usage: z.string().min(1).max(1_000).optional(),
  objective_description: z.string().min(1).max(5_000).optional(),
}).strict();

export const CanonicalVisualEntityContextSchema = z.object({
  entity_id: z.string().min(1).max(160),
  entity_kind: SemanticVisualEntityKindSchema,
  normalized_identity: z.string().min(1).max(1_000),
  revision_id: z.string().min(1).max(160),
  revision_number: z.number().int().positive(),
  content_hash: Sha256Schema,
  exact_name: z.string().min(1).max(160),
  role: z.string().optional(),
  description: z.string().optional(),
  appearance: z.string().optional(),
  styling: z.string().optional(),
  location: z.string().optional(),
  time: z.string().optional(),
  prompt: z.string().optional(),
  lighting: z.string().optional(),
  type: z.string().optional(),
}).strict();

export const CanonicalUserDecisionSchema = z.object({
  decision_id: SemanticDecisionIdSchema,
  field: z.string().min(1).max(160),
  value: z.unknown(),
  value_hash: Sha256Schema,
}).strict();

export const CanonicalProviderCapabilitySchema = z.object({
  profile_id: z.string().min(1).max(160),
  min_duration_seconds: z.number().int().positive().max(600),
  max_duration_seconds: z.number().int().positive().max(600),
  max_prompt_utf8_bytes: z.number().int().positive().max(1_000_000),
  max_reference_images: z.number().int().min(0).max(64),
  audio_owner: VideoAudioOwnerSchema,
}).strict().superRefine((value, context) => {
  if (value.max_duration_seconds < value.min_duration_seconds) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["max_duration_seconds"], message: "Provider duration bounds must be ordered." });
  }
});

export const CanonicalSourceBundleSchema = z.object({
  version: z.literal(1),
  brief_revision_id: z.string().min(1).max(160).optional(),
  source_text: z.string().min(1).max(50_000),
  source_hash: Sha256Schema,
  semantic_narrative_beat_lineage: SemanticNarrativeBeatLineageSchema.optional(),
  style_preferences: z.string().max(1_000),
  documents: z.array(CanonicalDocumentSourceSchema).max(4),
  references: z.array(CanonicalReferenceSourceSchema).max(7),
  visual_entities: z.array(CanonicalVisualEntityContextSchema).max(256).optional(),
  user_decisions: z.array(CanonicalUserDecisionSchema).max(64),
  provider_capability: CanonicalProviderCapabilitySchema,
  target_duration_seconds: z.number().int().positive().max(600),
}).strict().superRefine((value, context) => {
  const documentKeys = value.documents.map((item) => `${item.document_id}:${item.conversion_id}`);
  if (new Set(documentKeys).size !== documentKeys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["documents"], message: "Canonical document identities must be unique." });
  }
  const referenceIds = value.references.map((item) => item.asset_id);
  if (new Set(referenceIds).size !== referenceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["references"], message: "Canonical reference asset identities must be unique." });
  }
  value.references.forEach((reference, index) => {
    if (reference.position !== index) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["references", index, "position"], message: "Canonical reference positions must be contiguous and ordered." });
    }
  });
  const decisionIds = value.user_decisions.map((item) => item.decision_id);
  if (new Set(decisionIds).size !== decisionIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["user_decisions"], message: "Canonical user decision identities must be unique." });
  }
  if (value.style_preferences.trim()) {
    const styleDecisions = value.user_decisions.filter((item) => item.field === "style_preferences");
    if (styleDecisions.length !== 1 || styleDecisions[0]?.value !== value.style_preferences) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["style_preferences"],
        message: "Non-empty style preferences require one exact frozen user decision.",
      });
    }
  }
});

export const SemanticDialogueDecisionSchema = z.object({
  dialogue_id: SemanticDialogueIdSchema,
  exact_text: z.string().min(1).max(8_000),
  evidence: SourceTextEvidenceRefSchema,
}).strict();


export const SemanticDialogueProjectionSchema = z.object({
  version: z.literal(1),
  source_hash: Sha256Schema,
  decision_hash: Sha256Schema,
  segment_id: SemanticSegmentIdSchema,
  dialogues: z.array(z.object({
    dialogue_id: SemanticDialogueIdSchema,
    exact_text: z.string().min(1).max(8_000),
    evidence_id: SemanticEvidenceIdSchema,
    span: SourceTextSpanSchema,
  }).strict()).max(120),
}).strict().superRefine((value, context) => {
  const ids = value.dialogues.map((item) => item.dialogue_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dialogues"], message: "Projected dialogue identities must be unique." });
  }
  value.dialogues.forEach((dialogue, index) => {
    if (dialogue.span.quote !== dialogue.exact_text) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dialogues", index, "span"], message: "Projected dialogue text must equal its exact source quote." });
    }
  });
});

export const SemanticReferenceUsageSchema = z.object({
  asset_id: AssetIdSchema,
  provider_role: z.enum(["SUBJECT", "SCENE", "STYLE"]),
  usage: z.string().min(1).max(1_000),
  evidence_refs: z.array(SemanticEvidenceRefSchema).min(1).max(16),
}).strict();


export const SemanticReferenceProjectionSchema = z.object({
  version: z.literal(1),
  source_hash: Sha256Schema,
  decision_hash: Sha256Schema,
  segment_id: SemanticSegmentIdSchema,
  references: z.array(z.object({
    asset_id: AssetIdSchema,
    provider_role: z.enum(["SUBJECT", "SCENE", "STYLE"]),
    usage: z.string().min(1).max(1_000),
    evidence_ids: z.array(SemanticEvidenceIdSchema).min(1).max(16),
  }).strict()).max(7),
}).strict().superRefine((value, context) => {
  const ids = value.references.map((item) => item.asset_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["references"], message: "Projected reference identities must be unique." });
  }
});

export const SemanticUnresolvedItemSchema = z.object({
  unresolved_id: SemanticUnresolvedItemIdSchema,
  question: z.string().min(1).max(1_000),
  blocking: z.boolean(),
  evidence_refs: z.array(SemanticEvidenceRefSchema).max(16),
}).strict();

export const SemanticSegmentDecisionSchema = z.object({
  segment_id: SemanticSegmentIdSchema,
  sequence: z.number().int().positive().max(60),
  duration_seconds: z.number().int().positive().max(600),
  visual_decision: z.string().min(1).max(4_000),
  evidence_refs: z.array(SemanticEvidenceRefSchema).min(1).max(32),
  dialogue_ids: z.array(SemanticDialogueIdSchema).max(120),
  reference_asset_ids: z.array(AssetIdSchema).max(7),
  source_narrative_beat_sequences: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).max(3).optional(),
  scene_candidate_key: SemanticVisualEntityCandidateKeySchema.optional(),
  character_candidate_keys: z.array(SemanticVisualEntityCandidateKeySchema).max(32).optional(),
  prop_candidate_keys: z.array(SemanticVisualEntityCandidateKeySchema).max(32).optional(),
  bgm_intent: z.string().min(1).max(500).optional(),
}).strict();

export const SemanticDirectorDecisionSchema = z.object({
  version: z.literal(1),
  source_hash: Sha256Schema,
  semantic_narrative_beat_lineage: SemanticNarrativeBeatLineageSchema.optional(),
  target_duration_seconds: z.number().int().positive().max(600),
  execution_status: z.enum(["READY", "BLOCKED"]),
  entity_candidates: z.array(SemanticVisualEntityCandidateSchema).max(64).optional(),
  dialogues: z.array(SemanticDialogueDecisionSchema).max(120),
  reference_usages: z.array(SemanticReferenceUsageSchema).max(7),
  segments: z.array(SemanticSegmentDecisionSchema).max(60),
  unresolved_items: z.array(SemanticUnresolvedItemSchema).max(64),
}).strict().superRefine((value, context) => {
  const dialogueIds = value.dialogues.map((item) => item.dialogue_id);
  if (new Set(dialogueIds).size !== dialogueIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dialogues"], message: "Semantic dialogue identities must be unique." });
  }
  const segmentIds = value.segments.map((item) => item.segment_id);
  if (new Set(segmentIds).size !== segmentIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "Semantic segment identities must be unique." });
  }
  value.segments.forEach((segment, index) => {
    if (segment.sequence !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments", index, "sequence"], message: "Semantic segment sequences must be contiguous." });
    }
    if (new Set(segment.dialogue_ids).size !== segment.dialogue_ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments", index, "dialogue_ids"], message: "A dialogue may appear only once inside a segment." });
    }
    if (new Set(segment.reference_asset_ids).size !== segment.reference_asset_ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments", index, "reference_asset_ids"], message: "A reference asset may appear only once inside a segment." });
    }
  });
  const durationTotal = value.segments.reduce((total, segment) => total + segment.duration_seconds, 0);
  const assignedDialogueIds = value.segments.flatMap((segment) => segment.dialogue_ids);
  if (value.execution_status === "READY") {
    if (value.segments.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "A READY decision requires at least one segment." });
    }
    if (durationTotal !== value.target_duration_seconds) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "Semantic segment durations must equal the requested target duration." });
    }
    if (assignedDialogueIds.length !== dialogueIds.length
      || assignedDialogueIds.some((dialogueId, index) => dialogueId !== dialogueIds[index])) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["segments"], message: "Every exact dialogue must be assigned once and in source order." });
    }
    if (value.unresolved_items.some((item) => item.blocking)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["execution_status"], message: "A decision with blocking unresolved items cannot be READY." });
    }
  } else if (!value.unresolved_items.some((item) => item.blocking)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["unresolved_items"], message: "A BLOCKED decision requires at least one blocking unresolved item." });
  }
  const referenceUsageIds = value.reference_usages.map((item) => item.asset_id);
  if (new Set(referenceUsageIds).size !== referenceUsageIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reference_usages"], message: "Semantic reference usage identities must be unique." });
  }
});

export const SEMANTIC_DIRECTOR_DECISION_CONTRACT_VERSION = "semantic-director-decision-v1" as const;

/**
 * Machine-readable structural contract sent to compatible Semantic Director
 * models. Runtime provenance and cross-field checks remain authoritative.
 */
export const SemanticDirectorDecisionJsonSchema = zodToJsonSchema(
  SemanticDirectorDecisionSchema,
  {
    name: "SemanticDirectorDecision",
    target: "jsonSchema7",
    $refStrategy: "root",
  },
);

export type SourceTextSpan = z.infer<typeof SourceTextSpanSchema>;
export type SemanticEvidenceRef = z.infer<typeof SemanticEvidenceRefSchema>;
export type CanonicalDocumentSource = z.infer<typeof CanonicalDocumentSourceSchema>;
export type CanonicalReferenceSource = z.infer<typeof CanonicalReferenceSourceSchema>;
export type CanonicalVisualEntityContext = z.infer<typeof CanonicalVisualEntityContextSchema>;
export type CanonicalUserDecision = z.infer<typeof CanonicalUserDecisionSchema>;
export type CanonicalProviderCapability = z.infer<typeof CanonicalProviderCapabilitySchema>;
export type CanonicalSourceBundle = z.infer<typeof CanonicalSourceBundleSchema>;
export type SemanticNarrativeBeatLineage = z.infer<typeof SemanticNarrativeBeatLineageSchema>;
export type SemanticNarrativeBeatProjection = z.infer<typeof SemanticNarrativeBeatProjectionSchema>;
export type SemanticEntityReferenceProjection = z.infer<typeof SemanticEntityReferenceProjectionSchema>;
export type SemanticVisualEntityCandidate = z.infer<typeof SemanticVisualEntityCandidateSchema>;
export type SemanticDialogueDecision = z.infer<typeof SemanticDialogueDecisionSchema>;
export type SemanticDialogueProjection = z.infer<typeof SemanticDialogueProjectionSchema>;
export type SemanticReferenceUsage = z.infer<typeof SemanticReferenceUsageSchema>;
export type SemanticReferenceProjection = z.infer<typeof SemanticReferenceProjectionSchema>;
export type SemanticUnresolvedItem = z.infer<typeof SemanticUnresolvedItemSchema>;
export type SemanticSegmentDecision = z.infer<typeof SemanticSegmentDecisionSchema>;
export type SemanticDirectorDecision = z.infer<typeof SemanticDirectorDecisionSchema>;

export type SemanticPromptPackageIntegrityInput = Readonly<{
  shotSpecId: string;
  prompt: string;
  referencePolicy: string;
  sourcePrompt: string;
  generatedPromptParts: readonly string[];
  evidenceIds: readonly string[];
  dialogueProjection: SemanticDialogueProjection;
  referenceProjection: SemanticReferenceProjection;
  audioOwner: VideoAudioOwner;
  maxDurationSeconds: number;
  maxReferenceImages: number;
  bgmPrompt?: string;
  promptPackageId?: string;
  semanticEntityReferenceProjection?: SemanticEntityReferenceProjection;
  semanticEntityReferenceProjectionHash?: string;
  semanticNarrativeBeatLineage?: SemanticNarrativeBeatProjection;
  semanticNarrativeBeatLineageHash?: string;
}>;

/**
 * Shared canonical payload for the internal Semantic Director PromptPackage
 * digest. The hash itself stays server-owned; this helper only fixes which
 * immutable fields both persistence and workflow must cover.
 */
export const semanticPromptPackageIntegrityPayload = (
  input: SemanticPromptPackageIntegrityInput,
) => ({
  version: input.semanticEntityReferenceProjection || input.semanticNarrativeBeatLineage ? 2 as const : 1 as const,
  shot_spec_id: input.shotSpecId,
  prompt: input.prompt,
  reference_policy: input.referencePolicy,
  source_prompt: input.sourcePrompt,
  generated_prompt_parts: [...input.generatedPromptParts],
  evidence_ids: [...input.evidenceIds],
  semantic_dialogue_projection: input.dialogueProjection,
  semantic_reference_projection: input.referenceProjection,
  audio_owner: input.audioOwner,
  max_duration_seconds: input.maxDurationSeconds,
  max_reference_images: input.maxReferenceImages,
  ...(input.bgmPrompt ? { bgm_prompt: input.bgmPrompt } : {}),
  ...(input.semanticEntityReferenceProjection ? {
    prompt_package_id: input.promptPackageId,
    semantic_entity_reference_projection: input.semanticEntityReferenceProjection,
    semantic_entity_reference_projection_hash: input.semanticEntityReferenceProjectionHash,
  } : {}),
  ...(input.semanticNarrativeBeatLineage ? {
    semantic_narrative_beat_lineage: input.semanticNarrativeBeatLineage,
    semantic_narrative_beat_lineage_hash: input.semanticNarrativeBeatLineageHash,
  } : {}),
});
