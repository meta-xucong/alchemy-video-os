import { z } from "zod";

import {
  AssetIdSchema,
  DocumentConversionIdSchema,
  DocumentIdSchema,
  ProjectIdSchema,
  UtcTimestampSchema,
  WorkspaceIdSchema,
} from "./primitives.js";

export const DocumentStatusSchema = z.enum(["READY", "ARCHIVED"]);
export const DocumentConversionStatusSchema = z.enum(["CREATED", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);

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
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const CreateDocumentConversionCommandSchema = z.object({}).strict();
export const RetryDocumentConversionCommandSchema = z.object({}).strict();

export type DocumentConversionStatus = z.infer<typeof DocumentConversionStatusSchema>;
export type DocumentConversion = z.infer<typeof DocumentConversionSchema>;
