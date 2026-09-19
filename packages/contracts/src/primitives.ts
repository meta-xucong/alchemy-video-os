import { z } from "zod";

const prefixedId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`));

export const UserIdSchema = prefixedId("usr");
export const WorkspaceIdSchema = prefixedId("ws");
export const ProjectIdSchema = prefixedId("prj");
export const AssetIdSchema = prefixedId("ast");
export const DocumentIdSchema = prefixedId("doc");
export const DocumentConversionIdSchema = prefixedId("dcv");
export const DocumentKnowledgeRevisionIdSchema = prefixedId("dkr");
export const DocumentKnowledgeSectionIdSchema = prefixedId("dks");
export const DocumentFactIdSchema = prefixedId("dft");
export const ShotIdSchema = prefixedId("sht");
export const TaskRunIdSchema = prefixedId("tsk");
export const ProviderAttemptIdSchema = prefixedId("att");
export const UsageRecordIdSchema = prefixedId("use");
export const CreativeBriefRevisionIdSchema = prefixedId("cbr");
export const ScriptRevisionIdSchema = prefixedId("scr");
export const StoryboardRevisionIdSchema = prefixedId("sbr");
export const StoryboardShotSpecIdSchema = prefixedId("ssp");
export const PromptPackageIdSchema = prefixedId("ppk");
export const ProductionRunIdSchema = prefixedId("prd");
export const ProductionSegmentIdSchema = prefixedId("psg");
export const AssetDerivationIdSchema = prefixedId("drv");
export const QcReportIdSchema = prefixedId("qcr");
export const VideoVersionIdSchema = prefixedId("vvr");
export const MediaOperationIdSchema = prefixedId("mop");
export const HandoffReviewIdSchema = prefixedId("hrv");
export const TransitionRepairIdSchema = prefixedId("trp");
export const DeliveryPlanRevisionIdSchema = prefixedId("dpr");
export const NarrationPlanRevisionIdSchema = prefixedId("npr");
export const NarrationScriptRevisionIdSchema = prefixedId("nsr");
export const NarrationAssetVersionIdSchema = prefixedId("nav");
export const TimelinePlanIdSchema = prefixedId("tlp");
export const CapabilityProfileRevisionIdSchema = prefixedId("cpr");
export const VoiceAuthorizationIdSchema = prefixedId("vau");
export const PronunciationGlossaryRevisionIdSchema = prefixedId("pgr");
export const BrandPolicyRevisionIdSchema = prefixedId("bpr");
export const CreativeDecisionLogIdSchema = prefixedId("cdl");
export const BudgetReservationIdSchema = prefixedId("bgr");
export const OutputProfileRevisionIdSchema = prefixedId("opr");
export const QualityGateDecisionIdSchema = prefixedId("qgd");
export const EventIdSchema = prefixedId("evt");
export const RequestIdSchema = z.string().regex(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);

export const UtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const DecimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const IdempotencyKeySchema = z.string().min(1).max(255);
export const JsonObjectSchema = z.record(z.unknown());

export type UserId = z.infer<typeof UserIdSchema>;
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type AssetId = z.infer<typeof AssetIdSchema>;
export type DocumentId = z.infer<typeof DocumentIdSchema>;
export type DocumentConversionId = z.infer<typeof DocumentConversionIdSchema>;
export type DocumentKnowledgeRevisionId = z.infer<typeof DocumentKnowledgeRevisionIdSchema>;
export type DocumentKnowledgeSectionId = z.infer<typeof DocumentKnowledgeSectionIdSchema>;
export type DocumentFactId = z.infer<typeof DocumentFactIdSchema>;
export type ShotId = z.infer<typeof ShotIdSchema>;
export type TaskRunId = z.infer<typeof TaskRunIdSchema>;
export type ProviderAttemptId = z.infer<typeof ProviderAttemptIdSchema>;
export type UsageRecordId = z.infer<typeof UsageRecordIdSchema>;
export type CreativeBriefRevisionId = z.infer<typeof CreativeBriefRevisionIdSchema>;
export type ScriptRevisionId = z.infer<typeof ScriptRevisionIdSchema>;
export type StoryboardRevisionId = z.infer<typeof StoryboardRevisionIdSchema>;
export type StoryboardShotSpecId = z.infer<typeof StoryboardShotSpecIdSchema>;
export type PromptPackageId = z.infer<typeof PromptPackageIdSchema>;
export type ProductionRunId = z.infer<typeof ProductionRunIdSchema>;
export type ProductionSegmentId = z.infer<typeof ProductionSegmentIdSchema>;
export type AssetDerivationId = z.infer<typeof AssetDerivationIdSchema>;
export type QcReportId = z.infer<typeof QcReportIdSchema>;
export type VideoVersionId = z.infer<typeof VideoVersionIdSchema>;
export type MediaOperationId = z.infer<typeof MediaOperationIdSchema>;
export type HandoffReviewId = z.infer<typeof HandoffReviewIdSchema>;
export type TransitionRepairId = z.infer<typeof TransitionRepairIdSchema>;
export type DeliveryPlanRevisionId = z.infer<typeof DeliveryPlanRevisionIdSchema>;
export type NarrationPlanRevisionId = z.infer<typeof NarrationPlanRevisionIdSchema>;
export type NarrationScriptRevisionId = z.infer<typeof NarrationScriptRevisionIdSchema>;
export type NarrationAssetVersionId = z.infer<typeof NarrationAssetVersionIdSchema>;
export type TimelinePlanId = z.infer<typeof TimelinePlanIdSchema>;
export type CapabilityProfileRevisionId = z.infer<typeof CapabilityProfileRevisionIdSchema>;
export type VoiceAuthorizationId = z.infer<typeof VoiceAuthorizationIdSchema>;
export type PronunciationGlossaryRevisionId = z.infer<typeof PronunciationGlossaryRevisionIdSchema>;
export type BrandPolicyRevisionId = z.infer<typeof BrandPolicyRevisionIdSchema>;
export type CreativeDecisionLogId = z.infer<typeof CreativeDecisionLogIdSchema>;
export type BudgetReservationId = z.infer<typeof BudgetReservationIdSchema>;
export type OutputProfileRevisionId = z.infer<typeof OutputProfileRevisionIdSchema>;
export type QualityGateDecisionId = z.infer<typeof QualityGateDecisionIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
