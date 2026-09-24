import { createHash } from "node:crypto";

import {
  CanonicalSourceBundleSchema,
  SemanticDirectorDecisionSchema,
  SemanticDialogueProjectionSchema,
  SemanticReferenceProjectionSchema,
  type CanonicalProviderCapability,
  type CanonicalReferenceSource,
  type CanonicalSourceBundle,
  type SemanticDirectorDecision,
  type SemanticEvidenceRef,
  type SemanticDialogueProjection,
  type SemanticReferenceProjection,
} from "@alchemy-video/contracts";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
};

export const semanticValueHash = (value: unknown) => sha256(stableJson(value));

export type CanonicalSourceBundleInput = Readonly<{
  sourceText: string;
  stylePreferences: string;
  targetDurationSeconds: number;
  documents?: readonly Readonly<{
    documentId: string;
    conversionId: string;
    content: string;
  }>[];
  references?: readonly CanonicalReferenceSource[];
  userDecisions?: readonly Readonly<{
    decisionId: string;
    field: string;
    value: unknown;
  }>[];
  providerCapability: CanonicalProviderCapability;
}>;

export const createCanonicalSourceBundle = (input: CanonicalSourceBundleInput): CanonicalSourceBundle =>
  CanonicalSourceBundleSchema.parse({
    version: 1,
    source_text: input.sourceText,
    source_hash: sha256(input.sourceText),
    style_preferences: input.stylePreferences,
    documents: (input.documents ?? []).map((document) => ({
      document_id: document.documentId,
      conversion_id: document.conversionId,
      markdown_sha256: sha256(document.content),
      content: document.content,
    })),
    references: [...(input.references ?? [])],
    user_decisions: (input.userDecisions ?? []).map((decision) => ({
      decision_id: decision.decisionId,
      field: decision.field,
      value: decision.value,
      value_hash: semanticValueHash(decision.value),
    })),
    provider_capability: input.providerCapability,
    target_duration_seconds: input.targetDurationSeconds,
  });

export type SemanticDecisionVerificationErrorCode =
  | "CANONICAL_BUNDLE_INVALID"
  | "SEMANTIC_DECISION_MALFORMED"
  | "SOURCE_EVIDENCE_INVALID"
  | "DOCUMENT_EVIDENCE_INVALID"
  | "REFERENCE_EVIDENCE_INVALID"
  | "USER_DECISION_EVIDENCE_INVALID"
  | "EVIDENCE_ID_CONFLICT"
  | "DIALOGUE_EVIDENCE_INVALID"
  | "REFERENCE_ORDER_INVALID"
  | "PROVIDER_CAPABILITY_INVALID"
  | "SEMANTIC_DECISION_BLOCKED";

export class SemanticDecisionVerificationError extends Error {
  constructor(
    readonly code: SemanticDecisionVerificationErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SemanticDecisionVerificationError";
  }
}

const invalid = (
  code: SemanticDecisionVerificationErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new SemanticDecisionVerificationError(code, message, cause);
};

const validateCanonicalBundle = (input: unknown): CanonicalSourceBundle => {
  const parsed = CanonicalSourceBundleSchema.safeParse(input);
  if (!parsed.success) return invalid("CANONICAL_BUNDLE_INVALID", "Canonical source bundle schema validation failed.", parsed.error);
  const bundle = parsed.data;
  if (sha256(bundle.source_text) !== bundle.source_hash) {
    return invalid("CANONICAL_BUNDLE_INVALID", "Canonical source hash does not match the frozen source text.");
  }
  for (const document of bundle.documents) {
    if (sha256(document.content) !== document.markdown_sha256) {
      return invalid("CANONICAL_BUNDLE_INVALID", "Canonical document hash does not match its frozen content.");
    }
  }
  for (const decision of bundle.user_decisions) {
    if (semanticValueHash(decision.value) !== decision.value_hash) {
      return invalid("CANONICAL_BUNDLE_INVALID", "Canonical user decision hash does not match its frozen value.");
    }
  }
  if (bundle.target_duration_seconds < bundle.provider_capability.min_duration_seconds) {
    return invalid("PROVIDER_CAPABILITY_INVALID", "Requested duration is below the certified provider minimum.");
  }
  if (bundle.references.length > bundle.provider_capability.max_reference_images) {
    return invalid("PROVIDER_CAPABILITY_INVALID", "Reference count exceeds the certified provider capability.");
  }
  return bundle;
};

const evidenceIdentity = (value: SemanticEvidenceRef) => stableJson(value);

