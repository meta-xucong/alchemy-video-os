import { z } from "zod";

import {
  MediaOperationIdSchema,
  Sha256Schema,
} from "./primitives.js";

// This is an internal, loopback-only tool contract. It intentionally has no URL,
// object key, local path, provider field, or browser-visible request shape.
export const MediaRuntimeToolNameSchema = z.enum([
  "INSPECT_VIDEO",
  "EXTRACT_HANDOFF_FRAME",
  "COMPOSE_VIDEO",
]);

export const MediaRuntimeOperationSchema = z.object({
  operation_id: MediaOperationIdSchema,
  tool: MediaRuntimeToolNameSchema,
  expected_sha256: Sha256Schema.optional(),
}).strict();

export const MediaRuntimeVideoInspectionSchema = z.object({
  mime_type: z.literal("video/mp4"),
  sha256: Sha256Schema,
  byte_size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
}).strict();

export const MediaRuntimeImageArtifactSchema = z.object({
  mime_type: z.literal("image/png"),
  sha256: Sha256Schema,
  byte_size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();

export const MediaRuntimeCompositionInputSchema = z.object({
  operation_id: MediaOperationIdSchema,
  tool: z.literal("COMPOSE_VIDEO"),
  segment_count: z.number().int().min(1).max(12),
  expected_sha256: Sha256Schema.optional(),
}).strict();

export type MediaRuntimeToolName = z.infer<typeof MediaRuntimeToolNameSchema>;
export type MediaRuntimeOperation = z.infer<typeof MediaRuntimeOperationSchema>;
export type MediaRuntimeVideoInspection = z.infer<typeof MediaRuntimeVideoInspectionSchema>;
export type MediaRuntimeImageArtifact = z.infer<typeof MediaRuntimeImageArtifactSchema>;
export type MediaRuntimeCompositionInput = z.infer<typeof MediaRuntimeCompositionInputSchema>;
