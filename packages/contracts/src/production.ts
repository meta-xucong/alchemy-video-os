import { z } from "zod";

import {
  AssetIdSchema,
  ProductionRunIdSchema,
  ProductionSegmentIdSchema,
  ProjectIdSchema,
  QcReportIdSchema,
  StoryboardRevisionIdSchema,
  UtcTimestampSchema,
  VideoVersionIdSchema,
  WorkspaceIdSchema,
} from "./primitives.js";
import { ProductionRunSchema } from "./creative-planning.js";

export const PRODUCTION_SEGMENT_STATUSES = ["PENDING", "WAITING", "GENERATING", "CHECKING", "ACCEPTED", "FAILED"] as const;
export const ProductionSegmentStatusSchema = z.enum(PRODUCTION_SEGMENT_STATUSES);
export const QC_STATUSES = ["PASS", "NEEDS_ATTENTION", "FAILED"] as const;
export const QcStatusSchema = z.enum(QC_STATUSES);
export const VIDEO_VERSION_STATUSES = ["SUCCEEDED", "FAILED"] as const;
export const VideoVersionStatusSchema = z.enum(VIDEO_VERSION_STATUSES);

// Browser-safe progress view. Task, provider, object-storage, and derived-asset identities remain internal.
export const ProductionSegmentSchema = z.object({
  id: ProductionSegmentIdSchema,
  production_run_id: ProductionRunIdSchema,
  sequence: z.number().int().positive(),
  title: z.string().min(1).max(160),
  status: ProductionSegmentStatusSchema,
  retryable: z.boolean(),
  safe_summary: z.string().min(1).max(1_000),
  created_at: UtcTimestampSchema,
  updated_at: UtcTimestampSchema,
}).strict();

export const ProductionRunProgressSchema = z.object({
  production_run: ProductionRunSchema,
  segments: z.array(ProductionSegmentSchema).max(60),
}).strict();

export const QcReportSchema = z.object({
  id: QcReportIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  subject_type: z.enum(["PRODUCTION_SEGMENT", "VIDEO_VERSION"]),
  subject_id: z.string().min(1),
  kind: z.enum(["TECHNICAL", "COMPOSITION"]),
  status: QcStatusSchema,
  safe_summary: z.string().min(1).max(1_000),
  created_at: UtcTimestampSchema,
}).strict();

export const VideoVersionSchema = z.object({
  id: VideoVersionIdSchema,
  workspace_id: WorkspaceIdSchema,
  project_id: ProjectIdSchema,
  production_run_id: ProductionRunIdSchema,
  storyboard_revision_id: StoryboardRevisionIdSchema,
  asset_id: AssetIdSchema,
  status: VideoVersionStatusSchema,
  duration_ms: z.number().int().positive(),
  qc_report: QcReportSchema,
  created_at: UtcTimestampSchema,
}).strict();

export const RetryProductionSegmentCommandSchema = z.object({}).strict();

export type ProductionSegmentStatus = z.infer<typeof ProductionSegmentStatusSchema>;
export type QcStatus = z.infer<typeof QcStatusSchema>;
export type VideoVersionStatus = z.infer<typeof VideoVersionStatusSchema>;
export type ProductionSegment = z.infer<typeof ProductionSegmentSchema>;
export type ProductionRunProgress = z.infer<typeof ProductionRunProgressSchema>;
export type QcReport = z.infer<typeof QcReportSchema>;
export type VideoVersion = z.infer<typeof VideoVersionSchema>;