const verifyEvidence = (
  evidence: SemanticEvidenceRef,
  bundle: CanonicalSourceBundle,
  identities: Map<string, string>,
) => {
  const serialized = evidenceIdentity(evidence);
  const previous = identities.get(evidence.evidence_id);
  if (previous !== undefined && previous !== serialized) {
    return invalid("EVIDENCE_ID_CONFLICT", "One evidence identity refers to different immutable facts.");
  }
  identities.set(evidence.evidence_id, serialized);

  if (evidence.kind === "SOURCE_TEXT") {
    const { start, end, quote } = evidence.span;
    if (evidence.source_hash !== bundle.source_hash
      || bundle.source_text.slice(start, end) !== quote) {
      return invalid("SOURCE_EVIDENCE_INVALID", "Source evidence does not match the frozen text and offsets.");
    }
    return;
  }
  if (evidence.kind === "DOCUMENT") {
    const document = bundle.documents.find((item) =>
      item.document_id === evidence.document_id
      && item.conversion_id === evidence.conversion_id);
    if (!document
      || document.markdown_sha256 !== evidence.markdown_sha256
      || !document.content.includes(evidence.quote)) {
      return invalid("DOCUMENT_EVIDENCE_INVALID", "Document evidence does not match a frozen document source.");
    }
    return;
  }
  if (evidence.kind === "REFERENCE_ASSET") {
    const reference = bundle.references.find((item) => item.asset_id === evidence.asset_id);
    if (!reference || reference.asset_sha256 !== evidence.asset_sha256) {
      return invalid("REFERENCE_EVIDENCE_INVALID", "Reference evidence does not match a canonical reference asset.");
    }
    return;
  }
  const decision = bundle.user_decisions.find((item) => item.decision_id === evidence.decision_id);
  if (!decision || decision.field !== evidence.field || decision.value_hash !== evidence.value_hash) {
    return invalid("USER_DECISION_EVIDENCE_INVALID", "User-decision evidence does not match a frozen decision.");
  }
};

const ensureCanonicalAssetOrder = (
  assetIds: readonly string[],
  bundle: CanonicalSourceBundle,
) => {
  const positions = assetIds.map((assetId) => bundle.references.findIndex((item) => item.asset_id === assetId));
  if (positions.some((position) => position < 0)
    || positions.some((position, index) => index > 0 && position <= positions[index - 1]!)) {
    return invalid("REFERENCE_ORDER_INVALID", "Reference identities must exist and preserve canonical order.");
  }
};

export const verifySemanticDirectorDecision = (
  bundleInput: unknown,
  decisionInput: unknown,
): SemanticDirectorDecision => {
  const bundle = validateCanonicalBundle(bundleInput);
  const parsed = SemanticDirectorDecisionSchema.safeParse(decisionInput);
  if (!parsed.success) {
    return invalid("SEMANTIC_DECISION_MALFORMED", "Semantic director response schema validation failed.", parsed.error);
  }
  const decision = parsed.data;
  if (decision.source_hash !== bundle.source_hash
    || decision.target_duration_seconds !== bundle.target_duration_seconds) {
    return invalid("SEMANTIC_DECISION_MALFORMED", "Semantic director response does not target the frozen source bundle.");
  }

  const evidenceIdentities = new Map<string, string>();
  decision.dialogues.forEach((dialogue) => {
    verifyEvidence(dialogue.evidence, bundle, evidenceIdentities);
    if (dialogue.exact_text !== dialogue.evidence.span.quote) {
      invalid("DIALOGUE_EVIDENCE_INVALID", "Exact dialogue must equal its frozen source quote byte-for-byte.");
    }
  });
  const dialogueStarts = decision.dialogues.map((dialogue) => dialogue.evidence.span.start);
  if (dialogueStarts.some((start, index) => index > 0 && start <= dialogueStarts[index - 1]!)) {
    return invalid("DIALOGUE_EVIDENCE_INVALID", "Exact dialogues must follow source order and use distinct spans.");
  }

  const usageAssetIds = decision.reference_usages.map((usage) => usage.asset_id);
  ensureCanonicalAssetOrder(usageAssetIds, bundle);
  decision.reference_usages.forEach((usage) => {
    usage.evidence_refs.forEach((evidence) => verifyEvidence(evidence, bundle, evidenceIdentities));
    if (!usage.evidence_refs.some((evidence) =>
      evidence.kind === "REFERENCE_ASSET" && evidence.asset_id === usage.asset_id)) {
      invalid("REFERENCE_EVIDENCE_INVALID", "Reference usage requires evidence for the same canonical asset.");
    }
  });

  decision.segments.forEach((segment) => {
    if (segment.duration_seconds < bundle.provider_capability.min_duration_seconds
      || segment.duration_seconds > bundle.provider_capability.max_duration_seconds) {
      invalid("PROVIDER_CAPABILITY_INVALID", "Semantic segment duration is outside the certified provider range.");
    }
    segment.evidence_refs.forEach((evidence) => verifyEvidence(evidence, bundle, evidenceIdentities));
    ensureCanonicalAssetOrder(segment.reference_asset_ids, bundle);
  });
  decision.unresolved_items.forEach((item) =>
    item.evidence_refs.forEach((evidence) => verifyEvidence(evidence, bundle, evidenceIdentities)));

  return decision;
};

