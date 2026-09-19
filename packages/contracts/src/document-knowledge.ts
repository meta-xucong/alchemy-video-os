import { z } from "zod";

import {
  DocumentConversionIdSchema,
  CreativeBriefRevisionIdSchema,
  DocumentFactIdSchema,
  DocumentIdSchema,
  DocumentKnowledgeRevisionIdSchema,
  DocumentKnowledgeSectionIdSchema,
  ProjectIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";

export const DOCUMENT_KNOWLEDGE_REVISION_STATUSES = ["CREATED", "QUEUED", "RUNNING", "READY", "FAILED"] as const;
export const DocumentKnowledgeRevisionStatusSchema = z.enum(DOCUMENT_KNOWLEDGE_REVISION_STATUSES);
export const DocumentKnowledgeAnalysisQualitySchema = z.enum(["COMPLETE", "PARTIAL", "NEEDS_CONFIRMATION"]);
export const DocumentKnowledgeEvidenceKindSchema = z.enum(["TEXT", "TABLE", "VISUAL_UNAVAILABLE"]);
export const DocumentFactCategorySchema = z.enum([
  "BRAND",
  "PRODUCT",
  "LOCATION",
  "AUDIENCE",
  "SELLING_POINT",
  "AMENITY",
  "STYLE",
  "CTA",
  "COMPLIANCE",
  "NUMERIC_CLAIM",
  "RISK",
]);
export const DocumentFactConfidenceSchema = z.enum(["EXPLICIT", "INFERRED", "NEEDS_CONFIRMATION"]);

export const DocumentFactSourceSchema = z.object({
  document_id: DocumentIdSchema,
  conversion_id: DocumentConversionIdSchema,
  section_sequence: z.number().int().positive(),
  locator: z.string().min(1).max(240),
}).strict();

// Public, project-scoped summary. The frozen Markdown asset, hashes, analyzer
// implementation and internal selection rationale deliberately stay private.
export const DocumentKnowledgeRevisionSchema = z.object({
  id: DocumentKnowledgeRevisionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  document_id: DocumentIdSchema,
  conversion_id: DocumentConversionIdSchema,
  status: DocumentKnowledgeRevisionStatusSchema,
  retryable: z.boolean(),
  analysis_quality: DocumentKnowledgeAnalysisQualitySchema.nullable(),
  section_count: z.number().int().nonnegative(),
  fact_count: z.number().int().nonnegative(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const DocumentKnowledgeSectionSummarySchema = z.object({
  id: DocumentKnowledgeSectionIdSchema,
  knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
  sequence: z.number().int().positive(),
  heading: z.string().min(1).max(240),
  locator: z.string().min(1).max(240),
  evidence_kind: DocumentKnowledgeEvidenceKindSchema,
}).strict();

export const DocumentFactSchema = z.object({
  id: DocumentFactIdSchema,
  knowledge_revision_id: DocumentKnowledgeRevisionIdSchema,
  category: DocumentFactCategorySchema,
  statement: z.string().min(1).max(500),
  confidence: DocumentFactConfidenceSchema,
  source: DocumentFactSourceSchema,
}).strict();

/** A short, immutable fact snapshot safe to hand to planning/selection code. */
export const FrozenDocumentFactSchema = z.object({
  fact_id: DocumentFactIdSchema,
  category: DocumentFactCategorySchema,
  statement: z.string().min(1).max(500),
  confidence: DocumentFactConfidenceSchema,
  source: z.object({
    document_id: DocumentIdSchema,
    conversion_id: DocumentConversionIdSchema,
    section_sequence: z.number().int().positive(),
    locator: z.string().min(1).max(240),
  }).strict(),
}).strict();

export const CreativeBriefFactContextSchema = z.object({
  creative_brief_revision_id: CreativeBriefRevisionIdSchema,
  fact_id: DocumentFactIdSchema,
  sequence: z.number().int().positive().max(24),
  fact: FrozenDocumentFactSchema,
  selection_reason: z.string().min(1).max(240),
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const SegmentFactPackSchema = z.object({
  segment_sequence: z.number().int().positive(),
  global_brand_locks: z.array(FrozenDocumentFactSchema).max(12),
  segment_facts: z.array(FrozenDocumentFactSchema).max(8),
  fact_refs: z.array(DocumentFactIdSchema).max(20),
  selection_reason: z.string().min(1).max(240),
}).strict();

export const DocumentKnowledgeDetailSchema = z.object({
  revision: DocumentKnowledgeRevisionSchema,
  sections: z.array(DocumentKnowledgeSectionSummarySchema).max(120),
  facts: z.array(z.object({
    id: DocumentFactIdSchema,
    section_sequence: z.number().int().positive(),
    category: DocumentFactCategorySchema,
    statement: z.string().min(1).max(500),
    confidence: DocumentFactConfidenceSchema,
    source: z.object({ document_id: DocumentIdSchema, conversion_id: DocumentConversionIdSchema, locator: z.string().min(1).max(240) }).strict(),
  }).strict()).max(120),
}).strict();

export const RetryDocumentKnowledgeRevisionCommandSchema = z.object({}).strict();

export type DocumentKnowledgeRevisionStatus = z.infer<typeof DocumentKnowledgeRevisionStatusSchema>;
export type DocumentKnowledgeAnalysisQuality = z.infer<typeof DocumentKnowledgeAnalysisQualitySchema>;
export type DocumentKnowledgeEvidenceKind = z.infer<typeof DocumentKnowledgeEvidenceKindSchema>;
export type DocumentFactCategory = z.infer<typeof DocumentFactCategorySchema>;
export type DocumentFactConfidence = z.infer<typeof DocumentFactConfidenceSchema>;
export type DocumentFactSource = z.infer<typeof DocumentFactSourceSchema>;
export type DocumentKnowledgeRevision = z.infer<typeof DocumentKnowledgeRevisionSchema>;
export type DocumentKnowledgeSectionSummary = z.infer<typeof DocumentKnowledgeSectionSummarySchema>;
export type DocumentFact = z.infer<typeof DocumentFactSchema>;
export type FrozenDocumentFact = z.infer<typeof FrozenDocumentFactSchema>;
export type CreativeBriefFactContext = z.infer<typeof CreativeBriefFactContextSchema>;
export type SegmentFactPack = z.infer<typeof SegmentFactPackSchema>;
export type DocumentKnowledgeDetail = z.infer<typeof DocumentKnowledgeDetailSchema>;
