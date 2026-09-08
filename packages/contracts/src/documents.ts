import { z } from "zod";

import {
  AssetIdSchema,
  DocumentConversionIdSchema,
  DocumentIdSchema,
  DocumentKnowledgeRevisionIdSchema,
  ProjectIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";
import {
  DocumentKnowledgeAnalysisQualitySchema,
  DocumentKnowledgeRevisionStatusSchema,
} from "./document-knowledge.js";

export const DocumentStatusSchema = z.enum(["READY", "ARCHIVED"]);
export const DocumentConversionStatusSchema = z.enum(["CREATED", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);

/**
 * Public, project-scoped understanding state for a converted document.
 *
 * This deliberately contains no Markdown, object key, hash, analyzer or
 * provider fields. The optional field on DocumentConversion keeps C10
 * callers compatible while allowing the project list to expose the C11.2
 * readiness gate in one safe DTO.
 */
export const DocumentUnderstandingSummarySchema = z.object({
  knowledge_revision_id: DocumentKnowledgeRevisionIdSchema.nullable(),
  status: DocumentKnowledgeRevisionStatusSchema.nullable(),
  retryable: z.boolean(),
  analysis_quality: DocumentKnowledgeAnalysisQualitySchema.nullable(),
  fact_count: z.number().int().nonnegative(),
  has_confirmation: z.boolean(),
  has_visual_gaps: z.boolean(),
}).strict();

export const DocumentSchema = z.object({
  id: DocumentIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  source_asset_id: AssetIdSchema,
  status: DocumentStatusSchema,
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const DocumentConversionSchema = z.object({
  id: DocumentConversionIdSchema,
  document_id: DocumentIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  source_asset_id: AssetIdSchema,
  status: DocumentConversionStatusSchema,
  retryable: z.boolean(),
  markdown_asset_id: AssetIdSchema.nullable(),
  warnings: z.array(z.string().min(1).max(512)),
  attempt_count: z.number().int().nonnegative(),
  understanding: DocumentUnderstandingSummarySchema.optional(),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const CreateDocumentConversionCommandSchema = z.object({}).strict();
export const RetryDocumentConversionCommandSchema = z.object({}).strict();

export type DocumentConversionStatus = z.infer<typeof DocumentConversionStatusSchema>;
export type DocumentUnderstandingSummary = z.infer<typeof DocumentUnderstandingSummarySchema>;
export type DocumentConversion = z.infer<typeof DocumentConversionSchema>;