export const requireExecutableSemanticDecision = (
  decision: SemanticDirectorDecision,
): SemanticDirectorDecision => {
  if (decision.execution_status !== "READY") {
    return invalid("SEMANTIC_DECISION_BLOCKED", "Semantic director decision contains unresolved blocking facts.");
  }
  return decision;
};

export const projectSemanticDialogues = (
  decisionInput: SemanticDirectorDecision,
  segmentId: string,
): SemanticDialogueProjection => {
  const decision = SemanticDirectorDecisionSchema.parse(decisionInput);
  if (decision.execution_status !== "READY") {
    return invalid("SEMANTIC_DECISION_BLOCKED", "A blocked semantic decision cannot be projected for Provider dialogue.");
  }
  const segment = decision.segments.find((item) => item.segment_id === segmentId);
  if (!segment) {
    return invalid("SEMANTIC_DECISION_MALFORMED", "Semantic segment is missing from the verified decision.");
  }
  const dialogueById = new Map(decision.dialogues.map((dialogue) => [dialogue.dialogue_id, dialogue]));
  const dialogues = segment.dialogue_ids.map((dialogueId) => {
    const dialogue = dialogueById.get(dialogueId);
    if (!dialogue) {
      return invalid("SOURCE_EVIDENCE_INVALID", "A segment dialogue has no verified exact-text decision.");
    }
    return {
      dialogue_id: dialogue.dialogue_id,
      exact_text: dialogue.exact_text,
      evidence_id: dialogue.evidence.evidence_id,
      span: dialogue.evidence.span,
    };
  });
  return SemanticDialogueProjectionSchema.parse({
    version: 1,
    source_hash: decision.source_hash,
    decision_hash: semanticValueHash(decision),
    segment_id: segment.segment_id,
    dialogues,
  });
};

export const projectSemanticReferences = (
  decisionInput: SemanticDirectorDecision,
  segmentId: string,
): SemanticReferenceProjection => {
  const decision = SemanticDirectorDecisionSchema.parse(decisionInput);
  if (decision.execution_status !== "READY") {
    return invalid("SEMANTIC_DECISION_BLOCKED", "A blocked semantic decision cannot be projected for Provider references.");
  }
  const segment = decision.segments.find((item) => item.segment_id === segmentId);
  if (!segment) {
    return invalid("SEMANTIC_DECISION_MALFORMED", "Semantic segment is missing from the verified decision.");
  }
  const usageByAsset = new Map(decision.reference_usages.map((usage) => [usage.asset_id, usage]));
  const references = segment.reference_asset_ids.map((assetId) => {
    const usage = usageByAsset.get(assetId);
    if (!usage) {
      return invalid("REFERENCE_EVIDENCE_INVALID", "A segment reference has no verified usage decision.");
    }
    return {
      asset_id: assetId,
      provider_role: usage.provider_role,
      usage: usage.usage,
      evidence_ids: usage.evidence_refs.map((evidence) => evidence.evidence_id),
    };
  });
  return SemanticReferenceProjectionSchema.parse({
    version: 1,
    source_hash: decision.source_hash,
    decision_hash: semanticValueHash(decision),
    references,
  });
};

export interface SemanticDirectorPort {
  decide(bundle: CanonicalSourceBundle): Promise<unknown>;
}

export class VerifiedSemanticDirector {
  constructor(private readonly director: SemanticDirectorPort) {}

  async decide(bundleInput: unknown): Promise<SemanticDirectorDecision> {
    const bundle = validateCanonicalBundle(bundleInput);
    const rawDecision = await this.director.decide(bundle);
    return verifySemanticDirectorDecision(bundle, rawDecision);
  }

  async requireExecutable(bundleInput: unknown): Promise<SemanticDirectorDecision> {
    return requireExecutableSemanticDecision(await this.decide(bundleInput));
  }
}
