import { z } from "zod";

import { JsonObjectSchema, RequestIdSchema } from "./primitives.js";

export const ApplicationErrorCodeSchema = z.enum([
  "AUTH_UNAVAILABLE",
  "AUTH_FORBIDDEN",
  "CREDIT_INSUFFICIENT",
  "CREDIT_CONFLICT",
  "CREDIT_UNAVAILABLE",
  "CREDIT_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "PROVIDER_PROTOCOL_INVALID",
  "DOWNLOAD_INVALID",
  "DOCUMENT_UNSUPPORTED",
  "DOCUMENT_CONVERSION_FAILED",
  "DOCUMENT_CONVERSION_ACTIVE_CONFLICT",
  "DOCUMENT_RUNTIME_UNAVAILABLE",
  "DOCUMENT_OUTPUT_INVALID",
  "CREATIVE_PLAN_ACTIVE_CONFLICT",
  "CREATIVE_PLAN_STATE_INVALID",
  "PLANNING_FAILED",
  "STORYBOARD_SPEC_INVALID",
  "PRODUCTION_RUN_ACTIVE_CONFLICT",
  "PRODUCTION_RUN_STATE_INVALID",
  "PRODUCTION_SEGMENT_STATE_INVALID",
  "MEDIA_RUNTIME_UNAVAILABLE",
  "MEDIA_RENDER_FAILED",
  "QC_FAILED",
  "STORAGE_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "SHOT_POSITION_CONFLICT",
  "TASK_RUN_ACTIVE_CONFLICT",
  "WORKSPACE_FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "TASK_STATE_INVALID",
  "INTERNAL_ERROR",
]);

export const ApiErrorSchema = z.object({
  code: ApplicationErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: JsonObjectSchema.default({}),
});

export const ApiFailureEnvelopeSchema = z.object({
  error: ApiErrorSchema,
  request_id: RequestIdSchema,
});

export const successEnvelope = <TSchema extends z.ZodTypeAny>(data: TSchema) =>
  z.object({
    data,
    request_id: RequestIdSchema,
  });

export type ApplicationErrorCode = z.infer<typeof ApplicationErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
