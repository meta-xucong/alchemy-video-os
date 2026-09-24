import { z } from "zod";

import {
  AssetIdSchema,
  DocumentConversionIdSchema,
  DocumentIdSchema,
  Sha256Schema,
} from "./primitives.js";
import { VideoAudioOwnerSchema } from "./resources.js";

const internalId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,95}$`));

export const SemanticEvidenceIdSchema = internalId("evd");
export const SemanticDialogueIdSchema = internalId("dlg");
export const SemanticSegmentIdSchema = internalId("seg");
export const SemanticDecisionIdSchema = internalId("dec");
export const SemanticUnresolvedItemIdSchema = internalId("unr");

export const SourceTextSpanSchema = z.object({
  start: z.number().int().min(0).max(50_000),
  end: z.number().int().positive().max(50_000),
  quote: z.string().min(1).max(50_000),
}).strict().superRefine((value, context) => {
  if (value.end <= value.start) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "Source span end must be greater than start." });
  }
});

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
  locator: z.string().min(1).max(500),
  quote: z.string().min(1).max(5_000),
}).strict();

export const ReferenceAssetEvidenceRefSchema = z.object({
  evidence_id: SemanticEvidenceIdSchema,
  kind: z.literal("REFERENCE_ASSET"),
  asset_id: AssetIdSchema,
  asset_sha256: Sha256Schema,
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
  content: z.string().min(1).max(2_000_000),
}).strict();

export const CanonicalReferenceSourceSchema = z.object({
  asset_id: AssetIdSchema,
  asset_sha256: Sha256Schema,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  position: z.number().int().min(0).max(6),
  user_declared_usage: z.string().min(1).max(1_000).optional(),
  objective_description: z.string().min(1).max(5_000).optional(),
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
  source_text: z.string().min(1).max(50_000),
  source_hash: Sha256Schema,
  style_preferences: z.string().max(1_000),
  documents: z.array(CanonicalDocumentSourceSchema).max(4),
  references: z.array(CanonicalReferenceSourceSchema).max(7),
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
  bgm_intent: z.string().min(1).max(500).optional(),
}).strict();

export const SemanticDirectorDecisionSchema = z.object({
  version: z.literal(1),
  source_hash: Sha256Schema,
  target_duration_seconds: z.number().int().positive().max(600),
  execution_status: z.enum(["READY", "BLOCKED"]),
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

export type SourceTextSpan = z.infer<typeof SourceTextSpanSchema>;
export type SemanticEvidenceRef = z.infer<typeof SemanticEvidenceRefSchema>;
export type CanonicalDocumentSource = z.infer<typeof CanonicalDocumentSourceSchema>;
export type CanonicalReferenceSource = z.infer<typeof CanonicalReferenceSourceSchema>;
export type CanonicalUserDecision = z.infer<typeof CanonicalUserDecisionSchema>;
export type CanonicalProviderCapability = z.infer<typeof CanonicalProviderCapabilitySchema>;
export type CanonicalSourceBundle = z.infer<typeof CanonicalSourceBundleSchema>;
export type SemanticDialogueDecision = z.infer<typeof SemanticDialogueDecisionSchema>;
export type SemanticDialogueProjection = z.infer<typeof SemanticDialogueProjectionSchema>;
export type SemanticReferenceUsage = z.infer<typeof SemanticReferenceUsageSchema>;
export type SemanticReferenceProjection = z.infer<typeof SemanticReferenceProjectionSchema>;
export type SemanticUnresolvedItem = z.infer<typeof SemanticUnresolvedItemSchema>;
export type SemanticSegmentDecision = z.infer<typeof SemanticSegmentDecisionSchema>;
export type SemanticDirectorDecision = z.infer<typeof SemanticDirectorDecisionSchema>;
